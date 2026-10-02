import type {Action} from './actions';
import type {Workspace} from './theranetrix';

/** The most recent change that Undo would reverse, if any. */
export type UndoInfo={label:string;actor:string;savedAt:string}|null;
export type WorkspaceSaveResult =
  | {saved:true;data:Workspace;version:number;undo:UndoInfo;undone?:string}
  | {saved:false;conflict:boolean;message:string};

async function post(version:number,action:unknown,request:typeof fetch):Promise<WorkspaceSaveResult>{
  const response=await request('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version,action})});
  const result=await response.json() as {data:Workspace;version:number;error?:string;undo?:UndoInfo;undone?:string};
  if(!response.ok)return {saved:false,conflict:response.status===409,message:result.error||'Unable to save. Your entries are still on this page.'};
  return {saved:true,data:result.data,version:result.version,undo:result.undo??null,...(result.undone?{undone:result.undone}:{})};
}

/** A rejected save must never replace the workspace underneath unfinished forms. */
export function saveWorkspaceAction(version:number,action:Action,request:typeof fetch=fetch):Promise<WorkspaceSaveResult>{return post(version,action,request);}

/** Step back one saved change, or restore the original demonstration records. */
export function controlWorkspace(version:number,kind:'undo'|'reset',request:typeof fetch=fetch):Promise<WorkspaceSaveResult>{
  return post(version,kind==='undo'?{type:'workspace.undo'}:{type:'workspace.reset',confirm:'reset-demo-data'},request);
}
