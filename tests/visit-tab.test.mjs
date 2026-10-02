import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({stdin:{contents:"export * from './lib/visit-presentation'; export {seedWorkspace} from './lib/theranetrix'; export {applyAction,actionSchema} from './lib/actions'; export {normalizeWorkspace,patientSuggestions} from './lib/medications'; export {ensureShowcaseData} from './lib/demo-showcase'; export {medicationGroups,groupMedications} from './lib/medication-groups'; export {visitDocumentHtml} from './lib/visit-document'; export {EncounterReview} from './components/theranetrix/encounter-review'; export {SynopsisBoard} from './components/theranetrix/review-workspace'; export {ObservationHistory} from './components/theranetrix/clinical-flows/observation-history'; export {defaultDashboardLayout} from './lib/dashboard-layout'; export {advisorSuggestions,sinceSignedVisit} from './lib/advisor-guide'; export {medicationReportNote,affectingPainNote,emptyMedicationReport,emptyUnidentified} from './lib/patient-medication-report'; export {TreatmentCourse} from './components/theranetrix/treatment-course';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {seedWorkspace,applyAction,actionSchema,normalizeWorkspace,patientSuggestions,ensureShowcaseData,medicationGroups,groupMedications,visitDocumentHtml,visitGlance,visitProgression,latestQuestionnaire,latestDailyCheckin,questionnaireReviewLabel,EncounterReview,SynopsisBoard,ObservationHistory,defaultDashboardLayout,advisorSuggestions,sinceSignedVisit,medicationReportNote,affectingPainNote,emptyMedicationReport,emptyUnidentified,TreatmentCourse}=mod.exports;

const now='2026-09-20T10:00:00Z';
const act=(w,a,actor='Clinical reviewer')=>applyAction(w,actionSchema.parse(a),actor,now);
const ctx=data=>({data,user:'Clinical reviewer',busy:false,save:async()=>true,open:()=>{}});
const render=(w,p)=>renderToStaticMarkup(React.createElement(EncounterReview,{p,ctx:ctx(w),changeTab:()=>{}}));
const get=(w,id)=>w.patients.find(p=>p.id===id);
// The same command the patient companion sends: a 'checkin-' encounter with the patient as source, and the check-in type first.
function checkin(w,patientId,{pain=4,sleep=6,fn,note='Check-in type: Pre-visit\nLocation: Both feet\nMood 3/10\nTried before (patient-reported): Pregabalin · Helped: Did not help · Side effects: Dizzy · Why stopped: Dizzy\nCannot take (patient-reported): None\nWorse after long shifts at work.',at=now,recordedAt='2026-09-19T08:00:00Z'}={}){
  const requestId=crypto.randomUUID(),actAt=at;
  const answer=(value)=>value===undefined?{status:'unanswered'}:{status:value===0?'zero':'answered',value};
  const entries=[['pain',pain],['function',fn],['sleep',sleep]].map(([metric,value])=>({metric,...answer(value),source:'Patient self-report',recordedAt}));
  return applyAction(w,actionSchema.parse({type:'workflow.apply',domain:'encounters',patientId,requestId,expectedSliceVersion:w.clinicalWorkflows.slices.encounters.version,command:{type:'encounters.observations.save',requestId,patientId,encounterId:'checkin-'+requestId,instrument:'local-0-10',submissionStatus:'confirmed',submissionSource:'patient-self-report',patientNote:note,entries}}),'Shared workspace visitor',actAt);
}

test('the glance strip summarizes recorded values, links to each section and never shows the composite',()=>{
  const w=seedWorkspace(),p=get(w,'TN-1042');
  const glance=visitGlance(p,w,'2026-09-10');
  assert.deepEqual(glance.report.metrics.map(m=>[m.key,m.value,m.change,m.tone]),[['pain',6,0,'neutral'],['function',4,0,'neutral'],['sleep',5,0,'neutral']]);
  assert.equal(glance.highPriority,1);assert.deepEqual(glance.medications,{count:1,sideEffects:1,missedUse:0,confirmedNone:false});assert.equal(glance.followup,null);
  const html=render(w,p),strip=html.match(/<nav class="visit-glance"[\s\S]*?<\/nav>/)[0];
  for(const target of ['#visit-observations','#visit-concerns','#patient-medications','#visit-plan'])assert.ok(strip.includes('href="'+target+'"'),target);
  for(const id of ['visit-observations','visit-concerns','patient-medications','visit-plan'])assert.match(html,new RegExp('id="'+id+'"'),id);
  for(const text of ['1 high priority','Side effects reported (1)','No agreed plan'])assert.ok(strip.includes(text),text);
  assert.doesNotMatch(strip,/Composite|confidence|Next visit/i,'No composite, confidence label, or repeat of the header’s next visit.');
  const planned=act(w,{type:'plan.save',patientId:p.id,text:'Walking log review.',owner:'Taylor, RN',followup:'2026-09-30',time:'10:00'});
  assert.deepEqual(visitGlance(get(planned,p.id),planned,'2026-09-21').followup,{date:'2026-09-30',time:'10:00',owner:'Taylor, RN',state:'planned'});
  assert.equal(visitGlance(get(planned,p.id),planned,'2026-10-02').followup.state,'overdue');
});

test('visit progression comes only from encounter records; a check-in-only patient has no visit',()=>{
  let w=checkin(seedWorkspace(),'TN-1042');
  const p=get(w,'TN-1042');
  assert.ok(w.clinicalWorkflows.slices.encounters.state.observations.some(r=>r.patientId===p.id&&r.encounterId.startsWith('checkin-')));
  assert.deepEqual(visitProgression(p,w),{latest:null,encounters:[]});
  // Even an encounter record filed under a check-in id is not a visit.
  const probe=structuredClone(w);probe.clinicalWorkflows.slices.encounters.state.preparations.push({id:'prep-x',patientId:p.id,encounterId:'checkin-x',version:1,createdAt:now,updatedAt:now,history:[],status:'prepared'});
  assert.equal(visitProgression(get(probe,'TN-1042'),probe).encounters.length,0);
  const html=render(w,p);
  assert.match(html,/No recorded encounter/);assert.match(html,/Patient check-ins are reports, not visits/);assert.doesNotMatch(html,/Visit history/);
});

test('a prepared, assessed and signed encounter shows each step with dates and does not claim EHR filing',()=>{
  const w=ensureShowcaseData(seedWorkspace(),'Dr. Maya Chen','2026-09-20T09:00:00Z');
  const p=get(w,'TN-DEMO-01'),progress=visitProgression(p,w,'2026-09-21');
  assert.equal(progress.encounters.length,1);
  const [pre,during,post]=progress.latest.steps;
  assert.deepEqual([pre.state,pre.status],['done','Preparation reviewed']);
  assert.deepEqual([during.state,during.status],['done','Assessment recorded']);
  assert.deepEqual([post.state,post.status],['done','Signed in workspace']);
  assert.ok(pre.date&&during.date&&post.date);
  assert.equal(post.followup.bookingConfirmed,false);
  const html=render(w,p);
  for(const text of ['Latest recorded encounter · Sep','Pre-visit','In visit','Post-visit','Signed in workspace','appointment booking not confirmed','Visit history','Encounter 1','not file a note to the EHR'])assert.ok(html.includes(text),text);
  // One neutral heading: no Pre-visit/In visit view toggle that could contradict the recorded steps.
  assert.match(html,/<h2>Visit review<\/h2>/);assert.doesNotMatch(html,/Pre-visit review|In-visit review|Review view mode|View mode does not/);
  assert.doesNotMatch(html.match(/<section class="visit-progress"[\s\S]*?<\/section>/)[0],/sent to the EHR|filed in the EHR|signed in the EHR/i);
});

test('the pre-visit questionnaire card shows the latest self-report and records who reviewed it',()=>{
  let w=checkin(seedWorkspace(),'TN-1042');
  const q=latestQuestionnaire(get(w,'TN-1042'),w);
  assert.deepEqual(q.answers,{pain:4,function:'Not answered',sleep:6});
  assert.equal(q.mood,3);assert.equal(q.location,'Both feet');assert.equal(q.concerns,'Worse after long shifts at work.');
  assert.deepEqual(q.medicines,{answered:true,cannotTake:0,tried:1,takingNow:0,alsoOnRecord:0,notNamed:{cannotTake:0,tried:0,takingNow:0,other:0},allergicReaction:false,kinds:[]});assert.equal(q.review,null);
  let html=render(w,get(w,'TN-1042'));
  const card=html.match(/<section id="visit-questionnaire"[\s\S]*?<\/section>/)[0];
  for(const text of ['Pre-visit questionnaire','Awaiting clinician review','Completed by the patient','4 / 10','Not answered','3 / 10','not a mood or depression screen','Both feet','Worse after long shifts at work.','1 tried before','patient-reported, to verify','Mark reviewed'])assert.ok(card.includes(text),text);
  assert.ok(html.indexOf('id="visit-questionnaire"')<html.indexOf('visit-concerns-heading'),'The card leads the review rail.');
  assert.doesNotMatch(card,/Tried before \(patient-reported\)|Mood 3\/10/,'Raw note lines are summarized, not echoed.');
  assert.throws(()=>act(w,{type:'questionnaire.review',patientId:'TN-1042',recordId:q.record.id,version:q.record.version+1}),/changed/);
  assert.throws(()=>act(w,{type:'questionnaire.review',patientId:'TN-1038',recordId:q.record.id,version:q.record.version}),/not found/);
  const before=structuredClone(get(w,'TN-1042'));
  w=act(w,{type:'questionnaire.review',patientId:'TN-1042',recordId:q.record.id,version:q.record.version},'Dr. Maya Chen');
  assert.equal(w.audit[0].action,questionnaireReviewLabel(q.record));assert.equal(w.audit[0].actor,'Dr. Maya Chen');assert.equal(w.audit[0].date,now);
  assert.deepEqual(get(w,'TN-1042'),before,'Reviewing leaves the patient record and its answers unchanged.');
  assert.deepEqual(latestQuestionnaire(get(w,'TN-1042'),w).review,{actor:'Dr. Maya Chen',date:now});
  html=render(w,get(w,'TN-1042'));
  assert.match(html,/Reviewed by Dr\. Maya Chen/);assert.doesNotMatch(html,/Awaiting clinician review|>Mark reviewed</);
  // A newer submission needs its own review.
  w=checkin(w,'TN-1042',{pain:5,sleep:5,note:'Check-in type: Pre-visit\nMood 4/10'});
  assert.equal(latestQuestionnaire(get(w,'TN-1042'),w).review,null);
  const other=render(w,get(w,'TN-1038'));assert.doesNotMatch(other,/visit-questionnaire/,'No card without a self-report.');
});

test('patient self-reports read as submitted by the patient in the note and observation history',()=>{
  const w=checkin(seedWorkspace(),'TN-1042',{pain:4,sleep:6,fn:5,note:'Mood 3/10'}),p=get(w,'TN-1042');
  const note=p.notes.find(n=>n.workflowRecordId&&n.encounterId?.startsWith('checkin-'));
  assert.equal(note.type,'Patient-submitted report');assert.equal(note.author,'Submitted by patient');
  assert.ok(!p.notes.some(n=>n.type==='Confirmed observation report'));
  const history=renderToStaticMarkup(React.createElement(ObservationHistory,{patient:p}));
  assert.match(history,/Submitted by patient/);assert.match(history,/Submitted or updated by/);assert.match(history,/Patient check-in · submitted/);
  assert.doesNotMatch(history,/Shared workspace visitor|Confirmed by/,'The saving session is not presented as a confirming clinician.');
  const corrected=renderToStaticMarkup(React.createElement(ObservationHistory,{patient:{id:p.id,workflowObservations:[...p.workflowObservations,{...p.workflowObservations[0],id:'fix',workflowVersion:2,value:3,source:'Patient clarification at visit',confirmedBy:'Dr. Maya Chen',correctedFromEntryId:p.workflowObservations[0].id}]}}));
  assert.match(corrected,/Dr\. Maya Chen/);assert.match(corrected,/Updated/);
});

test('one medication group label set is used on the visit tab, synopsis, care overview and export',()=>{
  assert.deepEqual(medicationGroups.map(g=>g.title),['Analgesic medications','Other medications','Indication needs confirmation']);
  const w=normalizeWorkspace(seedWorkspace()),james=get(w,'TN-1038'),sarah=get(w,'TN-1042');
  assert.deepEqual(groupMedications(james.medications).map(g=>g.medications.map(m=>m.name)),[['Acetaminophen'],['Levothyroxine'],[]]);
  assert.equal(sarah.medications[0].indication,'Painful peripheral neuropathy');
  assert.deepEqual(groupMedications(sarah.medications).map(g=>g.medications.length),[1,0,0],'Gabapentin examples carry an explicit pain indication.');
  const visit=render(w,james),synopsis=renderToStaticMarkup(React.createElement(SynopsisBoard,{p:james,ctx:ctx(w),layout:defaultDashboardLayout(),changeTab:()=>{}}));
  for(const html of [visit,synopsis]){assert.match(html,/aria-label="Analgesic medications"/);assert.match(html,/aria-label="Other medications"/);assert.match(html,/Levothyroxine/);}
  assert.match(visit,/Drug-interaction checking is not connected/);
  const doc=visitDocumentHtml(james,w,now);
  assert.ok(doc.indexOf('Analgesic medications (1)')<doc.indexOf('Acetaminophen')&&doc.indexOf('Other medications (1)')<doc.indexOf('Levothyroxine'));
  assert.match(doc,/Recorded indication: Hypothyroidism \(example record\)/);
});

test('pain-framed prompts skip medications recorded for another reason; safety prompts stay on for all',()=>{
  const w=normalizeWorkspace(seedWorkspace()),p=get(w,'TN-1038');
  const titles=()=>patientSuggestions(p,w).map(s=>s.title+': '+s.reason).join('\n');
  assert.doesNotMatch(titles(),/Levothyroxine/);
  const other=p.medications.find(m=>m.name==='Levothyroxine');
  Object.assign(other,{benefit:'Not assessed',tolerability:'Not assessed',adherence:'Not assessed',regimen:''});
  assert.doesNotMatch(titles(),/Levothyroxine/,'No benefit, dose or use prompts for a non-pain medication.');
  Object.assign(other,{tolerability:'Effects reported',effects:'Palpitations reported by the patient.',adherence:'Missed doses'});
  assert.match(titles(),/Review reported side effects: .*Levothyroxine: Palpitations/);
  assert.match(titles(),/Clarify medication use: .*Levothyroxine: missed doses/);
  other.indication='';
  assert.match(titles(),/Ask about benefit and tolerability: .*Levothyroxine/,'An unconfirmed indication keeps the response prompts.');
});

test('previously tried shows structured stopped medications, or labeled free text when none are structured',()=>{
  const w=seedWorkspace(),emma=get(w,'TN-DEMO-01');
  const strip=html=>html.match(/<section class="visit-previously-tried"[\s\S]*?<\/section>/)[0];
  const stopped=emma.medications.find(m=>m.status==='Stopped');
  let html=strip(render(w,emma));
  assert.ok(html.includes(stopped.name));assert.match(html,/Stopped |Stop date not recorded/);assert.match(html,/Reported benefit: |Benefit not assessed/);
  assert.doesNotMatch(html,/fail/i);assert.match(html,/Medication history/);
  const p=get(w,'TN-1051');p.clinicalContext={allergyStatus:'None reported',allergies:'',priorTreatments:'A prior amitriptyline trial is described by the patient.',date:now,author:'Clinician',history:[]};
  html=strip(render(w,p));
  assert.match(html,/Recorded as free text – not yet structured/);assert.match(html,/amitriptyline/);
  p.clinicalContext.priorTreatments='Not recorded.';
  assert.match(strip(render(w,p)),/No previous medication trials recorded/);
});

test('a daily check-in never replaces the pre-visit questionnaire or resets its review, and is listed beside it',()=>{
  const previsit='Check-in type: Pre-visit\nLocation: Left foot\nMood 3/10\nTried before (patient-reported): Duloxetine · Helped: Did not help · Side effects: Not given · Why stopped: Not given\nWorried about work.';
  let w=checkin(seedWorkspace(),'TN-1042',{pain:6,sleep:5,fn:3,note:previsit,at:'2026-09-17T09:00:00Z',recordedAt:'2026-09-17T08:00:00Z'});
  const q=latestQuestionnaire(get(w,'TN-1042'),w),reviewedAt='2026-09-17T12:00:00Z';
  w=applyAction(w,actionSchema.parse({type:'questionnaire.review',patientId:'TN-1042',recordId:q.record.id,version:q.record.version}),'Dr. Maya Chen',reviewedAt);
  // Two daily check-ins on later days with function skipped: pain, sleep and mood only, with the patient's own words on the second.
  w=checkin(w,'TN-1042',{pain:7,sleep:4,note:'Check-in type: Daily\nMood 4/10',at:'2026-09-18T09:00:00Z',recordedAt:'2026-09-18T08:00:00Z'});
  w=checkin(w,'TN-1042',{pain:8,sleep:3,note:'Check-in type: Daily\nMood 2/10\nRough night after the long shift.',at:'2026-09-19T09:00:00Z'});
  const p=get(w,'TN-1042'),after=latestQuestionnaire(p,w),daily=latestDailyCheckin(p,w);
  assert.equal(after.record.id,q.record.id,'The card keeps the pre-visit submission');
  assert.deepEqual(after.answers,{pain:6,function:3,sleep:5});assert.equal(after.concerns,'Worried about work.');assert.equal(after.medicines.tried,1);
  assert.deepEqual(after.review,{actor:'Dr. Maya Chen',date:reviewedAt},'A daily check-in does not reset the review');
  assert.deepEqual([daily.date,daily.kind,daily.answers,daily.mood],['2026-09-19T09:00:00Z','daily',{pain:8,sleep:3},2]);
  assert.ok(!p.checkins.some(c=>c.workflowRecordId===daily.record.id),'A partial check-in adds no chart check-in, so its words must come from the record');
  const html=render(w,p),card=html.match(/<section id="visit-questionnaire"[\s\S]*?<\/section>/)[0];
  for(const text of ['Pre-visit questionnaire','Reviewed by Dr. Maya Chen','Worried about work.','Latest daily check-in, Sep 19','Pain 8 / 10 · Sleep 3 / 10 · Mood 2 / 10','do not replace these answers or their review'])assert.ok(card.includes(text),text);
  assert.doesNotMatch(card,/Awaiting clinician review|>Mark reviewed<|Check-in type/);
  // "From the patient" shows the patient's own words from the daily check-in, never the fixed lines.
  const voice=html.match(/<section class="visit-patient-voice"[\s\S]*?<\/section>/)[0];
  assert.match(voice,/Rough night after the long shift\./);assert.doesNotMatch(voice,/Check-in type|Mood 2\/10/);
  // A daily record is never reviewed as a questionnaire, so the audit label stays accurate.
  assert.throws(()=>act(w,{type:'questionnaire.review',patientId:'TN-1042',recordId:daily.record.id,version:daily.record.version}),/Only a pre-visit questionnaire can be marked reviewed/);
  // A patient who only sends daily check-ins has no questionnaire to review.
  const only=checkin(seedWorkspace(),'TN-1038',{pain:3,sleep:7,note:'Check-in type: Daily\nMood 6/10'}),james=get(only,'TN-1038');
  assert.equal(latestQuestionnaire(james,only),null);
  const empty=render(only,james).match(/<section id="visit-questionnaire"[\s\S]*?<\/section>/)[0];
  for(const text of ['Pre-visit questionnaire','No pre-visit questionnaire submitted yet.','Latest daily check-in','Pain 3 / 10 · Sleep 7 / 10 · Mood 6 / 10'])assert.ok(empty.includes(text),text);
  assert.doesNotMatch(empty,/Awaiting clinician review|Mark reviewed|Function/);
});

test('the questionnaire card counts every patient-reported kind and keeps "affecting your pain" as its own row',()=>{
  const report={...emptyMedicationReport(),cannotTakeAnswer:'yes',cannotTake:[{name:'',reason:'Allergic reaction',details:'Hives',unknown:{...emptyUnidentified(),form:'Pill',color:'white'}}],
    takingNow:[{name:'Zolpidem',dose:'5 mg nightly',category:'sleep-anxiety'},{name:'Fish oil',dose:'',category:'supplement'},{name:'CBD oil',dose:'',category:'herbal'}]};
  const note=['Check-in type: Pre-visit',medicationReportNote(report),affectingPainNote({factors:['Stress','Work'],words:'',declined:false}),'Hard to sleep before shifts.'].join('\n');
  const w=checkin(seedWorkspace(),'TN-1042',{note}),q=latestQuestionnaire(get(w,'TN-1042'),w);
  // Four medicines: one the patient cannot take and cannot name, and three taken now. The unnamed one is counted once.
  assert.deepEqual(q.medicines,{answered:true,cannotTake:1,tried:0,takingNow:3,alsoOnRecord:0,notNamed:{cannotTake:1,tried:0,takingNow:0,other:0},allergicReaction:true,kinds:['Sleep or anxiety medicine','Supplement or vitamin','Herbal or CBD product']});
  assert.equal(q.concerns,'Hard to sleep before shifts.','Only the patient’s own words are concerns');
  assert.equal(q.affecting,'Stress, Work');
  const card=render(w,get(w,'TN-1042')).match(/<section id="visit-questionnaire"[\s\S]*?<\/section>/)[0];
  for(const text of ['1 cannot take (allergic reaction reported; name not known for 1)','3 taking now, not on the record (sleep or anxiety medicine, supplement or vitamin, herbal or CBD product) · patient-reported','patient-reported, to verify','Also affecting pain:</span> Stress, Work','Hard to sleep before shifts.'])assert.ok(card.includes(text),text);
  assert.doesNotMatch(card,/No medicine answers|No medicines named|\(patient-reported\):|not named, described/,'The unnamed medicine is not counted a second time');
  // A pain-only answer is still summarized, not listed as a concern.
  const pain=checkin(seedWorkspace(),'TN-1042',{note:'Check-in type: Pre-visit\n'+affectingPainNote({factors:[],words:'My dog passed away',declined:false})}),pq=latestQuestionnaire(get(pain,'TN-1042'),pain);
  assert.deepEqual([pq.concerns,pq.affecting,pq.medicines.answered],['','My dog passed away',false]);
});

test('a later check-in that answers only another question keeps the earlier medicine answers on the visit tab',()=>{
  const allergy=medicationReportNote({...emptyMedicationReport(),cannotTakeAnswer:'yes',cannotTake:[{name:'Duloxetine',reason:'Allergic reaction',details:'Rash'}]});
  let w=checkin(seedWorkspace(),'TN-1042',{fn:4,note:'Check-in type: Pre-visit\n'+allergy,at:'2026-09-20T09:00:00Z',recordedAt:'2026-09-20T08:00:00Z'});
  w=checkin(w,'TN-1042',{fn:4,note:'Check-in type: Daily\n'+affectingPainNote({factors:['Stress'],words:'',declined:false}),at:'2026-09-22T09:00:00Z',recordedAt:'2026-09-22T08:00:00Z'});
  const block=render(w,get(w,'TN-1042')).match(/<section class="visit-patient-medicines"[\s\S]*?<\/section>/)[0];
  for(const text of ['Latest answer to each question','Cannot take · Sep 20','Duloxetine','Reason: Allergic reaction','Also affecting pain · Sep 22','Stress'])assert.ok(block.includes(text),text);
});

test('the Needs attention chip matches the rail badge without repeating the open count',()=>{
  const w=seedWorkspace(),chip=id=>render(w,get(w,id)).match(/<a href="#visit-concerns"[^>]*>[\s\S]*?<\/a>/)[0],badge=id=>render(w,get(w,id)).match(/<div class="visit-concerns-heading">[\s\S]*?<\/div>/)?.[0]??'';
  assert.match(chip('TN-1042'),/1 high priority/);assert.match(badge('TN-1042'),/1 high priority/);
  assert.match(chip('TN-1051'),/Medium priority/);assert.match(badge('TN-1051'),/Medium priority/);
  assert.deepEqual([visitGlance(get(w,'TN-1051'),w).highPriority,visitGlance(get(w,'TN-1051'),w).topPriority],[0,'Medium']);
  assert.match(chip('TN-1055'),/Routine priority/);assert.match(badge('TN-1055'),/Routine priority/);
  assert.match(chip('TN-1038'),/None open/);assert.match(render(w,get(w,'TN-1038')),/No unresolved concerns/);
  for(const id of ['TN-1042','TN-1051','TN-1055','TN-1038'])assert.doesNotMatch(chip(id),/No high priority|open review/);
});

test('previously tried is listed once, and the treatment decisions summary never contradicts it',()=>{
  const w=ensureShowcaseData(seedWorkspace(),'Dr. Maya Chen','2026-09-20T09:00:00Z'),html=render(w,get(w,'TN-1031'));
  assert.equal((html.match(/<h3>Previously tried/g)??[]).length,1,'One Previously tried section on the tab');
  assert.match(html,/A prior pregabalin trial was stopped by a previous clinician/);
  assert.doesNotMatch(html,/previous medication trials ·|0 previous medication trials/);
  assert.match(html,/Treatment decisions <small>\d+ options discussed<\/small>/);
});

test('the rail adds the signed-visit comparison the Advisor gives, beside the report-to-report rows',()=>{
  const w=ensureShowcaseData(seedWorkspace(),'Dr. Maya Chen','2026-09-20T09:00:00Z'),p=get(w,'TN-DEMO-01');
  for(const date of ['2026-09-23T08:00:00Z','2026-09-24T08:00:00Z']){p.dates.push(date);p.pain.push(8);p.function.push(4);p.sleep.push(3);}
  const visit=sinceSignedVisit(p,w),dock=advisorSuggestions(p,w,'visit').find(s=>s.id==='changes');
  assert.deepEqual(dock.points.slice(0,visit.points.length),visit.points,'Rail and Advisor state the same lines');
  assert.match(visit.points.join(' '),/Pain 5 → 8\/10 \(worse\)/);
  const rail=render(w,p).match(/<section class="visit-changes"[\s\S]*?<\/section>/)[0];
  assert.match(rail,/Since the prior report/);assert.match(rail,/No changes found in comparable recorded outcomes/,'Day-over-day rows stay report-to-report');
  assert.ok(rail.includes('Since the last signed visit, Sep 20:</strong> '+visit.points.join(' · ')),'The same comparison, with the same signed-visit anchor');
  assert.match(rail,/compares reports, not visits/);
  const plain=seedWorkspace();assert.equal(sinceSignedVisit(get(plain,'TN-1042'),plain),null);
  assert.doesNotMatch(render(plain,get(plain,'TN-1042')),/Since the last signed visit/);
});

test('previously tried medications use the same indication groups as current medications, on the visit tab and the treatment course',()=>{
  const w=seedWorkspace(),p=get(w,'TN-DEMO-01');
  const base=structuredClone(p.medications[0]);
  p.medications=p.medications.filter(m=>m.status!=='Stopped');
  p.medications.push({...base,id:'stopped-pain',name:'Pregabalin',status:'Stopped',indication:'Neuropathic pain',stopped:'2026-05-01'},{...base,id:'stopped-other',name:'Zolpidem',status:'Stopped',indication:'Insomnia',stopped:'2026-04-01'},{...base,id:'stopped-unknown',name:'Tramadol',status:'Stopped',indication:'',stopped:'2026-03-01'});
  const html=render(w,p).match(/<section class="visit-previously-tried"[\s\S]*?<\/section>/)[0];
  const at=text=>{const index=html.indexOf(text);assert.ok(index>=0,text+' is listed');return index;};
  assert.ok(at('aria-label="Previously tried · Analgesic medications"')<at('Pregabalin')&&at('Pregabalin')<at('aria-label="Previously tried · Other medications"'));
  assert.ok(at('aria-label="Previously tried · Other medications"')<at('Zolpidem')&&at('Zolpidem')<at('aria-label="Previously tried · Indication needs confirmation"'));
  assert.ok(at('aria-label="Previously tried · Indication needs confirmation"')<at('Tramadol'));
  assert.match(html,/<h3>Previously tried<span>3<\/span><\/h3>/);
  p.medications=p.medications.filter(m=>m.id!=='stopped-other');
  assert.doesNotMatch(render(w,p),/Previously tried · Other medications/,'an empty group is left out');
  const course=renderToStaticMarkup(React.createElement(TreatmentCourse,{p,ctx:ctx(w)}));
  assert.ok(course.indexOf('Previously tried · Analgesic medications')<course.indexOf('Pregabalin')&&course.indexOf('Pregabalin')<course.indexOf('Previously tried · Indication needs confirmation'),'the treatment course groups the same way');
});

test('earlier treatment decisions are listed newest first with date, author, direction, goal status and decision, options folded',()=>{
  let w=seedWorkspace();const id='TN-1042';
  const review=(decision,direction,goalStatus,options,actor,at)=>{w=applyAction(w,actionSchema.parse({type:'treatment.review',patientId:id,direction,goalStatus,goalEvidence:goalStatus==='Not assessed'?'':'Walks 10 minutes.',decision,monitoring:'Weekly check-ins.',options}),actor,at);};
  const option={title:'Topical option',status:'Deferred',rationale:'Discussed with the patient.',considerations:'Skin tolerance.'};
  review('First decision recorded.','Finding a treatment','Not assessed',[option],'Dr. Maya Chen','2026-08-01T10:00:00Z');
  review('Second decision recorded.','Monitoring benefit','Partly met',[],'Alex Morgan, NP','2026-08-20T10:00:00Z');
  review('Current decision.','Monitoring benefit','Met',[],'Dr. Maya Chen','2026-09-10T10:00:00Z');
  const p=get(w,id),html=render(w,p),details=html.slice(html.indexOf('<details class="visit-treatment-history"'));
  assert.match(details,/Treatment decisions <small>0 options discussed · 2 earlier decisions<\/small>/);
  const earlier=details.slice(details.indexOf('aria-label="Earlier treatment decisions"'));
  assert.ok(earlier.indexOf('Second decision recorded.')>0&&earlier.indexOf('Second decision recorded.')<earlier.indexOf('First decision recorded.'),'newest first');
  assert.match(earlier,/<time dateTime="2026-08-20T10:00:00Z">Aug 20<\/time> · Alex Morgan, NP · Monitoring benefit · Goal: Partly met/);
  assert.match(earlier,/<details><summary>Options discussed <span>1<\/span><\/summary>[\s\S]*Topical option[\s\S]*Deferred[\s\S]*Skin tolerance\./);
  assert.doesNotMatch(earlier.slice(0,earlier.indexOf('</ol>')),/Current decision\./,'the current review is not repeated as earlier');
  const course=renderToStaticMarkup(React.createElement(TreatmentCourse,{p,ctx:ctx(w)}));
  assert.ok(course.includes('Earlier treatment decisions <span>2</span>'),'the treatment course lists them too');
  assert.doesNotMatch(course,/retained in the record export/);
});

test('the composite help defines PEG and BPI in place',()=>{
  const w=seedWorkspace(),html=render(w,get(w,'TN-1042')),help=html.slice(html.indexOf('visit-composite-help'));
  for(const term of ['PEG','BPI'])assert.match(help.slice(0,help.indexOf('</details>')),new RegExp('class="glossary-term" title="[^"]+"[^>]*>'+term+'</button>'),term);
});
