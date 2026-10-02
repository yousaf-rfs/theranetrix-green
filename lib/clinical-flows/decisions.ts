import {z} from 'zod';
import type {EngineRun} from '../engine-demo';

const patientRefSchema=z.object({id:z.string().min(1).max(100),name:z.string().min(1).max(200)}).strict();
export type Context={
  actor:string;
  now:string;
  patients:readonly z.infer<typeof patientRefSchema>[];
  features:Readonly<Record<string,boolean>>;
  inputVersions?:readonly {patientId:string;encounterId:string;inputVersion:string}[];
  carePlans?:readonly {id:string;patientId:string;version?:number;summary?:string;goal?:string}[];
  engineRuns?:readonly EngineRun[];
  currentEngineRevision?:string;
  sourceSnapshot?:DecisionSourceSnapshot;
  carePlanPackages?:readonly DecisionCarePackage[];
  exportScope?:DecisionExportScope;
  observationSources?:readonly DecisionObservationSource[];
};

const metricSchema=z.number().int().min(0).max(10);
const nullableMetricSchema=z.union([metricSchema,z.null()]);
const timestampSchema=z.string().datetime({offset:true});
const idSchema=z.string().min(1).max(120);
const textSchema=z.string().trim().min(1).max(6000);
const optionalTextSchema=z.string().trim().max(6000);
const requestIdSchema=z.string().trim().min(1).max(200);
const versionSchema=z.number().int().min(1);
const metricPairSchema=z.object({prior:nullableMetricSchema.optional(),current:nullableMetricSchema.optional()}).strict();
const weight=z.number().min(0).max(100);
const enginePreferencesSchema=z.object({relief:weight,alertness:weight,routine:weight}).strict();
const preferenceWeightsSchema=z.union([enginePreferencesSchema,z.object({relief:weight,function:weight,sleep:weight,safety:weight}).strict()]);
const workSchema=z.object({id:idSchema,title:z.string().trim().min(1).max(500),owner:z.string().trim().min(1).max(200),dueAt:timestampSchema}).strict();
const observationSourceSchema=z.object({entryId:idSchema,recordId:idSchema,recordVersion:versionSchema,metric:z.enum(['pain','function','sleep']),status:z.enum(['answered','zero','unanswered','declined']),value:metricSchema.optional(),source:z.string().trim().min(1).max(2000),collectedAt:timestampSchema,confirmedAt:timestampSchema.optional(),confirmedBy:z.string().max(200).optional(),receivedAt:timestampSchema.optional(),correctedFromEntryId:idSchema.optional()}).strict();
const eventSchema=z.object({id:idSchema,kind:z.enum(['treatment','plan','life-event']),at:z.string().min(1).max(60),title:z.string().min(1).max(500),source:z.string().min(1).max(500)}).strict();
const sourceSnapshotSchema=z.object({patientId:idSchema,encounterId:idSchema,inputVersion:idSchema,capturedAt:timestampSchema,facts:z.record(z.string().max(120),z.string().max(6000))}).strict();
const sourceChangeSchema=z.object({field:z.string(),before:z.string(),after:z.string()}).strict();
const carePackageSchema=z.object({patientId:idSchema,planId:idSchema,patientName:z.string().max(200).optional(),instructions:textSchema,owner:z.string().max(200).optional(),followUp:z.object({date:z.string().max(60),time:z.string().max(30).optional(),timezone:z.string().max(100).optional()}).strict().optional(),notes:z.array(z.object({id:idSchema,at:timestampSchema,actor:z.string().max(200),text:z.string().max(12000)}).strict()).max(80).optional(),tasks:z.array(z.object({id:idSchema,title:z.string().max(500),owner:z.string().max(200).optional(),dueAt:z.string().max(100).optional(),done:z.boolean(),history:z.array(z.object({at:timestampSchema,actor:z.string().max(200),reason:z.string().max(6000),status:z.string().max(100)}).strict()).max(100).optional()}).strict()).max(100).optional()}).strict();
const audienceSchema=z.enum(['internal','patient','proxy']);
const exportScopeSchema=z.object({audience:audienceSchema,recipient:z.string().trim().min(1).max(200),accessScope:z.array(z.string().trim().min(1).max(120)).min(1).max(30),grantId:z.string().max(200).optional()}).strict();
const runSchema=z.object({releaseRef:z.object({releaseId:idSchema,artifactVersion:versionSchema}).strict().optional(),id:idSchema,date:timestampSchema,actor:z.string().min(1).max(200),revision:idSchema,version:idSchema,patientId:idSchema,preferences:enginePreferencesSchema,sources:z.array(z.object({label:z.string(),value:z.string(),date:z.string()}).strict()),gaps:z.array(z.string()),summary:z.string(),signals:z.array(z.string()),points:z.array(z.object({date:z.string(),pain:z.number().nullable(),target:z.number(),scenario:z.number().nullable(),low:z.number().nullable(),high:z.number().nullable()}).strict()),candidates:z.array(z.object({id:idSchema,title:z.string(),benefit:z.number(),burden:z.number(),routine:z.number(),pstScore:z.number(),shadowScore:z.number(),reason:z.string(),watch:z.string()}).strict()).max(12),pstOrder:z.array(idSchema).max(12),shadowOrder:z.array(idSchema).max(12),agreement:z.boolean().nullable(),enabled:z.object({twin:z.boolean(),pst:z.boolean(),shadow:z.boolean(),advisor:z.boolean()}).strict(),basis:z.array(z.string())}).strict();
// A working copy is incomplete editor text, never evidence or a signable draft.
const workingFormSchema=z.record(z.string().max(120),z.unknown()).superRefine((form,ctx)=>{
  const allowed=new Set(['inputVersion','reviewInterpretation','reviewGoal','reviewQuestion','collectedAt','receivedAt','observationProvenance','contradictions','pain','functionValue','sleep','preferenceSummary','weights','options','comparisonSafety','comparisonDisposition','comparisonRationale','missingInputs','comparisonEvidence','pstId','pstSummary','pstLimitations','shadowId','shadowSummary','shadowLimitations','agreement','outputProvenance','outputLimitations','supportingEvidence','conflictingEvidence','clarifications','engineDisposition','engineExplanation','suitability','modelVersions','configurationVersions','draftSummary','draftNote','signDisposition','reason','signRationale','planRef','monitoringOwner','monitoringDueAt','clarificationOwner','clarificationDueAt','sourceObservations','selectedDraftId','selectedDraftVersion','enginePreferences','selectedRunId','amendmentId','amendmentDisposition','amendmentRationale','amendmentPlan','amendmentReason']);
  if(Object.keys(form).some(key=>!allowed.has(key)))ctx.addIssue({code:'custom',message:'Unknown working-copy editor field.'});
  for(const [key,value] of Object.entries(form)){
    const valid=key==='weights'?preferenceWeightsSchema.safeParse(value).success:key==='enginePreferences'?enginePreferencesSchema.safeParse(value).success:key==='selectedDraftVersion'?z.number().int().min(0).safeParse(value).success:key==='sourceObservations'?observationSourceSchema.array().max(300).safeParse(value).success:key==='options'?z.array(z.object({id:idSchema,title:z.string().max(200),status:z.enum(['for-discussion','modified','rejected','deferred','alternative']),rationale:z.string().max(2000),applicability:z.string().max(2000),evidenceRefs:z.array(idSchema).max(30)}).strict()).max(12).safeParse(value).success:typeof value==='string'&&value.length<=6000;
    if(!valid)ctx.addIssue({code:'custom',message:`Invalid working-copy field: ${key}`});
  }
  if(form.selectedDraftId!==undefined&&(typeof form.selectedDraftVersion!=='number'||(form.selectedDraftId?form.selectedDraftVersion<1:form.selectedDraftVersion!==0)))ctx.addIssue({code:'custom',message:'A working-copy draft selection requires its saved version.'});
  try{if(JSON.stringify(form).length>22000)ctx.addIssue({code:'custom',message:'Working copy is too large.'});}catch{ctx.addIssue({code:'custom',message:'Working copy must be serializable.'});}
});
const workingCopySchema=z.object({id:idSchema,patientId:idSchema,encounterId:idSchema,inputVersion:idSchema,actor:z.string().min(1).max(200),version:versionSchema,createdAt:timestampSchema,updatedAt:timestampSchema,form:workingFormSchema,pendingAction:z.string().max(22000).optional(),sourceSnapshot:sourceSnapshotSchema.optional()}).strict();
export type DecisionSourceSnapshot=z.infer<typeof sourceSnapshotSchema>;
export type DecisionObservationSource=z.infer<typeof observationSourceSchema>;
export type DecisionCarePackage=z.infer<typeof carePackageSchema>;
export type DecisionExportScope=z.infer<typeof exportScopeSchema>;
export type DecisionWork=z.infer<typeof workSchema>;
export function diffDecisionSources(before:DecisionSourceSnapshot|undefined,after:DecisionSourceSnapshot|undefined){
  if(!before||!after)return [];
  if(before.patientId!==after.patientId||before.encounterId!==after.encounterId)throw new Error('Source comparison must stay within the patient encounter.');
  return [...new Set([...Object.keys(before.facts),...Object.keys(after.facts)])].sort().filter(field=>before.facts[field]!==after.facts[field]).map(field=>({field,before:before.facts[field]??'Not recorded',after:after.facts[field]??'Not recorded'}));
}

const evidenceRefSchema=z.object({
  id:idSchema,
  title:z.string().trim().min(1).max(300),
  locator:z.string().trim().min(1).max(600),
  version:z.string().trim().min(1).max(120),
  reviewDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
    const parsed=new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value;
  },'Evidence review date must be a valid calendar date.'),
}).strict();

const historySchema=z.object({
  id:idSchema,
  at:timestampSchema,
  actor:z.string().min(1).max(200),
  from:z.string().min(1).max(120),
  to:z.string().min(1).max(120),
  reason:z.string().min(1).max(6000),
  evidenceRef:z.string().trim().max(120).optional(),
}).strict();

type HistoryEntry=z.infer<typeof historySchema>;

type Direction='improved'|'worsened'|'unchanged'|'insufficient-data';

const observedReviewSchema=z.object({
  id:idSchema,
  patientId:idSchema,
  encounterId:idSchema,
  inputVersion:idSchema,
  version:versionSchema,
  createdAt:timestampSchema,
  updatedAt:timestampSchema,
  collectedAt:timestampSchema,
  receivedAt:timestampSchema,
  dataFreshness:z.enum(['fresh','stale']),
  contradictoryMetrics:z.array(z.string().trim().min(1).max(400)).max(20),
  provenance:z.enum(['observed','synthetic','model-derived']),
  metrics:z.object({
    pain:z.object({prior:nullableMetricSchema,current:nullableMetricSchema,direction:z.enum(['improved','worsened','unchanged','insufficient-data'])}).strict(),
    function:z.object({prior:nullableMetricSchema,current:nullableMetricSchema,direction:z.enum(['improved','worsened','unchanged','insufficient-data'])}).strict(),
    sleep:z.object({prior:nullableMetricSchema,current:nullableMetricSchema,direction:z.enum(['improved','worsened','unchanged','insufficient-data'])}).strict(),
  }).strict(),
  clinicalInterpretation:textSchema,
  goal:textSchema,
  nextMonitoringQuestion:textSchema,
  sourceObservations:z.array(observationSourceSchema).max(300).optional(),
  events:z.array(eventSchema).max(100).optional(),
  monitoring:workSchema.optional(),
  history:z.array(historySchema),
}).strict();

const comparisonOptionSchema=z.object({
  id:idSchema,
  title:z.string().trim().min(1).max(200),
  status:z.enum(['for-discussion','modified','rejected','deferred','alternative']),
  rationale:z.string().trim().min(1).max(2000),
  applicability:z.string().trim().min(1).max(2000),
  evidenceRefs:z.array(idSchema).max(30),
}).strict();

const comparisonSnapshotSchema=z.object({
  id:idSchema,
  patientId:idSchema,
  encounterId:idSchema,
  inputVersion:idSchema,
  version:versionSchema,
  createdAt:timestampSchema,
  updatedAt:timestampSchema,
  defaultAction:z.literal('no-prescription'),
  preferenceSummary:textSchema,
  preferenceWeights:preferenceWeightsSchema,
  sourceRunId:idSchema.optional(),
  sourceRunSnapshot:runSchema.optional(),
  options:z.array(comparisonOptionSchema).min(1).max(12),
  disposition:z.enum(['select-for-discussion','modify','reject-all','defer','author-alternative','no-change']),
  rationale:textSchema,
  safetyReview:textSchema,
  missingInputs:z.array(z.string().trim().min(1).max(500)).max(40),
  evidenceRefs:z.array(evidenceRefSchema).max(120),
  history:z.array(historySchema),
}).strict();

const strategyOutputSchema=z.object({outputId:idSchema,summary:textSchema,limitations:z.array(z.string().trim().min(1).max(500)).max(30)}).strict();

const engineComparisonSchema=z.object({
  id:idSchema,
  patientId:idSchema,
  encounterId:idSchema,
  inputVersion:idSchema,
  version:versionSchema,
  createdAt:timestampSchema,
  updatedAt:timestampSchema,
  pst:strategyOutputSchema,
  shadow:strategyOutputSchema,
  agreement:z.enum(['agree','disagree','partial']),
  limitations:z.array(z.string().trim().min(1).max(500)).max(30),
  supportingEvidence:z.array(evidenceRefSchema).max(120),
  conflictingEvidence:z.array(evidenceRefSchema).max(120),
  clarificationRequests:z.array(z.string().trim().min(1).max(500)).max(30),
  clarificationWork:z.array(workSchema).max(30).optional(),
  clinicianDisposition:z.enum(['accept-pst','accept-shadow','request-clarification','defer','reject-both','no-change']),
  dispositionExplanation:textSchema,
  suitability:z.enum(['not-reviewed','unsupported','evidence-reviewed']),
  provenance:z.enum(['synthetic','external','unverified']).default('unverified'),
  modelVersions:z.array(idSchema).max(120).default([]),
  configurationVersions:z.array(idSchema).max(120).default([]),
  sourceRunId:idSchema.optional(),
  sourceRunSnapshot:runSchema.optional(),
  history:z.array(historySchema),
}).strict();

const signedSnapshotSchema=z.object({
  id:idSchema,
  patientId:idSchema,
  encounterId:idSchema,
  inputVersion:idSchema,
  version:versionSchema,
  createdAt:timestampSchema,
  updatedAt:timestampSchema,
  actor:z.string().min(1).max(200),
  disposition:z.enum(['approve','defer','reject','no-change']),
  rationale:textSchema,
  patientPlanRef:z.string().trim().min(1).max(200),
  patientPlanSnapshot:z.object({id:idSchema,patientId:idSchema,version:versionSchema.optional(),summary:z.string().optional(),goal:z.string().optional()}).strict().optional(),
  sourceSnapshot:sourceSnapshotSchema.optional(),
  carePackage:carePackageSchema.optional(),
  reviewedInput:z.object({
    observedReview:observedReviewSchema,
    comparisonSnapshot:comparisonSnapshotSchema,
    engineComparison:engineComparisonSchema,
  }).strict(),
  evidenceVersions:z.array(z.string().trim().min(1).max(120)).max(120),
  modelVersions:z.array(z.string().trim().min(1).max(120)).max(120),
  configurationVersions:z.array(z.string().trim().min(1).max(120)).max(120),
  displayedOutputs:z.object({
    summary:textSchema,
    pstOutputId:idSchema,
    shadowOutputId:idSchema,
  }).strict(),
  amendmentOf:idSchema.optional(),
  history:z.array(historySchema),
}).strict();

const draftPayloadSchema=z.object({
  observedReviewId:idSchema.optional(),
  comparisonSnapshotId:idSchema.optional(),
  engineComparisonId:idSchema.optional(),
  pendingDisposition:z.enum(['approve','defer','reject','no-change']).optional(),
  note:optionalTextSchema.optional(),
}).strict();

const draftSchema=z.object({
  id:idSchema,
  patientId:idSchema,
  encounterId:idSchema,
  expectedInputVersion:idSchema,
  version:versionSchema,
  createdAt:timestampSchema,
  updatedAt:timestampSchema,
  status:z.enum(['draft','saved','disputed','corrected','cancelled','signed']),
  signedSnapshotId:idSchema.optional(),
  summary:textSchema,
  materialChangeDiff:z.array(z.string().trim().min(1).max(200)).max(80),
  sourceSnapshot:sourceSnapshotSchema.optional(),
  sourceChanges:z.array(sourceChangeSchema).optional(),
  payload:draftPayloadSchema,
  reviewedVersions:z.object({observedReview:versionSchema.optional(),comparisonSnapshot:versionSchema.optional(),engineComparison:versionSchema.optional()}).strict().default({}),
  history:z.array(historySchema),
}).strict();

const idempotencyReceiptSchema=z.object({
  requestId:requestIdSchema,
  hash:z.string().min(1),
  at:timestampSchema,
}).strict();

const exportRecordSchema=z.object({
  id:idSchema,
  requestId:requestIdSchema.optional(),
  patientId:idSchema,
  encounterId:idSchema,
  signedSnapshotId:idSchema,
  format:z.enum(['json','readable']),
  exportedAt:timestampSchema,
  actor:z.string().min(1).max(200),
  content:z.string().min(1),
  audience:audienceSchema.optional(),
  recipient:z.string().optional(),
  accessScope:z.array(z.string()).optional(),
  grantId:z.string().optional(),
}).strict();

const stateSchema=z.object({
  observedReviews:z.array(observedReviewSchema),
  comparisonSnapshots:z.array(comparisonSnapshotSchema),
  engineComparisons:z.array(engineComparisonSchema),
  signedSnapshots:z.array(signedSnapshotSchema),
  drafts:z.array(draftSchema),
  inputRevisions:z.array(z.object({patientId:idSchema,encounterId:idSchema,inputVersion:idSchema,updatedAt:timestampSchema,actor:z.string().min(1).max(200),history:z.array(historySchema).default([])}).strict()),
  idempotencyReceipts:z.array(idempotencyReceiptSchema).max(200),
  exports:z.array(exportRecordSchema),
  workingCopies:z.array(workingCopySchema).optional(),
}).strict();

export type State=z.infer<typeof stateSchema>;

export function initialState():State {
  return {observedReviews:[],comparisonSnapshots:[],engineComparisons:[],signedSnapshots:[],drafts:[],inputRevisions:[],idempotencyReceipts:[],exports:[],workingCopies:[]};
}

const reviewCaptureSchema=z.object({
  type:z.literal('decisions.review.capture'),
  requestId:requestIdSchema,
  patientId:idSchema,
  encounterId:idSchema,
  expectedVersion:z.number().int().min(0),
  inputVersion:idSchema,
  collectedAt:timestampSchema,
  receivedAt:timestampSchema,
  provenance:z.enum(['observed','synthetic','model-derived']),
  metrics:z.object({pain:metricPairSchema,function:metricPairSchema,sleep:metricPairSchema}).strict(),
  contradictoryMetrics:z.array(z.string().trim().min(1).max(400)).max(20),
  clinicalInterpretation:textSchema,
  goal:textSchema,
  nextMonitoringQuestion:textSchema,
  sourceObservations:z.array(observationSourceSchema).max(300).optional(),
  events:z.array(eventSchema).max(100).optional(),
  monitoring:workSchema.optional(),
}).strict();

const comparisonCaptureSchema=z.object({
  type:z.literal('decisions.comparison.capture'),
  requestId:requestIdSchema,
  patientId:idSchema,
  encounterId:idSchema,
  expectedVersion:z.number().int().min(0),
  inputVersion:idSchema,
  preferenceSummary:textSchema,
  preferenceWeights:preferenceWeightsSchema,
  options:z.array(comparisonOptionSchema).min(1).max(12),
  disposition:z.enum(['select-for-discussion','modify','reject-all','defer','author-alternative','no-change']),
  rationale:textSchema,
  safetyReview:textSchema,
  missingInputs:z.array(z.string().trim().min(1).max(500)).max(40),
  evidenceRefs:z.array(evidenceRefSchema).max(120),
}).strict();

const outputsCaptureSchema=z.object({
  type:z.literal('decisions.outputs.capture'),
  requestId:requestIdSchema,
  patientId:idSchema,
  encounterId:idSchema,
  expectedVersion:z.number().int().min(0),
  inputVersion:idSchema,
  pst:strategyOutputSchema,
  shadow:strategyOutputSchema,
  agreement:z.enum(['agree','disagree','partial']),
  limitations:z.array(z.string().trim().min(1).max(500)).max(30),
  supportingEvidence:z.array(evidenceRefSchema).max(120),
  conflictingEvidence:z.array(evidenceRefSchema).max(120),
  clarificationRequests:z.array(z.string().trim().min(1).max(500)).max(30),
  clarificationWork:z.array(workSchema).max(30).optional(),
  clinicianDisposition:z.enum(['accept-pst','accept-shadow','request-clarification','defer','reject-both','no-change']),
  dispositionExplanation:textSchema,
  suitability:z.enum(['not-reviewed','unsupported','evidence-reviewed']),
  provenance:z.enum(['synthetic','external','unverified']).default('unverified'),
  modelVersions:z.array(idSchema).max(120).default([]),
  configurationVersions:z.array(idSchema).max(120).default([]),
}).strict();

const draftSaveSchema=z.object({
  type:z.literal('decisions.draft.save'),
  requestId:requestIdSchema,
  patientId:idSchema,
  encounterId:idSchema,
  draftId:idSchema.optional(),
  expectedVersion:z.number().int().min(0).optional(),
  expectedInputVersion:idSchema,
  summary:textSchema,
  payload:draftPayloadSchema,
}).strict();

const draftStatusSchema=z.object({
  type:z.enum(['decisions.draft.cancel','decisions.draft.retry']),
  requestId:requestIdSchema,
  draftId:idSchema,
  patientId:idSchema,
  encounterId:idSchema,
  expectedVersion:z.number().int().min(1),
  reason:textSchema,
}).strict();

const disputeSchema=z.object({
  type:z.literal('decisions.summary.dispute'),
  requestId:requestIdSchema,
  draftId:idSchema,
  patientId:idSchema,
  encounterId:idSchema,
  expectedVersion:z.number().int().min(1),
  reason:textSchema,
}).strict();

const correctSchema=z.object({
  type:z.literal('decisions.summary.correct'),
  requestId:requestIdSchema,
  draftId:idSchema,
  patientId:idSchema,
  encounterId:idSchema,
  expectedVersion:z.number().int().min(1),
  expectedInputVersion:idSchema,
  summary:textSchema,
  payload:draftPayloadSchema,
  reason:textSchema,
}).strict();

const inputRevisionSchema=z.object({
  type:z.literal('decisions.input.revise'),
  requestId:requestIdSchema,
  patientId:idSchema,
  encounterId:idSchema,
  inputVersion:idSchema,
  expectedInputVersion:idSchema.optional(),
  reason:textSchema,
}).strict();

const signSchema=z.object({
  type:z.literal('decisions.sign.capture'),
  requestId:requestIdSchema,
  patientId:idSchema,
  encounterId:idSchema,
  draftId:idSchema,
  expectedDraftVersion:z.number().int().min(1),
  expectedInputVersion:idSchema,
  disposition:z.enum(['approve','defer','reject','no-change']),
  rationale:textSchema,
  patientPlanRef:z.string().trim().min(1).max(200),
  evidenceVersions:z.array(z.string().trim().min(1).max(120)).max(120),
  modelVersions:z.array(z.string().trim().min(1).max(120)).max(120),
  configurationVersions:z.array(z.string().trim().min(1).max(120)).max(120),
  displayedSummary:textSchema,
}).strict();

const amendSchema=z.object({
  type:z.literal('decisions.sign.amend'),
  requestId:requestIdSchema,
  signedSnapshotId:idSchema,
  expectedVersion:versionSchema.optional(),
  patientId:idSchema,
  encounterId:idSchema,
  reason:textSchema,
  disposition:z.enum(['approve','defer','reject','no-change']),
  rationale:textSchema,
  patientPlanRef:z.string().trim().min(1).max(200),
}).strict();

const exportSchema=z.object({
  type:z.literal('decisions.export.capture'),
  requestId:requestIdSchema,
  signedSnapshotId:idSchema,
  patientId:idSchema,
  encounterId:idSchema,
  format:z.enum(['json','readable']),
  audience:audienceSchema.optional(),
}).strict();

const engineCaptureSchema=z.object({type:z.literal('decisions.engine.capture'),requestId:requestIdSchema,patientId:idSchema,encounterId:idSchema,inputVersion:idSchema,runId:idSchema,expectedComparisonVersion:z.number().int().min(0),expectedOutputsVersion:z.number().int().min(0)}).strict();
const workingSaveSchema=z.object({type:z.literal('decisions.working.save'),requestId:requestIdSchema,patientId:idSchema,encounterId:idSchema,inputVersion:idSchema,id:idSchema.optional(),expectedVersion:z.number().int().min(0).optional(),form:workingFormSchema,pendingAction:z.string().max(22000).optional()}).strict();

export const actionSchema=z.discriminatedUnion('type',[
  engineCaptureSchema,
  workingSaveSchema,
  reviewCaptureSchema,
  comparisonCaptureSchema,
  outputsCaptureSchema,
  draftSaveSchema,
  draftStatusSchema,
  disputeSchema,
  correctSchema,
  inputRevisionSchema,
  signSchema,
  amendSchema,
  exportSchema,
]);

export type Action=z.infer<typeof actionSchema>;

const pair=(patientId:string,encounterId:string)=>JSON.stringify([patientId,encounterId]);
const metricDirection=(key:'pain'|'function'|'sleep',values:z.infer<typeof metricPairSchema>):Direction=>{
  if(values.current===null||values.current===undefined||values.prior===null||values.prior===undefined)return 'insufficient-data';
  if(values.current===values.prior)return 'unchanged';
  const improved=key==='pain'?values.current<values.prior:values.current>values.prior;
  return improved?'improved':'worsened';
};
const touchHistory=(from:string,to:string,actor:string,at:string,reason:string,evidenceRef?:string):HistoryEntry=>({id:createId('decisions-history'),at,actor,from,to,reason,...(evidenceRef===undefined?{}:{evidenceRef})});
const createId=(prefix:string)=>{
  const generated=globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${generated}`;
};
const ensurePatient=(context:Context,patientId:string)=>{
  if(!context.patients.some(patient=>patient.id===patientId))throw new Error('Patient not found in clinical workflow context.');
};
const ensurePlan=(context:Context,patientId:string,planRef:string)=>{
  if(context.carePlans&&!context.carePlans.some(plan=>plan.id===planRef&&plan.patientId===patientId))throw new Error('The plan reference must identify a saved care plan for this patient.');
  return context.carePlans?.find(plan=>plan.id===planRef&&plan.patientId===patientId);
};

function checkReceipt(next:State,requestId:string,payload:unknown){
  const hash=JSON.stringify(payload);
  const prior=next.idempotencyReceipts.find(receipt=>receipt.requestId===requestId);
  if(prior){
    if(prior.hash!==hash)throw new Error('Request id was already used with different payload.');
    return {hash,duplicate:true} as const;
  }
  return {hash,duplicate:false} as const;
}

function latestByScope<T extends {patientId:string;encounterId:string;version:number}>(rows:T[],patientId:string,encounterId:string){
  let latest:T|undefined;
  for(const row of rows){
    if(row.patientId!==patientId||row.encounterId!==encounterId)continue;
    if(!latest||row.version>latest.version)latest=row;
  }
  return latest;
}

function expectVersion(found:{version:number}|undefined,expected:number,label:string){
  const current=found?.version??0;
  if(current!==expected)throw new Error(`${label} changed in another session. Reload the latest version and retry.`);
}

function updateInputRevision(next:State,patientId:string,encounterId:string,inputVersion:string,actor:string,now:string,reason:string){
  const found=next.inputRevisions.find(revision=>revision.patientId===patientId&&revision.encounterId===encounterId);
  if(found){
    if(found.inputVersion===inputVersion)return;
    found.history.unshift(touchHistory(found.inputVersion,inputVersion,actor,now,reason));
    found.inputVersion=inputVersion;
    found.updatedAt=now;
    found.actor=actor;
    return;
  }
  next.inputRevisions.unshift({patientId,encounterId,inputVersion,updatedAt:now,actor,history:[touchHistory('none',inputVersion,actor,now,reason)]});
}

function assertInputVersion(state:State,patientId:string,encounterId:string,inputVersion:string,context:Context,now:string,establish=false){
  const authoritative=context.inputVersions?.find(row=>row.patientId===patientId&&row.encounterId===encounterId);
  if(context.inputVersions&&!authoritative)throw new Error('No current source version is available for this patient encounter.');
  if(authoritative&&authoritative.inputVersion!==inputVersion)throw new Error('Source input version changed. Reload and review the current patient encounter before saving.');
  const revision=state.inputRevisions.find(row=>row.patientId===patientId&&row.encounterId===encounterId);
  if(revision&&revision.inputVersion!==inputVersion&&!authoritative)throw new Error('Input version changed. Re-review the latest source version.');
  if(establish&&(!revision||revision.inputVersion!==inputVersion))updateInputRevision(state,patientId,encounterId,inputVersion,context.actor,now,'Captured current source version');
}

function reviewedSources(state:State,patientId:string,encounterId:string,inputVersion:string,payload:z.infer<typeof draftPayloadSchema>){
  const resolve=<T extends {id:string;patientId:string;encounterId:string;inputVersion:string;version:number}>(rows:T[],id:string|undefined,label:string)=>{
    if(!id)return undefined;
    const found=rows.find(row=>row.id===id&&row.patientId===patientId&&row.encounterId===encounterId);
    if(!found)throw new Error(`${label} does not belong to this patient encounter.`);
    if(found.inputVersion!==inputVersion)throw new Error(`${label} uses a different source input version. Re-review it before saving.`);
    if(latestByScope(rows,patientId,encounterId)?.id!==id)throw new Error(`${label} changed after review. Use the latest saved record.`);
    return found;
  };
  const observed=resolve(state.observedReviews,payload.observedReviewId,'Observed review');
  const comparison=resolve(state.comparisonSnapshots,payload.comparisonSnapshotId,'Comparison snapshot');
  const outputs=resolve(state.engineComparisons,payload.engineComparisonId,'PST/Shadow output');
  return {observed,comparison,outputs,versions:{observedReview:observed?.version,comparisonSnapshot:comparison?.version,engineComparison:outputs?.version}};
}

const unique=(values:readonly string[])=>[...new Set(values)].sort();
const sameValues=(left:readonly string[],right:readonly string[])=>JSON.stringify(unique(left))===JSON.stringify(unique(right));
const evidenceVersionsFor=(comparison:z.infer<typeof comparisonSnapshotSchema>,outputs:z.infer<typeof engineComparisonSchema>)=>unique([...comparison.evidenceRefs,...outputs.supportingEvidence,...outputs.conflictingEvidence].map(ref=>ref.version));

function assertEvidenceReferences(options:z.infer<typeof comparisonOptionSchema>[],refs:z.infer<typeof evidenceRefSchema>[]){
  const refIds=new Set(refs.map(ref=>ref.id));
  if(refIds.size!==refs.length)throw new Error('Evidence reference IDs must be unique.');
  if(new Set(options.map(option=>option.id)).size!==options.length)throw new Error('Comparison option IDs must be unique.');
  if(options.some(option=>option.evidenceRefs.some(id=>!refIds.has(id))))throw new Error('An option refers to evidence that was not captured.');
}

function trustedSource(context:Context,patientId:string,encounterId:string,inputVersion:string){
  if(!context.sourceSnapshot)return undefined;
  const source=sourceSnapshotSchema.parse(context.sourceSnapshot);
  if(source.patientId!==patientId||source.encounterId!==encounterId||source.inputVersion!==inputVersion)throw new Error('Source snapshot does not match the reviewed patient encounter version.');
  return structuredClone(source);
}
function trustedCarePackage(context:Context,patientId:string,planId:string){
  if(!context.carePlanPackages)return undefined;
  const found=context.carePlanPackages.find(row=>row.patientId===patientId&&row.planId===planId);
  if(!found)throw new Error('The historical care package is unavailable for this patient plan.');
  return carePackageSchema.parse(found);
}
function exportAuthorization(context:Context,audience:DecisionExportScope['audience']):DecisionExportScope{
  if(!context.features.decisionsExport)throw new Error('Export requires explicit server authorization.');
  const scope=context.exportScope?exportScopeSchema.parse(context.exportScope):undefined;
  if(scope&&scope.audience!==audience)throw new Error('Export audience does not match server authorization.');
  if(audience!=='internal'&&!scope)throw new Error('This export requires current recipient and sharing authorization.');
  return scope??{audience:'internal',recipient:context.actor,accessScope:['selected-historical-decision']};
}
export function decisionRunOutputId(runId:string,kind:'pst'|'shadow'){
  let hash=2166136261;for(const char of runId)hash=Math.imul(hash^char.charCodeAt(0),16777619);
  return `${kind}-${runId.slice(0,85)}-${(hash>>>0).toString(16)}`;
}
export function decisionRunSummary(run:EngineRun,kind:'pst'|'shadow'){
  const ids=kind==='pst'?run.pstOrder:run.shadowOrder;
  return ids.map((id,index)=>{const row=run.candidates.find(candidate=>candidate.id===id);if(!row)throw new Error('Saved engine ordering references a missing candidate.');return `${index+1}. ${row.title} — priority score ${kind==='pst'?row.pstScore:row.shadowScore}/100. ${row.reason} ${row.watch}`;}).join('\n');
}

export function reduce(state:State,action:Action,context:Context):State {
  const next=validateState(state);
  const parsed=actionSchema.parse(action);
  patientRefSchema.array().parse(context.patients);
  const now=timestampSchema.parse(context.now);
  z.string().trim().min(1).max(200).parse(context.actor);
  ensurePatient(context,parsed.patientId);
  // Authorization is checked before an idempotent replay can expose an old result.
  if(parsed.type==='decisions.export.capture'){
    const scope=exportAuthorization(context,parsed.audience??'internal');
    const prior=next.exports.find(row=>row.requestId===parsed.requestId);
    if(scope.audience==='proxy'&&prior&&(scope.grantId!==prior.grantId||scope.recipient!==prior.recipient))throw new Error('The proxy recipient or grant changed. Prepare a new export for the current recipient.');
  }

  const candidate=structuredClone(next);
  const apply=()=>{
    switch(parsed.type){
      case 'decisions.working.save':{
        const copies=candidate.workingCopies??=[];
        const existing=parsed.id?copies.find(row=>row.id===parsed.id&&row.patientId===parsed.patientId&&row.encounterId===parsed.encounterId&&row.actor===context.actor):undefined;
        if(parsed.id&&!existing&&(parsed.expectedVersion!==0||copies.some(row=>row.id===parsed.id)))throw new Error('Working copy not found for this patient encounter and author.');
        if(existing&&parsed.expectedVersion===undefined)throw new Error('Working copy version is required.');
        if(parsed.expectedVersion!==undefined)expectVersion(existing,parsed.expectedVersion,'Working copy');
        if(parsed.pendingAction){let pending:Action;try{pending=actionSchema.parse(JSON.parse(parsed.pendingAction));}catch{throw new Error('Pending action must be a valid saved Decisions command.');}if(pending.type==='decisions.working.save'||pending.patientId!==parsed.patientId||pending.encounterId!==parsed.encounterId)throw new Error('Pending action must match this working-copy patient encounter.');}
        const source=existing?.sourceSnapshot??(context.sourceSnapshot?.inputVersion===parsed.inputVersion?trustedSource(context,parsed.patientId,parsed.encounterId,parsed.inputVersion):undefined);
        const copy={id:existing?.id??parsed.id??createId('decisions-working'),patientId:parsed.patientId,encounterId:parsed.encounterId,inputVersion:parsed.inputVersion,actor:context.actor,version:(existing?.version??0)+1,createdAt:existing?.createdAt??now,updatedAt:now,form:structuredClone(parsed.form),...(parsed.pendingAction?{pendingAction:parsed.pendingAction}:{}),...(source?{sourceSnapshot:source}:{})};
        if(existing)copies[copies.indexOf(existing)]=copy;else copies.unshift(copy);
        return;
      }
      case 'decisions.engine.capture':{
        assertInputVersion(candidate,parsed.patientId,parsed.encounterId,parsed.inputVersion,context,now,true);
        const stored=context.engineRuns?.find(row=>row.id===parsed.runId&&row.patientId===parsed.patientId);
        if(!stored)throw new Error('Saved engine run does not belong to this patient.');
        const run=runSchema.parse(stored);
        if(!context.currentEngineRevision||run.revision!==context.currentEngineRevision)throw new Error('The saved engine run is stale. Run the comparison against the current patient record.');
        if(!run.enabled.pst||!run.enabled.shadow||!run.pstOrder.length||!run.shadowOrder.length)throw new Error('Both saved engine rankings are required.');
        const previous=latestByScope(candidate.comparisonSnapshots,parsed.patientId,parsed.encounterId),priorOutputs=latestByScope(candidate.engineComparisons,parsed.patientId,parsed.encounterId);
        expectVersion(previous,parsed.expectedComparisonVersion,'Comparison snapshot');expectVersion(priorOutputs,parsed.expectedOutputsVersion,'Engine outputs');
        const common={patientId:parsed.patientId,encounterId:parsed.encounterId,inputVersion:parsed.inputVersion,updatedAt:now,sourceRunId:run.id,sourceRunSnapshot:structuredClone(run)};
        const limitation='Saved demonstration rules; scores do not establish clinical suitability or authorize prescribing.';
        candidate.comparisonSnapshots.unshift({id:createId('decisions-comparison'),...common,version:(previous?.version??0)+1,createdAt:previous?.createdAt??now,defaultAction:'no-prescription',preferenceSummary:`Pain relief ${run.preferences.relief}; alertness / lower burden ${run.preferences.alertness}; routine ${run.preferences.routine}.`,preferenceWeights:{...run.preferences},options:run.pstOrder.map(id=>{const row=run.candidates.find(item=>item.id===id);if(!row)throw new Error('Saved ranking contains an unknown candidate.');return {id:row.id,title:row.title,status:'for-discussion' as const,rationale:row.reason,applicability:row.watch,evidenceRefs:[]};}),disposition:'defer',rationale:'Saved comparison is ready for independent clinician review.',safetyReview:limitation,missingInputs:[...run.gaps],evidenceRefs:[],history:[touchHistory(previous?`v${previous.version}`:'none','captured-engine',context.actor,now,`Imported saved engine run ${run.id}`),...(previous?.history??[])]});
        candidate.engineComparisons.unshift({id:createId('decisions-output'),...common,version:(priorOutputs?.version??0)+1,createdAt:priorOutputs?.createdAt??now,pst:{outputId:decisionRunOutputId(run.id,'pst'),summary:decisionRunSummary(run,'pst'),limitations:[limitation]},shadow:{outputId:decisionRunOutputId(run.id,'shadow'),summary:decisionRunSummary(run,'shadow'),limitations:[limitation]},agreement:run.agreement?'agree':'disagree',limitations:[limitation],supportingEvidence:[],conflictingEvidence:[],clarificationRequests:[],clinicianDisposition:'defer',dispositionExplanation:'Review the exact saved rankings, source records and calculation rules.',suitability:'unsupported',provenance:'synthetic',modelVersions:[],configurationVersions:[run.version],history:[touchHistory(priorOutputs?`v${priorOutputs.version}`:'none','captured-engine',context.actor,now,`Imported distinct rankings from ${run.id}`),...(priorOutputs?.history??[])]});
        return;
      }
      case 'decisions.input.revise':{
        ensurePatient(context,parsed.patientId);
        const revision=candidate.inputRevisions.find(row=>row.patientId===parsed.patientId&&row.encounterId===parsed.encounterId);
        if(revision&&parsed.expectedInputVersion!==revision.inputVersion)throw new Error('Input revision changed in another session. Reload before revising.');
        if(context.inputVersions){
          const authoritative=context.inputVersions.find(row=>row.patientId===parsed.patientId&&row.encounterId===parsed.encounterId);
          if(!authoritative||authoritative.inputVersion!==parsed.inputVersion)throw new Error('Input revision must match the current authoritative source version.');
        }else if(revision&&revision.inputVersion!==parsed.inputVersion&&revision.history.some(entry=>entry.from===parsed.inputVersion||entry.to===parsed.inputVersion))throw new Error('A prior input version cannot replace the current source revision.');
        updateInputRevision(candidate,parsed.patientId,parsed.encounterId,parsed.inputVersion,context.actor,now,parsed.reason);
        return;
      }
      case 'decisions.review.capture':{
        ensurePatient(context,parsed.patientId);
        assertInputVersion(candidate,parsed.patientId,parsed.encounterId,parsed.inputVersion,context,now,true);
        const previous=latestByScope(candidate.observedReviews,parsed.patientId,parsed.encounterId);
        expectVersion(previous,parsed.expectedVersion,'Observed patient-state review');
        const version=(previous?.version??0)+1;
        const pain={prior:parsed.metrics.pain.prior??null,current:parsed.metrics.pain.current??null,direction:metricDirection('pain',parsed.metrics.pain)};
        const functionMetric={prior:parsed.metrics.function.prior??null,current:parsed.metrics.function.current??null,direction:metricDirection('function',parsed.metrics.function)};
        const sleep={prior:parsed.metrics.sleep.prior??null,current:parsed.metrics.sleep.current??null,direction:metricDirection('sleep',parsed.metrics.sleep)};
        if(Date.parse(parsed.receivedAt)<Date.parse(parsed.collectedAt))throw new Error('Received time cannot be before collection time.');
        if(Date.parse(parsed.receivedAt)>Date.parse(now))throw new Error('Observation times cannot be in the future.');
        for(const source of parsed.sourceObservations??[]){
          if((source.status==='answered'||source.status==='zero')&&source.value===undefined||source.status==='zero'&&source.value!==0||(source.status==='unanswered'||source.status==='declined')&&source.value!==undefined)throw new Error('Observation source status and value must agree.');
          if(Date.parse(source.collectedAt)>Date.parse(now)||source.receivedAt&&(Date.parse(source.receivedAt)<Date.parse(source.collectedAt)||Date.parse(source.receivedAt)>Date.parse(now)))throw new Error('Observation source timestamps are inconsistent.');
          if(context.observationSources){const original=context.observationSources.find(row=>row.entryId===source.entryId);if(!original||JSON.stringify(observationSourceSchema.parse(original))!==JSON.stringify(source))throw new Error('Observation provenance must match the authorized patient encounter source.');}
        }
        const ms=Date.parse(now)-Date.parse(parsed.collectedAt);
        const dataFreshness:'fresh'|'stale'=Number.isFinite(ms)&&ms<=1000*60*60*24*3?'fresh':'stale';
        const record={
          id:createId('decisions-review'),
          patientId:parsed.patientId,
          encounterId:parsed.encounterId,
          inputVersion:parsed.inputVersion,
          version,
          createdAt:previous?.createdAt??now,
          updatedAt:now,
          collectedAt:parsed.collectedAt,
          receivedAt:parsed.receivedAt,
          dataFreshness,
          contradictoryMetrics:[...parsed.contradictoryMetrics],
          provenance:parsed.provenance,
          metrics:{pain,function:functionMetric,sleep},
          clinicalInterpretation:parsed.clinicalInterpretation,
          goal:parsed.goal,
          nextMonitoringQuestion:parsed.nextMonitoringQuestion,
          ...(parsed.sourceObservations?{sourceObservations:structuredClone(parsed.sourceObservations)}:{}),
          ...(parsed.events?{events:structuredClone(parsed.events)}:{}),
          ...(parsed.monitoring?{monitoring:structuredClone(parsed.monitoring)}:{}),
          history:[touchHistory(previous?`v${previous.version}`:'none',`v${version}`,context.actor,now,'Recorded reviewed patient state') ,...(previous?.history??[])],
        };
        candidate.observedReviews.unshift(record);
        return;
      }
      case 'decisions.comparison.capture':{
        ensurePatient(context,parsed.patientId);
        assertInputVersion(candidate,parsed.patientId,parsed.encounterId,parsed.inputVersion,context,now,true);
        assertEvidenceReferences(parsed.options,parsed.evidenceRefs);
        if(Object.values(parsed.preferenceWeights).every(weight=>weight===0))throw new Error('At least one preference weight is required.');
        const previous=latestByScope(candidate.comparisonSnapshots,parsed.patientId,parsed.encounterId);
        expectVersion(previous,parsed.expectedVersion,'Decision comparison snapshot');
        const version=(previous?.version??0)+1;
        const snapshot={
          id:createId('decisions-comparison'),
          patientId:parsed.patientId,
          encounterId:parsed.encounterId,
          inputVersion:parsed.inputVersion,
          version,
          createdAt:previous?.createdAt??now,
          updatedAt:now,
          defaultAction:'no-prescription' as const,
          preferenceSummary:parsed.preferenceSummary,
          preferenceWeights:parsed.preferenceWeights,
          ...(previous?.sourceRunSnapshot&&previous.inputVersion===parsed.inputVersion&&JSON.stringify(previous.sourceRunSnapshot.preferences)===JSON.stringify(parsed.preferenceWeights)?{sourceRunId:previous.sourceRunId,sourceRunSnapshot:structuredClone(previous.sourceRunSnapshot)}:{}),
          options:parsed.options,
          disposition:parsed.disposition,
          rationale:parsed.rationale,
          safetyReview:parsed.safetyReview,
          missingInputs:parsed.missingInputs,
          evidenceRefs:parsed.evidenceRefs,
          history:[touchHistory(previous?`v${previous.version}`:'none',`v${version}`,context.actor,now,'Saved options comparison snapshot'),...(previous?.history??[])],
        };
        candidate.comparisonSnapshots.unshift(snapshot);
        return;
      }
      case 'decisions.outputs.capture':{
        ensurePatient(context,parsed.patientId);
        assertInputVersion(candidate,parsed.patientId,parsed.encounterId,parsed.inputVersion,context,now,true);
        if(parsed.pst.outputId===parsed.shadow.outputId)throw new Error('PST and Shadow must have distinct output identifiers.');
        if(parsed.suitability==='evidence-reviewed'&&(parsed.supportingEvidence.length+parsed.conflictingEvidence.length===0))throw new Error('Evidence-reviewed suitability requires supporting or conflicting evidence references.');
        if(parsed.clarificationWork&&new Set(parsed.clarificationWork.map(work=>work.id)).size!==parsed.clarificationWork.length)throw new Error('Clarification work identifiers must be unique.');
        if(parsed.clarificationWork?.some(work=>!parsed.clarificationRequests.includes(work.title)))throw new Error('Owned clarification work must reference a recorded clarification request.');
        const previous=latestByScope(candidate.engineComparisons,parsed.patientId,parsed.encounterId);
        expectVersion(previous,parsed.expectedVersion,'PST/Shadow disposition output');
        const version=(previous?.version??0)+1;
        const output={
          id:createId('decisions-output'),
          patientId:parsed.patientId,
          encounterId:parsed.encounterId,
          inputVersion:parsed.inputVersion,
          version,
          createdAt:previous?.createdAt??now,
          updatedAt:now,
          pst:parsed.pst,
          shadow:parsed.shadow,
          agreement:parsed.agreement,
          limitations:parsed.limitations,
          supportingEvidence:parsed.supportingEvidence,
          conflictingEvidence:parsed.conflictingEvidence,
          clarificationRequests:parsed.clarificationRequests,
          ...(parsed.clarificationWork?{clarificationWork:structuredClone(parsed.clarificationWork)}:{}),
          clinicianDisposition:parsed.clinicianDisposition,
          dispositionExplanation:parsed.dispositionExplanation,
          suitability:parsed.suitability,
          provenance:parsed.provenance,
          modelVersions:unique(parsed.modelVersions),
          configurationVersions:unique(parsed.configurationVersions),
          ...(previous?.sourceRunSnapshot&&previous.inputVersion===parsed.inputVersion&&previous.provenance===parsed.provenance&&previous.pst.outputId===parsed.pst.outputId&&previous.pst.summary===parsed.pst.summary&&previous.shadow.outputId===parsed.shadow.outputId&&previous.shadow.summary===parsed.shadow.summary?{sourceRunId:previous.sourceRunId,sourceRunSnapshot:structuredClone(previous.sourceRunSnapshot)}:{}),
          history:[touchHistory(previous?`v${previous.version}`:'none',`v${version}`,context.actor,now,'Saved PST and Shadow dispositions'),...(previous?.history??[])],
        };
        candidate.engineComparisons.unshift(output);
        return;
      }
      case 'decisions.draft.save':{
        ensurePatient(context,parsed.patientId);
        assertInputVersion(candidate,parsed.patientId,parsed.encounterId,parsed.expectedInputVersion,context,now);
        const existing=parsed.draftId?candidate.drafts.find(draft=>draft.id===parsed.draftId&&draft.patientId===parsed.patientId&&draft.encounterId===parsed.encounterId):undefined;
        if(parsed.draftId&&!existing)throw new Error('Draft not found in this patient encounter.');
        if(existing&&parsed.expectedVersion===undefined)throw new Error('An expected draft version is required to update an existing draft.');
        if(existing&&['signed','cancelled','disputed'].includes(existing.status))throw new Error('Signed, cancelled, or disputed drafts must use their amendment, retry, or correction workflow.');
        if(parsed.expectedVersion!==undefined)expectVersion(existing,parsed.expectedVersion,'Decision draft');
        const reviewed=reviewedSources(candidate,parsed.patientId,parsed.encounterId,parsed.expectedInputVersion,parsed.payload);
        const diffKeys=existing?Array.from(new Set([...Object.keys(existing.payload),...Object.keys(parsed.payload)]).values()).filter(key=>JSON.stringify(existing.payload[key as keyof typeof existing.payload])!==JSON.stringify(parsed.payload[key as keyof typeof parsed.payload])):Object.keys(parsed.payload);
        if(existing&&existing.summary!==parsed.summary)diffKeys.push('summary');
        if(existing&&existing.expectedInputVersion!==parsed.expectedInputVersion)diffKeys.push('inputVersion');
        const sourceSnapshot=trustedSource(context,parsed.patientId,parsed.encounterId,parsed.expectedInputVersion);
        const version=(existing?.version??0)+1;
        const draft={
          id:existing?.id??createId('decisions-draft'),
          patientId:parsed.patientId,
          encounterId:parsed.encounterId,
          expectedInputVersion:parsed.expectedInputVersion,
          version,
          createdAt:existing?.createdAt??now,
          updatedAt:now,
          status:'saved' as const,
          summary:parsed.summary,
          materialChangeDiff:diffKeys.length?diffKeys:['no-material-change'],
          ...(sourceSnapshot?{sourceSnapshot,sourceChanges:diffDecisionSources(existing?.sourceSnapshot,sourceSnapshot)}:{}),
          payload:parsed.payload,
          reviewedVersions:reviewed.versions,
          history:[touchHistory(existing?`v${existing.version}`:'none',`v${version}`,context.actor,now,'Saved decision draft'),...(existing?.history??[])],
        };
        if(existing)candidate.drafts[candidate.drafts.indexOf(existing)]=draft;else candidate.drafts.unshift(draft);
        return;
      }
      case 'decisions.draft.cancel':
      case 'decisions.draft.retry':{
        ensurePatient(context,parsed.patientId);
        const draft=candidate.drafts.find(row=>row.id===parsed.draftId&&row.patientId===parsed.patientId&&row.encounterId===parsed.encounterId);
        if(!draft)throw new Error('Draft not found.');
        expectVersion(draft,parsed.expectedVersion,'Decision draft');
        if(draft.status==='signed')throw new Error('A signed draft requires an amendment.');
        if(parsed.type==='decisions.draft.retry'&&draft.status!=='cancelled')throw new Error('Only a cancelled draft can be retried.');
        draft.version+=1;
        draft.updatedAt=now;
        draft.status=parsed.type==='decisions.draft.cancel'?'cancelled':'draft';
        draft.history.unshift(touchHistory(`v${parsed.expectedVersion}`,`v${draft.version}`,context.actor,now,parsed.reason));
        return;
      }
      case 'decisions.summary.dispute':
      case 'decisions.summary.correct':{
        ensurePatient(context,parsed.patientId);
        const draft=candidate.drafts.find(row=>row.id===parsed.draftId&&row.patientId===parsed.patientId&&row.encounterId===parsed.encounterId);
        if(!draft)throw new Error('Draft not found.');
        expectVersion(draft,parsed.expectedVersion,'Decision draft');
        if(draft.status==='signed')throw new Error('A signed draft requires an amendment.');
        if(draft.status==='cancelled')throw new Error('Retry a cancelled draft before reviewing its summary.');
        draft.version+=1;
        draft.updatedAt=now;
        if(parsed.type==='decisions.summary.dispute')draft.status='disputed';
        else {
          assertInputVersion(candidate,parsed.patientId,parsed.encounterId,parsed.expectedInputVersion,context,now);
          const reviewed=reviewedSources(candidate,parsed.patientId,parsed.encounterId,parsed.expectedInputVersion,parsed.payload);
          const sourceSnapshot=trustedSource(context,parsed.patientId,parsed.encounterId,parsed.expectedInputVersion);
          if(sourceSnapshot){draft.sourceChanges=diffDecisionSources(draft.sourceSnapshot,sourceSnapshot);draft.sourceSnapshot=sourceSnapshot;}
          draft.status='corrected';
          draft.expectedInputVersion=parsed.expectedInputVersion;
          draft.summary=parsed.summary;
          draft.payload=parsed.payload;
          draft.reviewedVersions=reviewed.versions;
          draft.materialChangeDiff=['summary','reviewed-sources'];
        }
        draft.history.unshift(touchHistory(`v${parsed.expectedVersion}`,`v${draft.version}`,context.actor,now,parsed.reason));
        return;
      }
      case 'decisions.sign.capture':{
        ensurePatient(context,parsed.patientId);
        const patientPlanSnapshot=ensurePlan(context,parsed.patientId,parsed.patientPlanRef);
        const carePackage=trustedCarePackage(context,parsed.patientId,parsed.patientPlanRef);
        const sourceSnapshot=trustedSource(context,parsed.patientId,parsed.encounterId,parsed.expectedInputVersion);
        const draft=candidate.drafts.find(row=>row.id===parsed.draftId&&row.patientId===parsed.patientId&&row.encounterId===parsed.encounterId);
        if(!draft)throw new Error('Draft not found for sign-off.');
        expectVersion(draft,parsed.expectedDraftVersion,'Decision draft');
        if(draft.status!=='saved'&&draft.status!=='corrected')throw new Error('Only a saved or corrected draft can be signed. Resolve dispute, cancellation, or prior sign-off first.');
        if(draft.expectedInputVersion!==parsed.expectedInputVersion)throw new Error('The draft expected input version does not match sign-off input.');
        assertInputVersion(candidate,parsed.patientId,parsed.encounterId,parsed.expectedInputVersion,context,now);
        const currentInput=candidate.inputRevisions.find(row=>row.patientId===parsed.patientId&&row.encounterId===parsed.encounterId)?.inputVersion;
        if(currentInput&&currentInput!==parsed.expectedInputVersion)throw new Error('Input version changed after draft save. Re-review before signing.');
        if(!draft.payload.observedReviewId||!draft.payload.comparisonSnapshotId||!draft.payload.engineComparisonId)throw new Error('Draft must reference reviewed state, comparison, and disposition records before signing.');
        const {observed,comparison,outputs,versions}=reviewedSources(candidate,parsed.patientId,parsed.encounterId,parsed.expectedInputVersion,draft.payload);
        if(!observed||!comparison||!outputs)throw new Error('A reviewed state, comparison snapshot, and PST/Shadow disposition are required before signing.');
        if(JSON.stringify(versions)!==JSON.stringify(draft.reviewedVersions))throw new Error('Reviewed record versions changed after draft save. Save the reviewed draft again before signing.');
        if(parsed.displayedSummary!==draft.summary)throw new Error('The signed summary must exactly match the saved draft displayed for review.');
        if(draft.payload.pendingDisposition!==parsed.disposition)throw new Error('The sign-off disposition must match the saved draft.');
        const evidenceVersions=evidenceVersionsFor(comparison,outputs);
        if(!sameValues(parsed.evidenceVersions,evidenceVersions)||!sameValues(parsed.modelVersions,outputs.modelVersions)||!sameValues(parsed.configurationVersions,outputs.configurationVersions))throw new Error('Signed evidence, model, and configuration versions must match the captured records.');
        const record={
          id:createId('decisions-sign'),
          patientId:parsed.patientId,
          encounterId:parsed.encounterId,
          inputVersion:parsed.expectedInputVersion,
          version:1,
          createdAt:now,
          updatedAt:now,
          actor:context.actor,
          disposition:parsed.disposition,
          rationale:parsed.rationale,
          patientPlanRef:parsed.patientPlanRef,
          ...(patientPlanSnapshot?{patientPlanSnapshot:structuredClone(patientPlanSnapshot)}:{}),
          ...(carePackage?{carePackage:structuredClone(carePackage)}:{}),
          ...(sourceSnapshot?{sourceSnapshot}:{}),
          reviewedInput:{observedReview:structuredClone(observed),comparisonSnapshot:structuredClone(comparison),engineComparison:structuredClone(outputs)},
          evidenceVersions,
          modelVersions:outputs.modelVersions,
          configurationVersions:outputs.configurationVersions,
          displayedOutputs:{summary:draft.summary,pstOutputId:outputs.pst.outputId,shadowOutputId:outputs.shadow.outputId},
          history:[touchHistory('draft',`signed:${parsed.disposition}`,context.actor,now,'Created immutable signed decision snapshot')],
        };
        candidate.signedSnapshots.unshift(record);
        draft.version+=1;
        draft.status='signed';
        draft.signedSnapshotId=record.id;
        draft.updatedAt=now;
        draft.history.unshift(touchHistory(`v${parsed.expectedDraftVersion}`,`v${draft.version}`,context.actor,now,'Signed draft snapshot'));
        return;
      }
      case 'decisions.sign.amend':{
        ensurePatient(context,parsed.patientId);
        const patientPlanSnapshot=ensurePlan(context,parsed.patientId,parsed.patientPlanRef);
        const carePackage=trustedCarePackage(context,parsed.patientId,parsed.patientPlanRef);
        const signed=candidate.signedSnapshots.find(snapshot=>snapshot.id===parsed.signedSnapshotId&&snapshot.patientId===parsed.patientId&&snapshot.encounterId===parsed.encounterId);
        if(!signed)throw new Error('Signed snapshot not found.');
        if(parsed.expectedVersion!==undefined)expectVersion(signed,parsed.expectedVersion,'Signed snapshot');
        if(candidate.signedSnapshots.some(snapshot=>snapshot.amendmentOf===signed.id))throw new Error('This signed snapshot has a later amendment. Amend the latest snapshot.');
        const amendment={...structuredClone(signed),id:createId('decisions-sign-amend'),version:signed.version+1,createdAt:now,updatedAt:now,actor:context.actor,amendmentOf:signed.id,disposition:parsed.disposition,rationale:parsed.rationale,patientPlanRef:parsed.patientPlanRef,patientPlanSnapshot:patientPlanSnapshot?structuredClone(patientPlanSnapshot):undefined};
        if(!patientPlanSnapshot)delete amendment.patientPlanSnapshot;
        if(parsed.patientPlanRef===signed.patientPlanRef&&signed.carePackage)amendment.carePackage=structuredClone(signed.carePackage);
        else if(carePackage)amendment.carePackage=structuredClone(carePackage);else if(parsed.patientPlanRef!==signed.patientPlanRef)delete amendment.carePackage;
        amendment.history=[touchHistory(`signed:${signed.id}`,`amended:${amendment.id}`,context.actor,now,parsed.reason),...amendment.history];
        candidate.signedSnapshots.unshift(amendment);
        return;
      }
      case 'decisions.export.capture':{
        ensurePatient(context,parsed.patientId);
        const authorization=exportAuthorization(context,parsed.audience??'internal');
        const signed=candidate.signedSnapshots.find(snapshot=>snapshot.id===parsed.signedSnapshotId&&snapshot.patientId===parsed.patientId&&snapshot.encounterId===parsed.encounterId);
        if(!signed)throw new Error('Signed snapshot not found.');
        if(authorization.audience!=='internal'&&!signed.carePackage&&!signed.patientPlanSnapshot?.summary)throw new Error('Patient-facing instructions were not captured in this historical decision.');
        const patientPayload={patientId:signed.patientId,patientName:signed.carePackage?.patientName??context.patients.find(row=>row.id===signed.patientId)?.name,encounterId:signed.encounterId,signedSnapshotId:signed.id,historicalVersion:signed.version,signedAt:signed.createdAt,plan:{id:signed.patientPlanRef,instructions:signed.carePackage?.instructions??signed.patientPlanSnapshot?.summary,owner:signed.carePackage?.owner,followUp:signed.carePackage?.followUp},scope:'Patient instructions from the selected historical decision'};
        const payload=authorization.audience==='internal'?{patientId:signed.patientId,encounterId:signed.encounterId,snapshot:signed}:patientPayload;
        const content=parsed.format==='json'?JSON.stringify(payload):authorization.audience!=='internal'?[
          `Patient: ${patientPayload.patientName??signed.patientId}`,
          `Historical decision: ${signed.id} · revision ${signed.version} · ${signed.createdAt}`,
          `Patient instructions: ${patientPayload.plan.instructions}`,
          `Responsible owner: ${patientPayload.plan.owner??'Not recorded'}`,
          `Follow-up: ${patientPayload.plan.followUp?JSON.stringify(patientPayload.plan.followUp):'Not recorded'}`,
          patientPayload.scope,
        ].join('\n'):[
          `Patient: ${signed.patientId}`,
          `Encounter: ${signed.encounterId}`,
          `Disposition: ${signed.disposition}`,
          `Rationale: ${signed.rationale}`,
          `Plan reference: ${signed.patientPlanRef}`,
          `Signed at: ${signed.createdAt} by ${signed.actor}`,
          `Displayed summary: ${signed.displayedOutputs.summary}`,
          `Evidence versions: ${signed.evidenceVersions.join(', ')||'not recorded'}`,
          `Model versions: ${signed.modelVersions.join(', ')||'not recorded'}`,
          `Configuration versions: ${signed.configurationVersions.join(', ')||'not recorded'}`,
          'Exact reviewed records:',
          JSON.stringify(signed.reviewedInput,null,2),
          'Amendment and sign-off history:',
          JSON.stringify(signed.history,null,2),
          ...(signed.carePackage?['Historical plan, instructions and task history:',JSON.stringify(signed.carePackage,null,2)]:[]),
          ...(signed.sourceSnapshot?['Reviewed clinical facts:',JSON.stringify(signed.sourceSnapshot,null,2)]:[]),
        ].join('\n');
        candidate.exports.unshift({id:createId('decisions-export'),requestId:parsed.requestId,patientId:signed.patientId,encounterId:signed.encounterId,signedSnapshotId:signed.id,format:parsed.format,exportedAt:now,actor:context.actor,content,...authorization});
        return;
      }
    }
  };

  const receipt=checkReceipt(candidate,parsed.requestId,{actor:context.actor,action:parsed});
  if(receipt?.duplicate)return next;
  apply();
  if(receipt)candidate.idempotencyReceipts=[{requestId:parsed.requestId,hash:receipt.hash,at:now},...candidate.idempotencyReceipts].slice(0,200);
  return validateState(candidate);
}

export function validateState(state:unknown):State {
  const parsed=stateSchema.parse(state);
  for(const rows of [parsed.observedReviews,parsed.comparisonSnapshots,parsed.engineComparisons,parsed.signedSnapshots,parsed.drafts,parsed.exports,parsed.workingCopies??[]]){
    if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error('Persisted decision record identifiers must be unique.');
  }
  if(new Set(parsed.inputRevisions.map(row=>pair(row.patientId,row.encounterId))).size!==parsed.inputRevisions.length)throw new Error('Persisted source revisions must be unique per patient encounter.');
  for(const snapshot of parsed.signedSnapshots){
    if(snapshot.patientPlanSnapshot&&(snapshot.patientPlanSnapshot.patientId!==snapshot.patientId||snapshot.patientPlanSnapshot.id!==snapshot.patientPlanRef))throw new Error('Signed plan snapshot must match the patient and referenced plan.');
    if(snapshot.carePackage&&(snapshot.carePackage.patientId!==snapshot.patientId||snapshot.carePackage.planId!==snapshot.patientPlanRef))throw new Error('Signed care package must match the patient and referenced plan.');
    if(snapshot.sourceSnapshot&&(snapshot.sourceSnapshot.patientId!==snapshot.patientId||snapshot.sourceSnapshot.encounterId!==snapshot.encounterId||snapshot.sourceSnapshot.inputVersion!==snapshot.inputVersion))throw new Error('Signed clinical facts must match the reviewed patient encounter version.');
    for(const input of Object.values(snapshot.reviewedInput)){
      if(input.patientId!==snapshot.patientId||input.encounterId!==snapshot.encounterId||input.inputVersion!==snapshot.inputVersion)throw new Error('Signed snapshot contains input from another patient, encounter, or source version.');
    }
    if(snapshot.amendmentOf&&!parsed.signedSnapshots.some(original=>original.id===snapshot.amendmentOf&&original.patientId===snapshot.patientId&&original.encounterId===snapshot.encounterId))throw new Error('Amendment must reference a signed snapshot in the same patient encounter.');
  }
  for(const row of [...parsed.comparisonSnapshots,...parsed.engineComparisons]){
    if(row.sourceRunSnapshot&&(row.sourceRunSnapshot.patientId!==row.patientId||row.sourceRunSnapshot.id!==row.sourceRunId))throw new Error('Captured engine run must match the comparison patient and run reference.');
  }
  for(const row of [...parsed.drafts,...(parsed.workingCopies??[])])if(row.sourceSnapshot&&(row.sourceSnapshot.patientId!==row.patientId||row.sourceSnapshot.encounterId!==row.encounterId))throw new Error('Draft source facts must remain in the same patient encounter.');
  for(const row of parsed.workingCopies??[])if(row.pendingAction){
    let pending:Action;try{pending=actionSchema.parse(JSON.parse(row.pendingAction));}catch{throw new Error('Saved pending action is invalid.');}
    if(pending.type==='decisions.working.save'||pending.patientId!==row.patientId||pending.encounterId!==row.encounterId)throw new Error('Saved pending action belongs to another patient encounter.');
  }
  return parsed;
}

export function getSummary(state:State,patientId?:string):{open:number;overdue:number;attention:string[]} {
  const current=validateState(state);
  const scopedDrafts=current.drafts.filter(draft=>!patientId||draft.patientId===patientId);
  const open=scopedDrafts.filter(draft=>draft.status!=='signed'&&draft.status!=='cancelled').length;
  const stale=new Map(current.inputRevisions.map(revision=>[pair(revision.patientId,revision.encounterId),revision.inputVersion]));
  const overdue=scopedDrafts.filter(draft=>draft.status!=='cancelled'&&draft.status!=='signed'&&stale.get(pair(draft.patientId,draft.encounterId))!==undefined&&stale.get(pair(draft.patientId,draft.encounterId))!==draft.expectedInputVersion).length;
  const attention=[
    ...scopedDrafts.filter(draft=>draft.status==='disputed').map(draft=>`Draft ${draft.id} is disputed and needs correction review.`),
    ...scopedDrafts.filter(draft=>draft.status!=='cancelled'&&draft.status!=='signed'&&stale.get(pair(draft.patientId,draft.encounterId))!==undefined&&stale.get(pair(draft.patientId,draft.encounterId))!==draft.expectedInputVersion).map(draft=>`Draft ${draft.id} is stale against input revision.`),
  ];
  return {open,overdue,attention:attention.slice(0,10)};
}
