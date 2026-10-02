import {z} from 'zod';

export type Context={
  actor:string;
  now:string;
  patients:readonly {id:string;name:string}[];
  features:Readonly<Record<string, boolean>>;
  carePlans?:readonly {id:string;patientId:string;version:number;summary?:string;goal?:string}[];
  protocolAssignments?:readonly ProtocolAssignmentContext[];
};

export type ProtocolAssignmentContext={
  id:string;version:number;patientId:string;encounterId?:string;protocolId:string;protocolVersion:number;
  protocolSnapshot?:{steps:readonly {id:string;title:string;owner:string;kind:string;prerequisites:readonly string[];nextStepIds?:readonly string[];branchStepIds?:readonly string[];openQuestion?:string;schedule?:{dueAfterDays:number;channel:string;reviewEvidence:string};transitions?:readonly {toStepId:string;when:{kind:'always'}|{kind:'step-status';stepId:string;equals:'completed'}|{kind:'event';eventType:string}|{kind:'review-choice';choiceId:string;equals:string}}[]}[]};
};

const commandPrefix='patient-coordination';
const text=z.string().trim().min(1).max(6000);
const shortText=z.string().trim().min(1).max(200);
const identifier=z.string().trim().min(1).max(120);
const dateOnly=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>!Number.isNaN(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value,'Invalid date');
const timestamp=z.string().trim().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,'Use an ISO timestamp with a timezone').refine(value=>!Number.isNaN(Date.parse(value))&&dateOnly.safeParse(value.slice(0,10)).success,'Invalid timestamp');
const timezone=shortText.max(100).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}},'Use a valid IANA timezone');
const fingerprintSchema=z.string().min(1).max(100_000);
const reminderChannels=['sms','phone','portal','mail','none'] as const;
const handoffPhases=['locally-saved','delivery-reported','ownership-accepted','reviewed','action-documented','response-recorded','closed'] as const;
const handoffStatuses=['pending','reported','failed','retry','overdue'] as const;
const handoffContactStatuses=['not-attempted','attempted','failed','successful'] as const;
const translationStatuses=['not-needed','translated','unsupported','pending-review'] as const;
const pathwayStageStatuses=['pending','active','completed','failed-automation','deferred','declined'] as const;
const schedulePhases=['follow-up-due','requested','booking-reported','confirmed','attended','cancelled','no-show','reschedule-outreach'] as const;
const outreachStatuses=['not-started','in-progress','unreachable','retry-scheduled','completed'] as const;

type HistoryEntry={id:string;at:string;actor:string;from:string;to:string;reason:string;evidenceRef?:string};
type Receipt={requestId:string;fingerprint:string;recordType:'support'|'handoff'|'language'|'pathway'|'schedule';recordId:string;patientId:string;at:string};
type EventReceipt={eventId:string;fingerprint:string;at:string};
type VersionSnapshot={version:number;pathwayVersion:string;updatedAt:string};

type BaseRecord={id:string;patientId:string;encounterId:string;version:number;createdAt:string;updatedAt:string;history:HistoryEntry[]};

export type PatientSupportRecord=BaseRecord&{
  type:'support';
  conversationDate:string;
  planRef:{planId:string;planVersion:number;goalText:string};
  approvedEducation:readonly ('Pain plan copy'|'Scheduling checklist'|'Language access instructions'|'Follow-up reminder sheet')[];
  reminderPreference:{channel:(typeof reminderChannels)[number];optedOut:boolean};
  dueCheckInDate:string;
  originalText:string;
  attributedSummary:string;
  summaryAuthor:string;
  participation:{mode:'digital'|'staff-recorded';participant:'patient'|'caregiver';recordedSource:string};
};

export type HumanHandoffRecord=BaseRecord&{
  type:'handoff';
  concern:string;
  dedupeKey:string;
  priority:'routine'|'high';
  urgencySource:{type:'authorized-human'|'approved-policy'|'patient-request';label:string};
  responsibleTeam:string;
  responsiblePerson:string;
  coverageExpectation:string;
  fallbackOwner:string;
  phase:(typeof handoffPhases)[number];
  deliveryStatus:(typeof handoffStatuses)[number];
  deliveryEvidence?:{source:'receipt'|'manual';reference:string};
  dueAt?:string;
  actionSummary?:string;
  responseSummary?:string;
  patientContact:{status:(typeof handoffContactStatuses)[number];failureReason?:string;nextAttemptAt?:string};
  duplicates:{requestId:string;concern:string;capturedAt:string;actor:string;priority?:'routine'|'high'}[];
};

export type LanguageAccessRecord=BaseRecord&{
  type:'language';
  planRef?:{planId:string;planVersion:number};
  preferredLanguage:'en'|'es';
  instructionsLanguage:'en'|'es';
  sourceText:string;
  translatedText?:string;
  translationStatus:(typeof translationStatuses)[number];
  translationReviewer?:string;
  accessibilityPreferences:string[];
  teachBack:string;
  caregiverRole?:string;
  interpreterRole?:string;
  sharedDevice:boolean;
  proxyStatus:'none'|'active'|'revoked';
  verifiedPatientAuth:boolean;
};

export type PathwayStage={
  id:string;
  title:string;
  activity:string;
  prerequisites:string[];
  status:(typeof pathwayStageStatuses)[number];
  owner:string;
  dueDate:string;
  reason?:string;
};

export type PathwayRecord=BaseRecord&{
  type:'pathway';
  protocolAssignmentId?:string;
  protocolAssignmentVersion?:number;
  pathwayKey:string;
  pathwayVersion:string;
  currentVersion:boolean;
  priorVersions:VersionSnapshot[];
  stages:PathwayStage[];
  exceptions:{eventId:string;stageId:string;reason:string;actor:string;at:string}[];
  processedEvents:EventReceipt[];
};

export type SchedulingRecord=BaseRecord&{
  type:'schedule';
  phase:(typeof schedulePhases)[number];
  dueWindow:{start:string;end:string;timezone?:string};
  owner:string;
  preferredChannel:(typeof reminderChannels)[number];
  optedOut:boolean;
  appointment?:{startsAt:string;timezone:string;evidenceSource:'manual'|'provider-reported';evidenceRef:string};
  previousAppointments?:{startsAt:string;timezone:string;evidenceSource:'manual'|'provider-reported';evidenceRef:string}[];
  outreach:{status:(typeof outreachStatuses)[number];attempts:{at:string;outcome:'attempted'|'unreachable'|'opt-out'|'booked'|'cancelled'|'no-show';note:string}[];nextAttemptAt?:string};
  cancellationReason?:string;
};

export type State={
  support:PatientSupportRecord[];
  handoffs:HumanHandoffRecord[];
  language:LanguageAccessRecord[];
  pathways:PathwayRecord[];
  scheduling:SchedulingRecord[];
  receipts:Receipt[];
};

const historySchema=z.object({
  id:identifier,
  at:timestamp,
  actor:shortText.max(100),
  from:shortText.max(120),
  to:shortText.max(120),
  reason:text.max(1000),
  evidenceRef:z.string().trim().max(200).optional(),
}).strict();

const supportRecordSchema=z.object({
  id:identifier,
  patientId:identifier,
  encounterId:identifier,
  version:z.number().int().min(1),
  createdAt:timestamp,
  updatedAt:timestamp,
  history:z.array(historySchema),
  type:z.literal('support'),
  conversationDate:dateOnly,
  planRef:z.object({planId:shortText.max(100),planVersion:z.number().int().min(1),goalText:text.max(500)}).strict(),
  approvedEducation:z.array(z.enum(['Pain plan copy','Scheduling checklist','Language access instructions','Follow-up reminder sheet'])).max(4),
  reminderPreference:z.object({channel:z.enum(reminderChannels),optedOut:z.boolean()}).strict(),
  dueCheckInDate:dateOnly,
  originalText:text.max(4000),
  attributedSummary:text.max(2000),
  summaryAuthor:shortText.max(100),
  participation:z.object({mode:z.enum(['digital','staff-recorded']),participant:z.enum(['patient','caregiver']),recordedSource:shortText.max(200)}).strict(),
}).strict();

const handoffRecordSchema=z.object({
  id:identifier,
  patientId:identifier,
  encounterId:identifier,
  version:z.number().int().min(1),
  createdAt:timestamp,
  updatedAt:timestamp,
  history:z.array(historySchema),
  type:z.literal('handoff'),
  concern:text.max(3000),
  dedupeKey:shortText.max(150),
  priority:z.enum(['routine','high']),
  urgencySource:z.object({type:z.enum(['authorized-human','approved-policy','patient-request']),label:shortText.max(200)}).strict(),
  responsibleTeam:shortText.max(100),
  responsiblePerson:shortText.max(100),
  coverageExpectation:text.max(500),
  fallbackOwner:shortText.max(100),
  phase:z.enum(handoffPhases),
  deliveryStatus:z.enum(handoffStatuses),
  deliveryEvidence:z.object({source:z.enum(['receipt','manual']),reference:shortText.max(200)}).strict().optional(),
  dueAt:timestamp.optional(),
  actionSummary:z.string().trim().max(2000).optional(),
  responseSummary:z.string().trim().max(2000).optional(),
  patientContact:z.object({status:z.enum(handoffContactStatuses),failureReason:z.string().trim().max(1000).optional(),nextAttemptAt:timestamp.optional()}).strict(),
  duplicates:z.array(z.object({requestId:identifier,concern:text.max(3000),capturedAt:timestamp,actor:shortText.max(100),priority:z.enum(['routine','high']).optional()}).strict()),
}).strict();

const languageRecordSchema=z.object({
  id:identifier,
  patientId:identifier,
  encounterId:identifier,
  version:z.number().int().min(1),
  createdAt:timestamp,
  updatedAt:timestamp,
  history:z.array(historySchema),
  type:z.literal('language'),
  planRef:z.object({planId:identifier,planVersion:z.number().int().min(1)}).strict().optional(),
  preferredLanguage:z.enum(['en','es']),
  instructionsLanguage:z.enum(['en','es']),
  sourceText:text.max(4000),
  translatedText:z.string().trim().max(4000).optional(),
  translationStatus:z.enum(translationStatuses),
  translationReviewer:z.string().trim().max(100).optional(),
  accessibilityPreferences:z.array(z.string().trim().min(1).max(80)).max(8),
  teachBack:z.string().trim().max(2000),
  caregiverRole:z.string().trim().max(200).optional(),
  interpreterRole:z.string().trim().max(200).optional(),
  sharedDevice:z.boolean(),
  proxyStatus:z.enum(['none','active','revoked']),
  verifiedPatientAuth:z.boolean(),
}).strict();

const stageSchema=z.object({
  id:identifier,
  title:shortText.max(200),
  activity:text.max(500),
  prerequisites:z.array(identifier).max(40),
  status:z.enum(pathwayStageStatuses),
  owner:shortText.max(120),
  dueDate:z.union([dateOnly,z.literal('')]),
  reason:z.string().trim().max(1000).optional(),
}).strict();

const pathwayRecordSchema=z.object({
  id:identifier,
  patientId:identifier,
  encounterId:identifier,
  version:z.number().int().min(1),
  createdAt:timestamp,
  updatedAt:timestamp,
  history:z.array(historySchema),
  type:z.literal('pathway'),
  protocolAssignmentId:identifier.optional(),
  protocolAssignmentVersion:z.number().int().min(1).optional(),
  pathwayKey:shortText.max(100),
  pathwayVersion:shortText.max(100),
  currentVersion:z.boolean(),
  priorVersions:z.array(z.object({version:z.number().int().min(1),pathwayVersion:shortText.max(100),updatedAt:timestamp}).strict()),
  stages:z.array(stageSchema).min(1).max(40),
  exceptions:z.array(z.object({eventId:identifier,stageId:identifier,reason:text.max(1000),actor:shortText.max(100),at:timestamp}).strict()),
  processedEvents:z.array(z.object({eventId:identifier,fingerprint:fingerprintSchema,at:timestamp}).strict()),
}).strict();

const schedulingRecordSchema=z.object({
  id:identifier,
  patientId:identifier,
  encounterId:identifier,
  version:z.number().int().min(1),
  createdAt:timestamp,
  updatedAt:timestamp,
  history:z.array(historySchema),
  type:z.literal('schedule'),
  phase:z.enum(schedulePhases),
  dueWindow:z.object({start:dateOnly,end:dateOnly,timezone:timezone.optional()}).strict(),
  owner:shortText.max(100),
  preferredChannel:z.enum(reminderChannels),
  optedOut:z.boolean(),
  appointment:z.object({startsAt:timestamp,timezone:shortText.max(100),evidenceSource:z.enum(['manual','provider-reported']),evidenceRef:shortText.max(200)}).strict().optional(),
  previousAppointments:z.array(z.object({startsAt:timestamp,timezone:shortText.max(100),evidenceSource:z.enum(['manual','provider-reported']),evidenceRef:shortText.max(200)}).strict()).optional(),
  outreach:z.object({status:z.enum(outreachStatuses),attempts:z.array(z.object({at:timestamp,outcome:z.enum(['attempted','unreachable','opt-out','booked','cancelled','no-show']),note:z.string().trim().min(1).max(1000)}).strict()),nextAttemptAt:timestamp.optional()}).strict(),
  cancellationReason:z.string().trim().max(1000).optional(),
}).strict();

const receiptSchema=z.object({
  requestId:identifier,
  fingerprint:fingerprintSchema,
  recordType:z.enum(['support','handoff','language','pathway','schedule']),
  recordId:identifier,
  patientId:identifier,
  at:timestamp,
}).strict();

const stateSchema=z.object({
  support:z.array(supportRecordSchema),
  handoffs:z.array(handoffRecordSchema),
  language:z.array(languageRecordSchema),
  pathways:z.array(pathwayRecordSchema),
  scheduling:z.array(schedulingRecordSchema),
  receipts:z.array(receiptSchema),
}).strict();

const supportSaveSchema=z.object({
  type:z.literal(`${commandPrefix}.support.save`),
  id:identifier.optional(),
  patientId:identifier,
  encounterId:identifier,
  expectedVersion:z.number().int().min(1).optional(),
  requestId:identifier,
  conversationDate:dateOnly,
  planId:shortText.max(100),
  planVersion:z.number().int().min(1),
  goalText:text.max(500),
  approvedEducation:z.array(z.enum(['Pain plan copy','Scheduling checklist','Language access instructions','Follow-up reminder sheet'])).max(4),
  reminderChannel:z.enum(reminderChannels),
  optedOut:z.boolean(),
  dueCheckInDate:dateOnly,
  originalText:text.max(4000),
  attributedSummary:text.max(2000),
  summaryAuthor:shortText.max(100),
  participationMode:z.enum(['digital','staff-recorded']),
  participant:z.enum(['patient','caregiver']),
  recordedSource:shortText.max(200),
}).strict();

const handoffSaveSchema=z.object({
  type:z.literal(`${commandPrefix}.handoff.save`),
  id:identifier.optional(),
  patientId:identifier,
  encounterId:identifier,
  expectedVersion:z.number().int().min(1).optional(),
  requestId:identifier,
  concern:text.max(3000),
  dedupeKey:shortText.max(150),
  priority:z.enum(['routine','high']),
  urgencySourceType:z.enum(['authorized-human','approved-policy','patient-request']),
  urgencySource:shortText.max(200),
  responsibleTeam:shortText.max(100),
  responsiblePerson:shortText.max(100),
  coverageExpectation:text.max(500),
  fallbackOwner:shortText.max(100),
  phase:z.enum(handoffPhases),
  deliveryStatus:z.enum(handoffStatuses),
  dueAt:timestamp.optional(),
  deliveryEvidenceSource:z.enum(['none','receipt','manual']),
  deliveryEvidenceRef:z.string().trim().max(200).optional(),
  actionSummary:z.string().trim().max(2000).optional(),
  responseSummary:z.string().trim().max(2000).optional(),
  patientContactStatus:z.enum(handoffContactStatuses),
  patientContactFailureReason:z.string().trim().max(1000).optional(),
  nextAttemptAt:timestamp.optional(),
  transitionReason:text.max(1000),
}).strict();

const languageSaveSchema=z.object({
  type:z.literal(`${commandPrefix}.language.save`),
  planId:identifier.optional(),
  planVersion:z.number().int().min(1).optional(),
  id:identifier.optional(),
  patientId:identifier,
  encounterId:identifier,
  expectedVersion:z.number().int().min(1).optional(),
  requestId:identifier,
  preferredLanguage:z.enum(['en','es']),
  instructionsLanguage:z.enum(['en','es']),
  sourceText:text.max(4000),
  translatedText:z.string().trim().max(4000).optional(),
  translationStatus:z.enum(translationStatuses),
  translationReviewer:z.string().trim().max(100).optional(),
  accessibilityPreferences:z.array(z.string().trim().min(1).max(80)).max(8),
  teachBack:z.string().trim().max(2000),
  caregiverRole:z.string().trim().max(200).optional(),
  interpreterRole:z.string().trim().max(200).optional(),
  sharedDevice:z.boolean(),
  proxyStatus:z.enum(['none','active','revoked']),
  verifiedPatientAuth:z.boolean(),
}).strict();

const pathwaySaveSchema=z.object({
  type:z.literal(`${commandPrefix}.pathway.save`),
  protocolAssignmentId:identifier.optional(),
  protocolAssignmentVersion:z.number().int().min(1).optional(),
  id:identifier.optional(),
  patientId:identifier,
  encounterId:identifier,
  expectedVersion:z.number().int().min(1).optional(),
  requestId:identifier,
  pathwayKey:shortText.max(100),
  pathwayVersion:shortText.max(100),
  currentVersion:z.boolean(),
  stages:z.array(stageSchema).min(1).max(40),
  eventId:identifier,
  eventType:shortText.optional(),
  reviewChoice:z.object({choiceId:identifier,value:shortText}).strict().optional(),
  transitionReason:text.max(1000),
}).strict();

const scheduleSaveSchema=z.object({
  type:z.literal(`${commandPrefix}.schedule.save`),
  id:identifier.optional(),
  patientId:identifier,
  encounterId:identifier,
  expectedVersion:z.number().int().min(1).optional(),
  requestId:identifier,
  phase:z.enum(schedulePhases),
  dueWindowStart:dateOnly,
  dueWindowEnd:dateOnly,
  dueWindowTimezone:timezone.optional(),
  owner:shortText.max(100),
  preferredChannel:z.enum(reminderChannels),
  optedOut:z.boolean(),
  appointmentStartsAt:timestamp.optional(),
  appointmentTimezone:z.string().trim().max(100).optional(),
  bookingEvidenceSource:z.enum(['none','manual','provider-reported']),
  bookingEvidenceRef:z.string().trim().max(200).optional(),
  outreachStatus:z.enum(outreachStatuses),
  outreachNote:z.string().trim().max(1000).optional(),
  nextAttemptAt:timestamp.optional(),
  cancellationReason:z.string().trim().max(1000).optional(),
  transitionReason:text.max(1000),
}).strict();

export const actionSchema=z.discriminatedUnion('type',[
  supportSaveSchema,
  handoffSaveSchema,
  languageSaveSchema,
  pathwaySaveSchema,
  scheduleSaveSchema,
]);

export type Action=z.infer<typeof actionSchema>;

export function initialState():State{
  return {support:[],handoffs:[],language:[],pathways:[],scheduling:[],receipts:[]};
}

export function validateState(state:unknown):State{
  if(state===undefined||state===null)return initialState();
  const data=stateSchema.parse(state);
  const records=[...data.support,...data.handoffs,...data.language,...data.pathways,...data.scheduling];
  const ids=new Set<string>();
  const encounters=new Map<string,string>();
  for(const record of records){
    if(ids.has(record.id))throw new Error('Saved coordination record ids must be unique.');
    ids.add(record.id);
    if(encounters.has(record.encounterId)&&encounters.get(record.encounterId)!==record.patientId)throw new Error('An encounter cannot belong to multiple patients.');
    encounters.set(record.encounterId,record.patientId);
    if(Date.parse(record.createdAt)>Date.parse(record.updatedAt))throw new Error('Saved record chronology is invalid.');
    let latest=Date.parse(record.updatedAt);
    for(const entry of record.history){
      if(Date.parse(entry.at)<Date.parse(record.createdAt)||Date.parse(entry.at)>latest)throw new Error('Saved history chronology is invalid.');
      latest=Date.parse(entry.at);
    }
  }
  const requests=new Set<string>();
  for(const receipt of data.receipts){
    if(requests.has(receipt.requestId))throw new Error('Saved request ids must be unique.');
    requests.add(receipt.requestId);
    if(!records.some(record=>record.id===receipt.recordId&&record.patientId===receipt.patientId&&record.type===receipt.recordType))throw new Error('Saved receipt does not match its patient record.');
  }
  for(const record of data.support)assertSupportInput({optedOut:record.reminderPreference.optedOut,reminderChannel:record.reminderPreference.channel,dueCheckInDate:record.dueCheckInDate,conversationDate:record.conversationDate});
  for(const record of data.pathways){
    assertPathwayInput(record,record);
    if(new Set(record.processedEvents.map(event=>event.eventId)).size!==record.processedEvents.length)throw new Error('Saved pathway event ids must be unique.');
  }
  for(const record of data.handoffs){
    assertHandoffInput({...record,deliveryEvidenceSource:record.deliveryEvidence?.source??'none',deliveryEvidenceRef:record.deliveryEvidence?.reference,patientContactStatus:record.patientContact.status,patientContactFailureReason:record.patientContact.failureReason,nextAttemptAt:record.patientContact.nextAttemptAt},record);
  }
  for(const record of data.scheduling)assertScheduleInput({phase:record.phase,dueWindowStart:record.dueWindow.start,dueWindowEnd:record.dueWindow.end,optedOut:record.optedOut,preferredChannel:record.preferredChannel,appointmentStartsAt:record.appointment?.startsAt,appointmentTimezone:record.appointment?.timezone,bookingEvidenceSource:record.appointment?.evidenceSource??'none',bookingEvidenceRef:record.appointment?.evidenceRef,outreachStatus:record.outreach.status,nextAttemptAt:record.outreach.nextAttemptAt,cancellationReason:record.cancellationReason},record);
  for(const record of data.language)assertLanguageInput(record);
  return data;
}

function stable(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
  if(value&&typeof value==='object'){
    const entries=Object.entries(value as Record<string,unknown>).filter(([,entry])=>entry!==undefined).sort(([a],[b])=>a.localeCompare(b));
    return `{${entries.map(([key,entry])=>`${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function semanticAction(action:Action):unknown{
  const clone={...action} as Record<string,unknown>;
  delete clone.id;
  delete clone.requestId;
  delete clone.expectedVersion;
  delete clone.transitionReason;
  return clone;
}

function assertPatient(context:Context,patientId:string){
  if(!context.patients.some(patient=>patient.id===patientId))throw new Error('Patient not found.');
}

function requireExpectedVersion(action:Extract<Action,{id?:string}>){
  if(action.id&&!action.expectedVersion)throw new Error('Provide the latest saved version before updating this record.');
  if(!action.id&&action.expectedVersion!==undefined)throw new Error('A saved version requires a record id.');
}

function assertSamePatient(record:BaseRecord,patientId:string,encounterId:string){
  if(record.patientId!==patientId)throw new Error('This record does not belong to the selected patient.');
  if(record.encounterId!==encounterId)throw new Error('This record does not belong to the selected encounter.');
}

function ensureChronology(record:BaseRecord,at:string){
  if(Date.parse(at)<Date.parse(record.updatedAt))throw new Error('Chronology violation: updates must not move backward in time.');
}

function pushHistory(history:HistoryEntry[],actor:string,at:string,from:string,to:string,reason:string,evidenceRef?:string):HistoryEntry[]{
  return [{id:crypto.randomUUID(),at,actor,from,to,reason,evidenceRef},...history];
}

function registerReceipt(data:State,requestId:string,fingerprint:string,recordType:Receipt['recordType'],recordId:string,patientId:string,at:string){
  data.receipts=[{requestId,fingerprint,recordType,recordId,patientId,at},...data.receipts];
}

function guardIdempotency(data:State,action:Action,actor:string){
  const fingerprint=stable({action,actor});
  const existing=data.receipts.find(receipt=>receipt.requestId===action.requestId);
  if(existing){
    if(existing.fingerprint!==fingerprint)throw new Error('This requestId was already used with different content or actor.');
    return {fingerprint,duplicate:true as const};
  }
  return {fingerprint,duplicate:false as const};
}

function handoffIndex(phase:(typeof handoffPhases)[number]){return handoffPhases.indexOf(phase);}
function assertSupportInput(action:Pick<z.infer<typeof supportSaveSchema>,'optedOut'|'reminderChannel'|'dueCheckInDate'|'conversationDate'>){
  if(action.optedOut&&action.reminderChannel!=='none')throw new Error('Opted-out reminder preferences must use the none channel.');
  if(action.dueCheckInDate<action.conversationDate)throw new Error('The due check-in cannot be before the documented conversation date.');
}

function assertHandoffInput(action:Pick<z.infer<typeof handoffSaveSchema>,'phase'|'deliveryStatus'|'deliveryEvidenceRef'|'deliveryEvidenceSource'|'actionSummary'|'responseSummary'|'patientContactStatus'|'patientContactFailureReason'|'nextAttemptAt'>,existing?:HumanHandoffRecord){
  if(!existing&&(action.phase!=='locally-saved'||action.deliveryStatus!=='pending'))throw new Error('New handoffs must start as locally saved with pending delivery.');
  if(handoffIndex(action.phase)<0)throw new Error('Invalid handoff phase.');
  if(existing&&action.phase!==existing.phase&&handoffIndex(action.phase)!==handoffIndex(existing.phase)+1)throw new Error('Advance the handoff one step at a time.');
  if((handoffIndex(action.phase)>=handoffIndex('delivery-reported')||action.deliveryStatus==='reported')&&(!action.deliveryEvidenceRef||action.deliveryEvidenceSource==='none'))throw new Error('Document a real receipt or explicit manual source before marking delivery reported.');
  if(action.phase!=='locally-saved'&&action.deliveryStatus!=='reported')throw new Error('Delivered handoffs must retain their reported delivery status and evidence.');
  if(action.phase==='locally-saved'&&action.deliveryStatus==='reported')throw new Error('Advance to delivery-reported when recording delivery.');
  if(action.deliveryEvidenceSource!=='none'&&action.phase==='locally-saved')throw new Error('Delivery evidence cannot be recorded before delivery is reported.');
  if(action.phase==='closed'&&action.patientContactStatus!=='successful')throw new Error('Do not silently close a handoff before successful patient contact.');
  if(handoffIndex(action.phase)>=handoffIndex('action-documented')&&!action.actionSummary?.trim())throw new Error('Document and retain the action taken before saving this handoff step.');
  if(handoffIndex(action.phase)>=handoffIndex('response-recorded')&&!action.responseSummary?.trim())throw new Error('Record and retain the response before saving this handoff step.');
  if(action.patientContactStatus==='failed'&&!action.nextAttemptAt)throw new Error('Record the next contact attempt when patient contact fails.');
  if(action.patientContactStatus==='failed'&&!action.patientContactFailureReason?.trim())throw new Error('Record why patient contact failed.');
}

function assertLanguageInput(action:Pick<z.infer<typeof languageSaveSchema>,'preferredLanguage'|'instructionsLanguage'|'translationStatus'|'translatedText'|'translationReviewer'|'sharedDevice'|'proxyStatus'|'verifiedPatientAuth'>){
  if(action.translationStatus==='translated'&&(!action.translatedText?.trim()||!action.translationReviewer?.trim()))throw new Error('Translated instructions require saved text and a reviewer.');
  if(action.translationStatus==='unsupported'&&action.translatedText?.trim())throw new Error('Unsupported translations must remain explicit instead of storing unverified translated instructions.');
  if((action.sharedDevice||action.proxyStatus==='revoked')&&action.verifiedPatientAuth)throw new Error('Shared-device or revoked-proxy records cannot claim verified patient authentication.');
  if(action.preferredLanguage!==action.instructionsLanguage&&action.translationStatus==='not-needed')throw new Error('Different instruction and preferred languages require an explicit language support status.');
}

function assertPathwayInput(action:Pick<z.infer<typeof pathwaySaveSchema>,'stages'|'currentVersion'|'pathwayKey'|'pathwayVersion'>,existing?:PathwayRecord){
  const stageIds=new Set<string>();
  for(const stage of action.stages){
    if(stageIds.has(stage.id))throw new Error('Each pathway stage id must be unique.');
    stageIds.add(stage.id);
  }
  for(const stage of action.stages){
    for(const prerequisite of stage.prerequisites){
      if(prerequisite===stage.id||!stageIds.has(prerequisite))throw new Error('Every prerequisite must refer to another stage in the same local pathway.');
    }
    if((stage.status==='failed-automation'||stage.status==='deferred'||stage.status==='declined')&&!stage.reason?.trim())throw new Error('Failed, deferred, and declined stages require a reason.');
    if(stage.status==='completed'||stage.status==='active'){
      const unmet=stage.prerequisites.filter(prerequisite=>action.stages.find(candidate=>candidate.id===prerequisite)?.status!=='completed');
      if(unmet.length)throw new Error('Complete prerequisite stages before starting or completing a later stage.');
      if(!action.currentVersion&&(!existing||existing.stages.find(prior=>prior.id===stage.id)?.status!==stage.status))throw new Error('An archived pathway version cannot start or complete stages.');
    }
  }
  const visiting=new Set<string>();
  const visited=new Set<string>();
  function visit(id:string){
    if(visiting.has(id))throw new Error('Pathway prerequisites must not contain a cycle.');
    if(visited.has(id))return;
    visiting.add(id);
    for(const prerequisite of action.stages.find(stage=>stage.id===id)!.prerequisites)visit(prerequisite);
    visiting.delete(id);
    visited.add(id);
  }
  for(const stage of action.stages)visit(stage.id);
  if(existing){
    if(action.pathwayKey!==existing.pathwayKey)throw new Error('A saved pathway key cannot be reassigned.');
    const priorById=new Map(existing.stages.map(stage=>[stage.id,stage]));
    if(existing.stages.some(stage=>!stageIds.has(stage.id)))throw new Error('Saved pathway stages cannot be removed; record a declined or deferred reason instead.');
    for(const stage of action.stages){
      const previous=priorById.get(stage.id);
      if(previous&&previous.status==='completed'&&stage.status!=='completed')throw new Error('Completed pathway stages cannot move backward.');
      if(previous?.status==='completed'&&stable(previous)!==stable(stage))throw new Error('Completed pathway stage evidence cannot be rewritten.');
      if(previous&&action.pathwayVersion===existing.pathwayVersion&&stable(previous.prerequisites)!==stable(stage.prerequisites))throw new Error('Changing saved prerequisites requires a new pathway version.');
    }
  }
}

function assertScheduleInput(action:Pick<z.infer<typeof scheduleSaveSchema>,'phase'|'dueWindowStart'|'dueWindowEnd'|'optedOut'|'preferredChannel'|'appointmentStartsAt'|'appointmentTimezone'|'bookingEvidenceSource'|'bookingEvidenceRef'|'outreachStatus'|'nextAttemptAt'|'cancellationReason'>,existing?:SchedulingRecord){
  if(!existing&&action.phase!=='follow-up-due')throw new Error('New scheduling records must start at follow-up-due.');
  if(action.dueWindowEnd<action.dueWindowStart)throw new Error('The due window must end on or after it starts.');
  if(action.optedOut&&action.preferredChannel!=='none')throw new Error('Opted-out outreach must use the none channel.');
  const needsAppointment=['booking-reported','confirmed','attended','no-show'].includes(action.phase);
  if(needsAppointment&&(!action.appointmentStartsAt||!action.appointmentTimezone||action.bookingEvidenceSource==='none'||!action.bookingEvidenceRef))throw new Error('Booking-reported and later scheduling steps require appointment details and external booking evidence.');
  if(action.appointmentTimezone){try{new Intl.DateTimeFormat('en',{timeZone:action.appointmentTimezone});}catch{throw new Error('Use a valid IANA appointment timezone.');}}
  if(existing?.appointment&&['confirmed','attended','no-show'].includes(existing.phase)&&action.phase!=='reschedule-outreach'&&(action.appointmentStartsAt!==existing.appointment.startsAt||action.appointmentTimezone!==existing.appointment.timezone))throw new Error('Cancel and reschedule before changing a confirmed appointment.');
  if((action.outreachStatus==='unreachable'||action.outreachStatus==='retry-scheduled')&&!action.nextAttemptAt)throw new Error('Unreachable or retry outreach states require the next attempt time.');
  if((action.phase==='cancelled'||action.phase==='no-show')&&!action.cancellationReason?.trim())throw new Error('Cancelled and no-show records require a reason.');
  if(existing&&action.phase!==existing.phase){
    const allowedNext=existing.phase==='follow-up-due'?['requested']
      :existing.phase==='requested'?['booking-reported','reschedule-outreach','cancelled']
      :existing.phase==='booking-reported'?['confirmed','cancelled']
      :existing.phase==='confirmed'?['attended','cancelled','no-show']
      :existing.phase==='cancelled'||existing.phase==='no-show'?['reschedule-outreach']
      :existing.phase==='reschedule-outreach'?['requested','booking-reported']
      :[];
    if(!allowedNext.includes(action.phase))throw new Error('This scheduling transition is not allowed from the current step.');
  }
}

function duplicatePathwayEvent(existing:PathwayRecord,eventId:string,fingerprint:string){
  const found=existing.processedEvents.find(event=>event.eventId===eventId);
  if(!found)return false;
  if(found.fingerprint!==fingerprint)throw new Error('This event id was already used for a different pathway change.');
  return true;
}

function makeBase(action:{patientId:string;encounterId:string},context:Context):BaseRecord{
  return {id:crypto.randomUUID(),patientId:action.patientId,encounterId:action.encounterId,version:1,createdAt:context.now,updatedAt:context.now,history:[]};
}

function updateRecord<T extends BaseRecord>(record:T,changes:Partial<Omit<T,keyof BaseRecord>>,context:Context,from:string,to:string,reason:string,evidenceRef?:string):T{
  ensureChronology(record,context.now);
  return {...record,...changes,version:record.version+1,updatedAt:context.now,history:pushHistory(record.history,context.actor,context.now,from,to,reason,evidenceRef)} as T;
}

export function reduce(state:State,rawAction:Action,context:Context):State{
  const current=validateState(state);
  const action=actionSchema.parse(rawAction);
  context={...context,actor:shortText.max(100).parse(context.actor),now:new Date(timestamp.parse(context.now)).toISOString()};
  assertPatient(context,action.patientId);
  if([...current.support,...current.handoffs,...current.language,...current.pathways,...current.scheduling].some(record=>record.encounterId===action.encounterId&&record.patientId!==action.patientId))throw new Error('This encounter does not belong to the selected patient.');
  const {fingerprint,duplicate}=guardIdempotency(current,action,context.actor);
  if(duplicate)return current;
  const data=structuredClone(current);
  switch(action.type){
    case `${commandPrefix}.support.save`:{
      requireExpectedVersion(action);
      assertSupportInput(action);
      if(context.carePlans){
        const plan=context.carePlans.find(plan=>plan.id===action.planId&&plan.patientId===action.patientId&&plan.version===action.planVersion);
        if(!plan)throw new Error('Select a saved care plan and current version for this patient.');
        if(plan.goal&&plan.goal.trim()!==action.goalText)throw new Error('The goal snapshot must match the saved care plan version.');
      }
      const existing=action.id?data.support.find(record=>record.id===action.id):undefined;
      if(action.id&&!existing)throw new Error('Support record not found.');
      if(existing){
        assertSamePatient(existing,action.patientId,action.encounterId);
        if(existing.version!==action.expectedVersion)throw new Error('This support record changed. Reload the latest version before saving.');
      }
      const changes:Omit<PatientSupportRecord,keyof BaseRecord>={
        type:'support',
        conversationDate:action.conversationDate,
        planRef:{planId:action.planId,planVersion:action.planVersion,goalText:action.goalText},
        approvedEducation:[...action.approvedEducation],
        reminderPreference:{channel:action.reminderChannel,optedOut:action.optedOut},
        dueCheckInDate:action.dueCheckInDate,
        originalText:action.originalText,
        attributedSummary:action.attributedSummary,
        summaryAuthor:action.summaryAuthor,
        participation:{mode:action.participationMode,participant:action.participant,recordedSource:action.recordedSource},
      };
      if(existing){
        const updated=updateRecord(existing,changes,context,'support-saved','support-saved','Updated patient support documentation.');
        data.support[data.support.indexOf(existing)]=updated;
        registerReceipt(data,action.requestId,fingerprint,'support',updated.id,updated.patientId,context.now);
      }else{
        const created:{id:string;patientId:string;encounterId:string;version:number;createdAt:string;updatedAt:string;history:HistoryEntry[]} & Omit<PatientSupportRecord,keyof BaseRecord>={...makeBase(action,context),...changes};
        data.support.unshift(created);
        registerReceipt(data,action.requestId,fingerprint,'support',created.id,created.patientId,context.now);
      }
      return data;
    }
    case `${commandPrefix}.handoff.save`:{
      requireExpectedVersion(action);
      assertHandoffInput(action,action.id?data.handoffs.find(record=>record.id===action.id):undefined);
      if(action.nextAttemptAt&&Date.parse(action.nextAttemptAt)<=Date.parse(context.now))throw new Error('The next contact attempt must be after the current time.');
      const deliveryEvidence=action.deliveryEvidenceSource==='none'||!action.deliveryEvidenceRef?undefined:{source:action.deliveryEvidenceSource,reference:action.deliveryEvidenceRef};
      const changes:Omit<HumanHandoffRecord,keyof BaseRecord>={
        type:'handoff',
        concern:action.concern,
        dedupeKey:action.dedupeKey,
        priority:action.priority,
        urgencySource:{type:action.urgencySourceType,label:action.urgencySource},
        responsibleTeam:action.responsibleTeam,
        responsiblePerson:action.responsiblePerson,
        coverageExpectation:action.coverageExpectation,
        fallbackOwner:action.fallbackOwner,
        phase:action.phase,
        deliveryStatus:action.deliveryStatus,
        deliveryEvidence,
        dueAt:action.dueAt,
        actionSummary:action.actionSummary?.trim()||undefined,
        responseSummary:action.responseSummary?.trim()||undefined,
        patientContact:{status:action.patientContactStatus,failureReason:action.patientContactFailureReason?.trim()||undefined,nextAttemptAt:action.nextAttemptAt},
        duplicates:[],
      };
      const existing=action.id?data.handoffs.find(record=>record.id===action.id):undefined;
      if(action.id&&!existing)throw new Error('Handoff record not found.');
      if(existing){
        assertSamePatient(existing,action.patientId,action.encounterId);
        if(existing.version!==action.expectedVersion)throw new Error('This handoff changed. Reload the latest version before saving.');
        const updated=updateRecord(existing,{...changes,duplicates:[...existing.duplicates]},context,existing.phase,action.phase,action.transitionReason,deliveryEvidence?.reference);
        data.handoffs[data.handoffs.indexOf(existing)]=updated;
        registerReceipt(data,action.requestId,fingerprint,'handoff',updated.id,updated.patientId,context.now);
        return data;
      }
      const duplicateOf=data.handoffs.find(record=>record.patientId===action.patientId&&record.encounterId===action.encounterId&&record.dedupeKey===action.dedupeKey&&record.phase!=='closed');
      if(duplicateOf){
        const merged=updateRecord(duplicateOf,{priority:action.priority==='high'?'high':duplicateOf.priority,urgencySource:action.priority==='high'?{type:action.urgencySourceType,label:action.urgencySource}:duplicateOf.urgencySource,duplicates:[{requestId:action.requestId,concern:action.concern,capturedAt:context.now,actor:context.actor,priority:action.priority},...duplicateOf.duplicates]},context,duplicateOf.phase,duplicateOf.phase,action.transitionReason);
        data.handoffs[data.handoffs.indexOf(duplicateOf)]=merged;
        registerReceipt(data,action.requestId,fingerprint,'handoff',merged.id,merged.patientId,context.now);
        return data;
      }
      const created:{id:string;patientId:string;encounterId:string;version:number;createdAt:string;updatedAt:string;history:HistoryEntry[]} & Omit<HumanHandoffRecord,keyof BaseRecord>={...makeBase(action,context),...changes};
      data.handoffs.unshift(created);
      registerReceipt(data,action.requestId,fingerprint,'handoff',created.id,created.patientId,context.now);
      return data;
    }
    case `${commandPrefix}.language.save`:{
      requireExpectedVersion(action);
      assertLanguageInput(action);
      if((action.planId===undefined)!==(action.planVersion===undefined))throw new Error('Select both the care plan and its version for reviewed instructions.');
      if(action.planId&&context.carePlans){
        const plan=context.carePlans.find(plan=>plan.id===action.planId&&plan.patientId===action.patientId&&plan.version===action.planVersion);
        if(!plan)throw new Error('Select the current care plan for this patient before reviewing its translation.');
        if(plan.summary&&plan.summary.trim()!==action.sourceText.trim())throw new Error('The source instructions must match the selected care plan.');
      }
      if(action.verifiedPatientAuth&&!context.features.patientAuthenticationVerified)throw new Error('A trusted patient authentication verification is required; staff documentation cannot verify authentication.');
      const existing=action.id?data.language.find(record=>record.id===action.id):undefined;
      if(action.id&&!existing)throw new Error('Language/access record not found.');
      if(existing){
        assertSamePatient(existing,action.patientId,action.encounterId);
        if(existing.version!==action.expectedVersion)throw new Error('This language/access record changed. Reload the latest version before saving.');
      }
      const changes:Omit<LanguageAccessRecord,keyof BaseRecord>={
        type:'language',
        planRef:action.planId?{planId:action.planId,planVersion:action.planVersion!}:undefined,
        preferredLanguage:action.preferredLanguage,
        instructionsLanguage:action.instructionsLanguage,
        sourceText:action.sourceText,
        translatedText:action.translatedText?.trim()||undefined,
        translationStatus:action.translationStatus,
        translationReviewer:action.translationReviewer?.trim()||undefined,
        accessibilityPreferences:[...action.accessibilityPreferences],
        teachBack:action.teachBack,
        caregiverRole:action.caregiverRole?.trim()||undefined,
        interpreterRole:action.interpreterRole?.trim()||undefined,
        sharedDevice:action.sharedDevice,
        proxyStatus:action.proxyStatus,
        verifiedPatientAuth:action.verifiedPatientAuth,
      };
      if(existing){
        const updated=updateRecord(existing,changes,context,'language-saved','language-saved','Updated language and access preferences.');
        data.language[data.language.indexOf(existing)]=updated;
        registerReceipt(data,action.requestId,fingerprint,'language',updated.id,updated.patientId,context.now);
      }else{
        const created:{id:string;patientId:string;encounterId:string;version:number;createdAt:string;updatedAt:string;history:HistoryEntry[]} & Omit<LanguageAccessRecord,keyof BaseRecord>={...makeBase(action,context),...changes};
        data.language.unshift(created);
        registerReceipt(data,action.requestId,fingerprint,'language',created.id,created.patientId,context.now);
      }
      return data;
    }
    case `${commandPrefix}.pathway.save`:{
      requireExpectedVersion(action);
      const existing=action.id?data.pathways.find(record=>record.id===action.id):undefined;
      if(action.id&&!existing)throw new Error('Pathway record not found.');
      if(!action.id){
        const samePathway=data.pathways.find(record=>record.patientId===action.patientId&&record.encounterId===action.encounterId&&record.pathwayKey===action.pathwayKey);
        if(samePathway){
          if(duplicatePathwayEvent(samePathway,action.eventId,stable(semanticAction(action)))){
            registerReceipt(data,action.requestId,fingerprint,'pathway',samePathway.id,samePathway.patientId,context.now);
            return data;
          }
          throw new Error('This pathway already exists. Select its latest saved record before updating.');
        }
      }
      if(existing){
        assertSamePatient(existing,action.patientId,action.encounterId);
        if(existing.version!==action.expectedVersion)throw new Error('This pathway changed. Reload the latest version before saving.');
      }
      if((action.protocolAssignmentId===undefined)!==(action.protocolAssignmentVersion===undefined))throw new Error('Select the protocol assignment and its saved version together.');
      if(existing?.protocolAssignmentId&&(action.protocolAssignmentId!==existing.protocolAssignmentId||action.protocolAssignmentVersion!==existing.protocolAssignmentVersion))throw new Error('Migrate the assigned protocol explicitly before changing this pathway version.');
      if(action.protocolAssignmentId){
        const assignment=context.protocolAssignments?.find(assignment=>assignment.id===action.protocolAssignmentId&&assignment.patientId===action.patientId&&(!assignment.encounterId||assignment.encounterId===action.encounterId));
        if(!assignment?.protocolSnapshot)throw new Error('Select an approved protocol assigned to this patient and encounter.');
        if(data.pathways.some(record=>record.id!==existing?.id&&record.protocolAssignmentId===assignment.id&&record.currentVersion))throw new Error('This protocol assignment already has an active pathway. Open that record to continue.');
        if(assignment.version!==action.protocolAssignmentVersion||assignment.protocolId!==action.pathwayKey||String(assignment.protocolVersion)!==action.pathwayVersion)throw new Error('This protocol assignment changed. Reload its pinned version before continuing.');
        const steps=assignment.protocolSnapshot.steps;
        if(steps.length!==action.stages.length||action.stages.some(stage=>{const step=steps.find(step=>step.id===stage.id);return !step||step.title!==stage.title||stable([...step.prerequisites].sort())!==stable([...stage.prerequisites].sort());}))throw new Error('Assigned protocol steps and prerequisites must match the published version.');
        for(const stage of action.stages){
          const previous=existing?.stages.find(prior=>prior.id===stage.id);
          if(!['active','completed'].includes(stage.status)||previous?.status===stage.status||previous?.status==='active'&&stage.status==='completed')continue;
          const incoming=steps.flatMap(step=>step.transitions??[]).filter(transition=>transition.toStepId===stage.id);
          const permits=incoming.some(({when})=>when.kind==='always'||when.kind==='step-status'&&action.stages.some(step=>step.id===when.stepId&&step.status===when.equals)||when.kind==='event'&&action.eventType===when.eventType||when.kind==='review-choice'&&action.reviewChoice?.choiceId===when.choiceId&&action.reviewChoice.value===when.equals);
          if(incoming.length&&!permits)throw new Error('Record the qualifying activity or review decision before advancing this protocol step.');
        }
      }
      assertPathwayInput(action,existing);
      const eventFingerprint=stable(semanticAction(action));
      if(existing&&duplicatePathwayEvent(existing,action.eventId,eventFingerprint)){
        registerReceipt(data,action.requestId,fingerprint,'pathway',existing.id,existing.patientId,context.now);
        return data;
      }
      const exceptions=action.stages.filter(stage=>stage.reason?.trim()&&stage.status!=='pending'&&stage.status!=='active'&&stage.status!=='completed').map(stage=>({eventId:action.eventId,stageId:stage.id,reason:stage.reason!,actor:context.actor,at:context.now}));
      const changes:Omit<PathwayRecord,keyof BaseRecord>={
        type:'pathway',
        protocolAssignmentId:action.protocolAssignmentId,
        protocolAssignmentVersion:action.protocolAssignmentVersion,
        pathwayKey:action.pathwayKey,
        pathwayVersion:action.pathwayVersion,
        currentVersion:action.currentVersion,
        priorVersions:existing&&existing.pathwayVersion!==action.pathwayVersion?[{version:existing.version,pathwayVersion:existing.pathwayVersion,updatedAt:existing.updatedAt},...existing.priorVersions]:existing?.priorVersions??[],
        stages:action.stages.map(stage=>({...stage,prerequisites:[...stage.prerequisites]})),
        exceptions:existing?[...exceptions,...existing.exceptions]:exceptions,
        processedEvents:existing?[{eventId:action.eventId,fingerprint:eventFingerprint,at:context.now},...existing.processedEvents]:[{eventId:action.eventId,fingerprint:eventFingerprint,at:context.now}],
      };
      if(existing){
        const updated=updateRecord(existing,changes,context,existing.pathwayVersion,action.pathwayVersion,action.transitionReason,action.eventId);
        data.pathways[data.pathways.indexOf(existing)]=updated;
        registerReceipt(data,action.requestId,fingerprint,'pathway',updated.id,updated.patientId,context.now);
      }else{
        const created:{id:string;patientId:string;encounterId:string;version:number;createdAt:string;updatedAt:string;history:HistoryEntry[]} & Omit<PathwayRecord,keyof BaseRecord>={...makeBase(action,context),...changes};
        data.pathways.unshift(created);
        registerReceipt(data,action.requestId,fingerprint,'pathway',created.id,created.patientId,context.now);
      }
      return data;
    }
    case `${commandPrefix}.schedule.save`:{
      requireExpectedVersion(action);
      const existing=action.id?data.scheduling.find(record=>record.id===action.id):undefined;
      if(action.id&&!existing)throw new Error('Scheduling record not found.');
      if(existing){
        assertSamePatient(existing,action.patientId,action.encounterId);
        if(existing.version!==action.expectedVersion)throw new Error('This scheduling record changed. Reload the latest version before saving.');
      }
      assertScheduleInput(action,existing);
      if(action.nextAttemptAt&&Date.parse(action.nextAttemptAt)<=Date.parse(context.now))throw new Error('The next outreach attempt must be after the current time.');
      if(['attended','no-show'].includes(action.phase)&&action.appointmentStartsAt&&Date.parse(action.appointmentStartsAt)>Date.parse(context.now))throw new Error('Attendance and no-show cannot be recorded before the appointment starts.');
      const dueWindowTimezone=action.dueWindowTimezone??existing?.dueWindow.timezone;
      if(!dueWindowTimezone)throw new Error('Select the timezone for the follow-up due window.');
      if(['no-show','reschedule-outreach'].includes(action.phase)&&(action.outreachStatus==='completed'||!action.nextAttemptAt))throw new Error('Record the next contact attempt and keep outreach open before saving missed-visit follow-up.');
      const attempts=existing?.outreach.attempts??[];
      const outcome:SchedulingRecord['outreach']['attempts'][number]['outcome']=action.outreachStatus==='unreachable'?'unreachable':action.outreachStatus==='completed'&&action.phase==='booking-reported'?'booked':action.optedOut?'opt-out':action.phase==='cancelled'?'cancelled':action.phase==='no-show'?'no-show':'attempted';
      const nextAttempts=action.outreachNote?.trim()?[{at:context.now,outcome,note:action.outreachNote},...attempts]:attempts;
      const appointment=action.appointmentStartsAt&&action.appointmentTimezone&&action.bookingEvidenceSource!=='none'&&action.bookingEvidenceRef?{startsAt:action.appointmentStartsAt,timezone:action.appointmentTimezone,evidenceSource:action.bookingEvidenceSource,evidenceRef:action.bookingEvidenceRef}:undefined;
      const previousAppointments=[...(existing?.previousAppointments??[])];
      if(existing?.appointment&&(!appointment||stable(appointment)!==stable(existing.appointment)))previousAppointments.unshift({...existing.appointment});
      const changes:Omit<SchedulingRecord,keyof BaseRecord>={
        type:'schedule',
        phase:action.phase,
        dueWindow:{start:action.dueWindowStart,end:action.dueWindowEnd,timezone:dueWindowTimezone},
        owner:action.owner,
        preferredChannel:action.preferredChannel,
        optedOut:action.optedOut,
        appointment,
        previousAppointments,
        outreach:{status:action.outreachStatus,attempts:nextAttempts,nextAttemptAt:action.nextAttemptAt},
        cancellationReason:action.cancellationReason?.trim()||undefined,
      };
      if(existing){
        const updated=updateRecord(existing,changes,context,existing.phase,action.phase,action.transitionReason,appointment?.evidenceRef);
        data.scheduling[data.scheduling.indexOf(existing)]=updated;
        registerReceipt(data,action.requestId,fingerprint,'schedule',updated.id,updated.patientId,context.now);
      }else{
        const created:{id:string;patientId:string;encounterId:string;version:number;createdAt:string;updatedAt:string;history:HistoryEntry[]} & Omit<SchedulingRecord,keyof BaseRecord>={...makeBase(action,context),...changes};
        data.scheduling.unshift(created);
        registerReceipt(data,action.requestId,fingerprint,'schedule',created.id,created.patientId,context.now);
      }
      return data;
    }
  }
}

export function latestLanguageAccess(state:Pick<State,'language'>|undefined,patientId:string):LanguageAccessRecord|undefined{
  return state?.language.filter(record=>record.patientId===patientId).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt))[0];
}

export function reviewedPlanTranslation(state:Pick<State,'language'>|undefined,patientId:string,planId:string,planVersion:number,language:'en'|'es'):LanguageAccessRecord|undefined{
  const record=state?.language.filter(record=>record.patientId===patientId&&record.planRef?.planId===planId&&record.planRef.planVersion===planVersion&&record.preferredLanguage===language).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt))[0];
  return record?.translationStatus==='translated'&&record.instructionsLanguage===language&&record.translatedText&&record.translationReviewer?record:undefined;
}

function dateInTimezone(instant:string,zone:string){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant));
  return ['year','month','day'].map(type=>parts.find(part=>part.type===type)!.value).join('-');
}

export function getSummary(state:State,patientId?:string,referenceTime?:string):{open:number;overdue:number;attention:string[]}{
  const current=validateState(state);
  const now=new Date(timestamp.parse(referenceTime??new Date().toISOString())).toISOString();
  const handoffs=current.handoffs.filter(record=>(!patientId||record.patientId===patientId)&&record.phase!=='closed');
  const scheduling=current.scheduling.filter(record=>!patientId||record.patientId===patientId).filter(record=>!['attended','cancelled'].includes(record.phase));
  const pathways=current.pathways.filter(record=>(!patientId||record.patientId===patientId)&&record.currentVersion&&record.stages.some(stage=>!['completed','declined'].includes(stage.status)));
  const open=handoffs.length+scheduling.length+pathways.length;
  const overdueHandoffs=handoffs.filter(record=>record.deliveryStatus==='overdue'||!!record.dueAt&&Date.parse(record.dueAt)<Date.parse(now)).length;
  const overdueScheduling=scheduling.filter(record=>['booking-reported','confirmed'].includes(record.phase)&&record.appointment?Date.parse(record.appointment.startsAt)<Date.parse(now):!!record.dueWindow.timezone&&record.dueWindow.end<dateInTimezone(now,record.dueWindow.timezone)).length;
  const overduePathways=pathways.filter(record=>record.stages.some(stage=>!['completed','declined'].includes(stage.status)&&!!stage.dueDate&&stage.dueDate<now.slice(0,10))).length;
  const attention=[
    ...handoffs.filter(record=>record.priority==='high').map(record=>`High-priority handoff: ${record.concern}`),
    ...handoffs.filter(record=>record.phase==='locally-saved').map(record=>`Handoff awaiting delivery and accepted ownership: ${record.concern}`),
    ...current.language.filter(record=>!patientId||record.patientId===patientId).filter(record=>record.translationStatus==='unsupported').map(()=>`Language support is partial; unsupported translations remain explicit.`),
    ...current.scheduling.filter(record=>!patientId||record.patientId===patientId).filter(record=>record.optedOut).map(()=>`Patient opted out of outreach; manual follow-through is still needed.`),
    ...scheduling.filter(record=>record.outreach.status==='unreachable').map(record=>`Unable to reach patient; next outreach attempt ${record.outreach.nextAttemptAt??'requires review'}.`),
    ...scheduling.filter(record=>!record.dueWindow.timezone).map(()=>`The follow-up due window needs a timezone before its deadline can be assessed.`),
    ...scheduling.filter(record=>['no-show','reschedule-outreach'].includes(record.phase)&&(record.outreach.status==='completed'||!record.outreach.nextAttemptAt)).map(record=>`Missed-visit follow-up needs another contact attempt. Owner: ${record.owner}.`),
  ];
  return {open,overdue:overdueHandoffs+overdueScheduling+overduePathways,attention:[...new Set(attention)]};
}
