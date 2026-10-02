import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

const bundle=await build({stdin:{contents:"export * from './lib/clinical-flows/plan-preparation';export {seedWorkspace} from './lib/theranetrix';export {applyWorkflowAction} from './lib/clinical-flows';export {applyCareOperations} from './lib/care-operations';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {planSources,prepareLinkedPlan,seedWorkspace,applyWorkflowAction,applyCareOperations}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const patientId='TN-1042',otherPatientId='TN-1038',encounterId='current-plan-review',sourceEncounter='earlier-source-review';
const actor='Clinician preparing the plan',now='2026-09-17T14:00:00.000Z',day=now.slice(0,10);
const state=workspace=>workspace.clinicalWorkflows.slices;
const patient=(workspace,id=patientId)=>workspace.patients.find(row=>row.id===id);
function save(workspace,domain,command){
  const requestId=crypto.randomUUID();
  return applyWorkflowAction(workspace,{type:'workflow.apply',domain,patientId:command.patientId,requestId,expectedSliceVersion:state(workspace)[domain].version,command:{...command,requestId}},actor,now);
}
function signedPlan(workspace=seedWorkspace(),id=patientId){
  const scope={patientId:id,encounterId};
  workspace=save(workspace,'encounters',{type:'encounters.assessment.save',...scope,presentingProblem:'Review current activity limits.',painDistributionPhenotype:'Back discomfort.',timeline:'Current patient report reviewed.',relevantExamination:'Recorded assessment.',comorbidContext:'Reviewed.',psychologicalContext:'Reviewed.',socialContext:'Reviewed.',workingAssessment:'Continue the agreed care while reviewing outside advice.',alternatives:[],supportingFindings:['Patient report'],refutingFindings:[],uncertainty:'Outside advice will need reconciliation.',furtherWorkup:'',route:'continue-local',deferReason:''});
  const assessment=state(workspace).encounters.state.assessments.find(row=>row.patientId===id&&row.encounterId===encounterId);
  workspace=save(workspace,'encounters',{type:'encounters.signoff.saveDraft',...scope,assessmentRecordId:assessment.id,rationale:'Original plan discussed with the patient.',patientFacingPlan:'Keep the current agreed activity log.',disposition:{selected:[],rejected:[],deferred:[],noChange:true},owner:actor,followUp:{date:'2026-09-24',time:'10:00',timezone:'UTC'},pendingWork:[],teachBack:'Patient described the current next step.'});
  const record=()=>state(workspace).encounters.state.signoffs.find(row=>row.patientId===id&&row.encounterId===encounterId);
  for(const type of ['encounters.signoff.review','encounters.signoff.sign'])workspace=save(workspace,'encounters',{type,...scope,id:record().id,expectedVersion:record().version,reason:'Clinician reviewed and signed the original plan.'});
  return workspace;
}
function referral(workspace,{id='reviewed-referral',patient=patientId,reviewed=true}={}){
  const current=()=>state(workspace)['results-referrals'].state.referrals.find(row=>row.id===id);
  const next=(verb,fields={})=>{workspace=save(workspace,'results-referrals',{type:`results-referrals.referral.${verb}`,patientId:patient,id,expectedVersion:current()?.version??0,reason:'Review the specialist advice before changing the patient plan.',...fields});};
  next('create',{encounterId:sourceEncounter,mode:'electronic-consultation',clinicalQuestion:'Review the activity-pacing options.',receivingService:'Rehabilitation service',owner:actor,dueAt:day,supportingEvidence:'Current plan and patient report'});
  next('send',{evidenceRef:'Recorded dispatch'});next('accept',{evidenceRef:'Receiving service acknowledgement'});
  next('advice-received',{receivedAt:now,adviceSummary:'Use activity blocks with agreed rest breaks.',originalAdvice:'Specialist advice retained for clinical review.',evidenceRef:'Specialist letter'});
  if(reviewed){next('review',{reviewSummary:'The responsible clinician reviewed the advice with the current plan.',evidenceRef:'Dated clinical review'});next('plan-reconciled',{reconciliationPlan:'Agree shorter activity blocks and review the patient log together.',evidenceRef:'Reconciliation note'});}
  return workspace;
}
function transition(workspace,{id='reviewed-transition',patient=patientId,reviewed=true}={}){
  const source={source:'Discharge team',author:'Discharge clinician',collectedAt:now,receivedAt:now,reference:'Discharge instructions'};
  const handoverEvidence={source,patientAccount:'Patient described the prior instructions.',backupOwner:'Covering clinician',acceptance:'pending',pendingTransfers:[],timezone:'UTC'};
  const fields={patientId:patient,encounterId:sourceEncounter,id,reason:'Review the transition instructions.',owner:actor,dueDate:'2026-09-24',externalCareSource:'Discharge service',previousInstructions:'Earlier patient instructions retained.',newInstructions:'Incoming discharge instructions retained.',discrepancies:'Activity timing was discussed.',pendingWork:[],resolvedPendingWork:[],receivingClinician:actor,ownershipAccepted:false,reconciledInstructions:'',patientCommunication:'',handoverEvidence};
  const next=(handoverStatus,extra={})=>{
    const current=state(workspace)['treatment-continuity'].state.transitions.find(row=>row.id===id);
    workspace=save(workspace,'treatment-continuity',{type:'treatment-continuity.record-transition',...fields,...(current?{expectedVersion:current.version}:{}),handoverStatus,...extra});
  };
  next('draft');
  if(reviewed){
    next('ownership-pending');
    const reviewedFields={ownershipAccepted:true,reconciledInstructions:'Use the reconciled activity timing and attend the usual review.',patientCommunication:'The clinician discussed the reconciled instructions with the patient.',handoverEvidence:{...handoverEvidence,acceptance:'accepted',acceptedBy:actor,acceptedAt:now,acceptanceEvidence:'Receiving clinician accepted responsibility.',teachBack:'Patient described the reconciled instructions.'}};
    for(const status of ['instructions-reconciled','patient-communicated','completed'])next(status,reviewedFields);
  }
  return workspace;
}
function multidisciplinary(workspace,{id='reviewed-team',patient=patientId,reviewed=true,unresolvedConflict=false}={}){
  const interventions=[{id:'activity',title:'Graded activity',professional:'Physiotherapist',status:'active',accessBarrier:'',patientExperience:'Patient described the shorter sessions.',observedOutcome:'Walking progress is being reviewed.',decision:'continue'}];
  return save(workspace,'treatment-continuity',{type:'treatment-continuity.update-multidisciplinary',patientId:patient,encounterId:sourceEncounter,id,reason:'Team reviewed the patient goal and current activity.',owner:actor,dueDate:'2026-09-24',functionalGoal:'Walk to the local shop.',interventions,...(reviewed?{interventionReviews:[{interventionId:'activity',rationale:'Support walking toward the patient goal.',reviewCriterion:'Review burden and walking tolerance.',startedAt:day,participation:'attended',patientAgreement:'agreed',reviewDate:day,...(unresolvedConflict?{conflictingAdvice:'The team has not reconciled two pacing recommendations.'}:{})}]}:{})});
}
function preparation(workspace,ref=planSources(workspace,patientId)[0]?.ref){
  const target=state(workspace).encounters.state.signoffs.find(row=>row.patientId===patientId&&row.status==='signed');
  return {patientId,source:ref,signoffId:target.id,signoffVersion:target.version,patientInstructions:'Use the newly agreed activity blocks and bring the log to review.',rationale:'Clinician reconciled the reviewed source with the patient’s current goal.'};
}
function rejectsUnchanged(workspace,input,pattern){
  const before=structuredClone(workspace);
  assert.throws(()=>prepareLinkedPlan(workspace,input,actor,now,crypto.randomUUID()),pattern);
  assert.deepEqual(workspace,before);
}

test('source list offers current reviewed referrals, completed handovers and reconciled team reviews in this patient chart',()=>{
  let workspace=signedPlan();workspace=referral(workspace);workspace=transition(workspace);workspace=multidisciplinary(workspace);
  workspace=referral(workspace,{id:'received-unreviewed',reviewed:false});
  workspace=transition(workspace,{id:'draft-handover',reviewed:false});
  workspace=multidisciplinary(workspace,{id:'team-awaiting-review',reviewed:false});
  workspace=multidisciplinary(workspace,{id:'team-with-conflict',unresolvedConflict:true});
  workspace=referral(workspace,{id:'other-chart-referral',patient:otherPatientId});
  const before=structuredClone(workspace),sources=planSources(workspace,patientId);
  assert.deepEqual(sources.map(row=>row.ref.id).sort(),['reviewed-referral','reviewed-team','reviewed-transition']);
  assert.equal(sources.find(row=>row.ref.id==='reviewed-referral').summary,'Agree shorter activity blocks and review the patient log together.');
  assert.equal(sources.find(row=>row.ref.id==='reviewed-transition').summary,'Use the reconciled activity timing and attend the usual review.');
  assert.match(sources.find(row=>row.ref.id==='reviewed-team').summary,/Review burden and walking tolerance/);
  assert.ok(sources.every(row=>row.ref.version>0&&row.title));assert.deepEqual(workspace,before);
  assert.deepEqual(planSources(workspace,'missing-chart'),[]);
});

test('each reviewed source creates an attributed amendment draft and preserves the signed plan and source',()=>{
  for(const addSource of [referral,transition,multidisciplinary]){
    const workspace=addSource(signedPlan()),input=preparation(workspace),before=structuredClone(workspace);
    const next=prepareLinkedPlan(workspace,input,actor,now,crypto.randomUUID());
    const original=state(before).encounters.state.signoffs.find(row=>row.id===input.signoffId);
    const amendment=state(next).encounters.state.signoffs.find(row=>row.amendedFromId===input.signoffId);
    assert.ok(amendment,'the encounter state exposes the new draft');assert.equal(amendment.status,'draft');assert.equal(amendment.signedSnapshot,undefined);
    assert.equal(amendment.patientFacingPlan,input.patientInstructions);assert.equal(amendment.rationale,input.rationale);assert.equal(amendment.patientId,patientId);assert.equal(amendment.encounterId,encounterId);
    assert.match(amendment.amendmentReason,new RegExp(input.source.id));assert.match(amendment.amendmentReason,new RegExp(`version ${input.source.version}`));
    assert.equal(amendment.history[0].actor,actor);assert.equal(amendment.history[0].at,now);
    assert.deepEqual(state(next).encounters.state.signoffs.find(row=>row.id===original.id),original);
    assert.deepEqual(patient(next).carePlans,patient(before).carePlans);assert.deepEqual(patient(next).notes,patient(before).notes);
    assert.deepEqual(state(next)['results-referrals'],state(before)['results-referrals']);assert.deepEqual(state(next)['treatment-continuity'],state(before)['treatment-continuity']);
    assert.equal(state(next).encounters.version,state(before).encounters.version+1);assert.equal(state(next).encounters.updatedBy,actor);
    assert.deepEqual(workspace,before);
  }
});

test('patient instructions become the current plan only after the amendment is reviewed and signed',()=>{
  const initial=referral(signedPlan()),input=preparation(initial),originalPlan=structuredClone(patient(initial).carePlans[0]);
  let workspace=prepareLinkedPlan(initial,input,actor,now,crypto.randomUUID());
  const amendmentId=state(workspace).encounters.state.signoffs.find(row=>row.amendedFromId===input.signoffId).id;
  const amendment=()=>state(workspace).encounters.state.signoffs.find(row=>row.id===amendmentId);
  const action=type=>({type,patientId,encounterId,id:amendmentId,expectedVersion:amendment().version,reason:'Clinician reviewed the reconciled plan with the patient.'});
  assert.throws(()=>save(workspace,'encounters',action('encounters.signoff.sign')),/review/i);
  workspace=save(workspace,'encounters',action('encounters.signoff.review'));
  assert.deepEqual(patient(workspace).carePlans[0],originalPlan);
  workspace=save(workspace,'encounters',action('encounters.signoff.sign'));
  const newPlan=patient(workspace).carePlans.find(row=>row.workflowRecordId===amendmentId);
  assert.equal(newPlan.text,input.patientInstructions);assert.equal(newPlan.supersedes,originalPlan.id);
  assert.deepEqual(patient(workspace).carePlans.find(row=>row.id===originalPlan.id),originalPlan);
  assert.equal(amendment().status,'signed');assert.match(amendment().amendmentReason,/reviewed source results-referrals/);
});

test('foreign, stale, unreviewed and ambiguous target selections are rejected without writes',()=>{
  let workspace=referral(signedPlan());workspace=referral(workspace,{id:'foreign-source',patient:otherPatientId});
  workspace=referral(workspace,{id:'not-reviewed',reviewed:false});workspace=transition(workspace,{id:'not-completed',reviewed:false});workspace=multidisciplinary(workspace,{id:'not-reviewed-team',reviewed:false});
  workspace=signedPlan(workspace,otherPatientId);
  const input=preparation(workspace),foreign=planSources(workspace,otherPatientId)[0].ref;
  rejectsUnchanged(workspace,{...input,source:foreign},/this patient record/);
  rejectsUnchanged(workspace,{...input,source:{...input.source,version:input.source.version+1}},/source changed/);
  rejectsUnchanged(workspace,{...input,source:{...input.source,id:'not-reviewed',version:4}},/reviewed and reconciled/);
  for(const id of ['not-completed','not-reviewed-team'])rejectsUnchanged(workspace,{...input,source:{domain:'treatment-continuity',id,version:1}},/reviewed and reconciled/);
  const other=state(workspace).encounters.state.signoffs.find(row=>row.patientId===otherPatientId);
  rejectsUnchanged(workspace,{...input,signoffId:other.id,signoffVersion:other.version},/signed encounter from the same patient/);
  rejectsUnchanged(workspace,{...input,signoffVersion:input.signoffVersion+1},/signed encounter changed/);
  rejectsUnchanged(workspace,{...input,source:{domain:'encounters',id:input.signoffId,version:input.signoffVersion}},/Invalid/);
  const prepared=prepareLinkedPlan(workspace,input,actor,now,crypto.randomUUID());
  const draft=state(prepared).encounters.state.signoffs.find(row=>row.amendedFromId===input.signoffId);
  rejectsUnchanged(prepared,{...input,signoffId:draft.id,signoffVersion:draft.version},/signed encounter from the same patient/);
  rejectsUnchanged(prepared,input,/already has an amendment/);
});

test('retry identity creates one amendment and rejects different content or author',()=>{
  const workspace=referral(signedPlan()),input=preparation(workspace),requestId=crypto.randomUUID();
  const prepared=prepareLinkedPlan(workspace,input,actor,now,requestId),saved=JSON.parse(JSON.stringify(prepared));
  const retried=prepareLinkedPlan(saved,input,actor,'2026-09-18T10:00:00Z',requestId);
  assert.deepEqual(retried,saved);assert.equal(state(retried).encounters.state.signoffs.filter(row=>row.amendedFromId===input.signoffId).length,1);
  assert.throws(()=>prepareLinkedPlan(saved,{...input,patientInstructions:'Different proposed instructions.'},actor,now,requestId),/different workflow command/);
  assert.throws(()=>prepareLinkedPlan(saved,input,'Another clinician',now,requestId),/different workflow command/);
});


test('care operations prepares one saved amendment and replays without adding a plan or signature',()=>{
  let workspace=referral(signedPlan());
  const original=state(workspace).encounters.state.signoffs.find(row=>row.status==='signed');
  const command={kind:'prepare-plan',source:planSources(workspace,patientId)[0].ref,signoffId:original.id,signoffVersion:original.version,patientInstructions:'Use the agreed activity blocks and bring the log to review.',rationale:'Reconciled specialist advice with the patient goal.'};
  const action={type:'care.operations',patientId,requestId:'x'.repeat(200),expectedVersion:0,command};
  const previousPlans=structuredClone(patient(workspace).carePlans);
  workspace=applyCareOperations(workspace,action,actor,now);
  assert.equal(workspace.careOperations.version,1);
  assert.deepEqual(patient(workspace).carePlans,previousPlans);
  assert.equal(state(workspace).encounters.state.signoffs.filter(row=>row.amendedFromId===original.id).length,1);
  assert.deepEqual(applyCareOperations(workspace,action,actor,now),workspace);
  assert.throws(()=>applyCareOperations(workspace,{...action,command:{...command,rationale:'Changed payload'}},actor,now),/different action/);
});
