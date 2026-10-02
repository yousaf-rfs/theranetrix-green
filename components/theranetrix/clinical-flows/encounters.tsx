'use client';

import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {ZodError} from 'zod';
import styles from './encounters.module.css';
import {Badge,EmptyState,Panel} from '@/components/theranetrix/ui';
import {actionSchema,type Action,type AssessmentRecord,type Context,type EpisodeReviewRecord,getSummary,getSourceComparison,type ObservationRecord,type PreparationRecord,reduce,type ReviewEvidence,type SignoffRecord,type State,type IntakeRecord} from '@/lib/clinical-flows/encounters';

type PatientOption={id:string;name:string};

type Props={
  patientId?:string;
  patients:readonly PatientOption[];
  state:State;
  busy:boolean;
  onAction:(action:Action)=>Promise<boolean>;
  clinicalContext?:Pick<Context,'receivingWork'|'closureDependencies'|'reviewEvidence'>;
};

function splitList(value:string){
  return value.split(/\n|,/).map(item=>item.trim()).filter(Boolean);
}

function joinList(value:readonly string[]|undefined){
  return value?.join('\n')??'';
}

function pendingWorkToText(record:SignoffRecord|undefined){
  return record?.pendingWork.map(item=>[item.title,item.owner,item.dueDate??'',item.disposition].join(' | ')).join('\n')??'';
}

function parsePendingWork(value:string){
  return value.split('\n').map(line=>line.trim()).filter(Boolean).map(line=>{
    const parts=line.split('|').map(part=>part.trim());
    if(parts.length>4)throw new Error('Use title | owner | due date | disposition for pending work.');
    const [title,owner='',dueDate='',disposition='pending']=parts;
    if(!['pending','deferred','done'].includes(disposition))throw new Error('Pending work disposition must be pending, deferred, or done.');
    return {
      title,
      owner,
      ...(dueDate?{dueDate}:{ }),
      disposition:disposition as 'pending'|'deferred'|'done',
    };
  });
}

function observationValue(value:string){
  const normalized=value.trim().toLowerCase();
  if(!normalized)return {status:'unanswered' as const};
  if(normalized==='declined')return {status:'declined' as const};
  if(normalized==='unanswered')return {status:'unanswered' as const};
  const parsed=Number(normalized);
  if(Number.isInteger(parsed)&&parsed>=0&&parsed<=10){
    return {status:parsed===0?'zero' as const:'answered' as const,value:parsed};
  }
  throw new Error('Enter a whole number from 0 to 10, declined, or unanswered.');
}

export function toDateTimeLocalValue(timestamp:string){
  if(!timestamp)return '';
  const date=new Date(timestamp);
  if(Number.isNaN(date.getTime()))return '';
  const part=(value:number)=>String(value).padStart(2,'0');
  return `${date.getFullYear()}-${part(date.getMonth()+1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}

export function preserveDateTimeLocalOffset(value:string){
  const match=value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
  if(!match)return value;
  const date=new Date(value);
  const offsetMinutes=-date.getTimezoneOffset();
  const sign=offsetMinutes>=0?'+':'-';
  const absolute=Math.abs(offsetMinutes);
  const hours=String(Math.floor(absolute/60)).padStart(2,'0');
  const minutes=String(absolute%60).padStart(2,'0');
  return `${match[1]}T${match[2]}:${match[3]}:00${sign}${hours}:${minutes}`;
}

export function buildObservationCorrection(record:ObservationRecord,expectedVersion:number,metric:'pain'|'function'|'sleep',fields:{value:string;source:string;recordedAt:string;reason:string},requestId=crypto.randomUUID()):Extract<Action,{type:'encounters.observations.correct'}>{
  if(!record.currentEntries.some(entry=>entry.metric===metric))throw new Error('Choose a measure from the original report to correct.');
  return actionSchema.parse({type:'encounters.observations.correct',requestId,patientId:record.patientId,encounterId:record.encounterId,expectedVersion,reason:fields.reason,replacement:{metric,source:fields.source,recordedAt:preserveDateTimeLocalOffset(fields.recordedAt),...observationValue(fields.value)}}) as Extract<Action,{type:'encounters.observations.correct'}>;
}

export function encounterValidationMessage(error:unknown):string{
  if(!(error instanceof ZodError))return error instanceof Error?error.message:'Unable to save.';
  const labels:Record<string,string>={reason:'Reason',replacement:'Correction',recordedAt:'Observation time',source:'Observation source',followUp:'Follow-up',patientFacingPlan:'Patient-facing plan',assessmentRecordId:'Assessment',receivingWorkRef:'Receiving work',pendingWork:'Pending work',teachBack:'Teach-back',dueAt:'Due time'};
  const issues=error.issues.slice(0,3).map(issue=>{
    const field=issue.path.map(part=>typeof part==='number'?`item ${part+1}`:labels[part]??part.replace(/([a-z])([A-Z])/g,'$1 $2')).join(' · ');
    const message=issue.code==='too_small'&&issue.type==='string'&&issue.minimum===1?'Enter a value.':issue.code==='too_big'&&issue.type==='string'?`Use ${issue.maximum} characters or fewer.`:issue.message;
    return `${field?field[0].toUpperCase()+field.slice(1)+': ':''}${message}`;
  });
  return issues.join(' ')+(error.issues.length>3?' Check the remaining required fields.':'');
}

function entryText(record:ObservationRecord|undefined,metric:'pain'|'function'|'sleep'){
  const entry=record?.currentEntries.find(item=>item.metric===metric);
  if(!entry)return '';
  if(entry.status==='declined')return 'declined';
  if(entry.status==='unanswered')return 'unanswered';
  return String(entry.value ?? '');
}

function prepDefaults(record:PreparationRecord|undefined){
  return {
    reasonForVisit:record?.reasonForVisit??'',
    changesSinceLastReviewedEncounter:record?.changesSinceLastReviewedEncounter??'',
    sourceDates:(record?.sourceDates??[]).join(', '),
    preparationOwner:record?.preparationOwner??'',
    openQuestions:joinList(record?.openQuestions),
    missingInputs:joinList(record?.missingInputs),
    patientGoal:record?.patientGoal??'',
    status:record?.status??'draft',
    newInformation:'',
  };
}

function intakeDefaults(record:IntakeRecord|undefined){
  return {
    sourceHistory:record?.sourceHistory??'',
    medicationsReconciliationReference:record?.medicationsReconciliationReference??'',
    goals:joinList(record?.goals),
    consentReadiness:record?.consentReadiness??'unanswered',
    accessReadiness:record?.accessReadiness??'unanswered',
    unansweredFields:joinList(record?.unansweredFields),
    declinedFields:joinList(record?.declinedFields),
    coordinatorClarification:record?.coordinatorClarification??'',
    baselineReviewed:record?.baselineReviewed??false,
    enrollmentDecision:record?.enrollmentDecision??'pending',
    syntheticEvaluation:record?.syntheticEvaluation??false,
    finalDiagnosis:record?.finalDiagnosis??'',
  };
}

function assessmentDefaults(record:AssessmentRecord|undefined){
  return {
    presentingProblem:record?.presentingProblem??'',
    painDistributionPhenotype:record?.painDistributionPhenotype??'',
    timeline:record?.timeline??'',
    relevantExamination:record?.relevantExamination??'',
    comorbidContext:record?.comorbidContext??'',
    psychologicalContext:record?.psychologicalContext??'',
    socialContext:record?.socialContext??'',
    workingAssessment:record?.workingAssessment??'',
    alternatives:joinList(record?.alternatives),
    supportingFindings:joinList(record?.supportingFindings),
    refutingFindings:joinList(record?.refutingFindings),
    uncertainty:record?.uncertainty??'',
    furtherWorkup:record?.furtherWorkup??'',
    route:record?.route??'continue-local',
    deferReason:record?.deferReason??'',
  };
}

function observationDefaults(record:ObservationRecord|undefined){
  return {
    submissionStatus:record?.status==='confirmed'?'confirmed' as const:'draft' as const,
    correctionReason:'',
    pain:entryText(record,'pain'),
    function:entryText(record,'function'),
    sleep:entryText(record,'sleep'),
    source:record?.currentEntries[0]?.source??'Patient self-report',
    recordedAt:toDateTimeLocalValue(record?.currentEntries[0]?.recordedAt??new Date().toISOString()),
  };
}

function signoffDefaults(record:SignoffRecord|undefined,assessmentId:string){
  return {
    assessmentRecordId:record?.assessmentRecordId??assessmentId,
    rationale:record?.rationale??'',
    patientFacingPlan:record?.patientFacingPlan??'',
    selected:joinList(record?.disposition.selected),
    rejected:joinList(record?.disposition.rejected),
    deferred:joinList(record?.disposition.deferred),
    noChange:record?.disposition.noChange??false,
    owner:record?.owner??'',
    followUpDate:record?.followUp.date??new Date().toISOString().slice(0,10),
    followUpTime:record?.followUp.time??'',
    followUpTimezone:record?.followUp.timezone??'',
    pendingWork:pendingWorkToText(record),
    teachBack:record?.teachBack??'',
    planKind:record?.planKind??'definitive',
    receivingWorkId:record?.receivingWorkRef?.id??'',
    receivingWorkRevision:record?.receivingWorkRef?.revision??'',
    patientFallback:record?.patientFallback??'',
    teachBackOutcome:record?.teachBackOutcome??'not-checked',
    clarificationOwner:record?.clarification?.owner??'',
    clarificationDueAt:toDateTimeLocalValue(record?.clarification?.dueAt??''),
    clarificationQuestion:record?.clarification?.question??'',
  };
}

function episodeDefaults(record:EpisodeReviewRecord|undefined){
  return {
    goalEvidence:record?.goalEvidence??'',
    observedOutcomes:record?.observedOutcomes??'',
    priorInterventions:record?.priorInterventions??'',
    ongoingInterventions:record?.ongoingInterventions??'',
    patientExperience:record?.patientExperience??'',
    remainingConcerns:joinList(record?.remainingConcerns),
    decision:record?.decision??'continue',
    pendingWorkDisposition:record?.pendingWorkDisposition??'',
    pendingWorkOwner:record?.pendingWorkOwner??'',
    status:record?.status==='closed'?'reviewed':record?.status??'draft',
  };
}

function statusBadge(value:string){
  return <Badge tone={value.includes('signed')||value.includes('closed')||value.includes('enrolled')?'teal':value.includes('review')||value.includes('urgent')?'amber':'neutral'}>{value}</Badge>;
}

function SourceComparison({comparison}:{comparison:ReturnType<typeof getSourceComparison>}){
  function source(point:ReviewEvidence['observations'][number]|undefined){
    return point?<><strong>{point.value!==undefined?`${point.value}/10`:point.status==='declined'?'Declined':'Not answered'}</strong><br/><time dateTime={point.recordedAt}>{point.recordedAt}</time><br/><small>{point.source} · version {point.version}</small></>:<span>Not captured</span>;
  }
  if(!comparison.current&&!comparison.lastReviewed)return <p>Saved source comparisons will appear after the patient record is available.</p>;
  return <div>
    <table><caption>Dated observations: baseline, last reviewed and current</caption><thead><tr><th scope="col">Measure</th><th scope="col">Baseline</th><th scope="col">Last reviewed</th><th scope="col">Current</th></tr></thead><tbody>{comparison.metrics.map(row=><tr key={row.metric}><th scope="row">{row.metric==='function'?'Daily function':row.metric==='pain'?'Pain':'Sleep quality'}</th><td>{source(row.baseline)}</td><td>{source(row.lastReviewed)}</td><td>{source(row.current)}</td></tr>)}</tbody></table>
    <p>Current goal: {comparison.current?.goal.text||'Not recorded'}{comparison.current?.goal.recordedAt&&<> · {comparison.current.goal.recordedAt}</>}</p>
    {comparison.lastReviewed&&<p>Goal at the last review: {comparison.lastReviewed.goal.text||'Not recorded'} · reviewed {comparison.lastReviewed.capturedAt}</p>}
    {!!comparison.current?.pendingWork.length&&<><p>Outstanding source work</p><ul>{comparison.current.pendingWork.map(item=><li key={item.id}>{item.title} · source revision {item.revision.length<30?item.revision:'recorded'}</li>)}</ul></>}
  </div>;
}

type DraftEntry={form:unknown;recordId?:string;version?:number;dirty:boolean};
type DraftCache=Map<string,DraftEntry>;

function useEncounterDraft<T>(key:string,record:{id:string;version:number}|undefined,defaults:T,cache:DraftCache){
  const [draft,setDraft]=useState<DraftEntry>(()=>cache.get(key)??{form:defaults,recordId:record?.id,version:record?.version,dirty:false});
  const active=useMemo(()=>draft.dirty?draft:{form:defaults,recordId:record?.id,version:record?.version,dirty:false},[draft,defaults,record?.id,record?.version]);
  useEffect(()=>{cache.set(key,active);},[cache,key,active]);
  return {
    form:active.form as T,
    change:(form:T)=>setDraft({...active,form,dirty:true}),
    saved:()=>setDraft(previous=>({...previous,dirty:false})),
    version:active.version,
    dirty:active.dirty,
    reload:()=>setDraft({form:defaults,recordId:record?.id,version:record?.version,dirty:false}),
    stale:active.dirty&&(active.recordId!==record?.id||active.version!==record?.version),
  };
}

export function EncountersPanel({patientId,patients,state,busy,onAction,clinicalContext}:Props){
  const [chosenPatientId,setChosenPatientId]=useState(patients[0]?.id??'');
  const [encountersByPatient,setEncountersByPatient]=useState<Record<string,string>>({});
  const [newEncounterId,setNewEncounterId]=useState('');
  const [draftCache]=useState<DraftCache>(()=>new Map());
  const selectedPatientId=patientId??chosenPatientId;
  const encounterIds=useMemo(()=>Array.from(new Set([
    ...state.preparations,...state.intakes,...state.assessments,...state.observations,...state.signoffs,...state.episodes,
  ].filter(item=>item.patientId===selectedPatientId).map(item=>item.encounterId))).sort(),[state,selectedPatientId]);
  const selectedEncounterId=encountersByPatient[selectedPatientId]??encounterIds[0]??`${selectedPatientId}-encounter`;
  if(patientId&&!patients.some(patient=>patient.id===patientId))return <Panel title="Encounter workflows" subtitle="Invalid patient context"><p role="alert">The requested patient is not available in this launch context.</p></Panel>;
  if(!patients.length)return <Panel title="Encounter workflows"><EmptyState title="No patients available" description="Load a valid patient context to begin the encounters workflows."/></Panel>;
  if(!patients.some(patient=>patient.id===selectedPatientId))return <Panel title="Encounter workflows"><p role="alert">Select an available patient.</p><select aria-label="Patient" value="" onChange={event=>setChosenPatientId(event.target.value)}><option value="">Select patient</option>{patients.map(patient=><option key={patient.id} value={patient.id}>{patient.name}</option>)}</select></Panel>;
  return <div className={styles.panel}>
    <Panel title="Encounter context">
      {!patientId&&<label><span>Patient</span><select value={selectedPatientId} onChange={event=>{setChosenPatientId(event.target.value);setNewEncounterId('');}} disabled={busy}>{patients.map(patient=><option key={patient.id} value={patient.id}>{patient.name}</option>)}</select></label>}
      <label><span>Encounter</span><select value={selectedEncounterId} disabled={busy} onChange={event=>setEncountersByPatient(previous=>({...previous,[selectedPatientId]:event.target.value}))}>{Array.from(new Set([...encounterIds,selectedEncounterId])).map(id=><option key={id} value={id}>{id}</option>)}</select></label>
      <form onSubmit={event=>{event.preventDefault();const id=newEncounterId.trim();if(!id)return;setEncountersByPatient(previous=>({...previous,[selectedPatientId]:id}));setNewEncounterId('');}}>
        <label><span>New encounter id</span><input value={newEncounterId} maxLength={100} onChange={event=>setNewEncounterId(event.target.value)} required disabled={busy}/></label>
        <button type="submit" disabled={busy||!newEncounterId.trim()}>Open encounter</button>
      </form>
    </Panel>
    <EncounterWorkspace key={JSON.stringify([selectedPatientId,selectedEncounterId])} patientId={selectedPatientId} encounterId={selectedEncounterId} patients={patients} state={state} busy={busy} onAction={onAction} draftCache={draftCache} clinicalContext={clinicalContext}/>
  </div>;
}

function EncounterWorkspace({patientId:selectedPatientId,encounterId:selectedEncounterId,patients,state,busy,onAction,draftCache,clinicalContext}:{patientId:string;encounterId:string;draftCache:DraftCache}&Omit<Props,'patientId'>){
  const [notice,setNotice]=useState('');
  const [noticeIsError,setNoticeIsError]=useState(false);
  const noticeRef=useRef<HTMLParagraphElement>(null);
  const [correctionChoice,setCorrectionChoice]=useState<'pain'|'function'|'sleep'>();
  useEffect(()=>{if(notice&&noticeIsError)noticeRef.current?.focus();},[notice,noticeIsError]);
  const [amendmentReason,setAmendmentReason]=useState('');
  const [withdrawalReason,setWithdrawalReason]=useState('');
  const [submitting,setSubmitting]=useState(false);
  const submitLock=useRef(false);
  const summary=useMemo(()=>getSummary(state,selectedPatientId),[state,selectedPatientId]);
  const preparation=state.preparations.find(item=>item.patientId===selectedPatientId&&item.encounterId===selectedEncounterId);
  const intake=state.intakes.find(item=>item.patientId===selectedPatientId&&item.encounterId===selectedEncounterId);
  const assessment=state.assessments.find(item=>item.patientId===selectedPatientId&&item.encounterId===selectedEncounterId);
  const observations=state.observations.find(item=>item.patientId===selectedPatientId&&item.encounterId===selectedEncounterId);
  const signoff=state.signoffs.filter(item=>item.patientId===selectedPatientId&&item.encounterId===selectedEncounterId).at(-1);
  const episode=state.episodes.find(item=>item.patientId===selectedPatientId&&item.encounterId===selectedEncounterId);
  const closedEpisode=episode?.status==='closed';
  const correctionMetric=correctionChoice??observations?.currentEntries[0]?.metric??'pain';
  const draftSignoff=signoff?.status==='draft'?signoff:undefined;
  const reviewedSignoff=signoff?.status==='reviewed'?signoff:undefined;
  const signedSignoff=signoff?.status==='signed'?signoff:undefined;
  const closableEpisode=episode?.decision==='closure'&&episode.status==='reviewed'?episode:undefined;
  const draftKey=JSON.stringify([selectedPatientId,selectedEncounterId]);
  const prepDraft=useEncounterDraft(`${draftKey}:preparation`,preparation,prepDefaults(preparation),draftCache);
  const intakeDraft=useEncounterDraft(`${draftKey}:intake`,intake,intakeDefaults(intake),draftCache);
  const assessmentDraft=useEncounterDraft(`${draftKey}:assessment`,assessment,assessmentDefaults(assessment),draftCache);
  const observationDraft=useEncounterDraft(`${draftKey}:observations`,observations,observationDefaults(observations),draftCache);
  const signoffDraft=useEncounterDraft(`${draftKey}:signoff`,signoff,signoffDefaults(signoff,assessment?.id??''),draftCache);
  const episodeDraft=useEncounterDraft(`${draftKey}:episode`,episode,episodeDefaults(episode),draftCache);
  const {form:prepForm,change:setPrepForm}=prepDraft;
  const {form:intakeForm,change:setIntakeForm}=intakeDraft;
  const {form:assessmentForm,change:setAssessmentForm}=assessmentDraft;
  const {form:observationForm,change:setObservationForm}=observationDraft;
  const {form:signoffForm,change:setSignoffForm}=signoffDraft;
  const {form:episodeForm,change:setEpisodeForm}=episodeDraft;
  const saving=busy||submitting;
  const receivingWork=(clinicalContext?.receivingWork??[]).filter(item=>item.patientId===selectedPatientId&&(!item.encounterId||item.encounterId===selectedEncounterId));
  const selectedReceivingWork=receivingWork.find(item=>item.id===signoffForm.receivingWorkId);
  const dependencies=clinicalContext?.closureDependencies?.filter(item=>item.patientId===selectedPatientId&&(!item.encounterId||item.encounterId===selectedEncounterId));
  const blockedDependencies=dependencies?.filter(item=>!item.acceptedOwner);
  const comparison=getSourceComparison(state,selectedPatientId,clinicalContext?.reviewEvidence);
  function signoffDetails(){
    return {
      planKind:signoffForm.planKind,
      ...(signoffForm.planKind==='interim'?{receivingWorkRef:{id:signoffForm.receivingWorkId,revision:signoffForm.receivingWorkRevision},patientFallback:signoffForm.patientFallback}:{}),
      teachBackOutcome:signoffForm.teachBackOutcome,
      ...(signoffForm.teachBackOutcome==='needs-clarification'?{clarification:{owner:signoffForm.clarificationOwner,dueAt:preserveDateTimeLocalOffset(signoffForm.clarificationDueAt),question:signoffForm.clarificationQuestion}}:{}),
    };
  }

  async function submit(input:Action|(()=>Action)){
    if(busy||submitLock.current)return false;
    submitLock.current=true;
    setSubmitting(true);
    setNotice('');
    setNoticeIsError(false);
    try{
      const action=actionSchema.parse(typeof input==='function'?input():input);
      const ok=await onAction(action);
      if(ok){
        const drafts={preparation:prepDraft,intake:intakeDraft,assessment:assessmentDraft,observations:observationDraft,signoff:signoffDraft,episode:episodeDraft};
        drafts[action.type.split('.')[1] as keyof typeof drafts]?.saved();
        setAmendmentReason('');
      }
      setNoticeIsError(!ok);
      setNotice(ok?'Saved.':'Save failed. Your draft remains in the form.');
      return ok;
    }catch(error){
      const message=encounterValidationMessage(error);
      setNoticeIsError(true);
      setNotice(`${message} Your draft remains in the form.`);
      return false;
    }finally{submitLock.current=false;setSubmitting(false);}
  }

  const observationIdBase=`observation-${selectedPatientId||'patient'}-${selectedEncounterId||'encounter'}`;

  function encounterIdFor(){
    return selectedEncounterId||`${selectedPatientId}-encounter`;
  }

  const patientName=patients.find(patient=>patient.id===selectedPatientId)?.name??selectedPatientId;

  return <div className={styles.panel}>
    <Panel title="Encounter workflows" subtitle={`Local workflows for ${patientName}`} action={<div style={{display:'flex',gap:8,alignItems:'center'}}>{statusBadge(`${summary.open} open`)}{summary.overdue>0&&statusBadge(`${summary.overdue} overdue`)}</div>}>
      {notice&&<p role={noticeIsError?'alert':'status'} tabIndex={noticeIsError?-1:undefined} ref={noticeRef}>{notice}</p>}
      {[prepDraft,intakeDraft,assessmentDraft,observationDraft,signoffDraft,episodeDraft].some(item=>item.stale)&&<p role="alert">This encounter changed while you were editing. Your draft is preserved. <button type="button" onClick={()=>[prepDraft,intakeDraft,assessmentDraft,observationDraft,signoffDraft,episodeDraft].filter(item=>item.stale).forEach(item=>item.reload())}>Replace stale drafts with latest saved values</button></p>}
      {summary.attention.length>0&&<ul>{summary.attention.map(item=><li key={item}>{item}</li>)}</ul>}
    </Panel>

    <details open>
      <summary data-journey="J01">Preparation {preparation&&statusBadge(preparation.reviewNeeded?'review needed':preparation.status)}</summary>
      <Panel title="Prepare the encounter" subtitle="Drafts save and resume; new last-minute information reopens review.">
        <SourceComparison comparison={comparison}/>
        <fieldset disabled={saving}><form onSubmit={async (event:FormEvent)=>{event.preventDefault();await submit(()=>({
          type:'encounters.preparation.save',
          requestId:crypto.randomUUID(),
          patientId:selectedPatientId,
          encounterId:preparation?.encounterId??encounterIdFor(),
          ...(prepDraft.version!==undefined?{expectedVersion:prepDraft.version}:{ }),
          reasonForVisit:prepForm.reasonForVisit,
          changesSinceLastReviewedEncounter:prepForm.changesSinceLastReviewedEncounter,
          sourceDates:splitList(prepForm.sourceDates),
          preparationOwner:prepForm.preparationOwner,
          openQuestions:splitList(prepForm.openQuestions),
          missingInputs:splitList(prepForm.missingInputs),
          patientGoal:prepForm.patientGoal,
          status:prepForm.status as PreparationRecord['status'],
          newInformation:prepForm.newInformation,
        }));}}>
          <label><span>Reason for visit</span><textarea value={prepForm.reasonForVisit} onChange={event=>setPrepForm({...prepForm,reasonForVisit:event.target.value})} required/></label>
          <label><span>Changes since last reviewed encounter</span><textarea value={prepForm.changesSinceLastReviewedEncounter} onChange={event=>setPrepForm({...prepForm,changesSinceLastReviewedEncounter:event.target.value})}/></label>
          <label><span>Source dates</span><input value={prepForm.sourceDates} onChange={event=>setPrepForm({...prepForm,sourceDates:event.target.value})} placeholder="2026-09-17, 2026-09-18"/></label>
          <label><span>Preparation owner</span><input value={prepForm.preparationOwner} onChange={event=>setPrepForm({...prepForm,preparationOwner:event.target.value})} required/></label>
          <label><span>Open questions</span><textarea value={prepForm.openQuestions} onChange={event=>setPrepForm({...prepForm,openQuestions:event.target.value})}/></label>
          <label><span>Missing inputs</span><textarea value={prepForm.missingInputs} onChange={event=>setPrepForm({...prepForm,missingInputs:event.target.value})}/></label>
          <label><span>Patient goal</span><textarea value={prepForm.patientGoal} onChange={event=>setPrepForm({...prepForm,patientGoal:event.target.value})} required/></label>
          <label><span>Preparation status</span><select value={prepForm.status} onChange={event=>setPrepForm({...prepForm,status:event.target.value as PreparationRecord['status']})}><option value="draft">Draft</option><option value="prepared">Prepared</option><option value="clinician-reviewed">Clinician reviewed</option></select></label>
          <label><span>Last-minute information</span><textarea value={prepForm.newInformation} onChange={event=>setPrepForm({...prepForm,newInformation:event.target.value})}/></label>
          <button type="submit" disabled={saving}>Save preparation</button>
        </form></fieldset>
      </Panel>
    </details>

    <details>
      <summary data-journey="J02">Intake {intake&&statusBadge(intake.status)}</summary>
      <Panel title="Intake and enrollment readiness" subtitle="Review the history, goals, access needs and outstanding questions before enrollment.">
        <fieldset disabled={saving}><form onSubmit={async event=>{event.preventDefault();await submit(()=>({
          type:'encounters.intake.save',
          requestId:crypto.randomUUID(),
          patientId:selectedPatientId,
          encounterId:intake?.encounterId??encounterIdFor(),
          ...(intakeDraft.version!==undefined?{expectedVersion:intakeDraft.version}:{ }),
          sourceHistory:intakeForm.sourceHistory,
          medicationsReconciliationReference:intakeForm.medicationsReconciliationReference,
          goals:splitList(intakeForm.goals),
          consentReadiness:intakeForm.consentReadiness as IntakeRecord['consentReadiness'],
          accessReadiness:intakeForm.accessReadiness as IntakeRecord['accessReadiness'],
          unansweredFields:splitList(intakeForm.unansweredFields),
          declinedFields:splitList(intakeForm.declinedFields),
          coordinatorClarification:intakeForm.coordinatorClarification,
          baselineReviewed:intakeForm.baselineReviewed,
          enrollmentDecision:intakeForm.enrollmentDecision as IntakeRecord['enrollmentDecision'],
          syntheticEvaluation:intakeForm.syntheticEvaluation,
          finalDiagnosis:intakeForm.finalDiagnosis,
        }));}}>
          <label><span>Source and history</span><textarea value={intakeForm.sourceHistory} onChange={event=>setIntakeForm({...intakeForm,sourceHistory:event.target.value})} required/></label>
          <label><span>Medication reconciliation reference</span><input value={intakeForm.medicationsReconciliationReference} onChange={event=>setIntakeForm({...intakeForm,medicationsReconciliationReference:event.target.value})}/></label>
          <label><span>Goals</span><textarea value={intakeForm.goals} onChange={event=>setIntakeForm({...intakeForm,goals:event.target.value})}/></label>
          <label><span>Consent readiness</span><select value={intakeForm.consentReadiness} onChange={event=>setIntakeForm({...intakeForm,consentReadiness:event.target.value as IntakeRecord['consentReadiness']})}><option value="unanswered">Unanswered</option><option value="ready">Ready</option><option value="needs-clarification">Needs clarification</option><option value="declined">Declined</option></select></label>
          <label><span>Access readiness</span><select value={intakeForm.accessReadiness} onChange={event=>setIntakeForm({...intakeForm,accessReadiness:event.target.value as IntakeRecord['accessReadiness']})}><option value="unanswered">Unanswered</option><option value="ready">Ready</option><option value="needs-clarification">Needs clarification</option><option value="declined">Declined</option></select></label>
          <label><span>Unanswered fields</span><textarea value={intakeForm.unansweredFields} onChange={event=>setIntakeForm({...intakeForm,unansweredFields:event.target.value})}/></label>
          <label><span>Declined fields</span><textarea value={intakeForm.declinedFields} onChange={event=>setIntakeForm({...intakeForm,declinedFields:event.target.value})}/></label>
          <label><span>Coordinator clarification</span><textarea value={intakeForm.coordinatorClarification} onChange={event=>setIntakeForm({...intakeForm,coordinatorClarification:event.target.value})}/></label>
          <label><input type="checkbox" checked={intakeForm.baselineReviewed} onChange={event=>setIntakeForm({...intakeForm,baselineReviewed:event.target.checked})}/> Baseline reviewed</label>
          <label><span>Enrollment decision</span><select value={intakeForm.enrollmentDecision} onChange={event=>setIntakeForm({...intakeForm,enrollmentDecision:event.target.value as IntakeRecord['enrollmentDecision']})}><option value="pending">Pending</option><option value="enroll">Enroll</option><option value="defer">Defer</option><option value="decline">Decline</option></select></label>
          <label><span>Final diagnosis</span><input value={intakeForm.finalDiagnosis} onChange={event=>setIntakeForm({...intakeForm,finalDiagnosis:event.target.value})}/></label>
          <button type="submit" disabled={saving}>Save intake</button>
        </form></fieldset>
      </Panel>
    </details>

    <details>
      <summary data-journey="J08">Assessment {assessment&&statusBadge(assessment.status)}</summary>
      <Panel title="Structured encounter assessment" subtitle="Use text findings only; diagnosis, thresholds, and prescribing remain manual.">
        <fieldset disabled={saving}><form onSubmit={async event=>{event.preventDefault();await submit(()=>({
          type:'encounters.assessment.save',
          requestId:crypto.randomUUID(),
          patientId:selectedPatientId,
          encounterId:assessment?.encounterId??encounterIdFor(),
          ...(assessmentDraft.version!==undefined?{expectedVersion:assessmentDraft.version}:{ }),
          presentingProblem:assessmentForm.presentingProblem,
          painDistributionPhenotype:assessmentForm.painDistributionPhenotype,
          timeline:assessmentForm.timeline,
          relevantExamination:assessmentForm.relevantExamination,
          comorbidContext:assessmentForm.comorbidContext,
          psychologicalContext:assessmentForm.psychologicalContext,
          socialContext:assessmentForm.socialContext,
          workingAssessment:assessmentForm.workingAssessment,
          alternatives:splitList(assessmentForm.alternatives),
          supportingFindings:splitList(assessmentForm.supportingFindings),
          refutingFindings:splitList(assessmentForm.refutingFindings),
          uncertainty:assessmentForm.uncertainty,
          furtherWorkup:assessmentForm.furtherWorkup,
          route:assessmentForm.route as AssessmentRecord['route'],
          deferReason:assessmentForm.deferReason,
        }));}}>
          <label><span>Presenting problem</span><textarea value={assessmentForm.presentingProblem} onChange={event=>setAssessmentForm({...assessmentForm,presentingProblem:event.target.value})} required/></label>
          <label><span>Pain distribution and phenotype</span><textarea value={assessmentForm.painDistributionPhenotype} onChange={event=>setAssessmentForm({...assessmentForm,painDistributionPhenotype:event.target.value})}/></label>
          <label><span>Timeline</span><textarea value={assessmentForm.timeline} onChange={event=>setAssessmentForm({...assessmentForm,timeline:event.target.value})}/></label>
          <label><span>Relevant examination</span><textarea value={assessmentForm.relevantExamination} onChange={event=>setAssessmentForm({...assessmentForm,relevantExamination:event.target.value})}/></label>
          <label><span>Comorbid context</span><textarea value={assessmentForm.comorbidContext} onChange={event=>setAssessmentForm({...assessmentForm,comorbidContext:event.target.value})}/></label>
          <label><span>Psychological context</span><textarea value={assessmentForm.psychologicalContext} onChange={event=>setAssessmentForm({...assessmentForm,psychologicalContext:event.target.value})}/></label>
          <label><span>Social context</span><textarea value={assessmentForm.socialContext} onChange={event=>setAssessmentForm({...assessmentForm,socialContext:event.target.value})}/></label>
          <label><span>Working assessment</span><textarea value={assessmentForm.workingAssessment} onChange={event=>setAssessmentForm({...assessmentForm,workingAssessment:event.target.value})} required/></label>
          <label><span>Alternatives considered</span><textarea value={assessmentForm.alternatives} onChange={event=>setAssessmentForm({...assessmentForm,alternatives:event.target.value})}/></label>
          <label><span>Supporting findings</span><textarea value={assessmentForm.supportingFindings} onChange={event=>setAssessmentForm({...assessmentForm,supportingFindings:event.target.value})}/></label>
          <label><span>Refuting findings</span><textarea value={assessmentForm.refutingFindings} onChange={event=>setAssessmentForm({...assessmentForm,refutingFindings:event.target.value})}/></label>
          <label><span>Uncertainty</span><textarea value={assessmentForm.uncertainty} onChange={event=>setAssessmentForm({...assessmentForm,uncertainty:event.target.value})} required/></label>
          <label><span>Further workup or referral</span><textarea value={assessmentForm.furtherWorkup} onChange={event=>setAssessmentForm({...assessmentForm,furtherWorkup:event.target.value})}/></label>
          <label><span>Route</span><select value={assessmentForm.route} onChange={event=>setAssessmentForm({...assessmentForm,route:event.target.value as AssessmentRecord['route']})}><option value="continue-local">Continue locally</option><option value="defer">Defer</option><option value="longer-review">Longer review</option><option value="urgent-review">Urgent review</option><option value="out-of-scope">Out of scope</option></select></label>
          <label><span>Defer or out-of-scope reason</span><textarea value={assessmentForm.deferReason} onChange={event=>setAssessmentForm({...assessmentForm,deferReason:event.target.value})}/></label>
          <button type="submit" disabled={saving}>Save assessment</button>
        </form></fieldset>
      </Panel>
    </details>

    <details>
      <summary data-journey="J11">Observations {observations&&statusBadge(observations.status)}</summary>
      <Panel title="Observations and assessments" subtitle="Pain, function and sleep reports retain their source and collection time.">
        {observations?.withdrawal&&<p role="status">Withdrawn from current care by {observations.withdrawal.actor} on {observations.withdrawal.at}: {observations.withdrawal.reason}. The original report remains in history.</p>}
        {closedEpisode&&<p>This episode is closed. Correct one recorded measure at a time, with a reason. The original report and signed history remain available. Open a new encounter to record a new report.</p>}
        {closedEpisode&&observations?.status==='confirmed'?<fieldset disabled={saving}><form onSubmit={async event=>{
          event.preventDefault();
          if(await submit(()=>buildObservationCorrection(observations,observationDraft.version??observations.version,correctionMetric,{value:observationForm[correctionMetric],source:observationForm.source,recordedAt:observationForm.recordedAt,reason:observationForm.correctionReason})))setCorrectionChoice(undefined);
        }}>
          <label><span>Measure to correct</span><select value={correctionMetric} onChange={event=>{
            const metric=event.target.value as 'pain'|'function'|'sleep',entry=observations.currentEntries.find(row=>row.metric===metric)!;
            setCorrectionChoice(metric);setObservationForm({...observationForm,source:entry.source,recordedAt:toDateTimeLocalValue(entry.recordedAt)});
          }}>{observations.currentEntries.map(entry=><option key={entry.metric} value={entry.metric}>{entry.metric==='pain'?'Pain':entry.metric==='function'?'Daily function':'Sleep quality'}</option>)}</select></label>
          <label><span>Corrected response (0–10, declined, or unanswered)</span><input value={observationForm[correctionMetric]} onChange={event=>setObservationForm({...observationForm,[correctionMetric]:event.target.value})}/></label>
          <label><span>Correction source</span><input required value={observationForm.source} onChange={event=>setObservationForm({...observationForm,source:event.target.value})}/></label>
          <label><span>Observation time · your device timezone</span><input type="datetime-local" required value={observationForm.recordedAt} onChange={event=>setObservationForm({...observationForm,recordedAt:event.target.value})}/></label>
          <label><span>Correction reason</span><textarea required value={observationForm.correctionReason} onChange={event=>setObservationForm({...observationForm,correctionReason:event.target.value})}/></label>
          <button type="submit" disabled={saving}>Save observation correction</button>
        </form></fieldset>:!closedEpisode?<fieldset disabled={saving||observations?.status==='withdrawn'}><form onSubmit={async event=>{event.preventDefault();await submit(()=>({
          type:'encounters.observations.save',
          requestId:crypto.randomUUID(),
          patientId:selectedPatientId,
          encounterId:observations?.encounterId??encounterIdFor(),
          ...(observationDraft.version!==undefined?{expectedVersion:observationDraft.version}:{ }),
          instrument:'local-0-10',
          submissionStatus:observationForm.submissionStatus,
          ...(observationForm.correctionReason?{correctionReason:observationForm.correctionReason}:{}),
          entries:[
            {metric:'pain',source:observationForm.source,recordedAt:preserveDateTimeLocalOffset(observationForm.recordedAt),...observationValue(observationForm.pain)},
            {metric:'function',source:observationForm.source,recordedAt:preserveDateTimeLocalOffset(observationForm.recordedAt),...observationValue(observationForm.function)},
            {metric:'sleep',source:observationForm.source,recordedAt:preserveDateTimeLocalOffset(observationForm.recordedAt),...observationValue(observationForm.sleep)},
          ],
        }));}}>
          <label htmlFor={`${observationIdBase}-status`}>Submission status</label>
          <select disabled={observations?.status==='confirmed'} id={`${observationIdBase}-status`} value={observationForm.submissionStatus} onChange={event=>setObservationForm({...observationForm,submissionStatus:event.target.value as 'draft'|'confirmed'})}><option value="draft">Draft</option><option value="confirmed">Confirmed submission</option></select>
          <label htmlFor={`${observationIdBase}-source`}>Observation source</label>
          <input id={`${observationIdBase}-source`} value={observationForm.source} onChange={event=>setObservationForm({...observationForm,source:event.target.value})} required/>
          <label htmlFor={`${observationIdBase}-time`}>Observation time</label>
          <input id={`${observationIdBase}-time`} type="datetime-local" value={observationForm.recordedAt} onChange={event=>setObservationForm({...observationForm,recordedAt:event.target.value})} required/>
          <label htmlFor={`${observationIdBase}-pain`}>Pain (0-10, declined, or unanswered)</label>
          <input id={`${observationIdBase}-pain`} value={observationForm.pain} onChange={event=>setObservationForm({...observationForm,pain:event.target.value})}/>
          <label htmlFor={`${observationIdBase}-function`}>Function (0-10, declined, or unanswered)</label>
          <input id={`${observationIdBase}-function`} value={observationForm.function} onChange={event=>setObservationForm({...observationForm,function:event.target.value})}/>
          <label htmlFor={`${observationIdBase}-sleep`}>Sleep (0-10, declined, or unanswered)</label>
          <input id={`${observationIdBase}-sleep`} value={observationForm.sleep} onChange={event=>setObservationForm({...observationForm,sleep:event.target.value})}/>
          {observations?.status==='confirmed'&&<label><span>Correction reason</span><textarea value={observationForm.correctionReason} onChange={event=>setObservationForm({...observationForm,correctionReason:event.target.value})} required/></label>}
          <button type="submit" disabled={saving}>Save observations</button>
        </form></fieldset>:!observations?<p>There is no recorded observation to correct in this episode.</p>:null}
        {observations?.status==='confirmed'&&<form onSubmit={async event=>{event.preventDefault();if(await submit({type:'encounters.observations.withdraw',requestId:crypto.randomUUID(),patientId:selectedPatientId,encounterId:selectedEncounterId,id:observations.id,expectedVersion:observations.version,reason:withdrawalReason}))setWithdrawalReason('');}}>
          <label><span>Why should this report be withdrawn from this chart?</span><textarea required maxLength={2000} value={withdrawalReason} onChange={event=>setWithdrawalReason(event.target.value)} disabled={saving}/></label>
          <p>The report stays in history. Current charts and decisions will require review. No information is moved to another patient.</p>
          <button type="submit" disabled={saving||!withdrawalReason.trim()}>Withdraw report from current care</button>
        </form>}
      </Panel>
    </details>

    <details>
      <summary data-journey="J14">Encounter sign-off {signoff&&statusBadge(signoff.amendedFromId?`${signoff.status} amendment`:signoff.status)}</summary>
      <Panel title="Encounter draft, review, and sign-off" subtitle="A due follow-up is not a booked appointment. Signed records are immutable; amendments link back to the original.">
        <fieldset disabled={saving}><form onSubmit={async event=>{event.preventDefault();await submit(()=>({
          type:'encounters.signoff.saveDraft',
          ...signoffDetails(),
          requestId:crypto.randomUUID(),
          patientId:selectedPatientId,
          encounterId:signoff?.encounterId??encounterIdFor(),
          ...(signoffDraft.version!==undefined?{expectedVersion:signoffDraft.version}:{ }),
          assessmentRecordId:signoffForm.assessmentRecordId,
          rationale:signoffForm.rationale,
          patientFacingPlan:signoffForm.patientFacingPlan,
          disposition:{selected:splitList(signoffForm.selected),rejected:splitList(signoffForm.rejected),deferred:splitList(signoffForm.deferred),noChange:signoffForm.noChange},
          owner:signoffForm.owner,
          followUp:{date:signoffForm.followUpDate,time:signoffForm.followUpTime,timezone:signoffForm.followUpTimezone},
          pendingWork:parsePendingWork(signoffForm.pendingWork),
          teachBack:signoffForm.teachBack,
        }));}}>
          <label><span>Plan type</span><select value={signoffForm.planKind} onChange={event=>setSignoffForm({...signoffForm,planKind:event.target.value as 'definitive'|'interim'})}><option value="definitive">Agreed care plan</option><option value="interim">Interim plan while assessment continues</option></select></label>
          {signoffForm.planKind==='interim'&&<>
            <label><span>Receiving work and owner</span><select required value={signoffForm.receivingWorkId} onChange={event=>{const work=receivingWork.find(item=>item.id===event.target.value);setSignoffForm({...signoffForm,receivingWorkId:event.target.value,receivingWorkRevision:work?.revision??''});}}><option value="">Choose saved receiving work</option>{receivingWork.map(item=><option key={item.id} value={item.id}>{item.title} · {item.owner||'Owner not assigned'} · {item.dueAt||'Due time not assigned'}</option>)}</select></label>
            {!receivingWork.length&&<p>Record a handoff, referral or owned next action in care coordination first.</p>}
            {selectedReceivingWork&&selectedReceivingWork.revision!==signoffForm.receivingWorkRevision&&<p role="alert">Receiving work changed. <button type="button" onClick={()=>setSignoffForm({...signoffForm,receivingWorkRevision:selectedReceivingWork.revision})}>Use the latest receiving work details</button> Save and review this plan again before signing.</p>}
            <label><span>Patient instructions if contact fails</span><textarea required value={signoffForm.patientFallback} onChange={event=>setSignoffForm({...signoffForm,patientFallback:event.target.value})}/></label>
          </>}
          <label><span>Assessment record id</span><input value={signoffForm.assessmentRecordId} onChange={event=>setSignoffForm({...signoffForm,assessmentRecordId:event.target.value})} required list="assessment-records"/></label>
          <datalist id="assessment-records">{state.assessments.filter(item=>item.patientId===selectedPatientId&&item.encounterId===selectedEncounterId).map(item=><option key={item.id} value={item.id}>{item.encounterId}</option>)}</datalist>
          <label><span>Assessment rationale</span><textarea value={signoffForm.rationale} onChange={event=>setSignoffForm({...signoffForm,rationale:event.target.value})} required/></label>
          <label><span>Patient-facing plan</span><textarea value={signoffForm.patientFacingPlan} onChange={event=>setSignoffForm({...signoffForm,patientFacingPlan:event.target.value})} required/></label>
          <label><span>Selected disposition items</span><textarea value={signoffForm.selected} onChange={event=>setSignoffForm({...signoffForm,selected:event.target.value})}/></label>
          <label><span>Rejected disposition items</span><textarea value={signoffForm.rejected} onChange={event=>setSignoffForm({...signoffForm,rejected:event.target.value})}/></label>
          <label><span>Deferred disposition items</span><textarea value={signoffForm.deferred} onChange={event=>setSignoffForm({...signoffForm,deferred:event.target.value})}/></label>
          <label><input type="checkbox" checked={signoffForm.noChange} onChange={event=>setSignoffForm({...signoffForm,noChange:event.target.checked})}/> No change</label>
          <label><span>Owner</span><input value={signoffForm.owner} onChange={event=>setSignoffForm({...signoffForm,owner:event.target.value})} required/></label>
          <label><span>Follow-up date</span><input type="date" value={signoffForm.followUpDate} onChange={event=>setSignoffForm({...signoffForm,followUpDate:event.target.value})} required/></label>
          <label><span>Follow-up time</span><input type="time" value={signoffForm.followUpTime} onChange={event=>setSignoffForm({...signoffForm,followUpTime:event.target.value})} required/></label>
          <label><span>Follow-up timezone</span><input value={signoffForm.followUpTimezone} onChange={event=>setSignoffForm({...signoffForm,followUpTimezone:event.target.value})} required/></label>
          <label><span>Pending work (title | owner | dueDate | disposition)</span><textarea value={signoffForm.pendingWork} onChange={event=>setSignoffForm({...signoffForm,pendingWork:event.target.value})}/></label>
          <label><span>Teach-back</span><textarea value={signoffForm.teachBack} onChange={event=>setSignoffForm({...signoffForm,teachBack:event.target.value})} required/></label>
          <label><span>Patient understanding</span><select value={signoffForm.teachBackOutcome} onChange={event=>setSignoffForm({...signoffForm,teachBackOutcome:event.target.value as NonNullable<SignoffRecord['teachBackOutcome']>})}><option value="not-checked">Not checked yet</option><option value="understood">Patient explained the next step</option><option value="needs-clarification">Needs clarification</option><option value="declined">Patient declined a comprehension check</option></select></label>
          {signoffForm.teachBackOutcome==='needs-clarification'&&<>
            <label><span>Question to clarify</span><textarea required value={signoffForm.clarificationQuestion} onChange={event=>setSignoffForm({...signoffForm,clarificationQuestion:event.target.value})}/></label>
            <label><span>Clarification owner</span><input required value={signoffForm.clarificationOwner} onChange={event=>setSignoffForm({...signoffForm,clarificationOwner:event.target.value})}/></label>
            <label><span>Clarification due in your local timezone</span><input required type="datetime-local" value={signoffForm.clarificationDueAt} onChange={event=>setSignoffForm({...signoffForm,clarificationDueAt:event.target.value})}/></label>
          </>}
          <button type="submit" disabled={saving||Boolean(signedSignoff)}>Save encounter draft</button>
        </form></fieldset>
        {signoffDraft.dirty&&!signedSignoff&&<p>Save your draft changes before reviewing or signing.</p>}
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}>
          <button type="button" disabled={saving||!draftSignoff||signoffDraft.dirty} onClick={draftSignoff?()=>void submit({type:'encounters.signoff.review',requestId:crypto.randomUUID(),patientId:selectedPatientId,encounterId:draftSignoff.encounterId,id:draftSignoff.id,expectedVersion:draftSignoff.version,reason:'Draft reviewed before sign-off.'}):undefined}>Mark reviewed</button>
          <button type="button" disabled={saving||!reviewedSignoff||signoffDraft.dirty} onClick={reviewedSignoff?()=>void submit({type:'encounters.signoff.sign',requestId:crypto.randomUUID(),patientId:selectedPatientId,encounterId:reviewedSignoff.encounterId,id:reviewedSignoff.id,expectedVersion:reviewedSignoff.version,reason:'Signed after clinician review.'}):undefined}>Sign encounter</button>
          {signedSignoff&&<label><span>Amendment reason</span><textarea value={amendmentReason} onChange={event=>setAmendmentReason(event.target.value)} disabled={saving}/></label>}
          <button type="button" disabled={saving||!signedSignoff||!amendmentReason.trim()} onClick={signedSignoff?()=>void submit(()=>({type:'encounters.signoff.amend',...signoffDetails(),requestId:crypto.randomUUID(),patientId:selectedPatientId,encounterId:signedSignoff.encounterId,id:signedSignoff.id,expectedVersion:signoffDraft.version??signedSignoff.version,amendmentReason,rationale:signoffForm.rationale,patientFacingPlan:signoffForm.patientFacingPlan,disposition:{selected:splitList(signoffForm.selected),rejected:splitList(signoffForm.rejected),deferred:splitList(signoffForm.deferred),noChange:signoffForm.noChange},owner:signoffForm.owner,followUp:{date:signoffForm.followUpDate,time:signoffForm.followUpTime,timezone:signoffForm.followUpTimezone},pendingWork:parsePendingWork(signoffForm.pendingWork),teachBack:signoffForm.teachBack})):undefined}>Create amendment draft</button>
        </div>
      </Panel>
    </details>

    <details>
      <summary data-journey="J17">Episode review {episode&&statusBadge(episode.status)}</summary>
      <Panel title="Episode review and closure" subtitle="Closure requires explicit pending-work disposition and ownership.">
        <SourceComparison comparison={comparison}/>
        {dependencies===undefined?<p>Reload the care record to check outstanding work before closure.</p>:dependencies.length?<><p>Outstanding work must have accepted receiving responsibility.</p><ul>{dependencies.map(item=><li key={item.id}><strong>{item.title}</strong> · {item.acceptedOwner?`Responsibility accepted by ${item.acceptedOwner}`:`Owner: ${item.owner||'Not assigned'} · receiving responsibility not yet accepted`} · {item.dueAt||'Due time not recorded'}</li>)}</ul></>:<p>No outstanding care work is attached to this episode.</p>}
        <fieldset disabled={saving}><form onSubmit={async event=>{event.preventDefault();await submit(()=>({
          type:'encounters.episode.save',
          requestId:crypto.randomUUID(),
          patientId:selectedPatientId,
          encounterId:episode?.encounterId??encounterIdFor(),
          ...(episodeDraft.version!==undefined?{expectedVersion:episodeDraft.version}:{ }),
          goalEvidence:episodeForm.goalEvidence,
          observedOutcomes:episodeForm.observedOutcomes,
          priorInterventions:episodeForm.priorInterventions,
          ongoingInterventions:episodeForm.ongoingInterventions,
          patientExperience:episodeForm.patientExperience,
          remainingConcerns:splitList(episodeForm.remainingConcerns),
          decision:episodeForm.decision as EpisodeReviewRecord['decision'],
          pendingWorkDisposition:episodeForm.pendingWorkDisposition,
          pendingWorkOwner:episodeForm.pendingWorkOwner,
          status:episodeForm.status as 'draft'|'reviewed',
        }));}}>
          <label><span>Goal evidence</span><textarea value={episodeForm.goalEvidence} onChange={event=>setEpisodeForm({...episodeForm,goalEvidence:event.target.value})} required/></label>
          <label><span>Observed outcomes</span><textarea value={episodeForm.observedOutcomes} onChange={event=>setEpisodeForm({...episodeForm,observedOutcomes:event.target.value})} required/></label>
          <label><span>Prior interventions</span><textarea value={episodeForm.priorInterventions} onChange={event=>setEpisodeForm({...episodeForm,priorInterventions:event.target.value})}/></label>
          <label><span>Ongoing interventions</span><textarea value={episodeForm.ongoingInterventions} onChange={event=>setEpisodeForm({...episodeForm,ongoingInterventions:event.target.value})}/></label>
          <label><span>Patient experience</span><textarea value={episodeForm.patientExperience} onChange={event=>setEpisodeForm({...episodeForm,patientExperience:event.target.value})} required/></label>
          <label><span>Remaining concerns</span><textarea value={episodeForm.remainingConcerns} onChange={event=>setEpisodeForm({...episodeForm,remainingConcerns:event.target.value})}/></label>
          <label><span>Episode decision</span><select value={episodeForm.decision} onChange={event=>setEpisodeForm({...episodeForm,decision:event.target.value as EpisodeReviewRecord['decision']})}><option value="continue">Continue</option><option value="change">Change</option><option value="maintenance">Maintenance</option><option value="transfer">Transfer</option><option value="closure">Closure</option></select></label>
          <label><span>Pending work disposition</span><textarea value={episodeForm.pendingWorkDisposition} onChange={event=>setEpisodeForm({...episodeForm,pendingWorkDisposition:event.target.value})}/></label>
          <label><span>Pending work owner</span><input value={episodeForm.pendingWorkOwner} onChange={event=>setEpisodeForm({...episodeForm,pendingWorkOwner:event.target.value})}/></label>
          <label><span>Review status</span><select value={episodeForm.status} onChange={event=>setEpisodeForm({...episodeForm,status:event.target.value as 'draft'|'reviewed'})}><option value="draft">Draft</option><option value="reviewed">Reviewed</option></select></label>
          <button type="submit" disabled={saving||episode?.status==='closed'}>Save episode review</button>
        </form></fieldset>
        <button type="button" disabled={saving||!closableEpisode||episodeDraft.dirty||dependencies===undefined||!!blockedDependencies?.length} onClick={closableEpisode?()=>void submit({type:'encounters.episode.close',requestId:crypto.randomUUID(),patientId:selectedPatientId,encounterId:closableEpisode.encounterId,id:closableEpisode.id,expectedVersion:closableEpisode.version,reason:'Closure confirmed with pending work disposition and owner.'}):undefined}>Close episode</button>
        {episode?.closureSnapshot&&<p>Closed by {episode.closureSnapshot.actor} on {episode.closureSnapshot.at}. {episode.closureSnapshot.dependencies.length} open item(s) retained with accepted receiving responsibility.</p>}
      </Panel>
    </details>

    {[preparation,intake,assessment,observations,signoff,episode].some(Boolean)&&<Panel title="Saved history" subtitle="Latest workflow versions for this patient">
      <ul>
        {preparation&&<li>Preparation v{preparation.version} · {preparation.updatedAt} · {preparation.history.length} history entries{preparation.latestInformation&&<p>Additional information: {preparation.latestInformation}</p>}</li>}
        {intake&&<li>Intake v{intake.version} · {intake.updatedAt} · {intake.history.length} history entries</li>}
        {assessment&&<li>Assessment v{assessment.version} · {assessment.updatedAt} · {assessment.history.length} history entries</li>}
        {observations&&<li>Observations v{observations.version} · {observations.updatedAt} · {observations.entries.length} saved observations</li>}
        {signoff&&<li>Sign-off v{signoff.version} · {signoff.updatedAt} · {signoff.status}</li>}
        {episode&&<li>Episode review v{episode.version} · {episode.updatedAt} · {episode.status}</li>}
      </ul>
      {state.signoffs.filter(item=>item.patientId===selectedPatientId&&item.encounterId===selectedEncounterId).map(item=><details key={item.id}><summary>{item.amendedFromId?'Amendment':'Original encounter'} · {item.status} · {item.updatedAt}</summary>{item.amendmentReason&&<p>Amendment reason: {item.amendmentReason}</p>}<p>{item.patientFacingPlan}</p><ul>{item.history.map(event=><li key={event.id}>{event.at} · {event.actor}: {event.reason}</li>)}</ul></details>)}
      {observations&&<details><summary>Observation history</summary><ul>{observations.entries.map(entry=><li key={entry.id}>{entry.recordedAt} · {entry.metric}: {entry.value??entry.status} · {entry.source}{entry.correctedFromEntryId?' · correction':''}</li>)}</ul></details>}
    </Panel>}
  </div>;
}

export {reduce};
