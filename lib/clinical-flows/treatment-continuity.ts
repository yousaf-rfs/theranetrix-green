import {z} from 'zod';

export type Context={
  actor:string;
  now:string;
  patients:readonly {id:string;name:string}[];
  features:Readonly<Record<string,boolean>>;
  careActions?:readonly {domain:string;id:string;version:number;patientId:string;title:string;owner?:string}[];
  demoClinicalAuthority?:{patientId:string;principalId:string;canPrescribe:boolean;scopeSupported:boolean};
};

const isoDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'Expected YYYY-MM-DD date').refine(value=>!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'Use a valid calendar date');
const isoDateTime=z.string().datetime({offset:true});
const nonEmpty=z.string().trim().min(1).max(6000);
const optionalDate=isoDate.optional().or(z.literal(''));
const optionalString=nonEmpty.optional().or(z.literal(''));

export const sourceEvidenceSchema=z.object({source:nonEmpty,author:nonEmpty,collectedAt:isoDateTime.nullable(),receivedAt:isoDateTime,reference:nonEmpty}).strict();
export const careActionRefSchema=z.object({domain:z.enum(['results-referrals','treatment-continuity','encounters']),id:nonEmpty,version:z.number().int().positive()}).strict();
const agreementSchema=z.enum(['agreed','declined','not-discussed']);
const provenanceSchema=z.object({patient:sourceEvidenceSchema,external:sourceEvidenceSchema,nextAction:nonEmpty,reviewedBy:optionalString,reviewedAt:isoDateTime.optional()}).strict();
const responseReviewSchema=z.object({regimenVersion:z.number().int().positive(),periodStart:isoDate.nullable(),periodEnd:isoDate.nullable(),reportedAt:isoDateTime,source:nonEmpty,patientAgreement:agreementSchema}).strict();
const orderEvidenceSchema=z.object({orderId:nonEmpty,regimen:nonEmpty,regimenVersion:z.number().int().positive(),prescriber:nonEmpty,authority:z.enum(['manual-attestation','demo-service']),authorizationRef:optionalString,authorizedAt:isoDateTime.optional(),pharmacyReceipt:optionalString,pharmacyReceivedAt:isoDateTime.optional(),dispensingRef:optionalString,dispensedAt:isoDateTime.optional(),clarification:optionalString,actualUse:z.enum(['unknown','not-obtained','declined','started','stopped']),useReportedAt:isoDateTime,useSource:nonEmpty,startedAt:optionalDate,stoppedAt:optionalDate,renewalId:optionalString,followUpDaysAfterStart:z.number().int().min(1).max(365).optional()}).strict();
const accessReviewSchema=z.object({careAction:careActionRefSchema,verification:z.enum(['unverified','estimated','pending','confirmed','denied']),source:nonEmpty,checkedAt:isoDateTime,details:nonEmpty,alternativeDecision:z.enum(['none','pending','approved','declined']),reviewer:optionalString,reviewedAt:isoDateTime.optional(),patientAgreement:agreementSchema,actualStart:z.enum(['unknown','not-started','started','declined']),actualStartAt:optionalDate,actualStartSource:nonEmpty,followUpDaysAfterStart:z.number().int().min(1).max(365).optional()}).strict();
const pendingTransferSchema=z.object({title:nonEmpty,ref:careActionRefSchema,disposition:z.enum(['resolved','accepted-transfer']),owner:nonEmpty,backupOwner:nonEmpty,acceptedAt:isoDateTime,evidenceRef:nonEmpty}).strict();
const handoverEvidenceSchema=z.object({source:sourceEvidenceSchema,patientAccount:nonEmpty,backupOwner:nonEmpty,acceptance:z.enum(['pending','accepted','rejected']),acceptedBy:optionalString,acceptedAt:isoDateTime.optional(),acceptanceEvidence:optionalString,teachBack:optionalString,clarificationOwner:optionalString,pendingTransfers:z.array(pendingTransferSchema),timezone:nonEmpty}).strict();
const interventionReviewSchema=z.object({interventionId:nonEmpty,rationale:nonEmpty,reviewCriterion:nonEmpty,startedAt:optionalDate,stoppedAt:optionalDate,participation:z.enum(['proposed','attended','not-started','declined']),patientAgreement:agreementSchema,reviewDate:isoDate,conflictingAdvice:optionalString,reconciliation:optionalString}).strict();

export type CareActionRef=z.infer<typeof careActionRefSchema>;

export const reconciliationStatuses=['unknown','unreviewed','confirmed-none','declined','resolved'] as const;
export const useStatuses=['unknown','active','stopped','never-started'] as const;
export const benefitStatuses=['unknown','none','partial','helpful'] as const;
export const tolerabilityStatuses=['unknown','tolerated','side-effects','not-discussed'] as const;
export const reassessmentDecisions=['no-change','clinician-authored-alternative','defer','patient-declined'] as const;
export const lifecycleStages=['considered','clinician-review','authorization-recorded','external-transmission-reported','pharmacy-received','clarification-needed','dispensing-reported','started-reported','response-reviewed','continued','changed','stopped','renewal-requested','failed','not-started'] as const;
export const accessBarrierTypes=['cost','coverage','availability','transport','timing','patient-choice'] as const;
export const accessStatuses=['unresolved','resolved','patient-declined'] as const;
export const handoverStatuses=['draft','ownership-pending','instructions-reconciled','patient-communicated','completed'] as const;
export const multidisciplinaryStatuses=['planned','active','blocked','completed','closed'] as const;
export const interventionDecisions=['continue','change','closure'] as const;

const baseActionFields={
  patientId:nonEmpty,
  encounterId:optionalString,
  id:optionalString,
  expectedVersion:z.number().int().positive().optional(),
  requestId:nonEmpty,
  reason:nonEmpty,
  evidenceRef:optionalString,
  owner:optionalString,
  dueDate:optionalDate,
} as const;

const bridgeMedicationSchema=z.object({
  id:nonEmpty,
  name:nonEmpty,
  recordedAt:z.union([isoDate,isoDateTime,z.literal('')]).optional(),
}).strict();

const bridgeSchema=z.object({
  medications:z.array(bridgeMedicationSchema).default([]),
  clinicalContext:z.object({
    recordedAt:z.union([isoDate,isoDateTime,z.literal('')]).optional(),
    summary:optionalString,
  }).strict().optional(),
  integrationStatus:z.enum(['unconfigured','manual-review']).default('unconfigured'),
}).strict();

const reconciliationConflictSchema=z.object({
  field:nonEmpty,
  patientFact:nonEmpty,
  externalFact:nonEmpty,
  outcome:z.enum(['unreviewed','resolved','declined']),
}).strict();

const historySchema=z.object({
  id:nonEmpty,
  at:isoDateTime,
  actor:nonEmpty,
  from:nonEmpty,
  to:nonEmpty,
  reason:nonEmpty,
  evidenceRef:optionalString,
  previousSnapshot:z.string().optional(),
}).strict();

const recordBaseSchema=z.object({
  id:nonEmpty,
  patientId:nonEmpty,
  encounterId:optionalString,
  version:z.number().int().positive(),
  createdAt:isoDateTime,
  updatedAt:isoDateTime,
  createdBy:nonEmpty,
  updatedBy:nonEmpty,
  owner:optionalString,
  dueDate:optionalDate,
  currentStatus:nonEmpty,
  nextActions:z.array(nonEmpty),
  history:z.array(historySchema),
}).strict();

const reconciliationRecordSchema=recordBaseSchema.extend({
  kind:z.literal('reconciliation'),
  source:nonEmpty,
  sourceDate:isoDate,
  status:z.enum(reconciliationStatuses),
  reviewer:optionalString,
  resolution:optionalString,
  conflicts:z.array(reconciliationConflictSchema),
  bridge:bridgeSchema.optional(),
  provenance:provenanceSchema.optional(),
}).strict();

const experienceRecordSchema=recordBaseSchema.extend({
  kind:z.literal('experience'),
  medicationName:nonEmpty,
  reportedUse:z.enum(useStatuses),
  regimen:nonEmpty,
  regimenStartedAt:optionalDate,
  regimenDurationDays:z.number().int().min(0).nullable(),
  reportedBenefit:z.enum(benefitStatuses),
  tolerability:z.enum(tolerabilityStatuses),
  functionalGoal:nonEmpty,
  patientConcern:optionalString,
  trialStatus:z.enum(['active','stopped','never-started']),
  stopDate:optionalDate,
  stopReason:optionalString,
  reassessmentDecision:z.enum(reassessmentDecisions),
  alternativePlan:optionalString,
  responseReview:responseReviewSchema.optional(),
}).strict();

const lifecycleRecordSchema=recordBaseSchema.extend({
  kind:z.literal('lifecycle'),
  medicationName:nonEmpty,
  stage:z.enum(lifecycleStages),
  manualSource:optionalString,
  safetyPrerequisites:z.array(nonEmpty),
  reviewPrerequisites:z.array(nonEmpty),
  prescriberResponsibility:nonEmpty,
  clinicalServiceAvailable:z.boolean(),
  statusNote:optionalString,
  renewalRequested:z.boolean().default(false),
  failureReason:optionalString,
  notStartedReason:optionalString,
  orderEvidence:orderEvidenceSchema.optional(),
}).strict();

const accessRecordSchema=recordBaseSchema.extend({
  kind:z.literal('access'),
  barrierType:z.enum(accessBarrierTypes),
  status:z.enum(accessStatuses),
  patientChoice:nonEmpty,
  outreach:nonEmpty,
  alternatives:optionalString,
  requiresClinicianReview:z.boolean(),
  accessReview:accessReviewSchema.optional(),
  resolution:optionalString,
}).strict();

const transitionRecordSchema=recordBaseSchema.extend({
  kind:z.literal('transition'),
  externalCareSource:nonEmpty,
  previousInstructions:nonEmpty,
  newInstructions:nonEmpty,
  discrepancies:optionalString,
  pendingWork:z.array(nonEmpty),
  resolvedPendingWork:z.array(nonEmpty),
  receivingClinician:nonEmpty,
  ownershipAccepted:z.boolean(),
  reconciledInstructions:optionalString,
  patientCommunication:optionalString,
  handoverStatus:z.enum(handoverStatuses),
  handoverEvidence:handoverEvidenceSchema.optional(),
}).strict();

const multidisciplinaryInterventionSchema=z.object({
  id:nonEmpty,
  title:nonEmpty,
  professional:nonEmpty,
  status:z.enum(multidisciplinaryStatuses),
  accessBarrier:optionalString,
  patientExperience:optionalString,
  observedOutcome:optionalString,
  decision:z.enum(interventionDecisions),
}).strict();

const multidisciplinaryRecordSchema=recordBaseSchema.extend({
  kind:z.literal('multidisciplinary'),
  functionalGoal:nonEmpty,
  interventions:z.array(multidisciplinaryInterventionSchema).min(1),
  interventionReviews:z.array(interventionReviewSchema).optional(),
}).strict();

const receiptSchema=z.object({
  requestId:nonEmpty,
  actionType:nonEmpty,
  fingerprint:z.string().min(1),
  actor:nonEmpty.optional(),
  recordId:nonEmpty,
  version:z.number().int().positive(),
  at:isoDateTime,
}).strict();

export const stateSchema=z.object({
  reconciliations:z.array(reconciliationRecordSchema).default([]),
  experiences:z.array(experienceRecordSchema).default([]),
  lifecycles:z.array(lifecycleRecordSchema).default([]),
  accessBarriers:z.array(accessRecordSchema).default([]),
  transitions:z.array(transitionRecordSchema).default([]),
  multidisciplinary:z.array(multidisciplinaryRecordSchema).default([]),
  receipts:z.array(receiptSchema).default([]),
}).strict();

export type HistoryEntry=z.infer<typeof historySchema>;
export type ReconciliationRecord=z.infer<typeof reconciliationRecordSchema>;
export type ExperienceRecord=z.infer<typeof experienceRecordSchema>;
export type LifecycleRecord=z.infer<typeof lifecycleRecordSchema>;
export type AccessRecord=z.infer<typeof accessRecordSchema>;
export type TransitionRecord=z.infer<typeof transitionRecordSchema>;
export type MultidisciplinaryRecord=z.infer<typeof multidisciplinaryRecordSchema>;
export type State=z.infer<typeof stateSchema>;
export type TreatmentRecord=ReconciliationRecord|ExperienceRecord|LifecycleRecord|AccessRecord|TransitionRecord|MultidisciplinaryRecord;

export function missingRequirements(record:TreatmentRecord):string[]{
  const missing:string[]=[];
  if(!record.owner)missing.push('Assign the responsible owner.');
  if(record.kind==='reconciliation'&&!record.provenance)missing.push('Record both sources and the next reconciliation action.');
  if(record.kind==='experience'&&!record.responseReview)missing.push('Record the response period and patient agreement.');
  if(record.kind==='experience'&&record.reassessmentDecision==='no-change'&&!record.dueDate)missing.push('Set the next treatment review.');
  if(record.kind==='lifecycle'&&!record.orderEvidence)missing.push('Link the exact order and the patient’s actual use.');
  if(record.kind==='access'&&!record.accessReview)missing.push('Link the care action and verify access and actual start.');
  if(record.kind==='transition'&&!record.handoverEvidence)missing.push('Confirm source, backup coverage and accepted pending work.');
  if(record.kind==='multidisciplinary'&&record.interventions.some(item=>!record.interventionReviews?.some(review=>review.interventionId===item.id)))missing.push('Record dates and review criteria for each intervention.');
  return missing;
}

function requireDetail(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(message);}
function validateEvidence(evidence:z.infer<typeof sourceEvidenceSchema>,now:string){
  requireDetail(Date.parse(evidence.receivedAt)<=Date.parse(now),'Source receipt cannot be in the future');
  if(evidence.collectedAt)requireDetail(Date.parse(evidence.collectedAt)<=Date.parse(evidence.receivedAt),'Source receipt cannot precede collection');
}
function validateCareRef(ref:CareActionRef,patientId:string,context:Context){
  const source=context.careActions?.find(item=>item.domain===ref.domain&&item.id===ref.id);
  requireDetail(source&&source.patientId===patientId,'Choose a care action from this patient’s current record');
  requireDetail(source.version===ref.version,'Linked care action changed; review its current version');
}
function validateDetailedRecord(record:TreatmentRecord,prior:TreatmentRecord|undefined,state:State,context:Context){
  const now=Date.parse(context.now),day=context.now.slice(0,10);
  if(record.kind==='reconciliation'&&record.provenance){
    const p=record.provenance;validateEvidence(p.patient,context.now);validateEvidence(p.external,context.now);
    requireDetail(record.owner,'Reconciliation requires a responsible owner');
    if(['unknown','unreviewed'].includes(record.status)||record.conflicts.some(item=>item.outcome==='unreviewed'))requireDetail(record.dueDate,'Unresolved reconciliation requires a next review');
    if(['resolved','confirmed-none'].includes(record.status))requireDetail(p.reviewedBy&&p.reviewedAt&&Date.parse(p.reviewedAt)<=now,'Confirmed facts require an attributed completed review');
  }
  if(record.kind==='experience'&&record.responseReview){
    const r=record.responseReview,previous=prior?.kind==='experience'?prior:undefined;
    requireDetail(Date.parse(r.reportedAt)<=now,'Response report cannot be in the future');
    requireDetail((r.periodStart===null)===(r.periodEnd===null),'Record both response-period dates or leave both unknown');
    if(r.periodStart&&r.periodEnd){requireDetail(r.periodStart<=r.periodEnd&&r.periodEnd<=r.reportedAt.slice(0,10),'Response period must end before its report');if(record.regimenStartedAt)requireDetail(r.periodStart>=record.regimenStartedAt,'Response period belongs to an earlier regimen');if(record.stopDate)requireDetail(r.periodEnd<=record.stopDate,'Response period cannot extend beyond treatment stop');}
    const changed=previous&&(previous.medicationName!==record.medicationName||previous.regimen!==record.regimen||previous.regimenStartedAt!==record.regimenStartedAt);
    if(changed){requireDetail(r.regimenVersion===(previous.responseReview?.regimenVersion??1)+1,'Regimen change requires a new response version');requireDetail(record.reportedBenefit==='unknown'||!!r.periodStart,'Reassess the new regimen before carrying forward a benefit report');if(previous.responseReview)requireDetail(Date.parse(r.reportedAt)>Date.parse(previous.responseReview.reportedAt),'The previous response cannot be reused for a changed regimen');}
    else if(previous?.responseReview)requireDetail(r.regimenVersion===previous.responseReview.regimenVersion,'Response version must match the unchanged regimen');
    if(record.reassessmentDecision==='no-change')requireDetail(r.patientAgreement==='agreed'&&record.owner&&record.dueDate,'Continuation requires patient agreement, owner and next review');
  }
  if(record.kind==='lifecycle'&&record.orderEvidence){
    const o=record.orderEvidence;
    const previous=prior?.kind==='lifecycle'?prior:undefined;
    if(previous?.orderEvidence)requireDetail(record.medicationName===previous.medicationName&&o.orderId===previous.orderEvidence.orderId,'The medication and exact order identity cannot change after order evidence is linked. Create a new medication lifecycle for a different medication or order.');
    requireDetail(Date.parse(o.useReportedAt)<=now,'Actual-use report cannot be in the future');
    for(const date of [o.authorizedAt,o.pharmacyReceivedAt,o.dispensedAt])if(date)requireDetail(Date.parse(date)<=now,'Medication milestone cannot be in the future');
    if(o.pharmacyReceivedAt&&o.authorizedAt)requireDetail(Date.parse(o.pharmacyReceivedAt)>=Date.parse(o.authorizedAt),'Pharmacy receipt cannot precede authorization');
    if(o.dispensedAt&&o.pharmacyReceivedAt)requireDetail(Date.parse(o.dispensedAt)>=Date.parse(o.pharmacyReceivedAt),'Dispensing cannot precede pharmacy receipt');
    const authorized=!['considered','clinician-review','failed','not-started'].includes(record.stage);
    if(authorized)requireDetail(o.authorizationRef&&o.authorizedAt&&record.safetyPrerequisites.length&&record.reviewPrerequisites.length,'Record the exact order authorization, date and required reviews');
    if(previous?.orderEvidence&&o.regimen!==previous.orderEvidence.regimen)requireDetail(o.regimenVersion===previous.orderEvidence.regimenVersion+1&&o.authorizationRef!==previous.orderEvidence.authorizationRef,'A changed order needs a new regimen version and separate authorization');
    if(previous?.stage==='renewal-requested'&&record.stage==='authorization-recorded')requireDetail(o.authorizationRef!==previous.orderEvidence?.authorizationRef,'Renewal requires a separately reviewed authorization; do not reuse the previous order receipt');
    if(authorized&&o.authority==='demo-service'){const authority=context.demoClinicalAuthority;requireDetail(authority?.patientId===record.patientId&&authority.principalId===o.prescriber&&authority.canPrescribe&&authority.scopeSupported,'This demonstration prescriber is not authorized for the selected patient and scope');}
    if(['pharmacy-received','dispensing-reported','started-reported','response-reviewed','continued'].includes(record.stage))requireDetail(o.pharmacyReceipt&&o.pharmacyReceivedAt,'Pharmacy acknowledgement must be recorded separately');
    if(record.stage==='clarification-needed')requireDetail(o.clarification&&record.owner&&record.dueDate,'Pharmacy clarification requires its question, owner and next review');
    if(['dispensing-reported','started-reported','response-reviewed','continued'].includes(record.stage))requireDetail(o.dispensingRef&&o.dispensedAt,'Record dispensing evidence independently of transmission');
    if(['started-reported','response-reviewed','continued'].includes(record.stage))requireDetail(o.actualUse==='started'&&o.startedAt,'Treatment use requires a dated patient report');
    if(o.actualUse==='started')requireDetail(o.startedAt&&o.startedAt<=o.useReportedAt.slice(0,10),'Record the actual start before the use report');
    if(o.actualUse==='stopped')requireDetail(o.stoppedAt&&o.stoppedAt<=o.useReportedAt.slice(0,10),'Stopped use requires its own date');
    if(o.startedAt&&o.dispensedAt)requireDetail(o.startedAt>=o.dispensedAt.slice(0,10),'Actual use of this order cannot precede its dispensing');
    if(o.startedAt&&o.stoppedAt)requireDetail(o.stoppedAt>=o.startedAt,'Actual stop cannot precede actual start');
    if(o.actualUse==='started')requireDetail(!o.stoppedAt,'Current use cannot also have an actual stop date');
    if(['unknown','not-obtained','declined'].includes(o.actualUse))requireDetail(!o.startedAt&&!o.stoppedAt,'Unknown or never-started use cannot contain exposure dates');
    if(record.stage==='renewal-requested')requireDetail(o.renewalId&&record.owner&&record.dueDate,'Renewal requests require a unique request and owned review');
    requireDetail(!state.lifecycles.some(other=>other.id!==record.id&&other.orderEvidence?.orderId===o.orderId&&other.orderEvidence.regimenVersion===o.regimenVersion),'This exact medication order is already recorded');
    if(o.renewalId)requireDetail(!state.lifecycles.some(other=>other.id!==record.id&&other.orderEvidence?.renewalId===o.renewalId),'This renewal request is already recorded');
  }
  if(record.kind==='access'&&record.accessReview){
    const r=record.accessReview;validateCareRef(r.careAction,record.patientId,context);requireDetail(record.owner,'Access follow-up requires an accepted coordinator');
    requireDetail(Date.parse(r.checkedAt)<=now,'Access verification cannot be in the future');
    if(r.alternativeDecision==='approved')requireDetail(r.reviewer&&r.reviewedAt&&Date.parse(r.reviewedAt)<=now&&r.patientAgreement==='agreed','A clinical alternative requires clinician review and patient agreement');
    if(record.status==='resolved'){requireDetail(r.verification==='confirmed','An estimate or pending coverage is not confirmed access');if(record.requiresClinicianReview)requireDetail(r.alternativeDecision==='approved','Clinical alternatives must be reviewed before resolving access');requireDetail(r.actualStart!=='unknown','Confirm actual start or retain owned start follow-up');if(r.actualStart==='not-started')requireDetail(record.dueDate,'Care not yet started requires a next attempt');}
    if(r.actualStart==='started')requireDetail(r.actualStartAt&&r.actualStartAt<=day,'Actual start needs a date and source');
    else requireDetail(!r.actualStartAt,'Do not assign a start date to care that has not started');
  }
  if(record.kind==='transition'&&record.handoverEvidence){
    const e=record.handoverEvidence;validateEvidence(e.source,context.now);
    try{new Intl.DateTimeFormat('en',{timeZone:e.timezone});}catch{throw new Error('Use a valid handover timezone');}
    if(record.ownershipAccepted)requireDetail(e.acceptance==='accepted'&&e.acceptedBy===record.receivingClinician&&e.acceptedAt&&e.acceptanceEvidence,'Receiving ownership requires an attributed acceptance receipt');
    if(e.acceptedAt)requireDetail(Date.parse(e.acceptedAt)<=now,'Ownership acceptance cannot be in the future');
    const references=new Set<string>();
    for(const transfer of e.pendingTransfers){const key=transfer.ref.domain+':'+transfer.ref.id;requireDetail(!references.has(key),'Pending work must not be transferred twice');references.add(key);validateCareRef(transfer.ref,record.patientId,context);requireDetail(Date.parse(transfer.acceptedAt)<=now,'Pending-work acceptance cannot be in the future');}
    if(['patient-communicated','completed'].includes(record.handoverStatus))requireDetail(e.teachBack||e.clarificationOwner,'Record patient understanding or an owned clarification');
    if(record.handoverStatus==='completed')requireDetail(record.pendingWork.every(title=>e.pendingTransfers.some(item=>item.title===title&&item.disposition==='accepted-transfer')),'Every remaining item requires accepted receiving ownership and backup');
  }
  if(record.kind==='multidisciplinary'&&record.interventionReviews){
    requireDetail(new Set(record.interventionReviews.map(item=>item.interventionId)).size===record.interventionReviews.length,'Each intervention needs one review');
    requireDetail(record.interventions.every(item=>record.interventionReviews?.some(review=>review.interventionId===item.id)),'Review every intervention separately');
    for(const review of record.interventionReviews){const item=record.interventions.find(entry=>entry.id===review.interventionId);requireDetail(item,'Review refers to an unknown intervention');if(review.startedAt)requireDetail(review.startedAt<=day,'Intervention start cannot be in the future');if(review.stoppedAt)requireDetail(review.startedAt&&review.stoppedAt>=review.startedAt&&review.stoppedAt<=day,'Intervention stop must follow its start');if(review.participation==='attended')requireDetail(review.startedAt,'Attendance requires an actual participation date');if(['not-started','declined','proposed'].includes(review.participation))requireDetail(!review.startedAt&&!review.stoppedAt,'Proposed or declined care cannot contain attendance dates');if(item.status==='closed'||item.status==='completed'||item.decision==='change')requireDetail(review.patientAgreement!=='not-discussed'&&(!review.conflictingAdvice||review.reconciliation),'Resolve conflicting advice and record patient agreement before completing or changing a component');}
  }
}

export const actionSchema=z.discriminatedUnion('type',[
  z.object({
    type:z.literal('treatment-continuity.record-reconciliation'),
    ...baseActionFields,
    source:nonEmpty,
    sourceDate:isoDate,
    status:z.enum(reconciliationStatuses),
    reviewer:optionalString,
    resolution:optionalString,
    conflicts:z.array(reconciliationConflictSchema),
    bridge:bridgeSchema.optional(),
    provenance:provenanceSchema.optional(),
  }).strict(),
  z.object({
    type:z.literal('treatment-continuity.record-experience'),
    ...baseActionFields,
    medicationName:nonEmpty,
    reportedUse:z.enum(useStatuses),
    regimen:nonEmpty,
    regimenStartedAt:optionalDate,
    regimenDurationDays:z.number().int().min(0).nullable(),
    reportedBenefit:z.enum(benefitStatuses),
    tolerability:z.enum(tolerabilityStatuses),
    functionalGoal:nonEmpty,
    patientConcern:optionalString,
    trialStatus:z.enum(['active','stopped','never-started']),
    stopDate:optionalDate,
    stopReason:optionalString,
    reassessmentDecision:z.enum(reassessmentDecisions),
    alternativePlan:optionalString,
  responseReview:responseReviewSchema.optional(),
  }).strict(),
  z.object({
    type:z.literal('treatment-continuity.update-lifecycle'),
    ...baseActionFields,
    medicationName:nonEmpty,
    stage:z.enum(lifecycleStages),
    manualSource:optionalString,
    safetyPrerequisites:z.array(nonEmpty),
    reviewPrerequisites:z.array(nonEmpty),
    prescriberResponsibility:nonEmpty,
    clinicalServiceAvailable:z.boolean(),
    statusNote:optionalString,
    renewalRequested:z.boolean().default(false),
    failureReason:optionalString,
    notStartedReason:optionalString,
  orderEvidence:orderEvidenceSchema.optional(),
  }).strict(),
  z.object({
    type:z.literal('treatment-continuity.manage-access'),
    ...baseActionFields,
    barrierType:z.enum(accessBarrierTypes),
    status:z.enum(accessStatuses),
    patientChoice:nonEmpty,
    outreach:nonEmpty,
    alternatives:optionalString,
    requiresClinicianReview:z.boolean(),
  accessReview:accessReviewSchema.optional(),
    resolution:optionalString,
  }).strict(),
  z.object({
    type:z.literal('treatment-continuity.record-transition'),
    ...baseActionFields,
    externalCareSource:nonEmpty,
    previousInstructions:nonEmpty,
    newInstructions:nonEmpty,
    discrepancies:optionalString,
    pendingWork:z.array(nonEmpty),
    resolvedPendingWork:z.array(nonEmpty),
    receivingClinician:nonEmpty,
    ownershipAccepted:z.boolean(),
    reconciledInstructions:optionalString,
    patientCommunication:optionalString,
    handoverStatus:z.enum(handoverStatuses),
  handoverEvidence:handoverEvidenceSchema.optional(),
  }).strict(),
  z.object({
    type:z.literal('treatment-continuity.update-multidisciplinary'),
    ...baseActionFields,
    functionalGoal:nonEmpty,
    interventions:z.array(multidisciplinaryInterventionSchema).min(1),
  interventionReviews:z.array(interventionReviewSchema).optional(),
  }).strict(),
]);

export type Action=z.infer<typeof actionSchema>;

const externalLifecycleStages=new Set(['authorization-recorded','external-transmission-reported','dispensing-reported','started-reported']);
const lifecycleTransitions:Record<(typeof lifecycleStages)[number],ReadonlySet<(typeof lifecycleStages)[number]>>={
  considered:new Set(['clinician-review','failed','not-started']),
  'clinician-review':new Set(['authorization-recorded','failed','not-started']),
  'authorization-recorded':new Set(['external-transmission-reported','failed','not-started']),
  'external-transmission-reported':new Set(['pharmacy-received','clarification-needed','dispensing-reported','failed','not-started']),
  'pharmacy-received':new Set(['clarification-needed','dispensing-reported','failed','not-started']),
  'clarification-needed':new Set(['pharmacy-received','failed','not-started']),
  'dispensing-reported':new Set(['started-reported','failed','not-started']),
  'started-reported':new Set(['response-reviewed','failed','not-started']),
  'response-reviewed':new Set(['continued','changed','stopped','renewal-requested']),
  continued:new Set(['renewal-requested','changed','stopped']),
  changed:new Set(['started-reported','response-reviewed','continued','stopped']),
  stopped:new Set(['renewal-requested']),
  'renewal-requested':new Set(['authorization-recorded','continued','changed','stopped','failed']),
  failed:new Set(['considered']),
  'not-started':new Set(['considered','renewal-requested']),
};
const handoverTransitions:Record<(typeof handoverStatuses)[number],ReadonlySet<(typeof handoverStatuses)[number]>>={
  draft:new Set(['ownership-pending']),
  'ownership-pending':new Set(['instructions-reconciled']),
  'instructions-reconciled':new Set(['patient-communicated']),
  'patient-communicated':new Set(['completed']),
  completed:new Set([]),
};

export function initialState():State{
  return {reconciliations:[],experiences:[],lifecycles:[],accessBarriers:[],transitions:[],multidisciplinary:[],receipts:[]};
}

export function validateState(state:unknown):State{
  if(state===undefined||state===null)return initialState();
  const parsed=stateSchema.parse(state);
  for(const records of [parsed.reconciliations,parsed.experiences,parsed.lifecycles,parsed.accessBarriers,parsed.transitions,parsed.multidisciplinary]){
    const ids=new Set<string>();
    for(const record of records){
      if(ids.has(record.id))throw new Error('Duplicate treatment record ID');ids.add(record.id);
      if(record.version!==record.history.length)throw new Error('Record version must match its immutable history');
      const expectedStatus=record.kind==='reconciliation'||record.kind==='access'?record.status:record.kind==='lifecycle'?record.stage:record.kind==='transition'?record.handoverStatus:record.kind==='experience'?(record.trialStatus==='active'?record.reassessmentDecision:record.trialStatus):record.interventions.some(item=>item.status==='blocked')?'blocked':record.interventions.every(item=>['completed','closed'].includes(item.status))?'completed':'active';
      if(record.currentStatus!==expectedStatus)throw new Error('Treatment status does not match its clinical record');
      if(record.history[0]?.to!==record.currentStatus||record.history[0]?.at!==record.updatedAt)throw new Error('Current status and update time must match history');
      if(record.history.at(-1)?.at!==record.createdAt)throw new Error('Creation time must match history');
      const events=new Set<string>();
      for(let i=0;i<record.history.length;i++){
        const entry=record.history[i],prior=record.history[i+1];
        if(events.has(entry.id))throw new Error('Duplicate treatment history event');events.add(entry.id);
        if(prior&&(Date.parse(entry.at)<Date.parse(prior.at)||entry.from!==prior.to))throw new Error('Invalid treatment history chronology');
      }
    }
  }
  if(new Set(parsed.receipts.map(receipt=>receipt.requestId)).size!==parsed.receipts.length)throw new Error('Duplicate treatment request ID');
  return parsed;
}

function ensurePatient(context:Context,patientId:string){
  if(!context.patients.some(patient=>patient.id===patientId))throw new Error(`Unknown patient: ${patientId}`);
}

function normalizeOptional(value?:string){
  return value?.trim()||'';
}

function recordId(action:Pick<Action,'id'|'requestId'>){
  return normalizeOptional(action.id)||action.requestId;
}

function makeFingerprint(action:Action){
  return JSON.stringify(action);
}

function handleIdempotency(state:State,action:Action,actor:string){
  const fingerprint=makeFingerprint(action);
  const prior=state.receipts.find(receipt=>receipt.requestId===action.requestId);
  if(!prior)return {fingerprint};
  const priorActor=prior.actor??[...state.reconciliations,...state.experiences,...state.lifecycles,...state.accessBarriers,...state.transitions,...state.multidisciplinary].find(record=>record.id===prior.recordId)?.history.find(entry=>entry.id===`${prior.recordId}:${action.requestId}`)?.actor;
  if(priorActor!==actor)throw new Error(`Request ${action.requestId} was already used by a different actor`);
  if(prior.fingerprint!==fingerprint)throw new Error(`Request ${action.requestId} was already used for a different payload`);
  return {fingerprint,duplicate:true as const};
}

function addReceipt(state:State,requestId:string,actionType:string,fingerprint:string,recordIdValue:string,version:number,at:string,actor:string){
  state.receipts=[{requestId,actionType,fingerprint,actor,recordId:recordIdValue,version,at},...state.receipts];
}

function requireExpectedVersion<T extends {version:number;patientId:string;updatedAt:string}>(record:T|undefined,action:Pick<Action,'expectedVersion'|'patientId'>,id:string,context:Context){
  if(!record){if(action.expectedVersion!==undefined)throw new Error(`Record ${id} does not exist`);return;}
  if(record.patientId!==action.patientId)throw new Error('Treatment update uses the wrong patient record');
  if(Date.parse(context.now)<Date.parse(record.updatedAt))throw new Error('History time cannot move backwards');
  if(action.expectedVersion===undefined)throw new Error(`Expected version is required to update ${id}`);
  if(action.expectedVersion!==record.version)throw new Error(`Stale update for ${id}: expected version ${record.version}`);
}

function commonRecordFields(action:Action,context:Context,currentStatus:string,nextActions:string[]){
  return {
    id:recordId(action),
    patientId:action.patientId,
    encounterId:normalizeOptional(action.encounterId),
    owner:normalizeOptional(action.owner),
    dueDate:normalizeOptional(action.dueDate),
    currentStatus,
    nextActions,
    updatedAt:context.now,
    updatedBy:context.actor,
  };
}

function createHistory(priorStatus:string|undefined,nextStatus:string,action:Action,context:Context):HistoryEntry{
  return {id:`${recordId(action)}:${action.requestId}`,at:context.now,actor:context.actor,from:priorStatus??'new',to:nextStatus,reason:action.reason,evidenceRef:normalizeOptional(action.evidenceRef)};
}

function nextActionsForReconciliation(status:ReconciliationRecord['status'],conflicts:ReconciliationRecord['conflicts']){
  if(status==='unknown')return ['Confirm the source document and date before acting on these facts.'];
  if(status==='unreviewed')return ['Assign a reviewer and resolve each conflicting fact explicitly.'];
  if(status==='confirmed-none')return ['No discrepancy follow-up is required unless new outside information arrives.'];
  if(status==='declined')return ['Document why reconciliation was declined and schedule follow-up only if the patient requests it.'];
  return conflicts.length?['Carry forward prior versions and review again if source facts change.']:['Resolved without current discrepancies.'];
}

function nextActionsForExperience(action:Extract<Action,{type:'treatment-continuity.record-experience'}>){
  if(action.trialStatus==='never-started')return ['Clarify whether the patient still wants to consider this option before re-entering the lifecycle.'];
  if(action.trialStatus==='stopped')return ['Capture the stop reason in future reviews instead of inferring nonadherence or failure.'];
  if(action.reassessmentDecision==='clinician-authored-alternative')return ['Alternative options need clinician review before becoming the next regimen.'];
  if(action.reassessmentDecision==='patient-declined')return ['Record the decline and revisit only if the patient changes preference.'];
  if(action.reassessmentDecision==='defer')return ['Reassess after new evidence or a regimen change.'];
  return ['Continue documenting benefit, tolerability, goals, and concerns as separate facts.'];
}

function nextActionsForLifecycle(stage:LifecycleRecord['stage'],available:boolean){
  if(!available)return ['Clinical service is unavailable; keep the record local and do not imply prescribing capability.'];
  if(stage==='renewal-requested')return ['Await clinician review before recording any new authorization or external milestone.'];
  if(stage==='failed')return ['Document the failure branch and what follow-up remains.'];
  if(stage==='not-started')return ['Record why treatment was never started rather than inferring adherence.'];
  if(stage==='response-reviewed')return ['Choose continued, changed, or stopped explicitly after review.'];
  if(stage==='dispensing-reported')return ['Dispensing alone does not prove the patient started treatment.'];
  return [`Current stage: ${stage}. Record the next observed milestone manually.`];
}

function nextActionsForAccess(status:AccessRecord['status'],requiresClinicianReview:boolean){
  if(status==='resolved')return ['Keep the follow-up history; resolved access work does not imply pharmacologic success.'];
  if(status==='patient-declined')return ['Respect the patient choice and revisit only with the patient’s agreement.'];
  return [requiresClinicianReview?'Alternative options need clinician review before they replace the current plan.':'Continue outreach until the barrier is resolved or explicitly declined.'];
}

function nextActionsForTransition(status:TransitionRecord['handoverStatus'],pendingWork:string[]){
  if(status==='completed')return ['Handover completed; prior plans remain in history for audit.'];
  return [pendingWork.length?`Pending work: ${pendingWork.join('; ')}`:'Continue the explicit handover steps until completion is recorded.'];
}

function nextActionsForMultidisciplinary(record:Extract<Action,{type:'treatment-continuity.update-multidisciplinary'}>){
  const blocked=record.interventions.filter(intervention=>intervention.status==='blocked');
  if(blocked.length)return [`Resolve blocked access for ${blocked.map(intervention=>intervention.title).join(', ')}.`];
  const changing=record.interventions.filter(intervention=>intervention.decision!=='continue');
  if(changing.length)return ['Confirm the agreed change or closure with the assigned professionals and patient.'];
  return ['Review concurrent non-medication care alongside medication decisions.'];
}

function upsert<T extends {id:string;version:number;createdAt:string;createdBy:string;history:HistoryEntry[];currentStatus:string}>(records:T[],record:T){
  const index=records.findIndex(item=>item.id===record.id);
  if(index>=0)records[index]=record;
  else records.unshift(record);
}

function reduceReconciliation(state:State,action:Extract<Action,{type:'treatment-continuity.record-reconciliation'}>,context:Context,fingerprint:string){
  const id=recordId(action);
  const existing=state.reconciliations.find(record=>record.id===id);
  requireExpectedVersion(existing,action,id,context);
  if(action.sourceDate>context.now.slice(0,10))throw new Error('Source date cannot be in the future');
  if(action.status==='confirmed-none'&&action.conflicts.length)throw new Error('Confirmed none requires zero conflicts');
  if(action.status==='resolved'&&!action.conflicts.length)throw new Error('Resolved reconciliation requires at least one conflict');
  if(action.status==='resolved'&&action.conflicts.some(conflict=>conflict.outcome==='unreviewed'))throw new Error('Resolved reconciliation cannot keep conflicts unreviewed');
  if(['confirmed-none','declined','resolved'].includes(action.status)&&!normalizeOptional(action.resolution))throw new Error('A resolution is required for the selected reconciliation status');
  const status=action.status;
  const history=[createHistory(existing?.currentStatus,status,action,context),...(existing?.history??[])];
  const record:ReconciliationRecord={
    kind:'reconciliation',
    createdAt:existing?.createdAt??context.now,
    createdBy:existing?.createdBy??context.actor,
    version:(existing?.version??0)+1,
    source:action.source,
    sourceDate:action.sourceDate,
    status,
    reviewer:normalizeOptional(action.reviewer),
    resolution:normalizeOptional(action.resolution),
    conflicts:structuredClone(action.conflicts),
    bridge:action.bridge?structuredClone(action.bridge):existing?.bridge,
    provenance:action.provenance?structuredClone(action.provenance):existing?.provenance,
    history,
    ...commonRecordFields(action,context,status,nextActionsForReconciliation(status,action.conflicts)),
  };
  upsert(state.reconciliations,record);
  addReceipt(state,action.requestId,action.type,fingerprint,record.id,record.version,context.now,context.actor);
}

function reduceExperience(state:State,action:Extract<Action,{type:'treatment-continuity.record-experience'}>,context:Context,fingerprint:string){
  const id=recordId(action);
  const existing=state.experiences.find(record=>record.id===id);
  requireExpectedVersion(existing,action,id,context);
  if(action.regimenStartedAt&&action.regimenStartedAt>context.now.slice(0,10))throw new Error('Regimen start cannot be in the future');
  if(action.stopDate&&action.stopDate>context.now.slice(0,10))throw new Error('Stop date cannot be in the future');
  if(action.stopDate&&action.regimenStartedAt&&action.stopDate<action.regimenStartedAt)throw new Error('Stop date cannot precede regimen start');
  if(action.trialStatus==='never-started'&&(action.regimenStartedAt||action.regimenDurationDays!==null&&action.regimenDurationDays!==0))throw new Error('Never-started treatment cannot contain exposure dates or duration');
  if(action.regimenDurationDays!==null&&action.regimenDurationDays<0)throw new Error('Regimen duration cannot be negative');
  if(action.trialStatus==='stopped'&&!normalizeOptional(action.stopDate))throw new Error('Stopped treatment requires a stop date');
  if(action.trialStatus==='stopped'&&!normalizeOptional(action.stopReason))throw new Error('Stopped treatment requires a stop reason');
  if(action.trialStatus==='stopped'&&action.reportedUse==='active')throw new Error('Stopped treatment cannot be reported as active');
  if(action.trialStatus==='never-started'&&action.reportedUse!=='never-started')throw new Error('Never-started trials must stay distinct from active or stopped use');
  if(action.trialStatus==='active'&&['stopped','never-started'].includes(action.reportedUse))throw new Error('Active treatment cannot be recorded as stopped or never-started');
  if(action.trialStatus!=='stopped'&&(normalizeOptional(action.stopDate)||normalizeOptional(action.stopReason)))throw new Error('Stop date and reason are only allowed for stopped treatment');
  if(action.reassessmentDecision==='clinician-authored-alternative'&&!normalizeOptional(action.alternativePlan))throw new Error('Alternative plans must be documented when authored by the clinician');
  const regimenChanged=!!existing&&(
    existing.medicationName!==action.medicationName||
    existing.regimen!==action.regimen||
    existing.regimenStartedAt!==normalizeOptional(action.regimenStartedAt)
  );
  if(regimenChanged&&!normalizeOptional(action.evidenceRef))throw new Error('Regimen changes require reassessment evidence');
  const currentStatus=action.trialStatus==='stopped'?'stopped':action.trialStatus==='never-started'?'never-started':action.reassessmentDecision;
  const history=[createHistory(existing?.currentStatus,currentStatus,action,context),...(existing?.history??[])];
  const record:ExperienceRecord={
    kind:'experience',
    createdAt:existing?.createdAt??context.now,
    createdBy:existing?.createdBy??context.actor,
    version:(existing?.version??0)+1,
    medicationName:action.medicationName,
    reportedUse:action.reportedUse,
    regimen:action.regimen,
    regimenStartedAt:normalizeOptional(action.regimenStartedAt),
    regimenDurationDays:action.regimenDurationDays,
    reportedBenefit:action.reportedBenefit,
    tolerability:action.tolerability,
    functionalGoal:action.functionalGoal,
    patientConcern:normalizeOptional(action.patientConcern),
    trialStatus:action.trialStatus,
    stopDate:normalizeOptional(action.stopDate),
    stopReason:normalizeOptional(action.stopReason),
    reassessmentDecision:action.reassessmentDecision,
    alternativePlan:normalizeOptional(action.alternativePlan),
    responseReview:action.responseReview?structuredClone(action.responseReview):existing?.responseReview,
    history,
    ...commonRecordFields(action,context,currentStatus,nextActionsForExperience(action)),
  };
  upsert(state.experiences,record);
  addReceipt(state,action.requestId,action.type,fingerprint,record.id,record.version,context.now,context.actor);
}

function reduceLifecycle(state:State,action:Extract<Action,{type:'treatment-continuity.update-lifecycle'}>,context:Context,fingerprint:string){
  const id=recordId(action);
  const existing=state.lifecycles.find(record=>record.id===id);
  requireExpectedVersion(existing,action,id,context);
  if(!existing&&action.stage!=='considered')throw new Error('Lifecycle records must start at considered');
  if(existing&&existing.stage!==action.stage&&!lifecycleTransitions[existing.stage].has(action.stage))throw new Error(`Invalid lifecycle transition from ${existing.stage} to ${action.stage}`);
  if(externalLifecycleStages.has(action.stage)&&(!normalizeOptional(action.manualSource)||!normalizeOptional(action.evidenceRef)))throw new Error('External milestones require manual source and evidence');
  if(!action.clinicalServiceAvailable&&!['considered','clinician-review','failed','not-started'].includes(action.stage))throw new Error('Unavailable clinical services cannot progress to external or response stages');
  if(action.stage==='failed'&&!normalizeOptional(action.failureReason))throw new Error('Failed lifecycle branches require a failure reason');
  if(action.stage==='not-started'&&!normalizeOptional(action.notStartedReason))throw new Error('Not-started branches require a reason');
  if(action.stage==='response-reviewed'&&!action.safetyPrerequisites.length)throw new Error('Response review requires recorded safety prerequisites');
  const history=[createHistory(existing?.currentStatus,action.stage,action,context),...(existing?.history??[])];
  const record:LifecycleRecord={
    kind:'lifecycle',
    createdAt:existing?.createdAt??context.now,
    createdBy:existing?.createdBy??context.actor,
    version:(existing?.version??0)+1,
    medicationName:action.medicationName,
    stage:action.stage,
    manualSource:normalizeOptional(action.manualSource),
    safetyPrerequisites:[...action.safetyPrerequisites],
    reviewPrerequisites:[...action.reviewPrerequisites],
    prescriberResponsibility:action.prescriberResponsibility,
    clinicalServiceAvailable:action.clinicalServiceAvailable,
    statusNote:normalizeOptional(action.statusNote),
    renewalRequested:action.renewalRequested,
    failureReason:normalizeOptional(action.failureReason),
    notStartedReason:normalizeOptional(action.notStartedReason),
    orderEvidence:action.orderEvidence?structuredClone(action.orderEvidence):existing?.orderEvidence,
    history,
    ...commonRecordFields(action,context,action.stage,nextActionsForLifecycle(action.stage,action.clinicalServiceAvailable)),
  };
  upsert(state.lifecycles,record);
  addReceipt(state,action.requestId,action.type,fingerprint,record.id,record.version,context.now,context.actor);
}

function reduceAccess(state:State,action:Extract<Action,{type:'treatment-continuity.manage-access'}>,context:Context,fingerprint:string){
  const id=recordId(action);
  const existing=state.accessBarriers.find(record=>record.id===id);
  requireExpectedVersion(existing,action,id,context);
  if(action.status==='unresolved'&&!normalizeOptional(action.dueDate))throw new Error('Unresolved access barriers require a due date');
  if(action.status!=='unresolved'&&!normalizeOptional(action.resolution))throw new Error('Resolved or declined barriers require a resolution');
  if(action.requiresClinicianReview&&!normalizeOptional(action.alternatives))throw new Error('Alternatives requiring clinician review must be documented');
  const history=[createHistory(existing?.currentStatus,action.status,action,context),...(existing?.history??[])];
  const record:AccessRecord={
    kind:'access',
    createdAt:existing?.createdAt??context.now,
    createdBy:existing?.createdBy??context.actor,
    version:(existing?.version??0)+1,
    barrierType:action.barrierType,
    status:action.status,
    patientChoice:action.patientChoice,
    outreach:action.outreach,
    alternatives:normalizeOptional(action.alternatives),
    requiresClinicianReview:action.requiresClinicianReview,
    accessReview:action.accessReview?structuredClone(action.accessReview):existing?.accessReview,
    resolution:normalizeOptional(action.resolution),
    history,
    ...commonRecordFields(action,context,action.status,nextActionsForAccess(action.status,action.requiresClinicianReview)),
  };
  upsert(state.accessBarriers,record);
  addReceipt(state,action.requestId,action.type,fingerprint,record.id,record.version,context.now,context.actor);
}

function reduceTransition(state:State,action:Extract<Action,{type:'treatment-continuity.record-transition'}>,context:Context,fingerprint:string){
  const id=recordId(action);
  const existing=state.transitions.find(record=>record.id===id);
  requireExpectedVersion(existing,action,id,context);
  if(!existing&&action.handoverStatus!=='draft')throw new Error('Transitions must start in draft');
  if(existing&&existing.handoverStatus!==action.handoverStatus&&!handoverTransitions[existing.handoverStatus].has(action.handoverStatus))throw new Error(`Invalid handover transition from ${existing.handoverStatus} to ${action.handoverStatus}`);
  if(['instructions-reconciled','patient-communicated','completed'].includes(action.handoverStatus)&&(!action.ownershipAccepted||!normalizeOptional(action.reconciledInstructions)))throw new Error('Reconciled handovers require accepted ownership and reconciled instructions');
  if(['patient-communicated','completed'].includes(action.handoverStatus)&&!normalizeOptional(action.patientCommunication))throw new Error('Patient communication must be documented before advancing handover');
  if(action.pendingWork.some(item=>action.resolvedPendingWork.includes(item)))throw new Error('Pending work cannot also be marked resolved');
  if((existing?.resolvedPendingWork??[]).some(item=>!action.resolvedPendingWork.includes(item)))throw new Error('Resolved pending work cannot disappear from history');
  const previousPending=new Set(existing?.pendingWork??[]);
  const currentPending=new Set(action.pendingWork);
  const removed=[...previousPending].filter(item=>!currentPending.has(item));
  if(removed.some(item=>!action.resolvedPendingWork.includes(item)))throw new Error('Pending work cannot disappear without explicit resolution');
  if(action.handoverStatus==='completed'&&(!action.ownershipAccepted||!normalizeOptional(action.reconciledInstructions)||!normalizeOptional(action.patientCommunication)||(action.pendingWork.length&&!action.handoverEvidence)))throw new Error('Completed handovers require accepted ownership, reconciled instructions, patient communication, and no pending work');
  const history=[createHistory(existing?.currentStatus,action.handoverStatus,action,context),...(existing?.history??[])];
  const record:TransitionRecord={
    kind:'transition',
    createdAt:existing?.createdAt??context.now,
    createdBy:existing?.createdBy??context.actor,
    version:(existing?.version??0)+1,
    externalCareSource:action.externalCareSource,
    previousInstructions:action.previousInstructions,
    newInstructions:action.newInstructions,
    discrepancies:normalizeOptional(action.discrepancies),
    pendingWork:[...action.pendingWork],
    resolvedPendingWork:[...action.resolvedPendingWork],
    receivingClinician:action.receivingClinician,
    ownershipAccepted:action.ownershipAccepted,
    reconciledInstructions:normalizeOptional(action.reconciledInstructions),
    patientCommunication:normalizeOptional(action.patientCommunication),
    handoverStatus:action.handoverStatus,
    handoverEvidence:action.handoverEvidence?structuredClone(action.handoverEvidence):existing?.handoverEvidence,
    history,
    ...commonRecordFields(action,context,action.handoverStatus,nextActionsForTransition(action.handoverStatus,action.pendingWork)),
  };
  upsert(state.transitions,record);
  addReceipt(state,action.requestId,action.type,fingerprint,record.id,record.version,context.now,context.actor);
}

function reduceMultidisciplinary(state:State,action:Extract<Action,{type:'treatment-continuity.update-multidisciplinary'}>,context:Context,fingerprint:string){
  const id=recordId(action);
  const existing=state.multidisciplinary.find(record=>record.id===id);
  requireExpectedVersion(existing,action,id,context);
  if(new Set(action.interventions.map(item=>item.id)).size!==action.interventions.length)throw new Error('Intervention IDs must be unique');
  if(action.interventions.some(item=>item.status==='blocked'&&!normalizeOptional(item.accessBarrier)))throw new Error('Blocked interventions require an access barrier');
  if((existing?.interventions??[]).some(item=>!action.interventions.some(next=>next.id===item.id)))throw new Error('Existing interventions cannot disappear; record closure explicitly');
  const transitions:Record<string,string[]>={planned:['active','blocked','completed','closed'],active:['blocked','completed','closed'],blocked:['active','completed','closed'],completed:['closed'],closed:[]};
  for(const item of action.interventions){const prior=existing?.interventions.find(entry=>entry.id===item.id);if(prior&&prior.status!==item.status&&!transitions[prior.status].includes(item.status))throw new Error(`Invalid intervention transition from ${prior.status} to ${item.status}`);}
  const currentStatus=action.interventions.some(intervention=>intervention.status==='blocked')?'blocked':action.interventions.every(intervention=>['completed','closed'].includes(intervention.status))?'completed':'active';
  const history=[createHistory(existing?.currentStatus,currentStatus,action,context),...(existing?.history??[])];
  const record:MultidisciplinaryRecord={
    kind:'multidisciplinary',
    createdAt:existing?.createdAt??context.now,
    createdBy:existing?.createdBy??context.actor,
    version:(existing?.version??0)+1,
    functionalGoal:action.functionalGoal,
    interventions:structuredClone(action.interventions),
    interventionReviews:action.interventionReviews?structuredClone(action.interventionReviews):existing?.interventionReviews,
    history,
    ...commonRecordFields(action,context,currentStatus,nextActionsForMultidisciplinary(action)),
  };
  upsert(state.multidisciplinary,record);
  addReceipt(state,action.requestId,action.type,fingerprint,record.id,record.version,context.now,context.actor);
}

export function reduce(state:State,unknownAction:Action,context:Context):State{
  const action=actionSchema.parse(unknownAction);
  ensurePatient(context,action.patientId);
  isoDateTime.parse(context.now);
  if(!context.actor.trim())throw new Error('Context actor is required');
  const current=validateState(state);
  const idempotency=handleIdempotency(current,action,context.actor);
  if('duplicate' in idempotency)return current;
  const next=structuredClone(current);
  switch(action.type){
    case 'treatment-continuity.record-reconciliation':
      reduceReconciliation(next,action,context,idempotency.fingerprint);
      break;
    case 'treatment-continuity.record-experience':
      reduceExperience(next,action,context,idempotency.fingerprint);
      break;
    case 'treatment-continuity.update-lifecycle':
      reduceLifecycle(next,action,context,idempotency.fingerprint);
      break;
    case 'treatment-continuity.manage-access':
      reduceAccess(next,action,context,idempotency.fingerprint);
      break;
    case 'treatment-continuity.record-transition':
      reduceTransition(next,action,context,idempotency.fingerprint);
      break;
    case 'treatment-continuity.update-multidisciplinary':
      reduceMultidisciplinary(next,action,context,idempotency.fingerprint);
      break;
    default:
      return next;
  }
  for(const collection of ['reconciliations','experiences','lifecycles','accessBarriers','transitions','multidisciplinary'] as const){
    for(const record of next[collection]){
      const prior=current[collection].find(item=>item.id===record.id);
      if(!prior||record.version>prior.version)validateDetailedRecord(record,prior,next,context);
      if(prior&&record.version>prior.version)record.history[0].previousSnapshot=JSON.stringify({...prior,history:undefined});
    }
  }
  return validateState(next);
}

export function getSummary(state:State,patientId?:string,now=new Date().toISOString()){
  const current=validateState(state);
  const records=[...current.reconciliations,...current.experiences,...current.lifecycles,...current.accessBarriers,...current.transitions,...current.multidisciplinary]
    .filter(record=>!patientId||record.patientId===patientId);
  const openRecords=records.filter(record=>missingRequirements(record).length>0||!['resolved','confirmed-none','completed','closed','continued','stopped','declined','patient-declined','failed','not-started','never-started'].includes(record.currentStatus));
  const today=now.slice(0,10);
  const overdueRecords=openRecords.filter(record=>normalizeOptional(record.dueDate).length>0&&normalizeOptional(record.dueDate)<today);
  const attention=records.flatMap(record=>[...missingRequirements(record),...record.nextActions.slice(0,1)]);
  return {open:openRecords.length,overdue:overdueRecords.length,attention:Array.from(new Set(attention)).slice(0,6)};
}
