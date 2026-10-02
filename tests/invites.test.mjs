import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';

// Invite links and sessions against an in-memory database: a link works only as issued, a tampered, replaced or
// turned-off link does not, sessions end with their link, and nobody past the site password is ever turned away.
const db=new DatabaseSync(':memory:');
db.exec("CREATE TABLE invites (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', role TEXT NOT NULL, workspace TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT NOT NULL, revoked_at TEXT, link_version INTEGER NOT NULL DEFAULT 1, open_count INTEGER NOT NULL DEFAULT 0, last_opened_at TEXT, last_seen_at TEXT)");
db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
globalThis.__inviteTestDatabase={prepare(sql){return {bind(...values){return {
  async first(){return db.prepare(sql).get(...values)??null;},
  async all(){return db.prepare(sql).all(...values);},
  async run(){return {meta:{changes:Number(db.prepare(sql).run(...values).changes)}};},
};}};}};
const compiled=await build({stdin:{contents:"export * from './lib/invites'; export {workspaceAccess} from './lib/access';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'test-database',setup(b){
  b.onLoad({filter:/\/lib\/postgres-workspace\.ts$/},()=>({contents:'export const postgresWorkspace=globalThis.__inviteTestDatabase;export async function allowLoginAttempt(){return true;}',loader:'ts'}));
  b.onLoad({filter:/\/lib\/vercel-session\.ts$/},()=>({contents:"export async function vercelIdentity(){return {primaryKey:'workspace-owner',lookupKeys:['workspace-owner'],actor:'Shared workspace visitor',accessMode:'shared'};}",loader:'ts'}));
}}]});
const m=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const cookies=(...values)=>({get:name=>name==='cookie'?values.map(v=>v.split(';')[0]).join('; '):null});
const none={get:()=>null};

test('an invite link works only as issued, and its session follows the invite',async()=>{
  const invite=await m.createInvite({name:'Dr. Jordan Lee',email:'',role:'clinician',workspace:'own',note:''},'Workspace admin');
  const secret=await m.signingSecret(),token=m.linkToken(secret,invite);
  assert.equal((await m.inviteForLink(token))?.id,invite.id);
  for(const bad of [token.slice(0,-1)+(token.endsWith('A')?'B':'A'),invite.id+'.'+'A'.repeat(32),token+'x','../'+token,''])assert.equal(await m.inviteForLink(bad),null,bad);
  const session=await m.openInvite(invite);
  assert.match(session,/^__Host-theranetrix-invite=[^;]+; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=2592000$/);
  const access=await m.workspaceAccess(cookies(session));
  assert.deepEqual(access.identity,{primaryKey:'invite:'+invite.id,lookupKeys:['invite:'+invite.id],actor:'Dr. Jordan Lee',accessMode:'shared'});
  assert.equal((await m.getInvite(invite.id)).openCount,1);
  // A forged session for another invite id fails its signature.
  const [value]=session.split(';')[0].split('=').slice(1),[body,signature]=value.split('.');
  const forged=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(body,'base64url').toString()),id:'someone-else'})).toString('base64url')+'.'+signature;
  assert.equal(await m.sessionInvite(cookies('__Host-theranetrix-invite='+forged)),null);
  // Turning the invite off ends the session and the link; turning it back on restores both.
  await m.updateInvite(invite.id,'revoke');
  assert.equal(await m.sessionInvite(cookies(session)),null);assert.equal(await m.inviteForLink(token),null);
  await m.updateInvite(invite.id,'restore');
  assert.ok(await m.sessionInvite(cookies(session)));
  // A new link retires the old link and every session opened from it.
  const replaced=await m.updateInvite(invite.id,'new-link');
  assert.equal(await m.inviteForLink(token),null);assert.equal(await m.sessionInvite(cookies(session)),null);
  assert.equal((await m.inviteForLink(m.linkToken(secret,replaced)))?.id,invite.id);
});

test('a shared-workspace invite uses the shared workspace under its own name',async()=>{
  const invite=await m.createInvite({name:'Sam Ortiz',email:'sam@example.com',role:'clinician',workspace:'shared',note:''},'Workspace admin');
  const access=await m.workspaceAccess(cookies(await m.openInvite(invite)));
  assert.deepEqual(access.identity,{primaryKey:'workspace-owner',lookupKeys:['workspace-owner'],actor:'Sam Ortiz',accessMode:'shared'});
});

test('a visitor without a link still gets in: the site password is the only gate; the admin uses the shared workspace',async()=>{
  assert.equal((await m.workspaceAccess(none)).identity?.actor,'Shared workspace visitor');
  // A setting left over from the removed invite-only switch has no effect.
  db.prepare("INSERT INTO app_settings (key,value) VALUES ('invite_only','true') ON CONFLICT (key) DO UPDATE SET value=excluded.value").run();
  assert.equal((await m.workspaceAccess(none)).identity?.actor,'Shared workspace visitor');
  assert.equal(await m.isAdmin(none),false);
  const admin=await m.adminSessionHeader();
  assert.deepEqual((await m.workspaceAccess(cookies(admin))).identity,{primaryKey:'workspace-owner',lookupKeys:['workspace-owner'],actor:'Workspace admin',accessMode:'shared'});
});

test('the admin password is set once and then checked',async()=>{
  assert.equal(await m.adminConfigured(),false);
  assert.equal(await m.setupAdmin('correct horse battery'),true);
  assert.equal(await m.setupAdmin('someone else first'),false,'a second setup cannot replace it');
  assert.equal(await m.verifyAdmin('correct horse battery'),true);assert.equal(await m.verifyAdmin('wrong'),false);
  assert.doesNotMatch(db.prepare("SELECT value FROM app_settings WHERE key='admin_password_hash'").get().value,/correct horse/);
  // An expired admin session is refused.
  const old=await m.adminSessionHeader(Date.now()-13*3600_000);
  assert.equal(await m.isAdmin(cookies(old)),false);
});

test('invite details are checked before anything is saved',()=>{
  assert.equal(m.parseInviteInput({name:' ',role:'clinician',workspace:'own'}),'Enter the person’s name.');
  assert.equal(m.parseInviteInput({name:'A',email:'not-an-email',role:'clinician',workspace:'own'}),'That email address does not look right.');
  assert.equal(m.parseInviteInput({name:'A',role:'admin',workspace:'own'}),'Choose where the link opens.');
  assert.equal(m.parseInviteInput({name:'A',role:'patient',workspace:'everyone'}),'Choose which workspace they use.');
  assert.deepEqual(m.parseInviteInput({name:'  Pat  ',email:'',role:'patient',workspace:'own',note:'x'.repeat(400)}),{name:'Pat',email:'',note:'x'.repeat(300),role:'patient',workspace:'own'});
});

test('a pasted list becomes one person per line, from "Name, email", "Name <email>" or a bare email',()=>{
  const {people,errors}=m.parsePeople('Jordan Lee, jordan@example.com\n\n  Sam Ortiz <sam@example.com>\nalex.kim@example.com\nDr. Pat Rivera\n');
  assert.deepEqual(people,[{name:'Jordan Lee',email:'jordan@example.com'},{name:'Sam Ortiz',email:'sam@example.com'},{name:'Alex Kim',email:'alex.kim@example.com'},{name:'Dr. Pat Rivera',email:''}]);
  assert.deepEqual(errors,[]);
  assert.deepEqual(m.parsePeople('<>,\n').errors,['Line 1: add a name or an email address.']);
});
