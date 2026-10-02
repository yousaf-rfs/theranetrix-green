import {z} from 'zod';
import type {Patient,Workspace,FeatureKey} from '../theranetrix';
import {engineRecordRevision} from '../engine-demo';
import {featureEnabled} from '../theranetrix';
import * as results from './results-referrals';
import * as treatment from './treatment-continuity';
import * as encounters from './encounters';
import * as coordination from './patient-coordination';
import * as decisions from './decisions';
import * as integration from './integration-access';
import * as governance from './program-governance';
import {applyWorkflowBridges} from './bridges';
import {encounterContext,decisionSourceSnapshot,carePlanPackages,careActionReferences,decisionObservationSources} from './context';
import {requireDemoExportScope,demonstrationPatientIds} from '../demo-connection';
import {governedContext,requireGovernedUse} from './governance-runtime';
import {requireDecisionApprovalUse} from './decision-governance';

export const clinicalWorkflowDomains=['results-referrals','treatment-continuity','encounters','patient-coordination','decisions','integration-access','program-governance'] as const;
export type ClinicalWorkflowDomain=typeof clinicalWorkflowDomains[number];
export type WorkflowScope='patient'|'program';
export type WorkflowWorkerStatus='ready';
export type DomainStates={
  'results-referrals':results.State;
  'treatment-continuity':treatment.State;
  encounters:encounters.State;
  'patient-coordination':coordination.State;
  decisions:decisions.State;
  'integration-access':integration.State;
  'program-governance':governance.State;
};
export type WorkflowWorkerProvenance={pullRequest:number;headSha:string;journeys:readonly string[];component:string;modulePath:string;scope:WorkflowScope;status:WorkflowWorkerStatus;blocker:string;title:string};
const worker=(pullRequest:number,headSha:string,journeys:string[],component:string,domain:ClinicalWorkflowDomain,scope:WorkflowScope,title:string):WorkflowWorkerProvenance=>({pullRequest,headSha,journeys,component,modulePath:'lib/clinical-flows/'+domain+'.ts',scope,status:'ready',blocker:'',title});
export const clinicalWorkflowWorkerProvenance:Record<ClinicalWorkflowDomain,WorkflowWorkerProvenance>={
  'results-referrals':worker(6,'4fc31b4bdb694f0f59ab644b6cdc86d7610fce5e',['J29','J30'],'ResultsReferralsPanel','results-referrals','patient','Tests and referrals'),
  'treatment-continuity':worker(9,'67f7a74bf9f4c429c64d5418d461caa8b52adb89',['J03','J04','J31','J32','J33','J34'],'TreatmentContinuityPanel','treatment-continuity','patient','Treatment and continuity'),
  encounters:worker(11,'78fba342d244015d51b0db6c64eb827e48337901',['J01','J02','J08','J11','J14','J17'],'EncountersPanel','encounters','patient','Encounter and care plan'),
  'patient-coordination':worker(13,'1bc05fb072c785c594b5b99f5b6bbce3498c80f4',['J09','J10','J13','J15','J16'],'PatientCoordinationPanel','patient-coordination','patient','Patient coordination'),
  decisions:worker(15,'31892f1f4a61d38a82fb3f55398d4ae720fd8b0d',['J05','J06','J07','J18','J20'],'DecisionsPanel','decisions','patient','Decisions and evidence'),
  'integration-access':worker(17,'a9e917dec443677d517d717372064b87c705cca3',['J12','J19','J21'],'IntegrationAccessPanel','integration-access','program','Connections and access'),
  'program-governance':worker(19,'4d7c64a587fb743fac650149c0e8002b0a20eced',['J22','J23','J24','J25','J26','J27','J28'],'ProgramGovernancePanel','program-governance','program','Program governance'),
};
export type ClinicalWorkflowSlice<S=unknown>={version:number;state:S;requestIds:string[];receipts:{id:string;fingerprint:string}[];updatedAt?:string;updatedBy?:string;worker:WorkflowWorkerProvenance};
export type ClinicalWorkflowsState={version:1;contractPath:'docs/clinical-workflows-v3-contract.md';manifestPath:'docs/clinical-workflows-v3-acceptance.json';slices:{[K in ClinicalWorkflowDomain]:ClinicalWorkflowSlice<DomainStates[K]>}};
const modules={
  'results-referrals':results,'treatment-continuity':treatment,encounters,
  'patient-coordination':coordination,decisions,'integration-access':integration,'program-governance':governance,
};
const isRecord=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function initial<D extends ClinicalWorkflowDomain>(domain:D):DomainStates[D]{return modules[domain].initialState() as DomainStates[D];}
function normalizeSlice<D extends ClinicalWorkflowDomain>(domain:D,value:unknown):ClinicalWorkflowSlice<DomainStates[D]>{
  if(value!==undefined&&!isRecord(value))throw new Error('Invalid saved workflow slice: '+domain);
  const source=value as Record<string,unknown>|undefined;
  const version=source?.version??0;
  if(!Number.isInteger(version)||Number(version)<0)throw new Error('Invalid saved workflow version: '+domain);
  if(Number(version)>0&&source?.state===undefined)throw new Error('Saved workflow state is missing: '+domain);
  const legacyEmpty=source?.state===undefined||(version===0&&isRecord(source.state)&&Object.keys(source.state).length===0);
  const state=legacyEmpty?initial(domain):modules[domain].validateState(source?.state) as DomainStates[D];
  const receipts=z.array(z.object({id:z.string().min(1),fingerprint:z.string().min(1)}).strict()).max(50).parse(source?.receipts??[]);
  return {version:Number(version),state,requestIds:receipts.map(r=>r.id),receipts,
    ...(typeof source?.updatedAt==='string'?{updatedAt:source.updatedAt}:{}),
    ...(typeof source?.updatedBy==='string'?{updatedBy:source.updatedBy}:{}),worker:clinicalWorkflowWorkerProvenance[domain]};
}
export function normalizeClinicalWorkflows(value:unknown):ClinicalWorkflowsState{
  if(value!==undefined&&(!isRecord(value)||value.version!==1))throw new Error('Unsupported saved clinical workflow version.');
  if(isRecord(value)&&!isRecord(value.slices))throw new Error('Saved clinical workflow slices are missing or invalid.');
  const source=isRecord(value)&&isRecord(value.slices)?value.slices:{};
  return {version:1,contractPath:'docs/clinical-workflows-v3-contract.md',manifestPath:'docs/clinical-workflows-v3-acceptance.json',
    slices:Object.fromEntries(clinicalWorkflowDomains.map(domain=>[domain,normalizeSlice(domain,source[domain])])) as ClinicalWorkflowsState['slices']};
}
export function emptyClinicalWorkflows():ClinicalWorkflowsState{return normalizeClinicalWorkflows(undefined);}
export const workflowApplyActionSchema=z.object({
  type:z.literal('workflow.apply'),domain:z.enum(clinicalWorkflowDomains),patientId:z.string().trim().min(1).max(200).optional(),
  requestId:z.string().trim().min(1).max(200),expectedSliceVersion:z.number().int().min(0),
  command:z.object({type:z.string().trim().min(1).max(120)}).passthrough(),
}).strict();
export type WorkflowApplyAction=z.infer<typeof workflowApplyActionSchema>;
export function canonicalCommand(value:unknown):string{
  if(Array.isArray(value))return '['+value.map(canonicalCommand).join(',')+']';
  if(isRecord(value))return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonicalCommand(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export function workspaceCarePlans(workspace:Workspace){return workspace.patients.flatMap(patient=>{
  const superseded=new Set(patient.carePlans.map(plan=>plan.supersedes).filter(Boolean));
  return patient.carePlans.filter(plan=>!superseded.has(plan.id)).map(plan=>({id:plan.id,patientId:patient.id,version:plan.workflowVersion??1,summary:plan.text,goal:plan.workflowGoal??patient.goal}));
});}
/** Source-domain counters also invalidate reviews when records have not been projected into the legacy patient view. */
export function workflowInputRevision(patient:Patient,workspace:Workspace):string{
  const sources=clinicalWorkflowDomains.filter(domain=>domain!=='decisions').map(domain=>{
    const state=workspace.clinicalWorkflows?.slices[domain]?.state;
    if(!state)return null;
    if(domain==='program-governance')return state;
    return Object.fromEntries(Object.entries(state).filter(([key])=>key!=='receipts').map(([key,value])=>[key,Array.isArray(value)?value.filter(row=>row&&typeof row==='object'&&('patientId' in row?row.patientId===patient.id:'event' in row&&(row.event as {patientId?:string})?.patientId===patient.id)):null]));
  });
  let hash=2166136261;for(const character of canonicalCommand(sources))hash=Math.imul(hash^character.charCodeAt(0),16777619);
  return 'wf2-'+engineRecordRevision(patient,workspace)+'-'+(hash>>>0).toString(16);
}
function requireWorkflowFeatures(workspace:Workspace,type:string){
  const required:FeatureKey[]=[];
  if(type.startsWith('encounters.observations.')&&type!=='encounters.observations.withdraw')required.push('assessments');
  if(type.startsWith('decisions.')&&type!=='decisions.export.capture')required.push('digitalTwin');
  if(type==='decisions.comparison.capture')required.push('pst');
  if(type==='decisions.outputs.capture'||type==='decisions.engine.capture')required.push('pst','shadow');
  if(type==='patient-coordination.pathway.save')required.push('pathways');
  if(type==='patient-coordination.support.save')required.push('advisor');
  if(required.some(key=>!featureEnabled(workspace,key)))throw new Error('This capability is currently turned off in workspace settings.');
}
/** All workflow commands enter here after session authentication. No browser role, actor, or provider receipt becomes trusted context. */
export function applyWorkflowAction(workspace:Workspace,input:WorkflowApplyAction,actor:string,now=new Date().toISOString()):Workspace{
  const action=workflowApplyActionSchema.parse(input);
  if(!actor.trim()||!z.string().datetime({offset:true}).safeParse(now).success)throw new Error('A verified actor and server timestamp are required.');
  const command=modules[action.domain].actionSchema.parse(action.command);
  requireWorkflowFeatures(workspace,command.type);
  if(!command.type.startsWith(action.domain+'.'))throw new Error('Workflow command does not match its domain.');
  if(command.requestId!==action.requestId)throw new Error('Workflow request identity does not match its command.');
  const patientScope=clinicalWorkflowWorkerProvenance[action.domain].scope==='patient';
  const commandPatient='patientId' in command?command.patientId:undefined;
  if(patientScope&&(!action.patientId||commandPatient!==action.patientId))throw new Error('Workflow patient context does not match the selected patient.');
  if(!patientScope&&action.patientId!==undefined)throw new Error('Program workflow commands must not include a patient envelope.');
  if(commandPatient!==undefined&&!workspace.patients.some(p=>p.id===commandPatient))throw new Error('Patient not found.');
  // Recheck current permissions before serving even an already accepted export.
  const exportScope=command.type==='decisions.export.capture'?requireDemoExportScope(workspace,command.patientId,command.audience??'internal',now):undefined;
  const data=structuredClone(workspace),workflows=normalizeClinicalWorkflows(data.clinicalWorkflows),slice=workflows.slices[action.domain];
  data.clinicalWorkflows=workflows;
  if(command.type==='decisions.export.capture'&&exportScope?.audience==='proxy'){
    const prior=workflows.slices.decisions.state.exports.find(row=>row.requestId===command.requestId);
    if(prior&&(prior.grantId!==exportScope.grantId||prior.recipient!==exportScope.recipient))throw new Error('The proxy recipient or grant changed. Prepare a new export for the current recipient.');
  }
  const fingerprint=canonicalCommand({actor,domain:action.domain,patientId:action.patientId,command});
  const receipt=slice.receipts.find(r=>r.id===action.requestId);
  if(receipt){if(receipt.fingerprint!==fingerprint)throw new Error('This request ID was already used for a different workflow command.');return data;}
  const patients=data.patients.map(({id,name})=>({id,name}));
  const features={...Object.fromEntries(Object.keys(data.features).map(key=>[key,featureEnabled(data,key as keyof Workspace['features'])])),decisionsExport:true,patientAuthenticationVerified:false};
  const context={actor,now,patients,features};
  const previousState=canonicalCommand(slice.state);
  // Parse with each concrete schema. The outer envelope never permits direct replacement of a slice.
  switch(action.domain){
    case 'results-referrals':workflows.slices[action.domain].state=results.reduce(workflows.slices[action.domain].state,results.actionSchema.parse(command),{...context,careActions:careActionReferences(data)});break;
    case 'treatment-continuity':{
      const parsed=treatment.actionSchema.parse(command);
      const order=parsed.type==='treatment-continuity.update-lifecycle'?parsed.orderEvidence:undefined;
      const curated=demonstrationPatientIds.some(id=>id===parsed.patientId)&&data.workflowShowcase?.patientIds.includes(parsed.patientId);
      const demoClinicalAuthority=curated&&order?.authority==='demo-service'&&['Dr. Maya Chen','Alex Morgan, NP'].includes(order.prescriber)?{patientId:parsed.patientId,principalId:order.prescriber,canPrescribe:true,scopeSupported:true}:undefined;
      workflows.slices[action.domain].state=treatment.reduce(workflows.slices[action.domain].state,parsed,{...context,careActions:careActionReferences(data),demoClinicalAuthority});break;
    }
    case 'encounters':workflows.slices.encounters.state=encounters.reduce(workflows.slices.encounters.state,encounters.actionSchema.parse(command),{...context,...encounterContext(data,data.patients.find(p=>p.id===action.patientId)!,now)});break;
    case 'patient-coordination':workflows.slices[action.domain].state=coordination.reduce(workflows.slices[action.domain].state,coordination.actionSchema.parse(command),{...context,carePlans:workspaceCarePlans(data),protocolAssignments:workflows.slices['program-governance'].state.protocolAssignments});break;
    case 'decisions':{
      const parsed=decisions.actionSchema.parse(command),p=data.patients.find(p=>p.id===parsed.patientId)!;
      workflows.slices.decisions.state=decisions.reduce(workflows.slices.decisions.state,parsed,{...context,exportScope,engineRuns:data.engineRuns?.filter(run=>run.patientId===p.id),observationSources:decisionObservationSources(data,p,parsed.encounterId),currentEngineRevision:engineRecordRevision(p,data),sourceSnapshot:decisionSourceSnapshot(data,p,parsed.encounterId,workflowInputRevision(p,data),now),carePlanPackages:carePlanPackages(data,p),carePlans:workspaceCarePlans(data),inputVersions:[{patientId:p.id,encounterId:parsed.encounterId,inputVersion:workflowInputRevision(p,data)}]});break;
    }
    case 'integration-access':workflows.slices[action.domain].state=integration.reduce(workflows.slices[action.domain].state,integration.actionSchema.parse(command),context);break;
    case 'program-governance':workflows.slices[action.domain].state=governance.reduce(workflows.slices[action.domain].state,governance.actionSchema.parse(command),{...context,...governedContext(data)});break;
  }
  // Domain receipts outlive the bounded shared cache. An old replay must not create another audit event or increment the slice.
  if(canonicalCommand(slice.state)===previousState)return data;
  // Reducers work only on this clone. Let durable receipts authenticate an old
  // retry, but reject every new mutation before recording or projecting it.
  if(action.expectedSliceVersion!==slice.version)throw new Error('This workflow changed in another session. Reload before retrying.');
  // A durable receipt is an unchanged historical result, not a new use of its artifacts.
  // Evaluate new-use gates only after that distinction, while this is still a private clone.
  if(['decisions.engine.capture','decisions.comparison.capture','decisions.outputs.capture'].includes(command.type)){
    const ref=command.type==='decisions.engine.capture'?data.engineRuns?.find(run=>run.id===command.runId&&run.patientId===command.patientId)?.releaseRef:undefined;
    for(const capability of command.type==='decisions.comparison.capture'?['digitalTwin','pst'] as const:['digitalTwin','pst','shadow'] as const){
      if(command.type==='decisions.engine.capture')requireGovernedUse(data,capability,now,ref);
      else requireGovernedUse(data,capability,now);
    }
  }
  if(command.type==='decisions.sign.capture'||command.type==='decisions.sign.amend')requireDecisionApprovalUse(data,command,now);
  slice.version+=1;slice.updatedAt=now;slice.updatedBy=actor;
  slice.receipts=[...slice.receipts,{id:action.requestId,fingerprint}].slice(-50);slice.requestIds=slice.receipts.map(r=>r.id);
  data.audit.unshift({id:crypto.randomUUID(),date:now,actor,action:'Saved '+command.type,...(typeof commandPatient==='string'?{patientId:commandPatient}:{})});
  return applyWorkflowBridges(data,action.domain,{actor,now});
}
export function workflowStatusCounts(workspace:Workspace){const workflows=normalizeClinicalWorkflows(workspace.clinicalWorkflows);return {blocked:0,ready:Object.keys(workflows.slices).length,total:clinicalWorkflowDomains.length};}
