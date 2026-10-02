'use client';

import {useState} from 'react';
import {Activity,ArrowUpRight,MessageSquare} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {featureEnabled,type Patient} from '@/lib/theranetrix';
import {engineRecordRevision} from '@/lib/engine-demo';
import {visitObservations} from '@/lib/visit-observations';
import {patientTwinPreferences} from '@/lib/patient-twin-settings';
import type {Context} from './app';
import {Badge,Panel,Picker,formatDate} from './ui';

type Metric = 'pain' | 'function' | 'sleep';
export function PatientDigitalTwin({p,ctx,lang='en',compact=false,onExplore,onMessage}:{
  p:Patient;ctx:Context;lang?:'en'|'es';compact?:boolean;onExplore?:()=>void;onMessage?:()=>void;
}) {
  const preferences=patientTwinPreferences(p);
  const [selection,setSelection]=useState<{metric:Metric;revision:string}|null>(null);
  const revision=JSON.stringify(preferences);
  const metric=selection?.revision===revision&&preferences.measures.includes(selection.metric)?selection.metric:preferences.primary;
  const setMetric=(value:Metric)=>setSelection({metric:value,revision});
  const es=lang==='es';
  const say=(en:string,spanish:string)=>es?spanish:en;
  const labels={pain:say('Pain','Dolor'),function:say('Daily activities','Actividades diarias'),sleep:say('Sleep quality','Calidad del sueño')};
  if(!featureEnabled(ctx.data,'digitalTwin'))return <Panel title={say('Your Digital Twin','Tu gemelo digital')}><p className="patient-twin-note">{say('This view is turned off. Your existing records are retained.','Esta vista está desactivada. Tus registros anteriores se conservan.')}</p></Panel>;
  const run=ctx.data.engineRuns?.find(r=>r.patientId===p.id);
  const stale=!!run&&run.revision!==engineRecordRevision(p,ctx.data);
  const medications=p.medications.filter(m=>m.status==='Active');
  const plan=p.carePlans[0];
  const observations=visitObservations(p),latest=observations.at(-1),first=observations[0];
  const lastDate=latest?.date;
  return <Panel className="patient-twin redesign-patient-twin feedback-patient-twin" title={say('Your Digital Twin','Tu gemelo digital')} subtitle={say('Your recorded progress, in one place.','Tu progreso registrado, en un solo lugar.')}>
    <div className="patient-twin-content">
      <div className="patient-twin-intro"><Activity size={18} aria-hidden="true"/><p>{say('Based on your saved check-ins.','Basado en tus registros guardados.')}</p><Badge tone="teal">{say('Recorded observations','Observaciones registradas')}</Badge></div>
      <div className="patient-twin-metrics">{preferences.measures.map(key=>{
        const current=latest?.[key],baseline=first?.[key];
        const change=current!=null&&baseline!=null&&observations.length>1?Math.round((current-baseline)*10)/10:undefined;
        return <div key={key}><span>{labels[key]}</span><strong>{current??say('Not recorded','Sin registro')}{current!=null&&<small>/10</small>}</strong><p>{change===undefined?say('More check-ins will show change.','Más registros mostrarán los cambios.'):change===0?say('Unchanged from first check-in','Sin cambios desde el primer registro'):`${Math.abs(change)} ${change<0?say('points lower','puntos menos'):say('points higher','puntos más')} ${say('than first check-in','que el primer registro')}`}</p><small>{key==='pain'?say('Lower means less pain','Menos significa menos dolor'):say('Higher means better reported quality','Más significa mejor calidad informada')}</small></div>;
      })}</div>
      <div className="patient-twin-chart-head"><h3>{say('How you are changing','Cómo vas cambiando')}</h3><Picker label={say('Digital Twin measure','Medida del gemelo digital')} value={metric} onChange={v=>setMetric(v as Metric)} options={preferences.measures.map(value=>({value,label:labels[value]}))}/></div>
      {observations.some(row=>row[metric]!==null)?<RecordedTrendChart patient={p} metric={metric} lang={lang}/>:<p>{say('No check-ins for this measure yet. Your first saved check-in will appear here.','Todavía no hay registros de esta medida. Tu primer registro guardado aparecerá aquí.')}</p>}
      <p className="patient-twin-meta">{lastDate?`${say('Latest recorded check-in','Último registro guardado')}: ${formatDate(lastDate)}`:say('No dated check-ins yet','Todavía no hay registros con fecha')}. {say('Recorded observations only, not a forecast or proof that a medication is working.','Solo observaciones registradas, no un pronóstico ni una prueba de que un medicamento funciona.')}</p>
      {preferences.explanation&&<div className="patient-twin-goal"><span>{say('A note from your care team','Una nota de tu equipo')}</span><p style={{whiteSpace:'pre-wrap'}}>{preferences.explanation}</p>{p.twinPreferences&&<small>{p.twinPreferences.author} · {formatDate(p.twinPreferences.date)}</small>}</div>}
      {preferences.showGoal&&<div className="patient-twin-goal"><span>{say('What matters to you','Lo que te importa')}</span><strong>{p.goal||say('No goal recorded yet','Todavía no hay un objetivo registrado')}</strong></div>}
      {!compact&&<div className="patient-twin-details">
        {preferences.showMedications&&<details className="patient-twin-detail"><summary>{say('Your medication reports','Tus informes de medicamentos')}<span>{medications.length} {say('active','activos')}</span></summary><div><p>{say('What you reported, separate from the trend above. Medication changes stay with your prescriber.','Lo que informaste, separado de la tendencia anterior. Los cambios de medicamentos corresponden a tu prescriptor.')}</p>{medications.length?medications.map(m=><article key={m.id}><strong>{m.name}</strong><p>{say('Reported benefit','Beneficio informado')}: {m.benefit} · {say('Tolerability','Tolerancia')}: {m.tolerability}</p>{m.effects&&<p>{m.effects}</p>}<small>{say('Reported','Informado')}: {formatDate(m.reportedAt)}</small></article>):<p>{p.medicationReconciliation?.none?say('No medications reported.','No se informaron medicamentos.'):say('Current medications have not been recorded.','No se han registrado los medicamentos actuales.')}</p>}</div></details>}
        {preferences.showPlan&&<details className="patient-twin-detail"><summary>{say('Your agreed next step','Tu próximo paso acordado')}<span>{plan?formatDate(plan.followup):say('Not recorded','Sin registro')}</span></summary><div>{plan?<><p>{plan.text}</p><p><strong>{say('Follow-up','Seguimiento')}: {formatDate(plan.followup)} {plan.time}{plan.timezone?' · '+plan.timezone:''}</strong><br/>{plan.owner}</p>{plan.appointmentBooked===false&&<p>{say('Follow-up is due; an appointment has not been booked.','El seguimiento está pendiente; todavía no se ha reservado una cita.')}</p>}</>:<p>{say('Your care team has not saved a plan yet.','Tu equipo todavía no ha guardado un plan.')}</p>}</div></details>}
        <details className="patient-twin-provenance"><summary>{say('What is behind this view?','¿En qué se basa esta vista?')}</summary><p>{say('Your saved check-ins and the notes your care team records. Wearables, lab results, and outside health records are not connected yet.','Tus registros guardados y las notas de tu equipo de atención. Los dispositivos, los resultados de laboratorio y los historiales externos aún no están conectados.')}</p><p>{run?`${say('Latest saved engine snapshot','Última captura guardada del motor')}: ${formatDate(run.date,true)}. ${stale?say('New information has arrived since that snapshot. The observations above show the current saved record.','Hay información nueva desde esa captura. Las observaciones anteriores muestran el registro guardado actual.'):say('Based on the current saved inputs. This is not clinical validation or clinician approval.','Basada en los datos actuales. Esto no es validación clínica ni aprobación de un profesional.')}`:say('No engine snapshot has been saved. You can still see your recorded progress without running an engine.','No hay ninguna captura del motor guardada. Puedes ver tu progreso sin ejecutar un motor.')}</p></details>
      </div>}
      <div className="patient-twin-actions">{compact&&onExplore&&<Button variant="outline" onClick={onExplore}>{say('Explore my Digital Twin','Explorar mi gemelo digital')}<ArrowUpRight size={16}/></Button>}{onMessage&&featureEnabled(ctx.data,'messages')&&<Button variant="outline" onClick={onMessage}><MessageSquare size={16}/>{say('Ask my care team','Preguntar a mi equipo')}</Button>}</div>
    </div>
  </Panel>;
}


/** Dated observations only. Missing values break a line instead of becoming a zero. */
export function RecordedTrendChart({patient,metric='all',lang='en'}:{patient:Patient;metric?:Metric|'all';lang?:'en'|'es'}){
  const es=lang==='es',keys:Metric[]=metric==='all'?['pain','function','sleep']:[metric];
  const rows=visitObservations(patient).map(row=>({...row,time:Date.parse(row.date)})).filter(row=>Number.isFinite(row.time));
  const recorded=rows.some(row=>keys.some(key=>row[key]!==null&&Number.isFinite(row[key])));
  const labels={pain:es?'Dolor':'Pain',function:es?'Actividades diarias':'Daily activities',sleep:es?'Calidad del sueño':'Sleep quality'};
  const colors={pain:'#087f75',function:'#5578b1',sleep:'#a67a37'};
  if(!recorded)return <div className="feedback-chart-empty"><Activity size={24}/><strong>{es?'Todavía no hay observaciones registradas':'No observations recorded yet'}</strong><p>{es?'El primer registro guardado aparecerá aquí.':'The first saved check-in will appear here.'}</p></div>;
  const W=760,H=260,left=34,right=24,top=16,bottom=36,start=Math.min(...rows.map(row=>row.time)),end=Math.max(...rows.map(row=>row.time));
  const x=(time:number)=>end===start?(W+left-right)/2:left+(time-start)/(end-start)*(W-left-right),y=(value:number)=>top+(10-value)/10*(H-top-bottom);
  const tickIndices=[0,Math.floor((rows.length-1)/2),rows.length-1].filter((value,index,all)=>all.indexOf(value)===index);
  return <div className="feedback-recorded-trend"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${patient.name}: ${keys.map(key=>labels[key]).join(', ')} ${es?'observaciones registradas, escala de 0 a 10':'recorded observations, scale from 0 to 10'}`}>
    <title>{`${es?'Observaciones registradas':'Recorded observations'}: ${keys.map(key=>labels[key]).join(', ')}`}</title>
    {[0,2,4,6,8,10].map(value=><g key={value}><line x1={left} y1={y(value)} x2={W-right} y2={y(value)} stroke="#e4e9ed" strokeDasharray="3 4"/><text x={left-12} y={y(value)+4} textAnchor="end">{value}</text></g>)}
    {keys.map(key=>{let previous=false;const path=rows.map(row=>{if(row[key]===null||!Number.isFinite(row[key])){previous=false;return '';}const segment=`${previous?'L':'M'}${x(row.time)},${y(row[key]!)}`;previous=true;return segment;}).join(' ');return <g key={key}><path d={path} stroke={colors[key]} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none"/>{rows.map((row,index)=>row[key]!==null&&Number.isFinite(row[key])&&<circle key={index} cx={x(row.time)} cy={y(row[key]!)} r={4.5} fill="white" stroke={colors[key]} strokeWidth={2}><title>{`${formatDate(row.date)}: ${labels[key]} ${row[key]}/10`}</title></circle>)}</g>;})}
    {tickIndices.map(index=><text key={index} x={x(rows[index].time)} y={H-10} textAnchor={rows.length===1?'middle':index===0?'start':index===rows.length-1?'end':'middle'}>{formatDate(rows[index].date)}</text>)}
  </svg><div className="feedback-trend-legend">{keys.map(key=><span key={key}><i style={{background:colors[key]}}/>{labels[key]}<small>{key==='pain'?(es?'menos es mejor':'lower is better'):(es?'más es mejor':'higher is better')}</small></span>)}</div></div>;
}
