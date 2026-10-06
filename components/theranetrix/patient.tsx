'use client';
import Link from 'next/link';
import {useLocationHash,useLocationParameter} from './location-state';
import {patientRecordViewSearch} from '@/lib/workflow-navigation';
import {patientExport} from '@/lib/patient-export';
import type {ExportAudience} from '@/lib/demo-connection';
import type {Workspace} from '@/lib/theranetrix';
import {useState,useEffect,useRef,useSyncExternalStore} from 'react';
import {ArrowLeft,ArrowUpRight,Users,Activity,CalendarDays,FileText,Plus,ShieldCheck,Database,Check,Layers,Brain,Download,Route,MessageSquare,HeartPulse,ShieldAlert,ClipboardList,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {Checkbox} from '@/components/ui/checkbox';
import {Table,TableHeader,TableHead,TableRow,TableBody,TableCell} from '@/components/ui/table';
import {type Patient,featureEnabled,pathwaySteps,latest} from '@/lib/theranetrix';
import {type Context} from './app';
import {Avatar,Badge,Status,Panel,EmptyState,Outcome,TrendChart,Completion,formatDate,Picker,stickyRecordOffset,Term} from './ui';
import {PatientNotes} from './patient-notes';
import {RecommendationDetails} from './recommendation-details';
import {visitObservations,visitMetrics} from '@/lib/visit-observations';
import {PatientIdentityDialog,birthDateLabel,birthDateShort,dobText} from './patient-identity';
import {VisitDocument} from './visit-document';
import {PatientOverview,PatientSectionNavigation} from './patient-overview';
import {EngineBoard,AdvisorDock} from './engine-workspace';
import {ClinicalContextDialog} from './patient-context';
import {EncounterReview} from './encounter-review';
import {MessageThread} from './workflows';
import {PatientSynopsis,PatientEvidenceView,OutputTraceView} from './review-workspace';
import {WorkflowWorkbench} from './workflow-workbench';
import {ObservationHistory,numericObservationSource} from './clinical-flows/observation-history';
import {patientSelfReports} from '@/lib/patient-checkin-note';
export function exportPatient(p:Patient,w:Workspace,audience:ExportAudience='internal'){
  const file=new Blob([JSON.stringify(patientExport(p,w,new Date().toISOString(),audience),null,2)],{type:'application/json'});
  const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;
  link.download=`${p.id}-${audience==='internal'?'workspace-record':audience+'-instructions'}.json`;
  link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function PatientExportControls({patient,workspace,busy}:{patient:Patient;workspace:Workspace;busy:boolean}){
  const [open,setOpen]=useState(false),[audience,setAudience]=useState<ExportAudience>('patient'),[error,setError]=useState(''),[now,setNow]=useState(()=>Date.now());
  const proxyUntil=workspace.demoConnection?.patients[patient.id]?.proxyUntil;
  useEffect(()=>{if(!open)return;const timer=setInterval(()=>setNow(Date.now()),30000);return ()=>clearInterval(timer);},[open]);
  useEffect(()=>{if(!open||!proxyUntil)return;const remaining=Date.parse(proxyUntil)-Date.now();if(remaining<=0)return;const timer=setTimeout(()=>setNow(Date.now()),Math.min(remaining+1,2147483647));return ()=>clearTimeout(timer);},[open,proxyUntil]);
  let copy:ReturnType<typeof patientExport>|undefined,copyError='';
  if(open)try{copy=patientExport(patient,workspace,new Date(now).toISOString(),audience);}catch(caught){copyError=caught instanceof Error?caught.message:'Unable to prepare this copy.';}
  const instructions=copy&&'plan' in copy?copy.plan:undefined;
  const changeOpen=(value:boolean)=>{setNow(Date.now());setError('');setOpen(value);};
  return <><button onClick={()=>changeOpen(true)} className="text-link"><Download size={14}/>Export record</button><Sheet open={open} onOpenChange={changeOpen}><SheetContent className="detail-sheet"><SheetHeader><SheetTitle>Prepare a record copy</SheetTitle><SheetDescription>{patient.name} · Choose who this copy is for.</SheetDescription></SheetHeader><div className="padded stack">
    <label>Audience<select value={audience} onChange={event=>{setAudience(event.target.value as ExportAudience);setNow(Date.now());setError('');}}><option value="patient">Patient instructions</option><option value="proxy">Caregiver instructions</option><option value="internal">Internal workspace record</option></select></label>
    <p>{audience==='internal'?'The internal copy includes the saved clinical record, notes, conversations and review history.':'This copy contains the agreed patient instructions, owner and follow-up. Clinical notes and conversations are excluded.'}</p>
    {copy&&'recipient' in copy&&<p><strong>Prepared for:</strong> {copy.recipient}</p>}
    {instructions&&<section aria-label="Instructions preview" className="stack"><h3>Instructions preview</h3><p className="whitespace-pre-wrap">{instructions.text}</p><dl className="detail-list"><dt>Goal</dt><dd>{instructions.goal||'Not documented'}</dd><dt>Responsible person</dt><dd>{instructions.owner||'Not documented'}</dd><dt>Follow-up</dt><dd>{instructions.followup?formatDate(instructions.followup):'Not documented'}{instructions.time?' · '+instructions.time:''}{instructions.timezone?' '+instructions.timezone:''}</dd></dl></section>}
    {(copyError||error)&&<p role="alert">{copyError||error}</p>}
    <p className="muted">Downloading prepares a local copy. It does not send a message or deliver records to another service.</p>
    <Button disabled={busy||!copy||!!copyError} onClick={()=>{setError('');setNow(Date.now());try{exportPatient(patient,workspace,audience);}catch(caught){setError(caught instanceof Error?caught.message:'Unable to prepare this copy.');}}}><Download size={16}/>Download {audience==='internal'?'workspace record':'instructions'}</Button>
  </div></SheetContent></Sheet></>;
}
export function Off({name}:{name:string}){return <Panel><EmptyState title={name+' is turned off'} description="Enable this capability and its dependencies in Workspace settings to use it."/><Link className="panel-bottom full-link" href="/settings?tab=features">Open workspace settings <ArrowUpRight size={16}/></Link></Panel>;}
// Closing the allergy strip is a per-viewer convenience kept in this browser. It falls
// back to memory when storage is unavailable, and a chip always keeps the status visible.
const hiddenAllergyKey='theranetrix.hiddenAllergyStrips';
let hiddenAllergyMemory='';
const hiddenAllergyListeners=new Set<()=>void>();
function readHiddenAllergy(){try{return window.localStorage.getItem(hiddenAllergyKey)??hiddenAllergyMemory;}catch{return hiddenAllergyMemory;}}
function useHiddenAllergyStrip(patientId:string):[boolean,(hidden:boolean)=>void]{
  const raw=useSyncExternalStore(listener=>{hiddenAllergyListeners.add(listener);return()=>{hiddenAllergyListeners.delete(listener);};},readHiddenAllergy,()=>'');
  const ids=raw?raw.split(','):[];
  return [ids.includes(patientId),hidden=>{
    const next=[...new Set(hidden?[...ids,patientId]:ids.filter(id=>id!==patientId))].join(',');
    hiddenAllergyMemory=next;try{window.localStorage.setItem(hiddenAllergyKey,next);}catch{}
    hiddenAllergyListeners.forEach(listener=>listener());
  }];
}
export function PatientDetail({patient:p,ctx,onPatientChange}:{patient:Patient;ctx:Context;onPatientChange?:(patientId:string,tab:string)=>void}){
  const requestedTab=useLocationParameter('tab'),hash=useLocationHash();
  const tab=requestedTab&&['overview','visit','full','engines','twin','pst','shadow','advisor','evidence','trace','treatment','outcomes','pathway','messages','notes'].includes(requestedTab)?requestedTab:'visit';
  const recordTab=['pst','shadow','engines','treatment'].includes(tab)?'treatment':tab==='advisor'?'visit':tab;
  const changeTab=(t:string)=>{window.history.replaceState(null,'',patientRecordViewSearch(window.location.search,t));window.dispatchEvent(new PopStateEvent('popstate'));window.scrollTo({top:0});};
  useEffect(()=>{
    if(!hash)return;
    let anchor:string;
    try{anchor=decodeURIComponent(hash.slice(1));}catch{return;}
    const frame=requestAnimationFrame(()=>{
      const target=Array.from(document.querySelectorAll<HTMLElement>('#'+CSS.escape(anchor))).find(element=>!element.closest('[hidden]'));
      if(!target)return;
      for(let disclosure=target.closest('details');disclosure;disclosure=disclosure.parentElement?.closest('details')??null)disclosure.open=true;
      if(!target.getClientRects().length)return;
      // Land below the sticky bars and mark the section briefly, as the advisor does.
      const header=stickyRecordOffset();
      window.scrollTo({top:Math.max(0,target.getBoundingClientRect().top+window.scrollY-Math.max(0,header)-16)});
      target.classList.add('advisor-spotlight');window.setTimeout(()=>target.classList.remove('advisor-spotlight'),2600);
      if(!target.matches('a,button,input,select,textarea,[tabindex]'))target.setAttribute('tabindex','-1');
      target.focus({preventScroll:true});
    });
    return ()=>cancelAnimationFrame(frame);
  },[hash,p.id,recordTab]);
  const [contextOpen,setContextOpen]=useState(false),[identityOpen,setIdentityOpen]=useState(false),[linkStatus,setLinkStatus]=useState('');
  const openReviews=ctx.data.reviews.filter(r=>r.patientId===p.id&&r.status!=='Resolved').length;
  const context=p.clinicalContext;
  const [allergyHidden,setAllergyHidden]=useHiddenAllergyStrip(p.id);
  const allergyState=context?.allergyStatus==='Reactions reported'?'has-reactions':context?.allergyStatus==='None reported'?'':'is-unreviewed';
  const allergyText=context?.allergyStatus==='Reactions reported'?context.allergies:context?.allergyStatus==='None reported'?'None reported':'Not reviewed';
  useEffect(()=>{ctx.selectEnginePatient?.(p.id);},[p.id,ctx.selectEnginePatient]);
  // Where the chart header scrolls away (900px and below, and the Treatment tab up to 1250px), a one-line identity pin appears once it has gone.
  // 90px is the 56px top bar plus the 34px pin in feedback-foundation.css.
  const chartHeader=useRef<HTMLDivElement>(null),[identityPinned,setIdentityPinned]=useState(false);
  useEffect(()=>{const header=chartHeader.current;if(!header||typeof IntersectionObserver==='undefined')return;const observer=new IntersectionObserver(([entry])=>setIdentityPinned(!entry.isIntersecting&&entry.boundingClientRect.top<90),{rootMargin:'-90px 0px 0px 0px'});observer.observe(header);return ()=>observer.disconnect();},[]);
  const jumpToSection=(id:string)=>{
    const target=document.querySelector<HTMLElement>('.patient-overview #'+id);
    if(!target)return;
    if(target instanceof HTMLDetailsElement)target.open=true;
    target.scrollIntoView({block:'start'});
    target.setAttribute('tabindex','-1');
    target.focus({preventScroll:true});
  };
  const recordNavigation=(<div className="patient-record-flow"><TabsList variant="line" className="patient-flow-tabs" aria-label="Patient record sections">{onPatientChange&&<TabsTrigger value="full"><FileText size={16}/>Overview</TabsTrigger>}<TabsTrigger value="visit"><ClipboardList size={16}/>This visit</TabsTrigger><TabsTrigger value="treatment"><Layers size={16}/>Treatment</TabsTrigger><TabsTrigger value="twin"><Activity size={16}/>Digital Twin</TabsTrigger><TabsTrigger value="messages"><MessageSquare size={16}/>Messages</TabsTrigger><TabsTrigger value="notes"><FileText size={16}/>Notes</TabsTrigger></TabsList>{onPatientChange&&recordTab==='full'&&<PatientSectionNavigation onNavigate={jumpToSection}/>}<div className="patient-view-toolbar"><Picker label="Additional record views" value={['outcomes','pathway','overview',...(!onPatientChange?['full']:[]),'evidence','trace'].includes(recordTab)?recordTab:'more'} onChange={t=>{if(t!=='more')changeTab(t);}} options={[{value:'more',label:'More views'},{value:'outcomes',label:'Observation history'},{value:'pathway',label:'Care pathway'},{value:'overview',label:'Complete synopsis'},...(!onPatientChange?[{value:'full',label:'Complete record'}]:[]),{value:'evidence',label:'Evidence readiness'},{value:'trace',label:'Decision trace'}]}/><PatientExportControls key={p.id} patient={p} workspace={ctx.data} busy={ctx.busy}/></div></div>);
  return <div className={"patient-encounter-shell patient-redesign feedback-patient"+(recordTab==='visit'?' patient-profile-focus':'')}>
  <Tabs value={recordTab} onValueChange={changeTab} className="patient-tabs"><div className="patient-chart-header" ref={chartHeader}>{!onPatientChange&&recordNavigation}
  <div className="patient-record-head">
    <div className="patient-heading"><Link className="patient-back-control" href="/" aria-label="Return to care overview"><ArrowLeft size={17}/></Link><Avatar patient={p} size="large"/><div><div className="patient-title-line"><h1>{p.name}</h1><Status value={p.status}/><button type="button" className="patient-dob-control" aria-haspopup="dialog" onClick={()=>setIdentityOpen(true)}>DOB <strong>{birthDateLabel(p.dateOfBirth)}</strong></button><button type="button" className="patient-dob-control" aria-haspopup="dialog" onClick={()=>setIdentityOpen(true)}>MRN <strong>{p.medicalRecordNumber??'not recorded'}</strong></button></div><p><span className="patient-record-id">Workspace ID {p.id}</span><span>·</span>{p.age} years<span>·</span>{p.pronouns}<span>·</span>{p.clinician}</p></div></div>
    <div className="page-actions"><Picker label="Switch patient" className="patient-switch" value={p.id} onChange={id=>{if(onPatientChange)onPatientChange(id,tab);else window.location.href='/patients/'+encodeURIComponent(id)+'?tab='+encodeURIComponent(tab);}} options={ctx.data.patients.map(patient=>({value:patient.id,label:patient.name+' · '+dobText(patient.dateOfBirth)}))}/><Button variant="outline" onClick={()=>ctx.open('task',p)}><CalendarDays size={16}/>Schedule</Button><VisitDocument patient={p} workspace={ctx.data}/><Button variant={recordTab==='visit'?'outline':'default'} onClick={()=>ctx.open('note',p)}><Plus size={16}/>Add note</Button></div>
    <div className="patient-record-meta"><span><HeartPulse size={15}/><strong>{p.condition}</strong></span>{allergyHidden&&<button type="button" className={'patient-allergy-chip '+allergyState} aria-label={'Allergies: '+allergyText+'. Show allergy strip'} onClick={()=>setAllergyHidden(false)}>{context?.allergyStatus==='Reactions reported'?<ShieldAlert size={14}/>:<ShieldCheck size={14}/>}Allergies: {allergyText}</button>}<span>Last report <strong>{p.dates.length?formatDate(p.dates.at(-1)!):'Not recorded'}</strong></span><span>Next visit <strong>{p.nextVisit?formatDate(p.nextVisit):'Not scheduled'}</strong></span><button className="text-link patient-previsit-link" onClick={async()=>{try{await navigator.clipboard.writeText(window.location.origin+'/patient-companion?patient='+encodeURIComponent(p.id));setLinkStatus('Pre-visit link copied');}catch{setLinkStatus('Could not copy. Open patient preparation to copy its address.');}}}>Copy pre-visit link</button><Link className="text-link" href={'/patient-companion?patient='+encodeURIComponent(p.id)}>Patient preparation</Link>{linkStatus&&<span role="status">{linkStatus}</span>}{openReviews>0&&<span className="patient-record-review-count">{openReviews} open review{openReviews===1?'':'s'}</span>}</div>
    {allergyHidden?null:<div className={'patient-record-allergies '+allergyState} aria-label="Patient allergies">{context?.allergyStatus==='Reactions reported'?<ShieldAlert size={16}/>:<ShieldCheck size={16}/>}<strong>Allergies</strong><span>{allergyText}</span><button className="text-link" onClick={()=>setContextOpen(true)}>Review</button>{context&&<small>Recorded {formatDate(context.date)}</small>}<button type="button" className="patient-allergy-dismiss" aria-label="Hide allergy strip" onClick={()=>setAllergyHidden(true)}><X size={15}/></button></div>}
  </div>
  </div>
  {onPatientChange&&recordNavigation}
  <div className={'patient-identity-pin'+(identityPinned?' is-pinned':'')} aria-hidden="true"><strong>{p.name}</strong><span className={p.dateOfBirth?undefined:'is-missing'}><small>DOB</small> {p.dateOfBirth?birthDateShort(p.dateOfBirth):'not recorded'}</span><span className={p.medicalRecordNumber?undefined:'is-missing'}><small>MRN</small> {p.medicalRecordNumber??'not recorded'}</span><span className={'patient-identity-pin-allergy '+allergyState}>{context?.allergyStatus==='Reactions reported'?<ShieldAlert size={13}/>:<ShieldCheck size={13}/>}<small>Allergies:</small> <span>{allergyText||'Reactions reported'}</span></span></div>
    <TabsContent value="overview"><PatientSynopsis key={p.id} p={p} ctx={ctx} changeTab={changeTab}/></TabsContent>
    <TabsContent value="visit" forceMount hidden={recordTab!=='visit'}><EncounterReview key={p.id} p={p} ctx={ctx} changeTab={changeTab}/></TabsContent>
        <TabsContent value="evidence"><PatientEvidenceView p={p} ctx={ctx}/></TabsContent>
    <TabsContent value="trace"><OutputTraceView p={p} ctx={ctx}/></TabsContent>
        <TabsContent value="full"><PatientOverview key={p.id} p={p} ctx={ctx} changeTab={changeTab} streamlined={!!onPatientChange}/></TabsContent>
    <TabsContent value="twin">{featureEnabled(ctx.data,'digitalTwin')?<EngineBoard key={p.id+'twin'} p={p} ctx={ctx} initialTab="twin" embedded/>:<Off name="Digital Twin"/>}</TabsContent>
    <TabsContent value="treatment" forceMount hidden={recordTab!=='treatment'}><EngineBoard key={p.id+'treatment'} p={p} ctx={ctx} initialTab="treatment" embedded/></TabsContent>
    <TabsContent value="outcomes">{featureEnabled(ctx.data,'assessments')?<Outcomes p={p} selfReports={patientSelfReports(ctx.data,p.id)}/>:<Off name="Assessments"/>}</TabsContent>
    <TabsContent value="pathway">{featureEnabled(ctx.data,'pathways')?<PatientPathway p={p} ctx={ctx}/>:<Off name="Care pathways"/>}</TabsContent>
    <TabsContent value="messages" forceMount hidden={recordTab!=='messages'}>{featureEnabled(ctx.data,'messages')?<Panel id="patient-messages"><MessageThread key={p.id} p={p} ctx={ctx}/></Panel>:<Off name="Messaging"/>}</TabsContent>
    <TabsContent value="notes"><div id="patient-notes"><PatientNotes key={p.id} p={p} ctx={ctx}/></div></TabsContent>
  <WorkflowWorkbench workspace={ctx.data} patient={p} actor={ctx.user} busy={ctx.busy} onAction={ctx.save}/>
  </Tabs>
  <PatientIdentityDialog key={p.id+':identity'} p={p} ctx={ctx} open={identityOpen} close={()=>setIdentityOpen(false)}/>
  <ClinicalContextDialog key={p.id} p={p} open={contextOpen} close={()=>setContextOpen(false)} ctx={ctx}/>
  <AdvisorDock p={p} ctx={ctx} startOpen={tab==='advisor'} page={recordTab}/>
  </div>;
}
function DigitalTwin({p}:{p:Patient;ctx:Context}){const [detail,setDetail]=useState(false);return <><div className="section-intro"><div><h2>A longitudinal picture of {p.name.split(' ')[0]}</h2><p>Patient observations, context, and the information still missing.</p></div><Badge tone="blue">Observed data</Badge></div><div className="patient-grid"><div className="stack"><Panel title="Patient trajectory" subtitle="Recorded pain, function and sleep over time." action={<button onClick={()=>setDetail(true)} className="text-link">Inspect sources <Database size={14}/></button>}><TrendChart patient={p} all/></Panel><Panel title="Biopsychosocial context"><div className="context-grid">{[{icon:Activity,title:'Physical',value:p.condition,body:p.clinicalContext?.physicalContext||'Pain and daily function from patient self-reports.'},{icon:Brain,title:'Psychological',value:p.clinicalContext?.psychologicalContext||'Not documented',body:'Clinician-recorded context. Validated instrument results are not connected.'},{icon:Users,title:'Social & goals',value:p.goal,body:p.clinicalContext?.socialContext||'Patient-stated goal from the care record.'}].map(x=><div key={x.title}><x.icon size={22}/><h3>{x.title}</h3><strong>{x.value}</strong><p>{x.body}</p></div>)}</div></Panel></div><div className="stack"><Panel title="Data readiness"><div className="readiness-list">{[['Patient self-reports',p.pain.length?'Available':'Pending'],['Care-team notes',p.notes.length?'Available':'Pending'],['Workspace medications',p.medications.length?'Recorded':p.medicationReconciliation?.none?'None reported':'Needs review'],['EHR medication sync','Not connected'],['Workspace clinical history',p.clinicalContext?.medicalHistory?'Recorded':'Pending'],['EHR history','Not connected'],['Validated PROM instruments','Pending'],['Prediction model','Not connected']].map(([k,v])=><div key={k}><span>{k}</span><Badge tone={v==='Available'?'teal':'neutral'}>{v}</Badge></div>)}</div></Panel><div className="model-notice"><Layers size={23}/><h3>Transparent by design</h3><p>This view organizes recorded information. Calibrated predictions, composite scores, and inflection detection require the validated Digital Twin service.</p><button className="text-link" onClick={()=>setDetail(true)}>View provenance <ArrowUpRight size={14}/></button></div></div></div><Sheet open={detail} onOpenChange={setDetail}><SheetContent className="detail-sheet"><SheetHeader><SheetTitle>Data provenance</SheetTitle><SheetDescription>{p.name} · Digital Twin inputs</SheetDescription></SheetHeader><div className="padded stack"><Badge>Digital Twin inputs</Badge><dl className="detail-list"><dt>Observed period</dt><dd>{p.dates.length?formatDate(p.dates[0])+' to '+formatDate(p.dates.at(-1)!):'No observations'}</dd><dt>Self-report observations</dt><dd>{p.pain.length}</dd><dt>Source</dt><dd>Seeded sample records and submitted workspace check-ins</dd><dt>Last check-in</dt><dd>{p.dates.length?formatDate(p.dates.at(-1)!):'Not available'}</dd><dt>Model version</dt><dd>No model connected</dd><dt>Uncertainty</dt><dd>Not estimated. No predictive model output is displayed.</dd></dl><p className="muted">Manually reviewed workspace medications and clinical context are separate from EHR synchronization. Predictive clinical decision support remains unconnected.</p></div></SheetContent></Sheet></>;}
function Outcomes({p,selfReports}:{p:Patient;selfReports:ReturnType<typeof patientSelfReports>}){
  const [metric,setMetric]=useState('pain');
  const points=visitObservations(p),current=points.at(-1),baseline=points[0];
  return <div className="clinician-outcomes"><div className="section-intro"><div><h2>Patient-reported outcomes</h2><p>{current?'Latest report '+formatDate(current.date)+' · Compare with the first recorded report.':'Waiting for the first patient report.'}</p></div><Badge tone="teal">Patient self-reports</Badge></div>
    <div className="outcome-grid">{visitMetrics.map(key=>{const value=current?.[key],before=baseline?.[key];return <Outcome key={key} title={key==='pain'?'Pain':key==='function'?'Daily function':'Sleep quality'} value={value??'Not answered'} unit={value==null?'':'/ 10'} inverse={key==='pain'} change={value!=null&&before!=null&&points.length>1?value-before:undefined}/>;})}</div>
    <Panel title="Outcome trends" subtitle="Gaps stay visible when a measure was not reported." action={<Picker label="Outcome metric" value={metric} onChange={setMetric} options={[{value:'pain',label:'Pain'},{value:'function',label:'Daily function'},{value:'sleep',label:'Sleep quality'}]}/>}><TrendChart patient={p} metric={metric as 'pain'}/></Panel>
    <Panel title="Observation history" subtitle="Newest first. Corrected and partial reports remain distinct."><div className="observation-table-scroll"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Pain / 10</TableHead><TableHead>Function / 10</TableHead><TableHead>Sleep / 10</TableHead><TableHead>Source</TableHead></TableRow></TableHeader><TableBody>{[...points].reverse().map((point,index)=><TableRow key={point.date+index}><TableCell>{formatDate(point.date,true)}</TableCell>{visitMetrics.map(key=><TableCell key={key}>{point[key]??'Not answered'}</TableCell>)}<TableCell>{point.source}</TableCell></TableRow>)}</TableBody></Table></div>{!points.length&&<EmptyState title="No observations recorded" description="The first report will appear here once submitted."/>}<div className="chart-foot">These 0 to 10 check-ins are sample self-report questions. <Term t="BPI"/>, <Term t="PROMIS"/>, <Term t="PEG"/>, <Term t="SOAPP-R"/>, and <Term t="COMM"/> instruments are not implemented or scored.</div></Panel><ObservationHistory patient={p} selfReports={selfReports}/></div>;
}
export function PatientPathway({p,ctx}:{p:Patient;ctx:Context}){return <div className="patient-grid"><Panel title={p.pathway||'Care pathway enrollment'} subtitle="Care pathway · 5 activities" action={<Badge tone="blue">{p.stage}</Badge>}>{!p.pathway?<div className="padded"><p>Enroll this patient to track intake, review, documentation, and follow-up.</p><Button disabled={ctx.busy} onClick={()=>ctx.save({type:'pathway.enroll',patientId:p.id},'Patient enrolled')}>Enroll patient</Button></div>:<div className="pathway-steps">{pathwaySteps.map((s,i)=><div className={'pathway-step '+(p.completed.includes(s.id)?'is-complete':'')} key={s.id}><span className="step-node">{p.completed.includes(s.id)?<Check size={18}/>:i+1}</span><div><span className="eyebrow">{s.stage}</span><h3>{s.title}</h3><p>{s.description}</p><RecommendationDetails title={s.title} label="Why this step" rationale={[s.description,'This is an operational activity in the enrolled care pathway.']} sources={[{label:'Patient pathway',value:p.pathway+' · '+p.stage,href:'/patients/'+p.id+'?tab=pathway'},{label:'Recorded completion',value:p.completed.includes(s.id)?'Marked complete in this workspace.':'Not marked complete in this workspace.'}]} limitations={['These five activities organize the workflow. They are not the full clinical protocol or a patient-specific treatment recommendation.']}/></div><Checkbox aria-label={'Mark '+s.title+' complete'} checked={p.completed.includes(s.id)} disabled={ctx.busy} onCheckedChange={v=>ctx.save({type:'pathway.step',patientId:p.id,step:s.id as 'intake',complete:!!v},v?'Care activity completed':'Care activity reopened')}/></div>)}</div>}</Panel><div className="stack"><Panel title="Pathway progress"><div className="padded"><Completion value={Math.round(p.completed.length/5*100)} label={p.completed.length+' of 5 activities'}/><p className="muted mt-4">Activity completion is recorded in the workspace audit history.</p><Button className="w-full mt-4" variant="outline" onClick={()=>ctx.open('task',p)}>Schedule next activity</Button></div></Panel><div className="model-notice"><Route size={23}/><h3>Clinical pathway content</h3><p>The source specification names Peripheral Neuropathy Care Plan X-1 with 29 steps. Its full clinical protocol has not been supplied. This sample tracks operational care activities without inventing those clinical steps.</p></div></div></div>;}
