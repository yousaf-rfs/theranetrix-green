import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

const bundle=await build({stdin:{contents:"export {seedWorkspace} from './lib/theranetrix'; export {applyAction} from './lib/actions'; export {taskWorkflow} from './lib/task-controls'; export {projectTreatmentWork} from './lib/clinical-flows/treatment-bridges'; export {projectAcceptedWorkAssignments} from './lib/clinical-flows/accepted-work-assignments'; export {isReferralOverdue} from './lib/clinical-flows/results-referrals';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {seedWorkspace,applyAction,taskWorkflow,projectTreatmentWork,projectAcceptedWorkAssignments,isReferralOverdue}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const patientId='TN-1042',actor='Original clinician',receiver='Receiving clinician',now='2026-09-24T14:00:00Z',domain='treatment-continuity';
const treatment=w=>w.clinicalWorkflows.slices[domain].state;
const results=w=>w.clinicalWorkflows.slices['results-referrals'].state;
const sourceTasks=(w,id)=>w.tasks.filter(task=>task.patientId===patientId&&task.workflowRecordId===id);
function save(workspace,workflow,fields,at=now){
  const requestId=crypto.randomUUID(),command={patientId,requestId,...fields};
  return applyAction(workspace,{type:'workflow.apply',domain:workflow,patientId,requestId,expectedSliceVersion:workspace.clinicalWorkflows.slices[workflow].version,command},actor,at);
}
const careFields={encounterId:'assignment-review',owner:actor,dueDate:'2026-09-30',reason:'Record the current source and its next step.'};
const evidence={source:'Patient report',author:actor,collectedAt:null,receivedAt:now,reference:'Dated conversation'};
const reconciliation={...careFields,type:'treatment-continuity.record-reconciliation',id:'assignment-source',source:'Outside medication list',sourceDate:'2026-09-23',status:'unreviewed',conflicts:[{field:'Use',patientFact:'Stopped',externalFact:'Active',outcome:'unreviewed'}],provenance:{patient:evidence,external:evidence,nextAction:'Confirm the current list.'}};
function completeTransfer(workspace,id,references){
  const fields={...careFields,type:'treatment-continuity.record-transition',id,externalCareSource:'Hospital',previousInstructions:'Previous instructions retained.',newInstructions:'Receiving team follows pending work.',pendingWork:references.map((_,index)=>'Pending item '+index),resolvedPendingWork:[],receivingClinician:receiver,ownershipAccepted:true,reconciledInstructions:'Current instructions reconciled.',patientCommunication:'Patient understands the next step.',handoverEvidence:{source:evidence,patientAccount:'Patient describes the plan.',backupOwner:'Backup clinician',acceptance:'accepted',acceptedBy:receiver,acceptedAt:now,acceptanceEvidence:'Receiving clinician accepted by telephone.',teachBack:'Patient repeated the plan.',pendingTransfers:references.map((ref,index)=>({title:'Pending item '+index,ref,disposition:'accepted-transfer',owner:receiver,backupOwner:'Backup clinician',acceptedAt:now,evidenceRef:'Accepted responsibility for item '+index})),timezone:'UTC'}};
  for(const handoverStatus of ['draft','ownership-pending','instructions-reconciled','patient-communicated','completed']){
    const prior=treatment(workspace).transitions.find(record=>record.id===id);
    workspace=save(workspace,domain,{...fields,handoverStatus,...(prior?{expectedVersion:prior.version}:{})});
  }
  return {workspace,fields};
}

test('withdrawing actual start or its review interval retires the old response task and preserves its history',()=>{
  for(const withdrawal of ['start','interval']){
    let workspace=save(seedWorkspace(),domain,reconciliation);
    const accessReview={careAction:{domain,id:reconciliation.id,version:1},verification:'confirmed',source:'Service coordinator',checkedAt:now,details:'Access confirmed.',alternativeDecision:'none',patientAgreement:'agreed',actualStart:'started',actualStartAt:'2026-09-23',actualStartSource:'Patient confirmed attendance.',followUpDaysAfterStart:7};
    const access={...careFields,type:'treatment-continuity.manage-access',id:'withdrawn-response',barrierType:'coverage',status:'resolved',patientChoice:'Patient agreed to attend.',outreach:'Confirmed with service.',requiresClinicianReview:false,resolution:'Access confirmed.',accessReview};
    workspace=save(workspace,domain,access);
    const original=structuredClone(sourceTasks(workspace,access.id).find(task=>task.title==='Review care after the actual start'));
    const corrected={...accessReview};
    if(withdrawal==='start'){corrected.actualStart='not-started';delete corrected.actualStartAt;}else delete corrected.followUpDaysAfterStart;
    workspace=save(workspace,domain,{...access,expectedVersion:1,reason:'Correct the source report.',accessReview:corrected});
    const retired=workspace.tasks.find(task=>task.id===original.id);
    assert.equal(retired.done,true);assert.equal(retired.workflowDisposition,'deferred');assert.equal(retired.workflowVersion,2);
    assert.equal(retired.history[0].done,false);assert.equal(retired.history[0].workflowVersion,1);assert.equal(retired.history[0].changedBy,actor);
    assert.equal(taskWorkflow(workspace,retired),domain);
    assert.deepEqual(projectTreatmentWork(workspace,{actor,now}),workspace);
    workspace=save(workspace,domain,{...access,expectedVersion:2,reason:'Patient reconfirmed the start and agreed review.'});
    const restored=workspace.tasks.find(task=>task.id===original.id);
    assert.equal(restored.done,false);assert.equal(restored.workflowDisposition,'pending');assert.equal(restored.workflowVersion,3);
    assert.equal(restored.history[0].workflowDisposition,'deferred');assert.equal(restored.history[1].done,false);
    assert.equal(taskWorkflow(workspace,restored),undefined);
  }
});

test('accepted responsibility reaches all six treatment source kinds and survives routine source updates',()=>{
  const sources=[
    {...reconciliation,id:'assigned-reconciliation'},
    {...careFields,type:'treatment-continuity.record-experience',id:'assigned-experience',medicationName:'Recorded medicine',reportedUse:'unknown',regimen:'Recorded regimen',regimenDurationDays:null,reportedBenefit:'unknown',tolerability:'unknown',functionalGoal:'Walk to the shop',trialStatus:'active',reassessmentDecision:'defer'},
    {...careFields,type:'treatment-continuity.update-lifecycle',id:'assigned-lifecycle',medicationName:'Recorded medicine',stage:'considered',safetyPrerequisites:[],reviewPrerequisites:[],prescriberResponsibility:actor,clinicalServiceAvailable:true},
    {...careFields,type:'treatment-continuity.manage-access',id:'assigned-access',barrierType:'coverage',status:'unresolved',patientChoice:'Wants an affordable option.',outreach:'Service contacted.',requiresClinicianReview:false},
    {...careFields,type:'treatment-continuity.record-transition',id:'assigned-transition',externalCareSource:'Hospital',previousInstructions:'Old plan',newInstructions:'Incoming plan',pendingWork:[],resolvedPendingWork:[],receivingClinician:actor,ownershipAccepted:false,handoverStatus:'draft'},
    {...careFields,type:'treatment-continuity.update-multidisciplinary',id:'assigned-multidisciplinary',functionalGoal:'Walk to the shop',interventions:[{id:'pt',title:'Graded activity',professional:actor,status:'planned',decision:'continue'}]},
  ];
  let workspace=seedWorkspace();
  for(const source of sources)workspace=save(workspace,domain,source);
  const completed=completeTransfer(workspace,'accepted-six-kinds',sources.map(source=>({domain,id:source.id,version:1})));workspace=completed.workspace;
  for(const source of sources){
    assert.ok(sourceTasks(workspace,source.id).length);
    assert.ok(sourceTasks(workspace,source.id).every(task=>task.owner===receiver&&!task.done),source.id);
    workspace=save(workspace,domain,{...source,expectedVersion:1,reason:'Confirm the same pending work.'});
    assert.ok(sourceTasks(workspace,source.id).every(task=>task.owner===receiver&&task.workflowVersion===2&&!task.done),source.id);
  }
  const transition=treatment(workspace).transitions.find(record=>record.id==='accepted-six-kinds');
  assert.ok(transition.handoverEvidence.pendingTransfers.every(transfer=>transfer.ref.version===1));
  assert.throws(()=>save(workspace,domain,{...completed.fields,handoverStatus:'completed',expectedVersion:transition.version,reason:'Attempt to reuse stale review references.'}),/Linked care action changed/);
  assert.deepEqual(projectAcceptedWorkAssignments(workspace,{actor:'Unrelated later caller',now:'2026-09-25T10:00:00Z'}),workspace);
});

test('a result update retains accepted responsibility without changing the source owner or acceptance version',()=>{
  const tracking={requestStage:'draft',backupOwner:'Backup clinician',dueWindow:{end:'2026-09-30T15:00:00Z',timezone:'UTC'},priority:'routine',nextAction:'Authorize the request.'};
  let workspace=save(seedWorkspace(),'results-referrals',{type:'results-referrals.result.create',id:'assigned-result',encounterId:'assignment-review',expectedVersion:0,requestLabel:'Pending investigation',owner:actor,dueAt:'2026-09-30',requestedAt:'2026-09-24',reason:'Track the request.',tracking});
  workspace=completeTransfer(workspace,'accepted-result',[{domain:'results-referrals',id:'assigned-result',version:1}]).workspace;
  assert.equal(sourceTasks(workspace,'assigned-result')[0].owner,receiver);
  workspace=save(workspace,'results-referrals',{type:'results-referrals.result.track',id:'assigned-result',expectedVersion:1,reason:'Update the next attempt.',tracking:{...tracking,nextAction:'Confirm authorization.'}});
  const task=sourceTasks(workspace,'assigned-result')[0],record=results(workspace).results.find(record=>record.id==='assigned-result');
  assert.equal(task.owner,receiver);assert.equal(task.workflowVersion,2);assert.equal(task.done,false);
  assert.equal(record.owner,actor);assert.equal(record.version,2);
  assert.equal(treatment(workspace).transitions.find(record=>record.id==='accepted-result').handoverEvidence.pendingTransfers[0].ref.version,1);
});

test('ambiguous source identities and invalid acceptance cannot create an ownership projection',()=>{
  let workspace=save(seedWorkspace(),domain,{...reconciliation,id:'ambiguous-source'});
  workspace=save(workspace,domain,{...careFields,type:'treatment-continuity.record-experience',id:'ambiguous-source',medicationName:'Medicine',reportedUse:'unknown',regimen:'Regimen',regimenDurationDays:null,reportedBenefit:'unknown',tolerability:'unknown',functionalGoal:'Walk',trialStatus:'active',reassessmentDecision:'defer'});
  workspace=completeTransfer(workspace,'ambiguous-transfer',[{domain,id:'ambiguous-source',version:1}]).workspace;
  assert.ok(sourceTasks(workspace,'ambiguous-source').every(task=>task.owner===actor));
  let accepted=save(seedWorkspace(),domain,reconciliation);
  accepted=completeTransfer(accepted,'invalid-transfer',[{domain,id:reconciliation.id,version:1}]).workspace;
  for(const change of [
    evidence=>{evidence.acceptance='pending';},
    evidence=>{evidence.pendingTransfers[0].ref.id='missing-source';},
    evidence=>{evidence.pendingTransfers[0].ref.version=99;},
    evidence=>{evidence.pendingTransfers[0].acceptedAt='2026-09-25T14:00:00Z';},
  ]){
    const invalid=structuredClone(accepted);
    sourceTasks(invalid,reconciliation.id).forEach(task=>{task.owner=actor;});
    change(treatment(invalid).transitions.find(record=>record.id==='invalid-transfer').handoverEvidence);
    const before=structuredClone(invalid);
    assert.deepEqual(projectAcceptedWorkAssignments(invalid,{actor,now}),before);
  }
});

test('shared result and referral work uses the source deadline instant and preserves prior deadlines',()=>{
  const coordination={referringClinician:actor,urgency:'routine',authorizedPacket:'Referral packet',backupOwner:'Backup clinician',dueWindow:{end:'2026-09-30T10:00:00+01:00',timezone:'Europe/Lisbon'}};
  let workspace=save(seedWorkspace(),'results-referrals',{type:'results-referrals.referral.create',id:'deadline-referral',encounterId:'assignment-review',expectedVersion:0,clinicalQuestion:'Review investigation',receivingService:'Specialist',owner:actor,dueAt:'2026-09-30',supportingEvidence:'Referral packet',reason:'Request consultation.',mode:'appointment',coordination});
  workspace=save(workspace,'results-referrals',{type:'results-referrals.referral.configure',id:'deadline-referral',expectedVersion:1,reason:'Bring review forward.',mode:'appointment',coordination:{...coordination,dueWindow:{end:'2026-09-25T09:30:00+01:00',timezone:'Europe/Lisbon'}}});
  const referral=results(workspace).referrals.find(record=>record.id==='deadline-referral'),task=sourceTasks(workspace,referral.id)[0];
  assert.equal(referral.dueAt,'2026-09-25');assert.equal(task.date,'2026-09-25');assert.equal(task.time,'08:30');assert.equal(task.timezone,'UTC');
  assert.equal(task.history[0].date,'2026-09-30');assert.equal(task.history[0].time,'09:00');assert.ok(isReferralOverdue(referral,'2026-09-26T12:00:00Z'));
  const tracking={requestStage:'draft',backupOwner:'Backup clinician',dueWindow:{end:'2026-09-30T15:00:00+01:00',timezone:'Europe/Lisbon'},priority:'routine',nextAction:'Contact the laboratory.',nextAttemptAt:'2026-09-26T00:30:00+02:00'};
  workspace=save(workspace,'results-referrals',{type:'results-referrals.result.create',id:'deadline-result',encounterId:'assignment-review',expectedVersion:0,requestLabel:'Pending test',owner:actor,dueAt:'2026-09-30',requestedAt:'2026-09-24',reason:'Track the request.',tracking});
  const attempt=sourceTasks(workspace,'deadline-result')[0];
  assert.equal(attempt.date,'2026-09-25');assert.equal(attempt.time,'22:30');assert.equal(attempt.timezone,'UTC');
});
