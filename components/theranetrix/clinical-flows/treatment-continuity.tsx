'use client';
import {RecommendationDetails} from '../recommendation-details';

import {useEffect,useMemo,useRef,useState,type FormEvent,type ReactNode} from 'react';
import styles from './treatment-continuity.module.css';
import {
  actionSchema,
  type Action,
  type State,
  type ReconciliationRecord,
  type ExperienceRecord,
  type LifecycleRecord,
  type AccessRecord,
  type TransitionRecord,
  type MultidisciplinaryRecord,
  reconciliationStatuses,
  useStatuses,
  benefitStatuses,
  tolerabilityStatuses,
  reassessmentDecisions,
  lifecycleStages,
  accessBarrierTypes,
  accessStatuses,
  handoverStatuses,
  multidisciplinaryStatuses,
  interventionDecisions,
  validateState,
  getSummary,
  missingRequirements,
  type TreatmentRecord,
} from '@/lib/clinical-flows/treatment-continuity';

export type TreatmentContinuityBridgeData={
  medications?:readonly {id:string;name:string;recordedAt?:string}[];
  clinicalContext?:Readonly<{recordedAt?:string;summary?:string}>;
  integrationStatus?:'unconfigured'|'manual-review';
};

type PatientOption={id:string;name:string};
type PanelProps={
  patientId?:string;
  patients:readonly PatientOption[];
  state:State;
  busy:boolean;
  onAction:(action:Action)=>Promise<boolean>;
  careActions?:readonly {domain:string;id:string;version:number;patientId:string;title:string;owner?:string}[];
  bridge?:Readonly<Record<string,TreatmentContinuityBridgeData|undefined>>;
  clinicalContext?:Readonly<{recordedAt?:string;summary?:string}>;
};

type SaveProps={
  busy:boolean;
  onAction:(action:Action)=>Promise<boolean>;
  careActions?:PanelProps['careActions'];
};

type DetailKind=TreatmentRecord['kind'];
function atPath(value:unknown,path:string):unknown{return path.split('.').reduce<unknown>((current,key)=>current&&typeof current==='object'?(current as Record<string,unknown>)[key]:undefined,value);}
function localTimestamp(value:unknown){if(typeof value!=='string'||!value)return '';const date=new Date(value);return Number.isNaN(date.getTime())?'':new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function DetailInput({name,label,record,options,type='text',required=false}:{name:string;label:string;record?:unknown;options?:string[];type?:string;required?:boolean}){
  const value=atPath(record,name),defaultValue=type==='datetime-local'?localTimestamp(value):typeof value==='string'||typeof value==='number'?String(value):'';
  return <label>{label}{options?<select name={name} defaultValue={defaultValue} required={required}><option value="">Choose…</option>{options.map(option=><option key={option} value={option}>{statusText(option)}</option>)}</select>:<input name={name} type={type} defaultValue={defaultValue} required={required}/>}</label>;
}
function EvidenceInputs({prefix,record,title}:{prefix:string;record?:unknown;title:string}){return <fieldset><legend>{title}</legend><div className={styles.grid}>{[['source','Source'],['author','Source author'],['reference','Document or conversation reference']].map(([name,label])=><DetailInput key={name} name={`${prefix}.${name}`} label={label} record={record} required/>)}<DetailInput name={`${prefix}.collectedAt`} label="Collected at (leave blank if unknown)" type="datetime-local" record={record}/><DetailInput name={`${prefix}.receivedAt`} label="Received at" type="datetime-local" record={record} required/></div></fieldset>;}
function CareActionSelect({name,value,careActions}:{name:string;value?:unknown;careActions?:PanelProps['careActions']}){const ref=value as {domain?:string;id?:string;version?:number}|undefined;return <label>Linked care action<select name={name} defaultValue={ref?JSON.stringify({domain:ref.domain,id:ref.id,version:ref.version}):''}><option value="">Select an action from this patient’s chart</option>{careActions?.map(item=><option key={`${item.domain}:${item.id}`} value={JSON.stringify({domain:item.domain,id:item.id,version:item.version})}>{item.title}{item.owner?' · '+item.owner:''} · version {item.version} · ref {item.id.length>28?item.id.slice(0,12)+'…'+item.id.slice(-10):item.id}</option>)}</select></label>;}
function DetailedFields({kind,record,careActions,interventions=[],pendingWork=[]}:{kind:DetailKind;record?:TreatmentRecord;careActions?:PanelProps['careActions'];interventions?:MultidisciplinaryRecord['interventions'];pendingWork?:string[]}){
  const input=(name:string,label:string,options?:string[],type='text',required=false)=><DetailInput key={name} name={name} label={label} record={record} options={options} type={type} required={required}/>;
  return <details open><summary>Sources, responsibilities and review</summary><p className={styles.subtle}>Record what was observed. Times use your local time zone; blank collection dates remain unknown.</p>{input('encounterId','Encounter reference',undefined,'text',true)}
    {kind==='reconciliation'&&<><EvidenceInputs prefix="provenance.patient" title="Patient report" record={record}/><EvidenceInputs prefix="provenance.external" title="Outside record" record={record}/>{input('provenance.nextAction','Next reconciliation action',undefined,'text',true)}<div className={styles.grid}>{input('provenance.reviewedBy','Reviewing clinician')}{input('provenance.reviewedAt','Clinical review completed at',undefined,'datetime-local')}</div></>}
    {kind==='experience'&&<div className={styles.grid}>{input('responseReview.periodStart','Response period starts (unknown is allowed)',undefined,'date')}{input('responseReview.periodEnd','Response period ends',undefined,'date')}{input('responseReview.reportedAt','Patient reported at',undefined,'datetime-local',true)}{input('responseReview.source','Response source',undefined,'text',true)}{input('responseReview.patientAgreement','Patient agreement',['agreed','declined','not-discussed'],undefined,true)}</div>}
    {kind==='lifecycle'&&<div className={styles.grid}>{input('orderEvidence.orderId','Order reference',undefined,'text',true)}{input('orderEvidence.regimen','Exact recorded regimen',undefined,'text',true)}{input('orderEvidence.regimenVersion','Regimen version',undefined,'number',true)}{input('orderEvidence.prescriber','Prescriber named in the source',undefined,'text',true)}{input('orderEvidence.authority','Authorization source',['manual-attestation','demo-service'],undefined,true)}{input('orderEvidence.authorizationRef','Authorization evidence')}{input('orderEvidence.authorizedAt','Authorized at',undefined,'datetime-local')}{input('orderEvidence.pharmacyReceipt','Pharmacy acknowledgement')}{input('orderEvidence.pharmacyReceivedAt','Pharmacy received at',undefined,'datetime-local')}{input('orderEvidence.dispensingRef','Dispensing evidence')}{input('orderEvidence.dispensedAt','Dispensed at',undefined,'datetime-local')}{input('orderEvidence.clarification','Pharmacy question')}{input('orderEvidence.actualUse','Actual patient use',['unknown','not-obtained','declined','started','stopped'],undefined,true)}{input('orderEvidence.useReportedAt','Use reported at',undefined,'datetime-local',true)}{input('orderEvidence.useSource','Use report source',undefined,'text',true)}{input('orderEvidence.startedAt','Actual start date',undefined,'date')}{input('orderEvidence.stoppedAt','Actual stop date',undefined,'date')}{input('orderEvidence.renewalId','Renewal request reference')}{input('orderEvidence.followUpDaysAfterStart','Review days after actual start (if agreed)',undefined,'number')}</div>}
    {kind==='access'&&<><CareActionSelect name="accessReview.careAction" value={record?.kind==='access'?record.accessReview?.careAction:undefined} careActions={careActions}/><div className={styles.grid}>{input('accessReview.verification','Cost, coverage or availability',['unverified','estimated','pending','confirmed','denied'],undefined,true)}{input('accessReview.source','Verification source',undefined,'text',true)}{input('accessReview.checkedAt','Checked at',undefined,'datetime-local',true)}{input('accessReview.details','What has been verified',undefined,'text',true)}{input('accessReview.alternativeDecision','Clinical alternative review',['none','pending','approved','declined'],undefined,true)}{input('accessReview.reviewer','Reviewing clinician')}{input('accessReview.reviewedAt','Alternative reviewed at',undefined,'datetime-local')}{input('accessReview.patientAgreement','Patient agreement',['agreed','declined','not-discussed'],undefined,true)}{input('accessReview.actualStart','Has the care started?',['unknown','not-started','started','declined'],undefined,true)}{input('accessReview.actualStartAt','Actual start date',undefined,'date')}{input('accessReview.followUpDaysAfterStart','Review days after actual start (if agreed)',undefined,'number')}{input('accessReview.actualStartSource','Start confirmation source',undefined,'text',true)}</div></>}
    {kind==='transition'&&<><EvidenceInputs prefix="handoverEvidence.source" title="Incoming care information" record={record}/><div className={styles.grid}>{input('handoverEvidence.patientAccount','Patient’s current understanding',undefined,'text',true)}{input('handoverEvidence.backupOwner','Backup clinician',undefined,'text',true)}{input('handoverEvidence.timezone','Coverage timezone (for example Europe/Lisbon)',undefined,'text',true)}{input('handoverEvidence.acceptance','Receiving responsibility',['pending','accepted','rejected'],undefined,true)}{input('handoverEvidence.acceptedBy','Accepting clinician')}{input('handoverEvidence.acceptedAt','Accepted at',undefined,'datetime-local')}{input('handoverEvidence.acceptanceEvidence','Acceptance receipt or conversation')}{input('handoverEvidence.teachBack','Patient explained the next step')}{input('handoverEvidence.clarificationOwner','Owner of any remaining clarification')}</div>{pendingWork.filter(Boolean).map((title,index)=>{const transfer=record?.kind==='transition'?record.handoverEvidence?.pendingTransfers.find(item=>item.title===title):undefined;return <fieldset key={title}><legend>Pending: {title}</legend><CareActionSelect name={`transfer.${index}.ref`} value={transfer?.ref} careActions={careActions}/><p>Leave the linked action blank while transfer is pending. Accepted work retains its open task.</p><div className={styles.grid}>{['owner','backupOwner','evidenceRef'].map(name=><DetailInput key={name} name={`transfer.${index}.${name}`} label={name==='owner'?'Receiving owner':name==='backupOwner'?'Receiving backup':'Acceptance evidence'} record={{transfer:{[index]:transfer}}}/>)}<DetailInput name={`transfer.${index}.acceptedAt`} label="Accepted at" type="datetime-local" record={{transfer:{[index]:transfer}}}/></div></fieldset>;})}</>}
    {kind==='multidisciplinary'&&interventions.map((item,index)=>{const review=record?.kind==='multidisciplinary'?record.interventionReviews?.find(entry=>entry.interventionId===item.id):undefined;const source={review:{[index]:review}};return <fieldset key={item.id}><legend>Review: {item.title||`Intervention ${index+1}`}</legend><div className={styles.grid}>{[['rationale','Clinical rationale'],['reviewCriterion','What will be reviewed'],['conflictingAdvice','Conflicting advice'],['reconciliation','Agreed resolution']].map(([name,label])=><DetailInput key={name} name={`review.${index}.${name}`} label={label} record={source} required={['rationale','reviewCriterion'].includes(name)}/>)}{[['startedAt','Actual start'],['stoppedAt','Actual stop'],['reviewDate','Next joint review']].map(([name,label])=><DetailInput key={name} name={`review.${index}.${name}`} label={label} type="date" record={source} required={name==='reviewDate'}/>)}<DetailInput name={`review.${index}.participation`} label="Participation" options={['proposed','attended','not-started','declined']} record={source} required/><DetailInput name={`review.${index}.patientAgreement`} label="Patient agreement" options={['agreed','declined','not-discussed']} record={source} required/></div></fieldset>;})}
  </details>;
}
function readDetails(kind:DetailKind,element:HTMLFormElement,record?:TreatmentRecord,interventions:MultidisciplinaryRecord['interventions']=[],pendingWork:string[]=[]):Record<string,unknown>{
  const form=new FormData(element),value=(name:string)=>String(form.get(name)??'').trim(),optional=(name:string)=>value(name)||undefined;
  const instant=(name:string)=>{const input=value(name);if(!input)return undefined;const date=new Date(input);if(Number.isNaN(date.getTime())||localTimestamp(date.toISOString())!==input.slice(0,16))throw new Error('Use a valid local date and time');return date.toISOString();};
  const evidence=(prefix:string)=>({source:value(prefix+'.source'),author:value(prefix+'.author'),collectedAt:instant(prefix+'.collectedAt')??null,receivedAt:instant(prefix+'.receivedAt'),reference:value(prefix+'.reference')});
  const ref=(name:string)=>{try{return JSON.parse(value(name));}catch{throw new Error('Select a linked care action.');}};
  if(kind==='reconciliation')return {provenance:{patient:evidence('provenance.patient'),external:evidence('provenance.external'),nextAction:value('provenance.nextAction'),reviewedBy:optional('provenance.reviewedBy'),reviewedAt:instant('provenance.reviewedAt')}};
  if(kind==='experience')return {responseReview:{regimenVersion:record?.kind==='experience'?record.responseReview?.regimenVersion??1:1,periodStart:optional('responseReview.periodStart')??null,periodEnd:optional('responseReview.periodEnd')??null,reportedAt:instant('responseReview.reportedAt'),source:value('responseReview.source'),patientAgreement:value('responseReview.patientAgreement')}};
  if(kind==='lifecycle')return {orderEvidence:Object.fromEntries(['orderId','regimen','regimenVersion','prescriber','authority','authorizationRef','authorizedAt','pharmacyReceipt','pharmacyReceivedAt','dispensingRef','dispensedAt','clarification','actualUse','useReportedAt','useSource','startedAt','stoppedAt','renewalId','followUpDaysAfterStart'].map(name=>[name,name==='followUpDaysAfterStart'?(optional('orderEvidence.'+name)?Number(value('orderEvidence.'+name)):undefined):name==='regimenVersion'?Number(value('orderEvidence.'+name)):['authorizedAt','pharmacyReceivedAt','dispensedAt','useReportedAt'].includes(name)?instant('orderEvidence.'+name):optional('orderEvidence.'+name)]))};
  if(kind==='access')return {accessReview:{...Object.fromEntries(['verification','source','details','alternativeDecision','reviewer','patientAgreement','actualStart','actualStartAt','actualStartSource'].map(name=>[name,optional('accessReview.'+name)])),careAction:ref('accessReview.careAction'),followUpDaysAfterStart:optional('accessReview.followUpDaysAfterStart')?Number(value('accessReview.followUpDaysAfterStart')):undefined,checkedAt:instant('accessReview.checkedAt'),reviewedAt:instant('accessReview.reviewedAt')}};
  if(kind==='transition')return {handoverEvidence:{...Object.fromEntries(['patientAccount','backupOwner','acceptance','acceptedBy','acceptanceEvidence','teachBack','clarificationOwner','timezone'].map(name=>[name,optional('handoverEvidence.'+name)])),source:evidence('handoverEvidence.source'),acceptedAt:instant('handoverEvidence.acceptedAt'),pendingTransfers:pendingWork.filter(Boolean).flatMap((title,index)=>value(`transfer.${index}.ref`)?[{title,ref:ref(`transfer.${index}.ref`),disposition:'accepted-transfer',owner:value(`transfer.${index}.owner`),backupOwner:value(`transfer.${index}.backupOwner`),acceptedAt:instant(`transfer.${index}.acceptedAt`),evidenceRef:value(`transfer.${index}.evidenceRef`)}]:[])}};
  return {interventionReviews:interventions.map((item,index)=>({interventionId:item.id,...Object.fromEntries(['rationale','reviewCriterion','startedAt','stoppedAt','participation','patientAgreement','reviewDate','conflictingAdvice','reconciliation'].map(name=>[name,optional(`review.${index}.${name}`)]))}))};
}

function useErrorFocus(error:string){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(error)ref.current?.focus();},[error]);
  return ref;
}

function today(){
  return new Date().toISOString().slice(0,10);
}

function dateValue(value:string|undefined){
  return value||'';
}


function statusText(value:string){
  return value.replace(/-/g,' ');
}

function requestId(prefix:string,patientId:string){
  return `${prefix}-${patientId}-${globalThis.crypto.randomUUID()}`;
}

function formatDate(value?:string){
  if(!value)return 'Not set';
  return value;
}

function HistoryList({history}:{history:readonly {id:string;at:string;actor:string;from:string;to:string;reason:string;evidenceRef?:string}[]}){
  if(!history.length)return <p className={styles.subtle}>No saved history yet.</p>;
  return <ol className={styles.history}>{history.map(entry=><li key={entry.id}><strong>{statusText(entry.to)}</strong><span>{entry.actor} · {entry.at.slice(0,10)}</span><p>{entry.reason}</p>{entry.evidenceRef?<small>Evidence: {entry.evidenceRef}</small>:null}</li>)}</ol>;
}

function Section({journey,title,summary,children,open=false}:{journey?:string;title:string;summary?:ReactNode;children:ReactNode;open?:boolean}){
  return <details className={styles.section} open={open}><summary className={styles.sectionToggle} data-journey={journey}><h3>{title}</h3></summary>{summary?<div className={styles.sectionSummary}>{summary}</div>:null}{children}</details>;
}

function RecordMeta({record}:{record?:TreatmentRecord}){
  if(!record)return <p className={styles.subtle}>No saved record yet.</p>;
  return <><dl className={styles.meta}><div><dt>Status</dt><dd>{statusText(record.currentStatus)}{missingRequirements(record).length>0?' · further review needed':''}</dd></div><div><dt>Owner</dt><dd>{record.owner||'Not set'}</dd></div><div><dt>Due</dt><dd>{formatDate(record.dueDate)}</dd></div><div><dt>Version</dt><dd>{record.version}</dd></div><div><dt>Updated</dt><dd>{record.updatedAt.slice(0,10)}</dd></div><div><dt>Next action</dt><dd>{record.nextActions[0]||'None recorded'}</dd></div></dl><RecommendationDetails title="Treatment continuity review" label="Why this next step?" rationale={['Saved record state: '+statusText(record.currentStatus),...record.nextActions]} sources={[{label:'Continuity record',value:record.id+' · version '+record.version,date:record.updatedAt}]} considerations={missingRequirements(record)} limitations={['Next steps are documented workflow requirements, not a medication recommendation.']}/></>;
}

function SubmitBar({busy,label}:{busy:boolean;label:string}){
  return <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{busy?'Saving…':label}</button></div>;
}

function ErrorBanner({error,errorRef}:{error:string;errorRef:React.RefObject<HTMLDivElement|null>}){
  if(!error)return null;
  return <div ref={errorRef} tabIndex={-1} role="alert" className={styles.error}>{error}</div>;
}

function ReconciliationForm({patientId,record,bridge,clinicalContext,busy,onAction}:SaveProps&{patientId:string;record?:ReconciliationRecord;bridge?:TreatmentContinuityBridgeData;clinicalContext?:{recordedAt?:string;summary?:string}}){
  const [source,setSource]=useState(record?.source||'Existing medication list');
  const [sourceDate,setSourceDate]=useState(record?.sourceDate||today());
  const [status,setStatus]=useState<ReconciliationRecord['status']>(record?.status||'unreviewed');
  const [reviewer,setReviewer]=useState(record?.reviewer||'');
  const [resolution,setResolution]=useState(record?.resolution||'');
  const [conflictDrafts,setConflictDrafts]=useState<ReconciliationRecord['conflicts']>(()=>record?.conflicts.length?structuredClone(record.conflicts):[{field:'Medication name',patientFact:'',externalFact:'',outcome:'unreviewed'}]);
  const [owner,setOwner]=useState(record?.owner||'');
  const [dueDate,setDueDate]=useState(record?.dueDate||'');
  const [reason,setReason]=useState('');
  const [evidenceRef,setEvidenceRef]=useState('');
  const [error,setError]=useState('');
  const errorRef=useErrorFocus(error);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    try{
      const conflicts=status==='confirmed-none'?[]:conflictDrafts.filter(item=>item.patientFact.trim()||item.externalFact.trim()).map(item=>({...item,field:item.field.trim(),patientFact:item.patientFact.trim(),externalFact:item.externalFact.trim()}));
      const action=actionSchema.parse({
        type:'treatment-continuity.record-reconciliation',
        ...readDetails('reconciliation',event.currentTarget,record),
        patientId,
        encounterId:String(new FormData(event.currentTarget).get('encounterId')??record?.encounterId??''),
        id:record?.id,
        expectedVersion:record?.version,
        requestId:requestId('reconciliation',patientId),
        owner,
        dueDate,
        reason:reason.trim(),
        evidenceRef,
        source,
        sourceDate,
        status,
        reviewer,
        resolution,
        conflicts,
        bridge:bridge?{medications:[...(bridge.medications??[])],clinicalContext:clinicalContext??bridge.clinicalContext,integrationStatus:bridge.integrationStatus??'unconfigured'}:undefined,
      });
      if(await onAction(action)){
        setError('');
        setReason('');
        setEvidenceRef('');
      } else {
        setError('Save failed. Your draft has been kept.');
      }
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Unable to save reconciliation.');
    }
  }
  return <form className={styles.form} onSubmit={submit}><fieldset className={styles.fields} disabled={busy}><ErrorBanner error={error} errorRef={errorRef}/><div className={styles.grid}><label>Source<input value={source} onChange={event=>setSource(event.target.value)} required/></label><label>Source date<input type="date" value={sourceDate} onChange={event=>setSourceDate(event.target.value)} required/></label><label>Status<select value={status} onChange={event=>setStatus(event.target.value as ReconciliationRecord['status'])}>{reconciliationStatuses.map(option=><option key={option} value={option}>{statusText(option)}</option>)}</select></label><label>Reviewer<input value={reviewer} onChange={event=>setReviewer(event.target.value)} placeholder="Clinician reviewer"/></label><label>Owner<input value={owner} onChange={event=>setOwner(event.target.value)} placeholder="Current owner"/></label><label>Due date<input type="date" value={dateValue(dueDate)} onChange={event=>setDueDate(event.target.value)}/></label></div><label>Resolution<textarea value={resolution} onChange={event=>setResolution(event.target.value)} rows={3} placeholder="Document the explicit reconciliation outcome."/></label>{status!=='confirmed-none'&&<div>{conflictDrafts.map((conflict,index)=><fieldset key={index} disabled={busy}><legend>Conflicting fact {index+1}</legend><div className={styles.grid}><label>Conflicting field<input value={conflict.field} onChange={event=>setConflictDrafts(items=>items.map((item,i)=>i===index?{...item,field:event.target.value}:item))}/></label><label>Patient fact<input value={conflict.patientFact} onChange={event=>setConflictDrafts(items=>items.map((item,i)=>i===index?{...item,patientFact:event.target.value}:item))}/></label><label>External fact<input value={conflict.externalFact} onChange={event=>setConflictDrafts(items=>items.map((item,i)=>i===index?{...item,externalFact:event.target.value}:item))}/></label><label>Conflict outcome<select value={conflict.outcome} onChange={event=>setConflictDrafts(items=>items.map((item,i)=>i===index?{...item,outcome:event.target.value as 'unreviewed'|'resolved'|'declined'}:item))}><option value="unreviewed">Unreviewed</option><option value="resolved">Resolved</option><option value="declined">Declined</option></select></label></div></fieldset>)}<button type="button" disabled={busy} onClick={()=>setConflictDrafts(items=>[...items,{field:'',patientFact:'',externalFact:'',outcome:'unreviewed'}])}>Add conflicting fact</button></div>}<label>Reason for this update<textarea value={reason} onChange={event=>setReason(event.target.value)} rows={2} required/></label><label>Evidence reference<textarea value={evidenceRef} onChange={event=>setEvidenceRef(event.target.value)} rows={2} placeholder="Example: outside fill list scanned 2026-09-17"/></label><DetailedFields kind="reconciliation" record={record}/><SubmitBar busy={busy} label="Save reconciliation"/></fieldset></form>;
}

function ExperienceForm({patientId,record,busy,onAction}:SaveProps&{patientId:string;record?:ExperienceRecord}){
  const [medicationName,setMedicationName]=useState(record?.medicationName||'');
  const [reportedUse,setReportedUse]=useState<ExperienceRecord['reportedUse']>(record?.reportedUse||'unknown');
  const [regimen,setRegimen]=useState(record?.regimen||'');
  const [regimenStartedAt,setRegimenStartedAt]=useState(record?.regimenStartedAt||'');
  const [regimenDurationDays,setRegimenDurationDays]=useState(record?.regimenDurationDays===null?'':String(record?.regimenDurationDays??''));
  const [reportedBenefit,setReportedBenefit]=useState<ExperienceRecord['reportedBenefit']>(record?.reportedBenefit||'unknown');
  const [tolerability,setTolerability]=useState<ExperienceRecord['tolerability']>(record?.tolerability||'unknown');
  const [functionalGoal,setFunctionalGoal]=useState(record?.functionalGoal||'');
  const [patientConcern,setPatientConcern]=useState(record?.patientConcern||'');
  const [trialStatus,setTrialStatus]=useState<ExperienceRecord['trialStatus']>(record?.trialStatus||'active');
  const [stopDate,setStopDate]=useState(record?.stopDate||'');
  const [stopReason,setStopReason]=useState(record?.stopReason||'');
  const [reassessmentDecision,setReassessmentDecision]=useState<ExperienceRecord['reassessmentDecision']>(record?.reassessmentDecision||'no-change');
  const [alternativePlan,setAlternativePlan]=useState(record?.alternativePlan||'');
  const [owner,setOwner]=useState(record?.owner||'');
  const [dueDate,setDueDate]=useState(record?.dueDate||'');
  const [reason,setReason]=useState('');
  const [evidenceRef,setEvidenceRef]=useState('');
  const [error,setError]=useState('');
  const errorRef=useErrorFocus(error);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    try{
      const trimmedDuration=regimenDurationDays.trim();
      if(trimmedDuration!==''&&!/^\d+$/.test(trimmedDuration)){
        setError('Regimen duration must be a whole number of days or left blank if unknown.');
        return;
      }
      const parsedDuration=trimmedDuration===''?null:Number.parseInt(trimmedDuration,10);
      const details=readDetails('experience',event.currentTarget,record);
      const changed=record&&(record.medicationName!==medicationName||record.regimen!==regimen||record.regimenStartedAt!==(regimenStartedAt||''));
      if(changed)(details.responseReview as {regimenVersion:number}).regimenVersion=(record.responseReview?.regimenVersion??1)+1;
      const action=actionSchema.parse({
        type:'treatment-continuity.record-experience',
        ...details,
        patientId,
        encounterId:String(new FormData(event.currentTarget).get('encounterId')??record?.encounterId??''),
        id:record?.id,
        expectedVersion:record?.version,
        requestId:requestId('experience',patientId),
        owner,
        dueDate,
        reason:reason.trim(),
        evidenceRef,
        medicationName,
        reportedUse,
        regimen,
        regimenStartedAt,
        regimenDurationDays:parsedDuration,
        reportedBenefit,
        tolerability,
        functionalGoal,
        patientConcern,
        trialStatus,
        stopDate,
        stopReason,
        reassessmentDecision,
        alternativePlan,
      });
      if(await onAction(action)){
        setError('');
        setReason('');
        setEvidenceRef('');
      } else {
        setError('Save failed. Your draft has been kept.');
      }
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Unable to save treatment experience.');
    }
  }
  return <form className={styles.form} onSubmit={submit}><fieldset className={styles.fields} disabled={busy}><ErrorBanner error={error} errorRef={errorRef}/><div className={styles.grid}><label>Medication<input value={medicationName} onChange={event=>setMedicationName(event.target.value)} required/></label><label>Reported use<select value={reportedUse} onChange={event=>setReportedUse(event.target.value as ExperienceRecord['reportedUse'])}>{useStatuses.map(option=><option key={option} value={option}>{statusText(option)}</option>)}</select></label><label>Trial status<select value={trialStatus} onChange={event=>setTrialStatus(event.target.value as ExperienceRecord['trialStatus'])}><option value="active">Active</option><option value="stopped">Stopped</option><option value="never-started">Never started</option></select></label><label>Reassessment decision<select value={reassessmentDecision} onChange={event=>setReassessmentDecision(event.target.value as ExperienceRecord['reassessmentDecision'])}>{reassessmentDecisions.map(option=><option key={option} value={option}>{statusText(option)}</option>)}</select></label><label>Owner<input value={owner} onChange={event=>setOwner(event.target.value)}/></label><label>Due date<input type="date" value={dateValue(dueDate)} onChange={event=>setDueDate(event.target.value)}/></label></div><label>Actual regimen<textarea value={regimen} onChange={event=>setRegimen(event.target.value)} rows={2} required/></label><div className={styles.grid}><label>Regimen start<input type="date" value={dateValue(regimenStartedAt)} onChange={event=>setRegimenStartedAt(event.target.value)}/></label><label>Regimen duration days<input type="number" min="0" value={regimenDurationDays} onChange={event=>setRegimenDurationDays(event.target.value)} placeholder="Leave blank if unknown"/></label><label>Reported benefit<select value={reportedBenefit} onChange={event=>setReportedBenefit(event.target.value as ExperienceRecord['reportedBenefit'])}>{benefitStatuses.map(option=><option key={option} value={option}>{statusText(option)}</option>)}</select></label><label>Tolerability<select value={tolerability} onChange={event=>setTolerability(event.target.value as ExperienceRecord['tolerability'])}>{tolerabilityStatuses.map(option=><option key={option} value={option}>{statusText(option)}</option>)}</select></label></div><label>Functional goal<textarea value={functionalGoal} onChange={event=>setFunctionalGoal(event.target.value)} rows={2} required/></label><label>Patient concern<textarea value={patientConcern} onChange={event=>setPatientConcern(event.target.value)} rows={2} placeholder="Keep concerns distinct from benefit and tolerability."/></label>{trialStatus==='stopped'&&<div className={styles.grid}><label>Stop date<input type="date" value={dateValue(stopDate)} onChange={event=>setStopDate(event.target.value)}/></label><label>Stop reason<input value={stopReason} onChange={event=>setStopReason(event.target.value)} /></label></div>}{reassessmentDecision==='clinician-authored-alternative'&&<label>Alternative plan<textarea value={alternativePlan} onChange={event=>setAlternativePlan(event.target.value)} rows={2}/></label>}<label>Reason for this update<textarea value={reason} onChange={event=>setReason(event.target.value)} rows={2} required/></label><label>Evidence reference<textarea value={evidenceRef} onChange={event=>setEvidenceRef(event.target.value)} rows={2} placeholder="Required when the regimen changes."/></label><DetailedFields kind="experience" record={record}/><SubmitBar busy={busy} label="Save treatment experience"/></fieldset></form>;
}

function LifecycleForm({patientId,record,busy,onAction}:SaveProps&{patientId:string;record?:LifecycleRecord}){
  const [medicationName,setMedicationName]=useState(record?.medicationName||'');
  const [stage,setStage]=useState<LifecycleRecord['stage']>(record?.stage||'considered');
  const [manualSource,setManualSource]=useState(record?.manualSource||'');
  const [evidenceRef,setEvidenceRef]=useState('');
  const [safetyPrerequisites,setSafetyPrerequisites]=useState(record?.safetyPrerequisites.join('\n')||'');
  const [reviewPrerequisites,setReviewPrerequisites]=useState(record?.reviewPrerequisites.join('\n')||'');
  const [prescriberResponsibility,setPrescriberResponsibility]=useState(record?.prescriberResponsibility||'');
  const [clinicalServiceAvailable,setClinicalServiceAvailable]=useState(record?.clinicalServiceAvailable??false);
  const [statusNote,setStatusNote]=useState(record?.statusNote||'');
  const [renewalRequested,setRenewalRequested]=useState(record?.renewalRequested??false);
  const [failureReason,setFailureReason]=useState(record?.failureReason||'');
  const [notStartedReason,setNotStartedReason]=useState(record?.notStartedReason||'');
  const [owner,setOwner]=useState(record?.owner||'');
  const [dueDate,setDueDate]=useState(record?.dueDate||'');
  const [reason,setReason]=useState('');
  const [error,setError]=useState('');
  const errorRef=useErrorFocus(error);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    try{
      const action=actionSchema.parse({
        type:'treatment-continuity.update-lifecycle',
        ...readDetails('lifecycle',event.currentTarget,record),
        patientId,
        encounterId:String(new FormData(event.currentTarget).get('encounterId')??record?.encounterId??''),
        id:record?.id,
        expectedVersion:record?.version,
        requestId:requestId('lifecycle',patientId),
        owner,
        dueDate,
        reason:reason.trim(),
        evidenceRef,
        medicationName,
        stage,
        manualSource,
        safetyPrerequisites:safetyPrerequisites.split('\n').map(item=>item.trim()).filter(Boolean),
        reviewPrerequisites:reviewPrerequisites.split('\n').map(item=>item.trim()).filter(Boolean),
        prescriberResponsibility,
        clinicalServiceAvailable,
        statusNote,
        renewalRequested,
        failureReason,
        notStartedReason,
      });
      if(await onAction(action)){
        setError('');
        setReason('');
        setEvidenceRef('');
      } else {
        setError('Save failed. Your draft has been kept.');
      }
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Unable to save lifecycle state.');
    }
  }
  return <form className={styles.form} onSubmit={submit}><fieldset className={styles.fields} disabled={busy}><ErrorBanner error={error} errorRef={errorRef}/><div className={styles.grid}><label>Medication<input value={medicationName} onChange={event=>setMedicationName(event.target.value)} required/></label><label>Lifecycle stage<select value={stage} onChange={event=>setStage(event.target.value as LifecycleRecord['stage'])}>{lifecycleStages.map(option=><option key={option} value={option}>{statusText(option)}</option>)}</select></label><label>Owner<input value={owner} onChange={event=>setOwner(event.target.value)} /></label><label>Due date<input type="date" value={dateValue(dueDate)} onChange={event=>setDueDate(event.target.value)}/></label><label>Prescriber responsibility<input value={prescriberResponsibility} onChange={event=>setPrescriberResponsibility(event.target.value)} required/></label><label className={styles.checkbox}><input type="checkbox" checked={clinicalServiceAvailable} onChange={event=>setClinicalServiceAvailable(event.target.checked)}/>Clinical service available</label></div><label>Manual source for external milestones<textarea value={manualSource} onChange={event=>setManualSource(event.target.value)} rows={2} placeholder="Required for authorization, transmission, dispensing, and started stages."/></label><div className={styles.grid}><label>Safety prerequisites<textarea value={safetyPrerequisites} onChange={event=>setSafetyPrerequisites(event.target.value)} rows={3} placeholder="One per line"/></label><label>Review prerequisites<textarea value={reviewPrerequisites} onChange={event=>setReviewPrerequisites(event.target.value)} rows={3} placeholder="One per line"/></label></div><label>Status note<textarea value={statusNote} onChange={event=>setStatusNote(event.target.value)} rows={2}/></label><div className={styles.grid}><label className={styles.checkbox}><input type="checkbox" checked={renewalRequested} onChange={event=>setRenewalRequested(event.target.checked)}/>Renewal requested</label><label>Failure reason<input value={failureReason} onChange={event=>setFailureReason(event.target.value)} /></label><label>Never-started reason<input value={notStartedReason} onChange={event=>setNotStartedReason(event.target.value)} /></label></div><label>Reason for this update<textarea value={reason} onChange={event=>setReason(event.target.value)} rows={2} required/></label><label>Evidence reference<textarea value={evidenceRef} onChange={event=>setEvidenceRef(event.target.value)} rows={2} placeholder="Manual documentation only; never infer treatment use from dispensing."/></label><DetailedFields kind="lifecycle" record={record}/><SubmitBar busy={busy} label="Save lifecycle stage"/></fieldset></form>;
}

function AccessForm({patientId,record,busy,onAction,careActions}:SaveProps&{patientId:string;record?:AccessRecord}){
  const [barrierType,setBarrierType]=useState<AccessRecord['barrierType']>(record?.barrierType||'cost');
  const [status,setStatus]=useState<AccessRecord['status']>(record?.status||'unresolved');
  const [patientChoice,setPatientChoice]=useState(record?.patientChoice||'');
  const [outreach,setOutreach]=useState(record?.outreach||'');
  const [alternatives,setAlternatives]=useState(record?.alternatives||'');
  const [requiresClinicianReview,setRequiresClinicianReview]=useState(record?.requiresClinicianReview??false);
  const [resolution,setResolution]=useState(record?.resolution||'');
  const [owner,setOwner]=useState(record?.owner||'');
  const [dueDate,setDueDate]=useState(record?.dueDate||today());
  const [reason,setReason]=useState('');
  const [evidenceRef,setEvidenceRef]=useState('');
  const [error,setError]=useState('');
  const errorRef=useErrorFocus(error);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    try{
      const action=actionSchema.parse({
        type:'treatment-continuity.manage-access',
        ...readDetails('access',event.currentTarget,record),
        patientId,
        encounterId:String(new FormData(event.currentTarget).get('encounterId')??record?.encounterId??''),
        id:record?.id,
        expectedVersion:record?.version,
        requestId:requestId('access',patientId),
        owner,
        dueDate,
        reason:reason.trim(),
        evidenceRef,
        barrierType,
        status,
        patientChoice,
        outreach,
        alternatives,
        requiresClinicianReview,
        resolution,
      });
      if(await onAction(action)){
        setError('');
        setReason('');
        setEvidenceRef('');
      } else {
        setError('Save failed. Your draft has been kept.');
      }
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Unable to save access barrier.');
    }
  }
  return <form className={styles.form} onSubmit={submit}><fieldset className={styles.fields} disabled={busy}><ErrorBanner error={error} errorRef={errorRef}/><div className={styles.grid}><label>Barrier type<select value={barrierType} onChange={event=>setBarrierType(event.target.value as AccessRecord['barrierType'])}>{accessBarrierTypes.map(option=><option key={option} value={option}>{statusText(option)}</option>)}</select></label><label>Status<select value={status} onChange={event=>setStatus(event.target.value as AccessRecord['status'])}>{accessStatuses.map(option=><option key={option} value={option}>{statusText(option)}</option>)}</select></label><label>Owner<input value={owner} onChange={event=>setOwner(event.target.value)} required/></label><label>Due date<input type="date" value={dateValue(dueDate)} onChange={event=>setDueDate(event.target.value)} /></label></div><label>Patient choice<textarea value={patientChoice} onChange={event=>setPatientChoice(event.target.value)} rows={2} required/></label><label>Outreach completed<textarea value={outreach} onChange={event=>setOutreach(event.target.value)} rows={2} required/></label><label>Alternatives that still need clinician review<textarea value={alternatives} onChange={event=>setAlternatives(event.target.value)} rows={2}/></label><label className={styles.checkbox}><input type="checkbox" checked={requiresClinicianReview} onChange={event=>setRequiresClinicianReview(event.target.checked)}/>Alternative needs clinician review before it replaces the current plan</label><label>Resolution<textarea value={resolution} onChange={event=>setResolution(event.target.value)} rows={2} placeholder="Required if resolved or declined."/></label><label>Reason for this update<textarea value={reason} onChange={event=>setReason(event.target.value)} rows={2} required/></label><label>Evidence reference<textarea value={evidenceRef} onChange={event=>setEvidenceRef(event.target.value)} rows={2}/></label><DetailedFields kind="access" record={record} careActions={careActions}/><SubmitBar busy={busy} label="Save access follow-up"/></fieldset></form>;
}

function TransitionForm({patientId,record,busy,onAction,careActions}:SaveProps&{patientId:string;record?:TransitionRecord}){
  const [externalCareSource,setExternalCareSource]=useState(record?.externalCareSource||'');
  const [previousInstructions,setPreviousInstructions]=useState(record?.previousInstructions||'');
  const [newInstructions,setNewInstructions]=useState(record?.newInstructions||'');
  const [discrepancies,setDiscrepancies]=useState(record?.discrepancies||'');
  const [pendingWork,setPendingWork]=useState(record?.pendingWork.join('\n')||'');
  const [resolvedPendingWork,setResolvedPendingWork]=useState(record?.resolvedPendingWork.join('\n')||'');
  const [receivingClinician,setReceivingClinician]=useState(record?.receivingClinician||'');
  const [ownershipAccepted,setOwnershipAccepted]=useState(record?.ownershipAccepted??false);
  const [reconciledInstructions,setReconciledInstructions]=useState(record?.reconciledInstructions||'');
  const [patientCommunication,setPatientCommunication]=useState(record?.patientCommunication||'');
  const [handoverStatus,setHandoverStatus]=useState<TransitionRecord['handoverStatus']>(record?.handoverStatus||'draft');
  const [owner,setOwner]=useState(record?.owner||'');
  const [dueDate,setDueDate]=useState(record?.dueDate||today());
  const [reason,setReason]=useState('');
  const [evidenceRef,setEvidenceRef]=useState('');
  const [error,setError]=useState('');
  const errorRef=useErrorFocus(error);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    try{
      const action=actionSchema.parse({
        type:'treatment-continuity.record-transition',
        ...readDetails('transition',event.currentTarget,record,[],pendingWork.split('\n').map(item=>item.trim()).filter(Boolean)),
        patientId,
        encounterId:String(new FormData(event.currentTarget).get('encounterId')??record?.encounterId??''),
        id:record?.id,
        expectedVersion:record?.version,
        requestId:requestId('transition',patientId),
        owner,
        dueDate,
        reason:reason.trim(),
        evidenceRef,
        externalCareSource,
        previousInstructions,
        newInstructions,
        discrepancies,
        pendingWork:pendingWork.split('\n').map(item=>item.trim()).filter(Boolean),
        resolvedPendingWork:resolvedPendingWork.split('\n').map(item=>item.trim()).filter(Boolean),
        receivingClinician,
        ownershipAccepted,
        reconciledInstructions,
        patientCommunication,
        handoverStatus,
      });
      if(await onAction(action)){
        setError('');
        setReason('');
        setEvidenceRef('');
      } else {
        setError('Save failed. Your draft has been kept.');
      }
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Unable to save transition.');
    }
  }
  return <form className={styles.form} onSubmit={submit}><fieldset className={styles.fields} disabled={busy}><ErrorBanner error={error} errorRef={errorRef}/><div className={styles.grid}><label>External care source<input value={externalCareSource} onChange={event=>setExternalCareSource(event.target.value)} required/></label><label>Receiving clinician<input value={receivingClinician} onChange={event=>setReceivingClinician(event.target.value)} required/></label><label>Handover status<select value={handoverStatus} onChange={event=>setHandoverStatus(event.target.value as TransitionRecord['handoverStatus'])}>{handoverStatuses.map(option=><option key={option} value={option}>{statusText(option)}</option>)}</select></label><label>Owner<input value={owner} onChange={event=>setOwner(event.target.value)} /></label><label>Due date<input type="date" value={dateValue(dueDate)} onChange={event=>setDueDate(event.target.value)} /></label><label className={styles.checkbox}><input type="checkbox" checked={ownershipAccepted} onChange={event=>setOwnershipAccepted(event.target.checked)}/>Receiving clinician explicitly accepted ownership</label></div><label>Previous instructions<textarea value={previousInstructions} onChange={event=>setPreviousInstructions(event.target.value)} rows={2} required/></label><label>New instructions<textarea value={newInstructions} onChange={event=>setNewInstructions(event.target.value)} rows={2} required/></label><label>Discrepancies<textarea value={discrepancies} onChange={event=>setDiscrepancies(event.target.value)} rows={2}/></label><div className={styles.grid}><label>Pending work<textarea value={pendingWork} onChange={event=>setPendingWork(event.target.value)} rows={3} placeholder="One item per line"/></label><label>Resolved pending work<textarea value={resolvedPendingWork} onChange={event=>setResolvedPendingWork(event.target.value)} rows={3} placeholder="List items you closed explicitly"/></label></div><label>Reconciled instructions<textarea value={reconciledInstructions} onChange={event=>setReconciledInstructions(event.target.value)} rows={2}/></label><label>Patient communication<textarea value={patientCommunication} onChange={event=>setPatientCommunication(event.target.value)} rows={2}/></label><label>Reason for this update<textarea value={reason} onChange={event=>setReason(event.target.value)} rows={2} required/></label><label>Evidence reference<textarea value={evidenceRef} onChange={event=>setEvidenceRef(event.target.value)} rows={2}/></label><DetailedFields kind="transition" record={record} careActions={careActions} pendingWork={pendingWork.split('\n').map(item=>item.trim()).filter(Boolean)}/><SubmitBar busy={busy} label="Save handover"/></fieldset></form>;
}

function MultidisciplinaryForm({patientId,record,busy,onAction}:SaveProps&{patientId:string;record?:MultidisciplinaryRecord}){
  const [functionalGoal,setFunctionalGoal]=useState(record?.functionalGoal||'');
  const [interventions,setInterventions]=useState<MultidisciplinaryRecord['interventions']>(()=>record?.interventions.length?structuredClone(record.interventions):[{id:requestId('intervention',patientId),title:'',professional:'',status:'planned',accessBarrier:'',patientExperience:'',observedOutcome:'',decision:'continue'}]);
  const [owner,setOwner]=useState(record?.owner||'');
  const [dueDate,setDueDate]=useState(record?.dueDate||today());
  const [reason,setReason]=useState('');
  const [evidenceRef,setEvidenceRef]=useState('');
  const [error,setError]=useState('');
  const errorRef=useErrorFocus(error);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    try{
      const action=actionSchema.parse({
        type:'treatment-continuity.update-multidisciplinary',
        ...readDetails('multidisciplinary',event.currentTarget,record,interventions),
        patientId,
        encounterId:String(new FormData(event.currentTarget).get('encounterId')??record?.encounterId??''),
        id:record?.id,
        expectedVersion:record?.version,
        requestId:requestId('multidisciplinary',patientId),
        owner,
        dueDate,
        reason:reason.trim(),
        evidenceRef,
        functionalGoal,
        interventions,
      });
      if(await onAction(action)){
        setError('');
        setReason('');
        setEvidenceRef('');
      } else {
        setError('Save failed. Your draft has been kept.');
      }
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Unable to save multidisciplinary care.');
    }
  }
  function updateIntervention(index:number,patch:Partial<MultidisciplinaryRecord['interventions'][number]>){setInterventions(items=>items.map((item,i)=>i===index?{...item,...patch}:item));}
  return <form className={styles.form} onSubmit={submit}><fieldset className={styles.fields} disabled={busy}><ErrorBanner error={error} errorRef={errorRef}/><label>Patient functional goal<input value={functionalGoal} onChange={event=>setFunctionalGoal(event.target.value)} required/></label>{interventions.map((intervention,index)=><fieldset key={intervention.id} disabled={busy}><legend>Intervention {index+1}</legend><div className={styles.grid}><label>Intervention<input value={intervention.title} onChange={event=>updateIntervention(index,{title:event.target.value})} required/></label><label>Assigned professional<input value={intervention.professional} onChange={event=>updateIntervention(index,{professional:event.target.value})} required/></label><label>Activity status<select value={intervention.status} onChange={event=>updateIntervention(index,{status:event.target.value as typeof intervention.status})}>{multidisciplinaryStatuses.map(option=><option key={option} value={option}>{statusText(option)}</option>)}</select></label><label>Decision<select value={intervention.decision} onChange={event=>updateIntervention(index,{decision:event.target.value as typeof intervention.decision})}>{interventionDecisions.map(option=><option key={option} value={option}>{statusText(option)}</option>)}</select></label></div><label>Access barrier<textarea value={intervention.accessBarrier||''} onChange={event=>updateIntervention(index,{accessBarrier:event.target.value})} rows={2}/></label><label>Patient experience<textarea value={intervention.patientExperience||''} onChange={event=>updateIntervention(index,{patientExperience:event.target.value})} rows={2}/></label><label>Observed outcomes<textarea value={intervention.observedOutcome||''} onChange={event=>updateIntervention(index,{observedOutcome:event.target.value})} rows={2}/></label></fieldset>)}<button type="button" disabled={busy} onClick={()=>setInterventions(items=>[...items,{id:requestId('intervention',patientId),title:'',professional:'',status:'planned',accessBarrier:'',patientExperience:'',observedOutcome:'',decision:'continue'}])}>Add intervention</button><div className={styles.grid}><label>Owner<input value={owner} onChange={event=>setOwner(event.target.value)}/></label><label>Due date<input type="date" value={dateValue(dueDate)} onChange={event=>setDueDate(event.target.value)}/></label></div><label>Reason for this update<textarea value={reason} onChange={event=>setReason(event.target.value)} rows={2} required/></label><label>Evidence reference<textarea value={evidenceRef} onChange={event=>setEvidenceRef(event.target.value)} rows={2}/></label><DetailedFields kind="multidisciplinary" record={record} interventions={interventions}/><SubmitBar busy={busy} label="Save multidisciplinary care"/></fieldset></form>;
}

function RecordPicker({label,records,value,busy,onChange}:{label:string;records:readonly {id:string;currentStatus:string;createdAt:string;medicationName?:string;source?:string;barrierType?:string;externalCareSource?:string;functionalGoal?:string}[];value:string;busy:boolean;onChange:(value:string)=>void}){
  return <label className={styles.patientPicker}>{label}<select aria-label={label} value={value} disabled={busy} onChange={event=>onChange(event.target.value)}><option value="new">Create a new record</option>{records.map(record=><option key={record.id} value={record.id}>{record.medicationName||record.source||record.barrierType||record.externalCareSource||record.functionalGoal||'Care record'} · {statusText(record.currentStatus)} · {record.createdAt.slice(0,10)}</option>)}</select></label>;
}

export function TreatmentContinuityPanel({patientId,patients,state,busy,onAction,bridge,clinicalContext,careActions}:PanelProps){
  const currentState=useMemo(()=>validateState(state),[state]);
  const [selectedPatientId,setSelectedPatientId]=useState('');
  const [selectedRecords,setSelectedRecords]=useState<Record<string,string>>({});
  const activePatientId=patientId||(patients.some(item=>item.id===selectedPatientId)?selectedPatientId:'')||patients[0]?.id||'';
  function selectedRecord<T extends {id:string;patientId:string}>(records:readonly T[],kind:string){const selected=selectedRecords[`${activePatientId}:${kind}`];return selected==='new'?undefined:records.find(record=>record.patientId===activePatientId&&(!selected||record.id===selected));}
  const patientView={
    patient:patients.find(item=>item.id===activePatientId),
    summary:getSummary(currentState,activePatientId||undefined),
    patientBridge:activePatientId?bridge?.[activePatientId]:undefined,
    reconciliation:activePatientId?selectedRecord(currentState.reconciliations,'reconciliation'):undefined,
    experience:activePatientId?selectedRecord(currentState.experiences,'experience'):undefined,
    lifecycle:activePatientId?selectedRecord(currentState.lifecycles,'lifecycle'):undefined,
    access:activePatientId?selectedRecord(currentState.accessBarriers,'access'):undefined,
    transition:activePatientId?selectedRecord(currentState.transitions,'transition'):undefined,
    multidisciplinary:activePatientId?selectedRecord(currentState.multidisciplinary,'multidisciplinary'):undefined,
  };
  const {patient,summary,patientBridge,reconciliation,experience,lifecycle,access,transition,multidisciplinary}=patientView;
  const focusedJourney=typeof window!=='undefined'?new URLSearchParams(window.location.search).get('workflowJourney')??'':'';
  async function saveAction(action:Action){const saved=await onAction(action);if(saved&&!action.id){const kind={
    'treatment-continuity.record-reconciliation':'reconciliation','treatment-continuity.record-experience':'experience','treatment-continuity.update-lifecycle':'lifecycle','treatment-continuity.manage-access':'access','treatment-continuity.record-transition':'transition','treatment-continuity.update-multidisciplinary':'multidisciplinary',
  }[action.type];setSelectedRecords(items=>({...items,[`${action.patientId}:${kind}`]:action.requestId}));}return saved;}

  if(!activePatientId||!patient){
    return <section className={styles.panel}><h2>Treatment continuity</h2><p>Select a valid patient before documenting these workflows.</p></section>;
  }

  return <section className={styles.panel} aria-labelledby="treatment-continuity-title"><div className={styles.header}><div><p className={styles.eyebrow}>Treatment continuity</p><h2 id="treatment-continuity-title">Treatment, access, handover, and multidisciplinary follow-up for {patient.name}</h2><p className={styles.subtle}>Open items: {summary.open} · Overdue: {summary.overdue}. Manual documentation stays separate from any unconfigured partner integrations.</p></div>{!patientId&&<label className={styles.patientPicker}>Patient<select value={activePatientId} onChange={event=>setSelectedPatientId(event.target.value)} aria-label="Patient selection" disabled={busy}>{patients.map(option=><option key={option.id} value={option.id}>{option.name}</option>)}</select></label>}</div>{patientBridge&&<aside className={styles.notice}><strong>Existing-record bridge</strong><p>Medication bridge entries: {(patientBridge.medications??[]).length}. Clinical context: {patientBridge.clinicalContext?.recordedAt||clinicalContext?.recordedAt||'Not connected'}.</p><p>Integration status: {statusText(patientBridge.integrationStatus||'unconfigured')}.</p></aside>}{summary.attention.length>0&&<section className={styles.section}><h3>Attention</h3><ul className={styles.attention}>{summary.attention.map(item=><li key={item}>{item}</li>)}</ul></section>}<Section journey="J03" title="Reconciliation" open={focusedJourney==='J03'} summary={<RecordMeta record={reconciliation}/>}> <p className={styles.subtle}>Unknown, unreviewed, confirmed none, declined, and resolved stay distinct. Prior versions remain in history.</p><RecordPicker label="Reconciliation record" records={currentState.reconciliations.filter(record=>record.patientId===activePatientId)} value={reconciliation?.id??'new'} busy={busy} onChange={value=>setSelectedRecords(items=>({...items,[`${activePatientId}:reconciliation`]:value}))}/><ReconciliationForm key={`reconciliation:${activePatientId}:${reconciliation?.id??'new'}:${reconciliation?.version??0}`} patientId={activePatientId} record={reconciliation} bridge={patientBridge} clinicalContext={clinicalContext} busy={busy} onAction={saveAction}/><HistoryList history={reconciliation?.history??[]}/></Section><Section journey="J04" title="Treatment experience" open={focusedJourney==='J04'} summary={<RecordMeta record={experience}/>}> <p className={styles.subtle}>Reported use, duration, benefit, tolerability, goal, and concern are documented as separate facts.</p><RecordPicker label="Experience record" records={currentState.experiences.filter(record=>record.patientId===activePatientId)} value={experience?.id??'new'} busy={busy} onChange={value=>setSelectedRecords(items=>({...items,[`${activePatientId}:experience`]:value}))}/><ExperienceForm key={`experience:${activePatientId}:${experience?.id??'new'}:${experience?.version??0}`} patientId={activePatientId} record={experience} busy={busy} onAction={saveAction}/><HistoryList history={experience?.history??[]}/></Section><Section journey="J31" title="Medication lifecycle" open={focusedJourney==='J31'} summary={<RecordMeta record={lifecycle}/>}> <p className={styles.subtle}>External milestones require manual source and evidence. Dispensing never implies the patient started treatment.</p><RecordPicker label="Lifecycle record" records={currentState.lifecycles.filter(record=>record.patientId===activePatientId)} value={lifecycle?.id??'new'} busy={busy} onChange={value=>setSelectedRecords(items=>({...items,[`${activePatientId}:lifecycle`]:value}))}/><LifecycleForm key={`lifecycle:${activePatientId}:${lifecycle?.id??'new'}:${lifecycle?.version??0}`} patientId={activePatientId} record={lifecycle} busy={busy} onAction={saveAction}/><HistoryList history={lifecycle?.history??[]}/></Section><Section journey="J32" title="Access barriers" open={focusedJourney==='J32'} summary={<RecordMeta record={access}/>}> <p className={styles.subtle}>Access issues remain access issues; this panel does not relabel them as pharmacologic failure or nonadherence.</p><RecordPicker label="Access record" records={currentState.accessBarriers.filter(record=>record.patientId===activePatientId)} value={access?.id??'new'} busy={busy} onChange={value=>setSelectedRecords(items=>({...items,[`${activePatientId}:access`]:value}))}/><AccessForm key={`access:${activePatientId}:${access?.id??'new'}:${access?.version??0}`} patientId={activePatientId} record={access} busy={busy} onAction={saveAction} careActions={careActions?.filter(item=>item.patientId===activePatientId)}/><HistoryList history={access?.history??[]}/></Section><Section journey="J33" title="Transition and coverage" open={focusedJourney==='J33'} summary={<RecordMeta record={transition}/>}> <p className={styles.subtle}>Pending work stays visible until it is explicitly resolved and ownership is accepted.</p><RecordPicker label="Transition record" records={currentState.transitions.filter(record=>record.patientId===activePatientId)} value={transition?.id??'new'} busy={busy} onChange={value=>setSelectedRecords(items=>({...items,[`${activePatientId}:transition`]:value}))}/><TransitionForm key={`transition:${activePatientId}:${transition?.id??'new'}:${transition?.version??0}`} patientId={activePatientId} record={transition} busy={busy} onAction={saveAction} careActions={careActions?.filter(item=>item.patientId===activePatientId)}/><HistoryList history={transition?.history??[]}/></Section><Section journey="J34" title="Multidisciplinary care" open={focusedJourney==='J34'} summary={<RecordMeta record={multidisciplinary}/>}> <p className={styles.subtle}>Non-medication care is first-class and requires explicit continue, change, or closure decisions.</p><RecordPicker label="Multidisciplinary record" records={currentState.multidisciplinary.filter(record=>record.patientId===activePatientId)} value={multidisciplinary?.id??'new'} busy={busy} onChange={value=>setSelectedRecords(items=>({...items,[`${activePatientId}:multidisciplinary`]:value}))}/><MultidisciplinaryForm key={`multidisciplinary:${activePatientId}:${multidisciplinary?.id??'new'}:${multidisciplinary?.version??0}`} patientId={activePatientId} record={multidisciplinary} busy={busy} onAction={saveAction}/><HistoryList history={multidisciplinary?.history??[]}/></Section></section>;
}
