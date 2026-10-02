'use client';
import {useState,type FormEvent} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {type Patient} from '@/lib/theranetrix';
import {emptyClinicalContext,type ClinicalContextFields} from '@/lib/patient-overview';
import {type Context} from './app';
import {Picker} from './ui';

export function ClinicalContextDialog({p,open,close,ctx}:{p:Patient;open:boolean;close:()=>void;ctx:Context}){
  return <Dialog open={open} onOpenChange={v=>{if(!v&&!ctx.busy)close();}}><DialogContent className="medication-dialog patient-context-dialog"><DialogHeader><DialogTitle>Clinical context · {p.name}</DialogTitle><DialogDescription>Record reviewed information and the patient’s own priorities. Leave unknown information blank.</DialogDescription></DialogHeader>{open&&<ClinicalContextForm key={p.id} p={p} ctx={ctx} close={close}/>}</DialogContent></Dialog>;
}
function ClinicalContextForm({p,ctx,close}:{p:Patient;ctx:Context;close:()=>void}){
  const c=p.clinicalContext??emptyClinicalContext;const [allergyStatus,setAllergyStatus]=useState(c.allergyStatus);const [error,setError]=useState('');
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=new FormData(e.currentTarget);const value=(key:string)=>String(form.get(key)??'').trim();const fields=Object.fromEntries(Object.keys(emptyClinicalContext).map(key=>[key,key==='allergyStatus'?allergyStatus:value(key)])) as ClinicalContextFields;setError('');try{if(await ctx.save({type:'context.update',patientId:p.id,...fields},'Clinical context saved'))close();else setError('Context was not saved. Your entries are still here. Please try again.');}catch{setError('Context was not saved. Your entries are still here. Please try again.');}}
  return <form className="entry-form" onSubmit={submit}>{error&&<div role="alert" className="care-form-error">{error}</div>}<p className="context-review-date">{p.clinicalContext?'Last reviewed '+p.clinicalContext.date+' by '+p.clinicalContext.author:'Context has not been reviewed.'}</p><fieldset disabled={ctx.busy} className="patient-context-editor">
    <section className="context-form-section is-safety"><h3>Allergies & reported reactions</h3><label>Allergy review<Picker value={allergyStatus} onChange={v=>setAllergyStatus(v as ClinicalContextFields['allergyStatus'])} label="Allergy review status" options={['Not reviewed','None reported','Reactions reported']}/></label>{allergyStatus==='Reactions reported'&&<label>Allergen and reported reaction<Textarea name="allergies" required maxLength={2000} rows={3} defaultValue={c.allergies}/></label>}</section>
    <section className="context-form-section"><h3>Condition & history</h3><div className="form-two"><label>Pain location / distribution<Input name="painLocation" maxLength={500} defaultValue={c.painLocation}/></label><label>Duration / onset<Input name="painDuration" maxLength={200} defaultValue={c.painDuration}/></label></div><details><summary>Medical history & previous treatments</summary><div><label>Medical history and coexisting conditions<Textarea name="medicalHistory" maxLength={3000} rows={3} defaultValue={c.medicalHistory}/></label><label>Previous treatments and response<Textarea name="priorTreatments" maxLength={2000} rows={3} defaultValue={c.priorTreatments}/></label></div></details></section>
    <section className="context-form-section"><h3>Patient priorities & support</h3><label>Treatment priorities and acceptable burden<Textarea name="preferences" maxLength={1000} rows={3} defaultValue={c.preferences} placeholder="Relief, daily function, side effects, and treatment burden."/></label><label>Care coordinator<Input name="coordinator" maxLength={100} defaultValue={c.coordinator}/></label><details><summary>Physical, psychological & social context</summary><div><label>Physical impact, triggers, and limitations<Textarea name="physicalContext" maxLength={2000} rows={2} defaultValue={c.physicalContext}/></label><label>Psychological context<Textarea name="psychologicalContext" maxLength={2000} rows={2} defaultValue={c.psychologicalContext}/></label><label>Social context and support<Textarea name="socialContext" maxLength={2000} rows={2} defaultValue={c.socialContext}/></label></div></details></section>
    <div className="form-actions"><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button type="submit">{ctx.busy?'Saving…':'Save context'}</Button></div>
  </fieldset></form>;
}
