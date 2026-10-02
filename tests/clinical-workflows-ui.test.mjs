import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// An in-memory bundle keeps SSR tests independent of Vite's server/port lifecycle.
const bundle=await build({
  stdin:{contents:"export {WorkflowWorkbench} from './components/theranetrix/workflow-workbench'; export {JourneyGuide,journeyWorkflowHref} from './components/theranetrix/journey-guide'; export {seedWorkspace} from './lib/theranetrix'; export {clinicalWorkflowDomains,clinicalWorkflowWorkerProvenance} from './lib/clinical-flows'; export {journeys} from './lib/journey-navigation';",resolveDir:process.cwd()},
  bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',
  loader:{'.css':'empty','.module.css':'empty'},write:false,
});
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {WorkflowWorkbench,JourneyGuide,journeyWorkflowHref,seedWorkspace,clinicalWorkflowDomains,clinicalWorkflowWorkerProvenance,journeys}=mod.exports;
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const setup=()=>{const workspace=seedWorkspace();return {workspace,patient:workspace.patients[0],busy:false,onAction:async()=>true};};
const optionValues=(html)=>[...html.matchAll(/<option value="([^"]+)"/g)].map(match=>match[1]);

function assertClosedShell(html){
  assert.match(html,/aria-expanded="false"/);
  assert.match(html,/>Open workflows</);
  assert.match(html,/hidden=""/);
  assert.doesNotMatch(html,/data-workflow-domain=/,'Domain forms mount when opened, keeping hidden drafts out of the initial shell.');
  assert.doesNotMatch(html,/PR #|pull request|headSha|EncountersPanel|ProgramGovernancePanel|worker provenance|domains ready|Shared-owner evaluation|still targeting|workflow extension needed/i);
}

test('patient workbench renders a closed shell with patient workflow options and integration access',()=>{
  const props=setup();const html=render(WorkflowWorkbench,props);
  assertClosedShell(html);
  assert.match(html,/Clinical workflows/);
  assert.match(html,/Workflow area/);
  assert.match(html,new RegExp(props.patient.id));
  assert.match(html,/External delivery requires a configured service/);
  assert.deepEqual(optionValues(html),clinicalWorkflowDomains.filter(domain=>domain!=='program-governance'));
  assert.ok(optionValues(html).includes('integration-access'),'J12 and J19 remain available within the selected patient context.');
});

test('settings workbench exposes only program workflows and has no patient placeholder',()=>{
  const {workspace,busy,onAction}=setup();const html=render(WorkflowWorkbench,{workspace,mode:'settings',busy,onAction});
  assertClosedShell(html);
  assert.match(html,/Program workflows/);
  assert.match(html,/Program records/);
  assert.deepEqual(optionValues(html),clinicalWorkflowDomains.filter(domain=>clinicalWorkflowWorkerProvenance[domain].scope==='program'));
  assert.doesNotMatch(html,/Select a patient to open clinical workflows/);
});

test('a missing patient stays unselected and busy workbenches disable the area picker',()=>{
  const {workspace,onAction}=setup();const html=render(WorkflowWorkbench,{workspace,busy:true,onAction});
  assertClosedShell(html);
  assert.match(html,/Select a patient to open clinical workflows/);
  assert.match(html,/<select[^>]*disabled=""/);
  assert.doesNotMatch(html,new RegExp(workspace.patients[0].name),'The workbench must never substitute the first patient.');
});

test('every journey maps to its imported workflow domain while preserving patient/program scope',()=>{
  const patients=[{id:'TN-QA-1',name:'Explicit patient'},{id:'special +?/#%',name:'Encoded patient'}];
  for(const journey of journeys){
    const owners=clinicalWorkflowDomains.filter(domain=>clinicalWorkflowWorkerProvenance[domain].journeys.includes(journey.id));
    assert.equal(owners.length,1,`${journey.id} has one workflow owner`);
    const patientId=journey.requiresPatient?patients[0].id:'';
    const href=journeyWorkflowHref(journey.id,patientId,patients);
    assert.equal(new URL(href,'https://example.invalid').searchParams.get('workflowJourney'),journey.id);
    assert.ok(href,journey.id);
    const url=new URL(href,'https://example.invalid');
    assert.equal(url.origin,'https://example.invalid');
    assert.equal(url.searchParams.get('workflow'),owners[0]);
    assert.deepEqual([...url.searchParams.keys()],['workflow','workflowJourney']);
    assert.equal(url.pathname,journey.requiresPatient?'/patients/'+patientId:'/settings');
  }
  for(const journeyId of ['J12','J19'])assert.equal(journeyWorkflowHref(journeyId,patients[0].id,patients),'/patients/TN-QA-1?workflow=integration-access&workflowJourney='+journeyId);
  assert.equal(journeyWorkflowHref('J21','',patients),'/settings?workflow=integration-access&workflowJourney=J21');
  const encoded=new URL(journeyWorkflowHref('J04',patients[1].id,patients),'https://example.invalid');
  assert.equal(decodeURIComponent(encoded.pathname.slice('/patients/'.length)),patients[1].id);
});

test('direct workflow navigation rejects missing, unknown, and injected patient context',()=>{
  const patients=[{id:'TN-QA-1',name:'Available patient'}];
  for(const journey of journeys){
    if(journey.requiresPatient){
      for(const patientId of ['','unknown'])assert.equal(journeyWorkflowHref(journey.id,patientId,patients),null);
      assert.equal(journeyWorkflowHref(journey.id,patients[0].id,[]),null);
    }else assert.equal(journeyWorkflowHref(journey.id,patients[0].id,patients),null);
  }
  for(const id of ['J00','J35','','__proto__','https://example.invalid'])assert.equal(journeyWorkflowHref(id,patients[0].id,patients),null);
});

test('home journey launcher reports available workflows without selecting a patient or claiming completion',()=>{
  const {workspace}=setup();const html=render(JourneyGuide,{path:'/',patients:workspace.patients,busy:false});
  assert.match(html,/Explore patient journeys/);
  assert.match(html,/34 journeys/);
  assert.match(html,/Workflow available/);
  assert.match(html,/Select a patient explicitly/);
  assert.match(html,/Choose an available patient to continue/);
  assert.doesNotMatch(html,/href="\/patients\//,'Initial launch must wait for explicit patient selection.');
  assert.doesNotMatch(html,/Workflow extension needed|Unbuilt services|not an end-to-end implementation|PR #/);
  assert.match(html,/External services and approvals require their own setup and evidence/);
});
