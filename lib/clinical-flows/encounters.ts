import {z} from 'zod';

const idSchema=z.string().trim().min(1).max(200);
const shortTextSchema=z.string().trim().min(1).max(500);
const mediumTextSchema=z.string().trim().min(1).max(2000);
const optionalTextSchema=z.string().trim().max(6000);
const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>!Number.isNaN(Date.parse(`${value}T12:00:00Z`))&&new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value,'Invalid date');
const timeSchema=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/,'Invalid time');
const timestampSchema=z.string().datetime({offset:true});
const timezoneSchema=z.string().trim().min(1).max(100).refine(value=>{
  try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}
},'Use a valid timezone such as UTC or America/New_York.');

const patientSchema=z.object({id:idSchema,name:z.string().trim().min(1).max(200)}).strict();
const workRefSchema=z.object({id:shortTextSchema,revision:z.string().min(1).max(20000)}).strict();
const careDependencySchema=z.object({
  id:shortTextSchema,kind:shortTextSchema,patientId:idSchema,encounterId:idSchema.optional(),
  title:mediumTextSchema,owner:z.string().max(500),dueAt:z.string().max(500),revision:z.string().min(1).max(20000),
  sourceId:idSchema,acceptedOwner:shortTextSchema.optional(),
}).strict();
const receivingWorkSchema=careDependencySchema.extend({priority:z.enum(['high','routine']).optional(),fallbackOwner:z.string().max(500).optional(),coverageExpectation:z.string().max(2000).optional(),status:z.string().max(100).optional()}).strict();
const sourceTimeSchema=z.union([timestampSchema,dateSchema]);
const evidenceObservationSchema=z.object({
  recordId:idSchema,entryId:idSchema,version:z.number().int().positive(),metric:z.enum(['pain','function','sleep']),
  status:z.enum(['answered','zero','unanswered','declined']),value:z.number().int().min(0).max(10).optional(),
  recordedAt:sourceTimeSchema,source:shortTextSchema,
}).strict().superRefine((entry,ctx)=>{
  if((entry.status==='answered'&&entry.value===undefined)||(entry.status==='zero'&&entry.value!==0)||(['unanswered','declined'].includes(entry.status)&&entry.value!==undefined))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Source response and value must agree.'});
});
const reviewEvidenceSchema=z.object({
  patientId:idSchema,capturedAt:timestampSchema,
  goal:z.object({text:z.string().max(2000),recordedAt:sourceTimeSchema.optional(),sourceRef:idSchema.optional()}).strict(),
  observations:z.array(evidenceObservationSchema),pendingWork:z.array(workRefSchema.extend({title:mediumTextSchema}).strict()),
}).strict();
export type CareDependency=z.infer<typeof careDependencySchema>;
export type ReceivingWork=z.infer<typeof receivingWorkSchema>;
export type ReviewEvidence=z.infer<typeof reviewEvidenceSchema>;
const contextSchema=z.object({
  actor:idSchema,
  now:timestampSchema,
  patients:z.array(patientSchema),
  features:z.record(z.boolean()),
  receivingWork:z.array(receivingWorkSchema).optional(),
  closureDependencies:z.array(careDependencySchema).optional(),
  reviewEvidence:reviewEvidenceSchema.optional(),
}).strict();

export type Context=z.infer<typeof contextSchema>;

const historyEntrySchema=z.object({
  id:idSchema,
  at:timestampSchema,
  actor:idSchema,
  from:z.string().trim().max(100),
  to:z.string().trim().max(100),
  reason:mediumTextSchema,
  evidenceRef:idSchema.optional(),
}).strict();

type HistoryEntry=z.infer<typeof historyEntrySchema>;

const receiptSchema=z.object({
  requestId:idSchema,
  actionType:idSchema,
  fingerprint:z.string().min(2),
  recordedAt:timestampSchema,
  actor:idSchema.optional(),
}).strict();

type Receipt=z.infer<typeof receiptSchema>;

const sourceDatesSchema=z.array(dateSchema).max(12);
const listSchema=z.array(shortTextSchema).max(20);
const stringSetSchema=z.array(shortTextSchema).max(20).refine(values=>new Set(values.map(value=>value.toLowerCase())).size===values.length,'Duplicate values are not allowed.');

const baseRecordShape={
  id:idSchema,
  patientId:idSchema,
  encounterId:idSchema,
  version:z.number().int().min(1),
  createdAt:timestampSchema,
  updatedAt:timestampSchema,
  history:z.array(historyEntrySchema),
};

const pendingWorkItemSchema=z.object({
  title:shortTextSchema,
  owner:optionalTextSchema.max(200),
  dueDate:dateSchema.optional(),
  disposition:z.enum(['pending','deferred','done']),
}).strict();

const preparationStatusSchema=z.enum(['draft','prepared','clinician-reviewed']);
const preparationRecordSchema=z.object({
  ...baseRecordShape,
  status:preparationStatusSchema,
  reasonForVisit:mediumTextSchema,
  changesSinceLastReviewedEncounter:optionalTextSchema,
  sourceDates:sourceDatesSchema,
  preparationOwner:shortTextSchema,
  openQuestions:listSchema,
  missingInputs:listSchema,
  patientGoal:mediumTextSchema,
  reviewNeeded:z.boolean(),
  latestInformation:optionalTextSchema,
  reviewEvidence:reviewEvidenceSchema.optional(),
  reviewHistory:z.array(reviewEvidenceSchema).optional(),
}).strict();

export type PreparationRecord=z.infer<typeof preparationRecordSchema>;

const intakeStatusSchema=z.enum(['draft','ready-for-baseline','enrolled','declined']);
const readinessSchema=z.enum(['ready','needs-clarification','declined','unanswered']);
const intakeRecordSchema=z.object({
  ...baseRecordShape,
  status:intakeStatusSchema,
  sourceHistory:mediumTextSchema,
  medicationsReconciliationReference:optionalTextSchema,
  goals:listSchema,
  consentReadiness:readinessSchema,
  accessReadiness:readinessSchema,
  unansweredFields:stringSetSchema,
  declinedFields:stringSetSchema,
  coordinatorClarification:optionalTextSchema,
  baselineReviewed:z.boolean(),
  enrollmentDecision:z.enum(['pending','enroll','defer','decline']),
  syntheticEvaluation:z.boolean(),
  finalDiagnosis:optionalTextSchema,
}).strict();

export type IntakeRecord=z.infer<typeof intakeRecordSchema>;

const assessmentStatusSchema=z.enum(['draft','deferred','urgent-review','completed','out-of-scope']);
const assessmentRouteSchema=z.enum(['continue-local','defer','longer-review','urgent-review','out-of-scope']);
const assessmentRecordSchema=z.object({
  ...baseRecordShape,
  status:assessmentStatusSchema,
  presentingProblem:mediumTextSchema,
  painDistributionPhenotype:optionalTextSchema,
  timeline:optionalTextSchema,
  relevantExamination:optionalTextSchema,
  comorbidContext:optionalTextSchema,
  psychologicalContext:optionalTextSchema,
  socialContext:optionalTextSchema,
  workingAssessment:mediumTextSchema,
  alternatives:listSchema,
  supportingFindings:listSchema,
  refutingFindings:listSchema,
  uncertainty:mediumTextSchema,
  furtherWorkup:optionalTextSchema,
  route:assessmentRouteSchema,
  deferReason:optionalTextSchema,
}).strict();

export type AssessmentRecord=z.infer<typeof assessmentRecordSchema>;

const observationStatusSchema=z.enum(['draft','confirmed']);
const observationRecordStatusSchema=z.enum(['draft','confirmed','withdrawn']);
const observationValueStatusSchema=z.enum(['answered','unanswered','declined','zero']);
const observationEntrySchema=z.object({
  id:idSchema,
  metric:z.enum(['pain','function','sleep']),
  status:observationValueStatusSchema,
  value:z.number().int().min(0).max(10).optional(),
  source:shortTextSchema,
  recordedAt:timestampSchema,
  correctedFromEntryId:idSchema.optional(),
}).strict().superRefine((entry,ctx)=>{
  if(entry.status==='answered'&&entry.value===undefined)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Answered observations require a value.',path:['value']});
  if(entry.status==='zero'&&entry.value!==0)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Zero observations must record a value of 0.',path:['value']});
  if((entry.status==='unanswered'||entry.status==='declined')&&entry.value!==undefined)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Unanswered or declined observations cannot include a value.',path:['value']});
});

export type ObservationEntry=z.infer<typeof observationEntrySchema>;

const observationRecordSchema=z.object({
  ...baseRecordShape,
  status:observationRecordStatusSchema,
  instrument:z.literal('local-0-10'),
  currentEntries:z.array(observationEntrySchema),
  entries:z.array(observationEntrySchema),
  patientNote:z.string().max(2000).optional(),
  submissionSource:z.literal('patient-self-report').optional(),
  withdrawal:z.object({reason:mediumTextSchema,actor:idSchema,at:timestampSchema}).strict().optional(),
}).strict();

export type ObservationRecord=z.infer<typeof observationRecordSchema>;

const dispositionListSchema=z.array(shortTextSchema).max(20);
const signoffStatusSchema=z.enum(['draft','reviewed','signed']);
const signoffAdditionalShape={
  planKind:z.enum(['definitive','interim']).optional(),
  receivingWorkRef:workRefSchema.optional(),patientFallback:mediumTextSchema.optional(),
  teachBackOutcome:z.enum(['not-checked','understood','needs-clarification','declined']).optional(),
  clarification:z.object({owner:shortTextSchema,dueAt:timestampSchema,question:mediumTextSchema}).strict().optional(),
};
const signoffDispositionSchema=z.object({
  selected:dispositionListSchema,
  rejected:dispositionListSchema,
  deferred:dispositionListSchema,
  noChange:z.boolean(),
}).strict().superRefine((value,ctx)=>{
  const seen=new Map<string,string>();
  for(const [bucket,items] of Object.entries({selected:value.selected,rejected:value.rejected,deferred:value.deferred})){
    for(const item of items){
      const key=item.toLowerCase();
      const prior=seen.get(key);
      if(prior)ctx.addIssue({code:z.ZodIssueCode.custom,message:`Disposition "${item}" cannot appear in both ${prior} and ${bucket}.`});
      else seen.set(key,bucket);
    }
  }
  if(!value.noChange&&value.selected.length===0&&value.rejected.length===0&&value.deferred.length===0){
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'Record at least one selected, rejected, deferred, or no-change disposition.'});
  }
});
const followUpSchema=z.object({
  date:dateSchema,
  time:timeSchema,
  timezone:timezoneSchema,
  appointmentBooked:z.boolean(),
}).strict();
const followUpActionSchema=z.object({
  date:dateSchema,
  time:timeSchema,
  timezone:timezoneSchema,
}).strict();
const bridgeSchema=z.object({
  carePlanKey:idSchema,
  noteKey:idSchema,
  taskKeys:z.array(idSchema),
  companionKey:idSchema,
  assessmentVersion:z.number().int().min(1),
  observationVersion:z.number().int().min(1).optional(),
  deliveryStatus:z.enum(['pending','delivered','acknowledged','manual-report']),
  planFingerprint:idSchema,
}).strict();
const signoffSnapshotSchema=z.object({
  ...signoffAdditionalShape,
  assessmentRecordId:idSchema,
  rationale:mediumTextSchema,
  patientFacingPlan:mediumTextSchema,
  disposition:signoffDispositionSchema,
  owner:shortTextSchema,
  followUp:followUpSchema,
  pendingWork:z.array(pendingWorkItemSchema),
  teachBack:mediumTextSchema,
  bridge:bridgeSchema,
  assessmentSnapshot:assessmentRecordSchema,
  observationSnapshot:observationRecordSchema.optional(),
  receivingWorkSnapshot:receivingWorkSchema.optional(),
  reviewEvidence:reviewEvidenceSchema.optional(),
}).strict();
const signoffRecordSchema=z.object({
  ...baseRecordShape,
  ...signoffAdditionalShape,
  status:signoffStatusSchema,
  assessmentRecordId:idSchema,
  rationale:mediumTextSchema,
  patientFacingPlan:mediumTextSchema,
  disposition:signoffDispositionSchema,
  owner:shortTextSchema,
  followUp:followUpSchema,
  pendingWork:z.array(pendingWorkItemSchema),
  teachBack:mediumTextSchema,
  bridge:bridgeSchema,
  signedSnapshot:signoffSnapshotSchema.optional(),
  amendedFromId:idSchema.optional(),
  amendmentReason:mediumTextSchema.optional(),
  reviewEvidence:reviewEvidenceSchema.optional(),
}).strict();

export type SignoffRecord=z.infer<typeof signoffRecordSchema>;

const episodeStatusSchema=z.enum(['draft','reviewed','closed']);
const episodeDecisionSchema=z.enum(['continue','change','maintenance','transfer','closure']);
const episodeReviewRecordSchema=z.object({
  ...baseRecordShape,
  status:episodeStatusSchema,
  goalEvidence:mediumTextSchema,
  observedOutcomes:mediumTextSchema,
  priorInterventions:optionalTextSchema,
  ongoingInterventions:optionalTextSchema,
  patientExperience:mediumTextSchema,
  remainingConcerns:listSchema,
  decision:episodeDecisionSchema,
  pendingWorkDisposition:optionalTextSchema,
  pendingWorkOwner:optionalTextSchema.max(200),
  reviewEvidence:reviewEvidenceSchema.optional(),
  closureSnapshot:z.object({actor:idSchema,at:timestampSchema,dependencies:z.array(careDependencySchema)}).strict().optional(),
}).strict();

export type EpisodeReviewRecord=z.infer<typeof episodeReviewRecordSchema>;

const stateSchema=z.object({
  preparations:z.array(preparationRecordSchema),
  intakes:z.array(intakeRecordSchema),
  assessments:z.array(assessmentRecordSchema),
  observations:z.array(observationRecordSchema),
  signoffs:z.array(signoffRecordSchema),
  episodes:z.array(episodeReviewRecordSchema),
  receipts:z.array(receiptSchema).max(200),
}).strict();

export type State=z.infer<typeof stateSchema>;

const baseActionShape={requestId:idSchema,patientId:idSchema,encounterId:idSchema};
const versionedActionShape={...baseActionShape,expectedVersion:z.number().int().min(1)};

const observationInputSchema=z.object({
  metric:z.enum(['pain','function','sleep']),
  status:observationValueStatusSchema,
  value:z.number().int().min(0).max(10).optional(),
  source:shortTextSchema,
  recordedAt:timestampSchema,
}).strict().superRefine((entry,ctx)=>{
  if(entry.status==='answered'&&entry.value===undefined)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Answered observations require a value.',path:['value']});
  if(entry.status==='zero'&&entry.value!==0)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Zero observations must record a value of 0.',path:['value']});
  if((entry.status==='unanswered'||entry.status==='declined')&&entry.value!==undefined)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Unanswered or declined observations cannot include a value.',path:['value']});
});

const observationInputsSchema=z.array(observationInputSchema).min(1).max(3).superRefine((entries,ctx)=>{
  if(new Set(entries.map(entry=>entry.metric)).size!==entries.length){
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'Each observation metric can appear only once per submission.'});
  }
});

export const actionSchema=z.discriminatedUnion('type',[
  z.object({
    type:z.literal('encounters.preparation.save'),
    ...baseActionShape,
    expectedVersion:z.number().int().min(1).optional(),
    reasonForVisit:mediumTextSchema,
    changesSinceLastReviewedEncounter:optionalTextSchema,
    sourceDates:sourceDatesSchema,
    preparationOwner:shortTextSchema,
    openQuestions:listSchema,
    missingInputs:listSchema,
    patientGoal:mediumTextSchema,
    status:preparationStatusSchema,
    newInformation:optionalTextSchema.optional(),
  }).strict(),
  z.object({
    type:z.literal('encounters.intake.save'),
    ...baseActionShape,
    expectedVersion:z.number().int().min(1).optional(),
    sourceHistory:mediumTextSchema,
    medicationsReconciliationReference:optionalTextSchema,
    goals:listSchema,
    consentReadiness:readinessSchema,
    accessReadiness:readinessSchema,
    unansweredFields:stringSetSchema,
    declinedFields:stringSetSchema,
    coordinatorClarification:optionalTextSchema,
    baselineReviewed:z.boolean(),
    enrollmentDecision:z.enum(['pending','enroll','defer','decline']),
    syntheticEvaluation:z.boolean(),
    finalDiagnosis:optionalTextSchema,
  }).strict(),
  z.object({
    type:z.literal('encounters.assessment.save'),
    ...baseActionShape,
    expectedVersion:z.number().int().min(1).optional(),
    presentingProblem:mediumTextSchema,
    painDistributionPhenotype:optionalTextSchema,
    timeline:optionalTextSchema,
    relevantExamination:optionalTextSchema,
    comorbidContext:optionalTextSchema,
    psychologicalContext:optionalTextSchema,
    socialContext:optionalTextSchema,
    workingAssessment:mediumTextSchema,
    alternatives:listSchema,
    supportingFindings:listSchema,
    refutingFindings:listSchema,
    uncertainty:mediumTextSchema,
    furtherWorkup:optionalTextSchema,
    route:assessmentRouteSchema,
    deferReason:optionalTextSchema,
  }).strict(),
  z.object({
    type:z.literal('encounters.observations.save'),
    ...baseActionShape,
    expectedVersion:z.number().int().min(1).optional(),
    instrument:z.string().trim().min(1).max(100),
    submissionStatus:observationStatusSchema,
    entries:observationInputsSchema,
    patientNote:z.string().trim().max(2000).optional(),
    submissionSource:z.literal('patient-self-report').optional(),
    correctionReason:mediumTextSchema.optional(),
  }).strict(),
  z.object({
    type:z.literal('encounters.observations.correct'),
    ...versionedActionShape,
    reason:mediumTextSchema,
    replacement:observationInputSchema,
  }).strict(),
  z.object({
    type:z.literal('encounters.observations.withdraw'),...versionedActionShape,id:idSchema,reason:mediumTextSchema,
  }).strict(),
  z.object({
    type:z.literal('encounters.signoff.saveDraft'),
    ...baseActionShape,
    ...signoffAdditionalShape,
    expectedVersion:z.number().int().min(1).optional(),
    assessmentRecordId:idSchema,
    rationale:mediumTextSchema,
    patientFacingPlan:mediumTextSchema,
    disposition:signoffDispositionSchema,
    owner:shortTextSchema,
    followUp:followUpActionSchema,
    pendingWork:z.array(pendingWorkItemSchema).max(20),
    teachBack:mediumTextSchema,
  }).strict(),
  z.object({
    type:z.literal('encounters.signoff.review'),
    ...versionedActionShape,
    id:idSchema,
    reason:mediumTextSchema,
  }).strict(),
  z.object({
    type:z.literal('encounters.signoff.sign'),
    ...versionedActionShape,
    id:idSchema,
    reason:mediumTextSchema,
  }).strict(),
  z.object({
    type:z.literal('encounters.signoff.amend'),
    ...versionedActionShape,
    ...signoffAdditionalShape,
    id:idSchema,
    amendmentReason:mediumTextSchema,
    rationale:mediumTextSchema.optional(),
    patientFacingPlan:mediumTextSchema.optional(),
    disposition:signoffDispositionSchema.optional(),
    owner:shortTextSchema.optional(),
    followUp:followUpActionSchema.optional(),
    pendingWork:z.array(pendingWorkItemSchema).max(20).optional(),
    teachBack:mediumTextSchema.optional(),
  }).strict(),
  z.object({
    type:z.literal('encounters.episode.save'),
    ...baseActionShape,
    expectedVersion:z.number().int().min(1).optional(),
    goalEvidence:mediumTextSchema,
    observedOutcomes:mediumTextSchema,
    priorInterventions:optionalTextSchema,
    ongoingInterventions:optionalTextSchema,
    patientExperience:mediumTextSchema,
    remainingConcerns:listSchema,
    decision:episodeDecisionSchema,
    pendingWorkDisposition:optionalTextSchema,
    pendingWorkOwner:optionalTextSchema.max(200),
    status:z.enum(['draft','reviewed']),
  }).strict(),
  z.object({
    type:z.literal('encounters.episode.close'),
    ...versionedActionShape,
    id:idSchema,
    reason:mediumTextSchema,
  }).strict(),
]);

export type Action=z.infer<typeof actionSchema>;

export function initialState():State{
  return {preparations:[],intakes:[],assessments:[],observations:[],signoffs:[],episodes:[],receipts:[]};
}

export function validateState(state:unknown):State{
  if(state===undefined||state===null)return initialState();
  const parsed=stateSchema.parse(state);
  const collections=[parsed.preparations,parsed.intakes,parsed.assessments,parsed.observations,parsed.signoffs,parsed.episodes];
  const ids=new Set<string>();
  for(const records of collections){
    const encounters=new Set<string>();
    for(const record of records){
      if(ids.has(record.id))throw new Error('Duplicate encounter record id.');
      ids.add(record.id);
      const key=JSON.stringify([record.patientId,record.encounterId]);
      if(records!==parsed.signoffs&&encounters.has(key))throw new Error('Duplicate record for this patient encounter.');
      encounters.add(key);
      if(Date.parse(record.updatedAt)<Date.parse(record.createdAt))throw new Error('Encounter history cannot move backwards in time.');
      let previous=Date.parse(record.createdAt);
      for(const event of record.history){
        const at=Date.parse(event.at);
        if(at<previous||at>Date.parse(record.updatedAt))throw new Error('Encounter history must remain chronological.');
        previous=at;
      }
    }
  }
  if(new Set(parsed.receipts.map(item=>item.requestId)).size!==parsed.receipts.length)throw new Error('Duplicate encounter request receipt.');
  for(const record of parsed.observations){
    if((record.status==='withdrawn')!==Boolean(record.withdrawal))throw new Error('Withdrawn observations require their attributed withdrawal record.');
    if(record.withdrawal&&(record.withdrawal.at!==record.updatedAt||record.history.at(-1)?.to!=='withdrawn'||record.history.at(-1)?.actor!==record.withdrawal.actor||record.history.at(-1)?.reason!==record.withdrawal.reason))throw new Error('Observation withdrawal must match its recorded history.');
    if(new Set(record.entries.map(item=>item.id)).size!==record.entries.length)throw new Error('Duplicate observation entry.');
    if(new Set(record.currentEntries.map(item=>item.metric)).size!==record.currentEntries.length)throw new Error('Duplicate current observation metric.');
    for(const entry of record.currentEntries){
      const saved=record.entries.find(item=>item.id===entry.id);
      if(!saved||JSON.stringify(saved)!==JSON.stringify(entry))throw new Error('Current observation must match its saved history.');
    }
    const seen=new Map<string,ObservationEntry>();
    for(const entry of record.entries){
      if(Date.parse(entry.recordedAt)>Date.parse(record.updatedAt))throw new Error('Observation time cannot be after its saved time.');
      if(entry.correctedFromEntryId){
        const prior=seen.get(entry.correctedFromEntryId);
        if(!prior||prior.metric!==entry.metric)throw new Error('Observation correction must reference earlier history for the same metric.');
      }
      seen.set(entry.id,entry);
    }
  }
  const amendedIds=new Set<string>();
  const originalEncounters=new Set<string>();
  for(const record of parsed.signoffs){
    const assessment=parsed.assessments.find(item=>item.id===record.assessmentRecordId&&item.patientId===record.patientId&&item.encounterId===record.encounterId);
    if(!assessment)throw new Error('Sign-off assessment must belong to the same patient encounter.');
    if(record.amendedFromId){
      const prior=parsed.signoffs.find(item=>item.id===record.amendedFromId);
      if(!prior||prior.status!=='signed'||prior.patientId!==record.patientId||prior.encounterId!==record.encounterId||Date.parse(prior.updatedAt)>Date.parse(record.createdAt))throw new Error('Amendment must reference the signed encounter it revises.');
      if(amendedIds.has(prior.id))throw new Error('Parallel amendments are not allowed.');
      amendedIds.add(prior.id);
      if(!record.amendmentReason)throw new Error('Amendments require a reason.');
    }else{
      const key=JSON.stringify([record.patientId,record.encounterId]);
      if(originalEncounters.has(key))throw new Error('Duplicate original sign-off for this encounter.');
      originalEncounters.add(key);
    }
    if(record.status==='signed'){
      if(!record.signedSnapshot)throw new Error('Signed encounters require an immutable snapshot.');
      const {assessmentSnapshot,observationSnapshot,receivingWorkSnapshot,...snapshot}=record.signedSnapshot;
      if(JSON.stringify(snapshot)!==JSON.stringify(signoffSnapshotFields(record)))throw new Error('Signed encounter content must match its immutable snapshot.');
      if(assessmentSnapshot.id!==record.assessmentRecordId||assessmentSnapshot.patientId!==record.patientId||assessmentSnapshot.encounterId!==record.encounterId||assessmentSnapshot.version!==record.bridge.assessmentVersion)throw new Error('Signed assessment evidence does not match the encounter.');
      if(Boolean(observationSnapshot)!==Boolean(record.bridge.observationVersion))throw new Error('Signed observations require their immutable evidence snapshot.');
      if(observationSnapshot&&(observationSnapshot.patientId!==record.patientId||observationSnapshot.encounterId!==record.encounterId||observationSnapshot.version!==record.bridge.observationVersion))throw new Error('Signed observation evidence does not match the encounter.');
      if(receivingWorkSnapshot&&(receivingWorkSnapshot.patientId!==record.patientId||receivingWorkSnapshot.id!==record.receivingWorkRef?.id||receivingWorkSnapshot.revision!==record.receivingWorkRef?.revision))throw new Error('Signed receiving work does not match its reviewed reference.');
      if(record.planKind==='interim'&&!receivingWorkSnapshot)throw new Error('An interim signature requires the reviewed receiving work.');
    }else if(record.signedSnapshot){
      throw new Error('Unsigned encounters cannot contain a signed snapshot.');
    }
  }
  for(const record of [...parsed.preparations,...parsed.signoffs,...parsed.episodes]){
    if(record.reviewEvidence&&(record.reviewEvidence.patientId!==record.patientId||Date.parse(record.reviewEvidence.capturedAt)>Date.parse(record.updatedAt)))throw new Error('Reviewed sources must belong to this patient and precede the saved review.');
  }
  for(const record of parsed.preparations){
    if(record.reviewHistory?.some(evidence=>evidence.patientId!==record.patientId||Date.parse(evidence.capturedAt)>Date.parse(record.updatedAt)))throw new Error('Earlier reviewed sources must remain attributed to this patient.');
  }
  for(const record of parsed.episodes){
    if(record.closureSnapshot&&(record.status!=='closed'||record.closureSnapshot.at!==record.updatedAt||record.closureSnapshot.dependencies.some(item=>item.patientId!==record.patientId||!item.acceptedOwner)))throw new Error('Episode closure must retain its accepted work and closing event.');
  }
  for(const record of parsed.signoffs){
    const ancestors=new Set<string>([record.id]);
    let ancestor=record.amendedFromId;
    while(ancestor){
      if(ancestors.has(ancestor))throw new Error('Amendment history cannot contain a cycle.');
      ancestors.add(ancestor);
      ancestor=parsed.signoffs.find(item=>item.id===ancestor)?.amendedFromId;
    }
  }
  return parsed;
}

const nonTerminalPreparationStatuses=new Set<PreparationRecord['status']>(['draft','prepared']);
const nonTerminalAssessmentStatuses=new Set<AssessmentRecord['status']>(['draft','deferred','urgent-review']);

function ensurePatient(ctx:Context,patientId:string){
  if(!ctx.patients.some(patient=>patient.id===patientId))throw new Error(`Patient ${patientId} not found in launch context.`);
}

function assertVersion(expectedVersion:number|undefined,actualVersion:number|undefined){
  if(actualVersion===undefined){
    if(expectedVersion!==undefined)throw new Error('This record does not exist yet.');
    return;
  }
  if(expectedVersion===undefined)throw new Error('expectedVersion is required for updates.');
  if(expectedVersion!==actualVersion)throw new Error('This record changed in another session. Reload before saving again.');
}

function ensureChronology(now:string,date?:string){
  if(date&&date>now.slice(0,10))throw new Error('Dates cannot be in the future.');
}

function ensureObservationChronology(now:string,recordedAt:string){
  if(Date.parse(recordedAt)>Date.parse(now))throw new Error('Observation time cannot be in the future.');
}

function signoffAdditionalFields(record:Pick<SignoffRecord,'planKind'|'receivingWorkRef'|'patientFallback'|'teachBackOutcome'|'clarification'>){
  return {planKind:record.planKind,receivingWorkRef:record.receivingWorkRef,patientFallback:record.patientFallback,teachBackOutcome:record.teachBackOutcome,clarification:record.clarification};
}

function signoffSnapshotFields(record:SignoffRecord){
  return {
    ...signoffAdditionalFields(record),
    assessmentRecordId:record.assessmentRecordId,rationale:record.rationale,patientFacingPlan:record.patientFacingPlan,
    disposition:record.disposition,owner:record.owner,followUp:record.followUp,pendingWork:record.pendingWork,
    teachBack:record.teachBack,bridge:record.bridge,reviewEvidence:record.reviewEvidence,
  };
}

function latestSignoffs(records:readonly SignoffRecord[]){
  const superseded=new Set(records.map(item=>item.amendedFromId).filter(Boolean));
  return records.filter(item=>!superseded.has(item.id));
}

function assertSignoffEvidence(state:State,record:SignoffRecord,ctx:Context){
  const assessment=state.assessments.find(item=>item.id===record.assessmentRecordId&&item.patientId===record.patientId&&item.encounterId===record.encounterId);
  const observation=findByEncounter(state.observations,record.patientId,record.encounterId);
  if(!assessment||assessment.version!==record.bridge.assessmentVersion||observation?.version!==record.bridge.observationVersion)throw new Error('Assessment or observations changed. Save and review the latest encounter draft before signing.');
  let receivingWork:ReceivingWork|undefined;
  if(record.planKind==='interim'){
    receivingWork=ctx.receivingWork?.find(item=>item.id===record.receivingWorkRef?.id&&item.patientId===record.patientId);
    if(!receivingWork||receivingWork.revision!==record.receivingWorkRef?.revision)throw new Error('Select current receiving work for this patient before reviewing the interim plan.');
    if(receivingWork.encounterId&&receivingWork.encounterId!==record.encounterId)throw new Error('Receiving work belongs to a different encounter.');
    if(!receivingWork.owner.trim()||!receivingWork.dueAt.trim()||!record.patientFallback?.trim())throw new Error('Interim plans require a receiving owner, due time and patient fallback instructions.');
    if(assessment.status==='urgent-review'&&(receivingWork.kind!=='handoff'||receivingWork.priority!=='high'||!receivingWork.fallbackOwner?.trim()||!receivingWork.coverageExpectation?.trim()))throw new Error('Urgent interim plans require a high-priority human handoff with coverage and a fallback owner.');
  }else{
    if(record.receivingWorkRef||record.patientFallback)throw new Error('Receiving work and fallback instructions belong to an interim plan.');
    if(assessment.status!=='completed')throw new Error('Complete the assessment or choose an interim plan with owned receiving work before sign-off.');
  }
  if(observation&&observation.status==='draft')throw new Error('Confirm observations before clinical sign-off.');
  if(record.teachBackOutcome==='needs-clarification'&&!record.clarification)throw new Error('Assign clarification to an owner with a due time and the question to resolve.');
  if(record.teachBackOutcome!=='needs-clarification'&&record.clarification)throw new Error('Clarification work requires a needs-clarification outcome.');
  if(record.reviewEvidence&&!ctx.reviewEvidence)throw new Error('Patient sources are unavailable. Reload before reviewing or signing.');
  if(record.reviewEvidence&&ctx.reviewEvidence&&reviewEvidenceRevision(record.reviewEvidence)!==reviewEvidenceRevision(ctx.reviewEvidence))throw new Error('Patient sources changed. Save and review the latest encounter draft before signing.');
  if(findByEncounter(state.preparations,record.patientId,record.encounterId)?.reviewNeeded)throw new Error('Review the new preparation information before clinical sign-off.');
  if(new Set(record.pendingWork.map(item=>item.title.toLowerCase())).size!==record.pendingWork.length)throw new Error('Each pending work item must have a distinct title.');
  if(record.pendingWork.some(item=>item.disposition!=='done'&&!item.owner))throw new Error('Assign an owner to pending or deferred work before clinical sign-off.');
  return {assessment,observation,receivingWork};
}

function trustedReviewEvidence(ctx:Context,patientId:string){
  const evidence=ctx.reviewEvidence;if(!evidence)return undefined;
  if(evidence.patientId!==patientId||Date.parse(evidence.capturedAt)>Date.parse(ctx.now))throw new Error('Reviewed sources must match the patient and server time.');
  for(const item of evidence.observations){if(item.recordedAt.length===10?item.recordedAt>ctx.now.slice(0,10):Date.parse(item.recordedAt)>Date.parse(ctx.now))throw new Error('Reviewed observation sources cannot be in the future.');}
  return structuredClone(evidence);
}

export function reviewEvidenceRevision(evidence:ReviewEvidence){
  return stableHash(JSON.stringify({patientId:evidence.patientId,goal:evidence.goal,observations:[...evidence.observations].sort((a,b)=>a.recordId.localeCompare(b.recordId)||a.entryId.localeCompare(b.entryId)),pendingWork:[...evidence.pendingWork].sort((a,b)=>a.id.localeCompare(b.id))}));
}

/** The three columns retain their own sources, collection times and missing responses. */
export function getSourceComparison(state:State,patientId:string,current?:ReviewEvidence){
  const prior=[...state.preparations.filter(row=>row.patientId===patientId).flatMap(row=>[...(row.reviewHistory??[]),...(row.status==='clinician-reviewed'&&row.reviewEvidence?[row.reviewEvidence]:[])]),
    ...[...state.signoffs.filter(row=>row.status==='signed'),...state.episodes.filter(row=>row.status==='reviewed'||row.status==='closed')].filter(row=>row.patientId===patientId&&row.reviewEvidence).map(row=>row.reviewEvidence!)]
    .sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt))[0];
  const evidence=current?.patientId===patientId?current:undefined;
  const select=(rows:ReviewEvidence['observations'],metric:'pain'|'function'|'sleep',latest:boolean)=>[...rows].filter(row=>row.metric===metric).sort((a,b)=>(latest?-1:1)*(Date.parse(a.recordedAt)-Date.parse(b.recordedAt))||b.version-a.version)[0];
  return {current:evidence,lastReviewed:prior,metrics:(['pain','function','sleep'] as const).map(metric=>({metric,baseline:select(evidence?.observations??[],metric,false),lastReviewed:select(prior?.observations??[],metric,true),current:select(evidence?.observations??[],metric,true)}))};
}

function trimList(values:readonly string[]){
  return values.map(value=>value.trim()).filter(Boolean);
}

function pushHistory(history:readonly HistoryEntry[],ctx:Context,from:string,to:string,reason:string,evidenceRef?:string):HistoryEntry[]{
  return [...history,{
    id:crypto.randomUUID(),
    at:ctx.now,
    actor:ctx.actor,
    from,
    to,
    reason,
    ...(evidenceRef?{evidenceRef}:{})
  }];
}

function withReceipt(state:State,action:Action,ctx:Context):State{
  const fingerprint=JSON.stringify(action);
  const receipt:Receipt={requestId:action.requestId,actionType:action.type,fingerprint,recordedAt:ctx.now,actor:ctx.actor};
  return {...state,receipts:[receipt,...state.receipts.filter(existing=>existing.requestId!==action.requestId)].slice(0,200)};
}

function enforceIdempotency(state:State,action:Action,ctx:Context){
  const fingerprint=JSON.stringify(action);
  const prior=state.receipts.find(receipt=>receipt.requestId===action.requestId);
  if(!prior)return false;
  if(prior.actor!==ctx.actor)throw new Error('This request ID belongs to another actor or predates verified actor binding.');
  if(prior.actionType===action.type&&prior.fingerprint===fingerprint)return true;
  throw new Error(`Request ${action.requestId} has already been used for a different payload.`);
}

function recordId(prefix:string,patientId:string,encounterId:string){
  return `${prefix}:${patientId}:${encounterId}`;
}

function stableHash(value:string){
  let hash=5381;
  for(let index=0;index<value.length;index+=1){
    hash=((hash<<5)+hash)^value.charCodeAt(index);
  }
  return Math.abs(hash).toString(16);
}

function bridgeForSignoff(signoff:{
  patientId:string;
  encounterId:string;
  patientFacingPlan:string;
  disposition:{
    selected:readonly string[];
    rejected:readonly string[];
    deferred:readonly string[];
    noChange:boolean;
  };
  pendingWork:readonly z.infer<typeof pendingWorkItemSchema>[];
  rationale:string;
  owner:string;
  followUp:z.infer<typeof followUpActionSchema>;
  teachBack:string;
  assessmentVersion:number;
  observationVersion?:number;
  planKind?:SignoffRecord['planKind'];receivingWorkRef?:SignoffRecord['receivingWorkRef'];patientFallback?:string;
  teachBackOutcome?:SignoffRecord['teachBackOutcome'];clarification?:SignoffRecord['clarification'];
}){
  const planFingerprint=`bridge:${signoff.patientId}:${signoff.encounterId}:${stableHash(JSON.stringify({
    patientFacingPlan:signoff.patientFacingPlan,
    ...signoffAdditionalFields(signoff),
    rationale:signoff.rationale,owner:signoff.owner,followUp:signoff.followUp,teachBack:signoff.teachBack,
    assessmentVersion:signoff.assessmentVersion,observationVersion:signoff.observationVersion,
    disposition:{
      selected:[...signoff.disposition.selected].sort(),
      rejected:[...signoff.disposition.rejected].sort(),
      deferred:[...signoff.disposition.deferred].sort(),
      noChange:signoff.disposition.noChange,
    },
    pendingWork:[...signoff.pendingWork].map(item=>({...item})).sort((left,right)=>left.title.localeCompare(right.title)||left.owner.localeCompare(right.owner)||String(left.dueDate??'').localeCompare(String(right.dueDate??''))||left.disposition.localeCompare(right.disposition)),
  }))}`;
  return {
    carePlanKey:`careplan:${signoff.patientId}:${signoff.encounterId}`,
    noteKey:`note:${signoff.patientId}:${signoff.encounterId}`,
    taskKeys:signoff.pendingWork.map(item=>`task:${signoff.patientId}:${signoff.encounterId}:${stableHash(item.title.trim().toLowerCase())}`),
    companionKey:`companion:${signoff.patientId}`,
    assessmentVersion:signoff.assessmentVersion,
    ...(signoff.observationVersion?{observationVersion:signoff.observationVersion}:{}),
    deliveryStatus:'pending' as const,
    planFingerprint,
  };
}

function replaceById<T extends {id:string}>(items:readonly T[],next:T){
  const index=items.findIndex(item=>item.id===next.id);
  if(index<0)return [...items,next];
  return [...items.slice(0,index),next,...items.slice(index+1)];
}

function findByEncounter<T extends {patientId:string;encounterId:string}>(items:readonly T[],patientId:string,encounterId:string){
  return items.find(item=>item.patientId===patientId&&item.encounterId===encounterId);
}

function toAssessmentStatus(route:AssessmentRecord['route']):AssessmentRecord['status']{
  switch(route){
    case 'defer':
    case 'longer-review': return 'deferred';
    case 'urgent-review': return 'urgent-review';
    case 'out-of-scope': return 'out-of-scope';
    default: return 'completed';
  }
}

function summaryAttention(state:State,patientId?:string){
  const attention:string[]=[];
  const filter=<T extends {patientId:string}>(items:readonly T[])=>patientId?items.filter(item=>item.patientId===patientId):items;
  for(const item of filter(state.preparations)){
    if(item.reviewNeeded)attention.push(`Preparation needs re-review for ${item.encounterId}`);
  }
  for(const item of filter(state.assessments)){
    if(item.status==='urgent-review')attention.push(`Urgent assessment review for ${item.encounterId}`);
    if(item.status==='out-of-scope')attention.push(`Assessment deferred out of scope for ${item.encounterId}`);
  }
  for(const item of latestSignoffs(filter(state.signoffs))){
    if(item.status!=='signed')attention.push(`Encounter sign-off pending for ${item.encounterId}`);
    if(item.teachBackOutcome==='needs-clarification')attention.push(`Patient clarification is assigned to ${item.clarification?.owner??'an owner still to be confirmed'} for ${item.encounterId}`);
  }
  for(const item of filter(state.episodes)){
    if(item.decision==='closure'&&item.status!=='closed')attention.push(`Episode closure still open for ${item.encounterId}`);
  }
  return attention.slice(0,20);
}

export function getSummary(state:State,patientId?:string,now=new Date().toISOString()){
  const validated=validateState(state);
  const today=now.slice(0,10);
  const matches=<T extends {patientId:string}>(items:readonly T[])=>patientId?items.filter(item=>item.patientId===patientId):items;
  const open=
    matches(validated.preparations).filter(item=>nonTerminalPreparationStatuses.has(item.status)||item.reviewNeeded).length+
    matches(validated.intakes).filter(item=>item.status!=='enrolled'&&item.status!=='declined').length+
    matches(validated.assessments).filter(item=>nonTerminalAssessmentStatuses.has(item.status)).length+
    matches(validated.observations).filter(item=>item.status==='draft').length+
    latestSignoffs(matches(validated.signoffs)).filter(item=>item.status!=='signed').length+
    matches(validated.episodes).filter(item=>item.status!=='closed').length;
  const overdue=
    latestSignoffs(matches(validated.signoffs)).filter(item=>item.status!=='signed'&&item.followUp.date<today).length+
    latestSignoffs(matches(validated.signoffs)).flatMap(item=>item.pendingWork).filter(item=>item.disposition==='pending'&&item.dueDate!==undefined&&item.dueDate<today).length;
  return {open,overdue,attention:summaryAttention(validated,patientId)};
}

export function reduce(state:State,action:Action,context:Context):State{
  const current=validateState(state);
  const parsedAction=actionSchema.parse(action);
  const ctx=contextSchema.parse(context);
  ensurePatient(ctx,parsedAction.patientId);
  if(enforceIdempotency(current,parsedAction,ctx))return current;
  const encounterRecords=[...current.preparations,...current.intakes,...current.assessments,...current.observations,...current.signoffs,...current.episodes].filter(item=>item.patientId===parsedAction.patientId&&item.encounterId===parsedAction.encounterId);
  if(encounterRecords.some(item=>Date.parse(item.updatedAt)>Date.parse(ctx.now)))throw new Error('Encounter updates cannot move backwards in time.');
  const closedEpisode=findByEncounter(current.episodes,parsedAction.patientId,parsedAction.encounterId);
  if(closedEpisode?.status==='closed'&&!['encounters.observations.correct','encounters.observations.withdraw','encounters.signoff.amend','encounters.signoff.saveDraft','encounters.signoff.review','encounters.signoff.sign'].includes(parsedAction.type))throw new Error('This episode is closed. Start a new encounter or amend the signed record.');

  let next=current;

  switch(parsedAction.type){
    case 'encounters.preparation.save':{
      parsedAction.sourceDates.forEach(value=>ensureChronology(ctx.now,value));
      const existing=findByEncounter(current.preparations,parsedAction.patientId,parsedAction.encounterId);
      assertVersion(parsedAction.expectedVersion,existing?.version);
      const newInformation=parsedAction.newInformation?.trim()??'';
      const latestInformation=newInformation?`${existing?.latestInformation?`${existing.latestInformation}\n`:''}${newInformation}`:existing?.latestInformation??'';
      const reviewNeeded=Boolean(newInformation)||(Boolean(existing?.reviewNeeded)&&parsedAction.status!=='clinician-reviewed');
      const status=reviewNeeded?'prepared':parsedAction.status;
      const reason=existing?reviewNeeded?'Last-minute information requires another review.':'Preparation updated.':'Preparation started.';
      const reviewEvidence=status==='clinician-reviewed'?trustedReviewEvidence(ctx,parsedAction.patientId):existing?.reviewEvidence;
      const reviewHistory=[...(existing?.reviewHistory??[])];
      if(existing?.status==='clinician-reviewed'&&existing.reviewEvidence&&(!reviewEvidence||existing.reviewEvidence.capturedAt!==reviewEvidence.capturedAt||status!=='clinician-reviewed'))reviewHistory.push(structuredClone(existing.reviewEvidence));
      const record:PreparationRecord={
        id:existing?.id??recordId('preparation',parsedAction.patientId,parsedAction.encounterId),
        patientId:parsedAction.patientId,
        encounterId:parsedAction.encounterId,
        version:(existing?.version??0)+1,
        createdAt:existing?.createdAt??ctx.now,
        updatedAt:ctx.now,
        status,
        reasonForVisit:parsedAction.reasonForVisit,
        changesSinceLastReviewedEncounter:parsedAction.changesSinceLastReviewedEncounter,
        sourceDates:[...parsedAction.sourceDates],
        preparationOwner:parsedAction.preparationOwner,
        openQuestions:trimList(parsedAction.openQuestions),
        missingInputs:trimList(parsedAction.missingInputs),
        patientGoal:parsedAction.patientGoal,
        reviewNeeded,
        latestInformation,
        ...(reviewEvidence?{reviewEvidence}:{}),...(reviewHistory.length?{reviewHistory}:{}),
        history:pushHistory(existing?.history??[],ctx,existing?.status??'new',status,reason),
      };
      next={...current,preparations:replaceById(current.preparations,record)};
      break;
    }
    case 'encounters.intake.save':{
      const existing=findByEncounter(current.intakes,parsedAction.patientId,parsedAction.encounterId);
      assertVersion(parsedAction.expectedVersion,existing?.version);
      if(parsedAction.enrollmentDecision==='enroll'&&!parsedAction.baselineReviewed)throw new Error('Baseline review is required before enrollment.');
      if(parsedAction.enrollmentDecision==='enroll'&&(parsedAction.consentReadiness!=='ready'||parsedAction.accessReadiness!=='ready'))throw new Error('Consent and access readiness must be confirmed before enrollment.');
      const unanswered=new Set(parsedAction.unansweredFields.map(value=>value.toLowerCase()));
      if(parsedAction.declinedFields.some(value=>unanswered.has(value.toLowerCase())))throw new Error('An intake field cannot be both declined and unanswered.');
      const status: IntakeRecord['status']=parsedAction.enrollmentDecision==='enroll'?'enrolled':parsedAction.enrollmentDecision==='decline'?'declined':parsedAction.consentReadiness==='ready'&&parsedAction.accessReadiness==='ready'?'ready-for-baseline':'draft';
      const record:IntakeRecord={
        id:existing?.id??recordId('intake',parsedAction.patientId,parsedAction.encounterId),
        patientId:parsedAction.patientId,
        encounterId:parsedAction.encounterId,
        version:(existing?.version??0)+1,
        createdAt:existing?.createdAt??ctx.now,
        updatedAt:ctx.now,
        status,
        sourceHistory:parsedAction.sourceHistory,
        medicationsReconciliationReference:parsedAction.medicationsReconciliationReference,
        goals:trimList(parsedAction.goals),
        consentReadiness:parsedAction.consentReadiness,
        accessReadiness:parsedAction.accessReadiness,
        unansweredFields:trimList(parsedAction.unansweredFields),
        declinedFields:trimList(parsedAction.declinedFields),
        coordinatorClarification:parsedAction.coordinatorClarification,
        baselineReviewed:parsedAction.baselineReviewed,
        enrollmentDecision:parsedAction.enrollmentDecision,
        syntheticEvaluation:parsedAction.syntheticEvaluation,
        finalDiagnosis:parsedAction.finalDiagnosis,
        history:pushHistory(existing?.history??[],ctx,existing?.status??'new',status,existing?'Intake updated.':'Intake started.'),
      };
      next={...current,intakes:replaceById(current.intakes,record)};
      break;
    }
    case 'encounters.assessment.save':{
      const existing=findByEncounter(current.assessments,parsedAction.patientId,parsedAction.encounterId);
      assertVersion(parsedAction.expectedVersion,existing?.version);
      const supporting=new Set(parsedAction.supportingFindings.map(value=>value.toLowerCase()));
      const conflict=parsedAction.refutingFindings.find(value=>supporting.has(value.toLowerCase()));
      if(conflict)throw new Error(`Finding "${conflict}" cannot both support and refute the same assessment.`);
      if(parsedAction.route!=='continue-local'&&!parsedAction.deferReason)throw new Error('Record a reason for deferral, urgent review, or an out-of-scope route.');
      const status=toAssessmentStatus(parsedAction.route);
      const record:AssessmentRecord={
        id:existing?.id??recordId('assessment',parsedAction.patientId,parsedAction.encounterId),
        patientId:parsedAction.patientId,
        encounterId:parsedAction.encounterId,
        version:(existing?.version??0)+1,
        createdAt:existing?.createdAt??ctx.now,
        updatedAt:ctx.now,
        status,
        presentingProblem:parsedAction.presentingProblem,
        painDistributionPhenotype:parsedAction.painDistributionPhenotype,
        timeline:parsedAction.timeline,
        relevantExamination:parsedAction.relevantExamination,
        comorbidContext:parsedAction.comorbidContext,
        psychologicalContext:parsedAction.psychologicalContext,
        socialContext:parsedAction.socialContext,
        workingAssessment:parsedAction.workingAssessment,
        alternatives:trimList(parsedAction.alternatives),
        supportingFindings:trimList(parsedAction.supportingFindings),
        refutingFindings:trimList(parsedAction.refutingFindings),
        uncertainty:parsedAction.uncertainty,
        furtherWorkup:parsedAction.furtherWorkup,
        route:parsedAction.route,
        deferReason:parsedAction.deferReason,
        history:pushHistory(existing?.history??[],ctx,existing?.status??'new',status,existing?'Assessment updated.':'Assessment started.'),
      };
      next={...current,assessments:replaceById(current.assessments,record)};
      break;
    }
    case 'encounters.observations.save':{
      if(parsedAction.instrument!=='local-0-10')throw new Error('Only local 0-10 self-reports are supported until approved instruments are supplied.');
      const existing=findByEncounter(current.observations,parsedAction.patientId,parsedAction.encounterId);
      assertVersion(parsedAction.expectedVersion,existing?.version);
      if(existing?.status==='withdrawn')throw new Error('This observation was withdrawn. Record a new report in a new encounter; the original remains in history.');
      parsedAction.entries.forEach(entry=>ensureObservationChronology(ctx.now,entry.recordedAt));
      if(existing?.status==='confirmed'&&!parsedAction.correctionReason)throw new Error('Confirmed observations require a correction reason. The original values remain in history.');
      if(existing?.status==='confirmed'&&parsedAction.submissionStatus!=='confirmed')throw new Error('Confirmed observations cannot return to draft.');
      const createdEntries:ObservationEntry[]=parsedAction.entries.map(entry=>{
        const prior=existing?.currentEntries.find(currentEntry=>currentEntry.metric===entry.metric);
        return {
          id:crypto.randomUUID(),
          metric:entry.metric,
          status:entry.value===0?'zero':entry.status,
          ...(entry.value!==undefined?{value:entry.value}:{}),
          source:entry.source,
          recordedAt:entry.recordedAt,
          ...(prior?{correctedFromEntryId:prior.id}:{}),
        };
      });
      const nextCurrentEntries=[
        ...(existing?.currentEntries.filter(currentEntry=>!createdEntries.some(entry=>entry.metric===currentEntry.metric))??[]),
        ...createdEntries,
      ].sort((left,right)=>left.metric.localeCompare(right.metric));
      const record:ObservationRecord={
        id:existing?.id??recordId('observations',parsedAction.patientId,parsedAction.encounterId),
        patientId:parsedAction.patientId,
        encounterId:parsedAction.encounterId,
        version:(existing?.version??0)+1,
        createdAt:existing?.createdAt??ctx.now,
        updatedAt:ctx.now,
        status:parsedAction.submissionStatus,
        instrument:'local-0-10',
        currentEntries:nextCurrentEntries,
        entries:[...(existing?.entries??[]),...createdEntries],
        ...(parsedAction.patientNote!==undefined?{patientNote:parsedAction.patientNote}:existing?.patientNote!==undefined?{patientNote:existing.patientNote}:{}),
        ...(parsedAction.submissionSource?{submissionSource:parsedAction.submissionSource}:existing?.submissionSource?{submissionSource:existing.submissionSource}:{}),
        history:pushHistory(existing?.history??[],ctx,existing?.status??'new',parsedAction.submissionStatus,parsedAction.correctionReason??(parsedAction.submissionStatus==='draft'?'Observation draft saved.':'Observation submission confirmed.')),
      };
      next={...current,observations:replaceById(current.observations,record)};
      break;
    }
    case 'encounters.observations.correct':{
      const existing=findByEncounter(current.observations,parsedAction.patientId,parsedAction.encounterId);
      if(!existing)throw new Error('Observation record not found.');
      assertVersion(parsedAction.expectedVersion,existing.version);
      if(existing.status==='withdrawn')throw new Error('Withdrawn observations cannot be corrected or restored. Record a new report.');
      ensureObservationChronology(ctx.now,parsedAction.replacement.recordedAt);
      const prior=existing.currentEntries.find(entry=>entry.metric===parsedAction.replacement.metric);
      if(!prior)throw new Error(`No ${parsedAction.replacement.metric} observation exists to correct.`);
      const replacement:ObservationEntry={
        id:crypto.randomUUID(),
        metric:parsedAction.replacement.metric,
        status:parsedAction.replacement.value===0?'zero':parsedAction.replacement.status,
        ...(parsedAction.replacement.value!==undefined?{value:parsedAction.replacement.value}:{}),
        source:parsedAction.replacement.source,
        recordedAt:parsedAction.replacement.recordedAt,
        correctedFromEntryId:prior.id,
      };
      const record:ObservationRecord={
        ...existing,
        version:existing.version+1,
        updatedAt:ctx.now,
        status:'confirmed',
        currentEntries:existing.currentEntries.map(entry=>entry.metric===replacement.metric?replacement:entry),
        entries:[...existing.entries,replacement],
        history:pushHistory(existing.history,ctx,existing.status,'confirmed',parsedAction.reason,prior.id),
      };
      next={...current,observations:replaceById(current.observations,record)};
      break;
    }
    case 'encounters.observations.withdraw':{
      const existing=current.observations.find(item=>item.id===parsedAction.id&&item.patientId===parsedAction.patientId&&item.encounterId===parsedAction.encounterId);
      if(!existing)throw new Error('Observation record not found for this patient and encounter.');
      assertVersion(parsedAction.expectedVersion,existing.version);
      if(existing.status!=='confirmed')throw new Error('Only a confirmed observation can be withdrawn.');
      const record:ObservationRecord={...existing,status:'withdrawn',version:existing.version+1,updatedAt:ctx.now,withdrawal:{reason:parsedAction.reason,actor:ctx.actor,at:ctx.now},history:pushHistory(existing.history,ctx,existing.status,'withdrawn',parsedAction.reason,existing.id)};
      next={...current,observations:replaceById(current.observations,record)};
      break;
    }
    case 'encounters.signoff.saveDraft':{
      const assessment=current.assessments.find(item=>item.id===parsedAction.assessmentRecordId&&item.patientId===parsedAction.patientId&&item.encounterId===parsedAction.encounterId);
      if(!assessment)throw new Error('Assessment record not found for this encounter.');
      const observation=current.observations.find(item=>item.patientId===parsedAction.patientId&&item.encounterId===parsedAction.encounterId);
      const existing=latestSignoffs(current.signoffs).find(item=>item.patientId===parsedAction.patientId&&item.encounterId===parsedAction.encounterId);
      if(existing?.status==='signed')throw new Error('Signed encounter records are immutable. Create an amendment instead.');
      assertVersion(parsedAction.expectedVersion,existing?.version);
      const bridge=bridgeForSignoff({
        ...signoffAdditionalFields(parsedAction),
        patientId:parsedAction.patientId,
        encounterId:parsedAction.encounterId,
        patientFacingPlan:parsedAction.patientFacingPlan,
        disposition:parsedAction.disposition,
        pendingWork:parsedAction.pendingWork,
        rationale:parsedAction.rationale,owner:parsedAction.owner,followUp:parsedAction.followUp,teachBack:parsedAction.teachBack,
        assessmentVersion:assessment.version,
        observationVersion:observation?.version,
      });
      const record:SignoffRecord={
        ...signoffAdditionalFields(parsedAction),
        id:existing?.id??recordId('signoff',parsedAction.patientId,parsedAction.encounterId),
        patientId:parsedAction.patientId,
        encounterId:parsedAction.encounterId,
        version:(existing?.version??0)+1,
        createdAt:existing?.createdAt??ctx.now,
        updatedAt:ctx.now,
        status:'draft',
        assessmentRecordId:parsedAction.assessmentRecordId,
        rationale:parsedAction.rationale,
        patientFacingPlan:parsedAction.patientFacingPlan,
        disposition:parsedAction.disposition,
        owner:parsedAction.owner,
        followUp:{...parsedAction.followUp,appointmentBooked:false},
        pendingWork:parsedAction.pendingWork.map(item=>({...item})),
        teachBack:parsedAction.teachBack,
        bridge,
        reviewEvidence:trustedReviewEvidence(ctx,parsedAction.patientId),
        ...(existing?.amendedFromId?{amendedFromId:existing.amendedFromId,amendmentReason:existing.amendmentReason}:{}),
        history:pushHistory(existing?.history??[],ctx,existing?.status??'new','draft',existing?'Encounter draft updated.':'Encounter draft created.',assessment.id),
      };
      next={...current,signoffs:replaceById(current.signoffs,record)};
      break;
    }
    case 'encounters.signoff.review':{
      const existing=current.signoffs.find(item=>item.id===parsedAction.id&&item.patientId===parsedAction.patientId&&item.encounterId===parsedAction.encounterId);
      if(!existing)throw new Error('Encounter draft not found.');
      if(existing.status!=='draft')throw new Error('Only draft encounter records can move to reviewed.');
      assertVersion(parsedAction.expectedVersion,existing.version);
      assertSignoffEvidence(current,existing,ctx);
      const record:SignoffRecord={...existing,version:existing.version+1,updatedAt:ctx.now,status:'reviewed',history:pushHistory(existing.history,ctx,'draft','reviewed',parsedAction.reason)};
      next={...current,signoffs:replaceById(current.signoffs,record)};
      break;
    }
    case 'encounters.signoff.sign':{
      const existing=current.signoffs.find(item=>item.id===parsedAction.id&&item.patientId===parsedAction.patientId&&item.encounterId===parsedAction.encounterId);
      if(!existing)throw new Error('Encounter record not found.');
      if(existing.status!=='reviewed')throw new Error('Review the encounter record before signing.');
      assertVersion(parsedAction.expectedVersion,existing.version);
      const evidence=assertSignoffEvidence(current,existing,ctx);
      const snapshot={
        ...signoffAdditionalFields(existing),
        assessmentRecordId:existing.assessmentRecordId,
        rationale:existing.rationale,
        patientFacingPlan:existing.patientFacingPlan,
        disposition:existing.disposition,
        owner:existing.owner,
        followUp:existing.followUp,
        pendingWork:existing.pendingWork,
        teachBack:existing.teachBack,
        bridge:existing.bridge,
        assessmentSnapshot:evidence.assessment,
        ...(evidence.observation?{observationSnapshot:evidence.observation}:{}),
        ...(evidence.receivingWork?{receivingWorkSnapshot:structuredClone(evidence.receivingWork)}:{}),
        reviewEvidence:existing.reviewEvidence,
      };
      const record:SignoffRecord={...existing,version:existing.version+1,updatedAt:ctx.now,status:'signed',signedSnapshot:snapshot,history:pushHistory(existing.history,ctx,'reviewed','signed',parsedAction.reason)};
      next={...current,signoffs:replaceById(current.signoffs,record)};
      break;
    }
    case 'encounters.signoff.amend':{
      const existing=current.signoffs.find(item=>item.id===parsedAction.id&&item.patientId===parsedAction.patientId&&item.encounterId===parsedAction.encounterId);
      if(!existing)throw new Error('Signed encounter record not found.');
      if(existing.status!=='signed')throw new Error('Only signed encounter records can be amended.');
      assertVersion(parsedAction.expectedVersion,existing.version);
      if(current.signoffs.some(item=>item.amendedFromId===existing.id))throw new Error('This signed record already has an amendment. Reload the latest version before amending.');
      const assessment=current.assessments.find(item=>item.id===existing.assessmentRecordId&&item.patientId===existing.patientId&&item.encounterId===existing.encounterId);
      if(!assessment)throw new Error('Assessment record not found for this encounter.');
      const observation=findByEncounter(current.observations,existing.patientId,existing.encounterId);
      const additional={
        planKind:parsedAction.planKind??existing.planKind,
        receivingWorkRef:parsedAction.planKind==='definitive'?undefined:parsedAction.receivingWorkRef??existing.receivingWorkRef,
        patientFallback:parsedAction.planKind==='definitive'?undefined:parsedAction.patientFallback??existing.patientFallback,
        teachBackOutcome:parsedAction.teachBackOutcome??existing.teachBackOutcome,
        clarification:parsedAction.teachBackOutcome&&parsedAction.teachBackOutcome!=='needs-clarification'?undefined:parsedAction.clarification??existing.clarification,
      };
      const amended:SignoffRecord={
        ...existing,
        ...additional,
        id:crypto.randomUUID(),
        status:'draft',
        signedSnapshot:undefined,
        version:1,
        createdAt:ctx.now,
        updatedAt:ctx.now,
        amendedFromId:existing.id,
        amendmentReason:parsedAction.amendmentReason,
        rationale:parsedAction.rationale??existing.rationale,
        patientFacingPlan:parsedAction.patientFacingPlan??existing.patientFacingPlan,
        disposition:parsedAction.disposition??existing.disposition,
        owner:parsedAction.owner??existing.owner,
        followUp:parsedAction.followUp?{...parsedAction.followUp,appointmentBooked:false}:existing.followUp,
        pendingWork:parsedAction.pendingWork?.map(item=>({...item}))??existing.pendingWork,
        teachBack:parsedAction.teachBack??existing.teachBack,
        reviewEvidence:trustedReviewEvidence(ctx,parsedAction.patientId),
        bridge:bridgeForSignoff({
          ...additional,
          patientId:existing.patientId,
          encounterId:existing.encounterId,
          patientFacingPlan:parsedAction.patientFacingPlan??existing.patientFacingPlan,
          disposition:parsedAction.disposition??existing.disposition,
          pendingWork:parsedAction.pendingWork??existing.pendingWork,
          rationale:parsedAction.rationale??existing.rationale,owner:parsedAction.owner??existing.owner,followUp:parsedAction.followUp??existing.followUp,teachBack:parsedAction.teachBack??existing.teachBack,
          assessmentVersion:assessment.version,
          observationVersion:observation?.version,
        }),
        history:pushHistory([],ctx,'signed','draft',parsedAction.amendmentReason,existing.id),
      };
      next={...current,signoffs:[...current.signoffs,amended]};
      break;
    }
    case 'encounters.episode.save':{
      const existing=findByEncounter(current.episodes,parsedAction.patientId,parsedAction.encounterId);
      assertVersion(parsedAction.expectedVersion,existing?.version);
      const record:EpisodeReviewRecord={
        id:existing?.id??recordId('episode',parsedAction.patientId,parsedAction.encounterId),
        patientId:parsedAction.patientId,
        encounterId:parsedAction.encounterId,
        version:(existing?.version??0)+1,
        createdAt:existing?.createdAt??ctx.now,
        updatedAt:ctx.now,
        status:parsedAction.status,
        goalEvidence:parsedAction.goalEvidence,
        observedOutcomes:parsedAction.observedOutcomes,
        priorInterventions:parsedAction.priorInterventions,
        ongoingInterventions:parsedAction.ongoingInterventions,
        patientExperience:parsedAction.patientExperience,
        remainingConcerns:trimList(parsedAction.remainingConcerns),
        decision:parsedAction.decision,
        pendingWorkDisposition:parsedAction.pendingWorkDisposition,
        pendingWorkOwner:parsedAction.pendingWorkOwner,
        reviewEvidence:parsedAction.status==='reviewed'?trustedReviewEvidence(ctx,parsedAction.patientId):existing?.reviewEvidence,
        history:pushHistory(existing?.history??[],ctx,existing?.status??'new',parsedAction.status,existing?'Episode review updated.':'Episode review started.'),
      };
      next={...current,episodes:replaceById(current.episodes,record)};
      break;
    }
    case 'encounters.episode.close':{
      const existing=current.episodes.find(item=>item.id===parsedAction.id&&item.patientId===parsedAction.patientId&&item.encounterId===parsedAction.encounterId);
      if(!existing)throw new Error('Episode review not found.');
      assertVersion(parsedAction.expectedVersion,existing.version);
      if(existing.status!=='reviewed')throw new Error('Review the episode before closure.');
      if(existing.decision!=='closure')throw new Error('Only closure decisions can close the episode.');
      if(latestSignoffs(current.signoffs).some(item=>item.patientId===existing.patientId&&item.encounterId===existing.encounterId&&item.status!=='signed'))throw new Error('Finish the encounter sign-off before closing the episode.');
      if(current.assessments.some(item=>item.patientId===existing.patientId&&item.encounterId===existing.encounterId&&nonTerminalAssessmentStatuses.has(item.status)))throw new Error('Resolve deferred or urgent assessment reviews before closure.');
      if(!existing.pendingWorkDisposition||!existing.pendingWorkOwner)throw new Error('Record pending work disposition and ownership before closure.');
      if(existing.reviewEvidence&&!ctx.reviewEvidence)throw new Error('Patient sources are unavailable. Reload before closing the episode.');
      if(existing.reviewEvidence&&ctx.reviewEvidence&&reviewEvidenceRevision(existing.reviewEvidence)!==reviewEvidenceRevision(ctx.reviewEvidence))throw new Error('Patient sources changed. Review the episode again before closure.');
      if(ctx.closureDependencies===undefined)throw new Error('Pending care work is unavailable. Reload the patient record before closing the episode.');
      const dependencies=ctx.closureDependencies.filter(item=>item.patientId===existing.patientId&&(!item.encounterId||item.encounterId===existing.encounterId));
      const unaccepted=dependencies.filter(item=>!item.acceptedOwner?.trim());
      if(unaccepted.length)throw new Error(`Resolve or record accepted receiving responsibility before closure: ${unaccepted.map(item=>item.title).join('; ')}`);
      const record:EpisodeReviewRecord={...existing,version:existing.version+1,updatedAt:ctx.now,status:'closed',closureSnapshot:{actor:ctx.actor,at:ctx.now,dependencies:structuredClone(dependencies)},history:pushHistory(existing.history,ctx,existing.status,'closed',parsedAction.reason)};
      next={...current,episodes:replaceById(current.episodes,record)};
      break;
    }
  }

  return validateState(withReceipt(next,parsedAction,ctx));
}
