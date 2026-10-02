import {z} from 'zod';
import type {Workspace} from './theranetrix';
import {applyWorkflowAction,canonicalCommand,normalizeClinicalWorkflows,workspaceCarePlans} from './clinical-flows';

const id=z.string().trim().min(1).max(200);
export const demonstrationPatientIds=['TN-DEMO-01','TN-DEMO-02','TN-DEMO-03'] as const;
export const demoScopes=['care-participation','messaging','data-use','sharing'] as const;
export const demoAccessActions=['read-chart','read-plan','edit-record','import-data','share-plan','send-message','submit-checkin'] as const;
export const demoRoles=['clinician','coordinator','patient','proxy'] as const;
export type DemoScope=typeof demoScopes[number];
export type DemoAccessAction=typeof demoAccessActions[number];
export type DemoRole=typeof demoRoles[number];
export type DemoSourceMode='online'|'offline'|'read-only';
export type ExportAudience='internal'|'patient'|'proxy';
export type DemoExportScope={audience:ExportAudience;recipient:string;accessScope:string[];grantId?:string};
const deliveryId={deliveryId:id.optional()};
export const demoConnectionActionSchema=z.object({
  type:z.literal('demonstration.connection'),requestId:id.max(120),expectedVersion:z.number().int().min(0),patientId:id,
  command:z.discriminatedUnion('operation',[
    z.object({operation:z.literal('connect')}).strict(),
    z.object({operation:z.literal('set-source-mode'),mode:z.enum(['online','offline','read-only'])}).strict(),
    z.object({operation:z.literal('open-chart')}).strict(),
    z.object({operation:z.literal('import-readings')}).strict(),
    z.object({operation:z.literal('retry-import')}).strict(),
    z.object({operation:z.literal('replay-imports'),scenario:z.enum(['reconnection','changed-duplicate','late','invalid-unit'])}).strict(),
    z.object({operation:z.literal('resolve-import'),importId:id.optional(),resolution:z.enum(['reject','correct'])}).strict(),
    z.object({operation:z.literal('prepare-note')}).strict(),
    z.object({operation:z.literal('deliver-note'),...deliveryId}).strict(),
    z.object({operation:z.literal('queue-delivery'),...deliveryId}).strict(),
    z.object({operation:z.literal('receive-delivery'),...deliveryId,outcome:z.enum(['complete','partial','failure'])}).strict(),
    z.object({operation:z.literal('simulate-delivery-failure'),...deliveryId}).strict(),
    z.object({operation:z.literal('retry-delivery'),...deliveryId,waitForReceipt:z.boolean().optional()}).strict(),
    z.object({operation:z.literal('set-consent'),allowed:z.boolean()}).strict(),
    z.object({operation:z.literal('set-scope'),scope:z.enum(demoScopes),allowed:z.boolean()}).strict(),
    z.object({operation:z.literal('set-proxy'),allowed:z.boolean(),recipient:z.string().trim().min(1).max(120).optional()}).strict(),
    z.object({operation:z.literal('check-access'),role:z.enum(demoRoles),action:z.enum(demoAccessActions).optional()}).strict(),
  ]),
}).strict();
export type DemoConnectionAction=z.infer<typeof demoConnectionActionSchema>;
export type DemoCommand=DemoConnectionAction['command'];
type ReportEvent={sourceId:string;eventId:string;sourcePatientId:string;observedAt:string;entries:{metric:'pain'|'function'|'sleep';value:number;unit:string}[];replacesEventId?:string};
type ImportRecord={id:string;status:'accepted'|'quarantined'|'rejected'|'corrected';sourcePatientId:string;reason:string;receivedAt:string;observationId?:string;replacementObservationId?:string;event?:ReportEvent;fingerprint?:string;owner?:string;resolution?:{actor:string;at:string}};
export type DemoDeliveryPart={id:string;kind:'care-plan'|'handoff-summary';status:'prepared'|'pending'|'received'|'failed';attempts:number;text?:string;receipt?:string;receivedAt?:string;failure?:string};
export type DemoDelivery={id:string;planId:string;planVersion:number;text:string;status:'prepared'|'pending'|'partial'|'failed'|'received';preparedAt:string;attempts:number;receivedAt?:string;receipt?:string;failure?:string;encounterId?:string;owner?:string;parts?:DemoDeliveryPart[];attemptHistory?:{at:string;actor:string;partIds:string[];outcome:string}[];supersedesDeliveryId?:string};
export type DemoAccessCheck={role:string;action?:DemoAccessAction;allowed:boolean;reason:string;at:string;policyFingerprint?:string;expiresAt?:string};
export type DemoPatientConnection={consent:boolean;permissionVersion?:number;scopes?:Record<DemoScope,boolean>;scopeHistory?:{scope:DemoScope;allowed:boolean;actor:string;at:string}[];proxyUntil?:string;proxyRecipient?:string;proxyGrantId?:string;chartOpenedAt?:string;chartEncounterId?:string;imports:ImportRecord[];deliveries:DemoDelivery[];duplicateCount:number;accessChecks:DemoAccessCheck[];lastReceivedAt?:string;replayCursor?:string};
export type DemoConnection={version:number;connected:boolean;sourceMode?:DemoSourceMode;sourceModeVersion?:number;recovery?:{owner:string;since:string;resolvedAt?:string};patients:Record<string,DemoPatientConnection>;history:{id:string;patientId:string;operation:string;detail:string;actor:string;at:string}[];receipts:{id:string;fingerprint:string;actor:string}[]};
export const emptyDemoConnection=():DemoConnection=>({version:0,connected:false,sourceMode:'online',patients:{},history:[],receipts:[]});
export const emptyDemoPatientConnection=():DemoPatientConnection=>({consent:true,scopes:{'care-participation':true,messaging:true,'data-use':true,sharing:true},scopeHistory:[],imports:[],deliveries:[],duplicateCount:0,accessChecks:[]});
export const demoPatientScopes=(patient:DemoPatientConnection):Record<DemoScope,boolean>=>patient.scopes??{'care-participation':true,messaging:true,'data-use':patient.consent,sharing:patient.consent};
export const demoSourceMode=(state:DemoConnection):DemoSourceMode=>state.sourceMode??'online';

const roleActions:Record<DemoRole,readonly DemoAccessAction[]>={
  clinician:['read-chart','read-plan','edit-record','import-data','share-plan','send-message'],
  coordinator:['read-chart','read-plan','share-plan','send-message'],
  patient:['read-plan','submit-checkin','send-message'],
  proxy:['read-plan','share-plan','send-message'],
};
const requiredScope:Partial<Record<DemoAccessAction,DemoScope>>={'edit-record':'care-participation','submit-checkin':'care-participation','import-data':'data-use','share-plan':'sharing','send-message':'messaging'};
export function previewDemoAccess(state:DemoConnection,patientId:string,role:DemoRole,action:DemoAccessAction,now:string){
  const patient=state.patients[patientId]??emptyDemoPatientConnection(),scopes=demoPatientScopes(patient);
  const policyFingerprint=canonicalCommand({patientId,role,action,connected:state.connected,sourceMode:demoSourceMode(state),sourceModeVersion:state.sourceModeVersion??0,permissionVersion:patient.permissionVersion??0,consent:patient.consent,scopes,proxyUntil:patient.proxyUntil,proxyGrantId:patient.proxyGrantId,proxyRecipient:patient.proxyRecipient});
  const result=(allowed:boolean,reason:string)=>({allowed,reason,policyFingerprint,...(role==='proxy'&&patient.proxyUntil?{expiresAt:patient.proxyUntil}:{})});
  if(!Number.isFinite(Date.parse(now))||!demonstrationPatientIds.some(id=>id===patientId))return result(false,'Choose a patient story and a valid review time.');
  if(!state.connected)return result(false,'Connect the demonstration service first.');
  if(!roleActions[role]?.includes(action))return result(false,'This role does not have that capability in the walkthrough.');
  if(role==='proxy'&&(!patient.consent||!scopes.sharing||!patient.proxyUntil||Date.parse(patient.proxyUntil)<=Date.parse(now)))return result(false,'An active patient-specific proxy grant and sharing permission are required.');
  if(!patient.consent&&['read-chart','import-data','share-plan'].includes(action))return result(false,'Patient sharing permission is paused for this connection.');
  const scope=requiredScope[action];if(scope&&!scopes[scope])return result(false,`${scope==='data-use'?'Data use':scope==='care-participation'?'Care participation':scope==='sharing'?'Sharing':'Messaging'} permission is paused.`);
  if(action==='import-data'&&demoSourceMode(state)==='offline')return result(false,'The source is offline. Previously received records remain available.');
  if(action==='share-plan'&&demoSourceMode(state)!=='online')return result(false,demoSourceMode(state)==='offline'?'The inbox connection is offline.':'The connection has read access only.');
  return result(true,'This action is allowed for the selected role in the walkthrough.');
}
export function isDemoAccessCheckCurrent(check:DemoAccessCheck,state:DemoConnection,patientId:string,role:DemoRole,action:DemoAccessAction,now:string){
  const current=previewDemoAccess(state,patientId,role,action,now);
  return check.role===role&&check.action===action&&check.policyFingerprint===current.policyFingerprint&&check.allowed===current.allowed&&(!check.allowed||!check.expiresAt||Date.parse(check.expiresAt)>Date.parse(now));
}

/** Preparing a limited copy for an owner does not establish a production recipient identity. */
export function requireDemoExportScope(workspace:Workspace,patientId:string,audience:ExportAudience,now=new Date().toISOString()):DemoExportScope{
  const patient=workspace.patients.find(item=>item.id===patientId);if(!patient)throw new Error('Patient not found.');
  if(!Number.isFinite(Date.parse(now)))throw new Error('A valid export time is required.');
  if(audience==='internal')return {audience,recipient:'Workspace owner',accessScope:['internal-record']};
  const access=workspace.demoConnection?.patients[patientId];
  if(access&&(!access.consent||!demoPatientScopes(access).sharing))throw new Error('Patient sharing permission is paused.');
  if(audience==='patient')return {audience,recipient:patient.name,accessScope:['patient-plan']};
  if(audience!=='proxy')throw new Error('Choose an export audience.');
  if(!demonstrationPatientIds.some(id=>id===patientId)||!workspace.workflowShowcase?.patientIds.includes(patientId)||!access?.proxyUntil||!z.string().datetime({offset:true}).safeParse(access.proxyUntil).success||Date.parse(access.proxyUntil)<=Date.parse(now))throw new Error('An active patient-specific proxy grant is required.');
  return {audience,recipient:access.proxyRecipient??'Designated caregiver',accessScope:['patient-plan'],grantId:access.proxyGrantId??`legacy-proxy:${patientId}:${access.proxyUntil}`};
}
export function demoDeliveryParts(delivery:DemoDelivery):DemoDeliveryPart[]{
  return delivery.parts??[{id:delivery.id+'-plan',kind:'care-plan',status:delivery.status==='partial'?'failed':delivery.status,attempts:delivery.attempts,...(delivery.receipt?{receipt:delivery.receipt}:{}),...(delivery.receivedAt?{receivedAt:delivery.receivedAt}:{}),...(delivery.failure?{failure:delivery.failure}:{})}];
}

/** Local scenario service: never creates live integration permissions or provider receipts. */
export function applyDemoConnection(source:Workspace,input:DemoConnectionAction,actor:string,now:string):Workspace{
  const action=demoConnectionActionSchema.parse(input);
  if(!actor.trim()||!z.string().datetime({offset:true}).safeParse(now).success)throw new Error('A verified workspace actor and timestamp are required.');
  if(!source.workflowShowcase?.patientIds.includes(action.patientId)||!demonstrationPatientIds.some(id=>id===action.patientId))throw new Error('Choose a patient from the demonstration stories.');
  const chart=source.patients.find(patient=>patient.id===action.patientId);if(!chart)throw new Error('Patient not found.');
  const current=source.demoConnection??emptyDemoConnection(),fingerprint=canonicalCommand({patientId:action.patientId,command:action.command});
  let data=structuredClone(source);
  const state=structuredClone(current),patient=state.patients[action.patientId]??=emptyDemoPatientConnection(),{command}=action;
  const owner=chart.clinician||actor;
  const requireConnection=()=>{if(!state.connected)throw new Error('Connect the demonstration service first.');};
  const requireOnline=()=>{requireConnection();if(demoSourceMode(state)==='offline')throw new Error('The source is offline. Reconnect before receiving or sending records.');};
  const requireConsent=()=>{if(!patient.consent)throw new Error('This patient’s sharing permission is paused.');};
  const requireScope=(scope:DemoScope)=>{if(!demoPatientScopes(patient)[scope])throw new Error(`${scope==='data-use'?'Data use':scope==='sharing'?'Sharing':scope==='messaging'?'Messaging':'Care participation'} permission is paused.`);};
  const requireChart=()=>{requireConnection();requireConsent();if(!patient.chartOpenedAt||!data.clinicalWorkflows?.slices.encounters.state.preparations.some(record=>record.patientId===action.patientId&&record.encounterId===patient.chartEncounterId))throw new Error('Open this patient’s chart first.');};
  const requireSend=()=>{requireChart();requireScope('sharing');requireOnline();if(demoSourceMode(state)==='read-only')throw new Error('The connection has read access only. Delivery is unavailable.');};
  // Current permissions apply to retries as well as newly submitted commands.
  if(command.operation==='open-chart'){requireOnline();requireConsent();}
  if(['import-readings','retry-import','replay-imports','resolve-import'].includes(command.operation)){requireChart();requireScope('data-use');requireOnline();}
  if(command.operation==='prepare-note'){requireChart();requireScope('sharing');}
  if(['deliver-note','queue-delivery','retry-delivery','simulate-delivery-failure'].includes(command.operation))requireSend();
  if(command.operation==='receive-delivery')requireOnline();
  if(command.operation==='set-proxy'&&command.allowed){requireConsent();requireScope('sharing');}
  const replay=current.receipts.find(receipt=>receipt.id===action.requestId);
  if(replay){if(replay.fingerprint!==fingerprint||replay.actor!==actor)throw new Error('This request belongs to a different action or actor.');return source;}
  if(action.expectedVersion!==current.version)throw new Error('The connection changed. Review the latest record and try again.');
  const findDelivery=(selectedId?:string,requireCurrent=false)=>{
    const delivery=selectedId?patient.deliveries.find(item=>item.id===selectedId):patient.deliveries[0];
    if(!delivery)throw new Error('Prepare the current care plan first.');
    if(requireCurrent){const plan=workspaceCarePlans(data).find(plan=>plan.patientId===action.patientId);if(!plan||plan.id!==delivery.planId||plan.version!==delivery.planVersion||plan.summary!==delivery.text)throw new Error('The care plan changed. Prepare the latest plan before delivery.');}
    delivery.parts=demoDeliveryParts(delivery);delivery.owner??=owner;delivery.attemptHistory??=[];return delivery;
  };
  function fixture(kind:string,at=new Date(Date.parse(now)-30*60000).toISOString()):ReportEvent{
    return {sourceId:'demo-patient-reports',eventId:`demo-${action.patientId}-${kind}`,sourcePatientId:kind==='mismatch'?'unmatched-chart':action.patientId,observedAt:at,entries:[{metric:'pain',value:4,unit:'score-0-10'},{metric:'function',value:6,unit:'score-0-10'},{metric:'sleep',value:5,unit:'score-0-10'}]};
  }
  function eventFor(record:ImportRecord):ReportEvent{return record.event??fixture(record.sourcePatientId==='unmatched-chart'?'mismatch':'original',new Date(Date.parse(record.receivedAt)-30*60000).toISOString());}
  function importReport(event:ReportEvent){
    const encounterId=event.eventId,requestId=`${action.requestId}:${event.eventId}`;
    data=applyWorkflowAction(data,{type:'workflow.apply',domain:'encounters',patientId:action.patientId,requestId,expectedSliceVersion:normalizeClinicalWorkflows(data.clinicalWorkflows).slices.encounters.version,command:{type:'encounters.observations.save',requestId,patientId:action.patientId,encounterId,instrument:'local-0-10',submissionStatus:'confirmed',patientNote:`Imported from ${event.sourceId}; source report ${event.eventId}${event.replacesEventId?`; matched replacement for ${event.replacesEventId}`:''}.`,entries:event.entries.map(entry=>({metric:entry.metric,value:entry.value,status:entry.value===0?'zero':'answered',source:'Demonstration connection · patient report',recordedAt:event.observedAt}))}},actor,now);
    return data.clinicalWorkflows!.slices.encounters.state.observations.find(record=>record.patientId===action.patientId&&record.encounterId===encounterId)!.id;
  }
  function receive(event:ReportEvent){
    const eventFingerprint=canonicalCommand(event),existing=patient.imports.find(record=>{const saved=eventFor(record);return saved.sourceId===event.sourceId&&saved.eventId===event.eventId;});
    if(existing&&(existing.fingerprint??canonicalCommand(eventFor(existing)))===eventFingerprint){patient.duplicateCount++;return existing;}
    const reason=existing?'The source reused a report ID with different content. Review the source before accepting it.':event.sourcePatientId!==action.patientId?'The source patient does not match the open chart. No observations were added.':event.entries.some(entry=>entry.unit!=='score-0-10'||entry.value<0||entry.value>10)?'The source units or values need review. No observations were added.':Date.parse(event.observedAt)>Date.parse(now)?'The source time is in the future. No observations were added.':undefined;
    const held=patient.imports.find(record=>record.fingerprint===eventFingerprint);if(held){patient.duplicateCount++;return held;}
    const record:ImportRecord={id:existing?event.eventId+'-conflict-'+action.requestId:event.eventId,status:reason?'quarantined':'accepted',sourcePatientId:event.sourcePatientId,reason:reason??'Patient, units and source time matched.',receivedAt:now,event:structuredClone(event),fingerprint:eventFingerprint,owner};
    if(!reason)record.observationId=importReport(event);
    patient.imports.push(record);patient.lastReceivedAt=now;return record;
  }
  function queue(delivery:DemoDelivery,retry=false){
    if(delivery.status==='received')throw new Error('The demonstration inbox already received this note.');
    if(retry?!['failed','partial'].includes(delivery.status):delivery.status!=='prepared')throw new Error(retry?'There is no failed delivery to retry.':'Use Retry delivery for an interrupted note.');
    const remaining=delivery.parts!.filter(part=>part.status!=='received');
    for(const part of remaining){part.status='pending';part.attempts++;delete part.failure;}
    delivery.status='pending';delivery.attempts++;delete delivery.failure;
    delivery.attemptHistory!.push({at:now,actor,partIds:remaining.map(part=>part.id),outcome:'queued'});
  }
  function acknowledge(delivery:DemoDelivery,outcome:'complete'|'partial'|'failure'){
    const pending=delivery.parts!.filter(part=>part.status==='pending');
    if(delivery.status==='received')return false;
    if(delivery.status!=='pending'||!pending.length)throw new Error('There is no delivery waiting for a receipt.');
    if(outcome==='partial'&&pending.length<2)throw new Error('A partial receipt needs at least two pending items.');
    pending.forEach((part,index)=>{if(outcome==='complete'||outcome==='partial'&&index===0){part.status='received';part.receivedAt=now;part.receipt='DEMO-'+part.id;}else{part.status='failed';part.failure='The demonstration inbox was temporarily unavailable.';}});
    const received=delivery.parts!.filter(part=>part.status==='received').length;
    delivery.status=received===delivery.parts!.length?'received':received?'partial':'failed';
    if(delivery.status==='received'){delivery.receivedAt=now;delivery.receipt='DEMO-'+delivery.id;delete delivery.failure;}
    else delivery.failure=delivery.status==='partial'?'Some items arrived. The remaining items need a retry.':'The demonstration inbox was temporarily unavailable.';
    delivery.attemptHistory!.push({at:now,actor,partIds:pending.map(part=>part.id),outcome});return true;
  }
  let detail='';
  switch(command.operation){
    case 'connect':state.connected=true;detail='Demonstration service connected within this workspace.';break;
    case 'set-source-mode':requireConnection();state.sourceMode=command.mode;if(command.mode==='offline')state.recovery={owner,since:now};else if(state.recovery&&!state.recovery.resolvedAt)state.recovery.resolvedAt=now;detail=command.mode==='offline'?`Source disconnected. Last received records remain available. Recovery owner: ${owner}.`:command.mode==='read-only'?'Source connected with read access only. Import is available; delivery is blocked.':'Source reconnected. Replay pending reports to reconcile arrivals.';break;
    case 'open-chart':{
      const encounter=data.clinicalWorkflows?.slices.encounters.state.preparations.find(record=>record.patientId===action.patientId&&record.encounterId==='review-'+action.patientId);
      if(!encounter)throw new Error('The patient story has no matching encounter.');
      patient.chartOpenedAt=now;patient.chartEncounterId=encounter.encounterId;detail='Patient and encounter context matched; chart opened.';break;
    }
    case 'import-readings':if(patient.imports.length)throw new Error('This report has already arrived. Use Retry import to demonstrate duplicate handling.');receive(fixture('original'));receive(fixture('mismatch'));detail='One report added to observation history; one patient mismatch held for review.';break;
    case 'retry-import':{const original=patient.imports.find(record=>record.status==='accepted');if(!original)throw new Error('Import the report first.');receive(eventFor(original));detail='Repeated report reconciled by source ID and content. No duplicate observations were added.';break;}
    case 'replay-imports':{
      const original=patient.imports.find(record=>record.status==='accepted');if(!original)throw new Error('Import the report first.');const first=eventFor(original);
      if(command.scenario==='reconnection'){receive(first);const saved=patient.imports.find(record=>record.event?.eventId===`demo-${action.patientId}-reconnected`);receive(saved?eventFor(saved):fixture('reconnected'));const mismatch=patient.imports.find(record=>record.sourcePatientId==='unmatched-chart');receive(mismatch?eventFor(mismatch):fixture('mismatch'));patient.replayCursor='reconnection-1';detail='Pending reports replayed. New reports were saved; repeated reports were retained once.';}
      else if(command.scenario==='changed-duplicate'){receive({...first,entries:first.entries.map(entry=>({...entry,value:entry.metric==='pain'?7:entry.value}))});detail='A changed report reused an existing source ID and was held for review.';}
      else{const kind=command.scenario;const saved=patient.imports.find(record=>record.event?.eventId===`demo-${action.patientId}-${kind}`);const event=saved?eventFor(saved):fixture(kind,kind==='late'?new Date(Date.parse(first.observedAt)-86400000).toISOString():first.observedAt);if(kind==='invalid-unit')event.entries=event.entries.map(entry=>({...entry,unit:entry.metric==='sleep'?'hours':entry.unit}));receive(event);detail=kind==='late'?'A late report was added at its original collection time.':'A report with an unsupported unit was held for review.';}
      break;
    }
    case 'resolve-import':{
      const record=patient.imports.find(record=>record.status==='quarantined'&&(!command.importId||record.id===command.importId));if(!record)throw new Error('There is no unresolved import issue.');
      if(command.resolution==='correct'){
        if(record.sourcePatientId!=='unmatched-chart')throw new Error('This issue requires source review. Reject it here and retain the original report.');
        const event=eventFor(record),replacement=receive({...fixture('correction',event.observedAt),replacesEventId:event.eventId});record.replacementObservationId=replacement.observationId;record.status='corrected';record.reason='Original patient mismatch retained; a separately matched replacement was added to this chart.';
      }else{record.status='rejected';record.reason='Report rejected after review. Original content retained; no observations added.';}
      record.resolution={actor,at:now};detail=record.reason;break;
    }
    case 'prepare-note':{
      const plan=workspaceCarePlans(data).find(plan=>plan.patientId===action.patientId);if(!plan)throw new Error('Save a care plan before preparing delivery.');
      if(patient.deliveries.some(delivery=>delivery.planId===plan.id&&delivery.planVersion===plan.version&&delivery.text===plan.summary))throw new Error('This plan is already prepared. Review its delivery status below.');
      const deliveryId='demo-note-'+action.requestId,previous=patient.deliveries[0],savedPlan=chart.carePlans.find(item=>item.id===plan.id)!;
      patient.deliveries.unshift({id:deliveryId,planId:plan.id,planVersion:plan.version,text:plan.summary,status:'prepared',preparedAt:now,attempts:0,encounterId:savedPlan.encounterId??patient.chartEncounterId,owner,parts:([{kind:'care-plan',suffix:'plan'},{kind:'handoff-summary',suffix:'handoff'}] as const).map(part=>({id:deliveryId+'-'+part.suffix,kind:part.kind,status:'prepared',attempts:0,text:part.kind==='care-plan'?plan.summary:`Care plan ${plan.id}, version ${plan.version}. Follow-up owner: ${savedPlan.owner}. Due: ${savedPlan.followup} ${savedPlan.time}${savedPlan.timezone?' '+savedPlan.timezone:''}.`})),attemptHistory:[],...(previous?{supersedesDeliveryId:previous.id}:{})});detail='Current care plan prepared for the demonstration inbox.';break;
    }
    case 'queue-delivery':{const delivery=findDelivery(command.deliveryId,true);queue(delivery);detail='Care plan sent to the demo inbox; waiting for receipts.';break;}
    case 'simulate-delivery-failure':{const delivery=findDelivery(command.deliveryId,true);queue(delivery);acknowledge(delivery,'failure');detail=`Delivery interrupted. The prepared note is retained. Follow-up owner: ${delivery.owner}.`;break;}
    case 'deliver-note':case 'retry-delivery':{
      const delivery=findDelivery(command.deliveryId,true);queue(delivery,command.operation==='retry-delivery');
      if(command.operation==='retry-delivery'&&command.waitForReceipt){detail='Remaining delivery items sent; waiting for receipts.';break;}
      acknowledge(delivery,'complete');detail='Care plan received by the demonstration inbox.';break;
    }
    case 'receive-delivery':{const delivery=findDelivery(command.deliveryId);if(!acknowledge(delivery,command.outcome))return source;detail=delivery.status==='received'?'All items received by the demonstration inbox.':`${delivery.failure} Follow-up owner: ${delivery.owner}.`;break;}
    case 'set-consent':patient.consent=command.allowed;if(!command.allowed)delete patient.chartOpenedAt;detail=command.allowed?'Patient sharing permission restored for this connection.':'Patient sharing permission paused for this connection. Existing records and other care preferences are retained.';break;
    case 'set-scope':patient.scopes={...demoPatientScopes(patient),[command.scope]:command.allowed};(patient.scopeHistory??=[]).push({scope:command.scope,allowed:command.allowed,actor,at:now});detail=`${command.scope==='data-use'?'Data use':command.scope==='care-participation'?'Care participation':command.scope==='sharing'?'Sharing':'Messaging'} permission ${command.allowed?'allowed':'paused'}. Other permissions and existing records are retained.`;break;
    case 'set-proxy':if(command.allowed){patient.proxyUntil=new Date(Date.parse(now)+86400000).toISOString();patient.proxyRecipient=command.recipient??'Designated caregiver';patient.proxyGrantId=action.requestId;}else{delete patient.proxyUntil;delete patient.proxyGrantId;}detail=command.allowed?`Proxy access granted to ${patient.proxyRecipient} for 24 hours in the walkthrough.`:'Proxy access removed from the walkthrough.';break;
    case 'check-access':{requireConnection();const previewAction=command.action??(command.role==='patient'||command.role==='proxy'?'read-plan':'read-chart'),decision=previewDemoAccess(state,action.patientId,command.role,previewAction,now);patient.accessChecks.unshift({role:command.role,action:previewAction,...decision,at:now});detail=`${command.role} · ${previewAction}: ${decision.allowed?'access allowed':'access denied'}. ${decision.reason}`;break;}
  }
  if(['set-consent','set-scope','set-proxy'].includes(command.operation))patient.permissionVersion=(patient.permissionVersion??0)+1;
  if(command.operation==='set-source-mode')state.sourceModeVersion=(state.sourceModeVersion??0)+1;
  state.version++;state.receipts.push({id:action.requestId,fingerprint,actor});
  state.history.unshift({id:action.requestId,patientId:action.patientId,operation:command.operation,detail,actor,at:now});
  data.demoConnection=state;data.audit.unshift({id:crypto.randomUUID(),patientId:action.patientId,date:now,actor,action:'Demonstration connection: '+detail});return data;
}
