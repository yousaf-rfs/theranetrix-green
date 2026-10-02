import assert from 'node:assert/strict';

// The driver runs these same synthetic cases through reducer or authenticated API persistence.
// All delivery and appointment evidence below is manually documented test evidence.
export async function runScenarios(driver){
  const {patientId,now}=driver;
  const encounterId=`acceptance-coordination-${crypto.randomUUID()}`;
  const day=now.slice(0,10);
  const futureDay=new Date(Date.parse(now)+7*86_400_000).toISOString().slice(0,10);
  const futureTime=new Date(Date.parse(now)+86_400_000).toISOString();
  const base=()=>({patientId,encounterId,requestId:crypto.randomUUID()});
  const saved=collection=>driver.state()[collection].find(record=>record.patientId===patientId&&record.encounterId===encounterId);
  const edit=collection=>({id:saved(collection).id,expectedVersion:saved(collection).version});
  const plans=driver.carePlans??driver.workspace?.().patients.flatMap(patient=>patient.carePlans.map(plan=>({id:plan.id,patientId:patient.id,version:plan.workflowVersion??1,goal:plan.workflowGoal??patient.goal,summary:plan.text})))??[];
  const plan=plans.find(candidate=>candidate.patientId===patientId);
  assert.ok(plan,'J09 requires a real saved patient care plan from the signed encounter bridge.');

  const support={type:'patient-coordination.support.save',conversationDate:day,planId:plan.id,planVersion:plan.version,goalText:plan.goal??plan.summary??'Patient goal in the saved plan',approvedEducation:['Pain plan copy','Scheduling checklist'],reminderChannel:'phone',optedOut:false,dueCheckInDate:futureDay,originalText:'Please use the saved walking goal and call after work.',attributedSummary:'Patient requested telephone support for the existing care plan.',summaryAuthor:'Acceptance coordinator',participationMode:'staff-recorded',participant:'patient',recordedSource:'Synthetic patient conversation recorded by staff'};
  const originalSupport={...base(),...support};
  await driver.expectRejected({...base(),...support,planVersion:plan.version+100});
  await driver.apply(originalSupport);
  assert.equal(saved('support').planRef.planId,plan.id);
  assert.equal(saved('support').planRef.planVersion,plan.version);
  await driver.apply(originalSupport);
  assert.equal(driver.state().support.filter(record=>record.encounterId===encounterId).length,1);
  await driver.apply({...base(),...support,...edit('support'),attributedSummary:'Patient confirmed the telephone support preference.'});
  await driver.expectRejected({...base(),...support,id:saved('support').id,expectedVersion:1});
  assert.equal(saved('support').version,2);
  driver.record('J09','passed');

  const handoff={type:'patient-coordination.handoff.save',concern:'Synthetic callback request from the patient.',dedupeKey:encounterId,priority:'high',urgencySourceType:'authorized-human',urgencySource:'Manually documented clinician review',responsibleTeam:'Acceptance care team',responsiblePerson:'Acceptance clinician',coverageExpectation:'Named clinician reviews the callback queue this shift.',fallbackOwner:'Acceptance on-call clinician',phase:'locally-saved',deliveryStatus:'pending',deliveryEvidenceSource:'none',patientContactStatus:'not-attempted',transitionReason:'Staff recorded the callback concern.'};
  await driver.apply({...base(),...handoff});
  await driver.expectRejected({...base(),...handoff,...edit('handoffs'),phase:'ownership-accepted'});
  const delivered={...handoff,deliveryStatus:'reported',deliveryEvidenceSource:'manual',deliveryEvidenceRef:'Synthetic verbal acknowledgement from the named clinician',patientContactStatus:'attempted'};
  await driver.apply({...base(),...delivered,...edit('handoffs'),phase:'delivery-reported'});
  await driver.expectRejected({...base(),...delivered,...edit('handoffs'),phase:'ownership-accepted',deliveryEvidenceSource:'none',deliveryEvidenceRef:undefined});
  for(const phase of ['ownership-accepted','reviewed'])await driver.apply({...base(),...delivered,...edit('handoffs'),phase,transitionReason:`Clinician documented ${phase}.`});
  const actionSummary='Named clinician documented the manual callback plan.';
  await driver.apply({...base(),...delivered,...edit('handoffs'),phase:'action-documented',actionSummary});
  const responseSummary='Patient received the documented clinician response.';
  await driver.apply({...base(),...delivered,...edit('handoffs'),phase:'response-recorded',actionSummary,responseSummary,patientContactStatus:'successful'});
  await driver.expectRejected({...base(),...delivered,...edit('handoffs'),phase:'closed',actionSummary,responseSummary,patientContactStatus:'failed',patientContactFailureReason:'Unable to reach the patient',nextAttemptAt:futureTime});
  await driver.apply({...base(),...delivered,...edit('handoffs'),phase:'closed',actionSummary,responseSummary,patientContactStatus:'successful'});
  assert.equal(saved('handoffs').phase,'closed');
  assert.equal(saved('handoffs').history.length,6);
  assert.equal(saved('handoffs').deliveryEvidence.source,'manual');
  driver.record('J10','passed');

  const language={type:'patient-coordination.language.save',planId:plan.id,planVersion:plan.version,preferredLanguage:'es',instructionsLanguage:'en',sourceText:plan.summary??'Keep the agreed walking log and contact the care team if you need help.',translationStatus:'unsupported',accessibilityPreferences:['large-print','teach-back'],teachBack:'Interpreter assistance is requested before reviewing the instructions.',caregiverRole:'Caregiver present for support only.',interpreterRole:'Interpreter requested.',sharedDevice:true,proxyStatus:'revoked',verifiedPatientAuth:false};
  await driver.apply({...base(),...language});
  await driver.expectRejected({...base(),...language,...edit('language'),verifiedPatientAuth:true});
  await driver.expectRejected({...base(),...language,...edit('language'),translationStatus:'translated',translatedText:'Mantenga el registro acordado.'});
  await driver.apply({...base(),...language,...edit('language'),instructionsLanguage:'es',translationStatus:'translated',translatedText:'Mantenga el registro acordado de sus caminatas. Contacte al equipo si necesita ayuda.',translationReviewer:'Acceptance bilingual reviewer',interpreterRole:'Attributed synthetic interpreter review.',teachBack:'Patient repeated the agreed reminder steps through the interpreter.'});
  assert.equal(saved('language').translationStatus,'translated');
  assert.deepEqual(saved('language').planRef,{planId:plan.id,planVersion:plan.version});
  assert.equal(saved('language').verifiedPatientAuth,false);
  assert.equal(saved('language').proxyStatus,'revoked');
  driver.record('J13','passed');

  const stage=(id,title,prerequisites=[])=>({id,title,activity:'Document assigned operational work.',prerequisites,status:'pending',owner:'Acceptance coordinator',dueDate:futureDay});
  const stages=[stage('review-access','Review access needs'),stage('schedule-follow-up','Arrange follow-up',['review-access'])];
  const pathway={type:'patient-coordination.pathway.save',pathwayKey:encounterId,pathwayVersion:'acceptance-v1',currentVersion:true,stages,eventId:crypto.randomUUID(),transitionReason:'Create the synthetic operational pathway.'};
  await driver.apply({...base(),...pathway});
  await driver.expectRejected({...base(),...pathway,...edit('pathways'),eventId:crypto.randomUUID(),stages:[stages[0],{...stages[1],status:'active'}]});
  for(const [index,status] of [[0,'active'],[0,'completed'],[1,'active'],[1,'completed']]){
    const updatedStages=saved('pathways').stages.map((stage,stageIndex)=>stageIndex===index?{...stage,status}:stage);
    await driver.apply({...base(),...pathway,...edit('pathways'),stages:updatedStages,eventId:crypto.randomUUID(),transitionReason:`Document stage ${index+1} as ${status}.`});
  }
  assert.ok(saved('pathways').stages.every(stage=>stage.status==='completed'));
  assert.equal(saved('pathways').processedEvents.length,5);
  await driver.expectRejected({...base(),...pathway,...edit('pathways'),eventId:crypto.randomUUID(),stages:[saved('pathways').stages[0]]});
  driver.record('J15','passed');

  const schedule={type:'patient-coordination.schedule.save',dueWindowTimezone:'UTC',phase:'follow-up-due',dueWindowStart:day,dueWindowEnd:futureDay,owner:'Acceptance scheduler',preferredChannel:'phone',optedOut:false,bookingEvidenceSource:'none',outreachStatus:'not-started',transitionReason:'Document that follow-up is due.'};
  await driver.expectRejected({...base(),...schedule,phase:'attended'});
  await driver.apply({...base(),...schedule});
  await driver.apply({...base(),...schedule,...edit('scheduling'),phase:'requested',outreachStatus:'in-progress',outreachNote:'Synthetic manual appointment request.'});
  const booking={...schedule,appointmentStartsAt:new Date(Date.parse(now)-60_000).toISOString(),appointmentTimezone:'UTC',bookingEvidenceSource:'manual',bookingEvidenceRef:'Synthetic scheduler confirmation, entered retrospectively',outreachStatus:'completed'};
  await driver.expectRejected({...base(),...booking,...edit('scheduling'),phase:'booking-reported',bookingEvidenceSource:'none',bookingEvidenceRef:undefined});
  await driver.apply({...base(),...booking,...edit('scheduling'),phase:'booking-reported',outreachNote:'Staff recorded the manual scheduler confirmation.'});
  await driver.apply({...base(),...booking,...edit('scheduling'),phase:'confirmed'});
  await driver.expectRejected({...base(),...booking,...edit('scheduling'),phase:'confirmed',appointmentStartsAt:futureTime});
  await driver.expectRejected({...base(),...booking,...edit('scheduling'),phase:'no-show',cancellationReason:'The patient did not join the scheduled call.'});
  await driver.apply({...base(),...booking,...edit('scheduling'),phase:'no-show',outreachStatus:'retry-scheduled',nextAttemptAt:futureTime,cancellationReason:'The patient did not join the scheduled call.',transitionReason:'The coordinator will call again tomorrow.'});
  assert.equal(saved('scheduling').outreach.status,'retry-scheduled');
  await driver.apply({...base(),...schedule,...edit('scheduling'),phase:'reschedule-outreach',outreachStatus:'retry-scheduled',nextAttemptAt:futureTime,transitionReason:'The coordinator is arranging another visit.'});
  assert.ok(saved('scheduling').previousAppointments.length);
  await driver.apply({...base(),...booking,...edit('scheduling'),phase:'booking-reported',bookingEvidenceRef:'Coordinator documented the replacement appointment.'});
  await driver.apply({...base(),...booking,...edit('scheduling'),phase:'confirmed',bookingEvidenceRef:'Coordinator documented the replacement appointment.'});
  await driver.apply({...base(),...booking,...edit('scheduling'),phase:'attended',bookingEvidenceRef:'Coordinator documented the replacement appointment.',transitionReason:'The clinician confirmed that the visit took place.'});
  assert.equal(saved('scheduling').phase,'attended');
  assert.equal(saved('scheduling').appointment.evidenceSource,'manual');
  assert.ok(saved('scheduling').outreach.attempts.some(attempt=>attempt.outcome==='booked'));
  driver.record('J16','passed');
}
