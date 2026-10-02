import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({
  stdin:{contents:`
    export {featureAvailability} from './lib/feature-availability';
    export {createdGovernanceRecordId} from './lib/clinical-flows/governance-ui';
    export {initialState,reduce} from './lib/clinical-flows/program-governance';
    export {ensureGovernanceShowcase} from './lib/clinical-flows/governance-showcase';
    export {seedWorkspace,featureDefinitions} from './lib/theranetrix';
    export {ConfigurationSettings} from './components/theranetrix/configuration-settings';
    export {ConnectionReportReview,DemoConnectionPanel} from './components/theranetrix/demo-connection';
    export {ProgramGovernancePanel} from './components/theranetrix/clinical-flows/program-governance';
  `,resolveDir:process.cwd()},
  bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty','.module.css':'empty'},write:false,
});
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {featureAvailability,createdGovernanceRecordId,initialState,reduce,ensureGovernanceShowcase,seedWorkspace,featureDefinitions,ConfigurationSettings,ConnectionReportReview,DemoConnectionPanel,ProgramGovernancePanel}=mod.exports;
const now='2026-09-17T14:45:00.000Z',actor='Program reviewer';
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const setup=()=>{
  const source=seedWorkspace();
  source.features=Object.fromEntries(featureDefinitions.map(feature=>[feature.id,true]));
  return ensureGovernanceShowcase(source,actor,now);
};
const context=workspace=>({actor,now,patients:workspace.patients.map(({id,name})=>({id,name})),features:workspace.features,governedUsages:[],usageCoverage:'complete'});
function recall(workspace){
  const next=structuredClone(workspace),slice=next.clinicalWorkflows.slices['program-governance'],release=slice.state.releases.find(record=>record.decision==='approved');
  slice.state=reduce(slice.state,{type:'program-governance.recall-open',requestId:crypto.randomUUID(),subject:{kind:'release',id:release.id,artifactVersion:release.artifactVersion},expectedSubjectVersion:release.version,owner:actor,reason:'Local review of the displayed artifact',evidenceRef:'review://local-recall'},context(next));
  return next;
}

test('saved feature availability distinguishes flags, dependencies, and current recall restrictions',()=>{
  const workspace=setup(),before=JSON.stringify(workspace);
  for(const feature of ['digitalTwin','pst','shadow'])assert.equal(featureAvailability(workspace,feature,now).usable,true);
  assert.equal(JSON.stringify(workspace),before,'Availability inspection never changes the workspace.');
  const suspended=recall(workspace);
  for(const feature of ['digitalTwin','pst','shadow']){
    const availability=featureAvailability(suspended,feature,now);
    assert.equal(availability.enabled,true);
    assert.equal(availability.usable,false);
    assert.equal(availability.status,'governance-blocked');
    assert.ok(availability.reason.length>10);
    assert.equal(availability.reviewHref,'/settings?workflow=program-governance');
  }
  for(const feature of ['assessments','messages','pathways','reviewPrompts','advisor'])assert.equal(featureAvailability(suspended,feature,now).usable,true,'Unrelated record workflows retain their actual feature policy.');
  suspended.features.assessments=false;
  assert.equal(featureAvailability(suspended,'assessments',now).status,'disabled');
  assert.equal(featureAvailability(suspended,'digitalTwin',now).status,'dependency-blocked');
});

test('settings show enabled-but-blocked engine status and a named governance link',()=>{
  const workspace=recall(setup());
  const html=render(ConfigurationSettings,{ctx:{data:workspace,busy:false,save:async()=>true}});
  assert.match(html,/>Enabled</);
  assert.match(html,/>Blocked by governance</);
  assert.match(html,/Current availability:/);
  assert.match(html,/href="\/settings\?workflow=program-governance"[^>]*>Review governance requirements for Digital Twin/);
  assert.match(html,/aria-describedby="feature-availability-digitalTwin"/);
  assert.doesNotMatch(html,/>On<|features on</);
});

test('creation selection follows the exact request receipt across same-title concurrent records and retries',()=>{
  const workspace=seedWorkspace(),ctx=context(workspace);
  const command={type:'program-governance.configuration-save-draft',requestId:'my-create',record:{title:'Shared title',capabilityChoices:['assessments'],allowedCadence:['weekly'],languages:['English'],communicationSettings:['in-app'],displayReferences:[],safetyEssentials:['Named reviewer'],nonHideableSafetyEssentials:['Named reviewer']}};
  let state=reduce(initialState(),command,ctx);
  const createdId=state.configurations[0].id;
  state=reduce(state,{...command,requestId:'another-session-create'},ctx);
  assert.notEqual(state.configurations[0].id,createdId);
  assert.equal(createdGovernanceRecordId(state,'configuration','my-create'),createdId);
  assert.equal(createdGovernanceRecordId(reduce(state,command,ctx),'configuration','my-create'),createdId);
  assert.equal(createdGovernanceRecordId(state,'evidence','my-create'),undefined);
  assert.equal(createdGovernanceRecordId(state,'configuration','missing'),undefined);
  state=reduce(state,{...command,id:createdId,expectedVersion:1,requestId:'revise-existing',record:{...command.record,title:'Revised title'}},ctx);
  assert.equal(createdGovernanceRecordId(state,'configuration','revise-existing'),undefined,'An edit receipt must not be treated as a new creation.');
  const html=render(ProgramGovernancePanel,{state,patients:ctx.patients,busy:false,onAction:async()=>true});
  assert.match(html,/Select configuration record/);
  assert.match(html,/<h3 tabindex="-1">Shared title/,'Selected record has a programmatic focus target.');
});

const quarantined={id:'held-report',status:'quarantined',sourcePatientId:'unmatched-chart',reason:'The source patient does not match the chart.',receivedAt:now,event:{sourceId:'patient-reports',eventId:'source-event-42',sourcePatientId:'unmatched-chart',observedAt:'2026-09-17T14:00:00.000Z',entries:[{metric:'pain',value:4,unit:'score-0-10'},{metric:'function',value:6,unit:'score-0-10'},{metric:'sleep',value:5,unit:'hours'}]}};
const reportProps={record:quarantined,patient:{id:'TN-DEMO-01',name:'Chosen patient'},encounterId:'encounter-42',busy:false,canImport:true,onResolve:async()=>true};

test('quarantine review exposes original values, units, exact times and target before an initially disabled correction',()=>{
  const html=render(ConnectionReportReview,reportProps);
  for(const value of ['unmatched-chart','Chosen patient','TN-DEMO-01','encounter-42','source-event-42','2026-09-17T14:00:00.000Z',now,'score-0-10','hours'])assert.ok(html.includes(value),value);
  assert.match(html,/<details open=""/);
  assert.match(html,/<strong>Pain<\/strong>: 4/);
  assert.match(html,/<input[^>]*type="checkbox"[^>]*required=""/);
  assert.doesNotMatch(html,/<input[^>]*checked=""/);
  assert.match(html,/<button[^>]*type="submit"[^>]*disabled=""[^>]*>Import matched replacement/);
  assert.match(html,/quarantined source report stays in history/);
  const other=render(ConnectionReportReview,{...reportProps,patient:{id:'TN-DEMO-02',name:'Other chosen patient'}});
  assert.match(other,/Other chosen patient.*TN-DEMO-02/);
  assert.doesNotMatch(other,/TN-DEMO-01/);
});

test('missing report contents cannot be confirmed, and resolved records expose no correction action',()=>{
  const {event,...legacy}=quarantined;
  assert.ok(event);
  const html=render(ConnectionReportReview,{...reportProps,record:legacy});
  assert.match(html,/payload is unavailable/);
  assert.match(html,/<fieldset disabled=""/);
  assert.match(html,/<button[^>]*type="submit"[^>]*disabled=""/);
  const resolved=render(ConnectionReportReview,{...reportProps,record:{...quarantined,status:'corrected'}});
  assert.doesNotMatch(resolved,/Import matched replacement|Reject report|type="checkbox"/);
});

test('connection mode is explicitly workspace-wide while consent names the selected patient',()=>{
  const workspace=seedWorkspace(),patient={...workspace.patients[0],id:'TN-DEMO-01',name:'Chosen patient'};
  workspace.patients=[patient];workspace.workflowShowcase={patientIds:[patient.id]};
  workspace.demoConnection={version:1,connected:true,patients:{},history:[],receipts:[]};
  const html=render(DemoConnectionPanel,{workspace,patientId:patient.id,busy:false,onAction:async()=>true});
  assert.match(html,/Workspace connection mode/);
  assert.match(html,/Connection mode applies to every patient story in this workspace/);
  assert.match(html,/Consent and sharing choices below apply only to Chosen patient \(TN-DEMO-01\)/);
  assert.match(html,/<select[^>]*aria-describedby=/);
});
