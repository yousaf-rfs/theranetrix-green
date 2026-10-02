import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({stdin:{contents:"export * from './lib/clinical-flows/results-referrals'; export {ResultsWorkspace,ReferralsWorkspace,ResultsReferralsPanel,toOffsetDateTime} from './components/theranetrix/clinical-flows/results-referrals';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {
  resultActionSchema,referralActionSchema,reduceResultRecords,reduceReferralRecords,isResultOverdue,isReferralOverdue,
  ResultsWorkspace,ReferralsWorkspace,ResultsReferralsPanel,toOffsetDateTime,initialState,actionSchema,reduce,validateState,getSummary,
}=mod.exports;

const actor='Clinical reviewer';
const now='2026-09-17T14:00:00Z';
const resultAct=(records,action,at=now)=>reduceResultRecords(records,resultActionSchema.parse(action),actor,at);
const referralAct=(records,action,at='2026-09-24T14:00:00Z')=>reduceReferralRecords(records,referralActionSchema.parse(action),actor,at);

function createdResult(id='result-1',patientId='patient-1'){
  return resultAct([], {type:'result.create',actionId:'evt-create-'+id,id,patientId,encounterId:'enc-1',expectedVersion:0,requestLabel:'CBC with differential',owner:'Jordan RN',dueAt:'2026-09-18',requestedAt:'2026-09-17',reason:'Evaluate ongoing fatigue.'});
}
function createdReferral(id='referral-1',patientId='patient-1'){
  return referralAct([], {type:'referral.create',actionId:'evt-create-'+id,id,patientId,encounterId:'enc-1',expectedVersion:0,clinicalQuestion:'Please assess persistent radicular pain.',receivingService:'Neurology',owner:'Jordan RN',dueAt:'2026-09-25',supportingEvidence:'MRI summary',reason:'Symptoms persist despite conservative measures.'});
}

test('result workflow supports review, action, communication, closure, correction reopening, and overdue derivation',()=>{
  let records=createdResult();
  records=resultAct(records,{type:'result.mark-awaiting',actionId:'evt-await',id:'result-1',patientId:'patient-1',expectedVersion:1,reason:'Collection arranged with the patient.'});
  records=resultAct(records,{type:'result.receive',actionId:'evt-receive',id:'result-1',patientId:'patient-1',expectedVersion:2,revisionId:'rev-1',source:'manual',summary:'Hemoglobin slightly below range.',collectedAt:'2026-09-17T09:00:00Z',receivedAt:'2026-09-17T11:00:00Z',evidenceRef:'Scanned lab report',reason:'Manual result recorded from scanned report.'});
  assert.equal(records[0].history[0].reason,'Manual result recorded from scanned report.');
  records=resultAct(records,{type:'result.review',actionId:'evt-review',id:'result-1',patientId:'patient-1',expectedVersion:3,interpretation:'Mild anemia requires follow-up review.',reason:'Result needs clinical interpretation.',evidenceRef:'Scanned lab report'});
  records=resultAct(records,{type:'result.act',actionId:'evt-act',id:'result-1',patientId:'patient-1',expectedVersion:4,clinicalDisposition:'Order ferritin and review medication causes.',reason:'Escalate the workup.',evidenceRef:'Assessment note'});
  records=resultAct(records,{type:'result.communicate',actionId:'evt-communicate',id:'result-1',patientId:'patient-1',expectedVersion:5,contactEvidence:'Called patient and documented callback.',reason:'Discussed next steps with the patient.'});
  records=resultAct(records,{type:'result.close',actionId:'evt-close',id:'result-1',patientId:'patient-1',expectedVersion:6,reason:'Communication and follow-up plan recorded.'});
  const closed=records[0];
  assert.equal(closed.status,'closed');
  assert.equal(closed.communicationEvidence,'Called patient and documented callback.');
  records=resultAct(records,{type:'result.reopen',actionId:'evt-reopen-closed',id:'result-1',patientId:'patient-1',expectedVersion:7,reason:'Reopen after closure to document an update.'});
  assert.equal(records[0].status,'communicated');
  records=resultAct(records,{type:'result.close',actionId:'evt-reclose',id:'result-1',patientId:'patient-1',expectedVersion:8,reason:'Closed again before corrected result arrived.'});
  records=resultAct(records,{type:'result.correct',actionId:'evt-correct',id:'result-1',patientId:'patient-1',expectedVersion:9,revisionId:'rev-2',correctedFromId:'rev-1',source:'manual',summary:'Corrected hemoglobin after specimen relabel.',collectedAt:'2026-09-17T09:00:00Z',receivedAt:'2026-09-19T10:00:00Z',evidenceRef:'Corrected report addendum',reason:'Correction reopens review.'},'2026-09-19T10:00:00Z');
  const corrected=records[0];
  assert.equal(corrected.status,'received');
  assert.equal(corrected.revisions[0].kind,'corrected');
  assert.equal(corrected.revisions[0].correctedFromId,'rev-1');
  assert.equal(corrected.interpretation,'');
  assert.equal(corrected.clinicalDisposition,'');
  assert.equal(corrected.communicationEvidence,'');
  assert.equal(isResultOverdue(corrected,'2026-09-20T08:00:00Z'),true);
});

test('result reducer rejects wrong-patient and stale updates, preserves immutability, and deduplicates matching action ids',()=>{
  const original=createdResult();
  const before=structuredClone(original);
  const updated=resultAct(original,{type:'result.mark-awaiting',actionId:'evt-await',id:'result-1',patientId:'patient-1',expectedVersion:1,reason:'Waiting on sample collection.'});
  assert.deepEqual(original,before);
  const duplicate=resultAct(updated,{type:'result.mark-awaiting',actionId:'evt-await',id:'result-1',patientId:'patient-1',expectedVersion:1,reason:'Waiting on sample collection.'});
  assert.deepEqual(duplicate,updated);
  assert.throws(()=>resultAct(updated,{type:'result.receive',actionId:'evt-stale',id:'result-1',patientId:'patient-1',expectedVersion:1,revisionId:'rev-1',source:'manual',summary:'Delayed entry',collectedAt:'2026-09-17T09:00:00Z',receivedAt:'2026-09-17T11:00:00Z',evidenceRef:'note',reason:'stale'}),/Stale update/);
  assert.throws(()=>resultAct(updated,{type:'result.receive',actionId:'evt-wrong-patient',id:'result-1',patientId:'patient-2',expectedVersion:2,revisionId:'rev-1',source:'manual',summary:'Delayed entry',collectedAt:'2026-09-17T09:00:00Z',receivedAt:'2026-09-17T11:00:00Z',evidenceRef:'note',reason:'wrong patient'}),/wrong patient/);
});

test('result validation requires evidence where needed and supports cancel and reopen paths',()=>{
  assert.equal(resultActionSchema.safeParse({type:'result.receive',actionId:'evt',id:'result-1',patientId:'patient-1',expectedVersion:1,revisionId:'rev-1',source:'manual',summary:'A',collectedAt:'2026-09-17T09:00:00Z',receivedAt:'2026-09-17T11:00:00Z',evidenceRef:'',reason:'missing evidence'}).success,false);
  let records=createdResult();
  records=resultAct(records,{type:'result.mark-awaiting',actionId:'evt-await',id:'result-1',patientId:'patient-1',expectedVersion:1,reason:'Awaiting processing.'});
  records=resultAct(records,{type:'result.cancel',actionId:'evt-cancel',id:'result-1',patientId:'patient-1',expectedVersion:2,reason:'Patient deferred the test.'});
  assert.equal(records[0].status,'cancelled');
  records=resultAct(records,{type:'result.reopen',actionId:'evt-reopen',id:'result-1',patientId:'patient-1',expectedVersion:3,reason:'Patient is ready to complete testing.'});
  assert.equal(records[0].status,'awaiting-result');
  assert.throws(()=>resultAct(records,{type:'result.reopen',actionId:'evt-unknown',id:'missing',patientId:'patient-1',expectedVersion:0,reason:'retry'}),/not found/);
});

test('referral workflow requires specialist advice and cannot close before plan reconciliation',()=>{
  let records=createdReferral();
  records=referralAct(records,{type:'referral.send',actionId:'evt-send',id:'referral-1',patientId:'patient-1',expectedVersion:1,evidenceRef:'Fax confirmation',reason:'Manual external send confirmed.'});
  assert.throws(()=>referralAct(records,{type:'referral.close',actionId:'evt-close-early',id:'referral-1',patientId:'patient-1',expectedVersion:2,reason:'not allowed'}),/not allowed/);
  records=referralAct(records,{type:'referral.accept',actionId:'evt-accept',id:'referral-1',patientId:'patient-1',expectedVersion:2,evidenceRef:'Call log',reason:'Receiving service accepted the referral.'});
  records=referralAct(records,{type:'referral.schedule',actionId:'evt-schedule',id:'referral-1',patientId:'patient-1',expectedVersion:3,scheduledFor:'2026-09-22',evidenceRef:'Appointment note',reason:'Consult arranged with specialist.'});
  records=referralAct(records,{type:'referral.consultation-complete',actionId:'evt-complete',id:'referral-1',patientId:'patient-1',expectedVersion:4,completedAt:'2026-09-22T16:00:00Z',evidenceRef:'Specialist visit summary',reason:'Consultation finished.'});
  assert.throws(()=>referralAct(records,{type:'referral.close',actionId:'evt-close-mid',id:'referral-1',patientId:'patient-1',expectedVersion:5,reason:'still not allowed'}),/not allowed/);
  records=referralAct(records,{type:'referral.advice-received',actionId:'evt-advice',id:'referral-1',patientId:'patient-1',expectedVersion:5,receivedAt:'2026-09-23T09:30:00Z',adviceSummary:'Recommend EMG and medication review.',originalAdvice:'Original note: proceed with EMG and review duloxetine timing.',evidenceRef:'Faxed specialist note',reason:'Advice arrived from specialist.'});
  records=referralAct(records,{type:'referral.review',actionId:'evt-review',id:'referral-1',patientId:'patient-1',expectedVersion:6,reviewSummary:'Advice reviewed with current chart and symptoms.',evidenceRef:'Review note',reason:'Clinical review completed.'});
  records=referralAct(records,{type:'referral.plan-reconciled',actionId:'evt-reconcile',id:'referral-1',patientId:'patient-1',expectedVersion:7,reconciliationPlan:'Add EMG order and discuss duloxetine timing at follow-up.',evidenceRef:'Updated care plan',reason:'Primary plan reconciled with specialist advice.'});
  records=referralAct(records,{type:'referral.close',actionId:'evt-close',id:'referral-1',patientId:'patient-1',expectedVersion:8,reason:'Advice reviewed and care plan reconciled.'});
  assert.equal(records[0].status,'closed');
  assert.equal(records[0].specialistAdvice.originalAdvice,'Original note: proceed with EMG and review duloxetine timing.');
  assert.equal(isReferralOverdue(records[0],'2026-09-30T12:00:00Z'),false);
  records=referralAct(records,{type:'referral.reopen',actionId:'evt-reopen-referral',id:'referral-1',patientId:'patient-1',expectedVersion:9,reason:'Referral needs to restart after closure.'});
  assert.equal(records[0].status,'requested');
  assert.equal(records[0].specialistAdvice,undefined);
  assert.equal(JSON.parse(records[0].history[0].previousSnapshot).specialistAdvice.originalAdvice,'Original note: proceed with EMG and review duloxetine timing.');
});

test('referral branch history preserves rejection, unreachable, no-show, and re-request paths',()=>{
  let rejected=createdReferral('referral-2');
  rejected=referralAct(rejected,{type:'referral.send',actionId:'evt-send-reject',id:'referral-2',patientId:'patient-1',expectedVersion:1,evidenceRef:'Fax receipt',reason:'Referral sent manually.'});
  rejected=referralAct(rejected,{type:'referral.reject',actionId:'evt-reject',id:'referral-2',patientId:'patient-1',expectedVersion:2,evidenceRef:'Service response',reason:'Service cannot accept this case.'});
  rejected=referralAct(rejected,{type:'referral.re-request',actionId:'evt-rerequest-reject',id:'referral-2',patientId:'patient-1',expectedVersion:3,evidenceRef:'Updated packet',reason:'Sending to an alternate clinician.'});
  assert.equal(rejected[0].history.some(entry=>entry.to==='rejected'),true);
  let unreachable=createdReferral('referral-3');
  unreachable=referralAct(unreachable,{type:'referral.unreachable-patient',actionId:'evt-unreachable',id:'referral-3',patientId:'patient-1',expectedVersion:1,reason:'Could not confirm patient availability.'});
  unreachable=referralAct(unreachable,{type:'referral.re-request',actionId:'evt-rerequest-unreachable',id:'referral-3',patientId:'patient-1',expectedVersion:2,evidenceRef:'Retry note',reason:'Patient confirmed and referral is being retried.'});
  assert.equal(unreachable[0].history.some(entry=>entry.to==='unreachable-patient'),true);
  let noShow=createdReferral('referral-4');
  noShow=referralAct(noShow,{type:'referral.send',actionId:'evt-send-no-show',id:'referral-4',patientId:'patient-1',expectedVersion:1,evidenceRef:'Fax receipt',reason:'Referral sent manually.'});
  noShow=referralAct(noShow,{type:'referral.accept',actionId:'evt-accept-no-show',id:'referral-4',patientId:'patient-1',expectedVersion:2,evidenceRef:'Call log',reason:'Accepted by clinic.'});
  noShow=referralAct(noShow,{type:'referral.schedule',actionId:'evt-schedule-no-show',id:'referral-4',patientId:'patient-1',expectedVersion:3,scheduledFor:'2026-09-23',evidenceRef:'Schedule note',reason:'Visit scheduled.'});
  noShow=referralAct(noShow,{type:'referral.no-show',actionId:'evt-no-show',id:'referral-4',patientId:'patient-1',expectedVersion:4,evidenceRef:'Clinic message',reason:'Patient missed the appointment.'});
  noShow=referralAct(noShow,{type:'referral.re-request',actionId:'evt-rerequest-no-show',id:'referral-4',patientId:'patient-1',expectedVersion:5,evidenceRef:'Reschedule note',reason:'Re-request after outreach.'});
  assert.equal(noShow[0].status,'requested');
  assert.equal(noShow[0].history.some(entry=>entry.to==='no-show'),true);
  assert.equal(noShow[0].specialistAdvice,undefined);
});


test('component datetime-local conversion produces offset ISO strings for schema-backed actions',()=>{
  const converted=toOffsetDateTime('2026-09-17T09:00');
  assert.equal(converted,new Date('2026-09-17T09:00').toISOString());
  assert.equal(resultActionSchema.safeParse({type:'result.receive',actionId:'evt-ui',id:'result-1',patientId:'patient-1',expectedVersion:1,revisionId:'rev-ui',source:'manual',summary:'UI submitted result',collectedAt:converted,receivedAt:toOffsetDateTime('2026-09-17T11:15'),evidenceRef:'Scanned report',reason:'UI submission'}).success,true);
});

test('component datetime conversion rejects empty input before schema validation',()=>{
  assert.throws(()=>toOffsetDateTime(''),RangeError);
});

test('workspace components render named fields, identity, next actions, history, and manual labels',()=>{
  const resultRecords=resultAct(createdResult(),{type:'result.mark-awaiting',actionId:'evt-await',id:'result-1',patientId:'patient-1',expectedVersion:1,reason:'Queued.'});
  const resultHtml=renderToStaticMarkup(React.createElement(ResultsWorkspace,{patientId:'patient-1',records:resultRecords,busy:false,onAction:async()=>{}}));
  for(const text of ['Test results','data-journey="J29"','Owner','Due date','CBC with differential','Incomplete test remains visible','Next permissible action','Record result','History (2)'])assert.ok(resultHtml.includes(text),text);
  const referralRecords=referralAct(createdReferral(),{type:'referral.send',actionId:'evt-send-render',id:'referral-1',patientId:'patient-1',expectedVersion:1,evidenceRef:'Fax confirmation',reason:'Referral sent manually.'});
  const referralHtml=renderToStaticMarkup(React.createElement(ReferralsWorkspace,{patientId:'patient-1',records:referralRecords,busy:false,onAction:async()=>{}}));
  for(const text of ['Referrals','data-journey="J30"','Clinical question','Owner','Neurology','Manual external evidence only','Record acceptance','History (2)'])assert.ok(referralHtml.includes(text),text);
  for(const html of [resultHtml,referralHtml])assert.doesNotMatch(html.replace(/<[^>]+>/g,' '),/\bJ\d{2}\b/,'internal journey codes stay out of visible text');
});

test('shared results adapter enforces strict commands, replay identity, and validated persisted state',()=>{
  const context={actor,now,patients:[{id:'patient-1',name:'Avery'},{id:'patient-2',name:'Jordan'}],features:{}};
  const command={type:'results-referrals.result.create',requestId:'shared-create',id:'shared-result',patientId:'patient-1',encounterId:'enc-1',expectedVersion:0,requestLabel:'CBC',owner:'Nurse',dueAt:'2026-09-18',requestedAt:'2026-09-17',reason:'Evaluate persistent symptoms.'};
  assert.equal(actionSchema.safeParse({...command,actor:'Injected author'}).success,false);
  assert.equal(actionSchema.safeParse({...command,requestedAt:'2026-02-30'}).success,false);
  const state=reduce(initialState(),command,context);
  assert.deepEqual(reduce(state,command,context),state);
  assert.throws(()=>reduce(state,command,{...context,actor:'Another clinician'}),/different actor/);
  assert.throws(()=>reduce(state,{...command,requestLabel:'Different test'},context),/different payload/);
  assert.throws(()=>reduce(state,{...command,patientId:'patient-2'},context),/wrong patient/);
  assert.throws(()=>reduce(state,{...command,requestId:'second-create',patientId:'missing'},context),/Unknown patient/);
  assert.equal(getSummary(state,'patient-1',now).open,1);
  assert.equal(getSummary(state,'patient-2',now).open,0);
  const corrupted=structuredClone(state);corrupted.results[0].status='closed';
  assert.throws(()=>validateState(corrupted),/status/);
  assert.throws(()=>validateState({results:[{}],referrals:[]}));
  const html=renderToStaticMarkup(React.createElement(ResultsReferralsPanel,{patients:context.patients,state,busy:false,onAction:async()=>false}));
  assert.match(html,/Results and referrals for Avery/);
  assert.match(html,/aria-label="Results and referrals patient"/);
});

test('result chronology, correction identity and immutable clinical snapshots cannot be bypassed',()=>{
  const initial=createdResult();
  const receive={type:'result.receive',actionId:'receive-valid',id:'result-1',patientId:'patient-1',expectedVersion:1,revisionId:'revision-1',source:'manual',summary:'Original measured result',collectedAt:'2026-09-17T09:00:00Z',receivedAt:'2026-09-17T11:00:00Z',evidenceRef:'Lab report',reason:'Recorded received document.'};
  assert.throws(()=>resultAct(initial,{...receive,receivedAt:'2026-09-17T08:00:00Z'}),/precede collection/);
  assert.throws(()=>resultAct(initial,{...receive,receivedAt:'2026-09-18T08:00:00Z'}),/future/);
  assert.throws(()=>resultAct(initial,receive,'2026-09-17T13:00:00Z'),/backwards/);
  let state=resultAct(initial,receive);
  assert.throws(()=>resultAct(state,{...receive,summary:'Reused action ID with changed result'}),/different payload/);
  const correction={...receive,type:'result.correct',actionId:'correction',expectedVersion:2,revisionId:'revision-2',correctedFromId:'revision-1',summary:'Corrected measurement'};
  assert.throws(()=>resultAct(state,{...correction,revisionId:'revision-1'}),/already exists/);
  state=resultAct(state,correction);
  assert.throws(()=>resultAct(state,{...correction,actionId:'obsolete-correction',expectedVersion:3,revisionId:'revision-3'}),/current result revision/);
  assert.equal(JSON.parse(state[0].history[0].previousSnapshot).revisions[0].summary,'Original measured result');
  state[0].history.at(-1).reason='Mutated output';
  assert.equal(initial[0].history[0].reason,'Evaluate ongoing fatigue.');
});

test('referral cannot record a future no-show or advice preceding the consultation',()=>{
  let state=createdReferral();
  state=referralAct(state,{type:'referral.send',actionId:'chrono-send',id:'referral-1',patientId:'patient-1',expectedVersion:1,evidenceRef:'Fax receipt',reason:'Sent manually.'});
  state=referralAct(state,{type:'referral.accept',actionId:'chrono-accept',id:'referral-1',patientId:'patient-1',expectedVersion:2,evidenceRef:'Clinic note',reason:'Acceptance confirmed.'});
  state=referralAct(state,{type:'referral.schedule',actionId:'chrono-schedule',id:'referral-1',patientId:'patient-1',expectedVersion:3,scheduledFor:'2026-09-30',evidenceRef:'Booking note',reason:'Scheduled.'});
  assert.throws(()=>referralAct(state,{type:'referral.no-show',actionId:'future-no-show',id:'referral-1',patientId:'patient-1',expectedVersion:4,evidenceRef:'Unconfirmed',reason:'Premature no-show.'}),/before the scheduled date/);
  state=referralAct(state,{type:'referral.consultation-complete',actionId:'chrono-complete',id:'referral-1',patientId:'patient-1',expectedVersion:4,completedAt:'2026-09-30T09:00:00Z',evidenceRef:'Consult note',reason:'Observed completion.'},'2026-09-30T12:00:00Z');
  assert.throws(()=>referralAct(state,{type:'referral.advice-received',actionId:'early-advice',id:'referral-1',patientId:'patient-1',expectedVersion:5,receivedAt:'2026-09-29T12:00:00Z',adviceSummary:'Advice',originalAdvice:'Full advice',evidenceRef:'Report',reason:'Invalid sequence.'},'2026-09-30T12:00:00Z'),/precede consultation/);
});

test('datetime-local conversion respects a non-UTC browser timezone and rejects invalid dates',()=>{
  const original=process.env.TZ;
  try{process.env.TZ='America/New_York';assert.equal(toOffsetDateTime('2026-09-17T09:00'),'2026-09-17T13:00:00.000Z');assert.throws(()=>toOffsetDateTime('2026-02-30T09:00'),RangeError);}finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
});

test('request acceptance, dated coverage and preliminary/final/corrected reports retain independent evidence',()=>{
  const context={actor,now:'2026-09-24T14:00:00Z',patients:[{id:'patient-1',name:'David'}],features:{}};
  let state=initialState(),n=0;
  const current=()=>state.results[0];
  const command=(verb,fields={})=>({type:'results-referrals.result.'+verb,id:'detailed-result',patientId:'patient-1',expectedVersion:current()?.version??0,requestId:'detailed-result-'+(++n),reason:'Review the investigation and its accountable next action.',...fields});
  const run=(verb,fields={})=>state=reduce(state,command(verb,fields),context);
  let tracking={requestStage:'draft',backupOwner:'Covering clinician',reviewerAvailability:'absent',dueWindow:{start:'2026-09-24T09:00:00+01:00',end:'2026-09-24T17:00:00+01:00',timezone:'Europe/Lisbon'},priority:'urgent',policyRef:'Recorded local urgent-result protocol',nextAction:'Obtain the missing report and confirm covering responsibility.',requestEvidence:'Ordering record and receiving service confirmation',requestRecordedBy:'Ordering clinician',requestRecordedAt:context.now};
  run('create',{encounterId:'test-encounter',requestLabel:'Follow-up investigation',owner:'Usual clinician',dueAt:'2026-09-24',requestedAt:'2026-09-20',tracking});
  assert.throws(()=>run('mark-awaiting'),/Authorize and submit/);
  assert.throws(()=>run('track',{tracking:{...tracking,requestStage:'completed'}}),/separately/);
  for(const requestStage of ['authorized','submitted','accepted']){tracking={...tracking,requestStage};run('track',{tracking});}
  tracking={...tracking,coverage:{requestedOwner:'Covering clinician',status:'requested'}};run('track',{tracking});
  assert.throws(()=>run('track',{tracking:{...tracking,coverage:{...tracking.coverage,status:'accepted'}}}),/Acceptance requires/);
  tracking={...tracking,coverage:{...tracking.coverage,status:'accepted',acceptedBy:'Covering clinician',acceptedAt:context.now,evidenceRef:'Covering clinician confirmed responsibility'}};run('track',{tracking});
  assert.equal(current().owner,'Covering clinician');
  const report={source:'manual',collectedAt:'2026-09-23T09:00:00Z',receivedAt:context.now,evidenceRef:'Laboratory report',summary:'Preliminary report; final review pending.',findings:[{label:'Recorded finding',value:'4.2',unit:'mmol/L'}]};
  run('receive',{...report,revisionId:'preliminary',reportStatus:'preliminary'});
  run('finalize',{...report,revisionId:'final',finalizedFromId:'preliminary',reportStatus:'final',summary:'Final report received.'});
  assert.equal(current().revisions[1].reportStatus,'preliminary');assert.equal(current().revisions[0].findings[0].unit,'mmol/L');
  for(const [verb,fields] of [['review',{interpretation:'Covering clinician reviewed the final report.',evidenceRef:'Clinical review'}],['act',{clinicalDisposition:'Follow-up plan documented.',evidenceRef:'Plan'}],['communicate',{contactEvidence:'Patient telephone discussion'}]])run(verb,fields);
  assert.throws(()=>run('close'),/Complete the request/);
  tracking={...tracking,requestStage:'completed'};run('track',{tracking});run('close');
  run('correct',{...report,revisionId:'corrected',correctedFromId:'final',reportStatus:'corrected',summary:'Laboratory supplied a material correction.'});
  assert.equal(current().status,'received');assert.equal(current().interpretation,'');assert.equal(JSON.parse(current().history[0].previousSnapshot).status,'closed');
  const saved=JSON.stringify(state);assert.throws(()=>reduce(state,{...command('track',{tracking}),tracking:{...tracking,unexpected:true}},context));assert.equal(JSON.stringify(state),saved);
});

test('electronic consultation supports clarification and explicit patient communication without an appointment',()=>{
  let records=[];let n=0;
  const run=(type,fields={})=>{records=referralAct(records,{type:'referral.'+type,id:'econsult',patientId:'patient-1',expectedVersion:records[0]?.version??0,actionId:'econsult-'+(++n),reason:'Review focused electronic advice.',...fields});};
  run('create',{encounterId:'enc-1',mode:'electronic-consultation',clinicalQuestion:'Please clarify the conflicting advice.',receivingService:'Specialist advice service',owner:'Referring clinician',dueAt:'2026-09-25',supportingEvidence:'Authorized record packet'});
  run('send',{evidenceRef:'Service receipt'});run('clarification',{question:'Please provide the prior investigation.',evidenceRef:'Specialist request'});run('respond',{response:'Prior investigation supplied.',evidenceRef:'Updated packet receipt'});run('accept',{evidenceRef:'Service accepted the question'});
  run('advice-received',{receivedAt:'2026-09-24T14:00:00Z',adviceSummary:'Specialist advice received.',originalAdvice:'Original specialist wording retained.',evidenceRef:'Consultation report'});
  assert.equal(records[0].scheduledFor,'');run('review',{reviewSummary:'Referrer reconciled the differing advice.',evidenceRef:'Clinical review'});run('plan-reconciled',{reconciliationPlan:'Reviewed next steps.',evidenceRef:'Plan'});
  assert.throws(()=>run('close'),/patient instructions/);
  run('communicate',{communicatedAt:'2026-09-24T14:00:00Z',evidenceRef:'Patient explained the next step'});run('close');
  assert.equal(records[0].status,'closed');assert.match(records[0].clarification,/Prior investigation supplied/);
});

test('declined referrals retain an owned alternative and receiving transfer requires a separate acceptance',()=>{
  let records=[];let n=0;
  const run=(type,fields={})=>{records=referralAct(records,{type:'referral.'+type,id:'declined-referral',patientId:'patient-1',expectedVersion:records[0]?.version??0,actionId:'declined-'+(++n),reason:'Patient prefers another feasible next step.',...fields});};
  run('create',{encounterId:'enc-1',mode:'appointment',clinicalQuestion:'Review rehabilitation options.',receivingService:'Rehabilitation',owner:'Referring team',dueAt:'2026-09-25',supportingEvidence:'Current plan'});run('decline',{evidenceRef:'Patient declined the travel requirement'});
  run('alternative',{disposition:{decision:'Review a remote option with the patient.',reviewedBy:'Referring clinician',reviewedAt:'2026-09-24T14:00:00Z',patientAgreement:'agreed',nextAction:'Receiving team to arrange remote review.'}});run('communicate',{communicatedAt:'2026-09-24T14:00:00Z',evidenceRef:'Agreed patient instructions'});
  const acceptance={requestedOwner:'Receiving clinician',status:'accepted',acceptedBy:'Receiving clinician',acceptedAt:'2026-09-24T14:00:00Z',evidenceRef:'Receiving clinician accepted the next action'};
  assert.throws(()=>run('transfer',{transfer:acceptance}),/Request receiving ownership/);run('transfer',{transfer:{requestedOwner:'Receiving clinician',status:'requested'}});assert.equal(records[0].owner,'Referring team');run('transfer',{transfer:acceptance});run('close');
  assert.equal(records[0].owner,'Receiving clinician');assert.equal(records[0].specialistAdvice,undefined);
});

test('duplicate referral linkage cannot cross patient records or abandon its original clinical question',()=>{
  let records=[...createdReferral('original'),...createdReferral('duplicate'),...createdReferral('other-patient','patient-2')];
  const action={type:'referral.duplicate',id:'duplicate',patientId:'patient-1',expectedVersion:1,actionId:'duplicate-link',reason:'Confirmed duplicate request.',evidenceRef:'Coordinator comparison',duplicateOfId:'other-patient'};
  assert.throws(()=>referralAct(records,action),/same patient/);
  records=referralAct(records,{...action,duplicateOfId:'original'});assert.equal(records.find(item=>item.id==='duplicate').duplicateOfId,'original');assert.equal(records.find(item=>item.id==='original').status,'requested');
});

test('existing referral scope can be completed without rewriting advice or switching an attended consultation to e-consult',()=>{
  let records=createdReferral('scope-referral');
  const coordination={referringClinician:'Referring clinician',urgency:'routine',authorizedPacket:'Existing authorized record packet',backupOwner:'Covering clinician',dueWindow:{end:'2026-09-25T17:00:00+01:00',timezone:'Europe/Lisbon'}};
  records=referralAct(records,{type:'referral.configure',id:'scope-referral',patientId:'patient-1',expectedVersion:1,actionId:'scope-configure',mode:'appointment',coordination,reason:'Confirm existing referral scope and cover.'});
  assert.equal(records[0].status,'requested');assert.equal(records[0].clinicalQuestion,createdReferral('comparison')[0].clinicalQuestion);
  records=referralAct(records,{type:'referral.send',id:'scope-referral',patientId:'patient-1',expectedVersion:2,actionId:'scope-send',evidenceRef:'Service receipt',reason:'Sent authorized record packet.'});
  assert.throws(()=>referralAct(records,{type:'referral.configure',id:'scope-referral',patientId:'patient-1',expectedVersion:3,actionId:'scope-change',mode:'electronic-consultation',coordination,reason:'Cannot rewrite a transmitted appointment request.'}),/cannot rewrite/);
  assert.equal(isReferralOverdue(records[0],'2026-09-25T15:59:59Z'),false);
  assert.equal(isReferralOverdue(records[0],'2026-09-25T16:00:01Z'),true);
});
