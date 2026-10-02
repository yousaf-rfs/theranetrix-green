import assert from 'node:assert/strict';

// Runs unchanged against the pure reducer or the real persisted workflow API.
export async function runScenarios(driver){
  const {patientId,now}=driver;
  const encounterId=`acceptance-encounters-${crypto.randomUUID()}`;
  const base=()=>({patientId,encounterId,requestId:crypto.randomUUID()});
  const saved=(collection)=>driver.state()[collection].find(item=>item.patientId===patientId&&item.encounterId===encounterId);
  const apply=command=>driver.apply(command);
  const date=now.slice(0,10);
  const futureDate=new Date(Date.parse(now)+7*86400000).toISOString().slice(0,10);
  const preparation={type:'encounters.preparation.save',reasonForVisit:'Review function and the patient walking goal.',changesSinceLastReviewedEncounter:'Walking remains difficult after work.',sourceDates:[date],preparationOwner:'Acceptance clinician',openQuestions:[],missingInputs:[],patientGoal:'Walk to the park with family.',status:'clinician-reviewed'};
  await apply({...base(),...preparation});
  assert.equal(saved('preparations').status,'clinician-reviewed');
  const prepVersion=saved('preparations').version;
  await apply({...base(),...preparation,expectedVersion:prepVersion,newInformation:'Patient clarified the main goal is outdoor walking.'});
  assert.equal(saved('preparations').reviewNeeded,true);
  await driver.expectRejected({...base(),...preparation,expectedVersion:prepVersion});
  await apply({...base(),...preparation,expectedVersion:saved('preparations').version});
  assert.equal(saved('preparations').reviewNeeded,false);
  assert.match(saved('preparations').latestInformation,/outdoor walking/);
  driver.record('J01','passed');

  const intake={type:'encounters.intake.save',sourceHistory:'History supplied by the patient during the intake call.',medicationsReconciliationReference:'Recorded in the medication reconciliation workflow.',goals:['Walk to the park'],consentReadiness:'ready',accessReadiness:'ready',unansweredFields:[],declinedFields:['Video contact'],coordinatorClarification:'Telephone follow-up preferred.',baselineReviewed:true,enrollmentDecision:'enroll',syntheticEvaluation:true,finalDiagnosis:''};
  await driver.expectRejected({...base(),...intake,consentReadiness:'declined'});
  await apply({...base(),...intake});
  assert.equal(saved('intakes').status,'enrolled');
  assert.equal(saved('intakes').finalDiagnosis,'');
  assert.deepEqual(saved('intakes').declinedFields,['Video contact']);
  driver.record('J02','passed');

  const assessment={type:'encounters.assessment.save',presentingProblem:'Persistent pain affecting outdoor walking.',painDistributionPhenotype:'Lower back discomfort.',timeline:'Stable over the last week.',relevantExamination:'Examination documented by the clinician.',comorbidContext:'Reviewed manually.',psychologicalContext:'Patient wants a clear plan.',socialContext:'Family supports activity pacing.',workingAssessment:'Continue the clinician-selected conservative plan.',alternatives:['Longer review if function changes'],supportingFindings:['Stable function reported'],refutingFindings:['No new concerns reported'],uncertainty:'Review progress before changing treatment.',furtherWorkup:'Manual clinician review as needed.',route:'continue-local',deferReason:''};
  await driver.expectRejected({...base(),...assessment,refutingFindings:['Stable function reported']});
  await apply({...base(),...assessment});
  assert.equal(saved('assessments').status,'completed');
  driver.record('J08','passed');

  const observations={type:'encounters.observations.save',instrument:'local-0-10',submissionStatus:'confirmed',entries:[
    {metric:'pain',status:'zero',value:0,source:'Patient self-report',recordedAt:now},
    {metric:'function',status:'unanswered',source:'Patient self-report',recordedAt:now},
    {metric:'sleep',status:'declined',source:'Patient self-report',recordedAt:now},
  ]};
  await apply({...base(),...observations});
  const originalObservation=saved('observations');
  await driver.expectRejected({...base(),...observations,expectedVersion:originalObservation.version,entries:[{metric:'pain',status:'answered',value:4,source:'Patient self-report',recordedAt:now}]});
  await apply({...base(),type:'encounters.observations.correct',expectedVersion:originalObservation.version,reason:'Patient clarified the function score after the initial submission.',replacement:{metric:'function',status:'answered',value:5,source:'Patient clarification',recordedAt:now}});
  assert.equal(saved('observations').entries.length,4);
  assert.equal(saved('observations').currentEntries.find(item=>item.metric==='pain').value,0);
  assert.equal(saved('observations').currentEntries.find(item=>item.metric==='sleep').status,'declined');
  driver.record('J11','passed');

  const signoff={type:'encounters.signoff.saveDraft',planKind:'definitive',assessmentRecordId:saved('assessments').id,rationale:'The clinician and patient agreed to continue the current plan.',patientFacingPlan:'Continue the agreed activity pacing and keep your walking log.',disposition:{selected:[],rejected:['Medication escalation'],deferred:['Longer review'],noChange:true},owner:'Acceptance clinician',followUp:{date:futureDate,time:'10:00',timezone:'UTC'},pendingWork:[{title:'Review walking log',owner:'Acceptance clinician',dueDate:futureDate,disposition:'pending'}],teachBack:'Patient was unsure whether follow-up was already booked.',teachBackOutcome:'needs-clarification',clarification:{owner:'Acceptance clinician',dueAt:new Date(Date.parse(now)+3600000).toISOString(),question:'Clarify the difference between follow-up being due and an appointment being booked.'}};
  await apply({...base(),...signoff});
  const originalDraft=saved('signoffs');
  await driver.expectRejected({...base(),type:'encounters.signoff.sign',id:originalDraft.id,expectedVersion:originalDraft.version,reason:'Attempt to bypass review.'});
  await apply({...base(),type:'encounters.signoff.review',id:originalDraft.id,expectedVersion:originalDraft.version,reason:'Reviewed the current assessment and observations.'});
  await apply({...base(),type:'encounters.signoff.sign',id:originalDraft.id,expectedVersion:saved('signoffs').version,reason:'Clinician signature after review.'});
  const signed=structuredClone(saved('signoffs'));
  assert.equal(signed.status,'signed');
  assert.equal(signed.followUp.appointmentBooked,false);
  assert.equal(signed.bridge.deliveryStatus,'pending');
  assert.equal(signed.signedSnapshot.assessmentSnapshot.id,saved('assessments').id);
  assert.equal(signed.signedSnapshot.observationSnapshot.currentEntries.find(item=>item.metric==='pain').value,0);
  assert.equal(signed.signedSnapshot.teachBackOutcome,'needs-clarification');
  assert.equal(signed.signedSnapshot.clarification.owner,'Acceptance clinician');
  await apply({...base(),type:'encounters.signoff.amend',id:signed.id,expectedVersion:signed.version,amendmentReason:'Clarify that the follow-up is due and has not been booked.',patientFacingPlan:'Continue the agreed activity pacing and keep your walking log. Follow-up is due; an appointment has not yet been booked.',teachBackOutcome:'understood',teachBack:'Patient explained that follow-up is due and the coordinator will confirm the appointment.'});
  let amendment=driver.state().signoffs.find(item=>item.amendedFromId===signed.id);
  assert.equal(amendment.status,'draft');
  assert.deepEqual(driver.state().signoffs.find(item=>item.id===signed.id),signed);
  await apply({...base(),type:'encounters.signoff.review',id:amendment.id,expectedVersion:amendment.version,reason:'Clinician reviewed the clarification.'});
  amendment=driver.state().signoffs.find(item=>item.id===amendment.id);
  await apply({...base(),type:'encounters.signoff.sign',id:amendment.id,expectedVersion:amendment.version,reason:'Clinician signed the reviewed amendment.'});
  assert.equal(driver.state().signoffs.find(item=>item.id===amendment.id).status,'signed');
  assert.equal(driver.state().signoffs.find(item=>item.id===amendment.id).signedSnapshot.teachBackOutcome,'understood');
  assert.equal(driver.state().signoffs.find(item=>item.id===amendment.id).clarification,undefined);
  assert.deepEqual(driver.state().signoffs.find(item=>item.id===signed.id),signed);
  driver.record('J14','passed');

  const episode={type:'encounters.episode.save',goalEvidence:'Walking log reviewed with the patient.',observedOutcomes:'Patient reports improved confidence with the agreed activity.',priorInterventions:'Education and activity pacing.',ongoingInterventions:'Self-management plan continues.',patientExperience:'Patient agrees with the plan and closure decision.',remainingConcerns:[],decision:'closure',pendingWorkDisposition:'Walking-log follow-up transferred to the named clinician.',pendingWorkOwner:'Acceptance clinician',status:'draft'};
  await apply({...base(),...episode});
  await driver.expectRejected({...base(),type:'encounters.episode.close',id:saved('episodes').id,expectedVersion:saved('episodes').version,reason:'Attempt to close without review.'});
  if(driver.acceptEpisodeWork)await driver.acceptEpisodeWork(encounterId);
  await apply({...base(),...episode,expectedVersion:saved('episodes').version,status:'reviewed'});
  await apply({...base(),type:'encounters.episode.close',id:saved('episodes').id,expectedVersion:saved('episodes').version,reason:'Clinician confirmed closure and ownership of follow-up.'});
  assert.equal(saved('episodes').status,'closed');
  assert.ok(saved('episodes').closureSnapshot);
  driver.record('J17','passed');
}
