import type {Task,TaskState,Workspace} from '../theranetrix';
import {retainTaskState} from '../record-history';
import {validateState,type DecisionWork,type State} from './decisions';
import type {WorkflowBridgeContext} from './bridges';

type WorkKind='monitoring'|'clarification';
type SourceRecord=State['observedReviews'][number]|State['engineComparisons'][number];

// Capture records get new IDs on revision; the work item keeps its identity.
export function decisionWorkTaskId(kind:WorkKind,patientId:string,encounterId:string,workId:string):string{
  const input=JSON.stringify([patientId,encounterId,workId]);
  let first=2166136261,second=2246822507;
  for(let i=0;i<input.length;i++){
    first=Math.imul(first^input.charCodeAt(i),16777619);
    second=Math.imul(second^input.charCodeAt(i),3266489909);
  }
  return `wf-decision-${kind}-${(first>>>0).toString(16).padStart(8,'0')}${(second>>>0).toString(16).padStart(8,'0')}`;
}

function workItems(record:SourceRecord):DecisionWork[]{
  return 'metrics' in record?(record.monitoring?[record.monitoring]:[]):record.clarificationWork??[];
}

function sameIntent(before:DecisionWork,after:DecisionWork):boolean{
  return before.title===after.title&&before.owner===after.owner&&Date.parse(before.dueAt)===Date.parse(after.dueAt);
}

function taskFields(kind:WorkKind,record:SourceRecord,work:DecisionWork):TaskState{
  const instant=new Date(work.dueAt).toISOString();
  return {
    id:decisionWorkTaskId(kind,record.patientId,record.encounterId,work.id),
    patientId:record.patientId,encounterId:record.encounterId,
    workflowDomain:'decisions',workflowRecordId:record.id,workflowVersion:record.version,
    title:work.title,owner:work.owner,date:instant.slice(0,10),time:instant.slice(11,16),timezone:'UTC',
    type:'Care coordination',done:false,workflowDisposition:'pending',
  };
}

function retainSourceTransition(task:Task,record:SourceRecord,reason:string){
  const event=record.history[0];
  // A legacy source without attribution must not acquire the later caller's name.
  retainTaskState(task,event?.actor??'Source author not recorded',event?.at??record.updatedAt,
    `${reason}${event?` ${event.reason}`:''}`.slice(0,6000));
}

function projectScope(workspace:Workspace,kind:WorkKind,records:SourceRecord[]){
  const record=records.reduce((latest,row)=>row.version>latest.version?row:latest);
  if(!workspace.patients.some(patient=>patient.id===record.patientId))throw new Error('Decision work patient not found.');
  if(new Set(records.map(row=>row.version)).size!==records.length)throw new Error('Decision work source versions must be unambiguous within the patient encounter.');
  const knownWork=new Map<string,string>();
  for(const row of records){
    const items=workItems(row);
    if(new Set(items.map(work=>work.id)).size!==items.length)throw new Error('Decision work identifiers must be unique within a source.');
    for(const work of items){
      const id=decisionWorkTaskId(kind,row.patientId,row.encounterId,work.id);
      if(knownWork.has(id)&&knownWork.get(id)!==work.id)throw new Error('Decision task identifier collision.');
      knownWork.set(id,work.id);
    }
  }
  const desired=new Map(workItems(record).map(work=>[work.id,work]));
  for(const [id,workId] of knownWork){
    const matches=workspace.tasks.filter(task=>task.id===id);
    if(matches.length>1)throw new Error('Decision task identifiers must be unique.');
    const task=matches[0],work=desired.get(workId);
    const previous=task&&records.find(row=>row.id===task.workflowRecordId&&row.version===task.workflowVersion);
    if(task&&(task.patientId!==record.patientId||task.encounterId!==record.encounterId||task.workflowDomain!=='decisions'||!previous))throw new Error('Decision task source or patient scope does not match.');
    if(!task){
      if(work)workspace.tasks.push(taskFields(kind,record,work));
      continue;
    }
    const alreadyCurrent=task.workflowRecordId===record.id&&task.workflowVersion===record.version;
    if(!work){
      if(alreadyCurrent&&task.done&&task.workflowDisposition==='deferred')continue;
      retainSourceTransition(task,record,`Decision ${kind} work withdrawn by source v${record.version}: the latest review no longer includes this item.`);
      Object.assign(task,{workflowRecordId:record.id,workflowVersion:record.version,done:true,workflowDisposition:'deferred'});
      continue;
    }
    // Manual completion and accepted operational transfers survive a replay.
    if(alreadyCurrent)continue;
    const previousWork=workItems(previous!).find(item=>item.id===workId);
    const unchanged=!!previousWork&&sameIntent(previousWork,work);
    retainSourceTransition(task,record,unchanged
      ?`Decision ${kind} source advanced to v${record.version}; work intent and operational state retained.`
      :`Decision ${kind} work ${previousWork?'changed':'reinstated'} in source v${record.version}; follow-up reopened.`);
    if(unchanged){
      // Compare immutable source intent, not an owner/due date accepted later in
      // care operations. A source-only review must not undo that transfer.
      task.workflowRecordId=record.id;task.workflowVersion=record.version;
      task.workflowDisposition=task.done?'done':'pending';
    }else Object.assign(task,taskFields(kind,record,work));
  }
}

/** Project only operational work. Reviewed inputs and signed history stay exact. */
export function projectDecisionWork(workspace:Workspace,context:WorkflowBridgeContext):Workspace{
  if(!context.actor.trim()||!Number.isFinite(Date.parse(context.now)))throw new Error('Decision task projection requires the server actor and time.');
  if(!workspace.clinicalWorkflows)return workspace;
  const state=validateState(workspace.clinicalWorkflows.slices.decisions.state);
  const next=structuredClone(workspace);
  for(const [kind,rows] of [['monitoring',state.observedReviews],['clarification',state.engineComparisons]] as const){
    const scopes=new Map<string,SourceRecord[]>();
    for(const record of rows){
      const scope=JSON.stringify([record.patientId,record.encounterId]);
      const records=scopes.get(scope)??[];
      records.push(record);scopes.set(scope,records);
    }
    for(const records of scopes.values())projectScope(next,kind,records);
  }
  return next;
}
