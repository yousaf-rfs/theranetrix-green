import type {Review,TaskState,Workspace} from '../theranetrix';
import {retainTaskState} from '../record-history';
import {validateState as validateGovernance,type ProtocolAssignment,type ProtocolStep,type RecallRecord} from './program-governance';
import {validateState as validateCoordination,type PathwayRecord,type PathwayStage,type State as CoordinationState} from './patient-coordination';

type BridgeContext={actor:string;now:string};
type SourceEvent={actor:string;at:string;reason:string};
export function governanceProjectionId(kind:string,...parts:string[]){
  let first=2166136261,second=2246822507;
  for(const letter of JSON.stringify(parts)){first=Math.imul(first^letter.charCodeAt(0),16777619);second=Math.imul(second^letter.charCodeAt(0),3266489909);}
  return `wf-gov-${kind}-${(first>>>0).toString(16).padStart(8,'0')}${(second>>>0).toString(16).padStart(8,'0')}`;
}
function syncTask(workspace:Workspace,fields:TaskState,event:SourceEvent):boolean{
  const prior=workspace.tasks.find(task=>task.id===fields.id);
  if(prior&&(prior.patientId!==fields.patientId||prior.workflowRecordId!==fields.workflowRecordId||prior.workflowDomain!==fields.workflowDomain))throw new Error('Governance task projection identity collision.');
  if(prior&&Object.keys(fields).every(key=>prior[key as keyof TaskState]===fields[key as keyof TaskState]))return false;
  if(prior){retainTaskState(prior,event.actor,event.at,event.reason);Object.assign(prior,fields);}else workspace.tasks.push(fields);
  return true;
}
function recallEvent(recall:RecallRecord,context:BridgeContext):SourceEvent{
  const event=recall.history[0];return event?{actor:event.actor,at:event.at,reason:event.reason}:{actor:context.actor,at:context.now,reason:'Projected the existing recall record into patient review work.'};
}
function projectRecall(workspace:Workspace,recall:RecallRecord,context:BridgeContext):boolean{
  let changed=false;
  for(const patientId of new Set(recall.impacts.map(impact=>impact.patientId))){
    const patient=workspace.patients.find(item=>item.id===patientId);
    if(!patient)throw new Error('Recall impact references an unavailable patient.');
    const impacts=recall.impacts.filter(item=>item.patientId===patientId),done=impacts.every(impact=>impact.disposition!=='pending'),event=recallEvent(recall,context);
    const encounterIds=new Set(impacts.map(impact=>impact.encounterId)),encounterId=encounterIds.size===1?impacts[0].encounterId:undefined;
    const title=`Review ${recall.subject.kind} recall: ${recall.subject.id}`;
    changed=syncTask(workspace,{id:governanceProjectionId('recall-task',recall.id,patientId),patientId,encounterId,title,owner:recall.owner,date:'',time:'',type:'Care coordination',done,workflowDomain:'program-governance',workflowRecordId:recall.id,workflowVersion:recall.version,workflowDisposition:done?'done':'pending'},event)||changed;
    const id=governanceProjectionId('recall-review',recall.id,patientId),prior=workspace.reviews.find(item=>item.id===id);
    if(prior&&(prior.patientId!==patientId||prior.workflowRecordId!==recall.id))throw new Error('Governance review projection identity collision.');
    const status:Review['status']=done?'Resolved':prior?.status==='Acknowledged'?'Acknowledged':'Open';
    const resolution=done?impacts.map(impact=>`${impact.sourceId}: ${impact.disposition}. ${impact.evidenceRef}${impact.acceptedBy?` Accepted by ${impact.acceptedBy}.`:''}${impact.planRef?` Reviewed plan: ${impact.planRef}.`:''}`).join('\n'):'';
    const detail=[recall.reason,`Exact ${recall.subject.kind} version: ${recall.subject.kind==='release'?recall.subject.artifactVersion:recall.subject.version}.`,...impacts.map(impact=>`${impact.sourceId} v${impact.sourceVersion} · ${impact.encounterId} · ${impact.disposition}`),'Prior signed decisions and care plans are retained. New artifact use remains suspended.'].join('\n');
    if(!prior||prior.workflowVersion!==recall.version||prior.status!==status||prior.detail!==detail||prior.resolution!==resolution){
      const history=[...(prior?.history??[])];
      if(prior&&!history.length)history.push({status:prior.status,resolution:prior.resolution??'',actor:prior.updatedBy??'Earlier author not recorded',date:prior.updatedAt??prior.created});
      history.unshift({status,resolution,actor:event.actor,date:event.at});
      const next:Review={id,patientId,encounterId,title,detail,priority:'Routine',source:'Model and evidence recall',status,created:prior?.created??recall.createdAt,owner:recall.owner,resolution,updatedAt:event.at,updatedBy:event.actor,history,workflowRecordId:recall.id,workflowVersion:recall.version,workflowHistory:structuredClone(recall.history)};
      if(prior)Object.assign(prior,next);else workspace.reviews.unshift(next);
      changed=true;
    }
    if(!done){
      if(patient.status!=='Needs review'){patient.status='Needs review';changed=true;}
      if(!patient.recordReviewRequiredSince||Date.parse(patient.recordReviewRequiredSince)>Date.parse(recall.createdAt)){patient.recordReviewRequiredSince=recall.createdAt;changed=true;}
    }
  }
  return changed;
}
function graphMatches(pathway:PathwayRecord,assignment:ProtocolAssignment){
  const steps=assignment.protocolSnapshot?.steps;
  return !!steps&&pathway.pathwayKey===assignment.protocolId&&pathway.pathwayVersion===String(assignment.protocolVersion)&&steps.length===pathway.stages.length&&steps.every(step=>{const stage=pathway.stages.find(item=>item.id===step.id);return !!stage&&stage.title===step.title&&JSON.stringify([...stage.prerequisites].sort())===JSON.stringify([...step.prerequisites].sort());});
}
function newStage(step:ProtocolStep,at:string):PathwayStage{
  return {id:step.id,title:step.title,activity:step.sourceRef?`${step.title}. Source: ${step.sourceRef}`:step.title,prerequisites:[...step.prerequisites],status:'pending',owner:step.owner,dueDate:step.schedule?new Date(Date.parse(at)+step.schedule.dueAfterDays*86400000).toISOString().slice(0,10):''};
}
function stageTask(workspace:Workspace,pathway:PathwayRecord,stage:PathwayStage,event:SourceEvent){
  const done=stage.status==='completed'||stage.status==='declined';
  return syncTask(workspace,{id:governanceProjectionId('protocol-task',pathway.id,stage.id),patientId:pathway.patientId,encounterId:pathway.encounterId,title:stage.title,owner:stage.owner,date:stage.dueDate,time:'',type:'Care coordination',done,workflowDomain:'patient-coordination',workflowRecordId:pathway.id,workflowVersion:pathway.version,workflowDisposition:done?'done':stage.status==='deferred'?'deferred':'pending'},event);
}
function migratePathway(state:CoordinationState,prior:PathwayRecord,assignment:ProtocolAssignment,event:SourceEvent):PathwayStage[]{
  const migration=assignment.migration;
  if(!migration||migration.fromAssignmentVersion!==prior.protocolAssignmentVersion)throw new Error('Changing a materialized protocol requires the matching explicit migration record.');
  if(migration.sourceEpisodeVersion!==undefined&&migration.sourceEpisodeVersion!==prior.version)throw new Error('Episode work changed before its protocol migration could be materialized.');
  const oldAssignment=assignment.revisions.find(revision=>revision.version===migration.fromAssignmentVersion)?.record;
  if(!oldAssignment||!graphMatches(prior,oldAssignment as ProtocolAssignment))throw new Error('The source pathway does not match the pinned publication being migrated.');
  if(prior.stages.some(stage=>stage.status!=='completed'&&!migration.pendingWork.some(item=>item.oldStepId===stage.id)))throw new Error('Every open pathway step needs an explicit migration disposition.');
  for(const item of migration.pendingWork){if(item.disposition==='transfer'&&!item.acceptedBy)throw new Error('A protocol work transfer requires named acceptance.');if(item.disposition==='carry'&&!migration.stageMap.some(mapping=>mapping.oldStepId===item.oldStepId))throw new Error('Carried protocol work needs a target mapping.');}
  const stages=assignment.protocolSnapshot!.steps.map(step=>{
    const stage=newStage(step,assignment.updatedAt),mapping=migration.stageMap.find(item=>item.newStepId===step.id),old=mapping?prior.stages.find(item=>item.id===mapping.oldStepId):undefined;
    if(mapping?.carryStatus&&!old)throw new Error('The carried source stage is unavailable.');
    if(old&&mapping?.carryStatus){stage.status=old.status;stage.owner=old.owner;stage.dueDate=old.dueDate;if(old.reason)stage.reason=old.reason;}
    const disposition=mapping?migration.pendingWork.find(item=>item.oldStepId===mapping.oldStepId):undefined;
    if(disposition)stage.owner=disposition.disposition==='transfer'?disposition.acceptedBy!:disposition.owner;
    return stage;
  });
  if(stages.some(stage=>['active','completed'].includes(stage.status)&&stage.prerequisites.some(id=>stages.find(item=>item.id===id)?.status!=='completed')))throw new Error('Carried statuses do not meet the target protocol prerequisites. Record a different reviewed mapping.');
  const archived:PathwayRecord={...prior,currentVersion:false,version:prior.version+1,updatedAt:event.at,history:[{id:governanceProjectionId('archive',assignment.id,String(assignment.version)),actor:event.actor,at:event.at,from:prior.pathwayVersion,to:'archived',reason:`Explicit protocol migration retained this published episode. ${event.reason}`},...prior.history]};
  state.pathways[state.pathways.indexOf(prior)]=archived;
  return stages;
}
function materializeAssignment(state:CoordinationState,assignment:ProtocolAssignment,context:BridgeContext):{record?:PathwayRecord;previous?:PathwayRecord;changed:boolean;event:SourceEvent}{
  const sourceEvent=assignment.history[0],event={actor:sourceEvent?.actor??context.actor,at:sourceEvent?.at??context.now,reason:assignment.assignmentReason};
  // An old patient-only assignment cannot identify a clinical episode by itself.
  if(!assignment.encounterId||!assignment.protocolSnapshot)return {changed:false,event};
  const linked=state.pathways.filter(pathway=>pathway.protocolAssignmentId===assignment.id);
  const current=linked.find(pathway=>pathway.protocolAssignmentVersion===assignment.version);
  if(current){if(!graphMatches(current,assignment))throw new Error('Materialized pathway differs from its published graph; explicit migration is required.');return {record:current,changed:false,event};}
  if(linked.filter(pathway=>pathway.currentVersion).length>1)throw new Error('A protocol assignment cannot have multiple active pathway records.');
  const previous=linked.find(pathway=>pathway.currentVersion)??linked.sort((a,b)=>(b.protocolAssignmentVersion??0)-(a.protocolAssignmentVersion??0))[0];
  const stages=previous?migratePathway(state,previous,assignment,event):assignment.protocolSnapshot.steps.map(step=>newStage(step,assignment.updatedAt));
  const id=governanceProjectionId('protocol',assignment.id,String(assignment.version)),eventId=governanceProjectionId('assignment',assignment.id,String(assignment.version));
  if(state.pathways.some(record=>record.id===id))throw new Error('Protocol pathway projection identity collision.');
  const fingerprint=JSON.stringify({actor:event.actor,assignmentId:assignment.id,assignmentVersion:assignment.version,protocolId:assignment.protocolId,protocolVersion:assignment.protocolVersion});
  const record:PathwayRecord={id,type:'pathway',patientId:assignment.patientId,encounterId:assignment.encounterId,version:1,createdAt:event.at,updatedAt:event.at,history:[{id:eventId,actor:event.actor,at:event.at,from:previous?previous.pathwayVersion:'unassigned',to:String(assignment.protocolVersion),reason:event.reason}],protocolAssignmentId:assignment.id,protocolAssignmentVersion:assignment.version,pathwayKey:assignment.protocolId,pathwayVersion:String(assignment.protocolVersion),currentVersion:true,priorVersions:previous?[{version:previous.version,pathwayVersion:previous.pathwayVersion,updatedAt:previous.updatedAt},...previous.priorVersions]:[],stages,exceptions:[],processedEvents:[{eventId,fingerprint,at:event.at}]};
  state.pathways.unshift(record);
  state.receipts.unshift({requestId:eventId,fingerprint,recordType:'pathway',recordId:id,patientId:assignment.patientId,at:event.at});
  return {record,previous,changed:true,event};
}

/** Projects explicit governance records. No source run, signed decision, care plan, or medication is rewritten. */
export function projectGovernanceWork(workspace:Workspace,context:BridgeContext):Workspace{
  if(!context.actor.trim()||!Number.isFinite(Date.parse(context.now)))throw new Error('Governance projection requires a trusted actor and timestamp.');
  if(!workspace.clinicalWorkflows)return workspace;
  const governance=validateGovernance(workspace.clinicalWorkflows.slices['program-governance'].state),next=structuredClone(workspace);
  const slice=next.clinicalWorkflows!.slices['patient-coordination'],state=validateCoordination(slice.state);
  let changed=false,coordinationChanged=false;
  for(const recall of governance.recalls)changed=projectRecall(next,recall,context)||changed;
  for(const assignment of governance.protocolAssignments){
    if(!next.patients.some(patient=>patient.id===assignment.patientId))throw new Error('Protocol assignment references an unavailable patient.');
    const result=materializeAssignment(state,assignment,context);
    coordinationChanged=result.changed||coordinationChanged;
    if(result.previous&&result.record){
      const archived=state.pathways.find(pathway=>pathway.id===result.previous!.id)!;
      for(const stage of result.previous.stages){
        const disposition=assignment.migration!.pendingWork.find(item=>item.oldStepId===stage.id);
        const reason=disposition?`Protocol migration ${disposition.disposition}: ${disposition.evidenceRef}${disposition.acceptedBy?`; accepted by ${disposition.acceptedBy}`:''}. ${result.event.reason}`:`Completed source work retained during protocol migration. ${result.event.reason}`;
        changed=syncTask(next,{id:governanceProjectionId('protocol-task',archived.id,stage.id),patientId:archived.patientId,encounterId:archived.encounterId,title:stage.title,owner:stage.owner,date:stage.dueDate,time:'',type:'Care coordination',done:true,workflowDomain:'patient-coordination',workflowRecordId:archived.id,workflowVersion:archived.version,workflowDisposition:'done'},{...result.event,reason})||changed;
      }
    }
    if(result.record?.currentVersion){
      const event=result.changed?result.event:result.record.history[0]??{actor:context.actor,at:context.now,reason:'Projected current protocol activity.'};
      for(const stage of result.record.stages)changed=stageTask(next,result.record,stage,event)||changed;
    }
    if(result.changed){const auditId=governanceProjectionId('audit',assignment.id,String(assignment.version));if(!next.audit.some(item=>item.id===auditId))next.audit.unshift({id:auditId,date:result.event.at,actor:result.event.actor,patientId:assignment.patientId,action:`Materialized protocol ${assignment.protocolId} version ${assignment.protocolVersion} for episode ${assignment.encounterId}.`});}
  }
  if(coordinationChanged){slice.state=validateCoordination(state);slice.version+=1;slice.updatedAt=context.now;slice.updatedBy=context.actor;changed=true;}
  return changed?next:workspace;
}
