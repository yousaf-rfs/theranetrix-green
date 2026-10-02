'use client';

import {useState,type FormEvent} from 'react';
import {getSummary,permissionActions,principalRoles,type Action,type PermissionAction,type PrincipalRole,type State} from '@/lib/clinical-flows/integration-access';
import styles from './integration-access.module.css';

type Props={
  patientId?:string;
  patients:readonly {id:string;name:string}[];
  state:State;
  busy:boolean;
  onAction:(action:Action)=>Promise<boolean>;
};

export function IntegrationAccessPanel(props:Props){
  return <IntegrationAccessForm key={props.patientId??'workspace'} {...props}/>;
}

function IntegrationAccessForm({patientId,patients,state,busy,onAction}:Props){
  const [selectedPatient,setSelectedPatient]=useState(patientId??patients[0]?.id??'');
  const [sourceId,setSourceId]=useState('ehr-primary');
  const [sourceLabel,setSourceLabel]=useState(state.sourceConfigs['ehr-primary']?.label??'Primary EHR feed');
  const [evidence,setEvidence]=useState('');
  const [outboxId,setOutboxId]=useState('');
  const [quarantineId,setQuarantineId]=useState('');
  const [rejectionNote,setRejectionNote]=useState('');
  const [role,setRole]=useState<PrincipalRole>('clinician');
  const [permission,setPermission]=useState<PermissionAction>('records.export');
  const [allow,setAllow]=useState(()=>(state.policyDraft??state.policy).permissions.find(item=>item.role==='clinician'&&item.action==='records.export')?.allow??false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [submitting,setSubmitting]=useState(false);
  const pending=busy||submitting;
  const selectedId=patientId??selectedPatient;
  const summary=getSummary(state);
  const patientOutbox=state.outbox.filter(item=>item.patientId===selectedId);
  const quarantines=state.quarantinedEvents.filter(item=>!item.resolved&&(!patientId||item.event.patientId===patientId));
  const reports=state.externalEvidence.filter(item=>item.patientId===selectedId);
  const policy=state.policyDraft??state.policy;


  async function save(action:Action,message:string){
    setError('');setNotice('');setSubmitting(true);
    try{
      const saved=await onAction(action);
      if(saved) setNotice(message);
      else setError('The change was not saved. Your draft is preserved; refresh the latest state and retry.');
      return saved;
    }catch(caught){setError(caught instanceof Error?caught.message:'The change could not be saved.');return false;}
    finally{setSubmitting(false);}
  }
  const request=()=>({requestId:crypto.randomUUID(),expectedVersion:state.version});
  async function saveSource(event:FormEvent){
    event.preventDefault();
    await save({...request(),type:'integration-access.source.save',source:{sourceId:sourceId.trim(),label:sourceLabel.trim(),freshUntil:'2099-01-01T00:00:00.000Z',enabled:false,adapterMode:'unconfigured'}},'Source draft saved. A verified provider connection is still required.');
  }
  async function savePolicy(event:FormEvent){
    event.preventDefault();
    const existing=policy.permissions.find(item=>item.role===role&&item.action===permission);
    const permissions=policy.permissions.filter(item=>item.role!==role||item.action!==permission);
    permissions.push({...existing,role,action:permission,allow});
    await save({...request(),type:'integration-access.policy.draft',policy:{...policy,version:state.policy.version+1,permissions}},'Access policy draft saved. Active permissions are unchanged.');
  }
  async function saveEvidence(event:FormEvent){
    event.preventDefault();
    if(await save({...request(),type:'integration-access.outbox.manual-evidence',patientId:selectedId,...(outboxId?{outboxId}:{}),note:evidence},'Manual report saved. This does not confirm provider delivery.')){setEvidence('');setOutboxId('');}
  }
  async function rejectQuarantine(event:FormEvent){
    event.preventDefault();
    if(await save({...request(),type:'integration-access.event.reconcile',quarantineId,resolution:{accept:false,note:rejectionNote}},'Quarantined event rejected with a recorded reason.')){setRejectionNote('');setQuarantineId('');}
  }

  return <section className={styles.panel} aria-label="Integration access panel">
    <div className={styles.heading}><h2>Integrations and access</h2><span className={styles.badge}>Workspace connection settings</span></div>
    <p className={styles.muted}>Save connection drafts, review quarantines, and document follow-up. Clinical role authorization, EHR launch, incoming clinical data, and verified write-back require connected server identity and provider services.</p>
    <div className={styles.grid}>
      <span>Verified launch: <strong>{summary.launchStatus}</strong></span>
      <span>Active configured sources: <strong>{summary.connectedSources}</strong></span>
      <span>Accepted events: <strong>{summary.acceptedEvents}</strong></span>
      <span>Unresolved quarantines: <strong>{summary.quarantinedEvents}</strong></span>
      <span>Write-back awaiting delivery: <strong>{summary.outbox.prepared+summary.outbox.pending+summary.outbox.attempted}</strong></span>
      <span>Verified provider acknowledgements: <strong>{summary.outbox.acknowledged}</strong></span>
    </div>
    {error&&<p role="alert" className={styles.blocked}>{error}</p>}
    {notice&&<p role="status" className={styles.notice}>{notice}</p>}
    <section className={styles.subsection} aria-labelledby="integration-connection-title">
      <h3 id="integration-connection-title" data-journey="J19">EHR connection and launch</h3>
      <p className={styles.muted}>EHR launch is blocked until patient, encounter, organization, and principal are validated by a connected identity provider. Saving a draft does not establish a connection.</p>
      <form onSubmit={saveSource} className={styles.form}>
        <label>Source ID<input aria-label="Source ID" value={sourceId} onChange={event=>setSourceId(event.target.value)} maxLength={160} pattern="[A-Za-z0-9][A-Za-z0-9._:\-]*" required disabled={pending}/></label>
        <label>Source name<input aria-label="Source name" value={sourceLabel} onChange={event=>setSourceLabel(event.target.value)} maxLength={160} required disabled={pending}/></label>
        <button type="submit" disabled={pending||!!state.sourceConfigs[sourceId]?.organizationId}>Save source draft</button>
      </form>
      <ul className={styles.list}>{Object.values(state.sourceConfigs).map(source=><li key={source.sourceId}><strong>{source.label}</strong> · {source.sourceId} · {summary.blockedSources.includes(source.sourceId)?'Blocked / '+source.adapterMode:'Configured, current'}{source.organizationId?' · '+source.organizationId:''}</li>)}</ul>
    </section>
    <section className={styles.subsection} aria-labelledby="integration-ingest-title">
      <h3 id="integration-ingest-title" data-journey="J12">Ingestion and reconciliation</h3>
      <p className={styles.muted}>External events require a trusted source. Quarantined events never update patient observations until an authorized review passes source, patient, unit, timestamp, and correction checks.</p>
      {quarantines.length?<>
        <ul className={styles.list}>{quarantines.map(item=><li key={item.id}><strong>{item.event.eventId}</strong> · {item.event.patientId} · {item.reason}</li>)}</ul>
        <form onSubmit={rejectQuarantine} className={styles.form}>
          <label>Quarantined event<select aria-label="Quarantined event" value={quarantineId} onChange={event=>setQuarantineId(event.target.value)} required disabled={pending}><option value="">Choose an event</option>{quarantines.map(item=><option key={item.id} value={item.id}>{item.event.eventId} — {item.reason}</option>)}</select></label>
          <label>Rejection reason<textarea aria-label="Rejection reason" value={rejectionNote} onChange={event=>setRejectionNote(event.target.value)} maxLength={2000} required disabled={pending}/></label>
          <button type="submit" disabled={pending||!quarantineId||!rejectionNote.trim()}>Reject quarantined event</button>
        </form>
      </>:<p className={styles.empty}>No unresolved quarantined events.</p>}
      <p className={styles.muted}>Accepting or correcting imported clinical data is unavailable without verified clinical authorization.</p>
    </section>
    <section className={styles.subsection} aria-labelledby="integration-policy-title">
      <h3 id="integration-policy-title" data-journey="J21">Role and consent policy</h3>
      <p className={styles.muted}>Access is denied by default. Workspace ownership does not grant clinical access. A verified clinical role also needs the correct organization, patient relationship, and current consent.</p>
      <p className={styles.muted}>Active policy version: {state.policy.version}. {state.policyDraft?'An evaluation policy draft is saved; it is not active.':'No evaluation policy draft saved.'}</p>
      <form onSubmit={savePolicy} className={styles.form}>
        <label>Policy role<select aria-label="Policy role" value={role} onChange={event=>{const nextRole=event.target.value as PrincipalRole;setRole(nextRole);setAllow(policy.permissions.find(item=>item.role===nextRole&&item.action===permission)?.allow??false);}} disabled={pending}>{principalRoles.map(item=><option key={item} value={item}>{item}</option>)}</select></label>
        <label>Policy action<select aria-label="Policy action" value={permission} onChange={event=>{const nextPermission=event.target.value as PermissionAction;setPermission(nextPermission);setAllow(policy.permissions.find(item=>item.role===role&&item.action===nextPermission)?.allow??false);}} disabled={pending}>{permissionActions.map(item=><option key={item} value={item}>{item}</option>)}</select></label>
        <label className={styles.checkbox}><input type="checkbox" checked={allow} onChange={event=>setAllow(event.target.checked)} disabled={pending}/>Allow in evaluation policy draft</label>
        <button type="submit" disabled={pending}>Save policy draft</button>
      </form>
      <div className={styles.tableScroll}><table><caption>{state.policyDraft?'Evaluation policy draft':'Active policy rules'}</caption><thead><tr><th>Role</th><th>Action</th><th>Rule</th></tr></thead><tbody>{policy.permissions.map(item=><tr key={item.role+item.action}><td>{item.role}</td><td>{item.action}</td><td>{item.allow?'Allow with identity and consent checks':'Deny'}</td></tr>)}</tbody></table></div>
    </section>
    <section className={styles.subsection} aria-labelledby="integration-evidence-title">
      <h3 id="integration-evidence-title">Write-back follow-up</h3>
      {!patientId&&<label className={styles.field}>Patient<select aria-label="Integration patient" value={selectedPatient} onChange={event=>{setSelectedPatient(event.target.value);setOutboxId('');setEvidence('');setNotice('');}} disabled={pending||!patients.length}>{patients.map(patient=><option key={patient.id} value={patient.id}>{patient.name}</option>)}</select></label>}
      <p className={styles.muted}>Manual reports document calls or other external evidence. They do not mark write-back as delivered or acknowledged.</p>
      <form onSubmit={saveEvidence} className={styles.form}>
        <label>Related write-back<select aria-label="Related write-back" value={outboxId} onChange={event=>setOutboxId(event.target.value)} disabled={pending}><option value="">No linked write-back</option>{patientOutbox.map(item=><option key={item.id} value={item.id}>{item.noteId} · {item.status}</option>)}</select></label>
        <label>Manual evidence<textarea aria-label="Manual evidence" value={evidence} onChange={event=>setEvidence(event.target.value)} maxLength={2000} placeholder="Document the source, date, and what was reported." required disabled={pending||!selectedId}/></label>
        <button type="submit" disabled={pending||!selectedId||!evidence.trim()}>Save manual report</button>
      </form>
      {patientOutbox.length>0&&<ul className={styles.list}>{patientOutbox.map(item=><li key={item.id}><strong>{item.noteId}</strong> · {item.status} · {item.attempts} attempt(s){item.failureReason?' · '+item.failureReason:''}{item.providerMessageId?' · Provider receipt '+item.providerMessageId:''}</li>)}</ul>}
      {reports.length?<ul className={styles.list}>{reports.slice(0,20).map(item=><li key={item.id}><strong>Manual report</strong> · {item.reportedAt} · {item.reporter}<p className={styles.report}>{item.note}</p></li>)}</ul>:<p className={styles.empty}>No manual reports for this patient.</p>}
    </section>
  </section>;
}
