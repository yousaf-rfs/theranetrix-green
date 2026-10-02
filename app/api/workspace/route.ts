import {postgresWorkspace} from '@/lib/postgres-workspace';
import {workspaceAccess} from '@/lib/access';
import {actionSchema,applyAction,type Action} from '@/lib/actions';
import {seedWorkspace,type Workspace} from '@/lib/theranetrix';
import {ensureShowcaseData} from '@/lib/demo-showcase';
import {normalizeWorkspace} from '@/lib/medications';
import {type WorkspaceIdentity} from '@/lib/workspace-identity';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export const runtime='nodejs';
function database(){return postgresWorkspace;}
function hasAcceptedRequest(data:Workspace,action:Action){
  if(!('requestId' in action)||!action.requestId)return false;
  const id=action.requestId;
  if(action.type==='workflow.apply'){
    const slice=data.clinicalWorkflows?.slices[action.domain];
    if(slice?.receipts.some(receipt=>receipt.id===id))return true;
    return Object.entries(slice?.state??{}).filter(([key])=>/receipt/i.test(key)).some(([,rows])=>Array.isArray(rows)&&rows.some(row=>row&&typeof row==='object'&&(row.requestId===id||row.actionId===id||row.id===id)));
  }
  if(action.type==='care.operations')return !!data.careOperations?.receipts.some(receipt=>receipt.id===id);
  if(action.type==='demonstration.connection')return !!data.demoConnection?.receipts.some(receipt=>receipt.id===id);
  return !!data.actionReceipts?.some(receipt=>receipt.id===id);
}
async function read(user:WorkspaceIdentity){
  const db=database();
  type Row={owner_id:string;data:string;version:number};
  let row:Row|null=null;
  for(const key of user.lookupKeys){
    row=await db.prepare('SELECT owner_id,data,version FROM workspaces WHERE owner_id = ?').bind(key).first<Row>();
    if(row)break;
  }
  if(!row){await db.prepare('INSERT OR IGNORE INTO workspaces (owner_id,data,version,updated_at) VALUES (?,?,1,?)').bind(user.primaryKey,JSON.stringify(ensureShowcaseData(seedWorkspace(),user.actor)),new Date().toISOString()).run();row=await db.prepare('SELECT owner_id,data,version FROM workspaces WHERE owner_id = ?').bind(user.primaryKey).first<Row>();}
  if(!row)throw new Error('Workspace unavailable');
  return {data:normalizeWorkspace(JSON.parse(row.data) as Workspace),version:row.version,ownerKey:row.owner_id};
}
// Undo history: the state before each saved change, newest first. It lives beside the
// workspace row so the workspace itself stays small. History is best effort: a failure
// to record or read it never blocks the save it describes, and a failure to record it
// clears the older entries so Undo is never offered for the wrong change.
const historyDepth=25;
type UndoInfo={label:string;actor:string;savedAt:string}|null;
async function latestUndo(ownerKey:string):Promise<UndoInfo>{
  try{const row=await database().prepare('SELECT label,actor,saved_at FROM workspace_history WHERE owner_id = ? ORDER BY version DESC LIMIT 1').bind(ownerKey).first<{label:string;actor:string;saved_at:string}>();return row?{label:row.label,actor:row.actor,savedAt:row.saved_at}:null;}
  catch(error){console.error('Undo history unavailable',error);return null;}
}
async function remember(ownerKey:string,version:number,previous:Workspace,label:string,actor:string){
  try{
    await database().prepare('INSERT INTO workspace_history (owner_id,version,data,label,actor,saved_at) VALUES (?,?,?,?,?,?)').bind(ownerKey,version,JSON.stringify(previous),label,actor,new Date().toISOString()).run();
    await database().prepare('DELETE FROM workspace_history WHERE owner_id = ? AND version <= ?').bind(ownerKey,version-historyDepth).run();
  }catch(error){
    console.error('Undo history not recorded',error);
    // Without this change's entry the newest remaining one is older, and restoring it
    // would also throw away the change just saved. Offer no undo rather than that one.
    await database().prepare('DELETE FROM workspace_history WHERE owner_id = ?').bind(ownerKey).run().catch(clearError=>console.error('Undo history not cleared',clearError));
  }
}
function changeLabel(data:Workspace){
  const entry=data.audit?.[0],patient=entry?.patientId?data.patients.find(p=>p.id===entry.patientId)?.name:undefined;
  return (entry?.action??'Saved change')+(patient?' · '+patient:'');
}
async function control(kind:'workspace.undo'|'workspace.reset',user:WorkspaceIdentity,version:number){
  const current=await read(user);
  if(current.version!==version)return json({error:'This workspace changed in another tab. Refresh and try again.'},409);
  let next:Workspace,undone='';
  if(kind==='workspace.undo'){
    const row=await database().prepare('SELECT version,data,label FROM workspace_history WHERE owner_id = ? ORDER BY version DESC LIMIT 1').bind(current.ownerKey).first<{version:number;data:string;label:string}>().catch(()=>null);
    if(!row)return json({error:'There is nothing to undo.'},400);
    next=normalizeWorkspace(JSON.parse(row.data) as Workspace);undone=row.label;
    const result=await database().prepare('UPDATE workspaces SET data = ?, version = version + 1, updated_at = ? WHERE owner_id = ? AND version = ?').bind(row.data,new Date().toISOString(),current.ownerKey,current.version).run();
    if(result.meta.changes!==1)return json({error:'Another change was saved first. Refresh and try again.'},409);
    await database().prepare('DELETE FROM workspace_history WHERE owner_id = ? AND version = ?').bind(current.ownerKey,row.version).run();
  }else{
    next=ensureShowcaseData(seedWorkspace(),user.actor);
    const result=await database().prepare('UPDATE workspaces SET data = ?, version = version + 1, updated_at = ? WHERE owner_id = ? AND version = ?').bind(JSON.stringify(next),new Date().toISOString(),current.ownerKey,current.version).run();
    if(result.meta.changes!==1)return json({error:'Another change was saved first. Refresh and try again.'},409);
    // A reset can itself be undone.
    await remember(current.ownerKey,current.version,current.data,'Reset demo data',user.actor);
  }
  return json({data:next,version:current.version+1,user:user.actor,accessMode:user.accessMode??'password',undo:await latestUndo(current.ownerKey),undone});
}
export async function GET(request:Request){
  try{
    const access=await workspaceAccess(request.headers);
    if(!access.identity)return json({error:'Please sign in to access your workspace.'},401);
    const user=access.identity,{data,version,ownerKey}=await read(user);
    return json({data,version,user:user.actor,accessMode:user.accessMode??'password',undo:await latestUndo(ownerKey),...(access.invite?{invite:{name:access.invite.name,role:access.invite.role}}:{})});
  }
  catch(e){console.error('Workspace read failed',e);return json({error:'Your workspace could not load. Please try again.'},503);}
}
export async function POST(request:Request){
  try{
    const access=await workspaceAccess(request.headers);
    if(!access.identity)return json({error:'Please sign in to save changes.'},401);
    const user=access.identity;
    const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return json({error:'Invalid request origin.'},403);
    if(!request.headers.get('content-type')?.includes('application/json'))return json({error:'JSON required.'},415);
    const raw=await request.text();if(raw.length>30000)return json({error:'This entry is too large.'},413);
    let body;try{body=JSON.parse(raw);}catch{return json({error:'Invalid request.'},400);}
    if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'A workspace action object is required.'},400);
    const control_=body.action&&typeof body.action==='object'?(body.action as {type?:unknown}).type:undefined;
    if(control_==='workspace.undo'||control_==='workspace.reset'){
      if(!Number.isInteger(body.version))return json({error:'Workspace version is required.'},400);
      if(control_==='workspace.reset'&&(body.action as {confirm?:unknown}).confirm!=='reset-demo-data')return json({error:'Confirm the reset first.'},400);
      return control(control_,user,body.version);
    }
    const parsed=actionSchema.safeParse(body.action);if(!parsed.success)return json({error:parsed.error.issues[0]?.message??'Invalid entry.'},400);
    if(!Number.isInteger(body.version))return json({error:'Workspace version is required.'},400);
    const current=await read(user);
    if(current.version!==body.version){
      // An accepted save may have lost its response. Re-run only the pure,
      // server-attributed reducer to recognize its actor-bound receipt. Never
      // commit a different result from a stale workspace version.
      if('requestId' in parsed.data){
        try{const replay=applyAction(current.data,parsed.data,user.actor);if(JSON.stringify(replay)===JSON.stringify(current.data))return json({data:current.data,version:current.version,user:user.actor,accessMode:user.accessMode??'password',undo:await latestUndo(current.ownerKey)});}
        catch(error){if(hasAcceptedRequest(current.data,parsed.data))return json({error:error instanceof Error?error.message:'Unable to restore the saved action.'},400);}
      }
      return json({error:'This workspace changed in another tab. Refresh and try again.'},409);
    }
    let data:Workspace;try{data=applyAction(current.data,parsed.data,user.actor);}catch(e){return json({error:e instanceof Error?e.message:'Unable to apply change.'},400);}
    const serialized=JSON.stringify(data);if(serialized.length>2_000_000)return json({error:'This evaluation workspace has reached its storage limit. Export your records before continuing.'},413);
    if(serialized===JSON.stringify(current.data))return json({data:current.data,version:current.version,user:user.actor,accessMode:user.accessMode??'password',undo:await latestUndo(current.ownerKey)});
    const result=await database().prepare('UPDATE workspaces SET data = ?, version = version + 1, updated_at = ? WHERE owner_id = ? AND version = ?').bind(serialized,new Date().toISOString(),current.ownerKey,current.version).run();
    if(result.meta.changes!==1)return json({error:'Another change was saved first. Refresh and try again.'},409);
    await remember(current.ownerKey,current.version,current.data,changeLabel(data),user.actor);
    return json({data,version:current.version+1,user:user.actor,accessMode:user.accessMode??'password',undo:await latestUndo(current.ownerKey)});
  }catch(e){console.error('Workspace save failed',e);return json({error:'Your change was not saved. Please try again.'},503);}
}
