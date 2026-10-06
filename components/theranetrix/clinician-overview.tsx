'use client';
import Link from 'next/link';
import {useState,type ReactNode,type CSSProperties} from 'react';
import {DoctorDashboard} from './dashboard-customize';
import {type DashboardLayout} from '@/lib/dashboard-layout';
import {Search,Plus,Pill,CalendarDays,ArrowUpRight,ArrowDownRight,ArrowRight,ChevronDown,Users,CircleAlert,HeartPulse,MessageCircle,Activity,Check,Clock} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {type Patient,featureEnabled} from '@/lib/theranetrix';
import {activeMedications,patientSuggestions,priorityReviews,followupState} from '@/lib/medications';
import {EngineEncounterSummary} from './live-engine-summary';
import {type Context} from './app';
import {PageTitle,Panel,Badge,PatientName,Picker,EmptyState,formatDate} from './ui';
import {dobText} from './patient-identity';
import {MedicationDialog,PlanDialog} from './medications';
import {PatientReviewDetails} from './patient-review-details';
import {PatientStories} from './patient-stories';
import {RecommendationDetails} from './recommendation-details';
import {overviewRecommendationDetails} from '@/lib/patient-panel';
import {visitObservations} from '@/lib/visit-presentation';
import {ReportScore,ReportFooter,ReportDateIcon} from './report-score';

type OpenPatient = (patientId: string, trigger: HTMLElement) => void;

const columnTitles={medications:'Current medications',outcomes:'Latest report',plan:'Review focus'};
function OutcomePreview({p}:{p:Patient}){
  const points=visitObservations(p),latest=points.at(-1),previous=points.at(-2);
  const painChange=latest?.pain!=null&&previous?.pain!=null?latest.pain-previous.pain:null;
  return <div className="triage-outcomes">{(['pain','function','sleep'] as const).map(key=><div key={key}><ReportScore metric={key} value={latest?.[key]}/></div>)}<ReportFooter>{painChange!==null&&<small className={'triage-pain-change '+(painChange<0?'text-teal':painChange>0?'text-rose':'')}>{painChange<0?<ArrowDownRight size={13}/>:painChange>0?<ArrowUpRight size={13}/>:null}Pain {painChange===0?'unchanged':Math.abs(painChange)+' '+(painChange<0?'lower':'higher')} than prior report</small>}<small className="triage-observation-date">{latest&&<ReportDateIcon/>}{latest?'Reported '+formatDate(latest.date):'No check-in yet'}</small></ReportFooter></div>;
}

export function ClinicianOverview({ctx,onOpenPatient}:{ctx:Context;onOpenPatient?:OpenPatient}){return <DoctorDashboard ctx={ctx}>{(layout,controls,key)=><ClinicianBoard key={key} ctx={ctx} layout={layout} controls={controls} onOpenPatient={onOpenPatient}/>}</DoctorDashboard>;}

export function ClinicianBoard({ctx,layout,controls,onOpenPatient}:{ctx:Context;layout:DashboardLayout;controls?:ReactNode;onOpenPatient?:OpenPatient}){
  const [query,setQuery]=useState(''),[filter,setFilter]=useState<string>(layout.filter),[clinician,setClinician]=useState(layout.clinician),[medicationPatient,setMedicationPatient]=useState<string|null>(null),[planPatient,setPlanPatient]=useState<string|null>(null),[expanded,setExpanded]=useState<string|null>(null);
  const {data}=ctx,today=new Date().toISOString().slice(0,10);
  const rows=data.patients.map(p=>{const suggestions=patientSuggestions(p,data),reviews=priorityReviews(data,p),meds=activeMedications(p);return {p,suggestions,reviews,meds,attention:p.status==='Needs review'||reviews.length>0||suggestions.some(s=>s.attention),benefit:meds.some(m=>m.benefit==='Helpful'||m.benefit==='Partly helpful'),unknown:(!meds.length&&!p.medicationReconciliation?.none)||meds.some(m=>m.benefit==='Not assessed'),effects:meds.some(m=>m.tolerability==='Effects reported'),plan:p.carePlans[0]};});
  const assignedRows=rows.filter(r=>clinician==='All clinicians'||r.p.clinician===clinician);
  const visible=assignedRows.filter(r=>(r.p.name+' '+r.p.id+' '+r.p.condition+' '+r.meds.map(m=>m.name).join(' ')).toLowerCase().includes(query.toLowerCase())&&(filter==='All patients'||filter==='Needs review'&&r.attention||filter==='Benefit reported'&&r.benefit||filter==='Response missing'&&r.unknown||filter==='Side effects reported'&&r.effects)).sort((a,b)=>layout.sort==='name'?a.p.name.localeCompare(b.p.name):layout.sort==='visit'?(a.p.nextVisit||'9999').localeCompare(b.p.nextVisit||'9999')||a.p.name.localeCompare(b.p.name):(a.reviews.some(r=>r.priority==='High')?0:a.effects?1:a.attention?2:3)-(b.reviews.some(r=>r.priority==='High')?0:b.effects?1:b.attention?2:3)||a.p.name.localeCompare(b.p.name));
  const summaries=[{label:'All patients',count:assignedRows.length,filter:'All patients',tone:'',icon:Users},{label:'Need review',count:assignedRows.filter(r=>r.attention).length,filter:'Needs review',tone:'rose',icon:CircleAlert},{label:'Report benefit',count:assignedRows.filter(r=>r.benefit).length,filter:'Benefit reported',tone:'teal',icon:HeartPulse},{label:'Side effects',count:assignedRows.filter(r=>r.effects).length,filter:'Side effects reported',tone:'amber',icon:Pill},{label:'Response missing',count:assignedRows.filter(r=>r.unknown).length,filter:'Response missing',tone:'',icon:MessageCircle}];
  return <div className="care-overview-redesign dashboard-feedback"><PageTitle title="Care overview" description="Patient reports and priorities for your next review." actions={<><Button variant="outline" asChild><Link href="/schedule"><CalendarDays size={16}/>Schedule</Link></Button><Button onClick={()=>ctx.open('patient')}><Plus size={16}/>Add patient</Button></>}/>
    <div className="overview-preparation"><span><Clock size={15}/><strong>Pre-visit preparation</strong>Reports and open concerns before the visit</span><Link href="/review-queue">{data.reviews.filter(r=>r.status!=='Resolved').length} open concerns<ArrowRight size={14}/></Link></div>
    {layout.showSummary&&<div className="triage-summary" aria-label="Filter patients by review need">{summaries.map(s=><button key={s.label} onClick={()=>setFilter(s.filter)} aria-pressed={filter===s.filter} className={'triage-summary-card '+s.tone}><s.icon size={16}/><span className="triage-stat-label">{s.label}</span><strong>{s.count}</strong></button>)}</div>}
    <Panel id="clinician-overview" className={'triage-board dashboard-density-'+layout.density}>
      <div className="triage-board-heading"><div><h2>Patient worklist <span>{visible.length}</span></h2><p>{layout.sort==='name'?'Sorted by patient name':layout.sort==='visit'?'Sorted by next visit':'Recorded high-priority concerns first'}</p></div><div className="dashboard-view-controls">{controls}</div></div>
      <div className="table-toolbar triage-filters"><div className="input-search"><Search size={17}/><Input aria-label="Search clinical overview" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search patients, conditions, medications"/></div><Picker value={filter} onChange={setFilter} label="Filter clinical overview" options={['All patients','Needs review','Benefit reported','Side effects reported','Response missing']}/><Picker value={clinician} onChange={setClinician} label="Filter by clinician" options={['All clinicians',...Array.from(new Set(data.patients.map(p=>p.clinician)))]}/>{(query||filter!=='All patients'||clinician!=='All clinicians')&&<Button size="sm" variant="ghost" onClick={()=>{setQuery('');setFilter('All patients');setClinician('All clinicians');}}>Clear</Button>}</div>
      <div className="triage-list" style={{'--triage-columns':layout.columns.length} as CSSProperties}>
        <div className="triage-column-head" aria-hidden="true"><span>Patient / preparation</span>{layout.columns.map(column=><span key={column}>{columnTitles[column]}</span>)}<span>Review</span></div>
        {visible.map(({p,suggestions,reviews,meds,plan,effects})=>{
          const followup=followupState(p,data,today),lead=reviews[0],isExpanded=expanded===p.id;
          const next=suggestions.find(s=>s.kind!=='plan')??suggestions[0];
          const latestReport=visitObservations(p).at(-1)?.date;
          const reviewFocus=lead?.title??next?.title??'Review the patient record';
          const focus=lead?{title:lead.title,reason:lead.detail,kind:'review' as const}:next??{title:reviewFocus,reason:'Review the available record with the patient and agree on the next step.',kind:'plan' as const};
          const focusDetails=<RecommendationDetails {...overviewRecommendationDetails(p,data,focus)} label="Why this review"/>;
          const previews={
            medications:<div className="triage-medication-preview">{meds.length?<><strong>{meds[0].name}{meds.length>1&&<span> +{meds.length-1}</span>}</strong><span>{meds[0].benefit==='Not assessed'?'Benefit not assessed':meds[0].benefit}</span>{effects&&<span className="triage-side-effect"><CircleAlert size={12}/>Side effects reported</span>}</>:<><strong>{p.medicationReconciliation?.none?'None reported':'Needs reconciliation'}</strong><span>{p.medicationReconciliation?.none?'Medication list confirmed':'Current use not confirmed'}</span></>}<button className="overview-direct-action" onClick={()=>setMedicationPatient(p.id)} aria-label={'Review medications for '+p.name}>Review medications<ArrowRight size={12}/></button></div>,
            outcomes:featureEnabled(data,'assessments')?<OutcomePreview p={p}/>:<Badge>Assessments off</Badge>,
            plan:<div className="triage-next-step"><div className="triage-priority"><Badge tone={lead?.priority==='High'?'rose':lead||p.status==='Needs review'?'amber':p.status==='On track'?'teal':'neutral'}>{lead?lead.priority+' priority':p.status}</Badge>{reviews.length>1&&<span>+{reviews.length-1} concern{reviews.length===2?'':'s'}</span>}</div><strong>{reviewFocus}</strong>{focusDetails}<button className="overview-direct-action" onClick={()=>setPlanPatient(p.id)} aria-label={(plan?'Update':'Record')+' plan for '+p.name}>{plan?(followup.completed?'Follow-up complete':followup.overdue?'Update overdue plan':'Review plan'):'Record plan'}<ArrowRight size={12}/></button></div>,
          };
          return <article className={'triage-patient'+(isExpanded?' is-expanded':'')} key={p.id} data-patient-clickable={onOpenPatient ? 'true' : undefined}
            onClick={onOpenPatient ? event => {
              if (!(event.target instanceof Element) || event.target.closest('button,a,input,select,textarea,[role="button"],[role="dialog"]')) return;
              const trigger = event.currentTarget.querySelector<HTMLElement>('[data-patient-trigger]');
              if (trigger) onOpenPatient(p.id, trigger);
            } : undefined}>
            <div className="triage-patient-row"><div className="triage-patient-identity">{onOpenPatient ? <button type="button" className="patient-panel-trigger" data-patient-trigger aria-haspopup="dialog" aria-label={'View patient summary for '+p.name} onClick={event=>onOpenPatient(p.id,event.currentTarget)}><PatientName patient={p} sub={p.condition}/></button> : <Link href={'/patients/'+p.id}><PatientName patient={p} sub={p.condition}/></Link>}<div className="overview-patient-meta"><span>{dobText(p.dateOfBirth)}</span><span>{p.medicalRecordNumber?'MRN '+p.medicalRecordNumber:p.id}</span><span>{p.age} years</span></div><span className={'overview-preparation-status '+(latestReport?'has-report':'needs-report')}>{latestReport?<Check size={12}/>:<Clock size={12}/>} {latestReport?'Patient reports available':'Awaiting patient report'}</span>{!layout.columns.includes('plan')&&<div className="triage-priority"><Badge tone={lead?.priority==='High'?'rose':lead||p.status==='Needs review'?'amber':p.status==='On track'?'teal':'neutral'}>{lead?lead.priority+' priority':p.status}</Badge><span>{reviewFocus}</span>{focusDetails}</div>}</div>
              {layout.columns.map(column=><div className={'triage-preview triage-preview-'+column} key={column}><span className="triage-mobile-label">{columnTitles[column]}</span>{previews[column]}</div>)}
              <div className="triage-row-actions">{onOpenPatient ? <Button size="sm" aria-haspopup="dialog" onClick={event=>onOpenPatient(p.id,event.currentTarget)}>Open patient<ArrowRight size={14}/></Button> : <Button size="sm" asChild><Link href={'/patients/'+p.id}>Open patient<ArrowRight size={14}/></Link></Button>}<button className="triage-expand" onClick={event=>onOpenPatient?onOpenPatient(p.id,event.currentTarget):setExpanded(isExpanded?null:p.id)} aria-haspopup={onOpenPatient?'dialog':undefined} aria-expanded={onOpenPatient?undefined:isExpanded} aria-controls={onOpenPatient?undefined:'patient-review-'+p.id} aria-label={(isExpanded?'Hide':'Show')+' review details for '+p.name}>{isExpanded?'Less detail':'Quick review'}<ChevronDown size={15}/></button></div>
            </div>
            {isExpanded&&<section className="triage-expanded" id={'patient-review-'+p.id} aria-label={'Quick review for '+p.name}>
              <PatientReviewDetails p={p} ctx={ctx} columns={layout.columns} onReviewMedications={()=>setMedicationPatient(p.id)} onReviewPlan={()=>setPlanPatient(p.id)}/>
            </section>}
            {layout.showEngines&&<div className="triage-engine-preview"><EngineEncounterSummary p={p} ctx={ctx} compact/></div>}
          </article>;
        })}
      </div>
      {!visible.length&&<EmptyState title="No matching patients" description="Change your search or clear filters to see your patient panel."/>}
      <div className="panel-bottom"><span>{visible.length} of {assignedRows.length} patients</span><span>Reports describe observations, not completed clinic visits.</span></div>
    </Panel>
    {layout.showEngineIntro&&<Panel className="dashboard-engine-shortcut"><div><Activity size={21}/><div><h2>Treatment and engine workspace</h2><p>Inspect Digital Twin, PST, and Shadow AI in the patient record.</p></div></div><Button variant="outline" asChild><Link href="/engines">Open treatment<ArrowRight size={16}/></Link></Button></Panel>}
    {data.workflowShowcase?<PatientStories workspace={data} busy={ctx.busy} expanded={layout.showDemoLinks}/>:<details className="sample-journeys"><summary><span><strong>Sample patient journeys</strong><small>Explore connected care examples</small></span><ChevronDown size={17}/></summary><div className="sample-journeys-content"><p>Load example encounter, treatment, and coordination records.</p><Button variant="outline" disabled={ctx.busy} onClick={()=>ctx.save({type:'showcase.load'},'Patient stories are ready')}>{ctx.busy?'Loading…':'Load patient stories'}</Button></div></details>}
    <MedicationDialog patientId={medicationPatient} close={()=>setMedicationPatient(null)} ctx={ctx}/><PlanDialog patientId={planPatient} close={()=>setPlanPatient(null)} ctx={ctx}/>
  </div>;
}
