import assert from 'node:assert/strict';

// Authenticated API driver reloads saved state after every accepted action.
export async function runScenarios(driver){
  const suffix=globalThis.crypto.randomUUID(),date=driver.now.slice(0,10),timestamp=driver.now;
  let sequence=0;
  const requestId=()=>`results-qa-${suffix}-${++sequence}`;
  const resultId=`result-${suffix}`;let referralId=`referral-${suffix}`;
  const result=()=>driver.state().results.find(record=>record.id===resultId),referral=()=>driver.state().referrals.find(record=>record.id===referralId);
  const resultAction=(verb,payload={})=>({type:`results-referrals.result.${verb}`,requestId:requestId(),id:resultId,patientId:driver.patientId,expectedVersion:result()?.version??0,reason:'Review the investigation and document its responsible next action.',...payload});
  const referralAction=(verb,payload={})=>({type:`results-referrals.referral.${verb}`,requestId:requestId(),id:referralId,patientId:driver.patientId,expectedVersion:referral()?.version??0,reason:'Review the specialist question and patient’s agreed next step.',...payload});
  const window={start:new Date(Date.parse(timestamp)-120000).toISOString(),end:new Date(Date.parse(timestamp)-60000).toISOString(),timezone:'Europe/Lisbon'};
  let tracking={requestStage:'draft',backupOwner:'Covering clinician',reviewerAvailability:'absent',dueWindow:window,priority:'urgent',policyRef:'Recorded local urgent-result protocol',nextAction:'Obtain the missing report and confirm covering responsibility.',requestEvidence:'Ordering record and service receipt',requestRecordedBy:'Ordering clinician',requestRecordedAt:timestamp,missingResultReason:'The expected report has not arrived.',nextAttemptAt:new Date(Date.parse(timestamp)+3600000).toISOString()};
  await driver.apply(resultAction('create',{encounterId:`encounter-${suffix}`,requestLabel:'Follow-up investigation',owner:'Usual clinician',requestedAt:new Date(Date.parse(timestamp)-86400000).toISOString().slice(0,10),dueAt:date,tracking}));
  await driver.expectRejected(resultAction('close'));await driver.expectRejected(resultAction('mark-awaiting'));
  for(const requestStage of ['authorized','submitted','accepted']){tracking={...tracking,requestStage};await driver.apply(resultAction('track',{tracking}));}
  await driver.apply(resultAction('mark-awaiting'));
  tracking={...tracking,coverage:{requestedOwner:'Covering clinician',status:'requested'}};await driver.apply(resultAction('track',{tracking}));
  await driver.expectRejected(resultAction('track',{tracking:{...tracking,coverage:{...tracking.coverage,status:'accepted'}}}));
  tracking={...tracking,coverage:{...tracking.coverage,status:'accepted',acceptedBy:'Covering clinician',acceptedAt:timestamp,evidenceRef:'Covering clinician accepted responsibility by telephone.'}};await driver.apply(resultAction('track',{tracking}));
  assert.equal(result().owner,'Covering clinician');assert.equal(result().tracking.dueWindow.timezone,'Europe/Lisbon');
  const report={source:'manual',collectedAt:timestamp,receivedAt:timestamp,evidenceRef:'Laboratory report',findings:[{label:'Recorded finding',value:'4.2',unit:'mmol/L'}]};
  await driver.apply(resultAction('receive',{...report,revisionId:`preliminary-${suffix}`,reportStatus:'preliminary',summary:'Preliminary report received; final verification is pending.'}));
  await driver.apply(resultAction('finalize',{...report,revisionId:`final-${suffix}`,finalizedFromId:`preliminary-${suffix}`,reportStatus:'final',summary:'Final report received and matched to the original request.'}));
  assert.equal(result().revisions[1].reportStatus,'preliminary');
  const finishResult=async()=>{
    await driver.apply(resultAction('review',{interpretation:'Covering clinician reviewed the reported findings.',evidenceRef:'Dated clinical review'}));
    await driver.apply(resultAction('act',{clinicalDisposition:'The agreed clinical follow-up is documented.',evidenceRef:'Reviewed care plan'}));
    await driver.apply(resultAction('communicate',{contactEvidence:'Patient telephone discussion and next-step confirmation'}));
  };
  await finishResult();await driver.expectRejected(resultAction('close'));
  tracking={...tracking,requestStage:'completed'};await driver.apply(resultAction('track',{tracking}));await driver.apply(resultAction('close'));
  await driver.apply(resultAction('correct',{...report,revisionId:`corrected-${suffix}`,correctedFromId:`final-${suffix}`,reportStatus:'corrected',summary:'Laboratory supplied a material correction after the original review.'}));
  assert.equal(result().status,'received');assert.equal(result().interpretation,'');assert.equal(JSON.parse(result().history[0].previousSnapshot).status,'closed');assert.equal(result().owner,'Covering clinician');
  await finishResult();await driver.apply(resultAction('close'));driver.record('J29','passed');

  const coordination={referringClinician:'Referring clinician',urgency:'routine',authorizedPacket:'Patient-authorized clinical summary',backupOwner:'Covering clinician',dueWindow:{end:new Date(Date.parse(timestamp)+86400000).toISOString(),timezone:'Europe/Lisbon'}};
  const createReferral=async(mode='appointment')=>driver.apply(referralAction('create',{encounterId:`encounter-${suffix}`,mode,coordination,clinicalQuestion:'Please review the conflicting rehabilitation advice.',receivingService:'Rehabilitation advice service',owner:'Referring care team',dueAt:date,supportingEvidence:'Current plan and patient report'}));
  await createReferral();await driver.apply(referralAction('send',{evidenceRef:'Receiving service transmission receipt'}));await driver.apply(referralAction('reject',{evidenceRef:'Service reported no suitable appointment capacity'}));
  await driver.apply(referralAction('re-request',{evidenceRef:'Updated request accepted for reconsideration'}));await driver.apply(referralAction('send',{evidenceRef:'Updated packet receipt'}));await driver.apply(referralAction('accept',{evidenceRef:'Service accepted the referral'}));await driver.apply(referralAction('schedule',{scheduledFor:date,evidenceRef:'Appointment confirmation'}));await driver.apply(referralAction('consultation-complete',{completedAt:timestamp,evidenceRef:'Attendance confirmed by the clinic'}));
  await driver.expectRejected(referralAction('close'));assert.equal(referral().status,'consultation-complete');
  const receiveAdvice=async()=>driver.apply(referralAction('advice-received',{receivedAt:timestamp,adviceSummary:'Specialist supplied a different pacing recommendation.',originalAdvice:'Original specialist wording retained for the referring clinician.',evidenceRef:'Specialist consultation report'}));
  const reconcile=async()=>{await driver.apply(referralAction('review',{reviewSummary:'Referring clinician reviewed the conflicting advice.',evidenceRef:'Clinical review note'}));await driver.apply(referralAction('plan-reconciled',{reconciliationPlan:'Clinician and patient agreed a consistent pacing approach.',evidenceRef:'Reconciled plan'}));};
  const communicate=async()=>driver.apply(referralAction('communicate',{communicatedAt:timestamp,evidenceRef:'Patient explained the agreed next step'}));
  await receiveAdvice();await reconcile();await driver.expectRejected(referralAction('close'));await communicate();await driver.apply(referralAction('close'));
  assert.equal(referral().specialistAdvice.originalAdvice,'Original specialist wording retained for the referring clinician.');

  referralId=`econsult-${suffix}`;await createReferral('electronic-consultation');await driver.apply(referralAction('send',{evidenceRef:'Electronic consultation receipt'}));await driver.apply(referralAction('clarification',{question:'Please provide the previous investigation.',evidenceRef:'Specialist clarification request'}));await driver.apply(referralAction('respond',{response:'Prior investigation supplied with the authorized packet.',evidenceRef:'Updated packet receipt'}));await driver.apply(referralAction('accept',{evidenceRef:'Specialist accepted the electronic question'}));await receiveAdvice();assert.equal(referral().scheduledFor,'');await reconcile();await communicate();await driver.apply(referralAction('close'));

  referralId=`declined-referral-${suffix}`;await createReferral();await driver.apply(referralAction('decline',{evidenceRef:'Patient declined the travel requirement'}));await driver.apply(referralAction('alternative',{disposition:{decision:'Arrange a remote review with the receiving team.',reviewedBy:'Referring clinician',reviewedAt:timestamp,patientAgreement:'agreed',nextAction:'Receiving team to coordinate a remote appointment.'}}));await communicate();
  const accepted={requestedOwner:'Receiving clinician',status:'accepted',acceptedBy:'Receiving clinician',acceptedAt:timestamp,evidenceRef:'Receiving clinician accepted the remaining work'};
  await driver.expectRejected(referralAction('transfer',{transfer:accepted}));await driver.apply(referralAction('transfer',{transfer:{requestedOwner:'Receiving clinician',status:'requested'}}));await driver.apply(referralAction('transfer',{transfer:accepted}));await driver.apply(referralAction('close'));assert.equal(referral().owner,'Receiving clinician');
  driver.record('J30','passed');
}
