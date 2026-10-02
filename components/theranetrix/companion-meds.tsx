'use client';
import {useRef,useState} from 'react';
import {Check,Pill,Watch,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import type {Patient} from '@/lib/theranetrix';
import type {Context} from './app';
import {Badge,EmptyState,Panel,formatDate} from './ui';
import {RecommendationDetails} from './recommendation-details';

export function CompanionMeds({p,ctx,lang='en'}:{p:Patient;ctx:Context;lang?:'en'|'es'}){
  const es=lang==='es';
  const meds=p.medications.filter(m=>m.status==='Active');
  const [effects,setEffects]=useState<Record<string,string>>({});
  const [busyId,setBusyId]=useState(''),[error,setError]=useState<Record<string,string>>({}),[saved,setSaved]=useState<Record<string,string>>({});
  const inFlight=useRef(false);
  async function log(medicationId:string,status:'taken'|'missed'){
    if(ctx.busy||inFlight.current)return;
    inFlight.current=true;setBusyId(medicationId);setError(previous=>({...previous,[medicationId]:''}));setSaved(previous=>({...previous,[medicationId]:''}));
    try{
      const success=await ctx.save({type:'patient.dose.log',patientId:p.id,medicationId,status,effects:effects[medicationId]?.trim()||undefined},status==='taken'?(es?'Dosis marcada como tomada':'Dose marked as taken'):(es?'Dosis marcada como omitida':'Missed dose saved'));
      if(success){setSaved(previous=>({...previous,[medicationId]:es?'Registro guardado para que tu equipo lo revise.':'Dose report saved for your care team to review.'}));setEffects(previous=>({...previous,[medicationId]:''}));}
      else setError(previous=>({...previous,[medicationId]:es?'No se guardó. Tu nota se conserva. Inténtalo de nuevo.':'Not saved yet. Your side-effect note is kept here. Please try again.'}));
    }catch{setError(previous=>({...previous,[medicationId]:es?'No se guardó. Tu nota se conserva. Inténtalo de nuevo.':'Not saved yet. Your side-effect note is kept here. Please try again.'}));}
    finally{inFlight.current=false;setBusyId('');}
  }
  return <div className="stack companion-medications feedback-companion-medications">
    <h2 className="mb-2">{es?'Mis medicamentos':'My medications'}</h2>
    <p className="muted companion-medication-intro">{es?'Marca la dosis de hoy y avisa si notas algún efecto. Tu equipo revisa esto. No cambia la receta.':'Mark today’s dose and tell us if you notice a side effect. Your team reviews this. It does not change the prescription.'}</p>
    {meds.length?meds.map(m=>{
      const last=(p.doseLogs??[]).filter(l=>l.medicationId===m.id||l.name===m.name).sort((a,b)=>b.date.localeCompare(a.date))[0];
      return <Panel key={m.id}><div className="padded companion-med">
        <div className="companion-med-title"><span className="companion-med-symbol"><Pill size={20}/></span><div><h3>{m.name}</h3><span>{m.regimen||m.status}</span></div><Badge tone={m.reviewedAt?'teal':'amber'}>{m.reviewedAt?(es?'Revisión: ':'Reviewed: ')+formatDate(m.reviewedAt):(es?'Por verificar':'To verify')}</Badge></div>
        <p className="companion-med-when"><Watch size={14}/>{m.regimen||(es?'Horario no registrado. Confírmalo con tu equipo.':'Schedule not recorded. Confirm it with your care team.')}</p>
        <p>{es?'Para':'For'}: {m.indication||(es?'Motivo no registrado':'Reason not recorded')}</p>
        <RecommendationDetails label={es?'¿Por qué aparece este medicamento?':'Why is this medication listed?'} title={m.name} summary={es?'Información de tu registro de medicamentos':'Information from your medication record'} rationale={[m.indication?(es?'Motivo registrado: ':'Recorded reason: ')+m.indication:(es?'Tu registro no incluye el motivo de uso. Pregúntalo a tu equipo.':'Your record does not include the reason for use. Ask your care team.'),es?'Aparece porque está marcado como activo en tu registro.':'It appears because it is marked active in your record.']} sources={[{label:es?'Origen':'Source',value:m.source==='Patient report'?(es?'Informe del paciente':'Patient report'):(es?'Entrada del profesional':'Clinician entry'),date:m.reportedAt},{label:es?'Verificación':'Verification',value:m.reviewedAt?(m.reviewedBy||(es?'Profesional':'Clinician')):(es?'Pendiente de verificar':'Not yet verified'),date:m.reviewedAt||undefined}]} limitations={[es?'Esta lista muestra lo registrado; no confirma que sea adecuado cambiar tu dosis.':'This list shows what is recorded; it does not determine whether your dose should change.']}/>
        <div className="companion-med-response"><div><span>{es?'Beneficio registrado':'Recorded benefit'}</span><strong>{es?({'Not assessed':'Por revisar','Helpful':'Ayuda','Partly helpful':'Ayuda en parte','No benefit':'Sin beneficio'})[m.benefit]:m.benefit}</strong></div><div><span>{es?'Tolerancia registrada':'Recorded tolerance'}</span><strong>{m.tolerability==='Effects reported'?m.effects:m.tolerability==='Not assessed'?(es?'Por revisar':'To review'):(es?'Sin efectos reportados':'No effects reported')}</strong></div></div>
        {last&&<small>{es?'Último registro':'Last log'}: {last.status==='taken'?(es?'Tomada':'Taken'):(es?'Omitida':'Missed')} · {formatDate(last.date,true)}</small>}
        <div className="companion-dose-report"><h4>{es?'Registrar una dosis':'Record a dose'}</h4><label>{es?'¿Algo que contar sobre esta dosis?':'Any side effects with this dose?'} <span>{es?'Opcional':'Optional'}</span><Textarea rows={2} maxLength={1000} disabled={ctx.busy||!!busyId} value={effects[m.id]??''} onChange={e=>setEffects(s=>({...s,[m.id]:e.target.value}))} placeholder={es?'Por ejemplo, grogui al despertar':'For example, groggy on waking'}/></label><small>{es?'La nota se guarda cuando eliges Tomada o No la tomé.':'Your note is saved when you choose Taken or Missed.'}</small></div>
        {error[m.id]&&<p className="previsit-error" role="alert">{error[m.id]}</p>}{saved[m.id]&&<p className="previsit-saved" role="status">{saved[m.id]}</p>}
        <div className="form-actions">
          <Button type="button" disabled={ctx.busy||!!busyId} onClick={()=>void log(m.id,'taken')}><Check size={15}/>{es?'Tomada':'Taken'}</Button>
          <Button type="button" variant="outline" disabled={ctx.busy||!!busyId} onClick={()=>void log(m.id,'missed')}><X size={15}/>{es?'No la tomé':'Missed'}</Button>
        </div>
      </div></Panel>;
    }):<EmptyState title={es?'Sin medicamentos en tu plan':'No medications on your plan'} description={es?'Tu equipo añadirá lo que debas tomar.':'Your care team will add what you should take.'}/>}
    {(p.doseLogs??[]).length>0&&<Panel title={es?'Registro reciente':'Recent log'}><div className="padded stack">{p.doseLogs!.slice(0,8).map(l=><p key={l.id}><Badge>{l.status==='taken'?(es?'Tomada':'Taken'):(es?'Omitida':'Missed')}</Badge> {l.name} · {formatDate(l.date,true)}{l.effects?' · '+l.effects:''}</p>)}</div></Panel>}
    <div className="companion-device-status"><Watch size={16}/><div><strong>{es?'Dispositivos':'Devices'}</strong><p>{es?'Ningún dispositivo conectado. La conexión aún no está disponible.':'No devices connected. Device connection is not available yet.'}</p></div></div>
  </div>;
}
