'use client';
import {useRef,useState,type FormEvent} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {Patient} from '@/lib/theranetrix';
import type {Context} from './app';
import {hasDemoIdentity} from '@/lib/demo-identity';

export function birthDateLabel(value?:string){return value?new Date(value+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'not recorded';}
// Compact M/D/YYYY for the one-line identity pin; read straight from the ISO string, so no time zone can shift it.
export function birthDateShort(value:string){return Number(value.slice(5,7))+'/'+Number(value.slice(8,10))+'/'+value.slice(0,4);}
/** The date of birth beside a patient name in lists, pickers and the advisor header. A missing DOB stays visible as missing. */
export function dobText(value?:string){return 'DOB '+(value?birthDateShort(value):'not recorded');}
export function PatientIdentityDialog({p,ctx,open,close}:{p:Patient;ctx:Context;open:boolean;close:()=>void}){
  const [error,setError]=useState(''),[saving,setSaving]=useState(false);
  const savingRef=useRef(false),errorRef=useRef<HTMLParagraphElement>(null);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(ctx.busy||savingRef.current)return;
    const form=new FormData(event.currentTarget);savingRef.current=true;setSaving(true);setError('');
    try{const ok=await ctx.save({type:'patient.identity.update',patientId:p.id,dateOfBirth:String(form.get('dob')??''),medicalRecordNumber:String(form.get('mrn')??'')},'Patient identifiers saved');
      if(ok)close();else setError('Unable to save. Your entries are still here. Review the workspace notice and try again.');
    }catch(error){setError(error instanceof Error?error.message:'Unable to save patient identifiers.');}
    finally{savingRef.current=false;setSaving(false);requestAnimationFrame(()=>errorRef.current?.focus());}
  }
  return <Dialog open={open} onOpenChange={value=>{if(!value&&!saving&&!ctx.busy)close();}}><DialogContent className="care-entry-dialog entry-dialog"><DialogHeader><DialogTitle>Patient identifiers</DialogTitle><DialogDescription>{p.name} · Workspace ID {p.id}</DialogDescription></DialogHeader><form onSubmit={submit} className="entry-form care-form"><p className="muted">Record the identifiers supplied by the patient or source record. A date of birth is never inferred from age.</p>{hasDemoIdentity(p)&&<p className="muted">Demo patient: the seeded date of birth and DEMO- medical record number are fictional example values, not real identifiers.</p>}{error&&<p ref={errorRef} tabIndex={-1} role="alert" className="care-form-error">{error}</p>}<fieldset disabled={saving||ctx.busy}><label>Date of birth<Input type="date" name="dob" max={new Date().toISOString().slice(0,10)} defaultValue={p.dateOfBirth}/></label><label>Medical record number<Input name="mrn" maxLength={100} autoComplete="off" defaultValue={p.medicalRecordNumber}/></label><p className="muted">Leave an unknown identifier blank. The workspace ID remains {p.id}.</p><div className="form-actions"><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button type="submit">{saving?'Saving…':'Save identifiers'}</Button></div></fieldset></form></DialogContent></Dialog>;
}
