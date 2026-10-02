'use client';
import {RecommendationDetails} from './recommendation-details';
import {patientRecommendationBasis} from '@/lib/patient-recommendation-basis';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Pill,Plus,Check,ClipboardList} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {medicationNameOptions} from '@/lib/medication-presentation';
import {groupMedications} from '@/lib/medication-groups';
import {type Patient} from '@/lib/theranetrix';
import {type Medication,benefits,tolerabilities,medicationAdherence,activeMedications,patientSuggestions} from '@/lib/medications';
import {type Context} from './app';
import {Badge,Picker,Panel,formatDate} from './ui';
import {FormSection,RequiredField} from './forms';

export function MedicationSummary({medication:m}:{medication:Medication}){
  return <div className="medication-summary care-medication-summary"><div className="medication-name"><strong>{m.name}</strong><Badge tone={m.benefit==='No benefit'?'rose':m.benefit==='Helpful'?'teal':'amber'}>{m.benefit==='Not assessed'?'Benefit not assessed':m.benefit}</Badge>{m.status==='Stopped'&&<Badge>Recorded as stopped</Badge>}</div>
    <p className="care-medication-indication"><span>Reason for use</span> {m.indication||'Not recorded'}</p>
    <p className="care-medication-regimen">{m.regimen||'Dose and schedule not recorded'}</p>
    {m.status==='Stopped'&&<p className="care-medication-stopped">Stopped {m.stopped?formatDate(m.stopped):'date unknown'} · {m.stopReason||'Reason not recorded'}</p>}
    <div className="care-medication-response"><div><span>Side effects</span><p className={m.tolerability==='Effects reported'?'text-rose':''}>{m.tolerability==='Effects reported'?m.effects:m.tolerability==='Not assessed'?'Not assessed':'None reported'}</p></div><div><span>Medication use</span><p>{m.adherence==='Not assessed'?'Not assessed':m.adherence}</p></div></div>
    <small className="care-record-source">{m.source==='Patient report'?'Patient-reported':'Clinician-reported'} {formatDate(m.reportedAt)}{m.reviewedAt?' · Reviewed '+formatDate(m.reviewedAt)+(m.reviewedBy?' by '+m.reviewedBy:''):''}</small>
    {m.started&&<small>Started {formatDate(m.started)}{m.regimenSince?' · Current regimen since '+formatDate(m.regimenSince):''}</small>}
  </div>;
}
// Shared split by recorded indication. 'visit' keeps the analgesic and other groups visible when empty;
// 'compact' drops the group descriptions for narrow cards.
export function MedicationGroups({medications,render,variant='review'}:{medications:Medication[];render:(m:Medication)=>React.ReactNode;variant?:'review'|'compact'|'visit'}){
  const visit=variant==='visit';
  return <div className={visit?'visit-medication-groups':'medication-group-list'+(variant==='compact'?' medication-group-compact':'')}>{groupMedications(medications).map(group=>{const entries=group.medications;if(!entries.length&&(!visit||group.id==='unclassified'))return null;return <section className={visit?'visit-medication-group':'medication-category'} key={group.id} aria-label={group.title}>{visit?<h3>{group.title}<span>{entries.length}</span></h3>:<div className="medication-category-heading"><h3>{group.title} <span>{entries.length}</span></h3>{variant==='review'&&<p>{group.description}</p>}</div>}{entries.length?entries.map(render):<p className="visit-medication-empty">{group.empty}</p>}</section>;})}</div>;
}
export function MedicationPanel({p,ctx,inline=false}:{p:Patient;ctx:Context;inline?:boolean}){
  const [review,setReview]=useState(false);const meds=activeMedications(p);
  if(inline)return <Panel title="Medication review" subtitle="Reported benefit, side effects, and use. Edit a record here."><div className="inline-medication-review"><MedicationReview p={p} ctx={ctx} showPrompts={false}/></div></Panel>;
  return <><Panel title="Medication review" subtitle="Recorded use, patient-reported benefit, and tolerability" action={<Button variant="outline" onClick={()=>setReview(true)}><Pill size={16}/>Review medications</Button>}><div className="medication-panel-list">{meds.length?<MedicationGroups medications={meds} render={m=><MedicationSummary key={m.id} medication={m}/>}/>:<p>{p.medicationReconciliation?.none?'Confirmed no current medications reported.':'No active medication entries. Reconcile the medication list with the patient.'}</p>}</div></Panel><MedicationDialog patientId={review?p.id:null} close={()=>setReview(false)} ctx={ctx}/></>;
}
export function MedicationDialog({patientId,close,ctx,initialMedicationId}:{patientId:string|null;close:()=>void;ctx:Context;initialMedicationId?:string}){
  const p=ctx.data.patients.find(p=>p.id===patientId);
  return <Dialog open={!!p} onOpenChange={v=>{if(!v&&!ctx.busy)close();}}><DialogContent className="medication-dialog care-entry-dialog" onOpenAutoFocus={event=>{event.preventDefault();(event.currentTarget as HTMLElement).focus();}}><DialogHeader><DialogTitle>Medication review{p?' · '+p.name:''}</DialogTitle><DialogDescription>Document the patient’s report. Saving does not issue or change a prescription.</DialogDescription></DialogHeader>{p&&<MedicationReview key={p.id+(initialMedicationId??'')} p={p} ctx={ctx} initialEdit={initialMedicationId} directDone={initialMedicationId?close:undefined}/>}</DialogContent></Dialog>;
}
function MedicationReview({p,ctx,showPrompts=true,initialEdit,directDone}:{p:Patient;ctx:Context;showPrompts?:boolean;initialEdit?:string;directDone?:()=>void}){
  const [edit,setEdit]=useState<string|null>(initialEdit??null);const selected=p.medications.find(m=>m.id===edit);
  const current=activeMedications(p),previous=p.medications.filter(m=>m.status==='Stopped');
  function renderMedication(m:Medication){return <div className="medication-review-item" key={m.id}><MedicationSummary medication={m}/><Button variant="outline" disabled={ctx.busy} onClick={()=>setEdit(m.id)}>Review / edit</Button>{m.history.length>1&&<details className="medication-history"><summary>Earlier assessments ({m.history.length-1})</summary>{m.history.slice(1).map((h,i)=><p key={h.date+i}>{formatDate(h.reportedAt)} · {h.name} · {h.status}<br/>{h.regimen||'Regimen not recorded'}<br/>Started {h.started?formatDate(h.started):'date not recorded in this assessment'} · Reason: {h.indication??'Not recorded in this assessment'}<br/>{h.benefit}; {h.tolerability}; {h.adherence}. {h.effects}{h.status==='Stopped'&&<><br/>Stopped {h.stopped?formatDate(h.stopped):'date unknown'} · {h.stopReason||'Reason not recorded'}</>}<br/><small>Recorded {formatDate(h.date,true)} by {h.author}</small></p>)}</details>}</div>;}
  return <div className="medication-review-content feedback-medication-review">{edit!==null?<MedicationForm key={edit} medication={selected} p={p} ctx={ctx} done={()=>directDone?directDone():setEdit(null)}/>:<>
    <div className="medication-review-toolbar"><div><strong>{current.length} current medication{current.length===1?'':'s'}</strong><p>Verify names, use, and tolerance with the patient.</p></div><Button onClick={()=>setEdit('new')}><Plus size={16}/>Add medication record</Button></div>
    {!current.length&&<div className="subtle-notice">{p.medicationReconciliation?.none?<p>Confirmed no current medications reported · {formatDate(p.medicationReconciliation.date)} by {p.medicationReconciliation.author}</p>:<Button variant="outline" disabled={ctx.busy} onClick={()=>ctx.save({type:'medication.none',patientId:p.id},'Medication reconciliation saved')}>Confirm no current medications reported</Button>}</div>}
    <MedicationGroups medications={current} render={renderMedication}/>
    {previous.length>0&&<section className="medication-previous"><div className="medication-category-heading"><h3>Previously tried <span>{previous.length}</span></h3><p>Stopped medications, reported tolerance, and reasons for stopping.</p></div>{previous.map(renderMedication)}</section>}
    {!p.medications.length&&!p.medicationReconciliation?.none&&<div className="subtle-notice">No medication entries are recorded. Confirm current use with the patient.</div>}
    {showPrompts&&<div className="medication-prompts"><h3>Suggested review questions</h3>{patientSuggestions(p,ctx.data).filter(s=>s.kind==='medication').map(s=><div key={s.title}><strong>{s.title}</strong><p>{s.reason}</p><RecommendationDetails title={s.title} {...patientRecommendationBasis(p,ctx.data,s)}/></div>)}</div>}
  </>}</div>;
}
function MedicationForm({medication:m,p,ctx,done}:{medication?:Medication;p:Patient;ctx:Context;done:()=>void}){
  const [benefit,setBenefit]=useState<Medication['benefit']>(m?.benefit??'Not assessed');
  const [tolerability,setTolerability]=useState<Medication['tolerability']>(m?.tolerability??'Not assessed');
  const [adherence,setAdherence]=useState<Medication['adherence']>(m?.adherence??'Not assessed');
  const [status,setStatus]=useState<Medication['status']>(m?.status??'Active');
  const [regimen,setRegimen]=useState(m?.regimen??''),[regimenSince,setRegimenSince]=useState(m?.regimenSince??''),[confirmed,setConfirmed]=useState(false);
  const [error,setError]=useState(''),[saving,setSaving]=useState(false);
  const submitting=useRef(false),errorRef=useRef<HTMLDivElement>(null);
  const pending=ctx.busy||saving;
  useEffect(()=>{if(error||ctx.saveConflict)errorRef.current?.focus();},[error,ctx.saveConflict]);
  const needsConfirmation=!!m&&regimen!==m.regimen&&(benefit!=='Not assessed'||tolerability!=='Not assessed'||adherence!=='Not assessed');
  const today=new Date().toISOString().slice(0,10);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(ctx.busy||submitting.current)return;
    const f=new FormData(e.currentTarget),v=(key:string)=>String(f.get(key)??'').trim();
    submitting.current=true;setSaving(true);setError('');
    try{
      if(await ctx.save({type:'medication.save',patientId:p.id,id:m?.id,name:v('name'),regimen:v('regimen'),indication:v('indication'),started:v('started'),reportedAt:v('reportedAt'),regimenSince:v('regimenSince'),stopped:v('stopped'),stopReason:v('stopReason'),status,benefit,tolerability,adherence,effects:v('effects'),responseConfirmed:confirmed},'Medication review saved'))done();
      else setError('This medication review was not saved. Your entries are still here. Please try again.');
    }catch{setError('This medication review was not saved. Your entries are still here. Please try again.');}
    finally{submitting.current=false;setSaving(false);}
  }
  return <form className="entry-form care-form" onSubmit={submit} aria-busy={pending}>
    {(error||ctx.saveConflict)&&<div className="care-form-error" role="alert" tabIndex={-1} ref={errorRef}><p>{ctx.saveConflict?'A newer workspace was saved. Your entries are still here. Copy any changes you want to keep before loading the latest saved records.':error}</p>{ctx.saveConflict&&ctx.reloadWorkspace&&<Button type="button" variant="outline" disabled={pending} onClick={ctx.reloadWorkspace}>Load latest saved records</Button>}</div>}
    <fieldset disabled={pending}>
    <p className="care-form-key">* Required field</p>
    <FormSection title={m?'Medication record':'Add a medication'} description="Use a new medication record for a different drug.">
      <div className="form-two"><label><span>Medication name <RequiredField/></span><Input required name="name" maxLength={100} defaultValue={m?.name} readOnly={!!m} list={m?undefined:'clinician-medication-names-'+p.id} placeholder="Search or enter a medication name"/>{!m&&<datalist id={'clinician-medication-names-'+p.id}>{medicationNameOptions(p).map(name=><option key={name} value={name}/>)}</datalist>}</label><label>Recorded status<Picker label="Recorded medication status" value={status} onChange={v=>setStatus(v as Medication['status'])} options={['Active','Stopped']}/></label></div>
      <label>Recorded dose, route, and schedule <span className="care-optional">Optional if unconfirmed</span><Input name="regimen" maxLength={200} value={regimen} onChange={e=>{setRegimen(e.target.value);setRegimenSince('');setBenefit('Not assessed');setTolerability('Not assessed');setAdherence('Not assessed');setConfirmed(false);}} placeholder="Leave blank if not yet confirmed"/></label>
      <label><span>Reason for use <RequiredField/></span><Input required name="indication" maxLength={150} defaultValue={m?.indication??''} placeholder="Enter the recorded reason, or Not confirmed"/></label>
    </FormSection>
    {status==='Stopped'&&<FormSection title="Stopping this medication" description="Record the date and reason if confirmed."><div className="form-two"><label>Stopped on <span className="care-optional">Optional</span><Input name="stopped" type="date" max={today} defaultValue={m?.stopped}/></label><label>Recorded reason for stopping <span className="care-optional">Optional</span><Textarea name="stopReason" maxLength={1000} rows={2} defaultValue={m?.stopReason} placeholder="Leave blank if not confirmed"/></label></div></FormSection>}
    <FormSection title="Patient-reported response" description="If you edit the regimen, assess the response again.">
      <div className="form-two"><label>Patient-reported benefit<Picker label="Patient-reported medication benefit" value={benefit} onChange={v=>setBenefit(v as Medication['benefit'])} options={[...benefits]}/></label><label><span>Response reported on <RequiredField/></span><Input name="reportedAt" type="date" required max={today} defaultValue={m?.reportedAt??today}/></label></div>
      <div className="form-two"><label>Reported side effects<Picker label="Reported side effects" value={tolerability} onChange={v=>setTolerability(v as Medication['tolerability'])} options={[...tolerabilities]}/></label><label>Reported medication use<Picker label="Reported medication use" value={adherence} onChange={v=>setAdherence(v as Medication['adherence'])} options={[...medicationAdherence]}/></label></div>
      {tolerability==='Effects reported'&&<label className="care-effects-field"><span>Describe the reported effects <RequiredField/></span><Textarea required name="effects" maxLength={1000} defaultValue={m?.effects} rows={3}/></label>}
      {needsConfirmation&&<label className="response-confirmation"><Checkbox checked={confirmed} onCheckedChange={v=>setConfirmed(v===true)}/>These reports apply to the updated medication regimen.</label>}
    </FormSection>
    <details className="care-optional-section"><summary>Medication timeline <span>Optional dates</span></summary><div className="form-two"><label>Start date, if known<Input name="started" type="date" max={today} defaultValue={m?.started}/></label><label>Current regimen unchanged since, if known<Input name="regimenSince" type="date" max={today} value={regimenSince} onChange={e=>setRegimenSince(e.target.value)}/></label></div></details>
    <div className="form-actions care-form-actions"><Button type="button" variant="outline" onClick={done}>Cancel</Button><Button type="submit" disabled={needsConfirmation&&!confirmed}><Check size={16}/>{pending?'Saving…':'Save review'}</Button></div>
  </fieldset></form>;
}
export function PlanDialog({patientId,close,ctx,initialText}:{patientId:string|null;close:()=>void;ctx:Context;initialText?:string}){
  const p=ctx.data.patients.find(p=>p.id===patientId);
  return <Dialog open={!!p} onOpenChange={v=>{if(!v&&!ctx.busy)close();}}><DialogContent className="entry-dialog care-entry-dialog"><DialogHeader><DialogTitle>Record next steps{p?' · '+p.name:''}</DialogTitle><DialogDescription>Save the assessment and follow-up. A review activity will appear in the schedule.</DialogDescription></DialogHeader>{p&&<PlanForm key={p.id} p={p} ctx={ctx} close={close} initialText={initialText}/>}</DialogContent></Dialog>;
}
export function PlanForm({p,ctx,close,initialText,compact=false}:{p:Patient;ctx:Context;close:()=>void;initialText?:string;compact?:boolean}){
  const plan=p.carePlans[0],today=new Date().toISOString().slice(0,10);
  const [error,setError]=useState(''),[saving,setSaving]=useState(false);
  const submitting=useRef(false),errorRef=useRef<HTMLDivElement>(null);
  const pending=ctx.busy||saving;
  useEffect(()=>{if(error||ctx.saveConflict)errorRef.current?.focus();},[error,ctx.saveConflict]);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(ctx.busy||submitting.current)return;
    const f=new FormData(e.currentTarget);
    submitting.current=true;setSaving(true);setError('');
    try{
      const saved=await ctx.save({type:'plan.save',patientId:p.id,text:String(f.get('text')),owner:String(f.get('owner')),followup:String(f.get('followup')),time:String(f.get('time'))},'Plan saved and follow-up scheduled');
      if(saved)close();else setError('This plan was not saved. Your entries are still here. Please try again.');
    }catch{
      setError('This plan was not saved. Your entries are still here. Please try again.');
    }finally{submitting.current=false;setSaving(false);}
  }
  return <form onSubmit={submit} aria-busy={pending} className={compact?"entry-form care-form compact-plan-form":"entry-form care-form"}>
    {(error||ctx.saveConflict)&&<div className="care-form-error" role="alert" tabIndex={-1} ref={errorRef}><p>{ctx.saveConflict?'A newer workspace was saved. Your entries are still here. Copy any changes you want to keep before loading the latest saved records.':error}</p>{ctx.saveConflict&&ctx.reloadWorkspace&&<Button type="button" variant="outline" disabled={pending} onClick={ctx.reloadWorkspace}>Load latest saved records</Button>}</div>}
    <fieldset disabled={pending}>
    <p className="care-form-key">* Required field</p>
    <FormSection title="Assessment and next steps"><label><span>Assessment, rationale, and agreed next steps <RequiredField/></span><Textarea name="text" required rows={compact?3:6} maxLength={2000} defaultValue={initialText??plan?.text} placeholder="Document benefit, tolerability, remaining concerns, and your plan with the patient."/></label></FormSection>
    <FormSection title="Follow-up"><label><span>Follow-up owner <RequiredField/></span><Input name="owner" required maxLength={100} defaultValue={plan?.owner??p.clinician}/></label><div className="form-two"><label><span>Review date <RequiredField/></span><Input name="followup" type="date" required min={today} defaultValue={plan?.followup&&plan.followup>=today?plan.followup:today}/></label><label><span>Follow-up time <RequiredField/></span><Input name="time" type="time" required defaultValue={plan?.time??'09:00'}/></label></div></FormSection>
    <div className="form-actions care-form-actions"><Button type="button" variant="outline" onClick={e=>{if(ctx.busy||submitting.current)return;e.currentTarget.form?.reset();close();}}>Cancel</Button><Button type="submit"><ClipboardList size={16}/>{pending?'Saving…':'Save plan'}</Button></div>
  </fieldset></form>;
}
