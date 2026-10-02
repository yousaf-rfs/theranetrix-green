import assert from 'node:assert/strict';

export async function runScenarios(driver){
  const suffix=globalThis.crypto.randomUUID(),date=driver.now.slice(0,10),at=driver.now;
  let sequence=0;
  const collections={'record-reconciliation':'reconciliations','record-experience':'experiences','update-lifecycle':'lifecycles','manage-access':'accessBarriers','record-transition':'transitions','update-multidisciplinary':'multidisciplinary'};
  const record=(verb,id)=>driver.state()[collections[verb]].find(item=>item.id===id);
  const action=(verb,id,fields)=>({type:`treatment-continuity.${verb}`,patientId:driver.patientId,encounterId:`continuity-${suffix}`,id,requestId:`treatment-qa-${suffix}-${++sequence}`,...(record(verb,id)?{expectedVersion:record(verb,id).version}:{}),reason:'Care team reviewed the patient’s report and documented the next step.',evidenceRef:'Dated clinical conversation note',owner:'Dr. Maya Chen',dueDate:date,...fields});
  const save=(verb,id,fields)=>driver.apply(action(verb,id,fields));
  const source={source:'Hospital discharge list',author:'Discharge pharmacist',collectedAt:null,receivedAt:at,reference:'Discharge medication reconciliation'};
  const provenance={patient:{...source,source:'Patient telephone report',author:'Patient'},external:source,nextAction:'Confirm the current list with the usual prescriber.'};

  const reconciliationId=`reconciliation-${suffix}`;
  const reconciliation={source:'Hospital discharge list',sourceDate:date,status:'unreviewed',reviewer:'Dr. Maya Chen',resolution:'',conflicts:[{field:'Treatment use',patientFact:'Patient reports the treatment was stopped.',externalFact:'Outside list still says active.',outcome:'unreviewed'}],provenance};
  await save('record-reconciliation',reconciliationId,reconciliation);
  await driver.expectRejected(action('record-reconciliation',reconciliationId,{...reconciliation,owner:''}));
  await driver.expectRejected(action('record-reconciliation',reconciliationId,{...reconciliation,status:'resolved',resolution:'Conflict has not yet been reviewed.'}));
  await save('record-reconciliation',reconciliationId,{...reconciliation,status:'resolved',resolution:'Usual prescriber confirmed the patient’s current report.',conflicts:reconciliation.conflicts.map(item=>({...item,outcome:'resolved'})),provenance:{...provenance,reviewedBy:'Dr. Maya Chen',reviewedAt:at}});
  assert.equal(record('record-reconciliation',reconciliationId).status,'resolved');
  assert.equal(JSON.parse(record('record-reconciliation',reconciliationId).history[0].previousSnapshot).conflicts[0].outcome,'unreviewed');
  driver.record('J03','passed');

  const experienceId=`experience-${suffix}`;
  const experience={medicationName:'Current recorded treatment',reportedUse:'active',regimen:'Regimen on the reviewed medication list',regimenStartedAt:date,regimenDurationDays:0,reportedBenefit:'helpful',tolerability:'side-effects',functionalGoal:'Walk to the local shop without stopping',patientConcern:'Pain is unchanged and walking is harder despite reported benefit.',trialStatus:'active',stopDate:'',stopReason:'',reassessmentDecision:'no-change',alternativePlan:'',responseReview:{regimenVersion:1,periodStart:date,periodEnd:date,reportedAt:at,source:'Patient’s visit report',patientAgreement:'agreed'}};
  await save('record-experience',experienceId,experience);
  await driver.expectRejected(action('record-experience',experienceId,{...experience,dueDate:''}));
  await driver.expectRejected(action('record-experience',experienceId,{...experience,regimen:'Newly changed regimen'}));
  await save('record-experience',experienceId,{...experience,trialStatus:'stopped',reportedUse:'stopped',stopDate:date,stopReason:'Patient and clinician agreed to stop after reviewing the reported burden.',regimenDurationDays:null,reassessmentDecision:'defer'});
  assert.equal(record('record-experience',experienceId).reportedBenefit,'helpful');
  assert.match(record('record-experience',experienceId).patientConcern,/walking is harder/);
  driver.record('J04','passed');

  const lifecycleId=`lifecycle-${suffix}`;
  const orderEvidence={orderId:`outside-order-${suffix}`,regimen:'Exact regimen copied from the reviewed order',regimenVersion:1,prescriber:'Dr. Maya Chen',authority:'manual-attestation',authorizationRef:'Signed prescription in the outside record',authorizedAt:at,pharmacyReceipt:'Pharmacy acknowledged receipt by telephone',pharmacyReceivedAt:at,dispensingRef:'Pharmacy collection record',dispensedAt:at,actualUse:'not-obtained',useReportedAt:at,useSource:'Patient report'};
  const lifecycle={medicationName:'Current recorded treatment',stage:'considered',manualSource:'Outside prescribing and pharmacy records',safetyPrerequisites:['Prescriber’s required checks recorded'],reviewPrerequisites:['Current use and medication list reviewed'],prescriberResponsibility:'Dr. Maya Chen',clinicalServiceAvailable:true,statusNote:'Milestones recorded from the named source documents.',renewalRequested:false,failureReason:'',notStartedReason:'',orderEvidence};
  await save('update-lifecycle',lifecycleId,lifecycle);
  await driver.expectRejected(action('update-lifecycle',lifecycleId,{...lifecycle,stage:'dispensing-reported'}));
  for(const stage of ['clinician-review','authorization-recorded','external-transmission-reported','pharmacy-received','clarification-needed'])await save('update-lifecycle',lifecycleId,{...lifecycle,stage,orderEvidence:{...orderEvidence,clarification:'Pharmacy is confirming supply availability.'}});
  for(const stage of ['pharmacy-received','dispensing-reported'])await save('update-lifecycle',lifecycleId,{...lifecycle,stage});
  assert.equal(record('update-lifecycle',lifecycleId).orderEvidence.actualUse,'not-obtained');
  await driver.expectRejected(action('update-lifecycle',lifecycleId,{...lifecycle,stage:'started-reported'}));
  const started={...orderEvidence,actualUse:'started',startedAt:date};
  for(const stage of ['started-reported','response-reviewed','continued'])await save('update-lifecycle',lifecycleId,{...lifecycle,stage,orderEvidence:started});
  assert.equal(record('update-lifecycle',lifecycleId).stage,'continued');
  driver.record('J31','passed');

  const accessId=`access-${suffix}`;
  const careAction={domain:'treatment-continuity',id:lifecycleId,version:record('update-lifecycle',lifecycleId).version};
  const accessReview={careAction,verification:'estimated',source:'Benefits coordinator',checkedAt:at,details:'The quoted coverage is an estimate pending confirmation.',alternativeDecision:'pending',patientAgreement:'not-discussed',actualStart:'not-started',actualStartSource:'Patient has not attended the proposed alternative.'};
  const access={barrierType:'coverage',status:'unresolved',patientChoice:'Patient wants an affordable option.',outreach:'Coordinator contacted the service benefits desk.',alternatives:'Discuss a feasible alternative with the responsible clinician.',requiresClinicianReview:true,resolution:'',accessReview};
  await save('manage-access',accessId,access);
  await driver.expectRejected(action('manage-access',accessId,{...access,status:'resolved',resolution:'An estimate alone cannot resolve coverage.'}));
  await driver.expectRejected(action('manage-access',accessId,{...access,status:'resolved',resolution:'Clinical alternative still needs review.',accessReview:{...accessReview,verification:'confirmed'}}));
  await save('manage-access',accessId,{...access,status:'resolved',resolution:'Service confirmed access and clinician/patient reviewed the alternative.',accessReview:{...accessReview,verification:'confirmed',alternativeDecision:'approved',reviewer:'Dr. Maya Chen',reviewedAt:at,patientAgreement:'agreed'}});
  assert.equal(record('manage-access',accessId).accessReview.actualStart,'not-started');
  driver.record('J32','passed');

  const pendingId=`handover-list-${suffix}`;
  await save('record-reconciliation',pendingId,reconciliation);
  const transitionId=`transition-${suffix}`;
  const handoverEvidence={source,patientAccount:'Patient describes different timing from the discharge instructions.',backupOwner:'On-call clinician',acceptance:'pending',pendingTransfers:[],timezone:'Europe/Lisbon'};
  const transition={externalCareSource:'Hospital discharge team',previousInstructions:'Usual outpatient instructions retained.',newInstructions:'Hospital discharge instructions retained.',discrepancies:'Medication timing requires confirmation.',pendingWork:['Confirm the discharge medication list'],resolvedPendingWork:[],receivingClinician:'Covering clinician',ownershipAccepted:false,reconciledInstructions:'',patientCommunication:'',handoverStatus:'draft',handoverEvidence};
  await save('record-transition',transitionId,transition);await save('record-transition',transitionId,{...transition,handoverStatus:'ownership-pending'});
  await driver.expectRejected(action('record-transition',transitionId,{...transition,handoverStatus:'instructions-reconciled',ownershipAccepted:true,reconciledInstructions:'No accepting receipt has been recorded.'}));
  const accepted={...handoverEvidence,acceptance:'accepted',acceptedBy:'Covering clinician',acceptedAt:at,acceptanceEvidence:'Covering clinician accepted the handover by telephone.',teachBack:'Patient explained the current next step and who to contact.',pendingTransfers:[{title:transition.pendingWork[0],ref:{domain:'treatment-continuity',id:pendingId,version:1},disposition:'accepted-transfer',owner:'Covering clinician',backupOwner:'On-call clinician',acceptedAt:at,evidenceRef:'Accepted responsibility for the unresolved medication list'}]};
  const reconciled={...transition,ownershipAccepted:true,reconciledInstructions:'Clinician reviewed interim instructions without erasing the conflict.',patientCommunication:'Current instructions discussed with the patient.',handoverEvidence:accepted};
  for(const handoverStatus of ['instructions-reconciled','patient-communicated','completed'])await save('record-transition',transitionId,{...reconciled,handoverStatus});
  assert.equal(record('record-transition',transitionId).handoverStatus,'completed');assert.deepEqual(record('record-transition',transitionId).pendingWork,transition.pendingWork);assert.equal(record('record-reconciliation',pendingId).status,'unreviewed');
  driver.record('J33','passed');

  const multidisciplinaryId=`multidisciplinary-${suffix}`;
  const interventions=[{id:`pt-${suffix}`,title:'Graded activity',professional:'Physiotherapist',status:'active',accessBarrier:'',patientExperience:'Patient attended but found activity tiring.',observedOutcome:'Walking goal is not yet met.',decision:'continue'},{id:`ot-${suffix}`,title:'Occupational therapy',professional:'Occupational therapist',status:'blocked',accessBarrier:'No evening appointment available.',patientExperience:'Patient wants practical changes for work.',observedOutcome:'Awaiting an available appointment.',decision:'continue'}];
  const interventionReviews=interventions.map((item,index)=>({interventionId:item.id,rationale:'Support the patient’s activity goal.',reviewCriterion:'Review participation, burden and walking tolerance.',...(index===0?{startedAt:date}:{}),participation:index===0?'attended':'not-started',patientAgreement:'agreed',reviewDate:date,conflictingAdvice:'Professionals gave different activity-pacing advice.'}));
  const multidisciplinary={functionalGoal:'Walk to the local shop',interventions,interventionReviews};
  await save('update-multidisciplinary',multidisciplinaryId,multidisciplinary);
  await driver.expectRejected(action('update-multidisciplinary',multidisciplinaryId,{...multidisciplinary,interventions:[interventions[0]]}));
  await driver.expectRejected(action('update-multidisciplinary',multidisciplinaryId,{...multidisciplinary,interventions:interventions.map(item=>({...item,status:'completed',decision:'closure'}))}));
  await save('update-multidisciplinary',multidisciplinaryId,{...multidisciplinary,interventions:interventions.map(item=>({...item,status:'completed',decision:'closure',observedOutcome:'Team reviewed the documented participation and remaining goal.'})),interventionReviews:interventionReviews.map(review=>({...review,startedAt:date,participation:'attended',reconciliation:'The professionals and patient agreed a consistent pacing approach after an appointment became available.'}))});
  assert.equal(record('update-multidisciplinary',multidisciplinaryId).currentStatus,'completed');assert.equal(record('update-multidisciplinary',multidisciplinaryId).interventions.length,2);
  driver.record('J34','passed');
}
