import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({
  stdin:{contents:"export * from './lib/clinical-flows/program-governance';export {ensureGovernanceShowcase} from './lib/clinical-flows/governance-showcase';export {seedWorkspace} from './lib/theranetrix';export {engineVersion} from './lib/engine-demo';export {ProgramGovernancePanel} from './components/theranetrix/clinical-flows/program-governance';",resolveDir:process.cwd()},
  bundle:true,
  platform:'node',
  format:'cjs',
  packages:'external',
  jsx:'automatic',
  write:false,
  outdir:'.test-build',
});
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {initialState,reduce,validateState,actionSchema,getSummary,evaluateRuntimeUse,evaluateProtocolPredicate,monitoringFindings,monitoringIntervalsOverlap,ProgramGovernancePanel,ensureGovernanceShowcase,seedWorkspace,engineVersion}=mod.exports;

const patients=[{id:'TN-1042',name:'Sarah Mitchell'},{id:'TN-1038',name:'James Wilson'}];
const allFeatures={assessments:true,reviewPrompts:true,digitalTwin:true,pst:true,shadow:true,advisor:true,pathways:true,messages:true};
const makeContext=(overrides={})=>({governedUsages:[],usageCoverage:'complete',protocolEpisodes:[],actor:'Governance reviewer',now:'2026-09-17T14:45:00Z',patients,features:allFeatures,...overrides});
const act=(state,action,context=makeContext())=>reduce(state,actionSchema.parse(action),context);
const render=(state,props={})=>renderToStaticMarkup(React.createElement(ProgramGovernancePanel,{patients,state,busy:false,onAction:async()=>true,...props}));

function createConfiguration(state=initialState(),context=makeContext(),record={}) {
  return act(state,{type:'program-governance.configuration-save-draft',requestId:crypto.randomUUID(),record:{
    title:'Program configuration',
    capabilityChoices:['assessments','messages'],
    allowedCadence:['weekly'],
    languages:['English'],
    communicationSettings:['in-app'],
    displayReferences:['Settings card'],
    safetyEssentials:['Named reviewer'],
    nonHideableSafetyEssentials:['Named reviewer'],
    ...record,
  }},context);
}
function reviewConfiguration(state,id,version,context=makeContext()){
  return act(state,{type:'program-governance.configuration-review',requestId:crypto.randomUUID(),id,expectedVersion:version,reviewNote:'Reviewed and ready'},context);
}
function activateConfiguration(state,id,version,context=makeContext()){
  return act(state,{type:'program-governance.configuration-activate',requestId:crypto.randomUUID(),id,expectedVersion:version,reason:'Activate reviewed configuration'},context);
}
function createProtocol(state=initialState(),context=makeContext(),record={}) {
  return act(state,{type:'program-governance.protocol-save-draft',requestId:crypto.randomUUID(),record:{
    title:'Operational sample protocol',
    owner:'Program reviewer',
    evidenceLocator:'ops://protocol-sample-v1',
    publicationChecks:{sourceVersion:'sample-1',rightsEvidence:'synthetic://rights',clinicalReview:'synthetic://clinical-review',implementationReview:'synthetic://implementation-review',fixtureEvidence:'synthetic://fixtures',migrationPolicy:'Explicit owner review',rollbackPlan:'Preserve pinned episodes'},
    unresolvedQuestions:[],
    steps:[
      {id:'intake',title:'Review intake record',owner:'Reviewer',kind:'action',prerequisites:[],nextStepIds:['handoff'],branchStepIds:[],openQuestion:''},
      {id:'handoff',title:'Confirm owner handoff',owner:'Operations lead',kind:'handoff',prerequisites:['intake'],nextStepIds:['publish'],branchStepIds:[],openQuestion:''},
      {id:'publish',title:'Record publication evidence',owner:'Reviewer',kind:'decision',prerequisites:['handoff'],nextStepIds:[],branchStepIds:[],openQuestion:''},
    ],
    ...record,
  }},context);
}
function createEvidence(state=initialState(),context=makeContext(),record={}) {
  return act(state,{type:'program-governance.evidence-save-draft',requestId:crypto.randomUUID(),record:{
    title:'Evidence summary',
    indication:'Synthetic governance review',
    population:'Adults in the evaluation workspace',
    endpoint:'Documented follow-up completion',
    supportingSources:[{title:'Synthetic evidence memo',locator:'evidence://memo-1',kind:'supporting',publicationDate:context.now.slice(0,10),retracted:false}],
    rights:'public-summary',
    rightsExpiry:'2026-09-20',
    ...record,
  }},context);
}
function approveEvidence(state,id,version,context=makeContext()){
  state=act(state,{type:'program-governance.evidence-request-review',requestId:crypto.randomUUID(),id,expectedVersion:version,reason:'Request evidence review'},context);
  return act(state,{type:'program-governance.evidence-record-review',requestId:crypto.randomUUID(),id,expectedVersion:state.evidences[0].version,outcome:'approved',reviewer:'Evidence reviewer',reason:'Approved'},context);
}

test('configuration records bridge existing runtime settings, reject unsafe dependencies, and detect stale activations',()=>{
  const original=initialState();
  const blockedContext=makeContext({features:{...allFeatures,digitalTwin:false,shadow:false}});
  const blocked=createConfiguration(original,blockedContext,{capabilityChoices:['shadow']});
  assert.deepEqual(original,initialState());
  assert.equal(blocked.configurations[0].bridge.hiddenByPolicy.includes('shadow'),true);
  assert.equal(blocked.configurations[0].bridge.invalidDependencies.includes('shadow'),true);
  assert.throws(()=>reviewConfiguration(blocked,blocked.configurations[0].id,blocked.configurations[0].version,blockedContext),/Resolve blocked capability dependencies/);

  let state=createConfiguration(initialState());
  let current=state.configurations[0];
  state=reviewConfiguration(state,current.id,current.version);
  current=state.configurations[0];
  state=activateConfiguration(state,current.id,current.version);
  const activeA=state.configurations.find((record)=>record.status==='active');
  assert.ok(activeA);

  state=createConfiguration(state,makeContext(),{title:'Next configuration'});
  const staleDraft=state.configurations[0];
  state=createConfiguration(state,makeContext(),{title:'Current configuration'});
  let next=state.configurations[0];
  state=reviewConfiguration(state,next.id,next.version);
  next=state.configurations[0];
  state=activateConfiguration(state,next.id,next.version);
  state=reviewConfiguration(state,staleDraft.id,staleDraft.version,makeContext());
  const reviewedStale=state.configurations.find((record)=>record.id===staleDraft.id);
  assert.throws(()=>activateConfiguration(state,reviewedStale.id,reviewedStale.version,makeContext()),/stale because a newer active configuration already exists/);
  assert.equal(state.activeConfigurationId,state.configurations[0].id);
});

test('protocol authoring enforces graph integrity and preserves active episode protocol versions',()=>{
  let state=createProtocol();
  const protocolId=state.protocols[0].id;
  state=act(state,{type:'program-governance.protocol-request-review',requestId:crypto.randomUUID(),id:protocolId,expectedVersion:1,reason:'Ready for review'});
  state=act(state,{type:'program-governance.protocol-record-review',requestId:crypto.randomUUID(),id:protocolId,expectedVersion:2,outcome:'reviewed',reviewer:'Protocol reviewer',evidenceLocator:'ops://protocol-review-1',reason:'Reviewed'});
  state=act(state,{type:'program-governance.protocol-record-publication',requestId:crypto.randomUUID(),id:protocolId,expectedVersion:3,evidenceRef:'ops://publication-note',reason:'Publication recorded'});
  assert.equal(state.protocols[0].status,'publication-recorded');

  state=act(state,{type:'program-governance.protocol-assign-episode',requestId:crypto.randomUUID(),patientId:'TN-1042',protocolId,expectedProtocolVersion:4,reason:'Existing active episode'});
  assert.equal(state.protocolAssignments[0].protocolVersion,4);

  state=act(state,{type:'program-governance.protocol-save-draft',requestId:crypto.randomUUID(),id:protocolId,expectedVersion:4,record:{
    title:'Operational sample protocol v2',
    owner:'Program reviewer',
    evidenceLocator:'ops://protocol-sample-v2',
    unresolvedQuestions:[],
    steps:[
      {id:'intake',title:'Review intake record',owner:'Reviewer',kind:'action',prerequisites:[],nextStepIds:['handoff'],branchStepIds:[],openQuestion:''},
      {id:'handoff',title:'Confirm owner handoff',owner:'Operations lead',kind:'handoff',prerequisites:['intake'],nextStepIds:['education'],branchStepIds:[],openQuestion:''},
      {id:'education',title:'Record sample education note',owner:'Reviewer',kind:'action',prerequisites:['handoff'],nextStepIds:['publish'],branchStepIds:[],openQuestion:''},
      {id:'publish',title:'Record publication evidence',owner:'Reviewer',kind:'decision',prerequisites:['education'],nextStepIds:[],branchStepIds:[],openQuestion:''},
    ],
  }});
  state=act(state,{type:'program-governance.protocol-request-review',requestId:crypto.randomUUID(),id:protocolId,expectedVersion:5,reason:'Ready for review'});
  state=act(state,{type:'program-governance.protocol-record-review',requestId:crypto.randomUUID(),id:protocolId,expectedVersion:6,outcome:'reviewed',reviewer:'Protocol reviewer',evidenceLocator:'ops://protocol-review-2',reason:'Reviewed again'});
  state=act(state,{type:'program-governance.protocol-record-publication',requestId:crypto.randomUUID(),id:protocolId,expectedVersion:7,evidenceRef:'ops://publication-note-2',reason:'Publication recorded'});
  assert.equal(state.protocols[0].version,8);
  assert.equal(state.protocolAssignments[0].protocolVersion,4);

  assert.throws(()=>createProtocol(initialState(),makeContext(),{steps:[{id:'a',title:'A',owner:'Reviewer',kind:'action',prerequisites:[],nextStepIds:['missing'],branchStepIds:[],openQuestion:''}]}),/missing step targets/);
  assert.throws(()=>createProtocol(initialState(),makeContext(),{steps:[
    {id:'a',title:'A',owner:'Reviewer',kind:'action',prerequisites:[],nextStepIds:['b'],branchStepIds:[],openQuestion:''},
    {id:'b',title:'B',owner:'Reviewer',kind:'action',prerequisites:[],nextStepIds:['a'],branchStepIds:[],openQuestion:''},
  ]}),/contains a cycle/);
  const unresolved=createProtocol(initialState(),makeContext(),{unresolvedQuestions:['Need decision table']});
  assert.throws(()=>act(unresolved,{type:'program-governance.protocol-request-review',requestId:crypto.randomUUID(),id:unresolved.protocols[0].id,expectedVersion:1,reason:'Ready for review'}),/Resolve all protocol questions/);
});

test('evidence registry approves dated records, rejects unusable support, and flags dependent releases/readiness on withdrawal or expiry',()=>{
  let state=createEvidence();
  const evidenceId=state.evidences[0].id;
  state=approveEvidence(state,evidenceId,1);
  assert.equal(state.evidences[0].status,'approved');

  state=createConfiguration(state);
  state=reviewConfiguration(state,state.configurations[0].id,state.configurations[0].version);
  state=activateConfiguration(state,state.configurations[0].id,state.configurations[0].version);

  state=act(state,{type:'program-governance.release-save-draft',requestId:crypto.randomUUID(),record:{
    title:'Release candidate',
    modelId:'shadow-v1',
    softwareId:'app-2026.09',
    configurationId:state.activeConfigurationId,
    intendedUse:'Synthetic governance review',
    evidenceRefIds:[evidenceId],
    modelClaims:['Agreement is descriptive only.'],
    evaluation:{agreementSummary:'Agreement recorded.',performanceSummary:'Independent evaluation still required.',limitations:'No deployment.'},
    unresolvedConditions:['External validation required'],
    overrideTrainingPolicy:'Manual review only',
  }});
  state=act(state,{type:'program-governance.readiness-save-draft',requestId:crypto.randomUUID(),record:{
    title:'Readiness review',
    functions:['Configuration records'],
    claims:['Synthetic governance only'],
    partnerAssets:['Synthetic test assets'],
    partnerRights:['Rights review required'],
    partnerResponsibilities:['Partner sign-off'],
    evidenceRefIds:[evidenceId],
    blockingConditions:['Partner review pending'],
    mandatoryGates:[{id:'gate-1',title:'Clinical evidence reviewed',required:true,disposition:'open',evidenceRef:''}],
  }});
  state=act(state,{type:'program-governance.evidence-withdraw',requestId:crypto.randomUUID(),id:evidenceId,expectedVersion:3,reason:'Rights expired or evidence withdrawn'});
  assert.equal(state.releases[0].reviewRequired,true);
  assert.equal(state.readiness[0].reviewRequired,true);
  assert.ok(state.releases[0].unresolvedConditions.some((entry)=>entry.includes('requires review')));
  assert.ok(getSummary(state).attention.some((entry)=>entry.includes('Readiness')));

  const createCtx=makeContext({now:'2026-09-01T09:00:00Z'});
  const reviewCtx=makeContext({now:'2026-09-02T09:00:00Z'});
  const boundaryCtx=makeContext({now:'2026-09-03T09:00:00Z'});
  const expireCtx=makeContext({now:'2026-09-04T09:00:00Z'});
  const expired=createEvidence(initialState(),createCtx,{rightsExpiry:'2026-09-03'});
  let expiredState=act(expired,{type:'program-governance.evidence-request-review',requestId:crypto.randomUUID(),id:expired.evidences[0].id,expectedVersion:1,reason:'Request evidence review'},reviewCtx);
  assert.throws(()=>act(expiredState,{type:'program-governance.evidence-record-review',requestId:crypto.randomUUID(),id:expiredState.evidences[0].id,expectedVersion:2,outcome:'approved',reviewer:'Evidence reviewer',reason:'Approve expired'},expireCtx),/Expired evidence cannot be approved/);

  expiredState=act(expiredState,{type:'program-governance.evidence-record-review',requestId:crypto.randomUUID(),id:expiredState.evidences[0].id,expectedVersion:2,outcome:'approved',reviewer:'Evidence reviewer',reason:'Approve before expiry'},reviewCtx);
  expiredState=createConfiguration(expiredState,reviewCtx,{title:'Approved configuration'});
  expiredState=reviewConfiguration(expiredState,expiredState.configurations[0].id,expiredState.configurations[0].version,reviewCtx);
  expiredState=activateConfiguration(expiredState,expiredState.configurations[0].id,expiredState.configurations[0].version,reviewCtx);
  expiredState=act(expiredState,{type:'program-governance.release-save-draft',requestId:crypto.randomUUID(),record:{
    title:'Aging release',
    modelId:'shadow-v1',
    softwareId:'app-2026.09',
    configurationId:expiredState.activeConfigurationId,
    intendedUse:'Synthetic governance review',
    evidenceRefIds:[expiredState.evidences[0].id],
    modelClaims:['Evidence-backed summary'],
    evaluation:{agreementSummary:'Agreement recorded.',performanceSummary:'Independent evaluation still required.',limitations:'No deployment.'},
    unresolvedConditions:[],
    overrideTrainingPolicy:'Manual review only',
  }},reviewCtx);
  expiredState=act(expiredState,{type:'program-governance.readiness-save-draft',requestId:crypto.randomUUID(),record:{
    title:'Aging readiness',
    functions:['Configuration records'],
    claims:['Synthetic governance only'],
    partnerAssets:['Synthetic release note'],
    partnerRights:['Rights review'],
    partnerResponsibilities:['Partner sign-off'],
    evidenceRefIds:[expiredState.evidences[0].id],
    blockingConditions:[],
    mandatoryGates:[{id:'gate-1',title:'Clinical evidence reviewed',required:true,disposition:'satisfied',evidenceRef:'ready://gate'}],
  }},reviewCtx);
  assert.throws(()=>act(expiredState,{type:'program-governance.release-record-review',requestId:crypto.randomUUID(),id:expiredState.releases[0].id,expectedVersion:1,reviewer:'Release reviewer',decision:'approved',unresolvedConditions:[],reason:'Approve on expiry date'},boundaryCtx),/Current approval requires reviewed, non-expired, non-withdrawn evidence/);
  assert.throws(()=>act(expiredState,{type:'program-governance.release-record-review',requestId:crypto.randomUUID(),id:expiredState.releases[0].id,expectedVersion:1,reviewer:'Release reviewer',decision:'approved',unresolvedConditions:[],reason:'Approve after expiry'},expireCtx),/Current approval requires reviewed, non-expired, non-withdrawn evidence/);
  assert.throws(()=>act(expiredState,{type:'program-governance.readiness-record-decision',requestId:crypto.randomUUID(),id:expiredState.readiness[0].id,expectedVersion:1,reviewer:'Readiness reviewer',decision:'proposed',blockingConditions:[],mandatoryGates:[{id:'gate-1',title:'Clinical evidence reviewed',required:true,disposition:'satisfied',evidenceRef:'ready://gate'}],reviewEvidence:'ready://review',reason:'Propose after expiry'},expireCtx),/Current approval requires reviewed, non-expired, non-withdrawn evidence/);
});

test('release registry keeps exact metadata, rollout and rollback history, and blocks unsupported approval paths',()=>{
  let state=createEvidence();
  const evidenceId=state.evidences[0].id;
  state=approveEvidence(state,evidenceId,1);
  state=createConfiguration(state);
  state=reviewConfiguration(state,state.configurations[0].id,state.configurations[0].version);
  state=activateConfiguration(state,state.configurations[0].id,state.configurations[0].version);

  state=act(state,{type:'program-governance.release-save-draft',requestId:crypto.randomUUID(),record:{
    title:'Release candidate',
    modelId:'shadow-v1',
    softwareId:'app-2026.09',
    configurationId:state.activeConfigurationId,
    intendedUse:'Synthetic governance review',
    evidenceRefIds:[evidenceId],
    modelClaims:['Agreement is descriptive only.'],
    evaluation:{agreementSummary:'Agreement recorded.',performanceSummary:'Independent evaluation still required.',limitations:'No rollout side effects.'},
    unresolvedConditions:['Pilot rollout checklist'],
    overrideTrainingPolicy:'Manual review only',
  }});
  const releaseId=state.releases[0].id;
  state=act(state,{type:'program-governance.release-record-review',requestId:crypto.randomUUID(),id:releaseId,expectedVersion:1,reviewer:'Release reviewer',decision:'conditional-review',unresolvedConditions:['Pilot rollout checklist'],reason:'Conditional'});
  state=act(state,{type:'program-governance.release-record-rollout',requestId:crypto.randomUUID(),id:releaseId,expectedVersion:2,note:'Recorded rollout note only'});
  state=act(state,{type:'program-governance.release-record-rollback',requestId:crypto.randomUUID(),id:releaseId,expectedVersion:3,note:'Recorded rollback note only'});
  assert.equal(state.releases[0].rolloutRecords.length,1);
  assert.equal(state.releases[0].rollbackRecords.length,1);
  assert.equal(state.releases[0].decision,'conditional-review');
  const withInactiveConfig=createConfiguration(state,makeContext(),{title:'Draft-only configuration'});
  assert.throws(()=>act(withInactiveConfig,{type:'program-governance.release-save-draft',requestId:crypto.randomUUID(),record:{
    title:'Inactive configuration release',
    modelId:'shadow-v1',
    softwareId:'app-2026.09',
    configurationId:withInactiveConfig.configurations[0].id,
    intendedUse:'Synthetic governance review',
    evidenceRefIds:[evidenceId],
    modelClaims:['Agreement is descriptive only.'],
    evaluation:{agreementSummary:'Agreement recorded.',performanceSummary:'Independent evaluation still required.',limitations:'No rollout side effects.'},
    unresolvedConditions:[],
    overrideTrainingPolicy:'Manual review only',
  }}),/active approved configuration/);

  assert.throws(()=>act(state,{type:'program-governance.release-save-draft',requestId:crypto.randomUUID(),record:{
    title:'Invalid release',
    modelId:'shadow-v2',
    softwareId:'app-2026.10',
    configurationId:state.activeConfigurationId,
    intendedUse:'Synthetic governance review',
    evidenceRefIds:[],
    modelClaims:['Needs evidence'],
    evaluation:{agreementSummary:'Agreement recorded.',performanceSummary:'Pending.',limitations:'Pending.'},
    unresolvedConditions:[],
    overrideTrainingPolicy:'Manual review only',
  }}),/Evidence record/);
  assert.throws(()=>act(state,{type:'program-governance.release-save-draft',requestId:crypto.randomUUID(),record:{
    title:'Auto training release',
    modelId:'shadow-v2',
    softwareId:'app-2026.10',
    configurationId:state.activeConfigurationId,
    intendedUse:'Synthetic governance review',
    evidenceRefIds:[evidenceId],
    modelClaims:['Needs evidence'],
    evaluation:{agreementSummary:'Agreement recorded.',performanceSummary:'Pending.',limitations:'Pending.'},
    unresolvedConditions:[],
    overrideTrainingPolicy:'Automatic from clinician override',
  }}),/never automatic/);
});

test('operations keep attributed evidence, reject secrets, and block failed restore proof closure',()=>{
  let state=act(initialState(),{type:'program-governance.operation-report',requestId:crypto.randomUUID(),record:{
    title:'Service incident',
    kind:'incident',
    affectedServices:['workspace-api'],
    owner:'Operations lead',
    severity:'high',
    actionsTaken:['Captured incident summary without credentials.'],
    evidenceRef:'ops://incident-1',
    restoreOutcome:'not-applicable',
  }});
  const id=state.operations[0].id;
  state=act(state,{type:'program-governance.operation-confirm',requestId:crypto.randomUUID(),id,expectedVersion:1,owner:'Operations lead',severity:'critical',reason:'Authorized operator confirmed severity'});
  state=act(state,{type:'program-governance.operation-review',requestId:crypto.randomUUID(),id,expectedVersion:2,evidenceRef:'ops://review-1',reason:'Reviewed incident response evidence'});
  state=act(state,{type:'program-governance.operation-reconcile',requestId:crypto.randomUUID(),id,expectedVersion:3,record:{expectedEventManifestRef:'synthetic://empty-manifest',reconciliationEvidence:'synthetic://reconciled',events:[],coverage:[],correctiveActions:[],remainingRisks:[],reviewer:'Operations reviewer'},reason:'Reviewed zero missing events and no coverage gaps'});
  state=act(state,{type:'program-governance.operation-close',requestId:crypto.randomUUID(),id,expectedVersion:4,evidenceRef:'ops://close-1',reason:'Closed after evidence review'});
  assert.equal(state.operations[0].status,'closed');

  assert.throws(()=>act(initialState(),{type:'program-governance.operation-report',requestId:crypto.randomUUID(),record:{
    title:'Password pasted into ticket',
    kind:'incident',
    affectedServices:['workspace-api'],
    owner:'Operations lead',
    severity:'high',
    actionsTaken:['Reset access.'],
    evidenceRef:'ops://incident-2',
    restoreOutcome:'not-applicable',
  }}),/must not include credentials/);

  let restore=act(initialState(),{type:'program-governance.operation-report',requestId:crypto.randomUUID(),record:{
    title:'Restore exercise proof',
    kind:'restore-proof',
    affectedServices:['workspace-db'],
    owner:'Operations lead',
    severity:'medium',
    actionsTaken:['Recorded failed restore evidence only.'],
    evidenceRef:'ops://restore-1',
    restoreOutcome:'reported-failure',
  }});
  const restoreId=restore.operations[0].id;
  restore=act(restore,{type:'program-governance.operation-confirm',requestId:crypto.randomUUID(),id:restoreId,expectedVersion:1,owner:'Operations lead',severity:'medium',reason:'Authorized operator confirmed restore exercise'});
  restore=act(restore,{type:'program-governance.operation-review',requestId:crypto.randomUUID(),id:restoreId,expectedVersion:2,evidenceRef:'ops://restore-review',reason:'Reviewed restore exercise evidence'});
  assert.throws(()=>act(restore,{type:'program-governance.operation-close',requestId:crypto.randomUUID(),id:restoreId,expectedVersion:3,evidenceRef:'ops://restore-close',reason:'Attempted close'}),/failed restore exercise cannot be closed/);
});

test('monitoring documentation prevents duplicates and records qualified review with export-safe summaries',()=>{
  let state=act(initialState(),{type:'program-governance.monitoring-record-service',requestId:crypto.randomUUID(),record:{
    serviceDate:'2026-09-17',
    activity:'Documented service review',
    source:'Operations report',
    evidenceRef:'monitor://1',
    missingDocumentation:['Payer review external'],
  }});
  const record=state.monitoring[0];
  state=act(state,{type:'program-governance.monitoring-record-review',requestId:crypto.randomUUID(),id:record.id,expectedVersion:1,reason:'Qualified reviewer checked the log'});
  assert.equal(state.monitoring[0].status,'reviewed');
  assert.throws(()=>act(state,{type:'program-governance.monitoring-record-service',requestId:crypto.randomUUID(),record:{
    serviceDate:'2026-09-17',
    activity:'Documented service review',
    source:'Operations report',
    evidenceRef:'monitor://2',
    missingDocumentation:[],
  }}),/Duplicate service documentation/);
});

test('release readiness keeps blockers explicit and requires mandatory gate disposition evidence before a proposed decision',()=>{
  let state=createEvidence();
  const evidenceId=state.evidences[0].id;
  state=approveEvidence(state,evidenceId,1);
  state=act(state,{type:'program-governance.readiness-save-draft',requestId:crypto.randomUUID(),record:{
    title:'Partner release readiness',
    functions:['Configuration records','Protocol publication'],
    claims:['Synthetic governance only'],
    partnerAssets:['Synthetic release note'],
    partnerRights:['Rights review'],
    partnerResponsibilities:['Partner sign-off'],
    evidenceRefIds:[evidenceId],
    blockingConditions:['Clinical sign-off pending'],
    mandatoryGates:[{id:'gate-1',title:'Clinical evidence reviewed',required:true,disposition:'open',evidenceRef:''}],
  }});
  const readiness=state.readiness[0];
  assert.throws(()=>act(state,{type:'program-governance.readiness-record-decision',requestId:crypto.randomUUID(),id:readiness.id,expectedVersion:1,reviewer:'Readiness reviewer',decision:'proposed',blockingConditions:['Clinical sign-off pending'],mandatoryGates:readiness.mandatoryGates,reviewEvidence:'ready://1',reason:'Attempt proposal'}),/cannot leave mandatory gates unresolved/);
  state=act(state,{type:'program-governance.readiness-record-decision',requestId:crypto.randomUUID(),id:readiness.id,expectedVersion:1,reviewer:'Readiness reviewer',decision:'conditional-review',blockingConditions:['Clinical sign-off pending'],mandatoryGates:[{id:'gate-1',title:'Clinical evidence reviewed',required:true,disposition:'waived',evidenceRef:'ready://waiver'}],reviewEvidence:'ready://1',reason:'Conditional review pending external gates'});
  assert.equal(state.readiness[0].decision,'conditional-review');
  assert.match(state.readiness[0].regulatoryAuthorizationNote,/external gate/);
});

test('request idempotency, strict validation, non-mutation, state validation, and render contract all hold',()=>{
  const before=initialState();
  const requestId='repeatable-request';
  const action={type:'program-governance.configuration-save-draft',requestId,record:{
    title:'Program configuration',
    capabilityChoices:['assessments'],
    allowedCadence:['weekly'],
    languages:['English'],
    communicationSettings:['in-app'],
    displayReferences:['Settings card'],
    safetyEssentials:['Visible disclaimer'],
    nonHideableSafetyEssentials:['Visible disclaimer'],
  }};
  const first=act(before,action);
  const second=act(first,action);
  assert.deepEqual(before,initialState());
  assert.deepEqual(first,second);
  assert.throws(()=>act(first,{...action,record:{...action.record,title:'Different payload'}}),/already used for a different payload/);
  assert.equal(actionSchema.safeParse({...action,unexpected:true}).success,false);
  assert.deepEqual(validateState(first),first);
  const html=render(first,{patientId:'TN-1042'});
  for(const text of ['Program governance','Program configuration','Protocol authoring','Evidence and content registry','Release registry','Operations','Monitoring documentation','Release readiness','data-journey="J22"','data-journey="J28"','External proof still required'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html.replace(/<[^>]+>/g,' '),/\bJ\d{2}\b/,'internal journey codes stay out of visible text');
});


test('current runtime policy and visible safety requirements are checked again at review and activation',()=>{
  let state=createConfiguration();
  const original=structuredClone(state);
  const blocked=makeContext({features:{...allFeatures,messages:false}});
  assert.throws(()=>reviewConfiguration(state,state.configurations[0].id,1,blocked),/blocked capability/);
  assert.deepEqual(state,original);
  state=reviewConfiguration(state,state.configurations[0].id,1);
  assert.throws(()=>activateConfiguration(state,state.configurations[0].id,2,blocked),/runtime policy/);
  state=activateConfiguration(state,state.configurations[0].id,2);
  const active=state.configurations[0];
  const action={type:'program-governance.configuration-save-draft',requestId:crypto.randomUUID(),id:active.id,expectedVersion:active.version,record:{title:'Changed active title',capabilityChoices:active.capabilityChoices,allowedCadence:active.allowedCadence,languages:active.languages,communicationSettings:active.communicationSettings,displayReferences:active.displayReferences,safetyEssentials:active.safetyEssentials,nonHideableSafetyEssentials:active.nonHideableSafetyEssentials}};
  assert.throws(()=>act(state,action),/Activated configurations are immutable/);
  assert.throws(()=>createConfiguration(state,makeContext(),{safetyEssentials:['Different requirement'],nonHideableSafetyEssentials:['Different requirement']}),/cannot be removed/);
  assert.throws(()=>createConfiguration(initialState(),makeContext(),{safetyEssentials:['Displayed'],nonHideableSafetyEssentials:['Not displayed']}),/must remain visible/);
  assert.equal(active.revisions.find(revision=>revision.version===1).record.title,'Program configuration');
  assert.equal(active.revisions.find(revision=>revision.version===2).record.status,'reviewed');
});

test('protocol drafts allow open questions but reject duplicate IDs and prerequisite cycles; assignments retain published content',()=>{
  const step=(id,prerequisites=[])=>({id,title:`Step ${id}`,owner:'Reviewer',kind:'action',prerequisites,nextStepIds:[],branchStepIds:[],openQuestion:''});
  assert.throws(()=>createProtocol(initialState(),makeContext(),{steps:[step('a'),step('a')]}),/IDs must be unique/);
  assert.throws(()=>createProtocol(initialState(),makeContext(),{steps:[step('a',['b']),step('b',['a'])]}),/contains a cycle/);
  let open=createProtocol(initialState(),makeContext(),{steps:[{...step('a'),openQuestion:'Who owns this step?'}]});
  assert.equal(open.protocols[0].status,'draft');
  assert.throws(()=>act(open,{type:'program-governance.protocol-request-review',requestId:crypto.randomUUID(),id:open.protocols[0].id,expectedVersion:1,reason:'Review'}),/Resolve all protocol questions/);
  let state=createProtocol();const id=state.protocols[0].id;
  for(const action of [{type:'program-governance.protocol-request-review',reason:'Operational review'},{type:'program-governance.protocol-record-review',outcome:'reviewed',reviewer:'Reviewer',evidenceLocator:'synthetic://review',reason:'Review documented'},{type:'program-governance.protocol-record-publication',evidenceRef:'synthetic://publication',reason:'Publication documented'}])state=act(state,{requestId:crypto.randomUUID(),id,expectedVersion:state.protocols[0].version,...action});
  const published=structuredClone(state.protocols[0]);
  const assign={type:'program-governance.protocol-assign-episode',requestId:crypto.randomUUID(),patientId:patients[0].id,protocolId:id,expectedProtocolVersion:published.version,expectedAssignmentVersion:0,reason:'Documented assignment'};
  state=act(state,assign);
  assert.deepEqual(state.protocolAssignments[0].protocolSnapshot,published);
  assert.throws(()=>act(state,{...assign,requestId:crypto.randomUUID()}),/assignment changed/);
  const {title,owner,evidenceLocator,unresolvedQuestions,steps}=published;
  state=act(state,{type:'program-governance.protocol-save-draft',requestId:crypto.randomUUID(),id,expectedVersion:published.version,record:{title,owner,evidenceLocator,unresolvedQuestions,steps:steps.map((item,index)=>index===0?{...item,title:'Changed instruction'}:item)}});
  assert.deepEqual(state.protocolAssignments[0].protocolSnapshot,published);
  assert.equal(state.protocols[0].revisions[0].record.steps[0].title,published.steps[0].title);
});

test('approval refuses expiry at the date boundary, conflicting-only support, future sources and invalid calendar dates',()=>{
  const before=makeContext({now:'2026-09-01T00:00:00Z'});
  let state=createEvidence(initialState(),before,{rightsExpiry:'2026-09-02'});
  const id=state.evidences[0].id;
  state=act(state,{type:'program-governance.evidence-request-review',requestId:crypto.randomUUID(),id,expectedVersion:1,reason:'Review'},before);
  assert.throws(()=>act(state,{type:'program-governance.evidence-record-review',requestId:crypto.randomUUID(),id,expectedVersion:2,outcome:'approved',reviewer:'Reviewer',reason:'Approve'},makeContext({now:'2026-09-02T00:00:00Z'})),/Expired evidence/);
  const sources=[{title:'Conflicting memo',locator:'synthetic://memo',kind:'conflicting',publicationDate:'2026-09-01',retracted:false}];
  let conflicting=createEvidence(initialState(),before,{supportingSources:sources});
  assert.throws(()=>approveEvidence(conflicting,conflicting.evidences[0].id,1,before),/usable supporting source/);
  let future=createEvidence(initialState(),before,{supportingSources:[{...sources[0],kind:'supporting',publicationDate:'2026-09-03'}]});
  assert.throws(()=>approveEvidence(future,future.evidences[0].id,1,before),/Future-dated/);
  assert.throws(()=>createEvidence(initialState(),before,{rightsExpiry:'2026-02-30'}),/real calendar date/);
  assert.throws(()=>createConfiguration(initialState(),makeContext({now:'not-a-time'})),/Valid server time/);
});

function governanceDependencies(){
  let state=createConfiguration();state=reviewConfiguration(state,state.configurations[0].id,1);state=activateConfiguration(state,state.configurations[0].id,2);
  state=createEvidence(state);state=approveEvidence(state,state.evidences[0].id,1);
  const evidenceId=state.evidences[0].id;
  const release={title:'Reviewed release',modelId:'synthetic-model',softwareId:'synthetic-software',configurationId:state.activeConfigurationId,intendedUse:'Synthetic review',evidenceRefIds:[evidenceId],modelClaims:['Documented evaluation'],evaluation:{agreementSummary:'Descriptive only',performanceSummary:'Synthetic memo',limitations:'No clinical validation'},unresolvedConditions:[],overrideTrainingPolicy:'Manual review only'};
  state=act(state,{type:'program-governance.release-save-draft',requestId:crypto.randomUUID(),record:release});
  state=act(state,{type:'program-governance.release-record-review',requestId:crypto.randomUUID(),id:state.releases[0].id,expectedVersion:state.releases[0].version,reviewer:'Reviewer',decision:'approved',unresolvedConditions:[],reason:'Documented synthetic review'});
  const gates=[{id:'evidence',title:'Review evidence',required:true,disposition:'satisfied',evidenceRef:'synthetic://review'},{id:'partner',title:'Review partner rights',required:true,disposition:'satisfied',evidenceRef:'synthetic://partner'}];
  const readiness={releaseRef:{releaseId:state.releases[0].id,artifactVersion:state.releases[0].artifactVersion},scope:{capabilities:['assessments'],populationRefs:['demo-adults'],permittedRoles:['reviewer'],inputRefs:['synthetic-input'],outputRefs:['synthetic-output'],claimRefs:['synthetic-only'],environment:'demo'},title:'Reviewed readiness',functions:['Records'],claims:['Synthetic scope'],partnerAssets:[],partnerRights:[],partnerResponsibilities:[],evidenceRefIds:[evidenceId],blockingConditions:[],mandatoryGates:gates};
  state=act(state,{type:'program-governance.readiness-save-draft',requestId:crypto.randomUUID(),record:readiness});
  state=act(state,{type:'program-governance.readiness-record-decision',requestId:crypto.randomUUID(),id:state.readiness[0].id,expectedVersion:1,reviewer:'Reviewer',decision:'proposed',blockingConditions:[],mandatoryGates:gates,reviewEvidence:'synthetic://decision',reason:'Documentation reviewed'});
  return {state,evidenceId,release,readiness};
}

test('evidence edits invalidate existing approvals, retain snapshots, and still allow a documented no-go',()=>{
  let {state,evidenceId}=governanceDependencies();
  const release=structuredClone(state.releases[0]),readiness=structuredClone(state.readiness[0]);
  const {title,indication,population,endpoint,supportingSources,rights,rightsExpiry}=state.evidences[0];
  state=act(state,{type:'program-governance.evidence-save-draft',requestId:crypto.randomUUID(),id:evidenceId,expectedVersion:state.evidences[0].version,record:{title,indication,population,endpoint:`Revised ${endpoint}`,supportingSources,rights,rightsExpiry}});
  assert.equal(state.releases[0].reviewRequired,true);assert.equal(state.releases[0].decision,'pending');
  assert.equal(state.readiness[0].reviewRequired,true);assert.equal(state.readiness[0].decision,'conditional-review');
  assert.equal(state.releases[0].revisions.find(revision=>revision.version===release.version).record.decision,'approved');
  assert.equal(state.readiness[0].revisions.find(revision=>revision.version===readiness.version).record.decision,'proposed');
  assert.throws(()=>act(state,{type:'program-governance.release-record-review',requestId:crypto.randomUUID(),id:release.id,expectedVersion:state.releases[0].version,reviewer:'Reviewer',decision:'approved',unresolvedConditions:[],reason:'Attempt review'}),/non-expired/);
  state=act(state,{type:'program-governance.release-record-review',requestId:crypto.randomUUID(),id:release.id,expectedVersion:state.releases[0].version,reviewer:'Reviewer',decision:'no-go',unresolvedConditions:['Evidence was revised'],reason:'Do not proceed'});
  assert.equal(state.releases[0].decision,'no-go');
});

test('expired evidence appears in current summaries and invalidates persisted reviews on the next governance mutation',()=>{
  let {state}=governanceDependencies();
  const expired=makeContext({now:'2026-09-20T00:00:00Z'});
  const summary=getSummary(state,undefined,expired.now);
  assert.ok(summary.attention.some(note=>/expired/.test(note)));
  assert.ok(summary.attention.some(note=>/Release Reviewed release/.test(note)));
  const oldVersion=state.releases[0].version;
  state=act(state,{type:'program-governance.monitoring-record-service',requestId:crypto.randomUUID(),record:{serviceDate:'2026-09-20',activity:'Evidence dependency observation',source:'Synthetic review',evidenceRef:'synthetic://expiry',missingDocumentation:[]}},expired);
  assert.equal(state.releases[0].reviewRequired,true);
  assert.equal(state.releases[0].decision,'pending');
  assert.equal(state.releases[0].version,oldVersion+1);
  assert.equal(state.readiness[0].decision,'conditional-review');
  const invalidatedVersion=state.releases[0].version;
  state=act(state,{type:'program-governance.monitoring-record-review',requestId:crypto.randomUUID(),id:state.monitoring[0].id,expectedVersion:1,reason:'Expiry noted'},expired);
  assert.equal(state.releases[0].version,invalidatedVersion,'Repeated dependency checks do not duplicate invalidation history');
});

test('configuration deactivation invalidates dependent release approval and prevents reapproval',()=>{
  let {state}=governanceDependencies();
  state=act(state,{type:'program-governance.configuration-deactivate',requestId:crypto.randomUUID(),id:state.activeConfigurationId,expectedVersion:state.configurations[0].version,reason:'Configuration retired'});
  assert.equal(state.releases[0].decision,'pending');assert.equal(state.releases[0].reviewRequired,true);
  assert.throws(()=>act(state,{type:'program-governance.release-record-review',requestId:crypto.randomUUID(),id:state.releases[0].id,expectedVersion:state.releases[0].version,decision:'approved',reviewer:'Reviewer',unresolvedConditions:[],reason:'Reapprove'}),/active reviewed configuration/);
});

test('required readiness gates cannot be deleted or downgraded by decisions or draft rewrites',()=>{
  const {state,readiness}=governanceDependencies();
  const current=state.readiness[0];
  const base={type:'program-governance.readiness-record-decision',requestId:crypto.randomUUID(),id:current.id,expectedVersion:current.version,reviewer:'Reviewer',decision:'proposed',blockingConditions:[],reviewEvidence:'synthetic://review',reason:'Gate review'};
  assert.throws(()=>act(state,{...base,mandatoryGates:readiness.mandatoryGates.slice(0,1)}),/cannot be removed/);
  assert.throws(()=>act(state,{...base,mandatoryGates:readiness.mandatoryGates.map((gate,index)=>index===1?{...gate,required:false}:gate)}),/cannot be removed/);
  assert.throws(()=>act(state,{type:'program-governance.readiness-save-draft',requestId:crypto.randomUUID(),id:current.id,expectedVersion:current.version,record:{...readiness,mandatoryGates:readiness.mandatoryGates.slice(0,1)}}),/cannot be removed/);
  assert.throws(()=>act(state,{...base,mandatoryGates:[readiness.mandatoryGates[0],readiness.mandatoryGates[0]]}),/IDs must be unique/);
  const noEvidence=act(state,{type:'program-governance.readiness-save-draft',requestId:crypto.randomUUID(),record:{...readiness,evidenceRefIds:[]}});
  assert.throws(()=>act(noEvidence,{...base,id:noEvidence.readiness[0].id,expectedVersion:1,mandatoryGates:readiness.mandatoryGates}),/requires reviewed evidence/);
});

test('updates enforce both identity and version, request replay enforces actor, and invalid state references are rejected',()=>{
  let state=createConfiguration();
  const current=state.configurations[0];
  const {title,capabilityChoices,allowedCadence,languages,communicationSettings,displayReferences,safetyEssentials,nonHideableSafetyEssentials}=current;
  const command={type:'program-governance.configuration-save-draft',requestId:crypto.randomUUID(),record:{title,capabilityChoices,allowedCadence,languages,communicationSettings,displayReferences,safetyEssentials,nonHideableSafetyEssentials}};
  assert.throws(()=>act(state,{...command,expectedVersion:1}),/both id and expectedVersion/);
  assert.throws(()=>act(state,{...command,id:current.id}),/both id and expectedVersion/);
  assert.throws(()=>act(state,{...command,id:current.id,expectedVersion:2}),/changed/);
  state=act(state,command);
  assert.deepEqual(act(state,command),state);
  assert.throws(()=>act(state,command,makeContext({actor:'Different actor'})),/another actor/);
  const corrupt=structuredClone(state);corrupt.activeConfigurationId=current.id;
  assert.throws(()=>validateState(corrupt),/Active configuration reference/);
  assert.throws(()=>validateState({...state,configurations:[state.configurations[0],state.configurations[0]]}),/IDs must be unique/);
});

test('restore outcomes match their operation kind; future monitoring and duplicate normalized documentation are rejected',()=>{
  const operation={title:'Restore report',kind:'restore-proof',affectedServices:['Evaluation database'],owner:'Operator',severity:'medium',actionsTaken:['Documented exercise'],evidenceRef:'synthetic://restore',restoreOutcome:'not-applicable'};
  assert.throws(()=>act(initialState(),{type:'program-governance.operation-report',requestId:crypto.randomUUID(),record:operation}),/outcome must match/);
  const record={serviceDate:'2026-09-17',activity:'Service review',source:'Operations report',evidenceRef:'synthetic://service',missingDocumentation:[]};
  assert.throws(()=>act(initialState(),{type:'program-governance.monitoring-record-service',requestId:crypto.randomUUID(),record:{...record,serviceDate:'2026-09-18'}}),/future/);
  let state=act(initialState(),{type:'program-governance.monitoring-record-service',requestId:crypto.randomUUID(),record});
  assert.throws(()=>act(state,{type:'program-governance.monitoring-record-service',requestId:crypto.randomUUID(),record:{...record,activity:'SERVICE   REVIEW',source:'OPERATIONS REPORT'}}),/Duplicate/);
  state=act(state,{type:'program-governance.monitoring-record-review',requestId:crypto.randomUUID(),id:state.monitoring[0].id,expectedVersion:1,reason:'Reviewed'});
  assert.throws(()=>act(state,{type:'program-governance.monitoring-record-review',requestId:crypto.randomUUID(),id:state.monitoring[0].id,expectedVersion:2,reason:'Repeated review'}),/Only reported monitoring/);
});

test('all J22–J28 driver scenarios pass with documentation-only evidence and rejected unsafe transitions',async()=>{
  const {runScenarios}=await import('./fixtures/program-governance-scenarios.mjs');
  let state=initialState();const journeys=[];
  await runScenarios({patientId:patients[0].id,now:makeContext().now,workspace:()=>({features:allFeatures}),state:()=>state,apply:async action=>{state=act(state,action);return state;},expectRejected:async action=>{const snapshot=structuredClone(state);assert.throws(()=>act(state,action));assert.deepEqual(state,snapshot);},record:(id,status)=>journeys.push([id,status])});
  assert.deepEqual(journeys,['J22','J23','J24','J25','J26','J27','J28'].map(id=>[id,'passed']));
});

test('runtime scope permits only the exact reviewed artifact and never enables a raw disabled capability',()=>{
  let {state,release}=governanceDependencies();
  const context=makeContext(),releaseRef={releaseId:state.releases[0].id,artifactVersion:1};
  const use={capability:'assessments',releaseRef,populationRef:'demo-adults',role:'reviewer',environment:'demo'};
  assert.equal(evaluateRuntimeUse(initialState(),{capability:'assessments',environment:'demo'},context).allowed,true);
  assert.equal(evaluateRuntimeUse(initialState(),{capability:'assessments',environment:'production'},context).allowed,false);
  assert.equal(evaluateRuntimeUse(state,use,context).allowed,true);
  assert.equal(evaluateRuntimeUse(state,{...use,populationRef:'unreviewed-population'},context).allowed,false);
  assert.equal(evaluateRuntimeUse(state,{...use,role:'unreviewed-role'},context).allowed,false);
  assert.equal(evaluateRuntimeUse(state,use,{...context,features:{...allFeatures,assessments:false}}).allowed,false);
  assert.equal(evaluateRuntimeUse(state,use,{...context,now:'2026-09-20T00:00:00Z'}).allowed,false);
  state=act(state,{type:'program-governance.release-record-rollout',requestId:crypto.randomUUID(),id:releaseRef.releaseId,expectedVersion:state.releases[0].version,note:'Synthetic observation only'});
  assert.equal(state.releases[0].artifactVersion,1);
  assert.equal(evaluateRuntimeUse(state,use,context).allowed,true);
  const approvedReadiness=structuredClone(state.readiness[0]);
  state=act(state,{type:'program-governance.release-save-draft',requestId:crypto.randomUUID(),id:releaseRef.releaseId,expectedVersion:state.releases[0].version,record:{...release,modelId:'different-synthetic-model'}});
  assert.equal(state.releases[0].artifactVersion,2);
  assert.equal(state.readiness[0].decision,'conditional-review');
  assert.equal(evaluateRuntimeUse(state,use,context).allowed,false);
  assert.deepEqual(state.readiness[0].revisions.find(item=>item.version===approvedReadiness.version).record.releaseRef,releaseRef);
});

test('recall derives exact patient impacts, refreshes inventory, and keeps the artifact suspended after review closure',()=>{
  let {state}=governanceDependencies();
  const release=structuredClone(state.releases[0]),releaseRef={releaseId:release.id,artifactVersion:release.artifactVersion};
  const usage={patientId:patients[0].id,encounterId:'recall-episode',sourceId:'signed-output-1',sourceVersion:1,releaseRef,evidenceRefs:[]};
  const context=makeContext({governedUsages:[usage,{...usage,sourceId:'unrelated-output',releaseRef:{releaseId:'different-model',artifactVersion:1}}],usageCoverage:'complete'});
  const original=structuredClone(context);
  const open={type:'program-governance.recall-open',requestId:crypto.randomUUID(),subject:{kind:'release',id:release.id,artifactVersion:1},expectedSubjectVersion:release.version,owner:'Recall owner',reason:'Synthetic model recall exercise',evidenceRef:'synthetic://recall'};
  state=act(state,open,context);
  assert.equal(state.recalls[0].impacts.length,1);
  assert.equal(state.recalls[0].impacts[0].sourceId,usage.sourceId);
  assert.equal(state.releases[0].decision,'pending');
  assert.equal(state.readiness[0].decision,'conditional-review');
  assert.deepEqual(act(state,open,context),state);
  const before=structuredClone(state);
  const base=()=>({id:state.recalls[0].id,expectedVersion:state.recalls[0].version,requestId:crypto.randomUUID(),evidenceRef:'synthetic://review',reason:'Synthetic review recorded'});
  assert.throws(()=>act(state,{type:'program-governance.recall-close',...base()},context),/Complete the trusted impact inventory/);
  assert.throws(()=>act(state,{type:'program-governance.recall-review-impact',...base(),impactId:state.recalls[0].impacts[0].id,disposition:'accepted-transfer'},context),/receiving-owner acceptance/);
  assert.throws(()=>act(state,{type:'program-governance.recall-review-impact',...base(),impactId:state.recalls[0].impacts[0].id,disposition:'reviewed-plan-amended'},context),/reviewed plan reference/);
  assert.deepEqual(state,before);
  const expanded={...context,governedUsages:[...context.governedUsages,{...usage,patientId:patients[1].id,sourceId:'signed-output-2'}]};
  state=act(state,{type:'program-governance.recall-review-coverage',...base()},expanded);
  assert.equal(state.recalls[0].impacts.length,2);
  for(const impact of [...state.recalls[0].impacts])state=act(state,{type:'program-governance.recall-review-impact',...base(),impactId:impact.id,disposition:'reviewed-no-change'},expanded);
  state=act(state,{type:'program-governance.recall-close',...base()},expanded);
  assert.equal(state.recalls[0].status,'closed');
  assert.equal(evaluateRuntimeUse(state,{capability:'assessments',releaseRef,populationRef:'demo-adults',role:'reviewer',environment:'demo'},context).allowed,false);
  assert.throws(()=>act(state,{type:'program-governance.release-record-review',requestId:crypto.randomUUID(),id:release.id,expectedVersion:state.releases[0].version,reviewer:'Reviewer',decision:'approved',unresolvedConditions:[],reason:'Attempt to reuse recalled artifact'},context),/recalled artifact cannot be reapproved/);
  assert.deepEqual(context,original);
  assert.equal(state.releases[0].revisions.find(item=>item.version===release.version).record.decision,'approved');
});

test('release review cannot relabel saved artifacts with revised evidence and historical recalls retain their original impacts',()=>{
  let {state,release,readiness,evidenceId}=governanceDependencies();
  const originalRelease=structuredClone(state.releases[0]),originalEvidence=structuredClone(state.evidences[0]);
  const originalRef={releaseId:originalRelease.id,artifactVersion:originalRelease.artifactVersion};
  const usage={patientId:patients[0].id,encounterId:'evidence-revision-episode',sourceId:'original-engine-output',sourceVersion:1,releaseRef:originalRef,evidenceRefs:[]};
  const context=makeContext({governedUsages:[usage]});
  const {title,indication,population,endpoint,supportingSources,rights,rightsExpiry}=originalEvidence;
  state=act(state,{type:'program-governance.evidence-save-draft',requestId:crypto.randomUUID(),id:evidenceId,expectedVersion:originalEvidence.version,record:{title,indication,population,endpoint:endpoint+' revised',supportingSources,rights,rightsExpiry}},context);
  state=approveEvidence(state,evidenceId,state.evidences[0].version,context);
  const revisedEvidenceVersion=state.evidences[0].version;
  const review=decision=>({type:'program-governance.release-record-review',requestId:crypto.randomUUID(),id:originalRelease.id,expectedVersion:state.releases[0].version,reviewer:'Reviewer',decision,unresolvedConditions:[],reason:'Review revised supporting evidence'});
  for(const decision of ['conditional-review','no-go']){
    state=act(state,review(decision),context);
    assert.equal(state.releases[0].artifactVersion,originalRef.artifactVersion);
    assert.deepEqual(state.releases[0].evidenceVersions,originalRelease.evidenceVersions);
  }
  const beforeRejectedApproval=structuredClone(state);
  assert.throws(()=>act(state,review('approved'),context),/Save a revised release artifact/);
  assert.deepEqual(state,beforeRejectedApproval);

  state=act(state,{type:'program-governance.release-save-draft',requestId:crypto.randomUUID(),id:originalRelease.id,expectedVersion:state.releases[0].version,record:release},context);
  const replacementRef={releaseId:originalRelease.id,artifactVersion:state.releases[0].artifactVersion};
  assert.equal(replacementRef.artifactVersion,originalRef.artifactVersion+1);
  assert.equal(state.releases[0].evidenceVersions[evidenceId],revisedEvidenceVersion);
  state=act(state,review('approved'),context);
  state=act(state,{type:'program-governance.readiness-save-draft',requestId:crypto.randomUUID(),id:state.readiness[0].id,expectedVersion:state.readiness[0].version,record:{...readiness,releaseRef:replacementRef}},context);
  state=act(state,{type:'program-governance.readiness-record-decision',requestId:crypto.randomUUID(),id:state.readiness[0].id,expectedVersion:state.readiness[0].version,reviewer:'Reviewer',decision:'proposed',blockingConditions:[],mandatoryGates:readiness.mandatoryGates,reviewEvidence:'synthetic://replacement-scope',reason:'Review replacement artifact scope'},context);
  const use={capability:'assessments',populationRef:'demo-adults',role:'reviewer',environment:'demo'};
  assert.equal(evaluateRuntimeUse(state,{...use,releaseRef:replacementRef},context).allowed,true);
  assert.equal(evaluateRuntimeUse(state,{...use,releaseRef:originalRef},context).allowed,false);
  const recallContext={...context,governedUsages:[usage,{...usage,sourceId:'replacement-engine-output',releaseRef:replacementRef}]};
  state=act(state,{type:'program-governance.recall-open',requestId:crypto.randomUUID(),subject:{kind:'evidence',id:evidenceId,version:originalEvidence.version},expectedSubjectVersion:revisedEvidenceVersion,owner:'Recall owner',reason:'Recall original supporting evidence',evidenceRef:'synthetic://original-evidence-recall'},recallContext);
  assert.deepEqual(state.recalls[0].impacts.map(impact=>impact.sourceId),[usage.sourceId]);
  assert.equal(evaluateRuntimeUse(state,{...use,releaseRef:replacementRef},context).allowed,true);
  assert.ok(state.releases[0].revisions.filter(revision=>revision.record.artifactVersion===originalRef.artifactVersion).every(revision=>revision.record.evidenceVersions[evidenceId]===originalEvidence.version));
});

test('recalled readiness-only evidence suspends runtime scope and cannot be proposed again after recall closure',()=>{
  let {state,readiness}=governanceDependencies();
  const release=structuredClone(state.releases[0]),context=makeContext();
  state=createEvidence(state,context,{title:'Readiness-only safety support'});
  const evidenceId=state.evidences[0].id;
  state=approveEvidence(state,evidenceId,1,context);
  const evidenceVersion=state.evidences[0].version;
  state=act(state,{type:'program-governance.readiness-save-draft',requestId:crypto.randomUUID(),id:state.readiness[0].id,expectedVersion:state.readiness[0].version,record:{...readiness,evidenceRefIds:[evidenceId]}},context);
  const decision=()=>({type:'program-governance.readiness-record-decision',requestId:crypto.randomUUID(),id:state.readiness[0].id,expectedVersion:state.readiness[0].version,reviewer:'Reviewer',decision:'proposed',blockingConditions:[],mandatoryGates:readiness.mandatoryGates,reviewEvidence:'synthetic://scope-review',reason:'Review scope-only support'});
  state=act(state,decision(),context);
  const approvedScope=structuredClone(state.readiness[0]);
  const use={capability:'assessments',releaseRef:readiness.releaseRef,populationRef:'demo-adults',role:'reviewer',environment:'demo'};
  assert.equal(evaluateRuntimeUse(state,use,context).allowed,true);
  state=act(state,{type:'program-governance.recall-open',requestId:crypto.randomUUID(),subject:{kind:'evidence',id:evidenceId,version:evidenceVersion},expectedSubjectVersion:evidenceVersion,owner:'Recall owner',reason:'Recall readiness-only support',evidenceRef:'synthetic://scope-recall'},context);
  assert.deepEqual(state.releases[0],release,'A recall of scope-only support leaves the release artifact intact.');
  assert.equal(state.readiness[0].decision,'conditional-review');
  assert.equal(state.readiness[0].reviewRequired,true);
  assert.ok(state.readiness[0].dependencyAlerts.some(reason=>reason.includes('recalled')));
  assert.equal(evaluateRuntimeUse(state,use,context).allowed,false);
  assert.equal(evaluateRuntimeUse({...state,readiness:[approvedScope]},use,context).allowed,false,'Runtime validates recalls even if the stored scope still contains its prior approved decision.');
  assert.throws(()=>act(state,decision(),context),/Recalled evidence cannot support/);
  for(const type of ['recall-review-coverage','recall-close'])state=act(state,{type:`program-governance.${type}`,requestId:crypto.randomUUID(),id:state.recalls[0].id,expectedVersion:state.recalls[0].version,evidenceRef:'synthetic://recall-review',reason:'Reviewed complete output inventory'},context);
  assert.equal(state.recalls[0].status,'closed');
  assert.equal(evaluateRuntimeUse(state,use,context).allowed,false);
  assert.throws(()=>act(state,decision(),context),/Recalled evidence cannot support/);
});

test('evidence withdrawal finds historical artifact usages after source and release revisions, without trusting client impact lists',()=>{
  let {state,release,evidenceId}=governanceDependencies();
  const releaseRef={releaseId:state.releases[0].id,artifactVersion:1},approvedVersion=state.evidences[0].version;
  const usage={patientId:patients[0].id,encounterId:'historical-episode',sourceId:'historical-signed-output',sourceVersion:1,releaseRef,evidenceRefs:[]};
  const context=makeContext({governedUsages:[usage],usageCoverage:'partial'});
  state=act(state,{type:'program-governance.release-save-draft',requestId:crypto.randomUUID(),id:releaseRef.releaseId,expectedVersion:state.releases[0].version,record:{...release,modelId:'next-artifact'}},context);
  const current=state.evidences[0];
  const {title,indication,population,endpoint,supportingSources,rights,rightsExpiry}=current;
  state=act(state,{type:'program-governance.evidence-save-draft',requestId:crypto.randomUUID(),id:evidenceId,expectedVersion:current.version,record:{title,indication,population,endpoint:endpoint+' revised',supportingSources,rights,rightsExpiry}},context);
  state=act(state,{type:'program-governance.evidence-withdraw',requestId:crypto.randomUUID(),id:evidenceId,expectedVersion:state.evidences[0].version,reason:'Synthetic source withdrawal'},context);
  const recalled=state.recalls.find(item=>item.subject.kind==='evidence'&&item.subject.version===approvedVersion);
  assert.ok(recalled);
  assert.equal(recalled.impacts[0].sourceId,usage.sourceId);
  assert.equal(recalled.usageCoverage,'partial');
  assert.throws(()=>act(state,{type:'program-governance.recall-review-coverage',requestId:crypto.randomUUID(),id:recalled.id,expectedVersion:recalled.version,evidenceRef:'synthetic://coverage',reason:'Attempt to assert complete'},context),/incomplete reference coverage/);
  assert.equal(actionSchema.safeParse({type:'program-governance.recall-open',requestId:'bad-impact-injection',subject:{kind:'evidence',id:evidenceId,version:approvedVersion},expectedSubjectVersion:state.evidences[0].version,owner:'Owner',reason:'Review',evidenceRef:'synthetic://evidence',impacts:[usage]}).success,false);
});

function publishProtocol(state,id,context=makeContext()){
  for(const fields of [{type:'program-governance.protocol-request-review',reason:'Synthetic review requested'},{type:'program-governance.protocol-record-review',outcome:'reviewed',reviewer:'Synthetic reviewer',evidenceLocator:'synthetic://review',reason:'Named review recorded'},{type:'program-governance.protocol-record-publication',evidenceRef:'synthetic://publication',reason:'Named publication recorded'}])state=act(state,{requestId:crypto.randomUUID(),id,expectedVersion:state.protocols.find(item=>item.id===id).version,...fields},context);
  return state;
}
test('published predicates are typed and migration cannot replace a pinned assignment or abandon open work',()=>{
  const eventPredicate={kind:'event',eventType:'owner-accepted'};
  assert.equal(evaluateProtocolPredicate(eventPredicate,{stages:[],eventType:'attempted'}),false);
  assert.equal(evaluateProtocolPredicate(eventPredicate,{stages:[],eventType:'owner-accepted'}),true);
  assert.equal(evaluateProtocolPredicate({kind:'review-choice',choiceId:'next-route',equals:'follow-up'},{stages:[],reviewChoices:{'next-route':'defer'}}),false);
  let state=createProtocol();state=publishProtocol(state,state.protocols[0].id);
  const old=structuredClone(state.protocols[0]);
  state=act(state,{type:'program-governance.protocol-assign-episode',requestId:crypto.randomUUID(),patientId:patients[0].id,encounterId:'migration-episode',protocolId:old.id,expectedProtocolVersion:old.version,expectedAssignmentVersion:0,reason:'Synthetic episode assignment'});
  const assignment=structuredClone(state.protocolAssignments[0]);
  assert.throws(()=>act(state,{type:'program-governance.protocol-assign-episode',requestId:crypto.randomUUID(),patientId:patients[0].id,encounterId:'migration-episode',protocolId:old.id,expectedProtocolVersion:old.version,expectedAssignmentVersion:assignment.version,reason:'Try silent replacement'}),/explicit migration/);
  const steps=old.steps.map((step,index)=>index===0?{...step,transitions:[{toStepId:'handoff',when:eventPredicate}],sourceRef:'synthetic://source-step'}:step);
  state=createProtocol(state,makeContext(),{title:'Second reusable operational pathway',steps});
  state=publishProtocol(state,state.protocols[0].id);const target=state.protocols[0];
  const context=makeContext({patientPathways:[{protocolAssignmentId:assignment.id,version:7,patientId:patients[0].id,encounterId:'migration-episode',stages:old.steps.map(step=>({id:step.id,status:'active',owner:step.owner}))}]});
  const migration={type:'program-governance.protocol-migrate-episode',requestId:crypto.randomUUID(),id:assignment.id,expectedVersion:assignment.version,expectedEpisodeVersion:7,targetProtocolId:target.id,expectedProtocolVersion:target.version,stageMap:old.steps.map(step=>({oldStepId:step.id,newStepId:step.id,carryStatus:true})),pendingWork:[],reason:'Reviewed second-pathway migration',evidenceRef:'synthetic://migration'};
  assert.throws(()=>act(state,migration,context),/Every open source step/);
  const pendingWork=old.steps.map(step=>({oldStepId:step.id,disposition:'carry',owner:step.owner,evidenceRef:'synthetic://carry'}));
  assert.throws(()=>act(state,{...migration,pendingWork:pendingWork.map((item,index)=>index===0?{...item,disposition:'transfer'}:item)},context),/named acceptance/);
  assert.throws(()=>act(state,{...migration,expectedEpisodeVersion:6,pendingWork},context),/episode work changed/);
  state=act(state,{...migration,pendingWork},context);
  assert.equal(state.protocolAssignments[0].protocolId,target.id);
  assert.deepEqual(state.protocolAssignments[0].revisions[0].record.protocolSnapshot,old);
  assert.deepEqual(state.protocolAssignments[0].protocolSnapshot.steps[0].transitions,steps[0].transitions);
  assert.throws(()=>act(state,{...migration,requestId:crypto.randomUUID(),pendingWork},context),/changed/);
  assert.throws(()=>createProtocol(initialState(),makeContext(),{steps:[{...old.steps[0],nextStepIds:[],transitions:[{toStepId:'unknown',when:eventPredicate}]}]}),/missing step targets/);
  assert.throws(()=>createProtocol(initialState(),makeContext(),{steps:[{...old.steps[0],nextStepIds:[],transitions:[{toStepId:'intake',when:{kind:'event',eventType:'x',code:'unsafe()'}}]}]}),/Unrecognized key/);
  const withoutChecks=createProtocol(initialState(),makeContext(),{publicationChecks:undefined});
  assert.throws(()=>publishProtocol(withoutChecks,withoutChecks.protocols[0].id),/Publication requires source version/);
});

test('monitoring finds overlap across records, requires applicable versioned rules, and exports the exact accepted snapshot',()=>{
  const ruleRef={id:'demo-payer-rule',version:'2026.1',payer:'Synthetic payer',jurisdiction:'Demo jurisdiction',effectiveFrom:'2026-09-01',effectiveTo:'2026-09-30',reviewer:'Named demo reviewer',evidenceRef:'synthetic://rule-review'};
  const record={serviceDate:'2026-09-17',activity:'Documented monitoring',source:'Recorded local activity',evidenceRef:'synthetic://activity',missingDocumentation:[],patientId:patients[0].id,performerId:'demo-performer',serviceCode:'DEMO-A',intervals:[{startAt:'2026-09-17T10:00:00Z',endAt:'2026-09-17T10:20:00Z',sourceEventId:'activity-a'}],ruleRef};
  let state=act(initialState(),{type:'program-governance.monitoring-record-service',requestId:crypto.randomUUID(),record});const firstId=state.monitoring[0].id;
  assert.equal(monitoringIntervalsOverlap(record.intervals[0],{...record.intervals[0],startAt:'2026-09-17T10:20:00Z',endAt:'2026-09-17T10:30:00Z'}),false);
  assert.throws(()=>act(state,{type:'program-governance.monitoring-record-service',requestId:crypto.randomUUID(),record:{...record,activity:'Different title, same source event'}}),/Duplicate source event/);
  state=act(state,{type:'program-governance.monitoring-record-service',requestId:crypto.randomUUID(),record:{...record,patientId:patients[1].id,serviceCode:'DEMO-B',intervals:[{startAt:'2026-09-17T10:10:00Z',endAt:'2026-09-17T10:25:00Z',sourceEventId:'activity-b'}]}});
  const current=()=>state.monitoring.find(item=>item.id===firstId);
  const decision=(value,findings)=>({type:'program-governance.monitoring-record-decision',requestId:crypto.randomUUID(),id:firstId,expectedVersion:current().version,decision:value,findings,reason:'Recorded named review of synthetic rule'});
  assert.throws(()=>act(state,decision('accept',[])),/every current documentation and overlap finding/);
  const findings=monitoringFindings(state,current());assert.equal(findings.length,1);
  state=act(state,decision('clarify',findings));assert.equal(current().status,'reported');
  assert.throws(()=>act(state,decision('accept',findings)),/Resolve every documentation/);
  state=act(state,decision('accept',findings.map(item=>({...item,disposition:'resolved',evidenceRef:'synthetic://qualified-overlap-review'}))));
  const accepted=structuredClone(current());
  state=act(state,{type:'program-governance.monitoring-export',requestId:crypto.randomUUID(),id:firstId,expectedVersion:accepted.version,evidenceRef:'synthetic://authorized-demo-package'});
  assert.equal(current().exportRecords[0].snapshot.ruleRef.version,'2026.1');
  assert.deepEqual(current().exportRecords[0].snapshot.intervals,accepted.intervals);
  let expired=act(initialState(),{type:'program-governance.monitoring-record-service',requestId:crypto.randomUUID(),record:{...record,ruleRef:{...ruleRef,effectiveTo:'2026-09-16'}}});
  assert.throws(()=>act(expired,{...decision('accept',[]),id:expired.monitoring[0].id,expectedVersion:1}),/not applicable to the service period/);
  assert.throws(()=>act(initialState(),{type:'program-governance.monitoring-record-service',requestId:crypto.randomUUID(),record:{...record,intervals:[{...record.intervals[0],endAt:record.intervals[0].startAt}]}}),/positive duration/);
});

test('successful restore reports cannot close until every manifest event and coverage obligation is reconciled',()=>{
  let state=act(initialState(),{type:'program-governance.operation-report',requestId:crypto.randomUUID(),record:{title:'Synthetic restore exercise',kind:'restore-proof',affectedServices:['local-test-events'],owner:'Operations reviewer',severity:'high',actionsTaken:['Inspected synthetic event journal'],evidenceRef:'synthetic://restore',restoreOutcome:'reported-success'}});
  const id=state.operations[0].id;
  const base=()=>({requestId:crypto.randomUUID(),id,expectedVersion:state.operations[0].version});
  state=act(state,{type:'program-governance.operation-confirm',...base(),owner:'Operations reviewer',severity:'high',reason:'Confirmed local fixture'});
  state=act(state,{type:'program-governance.operation-review',...base(),evidenceRef:'synthetic://review',reason:'Reviewed local fixture'});
  const close=()=>({type:'program-governance.operation-close',...base(),evidenceRef:'synthetic://close',reason:'Accounted for all local events'});
  assert.throws(()=>act(state,close()),/expected-event manifest/);
  const ledger={expectedEventManifestRef:'synthetic://manifest',reconciliationEvidence:'synthetic://ledger',reviewer:'Operations reviewer',events:[{eventId:'event-1',service:'local-test-events',owner:'Event owner',status:'missing',sourceReceipt:'',evidenceRef:''}],coverage:[{obligationId:'follow-up-1',owner:'Receiving coordinator',acceptedBy:'',evidenceRef:''}],correctiveActions:['Replayed local missing event'],remainingRisks:['External restore unverified']};
  const reconcile=record=>({type:'program-governance.operation-reconcile',...base(),record,reason:'Reviewed expected local event inventory'});
  state=act(state,reconcile(ledger));
  assert.throws(()=>act(state,close()),/Missing downstream events/);
  assert.throws(()=>act(state,reconcile({...ledger,events:[]})),/cannot be removed/);
  assert.throws(()=>act(state,reconcile({...ledger,events:[{...ledger.events[0],status:'replayed',evidenceRef:'synthetic://replay'}]})),/receipt references/);
  const replayed={...ledger,events:[{...ledger.events[0],status:'replayed',sourceReceipt:'synthetic://receipt-1',evidenceRef:'synthetic://replay'}]};
  const replayCommand=reconcile(replayed);state=act(state,replayCommand);assert.deepEqual(act(state,replayCommand),state);
  assert.throws(()=>act(state,close()),/named owner acceptance/);
  state=act(state,reconcile({...replayed,coverage:[{...ledger.coverage[0],acceptedBy:'Receiving coordinator',evidenceRef:'synthetic://accepted'}]}));
  state=act(state,close());assert.equal(state.operations[0].status,'closed');
  assert.throws(()=>act(state,reconcile(replayed)),/immutable/);
});

test('governance showcase records a demo-scoped artifact once, preserves flags and active configuration, and respects later edits',()=>{
  const source=seedWorkspace(),original=structuredClone(source),context=makeContext();
  const seeded=ensureGovernanceShowcase(source,context.actor,context.now),state=seeded.clinicalWorkflows.slices['program-governance'].state;
  assert.deepEqual(source,original);
  assert.deepEqual(seeded.features,source.features);
  assert.equal(state.releases[0].modelId,engineVersion);
  assert.equal(state.releases[0].softwareId,engineVersion);
  assert.equal(state.readiness[0].scope.environment,'demo');
  const request={capability:'digitalTwin',populationRef:'workspace-patient-records',role:'workspace-owner',environment:'demo'};
  assert.equal(evaluateRuntimeUse(state,request,{...context,features:seeded.features}).allowed,true);
  assert.deepEqual(ensureGovernanceShowcase(seeded,context.actor,context.now),seeded);
  const modified=structuredClone(seeded),current=modified.clinicalWorkflows.slices['program-governance'].state.releases[0];
  const {title,modelId,softwareId,configurationId,intendedUse,evidenceRefIds,modelClaims,evaluation,unresolvedConditions,overrideTrainingPolicy}=current;
  modified.clinicalWorkflows.slices['program-governance'].state=act(state,{type:'program-governance.release-save-draft',requestId:crypto.randomUUID(),id:current.id,expectedVersion:current.version,record:{title:title+' user revision',modelId,softwareId,configurationId,intendedUse,evidenceRefIds,modelClaims,evaluation,unresolvedConditions:[...unresolvedConditions,'User review required'],overrideTrainingPolicy}});
  assert.deepEqual(ensureGovernanceShowcase(modified,context.actor,context.now),modified);
  const disabled=seedWorkspace();disabled.features.digitalTwin=false;
  const disabledSeeded=ensureGovernanceShowcase(disabled,context.actor,context.now);
  assert.equal(disabledSeeded.features.digitalTwin,false);
  assert.equal(evaluateRuntimeUse(disabledSeeded.clinicalWorkflows.slices['program-governance'].state,request,{...context,features:disabledSeeded.features}).allowed,false);
  let userConfiguration=createConfiguration();userConfiguration=reviewConfiguration(userConfiguration,userConfiguration.configurations[0].id,1);userConfiguration=activateConfiguration(userConfiguration,userConfiguration.configurations[0].id,2);
  const preconfigured=structuredClone(seeded);preconfigured.clinicalWorkflows.slices['program-governance'].state=userConfiguration;
  const after=ensureGovernanceShowcase(preconfigured,context.actor,context.now).clinicalWorkflows.slices['program-governance'].state;
  assert.deepEqual(after.configurations,userConfiguration.configurations);
  assert.equal(after.activeConfigurationId,userConfiguration.activeConfigurationId);
  assert.deepEqual(after.readiness[0].scope.capabilities,userConfiguration.configurations[0].capabilityChoices);
});
