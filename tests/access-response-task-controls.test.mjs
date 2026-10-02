import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

const bundle=await build({stdin:{contents:"export {seedWorkspace} from './lib/theranetrix'; export {applyAction} from './lib/actions'; export {projectTreatmentWork,treatmentBridgeId} from './lib/clinical-flows/treatment-bridges'; export {taskWorkflow,taskWorkflowDestination} from './lib/task-controls';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {seedWorkspace,applyAction,projectTreatmentWork,treatmentBridgeId,taskWorkflow,taskWorkflowDestination}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const patientId='TN-1042',actor='Care coordinator',now='2026-09-24T14:00:00Z',completedAt='2026-09-27T10:00:00Z';
const domain='treatment-continuity',guardError=/linked clinical workflow/;
const state=workspace=>workspace.clinicalWorkflows.slices[domain].state;
const task=(workspace,kind,recordId,key)=>workspace.tasks.find(item=>item.id===treatmentBridgeId('task',patientId,kind,recordId,key));
function save(workspace,fields,at=now){
  const requestId=crypto.randomUUID();
  const command={patientId,encounterId:'access-followup-visit',owner:actor,dueDate:'2026-09-25',reason:'Recorded the source and agreed next step.',requestId,...fields};
  return applyAction(workspace,{type:'workflow.apply',domain,patientId,requestId,expectedSliceVersion:workspace.clinicalWorkflows.slices[domain].version,command},actor,at);
}
const evidence={source:'Patient telephone report',author:'Patient',collectedAt:null,receivedAt:now,reference:'Dated conversation note'};
const accessReview={careAction:{domain,id:'reviewed-care',version:1},verification:'confirmed',source:'Service coordinator',checkedAt:now,details:'Service confirmed coverage.',alternativeDecision:'none',patientAgreement:'agreed',actualStart:'started',actualStartAt:'2026-09-20',actualStartSource:'Patient confirmed first attendance.',followUpDaysAfterStart:7};
const access={type:'treatment-continuity.manage-access',id:'access-start',barrierType:'coverage',status:'resolved',patientChoice:'Patient agreed to attend.',outreach:'Coordinator confirmed availability.',requiresClinicianReview:false,resolution:'Access confirmed.',accessReview};
function accessWorkspace(review=accessReview){
  let workspace=save(seedWorkspace(),{type:'treatment-continuity.record-reconciliation',id:'reviewed-care',source:'Outside medication list',sourceDate:'2026-09-23',status:'unreviewed',conflicts:[{field:'Current use',patientFact:'Stopped taking it',externalFact:'Listed as active',outcome:'unreviewed'}],provenance:{patient:evidence,external:{...evidence,source:'Hospital medication list',author:'Discharge pharmacist'},nextAction:'Confirm current use with the prescriber.'}});
  return save(workspace,{...access,accessReview:review});
}
function assertLocked(workspace,target){
  const before=structuredClone(workspace);
  assert.equal(taskWorkflow(workspace,target),domain);
  assert.throws(()=>applyAction(workspace,{type:'task.toggle',id:target.id,done:!target.done},actor,completedAt),guardError);
  assert.deepEqual(workspace,before);
}

test('the exact actual-start access follow-up can be completed through the action handler and keeps its source navigation',()=>{
  const workspace=accessWorkspace(),before=structuredClone(workspace),response=task(workspace,'access','access-start','response');
  assert.equal(response.date,'2026-09-27');assert.equal(response.done,false);
  assert.equal(taskWorkflow(workspace,response),undefined);
  assert.equal(taskWorkflowDestination(workspace,response),domain);
  const completed=applyAction(workspace,{type:'task.toggle',id:response.id,done:true},actor,completedAt);
  const saved=task(completed,'access','access-start','response');
  assert.equal(saved.done,true);assert.equal(saved.history[0].done,false);
  assert.equal(saved.history[0].changedBy,actor);assert.equal(saved.history[0].changedAt,completedAt);
  assert.equal(taskWorkflowDestination(completed,saved),domain);
  assert.deepEqual(state(completed),state(workspace));
  assert.deepEqual(completed.patients.find(patient=>patient.id==='TN-1038'),workspace.patients.find(patient=>patient.id==='TN-1038'));
  assert.deepEqual(workspace,before);
});

test('derived access barrier, start-confirmation and medication response milestones remain source controlled',()=>{
  let workspace=accessWorkspace();
  for(const key of ['access','start'])assertLocked(workspace,task(workspace,'access','access-start',key));
  const orderEvidence={orderId:'outside-order',regimen:'Exact regimen from the reviewed order',regimenVersion:1,prescriber:'Dr. Maya Chen',authority:'manual-attestation',authorizationRef:'Signed outside order',authorizedAt:'2026-09-20T09:00:00Z',pharmacyReceipt:'Pharmacy confirmed receipt',pharmacyReceivedAt:'2026-09-21T09:00:00Z',dispensingRef:'Pharmacy collection record',dispensedAt:'2026-09-22T09:00:00Z',actualUse:'not-obtained',useReportedAt:now,useSource:'Patient report',followUpDaysAfterStart:7};
  const lifecycle={type:'treatment-continuity.update-lifecycle',id:'medication-order',medicationName:'Recorded medication',manualSource:'Outside prescribing and pharmacy records',evidenceRef:'Dated order and collection records',safetyPrerequisites:['Required checks reviewed'],reviewPrerequisites:['Current use reviewed'],prescriberResponsibility:'Dr. Maya Chen',clinicalServiceAvailable:true,statusNote:'Reviewed documented milestones.',renewalRequested:false,failureReason:'',notStartedReason:'',orderEvidence};
  for(const stage of ['considered','clinician-review','authorization-recorded','external-transmission-reported','pharmacy-received','dispensing-reported','started-reported']){
    const existing=state(workspace).lifecycles.find(record=>record.id===lifecycle.id);
    workspace=save(workspace,{...lifecycle,stage,...(existing?{expectedVersion:existing.version}:{}),orderEvidence:stage==='started-reported'?{...orderEvidence,actualUse:'started',startedAt:'2026-09-23'}:orderEvidence});
  }
  const response=task(workspace,'lifecycle','medication-order','response');
  assert.equal(response.done,false);assert.equal(response.date,'2026-09-30');
  assertLocked(workspace,response);
});

test('fabricated IDs, wrong patients, missing sources, stale versions and withdrawn tasks cannot use the access follow-up exception',()=>{
  const source=accessWorkspace();
  const changes=[
    target=>{target.id+='-fabricated';},
    target=>{target.patientId='TN-1038';},
    target=>{target.workflowRecordId='unrecorded-access';},
    target=>{target.workflowVersion=0;},
    target=>{target.workflowDisposition='deferred';},
  ];
  for(const change of changes){
    const workspace=structuredClone(source),response=task(workspace,'access','access-start','response');
    change(response);assertLocked(workspace,response);
  }
});

test('a source without actual-start evidence or an agreed review interval cannot authorize a copied follow-up task',()=>{
  const original=task(accessWorkspace(),'access','access-start','response');
  const noStart={...accessReview,actualStart:'not-started'};delete noStart.actualStartAt;
  const noInterval={...accessReview};delete noInterval.followUpDaysAfterStart;
  for(const review of [noStart,noInterval]){
    const workspace=accessWorkspace(review);
    assert.equal(task(workspace,'access','access-start','response'),undefined);
    const copied=structuredClone(original);workspace.tasks.push(copied);
    assertLocked(workspace,copied);
  }
  const corrupt=accessWorkspace(),response=task(corrupt,'access','access-start','response');
  state(corrupt).accessBarriers[0].history=[];
  assert.equal(taskWorkflow(corrupt,response),domain);
  assert.throws(()=>applyAction(corrupt,{type:'task.toggle',id:response.id,done:true},actor,completedAt));
});

test('manual access review completion survives an unrelated source update and bridge replay',()=>{
  let workspace=accessWorkspace();
  const response=task(workspace,'access','access-start','response');
  workspace=applyAction(workspace,{type:'task.toggle',id:response.id,done:true},actor,completedAt);
  const completion=structuredClone(task(workspace,'access','access-start','response'));
  workspace=save(workspace,{...access,expectedVersion:1,accessReview:{...accessReview,actualStartSource:'Patient repeated the same attendance date.'}},'2026-09-28T10:00:00Z');
  const updated=task(workspace,'access','access-start','response');
  assert.equal(updated.done,true);assert.equal(updated.workflowVersion,2);
  assert.deepEqual(updated.history[1],completion.history[0]);
  assert.equal(taskWorkflow(workspace,updated),undefined);
  assert.equal(taskWorkflowDestination(workspace,updated),domain);
  assert.deepEqual(projectTreatmentWork(workspace,{actor:'Later reviewer',now:'2026-09-29T10:00:00Z'}),workspace);
});
