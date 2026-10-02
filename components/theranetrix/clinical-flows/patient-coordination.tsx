'use client';

import {useMemo,useRef,useState,type FormEvent,type ReactNode,type SetStateAction} from 'react';
import {Panel,EmptyState,Badge,formatDate} from '../ui';
import {Button} from '@/components/ui/button';
import {useLocationParameter} from '../location-state';
import {type Action,type State,getSummary,type Context,type PathwayStage,type PatientSupportRecord,type HumanHandoffRecord,type LanguageAccessRecord,type PathwayRecord,type SchedulingRecord} from '@/lib/clinical-flows/patient-coordination';
import './patient-coordination.css';

type Props={
  patientId?:string;
  patients:readonly {id:string;name:string}[];
  state:State;
  busy:boolean;
  onAction:(action:Action)=>Promise<boolean>;
  clinicalContext?:{carePlans?:Context['carePlans'];protocolAssignments?:Context['protocolAssignments']};
};

const approvedEducation=['Pain plan copy','Scheduling checklist','Language access instructions','Follow-up reminder sheet'] as const;
const reminderOptions=['sms','phone','portal','mail','none'] as const;
const handoffPhases=['locally-saved','delivery-reported','ownership-accepted','reviewed','action-documented','response-recorded','closed'] as const;
const handoffStatuses=['pending','reported','failed','retry','overdue'] as const;
const patientContactStatuses=['not-attempted','attempted','failed','successful'] as const;
const translationStatuses=['not-needed','translated','unsupported','pending-review'] as const;
const stageStatuses=['pending','active','completed','failed-automation','deferred','declined'] as const;
const schedulePhases=['follow-up-due','requested','booking-reported','confirmed','attended','cancelled','no-show','reschedule-outreach'] as const;
const outreachStatuses=['not-started','in-progress','unreachable','retry-scheduled','completed'] as const;

type SupportDraft={patientId:string;encounterId:string;id?:string;expectedVersion?:number;requestId:string;conversationDate:string;planId:string;planVersion:string;goalText:string;approvedEducation:string;reminderChannel:string;optedOut:boolean;dueCheckInDate:string;originalText:string;attributedSummary:string;summaryAuthor:string;participationMode:string;participant:string;recordedSource:string};
type HandoffDraft={patientId:string;encounterId:string;id?:string;expectedVersion?:number;requestId:string;concern:string;dedupeKey:string;priority:string;urgencySourceType:string;urgencySource:string;responsibleTeam:string;responsiblePerson:string;coverageExpectation:string;fallbackOwner:string;phase:string;deliveryStatus:string;dueAt:string;deliveryEvidenceSource:string;deliveryEvidenceRef:string;actionSummary:string;responseSummary:string;patientContactStatus:string;patientContactFailureReason:string;nextAttemptAt:string;transitionReason:string};
type LanguageDraft={patientId:string;encounterId:string;id?:string;expectedVersion?:number;requestId:string;planId:string;planVersion:string;preferredLanguage:string;instructionsLanguage:string;sourceText:string;translatedText:string;translationStatus:string;translationReviewer:string;accessibilityPreferences:string;teachBack:string;caregiverRole:string;interpreterRole:string;sharedDevice:boolean;proxyStatus:string;verifiedPatientAuth:boolean};
type PathwayDraft={patientId:string;encounterId:string;id?:string;expectedVersion?:number;requestId:string;protocolAssignmentId:string;protocolAssignmentVersion?:number;eventType:string;reviewChoiceId:string;reviewChoiceValue:string;pathwayKey:string;pathwayVersion:string;currentVersion:boolean;eventId:string;transitionReason:string;stages:PathwayStage[]};
type ScheduleDraft={patientId:string;encounterId:string;id?:string;expectedVersion?:number;requestId:string;phase:string;dueWindowStart:string;dueWindowEnd:string;dueWindowTimezone:string;owner:string;preferredChannel:string;optedOut:boolean;appointmentStartsAt:string;appointmentTimezone:string;bookingEvidenceSource:string;bookingEvidenceRef:string;outreachStatus:string;outreachNote:string;nextAttemptAt:string;cancellationReason:string;transitionReason:string};

function supportDraft(patientId:string,record?:PatientSupportRecord):SupportDraft{
  return {
    patientId,
    encounterId:record?.encounterId??'',
    id:record?.id,
    expectedVersion:record?.version,
    requestId:'',
    conversationDate:record?.conversationDate??'',
    planId:record?.planRef.planId??'',
    planVersion:String(record?.planRef.planVersion??1),
    goalText:record?.planRef.goalText??'',
    approvedEducation:record?.approvedEducation?.join(', ')??'',
    reminderChannel:record?.reminderPreference.channel??'none',
    optedOut:record?.reminderPreference.optedOut??false,
    dueCheckInDate:record?.dueCheckInDate??'',
    originalText:record?.originalText??'',
    attributedSummary:record?.attributedSummary??'',
    summaryAuthor:record?.summaryAuthor??'',
    participationMode:record?.participation.mode??'digital',
    participant:record?.participation.participant??'patient',
    recordedSource:record?.participation.recordedSource??'',
  };
}

function handoffDraft(patientId:string,record?:HumanHandoffRecord):HandoffDraft{
  return {
    patientId,
    encounterId:record?.encounterId??'',
    id:record?.id,
    expectedVersion:record?.version,
    requestId:'',
    concern:record?.concern??'',
    dedupeKey:record?.dedupeKey??'',
    priority:record?.priority??'routine',
    urgencySourceType:record?.urgencySource.type??'authorized-human',
    urgencySource:record?.urgencySource.label??'',
    responsibleTeam:record?.responsibleTeam??'',
    responsiblePerson:record?.responsiblePerson??'',
    coverageExpectation:record?.coverageExpectation??'',
    fallbackOwner:record?.fallbackOwner??'',
    phase:record?.phase??'locally-saved',
    deliveryStatus:record?.deliveryStatus??'pending',
    dueAt:record?.dueAt??'',
    deliveryEvidenceSource:record?.deliveryEvidence?.source??'none',
    deliveryEvidenceRef:record?.deliveryEvidence?.reference??'',
    actionSummary:record?.actionSummary??'',
    responseSummary:record?.responseSummary??'',
    patientContactStatus:record?.patientContact.status??'not-attempted',
    patientContactFailureReason:record?.patientContact.failureReason??'',
    nextAttemptAt:record?.patientContact.nextAttemptAt??'',
    transitionReason:'',
  };
}

function languageDraft(patientId:string,record?:LanguageAccessRecord):LanguageDraft{
  return {
    patientId,
    encounterId:record?.encounterId??'',
    id:record?.id,
    expectedVersion:record?.version,
    requestId:'',
    planId:record?.planRef?.planId??'',
    planVersion:String(record?.planRef?.planVersion??1),
    preferredLanguage:record?.preferredLanguage??'en',
    instructionsLanguage:record?.instructionsLanguage??'en',
    sourceText:record?.sourceText??'',
    translatedText:record?.translatedText??'',
    translationStatus:record?.translationStatus??'not-needed',
    translationReviewer:record?.translationReviewer??'',
    accessibilityPreferences:record?.accessibilityPreferences.join(', ')??'',
    teachBack:record?.teachBack??'',
    caregiverRole:record?.caregiverRole??'',
    interpreterRole:record?.interpreterRole??'',
    sharedDevice:record?.sharedDevice??false,
    proxyStatus:record?.proxyStatus??'none',
    verifiedPatientAuth:record?.verifiedPatientAuth??false,
  };
}

function pathwayDraft(patientId:string,record?:PathwayRecord):PathwayDraft{
  return {
    patientId,
    encounterId:record?.encounterId??'',
    id:record?.id,
    expectedVersion:record?.version,
    requestId:'',
    protocolAssignmentId:record?.protocolAssignmentId??'',
    protocolAssignmentVersion:record?.protocolAssignmentVersion,
    eventType:'',reviewChoiceId:'',reviewChoiceValue:'',
    pathwayKey:record?.pathwayKey??'patient-support-operational',
    pathwayVersion:record?.pathwayVersion??'local-v1',
    currentVersion:record?.currentVersion??true,
    eventId:'',
    transitionReason:'',
    stages:record?.stages.map(stage=>({...stage,prerequisites:[...stage.prerequisites]}))??[{id:'stage-intake',title:'Intake handoff',activity:'Review saved support, language, and scheduling needs.',prerequisites:[],status:'pending',owner:'Care coordination',dueDate:''}],
  };
}

function scheduleDraft(patientId:string,record?:SchedulingRecord):ScheduleDraft{
  return {
    patientId,
    encounterId:record?.encounterId??'',
    id:record?.id,
    expectedVersion:record?.version,
    requestId:'',
    phase:record?.phase??'follow-up-due',
    dueWindowStart:record?.dueWindow.start??'',
    dueWindowEnd:record?.dueWindow.end??'',
    dueWindowTimezone:record?.dueWindow.timezone??'',
    owner:record?.owner??'',
    preferredChannel:record?.preferredChannel??'none',
    optedOut:record?.optedOut??false,
    appointmentStartsAt:record?.appointment?.startsAt??'',
    appointmentTimezone:record?.appointment?.timezone??'',
    bookingEvidenceSource:record?.appointment?.evidenceSource??'none',
    bookingEvidenceRef:record?.appointment?.evidenceRef??'',
    outreachStatus:record?.outreach.status??'not-started',
    outreachNote:'',
    nextAttemptAt:record?.outreach.nextAttemptAt??'',
    cancellationReason:record?.cancellationReason??'',
    transitionReason:'',
  };
}

type DraftRecord={id:string;version:number;patientId:string;encounterId:string;concern?:string;createdAt?:string};
type DraftBase={id?:string;expectedVersion?:number;patientId:string;encounterId:string};

function useRecordDraft<R extends DraftRecord,D extends DraftBase>(patientId:string,records:R[],receipts:State['receipts'],makeDraft:(patientId:string,record?:R)=>D,{requestedId='',busy,isSaving,discardRetry}:{requestedId?:string;busy:boolean;isSaving:()=>boolean;discardRetry:()=>void}){
  const initial=requestedId?records.find(record=>record.id===requestedId):records[0];
  const fresh=(record?:R,selectedId=record?.id??'')=>({selectedId,form:makeDraft(patientId,record),dirty:false,pending:false,requestedSelection:null as string|null,savedRequest:'',version:`${record?.id??''}:${record?.version??''}`,requestedId});
  const [editor,setEditor]=useState(()=>fresh(initial));
  const record=records.find(record=>record.id===editor.selectedId);
  const version=`${record?.id??''}:${record?.version??''}`;
  const receipt=editor.savedRequest?receipts.find(receipt=>receipt.requestId===editor.savedRequest&&receipt.patientId===patientId):undefined;
  const saved=receipt&&records.find(record=>record.id===receipt.recordId);
  // Reconcile only acknowledged saves or untouched drafts. Dirty drafts retain their
  // original version so a concurrent write is visible and cannot be overwritten.
  if(editor.requestedId!==requestedId&&!editor.dirty&&!editor.pending&&!busy){
    setEditor(fresh(initial));
  }else if(saved){
    setEditor({...fresh(saved),requestedId:editor.requestedId});
  }else if(!editor.dirty&&!editor.pending&&version!==editor.version){
    setEditor({...editor,form:makeDraft(patientId,record),version});
  }
  function setDraft(change:SetStateAction<D>){setEditor(current=>({...current,dirty:true,form:typeof change==='function'?(change as (form:D)=>D)(current.form):change}));}
  function open(id:string){
    if(isSaving())return;
    const selected=records.find(record=>record.id===id);
    discardRetry();setEditor(fresh(selected,id));
  }
  function select(id:string){
    if(isSaving()||id===editor.selectedId)return;
    if(editor.dirty||editor.pending)setEditor(current=>({...current,requestedSelection:id}));
    else open(id);
  }
  return {record,form:editor.form,setDraft,select,selectedId:editor.selectedId,
    awaiting:()=>setEditor(current=>({...current,pending:true})),
    saved:(requestId:string)=>setEditor(current=>({...current,pending:false,savedRequest:requestId})),
    selectionPending:editor.requestedSelection!==null,
    keepEditing:()=>setEditor(current=>({...current,requestedSelection:null})),
    discardAndSwitch:()=>{if(editor.requestedSelection!==null)open(editor.requestedSelection);},
    reload:()=>open(editor.selectedId),stale:!!record&&editor.form.expectedVersion!==record.version,
    linkedRecordPending:editor.requestedId!==requestedId&&(editor.dirty||editor.pending),openLinkedRecord:()=>open(initial?.id??'')};
}

export function PatientCoordinationPanel(props:Props){
  const [selection,setSelection]=useState('');
  const requestedHandoffId=useLocationParameter('workflowRecordId')??'';
  const activePatientId=props.patientId??selection;
  const patient=props.patients.find(patient=>patient.id===activePatientId);
  if(props.patientId&&!patient)return <Panel title="Patient coordination"><EmptyState title="Invalid patient context" description="This launch context does not match a known patient. Select a valid patient before continuing."/></Panel>;
  if(patient&&requestedHandoffId&&!props.state.handoffs.some(record=>record.id===requestedHandoffId&&record.patientId===patient.id))return <Panel title="Patient coordination"><div className="padded"><p role="alert">This handoff is not available for the selected patient. No other handoff has been opened.</p><a className="text-link" href={'/review-queue?patient='+encodeURIComponent(patient.id)}>Return to this patient’s review queue</a></div></Panel>;
  return <div className="patient-coordination stack">
    {!props.patientId&&<label>Patient<select value={selection} onChange={event=>setSelection(event.target.value)} disabled={props.busy}><option value="">Select a patient</option>{props.patients.map(patient=><option key={patient.id} value={patient.id}>{patient.name}</option>)}</select></label>}
    {patient?<PatientCoordinationEditor key={patient.id} {...props} patientId={patient.id} requestedHandoffId={requestedHandoffId}/>:<EmptyState title="Select a patient" description="Choose a patient to document support, handoffs, language access, pathways, and follow-up scheduling."/>}
  </div>;
}

function PatientCoordinationEditor({patientId:activePatientId,patients,state,busy:externalBusy,onAction,clinicalContext,requestedHandoffId}:Props&{patientId:string;requestedHandoffId:string}){
  const requestedJourney=useLocationParameter('workflowJourney');
  const patientName=patients.find(patient=>patient.id===activePatientId)!.name;
  const [saving,setSaving]=useState(false);
  const busy=externalBusy||saving;
  const inFlight=useRef(false);
  const pendingRequests=useRef(new Map<string,{fingerprint:string;requestId:string;eventId:string}>());
  const isSaving=()=>externalBusy||inFlight.current;
  const supportRecords=state.support.filter(record=>record.patientId===activePatientId);
  const handoffRecords=state.handoffs.filter(record=>record.patientId===activePatientId);
  const languageRecords=state.language.filter(record=>record.patientId===activePatientId);
  const pathwayRecords=state.pathways.filter(record=>record.patientId===activePatientId);
  const scheduleRecords=state.scheduling.filter(record=>record.patientId===activePatientId);
  const supportEditor=useRecordDraft(activePatientId,supportRecords,state.receipts,supportDraft,{busy,isSaving,discardRetry:()=>{pendingRequests.current.delete('patient-coordination.support.save');}});
  const handoffEditor=useRecordDraft(activePatientId,handoffRecords,state.receipts,handoffDraft,{requestedId:requestedHandoffId,busy,isSaving,discardRetry:()=>{pendingRequests.current.delete('patient-coordination.handoff.save');}});
  const languageEditor=useRecordDraft(activePatientId,languageRecords,state.receipts,languageDraft,{busy,isSaving,discardRetry:()=>{pendingRequests.current.delete('patient-coordination.language.save');}});
  const pathwayEditor=useRecordDraft(activePatientId,pathwayRecords,state.receipts,pathwayDraft,{busy,isSaving,discardRetry:()=>{pendingRequests.current.delete('patient-coordination.pathway.save');}});
  const scheduleEditor=useRecordDraft(activePatientId,scheduleRecords,state.receipts,scheduleDraft,{busy,isSaving,discardRetry:()=>{pendingRequests.current.delete('patient-coordination.schedule.save');}});
  const {record:support,form:supportForm,setDraft:setSupportForm}=supportEditor;
  const {record:handoff,form:handoffForm,setDraft:setHandoffForm}=handoffEditor;
  const {record:language,form:languageForm,setDraft:setLanguageForm}=languageEditor;
  const {record:pathway,form:pathwayForm,setDraft:setPathwayForm}=pathwayEditor;
  const {record:schedule,form:scheduleForm,setDraft:setScheduleForm}=scheduleEditor;
  const localChecklistDraft=useRef<PathwayDraft|null>(null);
  const carePlans=clinicalContext?.carePlans?.filter(plan=>plan.patientId===activePatientId);
  const assignments=clinicalContext?.protocolAssignments?.filter(assignment=>assignment.patientId===activePatientId)??[];
  const assignedProtocol=assignments.find(assignment=>assignment.id===pathwayForm.protocolAssignmentId);
  const qualifyingEvents=[...new Set(assignedProtocol?.protocolSnapshot?.steps.flatMap(step=>step.transitions??[]).flatMap(({when})=>when.kind==='event'?[when.eventType]:[])??[])];
  const reviewChoices=assignedProtocol?.protocolSnapshot?.steps.flatMap(step=>step.transitions??[]).flatMap(({when})=>when.kind==='review-choice'?[when]:[])??[];
  const summary=useMemo(()=>getSummary(state,activePatientId),[state,activePatientId]);
  const openHandoffs=handoffRecords.filter(record=>record.phase!=='closed');
  const urgentHandoffs=openHandoffs.filter(record=>record.priority==='high');
  const editorNeedsAttention=(editor:{stale:boolean;selectionPending:boolean;linkedRecordPending?:boolean})=>editor.stale||editor.selectionPending||!!editor.linkedRecordPending;
  const editorWarnings=[['Patient support',supportEditor],['Human handoff',handoffEditor],['Language and access',languageEditor],['Operational pathway',pathwayEditor],['Scheduling and outreach',scheduleEditor]] as const;
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  async function submit(action:Action){
    if(busy||inFlight.current)return;
    if(action.patientId!==activePatientId){setError('Patient context changed. Reopen this record before saving.');return;}
    if(action.type==='patient-coordination.handoff.save'&&handoffEditor.linkedRecordPending){setError('A different handoff was requested. Review the preserved draft before opening the linked record.');return;}
    inFlight.current=true;
    setSaving(true);
    setError('');
    setNotice('');
    const fingerprint=JSON.stringify(action);
    let pending=pendingRequests.current.get(action.type);
    if(!pending||pending.fingerprint!==fingerprint){pending={fingerprint,requestId:crypto.randomUUID(),eventId:crypto.randomUUID()};pendingRequests.current.set(action.type,pending);}
    const command={...action,requestId:pending.requestId,...(action.type==='patient-coordination.pathway.save'?{eventId:pending.eventId}:{})} as Action;
    const editor=action.type==='patient-coordination.support.save'?supportEditor:action.type==='patient-coordination.handoff.save'?handoffEditor:action.type==='patient-coordination.language.save'?languageEditor:action.type==='patient-coordination.pathway.save'?pathwayEditor:scheduleEditor;
    editor.awaiting();
    try{
      const saved=await onAction(command);
      if(!saved)setError('Save did not complete. Your draft is preserved. Review the latest record and try again.');
      else{
        editor.saved(command.requestId);
        pendingRequests.current.delete(action.type);
        setNotice('Record saved.');
      }
    }catch(err){setError(err instanceof Error?err.message:'Unable to save. Your draft is preserved.');}
    finally{inFlight.current=false;setSaving(false);}
  }
  return <div className="stack clinical-coordination-editor">
    <Panel title="Patient coordination" subtitle={`Coordination records for ${patientName}. Delivery and bookings require recorded evidence. Authentication status comes from a trusted sign-in service.`} action={<Badge tone={summary.overdue?'amber':'teal'}>{summary.open} open · {summary.overdue} overdue</Badge>}>
      {summary.attention.length>0&&<div className="stack">{summary.attention.map(note=><div key={note} className="resolution-note">{note}</div>)}</div>}
      {error&&<div className="resolution-note" role="alert">{error}</div>}
      {notice&&<div className="resolution-note" role="status">{notice}</div>}
      {editorWarnings.filter(([,editor])=>editorNeedsAttention(editor)).map(([label])=><p role="status" className="clinical-editor-warning" key={label}>{label}: review the preserved draft and updated record before continuing.</p>)}
    </Panel>
    <details className="clinical-workflow-step" open={requestedJourney==='J09'||editorNeedsAttention(supportEditor)||!requestedJourney&&!urgentHandoffs.length&&!requestedHandoffId}><summary data-journey="J09"><span>Patient support<small>Plan understanding, education, and reminders</small></span><b>{supportRecords.length} records</b></summary><div className="clinical-step-body">
    <Panel title="Patient support" subtitle="Capture the dated conversation, exact saved plan/version, approved education, reminder preferences, and patient-authored summary.">
      <RecordSelector label="Support record" records={supportRecords} editor={supportEditor} busy={busy}/>
      <form className="entry-form" onSubmit={(event:FormEvent)=>{event.preventDefault();void submit({type:'patient-coordination.support.save',id:supportForm.id,expectedVersion:supportForm.expectedVersion,patientId:activePatientId,encounterId:supportForm.encounterId,requestId:supportForm.requestId,conversationDate:supportForm.conversationDate,planId:supportForm.planId,planVersion:Number(supportForm.planVersion),goalText:supportForm.goalText,approvedEducation:supportForm.approvedEducation.split(',').map(value=>value.trim()).filter((value):value is typeof approvedEducation[number]=>approvedEducation.includes(value as typeof approvedEducation[number])),reminderChannel:supportForm.reminderChannel as typeof reminderOptions[number],optedOut:supportForm.optedOut,dueCheckInDate:supportForm.dueCheckInDate,originalText:supportForm.originalText,attributedSummary:supportForm.attributedSummary,summaryAuthor:supportForm.summaryAuthor,participationMode:supportForm.participationMode as 'digital'|'staff-recorded',participant:supportForm.participant as 'patient'|'caregiver',recordedSource:supportForm.recordedSource});}}>
        <fieldset disabled={busy}>
          <label>Encounter ID<input readOnly={!!supportForm.id} value={supportForm.encounterId} onChange={event=>setSupportForm(form=>({...form,encounterId:event.target.value}))} required/></label>
          <label>Conversation date<input type="date" value={supportForm.conversationDate} onChange={event=>setSupportForm(form=>({...form,conversationDate:event.target.value}))} required/></label>
          {carePlans&&<label>Saved care plan<select value={carePlans.some(plan=>plan.id===supportForm.planId&&plan.version===Number(supportForm.planVersion))?`${supportForm.planId}:${supportForm.planVersion}`:''} onChange={event=>{const plan=carePlans.find(plan=>`${plan.id}:${plan.version}`===event.target.value);if(plan)setSupportForm(form=>({...form,planId:plan.id,planVersion:String(plan.version),goalText:plan.goal??plan.summary??form.goalText}));}} required><option value="">Select a saved care plan</option>{carePlans.map(plan=><option key={`${plan.id}:${plan.version}`} value={`${plan.id}:${plan.version}`}>{plan.goal??plan.summary??plan.id} · version {plan.version}</option>)}</select></label>}
          <label>Plan ID<input readOnly={!!carePlans} value={supportForm.planId} onChange={event=>setSupportForm(form=>({...form,planId:event.target.value}))} required/></label>
          <label>Plan version<input readOnly={!!carePlans} type="number" min={1} value={supportForm.planVersion} onChange={event=>setSupportForm(form=>({...form,planVersion:event.target.value}))} required/></label>
          <label>Goal snapshot<textarea rows={2} value={supportForm.goalText} onChange={event=>setSupportForm(form=>({...form,goalText:event.target.value}))} required/></label>
          <fieldset className="coordination-choices"><legend>Approved education</legend>{approvedEducation.map(item=><label key={item}><input type="checkbox" checked={supportForm.approvedEducation.split(', ').includes(item)} onChange={event=>setSupportForm(form=>({...form,approvedEducation:(event.target.checked?[...form.approvedEducation.split(', ').filter(Boolean),item]:form.approvedEducation.split(', ').filter(value=>value!==item)).join(', ')}))}/>{item}</label>)}</fieldset>
          <label>Reminder channel<select disabled={supportForm.optedOut} value={supportForm.reminderChannel} onChange={event=>setSupportForm(form=>({...form,reminderChannel:event.target.value}))}>{reminderOptions.map(option=><option key={option} value={option}>{option}</option>)}</select></label>
          <label><input type="checkbox" checked={supportForm.optedOut} onChange={event=>setSupportForm(form=>({...form,optedOut:event.target.checked,reminderChannel:event.target.checked?'none':form.reminderChannel}))}/> Patient opted out of reminders</label>
          <label>Due check-in date<input type="date" value={supportForm.dueCheckInDate} onChange={event=>setSupportForm(form=>({...form,dueCheckInDate:event.target.value}))} required/></label>
          <label>Original patient text<textarea rows={4} value={supportForm.originalText} onChange={event=>setSupportForm(form=>({...form,originalText:event.target.value}))} required/></label>
          <label>Editable attributed summary<textarea rows={4} value={supportForm.attributedSummary} onChange={event=>setSupportForm(form=>({...form,attributedSummary:event.target.value}))} required/></label>
          <label>Summary author<input value={supportForm.summaryAuthor} onChange={event=>setSupportForm(form=>({...form,summaryAuthor:event.target.value}))} required/></label>
          <label>Participation mode<select value={supportForm.participationMode} onChange={event=>setSupportForm(form=>({...form,participationMode:event.target.value}))}><option value="digital">digital</option><option value="staff-recorded">staff-recorded</option></select></label>
          <label>Participant<select value={supportForm.participant} onChange={event=>setSupportForm(form=>({...form,participant:event.target.value}))}><option value="patient">patient</option><option value="caregiver">caregiver</option></select></label>
          <label>Recorded source<input value={supportForm.recordedSource} onChange={event=>setSupportForm(form=>({...form,recordedSource:event.target.value}))} required/></label>
          <div className="form-actions"><Button type="submit" disabled={busy}>{busy?'Saving…':'Save support record'}</Button></div>
        </fieldset>
      </form>
      {support&&<RecordMeta record={support}/>}
    </Panel>
    </div></details>
    <details className="clinical-workflow-step" open={requestedJourney==='J10'||!!requestedHandoffId||urgentHandoffs.length>0||editorNeedsAttention(handoffEditor)}><summary data-journey="J10"><span>Human handoff<small>Concern, responsible owner, and documented response</small></span><b className={urgentHandoffs.length?'clinical-attention-count':''}>{urgentHandoffs.length?urgentHandoffs.length+' high priority':openHandoffs.length+' open'}</b></summary><div className="clinical-step-body">
    <Panel title="Human handoff" subtitle="Track concern delivery, ownership, review, documented action, response, and closure without implying delivery or triage beyond the saved evidence.">
      <RecordSelector label="Handoff record" records={handoffRecords} editor={handoffEditor} busy={busy}/>
      <form className="entry-form" onSubmit={(event:FormEvent)=>{event.preventDefault();void submit({type:'patient-coordination.handoff.save',id:handoffForm.id,expectedVersion:handoffForm.expectedVersion,patientId:activePatientId,encounterId:handoffForm.encounterId,requestId:handoffForm.requestId,concern:handoffForm.concern,dedupeKey:handoffForm.dedupeKey,priority:handoffForm.priority as 'routine'|'high',urgencySourceType:handoffForm.urgencySourceType as 'authorized-human'|'approved-policy'|'patient-request',urgencySource:handoffForm.urgencySource,responsibleTeam:handoffForm.responsibleTeam,responsiblePerson:handoffForm.responsiblePerson,coverageExpectation:handoffForm.coverageExpectation,fallbackOwner:handoffForm.fallbackOwner,phase:handoffForm.phase as typeof handoffPhases[number],deliveryStatus:handoffForm.deliveryStatus as typeof handoffStatuses[number],dueAt:handoffForm.dueAt||undefined,deliveryEvidenceSource:handoffForm.deliveryEvidenceSource as 'none'|'receipt'|'manual',deliveryEvidenceRef:handoffForm.deliveryEvidenceRef||undefined,actionSummary:handoffForm.actionSummary||undefined,responseSummary:handoffForm.responseSummary||undefined,patientContactStatus:handoffForm.patientContactStatus as typeof patientContactStatuses[number],patientContactFailureReason:handoffForm.patientContactFailureReason||undefined,nextAttemptAt:handoffForm.nextAttemptAt||undefined,transitionReason:handoffForm.transitionReason||'Manual handoff update'});}}>
        <fieldset disabled={busy}>
          <label>Encounter ID<input readOnly={!!handoffForm.id} value={handoffForm.encounterId} onChange={event=>setHandoffForm(form=>({...form,encounterId:event.target.value}))} required/></label>
          <label>Concern<textarea rows={3} value={handoffForm.concern} onChange={event=>setHandoffForm(form=>({...form,concern:event.target.value}))} required/></label>
          <label>Related concern reference<input value={handoffForm.dedupeKey} onChange={event=>setHandoffForm(form=>({...form,dedupeKey:event.target.value}))} required/></label>
          <label>Priority<select value={handoffForm.priority} onChange={event=>setHandoffForm(form=>({...form,priority:event.target.value}))}><option value="routine">routine</option><option value="high">high</option></select></label>
          <label>How urgency was identified<select value={handoffForm.urgencySourceType} onChange={event=>setHandoffForm(form=>({...form,urgencySourceType:event.target.value}))}><option value="authorized-human">Clinician assessment</option><option value="approved-policy">Approved policy</option><option value="patient-request">Patient request awaiting assessment</option></select></label>
          <label>Urgency source<input value={handoffForm.urgencySource} onChange={event=>setHandoffForm(form=>({...form,urgencySource:event.target.value}))} required/></label>
          <label>Responsible team<input value={handoffForm.responsibleTeam} onChange={event=>setHandoffForm(form=>({...form,responsibleTeam:event.target.value}))} required/></label>
          <label>Responsible person<input value={handoffForm.responsiblePerson} onChange={event=>setHandoffForm(form=>({...form,responsiblePerson:event.target.value}))} required/></label>
          <label>Coverage expectation<textarea rows={2} value={handoffForm.coverageExpectation} onChange={event=>setHandoffForm(form=>({...form,coverageExpectation:event.target.value}))} required/></label>
          <label>Fallback owner<input value={handoffForm.fallbackOwner} onChange={event=>setHandoffForm(form=>({...form,fallbackOwner:event.target.value}))} required/></label>
          <label>Phase<select value={handoffForm.phase} onChange={event=>setHandoffForm(form=>({...form,phase:event.target.value}))}>{handoffPhases.map(option=><option key={option} value={option}>{option}</option>)}</select></label>
          <label>Delivery status<select value={handoffForm.deliveryStatus} onChange={event=>setHandoffForm(form=>({...form,deliveryStatus:event.target.value}))}>{handoffStatuses.map(option=><option key={option} value={option}>{option}</option>)}</select></label>
          <label>Due at (your device timezone)<input type="datetime-local" value={toLocalInput(handoffForm.dueAt)} onChange={event=>setHandoffForm(form=>({...form,dueAt:fromLocalInput(event.target.value)}))}/></label>
          <label>Delivery evidence source<select value={handoffForm.deliveryEvidenceSource} onChange={event=>setHandoffForm(form=>({...form,deliveryEvidenceSource:event.target.value}))}><option value="none">none</option><option value="receipt">receipt</option><option value="manual">manual</option></select></label>
          <label>Delivery evidence reference<input value={handoffForm.deliveryEvidenceRef} onChange={event=>setHandoffForm(form=>({...form,deliveryEvidenceRef:event.target.value}))}/></label>
          <label>Action documented<textarea rows={2} value={handoffForm.actionSummary} onChange={event=>setHandoffForm(form=>({...form,actionSummary:event.target.value}))}/></label>
          <label>Response recorded<textarea rows={2} value={handoffForm.responseSummary} onChange={event=>setHandoffForm(form=>({...form,responseSummary:event.target.value}))}/></label>
          <label>Patient contact status<select value={handoffForm.patientContactStatus} onChange={event=>setHandoffForm(form=>({...form,patientContactStatus:event.target.value}))}>{patientContactStatuses.map(option=><option key={option} value={option}>{option}</option>)}</select></label>
          <label>Patient contact failure reason<input value={handoffForm.patientContactFailureReason} onChange={event=>setHandoffForm(form=>({...form,patientContactFailureReason:event.target.value}))}/></label>
          <label>Next contact attempt (your device timezone)<input type="datetime-local" value={toLocalInput(handoffForm.nextAttemptAt)} onChange={event=>setHandoffForm(form=>({...form,nextAttemptAt:fromLocalInput(event.target.value)}))}/></label>
          <label>Transition reason<textarea rows={2} value={handoffForm.transitionReason} onChange={event=>setHandoffForm(form=>({...form,transitionReason:event.target.value}))} placeholder="Why is this handoff changing?"/></label>
          <div className="form-actions"><Button type="submit" disabled={busy}>{busy?'Saving…':'Save handoff'}</Button></div>
        </fieldset>
      </form>
      {handoff&&<RecordMeta record={handoff}><p className="muted">Duplicates retained: {handoff.duplicates.length}</p></RecordMeta>}
    </Panel>
    </div></details>
    <details className="clinical-workflow-step" open={requestedJourney==='J13'||editorNeedsAttention(languageEditor)}><summary data-journey="J13"><span>Language and access<small>Instructions, accessibility, and caregiver context</small></span><b>{languageRecords.length} records</b></summary><div className="clinical-step-body">
    <Panel title="Language and access" subtitle="Persist English/Spanish preferences, accessibility needs, attribution, and explicit unsupported translations.">
      <RecordSelector label="Language/access record" records={languageRecords} editor={languageEditor} busy={busy}/>
      <form className="entry-form" onSubmit={(event:FormEvent)=>{event.preventDefault();void submit({type:'patient-coordination.language.save',id:languageForm.id,expectedVersion:languageForm.expectedVersion,patientId:activePatientId,encounterId:languageForm.encounterId,requestId:languageForm.requestId,planId:languageForm.planId||undefined,planVersion:languageForm.planId?Number(languageForm.planVersion):undefined,preferredLanguage:languageForm.preferredLanguage as 'en'|'es',instructionsLanguage:languageForm.instructionsLanguage as 'en'|'es',sourceText:languageForm.sourceText,translatedText:languageForm.translatedText||undefined,translationStatus:languageForm.translationStatus as typeof translationStatuses[number],translationReviewer:languageForm.translationReviewer||undefined,accessibilityPreferences:languageForm.accessibilityPreferences.split(',').map(value=>value.trim()).filter(Boolean),teachBack:languageForm.teachBack,caregiverRole:languageForm.caregiverRole||undefined,interpreterRole:languageForm.interpreterRole||undefined,sharedDevice:languageForm.sharedDevice,proxyStatus:languageForm.proxyStatus as 'none'|'active'|'revoked',verifiedPatientAuth:false});}}>
        <fieldset disabled={busy}>
          <label>Encounter ID<input readOnly={!!languageForm.id} value={languageForm.encounterId} onChange={event=>setLanguageForm(form=>({...form,encounterId:event.target.value}))} required/></label>
          <label>Instructions for<select value={languageForm.planId} onChange={event=>{const plan=carePlans?.find(plan=>plan.id===event.target.value);setLanguageForm(form=>({...form,planId:plan?.id??'',planVersion:String(plan?.version??1),sourceText:plan?.summary??form.sourceText,translatedText:'',translationReviewer:'',translationStatus:form.preferredLanguage==='en'?'not-needed':'pending-review'}));}}><option value="">General instructions</option>{carePlans?.map(plan=><option key={plan.id} value={plan.id}>{plan.summary?.slice(0,100)||'Saved care plan'} · version {plan.version}</option>)}</select></label>
          <label>Preferred language<select value={languageForm.preferredLanguage} onChange={event=>setLanguageForm(form=>({...form,preferredLanguage:event.target.value}))}><option value="en">English</option><option value="es">Spanish</option></select></label>
          <label>Instructions language<select value={languageForm.instructionsLanguage} onChange={event=>setLanguageForm(form=>({...form,instructionsLanguage:event.target.value}))}><option value="en">English</option><option value="es">Spanish</option></select></label>
          <label>Source text<textarea rows={4} readOnly={!!languageForm.planId} value={languageForm.sourceText} onChange={event=>setLanguageForm(form=>({...form,sourceText:event.target.value}))} required/></label>
          <label>Translated text<textarea rows={4} value={languageForm.translatedText} onChange={event=>setLanguageForm(form=>({...form,translatedText:event.target.value}))}/></label>
          <label>Translation status<select value={languageForm.translationStatus} onChange={event=>setLanguageForm(form=>({...form,translationStatus:event.target.value}))}>{translationStatuses.map(option=><option key={option} value={option}>{option}</option>)}</select></label>
          <label>Translation reviewer<input value={languageForm.translationReviewer} onChange={event=>setLanguageForm(form=>({...form,translationReviewer:event.target.value}))}/></label>
          <label>Accessibility preferences (comma separated)<input value={languageForm.accessibilityPreferences} onChange={event=>setLanguageForm(form=>({...form,accessibilityPreferences:event.target.value}))}/></label>
          <label>Teach-back<textarea rows={3} value={languageForm.teachBack} onChange={event=>setLanguageForm(form=>({...form,teachBack:event.target.value}))} required/></label>
          <label>Caregiver role<input value={languageForm.caregiverRole} onChange={event=>setLanguageForm(form=>({...form,caregiverRole:event.target.value}))}/></label>
          <label>Interpreter role<input value={languageForm.interpreterRole} onChange={event=>setLanguageForm(form=>({...form,interpreterRole:event.target.value}))}/></label>
          <label><input type="checkbox" checked={languageForm.sharedDevice} onChange={event=>setLanguageForm(form=>({...form,sharedDevice:event.target.checked}))}/> Shared device</label>
          <label>Reported proxy status · documentation only<select value={languageForm.proxyStatus} onChange={event=>setLanguageForm(form=>({...form,proxyStatus:event.target.value}))}><option value="none">No proxy reported</option><option value="active">Reported active</option><option value="revoked">Reported revoked</option></select></label>
          <p className="muted">This records what was reported. Saving it does not grant or revoke access. <a className="text-link" href={'/patients/'+encodeURIComponent(activePatientId)+'?workflow=integration-access'}>Manage caregiver access in the connection walkthrough</a>.</p>
          <p className="muted">Authentication: {language?.verifiedPatientAuth?'verified by the sign-in service':'not verified'}. Recording language or proxy preferences does not authenticate a patient.</p>
          <div className="form-actions"><Button type="submit" disabled={busy}>{busy?'Saving…':'Save language/access'}</Button></div>
        </fieldset>
      </form>
      {language&&<RecordMeta record={language}/>}
    </Panel>
    </div></details>
    <details className="clinical-workflow-step" open={requestedJourney==='J15'||editorNeedsAttention(pathwayEditor)}><summary data-journey="J15"><span>Operational pathway<small>Assigned activities, dependencies, and exceptions</small></span><b>{pathwayRecords.length} records</b></summary><div className="clinical-step-body">
    <Panel title="Operational pathway" subtitle="Track assigned protocol activities, prerequisites, owners and documented exceptions.">
      <RecordSelector label="Pathway record" records={pathwayRecords} editor={pathwayEditor} busy={busy}/>
      <p className="muted">{pathwayForm.protocolAssignmentId?`Assigned protocol · version ${pathwayForm.pathwayVersion}`:"Local operational checklist. Choose an assigned protocol to follow its approved activities."}</p>
      <form className="entry-form" onSubmit={(event:FormEvent)=>{event.preventDefault();void submit({type:'patient-coordination.pathway.save',id:pathwayForm.id,expectedVersion:pathwayForm.expectedVersion,patientId:activePatientId,encounterId:pathwayForm.encounterId,requestId:pathwayForm.requestId,protocolAssignmentId:pathwayForm.protocolAssignmentId||undefined,protocolAssignmentVersion:pathwayForm.protocolAssignmentVersion,eventType:pathwayForm.eventType||undefined,reviewChoice:pathwayForm.reviewChoiceId?{choiceId:pathwayForm.reviewChoiceId,value:pathwayForm.reviewChoiceValue}:undefined,pathwayKey:pathwayForm.pathwayKey,pathwayVersion:pathwayForm.pathwayVersion,currentVersion:pathwayForm.currentVersion,stages:pathwayForm.stages.map(stage=>({...stage,reason:stage.reason||undefined})),eventId:pathwayForm.eventId,transitionReason:pathwayForm.transitionReason||'Updated local pathway stage'});}}>
        <fieldset disabled={busy}>
          <label>Encounter ID<input readOnly={!!pathwayForm.id} value={pathwayForm.encounterId} onChange={event=>setPathwayForm(form=>({...form,encounterId:event.target.value}))} required/></label>
          {assignments.length>0&&<label>Assigned protocol<select disabled={!!pathwayForm.id} value={pathwayForm.protocolAssignmentId} onChange={event=>{if(!event.target.value){const local=localChecklistDraft.current??pathwayDraft(activePatientId);setPathwayForm({...local,encounterId:local.encounterId||pathwayForm.encounterId,protocolAssignmentId:'',protocolAssignmentVersion:undefined,eventType:'',reviewChoiceId:'',reviewChoiceValue:''});return;}const assignment=assignments.find(item=>item.id===event.target.value);if(!assignment)return;if(!pathwayForm.protocolAssignmentId)localChecklistDraft.current=structuredClone(pathwayForm);setPathwayForm(form=>({...form,protocolAssignmentId:assignment.id,protocolAssignmentVersion:assignment.version,encounterId:assignment.encounterId??form.encounterId,pathwayKey:assignment.protocolId,pathwayVersion:String(assignment.protocolVersion),stages:assignment.protocolSnapshot?.steps.map(step=>({id:step.id,title:step.title,activity:step.openQuestion||step.title,prerequisites:[...step.prerequisites],status:'pending',owner:step.owner,dueDate:''}))??form.stages}));}}><option value="">Local operational checklist</option>{assignments.map(assignment=><option key={assignment.id} value={assignment.id}>{assignment.protocolId} · version {assignment.protocolVersion}</option>)}</select></label>}
          <label>Pathway key<input readOnly={!!pathwayForm.id||!!pathwayForm.protocolAssignmentId} value={pathwayForm.pathwayKey} onChange={event=>setPathwayForm(form=>({...form,pathwayKey:event.target.value}))} required/></label>
          <label>Pathway version<input readOnly={!!pathwayForm.protocolAssignmentId} value={pathwayForm.pathwayVersion} onChange={event=>setPathwayForm(form=>({...form,pathwayVersion:event.target.value}))} required/></label>
          <label><input type="checkbox" checked={pathwayForm.currentVersion} onChange={event=>setPathwayForm(form=>({...form,currentVersion:event.target.checked}))}/> Current operational version</label>
          <div className="coordination-stages">
            {pathwayForm.stages.map((stage,index)=>{
              const savedStage=pathway?.stages.find(saved=>saved.id===stage.id);
              const locked=savedStage?.status==='completed';
              function update(changes:Partial<PathwayStage>){setPathwayForm(form=>({...form,stages:form.stages.map((current,stageIndex)=>stageIndex===index?{...current,...changes}:current)}));}
              return <fieldset key={index} className="coordination-stage" disabled={locked}>
                <legend>Stage {index+1}{locked?' · completed evidence':''}</legend>
                <label>Stage ID<input value={stage.id} readOnly={!!savedStage||!!pathwayForm.protocolAssignmentId} onChange={event=>update({id:event.target.value})} required/></label>
                <label>Stage title<input readOnly={!!pathwayForm.protocolAssignmentId} value={stage.title} onChange={event=>update({title:event.target.value})} required/></label>
                <label>Stage activity<textarea rows={2} value={stage.activity} onChange={event=>update({activity:event.target.value})} required/></label>
                <fieldset className="coordination-choices" disabled={!!pathwayForm.protocolAssignmentId}><legend>Prerequisite stages</legend>{pathwayForm.stages.filter(candidate=>candidate.id!==stage.id&&candidate.id).map(candidate=><label key={candidate.id}><input type="checkbox" checked={stage.prerequisites.includes(candidate.id)} onChange={event=>update({prerequisites:event.target.checked?[...stage.prerequisites,candidate.id]:stage.prerequisites.filter(id=>id!==candidate.id)})}/>{candidate.title||candidate.id}</label>)}{pathwayForm.stages.length===1&&<p className="muted">Add another stage to define prerequisites.</p>}</fieldset>
                <label>Stage status<select value={stage.status} onChange={event=>update({status:event.target.value as PathwayStage['status']})}>{stageStatuses.map(option=><option key={option} value={option}>{option}</option>)}</select></label>
                <label>Stage owner<input value={stage.owner} onChange={event=>update({owner:event.target.value})} required/></label>
                <label>Stage due date<input type="date" value={stage.dueDate} onChange={event=>update({dueDate:event.target.value})}/></label>
                <label>Stage reason<textarea rows={2} value={stage.reason??''} onChange={event=>update({reason:event.target.value})} required={['failed-automation','deferred','declined'].includes(stage.status)}/></label>
                {!savedStage&&!pathwayForm.protocolAssignmentId&&pathwayForm.stages.length>1&&<Button type="button" variant="outline" onClick={()=>setPathwayForm(form=>({...form,stages:form.stages.filter((_,stageIndex)=>stageIndex!==index).map(current=>({...current,prerequisites:current.prerequisites.filter(id=>id!==stage.id)}))}))}>Remove unsaved stage</Button>}
              </fieldset>;
            })}
          </div>
          <Button type="button" variant="outline" disabled={!!pathwayForm.protocolAssignmentId||pathwayForm.stages.length>=40} onClick={()=>setPathwayForm(form=>({...form,stages:[...form.stages,{id:`stage-${crypto.randomUUID().slice(0,8)}`,title:'',activity:'',prerequisites:[],status:'pending',owner:'Care coordination',dueDate:''}]}))}>Add stage</Button>
          {qualifyingEvents.length>0&&<label>Completed activity<select value={pathwayForm.eventType} onChange={event=>setPathwayForm(form=>({...form,eventType:event.target.value}))}><option value="">Select the recorded activity</option>{qualifyingEvents.map(eventType=><option key={eventType} value={eventType}>{eventType}</option>)}</select></label>}
          {reviewChoices.length>0&&<label>Review decision<select value={JSON.stringify([pathwayForm.reviewChoiceId,pathwayForm.reviewChoiceValue])} onChange={event=>{const [choiceId,value]=JSON.parse(event.target.value) as string[];setPathwayForm(form=>({...form,reviewChoiceId:choiceId,reviewChoiceValue:value}));}}><option value={JSON.stringify(['',''])}>Select the documented decision</option>{reviewChoices.map((choice,index)=><option key={index} value={JSON.stringify([choice.choiceId,choice.equals])}>{choice.choiceId}: {choice.equals}</option>)}</select></label>}
          <label>Transition reason<textarea rows={2} value={pathwayForm.transitionReason} onChange={event=>setPathwayForm(form=>({...form,transitionReason:event.target.value}))} required/></label>
          <div className="form-actions"><Button type="submit" disabled={busy}>{busy?'Saving…':'Save pathway'}</Button></div>
        </fieldset>
      </form>
      {pathway&&<RecordMeta record={pathway}><p className="muted">Recorded activity updates: {pathway.processedEvents.length}</p></RecordMeta>}
    </Panel>
    </div></details>
    <details className="clinical-workflow-step" open={requestedJourney==='J16'||editorNeedsAttention(scheduleEditor)}><summary data-journey="J16"><span>Scheduling and outreach<small>Follow-up windows, appointments, and contact attempts</small></span><b>{scheduleRecords.length} records</b></summary><div className="clinical-step-body">
    <Panel title="Scheduling and outreach" subtitle="Keep the due window distinct from the appointment, require booking evidence, and track unreachable or opt-out states explicitly.">
      <RecordSelector label="Scheduling record" records={scheduleRecords} editor={scheduleEditor} busy={busy}/>
      <form className="entry-form" onSubmit={(event:FormEvent)=>{event.preventDefault();void submit({type:'patient-coordination.schedule.save',id:scheduleForm.id,expectedVersion:scheduleForm.expectedVersion,patientId:activePatientId,encounterId:scheduleForm.encounterId,requestId:scheduleForm.requestId,phase:scheduleForm.phase as typeof schedulePhases[number],dueWindowStart:scheduleForm.dueWindowStart,dueWindowEnd:scheduleForm.dueWindowEnd,dueWindowTimezone:scheduleForm.dueWindowTimezone,owner:scheduleForm.owner,preferredChannel:scheduleForm.preferredChannel as typeof reminderOptions[number],optedOut:scheduleForm.optedOut,appointmentStartsAt:scheduleForm.appointmentStartsAt||undefined,appointmentTimezone:scheduleForm.appointmentTimezone||undefined,bookingEvidenceSource:scheduleForm.bookingEvidenceSource as 'none'|'manual'|'provider-reported',bookingEvidenceRef:scheduleForm.bookingEvidenceRef||undefined,outreachStatus:scheduleForm.outreachStatus as typeof outreachStatuses[number],outreachNote:scheduleForm.outreachNote||undefined,nextAttemptAt:scheduleForm.nextAttemptAt||undefined,cancellationReason:scheduleForm.cancellationReason||undefined,transitionReason:scheduleForm.transitionReason||'Updated scheduling workflow'});}}>
        <fieldset disabled={busy}>
          <label>Encounter ID<input readOnly={!!scheduleForm.id} value={scheduleForm.encounterId} onChange={event=>setScheduleForm(form=>({...form,encounterId:event.target.value}))} required/></label>
          <label>Phase<select value={scheduleForm.phase} onChange={event=>setScheduleForm(form=>({...form,phase:event.target.value,...(['no-show','reschedule-outreach'].includes(event.target.value)?{outreachStatus:'retry-scheduled'}:{}),...(event.target.value==='reschedule-outreach'?{appointmentStartsAt:'',appointmentTimezone:'',bookingEvidenceSource:'none',bookingEvidenceRef:''}:{})}))}>{schedulePhases.map(option=><option key={option} value={option}>{option}</option>)}</select></label>
          <label>Due window start<input type="date" value={scheduleForm.dueWindowStart} onChange={event=>setScheduleForm(form=>({...form,dueWindowStart:event.target.value}))} required/></label>
          <label>Due window end<input type="date" value={scheduleForm.dueWindowEnd} onChange={event=>setScheduleForm(form=>({...form,dueWindowEnd:event.target.value}))} required/></label>
          <label>Due-window timezone<input value={scheduleForm.dueWindowTimezone} onChange={event=>setScheduleForm(form=>({...form,dueWindowTimezone:event.target.value}))} placeholder="America/Toronto" required/></label>
          <label>Owner<input value={scheduleForm.owner} onChange={event=>setScheduleForm(form=>({...form,owner:event.target.value}))} required/></label>
          <label>Preferred channel<select disabled={scheduleForm.optedOut} value={scheduleForm.preferredChannel} onChange={event=>setScheduleForm(form=>({...form,preferredChannel:event.target.value}))}>{reminderOptions.map(option=><option key={option} value={option}>{option}</option>)}</select></label>
          <label><input type="checkbox" checked={scheduleForm.optedOut} onChange={event=>setScheduleForm(form=>({...form,optedOut:event.target.checked,preferredChannel:event.target.checked?'none':form.preferredChannel}))}/> Patient opted out</label>
          <label>Appointment start (your device timezone)<input type="datetime-local" value={toLocalInput(scheduleForm.appointmentStartsAt)} onChange={event=>setScheduleForm(form=>({...form,appointmentStartsAt:fromLocalInput(event.target.value)}))}/></label>
          <label>Appointment timezone<input value={scheduleForm.appointmentTimezone} onChange={event=>setScheduleForm(form=>({...form,appointmentTimezone:event.target.value}))}/></label>
          <label>Booking evidence source<select value={scheduleForm.bookingEvidenceSource} onChange={event=>setScheduleForm(form=>({...form,bookingEvidenceSource:event.target.value}))}><option value="none">none</option><option value="manual">manual</option><option value="provider-reported">provider-reported</option></select></label>
          <label>Booking evidence reference<input value={scheduleForm.bookingEvidenceRef} onChange={event=>setScheduleForm(form=>({...form,bookingEvidenceRef:event.target.value}))}/></label>
          <label>Outreach status<select value={scheduleForm.outreachStatus} onChange={event=>setScheduleForm(form=>({...form,outreachStatus:event.target.value}))}>{outreachStatuses.map(option=><option key={option} value={option}>{option}</option>)}</select></label>
          <label>Outreach note<textarea rows={2} value={scheduleForm.outreachNote} onChange={event=>setScheduleForm(form=>({...form,outreachNote:event.target.value}))}/></label>
          <label>Next attempt (your device timezone)<input type="datetime-local" value={toLocalInput(scheduleForm.nextAttemptAt)} required={['no-show','reschedule-outreach'].includes(scheduleForm.phase)||['unreachable','retry-scheduled'].includes(scheduleForm.outreachStatus)} onChange={event=>setScheduleForm(form=>({...form,nextAttemptAt:fromLocalInput(event.target.value)}))}/></label>
          <label>Cancellation or no-show reason<textarea rows={2} value={scheduleForm.cancellationReason} onChange={event=>setScheduleForm(form=>({...form,cancellationReason:event.target.value}))}/></label>
          <label>Transition reason<textarea rows={2} value={scheduleForm.transitionReason} onChange={event=>setScheduleForm(form=>({...form,transitionReason:event.target.value}))}/></label>
          <div className="form-actions"><Button type="submit" disabled={busy}>{busy?'Saving…':'Save scheduling record'}</Button></div>
        </fieldset>
      </form>
      {schedule&&<RecordMeta record={schedule}>{(schedule.previousAppointments?.length??0)>0&&<div><strong>Previous appointment evidence</strong><ul>{schedule.previousAppointments!.map((appointment,index)=><li key={index}>{formatDate(appointment.startsAt,true)} · {appointment.timezone} · {appointment.evidenceRef}</li>)}</ul></div>}</RecordMeta>}
    </Panel>
    </div></details>
  </div>;
}

function RecordSelector({label,records,editor,busy}:{label:string;records:DraftRecord[];editor:{selectedId:string;select:(id:string)=>void;stale:boolean;selectionPending:boolean;keepEditing:()=>void;discardAndSwitch:()=>void;reload:()=>void;linkedRecordPending?:boolean;openLinkedRecord?:()=>void};busy:boolean}){
  return <div className="coordination-selector">
    <label>{label}<select value={editor.selectedId} onChange={event=>editor.select(event.target.value)} disabled={busy}><option value="">Create a new record</option>{records.map(record=><option key={record.id} value={record.id}>{record.concern?record.concern.slice(0,90)+' · ':''}{record.encounterId}{record.concern&&record.createdAt?' · '+formatDate(record.createdAt,true):''} · version {record.version} · {record.id.slice(0,8)}</option>)}</select></label>
    {editor.selectionPending&&<div role="alert" className="resolution-note">This record has unsaved changes or a save awaiting confirmation. Your entries are preserved.<Button type="button" variant="outline" onClick={editor.keepEditing} disabled={busy}>Keep editing</Button><Button type="button" variant="outline" onClick={editor.discardAndSwitch} disabled={busy}>Discard draft and switch record</Button></div>}
    {editor.linkedRecordPending&&<div role="alert" className="resolution-note">The link points to a different handoff. Your unsaved draft is preserved.<Button type="button" variant="outline" onClick={editor.openLinkedRecord} disabled={busy}>Discard draft and open linked handoff</Button></div>}
    {editor.stale&&<div role="alert" className="resolution-note">A newer version is available. Your draft is preserved. Copy any changes you need before reloading.<Button type="button" variant="outline" onClick={editor.reload} disabled={busy}>Reload latest record</Button></div>}
  </div>;
}

function RecordMeta({record,children}:{record:{id:string;version:number;createdAt:string;updatedAt:string;history:{id:string;at:string;actor:string;from:string;to:string;reason:string;evidenceRef?:string}[]};children?:ReactNode}){
  return <div className="stack"><div className="muted">Saved record {record.id} · version {record.version} · created {formatDate(record.createdAt,true)} · updated {formatDate(record.updatedAt,true)}</div>{children}{record.history.length>0&&<div><strong>History</strong><ul>{record.history.map(entry=><li key={entry.id}>{formatDate(entry.at,true)} · {entry.actor} · {entry.from} → {entry.to} · {entry.reason}{entry.evidenceRef?` · ${entry.evidenceRef}`:''}</li>)}</ul></div>}</div>;
}

function toLocalInput(value?:string){
  if(!value)return '';
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return '';
  const offset=date.getTimezoneOffset();
  return new Date(date.getTime()-offset*60_000).toISOString().slice(0,16);
}
function fromLocalInput(value:string){return value?new Date(value).toISOString():'';}
