import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {runScenarios} from './fixtures/encounters-scenarios.mjs';

const bundle=await build({
  stdin:{
    contents:"export * from './lib/clinical-flows/encounters'; export * from './components/theranetrix/clinical-flows/encounters';",
    resolveDir:process.cwd(),
  },
  bundle:true,
  platform:'node',
  format:'cjs',
  packages:'external',
  jsx:'automatic',
  loader:{'.css':'empty','.module.css':'empty'},
  write:false,
});
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);

const {EncountersPanel,actionSchema,getSummary,getSourceComparison,reviewEvidenceRevision,initialState,preserveDateTimeLocalOffset,reduce,toDateTimeLocalValue,validateState}=mod.exports;

const patients=[
  {id:'patient-1',name:'Alex North'},
  {id:'patient-2',name:'Mina Vale'},
];

const context=now=>({actor:'Clinician A',now,patients,features:{},closureDependencies:[]});
const act=(state,action,now='2026-09-17T12:00:00Z',extra={})=>reduce(state,actionSchema.parse(action),{...context(now),...extra});

const assessmentCommand=(overrides={})=>({type:'encounters.assessment.save',requestId:crypto.randomUUID(),patientId:'patient-1',encounterId:'review-encounter',presentingProblem:'Walking review.',painDistributionPhenotype:'',timeline:'',relevantExamination:'',comorbidContext:'',psychologicalContext:'',socialContext:'',workingAssessment:'Stable function.',alternatives:[],supportingFindings:['Stable walking log'],refutingFindings:[],uncertainty:'Review progress.',furtherWorkup:'',route:'continue-local',deferReason:'',...overrides});
const signoffCommand=(state,overrides={})=>({type:'encounters.signoff.saveDraft',requestId:crypto.randomUUID(),patientId:'patient-1',encounterId:'review-encounter',assessmentRecordId:state.assessments[0].id,rationale:'Reviewed progress with the patient.',patientFacingPlan:'Continue the walking plan.',disposition:{selected:[],rejected:[],deferred:[],noChange:true},owner:'Clinician A',followUp:{date:'2026-09-22',time:'10:00',timezone:'UTC'},pendingWork:[],teachBack:'Patient described the plan.',...overrides});

test('domain request receipts remain bound to the verified actor after shared receipts expire',()=>{
  const command=assessmentCommand();
  const state=act(initialState(),command);
  assert.deepEqual(act(state,command),state);
  assert.throws(()=>reduce(state,command,{...context('2026-09-17T12:00:00Z'),actor:'Different clinician'}),/another actor/);
  const legacy=structuredClone(state);
  delete legacy.receipts[0].actor;
  assert.throws(()=>act(legacy,command),/predates verified actor binding/);
});

test('all six encounter acceptance scenarios exercise normal lifecycles and rejected commands',async()=>{
  let state=initialState();
  const recorded=[];
  await runScenarios({patientId:'patient-1',now:'2026-09-17T12:00:00Z',state:()=>state,apply:async command=>(state=act(state,command)),expectRejected:async command=>{const before=structuredClone(state);assert.throws(()=>act(state,command));assert.deepEqual(state,before);},record:(id,status)=>recorded.push([id,status])});
  assert.deepEqual(recorded,[['J01','passed'],['J02','passed'],['J08','passed'],['J11','passed'],['J14','passed'],['J17','passed']]);
  assert.equal(state.signoffs.filter(item=>item.status==='signed').length,2);
});

test('stale assessment evidence, changed observations, and cross-patient records cannot be signed',()=>{
  let state=act(initialState(),assessmentCommand());
  state=act(state,signoffCommand(state));
  const signoff=state.signoffs[0];
  state=act(state,{type:'encounters.signoff.review',requestId:'review-stale',patientId:'patient-1',encounterId:'review-encounter',id:signoff.id,expectedVersion:signoff.version,reason:'Reviewed.'});
  state=act(state,assessmentCommand({expectedVersion:state.assessments[0].version,workingAssessment:'Additional finding needs review.'}));
  const signing={type:'encounters.signoff.sign',requestId:'sign-stale',patientId:'patient-1',encounterId:'review-encounter',id:signoff.id,expectedVersion:state.signoffs[0].version,reason:'Attempt signature.'};
  assert.throws(()=>act(state,signing),/changed.*latest encounter draft/);
  assert.throws(()=>act(state,{...signing,patientId:'patient-2'}),/not found/);
  assert.throws(()=>act(state,signoffCommand(state,{patientId:'patient-2',encounterId:'foreign-encounter'})),/not found/);
  state=act(state,signoffCommand(state,{expectedVersion:state.signoffs[0].version}));
  state=act(state,{type:'encounters.observations.save',requestId:'new-observations',patientId:'patient-1',encounterId:'review-encounter',instrument:'local-0-10',submissionStatus:'confirmed',entries:[{metric:'pain',status:'zero',value:0,source:'Patient',recordedAt:'2026-09-17T11:59:00Z'}]});
  assert.throws(()=>act(state,{type:'encounters.signoff.review',requestId:'review-stale-observations',patientId:'patient-1',encounterId:'review-encounter',id:signoff.id,expectedVersion:state.signoffs[0].version,reason:'Review old draft.'}),/changed.*latest encounter draft/);
});

test('observation timestamps compare complete instants and confirmed corrections require a reason',()=>{
  const observation={type:'encounters.observations.save',requestId:'obs-time',patientId:'patient-1',encounterId:'timing',instrument:'local-0-10',submissionStatus:'confirmed',entries:[{metric:'pain',status:'zero',value:0,source:'Patient',recordedAt:'2026-09-17T12:00:01Z'}]};
  assert.throws(()=>act(initialState(),observation),/future/);
  assert.equal(actionSchema.safeParse({...observation,entries:[{...observation.entries[0],recordedAt:'2026-09-17'}]}).success,false);
  let state=act(initialState(),{...observation,entries:[{...observation.entries[0],recordedAt:'2026-09-17T13:00:00+01:00'}]});
  assert.equal(state.observations[0].currentEntries[0].value,0);
  assert.throws(()=>act(state,{...observation,requestId:'silent-overwrite',expectedVersion:1,entries:[{...observation.entries[0],recordedAt:'2026-09-17T12:00:00Z',status:'answered',value:6}]}),/correction reason/);
  state=act(state,{...observation,requestId:'explained-correction',expectedVersion:1,correctionReason:'Patient clarified the number.',entries:[{...observation.entries[0],recordedAt:'2026-09-17T12:00:00Z',status:'answered',value:6}]});
  assert.equal(state.observations[0].entries[0].value,0);
  assert.equal(state.observations[0].entries.length,2);
  assert.equal(state.observations[0].history.at(-1).reason,'Patient clarified the number.');
});

test('signed evidence snapshots survive later assessment changes and state rejects altered signatures',()=>{
  let state=act(initialState(),assessmentCommand());
  state=act(state,signoffCommand(state));
  state=act(state,{type:'encounters.signoff.review',requestId:'snapshot-review',patientId:'patient-1',encounterId:'review-encounter',id:state.signoffs[0].id,expectedVersion:state.signoffs[0].version,reason:'Review.'});
  state=act(state,{type:'encounters.signoff.sign',requestId:'snapshot-sign',patientId:'patient-1',encounterId:'review-encounter',id:state.signoffs[0].id,expectedVersion:state.signoffs[0].version,reason:'Sign.'});
  const original=structuredClone(state.signoffs[0]);
  state=act(state,assessmentCommand({expectedVersion:state.assessments[0].version,workingAssessment:'New assessment information.'}));
  assert.deepEqual(state.signoffs[0],original);
  assert.equal(state.signoffs[0].signedSnapshot.assessmentSnapshot.workingAssessment,'Stable function.');
  const forged=structuredClone(state);
  forged.signoffs[0].patientFacingPlan='Unreviewed treatment plan.';
  assert.throws(()=>validateState(forged),/immutable snapshot/);
  assert.throws(()=>validateState({...state,assessments:[...state.assessments,state.assessments[0]]}),/Duplicate/);
});

test('enrollment, urgent routes, closure review, and timezone values enforce prerequisites',()=>{
  const enrollment={type:'encounters.intake.save',requestId:'bad-enrollment',patientId:'patient-1',encounterId:'readiness',sourceHistory:'History',medicationsReconciliationReference:'',goals:[],consentReadiness:'declined',accessReadiness:'ready',unansweredFields:[],declinedFields:[],coordinatorClarification:'',baselineReviewed:true,enrollmentDecision:'enroll',syntheticEvaluation:true,finalDiagnosis:''};
  assert.throws(()=>act(initialState(),enrollment),/Consent and access/);
  assert.throws(()=>act(initialState(),{...enrollment,consentReadiness:'ready',enrollmentDecision:'pending',unansweredFields:['transport'],declinedFields:['Transport']}),/both declined and unanswered/);
  assert.throws(()=>act(initialState(),assessmentCommand({route:'urgent-review',deferReason:''})),/reason/);
  const state=act(initialState(),assessmentCommand());
  assert.equal(actionSchema.safeParse(signoffCommand(state,{followUp:{date:'2026-09-22',time:'10:00',timezone:'Not/AZone'}})).success,false);
  const episode={type:'encounters.episode.save',requestId:'unreviewed-episode',patientId:'patient-1',encounterId:'episode-close',goalEvidence:'Goal evidence',observedOutcomes:'Outcomes reviewed',priorInterventions:'',ongoingInterventions:'',patientExperience:'Patient agrees',remainingConcerns:[],decision:'closure',pendingWorkDisposition:'None outstanding',pendingWorkOwner:'Clinician A',status:'draft'};
  let episodeState=act(initialState(),episode);
  const close=()=>({type:'encounters.episode.close',requestId:crypto.randomUUID(),patientId:'patient-1',encounterId:'episode-close',id:episodeState.episodes[0].id,expectedVersion:episodeState.episodes[0].version,reason:'Close'});
  assert.throws(()=>act(episodeState,close()),/Review the episode/);
  episodeState=act(episodeState,{...episode,requestId:'reviewed-episode',expectedVersion:1,status:'reviewed'});
  episodeState=act(episodeState,close());
  assert.throws(()=>act(episodeState,{...episode,requestId:'reopen-closed',expectedVersion:episodeState.episodes[0].version}),/closed/);
});

test('preparation saves drafts, preserves idempotency, rejects unknown keys, and reopens review for last-minute information',()=>{
  assert.equal(actionSchema.safeParse({type:'encounters.preparation.save',requestId:'prep-0',patientId:'patient-1',encounterId:'enc-1',reasonForVisit:'Review progress',changesSinceLastReviewedEncounter:'',sourceDates:['2026-09-17'],preparationOwner:'RN A',openQuestions:[],missingInputs:[],patientGoal:'Walk to the mailbox',status:'draft',unexpected:true}).success,false);
  let state=initialState();
  state=act(state,{type:'encounters.preparation.save',requestId:'prep-1',patientId:'patient-1',encounterId:'enc-1',reasonForVisit:'Review progress and function.',changesSinceLastReviewedEncounter:'Increased morning stiffness.',sourceDates:['2026-09-15'],preparationOwner:'RN A',openQuestions:['Is the stiffness improving by afternoon?'],missingInputs:['Updated home exercise adherence'],patientGoal:'Walk to the mailbox',status:'draft'});
  assert.equal(state.preparations[0].status,'draft');
  const prepared=act(state,{type:'encounters.preparation.save',requestId:'prep-2',patientId:'patient-1',encounterId:'enc-1',expectedVersion:state.preparations[0].version,reasonForVisit:'Review progress and function.',changesSinceLastReviewedEncounter:'Increased morning stiffness.',sourceDates:['2026-09-15','2026-09-16'],preparationOwner:'RN A',openQuestions:['Is the stiffness improving by afternoon?'],missingInputs:[],patientGoal:'Walk to the mailbox',status:'clinician-reviewed'});
  assert.equal(prepared.preparations[0].status,'clinician-reviewed');
  const repeat=act(prepared,{type:'encounters.preparation.save',requestId:'prep-2',patientId:'patient-1',encounterId:'enc-1',expectedVersion:state.preparations[0].version,reasonForVisit:'Review progress and function.',changesSinceLastReviewedEncounter:'Increased morning stiffness.',sourceDates:['2026-09-15','2026-09-16'],preparationOwner:'RN A',openQuestions:['Is the stiffness improving by afternoon?'],missingInputs:[],patientGoal:'Walk to the mailbox',status:'clinician-reviewed'});
  assert.deepEqual(repeat,prepared);
  assert.throws(()=>act(prepared,{type:'encounters.preparation.save',requestId:'prep-2',patientId:'patient-1',encounterId:'enc-1',expectedVersion:state.preparations[0].version,reasonForVisit:'Different payload',changesSinceLastReviewedEncounter:'Increased morning stiffness.',sourceDates:['2026-09-15','2026-09-16'],preparationOwner:'RN A',openQuestions:['Is the stiffness improving by afternoon?'],missingInputs:[],patientGoal:'Walk to the mailbox',status:'clinician-reviewed'}),/different payload/);
  const rereview=act(prepared,{type:'encounters.preparation.save',requestId:'prep-3',patientId:'patient-1',encounterId:'enc-1',expectedVersion:prepared.preparations[0].version,reasonForVisit:'Review progress and function.',changesSinceLastReviewedEncounter:'Increased morning stiffness.',sourceDates:['2026-09-15','2026-09-16'],preparationOwner:'RN A',openQuestions:['Is the stiffness improving by afternoon?'],missingInputs:[],patientGoal:'Walk to the mailbox',status:'clinician-reviewed',newInformation:'Patient called about a fall this morning.'},'2026-09-17T12:15:00Z');
  assert.equal(rereview.preparations[0].status,'prepared');
  assert.equal(rereview.preparations[0].reviewNeeded,true);
  assert.throws(()=>act(rereview,{type:'encounters.preparation.save',requestId:'prep-4',patientId:'patient-1',encounterId:'enc-1',expectedVersion:1,reasonForVisit:'Review progress and function.',changesSinceLastReviewedEncounter:'Increased morning stiffness.',sourceDates:['2026-09-15'],preparationOwner:'RN A',openQuestions:[],missingInputs:[],patientGoal:'Walk to the mailbox',status:'prepared'},'2026-09-17T12:20:00Z'),/changed in another session/);
});

test('intake supports partial unanswered fields and synthetic enrollment without requiring a final diagnosis, and rejects unknown patients',()=>{
  let state=initialState();
  state=act(state,{type:'encounters.intake.save',requestId:'intake-1',patientId:'patient-1',encounterId:'enc-1',sourceHistory:'Patient history gathered from intake call and referral note.',medicationsReconciliationReference:'med-rec-44',goals:['Return to walking with grandchildren'],consentReadiness:'needs-clarification',accessReadiness:'ready',unansweredFields:['transportation preferences'],declinedFields:['video consent'],coordinatorClarification:'Confirm the caregiver access workflow.',baselineReviewed:false,enrollmentDecision:'pending',syntheticEvaluation:true,finalDiagnosis:''});
  assert.deepEqual(state.intakes[0].unansweredFields,['transportation preferences']);
  assert.deepEqual(state.intakes[0].declinedFields,['video consent']);
  state=act(state,{type:'encounters.intake.save',requestId:'intake-2',patientId:'patient-1',encounterId:'enc-1',expectedVersion:state.intakes[0].version,sourceHistory:'Patient history gathered from intake call and referral note.',medicationsReconciliationReference:'med-rec-44',goals:['Return to walking with grandchildren'],consentReadiness:'ready',accessReadiness:'ready',unansweredFields:[],declinedFields:['video consent'],coordinatorClarification:'Clarification reviewed.',baselineReviewed:true,enrollmentDecision:'enroll',syntheticEvaluation:true,finalDiagnosis:''});
  assert.equal(state.intakes[0].status,'enrolled');
  assert.equal(state.intakes[0].finalDiagnosis,'');
  assert.throws(()=>act(initialState(),{type:'encounters.intake.save',requestId:'intake-x',patientId:'missing-patient',encounterId:'enc-1',sourceHistory:'History',medicationsReconciliationReference:'',goals:[],consentReadiness:'ready',accessReadiness:'ready',unansweredFields:[],declinedFields:[],coordinatorClarification:'',baselineReviewed:true,enrollmentDecision:'enroll',syntheticEvaluation:true,finalDiagnosis:''}),/not found/);
});

test('assessment supports defer and out-of-scope routes and rejects conflicting findings',()=>{
  let state=initialState();
  state=act(state,{type:'encounters.assessment.save',requestId:'assessment-1',patientId:'patient-1',encounterId:'enc-1',presentingProblem:'Persistent low back pain with new activity intolerance.',painDistributionPhenotype:'Axial low back pain radiating to the right buttock.',timeline:'Worse over the last two weeks after gardening.',relevantExamination:'Limited forward flexion and guarded gait.',comorbidContext:'Type 2 diabetes; prior knee osteoarthritis.',psychologicalContext:'Concerned about future mobility.',socialContext:'Lives alone and relies on bus transport.',workingAssessment:'Mechanical low back pain flare with deconditioning.',alternatives:['Hip referred pain','Lumbar radicular flare'],supportingFindings:['Pain worsens after bending','Guarded gait'],refutingFindings:['No fever','No recent trauma'],uncertainty:'Need more detail on home exercise adherence.',furtherWorkup:'Schedule a longer review if gait worsens.',route:'defer',deferReason:'Need a longer in-person assessment.'});
  assert.equal(state.assessments[0].status,'deferred');
  state=act(state,{type:'encounters.assessment.save',requestId:'assessment-2',patientId:'patient-1',encounterId:'enc-2',presentingProblem:'Patient asked about a topic outside chronic pain scope.',painDistributionPhenotype:'',timeline:'',relevantExamination:'',comorbidContext:'',psychologicalContext:'',socialContext:'',workingAssessment:'Question is outside the supported local workflow.',alternatives:[],supportingFindings:['Topic is unrelated to pain episode'],refutingFindings:[],uncertainty:'Needs referral to a different service.',furtherWorkup:'Direct to the appropriate service.',route:'out-of-scope',deferReason:'Not in scope for this workflow.'});
  assert.equal(state.assessments.find(item=>item.encounterId==='enc-2').status,'out-of-scope');
  assert.throws(()=>act(state,{type:'encounters.assessment.save',requestId:'assessment-3',patientId:'patient-1',encounterId:'enc-3',presentingProblem:'Pain review',painDistributionPhenotype:'',timeline:'',relevantExamination:'',comorbidContext:'',psychologicalContext:'',socialContext:'',workingAssessment:'Conflicting evidence test.',alternatives:[],supportingFindings:['Tender over SI joint'],refutingFindings:['Tender over SI joint'],uncertainty:'Conflicting findings should fail.',furtherWorkup:'',route:'continue-local',deferReason:''}),/cannot both support and refute/);
});

test('observations preserve zero and partial answers, reject unsupported instruments, support idempotent repeats, and keep corrected originals',()=>{
  let state=initialState();
  state=act(state,{type:'encounters.observations.save',requestId:'obs-1',patientId:'patient-1',encounterId:'enc-1',instrument:'local-0-10',submissionStatus:'draft',entries:[
    {metric:'pain',status:'zero',value:0,source:'Check-in call',recordedAt:'2026-09-17T11:00:00Z'},
    {metric:'function',status:'unanswered',source:'Check-in call',recordedAt:'2026-09-17T11:00:00Z'},
    {metric:'sleep',status:'declined',source:'Check-in call',recordedAt:'2026-09-17T11:00:00Z'},
  ]});
  assert.equal(state.observations[0].currentEntries.find(item=>item.metric==='pain').value,0);
  assert.equal(state.observations[0].currentEntries.find(item=>item.metric==='function').status,'unanswered');
  const repeated=act(state,{type:'encounters.observations.save',requestId:'obs-1',patientId:'patient-1',encounterId:'enc-1',instrument:'local-0-10',submissionStatus:'draft',entries:[
    {metric:'pain',status:'zero',value:0,source:'Check-in call',recordedAt:'2026-09-17T11:00:00Z'},
    {metric:'function',status:'unanswered',source:'Check-in call',recordedAt:'2026-09-17T11:00:00Z'},
    {metric:'sleep',status:'declined',source:'Check-in call',recordedAt:'2026-09-17T11:00:00Z'},
  ]});
  assert.deepEqual(repeated,state);
  assert.throws(()=>act(state,{type:'encounters.observations.save',requestId:'obs-1',patientId:'patient-1',encounterId:'enc-1',instrument:'local-0-10',submissionStatus:'confirmed',entries:[
    {metric:'pain',status:'answered',value:1,source:'Check-in call',recordedAt:'2026-09-17T11:00:00Z'},
  ]}),/different payload/);
  assert.throws(()=>act(state,{type:'encounters.observations.save',requestId:'obs-2',patientId:'patient-1',encounterId:'enc-1',expectedVersion:state.observations[0].version,instrument:'PHQ-9',submissionStatus:'confirmed',entries:[
    {metric:'pain',status:'answered',value:4,source:'Check-in call',recordedAt:'2026-09-17T11:05:00Z'},
  ]}),/Only local 0-10 self-reports/);
  const corrected=act(state,{type:'encounters.observations.correct',requestId:'obs-3',patientId:'patient-1',encounterId:'enc-1',expectedVersion:state.observations[0].version,reason:'Patient clarified pain was 2/10, not 0/10.',replacement:{metric:'pain',status:'answered',value:2,source:'Follow-up clarification',recordedAt:'2026-09-17T11:10:00Z'}});
  assert.equal(corrected.observations[0].currentEntries.find(item=>item.metric==='pain').value,2);
  assert.equal(corrected.observations[0].entries.length,4);
  assert.ok(corrected.observations[0].entries.some(item=>item.correctedFromEntryId));
});

test('observation time helpers preserve entered wall-clock time with an explicit offset across seasonal dates',()=>{
  for(const local of ['2026-01-15T11:10','2026-07-15T11:10']){
    const preserved=preserveDateTimeLocalOffset(local);
    assert.match(preserved,new RegExp(`^${local}:00[+-]\\d{2}:\\d{2}$`));
    assert.equal(toDateTimeLocalValue(preserved).slice(0,16),local);
  }
});

test('sign-off supports no-change and deferred dispositions, creates deterministic bridge metadata, and amendments preserve the signed original',()=>{
  let state=initialState();
  state=act(state,{type:'encounters.assessment.save',requestId:'sign-assessment',patientId:'patient-1',encounterId:'enc-1',presentingProblem:'Follow-up low back pain review.',painDistributionPhenotype:'Axial discomfort after prolonged standing.',timeline:'Stable over one week.',relevantExamination:'Able to rise from chair slowly.',comorbidContext:'Previous knee pain.',psychologicalContext:'Worried about pacing activity.',socialContext:'Works nights.',workingAssessment:'Stable mechanical pain flare.',alternatives:['Hamstring strain'],supportingFindings:['Pain increases with prolonged standing'],refutingFindings:['No new weakness'],uncertainty:'Monitor the effect of pacing advice.',furtherWorkup:'Review if walking tolerance drops.',route:'continue-local',deferReason:''});
  state=act(state,{type:'encounters.observations.save',requestId:'sign-observations',patientId:'patient-1',encounterId:'enc-1',instrument:'local-0-10',submissionStatus:'confirmed',entries:[
    {metric:'pain',status:'answered',value:4,source:'Visit self-report',recordedAt:'2026-09-17T11:55:00Z'},
    {metric:'function',status:'answered',value:6,source:'Visit self-report',recordedAt:'2026-09-17T11:55:00Z'},
    {metric:'sleep',status:'answered',value:5,source:'Visit self-report',recordedAt:'2026-09-17T11:55:00Z'},
  ]});
  state=act(state,{type:'encounters.signoff.saveDraft',requestId:'sign-1',patientId:'patient-1',encounterId:'enc-1',assessmentRecordId:state.assessments[0].id,rationale:'Symptoms are stable enough for local follow-up without changing the treatment direction today.',patientFacingPlan:'Continue pacing, keep the walking log, and call if the new concern worsens.',disposition:{selected:[],rejected:['Medication escalation'],deferred:['Physical therapy referral'],noChange:true},owner:'Taylor RN',followUp:{date:'2026-09-20',time:'10:30',timezone:'America/Toronto'},pendingWork:[{title:'Review walking log',owner:'Taylor RN',dueDate:'2026-09-20',disposition:'pending'}],teachBack:'Patient repeated back the pacing and call-back plan.'});
  assert.equal(state.signoffs[0].bridge.deliveryStatus,'pending');
  assert.equal(state.signoffs[0].bridge.carePlanKey,'careplan:patient-1:enc-1');
  assert.equal(state.signoffs[0].followUp.appointmentBooked,false);
  state=act(state,{type:'encounters.signoff.review',requestId:'sign-2',patientId:'patient-1',encounterId:'enc-1',id:state.signoffs[0].id,expectedVersion:state.signoffs[0].version,reason:'Draft reviewed with the clinician.'});
  state=act(state,{type:'encounters.signoff.sign',requestId:'sign-3',patientId:'patient-1',encounterId:'enc-1',id:state.signoffs[0].id,expectedVersion:state.signoffs[0].version,reason:'Signed after review.'});
  assert.equal(state.signoffs[0].status,'signed');
  assert.equal(state.signoffs[0].signedSnapshot.bridge.deliveryStatus,'pending');
  assert.throws(()=>act(state,{type:'encounters.signoff.saveDraft',requestId:'sign-4',patientId:'patient-1',encounterId:'enc-1',expectedVersion:state.signoffs[0].version,assessmentRecordId:state.assessments[0].id,rationale:'Changed after signature.',patientFacingPlan:'New plan',disposition:{selected:['Home program'],rejected:[],deferred:[],noChange:false},owner:'Taylor RN',followUp:{date:'2026-09-21',time:'11:00',timezone:'America/Toronto'},pendingWork:[],teachBack:'Teach-back changed.'}),/immutable/);
  const amended=act(state,{type:'encounters.signoff.amend',requestId:'sign-5',patientId:'patient-1',encounterId:'enc-1',id:state.signoffs[0].id,expectedVersion:state.signoffs[0].version,amendmentReason:'Added clarification that the plan is due, not booked.',patientFacingPlan:'Continue pacing, keep the walking log, and note that the follow-up due date is not a booked appointment.'});
  assert.equal(amended.signoffs.length,2);
  const amendment=amended.signoffs.find(item=>item.amendedFromId);
  assert.equal(amendment.amendedFromId,state.signoffs[0].id);
  assert.equal(amendment.status,'draft');
  assert.equal(amendment.signedSnapshot,undefined);
  assert.ok(amendment.patientFacingPlan.includes('not a booked appointment'));
  assert.deepEqual(amended.signoffs[0],state.signoffs[0]);
  assert.throws(()=>act(amended,{type:'encounters.signoff.amend',requestId:'parallel-amendment',patientId:'patient-1',encounterId:'enc-1',id:state.signoffs[0].id,expectedVersion:state.signoffs[0].version,amendmentReason:'A parallel conflicting plan'}),/already has an amendment/);
  const reviewed=act(amended,{type:'encounters.signoff.review',requestId:'review-amendment',patientId:'patient-1',encounterId:'enc-1',id:amendment.id,expectedVersion:amendment.version,reason:'Review amendment.'});
  const signed=act(reviewed,{type:'encounters.signoff.sign',requestId:'sign-amendment',patientId:'patient-1',encounterId:'enc-1',id:amendment.id,expectedVersion:reviewed.signoffs[1].version,reason:'Sign amendment after review.'});
  assert.equal(signed.signoffs[1].status,'signed');
  assert.ok(signed.signoffs[1].signedSnapshot.patientFacingPlan.includes('not a booked appointment'));
  assert.deepEqual(signed.signoffs[0],state.signoffs[0]);
  assert.equal(getSummary(signed,'patient-1','2026-09-21T12:00:00Z').overdue,1);
});

test('episode review requires pending work ownership before closure and the panel renders saved workflow labels without changing patient context',()=>{
  let state=initialState();
  state=act(state,{type:'encounters.episode.save',requestId:'episode-1',patientId:'patient-2',encounterId:'enc-9',goalEvidence:'Patient can complete two short walks each week with less hesitation.',observedOutcomes:'Pain remains present but function is more consistent.',priorInterventions:'Education and pacing review.',ongoingInterventions:'Walking log and self-report check-ins.',patientExperience:'Feels heard but still wants a backup plan for flare days.',remainingConcerns:['Flare-day planning'],decision:'closure',pendingWorkDisposition:'',pendingWorkOwner:'',status:'reviewed'});
  assert.throws(()=>act(state,{type:'encounters.episode.close',requestId:'episode-2',patientId:'patient-2',encounterId:'enc-9',id:state.episodes[0].id,expectedVersion:state.episodes[0].version,reason:'Attempting closure too early.'}),/pending work disposition and ownership/);
  state=act(state,{type:'encounters.episode.save',requestId:'episode-3',patientId:'patient-2',encounterId:'enc-9',expectedVersion:state.episodes[0].version,goalEvidence:'Patient can complete two short walks each week with less hesitation.',observedOutcomes:'Pain remains present but function is more consistent.',priorInterventions:'Education and pacing review.',ongoingInterventions:'Walking log and self-report check-ins.',patientExperience:'Feels heard but still wants a backup plan for flare days.',remainingConcerns:['Flare-day planning'],decision:'closure',pendingWorkDisposition:'Escalate flare calls back to the coordinator.',pendingWorkOwner:'Jordan PT',status:'reviewed'});
  state=act(state,{type:'encounters.episode.close',requestId:'episode-4',patientId:'patient-2',encounterId:'enc-9',id:state.episodes[0].id,expectedVersion:state.episodes[0].version,reason:'Closure confirmed.'});
  assert.equal(state.episodes[0].status,'closed');
  assert.deepEqual(validateState(state),state);
  assert.equal(getSummary(state,'patient-2').open,0);
  const html=renderToStaticMarkup(React.createElement(EncountersPanel,{patientId:'patient-2',patients,state,busy:false,onAction:async()=>false}));
  for(const text of ['Encounter workflows','Prepare the encounter','Intake and enrollment readiness','Structured encounter assessment','Observations and assessments','Encounter draft, review, and sign-off','Episode review and closure'])assert.ok(html.includes(text),text);
  assert.equal(state.observations.filter(record=>record.patientId==='patient-2'&&record.encounterId==='enc-9').length,0);
  assert.ok(html.includes('There is no recorded observation to correct in this episode.'));
  assert.ok(!html.includes('id="observation-patient-2-enc-9-time"'),'closed episodes cannot create a new observation report');
  const invalidHtml=renderToStaticMarkup(React.createElement(EncountersPanel,{patientId:'missing-patient',patients,state,busy:false,onAction:async()=>false}));
  assert.ok(invalidHtml.includes('not available in this launch context'));
});

const now='2026-09-17T12:00:00Z';
const receiving={id:'handoff:urgent-1',sourceId:'urgent-1',kind:'handoff',patientId:'patient-1',encounterId:'review-encounter',title:'Arrange the longer assessment',owner:'Receiving nurse',dueAt:'2026-09-17T13:00:00Z',revision:'1',priority:'high',fallbackOwner:'Covering clinician',coverageExpectation:'Named team covers this interval.',status:'failed'};
function signatureCommand(state,type='encounters.signoff.review'){
  const record=state.signoffs.at(-1);
  return {type,requestId:crypto.randomUUID(),patientId:record.patientId,encounterId:record.encounterId,id:record.id,expectedVersion:record.version,...(type==='encounters.signoff.amend'?{}:{reason:'Reviewed the recorded plan and sources.'})};
}
function evidence(overrides={}){
  return {patientId:'patient-1',capturedAt:now,goal:{text:'Walk to the park.',recordedAt:'2026-09-10',sourceRef:'patient-goal'},observations:[
    {recordId:'report-a',entryId:'pain-a',version:1,metric:'pain',status:'answered',value:7,recordedAt:'2026-09-01',source:'Patient report'},
    {recordId:'report-b',entryId:'pain-b',version:1,metric:'pain',status:'zero',value:0,recordedAt:'2026-09-16T09:00:00Z',source:'Patient report'},
    {recordId:'report-b',entryId:'function-b',version:1,metric:'function',status:'declined',recordedAt:'2026-09-16T09:00:00Z',source:'Patient report'},
  ],pendingWork:[],...overrides};
}

test('interim plans retain uncertainty and require a current owned receiving workflow without completing urgent assessments',()=>{
  for(const route of ['defer','longer-review','urgent-review','out-of-scope']){
    let state=act(initialState(),assessmentCommand({route,deferReason:'Focused examination has not yet been performed.',relevantExamination:'Not performed during the interrupted visit.',painDistributionPhenotype:'Right-sided pain extending into the buttock.',comorbidContext:'Diabetes and knee osteoarthritis remain relevant.',workingAssessment:'Etiology remains uncertain.',alternatives:['Musculoskeletal pain','Referred symptoms']}));
    state=act(state,signoffCommand(state,{planKind:'interim',receivingWorkRef:{id:receiving.id,revision:receiving.revision},patientFallback:'Use the documented contact route if the team cannot be reached.'}));
    assert.throws(()=>act(state,signatureCommand(state)),/receiving work/);
    assert.throws(()=>act(state,signatureCommand(state),now,{receivingWork:[{...receiving,patientId:'patient-2'}]}),/receiving work/);
    assert.throws(()=>act(state,signatureCommand(state),now,{receivingWork:[{...receiving,encounterId:'another-visit'}]}),/different encounter/);
    if(route==='urgent-review')assert.throws(()=>act(state,signatureCommand(state),now,{receivingWork:[{...receiving,priority:'routine'}]}),/high-priority/);
    state=act(state,signatureCommand(state),now,{receivingWork:[receiving]});
    assert.throws(()=>act(state,signatureCommand(state,'encounters.signoff.sign'),now,{receivingWork:[{...receiving,revision:'2'}]}),/current receiving work/);
    state=act(state,signatureCommand(state,'encounters.signoff.sign'),now,{receivingWork:[receiving]});
    const signed=state.signoffs[0];
    assert.equal(signed.status,'signed');
    assert.notEqual(state.assessments[0].status,'completed');
    assert.equal(signed.signedSnapshot.receivingWorkSnapshot.status,'failed');
    assert.equal(signed.signedSnapshot.assessmentSnapshot.relevantExamination,'Not performed during the interrupted visit.');
    assert.deepEqual(signed.signedSnapshot.assessmentSnapshot.alternatives,['Musculoskeletal pain','Referred symptoms']);
    assert.match(signed.signedSnapshot.assessmentSnapshot.comorbidContext,/Diabetes/);
    assert.equal(signed.signedSnapshot.assessmentSnapshot.workingAssessment,'Etiology remains uncertain.');
    const forged=structuredClone(state);forged.signoffs[0].signedSnapshot.receivingWorkSnapshot.patientId='patient-2';
    assert.throws(()=>validateState(forged),/receiving work/);
  }
});

test('teach-back requiring clarification must have owned work and is resolved by an attributed amendment',()=>{
  let state=act(initialState(),assessmentCommand());
  state=act(state,signoffCommand(state,{teachBack:'Patient described a different next step.',teachBackOutcome:'needs-clarification'}));
  assert.throws(()=>act(state,signatureCommand(state)),/Assign clarification/);
  const clarification={owner:'Named nurse',dueAt:'2026-09-17T15:00:00Z',question:'Clarify which walking activity the patient agreed to try.'};
  state=act(state,signoffCommand(state,{expectedVersion:state.signoffs[0].version,teachBack:'Patient described a different next step.',teachBackOutcome:'needs-clarification',clarification}));
  state=act(state,signatureCommand(state));state=act(state,signatureCommand(state,'encounters.signoff.sign'));
  const original=structuredClone(state.signoffs[0]);
  assert.deepEqual(original.signedSnapshot.clarification,clarification);
  state=act(state,{...signatureCommand(state,'encounters.signoff.amend'),amendmentReason:'Reviewed the step again with the patient.',teachBackOutcome:'understood',teachBack:'Patient correctly described the agreed activity and when to ask for help.'});
  assert.equal(state.signoffs.at(-1).clarification,undefined);
  state=act(state,signatureCommand(state));state=act(state,signatureCommand(state,'encounters.signoff.sign'));
  assert.equal(state.signoffs.at(-1).signedSnapshot.teachBackOutcome,'understood');
  assert.deepEqual(state.signoffs[0],original);
  assert.equal(state.signoffs.at(-1).history[0].actor,'Clinician A');
  const forged=structuredClone(state);forged.signoffs[0].teachBackOutcome='understood';
  assert.throws(()=>validateState(forged),/immutable snapshot/);
});

test('withdrawal retains source entries and signed history, rejects wrong-chart requests and cannot be bypassed by save or correction',()=>{
  let state=act(initialState(),assessmentCommand());
  const save={type:'encounters.observations.save',requestId:'withdraw-source',patientId:'patient-1',encounterId:'review-encounter',instrument:'local-0-10',submissionStatus:'confirmed',entries:[{metric:'pain',status:'zero',value:0,source:'Patient report',recordedAt:now}]};
  state=act(state,save);state=act(state,signoffCommand(state));state=act(state,signatureCommand(state));state=act(state,signatureCommand(state,'encounters.signoff.sign'));
  const signed=structuredClone(state.signoffs[0]),original=structuredClone(state.observations[0]);
  const withdraw={type:'encounters.observations.withdraw',requestId:'withdraw-action',patientId:'patient-1',encounterId:'review-encounter',id:original.id,expectedVersion:original.version,reason:'This report was entered on the wrong chart.'};
  assert.throws(()=>act(state,{...withdraw,patientId:'patient-2'}),/not found/);
  assert.equal(actionSchema.safeParse({...withdraw,actor:'Forged clinician'}).success,false);
  assert.equal(actionSchema.safeParse({...save,submissionStatus:'withdrawn'}).success,false);
  state=act(state,withdraw);
  assert.equal(state.observations[0].status,'withdrawn');
  assert.deepEqual(state.observations[0].entries,original.entries);
  assert.deepEqual(state.observations[0].currentEntries,original.currentEntries);
  assert.deepEqual(state.signoffs[0],signed);
  assert.equal(state.observations[0].withdrawal.actor,'Clinician A');
  assert.deepEqual(act(state,withdraw),state);
  assert.throws(()=>act(state,{...save,requestId:'restore',expectedVersion:state.observations[0].version,correctionReason:'Attempted restoration.'}),/withdrawn/);
  assert.throws(()=>act(state,{type:'encounters.observations.correct',requestId:'correct-withdrawn',patientId:'patient-1',encounterId:'review-encounter',expectedVersion:state.observations[0].version,reason:'Attempt correction',replacement:save.entries[0]}),/Withdrawn/);
  const forged=structuredClone(state);forged.observations[0].withdrawal.actor='Different person';assert.throws(()=>validateState(forged),/recorded history/);
});

test('episode closure checks trusted unresolved work and snapshots accepted responsibility while leaving sources open',()=>{
  const episode={type:'encounters.episode.save',requestId:'dependency-review',patientId:'patient-1',encounterId:'review-encounter',goalEvidence:'Goal reviewed.',observedOutcomes:'Outcomes reviewed.',priorInterventions:'',ongoingInterventions:'Self management.',patientExperience:'Patient agrees.',remainingConcerns:[],decision:'closure',pendingWorkDisposition:'Receiving team follows up the result.',pendingWorkOwner:'Receiving nurse',status:'reviewed'};
  const state=act(initialState(),episode);
  const close={type:'encounters.episode.close',requestId:'dependency-close',patientId:'patient-1',encounterId:'review-encounter',id:state.episodes[0].id,expectedVersion:state.episodes[0].version,reason:'Closure after accepted responsibility.'};
  const work={id:'result:result-1',sourceId:'result-1',kind:'result',patientId:'patient-1',encounterId:'review-encounter',title:'Unreviewed outside report',owner:'Current clinician',dueAt:'2026-09-20',revision:'3'};
  assert.throws(()=>act(state,close,now,{closureDependencies:undefined}),/unavailable/);
  assert.throws(()=>act(state,close,now,{closureDependencies:[work]}),/Unreviewed outside report/);
  const accepted={...work,acceptedOwner:'Receiving nurse'};
  const closed=act(state,close,now,{closureDependencies:[accepted,{...work,id:'result:other-patient',patientId:'patient-2'}]});
  assert.equal(closed.episodes[0].status,'closed');assert.deepEqual(closed.episodes[0].closureSnapshot.dependencies,[accepted]);
  assert.equal(closed.episodes[0].closureSnapshot.actor,'Clinician A');assert.equal(accepted.revision,'3');
  assert.throws(()=>act(state,close,now,{closureDependencies:[{...work,revision:'4'}]}),/accepted receiving responsibility/);
  assert.equal(actionSchema.safeParse({...close,closureDependencies:[accepted]}).success,false);
  const forged=structuredClone(closed);delete forged.episodes[0].closureSnapshot.dependencies[0].acceptedOwner;assert.throws(()=>validateState(forged),/accepted work/);
});

test('source comparisons retain dated baseline, reviewed zero, current declined response and the goal at review',()=>{
  const prior=evidence();
  const prep={type:'encounters.preparation.save',requestId:'evidence-preparation',patientId:'patient-1',encounterId:'review-encounter',reasonForVisit:'Review activity goals.',changesSinceLastReviewedEncounter:'',sourceDates:['2026-09-16'],preparationOwner:'Clinician A',openQuestions:[],missingInputs:[],patientGoal:prior.goal.text,status:'clinician-reviewed'};
  let state=act(initialState(),prep,now,{reviewEvidence:prior});
  const latest=evidence({capturedAt:'2026-09-18T12:00:00Z',goal:{text:'Return to a short work shift.',recordedAt:'2026-09-18',sourceRef:'goal-revision-2'},observations:[...prior.observations,{recordId:'report-c',entryId:'pain-c',version:1,metric:'pain',status:'declined',recordedAt:'2026-09-18T10:00:00Z',source:'Patient report'}]});
  const compared=getSourceComparison(state,'patient-1',latest),pain=compared.metrics.find(row=>row.metric==='pain');
  assert.equal(pain.baseline.value,7);assert.equal(pain.baseline.recordedAt,'2026-09-01');assert.equal(pain.lastReviewed.value,0);assert.equal(pain.current.status,'declined');assert.equal(pain.current.value,undefined);
  assert.equal(compared.lastReviewed.goal.text,'Walk to the park.');assert.equal(compared.current.goal.text,'Return to a short work shift.');
  state=act(state,{...prep,requestId:'latest-preparation',expectedVersion:1,newInformation:'Patient updated their goal.'},latest.capturedAt,{reviewEvidence:latest});
  assert.equal(state.preparations[0].reviewNeeded,true);assert.deepEqual(state.preparations[0].reviewHistory,[prior]);
  assert.equal(getSourceComparison(state,'patient-1',latest).lastReviewed.goal.text,'Walk to the park.');
  assert.equal(getSourceComparison(state,'patient-2',latest).current,undefined);
  assert.equal(reviewEvidenceRevision(prior),reviewEvidenceRevision({...prior,capturedAt:'2026-09-18T12:00:00Z'}));
  assert.throws(()=>act(initialState(),prep,now,{reviewEvidence:{...prior,patientId:'patient-2'}}),/match the patient/);
  assert.equal(actionSchema.safeParse({...prep,reviewEvidence:prior}).success,false);
});

test('source changes block a reviewed signature while old records without structured evidence remain readable',()=>{
  const reviewed=evidence();let state=act(initialState(),assessmentCommand());
  state=act(state,signoffCommand(state),now,{reviewEvidence:reviewed});state=act(state,signatureCommand(state),now,{reviewEvidence:reviewed});
  const changed={...reviewed,goal:{text:'A different patient priority.'}};
  assert.throws(()=>act(state,signatureCommand(state,'encounters.signoff.sign')),/sources are unavailable/);
  assert.throws(()=>act(state,signatureCommand(state,'encounters.signoff.sign'),now,{reviewEvidence:changed}),/Patient sources changed/);
  state=act(state,signatureCommand(state,'encounters.signoff.sign'),now,{reviewEvidence:reviewed});
  assert.deepEqual(state.signoffs[0].signedSnapshot.reviewEvidence,reviewed);
  let legacy=act(initialState(),assessmentCommand());legacy=act(legacy,signoffCommand(legacy));legacy=act(legacy,signatureCommand(legacy));legacy=act(legacy,signatureCommand(legacy,'encounters.signoff.sign'));
  assert.equal(validateState(JSON.parse(JSON.stringify(legacy))).signoffs[0].teachBackOutcome,undefined);
});

test('encounter forms expose interim plans, explicit understanding, dated comparisons and guarded closure without a default follow-up time',()=>{
  const html=renderToStaticMarkup(React.createElement(EncountersPanel,{patientId:'patient-1',patients,state:act(initialState(),assessmentCommand()),busy:false,onAction:async()=>true,clinicalContext:{receivingWork:[receiving],closureDependencies:[receiving],reviewEvidence:evidence()}}));
  for(const text of ['Dated observations: baseline, last reviewed and current','Interim plan while assessment continues','Patient understanding','Needs clarification','receiving responsibility not yet accepted'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/type="time"[^>]*value="09:00"/);
  assert.match(html,/type="time"[^>]*value=""/);
  assert.doesNotMatch(html,/>Synthetic evaluation case</);
});

test('pain phenotype and limited examination preserve uncertainty in an owned interim signed plan',()=>{
  const fields=assessmentCommand({painDistributionPhenotype:'Burning foot symptoms and separate back discomfort.',relevantExamination:'Telephone review; gait, reflexes and sensation have not been examined.',supportingFindings:['Patient describes two distinct distributions.'],refutingFindings:['No examination has confirmed a shared cause.'],uncertainty:'Phenotype remains mixed; examination is needed before a definitive assessment.',furtherWorkup:'Arrange the owned in-person examination.',route:'defer',deferReason:'Physical examination is not yet available.'});
  let state=act(initialState(),fields);
  const work={id:'exam-work',kind:'task',patientId:'patient-1',encounterId:'review-encounter',title:'Review the examination',owner:'Clinician B',dueAt:'2026-09-20T10:00:00Z',revision:'1',sourceId:'exam-task'};
  state=act(state,signoffCommand(state,{planKind:'interim',receivingWorkRef:{id:work.id,revision:work.revision},patientFallback:'Contact the care team if the agreed examination cannot be arranged.',disposition:{selected:[],rejected:[],deferred:['Definitive assessment until examination'],noChange:true}}));
  const signoff=()=>state.signoffs[0];
  for(const verb of ['review','sign'])state=act(state,{type:'encounters.signoff.'+verb,requestId:crypto.randomUUID(),patientId:'patient-1',encounterId:'review-encounter',id:signoff().id,expectedVersion:signoff().version,reason:'Retained the reported phenotype and examination limits in the interim plan.'},undefined,{receivingWork:[work]});
  assert.equal(signoff().signedSnapshot.assessmentSnapshot.painDistributionPhenotype,fields.painDistributionPhenotype);
  assert.equal(signoff().signedSnapshot.assessmentSnapshot.relevantExamination,fields.relevantExamination);
  assert.equal(signoff().signedSnapshot.assessmentSnapshot.uncertainty,fields.uncertainty);
  assert.notEqual(state.assessments[0].status,'completed');
  assert.equal(signoff().signedSnapshot.receivingWorkSnapshot.id,work.id);
});

test('competing conditions retain alternatives and a reviewed no-change disposition in the signed assessment',()=>{
  const fields=assessmentCommand({comorbidContext:'Pain, disrupted sleep and daytime fatigue compete with the patient’s desk-work goal.',workingAssessment:'Several recorded problems may contribute; no single cause is established.',alternatives:['Pain-related sleep disruption','A separate contributor to daytime fatigue'],supportingFindings:['The patient reports both disrupted sleep and fatigue.'],refutingFindings:['The timing differs between the two reports.'],uncertainty:'The current record cannot distinguish the relative contributors.'});
  let state=act(initialState(),fields);
  state=act(state,signoffCommand(state,{rationale:'Maintain the agreed plan while separately reviewing the competing contributors.',disposition:{selected:[],rejected:[],deferred:['Changing treatment before the competing contributors are reviewed'],noChange:true}}));
  for(const verb of ['review','sign']){const record=state.signoffs[0];state=act(state,{type:'encounters.signoff.'+verb,requestId:crypto.randomUUID(),patientId:'patient-1',encounterId:'review-encounter',id:record.id,expectedVersion:record.version,reason:'Reviewed the alternatives, uncertainty and explicit no-change choice.'});}
  const original=structuredClone(state.signoffs[0].signedSnapshot);
  assert.deepEqual(original.assessmentSnapshot.alternatives,fields.alternatives);assert.equal(original.assessmentSnapshot.comorbidContext,fields.comorbidContext);assert.equal(original.disposition.noChange,true);assert.equal(original.disposition.deferred.length,1);
  state=act(state,assessmentCommand({...fields,requestId:crypto.randomUUID(),expectedVersion:state.assessments[0].version,comorbidContext:'A later review adds new context.'}));
  assert.deepEqual(state.signoffs[0].signedSnapshot,original);
});
