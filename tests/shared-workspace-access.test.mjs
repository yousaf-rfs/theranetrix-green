import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';

// Real Vercel identity and API handlers; only database transport is replaced.
const db=new DatabaseSync(':memory:');
db.exec("CREATE TABLE invites (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', role TEXT NOT NULL, workspace TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT NOT NULL, revoked_at TEXT, link_version INTEGER NOT NULL DEFAULT 1, open_count INTEGER NOT NULL DEFAULT 0, last_opened_at TEXT, last_seen_at TEXT)");db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
db.exec(await readFile(new URL('../drizzle/0000_left_ikaris.sql',import.meta.url),'utf8'));
db.exec('CREATE TABLE workspace_history (owner_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, label TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY (owner_id, version))');
const binding='sharedWorkspaceAccessTest';
globalThis[binding]={prepare(sql){return {bind(...values){return {
  async first(){return db.prepare(sql).get(...values)??null;},
  async run(){return {meta:{changes:Number(db.prepare(sql).run(...values).changes)}};},
};}};}};
const bundle=await build({
  stdin:{contents:"export * from './app/api/workspace/route';export {POST as sessionPost} from './app/api/session/route';export {vercelIdentity,configured} from './lib/vercel-session';export {seedWorkspace} from './lib/theranetrix';",resolveDir:process.cwd()},
  bundle:true,platform:'node',format:'cjs',packages:'external',write:false,
  plugins:[{name:'isolated-postgres',setup(builder){
    builder.onResolve({filter:/^@\/lib\/postgres-workspace$/},()=>({path:'storage',namespace:'shared-access-test'}));
    builder.onLoad({filter:/.*/,namespace:'shared-access-test'},()=>({contents:`export const postgresWorkspace=globalThis[${JSON.stringify(binding)}];export async function allowLoginAttempt(){throw new Error('Shared access must not attempt password login');}`,loader:'js'}));
  }}],
});
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
const {GET,POST,sessionPost,vercelIdentity,configured,seedWorkspace}=mod.exports;
const origin='https://theranetrix.test',url=origin+'/api/workspace';
const read=async(headers={})=>{const response=await GET(new Request(url,{headers}));assert.equal(response.status,200);return response.json();};
const save=(version,goal,headers={})=>POST(new Request(url,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify({version,action:{type:'goal.update',patientId:'TN-1042',goal}})}));

test.beforeEach(()=>{
  db.exec('DELETE FROM workspaces');
  delete process.env.WORKSPACE_REQUIRE_PASSWORD;
  delete process.env.AUTH_SECRET;
  delete process.env.WORKSPACE_PASSWORD_HASH;
  process.env.WORKSPACE_OWNER_KEY='existing-workspace';
  process.env.WORKSPACE_OWNER_NAME='Previously configured owner';
  process.env.DATABASE_URL='postgresql://unused-test-only';
});
test.after(()=>{db.close();delete globalThis[binding];});

test('password-free access preserves the existing workspace key, records and version',async()=>{
  const existing=seedWorkspace();existing.patients[0].goal='Keep my existing saved record';
  db.prepare('INSERT INTO workspaces(owner_id,data,version,updated_at) VALUES (?,?,?,?)').run('existing-workspace',JSON.stringify(existing),37,new Date().toISOString());
  const result=await read({cookie:'__Host-theranetrix-session=obsolete-cookie','oai-authenticated-user-email':'forged@example.test'});
  assert.equal(result.version,37);assert.equal(result.data.patients[0].goal,existing.patients[0].goal);
  assert.equal(result.user,'Shared workspace visitor');assert.equal(result.accessMode,'shared');
  assert.equal(db.prepare('SELECT count(*) AS total FROM workspaces').get().total,1);
  assert.equal(db.prepare('SELECT owner_id FROM workspaces').get().owner_id,'existing-workspace');
});

test('anonymous saves reload in the same shared workspace with honest audit attribution',async()=>{
  const before=await read();
  const response=await save(before.version,'Saved without an access code');assert.equal(response.status,200);
  const saved=await response.json(),reloaded=await read();assert.deepEqual(reloaded,saved);
  assert.equal(saved.version,before.version+1);assert.equal(saved.data.patients[0].goal,'Saved without an access code');
  assert.equal(saved.data.audit[0].actor,'Shared workspace visitor');assert.equal(saved.accessMode,'shared');
});

test('open access retains stale-write and cross-origin protections',async()=>{
  const before=await read();assert.equal((await save(before.version,'New saved goal')).status,200);
  const saved=await read();
  assert.equal((await save(before.version,'Stale overwrite')).status,409);
  assert.equal((await save(saved.version,'Cross-origin overwrite',{origin:'https://unrelated.test'})).status,403);
  assert.deepEqual(await read(),saved);
});

test('shared access works without old password secrets and clears obsolete session cookies',async()=>{
  assert.equal(configured(),true);
  const response=await sessionPost(new Request(origin+'/api/session',{method:'POST',headers:{origin}}));
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,accessMode:'shared'});
  assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await sessionPost(new Request(origin+'/api/session',{method:'POST',headers:{origin:'https://unrelated.test'}}))).status,403);
  delete process.env.DATABASE_URL;assert.equal(configured(),false);
});

test('only an explicit password opt-in restores the protected boundary',async()=>{
  process.env.WORKSPACE_REQUIRE_PASSWORD='true';
  assert.equal(await vercelIdentity(new Headers()),null);
  assert.equal((await GET(new Request(url))).status,401);
  assert.equal((await save(1,'Must not create records')).status,401);
  assert.equal(db.prepare('SELECT count(*) AS total FROM workspaces').get().total,0);
  assert.equal(configured(),false);
});

test('the default key also retains the original workspace and ignores forged owner headers',async()=>{
  delete process.env.WORKSPACE_OWNER_KEY;
  const identity=await vercelIdentity(new Headers({'x-vercel-user-id':'forged-owner'}));
  assert.deepEqual(identity,{primaryKey:'workspace-owner',lookupKeys:['workspace-owner'],actor:'Shared workspace visitor',accessMode:'shared'});
});
