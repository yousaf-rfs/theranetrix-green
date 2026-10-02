import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

// Real action parsing, workspace reducers and projections. These tests do not
// substitute a provider receipt or establish clinical assessment/acceptance.
const compiled=await build({stdin:{contents:"export {seedWorkspace} from './lib/theranetrix';export {ensureShowcaseData} from './lib/demo-showcase';export {applyAction,actionSchema} from './lib/actions';export {openCareWork,coverageAt} from './lib/care-operations';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {seedWorkspace,ensureShowcaseData,applyAction,actionSchema,openCareWork,coverageAt}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const actor='Operations test reviewer',now='2026-09-17T14:00:00.000Z',emma='TN-DEMO-01',lucas='TN-DEMO-02';
const fixture=ensureShowcaseData(seedWorkspace(),actor,now);
const init=()=>structuredClone(fixture);
const save=(workspace,action,at=now,author=actor)=>applyAction(workspace,actionSchema.parse(action),author,at);
const patient=(workspace,id=emma)=>workspace.patients.find(row=>row.id===id);
const operation=(workspace,command,patientId=emma)=>({type:'care.operations',patientId,requestId:crypto.randomUUID(),expectedVersion:workspace.careOperations?.version??0,command});
const rejectUnchanged=(workspace,action,pattern,at=now,author=actor)=>{const before=structuredClone(workspace);assert.throws(()=>save(workspace,action,at,author),pattern);assert.deepEqual(workspace,before);};

test('accepted transfers bind current patient work and version while keeping the work open',()=>{
  let workspace=save(init(),{type:'task.add',patientId:emma,title:'Confirm the activity log with the patient',date:'2026-09-18',time:'10:00',taskType:'Care coordination'});
  const item=openCareWork(workspace,emma).find(row=>row.title==='Confirm the activity log with the patient');
  assert.ok(item);assert.equal(item.kind,'task');
  const command={kind:'transfer',work:[{id:item.id,revision:item.revision}],owner:'Receiving clinician',backup:'Covering coordinator',dueAt:'2026-09-18T10:00:00Z',timezone:'Europe/Lisbon',evidence:'Receiving clinician explicitly accepted the pending review.'};
  rejectUnchanged(workspace,operation(workspace,{...command,work:[{id:item.id,revision:'stale-version'}]}),/Pending work changed/);
  rejectUnchanged(workspace,operation(workspace,command,lucas),/Pending work changed/);
  const before=structuredClone(workspace),accepted=operation(workspace,command);
  workspace=save(workspace,accepted);
  assert.deepEqual(before.tasks.find(row=>row.id===item.sourceId).done,false);
  const transferred=openCareWork(workspace,emma).find(row=>row.id===item.id),task=workspace.tasks.find(row=>row.id===item.sourceId);
  assert.equal(transferred.acceptedOwner,'Receiving clinician');assert.equal(transferred.revision,item.revision);
  assert.equal(task.owner,'Receiving clinician');assert.equal(task.done,false);
  assert.equal(workspace.careOperations.transfers[0].actor,actor);assert.equal(workspace.careOperations.transfers[0].at,now);
  assert.ok(task.history.some(entry=>entry.changedBy===actor&&entry.reason.includes('Receiving responsibility')));
  assert.deepEqual(save(workspace,accepted),workspace,'exact retry neither duplicates the transfer nor completes work');
  rejectUnchanged(workspace,{...accepted,command:{...command,owner:'Different recipient'}},/different action/);
  rejectUnchanged(workspace,{...operation(workspace,command),expectedVersion:accepted.expectedVersion},/coordination changed/);
  workspace=save(workspace,{type:'task.toggle',id:task.id,done:true});
  assert.ok(!openCareWork(workspace,emma).some(row=>row.id===item.id));
  rejectUnchanged(workspace,operation(workspace,command),/Pending work changed/);
});

test('an interrupted remote assessment requires an owned recovery and reconnection before completion',()=>{
  let workspace=init();const beforeReports=structuredClone(patient(workspace).checkins);
  const visit={kind:'remote-visit',encounterId:'operations-remote-review',channel:'video',location:'Patient confirmed being at home',owner:'Remote clinician',reason:'Document the connection state of this assessment.'};
  rejectUnchanged(workspace,operation(workspace,{...visit,status:'completed'}),/connected assessment/);
  workspace=save(workspace,operation(workspace,{...visit,status:'scheduled'}));
  rejectUnchanged(workspace,operation(workspace,{...visit,status:'interrupted'}),/owned next contact time/);
  workspace=save(workspace,operation(workspace,{...visit,status:'interrupted',nextAttemptAt:'2026-09-17T15:00:00Z'}));
  let recovery=workspace.tasks.find(row=>row.patientId===emma&&row.title==='Complete remote assessment');
  assert.equal(recovery.done,false);assert.equal(recovery.owner,'Remote clinician');assert.equal(recovery.date,'2026-09-17');assert.equal(recovery.time,'15:00');
  rejectUnchanged(workspace,operation(workspace,{...visit,status:'completed'}),/connected assessment/);
  workspace=save(workspace,operation(workspace,{...visit,channel:'phone',status:'connected'}),'2026-09-17T15:00:00Z');
  workspace=save(workspace,operation(workspace,{...visit,channel:'phone',status:'completed'}),'2026-09-17T15:20:00Z');
  recovery=workspace.tasks.find(row=>row.id===recovery.id);
  assert.equal(recovery.done,true);
  assert.equal(workspace.tasks.filter(row=>row.id===recovery.id).length,1);
  assert.deepEqual(workspace.careOperations.remoteVisits.filter(row=>row.encounterId===visit.encounterId).map(row=>row.status),['completed','connected','interrupted','scheduled']);
  assert.deepEqual(patient(workspace).checkins,beforeReports,'a completed connection workflow does not invent observations');
});

test('paused, disconnected and no-response monitoring preserve the last report instead of manufacturing freshness',()=>{
  let workspace=save(init(),{type:'checkin.add',patientId:emma,pain:6,function:4,sleep:5,note:'A dated patient report before the monitoring interruption.'},'2026-09-17T13:55:00Z');
  const reports=structuredClone(patient(workspace).checkins),trajectory=structuredClone({pain:patient(workspace).pain,function:patient(workspace).function,sleep:patient(workspace).sleep,dates:patient(workspace).dates});
  const monitor={kind:'monitoring',owner:'Monitoring coordinator',reason:'No new report has been received.'};
  rejectUnchanged(workspace,operation(workspace,{...monitor,status:'paused'}),/next review/);
  for(const status of ['paused','disconnected','no-response']){
    workspace=save(workspace,operation(workspace,{...monitor,status,nextAttemptAt:'2026-09-18T09:00:00Z'}),'2026-09-17T16:00:00Z');
    assert.equal(workspace.careOperations.monitoring[0].lastReceivedAt,'2026-09-17T13:55:00Z');
    assert.equal(workspace.careOperations.monitoring[0].status,status);
    assert.deepEqual(patient(workspace).checkins,reports);
  }
  const recovery=workspace.tasks.find(row=>row.patientId===emma&&row.title==='Contact patient about missing report');
  assert.equal(recovery.owner,'Monitoring coordinator');assert.equal(recovery.done,false);
  workspace=save(workspace,operation(workspace,{...monitor,status:'active'}),'2026-09-18T09:00:00Z');
  assert.equal(workspace.tasks.find(row=>row.id===recovery.id).done,true);
  assert.equal(workspace.careOperations.monitoring[0].lastReceivedAt,'2026-09-17T13:55:00Z');
  assert.deepEqual(patient(workspace).checkins,reports);
  assert.deepEqual({pain:patient(workspace).pain,function:patient(workspace).function,sleep:patient(workspace).sleep,dates:patient(workspace).dates},trajectory);
});

test('identity review preserves both original charts and rejects self-review or unknown charts',()=>{
  let workspace=init();const charts=structuredClone(workspace.patients);
  const command={kind:'identity-review',otherPatientId:lucas,status:'open',reason:'Review a possible chart selection mismatch.',owner:'Identity reviewer'};
  rejectUnchanged(workspace,operation(workspace,{...command,otherPatientId:emma}),/other chart/);
  rejectUnchanged(workspace,operation(workspace,{...command,otherPatientId:'missing-chart'}),/other chart/);
  workspace=save(workspace,operation(workspace,command));
  const original=structuredClone(workspace.careOperations.identityReviews[0]);
  workspace=save(workspace,operation(workspace,{...command,status:'distinct-records',reason:'The two people and their existing records are distinct.'}));
  assert.deepEqual(workspace.patients,charts,'review neither merges nor rewrites a patient record');
  assert.deepEqual(workspace.careOperations.identityReviews.find(row=>row.id===original.id),original);
  assert.equal(workspace.careOperations.identityReviews[0].actor,actor);
  const p=patient(workspace);
  rejectUnchanged(workspace,{type:'patient.add',name:p.name,dateOfBirth:p.dateOfBirth,condition:p.condition,clinician:p.clinician,goal:p.goal},/Patient identity review/);
});

test('an explicitly urgent question produces one staged owned handoff and retry cannot duplicate conversation or reviews',()=>{
  let workspace=init();
  workspace.careOperations.coverage=[];
  const coverage={kind:'coverage',owner:'Covering clinician',backup:'Backup clinician',startsAt:'2026-09-17T13:00:00Z',endsAt:'2026-09-17T17:00:00Z',timezone:'UTC',evidence:'Both clinicians accepted this recorded cover period.'};
  workspace=save(workspace,operation(workspace,coverage));
  assert.equal(coverageAt(workspace,emma,now).owner,'Covering clinician');assert.equal(coverageAt(workspace,emma,coverage.endsAt),undefined);
  const priorMessages=workspace.messages.length,priorTurns=workspace.advisorTurns?.length??0,priorHandoffs=workspace.clinicalWorkflows.slices['patient-coordination'].state.handoffs.length,priorReviews=workspace.reviews.length;
  const foreign=structuredClone(patient(workspace,lucas));
  const command={type:'advisor.chat',patientId:emma,requestId:'urgent-question-one',intent:'question',concernUrgency:'urgent',text:'I need an urgent call about my symptoms. Can someone review this now?'};
  workspace=save(workspace,command);
  const turn=workspace.advisorTurns.at(-1),handoff=workspace.clinicalWorkflows.slices['patient-coordination'].state.handoffs.find(row=>row.id===turn.handoffId),review=workspace.reviews.find(row=>row.id===turn.reviewId);
  assert.equal(turn.intent,'question');assert.equal(turn.patientText,command.text);
  assert.equal(handoff.concern,command.text);assert.equal(handoff.priority,'high');assert.equal(handoff.urgencySource.type,'patient-request');
  assert.equal(handoff.phase,'locally-saved');assert.equal(handoff.deliveryStatus,'pending');assert.equal(handoff.responsiblePerson,'Covering clinician');
  assert.equal(review.workflowRecordId,handoff.id);assert.equal(review.priority,'High');assert.equal(review.status,'Open');assert.equal(review.owner,'Covering clinician');
  assert.equal(workspace.messages.length,priorMessages+2);assert.equal(workspace.advisorTurns.length,priorTurns+1);
  assert.equal(workspace.clinicalWorkflows.slices['patient-coordination'].state.handoffs.length,priorHandoffs+1);assert.equal(workspace.reviews.length,priorReviews+1);
  assert.deepEqual(patient(workspace,lucas),foreign);
  const reloaded=JSON.parse(JSON.stringify(workspace));
  assert.deepEqual(save(reloaded,command,'2026-09-17T14:05:00Z'),reloaded,'retry after JSON persistence leaves every saved record unchanged');
  rejectUnchanged(workspace,{...command,text:'Different request under the same identity.'},/different action/);
  rejectUnchanged(workspace,{...command,patientId:lucas},/different action/);
  rejectUnchanged(workspace,command,/different action/,now,'Another reviewer');
  rejectUnchanged(workspace,{type:'review.update',id:review.id,status:'Resolved',resolution:'Try to close before handoff completion.'},/Complete the handoff/);
});

test('a blank optional coordinator routes ordinary and urgent companion concerns to the named clinician',()=>{
  const patientId='TN-1042';
  const workspace=save(seedWorkspace(),{type:'context.update',patientId,allergyStatus:'Not reviewed',allergies:'',medicalHistory:'Updated history.',priorTreatments:'',painLocation:'',painDuration:'',physicalContext:'',psychologicalContext:'',socialContext:'',coordinator:'   ',preferences:''});
  const clinician=patient(workspace,patientId).clinician;
  assert.ok(clinician.trim());
  assert.equal(patient(workspace,patientId).clinicalContext.coordinator,'');
  for(const type of ['advisor.request','advisor.chat'])for(const concernUrgency of ['routine','urgent']){
    const requestId=`blank-coordinator-${type}-${concernUrgency}`;
    const action={type,patientId,requestId,text:'Please review my concern.',concernUrgency,...(type==='advisor.chat'?{intent:'concern'}:{})};
    const next=save(workspace,action);
    const handoff=next.clinicalWorkflows.slices['patient-coordination'].state.handoffs.find(row=>row.dedupeKey===requestId);
    assert.equal(handoff.responsiblePerson,clinician.trim());
    assert.equal(handoff.priority,concernUrgency==='urgent'?'high':'routine');
    assert.ok(next.messages.some(message=>message.patientId===patientId&&message.text===action.text));
    assert.ok(next.reviews.some(review=>review.patientId===patientId&&review.workflowRecordId===handoff.id));
    assert.deepEqual(save(next,action),next,'An exact retry preserves the saved message and handoff.');
  }
});

test('source handoff closure resolves its linked review and task only after action and patient response',()=>{
  let workspace=save(init(),{type:'advisor.request',patientId:emma,requestId:'source-closure-request',text:'Please clarify the recorded next step.',concernUrgency:'routine'});
  const handoffId=workspace.clinicalWorkflows.slices['patient-coordination'].state.handoffs.find(row=>row.dedupeKey==='source-closure-request').id;
  const getHandoff=()=>workspace.clinicalWorkflows.slices['patient-coordination'].state.handoffs.find(row=>row.id===handoffId);
  const originalReview=structuredClone(workspace.reviews.find(row=>row.workflowRecordId===handoffId));
  const advance=(phase,extra={})=>{
    const row=getHandoff(),requestId=crypto.randomUUID();
    const command={type:'patient-coordination.handoff.save',requestId,id:row.id,expectedVersion:row.version,patientId:emma,encounterId:row.encounterId,concern:row.concern,dedupeKey:row.dedupeKey,priority:row.priority,urgencySourceType:row.urgencySource.type,urgencySource:row.urgencySource.label,responsibleTeam:row.responsibleTeam,responsiblePerson:row.responsiblePerson,coverageExpectation:row.coverageExpectation,fallbackOwner:row.fallbackOwner,dueAt:row.dueAt,phase,deliveryStatus:'reported',deliveryEvidenceSource:'manual',deliveryEvidenceRef:'Named clinician documented a verbal handoff receipt.',patientContactStatus:'attempted',transitionReason:'Document the next handoff stage.',...extra};
    return {type:'workflow.apply',domain:'patient-coordination',patientId:emma,requestId,expectedSliceVersion:workspace.clinicalWorkflows.slices['patient-coordination'].version,command};
  };
  for(const phase of ['delivery-reported','ownership-accepted','reviewed'])workspace=save(workspace,advance(phase));
  let linkedReview=workspace.reviews.find(row=>row.workflowRecordId===handoffId),linkedTask=workspace.tasks.find(row=>row.workflowRecordId===handoffId);
  assert.equal(linkedReview.status,'Acknowledged');assert.equal(linkedTask.done,false);
  rejectUnchanged(workspace,advance('closed'),/handoff|action|response|stage|phase/i);
  const actionSummary='Clinician reviewed the question and documented the next step.',responseSummary='Patient received the explanation and confirmed the next step.';
  workspace=save(workspace,advance('action-documented',{actionSummary}));
  workspace=save(workspace,advance('response-recorded',{actionSummary,responseSummary,patientContactStatus:'successful'}));
  assert.equal(workspace.reviews.find(row=>row.id===originalReview.id).status,'Acknowledged');
  workspace=save(workspace,advance('closed',{actionSummary,responseSummary,patientContactStatus:'successful'}));
  linkedReview=workspace.reviews.find(row=>row.id===originalReview.id);linkedTask=workspace.tasks.find(row=>row.id===linkedTask.id);
  assert.equal(getHandoff().phase,'closed');assert.equal(linkedReview.status,'Resolved');assert.equal(linkedTask.done,true);
  assert.equal(linkedReview.workflowVersion,getHandoff().version);assert.equal(linkedTask.workflowVersion,getHandoff().version);
  assert.equal(linkedReview.resolution,responseSummary);assert.ok(linkedReview.history.some(entry=>entry.status==='Open'));
  assert.equal(workspace.reviews.filter(row=>row.id===originalReview.id).length,1);
  assert.ok(!openCareWork(workspace,emma).some(row=>row.sourceId===handoffId));
});
