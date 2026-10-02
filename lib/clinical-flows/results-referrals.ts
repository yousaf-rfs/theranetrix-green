import {z} from 'zod';

const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'Use YYYY-MM-DD dates').refine(value=>!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'Use a valid calendar date');
const isoDateTimeSchema=z.string().datetime({offset:true});
const nonEmpty=(label:string,max:number)=>z.string().trim().min(1,`${label} is required`).max(max,`${label} must be ${max} characters or fewer`);
const evidenceRefSchema=nonEmpty('Evidence',200);
const reasonSchema=nonEmpty('Rationale',1000);
const patientIdSchema=nonEmpty('Patient ID',80);
const encounterIdSchema=nonEmpty('Encounter ID',80);
const recordIdSchema=nonEmpty('Record ID',120);
const actionIdSchema=nonEmpty('Action ID',120);
const expectedVersionSchema=z.number().int().min(0);
const dueWindowSchema=z.object({start:isoDateTimeSchema.optional(),end:isoDateTimeSchema,timezone:nonEmpty('Timezone',100)}).strict();
const coverageSchema=z.object({requestedOwner:nonEmpty('Receiving owner',120),status:z.enum(['requested','accepted','rejected']),acceptedBy:nonEmpty('Accepting clinician',120).optional(),acceptedAt:isoDateTimeSchema.optional(),evidenceRef:evidenceRefSchema.optional()}).strict();
export const resultTrackingSchema=z.object({requestStage:z.enum(['draft','authorized','submitted','accepted','completed','cancelled']),backupOwner:nonEmpty('Backup owner',120),reviewerAvailability:z.enum(['available','absent']).optional(),dueWindow:dueWindowSchema,priority:z.enum(['routine','urgent']),policyRef:nonEmpty('Escalation policy',200).optional(),coverage:coverageSchema.optional(),nextAction:reasonSchema,requestEvidence:evidenceRefSchema.optional(),requestRecordedBy:nonEmpty('Request reviewer',120).optional(),requestRecordedAt:isoDateTimeSchema.optional(),missingResultReason:reasonSchema.optional(),nextAttemptAt:isoDateTimeSchema.optional()}).strict();
const findingSchema=z.object({label:nonEmpty('Finding',120),value:nonEmpty('Recorded value',200),unit:z.string().max(80)}).strict();
const referralCoordinationSchema=z.object({referringClinician:nonEmpty('Referring clinician',120),urgency:z.enum(['routine','urgent']),policyRef:nonEmpty('Urgency policy',200).optional(),authorizedPacket:evidenceRefSchema,backupOwner:nonEmpty('Backup owner',120),dueWindow:dueWindowSchema}).strict();
const alternativeSchema=z.object({decision:reasonSchema,reviewedBy:nonEmpty('Reviewing clinician',120),reviewedAt:isoDateTimeSchema,patientAgreement:z.enum(['agreed','declined']),nextAction:reasonSchema}).strict();

export type HistoryEntry={id:string;at:string;actor:string;from:string;to:string;reason:string;evidenceRef?:string;fingerprint?:string;previousSnapshot?:string};
export type ResultRevision=z.infer<typeof resultRevisionSchema>;
export type ResultRecord={
  id:string;patientId:string;encounterId:string;version:number;createdAt:string;updatedAt:string;history:HistoryEntry[];
  status:ResultStatus;requestLabel:string;owner:string;dueAt:string;requestedAt:string;requestReason:string;
  revisions:ResultRevision[];interpretation:string;clinicalDisposition:string;communicationEvidence:string;closedAt?:string;cancelledAt?:string;
  tracking?:z.infer<typeof resultTrackingSchema>;
};
export const resultStatuses=['requested','awaiting-result','received','reviewed','acted-on','communicated','closed','cancelled'] as const;
export type ResultStatus=typeof resultStatuses[number];

export const referralStatuses=['requested','sent','accepted','scheduled','consultation-complete','advice-received','reviewed','plan-reconciled','closed','rejected','unreachable-patient','no-show','clarification-needed','patient-declined','alternative-disposition','communicated','transfer-pending','transferred'] as const;
export type ReferralStatus=typeof referralStatuses[number];
export type ReferralAdvice={receivedAt:string;summary:string;originalAdvice:string;evidenceRef:string};
export type ReferralRecord={
  id:string;patientId:string;encounterId:string;version:number;createdAt:string;updatedAt:string;history:HistoryEntry[];
  status:ReferralStatus;clinicalQuestion:string;receivingService:string;owner:string;dueAt:string;supportingEvidence:string;
  sentEvidence:string;scheduledFor:string;consultationCompletedAt:string;specialistAdvice?:ReferralAdvice;reviewSummary:string;reconciliationPlan:string;closedAt?:string;
  mode?:'appointment'|'electronic-consultation';coordination?:z.infer<typeof referralCoordinationSchema>;clarification?:string;alternativeDisposition?:z.infer<typeof alternativeSchema>;communicationEvidence?:string;communicationAt?:string;transfer?:z.infer<typeof coverageSchema>;duplicateOfId?:string;
};

export const createResultActionSchema=z.object({
  type:z.literal('result.create'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,encounterId:encounterIdSchema,expectedVersion:z.literal(0),
  requestLabel:nonEmpty('Requested test',160),owner:nonEmpty('Responsible owner',120),dueAt:dateSchema,requestedAt:dateSchema,reason:reasonSchema,
  tracking:resultTrackingSchema.optional(),
}).strict();
export const markResultAwaitingActionSchema=z.object({type:z.literal('result.mark-awaiting'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,reason:reasonSchema}).strict();
const receiveFields={
  actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,revisionId:recordIdSchema,
  source:z.enum(['manual','external']),summary:nonEmpty('Result summary',1000),collectedAt:isoDateTimeSchema,receivedAt:isoDateTimeSchema,evidenceRef:evidenceRefSchema,reason:reasonSchema,
  reportStatus:z.enum(['preliminary','final','corrected']).optional(),findings:z.array(findingSchema).optional(),
};
export const receiveResultActionSchema=z.object({type:z.literal('result.receive'),...receiveFields}).strict();
export const correctResultActionSchema=z.object({type:z.literal('result.correct'),correctedFromId:recordIdSchema,...receiveFields}).strict();
export const finalizeResultActionSchema=z.object({type:z.literal('result.finalize'),finalizedFromId:recordIdSchema,...receiveFields,reportStatus:z.literal('final')}).strict();
export const trackResultActionSchema=z.object({type:z.literal('result.track'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,tracking:resultTrackingSchema,reason:reasonSchema}).strict();
export const reviewResultActionSchema=z.object({type:z.literal('result.review'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,interpretation:nonEmpty('Interpretation',2000),reason:reasonSchema,evidenceRef:evidenceRefSchema}).strict();
export const actOnResultActionSchema=z.object({type:z.literal('result.act'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,clinicalDisposition:nonEmpty('Clinical disposition',2000),reason:reasonSchema,evidenceRef:evidenceRefSchema}).strict();
export const communicateResultActionSchema=z.object({type:z.literal('result.communicate'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,contactEvidence:evidenceRefSchema,reason:reasonSchema}).strict();
export const closeResultActionSchema=z.object({type:z.literal('result.close'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,reason:reasonSchema}).strict();
export const cancelResultActionSchema=z.object({type:z.literal('result.cancel'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,reason:reasonSchema}).strict();
export const reopenResultActionSchema=z.object({type:z.literal('result.reopen'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,reason:reasonSchema}).strict();
export const resultActionSchema=z.discriminatedUnion('type',[
  createResultActionSchema,markResultAwaitingActionSchema,receiveResultActionSchema,correctResultActionSchema,reviewResultActionSchema,
  actOnResultActionSchema,communicateResultActionSchema,closeResultActionSchema,cancelResultActionSchema,reopenResultActionSchema,
  finalizeResultActionSchema,trackResultActionSchema,
]);
export type ResultAction=z.infer<typeof resultActionSchema>;

export const createReferralActionSchema=z.object({
  type:z.literal('referral.create'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,encounterId:encounterIdSchema,expectedVersion:z.literal(0),
  clinicalQuestion:nonEmpty('Clinical question',2000),receivingService:nonEmpty('Receiving service',160),owner:nonEmpty('Responsible owner',120),dueAt:dateSchema,supportingEvidence:evidenceRefSchema,
  reason:reasonSchema,
  mode:z.enum(['appointment','electronic-consultation']).optional(),coordination:referralCoordinationSchema.optional(),
}).strict();
export const sendReferralActionSchema=z.object({type:z.literal('referral.send'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,evidenceRef:evidenceRefSchema,reason:reasonSchema}).strict();
export const acceptReferralActionSchema=z.object({type:z.literal('referral.accept'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,reason:reasonSchema,evidenceRef:evidenceRefSchema}).strict();
export const scheduleReferralActionSchema=z.object({type:z.literal('referral.schedule'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,scheduledFor:dateSchema,evidenceRef:evidenceRefSchema,reason:reasonSchema}).strict();
export const consultationCompleteReferralActionSchema=z.object({type:z.literal('referral.consultation-complete'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,completedAt:isoDateTimeSchema,evidenceRef:evidenceRefSchema,reason:reasonSchema}).strict();
export const adviceReceivedReferralActionSchema=z.object({type:z.literal('referral.advice-received'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,receivedAt:isoDateTimeSchema,adviceSummary:nonEmpty('Specialist advice summary',3000),originalAdvice:nonEmpty('Original specialist advice',4000),evidenceRef:evidenceRefSchema,reason:reasonSchema}).strict();
export const reviewReferralActionSchema=z.object({type:z.literal('referral.review'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,reviewSummary:nonEmpty('Review summary',3000),evidenceRef:evidenceRefSchema,reason:reasonSchema}).strict();
export const reconcileReferralActionSchema=z.object({type:z.literal('referral.plan-reconciled'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,reconciliationPlan:nonEmpty('Reconciled plan',3000),evidenceRef:evidenceRefSchema,reason:reasonSchema}).strict();
export const closeReferralActionSchema=z.object({type:z.literal('referral.close'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,reason:reasonSchema}).strict();
export const rejectReferralActionSchema=z.object({type:z.literal('referral.reject'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,reason:reasonSchema,evidenceRef:evidenceRefSchema}).strict();
export const unreachableReferralActionSchema=z.object({type:z.literal('referral.unreachable-patient'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,reason:reasonSchema}).strict();
export const noShowReferralActionSchema=z.object({type:z.literal('referral.no-show'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,reason:reasonSchema,evidenceRef:evidenceRefSchema}).strict();
export const rerequestReferralActionSchema=z.object({type:z.literal('referral.re-request'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,reason:reasonSchema,evidenceRef:evidenceRefSchema}).strict();
export const reopenReferralActionSchema=z.object({type:z.literal('referral.reopen'),actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,reason:reasonSchema}).strict();
const referralUpdateFields={actionId:actionIdSchema,id:recordIdSchema,patientId:patientIdSchema,expectedVersion:expectedVersionSchema,reason:reasonSchema};
export const clarifyReferralActionSchema=z.object({type:z.literal('referral.clarification'),...referralUpdateFields,question:reasonSchema,evidenceRef:evidenceRefSchema}).strict();
export const respondReferralActionSchema=z.object({type:z.literal('referral.respond'),...referralUpdateFields,response:reasonSchema,evidenceRef:evidenceRefSchema}).strict();
export const declineReferralActionSchema=z.object({type:z.literal('referral.decline'),...referralUpdateFields,evidenceRef:evidenceRefSchema}).strict();
export const alternativeReferralActionSchema=z.object({type:z.literal('referral.alternative'),...referralUpdateFields,disposition:alternativeSchema}).strict();
export const communicateReferralActionSchema=z.object({type:z.literal('referral.communicate'),...referralUpdateFields,communicatedAt:isoDateTimeSchema,evidenceRef:evidenceRefSchema}).strict();
export const transferReferralActionSchema=z.object({type:z.literal('referral.transfer'),...referralUpdateFields,transfer:coverageSchema}).strict();
export const duplicateReferralActionSchema=z.object({type:z.literal('referral.duplicate'),...referralUpdateFields,duplicateOfId:recordIdSchema,evidenceRef:evidenceRefSchema}).strict();
export const configureReferralActionSchema=z.object({type:z.literal('referral.configure'),...referralUpdateFields,mode:z.enum(['appointment','electronic-consultation']),coordination:referralCoordinationSchema}).strict();
export const referralActionSchema=z.discriminatedUnion('type',[
  createReferralActionSchema,sendReferralActionSchema,acceptReferralActionSchema,scheduleReferralActionSchema,consultationCompleteReferralActionSchema,
  adviceReceivedReferralActionSchema,reviewReferralActionSchema,reconcileReferralActionSchema,closeReferralActionSchema,rejectReferralActionSchema,
  unreachableReferralActionSchema,noShowReferralActionSchema,rerequestReferralActionSchema,reopenReferralActionSchema,
  clarifyReferralActionSchema,respondReferralActionSchema,declineReferralActionSchema,alternativeReferralActionSchema,communicateReferralActionSchema,transferReferralActionSchema,duplicateReferralActionSchema,
  configureReferralActionSchema,
]);
export type ReferralAction=z.infer<typeof referralActionSchema>;

const resultTransitions:Record<ResultAction['type'],readonly ResultStatus[]>= {
  'result.create':[],
  'result.mark-awaiting':['requested'],
  'result.receive':['requested','awaiting-result'],
  'result.correct':['received','reviewed','acted-on','communicated','closed'],
  'result.review':['received'],
  'result.act':['reviewed'],
  'result.communicate':['acted-on'],
  'result.close':['communicated'],
  'result.cancel':['requested','awaiting-result','received','reviewed','acted-on'],
  'result.reopen':['cancelled','closed','communicated'],
  'result.finalize':['received','reviewed','acted-on','communicated','closed'],
  'result.track':['requested','awaiting-result','received','reviewed','acted-on','communicated','closed','cancelled'],
};
const referralTransitions:Record<ReferralAction['type'],readonly ReferralStatus[]>= {
  'referral.create':[],
  'referral.send':['requested'],
  'referral.accept':['sent'],
  'referral.schedule':['accepted'],
  'referral.consultation-complete':['scheduled'],
  'referral.advice-received':['consultation-complete','accepted'],
  'referral.review':['advice-received'],
  'referral.plan-reconciled':['reviewed'],
  'referral.close':['plan-reconciled','communicated','transferred'],
  'referral.reject':['sent','accepted'],
  'referral.unreachable-patient':['requested','accepted','scheduled'],
  'referral.no-show':['scheduled'],
  'referral.re-request':['rejected','unreachable-patient','no-show'],
  'referral.reopen':['closed'],
  'referral.clarification':['sent','accepted'],
  'referral.respond':['clarification-needed'],
  'referral.decline':['requested','sent','accepted','scheduled','clarification-needed'],
  'referral.alternative':['rejected','patient-declined','unreachable-patient','no-show','consultation-complete'],
  'referral.communicate':['plan-reconciled','alternative-disposition','closed'],
  'referral.transfer':['communicated','transfer-pending'],
  'referral.duplicate':['requested','sent','rejected','clarification-needed'],
  'referral.configure':referralStatuses,
};
const terminalResultStatuses=new Set<ResultStatus>(['closed','cancelled']);
const terminalReferralStatuses=new Set<ReferralStatus>(['closed']);

function assert(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(message);}
function compareDateOnly(left:string,right:string){return left.localeCompare(right.slice(0,10));}
function appendHistory<T extends {history:HistoryEntry[];version:number;updatedAt:string}>(record:T,entry:HistoryEntry):T{return {...record,version:record.version+1,updatedAt:entry.at,history:[entry,...record.history]};}
function resultById(records:readonly ResultRecord[],id:string){const record=records.find(item=>item.id===id);assert(record,`Result record ${id} not found`);return record;}
function referralById(records:readonly ReferralRecord[],id:string){const record=records.find(item=>item.id===id);assert(record,`Referral record ${id} not found`);return record;}
function assertActionAllowed(status:string,allowed:readonly string[],label:string){assert(allowed.includes(status),`${label} is not allowed from ${status}`);}
function assertFresh(expected:number,version:number){assert(expected===version,`Stale update: expected version ${expected}, current version is ${version}`);}
function assertPatient(actionPatientId:string,recordPatientId:string,label:string){assert(actionPatientId===recordPatientId,`${label} uses the wrong patient record`);}
function checkWindow(window:z.infer<typeof dueWindowSchema>){
  try{new Intl.DateTimeFormat('en',{timeZone:window.timezone});}catch{throw new Error('Use a valid clinical deadline timezone');}
  if(window.start)assert(Date.parse(window.start)<=Date.parse(window.end),'Due window cannot end before it starts');
}
function checkCoverage(coverage:z.infer<typeof coverageSchema>|undefined,now:string){
  if(coverage?.status==='accepted')assert(coverage.acceptedBy===coverage.requestedOwner&&coverage.acceptedAt&&Date.parse(coverage.acceptedAt)<=Date.parse(now)&&coverage.evidenceRef,'Acceptance requires the receiving clinician, receipt and actual acceptance time');
  else if(coverage)assert(!coverage.acceptedBy&&!coverage.acceptedAt,'Pending or rejected coverage cannot claim acceptance');
}
function checkTracking(tracking:z.infer<typeof resultTrackingSchema>,previous:z.infer<typeof resultTrackingSchema>|undefined,now:string){
  checkWindow(tracking.dueWindow);checkCoverage(tracking.coverage,now);
  if(!['draft','cancelled'].includes(tracking.requestStage))assert(tracking.requestEvidence&&tracking.requestRecordedBy&&tracking.requestRecordedAt&&Date.parse(tracking.requestRecordedAt)<=Date.parse(now),'Request milestones require their actual reviewer, time and evidence');
  if(tracking.priority==='urgent')assert(tracking.policyRef,'Urgent review requires the recorded escalation policy');
  const transitions:Record<string,string[]>={draft:['authorized','cancelled'],authorized:['submitted','cancelled'],submitted:['accepted','cancelled'],accepted:['completed','cancelled'],completed:[],cancelled:['draft']};
  if(previous&&previous.requestStage!==tracking.requestStage)assert(transitions[previous.requestStage].includes(tracking.requestStage),'Request acceptance and completion must be recorded separately');
  if(tracking.coverage?.status==='accepted')assert(previous?.coverage?.requestedOwner===tracking.coverage.requestedOwner&&['requested','accepted'].includes(previous.coverage.status),'Request coverage before recording its acceptance');
}

export function isResultOverdue(record:ResultRecord,now:string){return !terminalResultStatuses.has(record.status)&&(record.tracking?Date.parse(record.tracking.dueWindow.end)<Date.parse(now):compareDateOnly(record.dueAt,now)<0);}
export function isReferralOverdue(record:ReferralRecord,now:string){return !terminalReferralStatuses.has(record.status)&&(record.coordination?Date.parse(record.coordination.dueWindow.end)<Date.parse(now):compareDateOnly(record.dueAt,now)<0);}
/** Shared work uses the same exact deadline as the source workflow. */
export function resultWorkDeadline(record:ResultRecord|ReferralRecord):{date:string;time:string;timezone?:string}{
  const deadline='requestLabel' in record?record.tracking?.nextAttemptAt??record.tracking?.dueWindow.end:record.coordination?.dueWindow.end;
  if(!deadline)return {date:record.dueAt,time:''};
  const instant=new Date(deadline).toISOString();
  return {date:instant.slice(0,10),time:instant.slice(11,16),timezone:'UTC'};
}
export function canRecordResultReport(record:ResultRecord){return !record.tracking||['accepted','completed'].includes(record.tracking.requestStage);}
export function nextResultActions(record:ResultRecord):readonly string[]{
  const request=record.tracking?.requestStage;
  const requestStep=request==='draft'?'Record request authorization':request==='authorized'?'Record request submission':request==='submitted'?'Record receiving-service acceptance':request==='accepted'?'Record request completion':request==='cancelled'?'Restart request tracking':undefined;
  const preliminary=record.revisions[0]?.reportStatus==='preliminary';
  const reportReady=canRecordResultReport(record),correction=reportReady?['Record correction']:[];
  if(['requested','awaiting-result'].includes(record.status)&&request&&!['accepted','completed'].includes(request))return [...(requestStep?[requestStep]:[]),...(record.status==='requested'&&request==='submitted'?['Mark awaiting result']:[]),'Cancel request'];
  if(record.status==='received'&&record.tracking?.reviewerAvailability==='absent'&&record.tracking.coverage?.status!=='accepted')return [record.tracking.coverage?.status==='requested'?'Record covering reviewer acceptance':'Request covering reviewer',...(preliminary&&reportReady?['Record final report']:[]),...correction];
  switch(record.status){
    case 'requested': return ['Mark awaiting result','Record result','Cancel request'] as const;
    case 'awaiting-result': return ['Record result','Cancel request'] as const;
    case 'received': return [...(preliminary&&reportReady?['Record final report']:[]),'Review interpretation',...correction];
    case 'reviewed': return ['Document action',...correction];
    case 'acted-on': return ['Document patient communication',...correction];
    case 'communicated': return [...(preliminary&&reportReady?['Record final report']:[]),...(requestStep?[requestStep]:[]),...(!preliminary&&(!request||request==='completed')?['Close workflow']:[]),...correction];
    case 'closed': return ['Reopen workflow',...correction];
    case 'cancelled': return ['Reopen workflow'] as const;
  }
}
export function nextReferralActions(record:ReferralRecord){
  switch(record.status){
    case 'requested': return ['Send referral'] as const;
    case 'sent': return ['Record acceptance','Record rejection'] as const;
    case 'accepted': return record.mode==='electronic-consultation'?['Record specialist advice','Request clarification','Mark patient unreachable'] as const:['Schedule consultation','Mark patient unreachable'] as const;
    case 'scheduled': return ['Record consultation complete','Mark no-show','Mark patient unreachable'] as const;
    case 'consultation-complete': return ['Record specialist advice'] as const;
    case 'advice-received': return ['Review advice'] as const;
    case 'reviewed': return ['Reconcile plan'] as const;
    case 'plan-reconciled': return record.mode?['Document patient communication'] as const:['Close referral'] as const;
    case 'rejected':
    case 'unreachable-patient':
    case 'no-show': return ['Re-request referral'] as const;
    case 'closed': return ['Reopen referral'] as const;
    case 'clarification-needed':return ['Respond to clarification'] as const;
    case 'patient-declined':return ['Document alternative disposition'] as const;
    case 'alternative-disposition':return ['Document patient communication'] as const;
    case 'communicated':return ['Close referral','Request accepted transfer'] as const;
    case 'transfer-pending':return ['Record receiving ownership acceptance'] as const;
    case 'transferred':return ['Close referring workflow'] as const;
  }
}

function assertReplay(records:readonly {id:string;patientId:string;history:HistoryEntry[]}[],action:ResultAction|ReferralAction,actor:string){
  for(const record of records){
    const prior=record.history.find(entry=>entry.id===action.actionId);
    if(!prior)continue;
    assertPatient(action.patientId,record.patientId,'Replayed action');
    assert(prior.actor===actor,'Action ID was already used by a different actor');
    assert(prior.fingerprint===JSON.stringify(action),'Action ID was already used for a different payload');
    return true;
  }
  return false;
}

export function reduceResultRecords(records:readonly ResultRecord[],validatedAction:ResultAction,actor:string,now:string){
  validatedAction=resultActionSchema.parse(validatedAction);
  records=structuredClone(records);
  isoDateTimeSchema.parse(now);
  nonEmpty('Actor',160).parse(actor);
  if(assertReplay(records,validatedAction,actor))return records as ResultRecord[];
  if(validatedAction.type==='result.create'){
    const existing=records.find(record=>record.id===validatedAction.id);
    assert(!existing,`Result record ${validatedAction.id} already exists`);
    assert(validatedAction.requestedAt<=now.slice(0,10),'Requested date cannot be in the future');
    assert(validatedAction.dueAt>=validatedAction.requestedAt,'Result due date cannot precede the request');
    if(validatedAction.tracking){checkTracking(validatedAction.tracking,undefined,now);assert(validatedAction.tracking.requestStage==='draft','New request tracking starts in draft');}
    return [{
      id:validatedAction.id,patientId:validatedAction.patientId,encounterId:validatedAction.encounterId,version:1,createdAt:now,updatedAt:now,
      status:'requested',requestLabel:validatedAction.requestLabel,owner:validatedAction.owner,dueAt:validatedAction.tracking?.dueWindow.end.slice(0,10)??validatedAction.dueAt,requestedAt:validatedAction.requestedAt,
      requestReason:validatedAction.reason,revisions:[],interpretation:'',clinicalDisposition:'',communicationEvidence:'',
      ...(validatedAction.tracking?{tracking:validatedAction.tracking}:{}),
      history:[{id:validatedAction.actionId,at:now,actor,from:'none',to:'requested',reason:validatedAction.reason,fingerprint:JSON.stringify(validatedAction)}],
    },...records.map(record=>structuredClone(record))];
  }
  const current=resultById(records,validatedAction.id);
  assertPatient(validatedAction.patientId,current.patientId,'Result action');
  assertFresh(validatedAction.expectedVersion,current.version);
  assert(Date.parse(now)>=Date.parse(current.updatedAt),'History time cannot move backwards');
  assertActionAllowed(current.status,resultTransitions[validatedAction.type],validatedAction.type);
  if(validatedAction.type==='result.mark-awaiting'&&current.tracking)assert(['submitted','accepted','completed'].includes(current.tracking.requestStage),'Authorize and submit the request before awaiting a result');
  if(validatedAction.type==='result.review'&&current.tracking?.reviewerAvailability==='absent')assert(current.tracking.coverage?.status==='accepted','An absent reviewer requires accepted covering responsibility');
  if(validatedAction.type==='result.receive'||validatedAction.type==='result.correct'||validatedAction.type==='result.finalize'){
    assert(Date.parse(validatedAction.receivedAt)>=Date.parse(validatedAction.collectedAt),'Result receipt cannot precede collection');
    assert(Date.parse(validatedAction.receivedAt)<=Date.parse(now),'Result receipt cannot be in the future');
    assert(!current.revisions.some(revision=>revision.id===validatedAction.revisionId),'Result revision ID already exists');
    if(current.tracking)assert(['accepted','completed'].includes(current.tracking.requestStage),'Match a report only after request acceptance is recorded');
    if(validatedAction.type==='result.receive')assert(validatedAction.reportStatus!=='corrected','A first report cannot be a correction');
    if(validatedAction.type==='result.finalize'){assert(current.revisions[0]?.reportStatus==='preliminary','Only a preliminary report can be finalized');assert(validatedAction.finalizedFromId===current.revisions[0].id,'Final report must reference the current preliminary report');assert(Date.parse(validatedAction.receivedAt)>=Date.parse(current.revisions[0].receivedAt),'Final report receipt cannot precede the preliminary report');}
    if(validatedAction.type==='result.correct'){
      assert(!validatedAction.reportStatus||validatedAction.reportStatus==='corrected','A corrected revision must retain corrected report status');
      assert(validatedAction.correctedFromId===current.revisions[0]?.id,'Corrections must reference the current result revision');
      assert(Date.parse(validatedAction.receivedAt)>=Date.parse(current.revisions[0].receivedAt),'Correction receipt cannot precede the original result');
    }
  }
  const next=(():ResultRecord=>{
    if(validatedAction.type==='result.track'){
      checkTracking(validatedAction.tracking,current.tracking,now);
      return appendHistory({...current,tracking:validatedAction.tracking,owner:validatedAction.tracking.coverage?.status==='accepted'?validatedAction.tracking.coverage.requestedOwner:current.owner,dueAt:validatedAction.tracking.dueWindow.end.slice(0,10)}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:current.status,reason:validatedAction.reason});
    }
    if(validatedAction.type==='result.mark-awaiting')return appendHistory({...current,status:'awaiting-result'}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'awaiting-result',reason:validatedAction.reason});
    if(validatedAction.type==='result.receive')return appendHistory({...current,status:'received',revisions:[{id:validatedAction.revisionId,kind:'original',source:validatedAction.source,summary:validatedAction.summary,collectedAt:validatedAction.collectedAt,receivedAt:validatedAction.receivedAt,evidenceRef:validatedAction.evidenceRef,reportStatus:validatedAction.reportStatus,findings:validatedAction.findings},...current.revisions]}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'received',reason:validatedAction.reason,evidenceRef:validatedAction.evidenceRef});
    if(validatedAction.type==='result.finalize')return appendHistory({...current,status:'received',revisions:[{id:validatedAction.revisionId,kind:'final',source:validatedAction.source,summary:validatedAction.summary,collectedAt:validatedAction.collectedAt,receivedAt:validatedAction.receivedAt,evidenceRef:validatedAction.evidenceRef,reportStatus:'final',findings:validatedAction.findings,correctedFromId:validatedAction.finalizedFromId},...current.revisions],interpretation:'',clinicalDisposition:'',communicationEvidence:'',closedAt:undefined},{id:validatedAction.actionId,at:now,actor,from:current.status,to:'received',reason:validatedAction.reason,evidenceRef:validatedAction.evidenceRef});
    if(validatedAction.type==='result.correct'){
      assert(current.revisions.some(revision=>revision.id===validatedAction.correctedFromId),`Unknown result revision ${validatedAction.correctedFromId}`);
      return appendHistory({...current,status:'received',revisions:[{id:validatedAction.revisionId,kind:'corrected',source:validatedAction.source,summary:validatedAction.summary,collectedAt:validatedAction.collectedAt,receivedAt:validatedAction.receivedAt,evidenceRef:validatedAction.evidenceRef,correctedFromId:validatedAction.correctedFromId,reportStatus:validatedAction.reportStatus??'corrected',findings:validatedAction.findings},...current.revisions],interpretation:'',clinicalDisposition:'',communicationEvidence:'',closedAt:undefined}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'received',reason:validatedAction.reason,evidenceRef:validatedAction.evidenceRef});
    }
    if(validatedAction.type==='result.review')return appendHistory({...current,status:'reviewed',interpretation:validatedAction.interpretation}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'reviewed',reason:validatedAction.reason,evidenceRef:validatedAction.evidenceRef});
    if(validatedAction.type==='result.act')return appendHistory({...current,status:'acted-on',clinicalDisposition:validatedAction.clinicalDisposition}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'acted-on',reason:validatedAction.reason,evidenceRef:validatedAction.evidenceRef});
    if(validatedAction.type==='result.communicate')return appendHistory({...current,status:'communicated',communicationEvidence:validatedAction.contactEvidence}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'communicated',reason:validatedAction.reason,evidenceRef:validatedAction.contactEvidence});
    if(validatedAction.type==='result.close'){if(current.tracking)assert(current.tracking.requestStage==='completed'&&current.revisions[0]?.reportStatus!=='preliminary','Complete the request and final report review before closure');return appendHistory({...current,status:'closed',closedAt:now}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'closed',reason:validatedAction.reason});}
    if(validatedAction.type==='result.cancel')return appendHistory({...current,status:'cancelled',cancelledAt:now}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'cancelled',reason:validatedAction.reason});
    const reopenedStatus=current.communicationEvidence?'communicated':current.clinicalDisposition?'acted-on':current.interpretation?'reviewed':current.revisions.length?'received':'awaiting-result';
    return appendHistory({...current,status:reopenedStatus,closedAt:undefined,cancelledAt:undefined}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:reopenedStatus,reason:validatedAction.reason});
  })();
  next.history[0]={...next.history[0],fingerprint:JSON.stringify(validatedAction),previousSnapshot:JSON.stringify({...current,history:undefined})};
  return records.map(record=>record.id===current.id?next:structuredClone(record));
}

export function reduceReferralRecords(records:readonly ReferralRecord[],validatedAction:ReferralAction,actor:string,now:string){
  validatedAction=referralActionSchema.parse(validatedAction);
  records=structuredClone(records);
  isoDateTimeSchema.parse(now);
  nonEmpty('Actor',160).parse(actor);
  if(assertReplay(records,validatedAction,actor))return records as ReferralRecord[];
  if(validatedAction.type==='referral.create'){
    const existing=records.find(record=>record.id===validatedAction.id);
    assert(!existing,`Referral record ${validatedAction.id} already exists`);
    if(validatedAction.coordination){checkWindow(validatedAction.coordination.dueWindow);if(validatedAction.coordination.urgency==='urgent')assert(validatedAction.coordination.policyRef,'Urgency requires an approved policy reference');}
    return [{
      id:validatedAction.id,patientId:validatedAction.patientId,encounterId:validatedAction.encounterId,version:1,createdAt:now,updatedAt:now,
      status:'requested',clinicalQuestion:validatedAction.clinicalQuestion,receivingService:validatedAction.receivingService,owner:validatedAction.owner,dueAt:validatedAction.coordination?.dueWindow.end.slice(0,10)??validatedAction.dueAt,
      mode:validatedAction.mode,coordination:validatedAction.coordination,
      supportingEvidence:validatedAction.supportingEvidence,sentEvidence:'',scheduledFor:'',consultationCompletedAt:'',reviewSummary:'',reconciliationPlan:'',
      history:[{id:validatedAction.actionId,at:now,actor,from:'none',to:'requested',reason:validatedAction.reason,evidenceRef:validatedAction.supportingEvidence,fingerprint:JSON.stringify(validatedAction)}],
    },...records.map(record=>structuredClone(record))];
  }
  const current=referralById(records,validatedAction.id);
  assertPatient(validatedAction.patientId,current.patientId,'Referral action');
  assertFresh(validatedAction.expectedVersion,current.version);
  assert(Date.parse(now)>=Date.parse(current.updatedAt),'History time cannot move backwards');
  assertActionAllowed(current.status,referralTransitions[validatedAction.type],validatedAction.type);
  if(validatedAction.type==='referral.consultation-complete'){
    assert(Date.parse(validatedAction.completedAt)<=Date.parse(now),'Consultation completion cannot be in the future');
    assert(validatedAction.completedAt.slice(0,10)>=current.scheduledFor,'Consultation cannot finish before the scheduled date');
  }
  if(validatedAction.type==='referral.advice-received'){
    assert(current.status!=='accepted'||current.mode==='electronic-consultation','An appointment referral requires completed consultation before advice');
    if(current.consultationCompletedAt)assert(Date.parse(validatedAction.receivedAt)>=Date.parse(current.consultationCompletedAt),'Advice receipt cannot precede consultation completion');
    assert(Date.parse(validatedAction.receivedAt)<=Date.parse(now),'Advice receipt cannot be in the future');
  }
  if(validatedAction.type==='referral.no-show')assert(current.scheduledFor<=now.slice(0,10),'No-show cannot be recorded before the scheduled date');
  const next=(():ReferralRecord=>{
    const event={id:validatedAction.actionId,at:now,actor,from:current.status,reason:validatedAction.reason};
    if(validatedAction.type==='referral.configure'){checkWindow(validatedAction.coordination.dueWindow);if(validatedAction.coordination.urgency==='urgent')assert(validatedAction.coordination.policyRef,'Urgency requires an approved policy reference');assert(!current.mode||current.mode===validatedAction.mode||current.status==='requested'&&!current.sentEvidence,'Consultation mode cannot rewrite completed service events');return appendHistory({...current,mode:validatedAction.mode,coordination:validatedAction.coordination,dueAt:validatedAction.coordination.dueWindow.end.slice(0,10)},{...event,to:current.status});}
    if(validatedAction.type==='referral.clarification')return appendHistory({...current,status:'clarification-needed',clarification:validatedAction.question},{...event,to:'clarification-needed',evidenceRef:validatedAction.evidenceRef});
    if(validatedAction.type==='referral.respond')return appendHistory({...current,status:'sent',clarification:current.clarification+'\nResponse: '+validatedAction.response},{...event,to:'sent',evidenceRef:validatedAction.evidenceRef});
    if(validatedAction.type==='referral.decline')return appendHistory({...current,status:'patient-declined'},{...event,to:'patient-declined',evidenceRef:validatedAction.evidenceRef});
    if(validatedAction.type==='referral.alternative'){assert(Date.parse(validatedAction.disposition.reviewedAt)<=Date.parse(now),'Alternative review cannot be in the future');return appendHistory({...current,status:'alternative-disposition',alternativeDisposition:validatedAction.disposition},{...event,to:'alternative-disposition'});}
    if(validatedAction.type==='referral.communicate'){assert(Date.parse(validatedAction.communicatedAt)<=Date.parse(now),'Communication cannot be recorded in the future');return appendHistory({...current,status:'communicated',communicationEvidence:validatedAction.evidenceRef,communicationAt:validatedAction.communicatedAt},{...event,to:'communicated',evidenceRef:validatedAction.evidenceRef});}
    if(validatedAction.type==='referral.transfer'){checkCoverage(validatedAction.transfer,now);if(validatedAction.transfer.status==='accepted')assert(current.transfer?.status==='requested'&&current.transfer.requestedOwner===validatedAction.transfer.requestedOwner,'Request receiving ownership before recording acceptance');const accepted=validatedAction.transfer.status==='accepted',status=accepted?'transferred':'transfer-pending';return appendHistory({...current,status,transfer:validatedAction.transfer,owner:accepted?validatedAction.transfer.requestedOwner:current.owner},{...event,to:status,evidenceRef:validatedAction.transfer.evidenceRef});}
    if(validatedAction.type==='referral.duplicate'){const original=referralById(records,validatedAction.duplicateOfId);assert(original.id!==current.id&&original.patientId===current.patientId&&original.status!=='closed'&&original.receivingService===current.receivingService&&original.clinicalQuestion===current.clinicalQuestion,'Link an open original referral for the same patient, service and clinical question');return appendHistory({...current,status:'closed',closedAt:now,duplicateOfId:original.id},{...event,to:'closed',evidenceRef:validatedAction.evidenceRef});}

    if(validatedAction.type==='referral.send')return appendHistory({...current,status:'sent',sentEvidence:validatedAction.evidenceRef}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'sent',reason:validatedAction.reason,evidenceRef:validatedAction.evidenceRef});
    if(validatedAction.type==='referral.accept')return appendHistory({...current,status:'accepted'}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'accepted',reason:validatedAction.reason,evidenceRef:validatedAction.evidenceRef});
    if(validatedAction.type==='referral.schedule')return appendHistory({...current,status:'scheduled',scheduledFor:validatedAction.scheduledFor}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'scheduled',reason:validatedAction.reason,evidenceRef:validatedAction.evidenceRef});
    if(validatedAction.type==='referral.consultation-complete')return appendHistory({...current,status:'consultation-complete',consultationCompletedAt:validatedAction.completedAt}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'consultation-complete',reason:validatedAction.reason,evidenceRef:validatedAction.evidenceRef});
    if(validatedAction.type==='referral.advice-received')return appendHistory({...current,status:'advice-received',specialistAdvice:{receivedAt:validatedAction.receivedAt,summary:validatedAction.adviceSummary,originalAdvice:validatedAction.originalAdvice,evidenceRef:validatedAction.evidenceRef}}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'advice-received',reason:validatedAction.reason,evidenceRef:validatedAction.evidenceRef});
    if(validatedAction.type==='referral.review')return appendHistory({...current,status:'reviewed',reviewSummary:validatedAction.reviewSummary}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'reviewed',reason:validatedAction.reason,evidenceRef:validatedAction.evidenceRef});
    if(validatedAction.type==='referral.plan-reconciled')return appendHistory({...current,status:'plan-reconciled',reconciliationPlan:validatedAction.reconciliationPlan}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'plan-reconciled',reason:validatedAction.reason,evidenceRef:validatedAction.evidenceRef});
    if(validatedAction.type==='referral.close'){if(current.mode)assert(current.communicationEvidence&&['communicated','transferred'].includes(current.status),'Record patient instructions before closing this referral');return appendHistory({...current,status:'closed',closedAt:now}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'closed',reason:validatedAction.reason});}
    if(validatedAction.type==='referral.reject')return appendHistory({...current,status:'rejected'}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'rejected',reason:validatedAction.reason,evidenceRef:validatedAction.evidenceRef});
    if(validatedAction.type==='referral.unreachable-patient')return appendHistory({...current,status:'unreachable-patient'}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'unreachable-patient',reason:validatedAction.reason});
    if(validatedAction.type==='referral.no-show')return appendHistory({...current,status:'no-show'}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'no-show',reason:validatedAction.reason,evidenceRef:validatedAction.evidenceRef});
    if(validatedAction.type==='referral.re-request')return appendHistory({...current,status:'requested',sentEvidence:'',scheduledFor:'',consultationCompletedAt:'',specialistAdvice:undefined,reviewSummary:'',reconciliationPlan:''}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'requested',reason:validatedAction.reason,evidenceRef:validatedAction.evidenceRef});
    return appendHistory({...current,status:'requested',sentEvidence:'',scheduledFor:'',consultationCompletedAt:'',specialistAdvice:undefined,reviewSummary:'',reconciliationPlan:'',closedAt:undefined}, {id:validatedAction.actionId,at:now,actor,from:current.status,to:'requested',reason:validatedAction.reason});
  })();
  next.history[0]={...next.history[0],fingerprint:JSON.stringify(validatedAction),previousSnapshot:JSON.stringify({...current,history:undefined})};
  return records.map(record=>record.id===current.id?next:structuredClone(record));
}

export const emptyResultRecordDraft={requestLabel:'',owner:'',dueAt:'',requestedAt:'',reason:''};
export const emptyReferralRecordDraft={clinicalQuestion:'',receivingService:'',owner:'',dueAt:'',supportingEvidence:'',reason:''};



const historySchema=z.object({id:actionIdSchema,at:isoDateTimeSchema,actor:nonEmpty('Actor',160),from:nonEmpty('Previous status',80),to:nonEmpty('Status',80),reason:reasonSchema,evidenceRef:evidenceRefSchema.optional(),fingerprint:z.string().optional(),previousSnapshot:z.string().optional()}).strict();
const recordFields={id:recordIdSchema,patientId:patientIdSchema,encounterId:encounterIdSchema,version:z.number().int().positive(),createdAt:isoDateTimeSchema,updatedAt:isoDateTimeSchema,history:z.array(historySchema).min(1)};
const resultRevisionSchema=z.object({id:recordIdSchema,kind:z.enum(['original','corrected','final']),source:z.enum(['manual','external']),summary:nonEmpty('Result summary',1000),collectedAt:isoDateTimeSchema,receivedAt:isoDateTimeSchema,evidenceRef:evidenceRefSchema,correctedFromId:recordIdSchema.optional(),reportStatus:z.enum(['preliminary','final','corrected']).optional(),findings:z.array(findingSchema).optional()}).strict();
export const resultRecordSchema=z.object({...recordFields,status:z.enum(resultStatuses),requestLabel:nonEmpty('Requested test',160),owner:nonEmpty('Responsible owner',120),dueAt:dateSchema,requestedAt:dateSchema,requestReason:reasonSchema,revisions:z.array(resultRevisionSchema),interpretation:z.string().max(2000),clinicalDisposition:z.string().max(2000),communicationEvidence:z.string().max(200),closedAt:isoDateTimeSchema.optional(),cancelledAt:isoDateTimeSchema.optional(),tracking:resultTrackingSchema.optional()}).strict();
export const referralRecordSchema=z.object({...recordFields,status:z.enum(referralStatuses),clinicalQuestion:nonEmpty('Clinical question',2000),receivingService:nonEmpty('Receiving service',160),owner:nonEmpty('Responsible owner',120),dueAt:dateSchema,supportingEvidence:evidenceRefSchema,sentEvidence:z.string().max(200),scheduledFor:z.union([dateSchema,z.literal('')]),consultationCompletedAt:z.union([isoDateTimeSchema,z.literal('')]),specialistAdvice:z.object({receivedAt:isoDateTimeSchema,summary:nonEmpty('Advice summary',3000),originalAdvice:nonEmpty('Original advice',4000),evidenceRef:evidenceRefSchema}).strict().optional(),reviewSummary:z.string().max(3000),reconciliationPlan:z.string().max(3000),closedAt:isoDateTimeSchema.optional(),mode:z.enum(['appointment','electronic-consultation']).optional(),coordination:referralCoordinationSchema.optional(),clarification:z.string().optional(),alternativeDisposition:alternativeSchema.optional(),communicationEvidence:evidenceRefSchema.optional(),communicationAt:isoDateTimeSchema.optional(),transfer:coverageSchema.optional(),duplicateOfId:recordIdSchema.optional()}).strict();

export const stateSchema=z.object({results:z.array(resultRecordSchema),referrals:z.array(referralRecordSchema)}).strict();
export type State=z.infer<typeof stateSchema>;
export type Context={actor:string;now:string;patients:readonly {id:string;name:string}[];features:Readonly<Record<string,boolean>>;careActions?:readonly {domain:string;id:string;version:number;patientId:string;title:string;owner?:string}[]};
export function initialState():State{return {results:[],referrals:[]};}
export function validateState(value:unknown):State{
  if(value===undefined||value===null)return initialState();
  const state=stateSchema.parse(value);
  const ids=new Set<string>(),events=new Set<string>();
  for(const record of [...state.results,...state.referrals]){
    assert(!ids.has(record.id),'Duplicate result or referral record ID');ids.add(record.id);
    assert(record.version===record.history.length,'Record version must match its immutable history');
    assert(record.history[0].to===record.status,'Current status must match the latest history entry');
    assert(record.history[0].at===record.updatedAt,'Updated time must match the latest history entry');
    assert(record.history.at(-1)?.at===record.createdAt,'Creation time must match the first history entry');
    for(let i=0;i<record.history.length;i++){
      const entry=record.history[i],previous=record.history[i+1];
      assert(!events.has(entry.id),'Duplicate result or referral action ID');events.add(entry.id);
      if(previous){assert(Date.parse(entry.at)>=Date.parse(previous.at),'History time cannot move backwards');assert(entry.from===previous.to,'History status chain is invalid');}
    }
  }
  for(const record of state.results){
    if(record.tracking){checkWindow(record.tracking.dueWindow);checkCoverage(record.tracking.coverage,record.updatedAt);}
    assert(record.dueAt>=record.requestedAt,'Result due date cannot precede the request');
    const ids=new Set<string>();
    for(let i=0;i<record.revisions.length;i++){
      const revision=record.revisions[i];assert(!ids.has(revision.id),'Duplicate result revision ID');ids.add(revision.id);
      assert(Date.parse(revision.receivedAt)>=Date.parse(revision.collectedAt),'Result receipt cannot precede collection');
      if(revision.kind==='corrected'||revision.kind==='final')assert(revision.correctedFromId===record.revisions[i+1]?.id,'Correction chain is invalid');
      else assert(i===record.revisions.length-1&&!revision.correctedFromId,'Original result must start the revision chain');
    }
    if(['received','reviewed','acted-on','communicated','closed'].includes(record.status))assert(record.revisions.length,'Result state requires a received result');
    if(['reviewed','acted-on','communicated','closed'].includes(record.status))assert(record.interpretation.trim(),'Result state requires clinical review');
    if(['acted-on','communicated','closed'].includes(record.status))assert(record.clinicalDisposition.trim(),'Result state requires an action');
    if(['communicated','closed'].includes(record.status))assert(record.communicationEvidence.trim(),'Result state requires documented communication');
  }
  for(const record of state.referrals){
    if(record.coordination)checkWindow(record.coordination.dueWindow);
    if(record.transfer)checkCoverage(record.transfer,record.updatedAt);
    if(record.duplicateOfId){assert(state.referrals.some(item=>item.id===record.duplicateOfId&&item.patientId===record.patientId),'Duplicate referral lost its original patient link');continue;}
    if(record.alternativeDisposition)continue;
    if(['advice-received','reviewed','plan-reconciled','closed'].includes(record.status))assert(record.specialistAdvice,'Referral state requires specialist advice');
    if(['reviewed','plan-reconciled','closed'].includes(record.status))assert(record.reviewSummary.trim(),'Referral state requires clinical review');
    if(['plan-reconciled','closed'].includes(record.status))assert(record.reconciliationPlan.trim(),'Referral state requires a reconciled plan');
  }
  return state;
}

// Shared commands use the domain prefix and requestId; legacy exports remain usable.
export const actionSchema=z.discriminatedUnion('type',[
  configureReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.configure'),requestId:actionIdSchema}).strict(),
  finalizeResultActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.result.finalize'),requestId:actionIdSchema}).strict(),
  trackResultActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.result.track'),requestId:actionIdSchema}).strict(),
  clarifyReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.clarification'),requestId:actionIdSchema}).strict(),
  respondReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.respond'),requestId:actionIdSchema}).strict(),
  declineReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.decline'),requestId:actionIdSchema}).strict(),
  alternativeReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.alternative'),requestId:actionIdSchema}).strict(),
  communicateReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.communicate'),requestId:actionIdSchema}).strict(),
  transferReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.transfer'),requestId:actionIdSchema}).strict(),
  duplicateReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.duplicate'),requestId:actionIdSchema}).strict(),

  createResultActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.result.create'),requestId:actionIdSchema}).strict(),
  markResultAwaitingActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.result.mark-awaiting'),requestId:actionIdSchema}).strict(),
  receiveResultActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.result.receive'),requestId:actionIdSchema}).strict(),
  correctResultActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.result.correct'),requestId:actionIdSchema}).strict(),
  reviewResultActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.result.review'),requestId:actionIdSchema}).strict(),
  actOnResultActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.result.act'),requestId:actionIdSchema}).strict(),
  communicateResultActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.result.communicate'),requestId:actionIdSchema}).strict(),
  closeResultActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.result.close'),requestId:actionIdSchema}).strict(),
  cancelResultActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.result.cancel'),requestId:actionIdSchema}).strict(),
  reopenResultActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.result.reopen'),requestId:actionIdSchema}).strict(),
  createReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.create'),requestId:actionIdSchema}).strict(),
  sendReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.send'),requestId:actionIdSchema}).strict(),
  acceptReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.accept'),requestId:actionIdSchema}).strict(),
  scheduleReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.schedule'),requestId:actionIdSchema}).strict(),
  consultationCompleteReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.consultation-complete'),requestId:actionIdSchema}).strict(),
  adviceReceivedReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.advice-received'),requestId:actionIdSchema}).strict(),
  reviewReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.review'),requestId:actionIdSchema}).strict(),
  reconcileReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.plan-reconciled'),requestId:actionIdSchema}).strict(),
  closeReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.close'),requestId:actionIdSchema}).strict(),
  rejectReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.reject'),requestId:actionIdSchema}).strict(),
  unreachableReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.unreachable-patient'),requestId:actionIdSchema}).strict(),
  noShowReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.no-show'),requestId:actionIdSchema}).strict(),
  rerequestReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.re-request'),requestId:actionIdSchema}).strict(),
  reopenReferralActionSchema.omit({actionId:true}).extend({type:z.literal('results-referrals.referral.reopen'),requestId:actionIdSchema}).strict(),

]);
export type Action=z.infer<typeof actionSchema>;
export function reduce(state:State,unknownAction:Action,context:Context):State{
  const action=actionSchema.parse(unknownAction);
  isoDateTimeSchema.parse(context.now);nonEmpty('Actor',160).parse(context.actor);
  assert(context.patients.some(patient=>patient.id===action.patientId),`Unknown patient: ${action.patientId}`);
  const current=validateState(state);
  const {requestId,...fields}=action;
  const legacy={...fields,type:action.type.slice('results-referrals.'.length),actionId:requestId};
  const isResult=legacy.type.startsWith('result.');
  const parsed=isResult?resultActionSchema.parse(legacy):referralActionSchema.parse(legacy);
  if(assertReplay([...current.results,...current.referrals],parsed,context.actor))return current;
  if(parsed.type.endsWith('.create'))assert(![...current.results,...current.referrals].some(record=>record.id===parsed.id),'Record ID already exists');
  const next=isResult?{...current,results:reduceResultRecords(current.results,parsed as ResultAction,context.actor,context.now)}:{...current,referrals:reduceReferralRecords(current.referrals,parsed as ReferralAction,context.actor,context.now)};
  return validateState(next);
}
export function getSummary(state:State,patientId?:string,now=new Date().toISOString()){
  const current=validateState(state);
  const results=current.results.filter(record=>(!patientId||record.patientId===patientId)&&(!terminalResultStatuses.has(record.status)||missingRequirements(record).length));
  const referrals=current.referrals.filter(record=>(!patientId||record.patientId===patientId)&&(!terminalReferralStatuses.has(record.status)||missingRequirements(record).length));
  return {open:results.length+referrals.length,overdue:results.filter(record=>isResultOverdue(record,now)).length+referrals.filter(record=>isReferralOverdue(record,now)).length,attention:[...results.map(record=>`${record.requestLabel}: ${[...missingRequirements(record),...nextResultActions(record)].join(', ')}`),...referrals.map(record=>`${record.receivingService}: ${[...missingRequirements(record),...nextReferralActions(record)].join(', ')}`)].slice(0,6)};
}

export function missingRequirements(record:ResultRecord|ReferralRecord):string[]{
  if('requestLabel' in record)return [...(!record.tracking?['Confirm request progress, backup coverage and the clinical deadline.']:[]),...(record.revisions.some(item=>!item.reportStatus)?['Confirm the report status of retained result versions.']:[])];
  if(record.duplicateOfId)return [];
  return [...(!record.mode||!record.coordination?['Confirm referral mode, authorized packet and backup responsibility.']:[]),...(record.status==='closed'&&!record.communicationEvidence?['Record patient communication and the agreed next action.']:[])];
}
