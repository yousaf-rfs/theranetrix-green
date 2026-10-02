import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const compiled=await build({stdin:{contents:"export {seedWorkspace} from './lib/theranetrix';export {buildEngineOutput,engineVersion} from './lib/engine-demo';export {ensureGovernanceShowcase} from './lib/clinical-flows/governance-showcase';export {governedContext,requireGovernedUse} from './lib/clinical-flows/governance-runtime';export {projectGovernanceWork,governanceProjectionId} from './lib/clinical-flows/governance-bridges';export {applyWorkflowAction,workflowInputRevision} from './lib/clinical-flows';export {validateState as validateDecisions} from './lib/clinical-flows/decisions';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',write:false});
const mod={exports:{}};
new Function('require','module','exports',compiled.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {seedWorkspace,buildEngineOutput,engineVersion,ensureGovernanceShowcase,governedContext,requireGovernedUse,projectGovernanceWork,governanceProjectionId,applyWorkflowAction,workflowInputRevision,validateDecisions}=mod.exports;
const now='2026-09-17T14:45:00Z',actor='Local program reviewer';
const fixture=()=>ensureGovernanceShowcase(seedWorkspace(),actor,now);
const governance=workspace=>workspace.clinicalWorkflows.slices['program-governance'].state;
function apply(workspace,domain,command){
  const requestId=crypto.randomUUID();
  const next=applyWorkflowAction(workspace,{type:'workflow.apply',domain,requestId,expectedSliceVersion:workspace.clinicalWorkflows.slices[domain].version,...(domain!=='program-governance'?{patientId:command.patientId}:{}),command:{...command,requestId}},actor,now);
  return projectGovernanceWork(next,{actor,now});
}
const program=(workspace,type,fields)=>apply(workspace,'program-governance',{type:`program-governance.${type}`,...fields});
const evidence='local-demo://connection-review';
function addRun(workspace,id='governed-run-1'){
  const data=structuredClone(workspace),patient=data.patients[0];
  const releaseRef=requireGovernedUse(data,'digitalTwin',now);
  const run={...buildEngineOutput(patient,data),id,date:now,actor,releaseRef};
  data.engineRuns=[run,...(data.engineRuns??[])];
  return {workspace:data,run};
}
function captureRun(workspace,run){
  const patientId=run.patientId,encounterId='governed-review',patient=workspace.patients.find(item=>item.id===patientId);
  const inputVersion=workflowInputRevision(patient,workspace);
  return apply(workspace,'decisions',{type:'decisions.engine.capture',patientId,encounterId,inputVersion,runId:run.id,expectedComparisonVersion:0,expectedOutputsVersion:0});
}
function openRecall(workspace,ref){
  const release=governance(workspace).releases.find(item=>item.id===ref.releaseId);
  return program(workspace,'recall-open',{subject:{kind:'release',id:ref.releaseId,artifactVersion:ref.artifactVersion},expectedSubjectVersion:release.version,owner:'Recall owner',reason:'Recorded local recall review',evidenceRef:evidence});
}

test('trusted usage indexing follows saved run references and retains partial coverage for unstamped legacy outputs',()=>{
  const added=addRun(fixture());let workspace=captureRun(added.workspace,added.run);
  const original=structuredClone(workspace),context=governedContext(workspace);
  assert.equal(context.usageCoverage,'complete');
  assert.equal(context.governedUsages.length,3);
  assert.ok(context.governedUsages.every(usage=>usage.releaseRef.releaseId===added.run.releaseRef.releaseId));
  assert.deepEqual(workspace,original);
  const withoutRef={...added.run,id:'legacy-run-same-engine-label'};delete withoutRef.releaseRef;
  workspace.engineRuns.push(withoutRef);
  const legacy=governedContext(workspace);
  assert.equal(legacy.usageCoverage,'partial');
  assert.equal(legacy.governedUsages.find(usage=>usage.sourceId===withoutRef.id).releaseRef,undefined);
  assert.ok(legacy.usageCoverageIssues.some(issue=>issue.includes(withoutRef.id)));
  assert.equal(withoutRef.version,engineVersion);
});

test('signed snapshot evidence keeps both record identity and saved version rather than matching version strings alone',()=>{
  const added=addRun(fixture());let workspace=captureRun(added.workspace,added.run);
  const patient=workspace.patients[0],scope={patientId:patient.id,encounterId:'governed-review'},inputVersion=workflowInputRevision(patient,workspace);
  workspace=apply(workspace,'decisions',{type:'decisions.review.capture',...scope,expectedVersion:0,inputVersion,collectedAt:now,receivedAt:now,provenance:'synthetic',metrics:{pain:{prior:4,current:4},function:{prior:4,current:4},sleep:{prior:4,current:4}},contradictoryMetrics:[],clinicalInterpretation:'Local review record',goal:'Review the recorded goal',nextMonitoringQuestion:'Review the next dated observation'});
  const decisions=workspace.clinicalWorkflows.slices.decisions.state,support=governance(workspace).evidences[0];
  const comparison=structuredClone(decisions.comparisonSnapshots[0]),outputs=structuredClone(decisions.engineComparisons[0]);
  comparison.evidenceRefs=[{id:support.id,title:support.title,locator:evidence,version:String(support.version),reviewDate:now.slice(0,10)}];
  const signed={id:'signed-governed-review',...scope,inputVersion,version:1,createdAt:now,updatedAt:now,actor,disposition:'defer',rationale:'Named local review',patientPlanRef:'local-demo-plan',reviewedInput:{observedReview:structuredClone(decisions.observedReviews[0]),comparisonSnapshot:comparison,engineComparison:outputs},evidenceVersions:[String(support.version)],modelVersions:[],configurationVersions:[engineVersion],displayedOutputs:{summary:'Review saved sources',pstOutputId:outputs.pst.outputId,shadowOutputId:outputs.shadow.outputId},history:[]};
  decisions.signedSnapshots.push(signed);validateDecisions(decisions);
  const original=structuredClone(signed),context=governedContext(workspace),usage=context.governedUsages.find(item=>item.sourceId===signed.id);
  assert.deepEqual(usage.evidenceRefs,[{evidenceId:support.id,version:support.version}]);
  assert.deepEqual(usage.releaseRef,added.run.releaseRef);
  assert.deepEqual(signed,original);
  signed.reviewedInput.comparisonSnapshot.evidenceRefs[0].id='unrelated-external-source';
  const unlinked=governedContext(workspace);
  assert.equal(unlinked.usageCoverage,'partial');
  assert.deepEqual(unlinked.governedUsages.find(item=>item.sourceId===signed.id).evidenceRefs,[]);
});

test('recall projects one versioned task and review per patient, closes only disposed impacts, and preserves saved outputs',()=>{
  const added=addRun(fixture());let workspace=captureRun(added.workspace,added.run);
  const originalRun=structuredClone(workspace.engineRuns),originalDecisions=structuredClone(workspace.clinicalWorkflows.slices.decisions.state),plans=structuredClone(workspace.patients[0].carePlans),medications=structuredClone(workspace.patients[0].medications);
  workspace=openRecall(workspace,added.run.releaseRef);
  let recall=governance(workspace).recalls[0];
  assert.equal(recall.impacts.length,3);
  const tasks=()=>workspace.tasks.filter(item=>item.workflowDomain==='program-governance'&&item.workflowRecordId===recall.id);
  const reviews=()=>workspace.reviews.filter(item=>item.workflowRecordId===recall.id);
  assert.equal(tasks().length,1);assert.equal(reviews().length,1);
  assert.equal(tasks()[0].done,false);assert.equal(tasks()[0].date,'');
  assert.equal(reviews()[0].owner,'Recall owner');
  assert.strictEqual(projectGovernanceWork(workspace,{actor,now}),workspace);
  for(const impact of [...recall.impacts]){
    recall=governance(workspace).recalls[0];
    workspace=program(workspace,'recall-review-impact',{id:recall.id,expectedVersion:recall.version,impactId:impact.id,disposition:'reviewed-no-change',evidenceRef:evidence,reason:'Reviewed original output without changing the plan'});
  }
  recall=governance(workspace).recalls[0];
  workspace=program(workspace,'recall-review-coverage',{id:recall.id,expectedVersion:recall.version,evidenceRef:evidence,reason:'Checked exact saved output inventory'});
  recall=governance(workspace).recalls[0];
  workspace=program(workspace,'recall-close',{id:recall.id,expectedVersion:recall.version,evidenceRef:evidence,reason:'Every known affected output has a recorded review'});
  assert.equal(tasks()[0].done,true);assert.equal(reviews()[0].status,'Resolved');
  assert.ok(tasks()[0].history.some(item=>item.done===false));
  assert.ok(reviews()[0].history.some(item=>item.status==='Open'));
  assert.deepEqual(workspace.engineRuns,originalRun);
  assert.deepEqual(workspace.clinicalWorkflows.slices.decisions.state,originalDecisions);
  assert.deepEqual(workspace.patients[0].carePlans,plans);assert.deepEqual(workspace.patients[0].medications,medications);
  assert.throws(()=>requireGovernedUse(workspace,'digitalTwin',now,added.run.releaseRef),/recall|review|artifact/i);
});

test('a reviewed replacement can generate new outputs without silently adopting an old recalled run',()=>{
  const added=addRun(fixture());let workspace=openRecall(added.workspace,added.run.releaseRef);
  const original=structuredClone(added.run),source=governance(workspace).releases[0];
  const {modelId,softwareId,configurationId,intendedUse,evidenceRefIds,modelClaims,evaluation,overrideTrainingPolicy}=source;
  workspace=program(workspace,'release-save-draft',{record:{title:'Reviewed replacement demonstration artifact',modelId,softwareId,configurationId,intendedUse,evidenceRefIds,modelClaims,evaluation,overrideTrainingPolicy,unresolvedConditions:[]}});
  let release=governance(workspace).releases[0];
  workspace=program(workspace,'release-record-review',{id:release.id,expectedVersion:release.version,reviewer:actor,decision:'approved',unresolvedConditions:[],reason:'Recorded replacement artifact review'});
  release=governance(workspace).releases[0];
  const prior=governance(workspace).readiness[0],{functions,claims,partnerAssets,partnerRights,partnerResponsibilities,mandatoryGates,scope}=prior;
  workspace=program(workspace,'readiness-save-draft',{record:{title:'Reviewed replacement demonstration scope',functions,claims,partnerAssets,partnerRights,partnerResponsibilities,mandatoryGates,scope,evidenceRefIds,blockingConditions:[],releaseRef:{releaseId:release.id,artifactVersion:release.artifactVersion}}});
  const ready=governance(workspace).readiness[0];
  workspace=program(workspace,'readiness-record-decision',{id:ready.id,expectedVersion:ready.version,reviewer:actor,decision:'proposed',blockingConditions:[],mandatoryGates,reviewEvidence:evidence,reason:'Recorded exact replacement scope review'});
  assert.equal(requireGovernedUse(workspace,'digitalTwin',now).releaseId,release.id);
  assert.throws(()=>requireGovernedUse(workspace,'digitalTwin',now,added.run.releaseRef),/review|recall|artifact/i);
  assert.throws(()=>requireGovernedUse(workspace,'digitalTwin',now,undefined),/no exact release reference/);
  assert.deepEqual(workspace.engineRuns[0],original);
  workspace.features.digitalTwin=false;
  assert.throws(()=>requireGovernedUse(workspace,'digitalTwin',now),/disabled|dependencies/i);
});

function protocol(workspace,title,steps){
  return program(workspace,'protocol-save-draft',{record:{title,owner:actor,evidenceLocator:evidence,unresolvedQuestions:[],steps,publicationChecks:{sourceVersion:'operational-1',rightsEvidence:evidence,clinicalReview:evidence,implementationReview:evidence,fixtureEvidence:evidence,migrationPolicy:'Explicit accounting of open work',rollbackPlan:'Preserve prior published episode'}}});
}
function publish(workspace,id){
  for(const [type,fields] of [['protocol-request-review',{reason:'Recorded operational review'}],['protocol-record-review',{outcome:'reviewed',reviewer:actor,evidenceLocator:evidence,reason:'Named review recorded'}],['protocol-record-publication',{evidenceRef:evidence,reason:'Publish the reviewed operational version'}]])workspace=program(workspace,type,{id,expectedVersion:governance(workspace).protocols.find(item=>item.id===id).version,...fields});
  return workspace;
}
const step=(id,title,prerequisites=[])=>({id,title,owner:actor,kind:'action',prerequisites,nextStepIds:[],branchStepIds:[],openQuestion:''});
test('published assignment projection preserves stage progress and explicitly archives/migrates prior open work',()=>{
  let workspace=protocol(fixture(),'Operational follow-up',[step('review','Review dated sources'),step('follow-up','Record the next owner',['review'])]);
  const protocolId=governance(workspace).protocols[0].id;
  workspace=publish(workspace,protocolId);
  workspace=program(workspace,'protocol-assign-episode',{patientId:workspace.patients[0].id,encounterId:'operational-episode',protocolId,expectedProtocolVersion:governance(workspace).protocols[0].version,expectedAssignmentVersion:0,reason:'Assign the reviewed operational version'});
  const assignment=structuredClone(governance(workspace).protocolAssignments[0]);
  const coordination=()=>workspace.clinicalWorkflows.slices['patient-coordination'];
  let pathway=coordination().state.pathways.find(item=>item.protocolAssignmentId===assignment.id);
  assert.ok(pathway);assert.equal(pathway.stages[0].dueDate,'');
  assert.equal(workspace.tasks.filter(item=>item.workflowRecordId===pathway.id).length,2);
  const initialSlice=coordination().version;
  workspace=apply(workspace,'patient-coordination',{type:'patient-coordination.pathway.save',id:pathway.id,expectedVersion:pathway.version,patientId:pathway.patientId,encounterId:pathway.encounterId,protocolAssignmentId:assignment.id,protocolAssignmentVersion:assignment.version,pathwayKey:pathway.pathwayKey,pathwayVersion:pathway.pathwayVersion,currentVersion:true,stages:pathway.stages.map((stage,index)=>index===0?{...stage,status:'completed'}:stage),eventId:'operational-review-completed',transitionReason:'Recorded source review completion'});
  pathway=coordination().state.pathways.find(item=>item.id===pathway.id);
  assert.equal(pathway.stages[0].status,'completed');assert.equal(coordination().version,initialSlice+1);
  assert.equal(workspace.tasks.find(item=>item.id===governanceProjectionId('protocol-task',pathway.id,'review')).done,true);
  assert.strictEqual(projectGovernanceWork(workspace,{actor,now}),workspace);
  const before=structuredClone(pathway),nextSteps=[step('review-2','Reviewed source record'),{...step('follow-up-2','Accepted follow-up owner',['review-2']),schedule:{dueAfterDays:2,channel:'manual',reviewEvidence:evidence}}];
  workspace=protocol(workspace,'Revised operational follow-up',nextSteps);
  const targetId=governance(workspace).protocols[0].id;
  assert.deepEqual(coordination().state.pathways.find(item=>item.id===before.id),before);
  workspace=publish(workspace,targetId);
  const beforeMigration=coordination().version;
  workspace=program(workspace,'protocol-migrate-episode',{id:assignment.id,expectedVersion:assignment.version,expectedEpisodeVersion:before.version,targetProtocolId:targetId,expectedProtocolVersion:governance(workspace).protocols[0].version,stageMap:[{oldStepId:'review',newStepId:'review-2',carryStatus:true},{oldStepId:'follow-up',newStepId:'follow-up-2',carryStatus:false}],pendingWork:[{oldStepId:'follow-up',disposition:'transfer',owner:'Receiving owner',acceptedBy:'Receiving owner',evidenceRef:evidence}],reason:'Reviewed migration and accepted remaining work',evidenceRef:evidence});
  const archived=coordination().state.pathways.find(item=>item.id===before.id),current=coordination().state.pathways.find(item=>item.protocolAssignmentId===assignment.id&&item.currentVersion);
  assert.equal(archived.currentVersion,false);assert.deepEqual(archived.stages,before.stages);
  assert.notEqual(current.id,archived.id);assert.equal(current.stages[0].status,'completed');
  assert.equal(current.stages[1].status,'pending');assert.equal(current.stages[1].owner,'Receiving owner');assert.equal(current.stages[1].dueDate,'2026-09-19');
  assert.equal(coordination().version,beforeMigration+1);
  assert.ok(workspace.tasks.filter(item=>item.workflowRecordId===archived.id).every(item=>item.done));
  assert.equal(workspace.tasks.find(item=>item.id===governanceProjectionId('protocol-task',current.id,'follow-up-2')).done,false);
  assert.strictEqual(projectGovernanceWork(workspace,{actor,now}),workspace);
  const corrupt=structuredClone(workspace),currentPath=corrupt.clinicalWorkflows.slices['patient-coordination'].state.pathways.find(item=>item.id===current.id);
  currentPath.stages[1].title='Unreviewed replacement instruction';
  assert.throws(()=>projectGovernanceWork(corrupt,{actor,now}),/differs from its published graph/);
});
