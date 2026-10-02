import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

const compiled=await build({stdin:{contents:"export * from './lib/theranetrix';export * from './lib/demo-showcase';export * from './lib/engine-demo';export * from './lib/care-operations';export * from './lib/clinical-flows';export * from './lib/clinical-flows/story-completion';export * from './lib/clinical-flows/governance-runtime';export {reviewedPlanTranslation} from './lib/clinical-flows/patient-coordination';export {workflowBridgeId} from './lib/clinical-flows/bridges';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {seedWorkspace,ensureShowcaseData,ensureStoryCompletion,normalizeClinicalWorkflows,applyWorkflowAction,applyCareOperations,engineRecordRevision,workflowInputRevision,buildEngineOutput,requireGovernedUse,reviewedPlanTranslation,workflowBridgeId}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const now='2026-09-17T12:00:00.000Z',actor='Story reviewer';
const ids=['TN-DEMO-01','TN-DEMO-02','TN-DEMO-03'];
const encounter=id=>'story-completion-v2-'+id;
const patient=(w,id)=>w.patients.find(row=>row.id===id);
const state=w=>w.clinicalWorkflows.slices.decisions.state;
const scope=(rows,id)=>rows.find(row=>row.patientId===id&&row.encounterId===encounter(id));
const complete=()=>ensureStoryCompletion(ensureShowcaseData(seedWorkspace(),actor,now),actor,now);
const apply=(w,domain,command)=>applyWorkflowAction(w,{type:'workflow.apply',domain,...(domain==='program-governance'?{}:{patientId:command.patientId}),requestId:command.requestId,expectedSliceVersion:w.clinicalWorkflows.slices[domain].version,command},actor,now);

test('the three stories freeze actual current governed runs, reviewed inputs and complete care packages',()=>{
  const w=complete();
  assert.deepEqual(normalizeClinicalWorkflows(w.clinicalWorkflows),w.clinicalWorkflows);
  for(const id of ids){
    const p=patient(w,id),signed=scope(state(w).signedSnapshots,id),working=scope(state(w).workingCopies,id);
    assert.ok(signed,id+' has an immutable signed decision');
    assert.ok(working,id+' has a separate resumable working copy');
    assert.equal(signed.actor,actor);
    assert.equal(signed.inputVersion,workflowInputRevision(p,w),'all source writes precede capture');
    assert.equal(working.inputVersion,signed.inputVersion);
    assert.ok(working.form.draftNote.length>40);
    assert.equal(scope(state(w).drafts,id).status,'signed');
    const reviewed=signed.reviewedInput,run=w.engineRuns.find(row=>row.id===reviewed.comparisonSnapshot.sourceRunId);
    assert.ok(run?.id.startsWith('story-v2-run-'));
    assert.equal(run.revision,engineRecordRevision(p,w));
    assert.deepEqual(run.candidates,buildEngineOutput(p,w,run.preferences).candidates);
    assert.deepEqual(run.releaseRef,requireGovernedUse(w,'digitalTwin',now));
    assert.deepEqual(reviewed.comparisonSnapshot.sourceRunSnapshot,run);
    assert.deepEqual(reviewed.engineComparison.sourceRunSnapshot,run);
    assert.equal(reviewed.engineComparison.sourceRunId,run.id);
    assert.notEqual(reviewed.engineComparison.pst.outputId,reviewed.engineComparison.shadow.outputId);
    assert.equal(reviewed.observedReview.goal,p.goal);
    assert.equal(signed.patientPlanRef,p.carePlans[0].id);
    assert.equal(signed.carePackage.instructions,p.carePlans[0].text);
    assert.ok(signed.carePackage.notes.length,'signed encounter notes are in the package');
    assert.ok(signed.carePackage.tasks.length,'owned follow-up is in the package');
    assert.equal(signed.carePackage.followUp.timezone,'Europe/Lisbon');
    assert.equal(signed.sourceSnapshot.facts.Goal,p.goal);
    assert.equal(working.sourceSnapshot.inputVersion,signed.inputVersion);
    assert.ok(state(w).drafts.some(row=>row.patientId===id&&row.encounterId==='review-'+id),'the previous review draft remains available');
  }
});

test('reviewed Spanish belongs to the current plan and teach-back amendments retain the original question and owner',()=>{
  const w=complete(),p=patient(w,ids[0]);
  const signs=w.clinicalWorkflows.slices.encounters.state.signoffs.filter(row=>row.patientId===p.id&&row.encounterId==='review-'+p.id);
  const original=signs.find(row=>!row.amendedFromId),question=signs.find(row=>row.teachBackOutcome==='needs-clarification'),understood=signs.find(row=>row.teachBackOutcome==='understood');
  assert.equal(original.teachBackOutcome,undefined,'legacy free text is not promoted into a structured result');
  assert.equal(question.amendedFromId,original.id);
  assert.equal(understood.amendedFromId,question.id);
  assert.equal(question.signedSnapshot.clarification.owner,'Alex Morgan, NP');
  assert.match(question.signedSnapshot.clarification.question,/confirm the appointment/);
  assert.equal(understood.clarification,undefined);
  assert.equal(understood.signedSnapshot.teachBackOutcome,'understood');
  assert.equal(p.carePlans[0].workflowRecordId,understood.id);
  assert.equal(p.carePlans[0].supersedes,p.carePlans.find(row=>row.workflowRecordId===question.id).id);
  assert.equal(original.patientFacingPlan,understood.patientFacingPlan,'clarification does not change treatment instructions');
  assert.equal(understood.followUp.appointmentBooked,false);
  const task=w.tasks.find(row=>row.id===workflowBridgeId('clarification',p.id,'review-'+p.id));
  assert.equal(task.done,true);assert.equal(task.owner,'Alex Morgan, NP');
  assert.ok(task.history.some(row=>row.done===false&&row.owner==='Alex Morgan, NP'));
  const translation=reviewedPlanTranslation(w.clinicalWorkflows.slices['patient-coordination'].state,p.id,p.carePlans[0].id,p.carePlans[0].workflowVersion,'es');
  assert.equal(p.preferredLanguage,'en');
  assert.equal(translation.sourceText,p.carePlans[0].text);
  assert.match(translation.translatedText,/medicación actual sin cambios/);
  assert.equal(translation.translationReviewer,'Sofía Alvarez, language support reviewer');
  assert.equal(translation.verifiedPatientAuth,false);
  assert.equal(reviewedPlanTranslation(w.clinicalWorkflows.slices['patient-coordination'].state,p.id,p.carePlans.find(row=>row.workflowRecordId===question.id).id,3,'es'),undefined);
});

test('coverage, remote interruption and no-response have saved owners and follow-up without fabricated completion',()=>{
  const w=complete(),ops=w.careOperations;
  assert.equal(ops.coverage.length,3);
  for(const row of ops.coverage){assert.equal(row.owner,'Dr. Maya Chen');assert.equal(row.backup,'Alex Morgan, NP');assert.ok(row.evidence&&row.startsAt&&row.endsAt);}
  const lucas=ops.remoteVisits.filter(row=>row.patientId===ids[1]);
  assert.deepEqual(lucas.map(row=>row.status),['completed','connected','alternative-arranged','interrupted','connected']);
  assert.equal(lucas[0].channel,'phone');
  const priya=ops.remoteVisits.filter(row=>row.patientId===ids[2]);
  assert.deepEqual(priya.map(row=>row.status),['interrupted','connected']);
  assert.equal(priya[0].nextAttemptAt,'2026-09-17T12:30:00.000Z');
  const remoteTask=id=>w.tasks.find(row=>row.id===workflowBridgeId('remote-recovery',id,encounter(id)));
  assert.equal(remoteTask(ids[1]).done,true);
  assert.ok(remoteTask(ids[1]).history.some(row=>!row.done));
  assert.equal(remoteTask(ids[2]).done,false);
  assert.equal(remoteTask(ids[2]).owner,'Alex Morgan, NP');
  const missing=ops.monitoring.find(row=>row.patientId===ids[0]);
  assert.equal(missing.status,'no-response');assert.equal(missing.nextAttemptAt,'2026-09-17T14:00:00.000Z');
  const gapTask=w.tasks.find(row=>row.id===workflowBridgeId('monitoring-recovery',ids[0],'monitoring'));
  assert.equal(gapTask.done,false);assert.equal(gapTask.title,'Contact patient about missing report');
  assert.match(scope(state(w).signedSnapshots,ids[2]).displayedOutputs.summary,/assessment remains incomplete/);
  assert.match(scope(state(w).signedSnapshots,ids[0]).displayedOutputs.summary,/not evidence of clinical deterioration/);
});

test('reloading, different actors and later patient edits retain completed stories and every frozen source',()=>{
  const initial=complete(),persisted=JSON.parse(JSON.stringify(initial));
  assert.deepEqual(ensureStoryCompletion(persisted,'Another reviewer','2026-09-19T10:00:00.000Z'),persisted);
  const before=structuredClone(state(persisted).signedSnapshots);
  patient(persisted,ids[0]).goal='Return to two short study sessions each day';
  const working=scope(state(persisted).workingCopies,ids[0]);
  const edited=apply(persisted,'decisions',{type:'decisions.working.save',requestId:'operator-working-edit',patientId:ids[0],encounterId:encounter(ids[0]),id:working.id,expectedVersion:working.version,inputVersion:working.inputVersion,form:{...working.form,draftNote:'The clinician saved this unfinished note after the patient changed the goal.'}});
  const after=ensureStoryCompletion(edited,actor,'2026-09-19T10:00:00.000Z');
  assert.deepEqual(after,edited,'loading does not re-sign against new sources or replace unfinished text');
  assert.deepEqual(state(after).signedSnapshots,before);
  assert.notEqual(scope(state(after).signedSnapshots,ids[0]).inputVersion,workflowInputRevision(patient(after,ids[0]),after),'new information leaves prior signatures historical');
});

test('an edited plan and existing contact preferences are preserved on first completion; unrelated patients are untouched',()=>{
  let w=seedWorkspace();
  const p=patient(w,ids[0]);
  p.carePlans[0].text='Operator-authored plan: review the new work schedule with the usual clinician.';
  p.goal='Return to two short study sessions each day';
  p.preferredLanguage='en';
  p.treatmentReview.goalEvidence='Patient now wants shorter study sessions; the prior desk-work target is no longer current.';
  w=applyCareOperations(w,{type:'care.operations',requestId:'existing-callback',patientId:ids[1],expectedVersion:0,command:{kind:'remote-visit',encounterId:'operator-visit',channel:'phone',status:'scheduled',owner:'Usual coordinator',location:'Patient chose a telephone visit.',reason:'Callback already arranged by the patient’s coordinator.'}},actor,now);
  const existing=structuredClone(w.careOperations.remoteVisits),plan=structuredClone(p.carePlans[0]);
  const unrelated=structuredClone(w.patients.filter(row=>!ids.includes(row.id))),input=structuredClone(w);
  const done=ensureStoryCompletion(w,actor,now);
  assert.deepEqual(w,input,'the helper does not mutate its input');
  assert.deepEqual(patient(done,ids[0]).carePlans[0],plan);
  assert.equal(patient(done,ids[0]).preferredLanguage,'en');
  assert.ok(!done.clinicalWorkflows.slices['patient-coordination'].state.language.some(row=>row.patientId===ids[0]&&row.translationStatus==='translated'));
  assert.deepEqual(done.careOperations.remoteVisits.filter(row=>row.patientId===ids[1]),existing);
  assert.deepEqual(done.patients.filter(row=>!ids.includes(row.id)),unrelated);
  const signed=scope(state(done).signedSnapshots,ids[0]);
  assert.equal(signed.carePackage.instructions,plan.text);
  assert.equal(signed.sourceSnapshot.facts.Goal,p.goal);
  assert.match(signed.reviewedInput.observedReview.clinicalInterpretation,/shorter study sessions/);
  assert.doesNotMatch(signed.displayedOutputs.summary,/reviewed translation/);
});

test('an inactive reviewed configuration blocks new engine adoption and is never reactivated by story loading',()=>{
  let w=ensureStoryCompletion(seedWorkspace(),actor,now);
  const config=w.clinicalWorkflows.slices['program-governance'].state.configurations.find(row=>row.id===w.clinicalWorkflows.slices['program-governance'].state.activeConfigurationId);
  w=apply(w,'program-governance',{type:'program-governance.configuration-deactivate',requestId:'operator-pauses-config',id:config.id,expectedVersion:config.version,reason:'The program owner paused this configuration for review.'});
  // A newly added authored patient has no completed story and must not receive a governed run.
  const template=structuredClone(patient(w,ids[1]));
  template.id=ids[2];template.name='Priya Raman';template.carePlans=template.carePlans.map(row=>({...row,id:'new-priya-plan'}));
  w.patients.push(template);
  const saved=structuredClone(w.clinicalWorkflows.slices['program-governance'].state),runs=structuredClone(w.engineRuns);
  const after=ensureStoryCompletion(w,actor,now);
  assert.deepEqual(after.clinicalWorkflows.slices['program-governance'].state,saved);
  assert.deepEqual(after.engineRuns,runs);
  assert.equal(scope(state(after).signedSnapshots,ids[2]),undefined);
  assert.equal(after.careOperations.remoteVisits.find(row=>row.patientId===ids[2]).status,'interrupted');
});
