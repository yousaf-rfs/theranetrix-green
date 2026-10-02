'use client';
import {RecommendationDetails} from './recommendation-details';
import {useRef,useState,type FormEvent} from 'react';
import type {Action} from '@/lib/actions';
import type {Patient,Workspace} from '@/lib/theranetrix';
import {canonicalCommand} from '@/lib/clinical-flows';
import {coverageAt,openCareWork,type CareOperationsAction,type RemoteVisit,type Monitoring,type IdentityReview} from '@/lib/care-operations';
import styles from './care-operations.module.css';
import {planSources} from '@/lib/clinical-flows/plan-preparation';

type Props={workspace:Workspace;patient:Patient;busy:boolean;onAction:(action:Action)=>Promise<boolean>};
type Kind=CareOperationsAction['command']['kind'];
function localTime(value?:string){if(!value)return '';const date=new Date(value);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function instant(value:string){return new Date(value).toISOString();}
function useFormDraft<D>(sourceKey:string,initial:D){
  const [draft,setDraft]=useState(()=>({sourceKey,value:initial,dirty:false}));
  const changed=draft.sourceKey!==sourceKey;
  if(changed&&!draft.dirty)setDraft({sourceKey,value:initial,dirty:false});
  return {value:changed&&!draft.dirty?initial:draft.value,dirty:draft.dirty,stale:changed&&draft.dirty,
    change:(patch:Partial<D>)=>setDraft(current=>({...current,value:{...current.value,...patch},dirty:true})),
    saved:()=>setDraft(current=>({...current,dirty:false})),
    reload:()=>setDraft({sourceKey,value:initial,dirty:false})};
}
type DraftControl={stale:boolean;reload:()=>void;saved:()=>void};

export function CareOperationsPanel(props:Props){return <CareOperationsEditor key={props.patient.id} {...props}/>;}
function CareOperationsEditor({workspace,patient,busy,onAction}:Props){
  const state=workspace.careOperations,work=openCareWork(workspace,patient.id),coverage=coverageAt(workspace,patient.id,new Date().toISOString());
  const latestCoverage=state?.coverage.find(record=>record.patientId===patient.id);
  const visits=state?.remoteVisits.filter(record=>record.patientId===patient.id)??[];
  const encounterIds=[...new Set([...visits.map(record=>record.encounterId),...(workspace.clinicalWorkflows?.slices.encounters.state.assessments.filter(record=>record.patientId===patient.id).map(record=>record.encounterId)??[])])];
  const [visitChoice,setVisitChoice]=useState(visits[0]?.encounterId??encounterIds[0]??'');
  const remote=visits.find(record=>record.encounterId===visitChoice),monitoring=state?.monitoring.find(record=>record.patientId===patient.id);
  const identityReviews=state?.identityReviews.filter(record=>record.patientId===patient.id)??[];
  const [identityChoice,setIdentityChoice]=useState(identityReviews[0]?.otherPatientId??'');
  const identity=identityReviews.find(record=>record.otherPatientId===identityChoice);
  const sources=planSources(workspace,patient.id),signoffs=workspace.clinicalWorkflows?.slices.encounters.state.signoffs??[];
  const superseded=new Set(signoffs.map(record=>record.amendedFromId).filter(Boolean));
  const signed=signoffs.filter(record=>record.patientId===patient.id&&record.status==='signed'&&!superseded.has(record.id)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
  const planDraft=useFormDraft(canonicalCommand({signed:signed&&{id:signed.id,version:signed.version},sources:sources.map(source=>source.ref)}),{sourceChoice:'',instructions:'',rationale:''});
  const transferDraft=useFormDraft(canonicalCommand(work.map(record=>({id:record.id,revision:record.revision,acceptedOwner:record.acceptedOwner}))),{selected:[] as string[],owner:patient.clinician,backup:'',due:'',zone:'UTC',evidence:''});
  const coverageDraft=useFormDraft(canonicalCommand(latestCoverage??null),{owner:latestCoverage?.owner??patient.clinician,backup:latestCoverage?.backup??'',start:localTime(latestCoverage?.startsAt),end:localTime(latestCoverage?.endsAt),zone:latestCoverage?.timezone??'UTC',evidence:latestCoverage?.evidence??''});
  const remoteDraft=useFormDraft(canonicalCommand({encounterId:visitChoice,record:remote}),{encounterId:visitChoice,owner:remote?.owner??patient.clinician,due:localTime(remote?.nextAttemptAt),channel:remote?.channel??'video' as RemoteVisit['channel'],status:remote?.status??'scheduled' as RemoteVisit['status'],location:remote?.location??'',reason:remote?.reason??''});
  const monitoringDraft=useFormDraft(canonicalCommand(monitoring??null),{owner:monitoring?.owner??patient.clinician,due:localTime(monitoring?.nextAttemptAt),status:monitoring?.status??'active' as Monitoring['status'],reason:monitoring?.reason??''});
  const identityDraft=useFormDraft(canonicalCommand({otherPatientId:identityChoice,record:identity}),{owner:identity?.owner??patient.clinician,status:identity?.status??'open' as IdentityReview['status'],reason:identity?.reason??''});
  const [feedback,setFeedback]=useState<Partial<Record<Kind,{error?:string;notice?:string}>>>({}),[saving,setSaving]=useState<Kind>();
  const pending=useRef(new Map<Kind,{key:string;action:CareOperationsAction}>()),inFlight=useRef(false);
  const disabled=busy||!!saving;
  const plan=planDraft.value,transfer=transferDraft.value,cover=coverageDraft.value,visit=remoteDraft.value,monitor=monitoringDraft.value,review=identityDraft.value;
  const planSource=sources.find(record=>JSON.stringify(record.ref)===plan.sourceChoice);
  function report(kind:Kind,message:{error?:string;notice?:string}){setFeedback(current=>({...current,[kind]:message}));}
  async function save(event:FormEvent,kind:Kind,editor:DraftControl,make:()=>CareOperationsAction['command']){
    event.preventDefault();if(disabled||inFlight.current)return;
    if(editor.stale){report(kind,{error:'The saved record changed while you were editing. Your draft is kept below. Review the current record before continuing.'});return;}
    inFlight.current=true;setSaving(kind);report(kind,{});
    try{
      const command=make(),key=canonicalCommand({patientId:patient.id,command}),previous=pending.current.get(kind);
      const action=previous?.key===key?previous.action:{type:'care.operations' as const,patientId:patient.id,requestId:crypto.randomUUID(),expectedVersion:state?.version??0,command};
      pending.current.set(kind,{key,action});
      if(await onAction(action)){pending.current.delete(kind);editor.saved();report(kind,{notice:kind==='prepare-plan'?'Care plan amendment prepared. Open Encounter and care plan to review and sign it.':'Saved to the care record.'});if(kind==='remote-visit')setVisitChoice(visit.encounterId);}
      else report(kind,{error:'Your changes were not saved. Your entries are kept here for another attempt.'});
    }catch(caught){report(kind,{error:caught instanceof Error?caught.message:'Check the entered details.'});}
    finally{inFlight.current=false;setSaving(undefined);}
  }
  function status(kind:Kind,editor:DraftControl){return <div className={styles.feedback}>
    {editor.stale&&<><p role="alert">The saved record changed. Your unsaved draft is preserved. Copy any changes you need before loading the current record.</p><button type="button" disabled={disabled} onClick={()=>{editor.reload();pending.current.delete(kind);report(kind,{});}}>Discard draft and load saved record</button></>}
    {feedback[kind]?.error&&<><p role="alert">{feedback[kind]?.error}</p>{!editor.stale&&<button type="button" disabled={disabled} onClick={()=>{const request=pending.current.get(kind);if(request)pending.current.set(kind,{...request,action:{...request.action,expectedVersion:state?.version??0}});report(kind,{notice:'The current saved version will be checked on your next attempt. Your request and entries are preserved.'});}}>Review current version for next attempt</button>}</>}
    {feedback[kind]?.notice&&<p role="status">{feedback[kind]?.notice}</p>}
  </div>;}
  return <section className={styles.root+' patient-care-operations'} aria-label="Connected care actions">
    <div className="care-operations-heading"><div><h3>Care coordination</h3><p>{coverage?`Coverage: ${coverage.owner} · backup ${coverage.backup} · ${coverage.timezone}`:'Coverage has not been confirmed for this time.'}</p></div><span>{work.length} open care actions</span></div>
    <div className="care-operations-summary"><div><span>Monitoring</span><strong>{monitoring?monitoring.status.replaceAll('-',' '):'Not recorded'}</strong></div><div><span>Remote visits</span><strong>{visits.length} recorded</strong></div><div><span>Coverage</span><strong>{coverage?'Confirmed':'Not confirmed'}</strong></div></div>
    <RecommendationDetails title="Care coordination priorities" label="Why review these care actions?" rationale={['There are '+work.length+' saved open care actions for this patient.',coverage?'A recorded coverage period identifies the current owner and backup.':'No coverage period is confirmed for the current time; a named owner and backup are needed before recording a handover.']} sources={[{label:'Patient record',value:patient.name+' · '+patient.id},{label:'Monitoring',value:monitoring?.status.replaceAll('-',' ')??'Not recorded'}]} considerations={work.map(record=>record.title+' · '+(record.acceptedOwner?'Accepted by '+record.acceptedOwner:'Owner: '+(record.owner||'Not assigned')))} limitations={['This view tracks recorded coordination. It does not contact the receiving team or establish that an external handover occurred.']}/>
    <details><summary>Prepare an updated care plan</summary><p>Bring reviewed advice into a new plan amendment. The signed instructions remain available while the amendment is reviewed.</p>
      {!signed?<p>Sign an encounter plan before preparing an amendment.</p>:!sources.length?<p>Review and reconcile specialist advice or a treatment transition first.</p>:<form onSubmit={event=>void save(event,'prepare-plan',planDraft,()=>{if(!planSource)throw new Error('Choose reviewed advice.');return {kind:'prepare-plan',source:planSource.ref,signoffId:signed.id,signoffVersion:signed.version,patientInstructions:plan.instructions,rationale:plan.rationale};})}><fieldset disabled={disabled||planDraft.stale}>
        <label>Reviewed source<select required value={plan.sourceChoice} onChange={event=>planDraft.change({sourceChoice:event.target.value})}><option value="">Choose reviewed advice</option>{sources.map(record=><option key={JSON.stringify(record.ref)} value={JSON.stringify(record.ref)}>{record.title} · revision {record.ref.version}</option>)}</select></label>
        {planSource&&<p>{planSource.summary}</p>}<label>Updated patient instructions<textarea required value={plan.instructions} onChange={event=>planDraft.change({instructions:event.target.value})}/></label><label>Reason for this amendment<textarea required value={plan.rationale} onChange={event=>planDraft.change({rationale:event.target.value})}/></label><button>Prepare plan amendment</button>
      </fieldset></form>}{status('prepare-plan',planDraft)}
    </details>
    <details><summary>Outstanding care and accepted handovers <span>{work.length}</span></summary><p>Open work stays visible after a transfer. Record the receiving owner, backup and acceptance before closing the episode.</p>
      <form onSubmit={event=>void save(event,'transfer',transferDraft,()=>({kind:'transfer',work:work.filter(record=>transfer.selected.includes(record.id)).map(record=>({id:record.id,revision:record.revision})),owner:transfer.owner,backup:transfer.backup,dueAt:instant(transfer.due),timezone:transfer.zone,evidence:transfer.evidence}))}><fieldset disabled={disabled||transferDraft.stale}>
        <ul className={styles.work}>{work.map(record=><li key={record.id}><label><input type="checkbox" checked={transfer.selected.includes(record.id)} onChange={event=>transferDraft.change({selected:event.target.checked?[...transfer.selected,record.id]:transfer.selected.filter(id=>id!==record.id)})}/><span><strong>{record.title}</strong><small>{record.acceptedOwner?'Accepted by '+record.acceptedOwner:'Current owner: '+(record.owner||'Unassigned')}{record.dueAt?' · '+record.dueAt:''}</small></span></label></li>)}</ul>
        {!work.length?<p>No outstanding care actions.</p>:<><div className={styles.fields}><label>Receiving clinician or coordinator<input required value={transfer.owner} onChange={event=>transferDraft.change({owner:event.target.value})}/></label><label>Next review · your device timezone<input required type="datetime-local" value={transfer.due} onChange={event=>transferDraft.change({due:event.target.value})}/></label><label>Backup owner<input required value={transfer.backup} onChange={event=>transferDraft.change({backup:event.target.value})}/></label><label>Handover timezone<input required value={transfer.zone} onChange={event=>transferDraft.change({zone:event.target.value})}/></label></div><label>Acceptance evidence<textarea required value={transfer.evidence} onChange={event=>transferDraft.change({evidence:event.target.value})} placeholder="Who accepted the work, when, and where the acceptance was recorded."/></label><button disabled={!transfer.selected.length||!transfer.due}>Record accepted handover</button></>}
      </fieldset></form>{status('transfer',transferDraft)}
    </details>
    <details><summary>Coverage and service hours</summary><form onSubmit={event=>void save(event,'coverage',coverageDraft,()=>({kind:'coverage',owner:cover.owner,backup:cover.backup,startsAt:instant(cover.start),endsAt:instant(cover.end),timezone:cover.zone,evidence:cover.evidence}))}><fieldset disabled={disabled||coverageDraft.stale}>
      <div className={styles.fields}><label>Accepted owner<input required value={cover.owner} onChange={event=>coverageDraft.change({owner:event.target.value})}/></label><label>Backup owner<input required value={cover.backup} onChange={event=>coverageDraft.change({backup:event.target.value})}/></label><label>Starts · your device timezone<input required type="datetime-local" value={cover.start} onChange={event=>coverageDraft.change({start:event.target.value})}/></label><label>Ends · your device timezone<input required type="datetime-local" value={cover.end} onChange={event=>coverageDraft.change({end:event.target.value})}/></label><label>Service timezone<input required value={cover.zone} onChange={event=>coverageDraft.change({zone:event.target.value})}/></label></div><label>Coverage agreement<textarea required value={cover.evidence} onChange={event=>coverageDraft.change({evidence:event.target.value})}/></label><button>Save coverage period</button>
    </fieldset></form>{status('coverage',coverageDraft)}</details>
    <details><summary>Remote visit {remote?'· '+remote.status.replaceAll('-',' '):''}</summary>
      <label>Visit encounter<select value={visitChoice} disabled={disabled||remoteDraft.dirty} onChange={event=>setVisitChoice(event.target.value)}><option value="">Create a visit for a new encounter</option>{encounterIds.map(encounterId=>{const record=visits.find(visit=>visit.encounterId===encounterId);return <option key={encounterId} value={encounterId}>{encounterId}{record?' · '+record.status.replaceAll('-',' '):' · no remote visit recorded'}</option>;})}</select></label>
      {remote&&<p>Saved visit: {remote.encounterId} · {remote.status.replaceAll('-',' ')} · {remote.owner}. {remote.reason}</p>}
      {remoteDraft.dirty&&!remoteDraft.stale&&<p>Save your changes or <button type="button" disabled={disabled} onClick={()=>{remoteDraft.reload();pending.current.delete('remote-visit');report('remote-visit',{});}}>Discard visit draft</button> before choosing another encounter.</p>}
      <form onSubmit={event=>void save(event,'remote-visit',remoteDraft,()=>({kind:'remote-visit',encounterId:visit.encounterId,channel:visit.channel,status:visit.status,location:visit.location,owner:visit.owner,...(visit.due?{nextAttemptAt:instant(visit.due)}:{}),reason:visit.reason}))}><fieldset disabled={disabled||remoteDraft.stale}>
        <div className={styles.fields}><label>Encounter ID<input required readOnly={!!visitChoice} value={visit.encounterId} onChange={event=>remoteDraft.change({encounterId:event.target.value})}/></label><label>Responsible clinician or coordinator<input required value={visit.owner} onChange={event=>remoteDraft.change({owner:event.target.value})}/></label><label>Next contact · your device timezone<input type="datetime-local" required={['interrupted','alternative-arranged'].includes(visit.status)} value={visit.due} onChange={event=>remoteDraft.change({due:event.target.value})}/></label><label>Channel<select value={visit.channel} onChange={event=>remoteDraft.change({channel:event.target.value as RemoteVisit['channel']})}><option value="video">Video</option><option value="phone">Phone</option></select></label><label>Visit state<select value={visit.status} onChange={event=>remoteDraft.change({status:event.target.value as RemoteVisit['status']})}>{['scheduled','connected','interrupted','alternative-arranged','completed'].map(value=><option key={value} value={value}>{value.replaceAll('-',' ')}</option>)}</select></label><label>Confirmed patient location<input required value={visit.location} onChange={event=>remoteDraft.change({location:event.target.value})}/></label></div><label>Assessment or recovery details<textarea required value={visit.reason} onChange={event=>remoteDraft.change({reason:event.target.value})}/></label><button>Save remote visit</button>
      </fieldset></form>{status('remote-visit',remoteDraft)}
    </details>
    <details><summary>Monitoring and missing reports {monitoring?'· '+monitoring.status.replaceAll('-',' '):''}</summary>
      {monitoring&&<p>Last actual report: {monitoring.lastReceivedAt??'Not recorded'}. {monitoring.reason} Responsible owner: {monitoring.owner}.</p>}
      <form onSubmit={event=>void save(event,'monitoring',monitoringDraft,()=>({kind:'monitoring',status:monitor.status,owner:monitor.owner,...(monitor.due?{nextAttemptAt:instant(monitor.due)}:{}),reason:monitor.reason}))}><fieldset disabled={disabled||monitoringDraft.stale}>
        <div className={styles.fields}><label>Responsible clinician or coordinator<input required value={monitor.owner} onChange={event=>monitoringDraft.change({owner:event.target.value})}/></label><label>Next review · your device timezone<input type="datetime-local" required={monitor.status!=='active'} value={monitor.due} onChange={event=>monitoringDraft.change({due:event.target.value})}/></label><label>Monitoring state<select value={monitor.status} onChange={event=>monitoringDraft.change({status:event.target.value as Monitoring['status']})}><option value="active">Receiving reports</option><option value="paused">Monitoring paused</option><option value="disconnected">Connection interrupted</option><option value="no-response">Patient response not received</option></select></label></div><label>Reason and agreed next step<textarea required value={monitor.reason} onChange={event=>monitoringDraft.change({reason:event.target.value})}/></label><button>Save monitoring status</button>
      </fieldset></form>{status('monitoring',monitoringDraft)}
    </details>
    <details><summary>Patient identity review</summary><p>Keep both charts intact while reviewing a possible duplicate. Correct misfiled observations in their original encounter history.</p>
      <label>Other chart<select required value={identityChoice} disabled={disabled||identityDraft.dirty} onChange={event=>setIdentityChoice(event.target.value)}><option value="">Choose a patient</option>{workspace.patients.filter(record=>record.id!==patient.id).map(record=><option key={record.id} value={record.id}>{record.name} · {record.id}</option>)}</select></label>
      {identityDraft.dirty&&!identityDraft.stale&&<button type="button" disabled={disabled} onClick={()=>{identityDraft.reload();pending.current.delete('identity-review');report('identity-review',{});}}>Discard identity review draft</button>}
      <form onSubmit={event=>void save(event,'identity-review',identityDraft,()=>({kind:'identity-review',otherPatientId:identityChoice,status:review.status,owner:review.owner,reason:review.reason}))}><fieldset disabled={disabled||identityDraft.stale}>
        <div className={styles.fields}><label>Review outcome<select value={review.status} onChange={event=>identityDraft.change({status:event.target.value as IdentityReview['status']})}><option value="open">Review remains open</option><option value="distinct-records">Confirmed distinct patients</option><option value="correction-required">Attributable correction required</option></select></label><label>Reviewer<input required value={review.owner} onChange={event=>identityDraft.change({owner:event.target.value})}/></label></div><label>Identity evidence and next step<textarea required value={review.reason} onChange={event=>identityDraft.change({reason:event.target.value})}/></label><button disabled={!identityChoice}>Save identity review</button>
      </fieldset></form>{status('identity-review',identityDraft)}
    </details>
  </section>;
}
