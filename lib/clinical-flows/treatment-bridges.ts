import type {Note,TaskState,Workspace} from '../theranetrix';
import {retainTaskState} from '../record-history';
import {initialState,missingRequirements,validateState,type State,type TreatmentRecord} from './treatment-continuity';

type BridgeContext={actor:string;now:string};
type TaskProjection={fields:TaskState;intent:string};
const collections=['reconciliations','experiences','lifecycles','accessBarriers','transitions','multidisciplinary'] as const;
const collectionForKind:Record<TreatmentRecord['kind'],typeof collections[number]>={reconciliation:'reconciliations',experience:'experiences',lifecycle:'lifecycles',access:'accessBarriers',transition:'transitions',multidisciplinary:'multidisciplinary'};
const labels:Record<TreatmentRecord['kind'],string>={reconciliation:'Source reconciliation',experience:'Treatment experience',lifecycle:'Medication order progress',access:'Care access',transition:'Care transition',multidisciplinary:'Multidisciplinary care'};

/** Patient, record kind and full source ID are part of every bounded identity. */
export function treatmentBridgeId(kind:string,...parts:string[]){
  const input=JSON.stringify(parts);let first=2166136261,second=2246822507;
  for(let index=0;index<input.length;index++){first=Math.imul(first^input.charCodeAt(index),16777619);second=Math.imul(second^input.charCodeAt(index),3266489909);}
  return `wf-treatment-${kind}-${(first>>>0).toString(16).padStart(8,'0')}${(second>>>0).toString(16).padStart(8,'0')}`;
}
function identity(record:TreatmentRecord){return [record.patientId,record.kind,record.id];}
function noteId(record:TreatmentRecord){return treatmentBridgeId('note',...identity(record),String(record.version));}
function dateAfter(date:string,days:number){const parsed=new Date(date+'T00:00:00Z');parsed.setUTCDate(parsed.getUTCDate()+days);return parsed.toISOString().slice(0,10);}
function evidenceText(value:{source:string;author:string;collectedAt:string|null;receivedAt:string;reference:string}){return `${value.source}; author: ${value.author}; collected: ${value.collectedAt??'not recorded'}; received: ${value.receivedAt}; reference: ${value.reference}`;}
function refText(ref:{domain:string;id:string;version:number}){return `${ref.domain}/${ref.id}, version ${ref.version}`;}

function sourceText(record:TreatmentRecord):string{
  const lines=[`${labels[record.kind]} · ${record.currentStatus}`,`Responsible owner: ${record.owner||'Not assigned'}`,`Next review: ${record.dueDate||'Not recorded'}`];
  if(record.kind==='reconciliation'){
    lines.push(`Source: ${record.source} (${record.sourceDate})`,...record.conflicts.map(item=>`${item.field}: patient reports “${item.patientFact}”; outside record says “${item.externalFact}”; ${item.outcome}.`));
    if(record.provenance){const p=record.provenance;lines.push(`Patient source: ${evidenceText(p.patient)}`,`Outside source: ${evidenceText(p.external)}`,`Next action: ${p.nextAction}`);if(p.reviewedAt)lines.push(`Reviewed by ${p.reviewedBy} at ${p.reviewedAt}.`);}
    if(record.resolution)lines.push(`Resolution: ${record.resolution}`);
  }else if(record.kind==='experience'){
    lines.push(`${record.medicationName}: ${record.regimen}`,`Reported use: ${record.reportedUse}; trial: ${record.trialStatus}; actual start: ${record.regimenStartedAt||'not recorded'}; duration: ${record.regimenDurationDays===null?'unknown':record.regimenDurationDays+' days'}.`,`Benefit: ${record.reportedBenefit}; tolerability: ${record.tolerability}.`,`Functional goal: ${record.functionalGoal}`,`Patient concern: ${record.patientConcern||'Not recorded'}`,`Decision: ${record.reassessmentDecision}${record.alternativePlan?'; '+record.alternativePlan:''}`);
    if(record.responseReview){const r=record.responseReview;lines.push(`Regimen version ${r.regimenVersion}; response period: ${r.periodStart??'unknown'} to ${r.periodEnd??'unknown'}; reported ${r.reportedAt} via ${r.source}; patient agreement: ${r.patientAgreement}.`);}
    if(record.stopDate)lines.push(`Stopped ${record.stopDate}: ${record.stopReason}`);
  }else if(record.kind==='lifecycle'){
    lines.push(`${record.medicationName}; recorded stage: ${record.stage}.`,`Prescriber responsibility: ${record.prescriberResponsibility}`,`Service available: ${record.clinicalServiceAvailable?'yes':'no'}`,`Safety review: ${record.safetyPrerequisites.join('; ')||'not recorded'}`,`Other required review: ${record.reviewPrerequisites.join('; ')||'not recorded'}`);
    const o=record.orderEvidence;
    if(o){lines.push(`Order ${o.orderId}, regimen version ${o.regimenVersion}: ${o.regimen}`,`Prescriber: ${o.prescriber}; evidence mode: ${o.authority}.`,`Authorization: ${o.authorizationRef||'not recorded'}${o.authorizedAt?' at '+o.authorizedAt:''}`,`Pharmacy acknowledgement: ${o.pharmacyReceipt||'not recorded'}${o.pharmacyReceivedAt?' at '+o.pharmacyReceivedAt:''}`,`Dispensing: ${o.dispensingRef||'not recorded'}${o.dispensedAt?' at '+o.dispensedAt:''}`,`Actual use: ${o.actualUse}; source: ${o.useSource}; reported: ${o.useReportedAt}.`);if(o.startedAt)lines.push(`Actual start: ${o.startedAt}`);if(o.stoppedAt)lines.push(`Actual stop: ${o.stoppedAt}`);if(o.clarification)lines.push(`Pharmacy question: ${o.clarification}`);if(o.renewalId)lines.push(`Renewal request: ${o.renewalId}`);if(o.followUpDaysAfterStart)lines.push(`Agreed review: ${o.followUpDaysAfterStart} days after actual start.`);}
    for(const detail of [record.statusNote,record.failureReason,record.notStartedReason])if(detail)lines.push(detail);
  }else if(record.kind==='access'){
    lines.push(`Barrier: ${record.barrierType}; ${record.status}.`,`Patient choice: ${record.patientChoice}`,`Outreach: ${record.outreach}`);if(record.alternatives)lines.push(`Proposed alternative: ${record.alternatives}`);
    if(record.accessReview){const r=record.accessReview;lines.push(`Linked care: ${refText(r.careAction)}`,`Access: ${r.verification}; checked ${r.checkedAt} with ${r.source}: ${r.details}`,`Alternative review: ${r.alternativeDecision}${r.reviewer?' by '+r.reviewer:''}${r.reviewedAt?' at '+r.reviewedAt:''}; patient agreement: ${r.patientAgreement}.`,`Actual start: ${r.actualStart}${r.actualStartAt?' on '+r.actualStartAt:''}; source: ${r.actualStartSource}.`);if(r.followUpDaysAfterStart)lines.push(`Agreed review: ${r.followUpDaysAfterStart} days after actual start.`);}
    if(record.resolution)lines.push(`Access resolution: ${record.resolution}`);
  }else if(record.kind==='transition'){
    lines.push(`Incoming source: ${record.externalCareSource}`,`Prior instructions: ${record.previousInstructions}`,`Incoming instructions: ${record.newInstructions}`,`Discrepancies: ${record.discrepancies||'None recorded'}`,`Reconciled instructions: ${record.reconciledInstructions||'Not yet recorded'}`,`Receiving clinician: ${record.receivingClinician}; accepted responsibility: ${record.ownershipAccepted?'yes':'not yet'}.`,`Patient communication: ${record.patientCommunication||'Not yet recorded'}`,...record.pendingWork.map(title=>`Still pending: ${title}`),...record.resolvedPendingWork.map(title=>`Explicitly resolved: ${title}`));
    if(record.handoverEvidence){const h=record.handoverEvidence;lines.push(`Source evidence: ${evidenceText(h.source)}`,`Patient account: ${h.patientAccount}`,`Backup: ${h.backupOwner}; timezone: ${h.timezone}.`,`Acceptance: ${h.acceptance}${h.acceptedBy?' by '+h.acceptedBy:''}${h.acceptedAt?' at '+h.acceptedAt:''}${h.acceptanceEvidence?'; '+h.acceptanceEvidence:''}`);if(h.teachBack)lines.push(`Patient understanding: ${h.teachBack}`);if(h.clarificationOwner)lines.push(`Remaining clarification owner: ${h.clarificationOwner}`);for(const item of h.pendingTransfers)lines.push(`${item.disposition}: ${item.title}; ${refText(item.ref)}; owner: ${item.owner}; backup: ${item.backupOwner}; accepted ${item.acceptedAt}; evidence: ${item.evidenceRef}`);}
  }else{
    lines.push(`Shared functional goal: ${record.functionalGoal}`);
    for(const item of record.interventions){lines.push(`${item.title}: ${item.status}; professional: ${item.professional}; decision: ${item.decision}.`,`Patient experience: ${item.patientExperience||'Not recorded'}; observed outcome: ${item.observedOutcome||'Not recorded'}.`);if(item.accessBarrier)lines.push(`Access barrier: ${item.accessBarrier}`);const review=record.interventionReviews?.find(row=>row.interventionId===item.id);if(review){lines.push(`Rationale: ${review.rationale}; review criterion: ${review.reviewCriterion}.`,`Participation: ${review.participation}; actual start: ${review.startedAt||'not recorded'}; actual stop: ${review.stoppedAt||'not recorded'}; next review: ${review.reviewDate}; patient agreement: ${review.patientAgreement}.`);if(review.conflictingAdvice)lines.push(`Conflicting advice: ${review.conflictingAdvice}; reconciliation: ${review.reconciliation||'Pending'}`);}}
  }
  const event=record.history[0];
  lines.push(...missingRequirements(record).map(item=>'Still required: '+item),`Source version: ${record.version}; recorded by ${event.actor} at ${event.at}.`,`Record change: ${event.from} → ${event.to}. ${event.reason}`);
  if(event.evidenceRef)lines.push(`Evidence reference: ${event.evidenceRef}`);
  return lines.join('\n');
}

/** Recover only real prior snapshots; legacy events without snapshots stay in domain history. */
function sourceVersions(record:TreatmentRecord):TreatmentRecord[]{
  const versions:TreatmentRecord[]=[];
  record.history.forEach((event,index)=>{
    if(!event.previousSnapshot)return;
    const snapshot=JSON.parse(event.previousSnapshot) as TreatmentRecord;
    if(snapshot.id!==record.id||snapshot.patientId!==record.patientId||snapshot.kind!==record.kind||snapshot.version!==record.version-index-1)throw new Error('Treatment history snapshot does not match its source.');
    const state=initialState(),collection=collectionForKind[record.kind];
    (state[collection] as TreatmentRecord[]).push({...snapshot,history:record.history.slice(index+1)});
    versions.push((validateState(state)[collection] as TreatmentRecord[])[0]);
  });
  return [...versions,record].sort((a,b)=>a.version-b.version);
}
function taskProjections(record:TreatmentRecord):TaskProjection[]{
  const tasks:TaskProjection[]=[],complete=missingRequirements(record).length===0;
  const add=(key:string,title:string,done:boolean,options:{date?:string;owner?:string;timezone?:string;intent?:unknown}={})=>{
    const fields:TaskState={id:treatmentBridgeId('task',...identity(record),key),patientId:record.patientId,title,date:options.date??record.dueDate??'',time:'',type:'Care coordination',done,owner:options.owner??record.owner??'',encounterId:record.encounterId||undefined,workflowDomain:'treatment-continuity',workflowRecordId:record.id,workflowVersion:record.version,workflowDisposition:done?'done':'pending',...(options.timezone?{timezone:options.timezone}:{})};
    tasks.push({fields,intent:JSON.stringify([title,fields.date,fields.owner,fields.timezone,done,options.intent])});
  };
  if(record.kind==='reconciliation')add('review','Reconcile outside and patient reports',complete&&['resolved','confirmed-none','declined'].includes(record.status),{intent:[record.source,record.conflicts,record.provenance?.nextAction]});
  else if(record.kind==='experience')add('review',`Review response to ${record.medicationName}`,complete&&(record.trialStatus!=='active'||record.reassessmentDecision==='patient-declined'),{intent:[record.regimen,record.responseReview?.regimenVersion,record.responseReview?.periodStart,record.responseReview?.periodEnd,record.patientConcern,record.reassessmentDecision]});
  else if(record.kind==='lifecycle'){
    const o=record.orderEvidence,terminal=['continued','stopped','failed','not-started'].includes(record.stage);
    const title=record.stage==='clarification-needed'?`Resolve pharmacy question for ${record.medicationName}`:record.stage==='renewal-requested'?`Review renewal request for ${record.medicationName}`:`Confirm medication progress for ${record.medicationName}`;
    add('progress',title,complete&&terminal,{intent:[record.stage,o?.orderId,o?.regimenVersion,o?.clarification,o?.renewalId,record.failureReason,record.notStartedReason]});
    if(o?.startedAt&&o.followUpDaysAfterStart)add('response',`Review response after starting ${record.medicationName}`,['response-reviewed','continued','stopped'].includes(record.stage),{date:dateAfter(o.startedAt,o.followUpDaysAfterStart),intent:[o.orderId,o.regimenVersion,o.startedAt,o.followUpDaysAfterStart]});
  }else if(record.kind==='access'){
    const r=record.accessReview;
    add('access','Resolve the recorded care access barrier',complete&&record.status!=='unresolved',{intent:[record.barrierType,r?.careAction,r?.verification,r?.alternativeDecision]});
    const started=r?.actualStart==='started'&&!!r.actualStartAt,declined=record.status==='patient-declined'||r?.actualStart==='declined';
    add('start','Confirm whether agreed care has started',!!started||declined,{date:started?r.actualStartAt:record.dueDate, intent:[r?.careAction,r?.actualStart,r?.actualStartAt]});
    if(started&&r?.followUpDaysAfterStart)add('response','Review care after the actual start',false,{date:dateAfter(r.actualStartAt!,r.followUpDaysAfterStart),intent:[r.careAction,r.actualStartAt,r.followUpDaysAfterStart]});
  }else if(record.kind==='transition'){
    const evidence=record.handoverEvidence;
    add('handover','Complete care transition and patient instructions',complete&&record.handoverStatus==='completed',{owner:record.ownershipAccepted?record.receivingClinician:record.owner,timezone:evidence?.timezone,intent:[record.handoverStatus,record.reconciledInstructions,record.patientCommunication]});
    for(const title of [...new Set([...record.pendingWork,...record.resolvedPendingWork])]){
      const transfer=evidence?.pendingTransfers.find(item=>item.title===title),done=record.resolvedPendingWork.includes(title);
      add('pending:'+title,`Transition follow-up: ${title}`,done,{owner:transfer?.disposition==='accepted-transfer'?transfer.owner:record.owner,timezone:evidence?.timezone,intent:[transfer?.ref,transfer?.disposition,done]});
    }
    if(evidence?.clarificationOwner)add('clarification','Clarify the patient’s transition instructions',!!evidence.teachBack,{owner:evidence.clarificationOwner,timezone:evidence.timezone,intent:evidence.patientAccount});
  }else{
    for(const item of record.interventions){const review=record.interventionReviews?.find(row=>row.interventionId===item.id);add('intervention:'+item.id,`Review ${item.title}`,!!review&&['completed','closed'].includes(item.status),{owner:item.professional,date:review?.reviewDate??record.dueDate,intent:[item.status,item.decision,item.accessBarrier,review?.reviewCriterion,review?.conflictingAdvice,review?.reconciliation]});}
  }
  return tasks;
}
export function treatmentTaskIds(record:TreatmentRecord){return taskProjections(record).map(projection=>projection.fields.id);}
function syncTask(workspace:Workspace,record:TreatmentRecord,projection:TaskProjection,versions:TreatmentRecord[]){
  const fields=projection.fields,prior=workspace.tasks.find(item=>item.id===fields.id);
  if(!prior){workspace.tasks.push(fields);return;}
  if(prior.patientId!==record.patientId||prior.workflowRecordId!==record.id||prior.workflowDomain!=='treatment-continuity')throw new Error('Treatment task identity collision.');
  if(prior.workflowVersion===record.version)return;
  if((prior.workflowVersion??0)>record.version)throw new Error('Treatment task cannot move to an earlier source version.');
  const previous=versions.find(item=>item.version===prior.workflowVersion),previousProjection=previous&&taskProjections(previous).find(item=>item.fields.id===fields.id);
  const sameIntent=previousProjection?.intent===projection.intent,event=record.history[0];
  retainTaskState(prior,event.actor,event.at,'Treatment record updated: '+event.reason);
  if(sameIntent){prior.workflowVersion=record.version;prior.encounterId=fields.encounterId;}
  else Object.assign(prior,fields);
}

function retireMissingTasks(workspace:Workspace,record:TreatmentRecord,projections:TaskProjection[],versions:TreatmentRecord[]){
  const currentIds=new Set(projections.map(projection=>projection.fields.id));
  const historicalIds=new Set(versions.flatMap(version=>taskProjections(version).map(projection=>projection.fields.id)));
  for(const task of workspace.tasks){
    if(task.patientId!==record.patientId||task.workflowDomain!=='treatment-continuity'||task.workflowRecordId!==record.id||currentIds.has(task.id)||!historicalIds.has(task.id))continue;
    if((task.workflowVersion??0)>record.version)throw new Error('Treatment task cannot move to an earlier source version.');
    if(task.workflowVersion===record.version&&task.workflowDisposition==='deferred'&&task.done)continue;
    const event=record.history[0];
    retainTaskState(task,event.actor,event.at,'Treatment follow-up withdrawn: '+event.reason);
    task.done=true;task.workflowDisposition='deferred';task.workflowVersion=record.version;task.encounterId=record.encounterId||undefined;
  }
}

/** Source records create documentation and owned work, never signed plans or external actions. */
export function projectTreatmentWork(workspace:Workspace,context:BridgeContext):Workspace{
  void context; // Attribution comes from each saved source event, including backfilled versions.
  const slice=workspace.clinicalWorkflows?.slices['treatment-continuity'];if(!slice)return workspace;
  const state:State=validateState(slice.state),next=structuredClone(workspace);
  for(const collection of collections)for(const record of state[collection]){
    const patient=next.patients.find(item=>item.id===record.patientId);if(!patient)throw new Error('Treatment source patient not found.');
    const versions=sourceVersions(record);
    for(const version of versions){
      const id=noteId(version),type='Treatment continuity: '+version.kind,event=version.history[0],text=sourceText(version);
      const saved=patient.notes.find(item=>item.id===id);
      if(saved){if(saved.workflowRecordId!==version.id||saved.workflowVersion!==version.version||saved.type!==type||saved.text!==text||saved.author!==event.actor||saved.date!==event.at)throw new Error('Treatment source note conflicts with its immutable record.');continue;}
      const previous=patient.notes.filter(item=>item.workflowRecordId===version.id&&item.type===type&&(item.workflowVersion??0)<version.version).sort((a,b)=>(b.workflowVersion??0)-(a.workflowVersion??0))[0];
      const note:Note={id,type,date:event.at,author:event.actor,text,workflowRecordId:version.id,workflowVersion:version.version,encounterId:version.encounterId||undefined,...(previous?{supersedes:previous.id}:{})};patient.notes.unshift(note);
    }
    const projections=taskProjections(record);
    for(const projection of projections)syncTask(next,record,projection,versions);
    retireMissingTasks(next,record,projections,versions);
  }
  return next;
}
