import {ensureWorkflowShowcase} from './clinical-flows/showcase';
import {ensureStoryCompletion} from './clinical-flows/story-completion';
import {featureEnabled,type Patient,type Review,type Workspace} from './theranetrix';
import type {Medication} from './medications';
import type {ClinicalContextFields} from './patient-overview';
import {emptyClinicalContext} from './patient-overview';
import type {TreatmentReview,TreatmentReviewFields} from './treatment-review';
import type {SavedTwinPreferences,TwinPreferences} from './patient-twin-settings';
import type {DashboardProfile} from './dashboard-layout';
import {defaultDashboardLayout} from './dashboard-layout';
import type {AdvisorTurn,EnginePreferences} from './engine-demo';
import {advisorReply,buildEngineOutput} from './engine-demo';
import {configurationSnapshot,defaultPlanning,type PlanningProfile} from './configuration';
import {retainReviewTransition,retainTaskState} from './record-history';
import {ADVISOR_EXCHANGE_LABEL,ADVISOR_HANDOFF_SOURCE,ADVISOR_NAME,ADVISOR_SENDER} from './product-names';
import {demoIdentity} from './demo-identity';

// Authored records for every mapped feature area. Everything here is
// explicitly fictional: no value is a clinical prediction, efficacy estimate, drug
// recommendation, or validated instrument score. The seeding order matters, because
// each saved engine run stores the record fingerprint that existed when it ran.
export const showcaseVersion=4;
const clinician='Dr. Maya Chen';
const coordinator='Taylor Reed, RN';
const actor=clinician;
const emmaId='TN-DEMO-01',lucasId='TN-DEMO-02';

const patientOf=(w:Workspace,id:string)=>w.patients.find(p=>p.id===id);
function context(fields:Partial<ClinicalContextFields>,date:string):Patient['clinicalContext']{
  return {...emptyClinicalContext,...fields,date,author:actor,history:[]};
}
function assessment(goal:string,date:string,fields:TreatmentReviewFields):TreatmentReview{
  return {...fields,date,author:actor,goalAtReview:goal,history:[]};
}

// ---------------------------------------------------------------------------
// 1. Clinician workspace: fill the recorded detail the dashboard columns read.
// Robert Chen and David Anderson stay deliberately incomplete so the missing-data
// and unassessed-response states remain visible somewhere in the directory.
// ---------------------------------------------------------------------------
type BaseSeed={
  medication?:Partial<Medication>;
  clinicalContext?:Partial<ClinicalContextFields>;
  plan?:{text:string;owner:string;followup:string;time:string};
  review?:TreatmentReviewFields;
  reconciledNone?:boolean;
};
const medReviewed='2026-09-09T09:00:00Z',contextAt='2026-09-09T09:15:00Z',planAt='2026-09-09T09:30:00Z',reviewAt='2026-09-09T10:00:00Z';
const baseSeeds:Record<string,BaseSeed>={
  'TN-1042':{
    medication:{regimen:'300 mg orally three times daily',started:'2026-07-28',regimenSince:'2026-08-18',adherence:'Taken as recorded'},
    clinicalContext:{allergyStatus:'Reactions reported',allergies:'Codeine: patient reports nausea and a rash during a hospital admission several years ago. Not verified against outside records.',medicalHistory:'Peripheral neuropathy affecting both feet for about two years. Cause not established in the records available here; outside neurology notes and laboratory values are not imported.',priorTreatments:'Over-the-counter analgesics with little reported relief. No prior specialist treatment is recorded.',painLocation:'Both feet, worse in the evening',painDuration:'About two years',physicalContext:'Walking tolerance is roughly 10 minutes before resting. Evening discomfort after activity.',psychologicalContext:'Discouraged by the recent change in symptoms; keen to keep walking.',socialContext:'Lives alone; a neighbour helps with errands.',coordinator,preferences:'Wants to stay active and would rather not add another medication if the current one can be adjusted.'},
    plan:{text:'Review the recent increase in reported discomfort against the current regimen and the reported morning grogginess. Confirm walking tolerance at the next visit. No medication change is recorded in this plan.',owner:clinician,followup:'2026-09-18',time:'09:30'},
    review:{direction:'Finding a treatment',goalStatus:'Partly met',goalEvidence:'Target is a comfortable 20-minute walk. The patient reports about 10 minutes before resting, and discomfort rose over the last two check-ins.',decision:'Clarify whether the reported grogginess and the recent symptom change need a different strategy before adjusting treatment.',monitoring:'Recorded plan: weekly pain, function, and sleep reports, with walking tolerance discussed at the September 18 visit. Automated reminders are not configured.',options:[{title:'Review the current regimen and reported grogginess',status:'For discussion',rationale:'Partial benefit is recorded alongside a reported morning effect and a recent symptom increase.',considerations:'Reported codeine reaction, missing outside neurology records, and unconfirmed laboratory values all need clinician assessment.'},{title:'Discuss a non-medication addition with the patient',status:'For discussion',rationale:'The patient states a preference for avoiding an additional medication.',considerations:'No specific programme, referral, or drug has been selected or ranked here.'}]},
  },
  'TN-1038':{
    medication:{regimen:'500 mg orally twice daily as needed',started:'2026-07-28',adherence:'Taken as recorded',regimenSince:'2026-08-11'},
    clinicalContext:{allergyStatus:'None reported',medicalHistory:'Chronic low back pain for about four years following a lifting injury. Imaging reports are referenced by the patient but are not available in this workspace.',priorTreatments:'Completed a physiotherapy programme with reported benefit. Continues a daily stretching routine.',painLocation:'Lower back, occasionally into the right thigh',painDuration:'About four years',physicalContext:'Reports gardening for short periods twice in the last week, which met the recorded goal.',psychologicalContext:'Positive about the recent progress.',socialContext:'Lives with his spouse; keen gardener.',coordinator,preferences:'Prefers to keep the current simple routine and use medication only when needed.'},
    plan:{text:'Continue the current as-needed regimen and the stretching routine while the recorded benefit holds. Review at the scheduled follow-up call. This note does not issue a prescription.',owner:coordinator,followup:'2026-09-22',time:'11:00'},
    review:{direction:'Monitoring benefit',goalStatus:'Met',goalEvidence:'Goal was gardening twice a week. The patient reports two gardening sessions in the last week, with pain reported down from 8/10 at intake to 4/10 and function up from 2/10 to 7/10.',decision:'Confirm that the reported benefit and the simple routine remain acceptable to the patient.',monitoring:'Recorded plan: weekly self-reports and a follow-up call on September 22. The patient can request an earlier review.',options:[{title:'Maintain the current routine with follow-up',status:'Agreed',rationale:'The patient reports helpful medication, no side effects, and has met the recorded activity goal.',considerations:'Reconfirm use and preferences at follow-up. This is a recorded clinician decision, not an automated safety clearance.'}]},
  },
  'TN-1051':{
    medication:{regimen:'30 mg orally once daily',started:'2026-07-28',adherence:'Taken as recorded',regimenSince:'2026-08-18'},
    clinicalContext:{allergyStatus:'None reported',medicalHistory:'Fibromyalgia diagnosed about three years ago, with widespread pain and fatigue. Rheumatology correspondence is not imported here.',priorTreatments:'A prior amitriptyline trial is described by the patient but the dose, dates, and stop reason were not recorded and remain unknown.',painLocation:'Widespread, worst across the shoulders and hips',painDuration:'About three years',physicalContext:'Fatigue limits family activities in the afternoon. Reports pacing activity across the day.',psychologicalContext:'Motivated by the pathway activities; asks frequent questions about next steps.',socialContext:'Two school-age children at home.',coordinator,preferences:'Wants more predictable energy for family time, and asks to be involved in each decision.'},
    plan:{text:'Review the pathway activities the patient completed and agree the next stage together. Discuss whether the reported partial benefit and the remaining fatigue justify revisiting the treatment strategy. No medication change is recorded here.',owner:coordinator,followup:'2026-09-21',time:'14:00'},
    review:{direction:'Finding a treatment',goalStatus:'Not yet met',goalEvidence:'Goal is more energy for family activities. Function is reported up from 3/10 to 5/10, but the patient still reports afternoon fatigue that limits the activities she named.',decision:'Answer the patient’s outstanding question about next steps, then decide whether to revisit the treatment strategy.',monitoring:'Recorded plan: weekly self-reports plus pathway activity completion, reviewed on September 21. Validated fatigue instruments are not implemented.',options:[{title:'Review the pathway stage with the patient',status:'For discussion',rationale:'The patient completed her current activities and has asked what comes next.',considerations:'The five-stage pathway is the operational track and is not the clinical protocol.'},{title:'Revisit the treatment strategy',status:'Deferred',rationale:'Partial benefit with persistent fatigue may warrant a different approach.',considerations:'The unknown prior trial details need reconciliation first. No alternative has been selected or ranked.'}]},
  },
  'TN-1034':{
    medication:{regimen:'500 mg orally twice daily as needed',started:'2026-07-28',adherence:'Taken as recorded',regimenSince:'2026-08-11'},
    clinicalContext:{allergyStatus:'None reported',medicalHistory:'Chronic low back pain for about eighteen months, with no red-flag features recorded in this workspace.',priorTreatments:'Completed a graded walking programme with reported benefit.',painLocation:'Lower back',painDuration:'About eighteen months',physicalContext:'Reports weekend walks of increasing length.',psychologicalContext:'Confident managing symptoms independently.',socialContext:'Walks with a local group at weekends.',coordinator,preferences:'Keen to stay on the lightest possible treatment.'},
    plan:{text:'Maintain the current as-needed regimen and walking programme. Review whether the reported benefit is sustained at the next follow-up.',owner:clinician,followup:'2026-09-25',time:'10:00'},
    review:{direction:'Monitoring benefit',goalStatus:'Met',goalEvidence:'Goal was returning to weekend walks. The patient reports regular weekend walks, pain down from 6/10 to 3/10, and function up from 4/10 to 7/10.',decision:'Confirm the reported benefit is sustained and keep treatment at the lowest acceptable level.',monitoring:'Recorded plan: weekly self-reports with a follow-up review on September 25.',options:[{title:'Maintain the recorded plan',status:'Agreed',rationale:'Reported benefit, no side effects, and an attained activity goal.',considerations:'Reconfirm at follow-up. Sustained benefit is a patient report, not an efficacy measurement.'}]},
  },
  'TN-1031':{
    medication:{regimen:'60 mg orally once daily',started:'2026-07-28',regimenSince:'2026-08-11',adherence:'Taken as recorded'},
    clinicalContext:{allergyStatus:'None reported',medicalHistory:'Fibromyalgia with a four-year history of widespread pain and disrupted sleep.',priorTreatments:'A prior pregabalin trial was stopped by a previous clinician; the dose and stop reason were not recorded and remain unknown.',painLocation:'Widespread, with neck and shoulder involvement',painDuration:'About four years',physicalContext:'Reports completing full workdays with planned breaks.',psychologicalContext:'Reports better mood alongside improved sleep.',socialContext:'Works full time in an office role.',coordinator,preferences:'Wants to protect the recent gains in work capacity and sleep.'},
    plan:{text:'Continue the current regimen while the reported benefit and sleep improvement hold. Reconcile the unknown prior trial details with the previous clinician before considering any change.',owner:clinician,followup:'2026-09-24',time:'09:00'},
    review:{direction:'Monitoring benefit',goalStatus:'Met',goalEvidence:'Goal was completing a full workday with breaks. The patient reports achieving this, with pain down from 7/10 to 4/10 and sleep up from 4/10 to 7/10.',decision:'Sustain the current plan and reconcile the incomplete prior-treatment history.',monitoring:'Recorded plan: weekly self-reports and a follow-up review on September 24.',options:[{title:'Maintain the recorded plan with follow-up',status:'Agreed',rationale:'The patient reports helpful treatment and has met the recorded work goal.',considerations:'The prior trial record is incomplete. Reconciliation is outstanding and is not resolved by this assessment.'}]},
  },
  'TN-1055':{
    plan:{text:'Agreed at the goal-setting call to hold off on any pain medication until Michael has been through the plan and understands each step. Continue graded movement with the physiotherapy team and record confidence with bending and lifting. Reassess the medication question at the October review. Nothing is started by this plan.',owner:coordinator,followup:'2026-09-30',time:'09:00'},
    clinicalContext:{allergyStatus:'None reported',medicalHistory:'Persistent pain following abdominal surgery about nine months ago. Operative records and discharge medication are not available in this workspace.',priorTreatments:'Post-operative analgesia was stopped before enrolment. No current pain treatment is recorded.',painLocation:'Around the surgical site',painDuration:'About nine months',physicalContext:'Avoids bending and lifting; reports low confidence in movement.',psychologicalContext:'Anxious about causing damage by moving.',socialContext:'Returning to office work part time.',coordinator,preferences:'Wants to understand the plan before starting any medication.'},
  },
  'TN-1049':{
    plan:{text:'Book the treatment-response conversation that has not yet happened: whether the gabapentin is helping, how David is actually taking it, and what his walking goal should be. Until that is recorded there is no assessed response to act on. No change is made by this plan.',owner:coordinator,followup:'2026-09-23',time:'14:00'},
    medication:{regimen:'',started:'2026-07-28'},
    clinicalContext:{allergyStatus:'None reported',medicalHistory:'Peripheral neuropathy affecting both feet. Cause and duration are recorded inconsistently in the source notes and need clinician review.',priorTreatments:'Not recorded.',painLocation:'Both feet',painDuration:'Not recorded',physicalContext:'Walks the dog most days; distance not recorded.',psychologicalContext:'Not recorded.',socialContext:'Lives with family; owns a dog.',coordinator,preferences:'Not recorded. The treatment-response conversation has not taken place.'},
  },
};
function enrichBasePatients(w:Workspace){
  for(const [id,seed] of Object.entries(baseSeeds)){
    const p=patientOf(w,id);
    if(!p)continue;
    const medication=p.medications?.[0];
    if(medication&&seed.medication&&!medication.regimen&&!medication.started){
      Object.assign(medication,seed.medication,{reviewedAt:medReviewed,reviewedBy:actor});
      medication.history=[{name:medication.name,regimen:medication.regimen,status:medication.status,started:medication.started,indication:medication.indication,benefit:medication.benefit,tolerability:medication.tolerability,adherence:medication.adherence,effects:medication.effects,reportedAt:medication.reportedAt,date:medReviewed,author:actor,regimenSince:medication.regimenSince}];
    }
    if(seed.reconciledNone&&!p.medications?.length&&!p.medicationReconciliation)p.medicationReconciliation={date:medReviewed,author:actor,none:true};
    if(seed.clinicalContext&&!p.clinicalContext)p.clinicalContext=context(seed.clinicalContext,contextAt);
    if(seed.plan&&!p.carePlans?.length)p.carePlans=[{id:'showcase-plan-'+id,date:planAt,author:actor,...seed.plan}];
    if(seed.review&&!p.treatmentReview)p.treatmentReview=assessment(p.goal,reviewAt,seed.review);
  }
}

// ---------------------------------------------------------------------------
// 2. Care pathway execution: named owners and one completed activity with history.
// ---------------------------------------------------------------------------
const taskOwners:Record<string,string>={'task-1':clinician,'task-2':coordinator,'task-3':coordinator,'task-4':coordinator,'task-5':coordinator};
function enrichPathwayActivities(w:Workspace){
  for(const task of w.tasks){const owner=taskOwners[task.id];if(owner&&!task.owner)task.owner=owner;}
  if(!w.tasks.some(t=>t.id==='showcase-pathway-baseline')){
    const completed={id:'showcase-pathway-baseline',patientId:lucasId,title:'Baseline check-in review',date:'2026-09-01',time:'09:00',type:'Care coordination',owner:coordinator,done:false};
    w.tasks.push(completed);
    const task=w.tasks.find(t=>t.id==='showcase-pathway-baseline')!;
    retainTaskState(task,coordinator,'2026-09-01T09:20:00Z','Activity completed');
    task.done=true;
  }
}

// ---------------------------------------------------------------------------
const noMedId='TN-DEMO-03';
// 3. Digital Twin display customization, including one saved revision history.
// ---------------------------------------------------------------------------
const twinSeeds:{id:string;date:string;preferences:TwinPreferences;previous?:{date:string;preferences:TwinPreferences}}[]=[
  {id:emmaId,date:'2026-09-14T10:40:00Z',
   preferences:{measures:['pain','function'],primary:'function',showGoal:true,showMedications:true,showPlan:true,explanation:'We have put your desk-work tolerance first, because that is the goal you told us matters most. The pain line is still here underneath it. Sleep is hidden for now to keep this view simple; ask us any time and we will turn it back on.'},
   previous:{date:'2026-09-08T11:20:00Z',preferences:{measures:['pain','function','sleep'],primary:'pain',showGoal:true,showMedications:true,showPlan:true,explanation:'Starting view with all three measures while we learn what is most useful to you.'}}},
  {id:lucasId,date:'2026-09-14T10:45:00Z',
   preferences:{measures:['pain','function','sleep'],primary:'function',showGoal:true,showMedications:true,showPlan:true,explanation:'Your walking and daily activity line opens first, since that is the goal you are tracking. Pain and sleep are both available from the selector.'}},
  {id:noMedId,date:'2026-09-14T10:05:00Z',
   preferences:{measures:['sleep','pain'],primary:'sleep',showGoal:true,showMedications:false,showPlan:true,explanation:'Your sleep line opens first, because an unbroken night is the goal you set. The medication section is hidden in this view, since you are not taking one at the moment. Ask us any time and we will change what you see here.'}},
  {id:'TN-1042',date:'2026-09-09T09:45:00Z',
   preferences:{measures:['pain','sleep'],primary:'sleep',showGoal:true,showMedications:false,showPlan:true,explanation:'Sleep opens first because that is what you asked us to watch. Your medication list is hidden in this view; you can still see it with your care team.'}},
];
function seedTwinDisplays(w:Workspace){
  for(const seed of twinSeeds){
    const p=patientOf(w,seed.id);
    if(!p||p.twinPreferences)continue;
    const history=seed.previous?[{...seed.previous.preferences,measures:[...seed.previous.preferences.measures],id:'showcase-twin-'+seed.id+'-0',date:seed.previous.date,author:actor}]:[];
    p.twinPreferences={...seed.preferences,measures:[...seed.preferences.measures],id:'showcase-twin-'+seed.id+'-1',date:seed.date,author:actor,history} as SavedTwinPreferences;
  }
}

// ---------------------------------------------------------------------------
// 3b. Confirmed absence of current medication. TN-1055 keeps demonstrating an
// unreviewed empty list, so this case demonstrates the reconciled-none record
// and a treatment plan that deliberately contains no drug.
// ---------------------------------------------------------------------------
const noMedDates=['2026-08-04','2026-08-11','2026-08-18','2026-08-25','2026-09-01','2026-09-08','2026-09-14'];
const noMedPain=[6,6,6,5,5,5,5],noMedSleep=[2,3,3,4,4,5,5],noMedFunction=[4,4,5,5,5,6,6];
function seedNoMedicationCase(w:Workspace){
  if(patientOf(w,noMedId))return;
  const goal='Sleep through the night without waking because of foot pain';
  const p:Patient={
    id:noMedId,name:'Priya Raman',initials:'PR',age:63,...demoIdentity(noMedId),pronouns:'she / her',
    condition:'Chemotherapy-induced peripheral neuropathy',stage:'Care plan',status:'Monitoring',
    clinician:'Alex Morgan, NP',color:'#e8f0e4',enrolled:noMedDates[0],nextVisit:'2026-09-23',goal,baseline:6,
    pain:[...noMedPain],sleep:[...noMedSleep],function:[...noMedFunction],dates:[...noMedDates],
    adherence:0,completed:['intake','baseline','review'],pathway:'Chronic pain follow-up',
    medications:[],
    medicationReconciliation:{date:'2026-09-14T09:10:00Z',author:actor,none:true},
    carePlans:[{id:'showcase-nomed-plan',date:'2026-09-14T09:40:00Z',author:actor,
      text:'Agreed to continue without a pain medication for now, which is the patient’s stated preference. Keep the evening foot-care and sleep routine, and keep recording nightly waking. Review at the September 23 appointment and revisit a medication discussion with the prescriber if the nightly waking stops improving. No medication is started by this plan.',
      owner:coordinator,followup:'2026-09-23',time:'11:00'}],
    clinicalContext:context({allergyStatus:'None reported',
      medicalHistory:'Numbness and burning in both feet that began during chemotherapy, which finished about eight months ago. Oncology correspondence and treatment records sit with the cancer service and are not imported into this workspace.',
      priorTreatments:'No pain medication has been taken since chemotherapy finished. The patient uses an evening foot-care and sleep routine that she reports as helpful.',
      painLocation:'Both feet, worse at night',painDuration:'About eight months',
      physicalContext:'Reports waking once or twice most nights, down from three or four times at enrolment.',
      psychologicalContext:'Reluctant to start another medication after chemotherapy. Wants to see how far the routine can get her first.',
      socialContext:'Lives with her daughter, who helps with appointments.',coordinator,
      preferences:'Would rather not take a pain medication unless the nightly waking stops improving. Wants any medication discussion to involve the oncology team.'},'2026-09-14T09:20:00Z'),
    treatmentReview:assessment(goal,'2026-09-14T09:50:00Z',{
      direction:'Monitoring benefit',goalStatus:'Partly met',
      goalEvidence:'Goal is an unbroken night. The patient reports waking once or twice most nights, improved from three or four at enrolment, with sleep reported up from 2/10 to 5/10. The goal is not yet fully met.',
      decision:'Continue without a pain medication, as the patient prefers, while the recorded sleep improvement continues.',
      monitoring:'Recorded plan: weekly pain, function, and sleep reports with nightly waking noted, reviewed on September 23. No validated sleep instrument is implemented here.',
      options:[{title:'Continue the current routine with no medication',status:'Agreed',rationale:'The patient states a clear preference against starting a medication, and the recorded sleep and waking reports are improving without one.',considerations:'The absence of medication is a confirmed reconciled record, not a missing one. Reassess if the improvement stalls.'},
        {title:'Discuss a medication option with the prescriber and oncology',status:'Deferred',rationale:'Kept available if nightly waking stops improving or the patient changes her preference.',considerations:'No drug, dose, or ranking has been selected here. Any discussion needs the oncology records that are not imported into this workspace.'}]}),
    checkins:noMedDates.map((date,i)=>({id:noMedId+'-checkin-'+i,date,pain:noMedPain[i],sleep:noMedSleep[i],function:noMedFunction[i],note:i===noMedDates.length-1?'I woke once last night instead of twice. The evening routine seems to be helping.':'',source:'Patient self-report' as const})).reverse(),
    notes:[{id:'showcase-nomed-note',date:'2026-09-14T09:50:00Z',author:actor,type:'Visit summary',
      text:'No current pain medication. The empty medication list is a confirmed reconciliation, recorded with an author and date, and is deliberately different from a list that has never been reviewed. Reported sleep gains are patient reports and do not isolate the effect of the foot-care routine.'}],
  };
  w.patients.push(p);
  w.tasks.push({id:'medication-followup-'+noMedId,patientId:noMedId,title:'Treatment review',date:'2026-09-23',time:'11:00',type:'Phone call',owner:coordinator,done:false});
  w.messages.push({id:'showcase-nomed-message',patientId:noMedId,date:'2026-09-14T08:05:00Z',sender:'Priya Raman',direction:'in',
    text:'I woke once last night instead of twice. I would still rather not add a tablet if we can keep going like this.'});
}

// ---------------------------------------------------------------------------
// 4. Advisor: scripted exchanges that reuse the app's own reply rules, with
// the same care-team handoffs, confirmed check-ins, and messages an exchange creates.
// ---------------------------------------------------------------------------
function advisorExchange(w:Workspace,p:Patient,options:{
  id:string;date:string;text:string;intent:AdvisorTurn['intent'];
  checkin?:{pain:number;function:number;sleep:number};
  review?:{title:string;priority:Review['priority']};
}){
  const response=advisorReply(p,w,options.intent,options.text);
  const checkinId=options.checkin?options.id+'-checkin':undefined;
  if(options.checkin){
    p.checkins.unshift({id:checkinId!,date:options.date,...options.checkin,note:options.text,source:'Patient self-report'});
    p.pain.push(options.checkin.pain);p.function.push(options.checkin.function);p.sleep.push(options.checkin.sleep);
    p.dates.push(options.date.slice(0,10));
  }
  const reply=response.reply+(options.checkin?' Your confirmed pain, function, and sleep check-in has also been saved.':'');
  const reviewId=options.review?options.id+'-review':undefined;
  if(options.review){
    w.reviews.unshift({id:reviewId!,patientId:p.id,title:options.review.title,detail:response.summary+'\nConversation '+options.id+'. Review the saved exchange and reply to the patient.',priority:options.review.priority,source:ADVISOR_HANDOFF_SOURCE,status:'Open',created:options.date});
  }
  w.messages.push({id:options.id+'-in',patientId:p.id,date:options.date,text:options.text,sender:p.name,direction:'in'},{id:options.id+'-out',patientId:p.id,date:options.date,text:reply,sender:ADVISOR_SENDER,direction:'out'});
  w.advisorTurns=[...(w.advisorTurns??[]),{id:options.id,patientId:p.id,date:options.date,patientText:options.text,reply,summary:response.summary,intent:options.intent,reviewId,checkinId}];
  if(options.checkin||reviewId){p.recordReviewRequiredSince=options.date;p.status='Needs review';}
  return reviewId;
}

// ---------------------------------------------------------------------------
// 5. Saved engine runs. Each run is computed by the real engine against the record
// as it stands at that moment, so the stored fingerprint matches what the UI
// recomputes. Runs are newest-first, exactly as engine.run stores them.
// ---------------------------------------------------------------------------
function saveRun(w:Workspace,p:Patient,id:string,date:string,preferences:EnginePreferences){
  const output=buildEngineOutput(p,w,preferences);
  w.engineRuns=[{...output,id,date,actor},...(w.engineRuns??[])];
  return id;
}
function saveDecision(w:Workspace,p:Patient,options:{id:string;runId:string;candidateId:string;date:string;rationale:string;patientPlan:string;owner:string;followup:string}){
  const run=w.engineRuns!.find(r=>r.id===options.runId)!;
  const candidate=run.candidates.find(c=>c.id===options.candidateId)!;
  const planId=options.id+'-plan';
  w.engineDecisions=[{id:options.id,runId:run.id,patientId:p.id,candidateId:candidate.id,title:candidate.title,rationale:options.rationale,patientPlan:options.patientPlan,owner:options.owner,followup:options.followup,date:options.date,actor,planId},...(w.engineDecisions??[])];
  const oldPlan=p.carePlans[0];
  p.carePlans.unshift({id:planId,date:options.date,author:actor,text:options.patientPlan,owner:options.owner,followup:options.followup,time:'09:00'});
  p.notes.unshift({id:options.id+'-note',date:options.date,author:actor,type:'Engine review',text:`Engine review: ${candidate.title}\nClinician rationale: ${options.rationale}\nPatient plan: ${options.patientPlan}\nRun: ${run.id} · ${run.version} · record ${run.revision}. No prescription issued.`});
  const taskId='medication-followup-'+p.id,task=w.tasks.find(t=>t.id===taskId);
  if(task)retainTaskState(task,actor,options.date,'Follow-up updated after engine review',oldPlan?.id);
  const fields={id:taskId,patientId:p.id,title:'Treatment review',owner:options.owner,date:options.followup,time:'09:00',type:task?.type??'Care coordination',done:false,planId};
  if(task)Object.assign(task,fields);else w.tasks.push(fields);
  p.nextVisit=w.tasks.filter(t=>t.patientId===p.id&&!t.done&&t.date>=options.date.slice(0,10)&&t.type!=='Care coordination').sort((x,y)=>(x.date+x.time).localeCompare(y.date+y.time))[0]?.date??'';
}

// Emma: the full loop. A plan question, an unresolved concern handoff, a confirmed
// self-report, a run whose decision is recorded, and a current re-run ready to decide.
function seedFindingTreatmentCase(w:Workspace){
  const p=patientOf(w,emmaId);
  if(!p||w.engineRuns?.some(r=>r.patientId===emmaId)||!featureEnabled(w,'digitalTwin')||(!featureEnabled(w,'pst')&&!featureEnabled(w,'shadow')))return;
  advisorExchange(w,p,{id:'showcase-emma-advisor-1',date:'2026-09-13T08:05:00Z',intent:'plan',text:'What is my current care plan and next follow-up?'});
  advisorExchange(w,p,{id:'showcase-emma-advisor-2',date:'2026-09-14T08:10:00Z',intent:'concern',
    text:'The grogginess in the morning is still stopping me concentrating at my desk, and I would like someone to look at it before my visit.',
    review:{title:ADVISOR_NAME+': patient concern',priority:'Medium'}});
  advisorExchange(w,p,{id:'showcase-emma-advisor-3',date:'2026-09-15T08:20:00Z',intent:'progress',
    text:'I managed about fifteen minutes at my desk today before I needed a break, which is better than last week.',
    checkin:{pain:5,function:5,sleep:5}});
  const first=saveRun(w,p,'showcase-emma-run-1','2026-09-15T09:05:00Z',{relief:30,alertness:50,routine:20});
  saveDecision(w,p,{id:'showcase-emma-decision-1',runId:first,candidateId:'review-current',date:'2026-09-15T09:30:00Z',
    rationale:'The two rule sets ordered these strategies differently. PST put discussing an alternative first from the priority weights alone; Shadow put reviewing the current trial first because the record carries a reported morning effect and an unresolved patient concern. I am following the Shadow ordering for this review: the reported grogginess and the incomplete allergy and outside-record information need assessment before any alternative is worth discussing. No medication change is made by this decision.',
    patientPlan:'We will keep your current medication unchanged for now and use your September visit to look closely at the morning grogginess you reported. Please keep noting how long you manage at your desk and how you feel in the mornings. If the grogginess gets worse before then, send a message and we will bring the visit forward.',
    owner:clinician,followup:'2026-09-24'});
  saveRun(w,p,'showcase-emma-run-2','2026-09-15T09:35:00Z',{relief:30,alertness:50,routine:20});
}

// Lucas: an answered question. The handoff is acknowledged and resolved with
// attribution, then a new clinician assessment clears the pending review flag.
function seedImprovingCase(w:Workspace){
  const p=patientOf(w,lucasId);
  if(!p||w.engineRuns?.some(r=>r.patientId===lucasId))return;
  advisorExchange(w,p,{id:'showcase-lucas-advisor-1',date:'2026-09-13T08:30:00Z',intent:'plan',text:'What is my current care plan and next follow-up?'});
  saveRun(w,p,'showcase-lucas-run-1','2026-09-13T09:00:00Z',{relief:60,alertness:20,routine:20});
  const reviewId=advisorExchange(w,p,{id:'showcase-lucas-advisor-2',date:'2026-09-14T08:10:00Z',intent:'question',
    text:'I am away next week. Should I keep taking the same dose while I am travelling?',
    review:{title:ADVISOR_NAME+': patient question',priority:'Routine'}});
  const review=w.reviews.find(r=>r.id===reviewId);
  if(review){
    retainReviewTransition(review,'Acknowledged','Picked up by the care coordinator. The advisor does not answer medication questions, so this needs a clinician reply.',coordinator,'2026-09-14T09:05:00Z');
    retainReviewTransition(review,'Resolved','Clinician replied to the patient in the care-team conversation. No change to the recorded regimen was made and the travel dates were noted for the September 22 review.',clinician,'2026-09-14T09:30:00Z');
  }
  w.messages.push({id:'showcase-lucas-reply',patientId:p.id,date:'2026-09-14T09:32:00Z',sender:clinician,direction:'out',
    text:'Thanks for asking before you travel, Lucas. Your recorded plan is unchanged, so take your medication exactly as it is written in your plan while you are away. I have noted your travel dates so we can review them together on September 22. If anything changes while you are away, message us here.'});
  delete p.recordReviewRequiredSince;
  p.status='On track';
  p.treatmentReview=assessment(p.goal,'2026-09-14T10:00:00Z',{
    direction:'Monitoring benefit',goalStatus:'Met',
    goalEvidence:'Goal is a 20-minute dog walk on at least five days a week. The patient reports meeting this, with pain reported down from 8/10 at intake to 3/10 and function up from 2/10 to 8/10. Residual tingling after longer walks continues.',
    decision:'Reported benefit and tolerability remain acceptable to the patient. Keep the recorded plan and review after the patient returns from travelling.',
    monitoring:'Recorded plan: weekly pain, function, sleep, side-effect, and walking reports, reviewed on September 22 together with the travel period. The patient can request an earlier review. Automated monitoring is not connected.',
    options:[{title:'Maintain the recorded plan through the travel period',status:'Agreed',rationale:'The patient reports helpful treatment, no current side effects, and a sustained walking goal. The travel question was answered without changing the regimen.',considerations:'Reconfirm use and tolerability after the patient returns. Outside-record reconciliation with primary care remains outstanding and is not resolved by this assessment.'},{title:'Revisit the treatment strategy',status:'Deferred',rationale:'Kept available if benefit falls, side effects appear, or the patient’s goals change.',considerations:'No additional medication has been selected or ranked. Review any new information with the prescriber.'}]});
  saveRun(w,p,'showcase-lucas-run-2','2026-09-14T10:10:00Z',{relief:40,alertness:40,routine:20});
}

// Elena already has an unresolved advisor handoff in the seed. Give it the
// conversation it refers to, so the queue item and the transcript match.
function seedHandoffConversation(w:Workspace){
  const p=patientOf(w,'TN-1051');
  const review=w.reviews.find(r=>r.id==='rev-3');
  if(!p||!review||w.advisorTurns?.some(t=>t.patientId===p.id))return;
  const text='I completed this week’s activities. Can we review what comes next?';
  const response=advisorReply(p,w,'question',text);
  w.advisorTurns=[...(w.advisorTurns??[]),{id:'showcase-elena-advisor-1',patientId:p.id,date:review.created,patientText:text,reply:response.reply,summary:response.summary,intent:'question',reviewId:review.id}];
  w.messages.push({id:'showcase-elena-advisor-reply',patientId:p.id,date:'2026-09-08T07:51:00Z',text:response.reply,sender:ADVISOR_SENDER,direction:'out'});
}

// ---------------------------------------------------------------------------
// 6. Saved doctor dashboards and the patient-overview section arrangement.
// ---------------------------------------------------------------------------
const dashboardSeeds:{id:string;name:string;date:string;layout:Partial<DashboardProfile['layout']>}[]=[
  {id:'showcase-dashboard-round',name:'Morning round · needs review first',date:'2026-09-09T08:05:00Z',
   layout:{filter:'Needs review',sort:'priority',density:'comfortable'}},
  {id:'showcase-dashboard-medication',name:'Medication response clinic',date:'2026-09-09T08:20:00Z',
   layout:{columns:['medications','plan'],filter:'Side effects reported',sort:'name',density:'compact',showEngines:false,showEngineIntro:false,
     reviewSections:['medications','outcomes','evidence','notes']}},
  {id:'showcase-dashboard-engines',name:'Engine review · Dr. Chen',date:'2026-09-14T11:00:00Z',
   layout:{columns:['outcomes','plan'],filter:'Benefit reported',sort:'visit',clinician:clinician,
     reviewSections:['twin','pst','shadow','advisor','medications','outcomes','pathway','evidence','notes']}},
];
function seedDashboardProfiles(w:Workspace){
  if(w.dashboardProfiles?.length)return;
  w.dashboardProfiles=dashboardSeeds.map(seed=>({id:seed.id,name:seed.name,layout:{...defaultDashboardLayout(),...seed.layout},revision:seed.id+'-r1',updatedAt:seed.date,updatedBy:actor}));
}

// ---------------------------------------------------------------------------
// 7. Regulatory pathway: a saved planning profile and its configuration snapshot.
// These are screening assumptions for review, never a determination.
// ---------------------------------------------------------------------------
function showcasePlanning():PlanningProfile{
  return {...defaultPlanning(),
    intendedUse:'Chronic-pain treatment workflow reviewed against records held in this workspace. A clinician reviews recorded medication response, patient-reported outcomes, and labelled record-based simulations, then documents their own decision and the plan the patient sees. Not for use with real patient data and not offered for clinical care.',
    users:'Both',decisionRole:'Support clinical judgment',timeCritical:'No',
    criteria:{permissibleInputs:'Yes',medicalInformation:'Yes',hcpSupport:'Yes',independentBasis:'Yes'},
    planned:{predictiveTwin:true,treatmentRecommendations:true,patientMedicalAdvice:false,timeCriticalAlerts:false,automatedTreatmentActions:false,signalOrImageAnalysis:false},
    plannedModelChanges:'Yes',owner:'Dr. Maya Chen',
    rationale:'Recorded as a screening assumption for review, not as evidence of compliance or a regulatory conclusion. Every displayed output currently comes from transparent record rules documented in lib/engine-demo.ts, each finding cites the saved record that produced it, and the clinician retains the decision. The two proposed future capabilities selected here, a predictive Digital Twin and generated or ranked treatment options, would change the basis a clinician can independently review, so both need a function-by-function assessment and clinical validation before release. The patient-facing companion is declared because the '+ADVISOR_NAME+' surface reaches patients, even though it uses scripted replies today and gives no treatment advice. No function-specific determination, device classification, exclusion, or clearance pathway has been established.'};
}
function seedPlanningSnapshot(w:Workspace){
  if(w.planning||w.configurationHistory?.length)return;
  const planning=showcasePlanning();
  w.planning=planning;
  const snapshot=configurationSnapshot(w.features,planning,actor,'2026-09-14T11:30:00Z','Saved feature configuration and FDA planning assumptions');
  w.configurationHistory=[{...snapshot,id:'showcase-configuration-1'}];
}

// ---------------------------------------------------------------------------
// 8. Audit history for the records seeded above, newest first as applyAction stores it.
// ---------------------------------------------------------------------------
const auditSeeds:{id:string;date:string;action:string;patientId?:string}[]=[
  {id:'showcase-audit-22',date:'2026-09-15T09:00:00Z',action:'Ran Digital Twin / PST / Shadow engines',patientId:noMedId},
  {id:'showcase-audit-21',date:'2026-09-15T08:10:00Z',action:ADVISOR_EXCHANGE_LABEL,patientId:noMedId},
  {id:'showcase-audit-20',date:'2026-09-14T10:05:00Z',action:'Customized patient Digital Twin display',patientId:noMedId},
  {id:'showcase-audit-19',date:'2026-09-14T09:15:00Z',action:'Ran Digital Twin / PST / Shadow engines',patientId:'TN-1042'},
  {id:'showcase-audit-18',date:'2026-09-14T07:45:00Z',action:ADVISOR_EXCHANGE_LABEL,patientId:'TN-1042'},
  {id:'showcase-audit-17',date:'2026-09-14T09:10:00Z',action:'Recorded medication reconciliation: no current medication',patientId:noMedId},
  {id:'showcase-audit-16',date:'2026-09-15T09:35:00Z',action:'Ran Digital Twin / PST / Shadow engines',patientId:emmaId},
  {id:'showcase-audit-15',date:'2026-09-15T09:30:00Z',action:'Saved clinician decision against engine run showcase-emma-run-1',patientId:emmaId},
  {id:'showcase-audit-14',date:'2026-09-15T09:05:00Z',action:'Ran Digital Twin / PST / Shadow engines',patientId:emmaId},
  {id:'showcase-audit-13',date:'2026-09-15T08:20:00Z',action:ADVISOR_EXCHANGE_LABEL+' with confirmed check-in',patientId:emmaId},
  {id:'showcase-audit-12',date:'2026-09-14T11:30:00Z',action:'Saved feature configuration and FDA planning: showcase-configuration-1'},
  {id:'showcase-audit-11',date:'2026-09-14T11:00:00Z',action:'Saved doctor dashboard: Engine review · Dr. Chen'},
  {id:'showcase-audit-10',date:'2026-09-14T10:45:00Z',action:'Customized patient Digital Twin display',patientId:lucasId},
  {id:'showcase-audit-09',date:'2026-09-14T10:40:00Z',action:'Customized patient Digital Twin display',patientId:emmaId},
  {id:'showcase-audit-08',date:'2026-09-14T10:10:00Z',action:'Ran Digital Twin / PST / Shadow engines',patientId:lucasId},
  {id:'showcase-audit-07',date:'2026-09-14T10:00:00Z',action:'Recorded clinician treatment assessment',patientId:lucasId},
  {id:'showcase-audit-06',date:'2026-09-14T09:30:00Z',action:'Resolved review: '+ADVISOR_NAME+': patient question',patientId:lucasId},
  {id:'showcase-audit-05',date:'2026-09-14T08:10:00Z',action:ADVISOR_EXCHANGE_LABEL+' and care-team handoff',patientId:emmaId},
  {id:'showcase-audit-04',date:'2026-09-13T09:00:00Z',action:'Ran Digital Twin / PST / Shadow engines',patientId:lucasId},
  {id:'showcase-audit-03',date:'2026-09-13T08:05:00Z',action:ADVISOR_EXCHANGE_LABEL,patientId:emmaId},
  {id:'showcase-audit-02',date:'2026-09-09T10:00:00Z',action:'Recorded clinician treatment assessment',patientId:'TN-1038'},
  {id:'showcase-audit-01',date:'2026-09-09T09:00:00Z',action:'Reviewed recorded medication response',patientId:'TN-1042'},
];
function seedAuditTrail(w:Workspace){
  if(w.audit.some(a=>a.id.startsWith('showcase-audit-')))return;
  w.audit=[...auditSeeds.map(a=>({...a,actor})),...w.audit];
}

// Sarah Mitchell is the default directory patient a demo lands on. She had a
// recorded check-in concern but no advisor transcript and no saved run, so the
// advisor card and the run history read empty on her record.
function seedDirectoryCase(w:Workspace){
  const p=patientOf(w,'TN-1042');
  if(!p||w.engineRuns?.some(r=>r.patientId===p.id))return;
  advisorExchange(w,p,{id:'showcase-sarah-advisor-1',date:'2026-09-13T07:40:00Z',intent:'plan',text:'What is my current care plan and next follow-up?'});
  advisorExchange(w,p,{id:'showcase-sarah-advisor-2',date:'2026-09-14T07:45:00Z',intent:'progress',
    text:'I managed about twelve minutes of walking before I needed to rest today, and the evenings are still the hardest part.'});
  saveRun(w,p,'showcase-sarah-run-1','2026-09-14T09:15:00Z',{relief:35,alertness:35,routine:30});
}

// Priya Raman was added for the confirmed-absence record and had no engine run,
// no advisor transcript and no display settings, which left the engine board,
// the output trace and the patient companion empty for her.
function seedNoMedicationEngagement(w:Workspace){
  const p=patientOf(w,noMedId);
  if(!p||w.engineRuns?.some(r=>r.patientId===noMedId))return;
  advisorExchange(w,p,{id:'showcase-priya-advisor-1',date:'2026-09-14T08:15:00Z',intent:'plan',text:'What is my current care plan and next follow-up?'});
  advisorExchange(w,p,{id:'showcase-priya-advisor-2',date:'2026-09-15T08:10:00Z',intent:'progress',
    text:'I woke once last night instead of twice. I would still rather not add a tablet if we can keep going like this.'});
  saveRun(w,p,'showcase-priya-run-1','2026-09-15T09:00:00Z',{relief:25,alertness:25,routine:50});
}

// Three directory patients had no conversation and no scheduled visit at all,
// which read as "No messages yet" and "Next visit: Not scheduled".
const directoryConversations:{id:string;patient:string;date:string;inbound:string;reply:string;replyFrom:string;visit:{id:string;title:string;date:string;time:string;type:string;owner:string}}[]=[
  {id:'showcase-olivia',patient:'TN-1034',date:'2026-09-12T08:05:00Z',
   inbound:'I did both of my weekend walks and the second one felt easier than it has in months.',
   reply:'That is good to hear, Olivia. I have recorded it against your walking goal and we will review it at your next check-in.',replyFrom:coordinator,
   visit:{id:'showcase-visit-TN-1034',title:'Progress review',date:'2026-09-25',time:'10:00',type:'Phone call',owner:clinician}},
  {id:'showcase-grace',patient:'TN-1031',date:'2026-09-12T17:30:00Z',
   inbound:'I got through a full workday with two planned breaks this week, and I slept better on the nights after.',
   reply:'Thank you, Grace. I have added this to your record ahead of the September 24 review so we can look at the sleep change together.',replyFrom:clinician,
   visit:{id:'showcase-visit-TN-1031',title:'Treatment review',date:'2026-09-24',time:'09:00',type:'Video visit',owner:clinician}},
  {id:'showcase-michael',patient:'TN-1055',date:'2026-09-09T10:40:00Z',
   inbound:'I have not started any tablets since the operation. Before I change anything I would like to understand what the plan actually is.',
   reply:'That is exactly what the call on September 10 is for, Michael. Nothing is being started before we agree it together, and I have recorded that you want to understand the plan first.',replyFrom:coordinator,
   visit:{id:'showcase-visit-TN-1055',title:'Goal setting call',date:'2026-09-19',time:'09:00',type:'Phone call',owner:coordinator}},
  {id:'showcase-david',patient:'TN-1049',date:'2026-09-11T09:20:00Z',
   inbound:'I am still walking the dog most days. Nobody has asked me yet whether the tablets are actually doing anything.',
   reply:'You are right that we have not recorded that conversation yet, David. I have booked a call so we can go through whether your medication is helping and how you are taking it.',replyFrom:coordinator,
   visit:{id:'showcase-visit-TN-1049',title:'Treatment response review',date:'2026-09-23',time:'14:00',type:'Phone call',owner:coordinator}},
];
function seedDirectoryEngagement(w:Workspace){
  for(const entry of directoryConversations){
    const p=patientOf(w,entry.patient);
    if(!p)continue;
    if(!w.messages.some(m=>m.id===entry.id+'-in')){
      w.messages.push({id:entry.id+'-in',patientId:p.id,date:entry.date,text:entry.inbound,sender:p.name,direction:'in'},
        {id:entry.id+'-out',patientId:p.id,date:entry.date.slice(0,11)+'12:00:00Z',text:entry.reply,sender:entry.replyFrom,direction:'out'});
    }
    if(!w.tasks.some(t=>t.id===entry.visit.id)){
      w.tasks.push({...entry.visit,patientId:p.id,done:false});
      if(!p.nextVisit)p.nextVisit=entry.visit.date;
    }
  }
  // No review was left in the Acknowledged state, so that queue filter was empty.
  const intake=w.reviews.find(r=>r.id==='rev-4');
  if(intake&&intake.status==='Open'&&!intake.history?.length){
    retainReviewTransition(intake,'Acknowledged','Care coordinator has the intake pack and has booked the goal-setting call. Held open until the clinician confirms the recorded goals with Michael.',coordinator,'2026-09-09T11:15:00Z');
  }
}

// The care overview renders an advisor card per patient, so a directory
// patient with no transcript reads as an empty panel on the landing screen.
// TN-1047 is deliberately left without one: it is the missing-record example.
const directoryExchanges:{id:string;patient:string;turns:{id:string;date:string;intent:'progress'|'plan';text:string}[]}[]=[
  {id:'james',patient:'TN-1038',turns:[
    {id:'showcase-james-advisor-1',date:'2026-09-12T09:15:00Z',intent:'plan',text:'What is my current care plan and next follow-up?'},
    {id:'showcase-james-advisor-2',date:'2026-09-14T16:40:00Z',intent:'progress',text:'Two gardening sessions this week and the back held up both times. The tablets are only occasional now.'}]},
  {id:'olivia',patient:'TN-1034',turns:[
    {id:'showcase-olivia-advisor-1',date:'2026-09-12T08:20:00Z',intent:'progress',text:'Did both weekend walks and the second one felt easier than it has in months.'}]},
  {id:'grace',patient:'TN-1031',turns:[
    {id:'showcase-grace-advisor-1',date:'2026-09-12T17:45:00Z',intent:'progress',text:'Got through a full workday with two planned breaks, and I slept better on the nights after.'},
    {id:'showcase-grace-advisor-2',date:'2026-09-15T08:30:00Z',intent:'plan',text:'What is my current care plan and next follow-up?'}]},
  {id:'david',patient:'TN-1049',turns:[
    {id:'showcase-david-advisor-1',date:'2026-09-11T09:35:00Z',intent:'progress',text:'Still walking the dog most days. I honestly could not tell you whether the tablets are doing anything.'}]},
  {id:'michael',patient:'TN-1055',turns:[
    {id:'showcase-michael-advisor-1',date:'2026-09-10T10:05:00Z',intent:'plan',text:'What is my current care plan and next follow-up?'}]},
];
function seedDirectoryExchanges(w:Workspace){
  for(const entry of directoryExchanges){
    const p=patientOf(w,entry.patient);
    if(!p||w.advisorTurns?.some(t=>t.patientId===p.id))continue;
    // Neither intent creates a review or a check-in, so a directory patient's
    // status is not disturbed by giving them a transcript.
    for(const turn of entry.turns)advisorExchange(w,p,{id:turn.id,date:turn.date,intent:turn.intent,text:turn.text});
  }
}

// Append the showcase records once. Existing patient data and user edits are never
// replaced: every step checks for the record it would create before adding it.
export function ensureShowcaseData(w:Workspace,loadedBy=actor,loadedAt=new Date().toISOString()){
  if((w.showcaseVersion??0)>=showcaseVersion)return w;
  enrichBasePatients(w);
  enrichPathwayActivities(w);
  seedNoMedicationCase(w);
  seedTwinDisplays(w);
  seedHandoffConversation(w);
  seedDirectoryEngagement(w);
  seedDirectoryExchanges(w);
  seedFindingTreatmentCase(w);
  seedImprovingCase(w);
  seedDirectoryCase(w);
  seedNoMedicationEngagement(w);
  seedDashboardProfiles(w);
  seedPlanningSnapshot(w);
  seedAuditTrail(w);
  Object.assign(w,ensureWorkflowShowcase(w,loadedBy,loadedAt));
  Object.assign(w,ensureStoryCompletion(w,loadedBy,loadedAt));
  w.showcaseVersion=showcaseVersion;
  return w;
}
