import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({stdin:{contents:"export * from './components/theranetrix/clinical-flows/decision-encounter-selection';export * from './components/theranetrix/decision-trace';export {DecisionsPanel} from './components/theranetrix/clinical-flows/decisions';export {EngineBoard} from './components/theranetrix/engine-workspace';export {OutputTraceView} from './components/theranetrix/review-workspace';export {seedWorkspace} from './lib/theranetrix';export {buildEngineOutput} from './lib/engine-demo';export {initialState,reduce} from './lib/clinical-flows/decisions';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty','.module.css':'empty'},write:false});
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {initialDecisionEncounterSelection,decisionEncounterSelection,signedDecisionsForTrace,DecisionsPanel,EngineBoard,OutputTraceView,seedWorkspace,buildEngineOutput,initialState,reduce}=mod.exports;
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));

test('editing an encounter choice never switches scope; dirty work requires a separate discard decision',()=>{
  let selection=initialDecisionEncounterSelection('visit-one');
  selection=decisionEncounterSelection(selection,{type:'editor',status:{dirty:true,pending:false,busy:false}});
  for(const value of ['v','visit-two','']){
    selection=decisionEncounterSelection(selection,{type:'stage',value});
    assert.equal(selection.encounterId,'visit-one');assert.equal(selection.editor.dirty,true);
  }
  assert.deepEqual(decisionEncounterSelection(selection,{type:'request'}),selection,'blank choices cannot dispose the editor');
  selection=decisionEncounterSelection(selection,{type:'stage',value:'visit-two'});
  selection=decisionEncounterSelection(selection,{type:'request'});
  assert.equal(selection.encounterId,'visit-one');assert.equal(selection.requestedId,'visit-two');
  selection=decisionEncounterSelection(selection,{type:'cancel'});
  assert.equal(selection.encounterId,'visit-one');assert.equal(selection.editor.dirty,true);assert.equal(selection.requestedId,null);
  assert.deepEqual(decisionEncounterSelection(selection,{type:'discard'}),selection,'discard requires an outstanding destination');
  selection=decisionEncounterSelection(selection,{type:'request'});
  selection=decisionEncounterSelection(selection,{type:'discard'});
  assert.equal(selection.encounterId,'visit-two');assert.equal(selection.requestedId,null);assert.equal(selection.editor.dirty,false);
});

test('clean editors switch explicitly, while pending or in-flight saves protect their original encounter',()=>{
  let selection=decisionEncounterSelection(initialDecisionEncounterSelection('first'),{type:'stage',value:'  second  '});
  assert.equal(selection.encounterId,'first');
  selection=decisionEncounterSelection(selection,{type:'request'});
  assert.equal(selection.encounterId,'second');assert.equal(selection.proposedId,'second');
  selection=decisionEncounterSelection(selection,{type:'stage',value:'third'});
  selection=decisionEncounterSelection(selection,{type:'editor',status:{dirty:false,pending:true,busy:true}});
  assert.deepEqual(decisionEncounterSelection(selection,{type:'request'}),selection);
  selection=decisionEncounterSelection(selection,{type:'editor',status:{dirty:false,pending:true,busy:false}});
  selection=decisionEncounterSelection(selection,{type:'request'});
  assert.equal(selection.encounterId,'second');assert.equal(selection.requestedId,'third');
  selection=decisionEncounterSelection(selection,{type:'editor',status:{dirty:false,pending:true,busy:true}});
  assert.deepEqual(decisionEncounterSelection(selection,{type:'discard'}),selection);
  selection=decisionEncounterSelection(selection,{type:'stage',value:'fourth'});
  assert.equal(selection.requestedId,null,'typing a different destination cannot reuse an earlier discard choice');
});

test('Decisions exposes an explicit encounter switch and the currently active editing scope',()=>{
  let saves=0;
  const html=render(DecisionsPanel,{patientId:'p-one',patients:[{id:'p-one',name:'Selected patient'},{id:'p-two',name:'Other patient'}],state:initialState(),busy:false,onAction:async()=>{saves++;return true;},clinicalContext:{inputVersions:[{patientId:'p-one',encounterId:'visit-one',inputVersion:'v1'},{patientId:'p-two',encounterId:'PRIVATE_OTHER_VISIT',inputVersion:'v1'}]}});
  assert.match(html,/Encounter to open/);assert.match(html,/Change encounter/);assert.match(html,/Editing encounter: <strong>visit-one<\/strong>/);
  assert.doesNotMatch(html,/PRIVATE_OTHER_VISIT/);assert.equal(saves,0);
});

const now='2026-09-17T14:00:00.000Z',actor='Signing reviewer';
function signedState(workspace,patient,run,encounterId,summary){
  let state=initialState();
  const scope={patientId:patient.id,encounterId},inputVersion='reviewed-source-v1',planId=`plan-${encounterId}`;
  const context={actor,now,patients:workspace.patients.map(({id,name})=>({id,name})),features:{digitalTwin:true,pst:true,shadow:true},engineRuns:[run],currentEngineRevision:run.revision,carePlans:[{id:planId,patientId:patient.id,version:1,summary:'Original historical instructions.'}],carePlanPackages:[{patientId:patient.id,planId,patientName:patient.name,instructions:'Original historical instructions.'}]};
  const apply=action=>{state=reduce(state,{...scope,requestId:crypto.randomUUID(),...action},context);};
  apply({type:'decisions.review.capture',expectedVersion:0,inputVersion,collectedAt:now,receivedAt:now,provenance:'observed',metrics:{pain:{prior:6,current:5},function:{prior:4,current:5},sleep:{prior:5,current:6}},contradictoryMetrics:[],clinicalInterpretation:'Reviewed the patient report.',goal:'Improve walking tolerance.',nextMonitoringQuestion:'How was the next walking period?'});
  apply({type:'decisions.engine.capture',inputVersion,runId:run.id,expectedComparisonVersion:0,expectedOutputsVersion:0});
  apply({type:'decisions.draft.save',expectedInputVersion:inputVersion,summary,payload:{observedReviewId:state.observedReviews[0].id,comparisonSnapshotId:state.comparisonSnapshots[0].id,engineComparisonId:state.engineComparisons[0].id,pendingDisposition:'defer',note:'Await patient discussion.'}});
  apply({type:'decisions.sign.capture',draftId:state.drafts[0].id,expectedDraftVersion:state.drafts[0].version,expectedInputVersion:inputVersion,disposition:'defer',rationale:'Historical rationale retained exactly.',patientPlanRef:planId,evidenceVersions:[],modelVersions:[],configurationVersions:[run.version],displayedSummary:summary});
  return state;
}
function traceFixture(){
  const workspace=seedWorkspace(),patient=workspace.patients[0],other=workspace.patients[1];
  const run={...buildEngineOutput(patient,workspace),id:'run-selected',date:now,actor};
  const second={...run,id:'run-second'};
  const foreign={...buildEngineOutput(other,workspace),id:'run-foreign',date:now,actor};
  workspace.engineRuns=[run,second,foreign];
  const first=signedState(workspace,patient,run,'visit-one','SIGNED_SELECTED_RUN');
  const another=signedState(workspace,patient,second,'visit-two','SIGNED_SECOND_RUN');
  const foreignState=signedState(workspace,other,foreign,'foreign-visit','PRIVATE_FOREIGN_SIGNATURE');
  workspace.clinicalWorkflows.slices.decisions.state={...first,signedSnapshots:[...first.signedSnapshots,...another.signedSnapshots,...foreignState.signedSnapshots]};
  patient.carePlans=[{id:'current-unrelated-plan',text:'CURRENT_PLAN_MUST_NOT_REPLACE_HISTORY',owner:actor,followup:'2026-09-24',time:'10:00',date:now,author:actor}];
  return {workspace,patient,run};
}

test('signed trace links only the selected patient and exact saved run and retains historical content',()=>{
  const {workspace,patient,run}=traceFixture(),before=structuredClone(workspace);
  assert.deepEqual(signedDecisionsForTrace(workspace,patient.id,run.id).map(row=>row.displayedOutputs.summary),['SIGNED_SELECTED_RUN']);
  assert.deepEqual(signedDecisionsForTrace(workspace,patient.id,'run-second').map(row=>row.displayedOutputs.summary),['SIGNED_SECOND_RUN']);
  assert.deepEqual(signedDecisionsForTrace(workspace,patient.id,'run-foreign'),[]);
  assert.deepEqual(signedDecisionsForTrace(workspace,patient.id,undefined,true),[]);
  workspace.engineRuns=workspace.engineRuns.filter(row=>row.id!==run.id);
  assert.deepEqual(signedDecisionsForTrace(workspace,patient.id,undefined,true).map(row=>row.displayedOutputs.summary),['SIGNED_SELECTED_RUN'],'signatures remain available if their run is no longer listed');
  workspace.engineRuns=before.engineRuns;assert.deepEqual(workspace,before);
});

test('both trace entrypoints show immutable signatures and keep current-plan and other-patient text out',()=>{
  const {workspace,patient}=traceFixture(),before=structuredClone(workspace);
  const props={p:patient,ctx:{data:workspace,user:actor,busy:false,save:async()=>false,open:()=>{}},initialTab:'history'};
  for(const Component of [OutputTraceView,EngineBoard]){
    const html=render(Component,props);
    assert.match(html,/SIGNED_SELECTED_RUN/);assert.match(html,/SIGNED_SECOND_RUN/);assert.match(html,/Original historical instructions/);assert.match(html,/Historical rationale retained exactly/);assert.match(html,/Immutable signed decisions/);
    assert.doesNotMatch(html,/PRIVATE_FOREIGN_SIGNATURE/);assert.doesNotMatch(html,/CURRENT_PLAN_MUST_NOT_REPLACE_HISTORY/);
    assert.equal(html.match(/SIGNED_SELECTED_RUN/g)?.length,1);assert.equal(html.match(/SIGNED_SECOND_RUN/g)?.length,1);
  }
  assert.deepEqual(workspace,before);
});

test('trace remains usable without listed runs and Twin labels the calculated comparison accurately',()=>{
  const {workspace,patient}=traceFixture();workspace.engineRuns=[];
  const ctx={data:workspace,user:actor,busy:false,save:async()=>false,open:()=>{}};
  const trace=render(OutputTraceView,{p:patient,ctx});
  assert.match(trace,/Other signed decision records/);assert.match(trace,/SIGNED_SELECTED_RUN/);assert.doesNotMatch(trace,/PRIVATE_FOREIGN_SIGNATURE/);
  const twin=render(EngineBoard,{p:patient,ctx,initialTab:'twin'});
  assert.match(twin,/Treatment target/);assert.match(twin,/Program assumption: a three-point reduction over the observed period/);
  assert.match(twin,/Observed pain minus assumed target/);
  assert.ok(twin.indexOf('Observed trajectory')<twin.indexOf('Prototype scenario'),'observations precede the separate scenario');
  assert.match(twin,/<details class="feedback-twin-detail feedback-prototype-scenario">/,'the prototype scenario is collapsed initially');
  assert.doesNotMatch(twin,/against the agreed target/);
});
