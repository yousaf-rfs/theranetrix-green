import {z} from 'zod';

const capabilityIds=[
  'assessments',
  'reviewPrompts',
  'digitalTwin',
  'pst',
  'shadow',
  'advisor',
  'pathways',
  'messages',
] as const;
const capabilityDependencies:Partial<Record<(typeof capabilityIds)[number],(typeof capabilityIds)[number]>>={
  digitalTwin:'assessments',
  pst:'digitalTwin',
  shadow:'digitalTwin',
  advisor:'messages',
};
const cadenceValues=['daily','weekly','monthly','quarterly','manual-only'] as const;
const communicationValues=['in-app','phone','email','interpreter','proxy'] as const;
const protocolStatuses=['draft','review-requested','reviewed','changes-required','publication-recorded','retired'] as const;
const evidenceStatuses=['draft','review-requested','approved','changes-required','withdrawn'] as const;
const configurationStatuses=['draft','reviewed','active','inactive'] as const;
const releaseDecisions=['pending','approved','conditional-review','no-go'] as const;
const operationStatuses=['reported','confirmed','reviewed','closed'] as const;
const monitoringStatuses=['reported','reviewed','exported'] as const;
const readinessDecisions=['proposed','conditional-review','no-go'] as const;
const strictObject=<T extends z.ZodRawShape>(shape:T)=>z.object(shape).strict();
const nonEmptyText=(max:number)=>z.string().trim().min(1).max(max);
const optionalText=(max:number)=>z.string().trim().max(max);
const isoDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'Use YYYY-MM-DD dates.').refine((value)=>!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'Use a real calendar date.');
const isoDateTime=z.string().datetime({offset:true});
const capabilitySchema=z.enum(capabilityIds);
export type Capability=z.infer<typeof capabilitySchema>;
const releaseRefSchema=strictObject({releaseId:nonEmptyText(120),artifactVersion:z.number().int().positive()});
export type ReleaseRef=z.infer<typeof releaseRefSchema>;
export const governedEvidenceRefSchema=strictObject({evidenceId:nonEmptyText(120),version:z.number().int().positive()});
export type GovernedEvidenceRef=z.infer<typeof governedEvidenceRefSchema>;
export type GovernedUsage={patientId:string;encounterId:string;sourceId:string;sourceVersion:number;releaseRef?:ReleaseRef;evidenceRefs:GovernedEvidenceRef[]};
const runtimeScopeSchema=strictObject({capabilities:z.array(capabilitySchema).min(1),populationRefs:z.array(nonEmptyText(120)).min(1),permittedRoles:z.array(nonEmptyText(120)).min(1),inputRefs:z.array(nonEmptyText(200)).min(1),outputRefs:z.array(nonEmptyText(200)).min(1),claimRefs:z.array(nonEmptyText(200)).min(1),environment:z.enum(['demo','production'])});
export type RuntimeScope=z.infer<typeof runtimeScopeSchema>;
const protocolPredicateSchema=z.discriminatedUnion('kind',[
  strictObject({kind:z.literal('always')}),
  strictObject({kind:z.literal('step-status'),stepId:nonEmptyText(120),equals:z.literal('completed')}),
  strictObject({kind:z.literal('event'),eventType:nonEmptyText(120)}),
  strictObject({kind:z.literal('review-choice'),choiceId:nonEmptyText(120),equals:nonEmptyText(120)}),
]);
export type ProtocolPredicate=z.infer<typeof protocolPredicateSchema>;
const publicationChecksSchema=strictObject({sourceVersion:nonEmptyText(120),rightsEvidence:nonEmptyText(200),clinicalReview:nonEmptyText(200),implementationReview:nonEmptyText(200),fixtureEvidence:nonEmptyText(200),migrationPolicy:nonEmptyText(1000),rollbackPlan:nonEmptyText(1000)});
const migrationSchema=strictObject({fromAssignmentVersion:z.number().int().positive(),sourceEpisodeVersion:z.number().int().positive().optional(),stageMap:z.array(strictObject({oldStepId:nonEmptyText(120),newStepId:nonEmptyText(120),carryStatus:z.boolean()})).max(40),pendingWork:z.array(strictObject({oldStepId:nonEmptyText(120),disposition:z.enum(['carry','complete','transfer']),owner:nonEmptyText(120),evidenceRef:nonEmptyText(200),acceptedBy:nonEmptyText(120).optional()})).max(40)});
const stepKindSchema=z.enum(['action','decision','handoff']);
const transitionSchema=strictObject({
  id:nonEmptyText(120),
  at:isoDateTime,
  actor:nonEmptyText(200),
  from:nonEmptyText(80),
  to:nonEmptyText(80),
  reason:nonEmptyText(4000),
  evidenceRef:optionalText(200).optional(),
});
export type Transition=z.infer<typeof transitionSchema>;

const requestReceiptSchema=strictObject({
  requestId:nonEmptyText(120),
  actionType:nonEmptyText(120),
  entityType:nonEmptyText(80),
  entityId:nonEmptyText(120),
  expectedVersion:z.number().int().nonnegative().nullable().optional(),
  payloadHash:nonEmptyText(2000000),
  actor:nonEmptyText(200).optional(),
  recordedAt:isoDateTime,
});
export type RequestReceipt=z.infer<typeof requestReceiptSchema>;

const revisionSchema=strictObject({version:z.number().int().positive(),record:z.record(z.unknown())});
const recordBaseSchema=strictObject({
  id:nonEmptyText(120),
  version:z.number().int().positive(),
  createdAt:isoDateTime,
  updatedAt:isoDateTime,
  history:z.array(transitionSchema),
  revisions:z.array(revisionSchema).default([]),
});

const configurationBridgeSchema=strictObject({
  runtimeFeatures:z.record(z.boolean()),
  hiddenByPolicy:z.array(capabilitySchema),
  invalidDependencies:z.array(capabilitySchema),
  notes:z.array(nonEmptyText(500)),
});
const configurationRecordSchema=recordBaseSchema.extend({
  status:z.enum(configurationStatuses),
  title:nonEmptyText(200),
  capabilityChoices:z.array(capabilitySchema).min(1).max(capabilityIds.length),
  allowedCadence:z.array(z.enum(cadenceValues)).min(1).max(cadenceValues.length),
  languages:z.array(nonEmptyText(80)).min(1).max(10),
  communicationSettings:z.array(z.enum(communicationValues)).min(1).max(communicationValues.length),
  displayReferences:z.array(nonEmptyText(200)).max(10),
  safetyEssentials:z.array(nonEmptyText(200)).min(1).max(10),
  nonHideableSafetyEssentials:z.array(nonEmptyText(200)).min(1).max(10),
  reviewNote:optionalText(2000),
  bridge:configurationBridgeSchema,
  baseActiveId:nonEmptyText(120).nullable(),
  baseActiveVersion:z.number().int().nonnegative().nullable(),
  activatedAt:isoDateTime.optional(),
  deactivatedAt:isoDateTime.optional(),
});
export type ConfigurationRecord=z.infer<typeof configurationRecordSchema>;

const protocolStepSchema=strictObject({
  id:nonEmptyText(120),
  title:nonEmptyText(200),
  owner:nonEmptyText(120),
  kind:stepKindSchema,
  prerequisites:z.array(nonEmptyText(120)).max(20),
  nextStepIds:z.array(nonEmptyText(120)).max(20),
  branchStepIds:z.array(nonEmptyText(120)).max(20),
  openQuestion:optionalText(500),
  sourceRef:nonEmptyText(200).optional(),
  transitions:z.array(strictObject({toStepId:nonEmptyText(120),when:protocolPredicateSchema})).max(40).optional(),
  schedule:strictObject({dueAfterDays:z.number().int().min(0).max(3650),channel:z.enum(['manual','in-app','phone','email']),reviewEvidence:nonEmptyText(200)}).optional(),
});
export type ProtocolStep=z.infer<typeof protocolStepSchema>;
const protocolRecordSchema=recordBaseSchema.extend({
  status:z.enum(protocolStatuses),
  title:nonEmptyText(200),
  sampleNotice:nonEmptyText(300),
  owner:nonEmptyText(120),
  evidenceLocator:nonEmptyText(200),
  reviewer:optionalText(120),
  reviewNote:optionalText(2000),
  unresolvedQuestions:z.array(nonEmptyText(500)).max(20),
  steps:z.array(protocolStepSchema).min(1).max(40),
  publicationEvidence:optionalText(200),
  retiredReason:optionalText(2000),
  publicationChecks:publicationChecksSchema.optional(),
});
export type ProtocolRecord=z.infer<typeof protocolRecordSchema>;

const protocolAssignmentSchema=recordBaseSchema.extend({
  patientId:nonEmptyText(120),
  encounterId:nonEmptyText(120).optional(),
  protocolId:nonEmptyText(120),
  protocolVersion:z.number().int().positive(),
  assignmentReason:nonEmptyText(1000),
  protocolSnapshot:protocolRecordSchema.optional(),
  migration:migrationSchema.optional(),
});
export type ProtocolAssignment=z.infer<typeof protocolAssignmentSchema>;

const evidenceSourceSchema=strictObject({
  title:nonEmptyText(200),
  locator:nonEmptyText(200),
  kind:z.enum(['supporting','conflicting']),
  publicationDate:isoDate,
  retracted:z.boolean(),
});
export type EvidenceSource=z.infer<typeof evidenceSourceSchema>;
const evidenceRecordSchema=recordBaseSchema.extend({
  status:z.enum(evidenceStatuses),
  title:nonEmptyText(200),
  indication:nonEmptyText(200),
  population:nonEmptyText(200),
  endpoint:nonEmptyText(200),
  supportingSources:z.array(evidenceSourceSchema).min(1).max(20),
  reviewNote:optionalText(2000),
  rights:z.enum(['owned','licensed','public-summary']),
  rightsExpiry:isoDate.optional(),
  instrumentVersion:optionalText(120),
  approvedTranslation:optionalText(120),
  reviewer:optionalText(120),
  withdrawnReason:optionalText(2000),
});
export type EvidenceRecord=z.infer<typeof evidenceRecordSchema>;

const evaluationSchema=strictObject({
  agreementSummary:nonEmptyText(1000),
  performanceSummary:nonEmptyText(1000),
  limitations:nonEmptyText(2000),
});
const rolloutRecordSchema=strictObject({
  at:isoDateTime,
  actor:nonEmptyText(200),
  note:nonEmptyText(1000),
});
const releaseRecordSchema=recordBaseSchema.extend({
  artifactVersion:z.number().int().positive().default(1),
  decision:z.enum(releaseDecisions),
  title:nonEmptyText(200),
  modelId:nonEmptyText(120),
  softwareId:nonEmptyText(120),
  configurationId:nonEmptyText(120),
  configurationVersion:z.number().int().positive().optional(),
  intendedUse:nonEmptyText(2000),
  evidenceRefIds:z.array(nonEmptyText(120)).max(20),
  evidenceVersions:z.record(z.number().int().positive()).default({}),
  modelClaims:z.array(nonEmptyText(300)).max(20),
  evaluation:evaluationSchema,
  reviewer:optionalText(120),
  reviewNote:optionalText(2000),
  unresolvedConditions:z.array(nonEmptyText(500)).max(20),
  rolloutRecords:z.array(rolloutRecordSchema),
  rollbackRecords:z.array(rolloutRecordSchema),
  reviewRequired:z.boolean(),
  dependencyAlerts:z.array(nonEmptyText(500)).max(20),
  overrideTrainingPolicy:nonEmptyText(200),
});
export type ReleaseRecord=z.infer<typeof releaseRecordSchema>;

const recoveryEventSchema=strictObject({eventId:nonEmptyText(120),service:nonEmptyText(120),patientId:nonEmptyText(120).optional(),owner:nonEmptyText(120),status:z.enum(['missing','replayed','duplicate-disposed','not-required']),sourceReceipt:optionalText(200),evidenceRef:optionalText(200)});
const recoveryCoverageSchema=strictObject({obligationId:nonEmptyText(120),owner:nonEmptyText(120),acceptedBy:optionalText(120),evidenceRef:optionalText(200)});
const reconciliationSchema=strictObject({expectedEventManifestRef:nonEmptyText(200),reconciliationEvidence:nonEmptyText(200),events:z.array(recoveryEventSchema).max(200),coverage:z.array(recoveryCoverageSchema).max(100),correctiveActions:z.array(nonEmptyText(1000)).max(40),remainingRisks:z.array(nonEmptyText(1000)).max(40),reviewer:nonEmptyText(120)});
export type RecoveryReconciliation=z.infer<typeof reconciliationSchema>;

const operationRecordSchema=recordBaseSchema.extend({
  status:z.enum(operationStatuses),
  kind:z.enum(['incident','restore-proof']),
  title:nonEmptyText(200),
  affectedServices:z.array(nonEmptyText(120)).min(1).max(20),
  owner:nonEmptyText(120),
  severity:z.enum(['low','medium','high','critical']),
  actionsTaken:z.array(nonEmptyText(2000)).max(20),
  evidenceRef:nonEmptyText(200),
  restoreOutcome:z.enum(['not-applicable','reported-success','reported-failure']),
  confirmedBy:optionalText(120),
  reviewNote:optionalText(2000),
  closeEvidence:optionalText(200),
  reconciliation:reconciliationSchema.optional(),
});
export type OperationRecord=z.infer<typeof operationRecordSchema>;

const monitoringIntervalSchema=strictObject({startAt:isoDateTime,endAt:isoDateTime,sourceEventId:nonEmptyText(120)});
const monitoringRuleSchema=strictObject({id:nonEmptyText(120),version:nonEmptyText(120),payer:nonEmptyText(120),jurisdiction:nonEmptyText(120),effectiveFrom:isoDate,effectiveTo:isoDate,reviewer:nonEmptyText(120),evidenceRef:nonEmptyText(200)});
const monitoringFindingSchema=strictObject({id:nonEmptyText(500),kind:z.enum(['overlap','missing-documentation']),description:nonEmptyText(500),owner:nonEmptyText(120),disposition:z.enum(['open','resolved','not-applicable']),evidenceRef:optionalText(200)});
export type MonitoringFinding=z.infer<typeof monitoringFindingSchema>;
export type MonitoringInterval=z.infer<typeof monitoringIntervalSchema>;
export type MonitoringRule=z.infer<typeof monitoringRuleSchema>;

const monitoringRecordSchema=recordBaseSchema.extend({
  status:z.enum(monitoringStatuses),
  serviceDate:isoDate,
  activity:nonEmptyText(200),
  source:nonEmptyText(200),
  evidenceRef:nonEmptyText(200),
  missingDocumentation:z.array(nonEmptyText(300)).max(20),
  reviewer:optionalText(120),
  reviewNote:optionalText(2000),
  duplicateKey:nonEmptyText(500),
  patientId:nonEmptyText(120).optional(),
  performerId:nonEmptyText(120).optional(),
  serviceCode:nonEmptyText(120).optional(),
  intervals:z.array(monitoringIntervalSchema).max(100).optional(),
  ruleRef:monitoringRuleSchema.optional(),
  findings:z.array(monitoringFindingSchema).max(200).default([]),
  decision:z.enum(['pending','accept','reject','clarify']).default('pending'),
  exportRecords:z.array(strictObject({at:isoDateTime,actor:nonEmptyText(200),evidenceRef:nonEmptyText(200),recordVersion:z.number().int().positive(),snapshot:z.record(z.unknown())})).default([]),
});
export type MonitoringRecord=z.infer<typeof monitoringRecordSchema>;

const gateSchema=strictObject({
  id:nonEmptyText(120),
  title:nonEmptyText(200),
  required:z.boolean(),
  disposition:z.enum(['open','satisfied','waived']),
  evidenceRef:optionalText(200),
});
export type ReadinessGate=z.infer<typeof gateSchema>;
const readinessRecordSchema=recordBaseSchema.extend({
  decision:z.enum(readinessDecisions),
  title:nonEmptyText(200),
  functions:z.array(nonEmptyText(200)).min(1).max(20),
  claims:z.array(nonEmptyText(300)).min(1).max(20),
  partnerAssets:z.array(nonEmptyText(200)).max(20),
  partnerRights:z.array(nonEmptyText(200)).max(20),
  partnerResponsibilities:z.array(nonEmptyText(200)).max(20),
  evidenceRefIds:z.array(nonEmptyText(120)).max(20),
  evidenceVersions:z.record(z.number().int().positive()).default({}),
  blockingConditions:z.array(nonEmptyText(500)).max(20),
  mandatoryGates:z.array(gateSchema).min(1).max(20),
  reviewer:optionalText(120),
  reviewEvidence:optionalText(200),
  reviewNote:optionalText(2000),
  reviewRequired:z.boolean(),
  dependencyAlerts:z.array(nonEmptyText(500)).max(20),
  regulatoryAuthorizationNote:nonEmptyText(300),
  releaseRef:releaseRefSchema.optional(),
  scope:runtimeScopeSchema.optional(),
});
export type ReadinessRecord=z.infer<typeof readinessRecordSchema>;

const recallSubjectSchema=z.discriminatedUnion('kind',[
  strictObject({kind:z.literal('release'),id:nonEmptyText(120),artifactVersion:z.number().int().positive()}),
  strictObject({kind:z.literal('evidence'),id:nonEmptyText(120),version:z.number().int().positive()}),
]);
const recallImpactSchema=strictObject({id:nonEmptyText(500),patientId:nonEmptyText(120),encounterId:nonEmptyText(120),sourceId:nonEmptyText(120),sourceVersion:z.number().int().positive(),owner:nonEmptyText(120),disposition:z.enum(['pending','reviewed-no-change','reviewed-plan-amended','accepted-transfer']),evidenceRef:optionalText(200),reviewer:optionalText(120),acceptedBy:optionalText(120),planRef:optionalText(200)});
const recallRecordSchema=recordBaseSchema.extend({status:z.enum(['open','closed']),subject:recallSubjectSchema,reason:nonEmptyText(2000),owner:nonEmptyText(120),evidenceRef:nonEmptyText(200),impacts:z.array(recallImpactSchema),usageCoverage:z.enum(['complete','partial']),coverageEvidence:optionalText(200)});
export type RecallRecord=z.infer<typeof recallRecordSchema>;

const stateSchema=strictObject({
  activeConfigurationId:nonEmptyText(120).nullable(),
  configurations:z.array(configurationRecordSchema),
  protocols:z.array(protocolRecordSchema),
  protocolAssignments:z.array(protocolAssignmentSchema),
  evidences:z.array(evidenceRecordSchema),
  releases:z.array(releaseRecordSchema),
  operations:z.array(operationRecordSchema),
  monitoring:z.array(monitoringRecordSchema),
  readiness:z.array(readinessRecordSchema),
  recalls:z.array(recallRecordSchema).default([]),
  receipts:z.array(requestReceiptSchema).max(200),
});
export type State=z.infer<typeof stateSchema>;

export function initialState():State{
  return {
    activeConfigurationId:null,
    configurations:[],
    protocols:[],
    protocolAssignments:[],
    evidences:[],
    releases:[],
    operations:[],
    monitoring:[],
    readiness:[],
    recalls:[],
    receipts:[],
  };
}

const configurationPayloadSchema=strictObject({
  title:nonEmptyText(200),
  capabilityChoices:z.array(capabilitySchema).min(1).max(capabilityIds.length),
  allowedCadence:z.array(z.enum(cadenceValues)).min(1).max(cadenceValues.length),
  languages:z.array(nonEmptyText(80)).min(1).max(10),
  communicationSettings:z.array(z.enum(communicationValues)).min(1).max(communicationValues.length),
  displayReferences:z.array(nonEmptyText(200)).max(10),
  safetyEssentials:z.array(nonEmptyText(200)).min(1).max(10),
  nonHideableSafetyEssentials:z.array(nonEmptyText(200)).min(1).max(10),
  reviewNote:optionalText(2000).optional(),
});
const protocolPayloadSchema=strictObject({
  title:nonEmptyText(200),
  owner:nonEmptyText(120),
  evidenceLocator:nonEmptyText(200),
  unresolvedQuestions:z.array(nonEmptyText(500)).max(20),
  steps:z.array(protocolStepSchema).min(1).max(40),
  publicationChecks:publicationChecksSchema.optional(),
});
const evidencePayloadSchema=strictObject({
  title:nonEmptyText(200),
  indication:nonEmptyText(200),
  population:nonEmptyText(200),
  endpoint:nonEmptyText(200),
  supportingSources:z.array(evidenceSourceSchema).min(1).max(20),
  rights:z.enum(['owned','licensed','public-summary']),
  rightsExpiry:isoDate.optional(),
  instrumentVersion:optionalText(120).optional(),
  approvedTranslation:optionalText(120).optional(),
  reviewNote:optionalText(2000).optional(),
});
const releasePayloadSchema=strictObject({
  title:nonEmptyText(200),
  modelId:nonEmptyText(120),
  softwareId:nonEmptyText(120),
  configurationId:nonEmptyText(120),
  intendedUse:nonEmptyText(2000),
  evidenceRefIds:z.array(nonEmptyText(120)).max(20),
  modelClaims:z.array(nonEmptyText(300)).max(20),
  evaluation:evaluationSchema,
  unresolvedConditions:z.array(nonEmptyText(500)).max(20),
  overrideTrainingPolicy:nonEmptyText(200),
});
const operationPayloadSchema=strictObject({
  title:nonEmptyText(200),
  kind:z.enum(['incident','restore-proof']),
  affectedServices:z.array(nonEmptyText(120)).min(1).max(20),
  owner:nonEmptyText(120),
  severity:z.enum(['low','medium','high','critical']),
  actionsTaken:z.array(nonEmptyText(2000)).max(20),
  evidenceRef:nonEmptyText(200),
  restoreOutcome:z.enum(['not-applicable','reported-success','reported-failure']),
});
const monitoringPayloadSchema=strictObject({
  serviceDate:isoDate,
  activity:nonEmptyText(200),
  source:nonEmptyText(200),
  evidenceRef:nonEmptyText(200),
  missingDocumentation:z.array(nonEmptyText(300)).max(20),
  patientId:nonEmptyText(120).optional(),
  performerId:nonEmptyText(120).optional(),
  serviceCode:nonEmptyText(120).optional(),
  intervals:z.array(monitoringIntervalSchema).min(1).max(100).optional(),
  ruleRef:monitoringRuleSchema.optional(),
});
const readinessPayloadSchema=strictObject({
  title:nonEmptyText(200),
  functions:z.array(nonEmptyText(200)).min(1).max(20),
  claims:z.array(nonEmptyText(300)).min(1).max(20),
  partnerAssets:z.array(nonEmptyText(200)).max(20),
  partnerRights:z.array(nonEmptyText(200)).max(20),
  partnerResponsibilities:z.array(nonEmptyText(200)).max(20),
  evidenceRefIds:z.array(nonEmptyText(120)).max(20),
  blockingConditions:z.array(nonEmptyText(500)).max(20),
  mandatoryGates:z.array(gateSchema).min(1).max(20),
  releaseRef:releaseRefSchema.optional(),
  scope:runtimeScopeSchema.optional(),
});

export const actionSchema=z.discriminatedUnion('type',[
  strictObject({type:z.literal('program-governance.configuration-save-draft'),requestId:nonEmptyText(120),id:nonEmptyText(120).optional(),expectedVersion:z.number().int().positive().optional(),record:configurationPayloadSchema}),
  strictObject({type:z.literal('program-governance.configuration-review'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),reviewNote:nonEmptyText(2000)}),
  strictObject({type:z.literal('program-governance.configuration-activate'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),reason:nonEmptyText(2000)}),
  strictObject({type:z.literal('program-governance.configuration-deactivate'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),reason:nonEmptyText(2000)}),

  strictObject({type:z.literal('program-governance.protocol-save-draft'),requestId:nonEmptyText(120),id:nonEmptyText(120).optional(),expectedVersion:z.number().int().positive().optional(),record:protocolPayloadSchema}),
  strictObject({type:z.literal('program-governance.protocol-request-review'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),reason:nonEmptyText(2000)}),
  strictObject({type:z.literal('program-governance.protocol-record-review'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),outcome:z.enum(['reviewed','changes-required']),reviewer:nonEmptyText(120),evidenceLocator:nonEmptyText(200),reason:nonEmptyText(2000)}),
  strictObject({type:z.literal('program-governance.protocol-record-publication'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),evidenceRef:nonEmptyText(200),reason:nonEmptyText(2000)}),
  strictObject({type:z.literal('program-governance.protocol-retire'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),evidenceRef:nonEmptyText(200),reason:nonEmptyText(2000)}),
  strictObject({type:z.literal('program-governance.protocol-assign-episode'),requestId:nonEmptyText(120),patientId:nonEmptyText(120),encounterId:nonEmptyText(120).optional(),protocolId:nonEmptyText(120),expectedProtocolVersion:z.number().int().positive(),expectedAssignmentVersion:z.number().int().nonnegative().optional(),reason:nonEmptyText(2000)}),
  strictObject({type:z.literal('program-governance.protocol-migrate-episode'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),expectedEpisodeVersion:z.number().int().positive().optional(),targetProtocolId:nonEmptyText(120),expectedProtocolVersion:z.number().int().positive(),stageMap:migrationSchema.shape.stageMap,pendingWork:migrationSchema.shape.pendingWork,reason:nonEmptyText(2000),evidenceRef:nonEmptyText(200)}),

  strictObject({type:z.literal('program-governance.evidence-save-draft'),requestId:nonEmptyText(120),id:nonEmptyText(120).optional(),expectedVersion:z.number().int().positive().optional(),record:evidencePayloadSchema}),
  strictObject({type:z.literal('program-governance.evidence-request-review'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),reason:nonEmptyText(2000)}),
  strictObject({type:z.literal('program-governance.evidence-record-review'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),outcome:z.enum(['approved','changes-required']),reviewer:nonEmptyText(120),reason:nonEmptyText(2000)}),
  strictObject({type:z.literal('program-governance.evidence-withdraw'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),reason:nonEmptyText(2000)}),

  strictObject({type:z.literal('program-governance.release-save-draft'),requestId:nonEmptyText(120),id:nonEmptyText(120).optional(),expectedVersion:z.number().int().positive().optional(),record:releasePayloadSchema}),
  strictObject({type:z.literal('program-governance.release-record-review'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),reviewer:nonEmptyText(120),decision:z.enum(['approved','conditional-review','no-go']),unresolvedConditions:z.array(nonEmptyText(500)).max(20),reason:nonEmptyText(2000)}),
  strictObject({type:z.literal('program-governance.release-record-rollout'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),note:nonEmptyText(1000)}),
  strictObject({type:z.literal('program-governance.release-record-rollback'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),note:nonEmptyText(1000)}),

  strictObject({type:z.literal('program-governance.operation-report'),requestId:nonEmptyText(120),id:nonEmptyText(120).optional(),expectedVersion:z.number().int().positive().optional(),record:operationPayloadSchema}),
  strictObject({type:z.literal('program-governance.operation-confirm'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),owner:nonEmptyText(120),severity:z.enum(['low','medium','high','critical']),reason:nonEmptyText(2000)}),
  strictObject({type:z.literal('program-governance.operation-review'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),evidenceRef:nonEmptyText(200),reason:nonEmptyText(2000)}),
  strictObject({type:z.literal('program-governance.operation-close'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),evidenceRef:nonEmptyText(200),reason:nonEmptyText(2000)}),
  strictObject({type:z.literal('program-governance.operation-reconcile'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),record:reconciliationSchema,reason:nonEmptyText(2000)}),

  strictObject({type:z.literal('program-governance.monitoring-record-service'),requestId:nonEmptyText(120),id:nonEmptyText(120).optional(),expectedVersion:z.number().int().positive().optional(),record:monitoringPayloadSchema}),
  strictObject({type:z.literal('program-governance.monitoring-record-review'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),reason:nonEmptyText(2000)}),
  strictObject({type:z.literal('program-governance.monitoring-record-decision'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),decision:z.enum(['accept','reject','clarify']),findings:z.array(monitoringFindingSchema).max(200),reason:nonEmptyText(2000)}),
  strictObject({type:z.literal('program-governance.monitoring-export'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),evidenceRef:nonEmptyText(200)}),

  strictObject({type:z.literal('program-governance.recall-open'),requestId:nonEmptyText(120),subject:recallSubjectSchema,expectedSubjectVersion:z.number().int().positive(),owner:nonEmptyText(120),reason:nonEmptyText(2000),evidenceRef:nonEmptyText(200)}),
  strictObject({type:z.literal('program-governance.recall-review-impact'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),impactId:nonEmptyText(500),disposition:z.enum(['reviewed-no-change','reviewed-plan-amended','accepted-transfer']),evidenceRef:nonEmptyText(200),reason:nonEmptyText(2000),acceptedBy:nonEmptyText(120).optional(),planRef:nonEmptyText(200).optional()}),
  strictObject({type:z.literal('program-governance.recall-review-coverage'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),evidenceRef:nonEmptyText(200),reason:nonEmptyText(2000)}),
  strictObject({type:z.literal('program-governance.recall-close'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),evidenceRef:nonEmptyText(200),reason:nonEmptyText(2000)}),

  strictObject({type:z.literal('program-governance.readiness-save-draft'),requestId:nonEmptyText(120),id:nonEmptyText(120).optional(),expectedVersion:z.number().int().positive().optional(),record:readinessPayloadSchema}),
  strictObject({type:z.literal('program-governance.readiness-record-decision'),requestId:nonEmptyText(120),id:nonEmptyText(120),expectedVersion:z.number().int().positive(),reviewer:nonEmptyText(120),decision:z.enum(readinessDecisions),blockingConditions:z.array(nonEmptyText(500)).max(20),mandatoryGates:z.array(gateSchema).min(1).max(20),reviewEvidence:nonEmptyText(200),reason:nonEmptyText(2000)}),
]);
export type Action=z.infer<typeof actionSchema>;

export type Context={
  actor:string;
  now:string;
  patients:readonly {id:string;name:string}[];
  features:Readonly<Record<string, boolean>>;
  governedUsages?:readonly GovernedUsage[];
  usageCoverage?:'complete'|'partial';
  protocolEpisodes?:readonly {assignmentId:string;version?:number;patientId:string;encounterId:string;stages:readonly {id:string;status:string;owner:string}[]}[];
  patientPathways?:readonly {id?:string;version?:number;protocolAssignmentId?:string;patientId:string;encounterId:string;stages:readonly {id:string;status:string;owner:string}[]}[];
};

function payloadHash(action:Action){return JSON.stringify(action);}
function transition(from:string,to:string,reason:string,context:Context,evidenceRef?:string):Transition{
  return {id:crypto.randomUUID(),at:context.now,actor:context.actor,from,to,reason,evidenceRef};
}
function nextVersion<T extends {version:number;updatedAt:string;history:Transition[];revisions:z.infer<typeof revisionSchema>[]}>(record:T,status:string,reason:string,context:Context,evidenceRef?:string,fields?:Partial<T>):T{
  const fromStatus='status' in record&&typeof record.status==='string'?record.status:'decision' in record&&typeof record.decision==='string'?record.decision:'protocolVersion' in record?String(record.protocolVersion):status;
  const {history:priorHistory,revisions:priorRevisions,...snapshot}=record;
  return {
    ...record,
    ...(fields??{}),
    version:record.version+1,
    updatedAt:context.now,
    history:[transition(String(fromStatus),status,reason,context,evidenceRef),...priorHistory],
    revisions:[{version:record.version,record:structuredClone(snapshot)},...priorRevisions],
  };
}
function recordCreateBase(context:Context,status='draft'){return {id:crypto.randomUUID(),version:1,createdAt:context.now,updatedAt:context.now,history:[transition('created',status,'Record created',context)],revisions:[]};}
function ensurePatient(context:Context,patientId:string){
  if(!context.patients.some((patient)=>patient.id===patientId))throw new Error('Patient not found in the current launch context.');
}
function findRecord<T extends {id:string}>(records:T[],id:string,label:string){
  const record=records.find((entry)=>entry.id===id);
  if(!record)throw new Error(`${label} not found.`);
  return record;
}
function requireVersion(version:number,expected:number,label:string){
  if(version!==expected)throw new Error(`${label} changed. Reload the latest version before saving again.`);
}
function remember(state:State,action:Action,entityType:string,entityId:string,context:Context,expectedVersion?:number|null):State{
  const hash=payloadHash(action);
  const existing=state.receipts.find((receipt)=>receipt.requestId===action.requestId);
  if(existing){
    if(existing.payloadHash!==hash)throw new Error('requestId was already used for a different payload.');
    return state;
  }
  return validateState({
    ...refreshDependencies(state,context),
    receipts:[{requestId:action.requestId,actionType:action.type,entityType,entityId,expectedVersion:expectedVersion??null,payloadHash:hash,recordedAt:context.now,actor:context.actor},...state.receipts].slice(0,200),
  });
}
function dependencyBlocks(capabilities:readonly (typeof capabilityIds)[number][],features:Readonly<Record<string, boolean>>){
  const selected=new Set(capabilities);
  const hiddenByPolicy:ConfigurationRecord['bridge']['hiddenByPolicy']=[];
  const invalidDependencies:ConfigurationRecord['bridge']['invalidDependencies']=[];
  const notes:string[]=[];
  for(const capability of capabilities){
    if(!features[capability]){
      hiddenByPolicy.push(capability);
      notes.push(`${capability} is hidden by the current approved runtime feature policy.`);
    }
    const dependency=capabilityDependencies[capability];
    if(dependency&&!selected.has(dependency)){
      invalidDependencies.push(capability);
      notes.push(`${capability} requires ${dependency}.`);
    }
  }
  return {runtimeFeatures:Object.fromEntries(Object.entries(features).map(([key,value])=>[key,!!value])),hiddenByPolicy,invalidDependencies,notes};
}
function validateProtocolTopology(steps:readonly ProtocolStep[],unresolvedQuestions:readonly string[],requireResolved=true){
  const ids=new Set(steps.map((step)=>step.id));
  if(ids.size!==steps.length)throw new Error('Protocol step IDs must be unique.');
  const missingTargets:string[]=[];
  for(const step of steps){
    const targets=[...step.prerequisites,...step.nextStepIds,...step.branchStepIds,...(step.transitions??[]).flatMap(edge=>[edge.toStepId,...(edge.when.kind==='step-status'?[edge.when.stepId]:[])])];
    for(const target of targets)if(!ids.has(target))missingTargets.push(`${step.id} -> ${target}`);
  }
  if(missingTargets.length)throw new Error(`Protocol has missing step targets: ${missingTargets.join(', ')}.`);
  const graph=new Map<string,string[]>();
  for(const step of steps)graph.set(step.id,[...step.nextStepIds,...step.branchStepIds,...(step.transitions??[]).map(edge=>edge.toStepId)]);
  for(const step of steps)for(const prerequisite of step.prerequisites)graph.get(prerequisite)?.push(step.id);
  const visiting=new Set<string>(),visited=new Set<string>();
  const visit=(id:string)=>{
    if(visiting.has(id))throw new Error(`Protocol contains a cycle at step ${id}.`);
    if(visited.has(id))return;
    visiting.add(id);
    for(const next of graph.get(id)??[])visit(next);
    visiting.delete(id);
    visited.add(id);
  };
  for(const id of ids)visit(id);
  const stepQuestions=steps.filter((step)=>step.openQuestion).map((step)=>step.id);
  if(requireResolved&&(unresolvedQuestions.length||stepQuestions.length))throw new Error(`Resolve all protocol questions before continuing (${[...stepQuestions,...unresolvedQuestions].join(', ')}).`);
}
export function evaluateProtocolPredicate(predicate:ProtocolPredicate,context:{stages:readonly {id:string;status:string}[];eventType?:string;reviewChoices?:Readonly<Record<string,string>>}):boolean{
  switch(predicate.kind){
    case 'always':return true;
    case 'step-status':return context.stages.some(step=>step.id===predicate.stepId&&step.status===predicate.equals);
    case 'event':return context.eventType===predicate.eventType;
    case 'review-choice':return context.reviewChoices?.[predicate.choiceId]===predicate.equals;
  }
}
function evidenceExpired(record:EvidenceRecord,now:string){
  return !!record.rightsExpiry&&record.rightsExpiry<=now.slice(0,10);
}
function evidenceUsable(record:EvidenceRecord,now:string){
  return record.status==='approved'&&!evidenceExpired(record,now)&&record.supportingSources.some((source)=>source.kind==='supporting'&&!source.retracted)&&!record.supportingSources.some((source)=>source.kind==='supporting'&&(source.retracted||source.publicationDate>now.slice(0,10)));
}
function ensureEvidenceRefs(state:State,evidenceRefIds:readonly string[],now:string,{usable}:{usable:boolean}){
  const evidences=evidenceRefIds.map((id)=>{
    const record=state.evidences.find((entry)=>entry.id===id);
    if(!record)throw new Error(`Evidence record ${id} not found.`);
    return record;
  });
  if(usable&&evidences.some((record)=>!evidenceUsable(record,now)))throw new Error('Current approval requires reviewed, non-expired, non-withdrawn evidence.');
  return evidences;
}
function ensureSafeText(value:string,label:string){
  if(/\b(password|secret|api[_ -]?key|token|credential)\b/i.test(value))throw new Error(`${label} must not include credentials or secret material.`);
}
function sanitizeOperationPayload(payload:z.infer<typeof operationPayloadSchema>){
  ensureSafeText(payload.title,'Operation title');
  ensureSafeText(payload.evidenceRef,'Operation evidence');
  payload.actionsTaken.forEach((entry)=>ensureSafeText(entry,'Operation action'));
}
function activeConfiguration(state:State){
  return state.activeConfigurationId?state.configurations.find((entry)=>entry.id===state.activeConfigurationId):undefined;
}
function evidenceVersions(state:State,ids:readonly string[]){
  return Object.fromEntries(ids.map((id)=>[id,findRecord(state.evidences,id,'Evidence record').version]));
}
function validateSafety(record:z.infer<typeof configurationPayloadSchema>,active?:ConfigurationRecord){
  if(new Set(record.capabilityChoices).size!==record.capabilityChoices.length)throw new Error('Capability choices must be unique.');
  const essentials=new Set(record.safetyEssentials);
  if(record.nonHideableSafetyEssentials.some((item)=>!essentials.has(item)))throw new Error('Non-hideable safety essentials must remain visible.');
  if(active?.nonHideableSafetyEssentials.some((item)=>!essentials.has(item)||!record.nonHideableSafetyEssentials.includes(item)))throw new Error('The active configuration\'s non-hideable safety essentials cannot be removed.');
}
function validateGates(gates:ReadinessGate[],prior?:ReadinessGate[]){
  if(new Set(gates.map((gate)=>gate.id)).size!==gates.length)throw new Error('Readiness gate IDs must be unique.');
  if(!gates.some((gate)=>gate.required))throw new Error('Readiness must contain a required gate.');
  if(prior?.some((gate)=>gate.required&&!gates.some((next)=>next.id===gate.id&&next.required&&next.title===gate.title)))throw new Error('Required readiness gates cannot be removed, renamed, or made optional.');
  if(gates.some((gate)=>gate.disposition!=='open'&&!gate.evidenceRef))throw new Error('Each satisfied or waived mandatory gate requires named review evidence.');
}
function releaseDependencyReasons(state:State,record:ReleaseRecord,now:string,features?:Context['features']){
  const reasons:string[]=[];
  const configuration=state.configurations.find((entry)=>entry.id===record.configurationId);
  if(!configuration||configuration.status!=='active'||state.activeConfigurationId!==configuration.id||(record.configurationVersion!==undefined&&record.configurationVersion!==configuration.version))reasons.push('Referenced configuration is no longer the active reviewed version.');
  if(configuration&&features){const bridge=dependencyBlocks(configuration.capabilityChoices,features);if(bridge.hiddenByPolicy.length||bridge.invalidDependencies.length)reasons.push('Current runtime policy blocks the referenced configuration.');}
  for(const id of record.evidenceRefIds){const evidence=state.evidences.find((entry)=>entry.id===id);if(!evidence||!evidenceUsable(evidence,now)||(record.evidenceVersions[id]!==undefined&&record.evidenceVersions[id]!==evidence.version))reasons.push(`Dependent evidence ${evidence?.title??id} now requires review.`);}
  if(state.recalls.some(recall=>recall.subject.kind==='release'?recall.subject.id===record.id&&recall.subject.artifactVersion===record.artifactVersion:record.evidenceVersions[recall.subject.id]===recall.subject.version))reasons.push('A recalled release artifact or supporting evidence version suspends this release.');
  return reasons;
}
function readinessDependencyReasons(state:State,record:ReadinessRecord,now:string){
  const reasons=record.evidenceRefIds.flatMap((id)=>{const evidence=state.evidences.find((entry)=>entry.id===id);return !evidence||!evidenceUsable(evidence,now)||(record.evidenceVersions[id]!==undefined&&record.evidenceVersions[id]!==evidence.version)?[`Dependent evidence ${evidence?.title??id} now requires review.`]:[];});
  if(state.recalls.some(recall=>recall.subject.kind==='evidence'&&record.evidenceVersions[recall.subject.id]===recall.subject.version))reasons.push('A recalled supporting evidence version suspends this readiness scope.');
  if(record.releaseRef){const release=state.releases.find(item=>item.id===record.releaseRef!.releaseId);if(!release||release.artifactVersion!==record.releaseRef.artifactVersion||release.decision!=='approved'||release.reviewRequired||releaseDependencyReasons(state,release,now).length)reasons.push('The exact release artifact now requires review.');}
  else if(record.decision==='proposed')reasons.push('Readiness needs an exact release artifact reference.');
  if(record.decision==='proposed'&&!record.scope)reasons.push('Readiness needs an explicit runtime scope.');
  return reasons;
}

export type RuntimeUseInput={capability:Capability;releaseRef?:ReleaseRef;evidenceRefs?:readonly GovernedEvidenceRef[];populationRef?:string;role?:string;environment:'demo'|'production'};
export function evaluateRuntimeUse(input:State,request:RuntimeUseInput,context:Pick<Context,'now'|'features'>):{allowed:boolean;reasons:string[];releaseRef?:ReleaseRef}{
  const state=validateState(input),reasons:string[]=[];
  const featureAllowed=(key:Capability):boolean=>!!context.features[key]&&(!capabilityDependencies[key]||featureAllowed(capabilityDependencies[key]!));
  if(!featureAllowed(request.capability))reasons.push('The capability or a required dependency is disabled by workspace policy.');
  // Existing demo workspaces may remain unconfigured. Production always requires explicit scope.
  const configured=!!state.activeConfigurationId||state.releases.length>0||state.readiness.length>0||state.recalls.length>0;
  if(!configured&&request.environment==='demo'&&!request.releaseRef&&!request.evidenceRefs?.length)return {allowed:reasons.length===0,reasons};
  const active=activeConfiguration(state);
  if(!active||active.status!=='active'||!active.capabilityChoices.includes(request.capability))reasons.push('The active configuration does not permit this capability.');
  if(active){const bridge=dependencyBlocks(active.capabilityChoices,context.features);if(bridge.invalidDependencies.length||bridge.hiddenByPolicy.length)reasons.push('The active configuration has blocked dependencies.');}
  const matches=state.readiness.filter(record=>record.decision==='proposed'&&!record.reviewRequired&&record.releaseRef&&record.scope&&record.scope.environment===request.environment&&record.scope.capabilities.includes(request.capability)&&!!request.populationRef&&record.scope.populationRefs.includes(request.populationRef)&&!!request.role&&record.scope.permittedRoles.includes(request.role)&&!readinessDependencyReasons(state,record,context.now).length&&(!request.releaseRef||record.releaseRef.releaseId===request.releaseRef.releaseId&&record.releaseRef.artifactVersion===request.releaseRef.artifactVersion));
  const refs=new Map(matches.map(record=>[`${record.releaseRef!.releaseId}:${record.releaseRef!.artifactVersion}`,record.releaseRef!]));
  const ref=request.releaseRef??(refs.size===1?[...refs.values()][0]:undefined);
  if(!ref||!matches.some(record=>record.releaseRef!.releaseId===ref.releaseId&&record.releaseRef!.artifactVersion===ref.artifactVersion))reasons.push('An exact reviewed release and matching population, role, and environment scope are required.');
  const release=ref?state.releases.find(record=>record.id===ref.releaseId&&record.artifactVersion===ref.artifactVersion):undefined;
  if(ref&&(!release||release.decision!=='approved'||release.reviewRequired||releaseDependencyReasons(state,release,context.now,context.features).length))reasons.push('The selected release artifact is not currently usable.');
  const evidenceRefs=[...(request.evidenceRefs??[]),...Object.entries(release?.evidenceVersions??{}).map(([evidenceId,version])=>({evidenceId,version}))];
  for(const evidenceRef of evidenceRefs){const evidence=state.evidences.find(record=>record.id===evidenceRef.evidenceId);if(!evidence||evidence.version!==evidenceRef.version||!evidenceUsable(evidence,context.now))reasons.push(`Evidence ${evidenceRef.evidenceId} is no longer usable at the referenced version.`);}
  if(state.recalls.some(recall=>recall.subject.kind==='release'?!!ref&&recall.subject.id===ref.releaseId&&recall.subject.artifactVersion===ref.artifactVersion:evidenceRefs.some(evidence=>evidence.evidenceId===recall.subject.id&&recall.subject.kind==='evidence'&&evidence.version===recall.subject.version)))reasons.push('A recall suspends new use of the referenced artifact. Closing patient review work does not reinstate it.');
  return {allowed:reasons.length===0,reasons:[...new Set(reasons)],...(ref?{releaseRef:ref}:{})};
}

function usageMatches(state:State,usage:GovernedUsage,subject:RecallRecord['subject']){
  if(subject.kind==='release')return usage.releaseRef?.releaseId===subject.id&&usage.releaseRef.artifactVersion===subject.artifactVersion;
  if(usage.evidenceRefs.some(ref=>ref.evidenceId===subject.id&&ref.version===subject.version))return true;
  const release=state.releases.find(record=>record.id===usage.releaseRef?.releaseId);
  if(!release||!usage.releaseRef)return false;
  if(release.artifactVersion===usage.releaseRef.artifactVersion)return release.evidenceVersions[subject.id]===subject.version;
  return release.revisions.some(revision=>(revision.record.artifactVersion??1)===usage.releaseRef!.artifactVersion&&(revision.record.evidenceVersions as Record<string,number>|undefined)?.[subject.id]===subject.version);
}
function recallImpacts(state:State,subject:RecallRecord['subject'],owner:string,context:Context):RecallRecord['impacts']{
  const seen=new Set<string>();
  return (context.governedUsages??[]).filter(usage=>usageMatches(state,usage,subject)).flatMap(usage=>{
    ensurePatient(context,usage.patientId);
    const id=`${usage.patientId}:${usage.encounterId}:${usage.sourceId}:v${usage.sourceVersion}`;
    if(seen.has(id))return [];seen.add(id);
    return [{id,patientId:usage.patientId,encounterId:usage.encounterId,sourceId:usage.sourceId,sourceVersion:usage.sourceVersion,owner,disposition:'pending' as const,evidenceRef:'',reviewer:'',acceptedBy:'',planRef:''}];
  });
}
function openRecall(state:State,subject:RecallRecord['subject'],owner:string,reason:string,evidenceRef:string,context:Context):State{
  if(state.recalls.some(recall=>JSON.stringify(recall.subject)===JSON.stringify(subject)))return state;
  const record:RecallRecord={...recordCreateBase(context,'open'),subject,status:'open',owner,reason,evidenceRef,impacts:recallImpacts(state,subject,owner,context),usageCoverage:context.usageCoverage??'partial',coverageEvidence:''};
  return {...state,recalls:[record,...state.recalls]};
}
export function monitoringIntervalsOverlap(a:MonitoringInterval,b:MonitoringInterval){return Date.parse(a.startAt)<Date.parse(b.endAt)&&Date.parse(b.startAt)<Date.parse(a.endAt);}
export function monitoringFindings(state:State,record:MonitoringRecord):MonitoringFinding[]{
  const owner=record.performerId??'Monitoring reviewer';
  const findings:MonitoringFinding[]=record.missingDocumentation.map((description,index)=>({id:`missing-${index}`,kind:'missing-documentation',description,owner,disposition:'open',evidenceRef:''}));
  if(record.performerId)for(const peer of state.monitoring.filter(item=>item.id!==record.id&&item.performerId===record.performerId))for(const interval of record.intervals??[])for(const other of peer.intervals??[])if(monitoringIntervalsOverlap(interval,other))findings.push({id:`overlap:${peer.id}:${interval.sourceEventId}:${other.sourceEventId}`,kind:'overlap',description:`Time overlaps documented activity ${peer.id}.`,owner,disposition:'open',evidenceRef:''});
  for(let i=0;i<(record.intervals?.length??0);i++)for(let j=i+1;j<record.intervals!.length;j++)if(monitoringIntervalsOverlap(record.intervals![i],record.intervals![j]))findings.push({id:`overlap:self:${i}:${j}`,kind:'overlap',description:'Two intervals in this record overlap.',owner,disposition:'open',evidenceRef:''});
  return findings.map(finding=>{const prior=record.findings.find(item=>item.id===finding.id&&item.description===finding.description);return prior??finding;});
}
function assertMonitoringAcceptance(state:State,record:MonitoringRecord){
  if(!record.patientId||!record.performerId||!record.serviceCode||!record.intervals?.length||!record.ruleRef)throw new Error('Acceptance requires patient, performer, service, timed intervals, and a named versioned payer rule.');
  const rule=record.ruleRef;
  if(rule.effectiveFrom>rule.effectiveTo||record.serviceDate<rule.effectiveFrom||record.serviceDate>rule.effectiveTo||record.intervals.some(interval=>interval.startAt.slice(0,10)<rule.effectiveFrom||interval.endAt.slice(0,10)>rule.effectiveTo))throw new Error('The named rule is not applicable to the service period.');
  if(monitoringFindings(state,record).some(finding=>finding.disposition==='open'||!finding.evidenceRef))throw new Error('Resolve every documentation and overlapping-time finding with review evidence before acceptance.');
}
function validateReconciliation(record:RecoveryReconciliation,prior?:RecoveryReconciliation){
  if(new Set(record.events.map(event=>event.eventId)).size!==record.events.length||new Set(record.coverage.map(item=>item.obligationId)).size!==record.coverage.length)throw new Error('Recovery event and coverage identities must be unique.');
  if(prior&&(prior.expectedEventManifestRef!==record.expectedEventManifestRef||prior.events.some(event=>!record.events.some(item=>item.eventId===event.eventId&&item.service===event.service&&item.patientId===event.patientId))||prior.coverage.some(item=>!record.coverage.some(next=>next.obligationId===item.obligationId))))throw new Error('Previously declared recovery events and coverage obligations cannot be removed or replaced.');
  if(record.events.some(event=>event.status!=='missing'&&(!event.evidenceRef||(event.status==='replayed'||event.status==='duplicate-disposed')&&!event.sourceReceipt)))throw new Error('Reconciled events require evidence and replay or duplicate receipt references.');
}
function refreshDependencies(input:State,context:Context):State{
  const state={...input};
  state.releases=state.releases.map((record)=>{
    const reasons=releaseDependencyReasons(state,record,context.now,context.features);
    if(!reasons.length||record.reviewRequired&&reasons.every((reason)=>record.dependencyAlerts.includes(reason)))return record;
    const decision=record.decision==='approved'?'pending':record.decision;
    return nextVersion(record,decision,'Dependent configuration or evidence needs review',context,undefined,{decision,reviewRequired:true,dependencyAlerts:[...new Set([...reasons,...record.dependencyAlerts])].slice(0,20),unresolvedConditions:[...new Set([...reasons,...record.unresolvedConditions])].slice(0,20)});
  });
  state.readiness=state.readiness.map((record)=>{
    const reasons=readinessDependencyReasons(state,record,context.now);
    if(!reasons.length||record.reviewRequired&&reasons.every((reason)=>record.dependencyAlerts.includes(reason)))return record;
    const decision=record.decision==='proposed'?'conditional-review':record.decision;
    return nextVersion(record,decision,'Dependent evidence needs review',context,undefined,{decision,reviewRequired:true,dependencyAlerts:[...new Set([...reasons,...record.dependencyAlerts])].slice(0,20),blockingConditions:[...new Set([...reasons,...record.blockingConditions])].slice(0,20)});
  });
  return state;
}
function flagDependentEvidence(state:State,evidenceId:string,reason:string,context:Context):State{
  const next=structuredClone(state);
  next.releases=next.releases.map((record)=>{
    if(!record.evidenceRefIds.includes(evidenceId))return record;
    if(record.dependencyAlerts.includes(reason))return record;
    const decision=record.decision==='approved'?'pending':record.decision;
    return nextVersion(record,decision,reason,context,undefined,{
      decision,
      reviewRequired:true,
      dependencyAlerts:[reason,...record.dependencyAlerts].slice(0,20),
      unresolvedConditions:[reason,...record.unresolvedConditions].slice(0,20),
    });
  });
  next.readiness=next.readiness.map((record)=>{
    if(!record.evidenceRefIds.includes(evidenceId))return record;
    if(record.dependencyAlerts.includes(reason))return record;
    const decision=record.decision==='proposed'?'conditional-review':record.decision;
    return nextVersion(record,decision,reason,context,undefined,{
      decision,
      reviewRequired:true,
      dependencyAlerts:[reason,...record.dependencyAlerts].slice(0,20),
      blockingConditions:[reason,...record.blockingConditions].slice(0,20),
    });
  });
  return next;
}

export function validateState(state:unknown):State{
  const parsed=stateSchema.parse(state);
  const active=parsed.configurations.filter((record)=>record.status==='active');
  if(active.length>1||(parsed.activeConfigurationId===null?active.length!==0:active.length!==1||active[0].id!==parsed.activeConfigurationId))throw new Error('Active configuration reference is inconsistent.');
  for(const records of [parsed.configurations,parsed.protocols,parsed.protocolAssignments,parsed.evidences,parsed.releases,parsed.operations,parsed.monitoring,parsed.readiness,parsed.recalls]){
    if(new Set(records.map((record)=>record.id)).size!==records.length)throw new Error('Record IDs must be unique within each registry.');
    for(const record of records){
      if(Date.parse(record.updatedAt)<Date.parse(record.createdAt))throw new Error('Record timestamps are inconsistent.');
      if(record.revisions.some((revision)=>revision.version>=record.version)||new Set(record.revisions.map((revision)=>revision.version)).size!==record.revisions.length)throw new Error('Record revision history is inconsistent.');
    }
  }
  if(new Set(parsed.protocolAssignments.map((record)=>`${record.patientId}:${record.encounterId??''}`)).size!==parsed.protocolAssignments.length)throw new Error('Each patient episode has one current protocol assignment.');
  for(const assignment of parsed.protocolAssignments){
    const protocol=parsed.protocols.find((record)=>record.id===assignment.protocolId);
    if(!protocol||assignment.protocolVersion>protocol.version)throw new Error('Protocol assignment references an unavailable version.');
    if(assignment.protocolSnapshot&&(assignment.protocolSnapshot.id!==assignment.protocolId||assignment.protocolSnapshot.version!==assignment.protocolVersion||assignment.protocolSnapshot.status!=='publication-recorded'))throw new Error('Protocol assignment snapshot is inconsistent.');
  }
  for(const record of parsed.releases){
    if(!parsed.configurations.some((configuration)=>configuration.id===record.configurationId))throw new Error('Release configuration reference is missing.');
    ensureEvidenceRefs(parsed,record.evidenceRefIds,record.updatedAt,{usable:false});
  }
  for(const record of parsed.readiness){validateGates(record.mandatoryGates);ensureEvidenceRefs(parsed,record.evidenceRefIds,record.updatedAt,{usable:false});}
  return parsed;
}

export function reduce(inputState:State,rawAction:Action,context:Context):State{
  const action=actionSchema.parse(rawAction);
  let state=validateState(structuredClone(inputState));
  if(!nonEmptyText(200).safeParse(context.actor).success)throw new Error('Server actor is required.');
  if(!isoDateTime.safeParse(context.now).success)throw new Error('Valid server time is required.');
  if('record' in action&&Boolean(action.id)!==Boolean(action.expectedVersion))throw new Error('Record updates require both id and expectedVersion.');
  const dedupeHit=state.receipts.find((receipt)=>receipt.requestId===action.requestId);
  if(dedupeHit){
    if(dedupeHit.actor&&dedupeHit.actor!==context.actor)throw new Error('requestId belongs to another actor.');
    if(dedupeHit.payloadHash!==payloadHash(action))throw new Error('requestId was already used for a different payload.');
    return state;
  }

  switch(action.type){
    case 'program-governance.configuration-save-draft':{
      const bridge=dependencyBlocks(action.record.capabilityChoices,context.features);
      const active=activeConfiguration(state);
      validateSafety(action.record,active);
      if(action.id){
        const current=findRecord(state.configurations,action.id,'Configuration record');
        requireVersion(current.version,action.expectedVersion??0,'Configuration record');
        if(current.status==='active'||current.status==='inactive')throw new Error('Activated configurations are immutable; create a new draft for changes.');
        const updated=nextVersion(current,'draft','Configuration draft updated',context,undefined,{
          ...action.record,
          status:'draft',
          bridge,
          reviewNote:action.record.reviewNote??'',
          baseActiveId:active?.id??null,
          baseActiveVersion:active?.version??null,
        });
        state={...state,configurations:state.configurations.map((entry)=>entry.id===updated.id?updated:entry)};
        return remember(state,action,'configuration',updated.id,context,current.version);
      }
      const created:ConfigurationRecord={
        ...recordCreateBase(context),
        ...action.record,
        reviewNote:action.record.reviewNote??'',
        status:'draft',
        bridge,
        baseActiveId:active?.id??null,
        baseActiveVersion:active?.version??null,
      };
      state={...state,configurations:[created,...state.configurations]};
      return remember(state,action,'configuration',created.id,context,null);
    }
    case 'program-governance.configuration-review':{
      const current=findRecord(state.configurations,action.id,'Configuration record');
      requireVersion(current.version,action.expectedVersion,'Configuration record');
      if(current.status!=='draft')throw new Error('Only configuration drafts can be reviewed.');
      const bridge=dependencyBlocks(current.capabilityChoices,context.features);
      validateSafety(current,activeConfiguration(state));
      if(bridge.invalidDependencies.length||bridge.hiddenByPolicy.length)throw new Error('Resolve blocked capability dependencies before review.');
      const updated=nextVersion(current,'reviewed',action.reviewNote,context,undefined,{status:'reviewed',reviewNote:action.reviewNote,bridge});
      state={...state,configurations:state.configurations.map((entry)=>entry.id===updated.id?updated:entry)};
      return remember(state,action,'configuration',updated.id,context,current.version);
    }
    case 'program-governance.configuration-activate':{
      const current=findRecord(state.configurations,action.id,'Configuration record');
      requireVersion(current.version,action.expectedVersion,'Configuration record');
      if(current.status!=='reviewed')throw new Error('Only reviewed configurations can be activated.');
      const bridge=dependencyBlocks(current.capabilityChoices,context.features);
      if(bridge.invalidDependencies.length)throw new Error('Invalid capability dependencies block activation.');
      if(bridge.hiddenByPolicy.length)throw new Error('Approved runtime policy still hides one or more selected capabilities.');
      const active=activeConfiguration(state);
      validateSafety(current,active);
      if(current.baseActiveId!==(active?.id??null)||current.baseActiveVersion!==(active?.version??null))throw new Error('This configuration draft is stale because a newer active configuration already exists or was deactivated.');
      const activated=nextVersion(current,'active',action.reason,context,undefined,{status:'active',activatedAt:context.now,bridge});
      const others=state.configurations.map((entry)=>{
        if(entry.id===activated.id)return activated;
        if(entry.status!=='active')return entry;
        return nextVersion(entry,'inactive','Superseded by a newer active configuration',context,undefined,{status:'inactive',deactivatedAt:context.now});
      });
      state={...state,activeConfigurationId:activated.id,configurations:others};
      return remember(state,action,'configuration',activated.id,context,current.version);
    }
    case 'program-governance.configuration-deactivate':{
      const current=findRecord(state.configurations,action.id,'Configuration record');
      requireVersion(current.version,action.expectedVersion,'Configuration record');
      if(current.status!=='active')throw new Error('Only the active configuration can be deactivated.');
      const updated=nextVersion(current,'inactive',action.reason,context,undefined,{status:'inactive',deactivatedAt:context.now});
      state={...state,activeConfigurationId:null,configurations:state.configurations.map((entry)=>entry.id===updated.id?updated:entry)};
      return remember(state,action,'configuration',updated.id,context,current.version);
    }

    case 'program-governance.protocol-save-draft':{
      validateProtocolTopology(action.record.steps,[],false);
      if(action.id){
        const current=findRecord(state.protocols,action.id,'Protocol record');
        requireVersion(current.version,action.expectedVersion??0,'Protocol record');
        const updated=nextVersion(current,'draft','Protocol draft updated',context,undefined,{
          ...action.record,
          sampleNotice:'Operational sample only — not approved X-1 clinical steps.',
          status:'draft',
          reviewer:'',
          reviewNote:'',
          publicationEvidence:'',
          retiredReason:'',
        });
        state={...state,protocols:state.protocols.map((entry)=>entry.id===updated.id?updated:entry)};
        return remember(state,action,'protocol',updated.id,context,current.version);
      }
      const created:ProtocolRecord={
        ...recordCreateBase(context),
        ...action.record,
        sampleNotice:'Operational sample only — not approved X-1 clinical steps.',
        status:'draft',
        reviewer:'',
        reviewNote:'',
        publicationEvidence:'',
        retiredReason:'',
      };
      state={...state,protocols:[created,...state.protocols]};
      return remember(state,action,'protocol',created.id,context,null);
    }
    case 'program-governance.protocol-request-review':{
      const current=findRecord(state.protocols,action.id,'Protocol record');
      requireVersion(current.version,action.expectedVersion,'Protocol record');
      if(current.status!=='draft'&&current.status!=='changes-required')throw new Error('Only draft protocols can request review.');
      validateProtocolTopology(current.steps,current.unresolvedQuestions);
      const updated=nextVersion(current,'review-requested',action.reason,context,undefined,{status:'review-requested'});
      state={...state,protocols:state.protocols.map((entry)=>entry.id===updated.id?updated:entry)};
      return remember(state,action,'protocol',updated.id,context,current.version);
    }
    case 'program-governance.protocol-record-review':{
      const current=findRecord(state.protocols,action.id,'Protocol record');
      requireVersion(current.version,action.expectedVersion,'Protocol record');
      if(current.status!=='review-requested')throw new Error('Protocol review can only be recorded after a review request.');
      const updated=nextVersion(current,action.outcome,action.reason,context,action.evidenceLocator,{
        status:action.outcome,
        reviewer:action.reviewer,
        reviewNote:action.reason,
        evidenceLocator:action.evidenceLocator,
      });
      state={...state,protocols:state.protocols.map((entry)=>entry.id===updated.id?updated:entry)};
      return remember(state,action,'protocol',updated.id,context,current.version);
    }
    case 'program-governance.protocol-record-publication':{
      const current=findRecord(state.protocols,action.id,'Protocol record');
      requireVersion(current.version,action.expectedVersion,'Protocol record');
      if(current.status!=='reviewed')throw new Error('Only reviewed protocols can be published.');
      validateProtocolTopology(current.steps,current.unresolvedQuestions);
      if(!current.reviewer)throw new Error('A named reviewer is required before publication.');
      if(!current.publicationChecks)throw new Error('Publication requires source version, rights, clinical and implementation reviews, fixtures, and migration and rollback records.');
      const updated=nextVersion(current,'publication-recorded',action.reason,context,action.evidenceRef,{
        status:'publication-recorded',
        publicationEvidence:action.evidenceRef,
      });
      state={...state,protocols:state.protocols.map((entry)=>entry.id===updated.id?updated:entry)};
      return remember(state,action,'protocol',updated.id,context,current.version);
    }
    case 'program-governance.protocol-retire':{
      const current=findRecord(state.protocols,action.id,'Protocol record');
      requireVersion(current.version,action.expectedVersion,'Protocol record');
      if(current.status!=='publication-recorded')throw new Error('Only published protocols can be retired.');
      const updated=nextVersion(current,'retired',action.reason,context,action.evidenceRef,{status:'retired',retiredReason:action.reason});
      state={...state,protocols:state.protocols.map((entry)=>entry.id===updated.id?updated:entry)};
      return remember(state,action,'protocol',updated.id,context,current.version);
    }
    case 'program-governance.protocol-assign-episode':{
      ensurePatient(context,action.patientId);
      const protocol=findRecord(state.protocols,action.protocolId,'Protocol record');
      if(protocol.status!=='publication-recorded')throw new Error('Only published protocol versions can be assigned to an active episode.');
      if(protocol.version!==action.expectedProtocolVersion)throw new Error('The protocol version changed. Reopen the published version before assigning it.');
      const currentAssignment=state.protocolAssignments.find((entry)=>entry.patientId===action.patientId&&entry.encounterId===action.encounterId);
      if((action.expectedAssignmentVersion??0)!==(currentAssignment?.version??0))throw new Error('The episode assignment changed. Reload before assigning a protocol.');
      if(currentAssignment)throw new Error('This episode already has a protocol assignment. Use explicit migration to account for open work.');
      const created={
            ...recordCreateBase(context,'assigned'),
            patientId:action.patientId,
            ...(action.encounterId?{encounterId:action.encounterId}:{}),
            protocolId:protocol.id,
            protocolVersion:protocol.version,
            protocolSnapshot:structuredClone(protocol),
            assignmentReason:action.reason,
          };
      state={...state,protocolAssignments:[created,...state.protocolAssignments]};
      return remember(state,action,'protocol-assignment',created.id,context,null);
    }
    case 'program-governance.protocol-migrate-episode':{
      const current=findRecord(state.protocolAssignments,action.id,'Protocol assignment');
      requireVersion(current.version,action.expectedVersion,'Protocol assignment');
      if(!context.protocolEpisodes&&!context.patientPathways)throw new Error('Migration needs the server inventory of current episode work.');
      const protocol=findRecord(state.protocols,action.targetProtocolId,'Target protocol');
      if(protocol.status!=='publication-recorded'||protocol.version!==action.expectedProtocolVersion)throw new Error('Migration requires the exact published target protocol version.');
      if(protocol.id===current.protocolId&&protocol.version===current.protocolVersion)throw new Error('The episode already uses this published version.');
      const oldIds=new Set(current.protocolSnapshot?.steps.map(step=>step.id)??[]),newIds=new Set(protocol.steps.map(step=>step.id));
      if(!oldIds.size)throw new Error('Legacy assignments need a verified published snapshot before migration.');
      if(new Set(action.stageMap.map(item=>item.oldStepId)).size!==action.stageMap.length||new Set(action.stageMap.map(item=>item.newStepId)).size!==action.stageMap.length||action.stageMap.some(item=>!oldIds.has(item.oldStepId)||!newIds.has(item.newStepId)))throw new Error('Migration needs unique mappings between existing source and target steps.');
      if(new Set(action.pendingWork.map(item=>item.oldStepId)).size!==action.pendingWork.length||action.pendingWork.some(item=>!oldIds.has(item.oldStepId)))throw new Error('Pending-work dispositions must uniquely identify source steps.');
      const episode=context.protocolEpisodes?.find(item=>item.assignmentId===current.id&&item.patientId===current.patientId&&(!current.encounterId||item.encounterId===current.encounterId))??context.patientPathways?.find(item=>item.protocolAssignmentId===current.id&&item.patientId===current.patientId&&(!current.encounterId||item.encounterId===current.encounterId));
      if(episode?.version!==undefined&&action.expectedEpisodeVersion!==episode.version)throw new Error('The episode work changed. Reload and review its latest version before migration.');
      const openSteps=episode?episode.stages.filter(step=>step.status!=='completed'):current.protocolSnapshot!.steps;
      if(openSteps.some(step=>!action.pendingWork.some(item=>item.oldStepId===step.id)))throw new Error('Every open source step needs a carry, completion, or accepted transfer disposition.');
      if(action.pendingWork.some(item=>item.disposition==='carry'&&!action.stageMap.some(mapping=>mapping.oldStepId===item.oldStepId)||item.disposition==='transfer'&&!item.acceptedBy))throw new Error('Carried work requires a mapping; transferred work requires named acceptance.');
      if(action.stageMap.some(mapping=>mapping.carryStatus&&!episode?.stages.some(step=>step.id===mapping.oldStepId)))throw new Error('A status can only be carried from server-recorded episode work.');
      const updated=nextVersion(current,String(protocol.version),action.reason,context,action.evidenceRef,{protocolId:protocol.id,protocolVersion:protocol.version,protocolSnapshot:structuredClone(protocol),assignmentReason:action.reason,migration:{fromAssignmentVersion:current.version,...(episode?.version?{sourceEpisodeVersion:episode.version}:{}),stageMap:action.stageMap,pendingWork:action.pendingWork}});
      state={...state,protocolAssignments:state.protocolAssignments.map(item=>item.id===current.id?updated:item)};
      return remember(state,action,'protocol-assignment',updated.id,context,current.version);
    }

    case 'program-governance.evidence-save-draft':{
      if(action.record.rightsExpiry&&action.record.rightsExpiry<=context.now.slice(0,10))throw new Error('Evidence rights expiry cannot already be in the past when saved as current support.');
      if(action.id){
        const current=findRecord(state.evidences,action.id,'Evidence record');
        requireVersion(current.version,action.expectedVersion??0,'Evidence record');
        if(current.status==='withdrawn')throw new Error('Withdrawn evidence must be replaced by a new record.');
        const updated=nextVersion(current,'draft','Evidence draft updated',context,undefined,{
          ...action.record,
          instrumentVersion:action.record.instrumentVersion??'',
          approvedTranslation:action.record.approvedTranslation??'',
          status:'draft',
          reviewer:'',
          withdrawnReason:'',
          reviewNote:action.record.reviewNote??'',
        });
        state={...state,evidences:state.evidences.map((entry)=>entry.id===updated.id?updated:entry)};
        state=flagDependentEvidence(state,updated.id,`Dependent evidence ${updated.title} now requires review.`,context);
        return remember(state,action,'evidence',updated.id,context,current.version);
      }
      const created:EvidenceRecord={
        ...recordCreateBase(context),
        ...action.record,
        instrumentVersion:action.record.instrumentVersion??'',
        approvedTranslation:action.record.approvedTranslation??'',
        reviewNote:action.record.reviewNote??'',
        status:'draft',
        reviewer:'',
        withdrawnReason:'',
      };
      state={...state,evidences:[created,...state.evidences]};
      return remember(state,action,'evidence',created.id,context,null);
    }
    case 'program-governance.evidence-request-review':{
      const current=findRecord(state.evidences,action.id,'Evidence record');
      requireVersion(current.version,action.expectedVersion,'Evidence record');
      if(current.status!=='draft'&&current.status!=='changes-required')throw new Error('Only evidence drafts can request review.');
      const updated=nextVersion(current,'review-requested',action.reason,context,undefined,{status:'review-requested'});
      state={...state,evidences:state.evidences.map((entry)=>entry.id===updated.id?updated:entry)};
      return remember(state,action,'evidence',updated.id,context,current.version);
    }
    case 'program-governance.evidence-record-review':{
      const current=findRecord(state.evidences,action.id,'Evidence record');
      requireVersion(current.version,action.expectedVersion,'Evidence record');
      if(current.status!=='review-requested')throw new Error('Evidence review can only be recorded after a review request.');
      if(action.outcome==='approved'&&evidenceExpired(current,context.now))throw new Error('Expired evidence cannot be approved as current support.');
      if(action.outcome==='approved'&&current.supportingSources.some((source)=>source.kind==='supporting'&&source.retracted))throw new Error('Retracted supporting evidence cannot be approved as current support.');
      if(action.outcome==='approved'&&!current.supportingSources.some((source)=>source.kind==='supporting'&&!source.retracted))throw new Error('At least one usable supporting source is required for approval.');
      if(action.outcome==='approved'&&current.supportingSources.some((source)=>source.publicationDate>context.now.slice(0,10)))throw new Error('Future-dated evidence sources cannot support current approval.');
      const updated=nextVersion(current,action.outcome,action.reason,context,undefined,{status:action.outcome,reviewer:action.reviewer,reviewNote:action.reason});
      state={...state,evidences:state.evidences.map((entry)=>entry.id===updated.id?updated:entry)};
      return remember(state,action,'evidence',updated.id,context,current.version);
    }
    case 'program-governance.evidence-withdraw':{
      const current=findRecord(state.evidences,action.id,'Evidence record');
      requireVersion(current.version,action.expectedVersion,'Evidence record');
      if(current.status==='withdrawn')throw new Error('This evidence record is already withdrawn.');
      const recalledVersions=new Set([current.version,...state.releases.flatMap(release=>[release.evidenceVersions[current.id],...release.revisions.map(revision=>(revision.record.evidenceVersions as Record<string,number>|undefined)?.[current.id])]).filter((version):version is number=>typeof version==='number'),...(context.governedUsages??[]).flatMap(usage=>usage.evidenceRefs.filter(ref=>ref.evidenceId===current.id).map(ref=>ref.version))]);
      for(const version of recalledVersions)state=openRecall(state,{kind:'evidence',id:current.id,version},context.actor,action.reason,`evidence:${current.id}:v${version}`,context);
      const updated=nextVersion(current,'withdrawn',action.reason,context,undefined,{status:'withdrawn',withdrawnReason:action.reason});
      state={...state,evidences:state.evidences.map((entry)=>entry.id===updated.id?updated:entry)};
      state=flagDependentEvidence(state,updated.id,`Dependent evidence ${updated.title} now requires review.`,context);
      return remember(state,action,'evidence',updated.id,context,current.version);
    }

    case 'program-governance.release-save-draft':{
      if(/automatic/i.test(action.record.overrideTrainingPolicy))throw new Error('Training from clinician override is never automatic.');
      if(action.record.modelClaims.length===0&&action.record.evidenceRefIds.length===0&&action.record.unresolvedConditions.length===0)throw new Error('Release records require evidence references or explicit unresolved conditions before review.');
      if(action.record.modelClaims.length>0&&action.record.evidenceRefIds.length===0)throw new Error('Evidence record references are required for every model claim.');
      ensureEvidenceRefs(state,action.record.evidenceRefIds,context.now,{usable:false});
      const configuration=findRecord(state.configurations,action.record.configurationId,'Configuration record');
      if(configuration.status!=='active'||state.activeConfigurationId!==configuration.id)throw new Error('Release records must reference the active approved configuration.');
      if(action.id){
        const current=findRecord(state.releases,action.id,'Release record');
        requireVersion(current.version,action.expectedVersion??0,'Release record');
        const updated=nextVersion(current,'pending','Release draft updated',context,undefined,{
          ...action.record,
          artifactVersion:current.artifactVersion+1,
          configurationVersion:configuration.version,
          evidenceVersions:evidenceVersions(state,action.record.evidenceRefIds),
          decision:'pending',
          reviewer:'',
          reviewNote:'',
          reviewRequired:false,
          dependencyAlerts:[],
        });
        state={...state,releases:state.releases.map((entry)=>entry.id===updated.id?updated:entry)};
        return remember(state,action,'release',updated.id,context,current.version);
      }
      const created:ReleaseRecord={
        ...recordCreateBase(context,'pending'),
        ...action.record,
        artifactVersion:1,
        configurationVersion:configuration.version,
        evidenceVersions:evidenceVersions(state,action.record.evidenceRefIds),
        decision:'pending',
        reviewer:'',
        reviewNote:'',
        rolloutRecords:[],
        rollbackRecords:[],
        reviewRequired:false,
        dependencyAlerts:[],
      };
      state={...state,releases:[created,...state.releases]};
      return remember(state,action,'release',created.id,context,null);
    }
    case 'program-governance.release-record-review':{
      const current=findRecord(state.releases,action.id,'Release record');
      requireVersion(current.version,action.expectedVersion,'Release record');
      if(action.decision==='approved'){
        if(state.recalls.some(recall=>recall.subject.kind==='release'?recall.subject.id===current.id&&recall.subject.artifactVersion===current.artifactVersion:current.evidenceVersions[recall.subject.id]===recall.subject.version))throw new Error('A recalled artifact cannot be reapproved; create and review a replacement artifact.');
        if(!current.evidenceRefIds.length)throw new Error('Current approval requires reviewed, non-expired, non-withdrawn evidence.');
        ensureEvidenceRefs(state,current.evidenceRefIds,context.now,{usable:true});
        if(current.evidenceRefIds.some(id=>current.evidenceVersions[id]!==findRecord(state.evidences,id,'Evidence record').version))throw new Error('Supporting evidence changed. Save a revised release artifact before approving its new evidence versions.');
        const configuration=findRecord(state.configurations,current.configurationId,'Configuration record');
        const bridge=dependencyBlocks(configuration.capabilityChoices,context.features);
        if(configuration.status!=='active'||state.activeConfigurationId!==configuration.id||current.configurationVersion!==configuration.version||bridge.hiddenByPolicy.length||bridge.invalidDependencies.length)throw new Error('Current approval requires the active reviewed configuration and current runtime policy.');
      }
      if(action.decision==='approved'&&action.unresolvedConditions.length)throw new Error('Approved releases cannot retain unresolved conditions.');
      const updated=nextVersion(current,action.decision,action.reason,context,undefined,{
        decision:action.decision,
        reviewer:action.reviewer,
        reviewNote:action.reason,
        unresolvedConditions:action.unresolvedConditions,
        reviewRequired:false,
        dependencyAlerts:[],
      });
      state={...state,releases:state.releases.map((entry)=>entry.id===updated.id?updated:entry)};
      return remember(state,action,'release',updated.id,context,current.version);
    }
    case 'program-governance.release-record-rollout':{
      const current=findRecord(state.releases,action.id,'Release record');
      requireVersion(current.version,action.expectedVersion,'Release record');
      const updated=nextVersion(current,current.decision,action.note,context,undefined,{rolloutRecords:[{at:context.now,actor:context.actor,note:action.note},...current.rolloutRecords]});
      state={...state,releases:state.releases.map((entry)=>entry.id===updated.id?updated:entry)};
      return remember(state,action,'release',updated.id,context,current.version);
    }
    case 'program-governance.release-record-rollback':{
      const current=findRecord(state.releases,action.id,'Release record');
      requireVersion(current.version,action.expectedVersion,'Release record');
      const updated=nextVersion(current,current.decision,action.note,context,undefined,{rollbackRecords:[{at:context.now,actor:context.actor,note:action.note},...current.rollbackRecords]});
      state={...state,releases:state.releases.map((entry)=>entry.id===updated.id?updated:entry)};
      return remember(state,action,'release',updated.id,context,current.version);
    }

    case 'program-governance.operation-report':{
      sanitizeOperationPayload(action.record);
      if(action.record.kind==='incident'&&action.record.restoreOutcome!=='not-applicable'||action.record.kind==='restore-proof'&&action.record.restoreOutcome==='not-applicable')throw new Error('Restore outcome must match the operation kind.');
      if(action.id){
        const current=findRecord(state.operations,action.id,'Operation record');
        requireVersion(current.version,action.expectedVersion??0,'Operation record');
        if(current.status==='closed')throw new Error('Closed operations are immutable; create a new report for follow-up.');
        const updated=nextVersion(current,'reported','Operation updated',context,undefined,{...action.record,status:'reported',confirmedBy:'',reviewNote:'',closeEvidence:''});
        state={...state,operations:state.operations.map((entry)=>entry.id===updated.id?updated:entry)};
        return remember(state,action,'operation',updated.id,context,current.version);
      }
      const created:OperationRecord={...recordCreateBase(context,'reported'),...action.record,status:'reported',confirmedBy:'',reviewNote:'',closeEvidence:''};
      state={...state,operations:[created,...state.operations]};
      return remember(state,action,'operation',created.id,context,null);
    }
    case 'program-governance.operation-confirm':{
      ensureSafeText(action.reason,'Operation confirmation');
      const current=findRecord(state.operations,action.id,'Operation record');
      requireVersion(current.version,action.expectedVersion,'Operation record');
      if(current.status!=='reported')throw new Error('Only reported operations can be confirmed.');
      const updated=nextVersion(current,'confirmed',action.reason,context,undefined,{status:'confirmed',owner:action.owner,severity:action.severity,confirmedBy:context.actor});
      state={...state,operations:state.operations.map((entry)=>entry.id===updated.id?updated:entry)};
      return remember(state,action,'operation',updated.id,context,current.version);
    }
    case 'program-governance.operation-review':{
      ensureSafeText(action.reason,'Operation review');
      ensureSafeText(action.evidenceRef,'Operation review evidence');
      const current=findRecord(state.operations,action.id,'Operation record');
      requireVersion(current.version,action.expectedVersion,'Operation record');
      if(current.status!=='confirmed')throw new Error('Only confirmed operations can be reviewed.');
      const updated=nextVersion(current,'reviewed',action.reason,context,action.evidenceRef,{status:'reviewed',reviewNote:action.reason,evidenceRef:action.evidenceRef});
      state={...state,operations:state.operations.map((entry)=>entry.id===updated.id?updated:entry)};
      return remember(state,action,'operation',updated.id,context,current.version);
    }
    case 'program-governance.operation-close':{
      ensureSafeText(action.reason,'Operation close reason');
      ensureSafeText(action.evidenceRef,'Operation close evidence');
      const current=findRecord(state.operations,action.id,'Operation record');
      requireVersion(current.version,action.expectedVersion,'Operation record');
      if(current.status!=='reviewed')throw new Error('Only reviewed operations can be closed.');
      if(current.kind==='restore-proof'&&current.restoreOutcome==='reported-failure')throw new Error('A failed restore exercise cannot be closed as successful proof.');
      if(!current.reconciliation)throw new Error('Closure requires a reviewed expected-event manifest and coverage reconciliation.');
      validateReconciliation(current.reconciliation);
      if(current.reconciliation.events.some(event=>event.status==='missing'))throw new Error('Missing downstream events prevent closure.');
      if(current.reconciliation.coverage.some(item=>!item.acceptedBy||!item.evidenceRef))throw new Error('Outstanding coverage needs named owner acceptance and evidence before closure.');
      const note=current.kind==='restore-proof'?'Reported restore-exercise evidence only; no restoration was performed.':action.reason;
      const updated=nextVersion(current,'closed',note,context,action.evidenceRef,{status:'closed',closeEvidence:action.evidenceRef,reviewNote:action.reason});
      state={...state,operations:state.operations.map((entry)=>entry.id===updated.id?updated:entry)};
      return remember(state,action,'operation',updated.id,context,current.version);
    }
    case 'program-governance.operation-reconcile':{
      const current=findRecord(state.operations,action.id,'Operation record');
      requireVersion(current.version,action.expectedVersion,'Operation record');
      if(current.status==='closed')throw new Error('Closed operation records are immutable.');
      validateReconciliation(action.record,current.reconciliation);
      for(const event of action.record.events)if(event.patientId)ensurePatient(context,event.patientId);
      const updated=nextVersion(current,current.status,action.reason,context,action.record.reconciliationEvidence,{reconciliation:action.record});
      state={...state,operations:state.operations.map(item=>item.id===current.id?updated:item)};
      return remember(state,action,'operation',updated.id,context,current.version);
    }

    case 'program-governance.monitoring-record-service':{
      if(action.record.serviceDate>context.now.slice(0,10))throw new Error('Reported service date cannot be in the future.');
      if(action.record.patientId)ensurePatient(context,action.record.patientId);
      const intervals=action.record.intervals??[];
      if(intervals.some(interval=>Date.parse(interval.startAt)>=Date.parse(interval.endAt)||Date.parse(interval.endAt)>Date.parse(context.now)))throw new Error('Service intervals must have positive duration and cannot end in the future.');
      if(new Set(intervals.map(interval=>interval.sourceEventId)).size!==intervals.length||state.monitoring.some(record=>record.id!==action.id&&record.intervals?.some(existing=>intervals.some(interval=>interval.sourceEventId===existing.sourceEventId))))throw new Error('Duplicate source event documentation is already recorded.');
      const normalize=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
      const duplicateKey=`${action.record.serviceDate}::${normalize(action.record.activity)}::${normalize(action.record.source)}${action.record.patientId?`::${action.record.patientId}::${action.record.performerId??''}::${action.record.serviceCode??''}`:''}`;
      const duplicate=state.monitoring.find((entry)=>entry.duplicateKey===duplicateKey&&entry.id!==action.id);
      if(duplicate)throw new Error('Duplicate service documentation is already recorded for that date, activity, and source.');
      if(action.id){
        const current=findRecord(state.monitoring,action.id,'Monitoring record');
        requireVersion(current.version,action.expectedVersion??0,'Monitoring record');
        const updated=nextVersion(current,'reported','Monitoring documentation updated',context,undefined,{...action.record,status:'reported',decision:'pending',reviewer:'',reviewNote:'',duplicateKey,findings:[]});
        updated.findings=monitoringFindings(state,updated);
        state={...state,monitoring:state.monitoring.map((entry)=>entry.id===updated.id?updated:entry)};
        return remember(state,action,'monitoring',updated.id,context,current.version);
      }
      const created:MonitoringRecord={...recordCreateBase(context,'reported'),...action.record,status:'reported',reviewer:'',reviewNote:'',duplicateKey,findings:[],decision:'pending',exportRecords:[]};
      created.findings=monitoringFindings(state,created);
      state={...state,monitoring:[created,...state.monitoring]};
      return remember(state,action,'monitoring',created.id,context,null);
    }
    case 'program-governance.monitoring-record-review':{
      const current=findRecord(state.monitoring,action.id,'Monitoring record');
      requireVersion(current.version,action.expectedVersion,'Monitoring record');
      if(current.status!=='reported')throw new Error('Only reported monitoring documentation can be reviewed.');
      const updated=nextVersion(current,'reviewed',action.reason,context,undefined,{status:'reviewed',reviewer:context.actor,reviewNote:action.reason});
      state={...state,monitoring:state.monitoring.map((entry)=>entry.id===updated.id?updated:entry)};
      return remember(state,action,'monitoring',updated.id,context,current.version);
    }
    case 'program-governance.monitoring-record-decision':{
      const current=findRecord(state.monitoring,action.id,'Monitoring record');
      requireVersion(current.version,action.expectedVersion,'Monitoring record');
      if(current.status==='exported')throw new Error('Revise the documentation before reviewing an exported record again.');
      const required=monitoringFindings(state,current);
      if(new Set(action.findings.map(item=>item.id)).size!==action.findings.length||required.length!==action.findings.length||required.some(item=>!action.findings.some(next=>next.id===item.id&&next.kind===item.kind&&next.description===item.description)))throw new Error('Review must account for every current documentation and overlap finding.');
      if(action.findings.some(finding=>finding.disposition!=='open'&&!finding.evidenceRef))throw new Error('Resolved findings require named review evidence.');
      const updated=nextVersion(current,action.decision,action.reason,context,undefined,{status:action.decision==='clarify'?'reported':'reviewed',decision:action.decision,findings:action.findings,reviewer:context.actor,reviewNote:action.reason});
      if(action.decision==='accept')assertMonitoringAcceptance(state,updated);
      state={...state,monitoring:state.monitoring.map(item=>item.id===current.id?updated:item)};
      return remember(state,action,'monitoring',updated.id,context,current.version);
    }
    case 'program-governance.monitoring-export':{
      const current=findRecord(state.monitoring,action.id,'Monitoring record');
      requireVersion(current.version,action.expectedVersion,'Monitoring record');
      if(current.decision!=='accept')throw new Error('Only accepted monitoring documentation can be exported as a reviewed package.');
      assertMonitoringAcceptance(state,current);
      const {history:ignoredHistory,revisions:ignoredRevisions,exportRecords:ignoredExports,...snapshot}=current;
      void ignoredHistory;void ignoredRevisions;void ignoredExports;
      const updated=nextVersion(current,'exported','Recorded export of the accepted monitoring package',context,action.evidenceRef,{status:'exported',exportRecords:[{at:context.now,actor:context.actor,evidenceRef:action.evidenceRef,recordVersion:current.version,snapshot:structuredClone(snapshot)},...current.exportRecords]});
      state={...state,monitoring:state.monitoring.map(item=>item.id===current.id?updated:item)};
      return remember(state,action,'monitoring',updated.id,context,current.version);
    }

    case 'program-governance.recall-open':{
      const subject=action.subject;
      const target=subject.kind==='release'?findRecord(state.releases,subject.id,'Release'):findRecord(state.evidences,subject.id,'Evidence');
      requireVersion(target.version,action.expectedSubjectVersion,'Recall subject');
      const available=subject.kind==='release'?'artifactVersion' in target&&(target.artifactVersion===subject.artifactVersion||target.revisions.some(revision=>revision.record.artifactVersion===subject.artifactVersion)):target.version===subject.version||target.revisions.some(revision=>revision.version===subject.version);
      if(!available)throw new Error('The recalled artifact version is unavailable.');
      if(state.recalls.some(recall=>JSON.stringify(recall.subject)===JSON.stringify(subject)))throw new Error('This exact artifact is already recalled.');
      state=openRecall(state,subject,action.owner,action.reason,action.evidenceRef,context);
      return remember(state,action,'recall',state.recalls[0].id,context,null);
    }
    case 'program-governance.recall-review-impact':{
      const current=findRecord(state.recalls,action.id,'Recall');
      requireVersion(current.version,action.expectedVersion,'Recall');
      if(current.status==='closed')throw new Error('Closed recall reviews are immutable.');
      findRecord(current.impacts,action.impactId,'Affected output');
      if(action.disposition==='accepted-transfer'&&!action.acceptedBy)throw new Error('Transfer needs named receiving-owner acceptance.');
      if(action.disposition==='reviewed-plan-amended'&&!action.planRef)throw new Error('An amended-plan disposition needs its reviewed plan reference.');
      const impacts=current.impacts.map(impact=>impact.id===action.impactId?{...impact,disposition:action.disposition,evidenceRef:action.evidenceRef,reviewer:context.actor,acceptedBy:action.acceptedBy??'',planRef:action.planRef??''}:impact);
      const updated=nextVersion(current,'open',action.reason,context,action.evidenceRef,{impacts});
      state={...state,recalls:state.recalls.map(item=>item.id===current.id?updated:item)};
      return remember(state,action,'recall',updated.id,context,current.version);
    }
    case 'program-governance.recall-review-coverage':{
      const current=findRecord(state.recalls,action.id,'Recall');
      requireVersion(current.version,action.expectedVersion,'Recall');
      if(current.status==='closed')throw new Error('Closed recall reviews are immutable.');
      if(context.usageCoverage!=='complete'||!context.governedUsages)throw new Error('The trusted output inventory still has incomplete reference coverage.');
      const fresh=recallImpacts(state,current.subject,current.owner,context),impacts=[...current.impacts,...fresh.filter(item=>!current.impacts.some(prior=>prior.id===item.id))];
      const updated=nextVersion(current,'open',action.reason,context,action.evidenceRef,{impacts,usageCoverage:'complete',coverageEvidence:action.evidenceRef});
      state={...state,recalls:state.recalls.map(item=>item.id===current.id?updated:item)};
      return remember(state,action,'recall',updated.id,context,current.version);
    }
    case 'program-governance.recall-close':{
      const current=findRecord(state.recalls,action.id,'Recall');
      requireVersion(current.version,action.expectedVersion,'Recall');
      const fresh=recallImpacts(state,current.subject,current.owner,context);
      if(current.status!=='open'||current.usageCoverage!=='complete'||!current.coverageEvidence||context.usageCoverage!=='complete'||!context.governedUsages||current.impacts.some(impact=>impact.disposition==='pending')||fresh.some(item=>!current.impacts.some(prior=>prior.id===item.id)))throw new Error('Complete the trusted impact inventory and every assigned patient review before closing the recall.');
      const updated=nextVersion(current,'closed',action.reason,context,action.evidenceRef,{status:'closed'});
      state={...state,recalls:state.recalls.map(item=>item.id===current.id?updated:item)};
      return remember(state,action,'recall',updated.id,context,current.version);
    }

    case 'program-governance.readiness-save-draft':{
      ensureEvidenceRefs(state,action.record.evidenceRefIds,context.now,{usable:false});
      validateGates(action.record.mandatoryGates);
      if(action.id){
        const current=findRecord(state.readiness,action.id,'Readiness record');
        requireVersion(current.version,action.expectedVersion??0,'Readiness record');
        validateGates(action.record.mandatoryGates,current.mandatoryGates);
        const updated=nextVersion(current,'conditional-review','Readiness draft updated',context,undefined,{
          ...action.record,
          evidenceVersions:evidenceVersions(state,action.record.evidenceRefIds),
          decision:'conditional-review',
          reviewer:'',
          reviewEvidence:'',
          reviewNote:'',
          reviewRequired:false,
          dependencyAlerts:[],
          regulatoryAuthorizationNote:'Recorded owner decision only; regulatory authorization remains an external gate.',
        });
        state={...state,readiness:state.readiness.map((entry)=>entry.id===updated.id?updated:entry)};
        return remember(state,action,'readiness',updated.id,context,current.version);
      }
      const created:ReadinessRecord={
        ...recordCreateBase(context,'conditional-review'),
        ...action.record,
        evidenceVersions:evidenceVersions(state,action.record.evidenceRefIds),
        decision:'conditional-review',
        reviewer:'',
        reviewEvidence:'',
        reviewNote:'',
        reviewRequired:false,
        dependencyAlerts:[],
        regulatoryAuthorizationNote:'Recorded owner decision only; regulatory authorization remains an external gate.',
      };
      state={...state,readiness:[created,...state.readiness]};
      return remember(state,action,'readiness',created.id,context,null);
    }
    case 'program-governance.readiness-record-decision':{
      const current=findRecord(state.readiness,action.id,'Readiness record');
      requireVersion(current.version,action.expectedVersion,'Readiness record');
      const nextEvidenceRefIds=[...current.evidenceRefIds];
      validateGates(action.mandatoryGates,current.mandatoryGates);
      if(action.decision==='proposed'&&!nextEvidenceRefIds.length)throw new Error('Proposed readiness requires reviewed evidence for its claims.');
      const nextEvidence=ensureEvidenceRefs(state,nextEvidenceRefIds,context.now,{usable:action.decision==='proposed'});
      if(action.decision==='proposed'&&nextEvidence.some(evidence=>state.recalls.some(recall=>recall.subject.kind==='evidence'&&recall.subject.id===evidence.id&&recall.subject.version===evidence.version)))throw new Error('Recalled evidence cannot support a proposed readiness scope. Review replacement evidence first.');
      const unresolvedMandatory=action.mandatoryGates.filter((gate)=>gate.required&&gate.disposition==='open');
      const missingGateEvidence=action.mandatoryGates.filter((gate)=>gate.disposition!=='open'&&!gate.evidenceRef);
      if(missingGateEvidence.length)throw new Error('Each satisfied or waived mandatory gate requires named review evidence.');
      if(action.decision==='proposed'&&unresolvedMandatory.length)throw new Error('Proposed readiness cannot leave mandatory gates unresolved.');
      if(action.decision==='proposed'&&action.blockingConditions.length)throw new Error('Proposed readiness cannot keep explicit release blockers.');
      if(action.decision==='proposed'){
        if(!current.releaseRef||!current.scope)throw new Error('Proposed readiness requires an exact release artifact and structured runtime scope.');
        const release=findRecord(state.releases,current.releaseRef.releaseId,'Readiness release');
        if(release.artifactVersion!==current.releaseRef.artifactVersion||release.decision!=='approved'||release.reviewRequired||releaseDependencyReasons(state,release,context.now,context.features).length)throw new Error('Readiness requires the current approved release artifact.');
        const configuration=findRecord(state.configurations,release.configurationId,'Release configuration');
        if(current.scope.capabilities.some(capability=>!configuration.capabilityChoices.includes(capability)))throw new Error('Readiness scope exceeds the active configuration capabilities.');
        if(current.scope.environment==='production')throw new Error('Recorded demo reviews cannot authorize production use.');
      }
      const updated=nextVersion(current,action.decision,action.reason,context,action.reviewEvidence,{
        decision:action.decision,
        reviewer:action.reviewer,
        reviewEvidence:action.reviewEvidence,
        reviewNote:action.reason,
        blockingConditions:action.blockingConditions,
        mandatoryGates:action.mandatoryGates,
        reviewRequired:false,
        dependencyAlerts:[],
        evidenceVersions:evidenceVersions(state,current.evidenceRefIds),
      });
      state={...state,readiness:state.readiness.map((entry)=>entry.id===updated.id?updated:entry)};
      return remember(state,action,'readiness',updated.id,context,current.version);
    }
  }
}

export function getSummary(stateInput:State,patientId?:string,now=new Date().toISOString()){
  const state=validateState(stateInput);
  const nowHint=isoDateTime.parse(now);
  const today=nowHint.slice(0,10);
  const attention:string[]=[];
  const activeProtocolAssignment=patientId?state.protocolAssignments.find((entry)=>entry.patientId===patientId):undefined;
  if(activeProtocolAssignment)attention.push(`Patient ${patientId} remains on protocol version ${activeProtocolAssignment.protocolVersion}.`);
  for(const configuration of state.configurations)if(configuration.bridge.invalidDependencies.length||configuration.bridge.hiddenByPolicy.length)attention.push(`Configuration ${configuration.title} is blocked by runtime dependencies or policy.`);
  for(const protocol of state.protocols)if(protocol.status==='changes-required')attention.push(`Protocol ${protocol.title} needs author changes.`);
  for(const evidence of state.evidences)if(evidence.status==='approved'&&evidenceExpired(evidence,nowHint))attention.push(`Evidence ${evidence.title} is expired and must not be treated as current support.`);
  for(const release of state.releases)if(release.reviewRequired||release.unresolvedConditions.length||releaseDependencyReasons(state,release,nowHint).length)attention.push(`Release ${release.title} retains unresolved conditions or evidence review.`);
  for(const operation of state.operations)if(operation.kind==='restore-proof'&&operation.restoreOutcome==='reported-failure')attention.push(`Restore proof ${operation.title} reported a failed exercise.`);
  for(const monitoring of state.monitoring)if(monitoring.missingDocumentation.length)attention.push(`Monitoring record ${monitoring.activity} has missing documentation.`);
  for(const recall of state.recalls)if(recall.status==='open')attention.push(`Recall ${recall.subject.id} has ${recall.impacts.filter(impact=>impact.disposition==='pending').length} patient reviews pending; reference coverage is ${recall.usageCoverage}.`);
  for(const readiness of state.readiness)if(readiness.blockingConditions.length||readiness.reviewRequired||readinessDependencyReasons(state,readiness,nowHint).length||readiness.mandatoryGates.some((gate)=>gate.required&&gate.disposition==='open'))attention.push(`Readiness ${readiness.title} still has blocking conditions.`);

  const open=
    state.configurations.filter((record)=>record.status==='draft'||record.status==='reviewed').length+
    state.protocols.filter((record)=>record.status!=='retired'&&record.status!=='publication-recorded').length+
    state.evidences.filter((record)=>record.status!=='withdrawn'&&!evidenceUsable(record,nowHint)).length+
    state.releases.filter((record)=>record.decision!=='no-go'&&(record.decision!=='approved'||record.reviewRequired||releaseDependencyReasons(state,record,nowHint).length>0)).length+
    state.operations.filter((record)=>record.status!=='closed').length+
    state.monitoring.filter((record)=>record.status==='reported'||record.missingDocumentation.length>0).length+
    state.readiness.filter((record)=>record.decision!=='no-go'&&(record.decision!=='proposed'||record.reviewRequired||readinessDependencyReasons(state,record,nowHint).length>0)).length+
    state.recalls.filter(record=>record.status==='open').length;
  const overdue=
    state.evidences.filter((record)=>record.status==='approved'&&evidenceExpired(record,nowHint)).length+
    state.operations.filter((record)=>record.kind==='restore-proof'&&record.restoreOutcome==='reported-failure').length+
    state.readiness.filter((record)=>record.blockingConditions.length>0).length+
    state.monitoring.filter((record)=>record.serviceDate<today&&record.status!=='reviewed'&&record.status!=='exported').length;
  return {open,overdue,attention:[...new Set(attention)].slice(0,12)};
}
