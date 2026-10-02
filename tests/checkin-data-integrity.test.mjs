import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// What the clinician side reads from patient check-ins: only the current version of an updated check-in, legacy notes never
// assumed to be the pre-visit questionnaire, each version attributed from its own confirmation, and only the patient's words quoted.
const bundle=await build({stdin:{contents:"export {seedWorkspace} from './lib/theranetrix'; export {applyAction,actionSchema} from './lib/actions'; export {rankPst,pstHistorySummary} from './lib/pst-library'; export {latestQuestionnaire,latestDailyCheckin} from './lib/visit-presentation'; export {medicationReportNote,emptyMedicationReport} from './lib/patient-medication-report'; export {patientCheckinUpdateReason,patientSelfReports} from './lib/patient-checkin-note'; export {selfReportSources} from './lib/patient-reported-answers'; export {EncounterReview} from './components/theranetrix/encounter-review'; export {PatientOverview} from './components/theranetrix/patient-overview'; export {ObservationHistory} from './components/theranetrix/clinical-flows/observation-history';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {seedWorkspace,applyAction,actionSchema,rankPst,pstHistorySummary,latestQuestionnaire,latestDailyCheckin,medicationReportNote,emptyMedicationReport,patientCheckinUpdateReason,patientSelfReports,selfReportSources,EncounterReview,PatientOverview,ObservationHistory}=mod.exports;

const weights={analgesia:40,abuse:20,cognitive:20,sedation:20};
const get=(w,id='TN-1042')=>w.patients.find(p=>p.id===id);
const ctx=data=>({data,user:'Clinical reviewer',busy:false,save:async()=>true,open:()=>{}});
const visit=(w,id='TN-1042')=>renderToStaticMarkup(React.createElement(EncounterReview,{p:get(w,id),ctx:ctx(w),changeTab:()=>{}}));
const section=(html,pattern)=>html.match(pattern)?.[0]??'';
// PST as the treatment screen runs it: with every current self-report record, not only the projected check-ins.
const pstFlags=(w,id,patientId='TN-1042')=>rankPst(get(w,patientId),weights,false,{reportSources:selfReportSources(get(w,patientId),w.clinicalWorkflows.slices.encounters.state.observations)}).all.find(r=>r.id===id).history.filter(h=>h.source==='patient-reported').map(h=>h.kind);
// The companion's own command: a 'checkin-' encounter, and a same-day update of it with the companion's update reason.
function save(w,{patientId='TN-1042',encounterId,expectedVersion,pain=5,fn,sleep=6,note,at,actor='Shared workspace visitor'}){
  const requestId=crypto.randomUUID(),answer=value=>value===undefined?{status:'unanswered'}:{status:value===0?'zero':'answered',value};
  const entries=[['pain',pain],['function',fn],['sleep',sleep]].map(([metric,value])=>({metric,...answer(value),source:'Patient self-report',recordedAt:at}));
  return applyAction(w,actionSchema.parse({type:'workflow.apply',domain:'encounters',patientId,requestId,expectedSliceVersion:w.clinicalWorkflows.slices.encounters.version,command:{type:'encounters.observations.save',requestId,patientId,encounterId,...(expectedVersion?{expectedVersion,correctionReason:patientCheckinUpdateReason}:{}),instrument:'local-0-10',submissionStatus:'confirmed',submissionSource:'patient-self-report',patientNote:note,entries}}),actor,at);
}

test('an answer the patient removes when updating today’s check-in is gone from PST and the visit tab',()=>{
  const allergy=medicationReportNote({...emptyMedicationReport(),cannotTakeAnswer:'yes',cannotTake:[{name:'Duloxetine',reason:'Allergic reaction',details:''}]});
  const flags=w=>{const onCheckins=rankPst(get(w),weights).all.find(r=>r.id==='duloxetine').history.filter(h=>h.source==='patient-reported').map(h=>h.kind);assert.deepEqual(pstFlags(w,'duloxetine'),onCheckins,'The treatment screen and check-in-only PST agree');return onCheckins;};
  const reported=w=>section(visit(w),/<section class="visit-patient-medicines"[\s\S]*?<\/section>/);
  for(const updatedFn of [4,undefined]){
    let w=save(seedWorkspace(),{encounterId:'checkin-r1',fn:4,note:'Check-in type: Pre-visit\n'+allergy,at:'2026-09-20T08:00:00.000Z'});
    assert.deepEqual(flags(w),['cannot-take']);assert.match(reported(w),/Duloxetine/);
    // The patient clears the cannot-take answer. With function answered the update is projected beside the first version;
    // with function left unanswered it is not projected at all. Either way the first version is history only.
    w=save(w,{encounterId:'checkin-r1',expectedVersion:1,pain:6,fn:updatedFn,note:'Check-in type: Pre-visit\nCannot take (patient-reported): None',at:'2026-09-20T09:00:00.000Z'});
    assert.ok(get(w).checkins.some(c=>c.encounterId==='checkin-r1'&&c.workflowVersion===1&&/Duloxetine/.test(c.note)),'The first version stays in the chart history');
    assert.deepEqual(flags(w),[],'PST reads only the current version');
    assert.doesNotMatch(reported(w),/Duloxetine|Allergic reaction/,'The visit tab reads only the current version');assert.match(reported(w),/None reported/);
  }
});

test('an answer the patient keeps when an update leaves a measure unanswered stays in PST and the visit tab',()=>{
  const allergy=medicationReportNote({...emptyMedicationReport(),cannotTakeAnswer:'yes',cannotTake:[{name:'Duloxetine',reason:'Allergic reaction',details:''}]});
  const reported=w=>section(visit(w),/<section class="visit-patient-medicines"[\s\S]*?<\/section>/);
  let w=save(seedWorkspace(),{encounterId:'checkin-k1',fn:4,note:'Check-in type: Pre-visit\n'+allergy,at:'2026-09-20T08:00:00.000Z'});
  assert.deepEqual(pstFlags(w,'duloxetine'),['cannot-take']);
  // The update keeps the cannot-take answer but leaves function unanswered, so it projects no check-in of its own.
  w=save(w,{encounterId:'checkin-k1',expectedVersion:1,pain:6,note:'Check-in type: Pre-visit\n'+allergy,at:'2026-09-20T09:00:00.000Z'});
  assert.ok(!get(w).checkins.some(c=>c.encounterId==='checkin-k1'&&c.workflowVersion===2),'The update is not projected as a check-in');
  assert.deepEqual(pstFlags(w,'duloxetine'),['cannot-take'],'PST still reads the kept answer from the current record');
  assert.match(reported(w),/Duloxetine/);
  // A second update removes it: it does not come back from either earlier version.
  w=save(w,{encounterId:'checkin-k1',expectedVersion:2,pain:6,note:'Check-in type: Pre-visit\nCannot take (patient-reported): None',at:'2026-09-20T10:00:00.000Z'});
  assert.deepEqual(pstFlags(w,'duloxetine'),[]);
  assert.doesNotMatch(reported(w),/Duloxetine/);
});

test('a clinician correction of an earlier check-in does not make its medicine answers newer than a later check-in',()=>{
  const allergy=medicationReportNote({...emptyMedicationReport(),cannotTakeAnswer:'yes',cannotTake:[{name:'Duloxetine',reason:'Allergic reaction',details:''}]});
  const reported=w=>section(visit(w),/<section class="visit-patient-medicines"[\s\S]*?<\/section>/);
  let w=save(seedWorkspace(),{encounterId:'checkin-a',fn:4,note:'Check-in type: Daily\n'+allergy,at:'2026-09-18T08:00:00.000Z'});
  w=save(w,{encounterId:'checkin-b',fn:4,note:'Check-in type: Daily\nCannot take (patient-reported): None',at:'2026-09-20T08:00:00.000Z'});
  assert.deepEqual(pstFlags(w,'duloxetine'),[]);
  const requestId=crypto.randomUUID();
  w=applyAction(w,actionSchema.parse({type:'workflow.apply',domain:'encounters',patientId:'TN-1042',requestId,expectedSliceVersion:w.clinicalWorkflows.slices.encounters.version,command:{type:'encounters.observations.correct',requestId,patientId:'TN-1042',encounterId:'checkin-a',expectedVersion:1,reason:'Clarified with the patient at the visit.',replacement:{metric:'sleep',status:'answered',value:4,source:'Patient clarification at visit',recordedAt:'2026-09-21T11:00:00.000Z'}}}),'Dr. Maya Chen','2026-09-21T11:00:00.000Z');
  assert.deepEqual(pstFlags(w,'duloxetine'),[],'the patient’s newer answer still wins');
  assert.doesNotMatch(reported(w),/Duloxetine/);assert.match(reported(w),/None reported/);
});

test('a medicine already active on the record reads as “the patient also reports taking it”, never “not on the record”',()=>{
  const p=get(seedWorkspace());
  p.checkins=[{id:'now',date:'2026-09-20T08:00:00Z',pain:5,sleep:5,function:5,note:medicationReportNote({...emptyMedicationReport(),takingNow:[{name:'Gabapentin',dose:'300 mg at night',category:''},{name:'Nortriptyline',dose:'',category:''}]})}];
  const flag=id=>rankPst(p,weights).all.find(r=>r.id===id).history.find(h=>h.kind==='reported-current');
  assert.ok(rankPst(p,weights).all.find(r=>r.id==='gabapentin').current,'Gabapentin is an active medication on this record');
  assert.equal(pstHistorySummary(flag('gabapentin')),'Gabapentin: the patient also reports taking it, reported 2026-09-20 (patient-reported, not verified)');
  assert.equal(pstHistorySummary(flag('nortriptyline')),'Nortriptyline: the patient reports taking it now, not on the record, reported 2026-09-20 (patient-reported, not verified)');
  // Once the record no longer lists it as active, "not on the record" is true again.
  for(const m of p.medications)if(/gabapentin/i.test(m.name))m.status='Stopped';
  assert.match(pstHistorySummary(flag('gabapentin')),/taking it now, not on the record/);
});

test('a check-in saved before the type line is never shown or reviewed as the pre-visit questionnaire',()=>{
  let w=save(seedWorkspace(),{encounterId:'checkin-q',fn:3,note:'Check-in type: Pre-visit\nWorried about work.',at:'2026-09-17T08:00:00.000Z'});
  const q=latestQuestionnaire(get(w),w);
  w=applyAction(w,actionSchema.parse({type:'questionnaire.review',patientId:'TN-1042',recordId:q.record.id,version:q.record.version}),'Dr. Maya Chen','2026-09-17T12:00:00.000Z');
  // The daily form before the type line: pain, sleep, mood and the location it filled in; function not asked.
  w=save(w,{encounterId:'checkin-legacy',pain:7,sleep:4,note:'Location: Both feet\nMood 4/10',at:'2026-09-18T08:00:00.000Z'});
  let p=get(w),card=()=>section(visit(w),/<section id="visit-questionnaire"[\s\S]*?<\/section>/);
  assert.equal(latestQuestionnaire(p,w).record.id,q.record.id,'The reviewed questionnaire stays the questionnaire');assert.equal(latestQuestionnaire(p,w).review.actor,'Dr. Maya Chen');
  assert.deepEqual([latestDailyCheckin(p,w).record.encounterId,latestDailyCheckin(p,w).kind],['checkin-legacy','daily']);
  for(const text of ['Reviewed by Dr. Maya Chen','Latest daily check-in, Sep 18','Pain 7 / 10 · Sleep 4 / 10 · Mood 4 / 10','Worried about work.'])assert.ok(card().includes(text),text);
  assert.doesNotMatch(card(),/Awaiting clinician review|>Mark reviewed</);
  // An untyped note with more than the daily questions has no recorded type: listed beside the questionnaire, never offered for review.
  w=save(w,{encounterId:'checkin-untyped',fn:5,note:'Location: Both feet\nCannot take (patient-reported): None\nCall me after 3 pm',at:'2026-09-19T08:00:00.000Z'});p=get(w);
  assert.equal(latestQuestionnaire(p,w).record.id,q.record.id);
  assert.deepEqual([latestDailyCheckin(p,w).record.encounterId,latestDailyCheckin(p,w).kind],['checkin-untyped',undefined]);
  assert.ok(card().includes('Latest check-in, type not recorded, Sep 19'));assert.doesNotMatch(card(),/Awaiting clinician review|>Mark reviewed</);
  // With only an untyped check-in there is no questionnaire to review.
  const only=save(seedWorkspace(),{patientId:'TN-1038',encounterId:'checkin-only',fn:5,note:'Location: Low back\nTried before (patient-reported): Not sure\nWorse at night',at:'2026-09-19T08:00:00.000Z'});
  assert.equal(latestQuestionnaire(get(only,'TN-1038'),only),null);
  const empty=section(visit(only,'TN-1038'),/<section id="visit-questionnaire"[\s\S]*?<\/section>/);
  // The empty state says an older check-in exists instead of implying the patient sent nothing.
  assert.ok(empty.includes('No check-in is recorded as the pre-visit questionnaire. 1 earlier check-in was saved before the check-in type was recorded and stays in the patient trajectory.'),empty);
  assert.ok(empty.includes('Latest check-in, type not recorded'));assert.doesNotMatch(empty,/Mark reviewed|No pre-visit questionnaire submitted yet/);
});

test('a medicine the patient reports taking that is already on the record is marked, not counted as missing from it',()=>{
  const report=medicationReportNote({...emptyMedicationReport(),takingNow:[{name:'Gabapentin',dose:'300 mg at night',category:''},{name:'Magnesium',dose:'',category:''}]});
  const w=save(seedWorkspace(),{encounterId:'checkin-on-record',fn:4,note:'Check-in type: Pre-visit\n'+report,at:'2026-09-20T08:00:00.000Z'});
  const q=latestQuestionnaire(get(w),w);
  assert.deepEqual([q.medicines.takingNow,q.medicines.alsoOnRecord],[1,1]);
  const html=visit(w),card=section(html,/<section id="visit-questionnaire"[\s\S]*?<\/section>/),reported=section(html,/<section class="visit-patient-medicines"[\s\S]*?<\/section>/);
  assert.ok(card.includes('1 taking now, not on the record'),card);assert.ok(card.includes('1 taking now, also on the record'),card);
  assert.match(reported,/<strong>Gabapentin<\/strong><em>Also on the record<\/em>/);assert.doesNotMatch(reported,/<strong>Magnesium<\/strong><em>/);
});

test('each version of an updated check-in is attributed from its own confirmation, in observation history and in the notes',()=>{
  const note='Check-in type: Daily\nMood 5/10';
  let w=save(seedWorkspace(),{encounterId:'checkin-v',fn:4,note,at:'2026-09-20T08:00:00.000Z',actor:'Clinician account'});
  w=save(w,{encounterId:'checkin-v',expectedVersion:1,pain:6,fn:4,note,at:'2026-09-20T09:00:00.000Z',actor:'Clinician account'});
  w=save(w,{encounterId:'checkin-v',expectedVersion:2,pain:7,fn:4,note,at:'2026-09-20T10:00:00.000Z',actor:'Clinician account'});
  // A clinician then corrects sleep from a source; that version is theirs.
  const requestId=crypto.randomUUID();
  w=applyAction(w,actionSchema.parse({type:'workflow.apply',domain:'encounters',patientId:'TN-1042',requestId,expectedSliceVersion:w.clinicalWorkflows.slices.encounters.version,command:{type:'encounters.observations.correct',requestId,patientId:'TN-1042',encounterId:'checkin-v',expectedVersion:3,reason:'Clarified with the patient at the visit.',replacement:{metric:'sleep',status:'answered',value:4,source:'Patient clarification at visit',recordedAt:'2026-09-20T11:00:00.000Z'}}}),'Dr. Maya Chen','2026-09-20T11:00:00.000Z');
  const p=get(w),html=renderToStaticMarkup(React.createElement(ObservationHistory,{patient:{...p,workflowObservations:p.workflowObservations.filter(entry=>entry.encounterId==='checkin-v')},selfReports:patientSelfReports(w,p.id)}));
  const rows=html.match(/<tr[^>]*data-observation-status[\s\S]*?<\/tr>/g)??[],byVersion=version=>rows.filter(row=>row.includes('</span> · version '+version+'</div>'));
  for(const version of [2,3]){assert.ok(byVersion(version).length>0,'version '+version);for(const row of byVersion(version)){assert.match(row,/Updated by patient/);assert.doesNotMatch(row,/Clinician account/);}}
  assert.ok(byVersion(1).every(row=>/Submitted by patient/.test(row)));
  assert.ok(byVersion(4).length===1&&/Dr\. Maya Chen/.test(byVersion(4)[0]),'The clinician correction keeps its actor');
  const notes=p.notes.filter(n=>n.encounterId==='checkin-v').map(n=>[n.workflowVersion,n.type,n.author]).sort((a,b)=>a[0]-b[0]);
  assert.deepEqual(notes,[[1,'Patient-submitted report','Submitted by patient'],[2,'Patient-updated report','Updated by patient'],[3,'Patient-updated report','Updated by patient'],[4,'Corrected observation report','Dr. Maya Chen']]);
});

test('a note saved for a patient update before updates were labelled is relabelled from its own confirmation',()=>{
  const note='Check-in type: Daily\nMood 5/10';
  let w=save(seedWorkspace(),{encounterId:'checkin-old',fn:4,note,at:'2026-09-20T08:00:00.000Z',actor:'Clinician account'});
  w=save(w,{encounterId:'checkin-old',expectedVersion:1,pain:6,fn:4,note,at:'2026-09-20T09:00:00.000Z',actor:'Clinician account'});
  // What the earlier bridge stored for the patient's update.
  Object.assign(get(w).notes.find(n=>n.encounterId==='checkin-old'&&n.workflowVersion===2),{type:'Corrected observation report',author:'Clinician account'});
  // Any later encounter update runs the bridges again.
  w=save(w,{patientId:'TN-1038',encounterId:'checkin-other',fn:4,note,at:'2026-09-20T10:00:00.000Z'});
  const relabelled=get(w).notes.find(n=>n.encounterId==='checkin-old'&&n.workflowVersion===2);
  assert.deepEqual([relabelled.type,relabelled.author],['Patient-updated report','Updated by patient']);
});

test('the Overview quotes only the patient’s own words from their latest check-in',()=>{
  const note='Check-in type: Daily\nMood: Prefer not to answer\nCannot take (patient-reported): Codeine · Reason: Allergic reaction · What happened: Hives\nRough night after the long shift.';
  const w=save(seedWorkspace(),{encounterId:'checkin-o',fn:4,note,at:'2026-09-24T08:00:00.000Z'});
  const html=renderToStaticMarkup(React.createElement(PatientOverview,{p:get(w),ctx:ctx(w),changeTab:()=>{}}));
  const quote=section(html,/<div class="patient-voice-note">[\s\S]*?<\/div>/);
  assert.ok(quote.includes('“Rough night after the long shift.”'),quote);
  assert.doesNotMatch(quote,/Check-in type|Prefer not to answer|Codeine|patient-reported/);
});

test('the server refuses to mark a daily or untyped check-in reviewed as a questionnaire',()=>{
  let w=save(seedWorkspace(),{encounterId:'checkin-legacy-2',pain:7,sleep:4,note:'Location: Both feet\nMood 4/10',at:'2026-09-18T08:00:00.000Z'});
  w=save(w,{encounterId:'checkin-untyped-2',fn:5,note:'Location: Both feet\nCall me after 3 pm',at:'2026-09-19T08:00:00.000Z'});
  for(const encounterId of ['checkin-legacy-2','checkin-untyped-2']){
    const record=patientSelfReports(w,'TN-1042').find(r=>r.encounterId===encounterId);
    assert.throws(()=>applyAction(w,actionSchema.parse({type:'questionnaire.review',patientId:'TN-1042',recordId:record.id,version:record.version}),'Dr. Maya Chen','2026-09-19T12:00:00.000Z'),/Only a pre-visit questionnaire can be marked reviewed/,encounterId);
  }
});
