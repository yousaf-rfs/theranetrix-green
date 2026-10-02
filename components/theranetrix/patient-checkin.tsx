'use client';
import {useEffect,useId,useRef,useState,type FormEvent,type RefObject} from 'react';
import {ArrowRight,CheckCircle2,ClipboardCheck,Clock3,Minus,Pill,Plus} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {affectingFactors,emptyAffectingPain,emptyMedicationReport,type AffectingPain,type MedicationReport} from '@/lib/patient-medication-report';
import {bodyRegionName,bodyRegionSpanish,checkinNote,checkinReadback,localDay,mergeCheckinNote,noteCheckinMode,noteMood,patientCheckinUpdateReason,patientSelfReports,readCheckinNote,recentCheckinDays,type CheckinAnswers} from '@/lib/patient-checkin-note';
import {CompanionMedicationQuestions} from './companion-medication-questions';
import {Textarea} from '@/components/ui/textarea';
import {featureEnabled,type Patient} from '@/lib/theranetrix';
import {normalizeClinicalWorkflows,type WorkflowApplyAction} from '@/lib/clinical-flows';
import type {ObservationRecord} from '@/lib/clinical-flows/encounters';
import type {Context} from './app';
import {Badge,EmptyState,Panel,formatDate} from './ui';
import {BodyMap} from './body-map';

const metrics=['pain','function','sleep'] as const;
type Metric=typeof metrics[number];
type Answer=''|'declined'|number;
type Mode='daily'|'previsit';
const blank=():Record<Metric,Answer>=>({pain:'',function:'',sleep:''});
const copy={en:{title:'How are you feeling today?',pain:'Pain',function:'Daily activities',sleep:'Sleep quality',mood:'Mood',unanswered:'Not answered',declined:'Prefer not to answer',note:'Anything you would like your team to know?',submit:'Save my check-in',saveUpdate:'Save today’s answers',done:'Your check-in is saved',again:'Record another check-in',partial:'Tap a number for each question. Only the answers you choose are saved.',history:'Your latest responses',
    modeLabel:'Check-in type',daily:'Daily check-in',previsit:'Before my visit',today:'Today’s check-in',dailyBadge:'Daily',previsitBadge:'Before visit',time:'About 30 seconds',dailyIntro:'Pain, daily activities, sleep and mood: one tap each, then save. Your answers add to your care team’s picture of how you are doing between visits.',
    safety:'Your care team is not watching these answers in real time. If something changes, use “I am worse”. In an emergency, call 911. For a mental health crisis, call or text 988.',
    moreDetail:'Add more detail',lessDetail:'Hide extra questions',detailTitle:'More about today (optional)',where:'Where does it hurt?',chooseArea:'Choose a body area',onRecord:'On your record: ',
    affectingTitle:'What else is affecting your pain lately?',affectingHint:'Optional. Tap any that apply, or say it in your own words.',affectingWords:'Anything else, in your own words',
    factors:{'Stress':'Stress','Work':'Work','Sleep problems':'Sleep problems','Money worries':'Money worries','Family or support':'Family or support','Activity':'Activity'} as Record<string,string>,
    todaySaved:'Today’s check-in is saved',savedAt:'Saved',update:'Update today’s answers',updatingTitle:'Updating today’s check-in',updatingHint:'Everything you sent today is filled in below. Change or remove any answer, then save. Your care team can still see what you sent before.',cancel:'Cancel',
    updatingDaily:'This stays a daily check-in. For your visit questions, save or cancel, then choose “Before my visit”.',updatingPrevisit:'This stays your check-in before your visit.',
    previsitHint:'Answer the questions for your visit. Today’s check-in stays as you sent it.',previsitNewTitle:'A new check-in before your visit',previsitNewHint:'Today’s check-in stays as you sent it. These answers are saved separately for your visit.',
    newDay:'A new day has started, so your answers were saved as today’s check-in.',submittedByYou:'Submitted by you',
    week:'Check-ins in the last 7 days',checkedIn:'checked in',noCheckin:'no check-in',
    tooLong:(over:number)=>`Your answers and notes are ${over} characters over the 2,000-character limit. Shorten your comment or medicine notes. Your answers are kept here.`,
    range:{pain:'0 = no pain · 10 = worst pain',function:'0 = pain made them very hard · 10 = pain did not get in the way',sleep:'0 = very poor · 10 = very good',mood:'0 = very low · 10 = very good'}},
  es:{title:'¿Cómo te sientes hoy?',pain:'Dolor',function:'Actividades diarias',sleep:'Calidad del sueño',mood:'Ánimo',unanswered:'Sin responder',declined:'Prefiero no responder',note:'¿Qué te gustaría que supiera tu equipo?',submit:'Guardar mi registro',saveUpdate:'Guardar las respuestas de hoy',done:'Tu registro está guardado',again:'Añadir otro registro',partial:'Toca un número en cada pregunta. Solo se guardarán las respuestas que elijas.',history:'Tus últimas respuestas',
    modeLabel:'Tipo de registro',daily:'Registro diario',previsit:'Antes de mi visita',today:'Registro de hoy',dailyBadge:'Diario',previsitBadge:'Antes de la visita',time:'Unos 30 segundos',dailyIntro:'Dolor, actividades diarias, sueño y ánimo: un toque cada uno y guarda. Tus respuestas ayudan a tu equipo a ver cómo estás entre visitas.',
    safety:'Tu equipo no ve estas respuestas en tiempo real. Si algo cambia, usa “Estoy peor”. En una emergencia, llama al 911. Para una crisis de salud mental, llama o envía un mensaje al 988.',
    moreDetail:'Añadir más detalles',lessDetail:'Ocultar preguntas adicionales',detailTitle:'Más sobre hoy (opcional)',where:'¿Dónde te duele?',chooseArea:'Elegir una zona del cuerpo',onRecord:'En tu registro: ',
    affectingTitle:'¿Qué más está afectando tu dolor últimamente?',affectingHint:'Opcional. Toca lo que corresponda o dilo con tus palabras.',affectingWords:'Algo más, con tus palabras',
    factors:{'Stress':'Estrés','Work':'Trabajo','Sleep problems':'Problemas para dormir','Money worries':'Preocupaciones de dinero','Family or support':'Familia o apoyo','Activity':'Actividad'} as Record<string,string>,
    todaySaved:'El registro de hoy está guardado',savedAt:'Guardado',update:'Actualizar las respuestas de hoy',updatingTitle:'Actualizando el registro de hoy',updatingHint:'Todo lo que enviaste hoy aparece abajo. Cambia o quita cualquier respuesta y guarda. Tu equipo aún puede ver lo que enviaste antes.',cancel:'Cancelar',
    updatingDaily:'Sigue siendo un registro diario. Para las preguntas de tu visita, guarda o cancela y luego elige “Antes de mi visita”.',updatingPrevisit:'Sigue siendo tu registro antes de la visita.',
    previsitHint:'Responde las preguntas para tu visita. Tu registro de hoy se queda como lo enviaste.',previsitNewTitle:'Un registro nuevo antes de tu visita',previsitNewHint:'Tu registro de hoy se queda como lo enviaste. Estas respuestas se guardan aparte para tu visita.',
    newDay:'Empezó un nuevo día, así que tus respuestas se guardaron como el registro de hoy.',submittedByYou:'Enviado por ti',
    week:'Registros de los últimos 7 días',checkedIn:'con registro',noCheckin:'sin registro',
    tooLong:(over:number)=>`Tus respuestas y notas superan en ${over} caracteres el límite de 2000. Acorta tu comentario o las notas sobre medicamentos. Tus respuestas se conservan.`,
    range:{pain:'0 = sin dolor · 10 = el peor dolor',function:'0 = el dolor las hizo muy difíciles · 10 = el dolor no las afectó',sleep:'0 = muy mala · 10 = muy buena',mood:'0 = muy bajo · 10 = muy bien'}}};

function Scale({id,label,range,value,onChange,disabled,unanswered,declined}:{id:string;label:string;range:string;value:Answer;onChange:(v:Answer)=>void;disabled:boolean;unanswered:string;declined:string}){
  return <fieldset className="checkin-scale" disabled={disabled}>
    <legend>{label}<span>{typeof value==='number'?value+' / 10':value==='declined'?declined:unanswered}</span></legend>
    <div className="checkin-chips" role="group" aria-label={label}>
      {Array.from({length:11},(_,n)=><button type="button" key={n} aria-pressed={value===n} className={value===n?'selected':''} disabled={disabled} onClick={()=>onChange(n)}>{n}</button>)}
    </div>
    <div className="checkin-scale-footer"><small>{range}</small><button type="button" className={'checkin-skip'+(value==='declined'?' selected':'')} aria-pressed={value==='declined'} disabled={disabled} onClick={()=>onChange(value==='declined'?'':'declined')}>{declined}</button></div>
    <select id={id} aria-label={label} className="sr-only" tabIndex={-1} value={value} disabled={disabled} onChange={event=>onChange(event.target.value===''?'':event.target.value==='declined'?'declined':Number(event.target.value))}>
      <option value="">{unanswered}</option><option value="declined">{declined}</option>{Array.from({length:11},(_,n)=><option key={n} value={n}>{n} / 10</option>)}
    </select>
  </fieldset>;
}

/** The optional biopsychosocial question: the patient's own choices and words, never scored. */
function AffectingPainQuestion({value,onChange,disabled,t}:{value:AffectingPain;onChange:(value:AffectingPain)=>void;disabled:boolean;t:typeof copy['en']}){
  return <fieldset className="medq-question checkin-affecting">
    <legend>{t.affectingTitle}</legend><p className="medq-hint">{t.affectingHint}</p>
    <div className="medq-chips" role="group" aria-label={t.affectingTitle}>
      {affectingFactors.map(factor=><button type="button" key={factor} className={value.factors.includes(factor)?'selected':''} aria-pressed={value.factors.includes(factor)} disabled={disabled||value.declined} onClick={()=>onChange({...value,factors:value.factors.includes(factor)?value.factors.filter(item=>item!==factor):[...value.factors,factor]})}>{t.factors[factor]}</button>)}
      <button type="button" className={value.declined?'selected':''} aria-pressed={value.declined} disabled={disabled} onClick={()=>onChange(value.declined?emptyAffectingPain():{factors:[],words:'',declined:true})}>{t.declined}</button>
    </div>
    <label className="medq-field">{t.affectingWords}<Input value={value.words} maxLength={200} disabled={disabled||value.declined} onChange={e=>onChange({...value,words:e.target.value})}/></label>
  </fieldset>;
}

function entryAnswer(record:ObservationRecord,metric:Metric):Answer{const entry=record.currentEntries.find(item=>item.metric===metric);return entry?.status==='declined'?'declined':typeof entry?.value==='number'?entry.value:'';}

/** Today's saved answers, the last seven days, a way to update today's check-in and, unless today's check-in is already the
 *  one for the visit, a way to answer the visit questions as a separate submission. */
function SavedCheckin({p,record,records,now,lang,onUpdate,onPrevisit,onAgain,headingRef}:{p:Patient;record?:ObservationRecord;records:ObservationRecord[];now:Date;lang:'en'|'es';onUpdate:(record:ObservationRecord)=>void;onPrevisit:()=>void;onAgain:()=>void;headingRef:RefObject<HTMLHeadingElement|null>}){
  const t=copy[lang],weekId=useId(),previsitId=useId(),locale=lang==='es'?'es-US':'en-US',shown=(value:Answer)=>typeof value==='number'?value+'/10':value==='declined'?t.declined:t.unanswered;
  const mood=noteMood(record?.patientNote),kind=noteCheckinMode(record?.patientNote);
  const values:[string,string][]=record?[[t.pain,shown(entryAnswer(record,'pain'))],[t.function,shown(entryAnswer(record,'function'))],[t.sleep,shown(entryAnswer(record,'sleep'))],[t.mood,shown(mood??'')]]:[];
  return <div className="checkin-success checkin-today">
    <CheckCircle2 size={44}/><h2 ref={headingRef} tabIndex={-1}>{record?t.todaySaved:t.done}</h2>
    {record&&<p className="checkin-today-time">{t.savedAt} {new Date(record.updatedAt).toLocaleTimeString(locale,{hour:'numeric',minute:'2-digit'})}{kind?' · '+(kind==='daily'?t.daily:t.previsit):''}</p>}
    {record&&<dl className="checkin-today-values">{values.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    <p>{lang==='es'?'Tu equipo puede revisar tus respuestas. Los datos de medicamentos siguen siendo tu informe hasta que el profesional los verifique.':'Your responses are submitted for your care team to review. Medication details remain patient-reported until your clinician verifies them.'}</p>
    <p className="checkin-week-caption" id={weekId}>{t.week}</p>
    <ol className="checkin-week" aria-labelledby={weekId}>{recentCheckinDays(p,records,now).map(item=><li key={item.day} className={(item.checkedIn?'done':'')+(item.day===localDay(now)?' today':'')}><span aria-hidden="true">{item.date.toLocaleDateString(locale,{weekday:'narrow'})}</span><i aria-hidden="true"/><span className="sr-only">{item.date.toLocaleDateString(locale,{weekday:'long',month:'long',day:'numeric'})}: {item.checkedIn?t.checkedIn:t.noCheckin}</span></li>)}</ol>
    {/* Each day already carries its status for screen readers; the key is for sighted patients. */}
    <p className="checkin-week-key" aria-hidden="true"><span className="done"><i/>{t.checkedIn}</span><span><i/>{t.noCheckin}</span></p>
    <p className="checkin-safety">{t.safety}</p>
    {record?<div className="flex flex-wrap justify-center gap-2"><Button variant="outline" onClick={()=>onUpdate(record)}>{t.update}</Button>{kind!=='previsit'&&<Button variant="outline" aria-describedby={previsitId} onClick={onPrevisit}>{t.previsit}</Button>}</div>:<Button variant="outline" onClick={onAgain}>{t.again}</Button>}
    {record&&kind!=='previsit'&&<p id={previsitId} className="checkin-previsit-hint mt-2 text-sm">{t.previsitHint}</p>}
  </div>;
}

const blankAnswers=():Omit<CheckinAnswers,'mode'>=>({location:'',mood:'',report:emptyMedicationReport(),affecting:emptyAffectingPain(),words:''});
export function PatientCheckin({p,ctx,lang='en',mode:initialMode='daily'}:{p:Patient;ctx:Context;lang?:'en'|'es';mode?:Mode}){
  const t=copy[lang],detailId=useId();
  const chartLocation=p.clinicalContext?.painLocation??'';
  const [answers,setAnswers]=useState(blank),[note,setNote]=useState(''),[savedOn,setSavedOn]=useState(''),[error,setError]=useState(''),[sending,setSending]=useState(false);
  // The location is only what the patient picks; the chart's wording is a hint, never saved as their answer.
  const [location,setLocation]=useState(''),[mood,setMood]=useState<Answer>(''),[mode,setMode]=useState<Mode>(initialMode),[more,setMore]=useState(false);
  const [medicationReport,setMedicationReport]=useState<MedicationReport>(emptyMedicationReport),[affecting,setAffecting]=useState<AffectingPain>(emptyAffectingPain);
  // An update edits today's record: the form opens with everything the patient already sent.
  const [updating,setUpdating]=useState<ObservationRecord|null>(null),[startAnswers,setStartAnswers]=useState(blank),[startNote,setStartNote]=useState('');
  // A pre-visit check-in started from today's saved card is a new submission; today's check-in is left as sent.
  const [another,setAnother]=useState(false);
  const [now,setNow]=useState(()=>new Date());
  const pending=useRef<{fingerprint:string;command:WorkflowApplyAction['command']}|null>(null);
  const inFlight=useRef(false);
  // Swapping between the form and the saved card moves focus to the new view's heading, only after the patient acts.
  const focusNext=useRef<'card'|'form'|null>(null),cardHeading=useRef<HTMLHeadingElement>(null),formHeading=useRef<HTMLHeadingElement>(null),updatingHeading=useRef<HTMLDivElement>(null);
  useEffect(()=>{const target=focusNext.current==='card'?cardHeading.current:focusNext.current==='form'?updatingHeading.current??formHeading.current:null;if(focusNext.current){focusNext.current=null;target?.focus();}});
  // "Today" follows the clock: it rolls over at local midnight and when the patient comes back to the page.
  useEffect(()=>{
    let timer=0;
    const refresh=()=>{const next=new Date();setNow(previous=>localDay(previous)===localDay(next)?previous:next);schedule();};
    const schedule=()=>{const at=new Date();window.clearTimeout(timer);timer=window.setTimeout(refresh,new Date(at.getFullYear(),at.getMonth(),at.getDate()+1).getTime()-at.getTime()+1000);};
    const visible=()=>{if(document.visibilityState==='visible')refresh();};
    schedule();document.addEventListener('visibilitychange',visible);window.addEventListener('focus',refresh);
    return ()=>{window.clearTimeout(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',refresh);};
  },[]);
  const today=localDay(now),saved=savedOn===today;
  const records=patientSelfReports(ctx.data,p.id),todayRecord=records.find(record=>localDay(record.createdAt)===today);
  function reset(next:{answers:Record<Metric,Answer>;fields:Omit<CheckinAnswers,'mode'>},record:ObservationRecord|null){
    setAnswers(next.answers);setStartAnswers(next.answers);setStartNote(checkinNote({...next.fields,mode:undefined}));setMood(next.fields.mood);setLocation(next.fields.location);setNote(next.fields.words);setMedicationReport(next.fields.report);setAffecting(next.fields.affecting);setUpdating(record);
    setAnother(false);setError('');setSavedOn('');pending.current=null;
  }
  const startNew=()=>{reset({answers:blank(),fields:blankAnswers()},null);setMode(initialMode);setMore(false);};
  const startPrevisit=()=>{focusNext.current='form';reset({answers:blank(),fields:blankAnswers()},null);setMode('previsit');setMore(false);setAnother(true);};
  function startUpdate(record:ObservationRecord){
    focusNext.current='form';
    // A card left open past midnight belongs to yesterday: start today's check-in instead of changing yesterday's.
    if(localDay(record.createdAt)!==localDay(new Date())){setNow(new Date());startNew();return;}
    const fields=readCheckinNote(record.patientNote);
    reset({answers:{pain:entryAnswer(record,'pain'),function:entryAnswer(record,'function'),sleep:entryAnswer(record,'sleep')},fields},record);
    // An update keeps the check-in's type, so the type toggle is hidden. A note saved before the type line existed stays
    // untyped and opens with the quick questions first; any extra answers already sent are shown.
    setMode(fields.mode??'daily');setMore(!!checkinNote({...fields,mode:undefined,mood:''}));
  }
  const draft=(withMode:boolean)=>checkinNote({mode:withMode?mode:undefined,location,mood,report:medicationReport,affecting,words:note});
  async function submit(event:FormEvent){
    event.preventDefault();if(ctx.busy||inFlight.current)return;
    setError('');
    // An update opened before midnight is saved as the new day's check-in, never as a change to yesterday's.
    const target=updating&&localDay(updating.createdAt)===localDay(new Date())?updating:null;
    const patientNote=target?mergeCheckinNote(target.patientNote??'',draft(false)):draft(true);
    if(patientNote.length>2000){setMore(true);setError(t.tooLong(patientNote.length-2000));return;}
    inFlight.current=true;setSending(true);
    const fingerprint=JSON.stringify({answers,patientNote,updating:target?.id,version:target?.version});
    if(pending.current?.fingerprint!==fingerprint){
      const requestId=crypto.randomUUID(),recordedAt=new Date().toISOString();
      pending.current={fingerprint,command:{type:'encounters.observations.save',requestId,patientId:p.id,encounterId:target?target.encounterId:'checkin-'+requestId,...(target?{expectedVersion:target.version,correctionReason:patientCheckinUpdateReason}:{}),instrument:'local-0-10',submissionStatus:'confirmed',submissionSource:'patient-self-report',patientNote,
        entries:metrics.map(metric=>({metric,status:answers[metric]===''?'unanswered':answers[metric]==='declined'?'declined':answers[metric]===0?'zero':'answered',...(typeof answers[metric]==='number'?{value:answers[metric]}:{}),source:'Patient self-report',recordedAt}))}};
    }
    const command=pending.current!.command;
    try{if(await ctx.save({type:'workflow.apply',domain:'encounters',patientId:p.id,requestId:String(command.requestId),expectedSliceVersion:normalizeClinicalWorkflows(ctx.data.clinicalWorkflows).slices.encounters.version,command},updating&&!target?t.newDay:t.done)){const at=new Date();startNew();setSavedOn(localDay(at));setNow(at);focusNext.current='card';}else setError(lang==='es'?'No se guardó. Tus respuestas se conservan.':'Not saved yet. Your answers are kept here so you can retry.');}
    catch{setError(lang==='es'?'No se guardó. Tus respuestas se conservan. Inténtalo de nuevo.':'Not saved yet. Your answers are kept here so you can retry.');}
    finally{inFlight.current=false;setSending(false);}
  }
  const disabled=ctx.busy||sending,detail=mode==='previsit'||more,kind=updating?noteCheckinMode(updating.patientNote):mode;
  // A new check-in needs at least one answer; an update needs a change to the answers the form opened with.
  const nothingEntered=updating?JSON.stringify(answers)===JSON.stringify(startAnswers)&&draft(false)===startNote:metrics.every(metric=>answers[metric]==='')&&!draft(false);
  // The chart's pain location is a hint only; a Spanish screen shows it only when it is a body-map area with a Spanish name.
  const chartHint=chartLocation&&(lang==='en'||Object.hasOwn(bodyRegionSpanish,chartLocation))?bodyRegionName(chartLocation,lang):'';
  if(!featureEnabled(ctx.data,'assessments'))return <Panel className="checkin-panel previsit-checkin"><EmptyState title={lang==='es'?'Registros desactivados':'Check-ins are turned off'}/></Panel>;
  if(saved||todayRecord&&!updating&&!another)return <Panel className="checkin-panel previsit-checkin"><SavedCheckin p={p} record={todayRecord} records={records} now={now} lang={lang} onUpdate={startUpdate} onPrevisit={startPrevisit} onAgain={()=>{setSavedOn('');focusNext.current='form';}} headingRef={cardHeading}/></Panel>;
  const scale=(metric:Metric)=><Scale key={metric} id={'checkin-'+p.id+'-'+metric} label={t[metric]} range={t.range[metric]} value={answers[metric]} disabled={disabled} unanswered={t.unanswered} declined={t.declined} onChange={v=>setAnswers(previous=>({...previous,[metric]:v}))}/>;
  return <Panel className="checkin-panel previsit-checkin"><form onSubmit={submit} aria-busy={disabled}>
    {/* The type is chosen once: an update keeps it, and a pre-visit check-in started from the saved card is already chosen. */}
    {!updating&&!another&&<div className="checkin-mode" role="group" aria-label={t.modeLabel}>{(['daily','previsit'] as const).map(value=><button type="button" key={value} className={mode===value?'selected':''} aria-pressed={mode===value} onClick={()=>setMode(value)}>{value==='daily'?t.daily:t.previsit}</button>)}</div>}
    {(updating||another)&&<div className="checkin-updating"><div ref={updatingHeading} tabIndex={-1}><strong>{updating?t.updatingTitle:t.previsitNewTitle}</strong><p>{updating?t.updatingHint:t.previsitNewHint}</p>{updating&&kind&&<p>{kind==='daily'?t.updatingDaily:t.updatingPrevisit}</p>}</div><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={()=>{startNew();focusNext.current='card';}}>{t.cancel}</Button></div>}
    {updating?null:mode==='daily'?<div className="previsit-state"><Clock3 size={20}/><div><strong>{t.daily}</strong><p>{t.dailyIntro}</p></div><Badge tone="teal">{t.time}</Badge></div>
    :<><div className="previsit-state"><ClipboardCheck size={20}/><div><strong>{lang==='es'?'Prepárate para tu revisión':'Prepare for your review'}</strong><p>{lang==='es'?'Envía tus respuestas antes de la visita. Tu profesional las verifica contigo.':'Send your responses before the visit. Your clinician verifies them with you.'}</p></div><Badge tone="teal">{lang==='es'?'Informe del paciente':'Patient report'}</Badge></div>
    <div className="previsit-flow" aria-label={lang==='es'?'Pasos de revisión':'Review steps'}><span><b>1</b>{lang==='es'?'Tú respondes':'You submit'}</span><ArrowRight size={14}/><span><b>2</b>{lang==='es'?'El equipo verifica':'Clinician verifies'}</span></div></>}
    <p className="checkin-safety">{t.safety}</p>
    <section className="previsit-section checkin-quick" aria-labelledby={'symptoms-'+p.id}><div className="checkin-heading"><h3 id={'symptoms-'+p.id} ref={formHeading} tabIndex={-1}>{t.today}</h3>{kind&&<Badge tone="teal">{kind==='daily'?t.dailyBadge:t.previsitBadge}</Badge>}</div><p>{t.partial}</p>
      {/* Four one-tap questions: pain, function and sleep make a complete report for the chart; mood is the patient's own rating. */}
      {scale('pain')}{scale('function')}{scale('sleep')}
      <Scale id={'checkin-'+p.id+'-mood'} label={t.mood} range={t.range.mood} value={mood} disabled={disabled} unanswered={t.unanswered} declined={t.declined} onChange={setMood}/>
    </section>
    {mode==='daily'&&<button type="button" className="checkin-more-toggle" aria-expanded={more} aria-controls={detailId} onClick={()=>setMore(value=>!value)}>{more?<Minus size={16}/>:<Plus size={16}/>}{more?t.lessDetail:t.moreDetail}</button>}
    {/* Extra questions stay mounted while hidden so nothing typed is lost; anything filled in is saved with the check-in. */}
    <div id={detailId} className="checkin-detail" hidden={!detail}>
      <section className="previsit-section" aria-labelledby={'detail-'+p.id}><h3 id={'detail-'+p.id}>{t.detailTitle}</h3>
        <details className="checkin-more"><summary><span>{t.where}<small>{location?bodyRegionName(location,lang):t.chooseArea+(chartHint?' · '+t.onRecord+chartHint:'')}</small></span></summary><BodyMap value={location} onChange={setLocation} lang={lang}/></details>
        <AffectingPainQuestion value={affecting} onChange={setAffecting} disabled={disabled} t={t}/>
      </section>
      <section className="previsit-section previsit-medication-report" aria-labelledby={'medications-'+p.id}>
        <div className="previsit-section-heading"><Pill size={18}/><div><h3 id={'medications-'+p.id}>{lang==='es'?'Medicamentos y cómo te sientes':'Medications and how they feel'}</h3><p>{lang==='es'?'Unas preguntas rápidas sobre tus medicamentos. Elige de la lista o escribe con tus palabras. Opcional.':'A few quick questions about your medicines. Pick from the list or write in your own words. Optional.'}</p></div></div>
        {p.medications.filter(m=>m.status==='Active').length>0&&<div className="previsit-recorded-medications"><span>{lang==='es'?'En tu registro':'Currently on your record'}</span>{p.medications.filter(m=>m.status==='Active').map(m=><p key={m.id}><strong>{m.name}</strong><span>{m.regimen||(lang==='es'?'Dosis por verificar':'Dose to verify')}</span></p>)}</div>}
        <CompanionMedicationQuestions p={p} report={medicationReport} onChange={setMedicationReport} disabled={disabled} lang={lang}/>
        <p className="medq-footnote">{lang==='es'?'Tu equipo revisa estas respuestas contigo. No cambian tu receta.':'Your care team checks these answers with you. They do not change your prescription.'}</p>
      </section>
      <label className="checkin-note">{t.note}<Textarea value={note} onChange={event=>setNote(event.target.value)} maxLength={2000} rows={3} disabled={disabled}/></label>
    </div>
    {error&&<p role="alert" className="previsit-error">{error}</p>}<div className="previsit-submit"><p>{lang==='es'?'Se envían las respuestas y notas que hayas completado.':'Your completed answers and medication notes are submitted together.'}</p><Button className="w-full" type="submit" disabled={disabled||nothingEntered}>{disabled?'…':updating?t.saveUpdate:t.submit}<ArrowRight size={16}/></Button></div>
  </form></Panel>;
}

/** A saved check-in note in the patient's language: fixed answers re-rendered, their own words exactly as typed. */
export function CheckinNoteReadback({note,lang}:{note?:string;lang:'en'|'es'}){
  const {rows,words}=checkinReadback(note,lang);
  return <>{rows.length>0&&<dl className="checkin-readback">{rows.map((row,index)=><div key={index}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}{words.length>0&&<p>{words.join('\n')}</p>}</>;
}

export function PatientResponseHistory({p,ctx,lang='en'}:{p:Patient;ctx:Context;lang?:'en'|'es'}){
  const t=copy[lang],records=normalizeClinicalWorkflows(ctx.data.clinicalWorkflows).slices.encounters.state.observations.filter(record=>record.patientId===p.id&&record.status==='confirmed'&&record.submissionSource==='patient-self-report').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  if(!records.length)return null;
  return <Panel title={t.history}><div className="padded stack companion-response-history">{records.map(record=>{const kind=noteCheckinMode(record.patientNote);return <div key={record.id}><div className="previsit-history-heading"><Badge>{formatDate(record.updatedAt,true)}</Badge><span>{t.submittedByYou}{kind?' · '+(kind==='daily'?t.daily:t.previsit):''}</span></div><p>{metrics.map(metric=>{const entry=record.currentEntries.find(item=>item.metric===metric);return `${t[metric]}: ${entry?.value!==undefined?entry.value+'/10':entry?.status==='declined'?t.declined:t.unanswered}`;}).join(' · ')}</p><CheckinNoteReadback note={record.patientNote} lang={lang}/></div>;})}</div></Panel>;
}
