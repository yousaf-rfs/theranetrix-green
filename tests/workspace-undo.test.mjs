import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';

// Undo steps the shared workspace back one saved change at a time; reset restores the
// demonstration records and can itself be undone. Real route, SQLite storage.
const db=new DatabaseSync(':memory:');
db.exec("CREATE TABLE invites (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', role TEXT NOT NULL, workspace TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT NOT NULL, revoked_at TEXT, link_version INTEGER NOT NULL DEFAULT 1, open_count INTEGER NOT NULL DEFAULT 0, last_opened_at TEXT, last_seen_at TEXT)");db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
db.exec(await readFile(new URL('../drizzle/0000_left_ikaris.sql',import.meta.url),'utf8'));
db.exec('CREATE TABLE workspace_history (owner_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, label TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY (owner_id, version))');
const key=`theranetrixUndo_${crypto.randomUUID().replaceAll('-','')}`;
const faults={historyInsert:false};
globalThis[key]={prepare(sql){return {bind(...values){return {
  async first(){return db.prepare(sql).get(...values)??null;},
  async run(){if(faults.historyInsert&&sql.startsWith('INSERT INTO workspace_history'))throw new Error('Simulated history write failure');return {meta:{changes:Number(db.prepare(sql).run(...values).changes)}};},
};}};}};
const bundle=await build({stdin:{contents:"export * from './app/api/workspace/route';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,
  plugins:[{name:'isolated',setup(b){
    b.onResolve({filter:/^@\/lib\/postgres-workspace$/},()=>({path:'storage',namespace:'undo-test'}));
    b.onResolve({filter:/^@\/lib\/vercel-session$/},()=>({path:'identity',namespace:'undo-test'}));
    b.onLoad({filter:/.*/,namespace:'undo-test'},({path})=>({contents:path==='storage'?`export const postgresWorkspace=globalThis[${JSON.stringify(key)}];`:"export {workspaceIdentity as vercelIdentity} from './lib/workspace-identity';",loader:'js',resolveDir:process.cwd()}));
  }}]});
const {GET,POST}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const origin='https://theranetrix.test',url=origin+'/api/workspace';
const headers={'oai-authenticated-user-email':'undo-clinician@example.test','oai-authenticated-user-full-name':'Undo Test Clinician'};
const read=async()=>(await GET(new Request(url,{headers}))).json();
const post=async(version,action)=>{const response=await POST(new Request(url,{method:'POST',headers:{...headers,'content-type':'application/json',origin},body:JSON.stringify({version,action})}));return {status:response.status,body:await response.json()};};
const emma=w=>w.data.patients.find(p=>p.id==='TN-DEMO-01');
test.after(()=>{db.close();delete globalThis[key];});

test('undo reverses saved changes one at a time, newest first',async()=>{
  const start=await read();
  assert.equal(start.undo,null,'A fresh workspace has nothing to undo');
  const first=await post(start.version,{type:'goal.update',patientId:'TN-DEMO-01',goal:'First goal change'});
  assert.equal(first.status,200);
  assert.match(first.body.undo.label,/Emma Carter/);
  const second=await post(first.body.version,{type:'goal.update',patientId:'TN-DEMO-01',goal:'Second goal change'});
  assert.equal(emma(second.body).goal,'Second goal change');
  const undoOne=await post(second.body.version,{type:'workspace.undo'});
  assert.equal(undoOne.status,200,JSON.stringify(undoOne.body));
  assert.equal(emma(undoOne.body).goal,'First goal change');
  assert.ok(undoOne.body.undone);
  const undoTwo=await post(undoOne.body.version,{type:'workspace.undo'});
  assert.equal(emma(undoTwo.body).goal,emma(start).goal);
  assert.equal(undoTwo.body.undo,null);
  const nothing=await post(undoTwo.body.version,{type:'workspace.undo'});
  assert.equal(nothing.status,400);assert.match(nothing.body.error,/nothing to undo/i);
  assert.deepEqual((await read()).data,undoTwo.body.data,'Undo is persisted');
});

test('reset restores the demonstration records, requires confirmation, and can be undone',async()=>{
  const start=await read();
  const changed=await post(start.version,{type:'goal.update',patientId:'TN-DEMO-01',goal:'Goal before reset'});
  const refused=await post(changed.body.version,{type:'workspace.reset'});
  assert.equal(refused.status,400,'Reset needs its confirmation token');
  const reset=await post(changed.body.version,{type:'workspace.reset',confirm:'reset-demo-data'});
  assert.equal(reset.status,200,JSON.stringify(reset.body));
  assert.notEqual(emma(reset.body).goal,'Goal before reset');
  assert.equal(reset.body.undo.label,'Reset demo data');
  const back=await post(reset.body.version,{type:'workspace.undo'});
  assert.equal(emma(back.body).goal,'Goal before reset');
});

test('undo and reset refuse a stale workspace version',async()=>{
  const current=await read();
  const stale=await post(current.version-1,{type:'workspace.undo'});
  assert.equal(stale.status,409);
});

test('when a change saves but its undo entry cannot be written, undo is not offered for an older change',async()=>{
  const start=await read();
  const first=await post(start.version,{type:'goal.update',patientId:'TN-DEMO-01',goal:'Recorded change'});
  assert.ok(first.body.undo,'The first change can be undone');
  faults.historyInsert=true;
  const errors=console.error;console.error=()=>{};
  let second;
  try{second=await post(first.body.version,{type:'goal.update',patientId:'TN-DEMO-01',goal:'Change without history'});}
  finally{faults.historyInsert=false;console.error=errors;}
  assert.equal(second.status,200,'The save itself still succeeds');
  assert.equal(second.body.undo,null,'Undo must not offer the older change');
  const undo=await post(second.body.version,{type:'workspace.undo'});
  assert.equal(undo.status,400,'Undoing would otherwise discard the newest change');
  assert.equal(emma(await read()).goal,'Change without history');
});
