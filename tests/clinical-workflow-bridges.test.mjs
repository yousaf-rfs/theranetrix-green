import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

const bundle=await build({stdin:{contents:"export {seedWorkspace} from './lib/theranetrix'; export {applyAction} from './lib/actions'; export {followupState} from './lib/medications'; export {reduce as reduceEncounters} from './lib/clinical-flows/encounters'; export {reduce as reduceCoordination} from './lib/clinical-flows/patient-coordination'; export {reduce as reduceResults} from './lib/clinical-flows/results-referrals'; export * from './lib/clinical-flows/bridges';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {seedWorkspace,reduceEncounters,reduceCoordination,reduceResults,applyAction,followupState,applyWorkflowBridges}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const now='2026-09-27T14:00:00Z',actor='Clinician who confirmed the record',patientId='TN-1042';
const patient=workspace=>workspace.patients.find(item=>item.id===patientId);
function apply(workspace,fields,encounterId='bridge-test',context={actor,now}){
  const next=structuredClone(workspace);
  const command={patientId,encounterId,requestId:crypto.randomUUID(),...fields};
  next.clinicalWorkflows.slices.encounters.state=reduceEncounters(next.clinicalWorkflows.slices.encounters.state,command,{...context,patients:next.patients.map(({id,name})=>({id,name})),features:{assessments:true}});
  return applyWorkflowBridges(next,'encounters',{actor:'An unrelated triggering account',now:'2026-09-28T00:00:00Z'});
}
function record(workspace,collection,encounterId='bridge-test'){return workspace.clinicalWorkflows.slices.encounters.state[collection].find(item=>item.encounterId===encounterId);}
function cleanWorkspace(){const workspace=seedWorkspace();patient(workspace).carePlans=[];patient(workspace).notes=[];workspace.tasks=workspace.tasks.filter(item=>item.patientId!==patientId);return workspace;}
function assessed(workspace){return apply(workspace,{type:'encounters.assessment.save',presentingProblem:'Patient reports difficulty walking.',painDistributionPhenotype:'Back discomfort.',timeline:'Clinician documented timeline.',relevantExamination:'Clinician documented examination.',comorbidContext:'Reviewed.',psychologicalContext:'Reviewed.',socialContext:'Reviewed.',workingAssessment:'Clinician documented working assessment.',alternatives:[],supportingFindings:['Patient report'],refutingFindings:[],uncertainty:'Follow-up will assess progress.',furtherWorkup:'',route:'continue-local',deferReason:''});}
function draft(workspace){return apply(workspace,{type:'encounters.signoff.saveDraft',assessmentRecordId:record(workspace,'assessments').id,rationale:'Clinician and patient reviewed the plan.',patientFacingPlan:'Keep the agreed walking log.',disposition:{selected:[],rejected:[],deferred:[],noChange:true},owner:'Named clinician',followUp:{date:'2026-09-30',time:'09:30',timezone:'Europe/Lisbon'},pendingWork:[{title:'Review walking log',owner:'Named nurse',disposition:'pending'},{title:'Review baseline document',owner:'Named clinician',dueDate:'2026-09-29',disposition:'done'}],teachBack:'Patient repeated the plan in their own words.'});}
function sign(workspace,id){let current=workspace.clinicalWorkflows.slices.encounters.state.signoffs.find(item=>item.id===id);workspace=apply(workspace,{type:'encounters.signoff.review',id,expectedVersion:current.version,reason:'Reviewed before signing.'});current=workspace.clinicalWorkflows.slices.encounters.state.signoffs.find(item=>item.id===id);return apply(workspace,{type:'encounters.signoff.sign',id,expectedVersion:current.version,reason:'Clinician signed the reviewed record.'});}

test('only a signed plan reaches shared care plans, documentation and unbooked coordination tasks',()=>{
  const initial=cleanWorkspace(),snapshot=structuredClone(initial);
  let workspace=draft(assessed(initial));
  assert.deepEqual(initial,snapshot);
  assert.equal(patient(workspace).carePlans.length,0);
  assert.equal(workspace.tasks.filter(item=>item.patientId===patientId).length,0);
  const signoffId=record(workspace,'signoffs').id;
  workspace=sign(workspace,signoffId);
  const plan=patient(workspace).carePlans[0],note=patient(workspace).notes.find(item=>item.workflowRecordId===signoffId);
  assert.equal(plan.text,'Keep the agreed walking log.');
  assert.equal(plan.author,actor);assert.equal(note.author,actor);assert.equal(plan.date,now);
  assert.equal(plan.workflowRecordId,signoffId);assert.equal(plan.encounterId,'bridge-test');
  assert.equal(plan.appointmentBooked,false);assert.equal(plan.timezone,'Europe/Lisbon');
  const tasks=workspace.tasks.filter(item=>item.patientId===patientId);
  assert.equal(tasks.length,3);assert.ok(tasks.every(item=>item.type==='Care coordination'&&item.planId===plan.id));
  assert.equal(tasks.find(item=>item.title==='Review walking log').date,'');
  assert.equal(tasks.find(item=>item.title==='Review walking log').time,'');
  assert.equal(tasks.find(item=>item.title==='Review baseline document').done,true);
  assert.equal(patient(workspace).nextVisit,patient(initial).nextVisit);
  assert.deepEqual(applyWorkflowBridges(workspace,'encounters',{actor:'Different caller',now}),workspace);
});

test('amendments preserve the original signed plan, task completion and task history without duplicates',()=>{
  let workspace=draft(assessed(cleanWorkspace()));workspace=sign(workspace,record(workspace,'signoffs').id);
  const originalSignoff=record(workspace,'signoffs'),originalPlan=structuredClone(patient(workspace).carePlans[0]);
  workspace.tasks.find(item=>item.title==='Review walking log').done=true;
  workspace=apply(workspace,{type:'encounters.signoff.amend',id:originalSignoff.id,expectedVersion:originalSignoff.version,amendmentReason:'Clarify the same agreed activity.',patientFacingPlan:'Keep the agreed walking log and bring it to review.'});
  assert.deepEqual(patient(workspace).carePlans,[originalPlan]);
  const amendment=workspace.clinicalWorkflows.slices.encounters.state.signoffs.find(item=>item.amendedFromId===originalSignoff.id);
  workspace=sign(workspace,amendment.id);
  const plans=patient(workspace).carePlans;
  assert.equal(plans.length,2);assert.equal(plans[0].supersedes,originalPlan.id);assert.deepEqual(plans[1],originalPlan);
  assert.equal(plans[0].workflowRecordId,amendment.id);
  const task=workspace.tasks.find(item=>item.title==='Review walking log');
  assert.equal(task.done,true);assert.equal(task.planId,plans[0].id);assert.equal(task.history.length,1);
  assert.equal(task.history[0].planId,originalPlan.id);assert.equal(task.history[0].done,true);
  const repeated=applyWorkflowBridges(workspace,'encounters',{actor,now});
  assert.deepEqual(repeated,workspace);
  assert.equal(repeated.tasks.filter(item=>item.patientId===patientId).length,3);
});

test('confirmed partial observations preserve zero and missing values without inventing trajectory data',()=>{
  const initial=cleanWorkspace(),originalTrajectory=structuredClone(patient(initial).pain),originalCheckins=patient(initial).checkins.length;
  let workspace=apply(initial,{type:'encounters.observations.save',instrument:'local-0-10',submissionStatus:'draft',entries:[{metric:'pain',status:'answered',value:9,source:'Unconfirmed draft',recordedAt:now}]});
  assert.equal(patient(workspace).workflowObservations,undefined);
  workspace=apply(workspace,{type:'encounters.observations.save',expectedVersion:record(workspace,'observations').version,instrument:'local-0-10',submissionStatus:'confirmed',entries:[{metric:'pain',status:'zero',value:0,source:'Patient report',recordedAt:now},{metric:'function',status:'unanswered',source:'Patient report',recordedAt:now},{metric:'sleep',status:'declined',source:'Patient report',recordedAt:now}]});
  const reports=patient(workspace).workflowObservations;
  assert.equal(reports.length,3);assert.equal(reports.find(item=>item.metric==='pain').value,0);
  assert.equal(reports.find(item=>item.metric==='sleep').value,undefined);
  assert.ok(reports.every(item=>item.source==='Patient report'&&item.confirmedBy===actor));
  assert.deepEqual(patient(workspace).pain,originalTrajectory);assert.equal(patient(workspace).checkins.length,originalCheckins);
  assert.deepEqual(applyWorkflowBridges(workspace,'encounters',{actor,now}),workspace);
});

test('complete reports and corrections update one trajectory point while retaining immutable observations',()=>{
  const initial=cleanWorkspace(),initialCount=patient(initial).pain.length;
  const entries=[{metric:'pain',status:'zero',value:0,source:'Patient report',recordedAt:now},{metric:'function',status:'answered',value:5,source:'Patient report',recordedAt:now},{metric:'sleep',status:'answered',value:6,source:'Patient report',recordedAt:now}];
  let workspace=apply(initial,{type:'encounters.observations.save',instrument:'local-0-10',submissionStatus:'confirmed',entries});
  const firstReport=record(workspace,'observations'),firstCheckin=structuredClone(patient(workspace).checkins.find(item=>item.workflowRecordId===firstReport.id));
  const originalObservation=structuredClone(patient(workspace).workflowObservations.find(item=>item.metric==='pain'));
  assert.equal(patient(workspace).pain.length,initialCount+1);assert.equal(patient(workspace).pain.at(-1),0);
  workspace=apply(workspace,{type:'encounters.observations.correct',expectedVersion:firstReport.version,reason:'Patient corrected the score.',replacement:{metric:'pain',status:'answered',value:2,source:'Patient clarification',recordedAt:now}});
  assert.equal(patient(workspace).pain.length,initialCount+1);assert.equal(patient(workspace).pain.at(-1),2);
  const checkins=patient(workspace).checkins.filter(item=>item.workflowRecordId===firstReport.id);
  assert.equal(checkins.length,2);assert.equal(checkins[0].supersedes,firstCheckin.id);
  assert.equal(checkins.find(item=>item.id===firstCheckin.id).pain,0);
  assert.deepEqual(patient(workspace).workflowObservations.find(item=>item.id===originalObservation.id),originalObservation);
  const corrected=patient(workspace).workflowObservations.find(item=>item.correctedFromEntryId===originalObservation.id);
  assert.equal(corrected.value,2);assert.equal(corrected.workflowVersion,2);
  assert.deepEqual(applyWorkflowBridges(workspace,'encounters',{actor,now}),workspace);
  workspace=apply(workspace,{type:'encounters.observations.correct',expectedVersion:2,reason:'Patient withdrew the sleep response.',replacement:{metric:'sleep',status:'declined',source:'Patient clarification',recordedAt:now}});
  assert.equal(patient(workspace).pain.length,initialCount);
  assert.equal(patient(workspace).workflowObservations.at(-1).status,'declined');
  assert.equal(patient(workspace).checkins.filter(item=>item.workflowRecordId===firstReport.id).length,2);
  assert.deepEqual(applyWorkflowBridges(workspace,'encounters',{actor,now}),workspace);
});

test('corrections to partial reports retain original provenance and name the actual correcting clinician',()=>{
  let workspace=apply(cleanWorkspace(),{type:'encounters.observations.save',instrument:'local-0-10',submissionStatus:'confirmed',entries:[{metric:'pain',status:'zero',value:0,source:'Initial patient report',recordedAt:now},{metric:'function',status:'unanswered',source:'Initial patient report',recordedAt:now}]});
  const original=structuredClone(patient(workspace).workflowObservations);
  const correctionTime='2026-09-28T11:00:00Z',correctionActor='Clinician who obtained the clarification';
  workspace=apply(workspace,{type:'encounters.observations.correct',expectedVersion:1,reason:'Patient clarified the previously unanswered score.',replacement:{metric:'function',status:'answered',value:5,source:'Patient clarification',recordedAt:now}},'bridge-test',{actor:correctionActor,now:correctionTime});
  for(const entry of original)assert.deepEqual(patient(workspace).workflowObservations.find(item=>item.id===entry.id),entry);
  const correction=patient(workspace).workflowObservations.find(item=>item.correctedFromEntryId);
  assert.equal(correction.confirmedBy,correctionActor);assert.equal(correction.confirmedAt,correctionTime);
  const note=patient(workspace).notes.find(item=>item.workflowRecordId===record(workspace,'observations').id&&item.workflowVersion===2);
  assert.equal(note.type,'Corrected observation report');assert.equal(note.author,correctionActor);assert.equal(note.date,correctionTime);
});

function applyDomain(workspace,domain,fields){
  const next=structuredClone(workspace),reduce=domain==='patient-coordination'?reduceCoordination:reduceResults;
  const command=Object.fromEntries(Object.entries({patientId,encounterId:'coordination-bridge',requestId:crypto.randomUUID(),...fields}).filter(([,value])=>value!==undefined));
  next.clinicalWorkflows.slices[domain].state=reduce(next.clinicalWorkflows.slices[domain].state,command,{actor,now,patients:next.patients.map(({id,name})=>({id,name})),features:{}});
  return applyWorkflowBridges(next,domain,{actor,now});
}
const handoffFields={type:'patient-coordination.handoff.save',concern:'Patient requested a care-team callback.',dedupeKey:'callback-concern',priority:'high',urgencySourceType:'authorized-human',urgencySource:'Named clinician documented the priority.',responsibleTeam:'Care team',responsiblePerson:'Responsible clinician',coverageExpectation:'Review during the current shift.',fallbackOwner:'On-call clinician',phase:'locally-saved',deliveryStatus:'pending',deliveryEvidenceSource:'none',patientContactStatus:'not-attempted',dueAt:'2026-09-30T09:30:00+01:00',transitionReason:'Staff recorded the patient concern.'};

test('human handoffs project to one attributed queue row, preserve manual changes and close only with the source',()=>{
  const initial=cleanWorkspace(),otherPatient=structuredClone(initial.patients.find(item=>item.id!==patientId)),messages=structuredClone(initial.messages);
  let workspace=applyDomain(initial,'patient-coordination',handoffFields);
  const source=()=>workspace.clinicalWorkflows.slices['patient-coordination'].state.handoffs.find(item=>item.id===handoffId);
  const handoffId=workspace.clinicalWorkflows.slices['patient-coordination'].state.handoffs[0].id;
  const queue=()=>workspace.reviews.find(item=>item.workflowRecordId===handoffId);
  assert.equal(queue().status,'Open');assert.equal(queue().priority,'High');assert.equal(queue().owner,'Responsible clinician');
  assert.equal(queue().updatedBy,actor);assert.equal(queue().dueAt,handoffFields.dueAt);
  const task=workspace.tasks.find(item=>item.workflowRecordId===handoffId);
  assert.equal(task.type,'Care coordination');assert.equal(task.date,'2026-09-30');assert.equal(task.time,'08:30');assert.equal(task.timezone,'UTC');
  assert.deepEqual(applyWorkflowBridges(workspace,'patient-coordination',{actor:'Unrelated caller',now}),workspace);
  assert.throws(()=>applyAction(workspace,{type:'review.update',id:queue().id,status:'Resolved',resolution:'Attempted queue-only closure.'},'Manual reviewer',now),/Complete the handoff/);
  workspace=applyAction(workspace,{type:'review.update',id:queue().id,status:'Acknowledged',resolution:'Manual queue review acknowledged; source handoff remains open.'},'Manual reviewer',now);
  assert.equal(applyWorkflowBridges(workspace,'patient-coordination',{actor,now}).reviews.find(item=>item.id===queue().id).status,'Acknowledged');
  for(const phase of ['delivery-reported','ownership-accepted','reviewed','action-documented','response-recorded','closed']){
    const actionStage=['action-documented','response-recorded','closed'].includes(phase),responseStage=['response-recorded','closed'].includes(phase);
    workspace=applyDomain(workspace,'patient-coordination',{...handoffFields,id:handoffId,expectedVersion:source().version,phase,deliveryStatus:'reported',deliveryEvidenceSource:'manual',deliveryEvidenceRef:'Documented receiving-clinician acknowledgement',patientContactStatus:responseStage?'successful':'attempted',...(actionStage?{actionSummary:'Clinician documented the callback action.'}:{}),...(responseStage?{responseSummary:'Patient received the clinician response.'}:{})});
    assert.equal(queue().status,phase==='closed'?'Resolved':phase==='delivery-reported'?'Open':'Acknowledged');
  }
  assert.ok(queue().history.some(item=>item.actor==='Manual reviewer'&&item.resolution.includes('Manual queue review')));
  assert.deepEqual(queue().workflowHistory,source().history);
  assert.equal(workspace.tasks.find(item=>item.workflowRecordId===handoffId).done,true);
  assert.equal(workspace.reviews.filter(item=>item.workflowRecordId===handoffId).length,1);
  const closed=structuredClone(queue());
  workspace=applyDomain(workspace,'patient-coordination',handoffFields);
  const newId=workspace.clinicalWorkflows.slices['patient-coordination'].state.handoffs[0].id;
  assert.notEqual(newId,handoffId);assert.deepEqual(queue(),closed);
  assert.equal(workspace.reviews.find(item=>item.workflowRecordId===newId).status,'Open');
  assert.deepEqual(workspace.messages,messages);assert.deepEqual(workspace.patients.find(item=>item.id===otherPatient.id),otherPatient);
  assert.equal(patient(workspace).nextVisit,patient(initial).nextVisit);
});

test('handoff without a due time stays in the queue and scheduling outreach stays explicitly unbooked',()=>{
  let workspace=applyDomain(cleanWorkspace(),'patient-coordination',{...handoffFields,dueAt:undefined});
  const handoff=workspace.clinicalWorkflows.slices['patient-coordination'].state.handoffs[0];
  assert.equal(workspace.tasks.some(item=>item.workflowRecordId===handoff.id),false);
  const fields={type:'patient-coordination.schedule.save',dueWindowTimezone:'Europe/Lisbon',phase:'follow-up-due',dueWindowStart:'2026-09-29',dueWindowEnd:'2026-10-01',owner:'Scheduling coordinator',preferredChannel:'phone',optedOut:false,bookingEvidenceSource:'none',outreachStatus:'not-started',transitionReason:'Follow-up is due, with no booking claimed.'};
  workspace=applyDomain(workspace,'patient-coordination',fields);
  let schedule=workspace.clinicalWorkflows.slices['patient-coordination'].state.scheduling[0];
  let task=workspace.tasks.find(item=>item.workflowRecordId===schedule.id);
  assert.equal(task.date,'2026-10-01');assert.equal(task.time,'');assert.equal(task.type,'Care coordination');assert.equal(schedule.appointment,undefined);
  workspace=applyDomain(workspace,'patient-coordination',{...fields,id:schedule.id,expectedVersion:schedule.version,phase:'requested',outreachStatus:'retry-scheduled',nextAttemptAt:'2026-10-01T10:00:00+01:00'});
  schedule=workspace.clinicalWorkflows.slices['patient-coordination'].state.scheduling[0];task=workspace.tasks.find(item=>item.workflowRecordId===schedule.id);
  assert.equal(task.time,'09:00');assert.equal(task.timezone,'UTC');assert.equal(task.owner,'Scheduling coordinator');assert.equal(task.history.length,1);
  assert.equal(schedule.appointment,undefined);assert.equal(workspace.tasks.filter(item=>item.workflowRecordId===schedule.id).length,1);
  assert.deepEqual(applyWorkflowBridges(workspace,'patient-coordination',{actor,now}),workspace);
});

test('result follow-up task closes and reopens with explicit source transitions while notes stay versioned',()=>{
  let workspace=applyDomain(cleanWorkspace(),'results-referrals',{type:'results-referrals.result.create',id:'bridged-result',expectedVersion:0,requestLabel:'Recorded lab follow-up',owner:'Lab reviewer',requestedAt:'2026-09-27',dueAt:'2026-09-29',reason:'Document the requested test.'});
  const task=()=>workspace.tasks.find(item=>item.workflowRecordId==='bridged-result');
  assert.equal(task().done,false);assert.equal(task().type,'Care coordination');assert.equal(task().time,'');
  workspace=applyDomain(workspace,'results-referrals',{type:'results-referrals.result.cancel',id:'bridged-result',expectedVersion:1,reason:'Patient deferred the requested test.',encounterId:undefined});
  assert.equal(task().done,true);assert.equal(task().history[0].done,false);
  workspace=applyDomain(workspace,'results-referrals',{type:'results-referrals.result.reopen',id:'bridged-result',expectedVersion:2,reason:'Patient elected to resume the test.',encounterId:undefined});
  assert.equal(task().done,false);assert.equal(task().history[0].done,true);
  const notes=patient(workspace).notes.filter(item=>item.workflowRecordId==='bridged-result');
  assert.equal(notes.length,3);assert.ok(notes[0].supersedes);assert.match(notes[2].text,/requested/);
  assert.deepEqual(applyWorkflowBridges(workspace,'results-referrals',{actor,now}),workspace);
});

test('current signed plan follow-up supersedes a completed legacy plan task',()=>{
  let workspace=cleanWorkspace();
  patient(workspace).carePlans.push({id:'legacy-plan',text:'Old plan',owner:'Previous clinician',followup:'2026-09-20',time:'09:00',date:'2026-09-15T10:00:00Z',author:'Previous clinician'});
  workspace.tasks.push({id:'medication-followup-'+patientId,patientId,title:'Legacy treatment review',date:'2026-09-20',time:'09:00',type:'Care coordination',done:true,planId:'legacy-plan'});
  workspace=draft(assessed(workspace));workspace=sign(workspace,record(workspace,'signoffs').id);
  const current=patient(workspace).carePlans[0],task=workspace.tasks.find(item=>item.planId===current.id&&item.title==='Encounter follow-up due');
  assert.equal(followupState(patient(workspace),workspace).completed,false);
  workspace=applyAction(workspace,{type:'task.toggle',id:task.id,done:true},actor,now);
  assert.equal(followupState(patient(workspace),workspace).completed,true);
});
