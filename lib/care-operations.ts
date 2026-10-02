import {z} from 'zod';
import type {Workspace} from './theranetrix';
import {canonicalCommand} from './clinical-flows';
import {workflowBridgeId} from './clinical-flows/bridges';
import {retainTaskState} from './record-history';
import {prepareLinkedPlan} from './clinical-flows/plan-preparation';

const id=z.string().trim().min(1).max(200),text=z.string().trim().min(1).max(2000),instant=z.string().datetime({offset:true});
const timezone=z.string().min(1).max(100).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}},'Choose a valid timezone.');
export type OpenCareWork={id:string;kind:string;patientId:string;encounterId?:string;title:string;owner:string;dueAt:string;revision:string;sourceId:string;acceptedOwner?:string};
export type Transfer={id:string;patientId:string;workId:string;revision:string;owner:string;backup:string;dueAt:string;timezone:string;evidence:string;actor:string;at:string};
export type Coverage={id:string;patientId:string;owner:string;backup:string;startsAt:string;endsAt:string;timezone:string;evidence:string;actor:string;at:string};
export type RemoteVisit={id:string;patientId:string;encounterId:string;channel:'video'|'phone';status:'scheduled'|'connected'|'interrupted'|'alternative-arranged'|'completed';location:string;owner:string;nextAttemptAt?:string;reason:string;at:string;actor:string};
export type Monitoring={id:string;patientId:string;status:'active'|'paused'|'disconnected'|'no-response';owner:string;nextAttemptAt?:string;reason:string;lastReceivedAt?:string;at:string;actor:string};
export type IdentityReview={id:string;patientId:string;otherPatientId:string;status:'open'|'distinct-records'|'correction-required';reason:string;owner:string;at:string;actor:string};
export type CareOperations={version:number;transfers:Transfer[];coverage:Coverage[];remoteVisits:RemoteVisit[];monitoring:Monitoring[];identityReviews:IdentityReview[];receipts:{id:string;fingerprint:string}[]};
export const emptyCareOperations=():CareOperations=>({version:0,transfers:[],coverage:[],remoteVisits:[],monitoring:[],identityReviews:[],receipts:[]});
const common={patientId:id,requestId:id,expectedVersion:z.number().int().nonnegative()};
const commandSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('prepare-plan'),source:z.object({domain:z.enum(['results-referrals','treatment-continuity']),id,version:z.number().int().positive()}).strict(),signoffId:id,signoffVersion:z.number().int().positive(),patientInstructions:text,rationale:text}).strict(),
  z.object({kind:z.literal('transfer'),work:z.array(z.object({id,revision:text}).strict()).min(1).max(100),owner:id,backup:id,dueAt:instant,timezone,evidence:text}).strict(),
  z.object({kind:z.literal('coverage'),owner:id,backup:id,startsAt:instant,endsAt:instant,timezone,evidence:text}).strict(),
  z.object({kind:z.literal('remote-visit'),encounterId:id,channel:z.enum(['video','phone']),status:z.enum(['scheduled','connected','interrupted','alternative-arranged','completed']),location:text,owner:id,nextAttemptAt:instant.optional(),reason:text}).strict(),
  z.object({kind:z.literal('monitoring'),status:z.enum(['active','paused','disconnected','no-response']),owner:id,nextAttemptAt:instant.optional(),reason:text}).strict(),
  z.object({kind:z.literal('identity-review'),otherPatientId:id,status:z.enum(['open','distinct-records','correction-required']),reason:text,owner:id}).strict(),
]);
export const careOperationsActionSchema=z.object({type:z.literal('care.operations'),...common,command:commandSchema}).strict();
export type CareOperationsAction=z.infer<typeof careOperationsActionSchema>;

/** Every open item resolves to saved source state, never to an asserted browser status. */
export function openCareWork(w:Workspace,patientId:string):OpenCareWork[]{
  const slices=w.clinicalWorkflows?.slices,items:OpenCareWork[]=[];
  const add=(kind:string,r:{id:string;patientId:string;encounterId?:string;version:number},title:string,owner:string,dueAt:string)=>{if(r.patientId===patientId)items.push({id:kind+':'+r.id,sourceId:r.id,kind,patientId,encounterId:r.encounterId||undefined,title,owner,dueAt,revision:String(r.version)});};
  if(slices){
    for(const r of slices['results-referrals'].state.results)if(!['closed','cancelled'].includes(r.status))add('result',r,r.requestLabel,r.owner,r.dueAt);
    for(const r of slices['results-referrals'].state.referrals)if(r.status!=='closed')add('referral',r,r.receivingService,r.owner,r.dueAt);
    for(const r of slices['patient-coordination'].state.handoffs)if(r.phase!=='closed')add('handoff',r,r.concern,r.responsiblePerson,r.dueAt??'');
    for(const r of slices['treatment-continuity'].state.transitions)if(r.handoverStatus!=='completed')add('transition',r,r.externalCareSource,r.owner??'',r.dueDate??'');
  }
  const sources=new Set(items.map(r=>r.sourceId));
  for(const task of w.tasks.filter(t=>t.patientId===patientId&&!t.done)){
    if(task.workflowRecordId&&sources.has(task.workflowRecordId))continue;
    items.push({id:'task:'+task.id,sourceId:task.id,kind:'task',patientId,encounterId:task.encounterId||undefined,title:task.title,owner:task.owner??'',dueAt:task.date+(task.time?' '+task.time:''),revision:canonicalCommand({title:task.title,date:task.date,time:task.time,planId:task.planId,workflowVersion:task.workflowVersion,done:task.done})});
  }
  for(const item of items){
    const transfer=w.careOperations?.transfers.find(t=>t.patientId===patientId&&t.workId===item.id&&t.revision===item.revision);
    if(transfer)item.acceptedOwner=transfer.owner;
    else for(const transition of slices?.['treatment-continuity'].state.transitions??[]){
      if(transition.patientId!==patientId||transition.handoverStatus!=='completed'||!transition.ownershipAccepted)continue;
      const accepted=transition.handoverEvidence?.pendingTransfers.find(row=>row.disposition==='accepted-transfer'&&row.ref.id===item.sourceId&&String(row.ref.version)===item.revision&&((['result','referral'].includes(item.kind)&&row.ref.domain==='results-referrals')||(item.kind==='transition'&&row.ref.domain==='treatment-continuity')));
      if(accepted)item.acceptedOwner=accepted.owner;
      const task=w.tasks.find(row=>row.id===item.sourceId);
      if(item.kind==='task'&&task?.workflowRecordId===transition.id){const pending=transition.handoverEvidence?.pendingTransfers.find(row=>row.disposition==='accepted-transfer'&&task.title==='Transition follow-up: '+row.title);if(pending)item.acceptedOwner=pending.owner;}
    }
  }
  return items;
}
export function coverageAt(w:Workspace,patientId:string,at:string){return w.careOperations?.coverage.find(row=>row.patientId===patientId&&Date.parse(row.startsAt)<=Date.parse(at)&&Date.parse(at)<Date.parse(row.endsAt));}
export function applyCareOperations(workspace:Workspace,input:CareOperationsAction,actor:string,now:string):Workspace{
  const action=careOperationsActionSchema.parse(input),w=structuredClone(workspace),patient=w.patients.find(p=>p.id===action.patientId);
  if(!patient)throw new Error('Patient not found.');
  const state=w.careOperations??=emptyCareOperations(),fingerprint=canonicalCommand({actor,patientId:action.patientId,command:action.command});
  const receipt=state.receipts.find(r=>r.id===action.requestId);if(receipt){if(receipt.fingerprint!==fingerprint)throw new Error('This request was already used for a different action.');return w;}
  if(state.version!==action.expectedVersion)throw new Error('Care coordination changed. Reload before saving.');
  const command=action.command,base={id:crypto.randomUUID(),patientId:patient.id,actor,at:now};
  const task=(kind:string,title:string,owner:string,due:string|undefined,done:boolean,source:string)=>{
    const taskId=workflowBridgeId(kind,patient.id,source),prior=w.tasks.find(t=>t.id===taskId);
    if(prior)retainTaskState(prior,actor,now,command.kind==='remote-visit'?'Remote visit updated':'Monitoring status updated');
    const fields={id:taskId,patientId:patient.id,title,owner,date:due?.slice(0,10)??'',time:due?.slice(11,16)??'',timezone:'UTC',type:'Care coordination',done};
    if(prior)Object.assign(prior,fields);else w.tasks.push(fields);
  };
  switch(command.kind){
    case 'prepare-plan':{
      const updated=prepareLinkedPlan(w,{patientId:patient.id,source:command.source,signoffId:command.signoffId,signoffVersion:command.signoffVersion,patientInstructions:command.patientInstructions,rationale:command.rationale},actor,now,workflowBridgeId('prepared-plan',action.requestId));
      Object.assign(w,updated);break;
    }
    case 'transfer':{
      const work=openCareWork(w,patient.id);
      for(const ref of command.work){const item=work.find(r=>r.id===ref.id);if(!item||item.revision!==ref.revision)throw new Error('Pending work changed. Review its current version before accepting responsibility.');
        state.transfers.unshift({...base,id:crypto.randomUUID(),workId:item.id,revision:item.revision,owner:command.owner,backup:command.backup,dueAt:command.dueAt,timezone:command.timezone,evidence:command.evidence});
        for(const pending of w.tasks.filter(t=>t.patientId===patient.id&&(t.id===item.sourceId||t.workflowRecordId===item.sourceId)&&!t.done)){retainTaskState(pending,actor,now,'Receiving responsibility recorded: '+command.evidence);pending.owner=command.owner;}
      }break;
    }
    case 'coverage':if(Date.parse(command.endsAt)<=Date.parse(command.startsAt))throw new Error('Coverage must end after it starts.');else state.coverage.unshift({...base,...command});break;
    case 'remote-visit':{
      const prior=state.remoteVisits.find(r=>r.patientId===patient.id&&r.encounterId===command.encounterId);
      if(command.status==='completed'&&prior?.status!=='connected')throw new Error('Record a connected assessment before completing the visit.');
      if(['interrupted','alternative-arranged'].includes(command.status)&&!command.nextAttemptAt)throw new Error('Record the owned next contact time.');
      state.remoteVisits.unshift({...base,...command});
      task('remote-recovery','Complete remote assessment',command.owner,command.nextAttemptAt,command.status==='completed',command.encounterId);break;
    }
    case 'monitoring':{
      if(command.status!=='active'&&!command.nextAttemptAt)throw new Error('Record the next review of the monitoring gap.');
      const lastReceivedAt=patient.checkins.filter(c=>!c.withdrawnAt).map(c=>c.date).sort().at(-1);
      state.monitoring.unshift({...base,...command,...(lastReceivedAt?{lastReceivedAt}:{})});
      task('monitoring-recovery',command.status==='no-response'?'Contact patient about missing report':'Review monitoring interruption',command.owner,command.nextAttemptAt,command.status==='active','monitoring');break;
    }
    case 'identity-review':if(!w.patients.some(p=>p.id===command.otherPatientId)||command.otherPatientId===patient.id)throw new Error('Select the other chart to review.');else state.identityReviews.unshift({...base,...command});break;
  }
  const savedState=w.careOperations!;savedState.version++;savedState.receipts=[...savedState.receipts,{id:action.requestId,fingerprint}].slice(-200);
  w.audit.unshift({id:crypto.randomUUID(),date:now,actor,patientId:patient.id,action:'Recorded '+command.kind});
  return w;
}
