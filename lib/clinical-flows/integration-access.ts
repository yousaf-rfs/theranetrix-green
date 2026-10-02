import {z} from 'zod';

const text=z.string().trim().min(1).max(2000);
const label=z.string().trim().min(1).max(160);
const id=z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).refine(value=>!['__proto__','prototype','constructor'].includes(value),'Reserved identifier.');
const isoInstant=z.string().datetime({offset:true}).transform(value=>new Date(value).toISOString());
const nonnegative=z.number().int().min(0);
const patientIdSchema=id;
const orgIdSchema=id;
const encounterIdSchema=id;

export const metrics=['pain','function','sleep','heartRate'] as const;
export const unitsByMetric={pain:['score-0-10'],function:['score-0-10'],sleep:['score-0-10'],heartRate:['bpm']} as const;
export type Metric=typeof metrics[number];
export type MetricUnit=(typeof unitsByMetric)[Metric][number];
export const principalRoles=['workspace-owner','clinician','patient','proxy','integration-admin'] as const;
export const permissionActions=['records.read','records.write','records.export','integration.configure','integration.writeback'] as const;
export const relationshipKinds=['self','care-team','proxy'] as const;
export const consentScopes=['read','write','export','integration'] as const;
export type PrincipalRole=typeof principalRoles[number];
export type PermissionAction=typeof permissionActions[number];
export type RelationshipKind=typeof relationshipKinds[number];
export type ConsentScope=typeof consentScopes[number];

const relationshipSchema=z.object({patientId:patientIdSchema,kind:z.enum(relationshipKinds),organizationId:orgIdSchema,expiresAt:isoInstant.optional(),revokedAt:isoInstant.optional()}).strict();
const consentSchema=z.object({patientId:patientIdSchema,scope:z.enum(consentScopes),granted:z.boolean(),grantedAt:isoInstant,expiresAt:isoInstant.optional(),revokedAt:isoInstant.optional()}).strict();
export const principalSchema=z.object({id,name:label,organizationId:orgIdSchema,role:z.enum(principalRoles),verifiedServerIdentity:z.boolean(),relationships:z.array(relationshipSchema).max(1000),consents:z.array(consentSchema).max(2000)}).strict();
const permissionSchema=z.object({role:z.enum(principalRoles),action:z.enum(permissionActions),allow:z.boolean(),requiresRelationship:z.array(z.enum(relationshipKinds)).min(1).max(3).optional(),consentScope:z.enum(consentScopes).optional()}).strict();
export const policySchema=z.object({version:z.number().int().min(1),sharedOwnerEvaluation:z.literal(true),patientOrganizations:z.record(patientIdSchema,orgIdSchema),permissions:z.array(permissionSchema).max(200)}).strict().superRefine((policy,ctx)=>{
  const seen=new Set<string>();
  for(const rule of policy.permissions){
    const key=rule.role+':'+rule.action;
    if(seen.has(key)) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Duplicate role/action policy rule.'});
    seen.add(key);
  }
});
export type CareRelationship=z.infer<typeof relationshipSchema>;
export type ConsentRecord=z.infer<typeof consentSchema>;
export type Principal=z.infer<typeof principalSchema>;
export type PermissionRecord=z.infer<typeof permissionSchema>;
export type Policy=z.infer<typeof policySchema>;

const launchContextSchema=z.object({patientId:patientIdSchema,encounterId:encounterIdSchema,organizationId:orgIdSchema,principalId:id}).strict();
const sourceConfigSchema=z.object({sourceId:id,label,freshUntil:isoInstant,enabled:z.boolean(),adapterMode:z.enum(['configured','unconfigured','disabled']),organizationId:orgIdSchema.optional(),adapterId:id.optional()}).strict();
const ingestEnvelopeSchema=z.object({sourceId:id,eventId:id,patientId:patientIdSchema,organizationId:orgIdSchema,metric:z.enum(metrics),value:z.number().finite(),unit:z.string().trim().min(1).max(40),observedAt:isoInstant,receivedAt:isoInstant,provenance:z.enum(['ehr','device','lab','manual-import']),correctedEventId:id.optional()}).strict();
const savedNoteSchema=z.object({noteId:id,patientId:patientIdSchema,encounterId:encounterIdSchema,payloadDigest:label,savedAt:isoInstant,savedBy:label}).strict();
const providerReceiptSchema=z.object({outboxId:id,attemptId:id,adapterId:id,providerMessageId:id,status:z.enum(['acknowledged','failed']),retryable:z.boolean().optional()}).strict();

// This context is built by the server. None of these attestations are accepted in actions.
const trustedIntegrationSchema=z.object({
  actorKind:z.enum(['server','server-adapter']),organizationId:orgIdSchema,verified:z.literal(true),
  principal:principalSchema.optional(),launchContext:launchContextSchema.optional(),
  trustedSourceIds:z.array(id).max(1000).default([]),trustedAdapterId:id.optional(),
  savedNote:savedNoteSchema.optional(),receipt:providerReceiptSchema.optional(),
}).strict();
const contextSchema=z.object({actor:label,now:isoInstant,patients:z.array(z.object({id:patientIdSchema,name:label}).passthrough()),features:z.record(z.boolean()),integrationAccess:trustedIntegrationSchema.optional()}).strict();
export type Context=z.input<typeof contextSchema>;
type ParsedContext=z.infer<typeof contextSchema>;
export type TrustedIntegrationContext=z.input<typeof trustedIntegrationSchema>;

const baseActionSchema=z.object({requestId:id,expectedVersion:nonnegative}).strict();
export const actionSchema=z.discriminatedUnion('type',[
  baseActionSchema.extend({type:z.literal('integration-access.policy.draft'),policy:policySchema}),
  baseActionSchema.extend({type:z.literal('integration-access.policy.replace'),policy:policySchema}),
  baseActionSchema.extend({type:z.literal('integration-access.source.save'),source:sourceConfigSchema}),
  baseActionSchema.extend({type:z.literal('integration-access.launch.validate'),context:launchContextSchema}),
  baseActionSchema.extend({type:z.literal('integration-access.event.ingest'),envelope:ingestEnvelopeSchema}),
  baseActionSchema.extend({type:z.literal('integration-access.event.reconcile'),quarantineId:id,resolution:z.object({accept:z.boolean(),patientId:patientIdSchema.optional(),unit:z.string().trim().min(1).max(40).optional(),value:z.number().finite().optional(),note:text}).strict()}),
  baseActionSchema.extend({type:z.literal('integration-access.outbox.prepare'),patientId:patientIdSchema,sourceId:id,encounterId:encounterIdSchema,noteId:id,payloadDigest:label,expectedPolicyVersion:z.number().int().min(1)}),
  baseActionSchema.extend({type:z.literal('integration-access.outbox.pending'),outboxId:id}),
  baseActionSchema.extend({type:z.literal('integration-access.outbox.retry'),outboxId:id}),
  baseActionSchema.extend({type:z.literal('integration-access.outbox.attempt'),outboxId:id}),
  baseActionSchema.extend({type:z.literal('integration-access.outbox.acknowledge'),outboxId:id}),
  baseActionSchema.extend({type:z.literal('integration-access.outbox.manual-evidence'),patientId:patientIdSchema,outboxId:id.optional(),note:text}),
]);
export type Action=z.infer<typeof actionSchema>;
export type AuthorizationDecision={allowed:boolean;reason:string;policyVersion:number};
const milliseconds=(value:string)=>Date.parse(value);

function activeAt(now:string,revokedAt?:string,expiresAt?:string){
  return (!revokedAt||milliseconds(revokedAt)>milliseconds(now))&&(!expiresAt||milliseconds(expiresAt)>milliseconds(now));
}
function hasRelationship(principal:Principal,patientId:string,kind:RelationshipKind,organizationId:string,now:string){
  const matching=principal.relationships.filter(item=>item.patientId===patientId&&item.organizationId===organizationId&&item.kind===kind);
  // A revoked duplicate must not be bypassed by an older unsuperseded relationship.
  if(matching.some(item=>item.revokedAt&&milliseconds(item.revokedAt)<=milliseconds(now))) return false;
  return matching.some(item=>activeAt(now,item.revokedAt,item.expiresAt));
}
function hasConsent(principal:Principal,patientId:string,scope:ConsentScope,now:string){
  const matching=principal.consents.filter(item=>item.patientId===patientId&&item.scope===scope&&milliseconds(item.grantedAt)<=milliseconds(now));
  if(!matching.length) return false;
  const newest=Math.max(...matching.map(item=>milliseconds(item.grantedAt)));
  return matching.filter(item=>milliseconds(item.grantedAt)===newest).every(item=>item.granted&&activeAt(now,item.revokedAt,item.expiresAt));
}

/** A policy decision only: the caller must obtain principal from a verified server identity provider. */
export function authorize(principalInput:unknown,actionInput:PermissionAction,patientId:string,policyInput:unknown,nowInput:string):AuthorizationDecision{
  const parsedPolicy=policySchema.safeParse(policyInput);
  const deny=(reason:string):AuthorizationDecision=>({allowed:false,reason,policyVersion:parsedPolicy.success?parsedPolicy.data.version:0});
  const parsedPrincipal=principalSchema.safeParse(principalInput);
  const parsedNow=isoInstant.safeParse(nowInput);
  if(!parsedPolicy.success||!parsedPrincipal.success||!parsedNow.success||!z.enum(permissionActions).safeParse(actionInput).success) return deny('Invalid authorization context.');
  const principal=parsedPrincipal.data,policy=parsedPolicy.data,now=parsedNow.data;
  if(!principal.verifiedServerIdentity) return deny('Principal identity is not verified by the server.');
  const patientOrg=Object.hasOwn(policy.patientOrganizations,patientId)?policy.patientOrganizations[patientId]:undefined;
  if(!patientOrg) return deny('Patient context is unknown to policy.');
  if(principal.organizationId!==patientOrg) return deny('Cross-organization access is blocked.');
  const rule=policy.permissions.find(item=>item.role===principal.role&&item.action===actionInput);
  if(!rule?.allow) return deny(rule?'Policy explicitly denies this action for the role.':'Policy has no allow rule for this role and action.');
  if(actionInput==='integration.configure'){
    if(!['workspace-owner','integration-admin'].includes(principal.role)) return deny('Integration configuration requires an integration administrator.');
  }else{
    if(['workspace-owner','integration-admin'].includes(principal.role)) return deny('Workspace administration does not grant clinical record access.');
    if(principal.role!=='clinician'&&actionInput!=='records.read') return deny('This role cannot change or export clinical records.');
    const requiredRelationship:RelationshipKind=principal.role==='clinician'?'care-team':principal.role==='patient'?'self':'proxy';
    if(!hasRelationship(principal,patientId,requiredRelationship,patientOrg,now)) return deny('An active care relationship is required.');
    const requiredScope:ConsentScope=actionInput==='records.read'?'read':actionInput==='records.write'?'write':actionInput==='records.export'?'export':'integration';
    if(!hasConsent(principal,patientId,requiredScope,now)) return deny('An active patient consent is required.');
  }
  if(rule.requiresRelationship?.length&&!rule.requiresRelationship.some(kind=>hasRelationship(principal,patientId,kind,patientOrg,now))) return deny('An active care relationship is required by policy.');
  if(rule.consentScope&&!hasConsent(principal,patientId,rule.consentScope,now)) return deny('An active patient consent is required by policy.');
  return {allowed:true,reason:'Allowed by policy for the verified principal.',policyVersion:policy.version};
}

const acceptedEventSchema=ingestEnvelopeSchema.extend({id,outOfOrder:z.boolean(),reconciledFrom:id.optional()});
const quarantinedEventSchema=z.object({id,event:ingestEnvelopeSchema,reason:text,serverTime:isoInstant,resolved:z.object({at:isoInstant,by:label,note:text,accepted:z.boolean(),acceptedEventId:id.optional()}).strict().optional()}).strict();
const bridgeObservationSchema=z.object({patientId:patientIdSchema,organizationId:orgIdSchema,metric:z.enum(metrics),value:z.number().finite(),unit:z.string(),observedAt:isoInstant,receivedAt:isoInstant,sourceId:id,eventId:id,recordedAt:isoInstant,provenance:z.enum(['ehr','device','lab','manual-import']),correctedEventId:id.optional()}).strict();
const outboxStatusSchema=z.enum(['prepared','pending','attempted','acknowledged','failed','retryable']);
const outboxSchema=z.object({id,patientId:patientIdSchema,organizationId:orgIdSchema,sourceId:id,encounterId:encounterIdSchema,noteId:id,payloadDigest:label,idempotencyKey:text,status:outboxStatusSchema,attempts:nonnegative,attemptId:id.optional(),adapterId:id.optional(),createdAt:isoInstant,updatedAt:isoInstant,preparedBy:id,providerMessageId:id.optional(),failureReason:text.optional(),requestId:id,expectedPolicyVersion:z.number().int().min(1)}).strict();
const auditSchema=z.object({id,at:isoInstant,actor:label,action:id,patientId:patientIdSchema.optional(),allowed:z.boolean().optional(),reason:text}).strict();
export const stateSchema=z.object({
  version:nonnegative,policy:policySchema,policyDraft:policySchema.optional(),policyDraftSavedAt:isoInstant.optional(),
  sourceConfigs:z.record(id,sourceConfigSchema),acceptedEvents:z.array(acceptedEventSchema).max(10000),quarantinedEvents:z.array(quarantinedEventSchema).max(10000),bridgeObservations:z.array(bridgeObservationSchema).max(10000),
  launch:z.object({status:z.enum(['not-validated','verified','blocked']),context:launchContextSchema.optional(),reason:text.optional(),validatedAt:isoInstant.optional()}).strict(),
  outbox:z.array(outboxSchema).max(10000),localWritebackNotes:z.array(savedNoteSchema).max(10000),
  providerReceipts:z.array(providerReceiptSchema.extend({recordedAt:isoInstant,recordedBy:label})).max(10000).default([]),
  externalEvidence:z.array(z.object({id,patientId:patientIdSchema,outboxId:id.optional(),note:text,reportedAt:isoInstant,reporter:label,kind:z.literal('manual-report')}).strict()).max(10000),
  adapter:z.object({mode:z.enum(['disabled','unconfigured','configured']),trustedServerActors:z.array(id)}).strict(),
  handledRequestIds:z.record(id,z.object({version:nonnegative,command:id,fingerprint:z.string(),actor:label}).strict()),audit:z.array(auditSchema).max(20000),
}).strict();
export type State=z.infer<typeof stateSchema>;
export type IngestedBridgeEvent=z.infer<typeof acceptedEventSchema>;
export type QuarantinedEvent=z.infer<typeof quarantinedEventSchema>;
export type OutboxStatus=z.infer<typeof outboxStatusSchema>;
export type OutboxRecord=z.infer<typeof outboxSchema>;
export type AuditRecord=z.infer<typeof auditSchema>;

const emptyState:State={
  version:0,
  policy:{version:1,sharedOwnerEvaluation:true,patientOrganizations:{},permissions:[
    {role:'workspace-owner',action:'integration.configure',allow:true},
    {role:'integration-admin',action:'integration.configure',allow:true},
    {role:'clinician',action:'records.read',allow:true,requiresRelationship:['care-team'],consentScope:'read'},
    {role:'clinician',action:'records.write',allow:true,requiresRelationship:['care-team'],consentScope:'write'},
    {role:'clinician',action:'records.export',allow:true,requiresRelationship:['care-team'],consentScope:'export'},
    {role:'clinician',action:'integration.writeback',allow:true,requiresRelationship:['care-team'],consentScope:'integration'},
    {role:'proxy',action:'records.read',allow:true,requiresRelationship:['proxy'],consentScope:'read'},
    {role:'patient',action:'records.read',allow:true,requiresRelationship:['self'],consentScope:'read'},
    {role:'workspace-owner',action:'records.read',allow:false},
  ]},
  sourceConfigs:{'ehr-primary':{sourceId:'ehr-primary',label:'Primary EHR feed',freshUntil:'2099-01-01T00:00:00.000Z',enabled:false,adapterMode:'unconfigured'}},
  acceptedEvents:[],quarantinedEvents:[],bridgeObservations:[],launch:{status:'not-validated'},outbox:[],localWritebackNotes:[],providerReceipts:[],externalEvidence:[],adapter:{mode:'unconfigured',trustedServerActors:[]},handledRequestIds:{},audit:[],
};

function stable(value:unknown):string{
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+':'+stable(item)).join(',')+'}';
  return JSON.stringify(value)??'null';
}
function keyFor(row:Pick<OutboxRecord,'organizationId'|'sourceId'|'patientId'|'encounterId'|'noteId'|'payloadDigest'>){return JSON.stringify([row.organizationId,row.sourceId,row.patientId,row.encounterId,row.noteId,row.payloadDigest]);}
function sourceMode(sources:State['sourceConfigs']):State['adapter']['mode']{
  const rows=Object.values(sources);
  if(rows.some(source=>source.enabled&&source.adapterMode==='configured')) return 'configured';
  return rows.length&&rows.every(source=>source.adapterMode==='disabled')?'disabled':'unconfigured';
}
function requirePatient(context:ParsedContext,patientId:string){if(!context.patients.some(patient=>patient.id===patientId)) throw new Error('Patient is outside the current workspace.');}
function requireTrusted(context:ParsedContext,kind:'server'|'server-adapter'){
  const trusted=context.integrationAccess;
  if(!trusted||trusted.actorKind!==kind||!trusted.verified) throw new Error('This command requires trusted server identity or adapter context.');
  if(kind==='server-adapter'&&context.actor!==trusted.trustedAdapterId) throw new Error('Untrusted adapter actor.');
  return trusted;
}
function requirePrincipal(context:ParsedContext,kind:'server'|'server-adapter'='server'){
  const trusted=requireTrusted(context,kind);
  const principal=trusted.principal;
  if(!principal?.verifiedServerIdentity||principal.organizationId!==trusted.organizationId||(kind==='server'&&principal.id!==context.actor)) throw new Error('Verified principal does not match the trusted actor and organization.');
  return principal;
}
function requirePermission(state:State,context:ParsedContext,patientId:string,action:PermissionAction,kind:'server'|'server-adapter'='server'){
  requirePatient(context,patientId);
  const principal=requirePrincipal(context,kind);
  const decision=authorize(principal,action,patientId,state.policy,context.now);
  if(!decision.allowed) throw new Error(decision.reason);
  return principal;
}
function requireConfigure(state:State,context:ParsedContext){
  const principal=requirePrincipal(context);
  // Configuration with no patient mapping can bootstrap only the verified administrator's own organization.
  const rule=state.policy.permissions.find(item=>item.role===principal.role&&item.action==='integration.configure');
  if(!['workspace-owner','integration-admin'].includes(principal.role)||!rule?.allow) throw new Error('Integration configuration requires an authorized administrator.');
  if(rule.requiresRelationship?.length||rule.consentScope) throw new Error('Patient-bound configuration rules need an explicit patient scope.');
  return principal;
}
function requireIngestion(state:State,context:ParsedContext,patientId:string,kind:'server'|'server-adapter'){
  const principal=requirePermission(state,context,patientId,'records.write',kind);
  if(!hasConsent(principal,patientId,'integration',context.now))throw new Error('Current patient consent for integration is required.');
}
function requireSource(state:State,context:ParsedContext,sourceId:string){
  const trusted=context.integrationAccess;
  const source=Object.hasOwn(state.sourceConfigs,sourceId)?state.sourceConfigs[sourceId]:undefined;
  if(!trusted?.trustedSourceIds.includes(sourceId)||!source||source.organizationId!==trusted.organizationId||source.adapterId!==trusted.trustedAdapterId) throw new Error('Source is outside the trusted adapter and organization scope.');
  return source;
}
function ensureWriteback(state:State,context:ParsedContext,row:Pick<OutboxRecord,'patientId'|'organizationId'|'sourceId'|'expectedPolicyVersion'>,kind:'server'|'server-adapter'='server'){
  requirePermission(state,context,row.patientId,'records.write',kind);
  const principal=requirePermission(state,context,row.patientId,'integration.writeback',kind);
  if(state.policy.patientOrganizations[row.patientId]!==row.organizationId) throw new Error('Write-back organization mismatch.');
  if(row.expectedPolicyVersion!==state.policy.version) throw new Error('Policy version is stale. Reload policy before preparing write-back.');
  requireSource(state,context,row.sourceId);
  return principal;
}
function getOutbox(state:State,outboxId:string){const row=state.outbox.find(item=>item.id===outboxId);if(!row) throw new Error('Outbox record not found.');return row;}
function eventIssue(state:State,event:z.infer<typeof ingestEnvelopeSchema>,now:string,patients:ParsedContext['patients'],reconcileId?:string):string|undefined{
  const source=Object.hasOwn(state.sourceConfigs,event.sourceId)?state.sourceConfigs[event.sourceId]:undefined;
  if(!source) return 'Unknown source.';
  if(!source.enabled||source.adapterMode!=='configured') return 'Source is not enabled/configured.';
  if(milliseconds(source.freshUntil)<=milliseconds(now)) return 'Source freshness expired.';
  if(source.organizationId!==event.organizationId||state.policy.patientOrganizations[event.patientId]!==event.organizationId||!patients.some(patient=>patient.id===event.patientId)) return 'Patient mapping mismatch.';
  if(milliseconds(event.receivedAt)<milliseconds(event.observedAt)) return 'Received time precedes observed time.';
  if(milliseconds(event.receivedAt)>milliseconds(now)||milliseconds(event.observedAt)>milliseconds(now)) return 'Event time is in the future.';
  if(!(unitsByMetric[event.metric] as readonly string[]).includes(event.unit)) return 'Unit mismatch for metric.';
  if(event.metric==='heartRate'?(event.value<=0||event.value>300):(event.value<0||event.value>10)) return 'Value is outside the metric range.';
  if(state.acceptedEvents.some(item=>item.sourceId===event.sourceId&&item.eventId===event.eventId)||(!reconcileId&&state.quarantinedEvents.some(item=>item.event.sourceId===event.sourceId&&item.event.eventId===event.eventId))) return 'Duplicate stable event ID.';
  if(event.correctedEventId){
    const target=state.acceptedEvents.find(item=>item.sourceId===event.sourceId&&item.eventId===event.correctedEventId);
    if(!target) return 'Correction target not found.';
    if(target.patientId!==event.patientId||target.organizationId!==event.organizationId||target.metric!==event.metric||event.correctedEventId===event.eventId) return 'Correction target belongs to a different patient, organization, or metric.';
    if(state.acceptedEvents.some(item=>item.sourceId===event.sourceId&&item.correctedEventId===event.correctedEventId)) return 'Correction target has already been superseded.';
  }
  return undefined;
}
function acceptEvent(state:State,event:z.infer<typeof ingestEnvelopeSchema>,now:string,reconciledFrom?:string){
  const prior=state.acceptedEvents.filter(item=>item.patientId===event.patientId&&item.metric===event.metric&&item.sourceId===event.sourceId);
  const latest=prior.length?Math.max(...prior.map(item=>milliseconds(item.observedAt))):-Infinity;
  const accepted:IngestedBridgeEvent={...event,id:crypto.randomUUID(),outOfOrder:milliseconds(event.observedAt)<latest,...(reconciledFrom?{reconciledFrom}:{})};
  state.acceptedEvents.unshift(accepted);
  if(event.correctedEventId) state.bridgeObservations=state.bridgeObservations.filter(item=>!(item.sourceId===event.sourceId&&item.eventId===event.correctedEventId&&item.patientId===event.patientId));
  state.bridgeObservations.unshift({...event,recordedAt:now});
  return accepted;
}

/** Safe normalization only: unknown or inconsistent persisted facts are rejected, never invented. */
export function initialState():State{return structuredClone(emptyState);}
export function normalizeState(input:unknown):State{
  if(input===undefined) return structuredClone(emptyState);
  const parsed=stateSchema.parse(input);
  const result=inspectState(parsed);
  if(!result.ok) throw new Error(result.errors.join(' '));
  return parsed;
}
export function validateState(input:unknown):State{return normalizeState(input);}
export function inspectState(input:unknown):{ok:boolean;errors:string[]}{
  const parsed=stateSchema.safeParse(input);
  if(!parsed.success) return {ok:false,errors:parsed.error.issues.map(issue=>`${issue.path.join('.')||'state'}: ${issue.message}`)};
  const state=parsed.data,errors:string[]=[];
  const unique=(values:string[],what:string)=>{if(new Set(values).size!==values.length) errors.push('Duplicate '+what+'.');};
  unique(state.acceptedEvents.map(item=>item.id),'accepted event row ID');
  unique(state.acceptedEvents.map(item=>JSON.stringify([item.sourceId,item.eventId])),'accepted source/event ID');
  unique(state.quarantinedEvents.map(item=>item.id),'quarantine ID');
  unique(state.outbox.map(item=>item.id),'outbox ID');
  unique(state.outbox.map(item=>item.idempotencyKey),'outbox idempotency key');
  unique(state.outbox.flatMap(item=>item.providerMessageId?[JSON.stringify([item.adapterId,item.providerMessageId])]:[]),'current provider receipt');
  unique(state.providerReceipts.map(item=>JSON.stringify([item.adapterId,item.providerMessageId])),'provider receipt');
  unique(state.providerReceipts.map(item=>JSON.stringify([item.outboxId,item.attemptId])),'provider attempt receipt');
  unique(state.externalEvidence.map(item=>item.id),'manual evidence ID');
  unique(state.bridgeObservations.map(item=>JSON.stringify([item.sourceId,item.eventId])),'bridge source/event ID');
  if(sourceMode(state.sourceConfigs)!==state.adapter.mode) errors.push('Adapter mode does not match configured sources.');
  const registered=[...new Set(Object.values(state.sourceConfigs).flatMap(source=>source.adapterMode==='configured'&&source.adapterId?[source.adapterId]:[]))].sort();
  if(stable([...state.adapter.trustedServerActors].sort())!==stable(registered)) errors.push('Adapter registry does not match configured sources.');
  for(const [key,source] of Object.entries(state.sourceConfigs)){
    if(key!==source.sourceId) errors.push('Source identifier mismatch.');
    if(source.adapterMode==='configured'&&(!source.organizationId||!source.adapterId)) errors.push('Configured sources need an organization and adapter.');
  }
  for(const row of state.outbox){
    if(row.status==='acknowledged'&&(!row.providerMessageId||!row.adapterId||!row.attemptId||row.attempts<1||!state.providerReceipts.some(receipt=>receipt.outboxId===row.id&&receipt.attemptId===row.attemptId&&receipt.providerMessageId===row.providerMessageId&&receipt.status==='acknowledged'))) errors.push('Acknowledged outbox rows need an attested provider receipt and attempt.');
    if(['attempted','retryable'].includes(row.status)&&(!row.attemptId||!row.adapterId||row.attempts<1)) errors.push('Attempted outbox rows need an adapter and attempt.');
    if(row.idempotencyKey!==keyFor(row)) errors.push('Outbox idempotency key mismatch.');
    if(state.policy.patientOrganizations[row.patientId]!==row.organizationId) errors.push('Outbox has cross-organization mismatch.');
    if(!state.localWritebackNotes.some(note=>note.noteId===row.noteId&&note.patientId===row.patientId&&note.encounterId===row.encounterId&&note.payloadDigest===row.payloadDigest)) errors.push('Outbox lacks trusted local note metadata.');
  }
  for(const event of state.acceptedEvents){
    if(state.policy.patientOrganizations[event.patientId]!==event.organizationId||state.sourceConfigs[event.sourceId]?.organizationId!==event.organizationId) errors.push('Accepted event has cross-organization mismatch.');
    if(!(unitsByMetric[event.metric] as readonly string[]).includes(event.unit)) errors.push('Accepted event has invalid units.');
    if(event.metric==='heartRate'?(event.value<=0||event.value>300):(event.value<0||event.value>10)) errors.push('Accepted event has invalid value.');
    if(milliseconds(event.observedAt)>milliseconds(event.receivedAt)) errors.push('Accepted event has invalid time ordering.');
    if(event.correctedEventId){
      const target=state.acceptedEvents.find(item=>item.sourceId===event.sourceId&&item.eventId===event.correctedEventId);
      if(!target||target.patientId!==event.patientId||target.organizationId!==event.organizationId||target.metric!==event.metric||target.id===event.id) errors.push('Invalid correction target.');
    }
    if(event.reconciledFrom&&!state.quarantinedEvents.some(item=>item.id===event.reconciledFrom&&item.resolved?.accepted&&item.resolved.acceptedEventId===event.id)) errors.push('Reconciled event lacks its documented quarantine resolution.');
    const superseded=state.acceptedEvents.some(item=>item.sourceId===event.sourceId&&item.correctedEventId===event.eventId);
    const bridge=state.bridgeObservations.find(item=>item.sourceId===event.sourceId&&item.eventId===event.eventId);
    if(superseded&&bridge||!superseded&&!bridge) errors.push('Correction and active bridge disagree.');
  }
  unique(state.acceptedEvents.flatMap(item=>item.correctedEventId?[JSON.stringify([item.sourceId,item.correctedEventId])]:[]),'correction target');
  for(const event of state.acceptedEvents){
    const visited=new Set<string>();let current:IngestedBridgeEvent|undefined=event;
    while(current?.correctedEventId){
      if(visited.has(current.id)){errors.push('Correction lineage contains a cycle.');break;}
      visited.add(current.id);const targetId:string=current.correctedEventId;
      current=state.acceptedEvents.find(item=>item.sourceId===event.sourceId&&item.eventId===targetId);
    }
  }
  for(const receipt of state.providerReceipts){
    const row=state.outbox.find(item=>item.id===receipt.outboxId);
    if(!row||row.adapterId!==receipt.adapterId||!row.attemptId) errors.push('Provider receipt does not belong to an attempted outbox item.');
  }
  for(const observation of state.bridgeObservations){
    const event=state.acceptedEvents.find(item=>item.sourceId===observation.sourceId&&item.eventId===observation.eventId);
    const {recordedAt,...bridgeEvent}=observation;
    if(milliseconds(recordedAt)<milliseconds(observation.receivedAt)) errors.push('Bridge recording time precedes receipt.');
    const acceptedEnvelope=event?Object.fromEntries(Object.keys(ingestEnvelopeSchema.shape).filter(key=>key in event).map(key=>[key,event[key as keyof typeof event]])):undefined;
    if(!event||stable(bridgeEvent)!==stable(acceptedEnvelope)) errors.push('Bridge observation differs from accepted event.');
  }
  for(const event of state.quarantinedEvents){
    if(event.resolved?.accepted&&!state.acceptedEvents.some(item=>item.id===event.resolved?.acceptedEventId&&item.reconciledFrom===event.id)) errors.push('Accepted reconciliation lacks its accepted event.');
  }
  for(const evidence of state.externalEvidence){
    if(evidence.outboxId&&!state.outbox.some(row=>row.id===evidence.outboxId&&row.patientId===evidence.patientId)) errors.push('Manual evidence has a mismatched outbox patient.');
  }
  for(const receipt of Object.values(state.handledRequestIds)) if(receipt.version>state.version) errors.push('Request receipt has a future state version.');
  if(state.launch.status==='verified'&&(!state.launch.context||!state.launch.validatedAt||state.policy.patientOrganizations[state.launch.context.patientId]!==state.launch.context.organizationId)) errors.push('Verified launch lacks a valid patient/organization context.');
  return {ok:!errors.length,errors};
}

export function reduce(stateInput:State,input:Action,contextInput:Context):State{
  const action=actionSchema.parse(input),context=contextSchema.parse(contextInput),next=normalizeState(stateInput);
  if(context.features.integrationAccess===false) throw new Error('Integration access workflow is disabled.');
  const fingerprint=stable({action,actor:context.actor,organizationId:context.integrationAccess?.organizationId,principalId:context.integrationAccess?.principal?.id,receipt:context.integrationAccess?.receipt});
  // Authenticate before considering replay; stored receipts cannot substitute for current privileges.
  switch(action.type){
    case 'integration-access.policy.replace':requireConfigure(next,context);break;
    case 'integration-access.source.save':{
      const existing=next.sourceConfigs[action.source.sourceId];
      if(action.source.enabled||action.source.adapterMode==='configured'||action.source.organizationId||action.source.adapterId||existing?.organizationId) requireConfigure(next,context);
      break;
    }
    case 'integration-access.launch.validate':requirePrincipal(context);break;
    case 'integration-access.event.ingest':requireTrusted(context,'server-adapter');requireSource(next,context,action.envelope.sourceId);requireIngestion(next,context,action.envelope.patientId,'server-adapter');break;
    case 'integration-access.event.reconcile':{
      const event=next.quarantinedEvents.find(item=>item.id===action.quarantineId);
      if(!event) throw new Error('Quarantined event not found.');
      if(action.resolution.accept){requireIngestion(next,context,action.resolution.patientId??event.event.patientId,'server');requireSource(next,context,event.event.sourceId);}
      else if(context.integrationAccess){
        const principal=requirePrincipal(context);requireSource(next,context,event.event.sourceId);
        if(['workspace-owner','integration-admin'].includes(principal.role)) requireConfigure(next,context);
        else requirePermission(next,context,event.event.patientId,'records.write');
      }
      break;
    }
    case 'integration-access.outbox.prepare':{
      const trusted=requireTrusted(context,'server');
      ensureWriteback(next,context,{...action,organizationId:trusted.organizationId});
      const note=trusted.savedNote;
      if(!note||note.noteId!==action.noteId||note.patientId!==action.patientId||note.encounterId!==action.encounterId||note.payloadDigest!==action.payloadDigest||milliseconds(note.savedAt)>milliseconds(context.now)) throw new Error('Write-back must reference trusted locally saved note metadata.');
      break;
    }
    case 'integration-access.outbox.pending':case 'integration-access.outbox.retry':case 'integration-access.outbox.attempt':ensureWriteback(next,context,getOutbox(next,action.outboxId),action.type==='integration-access.outbox.attempt'?'server-adapter':'server');break;
    case 'integration-access.outbox.acknowledge':{
      const trusted=requireTrusted(context,'server-adapter'),row=getOutbox(next,action.outboxId);
      requirePatient(context,row.patientId);requireSource(next,context,row.sourceId);
      if(trusted.organizationId!==row.organizationId||trusted.receipt?.outboxId!==row.id||trusted.receipt.adapterId!==trusted.trustedAdapterId||trusted.receipt.attemptId!==row.attemptId) throw new Error('Acknowledgement requires a trusted receipt for this exact outbox attempt.');
      break;
    }
    case 'integration-access.outbox.manual-evidence':{
      requirePatient(context,action.patientId);
      if(context.integrationAccess) requirePermission(next,context,action.patientId,'records.write');
      if(action.outboxId&&getOutbox(next,action.outboxId).patientId!==action.patientId) throw new Error('Manual evidence and outbox patient do not match.');
      break;
    }
  }
  const handled=Object.hasOwn(next.handledRequestIds,action.requestId)?next.handledRequestIds[action.requestId]:undefined;
  if(handled){if(handled.fingerprint!==fingerprint||handled.actor!==context.actor) throw new Error('Request ID was already used for a different command, actor, or payload.');return next;}
  if(action.expectedVersion!==next.version) throw new Error('State version mismatch. Reload and retry with the latest version.');
  const audit=(reason:string,patientId?:string,allowed=true)=>next.audit.unshift({id:crypto.randomUUID(),at:context.now,actor:context.actor,action:action.type,reason,...(patientId?{patientId}:{}),allowed});
  const finish=()=>{
    next.version+=1;
    next.handledRequestIds[action.requestId]={version:next.version,command:action.type,fingerprint,actor:context.actor};
    const validation=inspectState(next);if(!validation.ok) throw new Error(validation.errors.join(' '));
    return next;
  };
  switch(action.type){
    case 'integration-access.policy.draft':{
      if(action.policy.version!==next.policy.version+1) throw new Error('Draft policy version must be the next active policy version.');
      for(const patientId of Object.keys(action.policy.patientOrganizations)) requirePatient(context,patientId);
      next.policyDraft=action.policy;next.policyDraftSavedAt=context.now;
      audit('Evaluation policy draft saved. Active clinical permissions are unchanged.');break;
    }
    case 'integration-access.policy.replace':{
      if(action.policy.version!==next.policy.version+1) throw new Error('Policy version must increase by one.');
      const organizationId=context.integrationAccess!.organizationId;
      if(Object.values(next.policy.patientOrganizations).some(value=>value!==organizationId)) throw new Error('This policy contains another organization; use a tenant-scoped policy before updating it.');
      for(const patientId of new Set([...Object.keys(next.policy.patientOrganizations),...Object.keys(action.policy.patientOrganizations)])){
        const old=next.policy.patientOrganizations[patientId],replacement=action.policy.patientOrganizations[patientId];
        if(old!==replacement&&(old&&old!==organizationId||replacement&&replacement!==organizationId)) throw new Error('Policy changes cannot modify another organization.');
        if(old!==replacement&&old) throw new Error('Existing patient organization mappings cannot be reassigned.');
        if(replacement&&!old) requirePatient(context,patientId);
      }
      next.policy=action.policy;delete next.policyDraft;delete next.policyDraftSavedAt;
      next.launch={status:'not-validated',reason:'Policy changed; validate launch again.'};
      audit('Active policy replaced by verified administrator.');break;
    }
    case 'integration-access.source.save':{
      let source=action.source;
      const existing=next.sourceConfigs[source.sourceId];
      if(context.integrationAccess&&(source.enabled||source.adapterMode==='configured'||source.organizationId||source.adapterId||existing?.organizationId)){
        const trusted=context.integrationAccess;
        if(existing?.organizationId&&existing.organizationId!==trusted.organizationId||source.organizationId&&source.organizationId!==trusted.organizationId) throw new Error('Source belongs to a different organization.');
        if(source.adapterMode==='configured'&&(!trusted.trustedSourceIds.includes(source.sourceId)||!trusted.trustedAdapterId||milliseconds(source.freshUntil)<=milliseconds(context.now))) throw new Error('Source configuration needs a trusted, current adapter registration.');
        if(source.adapterId&&source.adapterId!==trusted.trustedAdapterId) throw new Error('Source adapter does not match trusted registration.');
        if(existing?.adapterId&&trusted.trustedAdapterId!==existing.adapterId&&next.outbox.some(row=>row.sourceId===source.sourceId&&['prepared','pending','attempted','retryable'].includes(row.status))) throw new Error('Cannot reassign an adapter while write-back is unresolved.');
        source={...source,organizationId:trusted.organizationId,...(source.adapterMode==='configured'?{adapterId:trusted.trustedAdapterId!}:{})};
      }
      if(source.enabled&&source.adapterMode!=='configured') throw new Error('Only a configured source can be enabled.');
      next.sourceConfigs[source.sourceId]=source;
      next.adapter.mode=sourceMode(next.sourceConfigs);
      next.adapter.trustedServerActors=[...new Set(Object.values(next.sourceConfigs).flatMap(item=>item.adapterMode==='configured'&&item.adapterId?[item.adapterId]:[]))];
      audit(source.adapterMode==='configured'?'Source configuration saved from trusted adapter registration.':'Source draft saved; external connectivity remains unconfigured.');break;
    }
    case 'integration-access.launch.validate':{
      const trusted=context.integrationAccess!,principal=trusted.principal!;
      if(!trusted.launchContext||stable(trusted.launchContext)!==stable(action.context)) throw new Error('Launch context must match the server-validated launch exactly.');
      requirePatient(context,action.context.patientId);
      let reason:string|undefined;
      if(action.context.principalId!==principal.id) reason='Launch context principal mismatch.';
      else if(action.context.organizationId!==trusted.organizationId||next.policy.patientOrganizations[action.context.patientId]!==action.context.organizationId) reason='Patient and organization context do not match policy.';
      else {const decision=authorize(principal,'records.read',action.context.patientId,next.policy,context.now);if(!decision.allowed) reason=decision.reason;}
      next.launch={status:reason?'blocked':'verified',context:action.context,reason:reason??'Verified launch context.',validatedAt:context.now};
      audit(next.launch.reason!,action.context.patientId,!reason);break;
    }
    case 'integration-access.event.ingest':{
      const event=action.envelope;
      if(event.organizationId!==context.integrationAccess!.organizationId) throw new Error('Event organization differs from the trusted adapter organization.');
      const reason=eventIssue(next,event,context.now,context.patients);
      if(reason){next.quarantinedEvents.unshift({id:crypto.randomUUID(),event,reason,serverTime:context.now});audit(reason,event.patientId,false);}
      else{acceptEvent(next,event,context.now);audit('Event accepted with source provenance.',event.patientId);}
      break;
    }
    case 'integration-access.event.reconcile':{
      const quarantined=next.quarantinedEvents.find(item=>item.id===action.quarantineId)!;
      if(quarantined.resolved) throw new Error('Quarantined event already reconciled.');
      let accepted:IngestedBridgeEvent|undefined;
      if(action.resolution.accept){
        const resolution=action.resolution;
        if(resolution.unit&&resolution.unit!==quarantined.event.unit&&resolution.value===undefined) throw new Error('Changing units requires an explicit corrected value and evidence note.');
        const patched={...quarantined.event,patientId:resolution.patientId??quarantined.event.patientId,unit:resolution.unit??quarantined.event.unit,value:resolution.value??quarantined.event.value};
        const reason=eventIssue(next,patched,context.now,context.patients,quarantined.id);
        if(reason) throw new Error('Reconciliation rejected: '+reason);
        accepted=acceptEvent(next,patched,context.now,quarantined.id);
      }
      quarantined.resolved={at:context.now,by:context.actor,note:action.resolution.note,accepted:action.resolution.accept,...(accepted?{acceptedEventId:accepted.id}:{})};
      audit(action.resolution.accept?'Quarantine accepted after full validation.':'Quarantine rejected with a documented reason.',quarantined.event.patientId);break;
    }
    case 'integration-access.outbox.prepare':{
      const trusted=context.integrationAccess!,principal=trusted.principal!,note=trusted.savedNote!;
      const idempotencyKey=keyFor({...action,organizationId:trusted.organizationId});
      if(next.outbox.some(item=>item.idempotencyKey===idempotencyKey)){audit('Existing write-back retained for this note revision.',action.patientId);break;}
      if(!next.localWritebackNotes.some(item=>stable(item)===stable(note))) next.localWritebackNotes.unshift(note);
      next.outbox.unshift({id:crypto.randomUUID(),patientId:action.patientId,organizationId:trusted.organizationId,sourceId:action.sourceId,encounterId:action.encounterId,noteId:action.noteId,payloadDigest:action.payloadDigest,idempotencyKey,status:'prepared',attempts:0,createdAt:context.now,updatedAt:context.now,preparedBy:principal.id,requestId:action.requestId,expectedPolicyVersion:action.expectedPolicyVersion});
      audit('Write-back prepared from an existing locally saved note; no external receipt.',action.patientId);break;
    }
    case 'integration-access.outbox.pending':case 'integration-access.outbox.retry':{
      const row=getOutbox(next,action.outboxId);
      const allowed=action.type==='integration-access.outbox.retry'?['failed','retryable']:['prepared','retryable'];
      if(!allowed.includes(row.status)) throw new Error('Invalid outbox transition to pending.');
      row.status='pending';row.updatedAt=context.now;delete row.failureReason;delete row.providerMessageId;
      audit('Write-back queued; external delivery is pending.',row.patientId);break;
    }
    case 'integration-access.outbox.attempt':{
      const row=getOutbox(next,action.outboxId);
      if(row.status!=='pending') throw new Error('Invalid outbox transition to attempted.');
      const source=requireSource(next,context,row.sourceId);
      row.updatedAt=context.now;
      if(!source.enabled||source.adapterMode!=='configured'||milliseconds(source.freshUntil)<=milliseconds(context.now)){row.status='failed';row.failureReason='Adapter unavailable, unconfigured, or stale.';audit(row.failureReason,row.patientId,false);break;}
      row.status='attempted';row.attempts+=1;row.attemptId=crypto.randomUUID();row.adapterId=context.integrationAccess!.trustedAdapterId;
      delete row.failureReason;delete row.providerMessageId;
      audit('Adapter attempt started; no provider acknowledgement yet.',row.patientId);break;
    }
    case 'integration-access.outbox.acknowledge':{
      const row=getOutbox(next,action.outboxId),receipt=context.integrationAccess!.receipt!;
      if(row.status!=='attempted') throw new Error('Only the current attempted write-back can receive a provider receipt.');
      if(next.providerReceipts.some(item=>item.adapterId===receipt.adapterId&&item.providerMessageId===receipt.providerMessageId)) throw new Error('Provider receipt has already been used for another outbox attempt.');
      next.providerReceipts.unshift({...receipt,recordedAt:context.now,recordedBy:context.actor});
      row.providerMessageId=receipt.providerMessageId;row.updatedAt=context.now;
      if(receipt.status==='acknowledged'){row.status='acknowledged';delete row.failureReason;}
      else{row.status=receipt.retryable?'retryable':'failed';row.failureReason='Provider write-back failed.';}
      audit(receipt.status==='acknowledged'?'Provider acknowledgement verified for this attempt.':'Provider reported write-back failure.',row.patientId,receipt.status==='acknowledged');break;
    }
    case 'integration-access.outbox.manual-evidence':{
      next.externalEvidence.unshift({id:crypto.randomUUID(),patientId:action.patientId,...(action.outboxId?{outboxId:action.outboxId}:{}),note:action.note,reportedAt:context.now,reporter:context.actor,kind:'manual-report'});
      audit('Manual report saved separately from verified provider acknowledgements.',action.patientId);break;
    }
  }
  return finish();
}

export function getSummary(state:State,now=new Date().toISOString()){
  const current=isoInstant.safeParse(now),instant=current.success?milliseconds(current.data):Infinity;
  const connected=Object.values(state.sourceConfigs).filter(source=>source.enabled&&source.adapterMode==='configured'&&milliseconds(source.freshUntil)>instant);
  return {
    version:state.version,sharedOwnerEvaluation:state.policy.sharedOwnerEvaluation,
    connectedSources:connected.length,blockedSources:Object.values(state.sourceConfigs).filter(source=>!connected.includes(source)).map(source=>source.sourceId),
    launchStatus:state.launch.status,acceptedEvents:state.acceptedEvents.length,quarantinedEvents:state.quarantinedEvents.filter(event=>!event.resolved).length,
    outbox:Object.fromEntries(outboxStatusSchema.options.map(status=>[status,state.outbox.filter(item=>item.status===status).length])) as Record<OutboxStatus,number>,
    manualReports:state.externalEvidence.length,policyDraftSaved:!!state.policyDraft,
    note:'Shared-owner evaluation. Verified clinical identity and provider connections require server integrations.',
  };
}
