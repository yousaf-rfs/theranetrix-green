'use client';
import {ResetDemoControl} from './workspace-controls';
import {RecommendationDetails} from './recommendation-details';
import {updatePatientLocation} from '@/lib/journey-navigation';
import {selectedPatient} from '@/lib/patient-selection';
import {openWorkflow} from '@/lib/workflow-navigation';
import {featureAvailability} from '@/lib/feature-availability';
import {useLocationParameter} from './location-state';
import {taskWorkflow,taskWorkflowDestination} from '@/lib/task-controls';
import {latestLanguageAccess} from '@/lib/clinical-flows/patient-coordination';
import {PatientPlan} from './engine-workspace';
import {patientMessages} from '@/lib/patient-overview';
import {useState,useRef,useSyncExternalStore,type FormEvent} from 'react';
import Link from 'next/link';
import {ArrowUpRight,ArrowRight,Check,ChevronRight,CalendarDays,Plus,Send,MessageSquare,Search,Inbox,Route,Target,Activity,Heart,BookOpen,Database,Plug,Layers,Brain,Smartphone,Download,CheckCircle2,TriangleAlert,UserRound,Pill} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Checkbox} from '@/components/ui/checkbox';
import {ReviewHistory,TaskHistory} from './record-history';
import {ConfigurationSettings} from './configuration-settings';
import {showcaseVersion} from '@/lib/demo-showcase';
import {WorkflowWorkbench} from './workflow-workbench';
import {CheckinNoteReadback,PatientCheckin,PatientResponseHistory} from './patient-checkin';
import {CompanionMeds} from './companion-meds';
import {visitObservations} from '@/lib/visit-presentation';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {Table,TableHeader,TableHead,TableRow,TableBody,TableCell} from '@/components/ui/table';
import {featureEnabled,pathwaySteps,type Patient,type Review} from '@/lib/theranetrix';
import {type Context} from './app';
import {Badge,Status,PatientName,Picker,Panel,EmptyState,PageTitle,TrendChart,Completion,Term,formatDate} from './ui';
import {Off,PatientPathway} from './patient';
import {ADVISOR_INTEGRATION_NAME,ADVISOR_NAME} from '@/lib/product-names';
function download(name:string,data:unknown){const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
export function CarePathways({ctx}:{ctx:Context}){const [selected,setSelected]=useState(''),[query,setQuery]=useState('');const p=ctx.data.patients.find(p=>p.id===selected);return <div className="workflow-page pathways-workspace"><PageTitle eyebrow="CARE DELIVERY" title="Care pathways" description="Track each patient from preparation through follow-up."/>{!featureEnabled(ctx.data,'pathways')?<Off name="Care pathways"/>:<><div className="pathway-banner"><div className="pathway-banner-icon"><Route size={28}/></div><div><h2>Chronic pain program</h2><p>Intake → Baseline → Review → Care plan → Follow-up</p></div><div className="pathway-banner-stat"><strong>{ctx.data.patients.filter(p=>p.pathway).length}</strong><span>patients enrolled</span></div></div>{p?<><div className="section-intro"><PatientName patient={p}/><Button variant="outline" onClick={()=>setSelected('')}>All enrollments</Button></div><PatientPathway p={p} ctx={ctx}/></>:<Panel title="Patient enrollments" action={<div className="input-search"><Search size={16}/><Input value={query} aria-label="Search pathway patients" onChange={e=>setQuery(e.target.value)} placeholder="Find patient"/></div>}><Table><TableHeader><TableRow><TableHead>Patient</TableHead><TableHead>Care stage</TableHead><TableHead>Progress</TableHead><TableHead>Next activity</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>{ctx.data.patients.filter(p=>p.name.toLowerCase().includes(query.toLowerCase())).map(p=><TableRow key={p.id}><TableCell><PatientName patient={p} sub={p.condition}/></TableCell><TableCell>{p.stage}</TableCell><TableCell><Completion value={Math.round(p.completed.length/5*100)} label={p.completed.length+'/5'}/></TableCell><TableCell><div className="pathway-next-activity"><span>{p.pathway?pathwaySteps.find(s=>!p.completed.includes(s.id))?.title??'Complete':'Not enrolled'}</span>{p.pathway&&<RecommendationDetails title="Pathway next activity" label="Why this step?" rationale={['The next activity is the first step not marked complete in this patient’s saved pathway.']} sources={[{label:'Saved pathway',value:p.pathway},{label:'Recorded completion',value:p.completed.length+' of '+pathwaySteps.length+' steps'}]} limitations={['Completion tracking is administrative progress, not a clinical outcome score.']}/>}</div></TableCell><TableCell><Button variant="outline" size="sm" onClick={()=>setSelected(p.id)}>{p.pathway?'Open pathway':'Enroll'}<ChevronRight size={14}/></Button></TableCell></TableRow>)}</TableBody></Table></Panel>}</>}</div>;}
/** A saved review detail can hold several lines (a rule-based flag lists what matched, the previous and current values, and the rule); each shows as its own line. */
const detailLines=(text:string)=>text.split('\n').filter(line=>line.trim()).map((line,index)=><span key={index} className="block">{line}</span>);
export function ReviewQueue({ctx}:{ctx:Context}){
  const [filter,setFilter]=useState('Active'),[priority,setPriority]=useState('All priorities'),[patientChoice,setPatientFilter]=useState<string>(),[selected,setSelected]=useState<Review|null>(null),[resolution,setResolution]=useState(''),[query,setQuery]=useState('');
  const requestedPatient=useLocationParameter('patient'),patientFilter=patientChoice??requestedPatient??'all',activePatient=ctx.data.patients.find(p=>p.id===patientFilter);
  const handoffs=ctx.data.clinicalWorkflows?.slices['patient-coordination'].state.handoffs??[];
  const reviews=ctx.data.reviews.map(review=>{
    const handoff=handoffs.find(record=>record.id===review.workflowRecordId&&record.patientId===review.patientId);
    if(!handoff)return review;
    const status:Review['status']=handoff.phase==='closed'?'Resolved':['ownership-accepted','reviewed','action-documented','response-recorded'].includes(handoff.phase)?'Acknowledged':'Open';
    return {...review,status};
  });
  const scopeReviews=reviews.filter(review=>patientFilter==='all'||review.patientId===patientFilter);
  const rows=reviews.filter(r=>(filter==='All'||filter==='Active'&&r.status!=='Resolved'||filter===r.status)&&(priority==='All priorities'||r.priority===priority)&&(patientFilter==='all'||r.patientId===patientFilter)&&[r.title,r.detail,r.owner,ctx.data.patients.find(p=>p.id===r.patientId)?.name].some(value=>value?.toLowerCase().includes(query.trim().toLowerCase()))).sort((a,b)=>Number(a.status==='Resolved')-Number(b.status==='Resolved')||({High:0,Medium:1,Routine:2}[a.priority]-{High:0,Medium:1,Routine:2}[b.priority])||a.created.localeCompare(b.created));
  const update=async(status:'Acknowledged'|'Resolved')=>{if(selected&&await ctx.save({type:'review.update',id:selected.id,status,resolution},status==='Resolved'?'Review resolved':'Review acknowledged')){setSelected(null);setResolution('');}};
  return <div className="workflow-page review-workspace">
    <PageTitle eyebrow="CARE TEAM" title="Review queue" description="Review patient concerns and record the next step." actions={<Button disabled={ctx.busy||(patientFilter!=='all'&&!activePatient)} onClick={()=>ctx.open('escalation',activePatient)}><Plus size={16}/>New escalation</Button>}/>
    <div className="workflow-metrics" aria-label="Review queue totals">
      <button aria-pressed={filter==='Active'&&priority==='All priorities'} onClick={()=>{setFilter('Active');setPriority('All priorities');}} className={filter==='Active'&&priority==='All priorities'?'selected':''}><span className="workflow-metric-icon"><Inbox size={20}/></span><span><strong>{scopeReviews.filter(r=>r.status!=='Resolved').length}</strong><small>Active reviews</small></span><ArrowUpRight size={16}/></button>
      <button aria-pressed={filter==='Active'&&priority==='High'} onClick={()=>{setFilter('Active');setPriority('High');}} className={'priority-metric '+(filter==='Active'&&priority==='High'?'selected':'')}><span className="workflow-metric-icon"><TriangleAlert size={20}/></span><span><strong>{scopeReviews.filter(r=>r.priority==='High'&&r.status!=='Resolved').length}</strong><small>High priority</small></span><ArrowUpRight size={16}/></button>
      <button aria-pressed={filter==='Resolved'} onClick={()=>{setFilter('Resolved');setPriority('All priorities');}} className={filter==='Resolved'?'selected':''}><span className="workflow-metric-icon"><CheckCircle2 size={20}/></span><span><strong>{scopeReviews.filter(r=>r.status==='Resolved').length}</strong><small>Resolved reviews</small></span><ArrowUpRight size={16}/></button>
    </div>
    <Panel className="review-list-panel" title="Patient concerns" subtitle={`${rows.length} ${rows.length===1?'review':'reviews'} · Highest priority first`}>
      <div className="table-toolbar workflow-filters">
        <div className="input-search"><Search size={16}/><Input value={query} onChange={event=>setQuery(event.target.value)} aria-label="Search review queue" placeholder="Search patient or concern"/></div>
        <label>Status<Picker value={filter} onChange={setFilter} options={['Active','Open','Acknowledged','Resolved','All']} label="Review status"/></label>
        <label>Priority<Picker value={priority} onChange={setPriority} options={['All priorities','High','Medium','Routine']} label="Review priority"/></label>
        <label>Patient<Picker value={patientFilter} onChange={next=>{if(ctx.busy)return;updatePatientLocation(next);setPatientFilter(next);}} options={[{value:'all',label:'All patients'},...ctx.data.patients.map(p=>({value:p.id,label:p.name}))]} label="Review patient"/></label>
      </div>
      <div className="review-column-headings" aria-hidden="true"><span>Patient & concern</span><span>Owner & due date</span><span>Next step</span></div>
      {rows.length?rows.map(r=>{
        const p=ctx.data.patients.find(p=>p.id===r.patientId);
        const handoff=handoffs.some(record=>record.id===r.workflowRecordId&&record.patientId===r.patientId);
        return <article className={'review-work-item '+(r.priority==='High'&&r.status!=='Resolved'?'needs-attention':'')} key={r.id}>
          <div className="review-item-main">
            {p?<Link className="review-patient-link" href={'/patients/'+p.id}><PatientName patient={p} sub={p.id}/></Link>:<p>Patient record unavailable · {r.patientId}</p>}
            <div className="review-concern"><h3>{r.title}</h3><div className="review-item-labels"><Status value={r.priority}/><Status value={r.status}/></div>{r.priority==='High'&&r.status!=='Resolved'&&<p className="review-visible-concern">{detailLines(r.detail)}</p>}<RecommendationDetails title={r.title} label="Why this needs review" summary={r.detail} rationale={['This item has a recorded '+r.priority.toLowerCase()+' priority and is '+r.status.toLowerCase()+'.',handoff?'This review is linked to a care-team handoff. Its status follows the saved handoff record.':'The queue presents the saved concern for clinician review; its priority is not a calculated clinical risk score.']} sources={[{label:'Concern source',value:r.source,date:r.created},{label:'Responsible owner',value:r.owner||p?.clinician||'Not assigned'},...(r.dueAt?[{label:'Due',value:formatDate(r.dueAt,true)}]:[])]} considerations={r.resolution?['Recorded resolution: '+r.resolution]:['Confirm the concern and document the next step before resolving this item.']} limitations={['Acknowledging or resolving this review does not change treatment or send a patient message.']}/>
</div>
          </div>
          <dl className="review-item-meta"><div><dt>Owner</dt><dd>{r.owner||p?.clinician||'Not assigned'}</dd></div><div><dt>Due</dt><dd>{r.dueAt?formatDate(r.dueAt,true):'No due date'}</dd></div></dl>
          <div className="review-item-action">{handoff&&p?<Link className="workflow-action-link secondary" href={'/patients/'+encodeURIComponent(p.id)+'?workflow=patient-coordination&workflowJourney=J10&workflowRecordId='+encodeURIComponent(r.workflowRecordId!)}>Open handoff <ArrowRight size={15}/></Link>:r.source==='Model and evidence recall'?<Link className="workflow-action-link secondary" href="/settings?workflow=program-governance">Review recall <ArrowRight size={15}/></Link>:<Button variant="outline" onClick={()=>{setSelected(r);setResolution(r.resolution??'');}}>{r.status==='Resolved'?'View review':'Review item'}<ArrowRight size={15}/></Button>}</div>
        </article>;
      }):<EmptyState title="No reviews in this view" description="Change the filters or continue with your patient panel."/>}
    </Panel>
    <Dialog open={!!selected} onOpenChange={v=>{if(!v&&!ctx.busy)setSelected(null);}}><DialogContent className="entry-dialog"><DialogHeader><DialogTitle>{selected?.title}</DialogTitle><DialogDescription>{selected&&detailLines(selected.detail)}</DialogDescription></DialogHeader>{selected&&<form className="entry-form" onSubmit={e=>{e.preventDefault();update('Resolved');}}><Badge>{selected.source}</Badge><ReviewHistory review={selected}/><label>Review notes and next steps<Textarea value={resolution} onChange={e=>setResolution(e.target.value)} required maxLength={6000} rows={5} placeholder="Record what you reviewed and how this was handled."/></label><p className="muted">This records a review in the workspace. It does not send a message or change treatment.</p><div className="form-actions"><Button type="button" variant="outline" disabled={ctx.busy||!resolution.trim()||selected.status==='Resolved'} onClick={()=>update('Acknowledged')}>Acknowledge</Button><Button type="submit" disabled={ctx.busy||!resolution.trim()}>{ctx.busy?'Saving...':selected.status==='Resolved'?'Update review':'Resolve review'}</Button></div></form>}</DialogContent></Dialog>
  </div>;
}
export function MessageThread({p,ctx,patientMode=false,spanish=false}:{p:Patient;ctx:Context;patientMode?:boolean;spanish?:boolean}){
  const [text,setText]=useState(''),[error,setError]=useState(''),[sending,setSending]=useState(false);
  const pending=useRef(false),messages=ctx.data.messages.filter(m=>m.patientId===p.id),locked=ctx.busy||sending;
  async function submit(e:FormEvent){
    e.preventDefault();if(!text.trim()||ctx.busy||pending.current)return;
    const submitted=text;pending.current=true;setSending(true);setError('');
    try{
      if(await ctx.save({type:'message.send',patientId:p.id,text:submitted,direction:patientMode?'in':'out'},spanish?'Mensaje guardado':'Message saved in workspace'))setText(current=>current===submitted?'':current);
      else setError(spanish?'No se ha guardado el mensaje. Tu texto sigue aquí; puedes volver a intentarlo.':'The message was not saved. Your text is still here; you can try again.');
    }catch{setError(spanish?'No se ha guardado el mensaje. Tu texto sigue aquí.':'The message was not saved. Your text is still here.');}
    finally{pending.current=false;setSending(false);}
  }
  return <div className="message-thread"><div className="thread-header">{patientMode?<div className="person"><span className="team-avatar"><StethoscopeIcon/></span><div><strong>{spanish?'Tu equipo de atención':'Your care team'}</strong><small>{p.clinician}</small></div></div>:<Link href={'/patients/'+p.id}><PatientName patient={p} sub={p.condition}/></Link>}{!patientMode&&<Link href={'/patients/'+p.id} className="workflow-action-link secondary">Open patient<ArrowUpRight size={14}/></Link>}</div>{!patientMode&&<div className="thread-context"><span><UserRound size={14}/>Care team · {p.clinician}</span><span>Patient messages</span>{ctx.data.reviews.some(review=>review.patientId===p.id&&review.status!=='Resolved')&&<Link href={'/review-queue?patient='+encodeURIComponent(p.id)} className="thread-concern-link">{ctx.data.reviews.filter(review=>review.patientId===p.id&&review.status!=='Resolved').length} open concerns · Review queue</Link>}</div>}<div className="message-history" role="region" tabIndex={0} aria-live="polite" aria-label={spanish?'Historial de mensajes':'Conversation history'}>{messages.length?messages.map(m=><div key={m.id} className={'message '+((patientMode?m.direction==='in':m.direction==='out')?'own':'')}><small>{m.sender} · {formatDate(m.date,true)}</small><div>{m.text}</div></div>):<EmptyState title={spanish?'Sin mensajes todavía':'Start a conversation'} description={spanish?'Los mensajes aparecerán aquí.':'Messages will appear here and in the patient companion.'}/>}</div>{error&&<p role="alert" className="subtle-notice">{error}</p>}<form className="message-compose" onSubmit={submit} aria-busy={locked}><Textarea aria-label={spanish?'Mensaje':'Message text'} value={text} onChange={e=>setText(e.target.value)} disabled={locked} placeholder={spanish?'Escribe un mensaje...':'Write a message...'} required maxLength={6000} rows={2}/><Button type="submit" disabled={locked||!text.trim()} aria-label={spanish?'Enviar mensaje':'Send message'}><Send size={17}/><span>{sending?(spanish?'Guardando…':'Saving…'):(spanish?'Enviar':'Send')}</span></Button></form><p className="message-disclaimer">{spanish?'Los mensajes se guardan solo en este espacio de evaluación. No se envían notificaciones externas.':'Messages stay in this evaluation workspace. External delivery and notifications are not connected.'}</p></div>;
}
function StethoscopeIcon(){return <Heart size={19}/>;}
export function Messages({ctx}:{ctx:Context}){
  const [patientChoice,setSelected]=useState<string>(),[query,setQuery]=useState('');
  const requestedPatient=useLocationParameter('patient'),p=selectedPatient(ctx.data.patients,requestedPatient,patientChoice),selected=p?.id;
  const lastMessage=(id:string)=>patientMessages({id},ctx.data).at(-1);
  const patients=ctx.data.patients.filter(patient=>[patient.name,patient.id].some(value=>value.toLowerCase().includes(query.toLowerCase()))).sort((a,b)=>(lastMessage(b.id)?.date??'').localeCompare(lastMessage(a.id)?.date??''));
  return <div className="workflow-page messages-workspace"><PageTitle eyebrow="CARE TEAM" title="Messages" description="Review messages and reply to patients in one place."/>
    {featureEnabled(ctx.data,'messages')?<Panel className="messages-layout redesigned-messages">
      <div className="conversation-list"><div className="conversation-list-heading"><h2>Patients</h2><span>{ctx.data.patients.length}</span></div><div className="input-search"><Search size={16}/><Input aria-label="Search conversations" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find patient or ID"/></div><p className="conversation-sort">Most recent activity first · Reply needed: the latest saved message is from the patient</p><div className="conversation-results">
        {patients.length?patients.map(patient=>{const message=lastMessage(patient.id);return <button key={patient.id} aria-pressed={selected===patient.id} className={'conversation '+(selected===patient.id?'selected':'')} onClick={()=>{if(ctx.busy)return;updatePatientLocation(patient.id);setSelected(patient.id);}}><div><PatientName patient={patient} sub={patient.id}/><p className="conversation-preview">{message?.text??'No messages yet'}</p><span className="conversation-date">{message?formatDate(message.date,true):patient.condition}</span>{message?.direction==='in'&&<span className="conversation-date"><Badge tone="amber">Reply needed</Badge></span>}</div><ChevronRight size={15}/></button>;}):<EmptyState title="No matching patients" description="Try a different name."/>}
      </div></div>
      {p?<MessageThread key={p.id} p={p} ctx={ctx}/>:<EmptyState title="Patient not found" description="Choose a patient from the conversation list to continue."/>}
    </Panel>:<Off name="Messaging"/>}
  </div>;
}
export function Schedule({ctx}:{ctx:Context}){
  const [date,setDate]=useState('all'),[show,setShow]=useState('Open'),[patientChoice,setPatientChoice]=useState<string>();
  const requestedPatient=useLocationParameter('patient'),patientFilter=patientChoice??requestedPatient??'all',activePatient=ctx.data.patients.find(p=>p.id===patientFilter);
  const patientTasks=ctx.data.tasks.filter(task=>patientFilter==='all'||task.patientId===patientFilter);
  const dates=Array.from(new Set(patientTasks.map(task=>task.date).filter(Boolean))).sort();
  const tasks=patientTasks.filter(task=>(date==='all'||task.date===date)&&(show==='All activities'||show==='Open'&&!task.done||show==='Completed'&&task.done&&task.workflowDisposition!=='deferred'||show==='Withdrawn / superseded'&&task.workflowDisposition==='deferred')).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  return <div className="workflow-page schedule-workspace"><PageTitle eyebrow="CARE TEAM" title="Schedule" description="Visits, check-ins, and follow-up, organized by date." actions={<Button disabled={ctx.busy||(patientFilter!=='all'&&!activePatient)} onClick={()=>ctx.open('task',activePatient)}><Plus size={16}/>Schedule activity</Button>}/>
    <div className="schedule-overview"><span className="schedule-overview-icon"><CalendarDays size={26}/></span><div><h2>{activePatient?activePatient.name+'’s activities':'Your care-team agenda'}</h2><p><strong>{patientTasks.filter(task=>!task.done).length}</strong> open activities · {patientTasks.filter(task=>task.done&&task.workflowDisposition!=='deferred').length} completed</p></div><Picker label="Schedule patient" value={patientFilter} onChange={next=>{if(ctx.busy)return;updatePatientLocation(next);setPatientChoice(next);setDate('all');}} options={[{value:'all',label:'All patients'},...ctx.data.patients.map(p=>({value:p.id,label:p.name}))]}/></div>
    <div className="schedule-days"><button className={date==='all'?'selected':''} aria-pressed={date==='all'} onClick={()=>setDate('all')}><span>AGENDA</span><strong>All dates</strong><small>{patientTasks.length} activities</small></button>{dates.map(day=><button key={day} className={date===day?'selected':''} aria-pressed={date===day} onClick={()=>setDate(day)}><span>{new Date(day+'T12:00:00').toLocaleDateString('en-US',{weekday:'short'})}</span><strong>{day.slice(-2)}</strong><small>{formatDate(day).split(' ')[0]}</small></button>)}</div>
    <Panel className="schedule-list-panel" title={date==='all'?'Care activities':formatDate(date)} subtitle={`${tasks.length} ${tasks.length===1?'activity':'activities'} in this view`} action={<Picker label="Activity status" value={show} onChange={setShow} options={['Open','Completed','Withdrawn / superseded','All activities']}/>}>
      {tasks.length?tasks.map((task,index)=>{
        const patient=ctx.data.patients.find(candidate=>candidate.id===task.patientId);
        const deferred=task.workflowDisposition==='deferred',source=taskWorkflow(ctx.data,task),workflow=taskWorkflowDestination(ctx.data,task)??(deferred?task.workflowDomain:undefined);
        const href=workflow==='program-governance'?'/settings?workflow=program-governance':workflow&&patient?`/patients/${patient.id}?workflow=${workflow==='care-operations'?'encounters':workflow}`:`/patients/${task.patientId}`;
        return <div className="schedule-item-group" key={task.id}>
          {date==='all'&&(index===0||tasks[index-1].date!==task.date)&&<div className="schedule-date-heading"><CalendarDays size={15}/>{task.date?formatDate(task.date):'No due date'}</div>}
          <article className={'agenda-item '+(task.done?'completed':'')}>
            <div className="agenda-time"><strong>{task.time||'Unscheduled'}</strong>{task.timezone&&<span>{task.timezone}</span>}<Badge tone={task.done&&!deferred?'teal':deferred?'neutral':'blue'}>{deferred?'Withdrawn / superseded':task.done?'Completed':'Open'}</Badge></div>
            <div className="agenda-main"><div className="agenda-title"><h3>{task.title}</h3></div><p className="agenda-type">{task.type}</p>{patient?<Link className="agenda-patient" href={'/patients/'+patient.id}><UserRound size={14}/>{patient.name}</Link>:<span>Patient record unavailable · {task.patientId}</span>}<p className="agenda-owner">Owner: <strong>{task.owner??patient?.clinician??'Not assigned'}</strong></p><RecommendationDetails title={task.title} label="Activity context" rationale={[source?'This activity is linked to a saved workflow. Update that workflow to record its outcome.':'This is a recorded care-team activity; its date and owner come from the saved schedule.']} sources={[{label:'Activity type',value:task.type},{label:'Patient',value:patient?.name??task.patientId},{label:'Scheduled date',value:task.date?formatDate(task.date)+(task.time?' · '+task.time:''):'Not recorded'}]} limitations={['A scheduled activity does not establish that the encounter or treatment occurred.']}/><TaskHistory task={task}/></div>
            <div className="agenda-actions"><label className="agenda-complete"><Checkbox checked={task.done&&!deferred} disabled={ctx.busy||!!source||deferred} onCheckedChange={value=>ctx.save({type:'task.toggle',id:task.id,done:!!value},value?'Activity completed':'Activity reopened')} aria-label={'Complete '+task.title+' for '+(patient?.name??task.patientId)}/>{deferred?'Superseded activity':source?'Managed in workflow':task.done?'Completed':'Mark complete'}</label>{source||deferred?<Link href={href} className="workflow-action-link secondary">{deferred?'View source history':'Open workflow'}<ArrowUpRight size={15}/></Link>:<Link href={href} className="text-link">{workflow?'View workflow':'Patient record'}<ArrowUpRight size={14}/></Link>}</div>
          </article>
        </div>;
      }):<EmptyState title="No activities in this view" description="Schedule a care activity or choose a different day."/>}
    </Panel>
  </div>;
}
const translations={en:{greeting:'Good morning',title:'A small check-in. A step forward.',intro:'How are you feeling today?',today:'Today',progress:'My progress',plan:'My care plan',messages:'Messages',pain:'Pain level',painMin:'No pain',painMax:'Worst pain',function:'Daily activities',functionMin:'Unable to do activities',functionMax:'No difficulty',sleep:'Sleep quality',sleepMin:'Very poor',sleepMax:'Excellent',notes:'Anything you’d like your care team to know?',submit:'Save my check-in',goal:'MY PERSONAL GOAL',done:'Your check-in is saved',doneBody:'Your care team can now see it in your patient record.',again:'Add another check-in',steps:'My next steps'},es:{greeting:'Buenos días',title:'Un pequeño registro. Un paso adelante.',intro:'¿Cómo te sientes hoy?',today:'Hoy',progress:'Mi progreso',plan:'Mi plan',messages:'Mensajes',pain:'Nivel de dolor',painMin:'Sin dolor',painMax:'El peor dolor',function:'Actividades diarias',functionMin:'No puedo realizar actividades',functionMax:'Sin dificultad',sleep:'Calidad del sueño',sleepMin:'Muy mala',sleepMax:'Excelente',notes:'¿Qué te gustaría compartir con tu equipo de atención?',submit:'Guardar mi registro',goal:'MI OBJETIVO PERSONAL',done:'Tu registro se ha guardado',doneBody:'Tu equipo de atención puede verlo en tu historial.',again:'Añadir otro registro',steps:'Mis próximos pasos'}};
const subscribeCompanionLocation=(listener:()=>void)=>{window.addEventListener('popstate',listener);return ()=>window.removeEventListener('popstate',listener);};
const companionLocation=()=>window.location.search;
const serverCompanionLocation=()=>'';
export function Companion({ctx}:{ctx:Context}){
  const search=useSyncExternalStore(subscribeCompanionLocation,companionLocation,serverCompanionLocation);
  const requested=new URLSearchParams(search).get('patient');
  const patient=selectedPatient(ctx.data.patients,requested);
  if(!patient)return <><EmptyState title={requested!==null?'Patient not found':'Choose a patient'} description="Select an available patient to open their companion."/><Picker label="Choose patient account" value="" onChange={next=>{updatePatientLocation(next);window.dispatchEvent(new PopStateEvent('popstate'));}} options={ctx.data.patients.map(p=>({value:p.id,label:p.name}))}/></>;
  return <PatientCompanionLanguage key={patient.id} p={patient} ctx={ctx} onAccount={next=>{if(ctx.busy)return;updatePatientLocation(next);window.dispatchEvent(new PopStateEvent('popstate'));}}/>;
}
export function PatientCompanionLanguage({p,ctx,onAccount}:{p:Patient;ctx:Context;onAccount:(id:string)=>void}){
  const access=latestLanguageAccess(ctx.data.clinicalWorkflows?.slices['patient-coordination'].state,p.id);
  const savedLanguage=p.preferredLanguage??access?.preferredLanguage??'en';
  const [draft,setDraft]=useState<'en'|'es'|undefined>(),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const lang=draft??savedLanguage;
  async function changeLanguage(language:'en'|'es'){
    if(ctx.busy||saving)return;
    setDraft(language);setError('');setSaving(true);
    try{if(await ctx.save({type:'patient.language.set',patientId:p.id,language},language==='es'?'Idioma guardado':'Language saved'))setDraft(undefined);else setError(language==='es'?'No se ha guardado el idioma. Puedes volver a intentarlo.':'Your language choice was not saved. You can try again.');}
    catch{setError(language==='es'?'No se ha guardado el idioma. Puedes volver a intentarlo.':'Your language choice was not saved. You can try again.');}
    finally{setSaving(false);}
  }
  return <>{error&&<div role="alert" className="resolution-note">{error} <Button variant="outline" disabled={ctx.busy||saving} onClick={()=>void changeLanguage(lang)}>{lang==='es'?'Reintentar':'Try again'}</Button></div>}<CompanionView p={p} ctx={ctx} lang={lang} accounts={ctx.data.patients.map(x=>({value:x.id,label:x.name}))} onAccount={onAccount} onLang={language=>void changeLanguage(language)} languageBusy={saving} accessibilityPreferences={access?.accessibilityPreferences??[]}/></>;
}
export function CompanionProgress({p,ctx,lang}:{p:Patient;ctx:Context;lang:'en'|'es'}){
  const t=translations[lang],spanish=lang==='es',observations=p.workflowObservations??[];
  const withdrawnIds=new Set(observations.filter(entry=>entry.withdrawnAt).map(entry=>entry.workflowRecordId));
  const submittedReportIds=new Set((ctx.data.clinicalWorkflows?.slices.encounters.state.observations??[]).filter(record=>record.patientId===p.id&&record.status==='confirmed'&&record.submissionSource==='patient-self-report').map(record=>record.id));
  const current=p.checkins.filter(checkin=>!submittedReportIds.has(checkin.workflowRecordId??'')&&!checkin.withdrawnAt&&!withdrawnIds.has(checkin.workflowRecordId??'')&&(!checkin.workflowRecordId||checkin.workflowVersion===Math.max(...observations.filter(entry=>entry.workflowRecordId===checkin.workflowRecordId).map(entry=>entry.workflowVersion))));
  const withdrawnReports=[...withdrawnIds].map(id=>observations.filter(entry=>entry.workflowRecordId===id));
  const otherWithdrawn=p.checkins.filter(checkin=>checkin.withdrawnAt&&!withdrawnIds.has(checkin.workflowRecordId??''));
  const historicalCount=withdrawnReports.length+otherWithdrawn.length;
  function recordedResponse(entry:(typeof observations)[number]){
    if(entry.status==='declined')return spanish?'No quiso responder':'Declined';
    if(entry.status==='unanswered')return spanish?'Sin respuesta':'Unanswered';
    return typeof entry.value==='number'?`${entry.value}/10`:spanish?'Valor no registrado':'Value not recorded';
  }
  // Patients see their own words only: never a clinician's withdrawal reason, a clinician-entered note, or record versions and sources.
  const setAside=spanish?'Tu equipo de atención apartó este registro.':'Your care team set this check-in aside.';
  const ownNote=(checkin:Patient['checkins'][number])=>!!checkin.note&&(!checkin.source||checkin.source==='Patient self-report');
  return <><h2 className="mb-2">{t.progress}</h2><p className="muted mb-5">{spanish?'Solo tus registros. Tu equipo también los ve. Nada de puntuaciones ni predicciones.':'Your reports only. Your team sees these too. No scores or predictions.'}</p>{featureEnabled(ctx.data,'assessments')?<>
    <Panel title={spanish?'Tus registros recientes':'Your recent check-ins'}><TrendChart patient={p} all/></Panel>
    <PatientResponseHistory p={p} ctx={ctx} lang={lang}/>
    <div className="mt-5 stack" aria-label={spanish?'Registros actuales':'Current check-ins'}>{current.map(checkin=><Panel key={checkin.id}><div className="padded"><Badge>{formatDate(checkin.date,checkin.date.length>10)}</Badge>{checkin.source==='Stored trajectory'&&<small>{spanish?'De tu historial de resultados':'From your outcome history'}</small>}<p>{t.pain}: {checkin.pain}/10 · {t.function}: {checkin.function}/10 · {t.sleep}: {checkin.sleep}/10</p>{ownNote(checkin)&&<CheckinNoteReadback note={checkin.note} lang={lang}/>}</div></Panel>)}</div>
    {historicalCount>0&&<details className="mt-5"><summary>{spanish?'Registros retirados':'Withdrawn check-ins'} ({historicalCount})</summary><p>{spanish?'Estos registros se conservan como historial y ya no se usan en tus valores actuales.':'These records remain in your history and are no longer used as current values.'}</p><div className="stack">
      {withdrawnReports.map(entries=><Panel key={entries[0].workflowRecordId}><div className="padded"><Badge>{spanish?'Retirado':'Withdrawn'} · {formatDate(entries[0].withdrawnAt!,true)}</Badge><p>{setAside}</p><ul>{entries.map(entry=><li key={entry.id}>{t[entry.metric]}: {recordedResponse(entry)}</li>)}</ul></div></Panel>)}
      {otherWithdrawn.map(checkin=><Panel key={checkin.id}><div className="padded"><Badge>{spanish?'Retirado':'Withdrawn'} · {formatDate(checkin.withdrawnAt!,true)}</Badge><p>{setAside}</p><p>{t.pain}: {checkin.pain}/10 · {t.function}: {checkin.function}/10 · {t.sleep}: {checkin.sleep}/10</p>{ownNote(checkin)&&<CheckinNoteReadback note={checkin.note} lang={lang}/>}</div></Panel>)}
    </div></details>}
  </>:<EmptyState title={spanish?'Registros desactivados':'Assessments off'} description={spanish?'Los registros anteriores se conservan.':'Check-in collection and outcome views are turned off. Existing records are retained.'}/>}</>;
}
function CompanionView({p,ctx,lang,accounts,onAccount,onLang,languageBusy=false,accessibilityPreferences=[]}:{p:Patient;ctx:Context;lang:'en'|'es';accounts?:{value:string;label:string}[];onAccount?:(id:string)=>void;onLang?:(lang:'en'|'es')=>void;languageBusy?:boolean;accessibilityPreferences?:string[]}){
  const t=translations[lang];
  const [tab,setTab]=useState('today'),[education,setEducation]=useState(false),[help,setHelp]=useState(false),[helpText,setHelpText]=useState(''),[helpUrgency,setHelpUrgency]=useState<'routine'|'urgent'>('urgent');
  const helpRequest=useRef<{signature:string;id:string}|null>(null);
  const sendingHelp=useRef(false);
  const [helpError,setHelpError]=useState('');
  async function requestHelp(event:FormEvent){
    event.preventDefault();if(ctx.busy||sendingHelp.current)return;
    const command={type:'advisor.request' as const,patientId:p.id,text:helpText,concernUrgency:helpUrgency};
    const signature=JSON.stringify(command);
    if(helpRequest.current?.signature!==signature)helpRequest.current={signature,id:crypto.randomUUID()};
    sendingHelp.current=true;setHelpError('');
    try{if(await ctx.save({...command,requestId:helpRequest.current.id},lang==='es'?'Aviso guardado para tu equipo':'Your team has a new alert')){helpRequest.current=null;setHelp(false);setHelpText('');setHelpUrgency('urgent');}else setHelpError(lang==='es'?'No se ha guardado. Conservamos tu mensaje para volver a intentarlo.':'Your request was not saved. Your message is still here so you can try again.');}
    catch{setHelpError(lang==='es'?'No se ha guardado. Conservamos tu mensaje para volver a intentarlo.':'Your request was not saved. Your message is still here so you can try again.');}
    finally{sendingHelp.current=false;}
  }
  const largePrint=accessibilityPreferences.some(value=>['large-print','large print'].includes(value.toLowerCase()));
  const hour=new Date().getHours();
  const hello=lang==='es'?(hour<12?'Buenos días':hour<19?'Buenas tardes':'Buenas noches'):(hour<12?'Good morning':hour<19?'Good afternoon':'Good evening');
  const latestReport=visitObservations(p).at(-1);
  const lastPain=latestReport?.pain,lastSleep=latestReport?.sleep,lastFn=latestReport?.function;
  const nextMed=p.medications.find(m=>m.status==='Active');
  return <div className={'companion-surface redesigned-companion clinician-companion'+(largePrint?' companion-large-print':'')} lang={lang}>
    <div className="companion-header">
      <div className="companion-identity"><span className="companion-brand"><Activity size={18}/>MobileNetrix</span><strong>{p.name}</strong><small>{lang==='es'?'Registros diarios y preparación de tu visita':'Daily check-ins & visit preparation'}</small></div>
      <div className="companion-account">
        {onLang&&<select aria-label={lang==='es'?'Idioma':'Language'} value={lang} disabled={ctx.busy||languageBusy} onChange={event=>onLang(event.target.value as 'en'|'es')}><option value="en">EN</option><option value="es">ES</option></select>}
        {accounts&&onAccount&&<Picker label={lang==='es'?'Cuenta':'Account'} value={p.id} onChange={onAccount} options={accounts}/>}
      </div>
    </div>
    <Tabs value={tab} onValueChange={setTab} className="companion-shell">
    <TabsList className="companion-tabs" aria-label={lang==='es'?'Tu atención':'Your care'}>
      <TabsTrigger value="today"><Heart size={18}/>{lang==='es'?'Registro':'Check-in'}</TabsTrigger>
      <TabsTrigger value="meds"><Pill size={18}/>{lang==='es'?'Medicamentos':'Medications'}</TabsTrigger>
      <TabsTrigger value="progress"><Activity size={18}/>{t.progress}</TabsTrigger>
      <TabsTrigger value="plan"><Route size={18}/>{t.plan}</TabsTrigger>
      <TabsTrigger value="messages"><MessageSquare size={18}/>{t.messages}</TabsTrigger>
    </TabsList>
    <div className="companion-body">
      <TabsContent value="today" forceMount hidden={tab!=='today'}>
        <div className="companion-welcome"><p>{hello}, {p.name.split(' ')[0]}.</p><h2>{lang==='es'?'¿Cómo estás hoy?':'How are you today?'}</h2><span>{lang==='es'?'Un registro diario rápido ayuda a tu equipo a ver cómo estás entre visitas. También puedes revisar tus medicamentos o añadir preguntas antes de tu próxima visita.':'A quick daily check-in helps your care team see how you are doing between visits. You can also review your medications or add questions before your next visit.'}</span></div>
        <div className="companion-preparation-actions">
          <button type="button" onClick={()=>setTab('meds')}><span className="companion-preparation-icon"><Pill size={19}/></span><span><strong>{lang==='es'?'Revisa tus medicamentos':'Review your medications'}</strong><small>{nextMed?nextMed.name+(p.medications.filter(m=>m.status==='Active').length>1?(lang==='es'?' y otros':' and others'):''):(lang==='es'?'Qué tomas y cómo te afecta':'What you take and how it affects you')}</small></span><ChevronRight size={17}/></button>
          <button type="button" onClick={()=>setTab('messages')}><span className="companion-preparation-icon"><MessageSquare size={19}/></span><span><strong>{lang==='es'?'Preguntas para tu equipo':'Questions for your team'}</strong><small>{lang==='es'?'Añade lo que quieres hablar':'Add what you want to discuss'}</small></span><ChevronRight size={17}/></button>
        </div>
        {(lastPain!=null||lastSleep!=null||lastFn!=null)&&<div className="companion-latest-report"><span>{lang==='es'?'Últimos valores registrados':'Latest recorded values'}{latestReport?' · '+formatDate(latestReport.date):''}</span><div className="companion-snapshot" aria-label={lang==='es'?'Tu último registro':'Your last check-in'}>
          <div><span>{lang==='es'?'Dolor':'Pain'}</span><strong>{lastPain!=null?`${lastPain}/10`:(lang==='es'?'Sin datos':'Not recorded')}</strong></div>
          <div><span>{lang==='es'?'Sueño':'Sleep'}</span><strong>{lastSleep!=null?`${lastSleep}/10`:(lang==='es'?'Sin datos':'Not recorded')}</strong></div>
          <div><span>{lang==='es'?'Actividad':'Function'}</span><strong>{lastFn!=null?`${lastFn}/10`:(lang==='es'?'Sin datos':'Not recorded')}</strong></div>
        </div></div>}
        <div className="companion-worse-bar"><div><strong>{lang==='es'?'¿Necesitas hablar con tu equipo antes?':'Need your team to review a change sooner?'}</strong><p>{lang==='es'?'Informa de dolor nuevo o de un efecto secundario.':'Report worsening pain or a new side effect.'}</p></div><button type="button" className="companion-worse" onClick={()=>setHelp(true)}><TriangleAlert size={18}/>{lang==='es'?'Estoy peor':'I am worse'}</button></div>
        <PatientCheckin p={p} ctx={ctx} lang={lang}/>
        <div className="companion-shortcuts">
          <button type="button" onClick={()=>setTab('plan')}><Route size={16}/>{lang==='es'?'Mi plan':'My plan'}</button>
          <button type="button" onClick={()=>setEducation(true)}><BookOpen size={16}/>{lang==='es'?'Preparar mi visita':'Prepare for my visit'}</button>
          <button type="button" onClick={()=>setTab('messages')}><MessageSquare size={16}/>{lang==='es'?'Mensaje':'Message'}</button>
        </div>
      </TabsContent>
      <TabsContent value="progress" forceMount hidden={tab!=='progress'}><CompanionProgress p={p} ctx={ctx} lang={lang}/></TabsContent>
      <TabsContent value="plan" forceMount hidden={tab!=='plan'}>
        <h2 className="mb-3">{lang==='es'?'Tu plan':'Your plan'}</h2>
        <Panel className="goal-panel"><Target size={20}/><div className="eyebrow mt-2">{t.goal}</div><blockquote>{p.goal?'“'+p.goal+'”':(lang==='es'?'Aún no hay un objetivo registrado.':'No goal recorded yet.')}</blockquote></Panel>
        <PatientPlan p={p} ctx={ctx} lang={lang} patientMode/>
        {featureEnabled(ctx.data,'pathways')&&p.pathway&&<Panel title={lang==='es'?'Tus próximos pasos':'Your next steps'}><div className="padded"><Completion value={Math.round(p.completed.length/5*100)} label={lang==='es'?'Completado':'Completed'}/></div>{pathwaySteps.map((s,i)=><div className="companion-step" key={s.id}><span className={p.completed.includes(s.id)?'done':''}>{p.completed.includes(s.id)?<Check size={17}/>:i+1}</span><div><h3>{lang==='es'?['Confirmar tus objetivos','Completar un registro inicial','Revisar tu historial con el equipo','Documentar el plan acordado','Revisar tu progreso'][i]:s.title}</h3><p>{p.completed.includes(s.id)?(lang==='es'?'Completado':'Completed'):(lang==='es'?'Tu equipo coordinará este paso.':'Your care team will coordinate this step.')}</p></div></div>)}</Panel>}
      </TabsContent>
      <TabsContent value="meds" forceMount hidden={tab!=='meds'}><CompanionMeds p={p} ctx={ctx} lang={lang}/></TabsContent>
      <TabsContent value="messages" forceMount hidden={tab!=='messages'}><div className="companion-section-intro"><h2>{lang==='es'?'Habla con tu equipo':'Talk with your care team'}</h2><p>{lang==='es'?'Envía preguntas sobre tus medicamentos o tu plan. Un mensaje guardado no confirma que lo hayan leído.':'Ask about your medications or care plan. A saved message does not confirm that your team has read it.'}</p></div>{featureEnabled(ctx.data,'messages')?<Panel><MessageThread p={p} ctx={ctx} patientMode spanish={lang==='es'}/></Panel>:<EmptyState title={lang==='es'?'Mensajes no disponibles':'Messaging is turned off'}/>}</TabsContent>
    </div>
    </Tabs>
    <Dialog open={help} onOpenChange={setHelp}><DialogContent><DialogHeader><DialogTitle>{lang==='es'?'Estoy peor':'I am worse'}</DialogTitle><DialogDescription>{lang==='es'?'Esto avisa a tu equipo. No sustituye una emergencia.':'This alerts your care team. It does not replace emergency care.'}</DialogDescription></DialogHeader>
      <div className="companion-emergency"><strong>{lang==='es'?'¿Es una emergencia?':'Is this an emergency?'}</strong><p>{lang==='es'?'Llama al 911. Para una crisis de salud mental, llama o envía un mensaje al 988.':'Call 911. For a mental health crisis, call or text 988.'}</p></div>
      {helpError&&<p role="alert">{helpError}</p>}
      <form className="entry-form" onSubmit={requestHelp}><label>{lang==='es'?'¿Qué ha cambiado?':'What changed?'}<Textarea required maxLength={6000} rows={4} value={helpText} onChange={e=>setHelpText(e.target.value)} placeholder={lang==='es'?'El dolor es peor, está en un sitio nuevo, o hay un efecto secundario.':'Pain is worse, it is in a new place, or there is a new side effect.'}/></label>
      <label>{lang==='es'?'¿Quieres que te llamen antes?':'Should they call you sooner?'}<select value={helpUrgency} onChange={event=>setHelpUrgency(event.target.value as typeof helpUrgency)}><option value="routine">{lang==='es'?'En la próxima revisión':'At the next review'}</option><option value="urgent">{lang==='es'?'Sí, esto no puede esperar':'Yes, this cannot wait'}</option></select></label>
      <p className="muted">{lang==='es'?'Guardar no confirma que el equipo lo haya visto todavía.':'Saving does not confirm that the team has seen it yet.'}</p>
      <div className="form-actions"><Button type="submit" disabled={ctx.busy||!helpText.trim()}>{lang==='es'?'Avisar a mi equipo':'Alert my team'}</Button></div></form>
    </DialogContent></Dialog>
    <Dialog open={education} onOpenChange={setEducation}><DialogContent><DialogHeader><DialogTitle>{lang==='es'?'Prepara tu revisión':'Prepare for your review'}</DialogTitle><DialogDescription>{lang==='es'?'Decide lo que quieres compartir antes de tu visita.':'Choose what you want to share before your visit.'}</DialogDescription></DialogHeader>
      <div className="education-content">{(lang==='es'?['Elige “Antes de mi visita” en tu registro de hoy y completa las respuestas que quieras compartir. Puedes dejar preguntas sin responder.','Anota lo que tomas, los cambios y los efectos que has notado.','Escribe las preguntas y actividades que más te importan.']:['Choose “Before my visit” in today’s check-in, then complete the answers you want to share. You can leave questions unanswered.','Record what you take, anything that changed, and effects you noticed.','Write down your questions and the activities that matter to you.']).map((s,i)=><p key={s}><strong>{i+1}.</strong>{s}</p>)}</div>
      <RecommendationDetails label={lang==='es'?'¿Para qué sirve esta preparación?':'Why prepare this information?'} title={lang==='es'?'Ayuda a organizar tu revisión':'Help organize your review'} rationale={lang==='es'?['Tus respuestas se guardan en tu registro para que tu equipo pueda revisarlas.','Las notas de medicamentos siguen siendo tu informe hasta que el profesional las verifique.']:['Your submitted responses are saved in your record for your care team to review.','Medication notes remain your report until your clinician verifies them.']} limitations={[lang==='es'?'Estas son instrucciones para usar la aplicación, no un consejo de tratamiento.':'These are instructions for using the app, not treatment advice.']}/>
    </DialogContent></Dialog>
    <style>{`.companion-large-print .companion-body p,.companion-large-print .companion-body label,.companion-large-print .companion-body button{font-size:1.125rem;line-height:1.6}.companion-large-print .companion-body small{font-size:1rem;line-height:1.6}`}</style>
    <p className="companion-demo-link"><Link href="/">{lang==='es'?'Espacio clínico':'Clinician workspace'}</Link></p>
  </div>;
}
export function ShowcaseRecords({ctx}:{ctx:Context}){
  const loaded=(ctx.data.showcaseVersion??0)>=showcaseVersion;
  const counts=[
    ['Saved engine runs',ctx.data.engineRuns?.length??0],
    ['Clinician decisions',ctx.data.engineDecisions?.length??0],
    ['Advisor exchanges',ctx.data.advisorTurns?.length??0],
    ['Saved dashboards',ctx.data.dashboardProfiles?.length??0],
    ['Configuration snapshots',ctx.data.configurationHistory?.length??0],
  ] as const;
  return <Panel className="showcase-records" title="Program records" subtitle="The saved records behind every workflow in this workspace.">
    <div className="padded stack">
      <Badge tone={loaded?'teal':'amber'}>{loaded?'Loaded in this workspace':'Available to load'}</Badge>
      <p>Every workspace opens with saved Digital Twin runs, PST and Shadow comparisons, a recorded clinician decision, {ADVISOR_NAME} conversations with care-team handoffs and a confirmed check-in, patient Digital Twin display settings, saved doctor dashboards, and an FDA planning snapshot. A workspace created before these records existed can load them once.</p>
      <div className="showcase-counts">{counts.map(([label,count])=><div key={label}><strong>{count}</strong><span>{label}</span></div>)}</div>
      <div className="showcase-actions">{!loaded&&<Button disabled={ctx.busy} onClick={()=>ctx.save({type:'showcase.load'},'Program records loaded')}><Database size={16}/>{ctx.busy?'Loading…':'Load program records'}</Button>}<ResetDemoControl ctx={ctx}/></div>
      <div className="subtle-notice">Nothing in this workspace is a clinical prediction, an efficacy estimate, a drug recommendation, or a validated instrument score. Loading records never replaces your existing patients, edits, or saved records. Reset demo data does, after you confirm, and Undo can bring them back.</div>
    </div>
  </Panel>;
}
const integrations=[
  {name:'Tabia',icon:Database,category:'Clinical data layer',status:'Not connected',tone:'amber' as const,body:'Normalized patient records, care events, and EHR write-back.',environment:'No partner sandbox provisioned',activity:'Contract and API contract in review',scope:'Demographics, care events, medication records, encounter history.',owner:'Platform engineering \u00b7 Dr. Maya Chen (clinical sign-off)',requirements:['Production tenant provisioning and signed data-processing agreement.','Patient matching by MRN (planned).','Write-back validation for care plans and documented decisions.','Clinical review of the record-mapping rules before first patient.']},
  {name:'SMART on FHIR',icon:Plug,category:'EHR launch',status:'Not connected',tone:'amber' as const,body:'Patient and encounter context when launched from an EHR.',environment:'No EHR tenant registered',activity:'App registration and scope approval pending',scope:'Patient, Encounter, Practitioner, Observation (read).',owner:'Integration team',requirements:['App registration and scope approval in each customer EHR tenant.','Patient matching by MRN (planned).','Single sign-on mapping from EHR identity to workspace roles.','Site-by-site launch testing with the customer\u2019s informatics team.']},
  {name:'MobileNetrix',icon:Smartphone,category:'Patient application',status:'Not connected',tone:'amber' as const,body:'Patient application, instruments, and patient-reported observations.',environment:'Existing app, not yet linked',activity:'Patient check-ins are entered in this workspace',scope:'Check-ins, goals, care-plan views, patient messages.',owner:'Patient experience team',requirements:['Licensed instrument agreements before scored questionnaires are shown.','Push notification and language coverage for the enrolled population.','Accessibility review of the patient surfaces at production scale.']},
  {name:'PST service',icon:Layers,category:'Treatment model',status:'Available in workspace',tone:'blue' as const,body:'Strategy comparison runs on saved patient data. A licensed clinical treatment engine is not connected.',environment:'In-workspace rules \u00b7 connected-engine v1',activity:'No saved runs',scope:'Saved observations, medication response, patient priorities.',owner:'Clinical informatics',requirements:['A licensed treatment-selection service and documented API contract.','Clinical drug candidates, combination simulation, and mechanistic evidence.','Validation of the ranking against clinician decisions before release.']},
  {name:'Digital Twin',icon:Activity,category:'Patient model',status:'Available in workspace',tone:'blue' as const,body:'Observed trajectories and scenario targets are assembled from the saved record.',environment:'In-workspace rules \u00b7 connected-engine v1',activity:'No saved runs',scope:'Pain, function, and sleep observations with care-team context.',owner:'Clinical informatics',requirements:['Versioned predictive models with calibration and uncertainty reporting.','A recalibration schedule and drift monitoring per population.','Prospective clinical validation before any prediction is displayed.']},
  {id:'shadow-advisor',name:ADVISOR_INTEGRATION_NAME,icon:Brain,category:'AI services',status:'Available in workspace',tone:'blue' as const,body:'Shadow AI reviews the same saved records as PST. External AI services and autonomous support are not connected.',environment:'In-workspace rules \u00b7 connected-engine v1',activity:'No saved advisor exchanges',scope:'Saved records, patient messages, care-team handoffs.',owner:'Clinical informatics',requirements:['A hosted inference service with logging, evaluation, and rollback.','Escalation routing and on-call coverage for urgent patient messages.','Clinical governance sign-off on any patient-facing advice.']},
];
function integrationCards(ctx:Context){
  const now=new Date().toISOString();
  const latestDate=(rows:readonly {date:string}[])=>rows.map(row=>row.date).sort().at(-1);
  return integrations.map(card=>{
    const features=card.name==='PST service'?['pst'] as const:card.name==='Digital Twin'?['digitalTwin'] as const:card.id==='shadow-advisor'?['shadow','advisor'] as const:[];
    if(!features.length)return card;
    const availability=features.map(feature=>featureAvailability(ctx.data,feature,now)),unavailable=availability.find(item=>!item.usable);
    const runDate=latestDate(ctx.data.engineRuns??[]),advisorDate=latestDate(ctx.data.advisorTurns??[]);
    const activity=card.id==='shadow-advisor'?`Engine run: ${runDate?formatDate(runDate,true):'None saved'} · Advisor exchange: ${advisorDate?formatDate(advisorDate,true):'None saved'}`:runDate?'Last saved run: '+formatDate(runDate,true):'No saved runs';
    return {...card,status:unavailable?(availability.some(item=>item.enabled)?'Review required':'Off in settings'):'Available in workspace',tone:unavailable?'amber' as const:'blue' as const,activity,body:unavailable?card.body+' '+unavailable.reason:card.body};
  });
}
export function WorkspaceSettings({ctx}:{ctx:Context}){const connections=integrationCards(ctx);const [integration,setIntegration]=useState<string|null>(null);const requestedTab=useLocationParameter('tab'),tab=requestedTab&&['features','integrations','access','audit'].includes(requestedTab)?requestedTab:'features';return <div className="workflow-page settings-workspace"><PageTitle eyebrow="ADMINISTRATION" title="Workspace settings" description="Manage capabilities, access, and program records."/><WorkflowWorkbench workspace={ctx.data} mode="settings" busy={ctx.busy} onAction={ctx.save} actor={ctx.user}/><Tabs value={tab} onValueChange={t=>{const params=new URLSearchParams(window.location.search);params.set('tab',t);window.history.replaceState(null,'','?'+params.toString());window.dispatchEvent(new PopStateEvent('popstate'));}}><TabsList variant="line" className="app-tabs mb-6"><TabsTrigger value="features">Capabilities & planning</TabsTrigger><TabsTrigger value="integrations">Integrations</TabsTrigger><TabsTrigger value="access">Account & access</TabsTrigger><TabsTrigger value="audit">Audit history</TabsTrigger></TabsList><TabsContent value="features" forceMount hidden={tab!=='features'}><ConfigurationSettings ctx={ctx}/></TabsContent><TabsContent value="integrations"><div className="subtle-notice mb-5" role="note"><Database size={16} aria-hidden="true"/><p>Your <Term t="EHR"/> remains the record of truth. TheraNetrix is planned to interoperate with Epic, Oracle Health (Cerner) and other EHRs through <Term t="SMART on FHIR"/>. No EHR is connected in this prototype.</p></div><Panel title="Connection walkthrough" subtitle="Inspect report matching, sharing and delivery in Program workflows."><Button variant="outline" onClick={()=>{const params=new URLSearchParams(window.location.search);params.set('tab','integrations');params.set('workflow','integration-access');window.history.replaceState(null,'','?'+params.toString());window.dispatchEvent(new PopStateEvent('popstate'));openWorkflow('integration-access');}}>Open connection walkthrough <ArrowUpRight size={14}/></Button></Panel><div className="integrations-grid mt-5">{connections.map(x=><Panel className="integration-card" key={x.name}><div><span className="integration-icon"><x.icon size={24}/></span><Badge tone={x.tone}>{x.status}</Badge></div><small>{x.category}</small><h2>{x.name}</h2><p>{x.body}</p><dl className="integration-facts"><dt>Environment</dt><dd>{x.environment}</dd><dt>Last activity</dt><dd>{x.activity}</dd></dl><Button variant="outline" onClick={()=>setIntegration(x.name)}>View connection details <ArrowUpRight size={14}/></Button></Panel>)}</div></TabsContent><TabsContent value="access"><div className="patient-grid settings-access-grid"><Panel title={ctx.preview?'Preview access':ctx.accessMode==='shared'?'Workspace access':'Your account'}><div className="account-card"><span className="account-symbol"><UserRound size={28}/></span><h2>{ctx.user}</h2><Badge tone="teal">{ctx.preview?'Sample workspace':ctx.accessMode==='shared'?'Open access':'Workspace owner'}</Badge><p>{ctx.preview?'Explore with sample patients only. Changes stay in this local preview and reset on refresh. No real patient records are updated and no messages or notifications are sent.':ctx.accessMode==='shared'?'Open the workspace directly. Everyone with the link shares the same records and saved changes.':'This workspace is protected by an access code. People with the code share this owner workspace and every record saved in it.'}</p>{ctx.accessMode!=='shared'&&<Button variant="outline" onClick={ctx.signOut}>Sign out</Button>}</div></Panel><Panel title="Clinical role model" subtitle="Planned permissions for the connected production app"><div className="role-list">{[['Pain physician','Review outputs, document decisions, and manage care plans.'],['Advanced practice provider','Review patient context and coordinate clinician-led care.'],['RN care coordinator','Coordinate tasks, check-ins, and escalations.'],['Patient','Access their own check-ins, goals, and care-team messages.']].map(([role,description])=><div key={role}><h3>{role}</h3><p>{description}</p><Badge>Production integration required</Badge></div>)}</div></Panel><ShowcaseRecords ctx={ctx}/></div></TabsContent><TabsContent value="audit"><Panel title="Workspace audit history" subtitle={ctx.accessMode==='shared'?'Every saved action and its recorded actor. New changes use Shared workspace visitor.':'Every saved action and its recorded workspace actor.'} action={<Button variant="outline" onClick={()=>download('theranetrix-audit.json',ctx.data.audit)}><Download size={15}/>Export log</Button>}>{ctx.data.audit.length?<Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>Action</TableHead><TableHead>Patient</TableHead><TableHead>Actor</TableHead></TableRow></TableHeader><TableBody>{ctx.data.audit.map(a=><TableRow key={a.id}><TableCell>{formatDate(a.date,true)}</TableCell><TableCell>{a.action}</TableCell><TableCell>{ctx.data.patients.find(p=>p.id===a.patientId)?.name??'Workspace'}</TableCell><TableCell>{a.actor}</TableCell></TableRow>)}</TableBody></Table>:<EmptyState title="Your first change starts the history" description="Add a note, complete an activity, or change a capability to create an audit entry."/>}</Panel></TabsContent></Tabs><Sheet open={!!integration} onOpenChange={v=>{if(!v)setIntegration(null);}}><SheetContent className="detail-sheet">{(()=>{const x=connections.find(i=>i.name===integration);return <><SheetHeader><SheetTitle>{integration}</SheetTitle><SheetDescription>{x?x.category+' \u00b7 '+x.status:'Connection details'}</SheetDescription></SheetHeader><div className="padded stack"><Badge tone={x?.tone??'neutral'}>{x?.status??'Connection details'}</Badge><dl className="detail-list"><dt>Environment</dt><dd>{x?.environment}</dd><dt>Last activity</dt><dd>{x?.activity}</dd><dt>Data in scope</dt><dd>{x?.scope}</dd><dt>Owner</dt><dd>{x?.owner}</dd></dl><h3>Remaining for production release</h3><div className="requirement-list">{(x?.requirements??[]).map((r,i)=><div key={r}><span>{i+1}</span><p>{r}</p></div>)}</div><div className="subtle-notice">Do not enter secrets or real patient information into these records. Integration credentials need a server-managed configuration.</div></div></>;})()}</SheetContent></Sheet></div>;}
