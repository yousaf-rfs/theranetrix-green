import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({stdin:{contents:"export * from './lib/clinical-flows/results-referrals'; export {initialState as treatmentState,reduce as reduceTreatment} from './lib/clinical-flows/treatment-continuity'; export {careActionReferences} from './lib/clinical-flows/context'; export {ResultsWorkspace,ReferralsWorkspace} from './components/theranetrix/clinical-flows/results-referrals'; export {TreatmentContinuityPanel} from './components/theranetrix/clinical-flows/treatment-continuity';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty','.module.css':'empty'},write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {initialState,reduce,nextResultActions,nextReferralActions,ResultsWorkspace,ReferralsWorkspace,treatmentState,reduceTreatment,careActionReferences,TreatmentContinuityPanel}=mod.exports;
const patientId='patient-1',now='2026-09-24T14:00:00Z',context={actor:'Reviewing clinician',now,patients:[{id:patientId,name:'Avery Stone'}],features:{}};
const render=(component,records)=>renderToStaticMarkup(React.createElement(component,{patientId,records,busy:false,onAction:async()=>true}));

test('result guidance and available forms respect request acceptance, cover and final-report closure gates',()=>{
  let state=initialState(),n=0;
  const run=(verb,fields={})=>{state=reduce(state,{type:'results-referrals.result.'+verb,patientId,id:'result-1',expectedVersion:state.results[0]?.version??0,requestId:'ux-result-'+(++n),reason:'Record the observed step.',...fields},context);};
  let tracking={requestStage:'draft',backupOwner:'Covering clinician',dueWindow:{end:'2026-09-25T17:00:00Z',timezone:'UTC'},priority:'routine',nextAction:'Confirm the request was accepted.'};
  run('create',{encounterId:'visit-1',requestLabel:'Outside laboratory result',owner:'Primary reviewer',dueAt:'2026-09-25',requestedAt:'2026-09-24',tracking});
  assert.deepEqual(nextResultActions(state.results[0]),['Record request authorization','Cancel request']);
  assert.doesNotMatch(render(ResultsWorkspace,state.results),/<h4>Record result<\/h4>|<h4>Mark awaiting result<\/h4>/);
  for(const requestStage of ['authorized','submitted','accepted']){tracking={...tracking,requestStage,requestEvidence:'Service receipt',requestRecordedBy:'Coordinator',requestRecordedAt:now};run('track',{tracking});}
  assert.ok(nextResultActions(state.results[0]).includes('Record result'));
  assert.match(render(ResultsWorkspace,state.results),/<h4>Record result<\/h4>/);
  const report={source:'manual',collectedAt:now,receivedAt:now,evidenceRef:'Report document',summary:'Reported finding.'};
  run('receive',{...report,revisionId:'preliminary',reportStatus:'preliminary'});
  tracking={...tracking,reviewerAvailability:'absent'};run('track',{tracking});
  assert.ok(nextResultActions(state.results[0]).includes('Request covering reviewer'));
  assert.doesNotMatch(render(ResultsWorkspace,state.results),/<h4>Interpretation<\/h4>/);
  tracking={...tracking,reviewerAvailability:'available'};run('track',{tracking});
  run('review',{interpretation:'Reviewed preliminary findings.',evidenceRef:'Clinical note'});run('act',{clinicalDisposition:'Follow-up documented.',evidenceRef:'Clinical plan'});run('communicate',{contactEvidence:'Patient discussion'});
  assert.ok(nextResultActions(state.results[0]).includes('Record final report'));assert.ok(!nextResultActions(state.results[0]).includes('Close workflow'));
  assert.doesNotMatch(render(ResultsWorkspace,state.results),/<h4>Close workflow<\/h4>/);
  run('finalize',{...report,revisionId:'final',finalizedFromId:'preliminary',reportStatus:'final'});
  run('review',{interpretation:'Reviewed final findings.',evidenceRef:'Clinical note'});run('act',{clinicalDisposition:'Final follow-up documented.',evidenceRef:'Clinical plan'});run('communicate',{contactEvidence:'Patient discussed final report'});
  assert.ok(nextResultActions(state.results[0]).includes('Record request completion'));assert.ok(!nextResultActions(state.results[0]).includes('Close workflow'));
  tracking={...tracking,requestStage:'completed'};run('track',{tracking});
  assert.ok(nextResultActions(state.results[0]).includes('Close workflow'));assert.match(render(ResultsWorkspace,state.results),/<h4>Close workflow<\/h4>/);
});

test('e-consultation guides advice and communication without suggesting an appointment or premature closure',()=>{
  let state=initialState(),n=0;
  const run=(verb,fields={})=>{state=reduce(state,{type:'results-referrals.referral.'+verb,patientId,id:'econsult',expectedVersion:state.referrals[0]?.version??0,requestId:'ux-referral-'+(++n),reason:'Record the observed step.',...fields},context);};
  run('create',{encounterId:'visit-1',mode:'electronic-consultation',clinicalQuestion:'Clarify current advice.',receivingService:'Specialist advice',owner:'Referring clinician',dueAt:'2026-09-25',supportingEvidence:'Authorized clinical packet'});run('send',{evidenceRef:'Service receipt'});run('accept',{evidenceRef:'Acceptance receipt'});
  assert.ok(nextReferralActions(state.referrals[0]).includes('Record specialist advice'));assert.ok(!nextReferralActions(state.referrals[0]).includes('Schedule consultation'));
  assert.match(render(ReferralsWorkspace,state.referrals),/<h4>Record specialist advice<\/h4>/);assert.doesNotMatch(render(ReferralsWorkspace,state.referrals),/<h4>Schedule consultation<\/h4>/);
  run('advice-received',{receivedAt:now,adviceSummary:'Specialist advice available.',originalAdvice:'Original advice retained.',evidenceRef:'Service report'});run('review',{reviewSummary:'Advice reviewed in context.',evidenceRef:'Clinical note'});run('plan-reconciled',{reconciliationPlan:'Agreed follow-up.',evidenceRef:'Plan note'});
  assert.deepEqual(nextReferralActions(state.referrals[0]),['Document patient communication']);assert.doesNotMatch(render(ReferralsWorkspace,state.referrals),/<h4>Close referral<\/h4>/);
  const html=render(ReferralsWorkspace,state.referrals),target=/aria-controls="([^"]+)"/.exec(html)?.[1];
  assert.ok(target);assert.ok(html.includes('id="'+target+'"'));assert.match(html,/<h3[^>]+tabindex="-1"[^>]*>Update Specialist advice<\/h3>/);
});

test('same-version linked treatment records have distinct clinical labels and references inside mounted disclosure forms',()=>{
  let state=treatmentState();
  state=reduceTreatment(state,{type:'treatment-continuity.record-reconciliation',patientId,id:'reconciliation-one',requestId:'ux-source',reason:'Review outside list.',source:'Hospital medication list',sourceDate:'2026-09-23',status:'unreviewed',conflicts:[],owner:'Coordinating nurse',dueDate:'2026-09-25'},context);
  state=reduceTreatment(state,{type:'treatment-continuity.update-lifecycle',patientId,id:'order-two',requestId:'ux-order',reason:'Review proposed treatment.',medicationName:'Recorded medication',stage:'considered',safetyPrerequisites:[],reviewPrerequisites:[],prescriberResponsibility:'Usual prescriber',clinicalServiceAvailable:false,owner:'Reviewing clinician'},context);
  const refs=careActionReferences({clinicalWorkflows:{slices:{'results-referrals':{state:initialState()},'treatment-continuity':{state},encounters:{state:{signoffs:[]}}}}});
  assert.equal(refs.length,2);assert.equal(refs[0].title,'Reconciliation: Hospital medication list');assert.equal(refs[1].title,'Medication order: Recorded medication');assert.equal(refs[0].version,refs[1].version);
  const html=renderToStaticMarkup(React.createElement(TreatmentContinuityPanel,{patientId,patients:context.patients,state,careActions:refs,busy:false,onAction:async()=>true}));
  assert.match(html,/Reconciliation: Hospital medication list · Coordinating nurse · version 1 · ref reconciliation-one/);
  assert.match(html,/Medication order: Recorded medication · Reviewing clinician · version 1 · ref order-two/);
  assert.equal((html.match(/<details><summary data-journey="J\d{2}"><h3>/g)||[]).length,6);
  assert.match(html,/name="orderEvidence.orderId"/);assert.match(html,/name="accessReview.careAction"/);
});
