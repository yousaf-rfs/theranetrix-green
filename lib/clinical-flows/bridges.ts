import type {Patient,Review,Task,TaskState,Workspace} from '../theranetrix';
import type {CarePlan} from '../medications';
import {retainTaskState} from '../record-history';
import {validateState,type ObservationRecord,type SignoffRecord} from './encounters';
import {validateState as validateCoordination,type HumanHandoffRecord,type SchedulingRecord,type State as CoordinationState} from './patient-coordination';
import {validateState as validateResults,resultWorkDeadline,type ResultRecord,type ReferralRecord} from './results-referrals';
import type {ClinicalWorkflowDomain} from './index';
import {projectDecisionWork} from './decision-bridges';
import {projectGovernanceWork} from './governance-bridges';
import {projectTreatmentWork} from './treatment-bridges';
import {projectAcceptedWorkAssignments} from './accepted-work-assignments';
import {workflowBridgeId} from './bridge-identity';
import {flagSymptomChange} from '../symptom-change-rule';
import {patientUpdatedCheckin} from '../patient-checkin-note';
export {workflowBridgeId} from './bridge-identity';

export type WorkflowBridgeContext={actor:string;now:string};

function signedEvent(record:SignoffRecord){const event=record.history.find(item=>item.to==='signed');if(!event||!record.signedSnapshot)throw new Error('A signed encounter requires its immutable signature and snapshot.');return event;}
function planId(record:SignoffRecord){return workflowBridgeId('plan',record.patientId,record.id,String(record.version));}
function noteId(record:SignoffRecord){return workflowBridgeId('note',record.patientId,record.id,String(record.version));}

function projectSignedRecord(patient:Patient,record:SignoffRecord,all:readonly SignoffRecord[]){
  const signature=signedEvent(record),snapshot=record.signedSnapshot!;
  const prior=record.amendedFromId?all.find(item=>item.id===record.amendedFromId&&item.status==='signed'):undefined;
  const instructions=snapshot.planKind==='interim'&&snapshot.patientFallback?`${snapshot.patientFacingPlan}\n\nIf contact fails: ${snapshot.patientFallback}`:snapshot.patientFacingPlan;
  const plan:CarePlan={id:planId(record),text:instructions,owner:snapshot.owner,followup:snapshot.followUp.date,time:snapshot.followUp.time,timezone:snapshot.followUp.timezone,appointmentBooked:false,date:signature.at,author:signature.actor,encounterId:record.encounterId,workflowRecordId:record.id,workflowVersion:record.version,...(prior?{supersedes:planId(prior)}:{})};
  const existing=patient.carePlans.find(item=>item.id===plan.id);
  if(existing){
    if(existing.workflowRecordId!==record.id||existing.workflowVersion!==record.version||(existing.text!==plan.text&&existing.text!==snapshot.patientFacingPlan))throw new Error('Saved care plan conflicts with its signed encounter snapshot.');
    // Repair the earlier projection that omitted already-signed fallback text.
    // The signed record and its original snapshot remain unchanged.
    if(existing.text!==plan.text)existing.text=plan.text;
  }
  else patient.carePlans.unshift(plan);
  const id=noteId(record),savedNote=patient.notes.find(item=>item.id===id);
  if(savedNote&&savedNote.workflowRecordId!==record.id)throw new Error('Signed encounter note identity collision.');
  const disposition=snapshot.disposition;
  const lines=[snapshot.patientFacingPlan,`Clinical rationale: ${snapshot.rationale}`,
      ...(disposition.selected.length?[`Selected: ${disposition.selected.join('; ')}`]:[]),...(disposition.rejected.length?[`Rejected: ${disposition.rejected.join('; ')}`]:[]),...(disposition.deferred.length?[`Deferred: ${disposition.deferred.join('; ')}`]:[]),...(disposition.noChange?['No change was explicitly documented.']:[]),
      `Responsible owner: ${snapshot.owner}`,`Follow-up due: ${snapshot.followUp.date} at ${snapshot.followUp.time} (${snapshot.followUp.timezone}). Appointment booking is not confirmed.`,
      ...snapshot.pendingWork.map(item=>`${item.disposition}: ${item.title} · Owner: ${item.owner||'Not assigned'}${item.dueDate?` · Due: ${item.dueDate}`:''}`),`Teach-back: ${snapshot.teachBack}`,...(record.amendmentReason?[`Amendment reason: ${record.amendmentReason}`]:[])];
  const text=[instructions,...lines.slice(1)].join('\n');
  if(savedNote){if(savedNote.text===lines.join('\n')&&savedNote.text!==text)savedNote.text=text;}
  else{
    patient.notes.unshift({id,date:signature.at,author:signature.actor,type:prior?'Signed encounter amendment':'Signed encounter plan',text,encounterId:record.encounterId,workflowRecordId:record.id,workflowVersion:record.version,...(prior?{supersedes:noteId(prior)}:{})});
  }
}

function syncTask(workspace:Workspace,fields:TaskState,record:SignoffRecord,reflectCompletion=false){
  const prior=workspace.tasks.find(task=>task.id===fields.id);
  if(!prior){workspace.tasks.push(fields);return;}
  if(prior.patientId!==record.patientId||prior.encounterId!==record.encounterId)throw new Error('Encounter task identity collision.');
  if(prior.workflowRecordId===record.id&&prior.workflowVersion===record.version)return;
  const signature=signedEvent(record);
  const sameIntent=['title','owner','date','time','timezone','workflowDisposition'].every(key=>prior[key as keyof Task]===fields[key as keyof TaskState]);
  retainTaskState(prior,signature.actor,signature.at,'Signed encounter amendment updated the care plan and follow-up.',prior.planId);
  Object.assign(prior,{...fields,done:reflectCompletion?fields.done:sameIntent?prior.done:fields.done});
}
function projectTasks(workspace:Workspace,record:SignoffRecord){
  const snapshot=record.signedSnapshot!;
  const common={patientId:record.patientId,encounterId:record.encounterId,planId:planId(record),workflowRecordId:record.id,workflowVersion:record.version,type:'Care coordination'};
  syncTask(workspace,{...common,id:workflowBridgeId('followup',record.patientId,record.encounterId),title:'Encounter follow-up due',date:snapshot.followUp.date,time:snapshot.followUp.time,timezone:snapshot.followUp.timezone,owner:snapshot.owner,done:false,workflowDisposition:'pending'},record);
  for(const item of snapshot.pendingWork)syncTask(workspace,{...common,id:workflowBridgeId('work',record.patientId,record.encounterId,item.title.trim().toLowerCase()),title:item.title,owner:item.owner,date:item.dueDate??'',time:'',done:item.disposition==='done',workflowDisposition:item.disposition},record);
  const clarificationId=workflowBridgeId('clarification',record.patientId,record.encounterId),previous=workspace.tasks.find(task=>task.id===clarificationId);
  if(snapshot.clarification||previous){
    const sourceDue=snapshot.clarification?.dueAt,due=sourceDue?new Date(sourceDue).toISOString():undefined;
    // Repair only the known older local-as-UTC projection for this signature.
    // Keep any subsequently accepted task owner and task history intact.
    if(previous?.workflowRecordId===record.id&&previous.workflowVersion===record.version&&sourceDue&&due&&previous.timezone==='UTC'&&previous.date===sourceDue.slice(0,10)&&previous.time===sourceDue.slice(11,16)){
      previous.date=due.slice(0,10);previous.time=due.slice(11,16);
    }
    const done=snapshot.teachBackOutcome==='understood';
    syncTask(workspace,{...common,id:clarificationId,title:snapshot.clarification?.question??previous?.title??'Clarify the patient care plan',owner:snapshot.clarification?.owner??previous?.owner??snapshot.owner,date:due?.slice(0,10)??previous?.date??'',time:due?.slice(11,16)??previous?.time??'',timezone:due?'UTC':previous?.timezone,done,workflowDisposition:done?'done':'pending'},record,true);
  }
  // Omitted old work stays open until explicitly completed. An amendment alone
  // never proves that a task was performed or an appointment booked.
}

function removeNumericProjection(patient:Patient,checkin:Patient['checkins'][number]){
  const index=checkin.trajectoryIndex;if(index===undefined)return;
  if(patient.dates[index]!==checkin.date.slice(0,10)||patient.pain[index]!==checkin.pain||patient.function[index]!==checkin.function||patient.sleep[index]!==checkin.sleep)throw new Error('Stored observation projection no longer matches its source record.');
  patient.dates.splice(index,1);patient.pain.splice(index,1);patient.function.splice(index,1);patient.sleep.splice(index,1);
  for(const item of patient.checkins){if(item.trajectoryIndex===index)delete item.trajectoryIndex;else if(item.trajectoryIndex!==undefined&&item.trajectoryIndex>index)item.trajectoryIndex--;}
}
/** Returns true only when this record version is projected for the first time. */
function projectObservation(patient:Patient,record:ObservationRecord){
  const event=[...record.history].reverse().find(item=>item.to==='confirmed');if(!event)throw new Error('Confirmed observations require a confirmation history entry.');
  const shared=patient.workflowObservations??=[];
  if(shared.some(item=>item.workflowRecordId===record.id&&item.workflowVersion===record.version))return false;
  for(const entry of record.currentEntries){
    const existing=shared.find(item=>item.id===entry.id);if(existing){if(existing.workflowRecordId!==record.id)throw new Error('Observation identity collision.');continue;}
    shared.push({...entry,workflowRecordId:record.id,workflowVersion:record.version,encounterId:record.encounterId,confirmedAt:event.at,confirmedBy:event.actor});
  }
  const previous=patient.checkins.filter(item=>item.workflowRecordId===record.id).sort((a,b)=>(b.workflowVersion??0)-(a.workflowVersion??0))[0];
  const baselineWasProjected=previous?.trajectoryIndex===0&&patient.baseline===previous.pain;
  if(previous)removeNumericProjection(patient,previous);
  const metrics=['pain','function','sleep'] as const;
  const entries=metrics.map(metric=>record.currentEntries.find(entry=>entry.metric===metric));
  const complete=entries.every(entry=>entry&&(entry.status==='answered'||entry.status==='zero')&&typeof entry.value==='number');
  const sameTime=complete&&new Set(entries.map(entry=>new Date(entry!.recordedAt).toISOString())).size===1;
  if(complete&&sameTime){
    const [pain,fn,sleep]=entries.map(entry=>entry!.value!);
    const date=entries[0]!.recordedAt,dateOnly=date.slice(0,10);
    let index=patient.dates.findIndex(item=>item>dateOnly);if(index<0)index=patient.dates.length;
    for(const item of patient.checkins)if(item.trajectoryIndex!==undefined&&item.trajectoryIndex>=index)item.trajectoryIndex++;
    const wasEmpty=patient.pain.length===0;
    patient.dates.splice(index,0,dateOnly);patient.pain.splice(index,0,pain);patient.function.splice(index,0,fn);patient.sleep.splice(index,0,sleep);
    patient.checkins.unshift({id:workflowBridgeId('checkin',patient.id,record.id,String(record.version)),date,pain,function:fn,sleep,note:record.patientNote??(record.submissionSource==='patient-self-report'?'Submitted by the patient. Individual answers are retained in observation history.':'Confirmed encounter report. Individual source statements are retained in observation history.'),source:record.submissionSource==='patient-self-report'?'Patient self-report':'Clinician-confirmed report',encounterId:record.encounterId,workflowRecordId:record.id,workflowVersion:record.version,workflowEntryIds:entries.map(entry=>entry!.id),trajectoryIndex:index,...(previous?{supersedes:previous.id}:{})});
    if(wasEmpty)patient.baseline=pain;
  }
  if(baselineWasProjected&&patient.pain.length)patient.baseline=patient.pain[0];
  const id=workflowBridgeId('observation-note',patient.id,record.id,String(record.version));
  const priorNote=patient.notes.find(item=>item.workflowRecordId===record.id);
  // A patient's own submission is not clinician-confirmed: label it as submitted by the patient, and a same-day
  // update from the companion as updated by the patient. Clinician corrections keep the actor who saved them;
  // a clinician review is a separate, attributed event.
  const corrected=record.currentEntries.some(entry=>entry.correctedFromEntryId),selfReport=record.submissionSource==='patient-self-report'&&!corrected,patientUpdate=corrected&&patientUpdatedCheckin(record);
  patient.notes.unshift({id,date:event.at,author:selfReport?'Submitted by patient':patientUpdate?'Updated by patient':event.actor,type:patientUpdate?'Patient-updated report':corrected?'Corrected observation report':selfReport?'Patient-submitted report':'Confirmed observation report',text:record.currentEntries.map(entry=>`${entry.metric}: ${entry.status==='answered'||entry.status==='zero'?`${entry.value}/10`:entry.status} · ${entry.source} · ${entry.recordedAt}`).join('\n')+(record.patientNote?'\nPatient note: '+record.patientNote:''),encounterId:record.encounterId,workflowRecordId:record.id,workflowVersion:record.version,...(priorNote?{supersedes:priorNote.id}:{})});
  patient.recordReviewRequiredSince=record.updatedAt;patient.status='Needs review';
  return true;
}

// A patient's same-day update projected before those updates were labelled was filed as the saving account's correction.
// Relabel each such note from its own version's confirmation event, so the notes and observation history agree. Idempotent.
function relabelPatientUpdateNotes(patient:Patient,record:ObservationRecord){
  if(record.submissionSource!=='patient-self-report')return;
  for(const note of patient.notes)if(note.workflowRecordId===record.id&&note.type==='Corrected observation report'&&note.id===workflowBridgeId('observation-note',patient.id,record.id,String(note.workflowVersion))&&patientUpdatedCheckin(record,note.date)){note.type='Patient-updated report';note.author='Updated by patient';}
}

function projectWithdrawnObservation(workspace:Workspace,patient:Patient,record:ObservationRecord){
  if(!record.withdrawal)throw new Error('Withdrawal requires its source, recorder and reason.');
  // The attributed source note is the durable receipt for this projection.
  // Replaying old withdrawals must not invalidate a later completed review.
  const projectionId=workflowBridgeId('observation-withdrawal-note',patient.id,record.id,String(record.version));
  const projected=patient.notes.find(note=>note.id===projectionId);
  if(projected){if(projected.workflowRecordId!==record.id||projected.workflowVersion!==record.version)throw new Error('Observation withdrawal note identity collision.');return;}
  const {at,actor,reason}=record.withdrawal;
  for(const checkin of patient.checkins.filter(item=>item.workflowRecordId===record.id)){
    if(checkin.trajectoryIndex!==undefined)removeNumericProjection(patient,checkin);
    checkin.withdrawnAt=at;checkin.withdrawalReason=reason;
  }
  for(const entry of patient.workflowObservations??[])if(entry.workflowRecordId===record.id){entry.withdrawnAt=at;entry.withdrawalReason=reason;}
  const id=workflowBridgeId('withdrawal-review',patient.id,record.id);
  if(!workspace.reviews.some(review=>review.id===id))workspace.reviews.unshift({id,patientId:patient.id,encounterId:record.encounterId,workflowRecordId:record.id,workflowVersion:record.version,title:'Review outputs affected by a chart correction',detail:reason,priority:'High',source:'Observation correction',status:'Open',created:at,owner:patient.clinician});
  sourceNote(patient,record,'observation-withdrawal',`Observation withdrawn from current use. ${reason}\nOriginal entries remain in the encounter history.`,{actor,at,reason});
  patient.recordReviewRequiredSince=at;patient.status='Needs review';
  if(patient.pain.length)patient.baseline=patient.pain[0];
}

type VersionedSource={id:string;patientId:string;encounterId:string;version:number;createdAt:string;updatedAt:string};
type SourceEvent={actor:string;at:string;reason:string};
function coordinationEvent(record:HumanHandoffRecord|SchedulingRecord,state:CoordinationState):SourceEvent{
  if(record.history[0])return record.history[0];
  // Initial coordination records have no history entry. The accepted receipt
  // contains the server-attributed actor; never substitute a later caller.
  const receipt=state.receipts.find(item=>item.recordId===record.id);
  let actor='Earlier author not recorded';
  if(receipt){try{const stored=JSON.parse(receipt.fingerprint);if(typeof stored.actor==='string'&&stored.actor.trim())actor=stored.actor;}catch{/* Legacy receipt cannot establish an author. */}}
  return {actor,at:record.createdAt,reason:record.type==='handoff'?'Human handoff recorded locally.':'Follow-up coordination recorded locally.'};
}
function syncVersionedTask(workspace:Workspace,record:VersionedSource,fields:Pick<TaskState,'id'|'title'|'date'|'time'|'done'|'owner'>,event:SourceEvent,timezone?:string){
  const previous=workspace.tasks.find(item=>item.id===fields.id);
  if(previous&&(previous.patientId!==record.patientId||previous.workflowRecordId!==record.id))throw new Error('Workflow task identity collision.');
  if(previous?.workflowVersion===record.version)return;
  const next:TaskState={...fields,patientId:record.patientId,encounterId:record.encounterId,workflowRecordId:record.id,workflowVersion:record.version,type:'Care coordination',workflowDisposition:fields.done?'done':'pending',...(timezone?{timezone}:{})};
  if(previous){retainTaskState(previous,event.actor,event.at,event.reason);Object.assign(previous,next);if(!timezone)delete previous.timezone;}
  else workspace.tasks.push(next);
}
function sourceNote(patient:Patient,record:VersionedSource,kind:string,text:string,event:SourceEvent){
  const id=workflowBridgeId(kind+'-note',record.patientId,record.id,String(record.version));
  const existing=patient.notes.find(item=>item.id===id);
  if(existing){if(existing.workflowRecordId!==record.id)throw new Error('Workflow note identity collision.');return;}
  const prior=patient.notes.find(item=>item.workflowRecordId===record.id);
  patient.notes.unshift({id,date:event.at,author:event.actor,type:kind==='handoff'?'Human handoff':kind==='result'?'Test result workflow':kind==='observation-withdrawal'?'Observation withdrawal':'Referral workflow',text,encounterId:record.encounterId,workflowRecordId:record.id,workflowVersion:record.version,...(prior?{supersedes:prior.id}:{})});
}
function projectHandoff(workspace:Workspace,patient:Patient,record:HumanHandoffRecord,state:CoordinationState){
  const event=coordinationEvent(record,state),id=workflowBridgeId('handoff-review',record.patientId,record.id);
  const existing=workspace.reviews.find(item=>item.id===id);
  if(existing&&(existing.patientId!==record.patientId||existing.workflowRecordId!==record.id))throw new Error('Handoff review identity collision.');
  const accepted=['ownership-accepted','reviewed','action-documented','response-recorded','closed'].includes(record.phase);
  const status:Review['status']=record.phase==='closed'?'Resolved':accepted?'Acknowledged':'Open';
  const dueLabel=record.dueAt?new Date(record.dueAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';
  const contactLabel={attempted:'Patient contact attempted','not-attempted':'Patient not contacted yet',completed:'Patient contacted',failed:'Patient contact failed',successful:'Patient contacted'}[record.patientContact.status]??record.patientContact.status;
  const detail=[record.concern,record.responsiblePerson?`Owner: ${record.responsiblePerson}`:'',...(dueLabel?[`Due ${dueLabel}`]:[]),contactLabel,...(record.actionSummary?[record.actionSummary]:[]),...(record.responseSummary?[record.responseSummary]:[])].filter(Boolean).join('\n');
  if(existing?.workflowVersion!==record.version||existing.status==='Resolved'&&record.phase!=='closed'){
    const resolution=record.phase==='closed'?record.responseSummary??event.reason:accepted?record.actionSummary??`Ownership explicitly accepted by ${record.responsiblePerson}.`:'';
    const history=[...(existing?.history??[])];
    if(existing){
      const prior={status:existing.status,resolution:existing.resolution??'',actor:existing.updatedBy??'Earlier author not recorded',date:existing.updatedAt??existing.created};
      if(JSON.stringify(history[0])!==JSON.stringify(prior))history.unshift(prior);
    }
    history.unshift({status,resolution,actor:event.actor,date:event.at});
    const next:Review={id,patientId:record.patientId,title:record.concern.slice(0,120),detail,priority:record.priority==='high'?'High':'Routine',source:'Patient concern',status,created:record.createdAt,resolution,updatedAt:event.at,updatedBy:event.actor,history,encounterId:record.encounterId,workflowRecordId:record.id,workflowVersion:record.version,owner:record.responsiblePerson,dueAt:record.dueAt,workflowHistory:structuredClone(record.history)};
    if(existing)Object.assign(existing,next);else workspace.reviews.unshift(next);
  }
  sourceNote(patient,record,'handoff',detail,event);
  const due=record.patientContact.nextAttemptAt??record.dueAt,taskId=workflowBridgeId('handoff-work',record.patientId,record.id);
  if(due||workspace.tasks.some(item=>item.id===taskId)){
    const instant=due?new Date(due).toISOString():undefined;
    syncVersionedTask(workspace,record,{id:taskId,title:record.patientContact.nextAttemptAt?'Patient contact for human handoff':'Human handoff follow-up',owner:record.responsiblePerson,date:instant?.slice(0,10)??'',time:instant?.slice(11,16)??'',done:record.phase==='closed'},event,instant?'UTC':undefined);
  }
}
function projectScheduling(workspace:Workspace,record:SchedulingRecord,state:CoordinationState){
  const instant=record.outreach.nextAttemptAt?new Date(record.outreach.nextAttemptAt).toISOString():undefined;
  syncVersionedTask(workspace,record,{id:workflowBridgeId('schedule-work',record.patientId,record.id),title:record.phase==='no-show'?'Arrange follow-up after missed appointment':record.phase==='reschedule-outreach'?'Arrange a new appointment':record.optedOut?'Review follow-up preferences':'Coordinate follow-up',owner:record.owner,date:instant?.slice(0,10)??record.dueWindow.end,time:instant?.slice(11,16)??'',done:record.outreach.status==='completed'&&!['no-show','reschedule-outreach'].includes(record.phase)},coordinationEvent(record,state),instant?'UTC':record.dueWindow.timezone);
}
function projectResultWork(workspace:Workspace,patient:Patient,record:ResultRecord|ReferralRecord){
  const isResult='requestLabel' in record,kind=isResult?'result':'referral',event=record.history[0];
  const title=isResult?`Test follow-up: ${record.requestLabel}`:`Referral follow-up: ${record.receivingService}`;
  const text=isResult?[title,`Status: ${record.status}. Owner: ${record.owner}. Due: ${record.dueAt}.`,record.requestReason,
    ...record.revisions.slice(0,1).map(item=>`Recorded result (${item.source}): ${item.summary}\nEvidence: ${item.evidenceRef}`),
    ...(record.interpretation?[`Clinician interpretation: ${record.interpretation}`]:[]),...(record.clinicalDisposition?[`Documented action: ${record.clinicalDisposition}`]:[]),...(record.communicationEvidence?[`Documented communication evidence: ${record.communicationEvidence}`]:[])].join('\n')
    :[title,`Status: ${record.status}. Owner: ${record.owner}. Due: ${record.dueAt}.`,record.clinicalQuestion,`Supporting evidence: ${record.supportingEvidence}`,
    ...(record.sentEvidence?[`Manual external-send evidence: ${record.sentEvidence}`]:[]),...(record.specialistAdvice?[`Original specialist advice: ${record.specialistAdvice.originalAdvice}`]:[]),...(record.reviewSummary?[`Clinician review: ${record.reviewSummary}`]:[]),...(record.reconciliationPlan?[`Reconciled plan: ${record.reconciliationPlan}`]:[])].join('\n');
  sourceNote(patient,record,kind,text,event);
  const cover=isResult&&record.tracking?.coverage?.status==='accepted'?record.tracking.coverage.acceptedBy:undefined,deadline=resultWorkDeadline(record);
  syncVersionedTask(workspace,record,{id:workflowBridgeId(kind+'-work',record.patientId,record.id),title,owner:cover||record.owner,date:deadline.date,time:deadline.time,done:record.status==='closed'||isResult&&record.status==='cancelled'},event,deadline.timezone);
}

/** Projects confirmed sources only. Booking, delivery and external transmission are separate actions. */
export function applyWorkflowBridges(workspace:Workspace,domain:ClinicalWorkflowDomain,context:WorkflowBridgeContext):Workspace{
  return projectAcceptedWorkAssignments(applyDomainWorkflowBridges(workspace,domain,context),context);
}
function applyDomainWorkflowBridges(workspace:Workspace,domain:ClinicalWorkflowDomain,context:WorkflowBridgeContext):Workspace{
  if(!context.actor.trim()||!Number.isFinite(Date.parse(context.now)))throw new Error('Workflow bridges require a trusted actor and timestamp.');
  if(!workspace.clinicalWorkflows)return workspace;
  if(domain==='decisions')return projectDecisionWork(workspace,context);
  if(domain==='program-governance')return projectGovernanceWork(workspace,context);
  if(domain==='treatment-continuity')return projectTreatmentWork(workspace,context);
  if(domain==='patient-coordination'){
    const state=validateCoordination(workspace.clinicalWorkflows.slices[domain].state),next=structuredClone(workspace),affected=new Set<string>();
    for(const record of state.handoffs){const patient=next.patients.find(item=>item.id===record.patientId);if(!patient)throw new Error('Handoff patient not found.');projectHandoff(next,patient,record,state);affected.add(patient.id);}
    for(const record of state.scheduling){if(!next.patients.some(item=>item.id===record.patientId))throw new Error('Scheduling patient not found.');projectScheduling(next,record,state);}
    for(const record of state.language){const patient=next.patients.find(p=>p.id===record.patientId);const latest=state.language.filter(r=>r.patientId===record.patientId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];if(patient&&record.id===latest?.id)patient.preferredLanguage=record.preferredLanguage;}
    for(const record of state.pathways.filter(row=>!row.protocolAssignmentId))for(const stage of record.stages){
      const event=record.history[0]??{actor:context.actor,at:record.updatedAt,reason:'Pathway activity recorded'};
      syncVersionedTask(next,record,{id:workflowBridgeId('pathway-stage',record.patientId,record.id,stage.id),title:stage.title,owner:stage.owner,date:stage.dueDate,time:'',done:stage.status==='completed'||stage.status==='declined'},event);
    }
    for(const patient of next.patients.filter(item=>affected.has(item.id))){if(next.reviews.some(item=>item.patientId===patient.id&&item.status!=='Resolved')||patient.recordReviewRequiredSince)patient.status='Needs review';else if(patient.status==='Needs review')patient.status='Monitoring';}
    return projectGovernanceWork(next,context);
  }
  if(domain==='results-referrals'){
    const state=validateResults(workspace.clinicalWorkflows.slices[domain].state),next=structuredClone(workspace);
    for(const record of [...state.results,...state.referrals]){const patient=next.patients.find(item=>item.id===record.patientId);if(!patient)throw new Error('Result or referral patient not found.');projectResultWork(next,patient,record);}
    return next;
  }
  if(domain!=='encounters')return workspace;
  const state=validateState(workspace.clinicalWorkflows.slices.encounters.state),next=structuredClone(workspace);
  const signed=state.signoffs.filter(record=>record.status==='signed');
  // Original records precede their amendments even when server timestamps match.
  function depth(record:SignoffRecord):number{return record.amendedFromId?1+depth(state.signoffs.find(item=>item.id===record.amendedFromId)!):0;}
  signed.sort((a,b)=>Date.parse(a.updatedAt)-Date.parse(b.updatedAt)||depth(a)-depth(b));
  for(const record of signed){const patient=next.patients.find(item=>item.id===record.patientId);if(!patient)throw new Error('Signed encounter patient not found.');projectSignedRecord(patient,record,signed);}
  const superseded=new Set(signed.map(record=>record.amendedFromId).filter(Boolean));
  for(const record of signed.filter(item=>!superseded.has(item.id)))projectTasks(next,record);
  for(const record of state.observations.filter(item=>item.status==='confirmed')){const patient=next.patients.find(item=>item.id===record.patientId);if(!patient)throw new Error('Observation patient not found.');
    // A new or corrected patient check-in is checked once against the clinician-set symptom-change rule; replays are not re-checked.
    if(projectObservation(patient,record))flagSymptomChange(next,patient,record,state.observations);}
  for(const record of state.observations.filter(item=>item.status==='withdrawn')){const patient=next.patients.find(item=>item.id===record.patientId);if(!patient)throw new Error('Observation patient not found.');projectWithdrawnObservation(next,patient,record);}
  for(const record of state.observations){const patient=next.patients.find(item=>item.id===record.patientId);if(patient)relabelPatientUpdateNotes(patient,record);}
  for(const patient of next.patients){patient.carePlans.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));patient.notes.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));patient.checkins.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));}
  return next;
}
