import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';

// Shared storage for on-screen feedback pins, through the real route with SQLite storage.
const db=new DatabaseSync(':memory:');
db.exec("CREATE TABLE invites (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', role TEXT NOT NULL, workspace TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT NOT NULL, revoked_at TEXT, link_version INTEGER NOT NULL DEFAULT 1, open_count INTEGER NOT NULL DEFAULT 0, last_opened_at TEXT, last_seen_at TEXT)");db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
db.exec('CREATE TABLE feedback_pins (app TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, ts INTEGER NOT NULL, deleted_at INTEGER, PRIMARY KEY (app, id))');
const key=`theranetrixFeedback_${crypto.randomUUID().replaceAll('-','')}`;
// race.missCheck: the next pre-write read misses a change another request just made.
const race={missCheck:false};
globalThis[key]={prepare(sql){return {bind(...values){return {
  async first(){if(race.missCheck&&sql.startsWith('SELECT id,data,ts,deleted_at')){race.missCheck=false;return null;}return db.prepare(sql).get(...values)??null;},
  async all(){return db.prepare(sql).all(...values);},
  async run(){return {meta:{changes:Number(db.prepare(sql).run(...values).changes)}};},
};}};}};
const bundle=await build({stdin:{contents:"export * from './app/api/feedback/route';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,
  plugins:[{name:'isolated',setup(b){
    b.onResolve({filter:/^@\/lib\/postgres-workspace$/},()=>({path:'storage',namespace:'fb'}));
    b.onResolve({filter:/^@\/lib\/vercel-session$/},()=>({path:'identity',namespace:'fb'}));
    b.onLoad({filter:/.*/,namespace:'fb'},({path})=>({contents:path==='storage'?`export const postgresWorkspace=globalThis[${JSON.stringify(key)}];`:"export {workspaceIdentity as vercelIdentity} from './lib/workspace-identity';",loader:'js',resolveDir:process.cwd()}));
  }}]});
const {GET,POST,DELETE}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const origin='https://theranetrix.test',base=origin+'/api/feedback?app=theranetrix';
const headers={'oai-authenticated-user-email':'reviewer@example.test','oai-authenticated-user-full-name':'Reviewer'};
const get=async()=>(await GET(new Request(base,{headers}))).json();
const post=async pin=>{const r=await POST(new Request(base,{method:'POST',headers:{...headers,'content-type':'application/json',origin},body:JSON.stringify({pin})}));return {status:r.status,body:await r.json()};};
const del=async id=>(await DELETE(new Request(base+'&id='+id,{method:'DELETE',headers:{...headers,origin}}))).status;
const anchor={v:2,sel:'#treatment-decision',requires:['route','tab'],screen:{route:'/patients/TN-DEMO-01',tab:'treatment'},fx:0.5,fy:0.2};
test.after(()=>{db.close();delete globalThis[key];});

test('pins are shared, keep their anchor as an object, and newer edits win',async()=>{
  assert.deepEqual((await get()).pins,[]);
  const saved=await post({id:'pin-1',ts:1000,text:'Decision bar wording',author:'Dan',importance:'high',route:'page',anchor});
  assert.equal(saved.status,200);
  const read=await get();
  assert.equal(read.pins.length,1);
  assert.deepEqual(read.pins[0].anchor,anchor,'The anchor must come back as an object, not a string');
  assert.equal((await post({id:'pin-1',ts:2000,text:'Edited',anchor})).status,200);
  const stale=await post({id:'pin-1',ts:1500,text:'Older copy',anchor});
  assert.equal(stale.status,409);assert.equal(stale.body.pin.text,'Edited');
});

test('a deleted pin stays deleted for other reviewers and is reported as a tombstone',async()=>{
  assert.equal(await del('pin-1'),200);
  const read=await get();
  assert.equal(read.pins.length,0);
  assert.equal(read.deleted[0].id,'pin-1');
  const resurrect=await post({id:'pin-1',ts:1500,text:'Old copy from another browser',anchor});
  assert.equal(resurrect.status,410,'An older copy cannot bring back a deleted pin');
});

test('the route rejects bad input, other origins and signed-out requests',async()=>{
  assert.equal((await post({id:'bad id!',ts:1})).status,400);
  const cross=await POST(new Request(base,{method:'POST',headers:{...headers,'content-type':'application/json',origin:'https://elsewhere.test'},body:JSON.stringify({pin:{id:'x',ts:1}})}));
  assert.equal(cross.status,403);
  assert.equal((await GET(new Request(origin+'/api/feedback?app=bad%20app',{headers}))).status,400);
  const long=await post({id:'long',ts:1,text:'x'.repeat(5000)});
  assert.equal(long.body.pin.text.length,4000,'Text is capped');
});

test('resolving a pin is shared and survives the next refresh',async()=>{
  assert.equal((await post({id:'pin-r',ts:3000,text:'Resolve me',anchor})).status,200);
  const resolved=await post({id:'pin-r',ts:3000,text:'Resolve me',anchor,resolvedAt:'2026-09-24T10:00:00.000Z',resolvedBy:'Dan'});
  assert.equal(resolved.status,200);
  const pin=(await get()).pins.find(p=>p.id==='pin-r');
  assert.equal(pin.resolvedAt,'2026-09-24T10:00:00.000Z');assert.equal(pin.resolvedBy,'Dan');
  await post({id:'pin-r',ts:3000,text:'Resolve me',anchor,resolvedAt:null,resolvedBy:null});
  assert.equal((await get()).pins.find(p=>p.id==='pin-r').resolvedAt,undefined,'Reopening clears it');
});

test('a write that raced past the checks still cannot overwrite a newer edit or undo a delete',async()=>{
  assert.equal((await post({id:'pin-x',ts:5000,text:'Newest edit',anchor})).status,200);
  race.missCheck=true;
  const older=await post({id:'pin-x',ts:4000,text:'Older edit',anchor});
  assert.equal(older.status,409);
  assert.equal((await get()).pins.find(p=>p.id==='pin-x').text,'Newest edit');
  assert.equal(await del('pin-x'),200);
  race.missCheck=true;
  const resurrect=await post({id:'pin-x',ts:5000,text:'Copy from before the delete',anchor});
  assert.equal(resurrect.status,410);
  assert.equal((await get()).pins.some(p=>p.id==='pin-x'),false,'The deleted pin stays deleted');
});
