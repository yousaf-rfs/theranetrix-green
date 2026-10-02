'use client';

import {useCallback,useEffect,useReducer,useRef,useState,type FormEvent} from 'react';
import styles from './decisions.module.css';
import {decisionEncounterSelection,initialDecisionEncounterSelection,type DecisionEditorStatus} from './decision-encounter-selection';
import {actionSchema,decisionRunSummary,decisionRunOutputId,diffDecisionSources,type DecisionCarePackage,type DecisionObservationSource,type DecisionSourceSnapshot,type Action,type State} from '@/lib/clinical-flows/decisions';

import {defaultEnginePreferences,type EnginePreferences,type EngineRun} from '@/lib/engine-demo';

export type DecisionsClinicalContext={
  savedRuns?:readonly EngineRun[];
  currentEngineRevision?:string;
  sourceSnapshot?:DecisionSourceSnapshot;
  carePackages?:readonly DecisionCarePackage[];
  actor?:string;
  events?:State['observedReviews'][number]['events'];
  currentInputVersion?:string;
  inputVersions?:readonly {patientId:string;encounterId:string;inputVersion:string}[];
  observations?:readonly {patientId:string;encounterId:string;inputVersion:string;collectedAt:string;receivedAt:string;provenance:'observed'|'synthetic'|'model-derived';metrics:Partial<Record<'pain'|'function'|'sleep',number>>;sources?:readonly DecisionObservationSource[]}[];
  engineRuns?:readonly {patientId:string;encounterId:string;inputVersion:string;pstOutputId:string;shadowOutputId:string;summary?:string;pstSummary?:string;shadowSummary?:string;provenance?:'synthetic'|'external'|'unverified';modelVersions?:readonly string[];configurationVersions?:readonly string[]}[];
  plans?:readonly {patientId:string;encounterId?:string;planRef:string;updatedAt:string;summary?:string}[];
};

type Props={patientId?:string;patients:readonly {id:string;name:string}[];state:State;busy:boolean;onAction:(action:Action)=>Promise<boolean>;onRunComparison?:(preferences:EnginePreferences)=>Promise<boolean>;clinicalContext?:DecisionsClinicalContext};
type Patient={id:string;name:string};
type Option=State['comparisonSnapshots'][number]['options'][number];
type Disposition=State['signedSnapshots'][number]['disposition'];
const requestId=(prefix:string)=>`${prefix}-${globalThis.crypto?.randomUUID?.()??Math.random().toString(16).slice(2)}`;
const lines=(value:string)=>value.split('\n').map(line=>line.trim()).filter(Boolean);
const unique=(values:readonly string[])=>[...new Set(values)].sort();
const latest=<T extends {patientId:string;encounterId:string;version:number}>(rows:readonly T[],patientId:string,encounterId:string)=>rows.reduce<T|undefined>((found,row)=>row.patientId===patientId&&row.encounterId===encounterId&&(!found||row.version>found.version)?row:found,undefined);
const metricText=(value:{prior:number|null;current:number|null}|undefined)=>value?`${value.prior??''}/${value.current??''}`:'';
const metricPair=(value:string)=>{
  if(!value.trim())return {prior:null,current:null};
  const match=/^\s*(\d{1,2})?\s*\/\s*(\d{1,2})?\s*$/.exec(value);
  if(!match)throw new Error('Enter metrics as prior/current, for example 7/5 or /5. Leave missing values blank.');
  const number=(raw:string|undefined)=>raw?Number(raw):null;
  const pair={prior:number(match[1]),current:number(match[2])};
  if(Object.values(pair).some(value=>value!==null&&value>10))throw new Error('Metric values must be between 0 and 10.');
  return pair;
};
const evidenceText=(refs:State['comparisonSnapshots'][number]['evidenceRefs'])=>refs.map(ref=>[ref.id,ref.title,ref.locator,ref.version,ref.reviewDate].join('|')).join('\n');
const evidence=(value:string)=>lines(value).map(line=>{
  const parts=line.split('|').map(part=>part.trim());
  if(parts.length!==5)throw new Error('Each evidence row needs ID|title|locator|version|YYYY-MM-DD.');
  const [id,title,locator,version,reviewDate]=parts;
  return {id,title,locator,version,reviewDate};
});
const blankOption=():Option=>({id:requestId('option'),title:'',status:'for-discussion',rationale:'',applicability:'',evidenceRefs:[]});
const provenanceLabel=(value:string)=>value==='synthetic'?'Demonstration record':value==='observed'?'Observed':value==='model-derived'?'Model-derived':value==='external'?'External engine record':'Manually recorded';
const dispositions:Disposition[]=['approve','defer','reject','no-change'];

export function DecisionsPanel(props:Props){
  const patient=props.patientId?props.patients.find(row=>row.id===props.patientId):props.patients[0];
  if(!patient)return <section className={styles.panel}><p>Select a patient to review decisions.</p></section>;
  // Remounting the patient form prevents unsaved text from following a patient switch.
  return <PatientDecisions key={patient.id} {...props} patient={patient}/>;
}

function PatientDecisions(props:Props&{patient:Patient}){
  const rows=[...(props.clinicalContext?.inputVersions??[]),...(props.clinicalContext?.observations??[]),...(props.clinicalContext?.engineRuns??[]),...props.state.inputRevisions,...props.state.drafts];
  const encounterIds=unique(rows.filter(row=>row.patientId===props.patient.id).map(row=>row.encounterId));
  const [selection,selectEncounter]=useReducer(decisionEncounterSelection,encounterIds[0]??'encounter-1',initialDecisionEncounterSelection);
  const {encounterId}=selection;
  const reportEditor=useCallback((status:DecisionEditorStatus)=>selectEncounter({type:'editor',status}),[selectEncounter]);
  const keepEditing=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(selection.requestedId)keepEditing.current?.focus();},[selection.requestedId]);
  const changingBlocked=props.busy||selection.editor.busy;
  return <section className={styles.panel+' clinical-decision-editor'}>
    <h2>Decisions and evidence</h2>
    <p>Patient: <strong>{props.patient.name}</strong> ({props.patient.id})</p>
    <form className={styles.form} onSubmit={event=>{event.preventDefault();if(!changingBlocked)selectEncounter({type:'request'});}}>
      <label>Encounter to open <input list={`decision-encounters-${props.patient.id}`} value={selection.proposedId} onChange={event=>selectEncounter({type:'stage',value:event.target.value})} disabled={changingBlocked} required maxLength={120}/></label>
      <datalist id={`decision-encounters-${props.patient.id}`}>{encounterIds.map(id=><option key={id} value={id}/>)}</datalist>
      <button type="submit" disabled={changingBlocked||!selection.proposedId.trim()||selection.proposedId.trim()===encounterId}>Change encounter</button>
      <p>Editing encounter: <strong>{encounterId}</strong></p>
      {selection.requestedId&&<div role="alert"><p>This encounter has editing changes or a save awaiting confirmation. Save progress for later or finish the retry before switching to {selection.requestedId}.</p><div className={styles.actions}><button ref={keepEditing} type="button" onClick={()=>selectEncounter({type:'cancel'})}>Keep editing</button><button type="button" disabled={changingBlocked} onClick={()=>selectEncounter({type:'discard'})}>Discard editor changes and switch</button></div><p>Previously saved records and working copies are retained.</p></div>}
    </form>
    <EncounterDecisions key={encounterId} {...props} encounterId={encounterId} onEditorStatus={reportEditor}/>
  </section>;
}

function EncounterDecisions({patient,encounterId,state,busy,onAction,onRunComparison,clinicalContext,onEditorStatus}:Props&{patient:Patient;encounterId:string;onEditorStatus:(status:DecisionEditorStatus)=>void}){
  const inScope=(row:{patientId:string;encounterId:string})=>row.patientId===patient.id&&row.encounterId===encounterId;
  const observed=latest(state.observedReviews,patient.id,encounterId);
  const comparison=latest(state.comparisonSnapshots,patient.id,encounterId);
  const outputs=latest(state.engineComparisons,patient.id,encounterId);
  const drafts=state.drafts.filter(inScope);
  const activeDraft=drafts.find(draft=>draft.status!=='signed');
  // null follows a newly saved draft; an empty selection explicitly starts a new one.
  const [selectedDraftId,setSelectedDraftId]=useState<string|null>(activeDraft?.id??null);
  const draft=selectedDraftId===null?activeDraft:drafts.find(row=>row.id===selectedDraftId);
  const [requestedDraftId,setRequestedDraftId]=useState<string|null>(null);
  const signed=state.signedSnapshots.filter(inScope);
  const revision=state.inputRevisions.find(inScope);
  const currentSource=clinicalContext?.inputVersions?.find(inScope)??(clinicalContext?.currentInputVersion?{...{patientId:patient.id,encounterId},inputVersion:clinicalContext.currentInputVersion}:undefined);
  const [inputVersion,setInputVersion]=useState(currentSource?.inputVersion??revision?.inputVersion??'input-v1');
  const currentInputVersion=currentSource?.inputVersion??revision?.inputVersion??inputVersion;
  const changedSource=currentInputVersion!==inputVersion;
  const missingSource=!!clinicalContext?.inputVersions&&!currentSource;
  const sourceObservations=(clinicalContext?.observations??[]).filter(inScope);
  const sourceRuns=(clinicalContext?.engineRuns??[]).filter(inScope);
  const savedRuns=(clinicalContext?.savedRuns??[]).filter(row=>row.patientId===patient.id);
  const [selectedRunId,setSelectedRunId]=useState('');
  const selectedRun=savedRuns.find(row=>row.id===selectedRunId)??savedRuns[0];
  const [enginePreferences,setEnginePreferences]=useState<EnginePreferences>(savedRuns[0]?.preferences??defaultEnginePreferences);
  const workingCopies=(state.workingCopies??[]).filter(row=>inScope(row)&&(!clinicalContext?.actor||row.actor===clinicalContext.actor));
  const [workingId,setWorkingId]=useState(workingCopies[0]?.id??requestId('working-copy'));
  const workingCopy=workingCopies.find(row=>row.id===workingId)??workingCopies[0];
  const [workingVersion,setWorkingVersion]=useState(workingCopy?.version??0);
  const currentSourceSnapshot=clinicalContext?.sourceSnapshot?.patientId===patient.id?{...clinicalContext.sourceSnapshot,encounterId}:undefined;
  const sourceChanges=diffDecisionSources(draft?.sourceSnapshot??workingCopy?.sourceSnapshot,currentSourceSnapshot);
  const sourcePlans=(clinicalContext?.plans??[]).filter(row=>row.patientId===patient.id&&(!row.encounterId||row.encounterId===encounterId));
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [pendingAction,setPendingAction]=useState<Action|null>(null);
  const [exportAudience,setExportAudience]=useState<'internal'|'patient'|'proxy'>('internal');
  const [reviewSources,setReviewSources]=useState<DecisionObservationSource[]>(observed?.sourceObservations??[]);
  const [monitoringOwner,setMonitoringOwner]=useState(observed?.monitoring?.owner??'');
  const [monitoringDueAt,setMonitoringDueAt]=useState(observed?.monitoring?.dueAt??'');
  const [clarificationOwner,setClarificationOwner]=useState(outputs?.clarificationWork?.[0]?.owner??'');
  const [clarificationDueAt,setClarificationDueAt]=useState(outputs?.clarificationWork?.[0]?.dueAt??'');
  const [saving,setSaving]=useState(false);
  const requestPending=useRef(false);
  const locked=busy||saving;
  const [reviewInterpretation,setReviewInterpretation]=useState(observed?.clinicalInterpretation??'');
  const [reviewGoal,setReviewGoal]=useState(observed?.goal??'');
  const [reviewQuestion,setReviewQuestion]=useState(observed?.nextMonitoringQuestion??'');
  const [collectedAt,setCollectedAt]=useState(observed?.collectedAt??'');
  const [receivedAt,setReceivedAt]=useState(observed?.receivedAt??'');
  const [observationProvenance,setObservationProvenance]=useState<'observed'|'synthetic'|'model-derived'>(observed?.provenance??'observed');
  const [contradictions,setContradictions]=useState(observed?.contradictoryMetrics.join('\n')??'');
  const [pain,setPain]=useState(metricText(observed?.metrics.pain));
  const [functionValue,setFunctionValue]=useState(metricText(observed?.metrics.function));
  const [sleep,setSleep]=useState(metricText(observed?.metrics.sleep));
  const [preferenceSummary,setPreferenceSummary]=useState(comparison?.preferenceSummary??'');
  const [weights,setWeights]=useState(comparison?.preferenceWeights??{...defaultEnginePreferences});
  const [options,setOptions]=useState<Option[]>(comparison?.options??[blankOption()]);
  const [comparisonSafety,setComparisonSafety]=useState(comparison?.safetyReview??'');
  const [comparisonDisposition,setComparisonDisposition]=useState<State['comparisonSnapshots'][number]['disposition']>(comparison?.disposition??'defer');
  const [comparisonRationale,setComparisonRationale]=useState(comparison?.rationale??'');
  const [missingInputs,setMissingInputs]=useState(comparison?.missingInputs.join('\n')??'');
  const [comparisonEvidence,setComparisonEvidence]=useState(evidenceText(comparison?.evidenceRefs??[]));
  const [pstId,setPstId]=useState(outputs?.pst.outputId??'');
  const [pstSummary,setPstSummary]=useState(outputs?.pst.summary??'');
  const [pstLimitations,setPstLimitations]=useState(outputs?.pst.limitations.join('\n')??'');
  const [shadowId,setShadowId]=useState(outputs?.shadow.outputId??'');
  const [shadowSummary,setShadowSummary]=useState(outputs?.shadow.summary??'');
  const [shadowLimitations,setShadowLimitations]=useState(outputs?.shadow.limitations.join('\n')??'');
  const [agreement,setAgreement]=useState<State['engineComparisons'][number]['agreement']>(outputs?.agreement??'partial');
  const [outputProvenance,setOutputProvenance]=useState<State['engineComparisons'][number]['provenance']>(outputs?.provenance??'unverified');
  const [outputLimitations,setOutputLimitations]=useState(outputs?.limitations.join('\n')??'');
  const [supportingEvidence,setSupportingEvidence]=useState(evidenceText(outputs?.supportingEvidence??[]));
  const [conflictingEvidence,setConflictingEvidence]=useState(evidenceText(outputs?.conflictingEvidence??[]));
  const [clarifications,setClarifications]=useState(outputs?.clarificationRequests.join('\n')??'');
  const [engineDisposition,setEngineDisposition]=useState<State['engineComparisons'][number]['clinicianDisposition']>(outputs?.clinicianDisposition??'defer');
  const [engineExplanation,setEngineExplanation]=useState(outputs?.dispositionExplanation??'');
  const [suitability,setSuitability]=useState<State['engineComparisons'][number]['suitability']>(outputs?.suitability??'not-reviewed');
  const [modelVersions,setModelVersions]=useState(outputs?.modelVersions.join('\n')??'');
  const [configurationVersions,setConfigurationVersions]=useState(outputs?.configurationVersions.join('\n')??'');
  const [draftSummary,setDraftSummary]=useState(draft?.summary??'');
  const [draftNote,setDraftNote]=useState(draft?.payload.note??'');
  const [signDisposition,setSignDisposition]=useState<Disposition>(draft?.payload.pendingDisposition??'defer');
  const [reason,setReason]=useState('');
  const [signRationale,setSignRationale]=useState('');
  const [planRef,setPlanRef]=useState(sourcePlans[0]?.planRef??'');
  const [amendmentId,setAmendmentId]=useState('');
  const [amendmentDisposition,setAmendmentDisposition]=useState<Disposition>('defer');
  const [amendmentRationale,setAmendmentRationale]=useState('');
  const [amendmentPlan,setAmendmentPlan]=useState('');
  const [amendmentReason,setAmendmentReason]=useState('');
  const [reviewConfirmed,setReviewConfirmed]=useState(false);

  async function send(makeAction:()=>unknown,success:string){
    if(requestPending.current||busy)return false;
    requestPending.current=true;setSaving(true);setError('');setMessage('');
    try{
      const parsed=actionSchema.safeParse(makeAction());
      if(!parsed.success){setError(parsed.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; '));return false;}
      const withoutId=(action:Action)=>JSON.stringify(Object.fromEntries(Object.entries(action).filter(([key])=>key!=='requestId')));
      const isWorking=parsed.data.type==='decisions.working.save';
      if(pendingAction&&!isWorking&&withoutId(pendingAction)!==withoutId(parsed.data)){setError('Retry the previous attempt or explicitly discard that retry before saving a different action.');return false;}
      const action=pendingAction&&withoutId(pendingAction)===withoutId(parsed.data)?pendingAction:parsed.data;
      if(!isWorking||!pendingAction)setPendingAction(action);
      const ok=await onAction(action);
      if(ok){if(action.type==='decisions.working.save'){setWorkingId(action.id??workingId);setWorkingVersion((action.expectedVersion??0)+1);setSavedWorkingSignature(JSON.stringify(action.form));}if(!pendingAction||pendingAction.requestId===action.requestId)setPendingAction(null);setMessage(success);setReviewConfirmed(false);}else setError('The save was not confirmed. Retry the same request below; your entries remain available.');
      return ok;
    }catch(cause){setError(cause instanceof Error?cause.message:'Unable to save this change.');return false;}
    finally{requestPending.current=false;setSaving(false);}
  }
  const scope={patientId:patient.id,encounterId};
  const draftPayload=()=>({observedReviewId:observed?.id,comparisonSnapshotId:comparison?.id,engineComparisonId:outputs?.id,pendingDisposition:signDisposition,note:draftNote});
  function saveReview(){return send(()=>({type:'decisions.review.capture',requestId:requestId('review'),...scope,expectedVersion:observed?.version??0,inputVersion,collectedAt,receivedAt,provenance:observationProvenance,metrics:{pain:metricPair(pain),function:metricPair(functionValue),sleep:metricPair(sleep)},contradictoryMetrics:lines(contradictions),clinicalInterpretation:reviewInterpretation,goal:reviewGoal,nextMonitoringQuestion:reviewQuestion,sourceObservations:reviewSources,...(clinicalContext?.events?{events:clinicalContext.events}:{}),...(monitoringOwner||monitoringDueAt?{monitoring:{id:observed?.monitoring?.id??requestId('monitoring'),title:reviewQuestion,owner:monitoringOwner,dueAt:monitoringDueAt}}:{})}),'Patient-state review saved.');}
  function saveComparison(){return send(()=>({type:'decisions.comparison.capture',requestId:requestId('comparison'),...scope,expectedVersion:comparison?.version??0,inputVersion,preferenceSummary,preferenceWeights:weights,options,disposition:comparisonDisposition,rationale:comparisonRationale,safetyReview:comparisonSafety,missingInputs:lines(missingInputs),evidenceRefs:evidence(comparisonEvidence)}),'Options comparison saved.');}
  function saveOutputs(){return send(()=>({type:'decisions.outputs.capture',requestId:requestId('outputs'),...scope,expectedVersion:outputs?.version??0,inputVersion,pst:{outputId:pstId,summary:pstSummary,limitations:lines(pstLimitations)},shadow:{outputId:shadowId,summary:shadowSummary,limitations:lines(shadowLimitations)},agreement,limitations:lines(outputLimitations),supportingEvidence:evidence(supportingEvidence),conflictingEvidence:evidence(conflictingEvidence),clarificationRequests:lines(clarifications),...(clarificationOwner||clarificationDueAt?{clarificationWork:lines(clarifications).map(title=>({id:outputs?.clarificationWork?.find(row=>row.title===title)?.id??requestId('clarification'),title,owner:clarificationOwner,dueAt:clarificationDueAt}))}:{}),clinicianDisposition:engineDisposition,dispositionExplanation:engineExplanation,suitability,provenance:outputProvenance,modelVersions:lines(modelVersions),configurationVersions:lines(configurationVersions)}),'Distinct PST and Shadow outputs saved.');}
  async function saveDraft(event:FormEvent<HTMLFormElement>){event.preventDefault();const ok=await send(()=>({type:'decisions.draft.save',requestId:requestId('draft'),...scope,draftId:draft?.status==='signed'?undefined:draft?.id,expectedVersion:draft?.status==='signed'?undefined:draft?.version,expectedInputVersion:inputVersion,summary:draftSummary,payload:draftPayload()}),'Draft saved with the exact reviewed record versions.');if(ok){setDraftSummary(draftSummary.trim());setDraftNote(draftNote.trim());if(!draft||draft.status==='signed')setSelectedDraftId(null);}}
  async function draftCommand(type:'decisions.summary.dispute'|'decisions.summary.correct'|'decisions.draft.cancel'|'decisions.draft.retry'){
    if(!draft)return;
    const ok=await send(()=>({type,requestId:requestId('draft-status'),...scope,draftId:draft.id,expectedVersion:draft.version,reason,...(type==='decisions.summary.correct'?{expectedInputVersion:inputVersion,summary:draftSummary,payload:draftPayload()}:{})}),'Draft status updated.');
    if(ok&&type==='decisions.summary.correct'){setDraftSummary(draftSummary.trim());setDraftNote(draftNote.trim());}
    return ok;
  }
  const sourceMismatch=[observed,comparison,outputs].some(row=>row&&row.inputVersion!==inputVersion);
  const draftReferencesCurrent=!!draft&&draft.payload.observedReviewId===observed?.id&&draft.payload.comparisonSnapshotId===comparison?.id&&draft.payload.engineComparisonId===outputs?.id&&draft.reviewedVersions.observedReview===observed?.version&&draft.reviewedVersions.comparisonSnapshot===comparison?.version&&draft.reviewedVersions.engineComparison===outputs?.version;
  const unsavedDraft=!!draft&&(draftSummary!==draft.summary||draftNote!==(draft.payload.note??'')||signDisposition!==draft.payload.pendingDisposition);
  const blockedReason=missingSource?'No authoritative source is available for this encounter.':changedSource?'Patient information changed. Review the current source version.':!draft?'Save the reviewed draft before signing.':!['saved','corrected'].includes(draft.status)?'Resolve the draft status before signing.':draft.expectedInputVersion!==inputVersion?'The draft uses an older input version. Re-review and save it.':!observed||!comparison||!outputs?'Save patient review, options comparison, and both engine outputs.':sourceMismatch?'Re-capture every reviewed record against the current input version.':!draftReferencesCurrent?'Reviewed records changed. Save the reviewed draft again.':unsavedDraft?'Save the summary or disposition changes before signing.':'';
  const actualEvidenceVersions=comparison&&outputs?unique([...comparison.evidenceRefs,...outputs.supportingEvidence,...outputs.conflictingEvidence].map(ref=>ref.version)):[];
  function signDecision(){
    if(!draft||blockedReason||!reviewConfirmed)return;
    return send(()=>({type:'decisions.sign.capture',requestId:requestId('sign'),...scope,draftId:draft.id,expectedDraftVersion:draft.version,expectedInputVersion:draft.expectedInputVersion,disposition:signDisposition,rationale:signRationale,patientPlanRef:planRef,evidenceVersions:actualEvidenceVersions,modelVersions:outputs?.modelVersions??[],configurationVersions:outputs?.configurationVersions??[],displayedSummary:draft.summary}),'Immutable signed snapshot saved.');
  }
  function loadDraft(id:string){
    setSelectedDraftId(id);const selected=drafts.find(row=>row.id===id);
    setDraftSummary(selected?.summary??'');setDraftNote(selected?.payload.note??'');setSignDisposition(selected?.payload.pendingDisposition??'defer');setReviewConfirmed(false);setRequestedDraftId(null);
  }
  function chooseDraft(id:string,discard=false){
    if(id===(draft?.id??''))return;
    if(locked||pendingAction){setError('Retry or explicitly discard the pending save before changing drafts.');return;}
    if(id&&!drafts.some(row=>row.id===id)){setError('This saved draft is unavailable in the current patient encounter.');return;}
    const edited=draftSummary!==(draft?.summary??'')||draftNote!==(draft?.payload.note??'')||signDisposition!==(draft?.payload.pendingDisposition??'defer');
    if(edited&&!discard){setRequestedDraftId(id);return;}
    loadDraft(id);
  }
  function importObservation(index:number){
    const row=sourceObservations[index];if(!row)return;
    setReviewSources([...(row.sources??[])]);setCollectedAt(row.collectedAt);setReceivedAt(row.receivedAt);setObservationProvenance(row.provenance);setPain(`/${row.metrics.pain??''}`);setFunctionValue(`/${row.metrics.function??''}`);setSleep(`/${row.metrics.sleep??''}`);setInputVersion(row.inputVersion);setMessage('Observation copied with original timestamps and provenance. Review missing prior measurements before saving.');
  }
  function importRun(index:number){
    const row=sourceRuns[index];if(!row||!row.pstSummary||!row.shadowSummary)return;
    setPstId(row.pstOutputId);setShadowId(row.shadowOutputId);setPstSummary(row.pstSummary);setShadowSummary(row.shadowSummary);setOutputProvenance(row.provenance??'unverified');setModelVersions(row.modelVersions?.join('\n')??'');setConfigurationVersions(row.configurationVersions?.join('\n')??'');setInputVersion(row.inputVersion);
  }

  const workingForm=()=>({inputVersion,reviewInterpretation,reviewGoal,reviewQuestion,collectedAt,receivedAt,observationProvenance,contradictions,pain,functionValue,sleep,preferenceSummary,weights,options,comparisonSafety,comparisonDisposition,comparisonRationale,missingInputs,comparisonEvidence,pstId,pstSummary,pstLimitations,shadowId,shadowSummary,shadowLimitations,agreement,outputProvenance,outputLimitations,supportingEvidence,conflictingEvidence,clarifications,engineDisposition,engineExplanation,suitability,modelVersions,configurationVersions,draftSummary,draftNote,signDisposition,reason,signRationale,planRef,monitoringOwner,monitoringDueAt,clarificationOwner,clarificationDueAt,sourceObservations:reviewSources,selectedDraftId:draft?.id??'',selectedDraftVersion:draft?.version??0,enginePreferences,selectedRunId:selectedRun?.id??'',amendmentId,amendmentDisposition,amendmentRationale,amendmentPlan,amendmentReason});
  const workingSignature=JSON.stringify(workingForm());
  const [savedWorkingSignature,setSavedWorkingSignature]=useState(workingSignature);
  const dirty=workingSignature!==savedWorkingSignature;
  const awaitingSave=!!pendingAction;
  useEffect(()=>onEditorStatus({dirty,pending:awaitingSave,busy:locked}),[dirty,awaitingSave,locked,onEditorStatus]);
  function saveProgress(){return send(()=>({type:'decisions.working.save',requestId:requestId('working'),...scope,inputVersion,id:workingId,expectedVersion:workingVersion,form:workingForm(),...(pendingAction&&pendingAction.type!=='decisions.working.save'?{pendingAction:JSON.stringify(pendingAction)}:{})}),'Working copy saved on the server. You can resume it after reopening this encounter.');}
  function resumeProgress(){
    if(!workingCopy)return;
    if(locked||pendingAction){setError('Retry or explicitly discard the pending save before restoring saved progress.');return;}
    setWorkingId(workingCopy.id);setWorkingVersion(workingCopy.version);
    const form=workingCopy.form;
    const savedDraft=drafts.find(row=>row.id===form.selectedDraftId);
    const restoredDraft=savedDraft&&savedDraft.version===form.selectedDraftVersion?savedDraft:undefined;
    const restoredRun=savedRuns.find(row=>row.id===form.selectedRunId)??savedRuns[0];
    const restoredAmendment=signed.find(row=>row.id===form.amendmentId);
    const selection={selectedDraftId:restoredDraft?.id??'',selectedDraftVersion:restoredDraft?.version??0,selectedRunId:restoredRun?.id??'',enginePreferences:(form.enginePreferences as EnginePreferences|undefined)??restoredRun?.preferences??defaultEnginePreferences,amendmentId:restoredAmendment?.id??'',amendmentDisposition:(form.amendmentDisposition as Disposition|undefined)??'defer',amendmentRationale:(form.amendmentRationale as string|undefined)??'',amendmentPlan:(form.amendmentPlan as string|undefined)??'',amendmentReason:(form.amendmentReason as string|undefined)??''};
    setSelectedDraftId(selection.selectedDraftId);setRequestedDraftId(null);setSelectedRunId(selection.selectedRunId);setEnginePreferences(selection.enginePreferences);
    setAmendmentId(selection.amendmentId);setAmendmentDisposition(selection.amendmentDisposition);setAmendmentRationale(selection.amendmentRationale);setAmendmentPlan(selection.amendmentPlan);setAmendmentReason(selection.amendmentReason);
    setSavedWorkingSignature(JSON.stringify({...workingForm(),...form,...selection}));
    if(form.inputVersion!==undefined)setInputVersion(form.inputVersion as typeof inputVersion);
    if(form.reviewInterpretation!==undefined)setReviewInterpretation(form.reviewInterpretation as typeof reviewInterpretation);
    if(form.reviewGoal!==undefined)setReviewGoal(form.reviewGoal as typeof reviewGoal);
    if(form.reviewQuestion!==undefined)setReviewQuestion(form.reviewQuestion as typeof reviewQuestion);
    if(form.collectedAt!==undefined)setCollectedAt(form.collectedAt as typeof collectedAt);
    if(form.receivedAt!==undefined)setReceivedAt(form.receivedAt as typeof receivedAt);
    if(form.observationProvenance!==undefined)setObservationProvenance(form.observationProvenance as typeof observationProvenance);
    if(form.contradictions!==undefined)setContradictions(form.contradictions as typeof contradictions);
    if(form.pain!==undefined)setPain(form.pain as typeof pain);
    if(form.functionValue!==undefined)setFunctionValue(form.functionValue as typeof functionValue);
    if(form.sleep!==undefined)setSleep(form.sleep as typeof sleep);
    if(form.preferenceSummary!==undefined)setPreferenceSummary(form.preferenceSummary as typeof preferenceSummary);
    if(form.weights!==undefined)setWeights(form.weights as typeof weights);
    if(form.options!==undefined)setOptions(form.options as typeof options);
    if(form.comparisonSafety!==undefined)setComparisonSafety(form.comparisonSafety as typeof comparisonSafety);
    if(form.comparisonDisposition!==undefined)setComparisonDisposition(form.comparisonDisposition as typeof comparisonDisposition);
    if(form.comparisonRationale!==undefined)setComparisonRationale(form.comparisonRationale as typeof comparisonRationale);
    if(form.missingInputs!==undefined)setMissingInputs(form.missingInputs as typeof missingInputs);
    if(form.comparisonEvidence!==undefined)setComparisonEvidence(form.comparisonEvidence as typeof comparisonEvidence);
    if(form.pstId!==undefined)setPstId(form.pstId as typeof pstId);
    if(form.pstSummary!==undefined)setPstSummary(form.pstSummary as typeof pstSummary);
    if(form.pstLimitations!==undefined)setPstLimitations(form.pstLimitations as typeof pstLimitations);
    if(form.shadowId!==undefined)setShadowId(form.shadowId as typeof shadowId);
    if(form.shadowSummary!==undefined)setShadowSummary(form.shadowSummary as typeof shadowSummary);
    if(form.shadowLimitations!==undefined)setShadowLimitations(form.shadowLimitations as typeof shadowLimitations);
    if(form.agreement!==undefined)setAgreement(form.agreement as typeof agreement);
    if(form.outputProvenance!==undefined)setOutputProvenance(form.outputProvenance as typeof outputProvenance);
    if(form.outputLimitations!==undefined)setOutputLimitations(form.outputLimitations as typeof outputLimitations);
    if(form.supportingEvidence!==undefined)setSupportingEvidence(form.supportingEvidence as typeof supportingEvidence);
    if(form.conflictingEvidence!==undefined)setConflictingEvidence(form.conflictingEvidence as typeof conflictingEvidence);
    if(form.clarifications!==undefined)setClarifications(form.clarifications as typeof clarifications);
    if(form.engineDisposition!==undefined)setEngineDisposition(form.engineDisposition as typeof engineDisposition);
    if(form.engineExplanation!==undefined)setEngineExplanation(form.engineExplanation as typeof engineExplanation);
    if(form.suitability!==undefined)setSuitability(form.suitability as typeof suitability);
    if(form.modelVersions!==undefined)setModelVersions(form.modelVersions as typeof modelVersions);
    if(form.configurationVersions!==undefined)setConfigurationVersions(form.configurationVersions as typeof configurationVersions);
    if(form.draftSummary!==undefined)setDraftSummary(form.draftSummary as typeof draftSummary);
    if(form.draftNote!==undefined)setDraftNote(form.draftNote as typeof draftNote);
    if(form.signDisposition!==undefined)setSignDisposition(form.signDisposition as typeof signDisposition);
    if(form.reason!==undefined)setReason(form.reason as typeof reason);
    if(form.signRationale!==undefined)setSignRationale(form.signRationale as typeof signRationale);
    if(form.planRef!==undefined)setPlanRef(form.planRef as typeof planRef);
    if(form.monitoringOwner!==undefined)setMonitoringOwner(form.monitoringOwner as typeof monitoringOwner);
    if(form.monitoringDueAt!==undefined)setMonitoringDueAt(form.monitoringDueAt as typeof monitoringDueAt);
    if(form.clarificationOwner!==undefined)setClarificationOwner(form.clarificationOwner as typeof clarificationOwner);
    if(form.clarificationDueAt!==undefined)setClarificationDueAt(form.clarificationDueAt as typeof clarificationDueAt);
    if(form.sourceObservations)setReviewSources(form.sourceObservations as DecisionObservationSource[]);
    if(workingCopy.pendingAction){const parsed=actionSchema.safeParse(JSON.parse(workingCopy.pendingAction));if(parsed.success)setPendingAction(parsed.data);}else setPendingAction(null);
    const draftNotice=form.selectedDraftId&&!restoredDraft?' The saved draft changed or is unavailable; your text is restored as a new draft to preserve both versions.':form.selectedDraftId===undefined?' This older working copy did not record a draft selection; its text is restored as a new draft.':'';
    setReviewConfirmed(false);setMessage(`Restored working copy saved ${workingCopy.updatedAt}.${draftNotice} Review any source changes before signing.`);
  }
  async function captureSelectedRun(){
    if(!selectedRun)return;
    const ok=await send(()=>({type:'decisions.engine.capture',requestId:requestId('engine-capture'),...scope,inputVersion,runId:selectedRun.id,expectedComparisonVersion:comparison?.version??0,expectedOutputsVersion:outputs?.version??0}),'Saved rankings and preferences captured together.');
    if(!ok)return;
    setEnginePreferences({...selectedRun.preferences});setWeights({...selectedRun.preferences});setPreferenceSummary(`Pain relief ${selectedRun.preferences.relief}; alertness / lower burden ${selectedRun.preferences.alertness}; routine ${selectedRun.preferences.routine}.`);
    setOptions(selectedRun.pstOrder.map(id=>{const row=selectedRun.candidates.find(candidate=>candidate.id===id)!;return {id:row.id,title:row.title,status:'for-discussion',rationale:row.reason,applicability:row.watch,evidenceRefs:[]};}));
    const limitation='Saved demonstration rules; scores do not establish clinical suitability or authorize prescribing.';
    setComparisonSafety(limitation);setMissingInputs(selectedRun.gaps.join('\n'));setComparisonEvidence('');setComparisonDisposition('defer');setComparisonRationale('Saved comparison is ready for independent clinician review.');
    setPstId(decisionRunOutputId(selectedRun.id,'pst'));setShadowId(decisionRunOutputId(selectedRun.id,'shadow'));setPstSummary(decisionRunSummary(selectedRun,'pst'));setShadowSummary(decisionRunSummary(selectedRun,'shadow'));setPstLimitations(limitation);setShadowLimitations(limitation);setAgreement(selectedRun.agreement?'agree':'disagree');setOutputProvenance('synthetic');setOutputLimitations(limitation);setSupportingEvidence('');setConflictingEvidence('');setClarifications('');setEngineDisposition('defer');setEngineExplanation('Review the exact saved rankings, source records and calculation rules.');setSuitability('unsupported');setModelVersions('');setConfigurationVersions(selectedRun.version);
  }

  function updateOption(index:number,patch:Partial<Option>){setOptions(current=>current.map((option,i)=>i===index?{...option,...patch}:option));}
  function startAmendment(snapshot:State['signedSnapshots'][number]){setAmendmentId(snapshot.id);setAmendmentDisposition(snapshot.disposition);setAmendmentRationale(snapshot.rationale);setAmendmentPlan(snapshot.patientPlanRef);setAmendmentReason('');}
  function saveAmendment(){const snapshot=signed.find(row=>row.id===amendmentId);if(!snapshot)return;return send(()=>({type:'decisions.sign.amend',requestId:requestId('amend'),...scope,signedSnapshotId:snapshot.id,expectedVersion:snapshot.version,reason:amendmentReason,disposition:amendmentDisposition,rationale:amendmentRationale,patientPlanRef:amendmentPlan}),'Amendment saved; the original snapshot is unchanged.');}

  return <>
    <p>This workspace records reviewed observations, evidence, and decisions. Agreement between engines is not a confidence score or clinical validation.</p>
    {error&&<p role="alert" className={styles.blocked}>{error}</p>}
    {message&&<p role="status" aria-live="polite">{message}</p>}
    {pendingAction&&<div className={styles.form}><p>A previous save is awaiting confirmation. Its original request ID is retained.</p><button type="button" disabled={locked} onClick={()=>send(()=>pendingAction,'The original request was confirmed.')}>Retry the same request</button><button type="button" disabled={locked} onClick={()=>{setPendingAction(null);setMessage('Retry discarded. Check saved records before making a new change.');}}>Discard this retry</button></div>}
    <div className={styles.form}><h3>Saved editing progress</h3><p>{workingCopy?`Last server save: ${workingCopy.updatedAt} · ${workingCopy.actor} · revision ${workingCopy.version}`:'This form has no saved working copy yet.'}</p><button type="button" disabled={locked} onClick={saveProgress}>Save progress for later</button>{workingCopy&&<button type="button" disabled={locked} onClick={resumeProgress}>Resume saved progress</button>}<p>Edits after the last successful save remain unsaved. Saving progress does not sign or approve a decision.</p></div>
    {!!sourceChanges.length&&<section className={styles.form}><h3>Changed since the saved review</h3>{sourceChanges.map(change=><p key={change.field}><strong>{change.field}</strong>: {change.before} → {change.after}</p>)}</section>}

    <div className={styles.form}>
      <label>Reviewed input version<input value={inputVersion} onChange={event=>setInputVersion(event.target.value)} readOnly={!!currentSource} disabled={locked}/></label>
      {missingSource&&<p className={styles.blocked}>No authoritative patient source is available for this encounter.</p>}
      {changedSource&&<><p role="status" className={styles.blocked}>Current source: {currentInputVersion}. Re-review the observations, options, and outputs before saving.</p><button type="button" disabled={locked} onClick={()=>{setInputVersion(currentInputVersion);setReviewConfirmed(false);}}>Use current version after source review</button></>}
      {!!sourceObservations.length&&<details><summary>Patient encounter observations</summary>{sourceObservations.map((row,index)=><article key={`${row.inputVersion}-${index}`}><p>{provenanceLabel(row.provenance)} · Collected {row.collectedAt} · Received {row.receivedAt}</p><p>Pain {row.metrics.pain??'missing'}, function {row.metrics.function??'missing'}, sleep {row.metrics.sleep??'missing'}</p><button type="button" disabled={locked||row.inputVersion!==currentInputVersion} onClick={()=>importObservation(index)}>Review these observations</button></article>)}</details>}
      {!!sourceRuns.length&&<details><summary>Patient encounter engine records</summary>{sourceRuns.map((row,index)=><article key={`${row.pstOutputId}-${index}`}><p>{row.summary??row.pstSummary}</p><p>Provenance: {provenanceLabel(row.provenance??'unverified')}</p>{row.pstSummary&&row.shadowSummary?<button type="button" disabled={locked||row.inputVersion!==currentInputVersion} onClick={()=>importRun(index)}>Review both stored outputs</button>:<p>Separate PST and Shadow output text is unavailable. Enter each exact output independently below.</p>}</article>)}</details>}
    </div>
    <p id={`decisions-sign-${patient.id}`} role="status" className={'clinical-stage-status '+(blockedReason?styles.blocked:'')}>{blockedReason||'The saved draft and reviewed records match.'}</p>
    <details className="clinical-workflow-step" open={!observed}><summary data-journey="J05"><span>Patient-state review<small>Observations, patient goal, and monitoring</small></span><b>{observed?'Review saved':'Start here'}</b></summary><div className="clinical-step-body">
    <fieldset className={styles.form} disabled={locked||changedSource||missingSource}>
      <legend>Patient-state review</legend>
      <p>Enter original collection and receipt times as ISO timestamps, including timezone. Missing measurements remain missing.</p>
      <div className={styles.grid}><label>Collected at<input value={collectedAt} onChange={event=>setCollectedAt(event.target.value)} placeholder="2026-09-17T12:00:00Z"/></label><label>Received at<input value={receivedAt} onChange={event=>setReceivedAt(event.target.value)} placeholder="2026-09-17T12:10:00Z"/></label></div>
      <label>Observation provenance<select value={observationProvenance} onChange={event=>setObservationProvenance(event.target.value as typeof observationProvenance)}><option value="observed">Observed</option><option value="synthetic">Demonstration record</option><option value="model-derived">Model-derived</option></select></label>
      <div className={styles.grid}><label>Pain prior/current<input value={pain} onChange={event=>setPain(event.target.value)} placeholder="7/5"/></label><label>Function prior/current<input value={functionValue} onChange={event=>setFunctionValue(event.target.value)} placeholder="4/6"/></label><label>Sleep prior/current<input value={sleep} onChange={event=>setSleep(event.target.value)} placeholder="3/4"/></label></div>
      <label>Contradictory observations, one per line<textarea value={contradictions} onChange={event=>setContradictions(event.target.value)}/></label>
      <label>Clinical interpretation<textarea value={reviewInterpretation} onChange={event=>setReviewInterpretation(event.target.value)}/></label><label>Patient goal<textarea value={reviewGoal} onChange={event=>setReviewGoal(event.target.value)}/></label><label>Next monitoring question<textarea value={reviewQuestion} onChange={event=>setReviewQuestion(event.target.value)}/></label><label>Monitoring owner<input value={monitoringOwner} onChange={event=>setMonitoringOwner(event.target.value)}/></label><label>Monitoring due at<input value={monitoringDueAt} onChange={event=>setMonitoringDueAt(event.target.value)} placeholder="2026-09-24T10:00:00Z"/></label>
      {!!reviewSources.length&&<details><summary>Reviewed observation sources</summary>{reviewSources.map(source=><p key={source.entryId}>{source.metric}: {source.value??source.status} · {source.source} · Collected {source.collectedAt} · Received {source.receivedAt??'Not recorded'} · Confirmed {source.confirmedAt??'Not recorded'} · Source revision {source.recordVersion}{source.correctedFromEntryId?` · corrects ${source.correctedFromEntryId}`:''}</p>)}</details>}{clinicalContext?.events?.map(event=><p key={event.id}>{event.at} · {event.kind} · {event.title} · {event.source}</p>)}
      <button type="button" disabled={!monitoringOwner.trim()||!monitoringDueAt.trim()} onClick={saveReview}>Save reviewed state</button>
      {observed&&<p>Saved revision {observed.version} · {provenanceLabel(observed.provenance)} · {observed.dataFreshness} when reviewed. Pain: {observed.metrics.pain.direction}; function: {observed.metrics.function.direction}; sleep: {observed.metrics.sleep.direction}.</p>}
    </fieldset>
    </div></details>
    <details className="clinical-workflow-step" open={!!observed&&!comparison}><summary data-journey="J06"><span>Options and preferences<small>Compare approaches and document the patient’s priorities</small></span><b>{comparison?'Comparison saved':'Needs review'}</b></summary><div className="clinical-step-body">
    <fieldset className={styles.form} disabled={locked||changedSource||missingSource}>
      <legend>Options and patient preferences</legend>
      <p>Options are for review and discussion. Saving this comparison does not issue a prescription.</p>
      {onRunComparison&&<div className={styles.form+' clinical-comparison-priorities'}><h4>Calculate a new comparison</h4>{(['relief','alertness','routine'] as const).map(key=><label key={key}>{key==='alertness'?'Alertness / lower burden':key} priority<input type="number" min={0} max={100} value={enginePreferences[key]} onChange={event=>setEnginePreferences(current=>({...current,[key]:Number(event.target.value)}))}/></label>)}<button type="button" onClick={async()=>{if(await onRunComparison(enginePreferences)){setSelectedRunId('');setMessage('New calculated run saved. Review its rankings, then capture it below.');}}}>Run and save comparison</button></div>}
      {!!savedRuns.length&&<div className={styles.form}><label>Saved calculated comparison<select value={selectedRun?.id??''} onChange={event=>setSelectedRunId(event.target.value)}>{savedRuns.map(run=><option key={run.id} value={run.id}>{run.date} · {run.revision===clinicalContext?.currentEngineRevision?'Current inputs':'Historical inputs'}</option>)}</select></label>{selectedRun&&<><p>Saved preferences: relief {selectedRun.preferences.relief}, alertness {selectedRun.preferences.alertness}, routine {selectedRun.preferences.routine}.</p><table><thead><tr><th>Strategy</th><th>PST priority</th><th>Shadow priority</th></tr></thead><tbody>{selectedRun.pstOrder.map(id=>{const candidate=selectedRun.candidates.find(row=>row.id===id);return candidate&&<tr key={id}><td>{candidate.title}</td><td>{candidate.pstScore}</td><td>{candidate.shadowScore}</td></tr>;})}</tbody></table><details><summary>Source records and calculation rules</summary>{selectedRun.sources.map((source,index)=><p key={index}>{source.label}: {source.value} · {source.date||'Date not recorded'}</p>)}{selectedRun.basis.map(rule=><p key={rule}>{rule}</p>)}</details><button type="button" disabled={selectedRun.revision!==clinicalContext?.currentEngineRevision} onClick={captureSelectedRun}>Use this saved comparison and both outputs</button></>}</div>}

      <label>Patient preferences<textarea value={preferenceSummary} onChange={event=>setPreferenceSummary(event.target.value)}/></label>
      <div className={styles.grid}>{(Object.keys(weights) as (keyof typeof weights)[]).map(key=><label key={key}>{key} weight (0–100)<input type="number" min={0} max={100} value={weights[key]} readOnly={!!onRunComparison} aria-label={`Saved ${key} preference weight`} onChange={event=>setWeights(current=>({...current,[key]:Number(event.target.value)}))}/></label>)}</div>
      {options.map((option,index)=><details className="clinical-option-editor" key={option.id}><summary><span>{index+1}. {option.title||'Untitled option'}</span><small>{option.status.replaceAll('-',' ')}</small></summary><fieldset className={styles.form}><legend>Option {index+1}</legend><label>Option title<input value={option.title} onChange={event=>updateOption(index,{title:event.target.value})}/></label><label>Status<select value={option.status} onChange={event=>updateOption(index,{status:event.target.value as Option['status']})}>{['for-discussion','modified','rejected','deferred','alternative'].map(value=><option key={value}>{value}</option>)}</select></label><label>Option rationale<textarea value={option.rationale} onChange={event=>updateOption(index,{rationale:event.target.value})}/></label><label>Patient-specific applicability<textarea value={option.applicability} onChange={event=>updateOption(index,{applicability:event.target.value})}/></label><label>Evidence IDs, one per line<textarea value={option.evidenceRefs.join('\n')} onChange={event=>updateOption(index,{evidenceRefs:lines(event.target.value)})}/></label><button type="button" disabled={options.length===1} onClick={()=>setOptions(current=>current.filter((_,i)=>i!==index))}>Remove option {index+1}</button></fieldset></details>)}
      <button type="button" disabled={options.length>=12} onClick={()=>setOptions(current=>[...current,blankOption()])}>Add comparison option</button>
      <label>Evidence rows: ID|title|locator|version|YYYY-MM-DD<textarea value={comparisonEvidence} onChange={event=>setComparisonEvidence(event.target.value)}/></label>
      <label>Safety review<textarea value={comparisonSafety} onChange={event=>setComparisonSafety(event.target.value)}/></label><label>Missing inputs, one per line<textarea value={missingInputs} onChange={event=>setMissingInputs(event.target.value)}/></label>
      <label>Comparison disposition<select value={comparisonDisposition} onChange={event=>setComparisonDisposition(event.target.value as typeof comparisonDisposition)}>{['select-for-discussion','modify','reject-all','defer','author-alternative','no-change'].map(value=><option key={value}>{value}</option>)}</select></label><label>Disposition rationale<textarea value={comparisonRationale} onChange={event=>setComparisonRationale(event.target.value)}/></label>
      <button type="button" onClick={saveComparison}>Save comparison snapshot</button>
    </fieldset>
    </div></details>
    <details className="clinical-workflow-step" open={!!observed&&!!comparison&&!outputs}><summary data-journey="J07"><span>Engine review<small>Inspect both outputs, evidence, and limitations</small></span><b>{outputs?'Disposition saved':'Needs review'}</b></summary><div className="clinical-step-body">
    <fieldset className={styles.form} disabled={locked||changedSource||missingSource}>
      <legend>PST and Shadow review</legend>
      <p>Record the exact output text and identifiers. No engine prediction is generated by this form. Empty version fields mean the version was not supplied.</p>
      <div className={styles.grid}><div className={styles.form}><label>PST output ID<input value={pstId} onChange={event=>setPstId(event.target.value)}/></label><label>PST exact output<textarea value={pstSummary} onChange={event=>setPstSummary(event.target.value)}/></label><label>PST limitations<textarea value={pstLimitations} onChange={event=>setPstLimitations(event.target.value)}/></label></div><div className={styles.form}><label>Shadow output ID<input value={shadowId} onChange={event=>setShadowId(event.target.value)}/></label><label>Shadow exact output<textarea value={shadowSummary} onChange={event=>setShadowSummary(event.target.value)}/></label><label>Shadow limitations<textarea value={shadowLimitations} onChange={event=>setShadowLimitations(event.target.value)}/></label></div></div>
      <label>Output provenance<select value={outputProvenance} onChange={event=>setOutputProvenance(event.target.value as typeof outputProvenance)}><option value="unverified">Manually entered / unverified</option><option value="synthetic">Demonstration output</option><option value="external">External engine record</option></select></label>
      <div className={styles.grid}><label>Model versions, one per line<textarea value={modelVersions} onChange={event=>setModelVersions(event.target.value)}/></label><label>Configuration versions, one per line<textarea value={configurationVersions} onChange={event=>setConfigurationVersions(event.target.value)}/></label></div>
      <label>Agreement<select value={agreement} onChange={event=>setAgreement(event.target.value as typeof agreement)}>{['agree','disagree','partial'].map(value=><option key={value}>{value}</option>)}</select></label><label>Comparison limitations, one per line<textarea value={outputLimitations} onChange={event=>setOutputLimitations(event.target.value)}/></label>
      <label>Supporting evidence: ID|title|locator|version|YYYY-MM-DD<textarea value={supportingEvidence} onChange={event=>setSupportingEvidence(event.target.value)}/></label><label>Conflicting evidence: ID|title|locator|version|YYYY-MM-DD<textarea value={conflictingEvidence} onChange={event=>setConflictingEvidence(event.target.value)}/></label><label>Clarification requests, one per line<textarea value={clarifications} onChange={event=>setClarifications(event.target.value)}/></label><label>Clarification owner<input value={clarificationOwner} onChange={event=>setClarificationOwner(event.target.value)}/></label><label>Clarification due at<input value={clarificationDueAt} onChange={event=>setClarificationDueAt(event.target.value)} placeholder="2026-09-24T10:00:00Z"/></label>
      <label>Suitability review<select value={suitability} onChange={event=>setSuitability(event.target.value as typeof suitability)}>{['not-reviewed','unsupported','evidence-reviewed'].map(value=><option key={value}>{value}</option>)}</select></label><label>Reviewer disposition<select value={engineDisposition} onChange={event=>setEngineDisposition(event.target.value as typeof engineDisposition)}>{['accept-pst','accept-shadow','request-clarification','defer','reject-both','no-change'].map(value=><option key={value}>{value}</option>)}</select></label><label>Disposition explanation<textarea value={engineExplanation} onChange={event=>setEngineExplanation(event.target.value)}/></label>
      <button type="button" disabled={!!lines(clarifications).length&&(!clarificationOwner.trim()||!clarificationDueAt.trim())} onClick={saveOutputs}>Save PST/Shadow disposition</button>
    </fieldset>
    </div></details>
    <details className="clinical-workflow-step" open={!!requestedDraftId||!!observed&&!!comparison&&!!outputs&&!draft}><summary data-journey="J20"><span>Draft and corrections<small>Prepare the exact summary for review</small></span><b>{draft?draft.status:'No saved draft'}</b></summary><div className="clinical-step-body">
    <form className={styles.form} onSubmit={saveDraft}>
      <h3>Reviewed draft and corrections</h3>
      {!!drafts.length&&<label>Saved draft<select value={draft?.id??''} onChange={event=>chooseDraft(event.target.value)} disabled={locked||!!pendingAction}><option value="">New draft</option>{drafts.map(row=><option key={row.id} value={row.id}>{row.status} · revision {row.version} · {row.summary.slice(0,60)}</option>)}</select></label>}
      {requestedDraftId!==null&&<div role="alert"><p>Changing drafts will replace the edited summary, note and disposition. Save progress for later or keep editing to retain this text.</p><button type="button" onClick={()=>setRequestedDraftId(null)}>Keep editing this draft</button><button type="button" disabled={locked||!!pendingAction} onClick={()=>chooseDraft(requestedDraftId,true)}>Discard draft edits and switch</button></div>}
      <label>Exact summary for sign-off<textarea value={draftSummary} onChange={event=>{setDraftSummary(event.target.value);setReviewConfirmed(false);}} required disabled={locked}/></label><label>Draft note<textarea value={draftNote} onChange={event=>setDraftNote(event.target.value)} disabled={locked}/></label>
      <label>Decision disposition<select value={signDisposition} onChange={event=>{setSignDisposition(event.target.value as Disposition);setReviewConfirmed(false);}} disabled={locked}>{dispositions.map(value=><option key={value}>{value}</option>)}</select></label>
      <button type="submit" disabled={locked||changedSource||missingSource||draft?.status==='cancelled'||draft?.status==='disputed'}>{draft?.status==='signed'?'Save as a new draft':'Save reviewed draft'}</button>
      {draft&&<><p>Draft revision {draft.version} · {draft.status} · source {draft.expectedInputVersion}</p><p>Material changes: {draft.materialChangeDiff.join(', ')}</p><label>Correction or status-change reason<textarea value={reason} onChange={event=>setReason(event.target.value)} disabled={locked}/></label><div className={styles.actions}><button type="button" disabled={locked||!reason.trim()||['signed','cancelled'].includes(draft.status)} onClick={()=>draftCommand('decisions.summary.dispute')}>Dispute summary</button><button type="button" disabled={locked||!reason.trim()||changedSource||missingSource||['signed','cancelled'].includes(draft.status)} onClick={()=>draftCommand('decisions.summary.correct')}>Save corrected summary and sources</button><button type="button" disabled={locked||!reason.trim()||['signed','cancelled'].includes(draft.status)} onClick={()=>draftCommand('decisions.draft.cancel')}>Cancel draft</button><button type="button" disabled={locked||!reason.trim()||draft.status!=='cancelled'} onClick={()=>draftCommand('decisions.draft.retry')}>Retry cancelled draft</button></div><details><summary>Draft audit history</summary>{draft.history.map(entry=><p key={entry.id}>{entry.at} · {entry.actor} · {entry.reason}</p>)}</details></>}
    </form>
    </div></details>
    <details className="clinical-workflow-step" open={!!draft&&draft.status!=='signed'}><summary data-journey="J18"><span>Review and sign<small>Confirm the saved summary, rationale, and patient plan</small></span><b>{blockedReason?'Review required':'Ready for review'}</b></summary><div className="clinical-step-body">
    <fieldset className={styles.form} disabled={locked}>
      <legend>Immutable sign-off</legend>
      {draft&&<><h4>Saved summary to sign</h4><p className={styles.context}>{draft.summary}</p><p>Disposition: {draft.payload.pendingDisposition??'missing'}</p></>}
      {observed&&comparison&&outputs&&<details><summary>Exact reviewed records and version provenance</summary><pre className={styles.context}>{JSON.stringify({observed,comparison,outputs},null,2)}</pre></details>}
      <label>Sign-off rationale<textarea value={signRationale} onChange={event=>setSignRationale(event.target.value)}/></label><label>Patient plan reference<input list={`decision-plans-${patient.id}`} value={planRef} onChange={event=>setPlanRef(event.target.value)}/></label><datalist id={`decision-plans-${patient.id}`}>{sourcePlans.map(row=><option key={row.planRef} value={row.planRef}/>)}</datalist>
      <label className={styles.check}><input type="checkbox" checked={reviewConfirmed} onChange={event=>setReviewConfirmed(event.target.checked)} disabled={!!blockedReason}/>I reviewed the exact saved summary, source records, missing inputs, and limitations.</label>
      <button type="button" aria-describedby={`decisions-sign-${patient.id}`} disabled={!!blockedReason||!reviewConfirmed||!signRationale.trim()||!planRef.trim()} onClick={signDecision}>Save immutable signed snapshot</button>
    </fieldset>
    </div></details>
    <details className="clinical-workflow-step" open={!!amendmentId}><summary><span>Signed decisions and exports<small>Historical snapshots, amendments, and record copies</small></span><b>{signed.length} signed</b></summary><div className="clinical-step-body">
    <section className={styles.form}>
      <h3>Signed snapshots and exports</h3><label>Report audience<select value={exportAudience} onChange={event=>setExportAudience(event.target.value as typeof exportAudience)}><option value="internal">Workspace reviewer — complete historical decision</option><option value="patient">Patient — historical instructions</option><option value="proxy">Authorized proxy — historical instructions</option></select></label>
      {!signed.length?<p>No signed snapshots for this patient encounter.</p>:signed.map(snapshot=><article className={styles.form} key={snapshot.id}><strong>{snapshot.disposition} · {snapshot.patientPlanRef}</strong><p>{snapshot.rationale}</p><small>{snapshot.createdAt} · {snapshot.actor} · revision {snapshot.version}{snapshot.amendmentOf?` · amendment of ${snapshot.amendmentOf}`:''}</small><p>Historical patient instructions: {snapshot.carePackage?.instructions??snapshot.patientPlanSnapshot?.summary??'Not captured'}</p>{snapshot.carePackage?.tasks?.map(task=><p key={task.id}>{task.title} · {task.owner??'Unassigned'} · {task.done?'Completed at signing':'Pending at signing'} · {task.dueAt??'Due date not recorded'}</p>)}{clinicalContext?.carePackages?.some(plan=>plan.patientId===patient.id&&plan.planId!==snapshot.patientPlanRef)&&<p>Other current plan records are available separately; this is the selected historical plan.</p>}<details><summary>View immutable snapshot</summary><pre className={styles.context}>{JSON.stringify(snapshot,null,2)}</pre></details><div className={styles.actions}><button type="button" disabled={locked||signed.some(row=>row.amendmentOf===snapshot.id)} onClick={()=>startAmendment(snapshot)}>Amend this snapshot</button><button type="button" disabled={locked} onClick={()=>send(()=>({type:'decisions.export.capture',requestId:requestId('export'),...scope,signedSnapshotId:snapshot.id,format:'json',audience:exportAudience}),'Authorized JSON export prepared below.')}>Prepare JSON export</button><button type="button" disabled={locked} onClick={()=>send(()=>({type:'decisions.export.capture',requestId:requestId('export'),...scope,signedSnapshotId:snapshot.id,format:'readable',audience:exportAudience}),'Authorized readable export prepared below.')}>Prepare readable export</button></div></article>)}
      {amendmentId&&<fieldset className={styles.form} disabled={locked}><legend>Amend signed snapshot</legend><p>The original reviewed records stay unchanged. Re-review new clinical input in a new draft.</p><label>Reason for amendment<textarea value={amendmentReason} onChange={event=>setAmendmentReason(event.target.value)}/></label><label>Amended disposition<select value={amendmentDisposition} onChange={event=>setAmendmentDisposition(event.target.value as Disposition)}>{dispositions.map(value=><option key={value}>{value}</option>)}</select></label><label>Amended rationale<textarea value={amendmentRationale} onChange={event=>setAmendmentRationale(event.target.value)}/></label><label>Amended plan reference<input value={amendmentPlan} onChange={event=>setAmendmentPlan(event.target.value)}/></label><button type="button" onClick={saveAmendment}>Save amendment</button></fieldset>}
      {state.exports.filter(inScope).map(record=><details key={record.id}><summary>{record.format} export · {record.audience??'internal'} · {record.recipient??record.actor} · {record.exportedAt}</summary><a download={`decision-${record.signedSnapshotId}.${record.format==='json'?'json':'txt'}`} href={`data:${record.format==='json'?'application/json':'text/plain'};charset=utf-8,${encodeURIComponent(record.content)}`}>Download prepared export</a><pre className={styles.context}>{record.content}</pre></details>)}
    </section>
    </div></details>
  </>;
}
