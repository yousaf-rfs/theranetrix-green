import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

const bundle=await build({stdin:{contents:"export * from './lib/clinical-flows/decision-bridges';export {reduce} from './lib/clinical-flows/decisions';export {seedWorkspace} from './lib/theranetrix';export {applyAction} from './lib/actions';export {engineRecordRevision} from './lib/engine-demo';export {workflowInputRevision} from './lib/clinical-flows';export {retainTaskState} from './lib/record-history';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {projectDecisionWork,decisionWorkTaskId,reduce,seedWorkspace,applyAction,engineRecordRevision,workflowInputRevision,retainTaskState}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const patientId='TN-1042',encounterId='decision-work',now='2026-09-17T14:00:00.000Z',actor='Reviewer who recorded the decision';
const projectionContext={actor:'Unrelated projection caller',now:'2026-09-20T12:00:00Z'};
const monitoring={id:'stable-work',title:'Review the walking log',owner:'Named coordinator',dueAt:'2026-09-24T10:30:00+01:00'};
const clarification={id:'stable-work',title:'Confirm the comparison inputs',owner:'Named reviewer',dueAt:'2026-09-24T12:00:00Z'};
const state=workspace=>workspace.clinicalWorkflows.slices.decisions.state;
const tasks=workspace=>workspace.tasks.filter(task=>task.workflowDomain==='decisions');
const patient=workspace=>workspace.patients.find(row=>row.id===patientId);
function capture(workspace,kind,work,scope={patientId,encounterId},context={actor,now}){
  const next=structuredClone(workspace),rows=state(next)[kind==='monitoring'?'observedReviews':'engineComparisons'];
  const previous=rows.filter(row=>row.patientId===scope.patientId&&row.encounterId===scope.encounterId).sort((a,b)=>b.version-a.version)[0];
  const common={...scope,requestId:crypto.randomUUID(),expectedVersion:previous?.version??0,inputVersion:'source-v1'};
  const action=kind==='monitoring'?{
    ...common,type:'decisions.review.capture',collectedAt:now,receivedAt:now,provenance:'observed',metrics:{pain:{prior:6,current:5},function:{prior:4,current:5},sleep:{prior:5,current:5}},contradictoryMetrics:[],clinicalInterpretation:'Patient and clinician reviewed the current report.',goal:'Walk with fewer interruptions.',nextMonitoringQuestion:'How was walking this week?',...(work?{monitoring:work}:{}),
  }:{
    ...common,type:'decisions.outputs.capture',pst:{outputId:'sample-pst',summary:'Saved sample ranking.',limitations:['Demonstration rules.']},shadow:{outputId:'sample-shadow',summary:'Saved sample comparator.',limitations:['Demonstration rules.']},agreement:'partial',limitations:['Ranking agreement is not predictive confidence.'],supportingEvidence:[],conflictingEvidence:[],clarificationRequests:(work??[]).map(item=>item.title),clarificationWork:work??[],clinicianDisposition:'defer',dispositionExplanation:'Review the recorded questions.',suitability:'unsupported',provenance:'synthetic',modelVersions:[],configurationVersions:['sample-rules-v1'],
  };
  next.clinicalWorkflows.slices.decisions.state=reduce(state(next),action,{...context,patients:next.patients.map(({id,name})=>({id,name})),features:{}});
  return next;
}
const project=workspace=>projectDecisionWork(workspace,projectionContext);
const latest=(workspace,kind)=>state(workspace)[kind==='monitoring'?'observedReviews':'engineComparisons'][0];

test('current owned decision work reaches the shared queue without changing sources or input revisions',()=>{
  let source=capture(seedWorkspace(),'monitoring',monitoring);
  source=capture(source,'clarification',[clarification,{...clarification,id:'second-question',title:'Confirm the missing report'}]);
  const before=structuredClone(source),engineVersion=engineRecordRevision(patient(source),source),inputVersion=workflowInputRevision(patient(source),source);
  const workspace=project(source),queue=tasks(workspace);
  assert.deepEqual(source,before);assert.deepEqual(state(workspace),state(source));
  assert.deepEqual(workspace.patients,source.patients);assert.deepEqual(workspace.reviews,source.reviews);
  assert.deepEqual(workspace.tasks.filter(task=>task.workflowDomain!=='decisions'),source.tasks);
  assert.equal(queue.length,3);assert.equal(new Set(queue.map(task=>task.id)).size,3);
  const task=queue.find(task=>task.id===decisionWorkTaskId('monitoring',patientId,encounterId,monitoring.id));
  assert.deepEqual(task,{id:decisionWorkTaskId('monitoring',patientId,encounterId,monitoring.id),patientId,encounterId,workflowDomain:'decisions',workflowRecordId:latest(workspace,'monitoring').id,workflowVersion:1,title:monitoring.title,owner:monitoring.owner,date:'2026-09-24',time:'09:30',timezone:'UTC',type:'Care coordination',done:false,workflowDisposition:'pending'});
  assert.ok(queue.every(task=>task.workflowRecordId&&task.workflowVersion===1&&task.patientId===patientId));
  assert.equal(engineRecordRevision(patient(workspace),workspace),engineVersion);
  assert.equal(workflowInputRevision(patient(workspace),workspace),inputVersion);
  const saved=JSON.parse(JSON.stringify(workspace));
  assert.deepEqual(projectDecisionWork(saved,{actor:'Another caller',now:'2026-09-21T12:00:00Z'}),saved);
});

test('unchanged source intent retains completion, accepted ownership and attributed prior versions',()=>{
  let workspace=project(capture(seedWorkspace(),'monitoring',monitoring));
  const taskId=tasks(workspace)[0].id,sourceOne=structuredClone(latest(workspace,'monitoring'));
  workspace=applyAction(workspace,{type:'task.toggle',id:taskId,done:true},'Clinician who completed the work','2026-09-18T10:00:00Z');
  const completed=tasks(workspace)[0];
  retainTaskState(completed,'Receiving coordinator','2026-09-18T11:00:00Z','Ownership transfer accepted.');
  completed.owner='Receiving coordinator';completed.date='2026-09-25';completed.time='14:00';
  const operational=structuredClone(completed);
  assert.deepEqual(project(workspace),workspace);
  // The offset changes but the actual due instant and source intent do not.
  workspace=capture(workspace,'monitoring',{...monitoring,dueAt:'2026-09-24T09:30:00Z'},undefined,{actor:'Second reviewer',now:'2026-09-19T12:00:00Z'});
  const sourceTwo=structuredClone(latest(workspace,'monitoring'));
  workspace=project(workspace);
  const task=tasks(workspace)[0];
  assert.equal(tasks(workspace).length,1);assert.equal(task.id,taskId);assert.equal(task.done,true);
  assert.equal(task.owner,'Receiving coordinator');assert.equal(task.date,'2026-09-25');assert.equal(task.time,'14:00');
  assert.equal(task.workflowRecordId,sourceTwo.id);assert.equal(task.workflowVersion,2);assert.equal(task.workflowDisposition,'done');
  assert.equal(task.history.length,operational.history.length+1);
  assert.equal(task.history[0].workflowRecordId,sourceOne.id);assert.equal(task.history[0].workflowVersion,1);
  assert.equal(task.history[0].changedBy,'Second reviewer');assert.equal(task.history[0].changedAt,'2026-09-19T12:00:00Z');
  assert.match(task.history[0].reason,/intent and operational state retained/);
  assert.deepEqual(task.history.slice(1),operational.history);
  assert.deepEqual(state(workspace).observedReviews.find(row=>row.id===sourceOne.id),sourceOne);
  assert.deepEqual(latest(workspace,'monitoring'),sourceTwo);assert.deepEqual(project(workspace),workspace);
});

test('material title, owner or due-time changes reopen the same completed task',()=>{
  for(const change of [{title:'Review the new walking goal'},{owner:'New responsible clinician'},{dueAt:'2026-09-25T12:00:00Z'}]){
    let workspace=project(capture(seedWorkspace(),'clarification',[clarification]));
    const taskId=tasks(workspace)[0].id;
    workspace=applyAction(workspace,{type:'task.toggle',id:taskId,done:true},'Completing clinician','2026-09-18T10:00:00Z');
    const completed=structuredClone(tasks(workspace)[0]);
    workspace=project(capture(workspace,'clarification',[{...clarification,...change}],undefined,{actor:'Amending reviewer',now:'2026-09-19T11:00:00Z'}));
    const task=tasks(workspace)[0];
    assert.equal(tasks(workspace).length,1);assert.equal(task.id,taskId);assert.equal(task.done,false);assert.equal(task.workflowDisposition,'pending');
    assert.equal(task.title,change.title??clarification.title);assert.equal(task.owner,change.owner??clarification.owner);
    assert.equal(task.date,new Date(change.dueAt??clarification.dueAt).toISOString().slice(0,10));
    assert.equal(task.history[0].done,true);assert.equal(task.history[0].workflowRecordId,completed.workflowRecordId);
    assert.equal(task.history[0].changedBy,'Amending reviewer');assert.match(task.history[0].reason,/changed.*reopened/);
    assert.deepEqual(task.history.slice(1),completed.history);assert.deepEqual(project(workspace),workspace);
  }
});

test('removal closes work with a withdrawal reason; reinstatement reopens without replaying historical tasks',()=>{
  for(const kind of ['monitoring','clarification']){
    const work=kind==='monitoring'?monitoring:clarification,wrap=item=>kind==='monitoring'?item:item?[item]:[];
    let workspace=project(capture(seedWorkspace(),kind,wrap(work)));
    const original=structuredClone(latest(workspace,kind)),taskId=tasks(workspace)[0].id;
    workspace=project(capture(workspace,kind,wrap(undefined),undefined,{actor:'Withdrawing reviewer',now:'2026-09-18T14:00:00Z'}));
    const removed=structuredClone(tasks(workspace)[0]);
    assert.equal(removed.done,true);assert.equal(removed.workflowDisposition,'deferred');assert.equal(removed.workflowVersion,2);
    assert.match(removed.history[0].reason,/withdrawn.*latest review no longer includes/);assert.equal(removed.history[0].changedBy,'Withdrawing reviewer');
    assert.equal(removed.history[0].workflowRecordId,original.id);assert.equal(removed.history[0].done,false);
    assert.deepEqual(project(workspace),workspace);assert.equal(tasks(workspace).length,1);
    workspace=project(capture(workspace,kind,wrap(work),undefined,{actor:'Reinstating reviewer',now:'2026-09-19T14:00:00Z'}));
    const restored=tasks(workspace)[0];
    assert.equal(restored.id,taskId);assert.equal(restored.done,false);assert.equal(restored.workflowDisposition,'pending');assert.equal(restored.workflowVersion,3);
    assert.equal(restored.history[0].workflowDisposition,'deferred');assert.match(restored.history[0].reason,/reinstated.*reopened/);
    assert.equal(restored.history[0].changedBy,'Reinstating reviewer');assert.deepEqual(restored.history.slice(1),removed.history);
    assert.deepEqual(state(workspace)[kind==='monitoring'?'observedReviews':'engineComparisons'].find(row=>row.id===original.id),original);
    assert.deepEqual(project(workspace),workspace);
  }
});

test('patient, encounter and work-kind boundaries prevent collisions and unrelated queue changes',()=>{
  let workspace=capture(seedWorkspace(),'monitoring',monitoring);
  workspace=capture(workspace,'monitoring',monitoring,{patientId:'TN-1038',encounterId});
  workspace=capture(workspace,'monitoring',monitoring,{patientId,encounterId:'another-encounter'});
  workspace=capture(workspace,'clarification',[clarification]);
  workspace=project(workspace);
  assert.equal(tasks(workspace).length,4);assert.equal(new Set(tasks(workspace).map(task=>task.id)).size,4);
  const unrelated=structuredClone(tasks(workspace).filter(task=>task.patientId!==patientId||task.encounterId!==encounterId||task.id.includes('clarification')));
  workspace=project(capture(workspace,'monitoring',undefined));
  for(const row of unrelated)assert.deepEqual(workspace.tasks.find(task=>task.id===row.id),row);
  const initial=capture(seedWorkspace(),'monitoring',monitoring),foreign=structuredClone(initial);
  foreign.tasks.push({...tasks(project(initial))[0],patientId:'TN-1038'});
  const before=structuredClone(foreign);
  assert.throws(()=>project(foreign),/source or patient scope/);assert.deepEqual(foreign,before);
  const duplicate=project(initial);duplicate.tasks.push(structuredClone(tasks(duplicate)[0]));
  assert.throws(()=>project(duplicate),/task identifiers must be unique/);
});

test('corrupt or ambiguous source scope is rejected without changing the workspace',()=>{
  const initial=capture(seedWorkspace(),'monitoring',monitoring);
  const missing=structuredClone(initial);missing.patients=missing.patients.filter(row=>row.id!==patientId);
  assert.throws(()=>project(missing),/patient not found/);
  const ambiguous=structuredClone(initial);state(ambiguous).observedReviews.push({...structuredClone(latest(ambiguous,'monitoring')),id:'another-record-at-same-version'});
  const before=structuredClone(ambiguous);
  assert.throws(()=>project(ambiguous),/versions must be unambiguous/);assert.deepEqual(ambiguous,before);
  const repeated=capture(seedWorkspace(),'clarification',[clarification]);latest(repeated,'clarification').clarificationWork.push(structuredClone(clarification));
  assert.throws(()=>project(repeated),/work identifiers must be unique/);
  assert.throws(()=>projectDecisionWork(initial,{actor:'',now}),/server actor and time/);
  assert.throws(()=>projectDecisionWork(initial,{actor,now:'invalid'}),/server actor and time/);
});
