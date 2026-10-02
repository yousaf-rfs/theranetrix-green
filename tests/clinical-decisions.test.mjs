import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const temp=await mkdtemp(join(tmpdir(),'clinical-decisions-'));
after(()=>rm(temp,{recursive:true,force:true}));
const result=await build({stdin:{contents:"export * from './lib/clinical-flows/decisions'; export {buildEngineOutput,engineRecordRevision} from './lib/engine-demo'; export {seedWorkspace} from './lib/theranetrix';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
await writeFile(join(temp,'decisions.mjs'),result.outputFiles[0].text);
const {initialState,reduce,actionSchema,validateState,getSummary,diffDecisionSources,buildEngineOutput,engineRecordRevision,seedWorkspace}=await import(pathToFileURL(join(temp,'decisions.mjs')).href);

const patientA={id:'TN-1042',name:'Sarah Mitchell'};
const patientB={id:'TN-1038',name:'James Wilson'};
const baseContext={actor:'Clinical reviewer',now:'2026-09-17T14:00:00.000Z',patients:[patientA,patientB],features:{decisionsExport:true}};
const apply=(state,action,context=baseContext)=>reduce(state,actionSchema.parse(action),context);
let sequence=0;
const request=()=>`decisions-test-${++sequence}`;
const scope={patientId:patientA.id,encounterId:'E-1'};
const ev1={id:'ev-1',title:'Guideline',locator:'Section 4',version:'2026.1',reviewDate:'2026-09-01'};
const ev2={id:'ev-2',title:'Case series',locator:'Appendix B',version:'2025.9',reviewDate:'2026-08-15'};
const review=(overrides={})=>({type:'decisions.review.capture',requestId:request(),...scope,expectedVersion:0,inputVersion:'input-v1',collectedAt:'2026-09-17T12:00:00.000Z',receivedAt:'2026-09-17T12:10:00.000Z',provenance:'observed',metrics:{pain:{prior:7,current:0},function:{prior:4,current:6},sleep:{prior:3,current:4}},contradictoryMetrics:[],clinicalInterpretation:'Reviewed observations and patient narrative.',goal:'Walk twenty minutes.',nextMonitoringQuestion:'What changed before the pain drop?',...overrides});
const comparison=(overrides={})=>({type:'decisions.comparison.capture',requestId:request(),...scope,expectedVersion:0,inputVersion:'input-v1',preferenceSummary:'Patient prefers function and safety.',preferenceWeights:{relief:30,function:40,sleep:20,safety:10},options:[{id:'opt-1',title:'Discuss current plan',status:'for-discussion',rationale:'Needs clinician review.',applicability:'Applies if safety review remains stable.',evidenceRefs:['ev-1']}],disposition:'defer',rationale:'Default action does not prescribe.',safetyReview:'Missing outside lab values.',missingInputs:['Outside lab values'],evidenceRefs:[ev1],...overrides});
const output=(overrides={})=>({type:'decisions.outputs.capture',requestId:request(),...scope,expectedVersion:0,inputVersion:'input-v1',pst:{outputId:'pst-fixture-1',summary:'Synthetic PST candidate ranking A',limitations:['Synthetic output only']},shadow:{outputId:'shadow-fixture-1',summary:'Synthetic Shadow candidate ranking B',limitations:['Synthetic output only']},agreement:'disagree',limitations:['Agreement is not confidence'],supportingEvidence:[ev1],conflictingEvidence:[ev2],clarificationRequests:['Confirm comparator details'],clinicianDisposition:'defer',dispositionExplanation:'Needs discussion.',suitability:'unsupported',provenance:'synthetic',modelVersions:['fixture-model-v1'],configurationVersions:['fixture-config-v1'],...overrides});
const draftPayload=state=>({observedReviewId:state.observedReviews[0]?.id,comparisonSnapshotId:state.comparisonSnapshots[0]?.id,engineComparisonId:state.engineComparisons[0]?.id,pendingDisposition:'defer',note:'Awaiting follow-up'});
const save=(state,overrides={})=>({type:'decisions.draft.save',requestId:request(),...scope,expectedInputVersion:'input-v1',summary:'Draft summary shown to the reviewer',payload:draftPayload(state),...overrides});
function seedComplete(){
  let state=apply(initialState(),review());state=apply(state,comparison());state=apply(state,output());return apply(state,save(state));
}
const sign=(state,overrides={})=>({type:'decisions.sign.capture',requestId:request(),...scope,draftId:state.drafts[0].id,expectedDraftVersion:state.drafts[0].version,expectedInputVersion:state.drafts[0].expectedInputVersion,disposition:'defer',rationale:'Need clarifications.',patientPlanRef:'plan-42',evidenceVersions:['2025.9','2026.1'],modelVersions:['fixture-model-v1'],configurationVersions:['fixture-config-v1'],displayedSummary:state.drafts[0].summary,...overrides});
const revise=(version,expected='input-v1')=>({type:'decisions.input.revise',requestId:request(),...scope,inputVersion:version,expectedInputVersion:expected,reason:'New source information received'});
const status=(state,type,extra={})=>({type,requestId:request(),...scope,draftId:state.drafts[0].id,expectedVersion:state.drafts[0].version,reason:'Review follow-up',...extra});

test('J05 preserves zero and missing values and evaluates freshness against review time',()=>{
  const state=initialState();const before=structuredClone(state);
  const next=apply(state,review({collectedAt:'2026-09-01T12:00:00Z',receivedAt:'2026-09-01T12:10:00Z',metrics:{pain:{prior:5,current:0},function:{current:6},sleep:{prior:3,current:3}}}));
  assert.deepEqual(state,before);assert.equal(next.observedReviews[0].metrics.pain.current,0);
  assert.equal(next.observedReviews[0].metrics.pain.direction,'improved');
  assert.equal(next.observedReviews[0].metrics.function.direction,'insufficient-data');
  assert.equal(next.observedReviews[0].metrics.sleep.direction,'unchanged');assert.equal(next.observedReviews[0].dataFreshness,'stale');
  assert.throws(()=>apply(state,review({receivedAt:'2026-09-17T11:59:00Z'})),/before collection/);
  assert.throws(()=>apply(state,review({receivedAt:'2026-09-18T12:10:00Z'})),/future/);
});

test('J06 preserves entered preferences and options and rejects missing or ambiguous evidence',()=>{
  const next=apply(initialState(),comparison());
  assert.equal(next.comparisonSnapshots[0].defaultAction,'no-prescription');
  assert.equal(next.comparisonSnapshots[0].options[0].title,'Discuss current plan');
  assert.deepEqual(next.comparisonSnapshots[0].preferenceWeights,{relief:30,function:40,sleep:20,safety:10});
  assert.throws(()=>apply(initialState(),comparison({preferenceWeights:{relief:0,function:0,sleep:0,safety:0}})),/weight/);
  assert.throws(()=>apply(initialState(),comparison({evidenceRefs:[]})),/not captured/);
  assert.throws(()=>apply(initialState(),comparison({evidenceRefs:[ev1,ev1]})),/unique/);
  assert.throws(()=>apply(initialState(),comparison({evidenceRefs:[{...ev1,reviewDate:'2026-02-30'}]})),/calendar date/);
});

test('J07 stores distinct exact outputs and provenance without treating agreement as correctness',()=>{
  const next=apply(initialState(),output({agreement:'agree',clinicianDisposition:'reject-both',dispositionExplanation:'Both synthetic suggestions conflict with patient evidence.'}));
  const saved=next.engineComparisons[0];
  assert.notEqual(saved.pst.summary,saved.shadow.summary);assert.equal(saved.provenance,'synthetic');
  assert.equal(saved.clinicianDisposition,'reject-both');assert.equal(saved.conflictingEvidence.length,1);
  assert.throws(()=>apply(initialState(),output({suitability:'evidence-reviewed',supportingEvidence:[],conflictingEvidence:[]})),/evidence/i);
  assert.throws(()=>apply(initialState(),output({shadow:{outputId:'pst-fixture-1',summary:'B',limitations:[]}})),/distinct/);
});

test('captures cannot regress input revisions or bypass authoritative patient source versions',()=>{
  let next=seedComplete();next=apply(next,revise('input-v2'));
  assert.throws(()=>apply(next,comparison({expectedVersion:1})),/Input version changed/);
  assert.throws(()=>apply(next,revise('input-v1','input-v2')),/prior input version/);
  assert.throws(()=>apply(next,revise('input-v3','input-v1')),/another session/);
  const context={...baseContext,inputVersions:[{...scope,inputVersion:'server-v2'}]};
  assert.throws(()=>apply(initialState(),review(),context),/Source input version changed/);
  assert.throws(()=>apply(initialState(),review({encounterId:'OTHER',inputVersion:'server-v2'}),context),/No current source/);
  const captured=apply(next,review({expectedVersion:1,inputVersion:'server-v2'}),context);
  assert.equal(captured.inputRevisions[0].inputVersion,'server-v2');
  assert.equal(captured.observedReviews[0].inputVersion,'server-v2');
  assert.equal(next.inputRevisions[0].inputVersion,'input-v2');
});

test('J20 stale source correction requires new reviewed records and updates actual draft text',()=>{
  let next=seedComplete();next=apply(next,revise('input-v2'));
  assert.throws(()=>apply(next,sign(next)),/Input version changed/);
  assert.throws(()=>apply(next,status(next,'decisions.summary.correct',{expectedInputVersion:'input-v2',summary:'Corrected actual text',payload:draftPayload(next)})),/different source input version/);
  next=apply(next,review({expectedVersion:1,inputVersion:'input-v2'}));
  next=apply(next,comparison({expectedVersion:1,inputVersion:'input-v2'}));
  next=apply(next,output({expectedVersion:1,inputVersion:'input-v2'}));
  next=apply(next,status(next,'decisions.summary.correct',{expectedInputVersion:'input-v2',summary:'Corrected actual text',payload:draftPayload(next)}));
  assert.equal(next.drafts[0].summary,'Corrected actual text');assert.equal(next.drafts[0].status,'corrected');
  const signed=apply(next,sign(next));assert.equal(signed.signedSnapshots[0].displayedOutputs.summary,'Corrected actual text');
});

test('same-input record updates retain prior revisions and invalidate a draft until re-reviewed',()=>{
  let next=seedComplete();const original=structuredClone(next.observedReviews[0]);
  next=apply(next,review({expectedVersion:1,clinicalInterpretation:'Amended reviewed observation'}));
  assert.equal(next.observedReviews.length,2);assert.deepEqual(next.observedReviews[1],original);
  assert.throws(()=>apply(next,sign(next)),/changed after review/);
  next=apply(next,save(next,{draftId:next.drafts[0].id,expectedVersion:next.drafts[0].version}));
  const signed=apply(next,sign(next));
  assert.equal(signed.signedSnapshots[0].reviewedInput.observedReview.clinicalInterpretation,'Amended reviewed observation');
});

test('draft writes require optimistic locks and patient/encounter-owned references',()=>{
  const next=seedComplete();
  assert.throws(()=>apply(next,save(next,{draftId:next.drafts[0].id})),/expected draft version/);
  assert.throws(()=>apply(next,save(next,{draftId:'unknown',expectedVersion:0})),/Draft not found/);
  assert.throws(()=>apply(next,save(next,{patientId:patientB.id})),/does not belong/);
  assert.throws(()=>apply(next,save(next,{encounterId:'E-2'})),/does not belong/);
  assert.throws(()=>apply(next,save(next,{patientId:patientB.id,draftId:next.drafts[0].id,expectedVersion:1,payload:{note:'foreign draft id'}})),/Draft not found/);
  assert.throws(()=>apply(next,save(next,{draftId:next.drafts[0].id,expectedVersion:99})),/another session/);
});

test('cancelled and disputed drafts cannot sign; retry and correction preserve saved content',()=>{
  let next=seedComplete();next=apply(next,status(next,'decisions.summary.dispute'));
  assert.throws(()=>apply(next,sign(next)),/saved or corrected/);
  assert.throws(()=>apply(next,save(next,{draftId:next.drafts[0].id,expectedVersion:next.drafts[0].version})),/correction workflow/);
  next=apply(next,status(next,'decisions.summary.correct',{expectedInputVersion:'input-v1',summary:'Corrected summary',payload:draftPayload(next)}));
  next=apply(next,status(next,'decisions.draft.cancel'));
  assert.throws(()=>apply(next,sign(next)),/saved or corrected/);
  next=apply(next,status(next,'decisions.draft.retry'));
  assert.equal(next.drafts[0].payload.note,'Awaiting follow-up');assert.equal(next.drafts[0].status,'draft');
  assert.throws(()=>apply(next,status(next,'decisions.draft.retry')),/Only a cancelled/);
  assert.throws(()=>apply(next,sign(next)),/saved or corrected/);
});

test('J18 sign-off binds the exact summary, disposition, and captured metadata',()=>{
  const next=seedComplete();
  assert.throws(()=>apply(next,sign(next,{displayedSummary:'Hidden replacement text'})),/exactly match/);
  assert.throws(()=>apply(next,sign(next,{disposition:'approve'})),/disposition must match/);
  assert.throws(()=>apply(next,sign(next,{modelVersions:['invented-model']})),/must match the captured/);
  assert.throws(()=>apply(next,sign(next,{evidenceVersions:['2026.1']})),/must match the captured/);
  assert.throws(()=>apply(next,sign(next),{...baseContext,inputVersions:[{...scope,inputVersion:'server-changed'}]}),/Source input version changed/);
  const command=sign(next);const signed=apply(next,command);
  assert.equal(signed.drafts[0].status,'signed');assert.equal(signed.signedSnapshots[0].displayedOutputs.summary,next.drafts[0].summary);
  assert.deepEqual(apply(signed,command),signed);
  assert.throws(()=>apply(signed,sign(signed)),/saved or corrected/);
  assert.throws(()=>apply(signed,status(signed,'decisions.summary.dispute')),/amendment/);
});

test('immutable signed originals survive later captures and amendment chains cannot fork silently',()=>{
  let next=seedComplete();next=apply(next,sign(next));const original=structuredClone(next.signedSnapshots[0]);
  next=apply(next,review({expectedVersion:1,clinicalInterpretation:'New review after signing'}));
  assert.deepEqual(next.signedSnapshots[0],original);
  const amend={type:'decisions.sign.amend',requestId:request(),...scope,signedSnapshotId:original.id,expectedVersion:1,reason:'Correct documentation wording',disposition:'no-change',rationale:'Amended rationale',patientPlanRef:'plan-42'};
  const amended=apply(next,amend);
  assert.deepEqual(amended.signedSnapshots[1],original);assert.equal(amended.signedSnapshots[0].amendmentOf,original.id);assert.equal(amended.signedSnapshots[0].version,2);
  assert.throws(()=>apply(amended,{...amend,requestId:request()}),/later amendment/);
  assert.throws(()=>apply(next,{...amend,patientId:patientB.id}),/not found/);
});

test('trusted care-plan scope blocks foreign plan IDs and freezes the referenced plan contents',()=>{
  const context={...baseContext,carePlans:[{id:'plan-42',patientId:patientA.id,version:2,summary:'Reviewed patient care plan',goal:'Walking goal'},{id:'foreign-plan',patientId:patientB.id,version:1,summary:'Other patient plan'}]};
  const next=seedComplete();
  assert.throws(()=>apply(next,sign(next,{patientPlanRef:'foreign-plan'}),context),/saved care plan for this patient/);
  assert.throws(()=>apply(next,sign(next,{patientPlanRef:'invented-plan'}),context),/saved care plan for this patient/);
  const signed=apply(next,sign(next),context);
  assert.deepEqual(signed.signedSnapshots[0].patientPlanSnapshot,context.carePlans[0]);
  context.carePlans[0].summary='Changed after sign-off';
  assert.equal(signed.signedSnapshots[0].patientPlanSnapshot.summary,'Reviewed patient care plan');
  assert.throws(()=>apply(signed,{type:'decisions.sign.amend',requestId:request(),...scope,signedSnapshotId:signed.signedSnapshots[0].id,reason:'Wrong plan',disposition:'defer',rationale:'Wrong plan',patientPlanRef:'foreign-plan'},context),/saved care plan for this patient/);
});

test('authorized exports include the exact records and authorization is rechecked on replay',()=>{
  let next=seedComplete();next=apply(next,sign(next));const snapshot=next.signedSnapshots[0];
  const command={type:'decisions.export.capture',requestId:request(),...scope,signedSnapshotId:snapshot.id,format:'json'};
  const exported=apply(next,command);assert.deepEqual(JSON.parse(exported.exports[0].content).snapshot,snapshot);
  assert.throws(()=>apply(exported,command,{...baseContext,features:{decisionsExport:false}}),/authorization/);
  assert.throws(()=>apply(exported,command,{...baseContext,patients:[patientB]}),/Patient not found/);
  assert.throws(()=>apply(next,{...command,patientId:patientB.id}),/not found/);
  assert.throws(()=>apply(next,{...command,encounterId:'E-2'}),/not found/);
  const readable=apply(exported,{...command,requestId:request(),format:'readable'}).exports[0].content;
  assert.ok(readable.includes(snapshot.displayedOutputs.summary));assert.ok(readable.includes('Synthetic Shadow candidate ranking B'));
  assert.ok(!readable.includes(patientB.id));
});

test('idempotency binds the actor and payload and supports long valid clinical entries',()=>{
  const command=review({requestId:'x'.repeat(200),clinicalInterpretation:'a'.repeat(6000)});
  const next=apply(initialState(),command);assert.equal(next.observedReviews[0].clinicalInterpretation.length,6000);
  assert.deepEqual(apply(next,command),next);
  assert.throws(()=>apply(next,{...command,goal:'Changed after submission'}),/different payload/);
  assert.throws(()=>apply(next,command,{...baseContext,actor:'Another reviewer'}),/different payload/);
  assert.equal(actionSchema.safeParse({...command,extraKey:'nope'}).success,false);
});

test('state validation rejects duplicate identifiers and cross-patient signed input',()=>{
  assert.throws(()=>validateState({}),/observedReviews/);
  let next=seedComplete();next=apply(next,sign(next));
  const duplicate=structuredClone(next);duplicate.drafts.push(duplicate.drafts[0]);assert.throws(()=>validateState(duplicate),/unique/);
  const foreign=structuredClone(next);foreign.signedSnapshots[0].reviewedInput.observedReview.patientId=patientB.id;
  assert.throws(()=>validateState(foreign),/another patient/);
});

test('summary counts saved unsigned work, disputes, and stale drafts while excluding signed history',()=>{
  let next=seedComplete();next=apply(next,save(initialState(),{encounterId:'E-2',payload:{note:'Another unsigned draft'}}));
  const first=next.drafts.find(row=>row.encounterId==='E-1');
  next=apply(next,{type:'decisions.summary.dispute',requestId:request(),...scope,draftId:first.id,expectedVersion:first.version,reason:'Disputed summary'});
  next=apply(next,revise('input-v9'));const summary=getSummary(next,patientA.id);
  assert.equal(summary.open,2);assert.equal(summary.overdue,1);assert.ok(summary.attention.some(text=>text.includes('disputed')));assert.ok(summary.attention.some(text=>text.includes('stale')));
  let signed=seedComplete();signed=apply(signed,sign(signed));signed=apply(signed,revise('input-v2'));
  assert.deepEqual(getSummary(signed,patientA.id),{open:0,overdue:0,attention:[]});
});

test('panel scopes supplied context to the selected patient and encounter and exposes genuine controls',async()=>{
  const rendered=await build({stdin:{contents:"import {createElement} from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {DecisionsPanel} from './components/theranetrix/clinical-flows/decisions'; export const render=(props)=>renderToStaticMarkup(createElement(DecisionsPanel,props));",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',loader:{'.css':'empty','.module.css':'empty'},banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"},write:false});
  await writeFile(join(temp,'panel.mjs'),rendered.outputFiles[0].text);
  const {render}=await import(pathToFileURL(join(temp,'panel.mjs')).href);
  const html=render({patientId:patientA.id,patients:[patientA,patientB],state:initialState(),busy:false,onAction:async()=>true,clinicalContext:{currentInputVersion:'server-fingerprint',inputVersions:[{...scope,inputVersion:'server-fingerprint'}],engineRuns:[{...scope,inputVersion:'server-fingerprint',pstOutputId:'pstA',shadowOutputId:'shadowA',summary:'Selected patient context'},{patientId:patientB.id,encounterId:'E-1',inputVersion:'v1',pstOutputId:'pstB',shadowOutputId:'shadowB',summary:'PRIVATE_OTHER_PATIENT'},{...scope,encounterId:'E-2',inputVersion:'v1',pstOutputId:'pstC',shadowOutputId:'shadowC',summary:'PRIVATE_OTHER_ENCOUNTER'}]}});
  assert.ok(html.includes('Selected patient context'));assert.ok(!html.includes('PRIVATE_OTHER_PATIENT'));assert.ok(!html.includes('PRIVATE_OTHER_ENCOUNTER'));
  assert.ok(html.includes('PST exact output'));assert.ok(html.includes('Shadow exact output'));assert.ok(html.includes('Add comparison option'));
  assert.ok(html.includes('Manually entered / unverified'));assert.ok(!html.includes('Option A'));
  const workspace=seedWorkspace(),patient=workspace.patients.find(row=>row.id===patientA.id);
  const run={...buildEngineOutput(patient,workspace),id:'ui-current-run',date:baseContext.now,actor:baseContext.actor};
  const reviewed=seedComplete();reviewed.drafts[0].sourceSnapshot={...scope,inputVersion:'input-v1',capturedAt:baseContext.now,facts:{Goal:'Earlier goal'}};
  const connected=render({patientId:patientA.id,patients:[patientA,patientB],state:reviewed,busy:false,onAction:async()=>true,onRunComparison:async()=>true,clinicalContext:{actor:baseContext.actor,currentInputVersion:'input-v1',currentEngineRevision:run.revision,savedRuns:[run,{...run,id:'foreign-run',patientId:patientB.id,summary:'PRIVATE_FOREIGN_RUN'}],sourceSnapshot:{...scope,encounterId:'current-record',inputVersion:'input-v1',capturedAt:baseContext.now,facts:{Goal:'New walking goal'}}}});
  assert.ok(connected.includes('Run and save comparison'));assert.ok(connected.includes('Use this saved comparison and both outputs'));
  assert.ok(connected.includes('Save progress for later'));assert.ok(connected.includes('Changed since the saved review'));
  assert.ok(connected.includes('Earlier goal'));assert.ok(connected.includes('New walking goal'));assert.ok(!connected.includes('PRIVATE_FOREIGN_RUN'));
  assert.ok(connected.includes('historical instructions'));

});

test('reusable API scenarios cover each decisions journey against trusted source versions',async()=>{
  const {runScenarios}=await import('./fixtures/decisions-scenarios.mjs');
  let current=initialState();const covered=new Map();
  const contextFor=command=>({...baseContext,inputVersions:[{patientId:patientA.id,encounterId:command.encounterId,inputVersion:'fixture-source-version'}]});
  await runScenarios({patientId:patientA.id,now:baseContext.now,inputVersion:()=> 'fixture-source-version',state:()=>current,apply:async command=>{current=apply(current,command,contextFor(command));return current;},expectRejected:async command=>{const before=structuredClone(current);assert.throws(()=>apply(current,command,contextFor(command)));assert.deepEqual(current,before);},record:(journey,status)=>covered.set(journey,status)});
  assert.deepEqual([...covered.keys()].sort(),['J05','J06','J07','J18','J20']);
  assert.ok([...covered.values()].every(status=>status==='passed'));
});


test('atomic saved-engine capture preserves actual rankings and preference effects without partial writes',()=>{
  const workspace=seedWorkspace(),patient=workspace.patients.find(row=>row.id===patientA.id);
  patient.pain=[8,7];patient.function=[3,4];patient.sleep=[4,4];patient.dates=['2026-09-10','2026-09-17'];
  const run=(id,preferences)=>({...buildEngineOutput(patient,workspace,preferences),id,date:baseContext.now,actor:baseContext.actor});
  const first=run('run-relief',{relief:100,alertness:0,routine:0}),second=run('run-routine',{relief:0,alertness:0,routine:100});
  assert.notDeepEqual(first.pstOrder,second.pstOrder);
  const context={...baseContext,engineRuns:[first,second],currentEngineRevision:engineRecordRevision(patient,workspace)};
  const capture=(runId,c=0,o=0)=>({type:'decisions.engine.capture',requestId:request(),...scope,inputVersion:'input-v1',runId,expectedComparisonVersion:c,expectedOutputsVersion:o});
  let state=apply(initialState(),capture(first.id),context),prior=structuredClone(state.comparisonSnapshots[0]);
  assert.deepEqual(state.comparisonSnapshots[0].sourceRunSnapshot,first);
  assert.deepEqual(state.comparisonSnapshots[0].preferenceWeights,first.preferences);
  assert.deepEqual(state.comparisonSnapshots[0].options.map(row=>row.id),first.pstOrder);
  assert.match(state.engineComparisons[0].pst.summary,new RegExp(String(first.candidates.find(row=>row.id===first.pstOrder[0]).pstScore)));
  assert.equal(state.engineComparisons[0].suitability,'unsupported');
  assert.deepEqual(state.engineComparisons[0].modelVersions,[]);
  const unchanged=structuredClone(state);
  assert.throws(()=>apply(state,capture(second.id,1,99),context),/another session/);
  assert.deepEqual(state,unchanged,'neither half changes when the second lock fails');
  state=apply(state,capture(second.id,1,1),context);
  assert.deepEqual(state.comparisonSnapshots[1],prior);
  assert.deepEqual(state.engineComparisons[0].sourceRunSnapshot.preferences,second.preferences);
  assert.throws(()=>apply(state,capture(first.id,2,2),{...context,currentEngineRevision:'new-source'}),/stale/);
  assert.throws(()=>apply(state,capture('foreign',2,2),{...context,engineRuns:[{...first,id:'foreign',patientId:patientB.id}]}),/belong to this patient/);
});

test('observed provenance and owned follow-up retain source detail and reject altered authorized sources',()=>{
  const point={entryId:'pain-zero',recordId:'observation-1',recordVersion:2,metric:'pain',status:'zero',value:0,source:'Patient report',collectedAt:'2026-09-17T12:00:00Z',receivedAt:'2026-09-17T12:10:00Z',confirmedAt:'2026-09-17T12:15:00Z',confirmedBy:'Original confirmer',correctedFromEntryId:'pain-prior'};
  const monitoring={id:'monitor-1',title:'Review walking goal',owner:'Care coordinator',dueAt:'2026-09-24T12:00:00Z'};
  const context={...baseContext,observationSources:[point]};
  const state=apply(initialState(),review({sourceObservations:[point],monitoring,events:[{id:'plan-event',kind:'plan',at:'2026-09-16',title:'Care plan recorded',source:'plan-42'}]}),context);
  assert.deepEqual(state.observedReviews[0].sourceObservations,[point]);assert.deepEqual(state.observedReviews[0].monitoring,monitoring);
  assert.throws(()=>apply(initialState(),review({sourceObservations:[{...point,source:'Invented external device'}]}),context),/provenance/);
  assert.throws(()=>apply(initialState(),review({sourceObservations:[{...point,status:'declined'}]}),context),/status and value/);
  const clarificationWork=[{id:'clarify-1',title:'Confirm comparator details',owner:'Clinical reviewer',dueAt:'2026-09-24T12:00:00Z'}];
  assert.deepEqual(apply(state,output({clarificationWork})).engineComparisons[0].clarificationWork,clarificationWork);
  assert.throws(()=>apply(state,output({clarificationWork:[{...clarificationWork[0],title:'Unrelated request'}]})),/recorded clarification/);
});

test('server working copies survive reload, preserve pending identity, and reject author or version conflicts',()=>{
  const pending=review(),command={type:'decisions.working.save',requestId:request(),...scope,id:'working-one',expectedVersion:0,inputVersion:'old-source',form:{draftSummary:'Partial text',pain:'/',weights:{relief:40,alertness:40,routine:20}},pendingAction:JSON.stringify(pending)};
  let state=apply(initialState(),command);
  state=validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(state.workingCopies[0].form.draftSummary,'Partial text');assert.equal(JSON.parse(state.workingCopies[0].pendingAction).requestId,pending.requestId);
  assert.equal(state.drafts.length,0);assert.equal(state.signedSnapshots.length,0);
  assert.deepEqual(apply(state,command),state,'exact retry does not add a working copy');
  assert.throws(()=>apply(state,{...command,requestId:request()}),/another session/);
  assert.throws(()=>apply(state,{...command,requestId:request(),expectedVersion:1},{...baseContext,actor:'Different reviewer'}),/author/);
  assert.throws(()=>apply(state,{...command,requestId:request(),expectedVersion:1,pendingAction:JSON.stringify({...pending,patientId:patientB.id})}),/patient encounter/);
  assert.throws(()=>apply(state,{...command,requestId:request(),expectedVersion:1,form:{options:{unsafe:'not an array'}}}),/working-copy field/);
  state=apply(state,{...command,requestId:request(),expectedVersion:1,form:{draftSummary:'Reviewed second draft'}});
  assert.equal(state.workingCopies[0].version,2);assert.equal(state.workingCopies[0].form.draftSummary,'Reviewed second draft');
});

test('clinical diffs and frozen care packages preserve historical facts and restrict audience reports',()=>{
  const source={...scope,inputVersion:'input-v1',capturedAt:baseContext.now,facts:{Goal:'Walk twenty minutes',Allergies:'Not recorded'}};
  const carePackage={patientId:patientA.id,planId:'plan-42',patientName:patientA.name,instructions:'Keep the agreed activity log.',owner:'Care coordinator',followUp:{date:'2026-09-24',time:'10:00',timezone:'UTC'},notes:[{id:'private-note',at:baseContext.now,actor:baseContext.actor,text:'PRIVATE INTERNAL NOTE'}],tasks:[{id:'task-1',title:'Review activity log',owner:'Care coordinator',dueAt:'2026-09-24T10:00:00Z',done:false,history:[]}]};
  const context={...baseContext,sourceSnapshot:source,carePlanPackages:[carePackage]};
  let state=seedComplete();
  state=apply(state,save(state,{draftId:state.drafts[0].id,expectedVersion:state.drafts[0].version}),context);
  state=apply(state,sign(state),context);const snapshot=structuredClone(state.signedSnapshots[0]);
  carePackage.instructions='Changed current instructions';source.facts.Goal='New priority';
  assert.equal(snapshot.carePackage.instructions,'Keep the agreed activity log.');assert.equal(snapshot.sourceSnapshot.facts.Goal,'Walk twenty minutes');
  assert.deepEqual(diffDecisionSources(snapshot.sourceSnapshot,source),[{field:'Goal',before:'Walk twenty minutes',after:'New priority'}]);
  const command={type:'decisions.export.capture',requestId:request(),...scope,signedSnapshotId:snapshot.id,format:'json',audience:'proxy'};
  assert.throws(()=>apply(state,command,context),/sharing authorization/);
  const authorized={...context,exportScope:{audience:'proxy',recipient:'Approved support person',accessScope:['historical-patient-instructions'],grantId:'grant-1'}};
  const exported=apply(state,command,authorized).exports[0],payload=JSON.parse(exported.content);
  assert.equal(payload.plan.instructions,'Keep the agreed activity log.');assert.equal(payload.historicalVersion,snapshot.version);
  assert.ok(!exported.content.includes('PRIVATE INTERNAL NOTE'));assert.ok(!exported.content.includes('Synthetic Shadow'));assert.ok(!exported.content.includes('Allergies'));
  assert.equal(exported.recipient,'Approved support person');assert.equal(exported.grantId,'grant-1');
  const savedExport=apply(state,command,authorized);
  assert.throws(()=>apply(savedExport,command,context),/sharing authorization/,'revoked authorization is checked before idempotent replay');
  assert.deepEqual(savedExport.signedSnapshots[0],snapshot);
});

test('a changed patient goal and preference vector invalidate reviewed work and preserve the earlier signed choice',()=>{
  let state=seedComplete();state=apply(state,sign(state));const historical=structuredClone(state.signedSnapshots[0]);
  state=apply(state,save(state,{summary:'A new discussion before the patient changes priorities.'}));
  const oldDraft=structuredClone(state.drafts[0]);
  state=apply(state,review({expectedVersion:1,goal:'Remain alert during the workday.'}));
  const preferenceWeights={relief:10,function:35,sleep:5,safety:50};
  state=apply(state,comparison({expectedVersion:1,preferenceSummary:'Patient now prioritizes alertness and safety at work.',preferenceWeights}));
  assert.throws(()=>apply(state,sign(state)),/changed after review/);
  state=apply(state,save(state,{draftId:oldDraft.id,expectedVersion:oldDraft.version,summary:'Reviewed the changed goal and preference priorities.'}));
  state=apply(state,sign(state));
  assert.equal(state.signedSnapshots[0].reviewedInput.observedReview.goal,'Remain alert during the workday.');
  assert.deepEqual(state.signedSnapshots[0].reviewedInput.comparisonSnapshot.preferenceWeights,preferenceWeights);
  assert.deepEqual(state.signedSnapshots.find(row=>row.id===historical.id),historical);
  assert.notDeepEqual(historical.reviewedInput.comparisonSnapshot.preferenceWeights,preferenceWeights);
});
