'use client';
import {useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/components/ui/alert-dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Loader2,X} from 'lucide-react';
import {type Patient} from '@/lib/theranetrix';
import {type Action} from '@/lib/actions';
import {Picker} from './ui';
import {type Context} from './app';
export type EntryKind='patient'|'note'|'goal'|'task'|'escalation';
const titles={patient:'Add a patient',note:'Document this encounter',goal:'Update patient goal',task:'Schedule a care activity',escalation:'Escalate for review'};
type Entry={kind:EntryKind;patient?:Patient};
export function FormSection({title,description,children}:{title:string;description?:string;children:ReactNode}){
  return <section className="care-form-section"><div className="care-form-section-heading"><h3>{title}</h3>{description&&<p>{description}</p>}</div><div className="care-form-fields">{children}</div></section>;
}
// Adult date-of-birth bounds (18 to 120 years) for the add-patient form; the server checks the same range.
const yearsAgo=(years:number,days=0)=>{const d=new Date();d.setUTCFullYear(d.getUTCFullYear()-years);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
export function RequiredField(){return <span className="care-required" aria-hidden="true">*</span>;}
export function EntryDialog({entry,close,ctx}:{entry:Entry|null;close:()=>void;ctx:Context}){
  return entry?<ActiveEntryDialog key={entry.kind+':'+(entry.patient?.id??'')} entry={entry} close={close} ctx={ctx}/>:null;
}
function ActiveEntryDialog({entry,close,ctx}:{entry:Entry;close:()=>void;ctx:Context}){
  const dirty=useRef(false),saving=useRef(false);
  const [discardOpen,setDiscardOpen]=useState(false);
  const spanish=entry.kind==='goal'&&entry.patient?.preferredLanguage==='es';
  function requestClose(){
    if(ctx.busy||saving.current)return;
    if(dirty.current)setDiscardOpen(true);else close();
  }
  return <>
    <Dialog open onOpenChange={open=>{if(!open)requestClose();}}>
      <DialogContent className="entry-dialog care-entry-dialog" showCloseButton={false} lang={spanish?'es':undefined}>
        <button type="button" className="absolute right-4 top-4 rounded-sm p-1" aria-label={spanish?'Cerrar':'Close'} disabled={ctx.busy} onClick={requestClose}><X size={18}/></button>
        <DialogHeader><DialogTitle>{spanish?'Actualizar objetivo':titles[entry.kind]}</DialogTitle><DialogDescription>{entry.patient?entry.patient.name+' · '+entry.patient.id:'Use fictional information in this evaluation workspace.'}</DialogDescription></DialogHeader>
        <EntryForm entry={entry} close={close} cancel={requestClose} ctx={ctx} spanish={spanish} onDirty={()=>{dirty.current=true;}} onSaving={value=>{saving.current=value;}}/>
      </DialogContent>
    </Dialog>
    <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
      <AlertDialogContent lang={spanish?'es':undefined}>
        <AlertDialogHeader><AlertDialogTitle>{spanish?'¿Descartar los cambios sin guardar?':'Discard unsaved changes?'}</AlertDialogTitle><AlertDialogDescription>{spanish?'Tu texto sigue aquí. Puedes continuar editándolo o descartarlo.':'Your text is still here. You can keep editing or discard this unfinished entry.'}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{spanish?'Seguir editando':'Keep editing'}</AlertDialogCancel><AlertDialogAction disabled={ctx.busy} onClick={()=>{if(ctx.busy||saving.current)return;dirty.current=false;close();}}>{spanish?'Descartar cambios':'Discard changes'}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
function EntryForm({entry,close,cancel,ctx,spanish,onDirty,onSaving}:{entry:Entry;close:()=>void;cancel:()=>void;ctx:Context;spanish:boolean;onDirty:()=>void;onSaving:(saving:boolean)=>void}){
  const [patientId,setPatientId]=useState(entry.patient?.id??ctx.data.patients[0]?.id??''),[text,setText]=useState(entry.kind==='goal'?entry.patient?.goal??'':''),[type,setType]=useState('Progress note'),[clinician,setClinician]=useState('Dr. Maya Chen'),[priority,setPriority]=useState('Medium'),[taskType,setTaskType]=useState('Video visit');
  const [error,setError]=useState(''),[saving,setSaving]=useState(false);
  const submitting=useRef(false),errorRef=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(ctx.busy||submitting.current)return;const form=new FormData(e.currentTarget);const val=(key:string)=>String(form.get(key)??'').trim();let a:Action;
    if(entry.kind==='patient')a={type:'patient.add',name:val('name'),dateOfBirth:val('dateOfBirth'),condition:val('condition'),goal:val('goal'),clinician};
    else if(entry.kind==='note')a={type:'note.add',patientId,text,typeLabel:type as 'Progress note'};
    else if(entry.kind==='goal')a={type:'goal.update',patientId,goal:text};
    else if(entry.kind==='task')a={type:'task.add',patientId,title:val('title'),date:val('date'),time:val('time'),taskType:taskType as 'Video visit'};
    else a={type:'review.add',patientId,title:val('title'),detail:text,priority:priority as 'Medium'};
    submitting.current=true;setSaving(true);onSaving(true);setError('');
    try{
      if(await ctx.save(a,spanish?'Guardado en el registro del paciente':entry.kind==='patient'?'Sample patient added':'Saved to the patient record'))close();
      else setError(spanish?'No se ha guardado. Tu texto sigue aquí; vuelve a intentarlo.':'This entry was not saved. Your text is still here; try again.');
    }catch{
      setError(spanish?'No se ha guardado. Tu texto sigue aquí; vuelve a intentarlo.':'This entry was not saved. Your text is still here; try again.');
    }finally{submitting.current=false;setSaving(false);onSaving(false);}
  }
  return <form onSubmit={submit} onChange={onDirty} className="entry-form care-form" lang={spanish?'es':undefined}>
    {error&&<p className="care-form-error" role="alert" tabIndex={-1} ref={errorRef}>{ctx.saveConflict?(spanish?'Hay un registro más reciente. Tu texto sigue aquí. Copia los cambios que quieras conservar antes de cargar los registros guardados.':'A newer workspace was saved. Your text is still here. Copy any changes you want to keep before loading the latest records.'):error}{ctx.saveConflict&&ctx.reloadWorkspace&&<Button type="button" variant="outline" onClick={ctx.reloadWorkspace}>{spanish?'Cargar registros guardados':'Load latest saved records'}</Button>}</p>}
    <fieldset disabled={ctx.busy||saving}>
      <p className="care-form-key">{spanish?'* Campo obligatorio':'* Required field'}</p>
      {entry.kind!=='patient'&&!entry.patient&&<FormSection title="Patient"><label>Select patient<Picker label="Select patient" value={patientId} onChange={value=>{onDirty();setPatientId(value);}} options={ctx.data.patients.map(p=>({value:p.id,label:p.name}))}/></label></FormSection>}
      {entry.kind==='patient'&&<>
        <FormSection title="Patient details"><div className="form-two"><label><span>Full name <RequiredField/></span><Input name="name" required maxLength={100} placeholder="Fictional patient name"/></label><label><span>Date of birth <RequiredField/></span><Input name="dateOfBirth" required type="date" min={yearsAgo(121,1)} max={yearsAgo(18)}/></label></div></FormSection>
        <FormSection title="Care context"><label><span>Condition <RequiredField/></span><Input name="condition" required maxLength={150} placeholder="Chronic pain condition"/></label><label>Care-team lead<Picker value={clinician} onChange={value=>{onDirty();setClinician(value);}} options={['Dr. Maya Chen','Alex Morgan, NP']} label="Care-team lead"/></label><label><span>Patient goal <RequiredField/></span><Textarea name="goal" required maxLength={500} rows={3} placeholder="What matters most to this patient?"/></label></FormSection>
        <div className="subtle-notice">This creates an evaluation record. It does not enroll a real patient or contact anyone.</div>
      </>}
      {entry.kind==='task'&&<>
        <FormSection title="Care activity"><label><span>Activity <RequiredField/></span><Input name="title" required maxLength={150} placeholder="Follow-up check-in"/></label><label>Activity type<Picker value={taskType} onChange={value=>{onDirty();setTaskType(value);}} options={['Video visit','Phone call','Care coordination']} label="Activity type"/></label></FormSection>
        <FormSection title="Schedule"><div className="form-two"><label><span>Date <RequiredField/></span><Input name="date" type="date" required defaultValue={new Date().toISOString().slice(0,10)}/></label><label><span>Time <RequiredField/></span><Input name="time" type="time" required defaultValue="09:30"/></label></div></FormSection>
        <div className="subtle-notice">Adds an activity to this workspace schedule. Calendar invitations and video conferencing are not connected.</div>
      </>}
      {entry.kind==='escalation'&&<FormSection title="Review request"><label><span>Reason for review <RequiredField/></span><Input name="title" required maxLength={150} placeholder="Describe what needs attention"/></label><label>Priority<Picker value={priority} onChange={value=>{onDirty();setPriority(value);}} options={['High','Medium','Routine']} label="Priority"/></label></FormSection>}
      {['note','goal','escalation'].includes(entry.kind)&&<FormSection title={spanish?'Lo que te importa':entry.kind==='goal'?'What matters to the patient':entry.kind==='note'?'Encounter documentation':'Supporting context'}>
        {entry.kind==='note'&&<label>Note type<Picker value={type} onChange={value=>{onDirty();setType(value);}} options={['Progress note','Care plan','Visit summary']} label="Note type"/></label>}
        <label><span>{spanish?'Objetivo del paciente':entry.kind==='goal'?'Patient goal':entry.kind==='note'?'Clinical documentation':'Context for the care team'} <RequiredField/></span><Textarea required value={text} onChange={e=>setText(e.target.value)} maxLength={entry.kind==='goal'?500:6000} rows={entry.kind==='goal'?4:7} placeholder={spanish?'Escribe lo que te gustaría conseguir.':entry.kind==='note'?'Document what you reviewed, the discussion, and the agreed next steps.':'Add details...'}/></label>
      </FormSection>}
      <div className="form-actions care-form-actions"><Button type="button" variant="outline" onClick={cancel}>{spanish?'Cancelar':'Cancel'}</Button><Button type="submit">{(ctx.busy||saving)&&<Loader2 className="animate-spin" size={16}/>} {ctx.busy||saving?(spanish?'Guardando…':'Saving...'):spanish?'Guardar':entry.kind==='patient'?'Add patient':entry.kind==='note'?'Save note':entry.kind==='task'?'Schedule activity':entry.kind==='escalation'?'Save review request':'Save goal'}</Button></div>
    </fieldset>
  </form>;
}
