import {applyCareOperations,type CareOperationsAction} from '../care-operations';
import {buildEngineOutput,type EnginePreferences,type EngineRun} from '../engine-demo';
import {featureEnabled,type Workspace} from '../theranetrix';
import {applyWorkflowAction,normalizeClinicalWorkflows,workflowInputRevision,workspaceCarePlans,type ClinicalWorkflowDomain,type WorkflowApplyAction} from './index';
import {ensureGovernanceShowcase} from './governance-showcase';
import {requireGovernedUse} from './governance-runtime';
import type {SignoffRecord} from './encounters';

const clinician='Dr. Maya Chen';
const coordinator='Alex Morgan, NP';
const patientIds=['TN-DEMO-01','TN-DEMO-02','TN-DEMO-03'] as const;
const encounterFor=(patientId:string)=>`story-completion-v2-${patientId}`;
const emmaPlan='We will keep your current medication unchanged for now and use your September visit to look closely at the morning grogginess you reported. Please keep noting how long you manage at your desk and how you feel in the mornings. If the grogginess gets worse before then, send a message and we will bring the visit forward.';
const emmaSpanishPlan='Por ahora mantendremos tu medicación actual sin cambios y aprovecharemos tu visita de septiembre para revisar con detalle el aturdimiento por las mañanas que has comentado. Sigue anotando cuánto tiempo puedes trabajar en tu escritorio y cómo te sientes por las mañanas. Si el aturdimiento empeora antes de la visita, envíanos un mensaje y adelantaremos la cita.';
const clarificationReason='Record the question about the follow-up due date and who will confirm the appointment.';
const understoodReason='Record the patient’s explanation after the coordinator clarified the follow-up arrangements.';

type Story={preferences:EnginePreferences;interpretation:string;question:string;summary:string;rationale:string;workingNote:string};
const stories:Record<typeof patientIds[number],Story>={
  'TN-DEMO-01':{preferences:{relief:30,alertness:50,routine:20},interpretation:'Desk-work tolerance has improved to about fifteen minutes, but morning grogginess is still interfering with concentration. The outside medication list and the patient’s account require reconciliation. A missed report does not establish deterioration.',question:'How long can Emma work at her desk, and is morning grogginess changing?',summary:'Review the reported morning effects and the outside medication history before changing treatment. The current plan remains available in English and reviewed Spanish, and the coordinator owns the next contact.',rationale:'The saved rankings differ because the record contains reported treatment burden and an unresolved concern. Record the comparison for discussion and defer a treatment change until the responsible clinician reviews those sources.',workingNote:'Ask whether an after-work call would make the next review easier. Confirm the missing report before interpreting the trend.'},
  'TN-DEMO-02':{preferences:{relief:40,alertness:40,routine:20},interpretation:'Lucas reports meeting the twenty-minute walking goal on at least five days a week. Residual tingling after longer walks remains relevant. The phone fallback allowed the care-team conversation to finish after the video connection failed.',question:'Was the walking goal maintained during travel, and did benefit or tolerability change?',summary:'The recorded walking improvement and current plan were reviewed. Retain the agreed plan while confirming progress and treatment experience after travel.',rationale:'Both saved rankings can be inspected alongside the walking reports. Agreement between rule sets does not replace the review of benefit, tolerability and patient priorities.',workingNote:'At the next review, ask about walking during travel and any change in tingling after longer walks.'},
  'TN-DEMO-03':{preferences:{relief:25,alertness:45,routine:30},interpretation:'Priya’s medication reconciliation records that she is taking no pain medication, in line with her preference. Nightly waking has improved but the sleep goal is not yet met. The interrupted remote visit leaves the assessment incomplete and a named callback remains due.',question:'How many times is Priya waking because of foot pain, and can the remote assessment be completed?',summary:'Keep the existing non-medication plan visible and complete the interrupted assessment before revisiting treatment choices. The coordinator owns the callback.',rationale:'A confirmed absence of pain medication is distinct from an unreconciled list. The saved comparison supports a later discussion; it does not start medication or complete the interrupted assessment.',workingNote:'Confirm the callback time with Priya and her daughter. Complete the remaining assessment before discussing whether the sleep routine is still helping.'},
};

/** Add the remaining authored stories once, through the same commands as the screens.
 * Existing records are retained, and a completed story is never refreshed over later user edits.
 */
export function ensureStoryCompletion(source:Workspace,actor:string,now:string):Workspace{
  const present=patientIds.filter(id=>source.patients.some(patient=>patient.id===id));
  if(!present.length)return source;
  const completed=(patientId:string)=>{
    const state=source.clinicalWorkflows?.slices.decisions.state,encounterId=encounterFor(patientId);
    return state?.signedSnapshots.some(row=>row.patientId===patientId&&row.encounterId===encounterId)&&state.workingCopies?.some(row=>row.patientId===patientId&&row.encounterId===encounterId);
  };
  if(present.every(completed))return source;
  let data=structuredClone(source);
  data.clinicalWorkflows=normalizeClinicalWorkflows(data.clinicalWorkflows);
  const instant=(minutes:number)=>new Date(Date.parse(now)+minutes*60_000).toISOString();
  const patient=(patientId:string)=>data.patients.find(row=>row.id===patientId)!;
  const decisions=()=>data.clinicalWorkflows!.slices.decisions.state;
  const encounters=()=>data.clinicalWorkflows!.slices.encounters.state;
  function save(domain:ClinicalWorkflowDomain,key:string,command:WorkflowApplyAction['command']&{patientId:string},at=now){
    const requestId=`story-v2-${command.patientId}-${key}`;
    data=applyWorkflowAction(data,{type:'workflow.apply',domain,patientId:command.patientId,requestId,expectedSliceVersion:data.clinicalWorkflows!.slices[domain].version,command:{...command,requestId}},actor,at);
  }
  function care(patientId:string,key:string,command:CareOperationsAction['command']){
    data=applyCareOperations(data,{type:'care.operations',patientId,requestId:`story-v2-${patientId}-${key}`,expectedVersion:data.careOperations?.version??0,command},actor,now);
  }
  function signAmendment(original:SignoffRecord,key:string,fields:Record<string,unknown>){
    const scope={patientId:original.patientId,encounterId:original.encounterId};
    save('encounters',key,{type:'encounters.signoff.amend',...scope,id:original.id,expectedVersion:original.version,...fields});
    let amendment=encounters().signoffs.find(row=>row.amendedFromId===original.id)!;
    for(const verb of ['review','sign']){
      save('encounters',`${key}-${verb}`,{type:`encounters.signoff.${verb}`,...scope,id:amendment.id,expectedVersion:amendment.version,reason:'Reviewed the unchanged plan, the patient’s question and the recorded explanation.'});
      amendment=encounters().signoffs.find(row=>row.id===amendment.id)!;
    }
    return amendment;
  }

  // Contact history remains history: an interrupted visit is never labelled completed.
  for(const patientId of present){
    if(completed(patientId))continue;
    const encounterId=encounterFor(patientId);
    if(!data.careOperations?.coverage.some(row=>row.patientId===patientId))care(patientId,'coverage',{kind:'coverage',owner:clinician,backup:coordinator,startsAt:instant(-60),endsAt:instant(8*60),timezone:'Europe/Lisbon',evidence:'Maya Chen and Alex Morgan reviewed the afternoon cover list and agreed who will respond to outstanding patient contacts.'});
    if(!data.careOperations?.remoteVisits.some(row=>row.patientId===patientId)&&patientId!=='TN-DEMO-01'){
      const location=patientId==='TN-DEMO-02'?'At home; location and callback details confirmed at the start of the call.':'At home with her daughter; location and callback details confirmed.';
      care(patientId,'remote-connected',{kind:'remote-visit',encounterId,channel:'video',status:'connected',location,owner:coordinator,reason:'Patient joined the planned video conversation and identity and location were checked.'});
      care(patientId,'remote-interrupted',{kind:'remote-visit',encounterId,channel:'video',status:'interrupted',location,owner:coordinator,nextAttemptAt:instant(30),reason:patientId==='TN-DEMO-02'?'The video connection dropped during the travel and activity review.':'The video connection failed before the remaining foot symptoms and sleep questions could be reviewed.'});
      if(patientId==='TN-DEMO-02'){
        care(patientId,'remote-alternative',{kind:'remote-visit',encounterId,channel:'phone',status:'alternative-arranged',location,owner:coordinator,nextAttemptAt:instant(30),reason:'Patient agreed to continue by telephone using the confirmed callback number.'});
        care(patientId,'phone-connected',{kind:'remote-visit',encounterId,channel:'phone',status:'connected',location,owner:coordinator,reason:'Telephone contact was established and the patient confirmed he could continue privately.'});
        care(patientId,'remote-completed',{kind:'remote-visit',encounterId,channel:'phone',status:'completed',location,owner:coordinator,reason:'Completed the planned discussion of walking, travel and treatment experience. No physical examination was claimed.'});
      }
    }
    if(!data.careOperations?.monitoring.some(row=>row.patientId===patientId))care(patientId,'monitoring',patientId==='TN-DEMO-01'?{kind:'monitoring',status:'no-response',owner:coordinator,nextAttemptAt:instant(120),reason:'The planned progress report has not arrived. Call after work to check whether the request was received and whether another reporting method would help.'}:patientId==='TN-DEMO-03'?{kind:'monitoring',status:'disconnected',owner:coordinator,nextAttemptAt:instant(30),reason:'The remote connection ended before the sleep update was complete. Keep the last received report visible and collect the missing update during the callback.'}:{kind:'monitoring',status:'active',owner:coordinator,reason:'The recent walking and treatment-experience reports were received; continue the agreed review cadence.'});
  }

  // An exact, untouched authored plan can acquire clarification history. Never amend an operator's plan.
  if(present.includes('TN-DEMO-01')&&!completed('TN-DEMO-01')){
    const current=patient('TN-DEMO-01').carePlans[0];
    const original=encounters().signoffs.find(row=>row.id===current?.workflowRecordId&&row.patientId==='TN-DEMO-01'&&row.encounterId==='review-TN-DEMO-01'&&row.status==='signed'&&!row.amendedFromId&&row.teachBackOutcome===undefined&&row.version===3);
    if(original&&current.text===emmaPlan&&original.patientFacingPlan===emmaPlan&&!encounters().signoffs.some(row=>row.amendedFromId===original.id)){
      const clarification=signAmendment(original,'teachback-question',{amendmentReason:clarificationReason,teachBackOutcome:'needs-clarification',teachBack:'Emma asked whether the follow-up due date meant an appointment had already been booked.',clarification:{owner:coordinator,dueAt:instant(120),question:'Explain who will confirm the appointment and how Emma can request an earlier review.'}});
      signAmendment(clarification,'teachback-understood',{amendmentReason:understoodReason,teachBackOutcome:'understood',teachBack:'Emma explained that the coordinator will confirm the appointment, that a due date is not a booking, and that she can send a message if the morning grogginess worsens.'});
    }
  }

  for(const patientId of present){
    if(completed(patientId))continue;
    const encounterId=encounterFor(patientId),state=data.clinicalWorkflows!.slices['patient-coordination'].state;
    if(state.language.some(row=>row.patientId===patientId&&row.encounterId===encounterId))continue;
    const latest=state.language.filter(row=>row.patientId===patientId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
    const originalPreference=!latest||latest.encounterId===`review-${patientId}`&&latest.version===1&&!latest.planRef&&latest.teachBack==='Ask the patient to explain the next step in their own words.';
    if(!originalPreference||!latest&&patient(patientId).preferredLanguage!==undefined)continue;
    const current=patient(patientId),plan=workspaceCarePlans(data).find(row=>row.patientId===patientId&&row.id===current.carePlans[0]?.id);
    if(!plan?.summary)continue;
    const spanish=patientId==='TN-DEMO-01'&&plan.summary===emmaPlan;
    // The authored Spanish text is never attached to an edited English plan.
    if(patientId==='TN-DEMO-01'&&!spanish)continue;
    const access={type:'patient-coordination.language.save' as const,patientId,encounterId,planId:plan.id,planVersion:plan.version,sourceText:plan.summary,accessibilityPreferences:patientId==='TN-DEMO-03'?['large-print','telephone follow-up']:['plain-language instructions','teach-back'],teachBack:spanish?'Emma explained the next step in Spanish and distinguished the review due date from a confirmed appointment.':patientId==='TN-DEMO-02'?'Lucas described the walking goal and agreed to raise any change in benefit or tolerability at review.':'Ask Priya to explain the sleep-recording plan during the callback; the interrupted visit did not complete teach-back.',caregiverRole:patientId==='TN-DEMO-03'?'Daughter helps arrange appointments when Priya requests it.':'Patient chooses whether anyone else is involved.',sharedDevice:patientId==='TN-DEMO-03',proxyStatus:'none' as const,verifiedPatientAuth:false};
    if(spanish)save('patient-coordination','language-es',{...access,preferredLanguage:'es',instructionsLanguage:'es',translatedText:emmaSpanishPlan,translationReviewer:'Sofía Alvarez, language support reviewer',translationStatus:'translated',interpreterRole:'Spanish instructions reviewed by the language support reviewer.'});
    save('patient-coordination','language',{...access,preferredLanguage:'en',instructionsLanguage:'en',translationStatus:'not-needed',interpreterRole:spanish?'Reviewed Spanish remains available; the companion stays in English until the patient chooses Spanish.':'No interpreter requested for this conversation.'},spanish?instant(1):now);
  }

  // The governance state is part of every source revision. Finish it before any patient capture.
  data=ensureGovernanceShowcase(data,actor,now);
  if(!['digitalTwin','pst','shadow'].every(key=>featureEnabled(data,key as 'digitalTwin'|'pst'|'shadow')))return data;
  let releaseRef:EngineRun['releaseRef'];
  try{
    releaseRef=requireGovernedUse(data,'digitalTwin',now);
    for(const capability of ['pst','shadow'] as const)if(JSON.stringify(requireGovernedUse(data,capability,now))!==JSON.stringify(releaseRef))return data;
  }catch{
    // A revoked or edited review is retained. Loading stories cannot reapprove a governed release.
    return data;
  }

  for(const patientId of present){
    const encounterId=encounterFor(patientId),scope={patientId,encounterId};
    // In-progress work in this encounter belongs to its author; seed neither over it nor beside it.
    if([...decisions().observedReviews,...decisions().comparisonSnapshots,...decisions().engineComparisons,...decisions().drafts,...decisions().signedSnapshots,...(decisions().workingCopies??[])].some(row=>row.patientId===patientId&&row.encounterId===encounterId))continue;
    const current=patient(patientId),story=stories[patientId],plan=workspaceCarePlans(data).find(row=>row.patientId===patientId&&row.id===current.carePlans[0]?.id);
    if(!plan)continue;
    const inputVersion=workflowInputRevision(current,data),output=buildEngineOutput(current,data,story.preferences);
    const run:EngineRun={...output,id:`story-v2-run-${patientId}-${output.revision}`,date:now,actor,...(releaseRef?{releaseRef:structuredClone(releaseRef)}:{})};
    if(!data.engineRuns?.some(row=>row.id===run.id))data.engineRuns=[run,...(data.engineRuns??[])];
    const rows=encounters().observations.filter(row=>row.patientId===patientId&&row.status==='confirmed').flatMap(row=>row.currentEntries);
    const metric=(key:'pain'|'function'|'sleep')=>{
      const recorded=rows.filter(row=>row.metric===key).sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt))[0];
      return {prior:current[key][0]??null,current:recorded?recorded.value??null:current[key].at(-1)??null};
    };
    const lastReported=rows.map(row=>row.recordedAt).sort().at(-1)??(current.dates.at(-1)?`${current.dates.at(-1)}T00:00:00.000Z`:now);
    const collectedAt=Date.parse(lastReported)<=Date.parse(now)?lastReported:now;
    const remote=data.careOperations?.remoteVisits.find(row=>row.patientId===patientId);
    const monitoring=data.careOperations?.monitoring.find(row=>row.patientId===patientId);
    const translated=data.clinicalWorkflows!.slices['patient-coordination'].state.language.some(row=>row.patientId===patientId&&row.planRef?.planId===plan.id&&row.planRef.planVersion===plan.version&&row.translationStatus==='translated'&&row.translationReviewer);
    const sourceNotes=[current.treatmentReview?.goalEvidence??story.interpretation,...(current.treatmentReview?.goalAtReview&&current.treatmentReview.goalAtReview!==current.goal?[`That assessment refers to the earlier goal: ${current.treatmentReview.goalAtReview}. Review the current goal separately.`]:[]),...(remote?[`Recorded remote visit: ${remote.status}. ${remote.reason}`]:[]),...(monitoring?[`Recorded reporting status: ${monitoring.status}. ${monitoring.reason}`]:[])];
    const summary=[current.treatmentReview?.decision??'Review the saved patient plan and current priorities before deciding the next step.',translated?'A reviewed translation is linked to this exact care-plan version.':'The current source instructions are retained with the reviewed care package.',...(remote?.status==='interrupted'?['The remote assessment remains incomplete; the named callback is still due.']:[]),...(monitoring?.status==='no-response'?['The missing report has an owned follow-up; it is not evidence of clinical deterioration.']:[])].join(' ');
    save('decisions','review',{type:'decisions.review.capture',...scope,expectedVersion:0,inputVersion,collectedAt,receivedAt:now,provenance:'synthetic',metrics:{pain:metric('pain'),function:metric('function'),sleep:metric('sleep')},contradictoryMetrics:[],clinicalInterpretation:sourceNotes.join(' '),goal:current.goal,nextMonitoringQuestion:story.question});
    save('decisions','engine-capture',{type:'decisions.engine.capture',...scope,inputVersion,runId:run.id,expectedComparisonVersion:0,expectedOutputsVersion:0});
    const observed=decisions().observedReviews.find(row=>row.patientId===patientId&&row.encounterId===encounterId)!;
    const comparison=decisions().comparisonSnapshots.find(row=>row.patientId===patientId&&row.encounterId===encounterId)!;
    const engines=decisions().engineComparisons.find(row=>row.patientId===patientId&&row.encounterId===encounterId)!;
    save('decisions','draft',{type:'decisions.draft.save',...scope,expectedInputVersion:inputVersion,summary,payload:{observedReviewId:observed.id,comparisonSnapshotId:comparison.id,engineComparisonId:engines.id,pendingDisposition:'defer',note:story.rationale}});
    const draft=decisions().drafts.find(row=>row.patientId===patientId&&row.encounterId===encounterId)!;
    save('decisions','signature',{type:'decisions.sign.capture',...scope,draftId:draft.id,expectedDraftVersion:draft.version,expectedInputVersion:inputVersion,disposition:'defer',rationale:story.rationale,patientPlanRef:plan.id,evidenceVersions:[],modelVersions:engines.modelVersions,configurationVersions:engines.configurationVersions,displayedSummary:draft.summary});
    save('decisions','working-copy',{type:'decisions.working.save',...scope,id:`story-v2-working-${patientId}`,expectedVersion:0,inputVersion,form:{inputVersion,draftSummary:'Questions for the next review',draftNote:story.workingNote,reviewGoal:current.goal,reviewQuestion:story.question,planRef:plan.id,weights:story.preferences,preferenceSummary:comparison.preferenceSummary,signDisposition:'defer',signRationale:'Continue this working note after the next patient contact.'}});
  }
  return data;
}
