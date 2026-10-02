import {buildEngineOutput} from '../engine-demo';
import type {Workspace,Patient} from '../theranetrix';
import {featureEnabled,latest} from '../theranetrix';
import {applyWorkflowAction,clinicalWorkflowWorkerProvenance,normalizeClinicalWorkflows,workflowInputRevision,workspaceCarePlans,type ClinicalWorkflowDomain} from './index';
import {ensureGovernanceShowcase} from './governance-showcase';
import {requireGovernedUse} from './governance-runtime';

export const workflowShowcaseVersion=1;
export type WorkflowShowcase={version:number;loadedAt:string;patientIds:string[]};
const owner='Dr. Maya Chen';
const coordinator='Alex Morgan, NP';

/** Curated, resumable patient stories. Only new records belonging to these encounters are added. */
export function ensureWorkflowShowcase(source:Workspace,actor:string,now:string):Workspace{
  if((source.workflowShowcase?.version??0)>=workflowShowcaseVersion)return source;
  let data=structuredClone(source);
  data.clinicalWorkflows=normalizeClinicalWorkflows(data.clinicalWorkflows);
  const day=now.slice(0,10);
  const dateAfter=(days:number)=>new Date(Date.parse(now)+days*86400000).toISOString().slice(0,10);
  // An hour earlier, but never on the previous day: the story schedules the consultation for today,
  // and between 00:00 and 01:00 UTC an hour earlier would fall before that scheduled date.
  const nowMs=Date.parse(now),dayStart=Date.parse(day+'T00:00:00.000Z');
  const before=new Date(nowMs-3600000>=dayStart?nowMs-3600000:dayStart+Math.floor((nowMs-dayStart)/2)).toISOString();
  const patients=['TN-DEMO-01','TN-DEMO-02','TN-DEMO-03'].map(id=>data.patients.find(p=>p.id===id)).filter((p):p is Patient=>!!p);
  let sequence=0;
  function save(domain:ClinicalWorkflowDomain,command:{type:string;patientId?:string;[key:string]:unknown}){
    const requestId=`showcase-workflow-v1-${++sequence}`;
    data=applyWorkflowAction(data,{type:'workflow.apply',domain,requestId,expectedSliceVersion:data.clinicalWorkflows!.slices[domain].version,
      ...(clinicalWorkflowWorkerProvenance[domain].scope==='patient'?{patientId:command.patientId}:{}),command:{...command,requestId}},actor,now);
  }
  const encounter=(id:string)=>`review-${id}`;
  for(const patient of patients){
    const patientId=patient.id,encounterId=encounter(patientId),scope={patientId,encounterId};
    const state=()=>data.clinicalWorkflows!.slices.encounters.state;
    if(state().preparations.some(r=>r.patientId===patientId&&r.encounterId===encounterId))continue;
    const context=patient.clinicalContext;
    save('encounters',{type:'encounters.preparation.save',...scope,reasonForVisit:'Review progress, treatment experience and the next step together.',changesSinceLastReviewedEncounter:patient.treatmentReview?.goalEvidence??'Review the latest patient reports and the current goal.',sourceDates:[day],preparationOwner:coordinator,openQuestions:['Which change would make the biggest difference this week?'],missingInputs:[],patientGoal:patient.goal,status:'clinician-reviewed'});
    save('encounters',{type:'encounters.intake.save',...scope,sourceHistory:context?.medicalHistory||patient.condition,medicationsReconciliationReference:'Medication history in the patient record',goals:[patient.goal],consentReadiness:'ready',accessReadiness:'ready',unansweredFields:[],declinedFields:[],coordinatorClarification:context?.preferences||'Review the preferred contact channel.',baselineReviewed:true,enrollmentDecision:'enroll',syntheticEvaluation:true,finalDiagnosis:''});
    save('encounters',{type:'encounters.assessment.save',...scope,presentingProblem:patient.condition,painDistributionPhenotype:context?.painLocation||'Patient-reported pain',timeline:context?.painDuration||'See the longitudinal record',relevantExamination:'Focused assessment reviewed with the care team.',comorbidContext:context?.medicalHistory||'History reviewed.',psychologicalContext:context?.psychologicalContext||'Priorities discussed with the patient.',socialContext:context?.socialContext||'Support and daily activities reviewed.',workingAssessment:'Review the current plan against the patient’s goal and recent reports.',alternatives:['Continue the current plan with follow-up','Revisit the strategy after further information'],supportingFindings:['Dated patient reports and goal history are available.'],refutingFindings:['An improving score alone does not establish that the goal is met.'],uncertainty:'Confirm tolerability and everyday function at the next review.',furtherWorkup:'Reconcile outstanding outside records where needed.',route:'continue-local',deferReason:''});
    if(featureEnabled(data,'assessments'))save('encounters',{type:'encounters.observations.save',...scope,instrument:'local-0-10',submissionStatus:'confirmed',entries:([{metric:'pain',value:latest(patient.pain)},{metric:'function',value:latest(patient.function)},{metric:'sleep',value:latest(patient.sleep)}] as const).map(({metric,value})=>({metric,value,status:value===0?'zero':'answered',source:'Patient self-report',recordedAt:before}))});
    const assessment=state().assessments.find(r=>r.patientId===patientId&&r.encounterId===encounterId)!;
    const planText=patient.carePlans[0]?.text||'Keep your agreed activity log and review it with the care team at follow-up.';
    save('encounters',{type:'encounters.signoff.saveDraft',...scope,assessmentRecordId:assessment.id,rationale:'Reviewed the current record and the patient’s stated preferences together.',patientFacingPlan:planText,disposition:{selected:['Continue the agreed care activities'],rejected:[],deferred:['Revisit treatment choices after the next progress review'],noChange:true},owner,followUp:{date:dateAfter(7),time:'10:00',timezone:'Europe/Lisbon'},pendingWork:[{title:'Review the patient’s activity log',owner:coordinator,dueDate:dateAfter(7),disposition:'pending'}],teachBack:'The patient described the agreed next step and how to contact the care team.'});
    let signoff=state().signoffs.find(r=>r.patientId===patientId&&r.encounterId===encounterId)!;
    for(const type of ['encounters.signoff.review','encounters.signoff.sign']){
      save('encounters',{type,...scope,id:signoff.id,expectedVersion:signoff.version,reason:'Reviewed the patient’s recorded plan and current observations.'});
      signoff=state().signoffs.find(r=>r.id===signoff.id)!;
    }
    const signedPlan=data.patients.find(record=>record.id===patientId)!.carePlans.find(plan=>plan.workflowRecordId===signoff.id);
    if(signedPlan&&patient.carePlans[0])signedPlan.supersedes=patient.carePlans[0].id;
    save('encounters',{type:'encounters.episode.save',...scope,goalEvidence:patient.treatmentReview?.goalEvidence||patient.goal,observedOutcomes:'Recent patient reports are available in the outcome history.',priorInterventions:context?.priorTreatments||'See treatment history.',ongoingInterventions:planText,patientExperience:'Discuss which parts of the plan are helping in everyday life.',remainingConcerns:['Confirm the next follow-up and the owner of outstanding work.'],decision:'continue',pendingWorkDisposition:'Activity-log review remains with the named care team.',pendingWorkOwner:coordinator,status:'draft'});
  }

  const primary=patients[0];
  if(primary){
    const patientId=primary.id,encounterId=encounter(patientId),scope={patientId,encounterId};
    const resultState=()=>data.clinicalWorkflows!.slices['results-referrals'].state;
    const resultId=`showcase-result-${patientId}`;
    if(!resultState().results.some(r=>r.id===resultId)){
      const result=(verb:string,fields:Record<string,unknown>={})=>save('results-referrals',{type:`results-referrals.result.${verb}`,id:resultId,patientId,expectedVersion:resultState().results.find(r=>r.id===resultId)?.version??0,reason:'Track the received report through review and patient follow-up.',...fields});
      result('create',{encounterId,requestLabel:'Outside treatment review report',owner,requestedAt:dateAfter(-3),dueAt:dateAfter(2)});
      result('mark-awaiting');
      result('receive',{revisionId:`showcase-result-original-${patientId}`,source:'manual',summary:'The outside clinic’s report has arrived. The treatment list needs reconciliation with the patient’s account.',collectedAt:before,receivedAt:now,evidenceRef:'Outside clinic report, visit correspondence'});
    }
    const referralId=`showcase-referral-${patientId}`;
    if(!resultState().referrals.some(r=>r.id===referralId)){
      const referral=(verb:string,fields:Record<string,unknown>={})=>save('results-referrals',{type:`results-referrals.referral.${verb}`,id:referralId,patientId,expectedVersion:resultState().referrals.find(r=>r.id===referralId)?.version??0,reason:'Follow the specialist consultation back into the shared care plan.',...fields});
      referral('create',{encounterId,clinicalQuestion:'Review the reported morning effects and options that support desk-work tolerance.',receivingService:'Pain rehabilitation team',owner:coordinator,dueAt:dateAfter(3),supportingEvidence:'Current care plan, medication experience and activity log'});
      referral('send',{evidenceRef:'Referral coordinator’s dispatch record'});
      referral('accept',{evidenceRef:'Receiving team’s acceptance record'});
      referral('schedule',{scheduledFor:day,evidenceRef:'Appointment coordinator’s confirmation'});
      referral('consultation-complete',{completedAt:before,evidenceRef:'Rehabilitation consultation note'});
      referral('advice-received',{receivedAt:now,adviceSummary:'Agree an activity-pacing plan and review treatment tolerability with the responsible clinician.',originalAdvice:'Patient priorities include remaining alert at work. Coordinate the next review with the existing care team and retain the current plan until that review.',evidenceRef:'Rehabilitation advice letter'});
    }
    const treatment=data.clinicalWorkflows!.slices['treatment-continuity'].state;
    const treat=(verb:string,id:string,fields:Record<string,unknown>)=>save('treatment-continuity',{type:`treatment-continuity.${verb}`,patientId,id,reason:'Recorded for the upcoming shared review.',evidenceRef:'Patient conversation and dated care record',owner,dueDate:dateAfter(3),...fields});
    if(!treatment.reconciliations.some(r=>r.id===`showcase-reconciliation-${patientId}`))treat('record-reconciliation',`showcase-reconciliation-${patientId}`,{source:'Patient report and outside medication list',sourceDate:day,status:'unreviewed',reviewer:owner,resolution:'',conflicts:[{field:'Current treatment use',patientFact:'The patient reports changing when the evening treatment is taken.',externalFact:'The outside list retains the previous timing.',outcome:'unreviewed'}]});
    const medication=primary.medications.find(m=>m.status==='Active')??primary.medications[0];
    if(medication&&!treatment.experiences.some(r=>r.id===`showcase-experience-${patientId}`))treat('record-experience',`showcase-experience-${patientId}`,{medicationName:medication.name,reportedUse:'active',regimen:medication.regimen||'Current recorded regimen',regimenStartedAt:dateAfter(-21),regimenDurationDays:21,reportedBenefit:'partial',tolerability:'side-effects',functionalGoal:primary.goal,patientConcern:'Morning grogginess interferes with desk work.',trialStatus:'active',stopDate:'',stopReason:'',reassessmentDecision:'defer',alternativePlan:''});
    if(medication&&!treatment.lifecycles.some(r=>r.id===`showcase-lifecycle-${patientId}`)){
      const fields={medicationName:medication.name,manualSource:'Current clinician treatment record',safetyPrerequisites:['Review reported reactions and the reconciled medication list'],reviewPrerequisites:['Discuss benefit, tolerability and patient priorities'],prescriberResponsibility:owner,clinicalServiceAvailable:true,statusNote:'Awaiting the responsible clinician’s review.',renewalRequested:false,failureReason:'',notStartedReason:''};
      treat('update-lifecycle',`showcase-lifecycle-${patientId}`,{...fields,stage:'considered'});
      const current=data.clinicalWorkflows!.slices['treatment-continuity'].state.lifecycles.find(r=>r.id===`showcase-lifecycle-${patientId}`)!;
      treat('update-lifecycle',current.id,{...fields,stage:'clinician-review',expectedVersion:current.version});
    }
    if(!treatment.accessBarriers.some(r=>r.id===`showcase-access-${patientId}`))treat('manage-access',`showcase-access-${patientId}`,{barrierType:'timing',status:'unresolved',patientChoice:'A visit after work would be easier to attend.',outreach:'Coordinator contacted the scheduling team.',alternatives:'Offer a telephone visit if an evening slot is unavailable.',requiresClinicianReview:true,resolution:''});
    if(!treatment.transitions.some(r=>r.id===`showcase-transition-${patientId}`))treat('record-transition',`showcase-transition-${patientId}`,{externalCareSource:'Pain rehabilitation service',previousInstructions:primary.carePlans[0]?.text||'Continue the agreed care activities.',newInstructions:'Review the specialist’s advice with the usual care team.',discrepancies:'Confirm the current medication timing.',pendingWork:['Reconcile medication timing','Review rehabilitation advice'],resolvedPendingWork:[],receivingClinician:owner,ownershipAccepted:false,reconciledInstructions:'',patientCommunication:'',handoverStatus:'draft'});
    if(!treatment.multidisciplinary.some(r=>r.id===`showcase-team-${patientId}`))treat('update-multidisciplinary',`showcase-team-${patientId}`,{functionalGoal:primary.goal,interventions:[{id:'graded-activity',title:'Activity pacing and graded movement',professional:'Jamie Taylor, physiotherapist',status:'active',accessBarrier:'',patientExperience:'The shorter activity blocks are easier to fit around work.',observedOutcome:'Activity log ready for review.',decision:'continue'},{id:'work-routine',title:'Workstation and daily-routine review',professional:'Sam Rivera, occupational therapist',status:'blocked',accessBarrier:'Evening appointment needed.',patientExperience:'Would like practical changes for the workday.',observedOutcome:'First visit requested.',decision:'continue'}]});

    const coordination=()=>data.clinicalWorkflows!.slices['patient-coordination'].state;
    const plan=workspaceCarePlans(data).find(p=>p.patientId===patientId)!;
    if(featureEnabled(data,'advisor')&&!coordination().support.some(r=>r.encounterId===encounterId))save('patient-coordination',{type:'patient-coordination.support.save',...scope,conversationDate:day,planId:plan.id,planVersion:plan.version,goalText:primary.goal,approvedEducation:['Pain plan copy','Scheduling checklist'],reminderChannel:'phone',optedOut:false,dueCheckInDate:dateAfter(7),originalText:'Please call after work. I want to keep track of whether I can sit comfortably for longer.',attributedSummary:'Patient prefers a call after work and wants follow-up to focus on desk-work tolerance.',summaryAuthor:coordinator,participationMode:'staff-recorded',participant:'patient',recordedSource:'Patient telephone conversation'});
    if(!coordination().handoffs.some(r=>r.encounterId===encounterId))save('patient-coordination',{type:'patient-coordination.handoff.save',...scope,concern:'Patient asks to discuss morning grogginess and when to take the current treatment.',dedupeKey:`showcase-callback-${patientId}`,priority:'high',urgencySourceType:'authorized-human',urgencySource:'Priority assigned by the reviewing clinician',responsibleTeam:'Chronic Pain Program',responsiblePerson:owner,coverageExpectation:'Review during the current clinical session.',fallbackOwner:coordinator,phase:'locally-saved',deliveryStatus:'pending',deliveryEvidenceSource:'none',patientContactStatus:'not-attempted',dueAt:new Date(Date.parse(now)+3600000).toISOString(),nextAttemptAt:new Date(Date.parse(now)+3600000).toISOString(),transitionReason:'Concern added to the clinician’s review queue.'});
    if(!coordination().language.some(r=>r.encounterId===encounterId))save('patient-coordination',{type:'patient-coordination.language.save',...scope,preferredLanguage:'en',instructionsLanguage:'en',sourceText:plan.summary,translationStatus:'not-needed',accessibilityPreferences:['large-print','teach-back'],teachBack:'Ask the patient to explain the next step in their own words.',caregiverRole:'Support with appointments when the patient requests it.',interpreterRole:'Not requested for this conversation.',sharedDevice:false,proxyStatus:'none',verifiedPatientAuth:false});
    if(featureEnabled(data,'pathways')&&!coordination().pathways.some(r=>r.encounterId===encounterId))save('patient-coordination',{type:'patient-coordination.pathway.save',...scope,pathwayKey:`showcase-pathway-${patientId}`,pathwayVersion:'1',currentVersion:true,stages:[{id:'review-priorities',title:'Review goals and treatment experience',activity:'Review the patient’s priorities and current care plan.',prerequisites:[],status:'pending',owner,dueDate:day},{id:'agree-follow-up',title:'Agree the follow-up',activity:'Confirm a feasible appointment and the next activity-log review.',prerequisites:['review-priorities'],status:'pending',owner:coordinator,dueDate:dateAfter(7)}],eventId:`showcase-pathway-event-${patientId}`,transitionReason:'Care activities added to the shared record.'});
    if(!coordination().scheduling.some(r=>r.encounterId===encounterId))save('patient-coordination',{type:'patient-coordination.schedule.save',dueWindowTimezone:'UTC',...scope,phase:'follow-up-due',dueWindowStart:day,dueWindowEnd:dateAfter(7),owner:coordinator,preferredChannel:'phone',optedOut:false,bookingEvidenceSource:'none',outreachStatus:'not-started',transitionReason:'Follow-up due; choose an appointment with the patient.'});
  }

  const governance=()=>data.clinicalWorkflows!.slices['program-governance'].state;
  const program=(type:string,fields:Record<string,unknown>)=>save('program-governance',{type:`program-governance.${type}`,...fields});
  if(!governance().configurations.length&&Object.values(data.features).some(Boolean)){program('configuration-save-draft',{record:{title:'Chronic Pain Program',capabilityChoices:Object.keys(data.features).filter(key=>data.features[key as keyof Workspace['features']]),allowedCadence:['weekly'],languages:['English','Spanish'],communicationSettings:['in-app','phone'],displayReferences:['Patient goals, outcomes and pending work'],safetyEssentials:['Patient identity','Source dates','Named care owner'],nonHideableSafetyEssentials:['Patient identity','Source dates','Named care owner']}});
    const blockedDependencies=Object.keys(data.features).some(key=>data.features[key as keyof Workspace['features']]&&!featureEnabled(data,key as keyof Workspace['features']));
    if(!blockedDependencies){
      let record=governance().configurations[0];
      program('configuration-review',{id:record.id,expectedVersion:record.version,reviewNote:'Reviewed the demonstration workspace settings.'});
      record=governance().configurations[0];
      program('configuration-activate',{id:record.id,expectedVersion:record.version,reason:'Use these settings for the demonstration workspace.'});
    }
  }
  if(!governance().protocols.length)program('protocol-save-draft',{record:{title:'Progress review and follow-up',owner,evidenceLocator:'Program handbook / follow-up workflow',unresolvedQuestions:[],steps:[{id:'review',title:'Review the patient’s goal and recent reports',owner,kind:'action',prerequisites:[],nextStepIds:['follow-up'],branchStepIds:[],openQuestion:''},{id:'follow-up',title:'Agree an owned follow-up',owner:coordinator,kind:'handoff',prerequisites:['review'],nextStepIds:[],branchStepIds:[],openQuestion:''}]}});
  if(!governance().evidences.length)program('evidence-save-draft',{record:{title:'Patient-reported progress review',indication:'Support a structured care-team discussion',population:'Adult chronic pain program',endpoint:'Documented patient goal and follow-up',supportingSources:[{title:'Program review checklist',locator:'Program handbook / review checklist',kind:'supporting',publicationDate:day,retracted:false}],rights:'owned'}});
  const configuration=governance().configurations.find(r=>r.id===governance().activeConfigurationId)??governance().configurations[0];
  if(!governance().releases.length&&configuration?.status==='active')program('release-save-draft',{record:{title:'Connected care walkthrough',modelId:'care-review-example',softwareId:'theranetrix',configurationId:configuration.id,intendedUse:'Demonstrate review, documentation and care coordination',evidenceRefIds:governance().evidences.map(record=>record.id),modelClaims:['Dated records and accountable follow-up'],evaluation:{agreementSummary:'Compare each displayed output with its supporting record.',performanceSummary:'Review the working care journeys.',limitations:'Clinical performance is evaluated separately.'},unresolvedConditions:['Complete the presentation review'],overrideTrainingPolicy:'Manual review only'}});
  if(!governance().operations.length)program('operation-report',{record:{title:'Delayed observation feed',kind:'incident',affectedServices:['Observation inbox'],owner:coordinator,severity:'low',actionsTaken:['Care team notified and source freshness reviewed.'],evidenceRef:'Operations activity log',restoreOutcome:'not-applicable'}});
  if(!governance().monitoring.length)program('monitoring-record-service',{record:{serviceDate:day,activity:'Review patient-reported progress and coordinate follow-up',source:'Care-team activity record',evidenceRef:'Visit and contact notes',missingDocumentation:['Confirm the service documentation with the reviewing team.']}});
  if(!governance().readiness.length)program('readiness-save-draft',{record:{title:'Connected care release review',functions:['Patient review','Shared care planning','Care coordination'],claims:['Working demonstration of the connected care journey'],partnerAssets:['Local demonstration connection'],partnerRights:['Program-owned demonstration records'],partnerResponsibilities:['Review integration requirements before live service use'],evidenceRefIds:[],blockingConditions:[],mandatoryGates:[{id:'journey-review',title:'Review the complete patient journeys',required:true,disposition:'open',evidenceRef:''},{id:'service-review',title:'Review live-service requirements',required:true,disposition:'open',evidenceRef:''}]}});

  data=ensureGovernanceShowcase(data,actor,now);
  // Retain prior snapshots and capture fresh runs against the now-connected record.
  for(const seeded of patients){
    const patient=data.patients.find(record=>record.id===seeded.id)!;
    if(source.showcaseVersion===undefined&&patient.id==='TN-DEMO-02'&&patient.treatmentReview?.author===owner&&patient.treatmentReview.date==='2026-09-14T10:00:00Z'&&patient.treatmentReview.goalAtReview===patient.goal){
      const {history,...previous}=patient.treatmentReview;
      patient.treatmentReview={...previous,date:now,author:owner,history:[previous,...history]};
      delete patient.recordReviewRequiredSince;patient.status='On track';
    }
    const previous=data.engineRuns?.find(run=>run.patientId===patient.id);
    if(previous&&featureEnabled(data,'digitalTwin')){const releaseRef=requireGovernedUse(data,'digitalTwin',now);data.engineRuns=[{...buildEngineOutput(patient,data,previous.preferences),id:`showcase-workflow-run-${patient.id}`,date:now,actor,...(releaseRef?{releaseRef}:{})},...(data.engineRuns??[])];}
  }
  // Source counters must be final before capturing the current decision inputs.
  for(const patient of patients){
    if(!featureEnabled(data,'digitalTwin'))continue;
    const patientId=patient.id,encounterId=encounter(patientId),scope={patientId,encounterId};
    const state=()=>data.clinicalWorkflows!.slices.decisions.state;
    if(state().observedReviews.some(r=>r.patientId===patientId&&r.encounterId===encounterId))continue;
    const current=data.patients.find(p=>p.id===patientId)!;
    const inputVersion=workflowInputRevision(current,data);
    const evidence={id:`showcase-progress-${patientId}`,title:'Patient reports and current care plan',locator:'Patient record / outcomes and signed plan',version:'1',reviewDate:day};
    const metric=(values:number[])=>({prior:values.length?values[0]:null,current:values.length?latest(values):null});
    save('decisions',{type:'decisions.review.capture',...scope,expectedVersion:0,inputVersion,collectedAt:before,receivedAt:now,provenance:'synthetic',metrics:{pain:metric(current.pain),function:metric(current.function),sleep:metric(current.sleep)},contradictoryMetrics:[],clinicalInterpretation:current.treatmentReview?.goalEvidence||'Review the trend alongside the patient’s everyday activities.',goal:current.goal,nextMonitoringQuestion:'Is the current plan helping with the goal that matters to the patient?'});
    if(featureEnabled(data,'pst'))save('decisions',{type:'decisions.comparison.capture',...scope,expectedVersion:0,inputVersion,preferenceSummary:current.clinicalContext?.preferences||'Keep the patient’s daily activities and treatment burden central.',preferenceWeights:{relief:25,function:45,sleep:15,safety:15},options:[{id:'review-current',title:'Review the current treatment and reported effects',status:'for-discussion',rationale:'Consider the reported benefit alongside the impact on everyday function.',applicability:'Discuss against the current history and patient priorities.',evidenceRefs:[evidence.id]},{id:'support-function',title:'Agree practical support for the patient’s goal',status:'for-discussion',rationale:'Activity pacing and a feasible follow-up can support the agreed plan.',applicability:'Confirm which activities the patient wants to prioritize.',evidenceRefs:[evidence.id]}],disposition:'defer',rationale:'Review the options together before choosing the next step.',safetyReview:'Current treatment history and reported effects are visible for review.',missingInputs:[],evidenceRefs:[evidence]});
    if(featureEnabled(data,'pst')&&featureEnabled(data,'shadow'))save('decisions',{type:'decisions.outputs.capture',...scope,expectedVersion:0,inputVersion,pst:{outputId:`showcase-pst-${patientId}`,summary:'Focus the discussion on the patient’s functional goal and the reported treatment experience.',limitations:['Review the source history and current priorities.']},shadow:{outputId:`showcase-shadow-${patientId}`,summary:'Check source freshness, unresolved questions and whether the proposed next step matches the recorded goal.',limitations:['Resolve missing or conflicting information before sign-off.']},agreement:'partial',limitations:['The two perspectives support a clinician-led discussion.'],supportingEvidence:[evidence],conflictingEvidence:[],clarificationRequests:['Confirm the patient’s preferred next step.'],clinicianDisposition:'request-clarification',dispositionExplanation:'Compare the perspectives and record the rationale for the agreed plan.',suitability:'unsupported',provenance:'synthetic',modelVersions:['demonstration-1'],configurationVersions:['care-review-1']});
    const observed=state().observedReviews.find(r=>r.patientId===patientId&&r.encounterId===encounterId)!;
    const comparison=state().comparisonSnapshots.find(r=>r.patientId===patientId&&r.encounterId===encounterId);
    const outputs=state().engineComparisons.find(r=>r.patientId===patientId&&r.encounterId===encounterId);
    save('decisions',{type:'decisions.draft.save',...scope,expectedInputVersion:inputVersion,summary:'Review the patient’s progress, preferences and current plan, then agree the next step together.',payload:{observedReviewId:observed.id,...(comparison?{comparisonSnapshotId:comparison.id}:{}),...(outputs?{engineComparisonId:outputs.id}:{}),pendingDisposition:'defer',note:'Ready for the clinician’s review.'}});
  }
  data.workflowShowcase={version:workflowShowcaseVersion,loadedAt:now,patientIds:patients.map(p=>p.id)};
  return data;
}
