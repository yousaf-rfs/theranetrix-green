import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

const bundle=await build({stdin:{contents:"export {seedWorkspace} from './lib/theranetrix';export {applyAction,actionSchema} from './lib/actions';export {openCareWork} from './lib/care-operations';export {applyWorkflowBridges} from './lib/clinical-flows/bridges';export {encounterContext} from './lib/clinical-flows/context';export {patientExport} from './lib/patient-export';export {advisorReply} from './lib/engine-demo';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {seedWorkspace,applyAction,actionSchema,openCareWork,applyWorkflowBridges,encounterContext,patientExport,advisorReply}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const patientId='TN-1038',otherPatientId='TN-1042',encounterId='integrity-review',actor='Encounter integrity reviewer',now='2026-09-17T14:00:00Z';
const patient=workspace=>workspace.patients.find(row=>row.id===patientId);
const state=workspace=>workspace.clinicalWorkflows.slices.encounters.state;
const latestSignoff=workspace=>state(workspace).signoffs.at(-1);
const save=(workspace,action,at=now)=>applyAction(workspace,actionSchema.parse(action),actor,at);
function workflow(workspace,fields,{at=now,id=patientId,encounter=encounterId}={}){
  const requestId=crypto.randomUUID();
  return save(workspace,{type:'workflow.apply',domain:'encounters',patientId:id,requestId,expectedSliceVersion:workspace.clinicalWorkflows.slices.encounters.version,command:{patientId:id,encounterId:encounter,requestId,...fields}},at);
}
function assess(workspace,fields={},scope){
  return workflow(workspace,{type:'encounters.assessment.save',presentingProblem:'Review walking progress.',painDistributionPhenotype:'',timeline:'',relevantExamination:'',comorbidContext:'',psychologicalContext:'',socialContext:'',workingAssessment:'Review the reported function.',alternatives:[],supportingFindings:[],refutingFindings:[],uncertainty:'Review progress at follow-up.',furtherWorkup:'',route:'continue-local',deferReason:'',...fields},scope);
}
function draft(workspace,fields={},at=now){
  const existing=latestSignoff(workspace);
  return workflow(workspace,{type:'encounters.signoff.saveDraft',...(existing?{expectedVersion:existing.version}:{}),assessmentRecordId:state(workspace).assessments.find(row=>row.patientId===patientId&&row.encounterId===encounterId).id,rationale:'Reviewed the available information with the patient.',patientFacingPlan:'Continue the agreed walking plan.',disposition:{selected:[],rejected:[],deferred:[],noChange:true},owner:actor,followUp:{date:'2026-09-22',time:'10:00',timezone:'UTC'},pendingWork:[],teachBack:'Patient described the agreed instructions.',...fields},{at});
}
function advance(workspace,verb,at=now){
  const record=latestSignoff(workspace);
  return workflow(workspace,{type:'encounters.signoff.'+verb,id:record.id,expectedVersion:record.version,reason:'Reviewed the source evidence and instructions.'},{at});
}
const sign=workspace=>advance(advance(workspace,'review'),'sign');
const observations=(values=[4,7,6])=>({type:'encounters.observations.save',instrument:'local-0-10',submissionStatus:'confirmed',entries:['pain','function','sleep'].map((metric,index)=>({metric,status:values[index]===0?'zero':'answered',value:values[index],source:'Patient self-report',recordedAt:now}))});

test('interim fallback reaches patient instructions and notes while signed originals remain unchanged',()=>{
  let workspace=save(seedWorkspace(),{type:'task.add',patientId,title:'Arrange the longer assessment',date:'2026-09-18',time:'10:00',taskType:'Care coordination'});
  const work=openCareWork(workspace,patientId).find(row=>row.title==='Arrange the longer assessment');
  workspace=save(workspace,{type:'care.operations',patientId,requestId:crypto.randomUUID(),expectedVersion:workspace.careOperations?.version??0,command:{kind:'transfer',work:[{id:work.id,revision:work.revision}],owner:'Receiving nurse',backup:'Covering clinician',dueAt:'2026-09-18T10:00:00Z',timezone:'UTC',evidence:'The receiving nurse accepted the next assessment.'}});
  workspace=assess(workspace,{route:'defer',deferReason:'The examination requires a longer review.'});
  const fallback='If the receiving team cannot be reached, call the covering clinician on 555-0123.';
  workspace=sign(draft(workspace,{planKind:'interim',receivingWorkRef:{id:work.id,revision:work.revision},patientFallback:fallback}));
  const signed=structuredClone(latestSignoff(workspace)),plan=structuredClone(patient(workspace).carePlans[0]);
  assert.equal(signed.signedSnapshot.patientFacingPlan,'Continue the agreed walking plan.');
  assert.equal(signed.signedSnapshot.patientFallback,fallback);
  assert.ok(plan.text.includes(fallback));
  assert.ok(patient(workspace).notes.find(row=>row.workflowRecordId===signed.id).text.includes(fallback));
  assert.ok(patientExport(patient(workspace),workspace,now,'patient').plan.text.includes(fallback));
  assert.ok(advisorReply(patient(workspace),workspace,'plan','What is my saved plan?').reply.includes(fallback));

  // A previously saved projection omitted only the separately signed fallback.
  const previousProjection=structuredClone(workspace);
  patient(previousProjection).carePlans[0].text=signed.signedSnapshot.patientFacingPlan;
  const note=patient(previousProjection).notes.find(row=>row.workflowRecordId===signed.id);
  note.text=note.text.replace('\n\nIf contact fails: '+fallback,'');
  const repaired=applyWorkflowBridges(previousProjection,'encounters',{actor,now});
  assert.deepEqual(patient(repaired).carePlans[0],plan);
  assert.ok(patient(repaired).notes.find(row=>row.id===note.id).text.includes(fallback));
  assert.deepEqual(latestSignoff(repaired),signed);
  assert.deepEqual(applyWorkflowBridges(repaired,'encounters',{actor,now}),repaired);

  workspace=workflow(workspace,{type:'encounters.signoff.amend',id:signed.id,expectedVersion:signed.version,amendmentReason:'The patient clarified the alternative contact route.',patientFallback:'If contact fails, use the newly agreed cover number.'});
  workspace=sign(workspace);
  assert.deepEqual(state(workspace).signoffs.find(row=>row.id===signed.id),signed);
  assert.deepEqual(patient(workspace).carePlans.find(row=>row.id===plan.id),plan);
  assert.ok(patient(workspace).carePlans[0].text.includes('newly agreed cover number'));
});

test('clarification tasks retain the signed instant when local offsets cross UTC dates',()=>{
  for(const dueAt of ['2026-09-18T10:00:00-04:00','2026-09-18T00:15:00+05:30']){
    const workspace=sign(draft(assess(seedWorkspace()),{teachBackOutcome:'needs-clarification',clarification:{owner:'Clarifying nurse',dueAt,question:'Clarify the agreed walking interval.'}}));
    const task=workspace.tasks.find(row=>row.title==='Clarify the agreed walking interval.');
    assert.equal(task.timezone,'UTC');
    assert.equal(`${task.date}T${task.time}:00.000Z`,new Date(dueAt).toISOString());
    assert.equal(latestSignoff(workspace).signedSnapshot.clarification.dueAt,dueAt);
    const previousProjection=structuredClone(workspace),previousTask=previousProjection.tasks.find(row=>row.id===task.id);
    previousTask.date=dueAt.slice(0,10);previousTask.time=dueAt.slice(11,16);
    const repaired=applyWorkflowBridges(previousProjection,'encounters',{actor,now});
    assert.deepEqual(repaired.tasks.find(row=>row.id===task.id),task);
    assert.deepEqual(state(repaired),state(workspace));
  }
});

test('a completed withdrawal review stays completed after persistence and another patient encounter save',()=>{
  let workspace=workflow(seedWorkspace(),observations());
  const record=state(workspace).observations[0];
  workspace=workflow(workspace,{type:'encounters.observations.withdraw',id:record.id,expectedVersion:record.version,reason:'Report entered on the wrong chart.'});
  const review=workspace.reviews.find(row=>row.workflowRecordId===record.id);
  workspace=save(workspace,{type:'review.update',id:review.id,status:'Resolved',resolution:'Reviewed affected outputs after withdrawal.'},'2026-09-17T15:00:00Z');
  workspace=save(workspace,{type:'treatment.review',patientId,direction:'Reassessment needed',goalStatus:'Not assessed',goalEvidence:'',decision:'Reviewed the corrected chart.',monitoring:'Continue the agreed follow-up.',options:[]},'2026-09-17T15:01:00Z');
  assert.equal(patient(workspace).recordReviewRequiredSince,undefined);
  assert.equal(patient(workspace).status,'Monitoring');
  workspace=JSON.parse(JSON.stringify(workspace));
  const reviewedPatient=structuredClone(patient(workspace));
  workspace=assess(workspace,{}, {at:'2026-09-17T16:00:00Z',id:otherPatientId,encounter:'unrelated-patient-assessment'});
  assert.deepEqual(patient(workspace),reviewedPatient);
  assert.equal(workspace.reviews.find(row=>row.id===review.id).status,'Resolved');
  assert.equal(patient(workspace).checkins.find(row=>row.workflowRecordId===record.id).withdrawnAt,now);
});

for(const source of ['checkin.add','advisor.chat'])test(`${source} invalidates a reviewed encounter until the new report is reviewed`,()=>{
  let workspace=advance(draft(assess(seedWorkspace())),'review');
  const values={pain:patient(workspace).pain.at(-1),function:patient(workspace).function.at(-1),sleep:0};
  const action=source==='checkin.add'?{type:source,patientId,...values,note:'Latest patient report.'}:{type:source,patientId,requestId:crypto.randomUUID(),text:'My latest pain, daily function and sleep report.',intent:'progress',checkin:values};
  workspace=save(workspace,action,'2026-09-17T15:00:00Z');
  const report=patient(workspace).checkins[0],before=structuredClone(workspace);
  assert.throws(()=>advance(workspace,'sign','2026-09-17T16:00:00Z'),/Patient sources changed/);
  assert.deepEqual(workspace,before);
  workspace=draft(workspace,{},'2026-09-17T16:00:00Z');
  workspace=advance(advance(workspace,'review','2026-09-17T16:00:00Z'),'sign','2026-09-17T16:00:00Z');
  const evidence=latestSignoff(workspace).signedSnapshot.reviewEvidence.observations.filter(row=>row.recordId===report.id);
  assert.equal(evidence.length,3);
  assert.ok(evidence.every(row=>row.recordedAt===report.date&&row.source==='Patient self-report'));
  assert.equal(evidence.find(row=>row.metric==='sleep').status,'zero');
  assert.equal(evidence.find(row=>row.metric==='sleep').value,0);
});

test('review evidence includes saved baseline check-ins once and excludes obsolete workflow projections',()=>{
  let workspace=seedWorkspace();
  const legacyCount=patient(workspace).checkins.length*3;
  assert.equal(encounterContext(workspace,patient(workspace),now).reviewEvidence.observations.length,legacyCount);
  workspace=workflow(workspace,observations());
  const record=state(workspace).observations[0];
  assert.equal(encounterContext(workspace,patient(workspace),now).reviewEvidence.observations.length,legacyCount+3);
  workspace=workflow(workspace,{type:'encounters.observations.correct',expectedVersion:record.version,reason:'Patient corrected the pain score.',replacement:{metric:'pain',status:'zero',value:0,source:'Patient clarification',recordedAt:now}});
  const current=encounterContext(workspace,patient(workspace),now).reviewEvidence.observations;
  assert.equal(current.length,legacyCount+3);
  assert.equal(current.find(row=>row.recordId===record.id&&row.metric==='pain').value,0);
  workspace=workflow(workspace,{type:'encounters.observations.withdraw',id:record.id,expectedVersion:2,reason:'This report belongs to a different chart.'});
  assert.equal(encounterContext(workspace,patient(workspace),now).reviewEvidence.observations.length,legacyCount);
});
