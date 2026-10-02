'use client';

import {useState,type FormEvent} from 'react';
import {Settings2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {defaultTwinPreferences,patientTwinPreferences,twinMeasures,type TwinPreferences} from '@/lib/patient-twin-settings';
import {featureEnabled,type Patient} from '@/lib/theranetrix';
import type {Context} from './app';
import {Picker,formatDate} from './ui';
import {PatientDigitalTwin} from './patient-digital-twin';

const measureLabels={pain:'Pain',function:'Daily function',sleep:'Sleep quality'};
export function TwinCustomizeButton({p,ctx}:{p:Patient;ctx:Context}){
  const [open,setOpen]=useState(false);
  return <><Button variant="outline" onClick={()=>setOpen(true)}><Settings2 size={16}/>Customize patient view</Button><Dialog open={open} onOpenChange={v=>{if(!ctx.busy)setOpen(v);}}><DialogContent className="twin-customize-dialog"><DialogHeader><DialogTitle>Patient Digital Twin · {p.name}</DialogTitle><DialogDescription>Choose the measures and sections shown to this patient. Clinical records stay unchanged.</DialogDescription></DialogHeader>{open&&<TwinCustomizeForm key={p.id} p={p} ctx={ctx} close={()=>setOpen(false)}/>}</DialogContent></Dialog></>;
}
function TwinCustomizeForm({p,ctx,close}:{p:Patient;ctx:Context;close:()=>void}){
  const [draft,setDraft]=useState<TwinPreferences>(()=>patientTwinPreferences(p));
  const [baseId]=useState(p.twinPreferences?.id??'');
  const [error,setError]=useState('');
  const conflict=baseId!==(p.twinPreferences?.id??'');
  function toggleMeasure(metric:typeof twinMeasures[number],checked:boolean){
    setDraft(current=>{
      const measures=checked?twinMeasures.filter(m=>m===metric||current.measures.includes(m)):current.measures.filter(m=>m!==metric);
      if(!measures.length)return current;
      return {...current,measures,primary:measures.includes(current.primary)?current.primary:measures[0]};
    });
  }
  async function submit(e:FormEvent){
    e.preventDefault();setError('');
    if(await ctx.save({type:'patient.twin.configure',patientId:p.id,baseId,preferences:draft},'Patient Digital Twin preferences saved'))close();
    else setError('Your changes were not saved. Your draft is still here. Review the workspace message and try again.');
  }
  const previewPatient={...p,twinPreferences:{...draft,id:'preview',date:new Date().toISOString(),author:'Unsaved preview'}};
  return <form onSubmit={submit}>
    <div className="twin-customize-grid"><fieldset disabled={ctx.busy} className="twin-customize-controls">
      <legend>Care-team controls</legend>
      <p>Saved for this patient in the shared owner workspace. Separate clinician and patient accounts are not configured.</p>
      <h3>Visible measures</h3><p>Keep at least one measure. Hidden measures remain in the care record.</p>
      {twinMeasures.map(metric=><label className="twin-setting-toggle" key={metric}><Checkbox checked={draft.measures.includes(metric)} disabled={draft.measures.length===1&&draft.measures.includes(metric)} onCheckedChange={v=>toggleMeasure(metric,v===true)}/>{measureLabels[metric]}</label>)}
      <label>Starting chart<Picker label="Starting chart" value={draft.primary} onChange={value=>setDraft({...draft,primary:value as TwinPreferences['primary']})} options={draft.measures.map(value=>({value,label:measureLabels[value]}))}/></label>
      <h3>Sections in the Twin</h3>
      {([{key:'showGoal',label:'Patient goal'},{key:'showMedications',label:'Medication reports in the detailed view'},{key:'showPlan',label:'Agreed care plan in the detailed view'}] as const).map(item=><label className="twin-setting-toggle" key={item.key}><Checkbox checked={draft[item.key]} onCheckedChange={v=>setDraft({...draft,[item.key]:v===true})}/>{item.label}</label>)}
      <label>A note for this patient<Textarea rows={4} maxLength={1200} value={draft.explanation} onChange={e=>setDraft({...draft,explanation:e.target.value})} placeholder="Explain what you would like the patient to focus on in their check-ins."/></label><small>{draft.explanation.length}/1,200 characters. Shown as a care-team note.</small>
      <p>Data sources and observation limitations always remain visible to the patient. These controls do not enable a clinical model or change feature availability.</p>
      {!featureEnabled(ctx.data,'digitalTwin')&&<p role="status">Digital Twin is off in workspace settings. You can save preferences now; they will appear when it is enabled.</p>}
      <Button type="button" variant="outline" onClick={()=>setDraft(defaultTwinPreferences())}>Reset draft to defaults</Button>
      {p.twinPreferences&&<details><summary>Saved display history</summary>{[p.twinPreferences,...(p.twinPreferences.history??[])].map(revision=><article key={revision.id}><strong>{formatDate(revision.date,true)} · {revision.author}</strong><p>{revision.measures.map(m=>measureLabels[m]).join(', ')}. Starting chart: {measureLabels[revision.primary]}.</p><p>Goal: {revision.showGoal?'shown':'hidden'} · Medications: {revision.showMedications?'shown':'hidden'} · Plan: {revision.showPlan?'shown':'hidden'}</p>{revision.explanation&&<p>{revision.explanation}</p>}</article>)}</details>}
    </fieldset><section className="twin-customize-preview" aria-label="Patient preview"><h3>Patient preview <span>Unsaved changes</span></h3><PatientDigitalTwin p={previewPatient} ctx={ctx}/></section></div>
    {conflict&&<p role="alert">The saved settings changed while this editor was open. Close and reopen it to review the latest version.</p>}{error&&<p role="alert">{error}</p>}
    <div className="form-actions"><Button type="button" variant="outline" disabled={ctx.busy} onClick={close}>Cancel</Button><Button type="submit" disabled={ctx.busy||conflict}>{ctx.busy?'Saving…':'Save patient view'}</Button></div>
  </form>;
}
