import type {CareOperations} from './care-operations';
import type {DemoConnection} from './demo-connection';
import type {WorkflowShowcase} from './clinical-flows/showcase';
import {emptyClinicalWorkflows,type ClinicalWorkflowsState} from './clinical-flows';
import {sampleMedications,type Medication,type CarePlan} from './medications';
import type {ConfigurationSnapshot,PlanningProfile} from './configuration';
import type {ClinicalContext} from './patient-overview';
import type {TreatmentReview} from './treatment-review';
import {ensureObservationRecords} from './observations';
import {ensureTreatmentDemoCases} from './demo-cases';
import type {EngineRun,EngineDecision,AdvisorTurn} from './engine-demo';
import type {SavedTwinPreferences} from './patient-twin-settings';
import type {DashboardProfile} from './dashboard-layout';
import {ADVISOR_HANDOFF_SOURCE,ADVISOR_NAME} from './product-names';
import {demoIdentity} from './demo-identity';
import {demoSymptomChangeRule,type SymptomChangeRule} from './symptom-change-rule';
export type Patient = {
  id: string; name: string; initials: string; age: number; pronouns: string; condition: string;
  dateOfBirth?:string; medicalRecordNumber?:string;
  identityHistory?:{dateOfBirth:string;medicalRecordNumber:string;date:string;actor:string}[];
  stage: string; status: 'Needs review' | 'On track' | 'Monitoring'; clinician: string;
  color: string; enrolled: string; nextVisit: string; goal: string; baseline: number;
  pain: number[]; sleep: number[]; function: number[]; dates: string[];
  adherence: number; notes: Note[]; completed: string[]; pathway: string;
  medications: Medication[]; carePlans: CarePlan[];
  recordReviewRequiredSince?:string;
  preferredLanguage?:'en'|'es';
  medicationReconciliation?: {date:string;author:string;none:true};
  clinicalContext?: ClinicalContext;
  twinPreferences?: SavedTwinPreferences;
  treatmentReview?: TreatmentReview;
  demoCase?: 'finding-treatment'|'improving';
  workflowObservations?: {id:string;workflowRecordId:string;workflowVersion:number;encounterId:string;metric:'pain'|'function'|'sleep';status:'answered'|'zero'|'unanswered'|'declined';value?:number;source:string;recordedAt:string;confirmedAt:string;confirmedBy:string;correctedFromEntryId?:string;withdrawnAt?:string;withdrawalReason?:string}[];
  checkins: {id:string;date:string;pain:number;sleep:number;function:number;note:string;source?:'Stored trajectory'|'Patient self-report'|'Clinician-confirmed report';encounterId?:string;workflowRecordId?:string;workflowVersion?:number;workflowEntryIds?:string[];supersedes?:string;trajectoryIndex?:number;withdrawnAt?:string;withdrawalReason?:string}[];
  doseLogs?: {id:string;date:string;medicationId:string;name:string;status:'taken'|'missed';effects:string}[];
};
export type Note = {id:string;date:string;author:string;text:string;type:string;encounterId?:string;workflowRecordId?:string;workflowVersion?:number;supersedes?:string};
export type Review = {id:string;patientId:string;title:string;detail:string;priority:'High'|'Medium'|'Routine';source:string;status:'Open'|'Acknowledged'|'Resolved';created:string;resolution?:string;updatedAt?:string;updatedBy?:string;history?:{status:Review['status'];resolution:string;actor:string;date:string}[];encounterId?:string;workflowRecordId?:string;workflowVersion?:number;owner?:string;dueAt?:string;workflowHistory?:{id:string;at:string;actor:string;from:string;to:string;reason:string;evidenceRef?:string}[]};
export type TaskState = {workflowDomain?:'decisions'|'program-governance'|'patient-coordination'|'treatment-continuity';id:string;patientId:string;title:string;date:string;time:string;type:string;done:boolean;owner?:string;planId?:string;encounterId?:string;workflowRecordId?:string;workflowVersion?:number;timezone?:string;workflowDisposition?:'pending'|'deferred'|'done'};
export type Task = TaskState & {history?:(TaskState & {changedAt:string;changedBy:string;reason:string})[]};
export type Message = {id:string;patientId:string;text:string;date:string;sender:string;direction:'in'|'out'};
export type Audit = {id:string;date:string;actor:string;action:string;patientId?:string};
export type FeatureKey = 'assessments'|'digitalTwin'|'pst'|'shadow'|'advisor'|'pathways'|'messages'|'reviewPrompts';
export type PrototypeFeedback = {id:string;path:string;screen:string;priority:'Must-have'|'Nice-to-have';intent:'Question'|'Change'|'Keep'|'Hide'|'Remove'|'Prioritize';text:string;date:string;author:string};
export type Workspace = {prototypeFeedback?:PrototypeFeedback[];actionReceipts?:{id:string;fingerprint:string}[];careOperations?:CareOperations;demoConnection?:DemoConnection;workflowShowcase?:WorkflowShowcase;dashboardProfiles?:DashboardProfile[];patients:Patient[];reviews:Review[];tasks:Task[];messages:Message[];audit:Audit[];features:Record<FeatureKey,boolean>;clinicalWorkflows?:ClinicalWorkflowsState;demoCasesVersion?:number;showcaseVersion?:number;planning?:PlanningProfile;configurationHistory?:ConfigurationSnapshot[];engineRuns?:EngineRun[];engineDecisions?:EngineDecision[];advisorTurns?:AdvisorTurn[];symptomChangeRule?:SymptomChangeRule};
export const featureDefinitions:{id:FeatureKey;name:string;description:string;dependency?:FeatureKey;mode:string}[] = [
  {id:'assessments',name:'MobileNetrix assessments',description:'Patient check-ins and observed pain, function, and sleep outcomes.',mode:'Working workflow'},
  {id:'reviewPrompts',name:'Record-based review prompts',description:'Patient-specific prompts about reported effects, benefit, medication use, and missing information.',mode:'Deterministic review rules'},
  {id:'digitalTwin',name:'Digital Twin',description:'Patient state, observed trajectory, and saved scenario runs.',dependency:'assessments',mode:'Record-based engine'},
  {id:'pst',name:'PST',description:'Weighted strategy comparison and saved clinician decisions.',dependency:'digitalTwin',mode:'Weighted strategy engine'},
  {id:'shadow',name:'Shadow AI',description:'Record-based strategy comparison alongside PST, with inspectable rules.',dependency:'digitalTwin',mode:'Record-rule engine'},
  {id:'advisor',name:ADVISOR_NAME,description:'Guided patient conversations, confirmed check-ins, and care-team handoffs.',dependency:'messages',mode:'Guided conversation'},
  {id:'pathways',name:'Care pathways',description:'Enroll patients, assign activities, and record completion.',mode:'Working workflow'},
  {id:'messages',name:'Patient messaging',description:'Workspace message history and patient companion conversations.',mode:'Workspace only'},
];
export const pathwaySteps = [
  {id:'intake',stage:'Intake',title:'Confirm patient goals',description:'Record the patient’s priorities and care-team assignment.'},
  {id:'baseline',stage:'Baseline',title:'Collect baseline check-in',description:'Collect pain, daily function, and sleep self-reports.'},
  {id:'review',stage:'Clinical review',title:'Review the patient record',description:'A clinician reviews available history and outstanding information.'},
  {id:'plan',stage:'Care plan',title:'Document the agreed plan',description:'Record the plan discussed with the patient and the follow-up owner.'},
  {id:'followup',stage:'Follow-up',title:'Review progress with the patient',description:'Discuss progress toward the patient’s goals and document next steps.'},
];
export const seedWorkspace = ():Workspace => {
  const rows = [
    ['TN-1042','Sarah Mitchell','SM',54,'she / her','Peripheral neuropathy','Clinical review','Needs review','Dr. Maya Chen','#e6edf9','Walk comfortably for 20 minutes',7,[7,6,6,5,5,6,6],[4,5,5,6,6,5,5],[3,4,4,5,5,4,4],86],
    ['TN-1038','James Wilson','JW',62,'he / him','Chronic low back pain','Follow-up','On track','Dr. Maya Chen','#e1f1e9','Return to gardening twice a week',8,[8,7,7,6,5,4,4],[4,4,5,6,6,7,7],[2,3,4,4,5,6,7],94],
    ['TN-1051','Elena Rodriguez','ER',47,'she / her','Fibromyalgia','Care plan','Monitoring','Alex Morgan, NP','#f1e8f4','Have more energy for family activities',7,[7,7,6,6,6,5,5],[3,4,4,4,5,5,6],[3,3,4,4,5,5,5],79],
    ['TN-1047','Robert Chen','RC',68,'he / him','Peripheral neuropathy','Baseline','Needs review','Alex Morgan, NP','#faecd8','Sleep with fewer interruptions',6,[6,6,6,7,7,7,8],[5,5,4,4,3,3,3],[5,5,4,4,4,3,3],57],
    ['TN-1034','Olivia Bennett','OB',39,'she / her','Chronic low back pain','Follow-up','On track','Dr. Maya Chen','#e0eef2','Get back to weekend walks',6,[6,6,5,5,4,3,3],[5,5,6,6,7,7,8],[4,4,5,5,6,7,7],96],
    ['TN-1055','Michael Thompson','MT',58,'he / him','Persistent postsurgical pain','Intake','Monitoring','Alex Morgan, NP','#ece9e4','Feel confident moving again',7,[7,7,7,6,6,6,6],[4,4,4,5,5,5,5],[3,3,3,4,4,4,4],71],
    ['TN-1031','Grace Park','GP',45,'she / her','Fibromyalgia','Follow-up','On track','Dr. Maya Chen','#f4e5ea','Complete a full workday with breaks',7,[7,6,6,5,5,4,4],[4,5,5,6,6,7,7],[3,4,4,5,5,6,6],91],
    ['TN-1049','David Anderson','DA',71,'he / him','Peripheral neuropathy','Care plan','Monitoring','Alex Morgan, NP','#e4eafa','Enjoy a daily walk with my dog',6,[6,6,5,5,5,5,5],[5,5,5,6,6,6,6],[4,4,5,5,5,5,5],83],
  ] as const;
  const patients:Patient[]=rows.map((r,i)=>({id:r[0],name:r[1],initials:r[2],age:r[3],...demoIdentity(r[0]),pronouns:r[4],condition:r[5],stage:r[6],status:r[7],clinician:r[8],color:r[9],goal:r[10],baseline:r[11],pain:[...r[12]],sleep:[...r[13]],function:[...r[14]],adherence:r[15],dates:['2026-07-28','2026-08-04','2026-08-11','2026-08-18','2026-08-25','2026-09-01','2026-09-08'],enrolled:'2026-07-28',nextVisit:`2026-09-${String(8+i%4).padStart(2,'0')}`,pathway:'Chronic pain follow-up',completed:pathwaySteps.slice(0,Math.max(0,pathwaySteps.findIndex(s=>s.stage===r[6]))).map(s=>s.id),medications:sampleMedications({id:r[0],name:r[1],condition:r[5]}),carePlans:[],checkins:[],notes:[{id:`note-${i}`,date:'2026-09-01T10:30:00Z',author:r[8],type:'Progress note',text:`Reviewed the patient’s reported progress and daily activities. Patient goal: ${r[10].toLowerCase()}. Follow-up review planned.`}]}));
  const workspace:Workspace = {patients,reviews:[
    {id:'rev-1',patientId:'TN-1042',title:'Change in reported symptoms',detail:'Sarah reported more discomfort during her most recent check-ins and would like to discuss her activity plan. Review the self-reported trend and follow up with the patient.',priority:'High',source:'Patient check-in',status:'Open',created:'2026-09-08T08:40:00Z'},
    {id:'rev-2',patientId:'TN-1047',title:'Baseline information incomplete',detail:'Robert’s baseline record is missing a complete medication reconciliation and a current clinician-reviewed history.',priority:'High',source:'Care coordinator',status:'Open',created:'2026-09-08T08:15:00Z'},
    {id:'rev-3',patientId:'TN-1051',title:'Patient asks about next steps',detail:'Elena: “I completed this week’s activities. Can we review what comes next?” Review the pathway and reply within the workspace.',priority:'Medium',source:ADVISOR_HANDOFF_SOURCE,status:'Open',created:'2026-09-08T07:50:00Z'},
    {id:'rev-4',patientId:'TN-1055',title:'Intake review ready',detail:'Michael’s initial profile is ready for care-team review and goal confirmation.',priority:'Routine',source:'Care pathway',status:'Open',created:'2026-09-07T16:00:00Z'},
  ],tasks:[
    {id:'task-1',patientId:'TN-1042',title:'Progress review',date:'2026-09-08',time:'09:30',type:'Video visit',done:false},
    {id:'task-2',patientId:'TN-1047',title:'Complete baseline history',date:'2026-09-08',time:'10:15',type:'Care coordination',done:false},
    {id:'task-3',patientId:'TN-1038',title:'Follow-up check-in',date:'2026-09-08',time:'11:00',type:'Phone call',done:false},
    {id:'task-4',patientId:'TN-1051',title:'Care plan review',date:'2026-09-09',time:'14:00',type:'Video visit',done:false},
    {id:'task-5',patientId:'TN-1055',title:'Welcome and goal setting',date:'2026-09-10',time:'09:00',type:'Care coordination',done:false},
  ],messages:[
    {id:'msg-1',patientId:'TN-1042',text:'I’ve noticed more discomfort after my afternoon walks this week. Can we talk about it at our next visit?',date:'2026-09-08T08:40:00Z',sender:'Sarah Mitchell',direction:'in'},
    {id:'msg-2',patientId:'TN-1042',text:'Thank you for sharing this, Sarah. We’ll review your check-ins and talk through your goals at our next visit.',date:'2026-09-08T08:55:00Z',sender:'Care team',direction:'out'},
    {id:'msg-3',patientId:'TN-1051',text:'I completed this week’s activities. Can we review what comes next?',date:'2026-09-08T07:50:00Z',sender:'Elena Rodriguez',direction:'in'},
    {id:'msg-4',patientId:'TN-1038',text:'I spent some time in the garden yesterday. Happy to be getting back to it!',date:'2026-09-07T15:20:00Z',sender:'James Wilson',direction:'in'},
  ],audit:[],features:{reviewPrompts:true,assessments:true,digitalTwin:true,pst:true,shadow:true,advisor:true,pathways:true,messages:true},clinicalWorkflows:emptyClinicalWorkflows(),symptomChangeRule:demoSymptomChangeRule()};
  for(const p of workspace.patients){if(workspace.reviews.some(r=>r.patientId===p.id&&r.status!=='Resolved'))p.status='Needs review';p.nextVisit=workspace.tasks.filter(t=>t.patientId===p.id&&!t.done&&t.type!=='Care coordination').sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))[0]?.date??'';}
  return ensureObservationRecords(ensureTreatmentDemoCases(workspace));
};
export function featureEnabled(w:Workspace,key:FeatureKey):boolean {
  const def=featureDefinitions.find(f=>f.id===key);
  return w.features[key] && (!def?.dependency || featureEnabled(w,def.dependency));
}
export function latest(values:number[]){return values.at(-1)??0;}
export function initials(name:string){return name.trim().split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase();}
