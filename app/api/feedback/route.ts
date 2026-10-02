import {postgresWorkspace} from '@/lib/postgres-workspace';
import {workspaceAccess} from '@/lib/access';
export const dynamic='force-dynamic';
export const runtime='nodejs';

// Shared storage for on-screen feedback pins (public/feedback-pin). It speaks the same
// protocol as the upstream Vercel Blob backend so the pin script needs no changes:
//   GET    /api/feedback?app=slug          → {v, updatedAt, pins, deleted}
//   POST   /api/feedback?app=slug  {pin}   → {ok, pin} | 409 stale | 410 deleted
//   DELETE /api/feedback?app=slug&id=X     → {ok}
// Pins live in the workspace database, one row per pin; a delete keeps a tombstone
// so another reviewer's older copy cannot bring the pin back.
type Row={id:string;data:string;ts:number|string;deleted_at:number|string|null};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const APP=/^[a-z0-9_-]{1,64}$/i,ID=/^[a-z0-9_-]{1,64}$/i;
const MAX_PINS=1000,MAX_BODY=64*1024,TOMBSTONE_MS=30*86400000;
const CAPS:Record<string,number>={text:4000,label:200,snippet:300,overlay:200,author:80,route:200,importance:32,view:120,resolvedAt:40,resolvedBy:80};

function sanitizeAnchor(value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
  const text=JSON.stringify(value);
  return text.length<=8000?JSON.parse(text) as Record<string,unknown>:undefined;
}
function sanitizePin(input:Record<string,unknown>){
  const pin:Record<string,unknown>={id:String(input.id),ts:Number.isFinite(input.ts)?Math.min(Number(input.ts),Date.now()+60000):Date.now()};
  for(const [key,cap] of Object.entries(CAPS)){const value=input[key];if(typeof value==='string')pin[key]=value.slice(0,cap);}
  for(const key of ['x','y','w','h','scrollY','page'])if(Number.isFinite(input[key]))pin[key]=input[key];
  const anchor=sanitizeAnchor(input.anchor);if(anchor)pin.anchor=anchor;
  if(input.resolved===true)pin.resolved=true;
  return pin;
}
async function authorised(request:Request,write:boolean){
  const access=await workspaceAccess(request.headers);
  if(!access.identity)return json({error:'Please sign in to use feedback.'},401);
  const origin=request.headers.get('origin');
  if(write&&origin&&origin!==new URL(request.url).origin)return json({error:'Invalid request origin.'},403);
  return null;
}
function appFrom(request:Request){const app=new URL(request.url).searchParams.get('app')??'';return APP.test(app)?app:null;}
const db=postgresWorkspace;

export async function GET(request:Request){
  const denied=await authorised(request,false);if(denied)return denied;
  const app=appFrom(request);if(!app)return json({error:'Missing or invalid app.'},400);
  try{
    const since=Date.now()-TOMBSTONE_MS;
    const rows=await allRows(app);
    const pins=rows.filter(row=>row.deleted_at===null).map(row=>JSON.parse(row.data));
    const deleted=rows.filter(row=>row.deleted_at!==null&&Number(row.deleted_at)>=since).map(row=>({id:row.id,deletedAt:Number(row.deleted_at)}));
    const v=rows.reduce((max,row)=>Math.max(max,Number(row.ts),Number(row.deleted_at??0)),0);
    return json({v,updatedAt:v,pins,deleted});
  }catch(error){console.error('Feedback read failed',error);return json({error:'Feedback could not load.'},503);}
}

export async function POST(request:Request){
  const denied=await authorised(request,true);if(denied)return denied;
  const app=appFrom(request);if(!app)return json({error:'Missing or invalid app.'},400);
  const raw=await request.text();if(raw.length>MAX_BODY)return json({error:'Payload too large'},413);
  let body:{pin?:Record<string,unknown>};try{body=JSON.parse(raw);}catch{return json({error:'Invalid request.'},400);}
  const input=body?.pin;
  if(!input||typeof input!=='object'||!ID.test(String(input.id)))return json({error:'Missing or invalid pin.id.'},400);
  const pin=sanitizePin(input);
  try{
    const existing=await db.prepare('SELECT id,data,ts,deleted_at FROM feedback_pins WHERE app = ? AND id = ?').bind(app,pin.id).first<Row>();
    const refused=(row:Row|null)=>row?.deleted_at!=null&&Number(row.deleted_at)>=Number(pin.ts)?json({ok:false,reason:'deleted',deletedAt:Number(row.deleted_at)},410)
      :row&&row.deleted_at==null&&Number(row.ts)>Number(pin.ts)?json({ok:false,reason:'stale',pin:JSON.parse(row.data)},409):null;
    const early=refused(existing);if(early)return early;
    if(!existing){
      const count=await db.prepare('SELECT COUNT(*) AS count FROM feedback_pins WHERE app = ? AND deleted_at IS NULL').bind(app).first<{count:number|string}>();
      if(Number(count?.count??0)>=MAX_PINS)return json({error:`Pin cap reached (${MAX_PINS}).`},429);
    }
    // The same newer-wins and tombstone rules, applied again inside the write, so a
    // concurrent save or delete that lands after the check above cannot be overwritten.
    const result=await db.prepare('INSERT INTO feedback_pins (app,id,data,ts,deleted_at) VALUES (?,?,?,?,NULL) ON CONFLICT (app,id) DO UPDATE SET data = excluded.data, ts = excluded.ts, deleted_at = NULL WHERE feedback_pins.ts <= excluded.ts AND (feedback_pins.deleted_at IS NULL OR feedback_pins.deleted_at < excluded.ts)').bind(app,pin.id,JSON.stringify(pin),pin.ts).run();
    if(result.meta.changes!==1){
      const latest=await db.prepare('SELECT id,data,ts,deleted_at FROM feedback_pins WHERE app = ? AND id = ?').bind(app,pin.id).first<Row>();
      return refused(latest)??json({ok:false,reason:'stale'},409);
    }
    return json({ok:true,v:pin.ts,pin});
  }catch(error){console.error('Feedback save failed',error);return json({error:'Feedback was not saved.'},503);}
}

export async function DELETE(request:Request){
  const denied=await authorised(request,true);if(denied)return denied;
  const app=appFrom(request);if(!app)return json({error:'Missing or invalid app.'},400);
  const id=new URL(request.url).searchParams.get('id')??'';if(!ID.test(id))return json({error:"Missing or invalid 'id'."},400);
  try{
    const now=Date.now();
    await db.prepare("INSERT INTO feedback_pins (app,id,data,ts,deleted_at) VALUES (?,?,'{}',?,?) ON CONFLICT (app,id) DO UPDATE SET deleted_at = excluded.deleted_at").bind(app,id,now,now).run();
    return json({ok:true,v:now});
  }catch(error){console.error('Feedback delete failed',error);return json({error:'Feedback was not deleted.'},503);}
}

async function allRows(app:string):Promise<Row[]>{
  return db.prepare('SELECT id,data,ts,deleted_at FROM feedback_pins WHERE app = ? ORDER BY ts').bind(app).all<Row>();
}
