#!/usr/bin/env node
/**
 * LOCAL SYNTHETIC QA ONLY. This file is never imported by application routes.
 * Usage: node scripts/clinical-workflow-browser-server.mjs [--seed-fixtures] [--start-next] [--smoke]
 * Starts 127.0.0.1:3101; pages/static come from a production build on 127.0.0.1:3100.
 * Workspace route, schemas, reducers, bridges, normalization and SQL are real.
 * Identity and storage adapters are deliberately replaced for this test process.
 * This does not verify production authentication, PostgreSQL or provider adapters.
 */
import http from 'node:http';
import {mkdtemp,readFile,appendFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('../',import.meta.url));
const args=new Set(process.argv.slice(2));
for(const argument of args) if(!['--seed-fixtures','--start-next','--smoke'].includes(argument)) throw new Error('Unsupported QA argument: '+argument);
const port=Number(process.env.THERANETRIX_QA_PORT??3101);
if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('THERANETRIX_QA_PORT must be an unprivileged local port.');
const origin=`http://127.0.0.1:${port}`;
const upstream=new URL(process.env.THERANETRIX_QA_UPSTREAM??'http://127.0.0.1:3100');
function literalLoopback(hostname){return ['127.0.0.1','[::1]'].includes(hostname);}
if(upstream.protocol!=='http:'||!literalLoopback(upstream.hostname)||upstream.username||upstream.password||upstream.pathname!=='/'||upstream.search||upstream.hash) throw new Error('QA upstream must be a plain HTTP loopback origin with no credentials or path.');
if(Number(upstream.port||80)===port) throw new Error('QA proxy and upstream ports must differ.');

const directory=await mkdtemp(join(tmpdir(),'theranetrix-browser-qa-'));
const sqlitePath=join(directory,'synthetic-workspace.sqlite');
const logPath=join(directory,'requests.log');
const db=new DatabaseSync(sqlitePath);
db.exec(await readFile(join(root,'drizzle/0000_left_ikaris.sql'),'utf8'));
db.exec('CREATE TABLE workspace_history (owner_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, label TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY (owner_id, version))');
const storageKey=`theranetrixBrowserQa_${crypto.randomUUID().replaceAll('-','')}`;
globalThis[storageKey]={prepare(sql){return {bind(...values){return {
  async first(){return db.prepare(sql).get(...values)??null;},
  async run(){const result=db.prepare(sql).run(...values);return {meta:{changes:Number(result.changes)}};},
};}};}};
const bundle=await build({
  stdin:{contents:"export * from './app/api/workspace/route'; export {clinicalWorkflowDomains,clinicalWorkflowWorkerProvenance,workspaceCarePlans,workflowInputRevision} from './lib/clinical-flows';",resolveDir:root},
  bundle:true,platform:'node',format:'esm',write:false,
  plugins:[{name:'local-synthetic-qa-storage-and-identity',setup(builder){
    builder.onResolve({filter:/^@\/lib\/postgres-workspace$/},()=>({path:'storage',namespace:'clinical-browser-qa'}));
    builder.onResolve({filter:/^@\/lib\/vercel-session$/},()=>({path:'identity',namespace:'clinical-browser-qa'}));
    builder.onLoad({filter:/.*/,namespace:'clinical-browser-qa'},({path})=>({
      contents:path==='storage'?`export const postgresWorkspace=globalThis[${JSON.stringify(storageKey)}];`:"export {workspaceIdentity as vercelIdentity} from './lib/workspace-identity';",
      loader:'js',resolveDir:root,
    }));
  }}],
});
const route=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const actor='synthetic-browser-qa@example.test';
const fixedIdentity={'oai-authenticated-user-email':actor,'oai-authenticated-user-full-name':'Synthetic Browser QA Owner'};
let signedIn=true;
let failuresRemaining=0;
const counters={workspaceReads:0,workspaceWrites:0,acceptedWrites:0,rejectedWrites:0,injectedFailures:0};
const journeyResults={};
const identityHeaders=()=>signedIn?fixedIdentity:{};
const readWorkspace=async()=>{
  const response=await route.GET(new Request(origin+'/api/workspace',{headers:fixedIdentity}));
  const body=await response.json();
  if(!response.ok) throw new Error('Synthetic workspace could not load: '+JSON.stringify(body));
  return body;
};
const postWorkspace=(workspace,action)=>route.POST(new Request(origin+'/api/workspace',{method:'POST',headers:{...fixedIdentity,'content-type':'application/json',origin},body:JSON.stringify({version:workspace.version,action})}));

// Optional fixture preparation still uses the unchanged route and SQL adapter.
if(args.has('--seed-fixtures')){
  let workspace=await readWorkspace();
  const patientId='TN-1042';
  for(const domain of ['results-referrals','treatment-continuity','encounters','patient-coordination','decisions','integration-access','program-governance']){
    const {runScenarios}=await import(new URL(`../tests/fixtures/${domain}-scenarios.mjs`,import.meta.url));
    const envelope=command=>({type:'workflow.apply',domain,requestId:command.requestId,expectedSliceVersion:workspace.data.clinicalWorkflows.slices[domain].version,...(route.clinicalWorkflowWorkerProvenance[domain].scope==='patient'?{patientId:command.patientId}:{}),command});
    const driver={
      patientId,now:new Date().toISOString(),state:()=>workspace.data.clinicalWorkflows.slices[domain].state,workspace:()=>workspace.data,
      get inputVersion(){return route.workflowInputRevision(workspace.data.patients.find(patient=>patient.id===patientId),workspace.data);},
      get carePlans(){return route.workspaceCarePlans(workspace.data).filter(plan=>plan.patientId===patientId);},
      get planRef(){return workspace.data.patients.find(patient=>patient.id===patientId).carePlans[0]?.id;},
      apply:async command=>{
        const response=await postWorkspace(workspace,envelope(command));
        const saved=await response.json();
        if(!response.ok) throw new Error(`${domain} fixture ${command.type} failed: ${JSON.stringify(saved)}`);
        workspace=await readWorkspace();
        return workspace.data.clinicalWorkflows.slices[domain].state;
      },
      expectRejected:async command=>{
        const prior=structuredClone(workspace);
        const response=await postWorkspace(workspace,envelope(command));
        if(response.ok) throw new Error('Fixture command unexpectedly accepted: '+command.type);
        workspace=await readWorkspace();
        if(!isDeepStrictEqual(workspace,prior)) throw new Error('Rejected fixture changed the persisted workspace.');
      },
      record:(journey,status)=>{journeyResults[journey]=status;},
    };
    await runScenarios(driver);
  }
}
await readWorkspace();

const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-theranetrix-qa':'isolated-synthetic-only'}});
function requestOrigin(request){
  if(!request.url?.startsWith('/')||request.url.startsWith('//')||request.url.includes('\\')) throw new Error('Invalid local request target.');
  const host=request.headers.host;
  if(!host) throw new Error('Missing local Host header.');
  const candidate=new URL('http://'+host);
  if(!['127.0.0.1','localhost','[::1]'].includes(candidate.hostname)||Number(candidate.port||80)!==port||candidate.username||candidate.password) throw new Error('Only the local QA host is accepted.');
  return candidate.origin;
}
function sameOrigin(request,currentOrigin){return !request.headers.origin||request.headers.origin===currentOrigin;}
async function bodyBuffer(request,maxBytes=65536){
  const chunks=[];let size=0;
  for await(const chunk of request){size+=chunk.length;if(size>maxBytes)throw new Error('QA request body too large.');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
async function send(response,nodeResponse){
  nodeResponse.statusCode=response.status;
  for(const [key,value] of response.headers) nodeResponse.setHeader(key,value);
  nodeResponse.setHeader('x-theranetrix-qa','isolated-synthetic-only');
  nodeResponse.end(Buffer.from(await response.arrayBuffer()));
}
function publicStatus(workspace){
  return {harness:'isolated-synthetic-browser-qa',productionAuthentication:false,storage:'temporary-sqlite',signedIn,workspaceVersion:workspace.version,patientCount:workspace.data.patients.length,counters:{...counters},failuresRemaining,fixtureJourneys:journeyResults,
    domains:Object.fromEntries(route.clinicalWorkflowDomains.map(domain=>{
      const slice=workspace.data.clinicalWorkflows.slices[domain];
      const collections=Object.fromEntries(Object.entries(slice.state).filter(([,value])=>Array.isArray(value)).map(([key,value])=>[key,value.length]));
      return [domain,{version:slice.version,collections}];
    })),
  };
}
const blockedForwardHeaders=new Set(['host','authorization','cookie','connection','proxy-authorization','proxy-connection','x-forwarded-host','x-forwarded-for','x-forwarded-proto']);
function forwardPage(request,response,currentOrigin){
  const target=new URL(request.url,upstream);
  if(target.origin!==upstream.origin){response.writeHead(400);response.end('Invalid upstream target.');return;}
  const headers=Object.fromEntries(Object.entries(request.headers).filter(([key])=>!blockedForwardHeaders.has(key)&&!key.startsWith('oai-authenticated-')));
  headers.host=upstream.host;
  const proxy=http.request(target,{method:request.method,headers},incoming=>{
    const outgoingHeaders={...incoming.headers,'x-theranetrix-qa':'isolated-synthetic-only'};
    delete outgoingHeaders['set-cookie'];
    if(outgoingHeaders.location){
      const location=new URL(outgoingHeaders.location,upstream);
      if(location.origin!==upstream.origin){response.writeHead(502,{'content-type':'text/plain'});response.end('QA harness blocked an external redirect.');incoming.resume();return;}
      outgoingHeaders.location=currentOrigin+location.pathname+location.search+location.hash;
    }
    response.writeHead(incoming.statusCode??502,outgoingHeaders);
    incoming.pipe(response);
  });
  proxy.setTimeout(30000,()=>proxy.destroy(new Error('Local page server timed out.')));
  proxy.on('error',()=>{if(!response.headersSent){response.writeHead(502,{'content-type':'text/plain','x-theranetrix-qa':'isolated-synthetic-only'});response.end('The local Next page server is unavailable. Start it on '+upstream.origin+'.');}else response.destroy();});
  request.on('aborted',()=>proxy.destroy());
  request.pipe(proxy);
}

const server=http.createServer(async(request,response)=>{
  const began=Date.now();
  response.on('finish',()=>{void appendFile(logPath,JSON.stringify({at:new Date().toISOString(),method:request.method,path:request.url?.split('?')[0],status:response.statusCode,durationMs:Date.now()-began})+'\n').catch(()=>{});});
  try{
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress??'')){await send(json({error:'Local QA requests only.'},403),response);return;}
    let currentOrigin;
    try{currentOrigin=requestOrigin(request);}catch{await send(json({error:'Only the local QA origin is accepted.'},403),response);return;}
    const url=new URL(request.url,currentOrigin);
    if(url.pathname==='/__qa/status'&&request.method==='GET'){
      await send(json(publicStatus(await readWorkspace())),response);return;
    }
    if(url.pathname==='/__qa/fail-next-save'&&request.method==='POST'){
      if(!sameOrigin(request,currentOrigin)){await send(json({error:'Invalid request origin.'},403),response);return;}
      if(!request.headers['content-type']?.includes('application/json')){await send(json({error:'JSON required.'},415),response);return;}
      const body=JSON.parse((await bodyBuffer(request,2048)).toString()||'{}');
      const count=body.count??1;
      if(!Number.isInteger(count)||count<0||count>5||Object.keys(body).some(key=>key!=='count')){await send(json({error:'Expected {count: 0..5}.'},400),response);return;}
      failuresRemaining=count;
      await send(json({ok:true,qaHarness:true,failuresRemaining,message:'The next workspace POST will receive a synthetic 503 before any route or SQL mutation.'}),response);return;
    }
    if(url.pathname==='/api/session'){
      if(!sameOrigin(request,currentOrigin)){await send(json({error:'Invalid request origin.'},403),response);return;}
      if(request.method==='POST'){
        // Placeholder input is discarded. No production password or secret is read.
        await bodyBuffer(request,2048);signedIn=true;
        await send(json({ok:true,qaHarness:true,message:'Synthetic QA sign-in only; production authentication is not tested.'}),response);return;
      }
      if(request.method==='DELETE'){signedIn=false;await send(json({ok:true,qaHarness:true}),response);return;}
      await send(json({error:'Use POST or DELETE for the synthetic QA session.'},405),response);return;
    }
    if(url.pathname==='/api/workspace'){
      const headers=new Headers(identityHeaders());
      if(request.headers['content-type'])headers.set('content-type',request.headers['content-type']);
      if(request.headers.origin)headers.set('origin',request.headers.origin);
      if(request.method==='GET'){
        counters.workspaceReads++;await send(await route.GET(new Request(url,{headers})),response);return;
      }
      if(request.method==='POST'){
        counters.workspaceWrites++;
        const body=await bodyBuffer(request);
        if(failuresRemaining>0&&sameOrigin(request,currentOrigin)){
          failuresRemaining--;counters.injectedFailures++;counters.rejectedWrites++;
          await send(json({error:'Synthetic QA save failure. Your draft should remain available to retry.',qaHarness:true},503),response);return;
        }
        const result=await route.POST(new Request(url,{method:'POST',headers,body}));
        if(result.ok)counters.acceptedWrites++;else counters.rejectedWrites++;
        await send(result,response);return;
      }
      await send(json({error:'Method not supported.'},405),response);return;
    }
    if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/__qa/')){await send(json({error:'This API is unavailable in the isolated QA harness.'},404),response);return;}
    if(!['GET','HEAD'].includes(request.method??'')){await send(json({error:'Only page and static reads are forwarded.'},405),response);return;}
    forwardPage(request,response,currentOrigin);
  }catch(error){
    if(response.headersSent){response.destroy();return;}
    const tooLarge=error instanceof Error&&error.message==='QA request body too large.';
    await send(json({error:tooLarge?'QA request body too large.':'Local QA harness request failed.',qaHarness:true},tooLarge?413:500),response);
  }
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
console.log(JSON.stringify({message:'ISOLATED SYNTHETIC BROWSER QA; production authentication and database are not used.',url:origin,upstream:upstream.origin,sqlitePath,logPath,fixtureJourneys:journeyResults}));
let localNext;
let shutdownPromise;
function shutdown(){
  if(shutdownPromise)return shutdownPromise;
  shutdownPromise=new Promise(resolve=>{
    server.close(()=>{db.close();delete globalThis[storageKey];resolve();});
    server.closeAllConnections();
    if(localNext&&!localNext.killed)localNext.kill('SIGTERM');
  });
  return shutdownPromise;
}
process.on('SIGTERM',()=>{void shutdown().then(()=>process.exit(0));});
process.on('SIGINT',()=>{void shutdown().then(()=>process.exit(0));});

if(args.has('--start-next')){
  // For ordinary local use, keep Next and the proxy in the same process tree.
  // The child receives no production database, password, token, or session env.
  try{
    await readFile(join(root,'.next/BUILD_ID'),'utf8');
    localNext=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'start','--hostname',upstream.hostname.replace(/^\[|\]$/g,''),'--port',String(Number(upstream.port||80))],{
      cwd:root,env:{PATH:process.env.PATH??'',NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','inherit','inherit'],
    });
    localNext.once('error',error=>console.error('Local Next child failed:',error.message));
    localNext.once('exit',code=>{if(code&&!shutdownPromise)console.error('Local Next exited with status',code);});
  }catch(error){
    await shutdown();throw new Error('Build Next before using --start-next: '+(error instanceof Error?error.message:'build unavailable'));
  }
}

if(args.has('--smoke')){
  // In-process HTTP validation only. This flag never opens or automates a browser.
  const check=(condition,message)=>{if(!condition)throw new Error('QA smoke: '+message);};
  const localRequest=(path,method='GET',body,extraHeaders={})=>new Promise((resolve,reject)=>{
    const encoded=body===undefined?undefined:JSON.stringify(body);
    const request=http.request(new URL(path,origin),{method,headers:{...(encoded?{'content-type':'application/json',origin}:{}),...extraHeaders}},response=>{
      const chunks=[];
      response.on('data',chunk=>chunks.push(chunk));
      response.on('end',()=>{
        try{resolve({status:response.statusCode,headers:response.headers,body:JSON.parse(Buffer.concat(chunks).toString())});}catch(error){reject(error);}
      });
    });
    request.on('error',reject);request.end(encoded);
  });
  try{
    let loaded=await localRequest('/api/workspace');
    check(loaded.status===200,'initial route GET');
    check(loaded.body.user===actor,'fixed synthetic identity');
    const spoofed=await localRequest('/api/workspace','GET',undefined,{'oai-authenticated-user-email':'browser-forged@example.test'});
    check(spoofed.body.user===actor,'browser identity claims ignored');
    let workspace=loaded.body;
    const makeSave=label=>{
      const slice=workspace.data.clinicalWorkflows.slices['integration-access'];
      const command={type:'integration-access.source.save',requestId:crypto.randomUUID(),expectedVersion:slice.state.version,source:{sourceId:'qa-proxy-smoke',label,freshUntil:'2099-01-01T00:00:00.000Z',enabled:false,adapterMode:'unconfigured'}};
      return {version:workspace.version,action:{type:'workflow.apply',domain:'integration-access',requestId:command.requestId,expectedSliceVersion:slice.version,command}};
    };
    const saved=await localRequest('/api/workspace','POST',makeSave('Synthetic smoke source draft'));
    check(saved.status===200,'real schema/reducer/SQL save');
    loaded=await localRequest('/api/workspace');
    check(isDeepStrictEqual(loaded.body,saved.body),'saved state persists on GET reload');
    workspace=loaded.body;
    const retry=makeSave('Synthetic draft retained after failed save');
    const toggled=await localRequest('/__qa/fail-next-save','POST',{count:1});
    check(toggled.status===200,'failure injection enabled');
    const failed=await localRequest('/api/workspace','POST',retry);
    check(failed.status===503,'deliberate save failure');
    loaded=await localRequest('/api/workspace');
    check(isDeepStrictEqual(loaded.body,workspace),'failed save leaves SQL state unchanged');
    const recovered=await localRequest('/api/workspace','POST',retry);
    check(recovered.status===200,'identical draft retries successfully');
    loaded=await localRequest('/api/workspace');
    check(isDeepStrictEqual(loaded.body,recovered.body),'retry persists on GET reload');
    const crossOrigin=await localRequest('/api/workspace','POST',{},{origin:'https://external.example.test'});
    check(crossOrigin.status===403,'real route rejects cross-origin writes');
    const unknown=await localRequest('/api/production-only');
    check(unknown.status===404,'unknown APIs are not forwarded');
    const status=await localRequest('/__qa/status');
    check(status.body.failuresRemaining===0,'failure toggle consumed');
    check(status.body.counters.injectedFailures===1,'one failed save counted');
    check(loaded.body.data.clinicalWorkflows.slices['integration-access'].state.acceptedEvents.length===0,'no external clinical data invented');
    console.log(JSON.stringify({smoke:'passed',browserTested:false,syntheticIdentity:true,realRouteSqlReload:true,failedSaveUnchanged:true,draftRetrySaved:true,workspaceVersion:loaded.body.version,logPath}));
  }finally{await shutdown();}
}
