#!/usr/bin/env node
// Run locally with Node.js 22.13+ (Node 24 recommended).
// This standalone script configures the existing Vercel app. It does not upload source.
import {spawn} from 'node:child_process';
import {randomBytes,scryptSync} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';

const projectId='prj_qSI3xN7l5ynKsb5hXFZ0qXuyTW3U';
const teamId='team_W5mshjfDWraSrzEqyniy9rF6';
const scope='got-ai-s-projects';
const email='daniel@gotai.com';
const origin='https://theranetrix-app.vercel.app';
const storageUrl='https://vercel.com/got-ai-s-projects/theranetrix-app/stores';
const schema=[
  'CREATE TABLE IF NOT EXISTS workspaces (owner_id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0), updated_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS auth_attempts (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, window_started TIMESTAMPTZ NOT NULL DEFAULT NOW())',
];

if(process.argv.includes('--plan')){
  console.log(`TheraNetrix setup plan\nAccount: ${email}\nTeam: ${scope}\nExisting project: ${projectId}\nApp: ${origin}\n\n1. Verify Vercel login and project ownership.\n2. Connect a dedicated Neon database if this project has none.\n3. Create the two workspace tables without replacing records.\n4. Generate a new access code and set server-only production secrets.\n5. Rebuild the current production deployment with those settings.\n6. Check rejected anonymous access, wrong code, valid code, read/reload, and stale-write protection.\n\nExisting Sites records are not imported. A new database starts with synthetic cases.\nRerunning this script rotates the workspace access code.\nNo network requests or changes were made.`);
  process.exit(0);
}

if(!process.argv.includes('--require-password')){
  console.log('The workspace opens without a password. This legacy setup helper enables password protection. Run with --require-password only if you intend to require an access code again.');
  process.exit(0);
}

let temporary;
let activeChild;
let stopping=false;
let cleanupPromise;
class SetupError extends Error{}
function cleanup(){return cleanupPromise??=(async()=>{if(temporary)await rm(temporary,{recursive:true,force:true});})();}
for(const [signal,status]of [['SIGINT',130],['SIGTERM',143]])process.once(signal,()=>{
  stopping=true;
  const child=activeChild;
  const stopped=child?new Promise(resolve=>{child.once('close',resolve);child.kill('SIGTERM');}):Promise.resolve();
  void stopped.then(cleanup).finally(()=>process.exit(status));
});
const run=(command,args,{cwd,input,capture=false,allowFailure=false,environment=process.env}={})=>new Promise((resolve,reject)=>{
  if(stopping){reject(new SetupError('Setup was canceled.'));return;}
  const child=spawn(command,args,{cwd,env:{...environment,NO_UPDATE_NOTIFIER:'1'},stdio:[input===undefined?'inherit':'pipe',capture?'pipe':'inherit',capture?'pipe':'inherit']});
  activeChild=child;
  let stdout='',stderr='';
  if(capture){child.stdout.on('data',part=>{stdout+=part;});child.stderr.on('data',part=>{stderr+=part;});}
  child.on('error',()=>reject(new SetupError(`Could not start ${command}. Confirm Node.js and npm are installed.`)));
  child.on('close',status=>{
    if(activeChild===child)activeChild=undefined;
    // Do not include captured stderr: provider errors may contain credential values.
    if(status!==0&&!allowFailure)reject(new SetupError(`${command} ${args[0]??''} failed (exit ${status}). Check your connection and Vercel account settings, then rerun.`));
    else resolve({status,stdout,stderr});
  });
  if(input!==undefined){child.stdin.on('error',()=>{});child.stdin.end(input);}
});
function decoded(result){try{return JSON.parse(result.stdout);}catch{return null;}}
function requireThat(condition,message){if(!condition)throw new SetupError(message);}

try{
  const [major,minor]=process.versions.node.split('.').map(Number);
  requireThat(major>22||major===22&&minor>=13,'Install Node.js 24, then run this script again.');
  requireThat(process.platform!=='win32','Run this script from macOS, Linux, or WSL with Node.js 24.');
  console.log(`Finishing ${origin} for ${email}.\nThis creates a shared evaluation access code. Keep it in your password manager.\nA new database starts with synthetic cases; existing Sites records stay on the original site.\n`);
  temporary=await mkdtemp(join(tmpdir(),'theranetrix-setup-'));
  await chmod(temporary,0o700);
  const working=join(temporary,'project'),tooling=join(temporary,'tools');
  await mkdir(working);
  console.log('Installing the setup tools in a temporary folder...');
  await run('npm',['install','--prefix',tooling,'--no-audit','--no-fund','vercel@59.15.1','@neondatabase/serverless@1.1.0']);
  const cli=join(tooling,'node_modules/vercel/dist/index.js');
  const cliEnvironment={...process.env,VERCEL_ORG_ID:teamId,VERCEL_PROJECT_ID:projectId};
  delete cliEnvironment.NOW_ORG_ID;
  delete cliEnvironment.NOW_PROJECT_ID;
  const vc=(args,options={})=>run(process.execPath,[cli,...args],{cwd:working,environment:cliEnvironment,...options});
  let account=decoded(await vc(['api','/v2/user','--raw'],{capture:true,allowFailure:true}));
  if(!account?.user?.email){
    console.log(`Sign in to Vercel with ${email} when prompted.`);
    await vc(['login']);
    account=decoded(await vc(['api','/v2/user','--raw'],{capture:true}));
  }
  requireThat(account?.user?.email?.toLowerCase()===email,`Vercel is not signed in as ${email}. Switch accounts with the Vercel CLI, then rerun.`);
  const project=decoded(await vc(['api',`/v9/projects/${projectId}?teamId=${teamId}`,'--raw'],{capture:true}));
  requireThat(project?.id===projectId&&project?.accountId===teamId,'The existing TheraNetrix project could not be verified. No replacement project will be created.');
  const sourceDeployment=project.targets?.production?.id??project.latestDeployments?.find(d=>d.target==='production'&&d.readyState==='READY')?.id;
  requireThat(typeof sourceDeployment==='string'&&/^dpl_[a-zA-Z0-9]+$/.test(sourceDeployment),'No ready production deployment was found to rebuild.');
  await vc(['link','--yes','--project',projectId,'--scope',scope]);
  let linked;
  try{linked=JSON.parse(await readFile(join(working,'.vercel/project.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(linked)requireThat(linked.projectId===projectId&&linked.orgId===teamId,'The local Vercel link did not match TheraNetrix. Setup stopped before changing project settings.');
  const envPath=join(working,'.env.production.local');
  async function productionEnv(){
    await vc(['env','pull',envPath,'--environment','production','--yes','--scope',scope],{capture:true});
    await chmod(envPath,0o600);
    return parseEnv(await readFile(envPath,'utf8'));
  }
  let env=await productionEnv();
  if(!env.DATABASE_URL){
    console.log('Connecting a dedicated Neon database. Choose the Free plan if Vercel asks.');
    console.log('Review any provider plan or account prompt before continuing.');
    await vc(['integration','add','neon','--name','theranetrix-workspace','--environment','production','--no-env-pull','--no-claim','--scope',scope]);
    env=await productionEnv();
  }
  requireThat(!!env.DATABASE_URL,`DATABASE_URL is missing. Connect a dedicated Neon database to production at ${storageUrl}, then rerun.`);
  const schemaReady=process.argv.includes('--schema-ready');
  if(env.DATABASE_URL==='[SENSITIVE]'&&!schemaReady){
    console.log('The existing database URL is a private Vercel secret. No replacement database will be created.');
    console.log('Open the connected Neon database SQL editor and run:\n'+schema.join(';\n')+';');
    throw new SetupError('After those tables are prepared in the connected database, rerun with --schema-ready. Keep DATABASE_URL private.');
  }
  if(!schemaReady){
    let databaseUrl;
    try{databaseUrl=new URL(env.DATABASE_URL);}catch{throw new SetupError('The production DATABASE_URL is not a valid connection URL. Check it in Vercel Storage.');}
    requireThat(['postgres:','postgresql:'].includes(databaseUrl.protocol)&&databaseUrl.hostname.endsWith('.neon.tech'),'The project needs a Neon Postgres connection for this app. No database changes were made.');
    const {neon}=await import(pathToFileURL(join(tooling,'node_modules/@neondatabase/serverless/index.mjs')).href);
    const sql=neon(env.DATABASE_URL);
    console.log('Preparing the database tables...');
    try{for(const statement of schema){requireThat(!stopping,'Setup was canceled.');await sql.query(statement,[]);}}catch{throw new SetupError('The database migration failed. Check the project database connection; connection secrets have not been printed.');}
  }

  const code='TN-'+randomBytes(12).toString('base64url');
  const salt=randomBytes(16).toString('hex');
  const settings={WORKSPACE_REQUIRE_PASSWORD:'true',AUTH_SECRET:randomBytes(48).toString('base64url'),WORKSPACE_PASSWORD_HASH:salt+':'+scryptSync(code,salt,64).toString('hex'),WORKSPACE_OWNER_NAME:'Daniel Rondeau'};
  console.log('Setting the production access code...');
  for(const [key,value]of Object.entries(settings)){
    const privacy=['WORKSPACE_OWNER_NAME','WORKSPACE_REQUIRE_PASSWORD'].includes(key)?'--no-sensitive':'--sensitive';
    await vc(['env','add',key,'production',privacy,'--force','--yes','--scope',scope],{input:value+'\n',capture:true});
  }
  console.log(`\nYour new TheraNetrix access code: ${code}\nSave it now. It becomes active when the deployment below succeeds.\n`);
  await vc(['redeploy',sourceDeployment,'--target','production','--scope',scope]);

  console.log('Checking the live access gate...');
  const request=(path,options={})=>fetch(origin+path,{...options,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
  const anonymous=await request('/api/workspace');
  requireThat(anonymous.status===401,'Anonymous workspace access was not rejected. Review the deployment before sharing it.');
  const unauthorizedWrite=await request('/api/workspace',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
  requireThat(unauthorizedWrite.status===401,'Anonymous workspace writes were not rejected.');
  const wrong=await request('/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:randomBytes(24).toString('base64url')})});
  requireThat(wrong.status===401,'The wrong-code check did not return 401. Check the production authentication settings.');
  const signedIn=await request('/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:code})});
  requireThat(signedIn.status===200,'The new access code could not sign in. Check the Vercel runtime logs.');
  const cookieHeader=signedIn.headers.get('set-cookie')??'';
  requireThat(cookieHeader.includes('__Host-theranetrix-session=')&&/HttpOnly/i.test(cookieHeader)&&/Secure/i.test(cookieHeader),'The session cookie is missing its security attributes.');
  const cookie=cookieHeader.split(';')[0];
  const first=await request('/api/workspace',{headers:{Cookie:cookie}});
  requireThat(first.status===200,'Sign-in succeeded, but the workspace could not load.');
  const workspace=await first.json();
  requireThat(Number.isInteger(workspace.version)&&Array.isArray(workspace.data?.patients),'The workspace response was invalid.');
  const reloaded=await request('/api/workspace',{headers:{Cookie:cookie}});
  requireThat(reloaded.status===200,'The workspace could not reload.');
  const second=await reloaded.json();
  requireThat(second.version>=workspace.version,'The saved workspace version was lost on reload.');
  const stale=await request('/api/workspace',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({version:-1,action:{type:'feature.toggle',feature:'messages',enabled:true}})});
  requireThat(stale.status===409,'Stale-write protection did not return 409.');
  const logout=await request('/api/session',{method:'DELETE',headers:{Cookie:cookie,Origin:origin}});
  requireThat(logout.status===200&&/Max-Age=0/i.test(logout.headers.get('set-cookie')??''),'The sign-out cookie check failed.');
  console.log(`\nVerified: anonymous access blocked, wrong code rejected, sign-in, workspace read/reload, stale-write rejection, and sign-out.\nOpen: ${origin}\nAccess code: ${code}\n\nThe workspace uses synthetic cases. Existing Sites records were not imported.\n`);
}catch(error){
  // Only surface messages created above. Unexpected provider errors can contain secrets.
  console.error('\nSetup stopped. '+(error instanceof SetupError?error.message:'An unexpected setup error occurred. Check the connection and account, then rerun. Provider details were hidden to protect credentials.'));
  process.exitCode=1;
}finally{
  if(activeChild)activeChild.kill('SIGTERM');
  await cleanup();
}
