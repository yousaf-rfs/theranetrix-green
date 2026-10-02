import assert from 'node:assert/strict';

// Reused by domain tests and authenticated API persistence/reload tests.
// All engine outputs and evidence in this scenario are synthetic test records.
export async function runScenarios(driver){
  const encounterId=`acceptance-decisions-${globalThis.crypto.randomUUID()}`;
  const scope={patientId:driver.patientId,encounterId};
  const base=()=>({...scope,requestId:globalThis.crypto.randomUUID()});
  const inputVersion=()=>typeof driver.inputVersion==='function'?driver.inputVersion():driver.inputVersion;
  const saved=collection=>driver.state()[collection].find(row=>row.patientId===scope.patientId&&row.encounterId===encounterId);
  const planRef=()=>{
    const workspace=driver.workspace?.();
    if(!workspace)return 'synthetic-plan-reference';
    const plans=workspace.patients.find(patient=>patient.id===driver.patientId)?.carePlans;
    assert.ok(plans?.length,'Create a saved patient care plan before running decisions sign-off scenarios.');
    return plans[0].id;
  };
  const timestamp=new Date(Date.parse(driver.now)-60_000).toISOString();
  const future=new Date(Date.parse(driver.now)+86_400_000).toISOString();
  const evidence={id:'synthetic-guideline',title:'Synthetic acceptance reference',locator:'Fixture section 1',version:'fixture-evidence-1',reviewDate:driver.now.slice(0,10)};
  const observation=()=>({type:'decisions.review.capture',...base(),expectedVersion:saved('observedReviews')?.version??0,inputVersion:inputVersion(),collectedAt:timestamp,receivedAt:timestamp,provenance:'synthetic',metrics:{pain:{prior:7,current:0},function:{prior:null,current:5},sleep:{prior:3,current:3}},contradictoryMetrics:[],clinicalInterpretation:'Synthetic self-reported improvement; incomplete baseline function.',goal:'Patient-defined walking goal in the synthetic scenario.',nextMonitoringQuestion:'Clarify the missing baseline function measurement.',monitoring:{id:`monitor-${encounterId}`,title:'Clarify the missing baseline function measurement.',owner:'Fixture care coordinator',dueAt:future}});
  await driver.expectRejected({...observation(),receivedAt:future});
  await driver.apply(observation());
  assert.equal(saved('observedReviews').metrics.pain.current,0);
  assert.equal(saved('observedReviews').metrics.pain.direction,'improved');
  assert.equal(saved('observedReviews').metrics.function.direction,'insufficient-data');
  assert.equal(saved('observedReviews').provenance,'synthetic');
  assert.equal(saved('observedReviews').monitoring.owner,'Fixture care coordinator');
  driver.record('J05','passed');

  const comparison=()=>({type:'decisions.comparison.capture',...base(),expectedVersion:saved('comparisonSnapshots')?.version??0,inputVersion:inputVersion(),preferenceSummary:'Synthetic patient prioritizes function and low burden.',preferenceWeights:{relief:20,function:60,sleep:10,safety:10},options:[{id:'discuss-current-plan',title:'Discuss the existing clinician-selected plan',status:'for-discussion',rationale:'A discussion option in this fixture, not a prescribed intervention.',applicability:'Needs clinician review against the source evidence.',evidenceRefs:[evidence.id]}],disposition:'defer',rationale:'Await clarification of baseline function.',safetyReview:'Manual synthetic review recorded.',missingInputs:['Baseline function measurement'],evidenceRefs:[evidence]});
  await driver.expectRejected({...comparison(),evidenceRefs:[]});
  await driver.apply(comparison());
  assert.equal(saved('comparisonSnapshots').defaultAction,'no-prescription');
  assert.equal(saved('comparisonSnapshots').preferenceWeights.function,60);
  assert.deepEqual(saved('comparisonSnapshots').missingInputs,['Baseline function measurement']);
  driver.record('J06','passed');

  const output=()=>({type:'decisions.outputs.capture',...base(),expectedVersion:saved('engineComparisons')?.version??0,inputVersion:inputVersion(),pst:{outputId:`pst-${encounterId}`,summary:'Synthetic PST output: candidate A for discussion.',limitations:['Synthetic fixture, not clinical prediction.']},shadow:{outputId:`shadow-${encounterId}`,summary:'Synthetic Shadow output: candidate B requires clarification.',limitations:['Synthetic fixture, not clinical prediction.']},agreement:'disagree',limitations:['Engine agreement does not establish clinical correctness.'],supportingEvidence:[evidence],conflictingEvidence:[],clarificationRequests:['Confirm the baseline function measurement.'],clarificationWork:[{id:`clarification-${encounterId}`,title:'Confirm the baseline function measurement.',owner:'Fixture clinical reviewer',dueAt:future}],clinicianDisposition:'request-clarification',dispositionExplanation:'Review the distinct outputs with the missing observation.',suitability:'unsupported',provenance:'synthetic',modelVersions:['fixture-model-1'],configurationVersions:['fixture-config-1']});
  await driver.expectRejected({...output(),supportingEvidence:[],suitability:'evidence-reviewed'});
  await driver.apply(output());
  assert.notEqual(saved('engineComparisons').pst.summary,saved('engineComparisons').shadow.summary);
  assert.equal(saved('engineComparisons').provenance,'synthetic');
  assert.equal(saved('engineComparisons').clinicianDisposition,'request-clarification');
  assert.equal(saved('engineComparisons').clarificationWork[0].owner,'Fixture clinical reviewer');
  driver.record('J07','passed');

  const payload=()=>({observedReviewId:saved('observedReviews').id,comparisonSnapshotId:saved('comparisonSnapshots').id,engineComparisonId:saved('engineComparisons').id,pendingDisposition:'defer',note:'Synthetic decision awaits clarification.'});
  const draft=()=>({type:'decisions.draft.save',...base(),draftId:saved('drafts')?.id,expectedVersion:saved('drafts')?.version,expectedInputVersion:inputVersion(),summary:'Saved synthetic review summary before correction.',payload:payload()});
  const sign=()=>({type:'decisions.sign.capture',...base(),draftId:saved('drafts').id,expectedDraftVersion:saved('drafts').version,expectedInputVersion:inputVersion(),disposition:'defer',rationale:'Synthetic sign-off records a deferred decision.',patientPlanRef:planRef(),evidenceVersions:['fixture-evidence-1'],modelVersions:['fixture-model-1'],configurationVersions:['fixture-config-1'],displayedSummary:saved('drafts').summary});
  const status=(type,extra={})=>({type,...base(),draftId:saved('drafts').id,expectedVersion:saved('drafts').version,reason:'Synthetic review lifecycle acceptance check.',...extra});
  const pending=comparison();
  const working={type:'decisions.working.save',...base(),id:`working-${encounterId}`,expectedVersion:0,inputVersion:inputVersion(),form:{draftSummary:'Unsaved clinical review text retained as a server working copy.',pain:'/'},pendingAction:JSON.stringify(pending)};
  await driver.apply(working);
  assert.equal(saved('workingCopies').form.pain,'/');
  assert.equal(JSON.parse(saved('workingCopies').pendingAction).requestId,pending.requestId);
  const workingSnapshot=structuredClone(saved('workingCopies'));
  await driver.apply(working);
  assert.deepEqual(saved('workingCopies'),workingSnapshot,'working-copy retry retains one exact saved record');
  await driver.expectRejected({...working,...base(),expectedVersion:0});
  await driver.expectRejected({...working,...base(),expectedVersion:1,pendingAction:JSON.stringify({...pending,encounterId:'different-encounter'})});
  await driver.apply(draft());
  await driver.apply(status('decisions.summary.dispute'));
  await driver.expectRejected(sign());
  await driver.apply(status('decisions.summary.correct',{expectedInputVersion:inputVersion(),summary:'Corrected synthetic summary after explicit review.',payload:payload()}));
  assert.equal(saved('drafts').summary,'Corrected synthetic summary after explicit review.');
  assert.equal(saved('drafts').status,'corrected');
  const correctedSummary=saved('drafts').summary;
  await driver.apply(status('decisions.draft.cancel'));
  await driver.expectRejected(sign());
  await driver.apply(status('decisions.draft.retry'));
  await driver.apply({...draft(),summary:correctedSummary});
  await driver.expectRejected({...draft(),expectedVersion:saved('drafts').version-1});
  // An update at the same input version must invalidate the earlier reviewed reference.
  const originalObservedId=saved('observedReviews').id;
  await driver.apply({...observation(),clinicalInterpretation:'Updated synthetic interpretation requiring another review.'});
  assert.ok(driver.state().observedReviews.some(row=>row.id===originalObservedId));
  await driver.expectRejected(sign());
  await driver.apply({...draft(),summary:correctedSummary});
  driver.record('J20','passed');

  await driver.expectRejected({...sign(),displayedSummary:'Replacement text that was never reviewed.'});
  await driver.apply(sign());
  const original=structuredClone(saved('signedSnapshots'));
  assert.equal(original.displayedOutputs.summary,correctedSummary);
  assert.equal(original.reviewedInput.engineComparison.pst.summary,'Synthetic PST output: candidate A for discussion.');
  assert.equal(saved('drafts').status,'signed');
  await driver.apply({type:'decisions.sign.amend',...base(),signedSnapshotId:original.id,expectedVersion:original.version,reason:'Clarify the documentation without modifying the reviewed inputs.',disposition:'no-change',rationale:'Synthetic amended wording.',patientPlanRef:original.patientPlanRef});
  const amendment=saved('signedSnapshots');
  assert.equal(amendment.amendmentOf,original.id);
  assert.deepEqual(driver.state().signedSnapshots.find(row=>row.id===original.id),original);
  await driver.expectRejected({type:'decisions.sign.amend',...base(),signedSnapshotId:original.id,expectedVersion:original.version,reason:'Attempt to amend an outdated ancestor.',disposition:'defer',rationale:'Outdated amendment attempt.',patientPlanRef:original.patientPlanRef});
  await driver.apply({type:'decisions.export.capture',...base(),signedSnapshotId:amendment.id,format:'json'});
  const exported=JSON.parse(saved('exports').content);
  assert.equal(exported.patientId,driver.patientId);
  assert.equal(exported.encounterId,encounterId);
  assert.deepEqual(exported.snapshot,JSON.parse(JSON.stringify(amendment)));
  await driver.expectRejected({type:'decisions.export.capture',...base(),encounterId:`foreign-${encounterId}`,signedSnapshotId:amendment.id,format:'json'});
  driver.record('J18','passed');
}
