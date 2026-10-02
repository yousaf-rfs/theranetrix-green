import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {runScenarios} from './fixtures/patient-coordination-scenarios.mjs';

const bundle=await build({stdin:{contents:"export * from './lib/clinical-flows/patient-coordination'; export {PatientCoordinationPanel} from './components/theranetrix/clinical-flows/patient-coordination';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'},write:false});
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {initialState,validateState,actionSchema,reduce,getSummary,latestLanguageAccess,reviewedPlanTranslation,PatientCoordinationPanel}=mod.exports;

const patients=[{id:'TN-100',name:'Taylor North'},{id:'TN-200',name:'Jordan West'}];
const context=(now='2026-09-17T18:30:00Z',actor='Coordinator Example')=>({actor,now,patients,features:{}});
const act=(state,action,ctx=context())=>reduce(state,actionSchema.parse(action),ctx);
const render=props=>renderToStaticMarkup(React.createElement(PatientCoordinationPanel,props));

test('patient support keeps plan/version links, summary attribution, chronology, idempotency, and non-mutation',()=>{
  const start=initialState();
  const before=structuredClone(start);
  const action={type:'patient-coordination.support.save',requestId:'req-support-1',patientId:'TN-100',encounterId:'ENC-1',conversationDate:'2026-09-17',planId:'plan-44',planVersion:3,goalText:'Walk to the mailbox twice daily.',approvedEducation:['Pain plan copy','Scheduling checklist'],reminderChannel:'phone',optedOut:false,dueCheckInDate:'2026-09-20',originalText:'Please call after 5 pm and use the saved plan we reviewed.',attributedSummary:'Patient asked for after-work reminders that point back to the saved plan.',summaryAuthor:'Coordinator Example',participationMode:'staff-recorded',participant:'patient',recordedSource:'Phone call documented by authorized staff'};
  const saved=act(start,action);
  assert.deepEqual(start,before);
  assert.equal(saved.support[0].planRef.planVersion,3);
  assert.equal(saved.support[0].participation.mode,'staff-recorded');
  assert.equal(saved.support[0].summaryAuthor,'Coordinator Example');
  assert.equal(saved.support[0].history.length,0);
  const duplicate=act(saved,action);
  assert.equal(duplicate.support.length,1);
  assert.equal(duplicate.receipts.length,1);
  assert.throws(()=>act(saved,{...action,requestId:'req-support-2',id:saved.support[0].id,expectedVersion:99}),/changed/);
  assert.throws(()=>act(saved,{...action,id:saved.support[0].id,expectedVersion:saved.support[0].version,patientId:'TN-200',requestId:'req-support-3'}),/selected patient/);
});

test('handoffs enforce evidence boundaries, retain duplicates, keep high priority and unaccepted handoffs discoverable without guessing coverage, and prevent silent closure',()=>{
  let state=initialState();
  state=act(state,{type:'patient-coordination.handoff.save',requestId:'handoff-1',patientId:'TN-100',encounterId:'ENC-1',concern:'New pain flare reported after hours.',dedupeKey:'pain-flare-2026-09-17',priority:'high',urgencySourceType:'authorized-human',urgencySource:'RN callback assessment',responsibleTeam:'Pain team',responsiblePerson:'Taylor RN',coverageExpectation:'Respond within the documented after-hours queue.',fallbackOwner:'On-call clinician',phase:'locally-saved',deliveryStatus:'pending',deliveryEvidenceSource:'none',patientContactStatus:'not-attempted',transitionReason:'Saved the new concern locally.'},context('2026-09-17T19:05:00Z','After hours RN'));
  assert.equal(getSummary(state,'TN-100').attention.some(item=>item.includes('Handoff awaiting delivery and accepted ownership')),true);
  assert.equal(getSummary(state,'TN-100').attention.some(item=>item.includes('High-priority handoff')),true);
  assert.throws(()=>act(state,{type:'patient-coordination.handoff.save',requestId:'handoff-2',id:state.handoffs[0].id,expectedVersion:state.handoffs[0].version,patientId:'TN-100',encounterId:'ENC-1',concern:state.handoffs[0].concern,dedupeKey:state.handoffs[0].dedupeKey,priority:'high',urgencySourceType:'authorized-human',urgencySource:'RN callback assessment',responsibleTeam:'Pain team',responsiblePerson:'Taylor RN',coverageExpectation:'Respond within the documented after-hours queue.',fallbackOwner:'On-call clinician',phase:'delivery-reported',deliveryStatus:'reported',deliveryEvidenceSource:'none',patientContactStatus:'attempted',transitionReason:'Pretend delivery happened.'}),/real receipt or explicit manual source/);
  const duplicate=act(state,{type:'patient-coordination.handoff.save',requestId:'handoff-dup',patientId:'TN-100',encounterId:'ENC-1',concern:'Same concern from spouse adds context.',dedupeKey:'pain-flare-2026-09-17',priority:'high',urgencySourceType:'authorized-human',urgencySource:'RN callback assessment',responsibleTeam:'Pain team',responsiblePerson:'Taylor RN',coverageExpectation:'Respond within the documented after-hours queue.',fallbackOwner:'On-call clinician',phase:'locally-saved',deliveryStatus:'pending',deliveryEvidenceSource:'none',patientContactStatus:'not-attempted',transitionReason:'Merged duplicate concern context.'},context('2026-09-17T19:06:00Z','After hours RN'));
  assert.equal(duplicate.handoffs.length,1);
  assert.equal(duplicate.handoffs[0].duplicates.length,1);
  state=act(state,{type:'patient-coordination.handoff.save',requestId:'handoff-3',id:state.handoffs[0].id,expectedVersion:state.handoffs[0].version,patientId:'TN-100',encounterId:'ENC-1',concern:state.handoffs[0].concern,dedupeKey:state.handoffs[0].dedupeKey,priority:'high',urgencySourceType:'authorized-human',urgencySource:'RN callback assessment',responsibleTeam:'Pain team',responsiblePerson:'Taylor RN',coverageExpectation:'Respond within the documented after-hours queue.',fallbackOwner:'On-call clinician',phase:'delivery-reported',deliveryStatus:'reported',deliveryEvidenceSource:'manual',deliveryEvidenceRef:'Spoken handoff to overnight clinician',patientContactStatus:'attempted',transitionReason:'Manual verbal receipt confirmed.'},context('2026-09-17T19:15:00Z','After hours RN'));
  state=act(state,{type:'patient-coordination.handoff.save',requestId:'handoff-3b',id:state.handoffs[0].id,expectedVersion:state.handoffs[0].version,patientId:'TN-100',encounterId:'ENC-1',concern:state.handoffs[0].concern,dedupeKey:state.handoffs[0].dedupeKey,priority:'high',urgencySourceType:'authorized-human',urgencySource:'RN callback assessment',responsibleTeam:'Pain team',responsiblePerson:'Taylor RN',coverageExpectation:'Respond within the documented after-hours queue.',fallbackOwner:'On-call clinician',phase:'ownership-accepted',deliveryStatus:'reported',deliveryEvidenceSource:'manual',deliveryEvidenceRef:'Spoken handoff to overnight clinician',patientContactStatus:'attempted',transitionReason:'Owner accepted the handoff.'},context('2026-09-17T19:20:00Z','Overnight clinician'));
  state=act(state,{type:'patient-coordination.handoff.save',requestId:'handoff-3c',id:state.handoffs[0].id,expectedVersion:state.handoffs[0].version,patientId:'TN-100',encounterId:'ENC-1',concern:state.handoffs[0].concern,dedupeKey:state.handoffs[0].dedupeKey,priority:'high',urgencySourceType:'authorized-human',urgencySource:'RN callback assessment',responsibleTeam:'Pain team',responsiblePerson:'Taylor RN',coverageExpectation:'Respond within the documented after-hours queue.',fallbackOwner:'On-call clinician',phase:'reviewed',deliveryStatus:'reported',deliveryEvidenceSource:'manual',deliveryEvidenceRef:'Spoken handoff to overnight clinician',patientContactStatus:'attempted',transitionReason:'Reviewed the concern.'},context('2026-09-17T19:25:00Z','Overnight clinician'));
  state=act(state,{type:'patient-coordination.handoff.save',requestId:'handoff-3d',id:state.handoffs[0].id,expectedVersion:state.handoffs[0].version,patientId:'TN-100',encounterId:'ENC-1',concern:state.handoffs[0].concern,dedupeKey:state.handoffs[0].dedupeKey,priority:'high',urgencySourceType:'authorized-human',urgencySource:'RN callback assessment',responsibleTeam:'Pain team',responsiblePerson:'Taylor RN',coverageExpectation:'Respond within the documented after-hours queue.',fallbackOwner:'On-call clinician',phase:'action-documented',deliveryStatus:'reported',deliveryEvidenceSource:'manual',deliveryEvidenceRef:'Spoken handoff to overnight clinician',actionSummary:'Documented next-step review and callback plan.',patientContactStatus:'attempted',transitionReason:'Documented action.'},context('2026-09-17T19:30:00Z','Overnight clinician'));
  state=act(state,{type:'patient-coordination.handoff.save',requestId:'handoff-3e',id:state.handoffs[0].id,expectedVersion:state.handoffs[0].version,patientId:'TN-100',encounterId:'ENC-1',concern:state.handoffs[0].concern,dedupeKey:state.handoffs[0].dedupeKey,priority:'high',urgencySourceType:'authorized-human',urgencySource:'RN callback assessment',responsibleTeam:'Pain team',responsiblePerson:'Taylor RN',coverageExpectation:'Respond within the documented after-hours queue.',fallbackOwner:'On-call clinician',phase:'response-recorded',deliveryStatus:'reported',deliveryEvidenceSource:'manual',deliveryEvidenceRef:'Spoken handoff to overnight clinician',actionSummary:'Documented next-step review and callback plan.',responseSummary:'Attempted to reach patient and saved next follow-up.',patientContactStatus:'attempted',transitionReason:'Response recorded.'},context('2026-09-17T19:35:00Z','Overnight clinician'));
  const deliveryHistory=state.handoffs[0].history.find(entry=>entry.from==='locally-saved'&&entry.to==='delivery-reported');
  assert.ok(deliveryHistory);
  assert.throws(()=>act(state,{type:'patient-coordination.handoff.save',requestId:'handoff-4',id:state.handoffs[0].id,expectedVersion:state.handoffs[0].version,patientId:'TN-100',encounterId:'ENC-1',concern:state.handoffs[0].concern,dedupeKey:state.handoffs[0].dedupeKey,priority:'high',urgencySourceType:'authorized-human',urgencySource:'RN callback assessment',responsibleTeam:'Pain team',responsiblePerson:'Taylor RN',coverageExpectation:'Respond within the documented after-hours queue.',fallbackOwner:'On-call clinician',phase:'closed',deliveryStatus:'reported',deliveryEvidenceSource:'manual',deliveryEvidenceRef:'Spoken handoff to overnight clinician',patientContactStatus:'failed',patientContactFailureReason:'No answer',nextAttemptAt:'2026-09-17T20:00:00Z',transitionReason:'Trying to close without response.'}),/silently close/);
});

test('language access preserves partial support, unsupported translation boundaries, and auth safety for shared devices and revoked proxies',()=>{
  const state=act(initialState(),{type:'patient-coordination.language.save',requestId:'lang-1',patientId:'TN-100',encounterId:'ENC-1',preferredLanguage:'es',instructionsLanguage:'en',sourceText:'Please review the saved check-in reminder steps in English with an interpreter.',translationStatus:'unsupported',accessibilityPreferences:['teach-back','large-print'],teachBack:'Patient repeated the reminder steps in Spanish with caregiver support.',caregiverRole:'Adult daughter present for support',interpreterRole:'Spanish interpreter attributed only',sharedDevice:true,proxyStatus:'revoked',verifiedPatientAuth:false});
  assert.equal(state.language[0].translationStatus,'unsupported');
  assert.equal(getSummary(state,'TN-100').attention.some(item=>item.includes('partial')),true);
  assert.throws(()=>act(initialState(),{type:'patient-coordination.language.save',requestId:'lang-2',patientId:'TN-100',encounterId:'ENC-1',preferredLanguage:'es',instructionsLanguage:'es',sourceText:'Saved instructions',translatedText:'Texto no verificado',translationStatus:'unsupported',accessibilityPreferences:['teach-back'],teachBack:'Teach-back captured.',sharedDevice:false,proxyStatus:'none',verifiedPatientAuth:false}),/Unsupported translations/);
  assert.throws(()=>act(initialState(),{type:'patient-coordination.language.save',requestId:'lang-3',patientId:'TN-100',encounterId:'ENC-1',preferredLanguage:'en',instructionsLanguage:'en',sourceText:'Saved instructions',translationStatus:'not-needed',accessibilityPreferences:['teach-back'],teachBack:'Teach-back captured.',sharedDevice:true,proxyStatus:'revoked',verifiedPatientAuth:true}),/cannot claim verified patient authentication/);
});

test('pathways enforce prerequisites, stale version checks, duplicate event safety, wrong patient blocking, and non-mutation',()=>{
  const start=initialState();
  const before=structuredClone(start);
  let state=act(start,{type:'patient-coordination.pathway.save',requestId:'path-1',patientId:'TN-100',encounterId:'ENC-1',pathwayKey:'support-x1-local',pathwayVersion:'local-v1',currentVersion:true,eventId:'evt-1',transitionReason:'Start the local operational pathway.',stages:[{id:'stage-1',title:'Review access needs',activity:'Confirm language, support, and outreach constraints.',prerequisites:[],status:'pending',owner:'Care coordination',dueDate:'2026-09-18'}]});
  assert.deepEqual(start,before);
  const unchanged=act(state,{type:'patient-coordination.pathway.save',requestId:'path-2',id:state.pathways[0].id,expectedVersion:state.pathways[0].version,patientId:'TN-100',encounterId:'ENC-1',pathwayKey:'support-x1-local',pathwayVersion:'local-v1',currentVersion:true,eventId:'evt-1',transitionReason:'Duplicate upstream event.',stages:[{id:'stage-1',title:'Review access needs',activity:'Confirm language, support, and outreach constraints.',prerequisites:[],status:'pending',owner:'Care coordination',dueDate:'2026-09-18'}]});
  assert.equal(unchanged.pathways[0].version,state.pathways[0].version);
  assert.throws(()=>act(state,{type:'patient-coordination.pathway.save',requestId:'path-3',id:state.pathways[0].id,expectedVersion:state.pathways[0].version,patientId:'TN-100',encounterId:'ENC-1',pathwayKey:'support-x1-local',pathwayVersion:'local-v1',currentVersion:true,eventId:'evt-1',transitionReason:'Same event, different data.',stages:[{id:'stage-1',title:'Review access needs',activity:'Confirm language, support, and outreach constraints.',prerequisites:[],status:'completed',owner:'Care coordination',dueDate:'2026-09-18'},{id:'stage-2',title:'Book follow-up',activity:'Attempt booking.',prerequisites:['stage-1'],status:'completed',owner:'Care coordination',dueDate:'2026-09-18'}]}),/event id was already used/);
  assert.throws(()=>act(state,{type:'patient-coordination.pathway.save',requestId:'path-4',id:state.pathways[0].id,expectedVersion:state.pathways[0].version,patientId:'TN-100',encounterId:'ENC-1',pathwayKey:'support-x1-local',pathwayVersion:'local-v1',currentVersion:true,eventId:'evt-2',transitionReason:'Skip prerequisites.',stages:[{id:'stage-1',title:'Review access needs',activity:'Confirm language, support, and outreach constraints.',prerequisites:[],status:'pending',owner:'Care coordination',dueDate:'2026-09-18'},{id:'stage-2',title:'Book follow-up',activity:'Attempt booking.',prerequisites:['stage-1'],status:'completed',owner:'Care coordination',dueDate:'2026-09-18'}]}),/prerequisite/);
  assert.throws(()=>act(state,{type:'patient-coordination.pathway.save',requestId:'path-5',id:state.pathways[0].id,expectedVersion:999,patientId:'TN-100',encounterId:'ENC-1',pathwayKey:'support-x1-local',pathwayVersion:'local-v1',currentVersion:true,eventId:'evt-2',transitionReason:'Stale version.',stages:[{id:'stage-1',title:'Review access needs',activity:'Confirm language, support, and outreach constraints.',prerequisites:[],status:'active',owner:'Care coordination',dueDate:'2026-09-18'}]}),/changed/);
  assert.throws(()=>act(state,{type:'patient-coordination.pathway.save',requestId:'path-6',id:state.pathways[0].id,expectedVersion:state.pathways[0].version,patientId:'TN-200',encounterId:'ENC-1',pathwayKey:'support-x1-local',pathwayVersion:'local-v1',currentVersion:true,eventId:'evt-2',transitionReason:'Wrong patient.',stages:[{id:'stage-1',title:'Review access needs',activity:'Confirm language, support, and outreach constraints.',prerequisites:[],status:'active',owner:'Care coordination',dueDate:'2026-09-18'}]}),/selected patient/);
});

test('scheduling enforces booking evidence, cancellation and no-show reasons, opt-out and unreachable retries, and summary counts',()=>{
  let state=act(initialState(),{type:'patient-coordination.schedule.save',dueWindowTimezone:'UTC',requestId:'sched-1',patientId:'TN-100',encounterId:'ENC-1',phase:'follow-up-due',dueWindowStart:'2026-09-17',dueWindowEnd:'2026-09-19',owner:'Care coordination',preferredChannel:'none',optedOut:true,bookingEvidenceSource:'none',outreachStatus:'retry-scheduled',nextAttemptAt:'2026-09-18T14:00:00Z',transitionReason:'Patient opted out; manual retry scheduled.'});
  assert.equal(getSummary(state,'TN-100').attention.some(item=>item.includes('opted out')),true);
  state=act(state,{type:'patient-coordination.schedule.save',dueWindowTimezone:'UTC',requestId:'sched-2',id:state.scheduling[0].id,expectedVersion:state.scheduling[0].version,patientId:'TN-100',encounterId:'ENC-1',phase:'requested',dueWindowStart:'2026-09-17',dueWindowEnd:'2026-09-19',owner:'Care coordination',preferredChannel:'none',optedOut:true,bookingEvidenceSource:'none',outreachStatus:'in-progress',outreachNote:'Patient agreed to a manual callback request.',transitionReason:'Saved the request state.'});
  assert.throws(()=>act(state,{type:'patient-coordination.schedule.save',dueWindowTimezone:'UTC',requestId:'sched-3',id:state.scheduling[0].id,expectedVersion:state.scheduling[0].version,patientId:'TN-100',encounterId:'ENC-1',phase:'booking-reported',dueWindowStart:'2026-09-17',dueWindowEnd:'2026-09-19',owner:'Care coordination',preferredChannel:'none',optedOut:true,appointmentStartsAt:'2026-09-20T15:00:00Z',appointmentTimezone:'America/Toronto',bookingEvidenceSource:'none',outreachStatus:'completed',transitionReason:'Pretend booking exists.'}),/external booking evidence/);
  state=act(state,{type:'patient-coordination.schedule.save',dueWindowTimezone:'UTC',requestId:'sched-4',id:state.scheduling[0].id,expectedVersion:state.scheduling[0].version,patientId:'TN-100',encounterId:'ENC-1',phase:'booking-reported',dueWindowStart:'2026-09-17',dueWindowEnd:'2026-09-19',owner:'Care coordination',preferredChannel:'none',optedOut:true,appointmentStartsAt:'2026-09-20T15:00:00Z',appointmentTimezone:'America/Toronto',bookingEvidenceSource:'manual',bookingEvidenceRef:'Scheduler call reference 72',outreachStatus:'completed',outreachNote:'Manual scheduler confirmation received.',transitionReason:'External booking reported manually.'});
  state=act(state,{type:'patient-coordination.schedule.save',dueWindowTimezone:'UTC',requestId:'sched-5',id:state.scheduling[0].id,expectedVersion:state.scheduling[0].version,patientId:'TN-100',encounterId:'ENC-1',phase:'confirmed',dueWindowStart:'2026-09-17',dueWindowEnd:'2026-09-19',owner:'Care coordination',preferredChannel:'none',optedOut:true,appointmentStartsAt:'2026-09-20T15:00:00Z',appointmentTimezone:'America/Toronto',bookingEvidenceSource:'manual',bookingEvidenceRef:'Scheduler call reference 72',outreachStatus:'completed',transitionReason:'Appointment confirmed.'});
  assert.throws(()=>act(state,{type:'patient-coordination.schedule.save',dueWindowTimezone:'UTC',requestId:'sched-6',id:state.scheduling[0].id,expectedVersion:state.scheduling[0].version,patientId:'TN-100',encounterId:'ENC-1',phase:'no-show',dueWindowStart:'2026-09-17',dueWindowEnd:'2026-09-19',owner:'Care coordination',preferredChannel:'none',optedOut:true,appointmentStartsAt:'2026-09-20T15:00:00Z',appointmentTimezone:'America/Toronto',bookingEvidenceSource:'manual',bookingEvidenceRef:'Scheduler call reference 72',outreachStatus:'completed',transitionReason:'Missing reason.'}),/require a reason/);
  state=act(state,{type:'patient-coordination.schedule.save',dueWindowTimezone:'UTC',requestId:'sched-7',id:state.scheduling[0].id,expectedVersion:state.scheduling[0].version,patientId:'TN-100',encounterId:'ENC-1',phase:'no-show',dueWindowStart:'2026-09-17',dueWindowEnd:'2026-09-19',owner:'Care coordination',preferredChannel:'none',optedOut:true,appointmentStartsAt:'2026-09-20T15:00:00Z',appointmentTimezone:'America/Toronto',bookingEvidenceSource:'manual',bookingEvidenceRef:'Scheduler call reference 72',outreachStatus:'retry-scheduled',nextAttemptAt:'2026-09-21T14:00:00Z',cancellationReason:'No answer at check-in; patient marked no-show by clinic staff.',transitionReason:'Documented no-show.'},context('2026-09-20T16:00:00Z'));
  state=act(state,{type:'patient-coordination.schedule.save',dueWindowTimezone:'UTC',requestId:'sched-8',id:state.scheduling[0].id,expectedVersion:state.scheduling[0].version,patientId:'TN-100',encounterId:'ENC-1',phase:'reschedule-outreach',dueWindowStart:'2026-09-17',dueWindowEnd:'2026-09-19',owner:'Care coordination',preferredChannel:'none',optedOut:true,bookingEvidenceSource:'none',outreachStatus:'unreachable',nextAttemptAt:'2026-09-21T14:00:00Z',outreachNote:'Unable to reach patient; next attempt saved.',transitionReason:'Start reschedule outreach.'},context('2026-09-20T16:05:00Z'));
  assert.equal(getSummary(state,'TN-100').overdue>=0,true);
  assert.equal(state.scheduling[0].history[0].to,'reschedule-outreach');
});

test('validateState and panel render expose forms, histories, busy protections, and limitations without selecting the wrong patient',()=>{
  const supportState=validateState(act(initialState(),{type:'patient-coordination.support.save',requestId:'render-1',patientId:'TN-100',encounterId:'ENC-1',conversationDate:'2026-09-17',planId:'plan-1',planVersion:1,goalText:'Stay active.',approvedEducation:['Pain plan copy'],reminderChannel:'none',optedOut:true,dueCheckInDate:'2026-09-18',originalText:'Keep the reminders in the chart only.',attributedSummary:'Patient asked for local chart reminders only.',summaryAuthor:'Coordinator Example',participationMode:'digital',participant:'patient',recordedSource:'Patient portal'}));
  const html=render({patientId:'TN-100',patients,state:supportState,busy:true,onAction:async()=>true});
  for(const text of ['data-journey="J09"','Patient support','Human handoff','Language and access','Operational pathway','Scheduling and outreach','Delivery and bookings require recorded evidence.','Original patient text','Saving…'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html.replace(/<[^>]+>/g,' '),/\bJ\d{2}\b/,'internal journey codes stay out of visible text');
  assert.ok(html.includes('disabled=""'));
  const blocked=render({patientId:'missing',patients,state:supportState,busy:false,onAction:async()=>true});
  assert.ok(blocked.includes('Invalid patient context'));
});

test('panel edits every pathway stage while preserving completed evidence',()=>{
  const state=act(initialState(),{type:'patient-coordination.pathway.save',requestId:'render-path-1',patientId:'TN-100',encounterId:'ENC-1',pathwayKey:'support-x1-local',pathwayVersion:'local-v1',currentVersion:true,eventId:'evt-path-render',transitionReason:'Seed multi-stage pathway.',stages:[{id:'stage-1',title:'Review access needs',activity:'Confirm language, support, and outreach constraints.',prerequisites:[],status:'completed',owner:'Care coordination',dueDate:'2026-09-18'},{id:'stage-2',title:'Book follow-up',activity:'Attempt booking.',prerequisites:['stage-1'],status:'pending',owner:'Care coordination',dueDate:'2026-09-19'}]});
  const html=render({patientId:'TN-100',patients,state,busy:false,onAction:async()=>false});
  assert.ok(html.includes('Stage 1 · completed evidence'));
  assert.ok(html.includes('Stage 2'));
  assert.ok(html.includes('Book follow-up'));
  assert.ok(html.includes('Add stage'));
  assert.ok(!html.includes('read-only here'));
  assert.ok(!html.includes('Request ID'));
  assert.ok(html.includes('disabled=""'));
});

const supportCommand=(overrides={})=>({type:'patient-coordination.support.save',requestId:'support-regression',patientId:'TN-100',encounterId:'ENC-1',conversationDate:'2026-09-17',planId:'plan-44',planVersion:3,goalText:'Walk daily.',approvedEducation:['Pain plan copy'],reminderChannel:'none',optedOut:true,dueCheckInDate:'2026-09-20',originalText:'A daily walk is my goal.',attributedSummary:'Patient wants to walk daily.',summaryAuthor:'Coordinator Example',participationMode:'staff-recorded',participant:'patient',recordedSource:'Patient conversation',...overrides});
const languageCommand=(overrides={})=>({type:'patient-coordination.language.save',requestId:'language-regression',patientId:'TN-100',encounterId:'ENC-1',preferredLanguage:'en',instructionsLanguage:'en',sourceText:'Saved reminder instructions.',translationStatus:'not-needed',accessibilityPreferences:[],teachBack:'Patient repeated instructions.',sharedDevice:false,proxyStatus:'none',verifiedPatientAuth:false,...overrides});
const handoffCommand=(overrides={})=>({type:'patient-coordination.handoff.save',requestId:'handoff-regression',patientId:'TN-100',encounterId:'ENC-1',concern:'Patient requests callback.',dedupeKey:'callback-regression',priority:'routine',urgencySourceType:'authorized-human',urgencySource:'Coordinator review',responsibleTeam:'Care team',responsiblePerson:'Assigned nurse',coverageExpectation:'Next shift callback',fallbackOwner:'On-call clinician',phase:'locally-saved',deliveryStatus:'pending',deliveryEvidenceSource:'none',patientContactStatus:'not-attempted',transitionReason:'Document patient request.',...overrides});
const scheduleCommand=(overrides={})=>({type:'patient-coordination.schedule.save',dueWindowTimezone:'UTC',requestId:'schedule-regression',patientId:'TN-100',encounterId:'ENC-1',phase:'follow-up-due',dueWindowStart:'2026-09-18',dueWindowEnd:'2026-09-20',owner:'Care coordinator',preferredChannel:'phone',optedOut:false,bookingEvidenceSource:'none',outreachStatus:'not-started',transitionReason:'Schedule follow-up.',...overrides});
const stage=(id,overrides={})=>({id,title:`Stage ${id}`,activity:'Document operational follow-up.',prerequisites:[],status:'pending',owner:'Care coordinator',dueDate:'2026-09-20',...overrides});
const pathwayCommand=(overrides={})=>({type:'patient-coordination.pathway.save',requestId:'pathway-regression',patientId:'TN-100',encounterId:'ENC-1',pathwayKey:'care-coordination',pathwayVersion:'local-v1',currentVersion:true,eventId:'event-regression',transitionReason:'Document pathway.',stages:[stage('one'),stage('two',{prerequisites:['one']})],...overrides});

test('records cannot move encounters or reuse another patient encounter, and updates require versions',()=>{
  for(const [command,collection] of [[supportCommand(),'support'],[languageCommand(),'language'],[handoffCommand(),'handoffs'],[pathwayCommand(),'pathways'],[scheduleCommand(),'scheduling']]){
    const state=act(initialState(),command);
    const record=state[collection][0];
    assert.throws(()=>act(state,{...command,id:record.id,expectedVersion:record.version,requestId:'wrong-encounter',encounterId:'ENC-2'}),/selected encounter/);
    assert.throws(()=>act(state,{...command,id:record.id,requestId:'missing-version'}),/latest saved version/);
    assert.throws(()=>act(state,{...command,patientId:'TN-200',requestId:'cross-patient-encounter'}),/selected patient/);
    assert.throws(()=>act(initialState(),{...command,expectedVersion:1}),/record id/);
  }
});

test('timestamps require real dates and offsets, and chronology compares instants',()=>{
  const command=supportCommand();
  assert.throws(()=>act(initialState(),command,context('2026-02-30T12:00:00Z')),/Invalid timestamp/);
  assert.throws(()=>act(initialState(),command,context('2026-09-17')),/timezone/);
  assert.throws(()=>act(initialState(),command,context('2026-09-17T12:00:00Z','')),/String must contain/);
  let state=act(initialState(),command,context('2026-09-17T20:00:00+02:00'));
  state.support[0].updatedAt='2026-09-17T20:00:00+02:00';
  const update={...command,id:state.support[0].id,expectedVersion:1,requestId:'later-instant'};
  state=act(state,update,context('2026-09-17T19:30:00+01:00'));
  assert.equal(state.support[0].updatedAt,'2026-09-17T18:30:00.000Z');
  assert.throws(()=>act(state,{...update,expectedVersion:2,requestId:'earlier-instant'},context('2026-09-17T20:00:00+02:00')),/Chronology/);
});

test('request reuse rejects changed content, survives JSON transport, and retains large valid payloads',()=>{
  const command=supportCommand({id:undefined,expectedVersion:undefined,originalText:'o'.repeat(4000),attributedSummary:'s'.repeat(2000)});
  const saved=act(initialState(),command);
  assert.deepEqual(validateState(saved),saved);
  assert.equal(act(saved,JSON.parse(JSON.stringify(command))).support.length,1);
  assert.throws(()=>act(saved,{...command,originalText:'Changed request'}),/already used with different content/);
  assert.throws(()=>act(saved,command,context('2026-09-17T18:30:00Z','Different trusted actor')),/different content or actor/);
  const altered=structuredClone(saved);
  altered.receipts[0].patientId='TN-200';
  assert.throws(()=>validateState(altered),/receipt does not match/);
});

test('request receipts remain duplicate-safe after more than 200 subsequent writes',()=>{
  const command=supportCommand();
  let state=act(initialState(),command);
  for(let i=0;i<202;i++)state=act(state,languageCommand({requestId:`receipt-${i}`}));
  assert.equal(state.receipts.length,203);
  const replay=act(state,command);
  assert.equal(replay.support.length,1);
  assert.equal(replay.receipts.length,203);
});

test('support verifies saved patient plan, version and goal when integration context is supplied',()=>{
  const ctx={...context(),carePlans:[{id:'plan-44',patientId:'TN-100',version:3,goal:'Walk daily.'}]};
  assert.equal(act(initialState(),supportCommand(),ctx).support.length,1);
  assert.throws(()=>act(initialState(),supportCommand({planVersion:2}),ctx),/saved care plan/);
  assert.throws(()=>act(initialState(),supportCommand({patientId:'TN-200'}),ctx),/saved care plan/);
  assert.throws(()=>act(initialState(),supportCommand({goalText:'Invented goal'}),ctx),/goal snapshot/);
});

test('handoff delivery, actions and responses remain required through closure',()=>{
  let state=act(initialState(),handoffCommand());
  function advance(phase,extra={}){
    const record=state.handoffs[0];
    const command=handoffCommand({id:record.id,expectedVersion:record.version,requestId:`phase-${phase}`,phase,deliveryStatus:'reported',deliveryEvidenceSource:'manual',deliveryEvidenceRef:'Acknowledged by the on-call clinician',actionSummary:record.actionSummary,responseSummary:record.responseSummary,...extra});
    state=act(state,command);
    return command;
  }
  advance('delivery-reported');
  assert.throws(()=>act(state,handoffCommand({id:state.handoffs[0].id,expectedVersion:2,requestId:'erase-receipt',phase:'ownership-accepted',deliveryStatus:'pending'})),/real receipt/);
  advance('ownership-accepted');
  advance('reviewed');
  advance('action-documented',{actionSummary:'Clinician documented the callback plan.'});
  assert.throws(()=>act(state,handoffCommand({id:state.handoffs[0].id,expectedVersion:5,requestId:'erase-action',phase:'response-recorded',deliveryStatus:'reported',deliveryEvidenceSource:'manual',deliveryEvidenceRef:'Acknowledgement',responseSummary:'Callback completed.'})),/retain the action/);
  advance('response-recorded',{responseSummary:'Patient received the clinician callback.',patientContactStatus:'successful'});
  advance('closed',{patientContactStatus:'successful'});
  assert.equal(validateState(state).handoffs[0].phase,'closed');
  assert.equal(state.handoffs[0].history.length,6);
});

test('duplicate high-priority concerns escalate the existing handoff instead of losing urgency',()=>{
  let state=act(initialState(),handoffCommand());
  state=act(state,handoffCommand({requestId:'high-priority-duplicate',priority:'high',urgencySource:'Clinician escalation review',concern:'Additional concern requires urgent callback.'}));
  assert.equal(state.handoffs.length,1);
  assert.equal(state.handoffs[0].priority,'high');
  assert.equal(state.handoffs[0].duplicates[0].priority,'high');
  assert.throws(()=>act(initialState(),handoffCommand({patientContactStatus:'failed',patientContactFailureReason:'No answer',nextAttemptAt:'2026-09-16T12:00:00Z'})),/after the current time/);
});

test('language documentation cannot self-verify patient authentication or hide unsupported language',()=>{
  assert.throws(()=>act(initialState(),languageCommand({verifiedPatientAuth:true})),/trusted patient authentication/);
  assert.equal(act(initialState(),languageCommand({verifiedPatientAuth:true}),{...context(),features:{patientAuthenticationVerified:true}}).language[0].verifiedPatientAuth,true);
  assert.throws(()=>act(initialState(),languageCommand({preferredLanguage:'es',instructionsLanguage:'en'})),/explicit language support/);
  assert.throws(()=>act(initialState(),languageCommand({translationStatus:'translated',translatedText:'Traducción'})),/reviewer/);
});

test('pathways reject cycles, active unmet prerequisites, removed evidence and archived execution',()=>{
  assert.throws(()=>act(initialState(),pathwayCommand({stages:[stage('one',{prerequisites:['two']}),stage('two',{prerequisites:['one']})]})),/cycle/);
  assert.throws(()=>act(initialState(),pathwayCommand({stages:[stage('one'),stage('two',{prerequisites:['one'],status:'active'})]})),/prerequisite/);
  assert.throws(()=>act(initialState(),pathwayCommand({currentVersion:false,stages:[stage('one',{status:'active'})]})),/archived/);
  const state=act(initialState(),pathwayCommand({stages:[stage('one',{status:'completed'}),stage('two',{prerequisites:['one']})]}));
  const update={id:state.pathways[0].id,expectedVersion:1,requestId:'edit-path',eventId:'edit-path-event'};
  assert.throws(()=>act(state,pathwayCommand({...update,stages:[stage('two')]})),/cannot be removed/);
  assert.throws(()=>act(state,pathwayCommand({...update,stages:[stage('one',{status:'completed',activity:'Different evidence'}),stage('two',{prerequisites:['one']})]})),/cannot be rewritten/);
  assert.throws(()=>act(state,pathwayCommand({...update,stages:[stage('one',{status:'completed'}),stage('two')]})),/new pathway version/);
  const original=pathwayCommand();
  const existing=act(initialState(),original);
  assert.equal(act(existing,{...original,requestId:'same-event-new-request'}).pathways.length,1);
  assert.throws(()=>act(existing,{...original,requestId:'new-create-request',eventId:'new-event'}),/already exists/);
});

test('scheduling requires a lifecycle, valid timezone and real appointment chronology',()=>{
  assert.throws(()=>act(initialState(),scheduleCommand({phase:'attended'})),/start at follow-up-due/);
  let state=act(initialState(),scheduleCommand());
  function update(phase,extra={},now='2026-09-17T18:30:00Z'){
    const previous=state.scheduling[0];
    const command=scheduleCommand({id:previous.id,expectedVersion:previous.version,requestId:`schedule-${phase}-${previous.version}`,phase,...extra});
    state=act(state,command,context(now));
    return command;
  }
  update('requested');
  const booking={appointmentStartsAt:'2026-09-20T10:00:00Z',appointmentTimezone:'Europe/Lisbon',bookingEvidenceSource:'manual',bookingEvidenceRef:'Scheduler receipt 42'};
  assert.throws(()=>act(state,scheduleCommand({...booking,id:state.scheduling[0].id,expectedVersion:2,requestId:'invalid-zone',phase:'booking-reported',appointmentTimezone:'Moon/Base'})),/IANA/);
  update('booking-reported',booking);
  update('confirmed',booking);
  assert.throws(()=>act(state,scheduleCommand({...booking,id:state.scheduling[0].id,expectedVersion:4,requestId:'future-no-show',phase:'no-show',cancellationReason:'Not yet arrived'})),/before the appointment/);
  assert.throws(()=>act(state,scheduleCommand({...booking,id:state.scheduling[0].id,expectedVersion:4,requestId:'silent-reschedule',phase:'confirmed',appointmentStartsAt:'2026-09-21T10:00:00Z'})),/Cancel and reschedule/);
  update('cancelled',{...booking,cancellationReason:'Patient requested rescheduling.'});
  update('reschedule-outreach',{outreachStatus:'retry-scheduled',nextAttemptAt:'2026-09-18T10:00:00Z'});
  assert.equal(state.scheduling[0].appointment,undefined);
  assert.equal(state.scheduling[0].previousAppointments[0].evidenceRef,'Scheduler receipt 42');
  assert.equal(validateState(state).scheduling[0].previousAppointments.length,1);
});

test('overdue summary uses the reference clock rather than future appointment and retry timestamps',()=>{
  let state=act(initialState(),scheduleCommand({outreachStatus:'retry-scheduled',nextAttemptAt:'2026-12-01T12:00:00Z'}));
  assert.equal(getSummary(state,'TN-100','2026-09-17T20:00:00Z').overdue,0);
  assert.equal(getSummary(state,'TN-100','2026-09-21T20:00:00Z').overdue,1);
  assert.equal(getSummary(state,'TN-200','2026-09-21T20:00:00Z').open,0);
  state=act(state,handoffCommand({requestId:'offset-due-handoff',dueAt:'2026-09-17T20:00:00+02:00'}));
  assert.equal(getSummary(state,'TN-100','2026-09-17T18:30:00Z').overdue,1);
});

test('all five coordination journey scenarios complete with domain-specific rejections and persistent state',async()=>{
  let state=initialState();
  const carePlans=[{id:'plan-44',patientId:'TN-100',version:3,goal:'Walk daily.'}];
  const ctx={...context(),carePlans};
  const recorded=[];
  await runScenarios({patientId:'TN-100',now:ctx.now,carePlans,state:()=>state,apply:async command=>{state=validateState(JSON.parse(JSON.stringify(act(state,command,ctx))));return state;},expectRejected:async command=>{const before=structuredClone(state);assert.throws(()=>act(state,command,ctx));assert.deepEqual(state,before);},record:(id,status)=>recorded.push([id,status])});
  assert.deepEqual(recorded,[['J09','passed'],['J10','passed'],['J13','passed'],['J15','passed'],['J16','passed']]);
});


test('missed visits require open recovery, while legacy incomplete recovery stays visible',()=>{
  let state=act(initialState(),scheduleCommand());
  const booking={appointmentStartsAt:'2026-09-17T16:00:00Z',appointmentTimezone:'America/Toronto',bookingEvidenceSource:'manual',bookingEvidenceRef:'Clinic appointment confirmation'};
  function save(phase,extra={}){
    const prior=state.scheduling[0];
    state=act(state,scheduleCommand({id:prior.id,expectedVersion:prior.version,requestId:crypto.randomUUID(),phase,...extra}));
  }
  save('requested');save('booking-reported',booking);save('confirmed',booking);
  const prior=state.scheduling[0];
  const missed=scheduleCommand({...booking,id:prior.id,expectedVersion:prior.version,requestId:'missed-without-recovery',phase:'no-show',outreachStatus:'completed',cancellationReason:'The patient could not join the call.'});
  assert.throws(()=>act(state,missed),/next contact attempt/);
  assert.throws(()=>act(state,{...missed,outreachStatus:'in-progress',requestId:'missed-without-time'}),/next contact attempt/);
  save('no-show',{...booking,outreachStatus:'retry-scheduled',nextAttemptAt:'2026-09-18T14:30:00Z',cancellationReason:'The patient could not join the call.'});
  assert.equal(state.scheduling[0].owner,'Care coordinator');
  const legacy=structuredClone(state);
  legacy.scheduling[0].outreach={...legacy.scheduling[0].outreach,status:'completed',nextAttemptAt:undefined};
  assert.equal(validateState(legacy).scheduling[0].phase,'no-show');
  assert.ok(getSummary(legacy,'TN-100','2026-09-17T20:00:00Z').attention.some(item=>item.includes('Missed-visit follow-up needs another contact attempt')));
});

test('due dates use their clinical timezone and missing legacy timezone stays explicit',()=>{
  const command=scheduleCommand({dueWindowStart:'2026-09-17',dueWindowEnd:'2026-09-17',dueWindowTimezone:'America/Los_Angeles'});
  const state=act(initialState(),command);
  assert.equal(getSummary(state,'TN-100','2026-09-18T02:00:00Z').overdue,0,'still the due date in Los Angeles');
  assert.equal(getSummary(state,'TN-100','2026-09-18T08:00:00Z').overdue,1);
  assert.throws(()=>act(initialState(),{...command,dueWindowTimezone:undefined}),/timezone for the follow-up/);
  assert.throws(()=>act(initialState(),{...command,dueWindowTimezone:'Moon/Base'}),/IANA/);
  const legacy=structuredClone(state);delete legacy.scheduling[0].dueWindow.timezone;
  assert.ok(getSummary(legacy,'TN-100','2026-09-18T08:00:00Z').attention.some(item=>item.includes('needs a timezone')));
  const handoff=act(initialState(),handoffCommand(),context('2026-09-17T23:00:00Z'));
  assert.ok(!getSummary(handoff,'TN-100').attention.some(item=>item.includes('After-hours')),'UTC hour does not establish staffed coverage');
});

test('reviewed translation is patient-specific and bound to the exact current plan version',()=>{
  const ctx={...context(),carePlans:[{id:'plan-current',patientId:'TN-100',version:2,summary:'Keep your walking log.'}]};
  const command=languageCommand({planId:'plan-current',planVersion:2,sourceText:'Keep your walking log.',preferredLanguage:'es',instructionsLanguage:'es',translationStatus:'translated',translatedText:'Mantén tu registro de caminatas.',translationReviewer:'Sofía Morales, bilingual clinician'});
  const state=act(initialState(),command,ctx);
  assert.equal(latestLanguageAccess(state,'TN-100').preferredLanguage,'es');
  assert.equal(latestLanguageAccess(state,'TN-200'),undefined);
  assert.equal(reviewedPlanTranslation(state,'TN-100','plan-current',2,'es').translatedText,'Mantén tu registro de caminatas.');
  assert.equal(reviewedPlanTranslation(state,'TN-100','plan-current',3,'es'),undefined);
  assert.equal(reviewedPlanTranslation(state,'TN-200','plan-current',2,'es'),undefined);
  assert.throws(()=>act(initialState(),{...command,planVersion:1},ctx),/current care plan/);
  assert.throws(()=>act(initialState(),{...command,sourceText:'Different instructions.'},ctx),/source instructions/);
  assert.throws(()=>act(initialState(),{...command,planVersion:undefined},ctx),/both the care plan/);
  const newer=act(state,{...command,id:state.language[0].id,expectedVersion:1,requestId:'translation-review-reopened',translatedText:undefined,translationReviewer:undefined,translationStatus:'pending-review'},ctx);
  assert.equal(reviewedPlanTranslation(newer,'TN-100','plan-current',2,'es'),undefined,'a new pending review does not fall back to an earlier translation');
});

test('assigned pathways keep the approved graph and require qualifying events',()=>{
  const assignment={id:'assignment-walking',version:1,patientId:'TN-100',encounterId:'ENC-1',protocolId:'reviewed-support',protocolVersion:4,protocolSnapshot:{steps:[
    {id:'one',title:'Review access needs',owner:'Care coordinator',kind:'activity',prerequisites:[],transitions:[{toStepId:'two',when:{kind:'event',eventType:'access-reviewed'}}]},
    {id:'two',title:'Arrange follow-up',owner:'Care coordinator',kind:'activity',prerequisites:['one']}
  ]}};
  const ctx={...context(),protocolAssignments:[assignment]};
  const stages=assignment.protocolSnapshot.steps.map(step=>({...stage(step.id),title:step.title,prerequisites:step.prerequisites,dueDate:''}));
  const command=pathwayCommand({protocolAssignmentId:assignment.id,protocolAssignmentVersion:1,pathwayKey:assignment.protocolId,pathwayVersion:'4',stages});
  let state=act(initialState(),command,ctx);
  assert.equal(state.pathways[0].stages[0].dueDate,'','an absent approved schedule stays undated');
  assert.equal(getSummary(state,'TN-100',ctx.now).overdue,0);
  const edit=(changes)=>({...command,id:state.pathways[0].id,expectedVersion:state.pathways[0].version,requestId:crypto.randomUUID(),eventId:crypto.randomUUID(),...changes});
  assert.throws(()=>act(state,edit({pathwayVersion:'5'}),ctx),/pinned version/);
  assert.throws(()=>act(state,edit({stages:[stages[0],{...stages[1],prerequisites:[]}]}),ctx),/published version/);
  const advanced=[{...stages[0],status:'completed'},{...stages[1],status:'active'}];
  assert.throws(()=>act(state,edit({stages:advanced}),ctx),/qualifying activity/);
  state=act(state,edit({stages:advanced,eventType:'access-reviewed'}),ctx);
  assert.equal(state.pathways[0].stages[1].status,'active');
  assert.throws(()=>act(state,edit({protocolAssignmentId:undefined,protocolAssignmentVersion:undefined}),ctx),/Migrate/);
  assert.throws(()=>act(initialState(),command,{...context(),protocolAssignments:[]}),/approved protocol/);
  assert.throws(()=>act(state,{...command,encounterId:'ENC-2',requestId:'duplicate-assignment',eventId:'duplicate-assignment-event'},{...ctx,protocolAssignments:[{...assignment,encounterId:undefined}]}),/already has an active pathway/);
});

const patientUiBundle=await build({stdin:{contents:"export {PatientPlan,RoboAdvisor} from './components/theranetrix/engine-workspace';export {PatientCompanionLanguage,ReviewQueue} from './components/theranetrix/workflows';export {seedWorkspace} from './lib/theranetrix';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',plugins:[{name:'css-for-render-tests',setup(builder){builder.onLoad({filter:/\.css$/},()=>({contents:'export default {}',loader:'js'}));}}],write:false});
const patientUi={exports:{}};
new Function('require','module','exports',patientUiBundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),patientUi,patientUi.exports);

test('companion uses saved patient language and reviewed plan translation without exposing clinician rationale',()=>{
  const workspace=patientUi.exports.seedWorkspace();
  const patient=workspace.patients[0];patient.id='TN-100';patient.preferredLanguage='es';
  patient.carePlans=[{id:'plan-current',workflowVersion:2,text:'Keep your walking log.',owner:'Sofía Morales',followup:'2026-09-24',time:'',appointmentBooked:false,date:'2026-09-17T12:00:00Z',author:'Sofía Morales'}];
  workspace.engineDecisions=[{id:'decision-current',patientId:patient.id,planId:'plan-current',rationale:'Private clinical reasoning about an outside report.'}];
  const state=act(initialState(),languageCommand({preferredLanguage:'es',instructionsLanguage:'es',translationStatus:'translated',planId:'plan-current',planVersion:2,sourceText:'Keep your walking log.',translatedText:'Mantén tu registro de caminatas.',translationReviewer:'Sofía Morales',accessibilityPreferences:['large-print']}));
  workspace.clinicalWorkflows={...workspace.clinicalWorkflows,slices:{...workspace.clinicalWorkflows.slices,'patient-coordination':{...workspace.clinicalWorkflows.slices['patient-coordination'],state}}};
  const ctx={data:workspace,busy:false,save:async()=>false,open:()=>{}};
  const planHtml=renderToStaticMarkup(React.createElement(patientUi.exports.PatientPlan,{p:patient,ctx,lang:'es',patientMode:true}));
  assert.ok(planHtml.includes('Mantén tu registro de caminatas.'));
  assert.ok(planHtml.includes('Traducción revisada por'));
  assert.ok(planHtml.includes('Cita aún no reservada'));
  assert.ok(!planHtml.includes('Private clinical reasoning'));
  const companionHtml=renderToStaticMarkup(React.createElement(patientUi.exports.PatientCompanionLanguage,{p:patient,ctx,onAccount:()=>{}}));
  assert.ok(companionHtml.includes('lang="es"'));
  assert.ok(companionHtml.includes('companion-large-print'));
  assert.ok(companionHtml.includes('Guardar mi registro'),'the visible primary check-in action uses the saved Spanish language');
  assert.ok(companionHtml.includes('Mi plan'),'care-plan navigation uses the saved Spanish language');
  patient.carePlans[0].workflowVersion=3;
  const changedPlanHtml=renderToStaticMarkup(React.createElement(patientUi.exports.PatientPlan,{p:patient,ctx,lang:'es',patientMode:true}));
  assert.ok(!changedPlanHtml.includes('Mantén tu registro de caminatas.'));
  assert.ok(changedPlanHtml.includes('No hay una traducción revisada al español de este plan.'));
  assert.ok(changedPlanHtml.includes('Keep your walking log.'));
});

test('Spanish advisor exposes an explicit urgent-concern choice and retains original exchanges',()=>{
  const workspace=patientUi.exports.seedWorkspace(),patient=workspace.patients[0];
  workspace.advisorTurns=[{id:'turn-original',patientId:patient.id,date:'2026-09-17T12:00:00Z',patientText:'I could not join the call.',reply:'Your request has been saved.',summary:'Call follow-up requested.',intent:'concern',reviewId:'review-one'}];
  const html=renderToStaticMarkup(React.createElement(patientUi.exports.RoboAdvisor,{p:patient,ctx:{data:workspace,busy:false,save:async()=>false,open:()=>{}},lang:'es'}));
  for(const label of ['¿Es urgente tu preocupación?','Tengo una preocupación urgente','Tu mensaje','Guardar mensaje','I could not join the call.','Conversación guardada en su idioma original'])assert.ok(html.includes(label),label);
  assert.ok(!html.includes('checked=""'),'scores are not attached implicitly');
});

// A bounded hook harness exercises submit handlers without claiming browser coverage.
function interactivePatientComponent(name,props){
  const slots=[];let cursor=0;
  const hooks={...React,useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];}};
  const loaded={exports:{}},require=createRequire(process.cwd()+'/package.json');
  new Function('require','module','exports',patientUiBundle.outputFiles[0].text)(id=>id==='react'?hooks:require(id),loaded,loaded.exports);
  return ()=>{cursor=0;return loaded.exports[name](props);};
}
function findElement(tree,predicate){
  if(!tree||typeof tree!=='object')return undefined;
  if(predicate(tree))return tree;
  for(const child of React.Children.toArray(tree.props?.children)){const match=findElement(child,predicate);if(match)return match;}
}

test('advisor retries reuse their request identity while changed message drafts get a new request',async()=>{
  const workspace=patientUi.exports.seedWorkspace(),patient=workspace.patients[0],commands=[];
  const renderAdvisor=interactivePatientComponent('RoboAdvisor',{p:patient,ctx:{data:workspace,busy:false,save:async command=>{commands.push(command);return false;},open:()=>{}}});
  let tree=renderAdvisor();
  findElement(tree,node=>node.props?.children==='Report a difficulty').props.onClick();
  tree=renderAdvisor();
  await findElement(tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});
  tree=renderAdvisor();
  assert.ok(findElement(tree,node=>node.props?.role==='alert'));
  await findElement(tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});
  assert.equal(commands[0].requestId,commands[1].requestId);
  assert.ok(commands[0].requestId);
  tree=renderAdvisor();
  findElement(tree,node=>node.props?.maxLength===2000&&node.props?.rows===3).props.onChange({target:{value:'I could not join the call and would like another appointment.'}});
  tree=renderAdvisor();
  await findElement(tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});
  assert.notEqual(commands[2].requestId,commands[1].requestId);
  assert.equal(commands[2].text,'I could not join the call and would like another appointment.');
});

test('a failed companion language save keeps the chosen language available for retry',async()=>{
  const workspace=patientUi.exports.seedWorkspace(),patient=workspace.patients[0],commands=[];
  patient.preferredLanguage='en';
  const renderCompanion=interactivePatientComponent('PatientCompanionLanguage',{p:patient,ctx:{data:workspace,busy:false,save:async command=>{commands.push(command);return false;},open:()=>{}},onAccount:()=>{}});
  let tree=renderCompanion();
  const initialView=findElement(tree,node=>typeof node.props?.onLang==='function');
  initialView.props.onLang('es');await new Promise(resolve=>setImmediate(resolve));
  tree=renderCompanion();
  assert.equal(findElement(tree,node=>typeof node.props?.onLang==='function').props.lang,'es');
  assert.ok(findElement(tree,node=>node.props?.role==='alert'));
  assert.deepEqual(commands[0],{type:'patient.language.set',patientId:patient.id,language:'es'});
});


test('an unresolved source handoff remains visible when an older queue row was manually resolved',()=>{
  const workspace=patientUi.exports.seedWorkspace(),patient=workspace.patients[0];
  const state=act(initialState(),handoffCommand({patientId:patient.id,priority:'high'}),{...context(),patients:workspace.patients});
  const handoff=state.handoffs[0];
  workspace.clinicalWorkflows={...workspace.clinicalWorkflows,slices:{...workspace.clinicalWorkflows.slices,'patient-coordination':{...workspace.clinicalWorkflows.slices['patient-coordination'],state}}};
  workspace.reviews=[{id:'linked-review',patientId:patient.id,title:'Callback still needs a response',detail:'The original handoff remains open.',priority:'High',source:'Human handoff',status:'Resolved',created:handoff.createdAt,workflowRecordId:handoff.id}];
  const html=renderToStaticMarkup(React.createElement(patientUi.exports.ReviewQueue,{ctx:{data:workspace,busy:false,save:async()=>false,open:()=>{}}}));
  assert.ok(html.includes('Callback still needs a response'));
  assert.ok(html.includes('Open handoff'));
  assert.ok(html.includes('workflow=patient-coordination&amp;workflowJourney=J10'));
  assert.ok(!html.includes('No reviews in this view'));
});
