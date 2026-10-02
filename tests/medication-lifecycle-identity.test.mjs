import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

const bundle=await build({stdin:{contents:"export {seedWorkspace} from './lib/theranetrix';export {applyAction,actionSchema} from './lib/actions';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {seedWorkspace,applyAction,actionSchema}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const now='2026-09-24T14:00:00Z',actor='Original clinician',patientId='TN-1042';
const base={type:'treatment-continuity.update-lifecycle',id:'identity-review-lifecycle',patientId,encounterId:'identity-review-encounter',owner:actor,dueDate:'2026-09-30',reason:'Record the reviewed source evidence.',medicationName:'Original medicine',manualSource:'Outside prescribing and pharmacy records',evidenceRef:'Dated original order',safetyPrerequisites:['Checks complete'],reviewPrerequisites:['Current list reviewed'],prescriberResponsibility:actor,clinicalServiceAvailable:true};
const originalOrder={orderId:'original-order',regimen:'100 mg once daily',regimenVersion:1,prescriber:actor,authority:'manual-attestation',authorizationRef:'Original signed order',authorizedAt:'2026-09-20T09:00:00Z',pharmacyReceipt:'Original pharmacy receipt',pharmacyReceivedAt:'2026-09-21T09:00:00Z',dispensingRef:'Original dispensing record',dispensedAt:'2026-09-22T09:00:00Z',actualUse:'started',useReportedAt:now,useSource:'Patient report',startedAt:'2026-09-23',followUpDaysAfterStart:7};
const lifecycle=(workspace,id=base.id)=>workspace.clinicalWorkflows.slices['treatment-continuity'].state.lifecycles.find(record=>record.id===id);
function save(workspace,stage,fields={}){
  const slice=workspace.clinicalWorkflows.slices['treatment-continuity'],id=fields.id??base.id;
  const previous=lifecycle(workspace,id),requestId=crypto.randomUUID();
  const command={...base,stage,requestId,orderEvidence:originalOrder,...(previous?{expectedVersion:previous.version}:{}),...fields};
  return applyAction(workspace,actionSchema.parse({type:'workflow.apply',domain:'treatment-continuity',patientId,requestId,expectedSliceVersion:slice.version,command}),actor,now);
}
function continued(){
  let workspace=seedWorkspace();
  for(const stage of ['considered','clinician-review','authorization-recorded','external-transmission-reported','pharmacy-received','dispensing-reported','started-reported','response-reviewed','continued'])workspace=save(workspace,stage);
  return workspace;
}

test('linked medication and order identities cannot inherit a continued lifecycle or its completed work',()=>{
  const workspace=continued(),before=structuredClone(workspace),record=lifecycle(workspace);
  const tasks=workspace.tasks.filter(task=>task.workflowRecordId===record.id);
  assert.equal(tasks.length,2);assert.ok(tasks.every(task=>task.done));
  for(const fields of [
    {medicationName:'Different medicine'},
    {medicationName:'Different medicine',orderEvidence:undefined},
    {orderEvidence:{...originalOrder,orderId:'different-order'}},
    {medicationName:'Different medicine',orderEvidence:{...originalOrder,orderId:'different-order'}},
    {medicationName:'Different medicine',orderEvidence:{...originalOrder,orderId:'different-order',regimenVersion:2,authorizationRef:'New authorization'}},
  ]){
    assert.throws(()=>save(workspace,'continued',fields),/Create a new medication lifecycle/);
    assert.deepEqual(workspace,before,'Rejected replacement must preserve source history, task completion, notes, and receipts.');
  }
  const updated=save(workspace,'continued',{medicationName:'  Original medicine  ',orderEvidence:{...originalOrder,orderId:'  original-order  '},statusNote:'The same exact order remains in use.'});
  assert.equal(lifecycle(updated).medicationName,base.medicationName);
  assert.equal(lifecycle(updated).orderEvidence.orderId,originalOrder.orderId);
  assert.deepEqual(lifecycle(updated).history.slice(1),record.history);
});

test('replacement medication starts a separate lifecycle without transferring prior exposure or completed work',()=>{
  const workspace=continued(),original=structuredClone(lifecycle(workspace));
  const replacement={orderId:'replacement-order',regimen:'25 mg once daily',regimenVersion:1,prescriber:actor,authority:'manual-attestation',actualUse:'unknown',useReportedAt:now,useSource:'Actual use has not been reported'};
  const updated=save(workspace,'considered',{id:'replacement-lifecycle',medicationName:'Different medicine',orderEvidence:replacement});
  assert.deepEqual(lifecycle(updated),original);
  const record=lifecycle(updated,'replacement-lifecycle');
  assert.equal(record.stage,'considered');assert.equal(record.version,1);
  assert.equal(record.orderEvidence.actualUse,'unknown');
  assert.equal(record.orderEvidence.authorizationRef,undefined);assert.equal(record.orderEvidence.startedAt,undefined);
  const tasks=updated.tasks.filter(task=>task.workflowRecordId===record.id);
  assert.equal(tasks.length,1);assert.equal(tasks[0].done,false);
  assert.ok(updated.tasks.filter(task=>task.workflowRecordId===original.id).every(task=>task.done));
});

test('the same medication and order can progress through an authorized new regimen version',()=>{
  const workspace=continued(),original=structuredClone(lifecycle(workspace));
  const order={orderId:originalOrder.orderId,regimen:'50 mg twice daily',regimenVersion:2,prescriber:actor,authority:'manual-attestation',authorizationRef:'Separately reviewed regimen authorization',authorizedAt:'2026-09-24T09:00:00Z',actualUse:'not-obtained',useReportedAt:now,useSource:'Patient has not obtained the revised regimen',followUpDaysAfterStart:7};
  assert.throws(()=>save(workspace,'changed',{orderEvidence:{...order,regimenVersion:1}}),/new regimen version/);
  assert.throws(()=>save(workspace,'changed',{orderEvidence:{...order,authorizationRef:originalOrder.authorizationRef}}),/separate authorization/);
  let updated=save(workspace,'changed',{orderEvidence:order});
  const firstNewHistory=lifecycle(updated).history[0];
  assert.equal(JSON.parse(firstNewHistory.previousSnapshot).orderEvidence.regimenVersion,1);
  updated=save(updated,'started-reported',{orderEvidence:{...order,pharmacyReceipt:'New pharmacy receipt',pharmacyReceivedAt:'2026-09-24T10:00:00Z',dispensingRef:'New dispensing record',dispensedAt:'2026-09-24T11:00:00Z',actualUse:'started',startedAt:'2026-09-24',useSource:'Patient confirmed the revised regimen start'}});
  const record=lifecycle(updated);
  assert.equal(record.medicationName,original.medicationName);assert.equal(record.orderEvidence.orderId,original.orderEvidence.orderId);
  assert.equal(record.orderEvidence.regimenVersion,2);assert.equal(record.stage,'started-reported');
  assert.deepEqual(record.history.slice(2),original.history);
  assert.ok(updated.tasks.filter(task=>task.workflowRecordId===record.id).every(task=>!task.done),'New regimen progress and response still require review.');
});
