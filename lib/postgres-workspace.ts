import {neon} from '@neondatabase/serverless';
import {createHash} from 'node:crypto';

function database(){const url=process.env.DATABASE_URL;if(!url)throw new Error('Database is not configured');return neon(url);}

let schemaReady:Promise<void>|null=null;
async function ensureSchema(){
  if(!schemaReady){
    const sql=database();
    schemaReady=(async()=>{
      await sql.query(`CREATE TABLE IF NOT EXISTS workspaces (
        owner_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        updated_at TEXT NOT NULL
      )`);
      await sql.query(`CREATE TABLE IF NOT EXISTS workspace_history (
        owner_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        data TEXT NOT NULL,
        label TEXT NOT NULL,
        actor TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, version)
      )`);
      await sql.query(`CREATE TABLE IF NOT EXISTS feedback_pins (
        app TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        ts BIGINT NOT NULL,
        deleted_at BIGINT,
        PRIMARY KEY (app, id)
      )`);
      await sql.query(`CREATE TABLE IF NOT EXISTS invites (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL,
        workspace TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        revoked_at TEXT,
        link_version INTEGER NOT NULL DEFAULT 1,
        open_count INTEGER NOT NULL DEFAULT 0,
        last_opened_at TEXT,
        last_seen_at TEXT
      )`);
      await sql.query(`CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`);
      await sql.query(`CREATE TABLE IF NOT EXISTS auth_attempts (
        bucket TEXT PRIMARY KEY,
        attempts INTEGER NOT NULL DEFAULT 0,
        window_started TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    })();
  }
  await schemaReady;
}

/** D1-compatible prepared operations backed by parameterized Postgres queries. */
export const postgresWorkspace={prepare(statement:string){
  let index=0;
  let query=statement.replaceAll('?',()=>'$'+(++index));
  if(query.startsWith('INSERT OR IGNORE INTO workspaces'))query=query.replace('INSERT OR IGNORE','INSERT')+' ON CONFLICT (owner_id) DO NOTHING';
  return {bind(...values:unknown[]){return {
    async first<T>(){await ensureSchema();const rows=await database().query(query,values);return (rows[0]??null) as T|null;},
    async all<T>(){await ensureSchema();return (await database().query(query,values)) as T[];},
    async run(){await ensureSchema();const result=await database().query(query,values,{fullResults:true});return {meta:{changes:result.rowCount??0}};},
  };}};
}};

// Vercel overwrites x-forwarded-for at its edge. Hash it before storing a rate-limit key.
export async function allowLoginAttempt(request:Request){
  await ensureSchema();
  const ip=request.headers.get('x-forwarded-for')?.split(',')[0].trim()??'unknown-source';
  const bucket='login:'+createHash('sha256').update(ip).digest('hex');
  const rows=await database().query(`INSERT INTO auth_attempts (bucket,attempts,window_started) VALUES ($1,1,NOW())
    ON CONFLICT (bucket) DO UPDATE SET
      attempts=CASE WHEN auth_attempts.window_started<NOW()-INTERVAL '15 minutes' THEN 1 ELSE auth_attempts.attempts+1 END,
      window_started=CASE WHEN auth_attempts.window_started<NOW()-INTERVAL '15 minutes' THEN NOW() ELSE auth_attempts.window_started END
    RETURNING attempts`,[bucket]);
  return Number(rows[0]?.attempts)<=20;
}
