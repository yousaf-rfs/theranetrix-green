'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {demonstrationPatientIds,emptyDemoConnection,emptyDemoPatientConnection,demoPatientScopes,demoSourceMode,demoDeliveryParts,demoScopes,demoRoles,demoAccessActions,isDemoAccessCheckCurrent,type DemoCommand,type DemoRole,type DemoAccessAction,type DemoSourceMode,type ExportAudience,type DemoPatientConnection} from '@/lib/demo-connection';
import {patientExport} from '@/lib/patient-export';
import type {Workspace} from '@/lib/theranetrix';
import type {Action} from '@/lib/actions';
import {Button} from '@/components/ui/button';
import {Badge,Panel,formatDate} from './ui';
import styles from './demo-connection.module.css';

const scopeLabels={'care-participation':'Care participation',messaging:'Care-team messages','data-use':'Import and use patient reports',sharing:'Share patient instructions'};
const actionLabels:Record<DemoAccessAction,string>={'read-chart':'View clinical chart','read-plan':'View patient instructions','edit-record':'Edit clinical record','import-data':'Import patient reports','share-plan':'Send care plan','send-message':'Send a message','submit-checkin':'Submit a check-in'};
const deliveryLabels={prepared:'Ready to send',pending:'Waiting for receipt',partial:'Partially received by demo inbox',failed:'Delivery interrupted',received:'Received by demo inbox'};

export function ConnectionReportReview({record,patient,encounterId,busy,canImport,onResolve}:{record:DemoPatientConnection['imports'][number];patient:{id:string;name:string};encounterId?:string;busy:boolean;canImport:boolean;onResolve:(resolution:'reject'|'correct')=>Promise<boolean>}){
  const [confirmed,setConfirmed]=useState(false),descriptionId=useId();
  const event=record.event,quarantined=record.status==='quarantined',canCorrect=quarantined&&record.sourcePatientId==='unmatched-chart';
  return <>
    <details open={quarantined}><summary>Report contents and patient match</summary><dl className="detail-list">
      <dt>Source patient</dt><dd>{event?.sourcePatientId??record.sourcePatientId}</dd>
      <dt>Target patient chart</dt><dd>{patient.name} · {patient.id}</dd>
      <dt>Target encounter</dt><dd>{encounterId??'No chart encounter opened'}</dd>
      {event&&<><dt>Source</dt><dd>{event.sourceId}</dd><dt>Source report</dt><dd>{event.eventId}</dd><dt>Collected</dt><dd><time dateTime={event.observedAt}>{event.observedAt}</time></dd></>}
      <dt>Received</dt><dd><time dateTime={record.receivedAt}>{record.receivedAt}</time></dd>
    </dl>{event?<ul className={styles.parts} aria-label="Reported measurements">{event.entries.map((entry,index)=><li key={entry.metric+'-'+index}><strong>{entry.metric==='pain'?'Pain':entry.metric==='function'?'Daily function':'Sleep'}</strong>: {entry.value} · Unit: {entry.unit}</li>)}</ul>:<p>The original report payload is unavailable in this saved record. A matched replacement cannot be confirmed here.</p>}</details>
    {quarantined&&<>
      {canCorrect&&<form onSubmit={async event=>{event.preventDefault();if(confirmed&&record.event&&await onResolve('correct'))setConfirmed(false);}}><fieldset disabled={busy||!canImport||!event} className="min-w-0 space-y-3"><legend>Confirm the patient match</legend><p id={descriptionId}>A separate matched replacement will be added to {patient.name} ({patient.id}). The quarantined source report stays in history.</p><label><input type="checkbox" required checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} aria-describedby={descriptionId}/>I reviewed the report values, units and timestamps and confirm the matched replacement belongs to {patient.name} ({patient.id}).</label><Button type="submit" disabled={!confirmed||!event} className="h-auto whitespace-normal">Import matched replacement</Button></fieldset></form>}
      <Button variant="outline" disabled={busy||!canImport} aria-label={'Reject report '+(event?.eventId??record.id)} onClick={()=>onResolve('reject')}>Reject report</Button>
    </>}
  </>;
}

export function DemoConnectionPanel({workspace,patientId,busy,onAction}:{workspace:Workspace;patientId?:string;busy:boolean;onAction:(action:Action)=>Promise<boolean>}){
  const connectionScopeId=useId();
  const patients=workspace.patients.filter(patient=>workspace.workflowShowcase?.patientIds.includes(patient.id)&&demonstrationPatientIds.some(id=>id===patient.id));
  const [selected,setSelected]=useState(patientId&&patients.some(patient=>patient.id===patientId)?patientId:patients[0]?.id??'');
  const fixed=patientId&&patients.some(patient=>patient.id===patientId)?patientId:undefined;
  const id=fixed??(patients.some(patient=>patient.id===selected)?selected:patients[0]?.id??''),state=workspace.demoConnection??emptyDemoConnection(),patient=state.patients[id]??emptyDemoPatientConnection();
  const [role,setRole]=useState<DemoRole>('clinician'),[previewAction,setPreviewAction]=useState<DemoAccessAction>('read-chart'),[error,setError]=useState(''),[sending,setSending]=useState(false);
  const [recipient,setRecipient]=useState(patient.proxyRecipient??'Designated caregiver'),[audience,setAudience]=useState<ExportAudience|null>(null),[now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30000);return ()=>clearInterval(timer);},[]);
  useEffect(()=>{if(!patient.proxyUntil)return;const remaining=Date.parse(patient.proxyUntil)-Date.now();if(remaining<=0)return;const timer=setTimeout(()=>setNow(Date.now()),Math.min(remaining+1,2147483647));return ()=>clearTimeout(timer);},[patient.proxyUntil]);
  const pending=useRef<{key:string;requestId:string}|null>(null),inFlight=useRef(false);
  async function run(command:DemoCommand):Promise<boolean>{
    if(busy||inFlight.current)return false;inFlight.current=true;setSending(true);setError('');
    const key=JSON.stringify({id,command});if(pending.current?.key!==key)pending.current={key,requestId:crypto.randomUUID()};
    try{if(await onAction({type:'demonstration.connection',patientId:id,expectedVersion:state.version,requestId:pending.current!.requestId,command})){pending.current=null;return true;}setError('The change was not saved. You can retry without losing the current record.');return false;}
    catch(caught){setError(caught instanceof Error?caught.message:'Unable to save. Please retry.');return false;}finally{inFlight.current=false;setSending(false);}
  }
  if(!patients.length)return <Panel title="Connection walkthrough"><div className="padded">Load the patient stories to open the connection walkthrough.</div></Panel>;
  if(patientId&&!fixed)return <Panel title="Connection walkthrough"><div className="padded stack"><p>Choose a patient story to try the demonstration connection.</p>{patients.map(patient=><a key={patient.id} href={'/patients/'+encodeURIComponent(patient.id)+'?workflow=integration-access'}>{patient.name}</a>)}</div></Panel>;
  const disabled=busy||sending,mode=demoSourceMode(state),scopes=demoPatientScopes(patient),chartReady=state.connected&&!!patient.chartOpenedAt&&patient.consent,canImport=chartReady&&scopes['data-use']&&mode!=='offline',canSend=chartReady&&scopes.sharing&&mode==='online',check=patient.accessChecks[0];
  const chartPatient=patients.find(patient=>patient.id===id)!;
  const checkCurrent=check&&isDemoAccessCheckCurrent(check,state,id,role,previewAction,new Date(now).toISOString()),proxyActive=!!patient.proxyUntil&&Date.parse(patient.proxyUntil)>now;
  let exportContent='',exportError='';
  if(audience)try{exportContent=JSON.stringify(patientExport(patients.find(patient=>patient.id===id)!,workspace,new Date(now).toISOString(),audience),null,2);}catch(caught){exportError=caught instanceof Error?caught.message:'Unable to prepare this copy.';}
  return <Panel title="Connected care walkthrough" subtitle="Open a chart, bring in patient reports, and follow a care plan into the inbox.">
    <div className={styles.body}>
      <div className={styles.toolbar}><Badge tone={state.connected&&mode==='online'?'teal':'amber'}>{!state.connected?'Demo connection ready':mode==='offline'?'Source offline':mode==='read-only'?'Read access only':'Demo connection active'}</Badge><span>Workspace connection · all patient stories</span>
        {!fixed&&<label>Patient<select value={id} disabled={disabled} onChange={event=>{setSelected(event.target.value);setRecipient(state.patients[event.target.value]?.proxyRecipient??'Designated caregiver');setError('');setAudience(null);pending.current=null;}}>{patients.map(patient=><option key={patient.id} value={patient.id}>{patient.name}</option>)}</select></label>}
        {!state.connected?<Button disabled={disabled} aria-describedby={connectionScopeId} onClick={()=>run({operation:'connect'})}>Connect workspace</Button>:<label>Workspace connection mode<select value={mode} disabled={disabled} aria-describedby={connectionScopeId} onChange={event=>run({operation:'set-source-mode',mode:event.target.value as DemoSourceMode})}><option value="online">Connected</option><option value="read-only">Read access only</option><option value="offline">Disconnected</option></select></label>}
      </div>
      <p id={connectionScopeId}>Connection mode applies to every patient story in this workspace. Consent and sharing choices below apply only to {chartPatient.name} ({id}).</p>
      {mode==='offline'&&<p role="status">Previously received records remain available. New imports and deliveries are paused.{state.recovery&&` Recovery owner: ${state.recovery.owner}.`}</p>}
      {mode==='read-only'&&<p role="status">Patient reports can be received. Sending to the inbox requires write access.</p>}
      {error&&<p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.grid}>
        <section><h3>1 · Open the patient chart</h3><p>{patient.chartOpenedAt?'Patient and encounter matched.':'Confirm the patient context before receiving or sending records.'}</p>
          <Button variant="outline" disabled={disabled||!state.connected||!patient.consent||mode==='offline'} onClick={()=>run({operation:'open-chart'})}>{patient.chartOpenedAt?'Reopen chart':'Open chart'}</Button>
          <h4>Patient reports</h4><p>Import pain, daily function and sleep responses, plus a report that needs its patient match reviewed.</p>
          <small>{patient.lastReceivedAt?'Last report received '+formatDate(patient.lastReceivedAt,true):'No reports received through this connection.'}</small>
          <div className={styles.actions}><Button disabled={disabled||!canImport||!!patient.imports.length} onClick={()=>run({operation:'import-readings'})}>Import readings</Button><Button variant="outline" disabled={disabled||!canImport||!patient.imports.length} onClick={()=>run({operation:'retry-import'})}>Retry import</Button></div>
          {patient.imports.length>0&&<details><summary>Replay and source checks</summary><div className={styles.actions}><Button variant="outline" disabled={disabled||!canImport} onClick={()=>run({operation:'replay-imports',scenario:'reconnection'})}>Replay pending reports</Button><Button variant="outline" disabled={disabled||!canImport} onClick={()=>run({operation:'replay-imports',scenario:'changed-duplicate'})}>Review a changed duplicate</Button><Button variant="outline" disabled={disabled||!canImport} onClick={()=>run({operation:'replay-imports',scenario:'late'})}>Receive a late report</Button><Button variant="outline" disabled={disabled||!canImport} onClick={()=>run({operation:'replay-imports',scenario:'invalid-unit'})}>Review a unit mismatch</Button></div></details>}
          {patient.imports.map(record=><div className={styles.record} key={record.id}><Badge tone={record.status==='quarantined'?'amber':record.status==='rejected'?'neutral':'teal'}>{record.status}</Badge><p>{record.reason}</p>{workspace.clinicalWorkflows?.slices.encounters.state.observations.some(row=>[record.observationId,record.replacementObservationId].includes(row.id)&&row.status==='withdrawn')&&<p>Withdrawn from current chart use. The original receipt remains in history.</p>}<ConnectionReportReview key={`${id}:${record.id}:${state.version}:${JSON.stringify(record.event)}`} record={record} patient={chartPatient} encounterId={patient.chartEncounterId} busy={disabled} canImport={canImport} onResolve={resolution=>run({operation:'resolve-import',importId:record.id,resolution})}/>{record.owner&&<small>Review owner: {record.owner}</small>}{(record.observationId||record.replacementObservationId)&&<a href={'/patients/'+encodeURIComponent(id)+'?tab=outcomes'}>View observation history</a>}</div>)}
          {!!patient.duplicateCount&&<p role="status">{patient.duplicateCount} repeated {patient.duplicateCount===1?'report':'reports'} reconciled; no duplicates added.</p>}
        </section>
        <section><h3>2 · Send the agreed plan</h3><p>Prepare a copy of the saved care plan. Each delivery keeps its plan version, receipts and attempt history.</p>
          <Button variant="outline" disabled={disabled||!chartReady||!scopes.sharing} onClick={()=>run({operation:'prepare-note'})}>Prepare current plan</Button>
          {patient.deliveries.map((delivery,index)=><div className={styles.record} key={delivery.id}><Badge tone={delivery.status==='received'?'teal':delivery.status==='failed'||delivery.status==='partial'?'amber':'blue'}>{deliveryLabels[delivery.status]}</Badge>{index>0&&<small>Earlier prepared plan</small>}<p>{delivery.text}</p><small>Plan version {delivery.planVersion} · {delivery.attempts} delivery attempts<br/>Follow-up owner: {delivery.owner??'Not assigned'}</small>{delivery.failure&&<p>{delivery.failure}</p>}
            <ul className={styles.parts}>{demoDeliveryParts(delivery).map(part=><li key={part.id}><strong>{part.kind==='care-plan'?'Care plan':'Handoff summary'}</strong> · {part.status}<small>{part.attempts} {part.attempts===1?'attempt':'attempts'}{part.receipt?' · '+part.receipt:''}</small>{part.text&&<details><summary>View item</summary><p>{part.text}</p></details>}</li>)}</ul>
            {delivery.status==='prepared'&&<div className={styles.actions}><Button disabled={disabled||!canSend} onClick={()=>run({operation:'queue-delivery',deliveryId:delivery.id})}>Send to demo inbox</Button><Button variant="outline" disabled={disabled||!canSend} onClick={()=>run({operation:'simulate-delivery-failure',deliveryId:delivery.id})}>Try an interrupted delivery</Button></div>}
            {delivery.status==='pending'&&<div className={styles.actions}><Button disabled={disabled||mode==='offline'} onClick={()=>run({operation:'receive-delivery',deliveryId:delivery.id,outcome:'complete'})}>Receive inbox receipts</Button>{demoDeliveryParts(delivery).filter(part=>part.status==='pending').length>1&&<Button variant="outline" disabled={disabled||mode==='offline'} onClick={()=>run({operation:'receive-delivery',deliveryId:delivery.id,outcome:'partial'})}>Try a partial receipt</Button>}<Button variant="outline" disabled={disabled||mode==='offline'} onClick={()=>run({operation:'receive-delivery',deliveryId:delivery.id,outcome:'failure'})}>Record inbox interruption</Button></div>}
            {(delivery.status==='failed'||delivery.status==='partial')&&<Button disabled={disabled||!canSend} onClick={()=>run({operation:'retry-delivery',deliveryId:delivery.id,waitForReceipt:true})}>Retry remaining items</Button>}
            {delivery.receivedAt&&<p>{formatDate(delivery.receivedAt,true)} · {delivery.receipt}</p>}
            {!!delivery.attemptHistory?.length&&<details><summary>Delivery history</summary><ol className={styles.history}>{delivery.attemptHistory.map((attempt,i)=><li key={i}>{attempt.outcome} · {attempt.partIds.length} items<small>{formatDate(attempt.at,true)} · {attempt.actor}</small></li>)}</ol></details>}
          </div>)}
        </section>
        <section><h3>3 · Preview access</h3><p>Choose a role and task. These permissions apply to this walkthrough; saved actions retain the workspace actor.</p>
          <label><input type="checkbox" checked={patient.consent} disabled={disabled} onChange={event=>run({operation:'set-consent',allowed:event.target.checked})}/> Connection access allowed</label>
          {demoScopes.map(scope=><label key={scope}><input type="checkbox" checked={scopes[scope]} disabled={disabled} onChange={event=>run({operation:'set-scope',scope,allowed:event.target.checked})}/>{scopeLabels[scope]}</label>)}
          <p>Pausing one permission keeps other choices and the clinical history intact.</p>
          <label>Caregiver name<input value={recipient} maxLength={120} disabled={disabled} onChange={event=>setRecipient(event.target.value)}/></label>
          <label><input type="checkbox" checked={proxyActive} disabled={disabled||!proxyActive&&(!patient.consent||!scopes.sharing||!recipient.trim())} onChange={event=>run({operation:'set-proxy',allowed:event.target.checked,...(event.target.checked?{recipient:recipient.trim()}:{})})}/> Proxy access for 24 hours</label>
          {patient.proxyUntil&&<small>{patient.proxyRecipient??'Designated caregiver'} · expires {formatDate(patient.proxyUntil,true)}</small>}
          <label>Preview role<select value={role} disabled={disabled} onChange={event=>setRole(event.target.value as DemoRole)}>{demoRoles.map(role=><option key={role} value={role}>{role}</option>)}</select></label>
          <label>Task<select value={previewAction} disabled={disabled} onChange={event=>setPreviewAction(event.target.value as DemoAccessAction)}>{demoAccessActions.map(action=><option key={action} value={action}>{actionLabels[action]}</option>)}</select></label>
          <Button variant="outline" disabled={disabled||!state.connected} onClick={()=>run({operation:'check-access',role,action:previewAction})}>Check access</Button>
          {check&&<div role="status" className={styles.record}>{checkCurrent?<><Badge tone={check.allowed?'teal':'amber'}>{check.allowed?'Access allowed':'Access denied'}</Badge><p>{check.role} · {check.reason}</p></>:<p>Permissions or the selected task changed. Check access again.</p>}<small>Last checked {formatDate(check.at,true)}</small></div>}
          <h4>Patient and caregiver copies</h4><p>Preview the patient instructions before sharing. Internal notes and conversations stay outside these copies.</p>
          <div className={styles.actions}><Button variant="outline" disabled={disabled} onClick={()=>setAudience('patient')}>Preview patient copy</Button><Button variant="outline" disabled={disabled} onClick={()=>setAudience('proxy')}>Preview caregiver copy</Button></div>
          {exportError&&<p role="alert" className={styles.error}>{exportError}</p>}
          {exportContent&&<details open><summary>{audience==='proxy'?'Caregiver':'Patient'} copy</summary><pre className={styles.preview}>{exportContent}</pre><a download={`${id}-${audience}-instructions.json`} href={'data:application/json;charset=utf-8,'+encodeURIComponent(exportContent)}>Download this copy</a></details>}
        </section>
      </div>
      <details><summary>Connection activity · {state.history.filter(item=>item.patientId===id).length} saved actions</summary><ol className={styles.history}>{state.history.filter(item=>item.patientId===id).map(item=><li key={item.id}><strong>{item.detail}</strong><small>{formatDate(item.at,true)} · {item.actor}</small></li>)}</ol></details>
    </div>
  </Panel>;
}
