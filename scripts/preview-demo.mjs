/**
 * Local synthetic-data preview. The normal Next.js API and its production
 * authentication remain unchanged. Only this separate loopback server binds
 * the workspace route to an isolated, in-memory test database and identity.
 */
import http from 'node:http';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createWriteStream} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');

export async function startDemoPreview({port=3030,appPort=3000,logPath,production=process.env.THERANETRIX_PREVIEW_MODE==='production'}={}){
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE workspaces (owner_id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)');
  db.exec('CREATE TABLE workspace_history (owner_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, label TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY (owner_id, version))');
  db.exec('CREATE TABLE feedback_pins (app TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, ts INTEGER NOT NULL, deleted_at INTEGER, PRIMARY KEY (app, id))');
  db.exec("CREATE TABLE invites (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', role TEXT NOT NULL, workspace TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT NOT NULL, revoked_at TEXT, link_version INTEGER NOT NULL DEFAULT 1, open_count INTEGER NOT NULL DEFAULT 0, last_opened_at TEXT, last_seen_at TEXT)");
  db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const binding={prepare(sql){return {bind(...values){return {
    async first(){return db.prepare(sql).get(...values)??null;},
    async all(){return db.prepare(sql).all(...values);},
    async run(){return {meta:{changes:Number(db.prepare(sql).run(...values).changes)}};},
  };}};}};
  const key='__theranetrixLocalPreviewDatabase';
  globalThis[key]=binding;
  const compile=entry=>build({entryPoints:[resolve(projectRoot,entry)],bundle:true,platform:'node',format:'esm',write:false,plugins:[{
    name:'local-preview-only-adapters',
    setup(builder){
      builder.onLoad({filter:/\/lib\/postgres-workspace\.ts$/},()=>({contents:`export const postgresWorkspace=globalThis[${JSON.stringify(key)}];export async function allowLoginAttempt(){return true;}`,loader:'ts'}));
      builder.onLoad({filter:/\/lib\/vercel-session\.ts$/},()=>({contents:"export async function vercelIdentity(){return {primaryKey:'local-synthetic-preview',lookupKeys:['local-synthetic-preview'],actor:'Demo care team',accessMode:'shared'};}",loader:'ts'}));
    },
  }]});
  const load=async entry=>import('data:text/javascript;base64,'+Buffer.from((await compile(entry)).outputFiles[0].text).toString('base64'));
  const handlers=await load('app/api/workspace/route.ts'),feedbackHandlers=await load('app/api/feedback/route.ts');
  const adminSession=await load('app/api/admin/session/route.ts'),adminInvites=await load('app/api/admin/invites/route.ts'),inviteLink=await load('app/i/[token]/route.ts');
  const app=spawn(process.execPath,[resolve(projectRoot,'node_modules/next/dist/bin/next'),production?'start':'dev','--hostname','127.0.0.1','--port',String(appPort),...(production?[]:['--webpack'])],{cwd:projectRoot,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
  const log=logPath?createWriteStream(logPath):null;
  app.stdout.pipe(log??process.stdout);app.stderr.pipe(log??process.stderr);
  const server=http.createServer(async(req,res)=>{
    try{
      const pathname=new URL(req.url,'http://localhost').pathname;
      if(pathname==='/__preview/status'){
        res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({mode:'synthetic-local-preview',persistent:false}));return;
      }
      if(pathname==='/api/workspace'){
        if(!['GET','POST'].includes(req.method)){res.writeHead(405);res.end('Method not supported');return;}
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>32000){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
        const headers=new Headers();
        for(const [name,value] of Object.entries(req.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(', '):value);
        const request=new Request(`http://127.0.0.1:${port}${req.url}`,{method:req.method,headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})});
        const response=await handlers[req.method](request);
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
      }
      if(pathname==='/api/feedback'){
        if(!['GET','POST','DELETE'].includes(req.method)){res.writeHead(405);res.end('Method not supported');return;}
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const headers=new Headers();for(const [name,value] of Object.entries(req.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(', '):value);
        const response=await feedbackHandlers[req.method](new Request(`http://127.0.0.1:${port}${req.url}`,{method:req.method,headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})}));
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
      }
      // Invite links and the invite dashboard's API use the same in-memory database as the workspace.
      const inviteRoute=pathname==='/api/admin/session'?adminSession:pathname==='/api/admin/invites'?adminInvites:/^\/i\/[^/]+$/.test(pathname)?inviteLink:null;
      if(inviteRoute){
        const handler=inviteRoute[req.method];if(!handler){res.writeHead(405);res.end('Method not supported');return;}
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const headers=new Headers();for(const [name,value] of Object.entries(req.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(', '):value);
        const request=new Request(`http://127.0.0.1:${port}${req.url}`,{method:req.method,headers,...(['POST','PATCH','PUT'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
        const response=await handler(request,{params:Promise.resolve({token:decodeURIComponent(pathname.slice(3))})});
        const out={};response.headers.forEach((value,name)=>{out[name]=name in out?[].concat(out[name],value):value;});
        res.writeHead(response.status,out);res.end(Buffer.from(await response.arrayBuffer()));return;
      }
      if(pathname==='/api/session'){
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:true,accessMode:'shared'}));return;
      }
      const upstream=http.request({hostname:'127.0.0.1',port:appPort,path:req.url,method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
      res.on('error',()=>upstream.destroy());
      upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('The local app is starting. Refresh shortly.');});req.pipe(upstream);
    }catch(error){console.error('Local preview request failed:',error);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'The local preview request failed.'}));}
  });
  server.on('upgrade',(req,socket,head)=>{
    socket.on('error',()=>socket.destroy());
    const upstream=http.request({hostname:'127.0.0.1',port:appPort,path:req.url,method:req.method,headers:req.headers});
    upstream.on('upgrade',(response,peer,data)=>{
      socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(response.headers).map(([name,value])=>name+': '+value).join('\r\n')+'\r\n\r\n');
      peer.on('error',()=>socket.destroy());socket.on('error',()=>peer.destroy());
      if(data.length)socket.write(data);if(head.length)peer.write(head);peer.pipe(socket);socket.pipe(peer);
    });upstream.on('error',()=>socket.destroy());upstream.end();
  });
  await new Promise((resolveReady,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolveReady);});
  console.log(`Synthetic local preview: http://127.0.0.1:${port}`);
  console.log('Sample records only. Changes reset when this preview stops. Production data and authentication are unchanged.');
  return {url:`http://127.0.0.1:${port}`,server,app,db,async close(){server.closeAllConnections();server.close();app.kill('SIGTERM');db.close();delete globalThis[key];if(log)log.end();}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const preview=await startDemoPreview();
  let closing=false;
  const stop=async()=>{if(closing)return;closing=true;await preview.close();process.exit(0);};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
