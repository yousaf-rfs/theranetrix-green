import type {ObservationRecord} from './clinical-flows/encounters';
import type {Patient,Workspace} from './theranetrix';
import {affectingFactors,affectingPainNote,medicationAnswersFromNote,medicationReportNote,parseMedicationReport,summaryAnswers,type AffectingFactor,type AffectingPain,type MedicationReport,type ReportedLineKind} from './patient-medication-report';

// The patient check-in note carries a few fixed English lines ("Check-in type: Daily", "Location: Left foot",
// "Mood 6/10") beside the medicine answers and the patient's own words. These helpers write and read those lines,
// let an update edit what was already sent, and show a note back to the patient in their own language.
// The stored lines stay English because the clinician views parse them.

export type CheckinMode='daily'|'previsit';
const typePrefix='Check-in type: ',typeNames:Record<CheckinMode,string>={daily:'Daily',previsit:'Pre-visit'};
const locationPrefix='Location: ';
const moodLine=/^Mood (\d{1,2})\/10$/,moodDeclined='Mood: Prefer not to answer';
export const checkinTypeLine=(mode:CheckinMode)=>typePrefix+typeNames[mode];
/** Which check-in the patient chose. Notes saved before the line existed return undefined; `checkinKind` reads those. */
export function noteCheckinMode(note?:string):CheckinMode|undefined{const line=(note??'').split('\n').find(line=>line.startsWith(typePrefix));return line===checkinTypeLine('daily')?'daily':line===checkinTypeLine('previsit')?'previsit':undefined;}
export function noteLocation(note?:string):string{return (note??'').split('\n').find(line=>line.startsWith(locationPrefix))?.slice(locationPrefix.length).trim()??'';}
/** The patient's 0-10 mood, or 'declined' when they chose "Prefer not to answer". */
export function noteMood(note?:string):number|'declined'|undefined{
  const line=(note??'').split('\n').find(line=>line===moodDeclined||moodLine.test(line));if(line===moodDeclined)return 'declined';
  const value=Number(line?.match(moodLine)?.[1]??NaN);return value>=0&&value<=10?value:undefined;
}
const fieldLine=(line:string)=>line.startsWith(typePrefix)||line.startsWith(locationPrefix)||line===moodDeclined||moodLine.test(line);
/** The patient's own words: every line that is not a fixed check-in line or a medicine answer. */
export function noteOwnWords(note?:string):string{return (note??'').split('\n').filter(line=>line.trim()&&!fieldLine(line)&&!parseMedicationReport(line).length).join('\n');}
/** Which check-in a saved record is. A note saved before the type line existed is never assumed to be pre-visit: the daily
 *  form was already the default then, and both forms saved the same lines. It counts as daily only when it holds nothing
 *  beyond what the daily form asked (pain, sleep, mood and the location it filled in) and function was left unanswered;
 *  any other untyped note has no recorded type, so it is never reviewed as the pre-visit questionnaire. */
export function checkinKind(record:Pick<ObservationRecord,'patientNote'|'currentEntries'>):CheckinMode|undefined{
  const typed=noteCheckinMode(record.patientNote);if(typed)return typed;
  const fn=record.currentEntries.find(entry=>entry.metric==='function'),quick=(record.patientNote??'').split('\n').every(line=>!line.trim()||fieldLine(line));
  return quick&&(!fn||fn.status==='unanswered')?'daily':undefined;
}

export type CheckinAnswers={mode?:CheckinMode;location:string;mood:number|'declined'|'';report:MedicationReport;affecting:AffectingPain;words:string};
/** One note from the check-in answers. The check-in type comes first, so every companion submission records it. */
export function checkinNote(answers:CheckinAnswers):string{
  return [answers.mode&&checkinTypeLine(answers.mode),answers.location.trim()&&locationPrefix+answers.location.trim(),typeof answers.mood==='number'?`Mood ${answers.mood}/10`:answers.mood==='declined'?moodDeclined:'',
    medicationReportNote(answers.report),affectingPainNote(answers.affecting),answers.words.trim()].filter(Boolean).join('\n');
}
/** A saved note back as check-in answers, so "Update today’s answers" opens with everything already sent.
 *  `kept` holds the lines the form cannot show; an update keeps those as sent. */
export function readCheckinNote(note?:string):CheckinAnswers&{kept:string[]}{
  const text=note??'',medicines=medicationAnswersFromNote(text),mood=noteMood(text);
  return {mode:noteCheckinMode(text),location:noteLocation(text),mood:mood??'',report:medicines.report,affecting:medicines.affecting,words:noteOwnWords(text),kept:medicines.kept};
}
/** An update is the patient's own edit of today's check-in: the form opens with everything already sent, so the new
 *  answers replace the earlier ones instead of piling up beside them. Earlier lines the form cannot show are kept as
 *  sent. The check-in keeps its type: a daily one stays daily, a pre-visit one stays pre-visit, and a note saved before
 *  the type line existed stays untyped. Answers for the visit on a day with a daily check-in are a new submission. */
export function mergeCheckinNote(previous:string,next:string):string{
  const lines=next.split('\n').filter(line=>line.trim()&&!line.startsWith(typePrefix)),kept=readCheckinNote(previous).kept.filter(line=>!lines.includes(line)),mode=noteCheckinMode(previous);
  return [mode&&checkinTypeLine(mode),...lines,...kept].filter(Boolean).join('\n');
}

/** The reason the companion records when the patient updates today's check-in. */
export const patientCheckinUpdateReason='Patient updated today’s check-in answers in the companion.';
/** True when a version is the patient's own same-day update, not a clinician correction. Each version is read from its
 *  own confirmation event, found by the time it was confirmed (`at`); without `at`, the current version is read. */
export function patientUpdatedCheckin(record:Pick<ObservationRecord,'submissionSource'|'history'>,at?:string):boolean{
  const event=[...record.history].reverse().find(item=>item.to==='confirmed'&&(at===undefined||item.at===at));
  return record.submissionSource==='patient-self-report'&&event?.reason===patientCheckinUpdateReason&&!event.evidenceRef;
}

/** Body-map areas in Spanish. The saved value stays English for the clinician views; one Spanish name per area. */
export const bodyRegionSpanish:Record<string,string>={'Head':'Cabeza','Neck':'Cuello','Right chest':'Pecho derecho','Left chest':'Pecho izquierdo','Abdomen':'Abdomen','Right arm':'Brazo derecho','Left arm':'Brazo izquierdo','Right hand':'Mano derecha','Left hand':'Mano izquierda','Low back':'Parte baja de la espalda','Right thigh':'Muslo derecho','Left thigh':'Muslo izquierdo','Right foot':'Pie derecho','Left foot':'Pie izquierdo','Widespread':'En todo el cuerpo'};
/** A body-map area in the patient's language; anything that is not a body-map area is shown as saved. */
export function bodyRegionName(label:string,lang:'en'|'es'):string{return lang==='es'&&Object.hasOwn(bodyRegionSpanish,label)?bodyRegionSpanish[label]:label;}

// Showing a note back to the patient: fixed lines and medicine answers are re-rendered from their structure in the
// patient's language, with no record-format labels; the patient's own words are shown exactly as typed.
const readbackCopy={
  en:{type:{daily:'Daily check-in',previsit:'Before my visit'},mood:'Mood',where:'Where it hurts',declined:'Prefer not to answer',
    kinds:{'cannot-take':'Medicine you can’t take',tried:'Tried before','taking-now':'Also taking','sleep-anxiety':'Sleep or anxiety medicine',supplement:'Supplement or vitamin',herbal:'Herbal or CBD','food-drink':'Food or drink',unidentified:'Medicine, name not known','affecting-pain':'Also affecting your pain'} as Record<ReportedLineKind,string>,
    labels:{'Reason':'Why','Helped':'How it went','Why stopped':'Why you stopped','Dose':'Amount','How much':'Amount','Name as typed':'Name you typed','Letters or numbers on it':'Letters or numbers','In their words':'In your words'} as Record<string,string>,
    values:{} as Record<string,string>},
  es:{type:{daily:'Registro diario',previsit:'Antes de mi visita'},mood:'Ánimo',where:'Dónde te duele',declined:'Prefiero no responder',
    kinds:{'cannot-take':'Medicamento que no puedes tomar',tried:'Probado antes','taking-now':'También tomas','sleep-anxiety':'Medicamento para dormir o la ansiedad',supplement:'Suplemento o vitamina',herbal:'Hierbas o CBD','food-drink':'Comida o bebida',unidentified:'Medicamento sin nombre conocido','affecting-pain':'También afecta tu dolor'} as Record<ReportedLineKind,string>,
    labels:{'Reason':'Motivo','What happened':'Qué pasó','Helped':'Resultado','Side effects':'Efectos secundarios','Why stopped':'Por qué lo dejaste','Dose':'Cantidad','How much':'Cantidad','Kind':'Tipo','Name as typed':'Nombre que escribiste','Form':'Forma','Color':'Color','Letters or numbers on it':'Letras o números','Used for':'Para qué lo usas','Prescriber or pharmacy':'Quién lo recetó o farmacia','In their words':'Con tus palabras'} as Record<string,string>,
    values:{'None':'Ninguno','Yes, not named':'Sí, sin nombre','Not sure':'No estoy seguro','Name not known':'Nombre desconocido','Prefer not to answer':'Prefiero no responder',
      'Allergic reaction':'Reacción alérgica','Bad side effect':'Efecto secundario fuerte','Told not to take it':'Me dijeron que no lo tomara','Other':'Otro',
      'Helped':'Ayudó','Helped a little':'Ayudó un poco','Did not help':'No ayudó',
      'Drowsy or groggy':'Sueño o aturdimiento','Dizzy':'Mareo','Upset stomach':'Malestar de estómago','Constipation':'Estreñimiento','Skin irritation':'Irritación de la piel','Weight gain':'Aumento de peso','Trouble thinking':'Dificultad para pensar',
      'Pill':'Pastilla','Capsule':'Cápsula','Patch':'Parche','Cream or gel':'Crema o gel','Liquid':'Líquido','Injection':'Inyección','Inhaler':'Inhalador',
      'Sleep or anxiety medicine':'Medicamento para dormir o la ansiedad','Supplement or vitamin':'Suplemento o vitamina','Herbal or CBD product':'Hierbas o CBD','Food or drink':'Comida o bebida',
      'Stress':'Estrés','Work':'Trabajo','Sleep problems':'Problemas para dormir','Money worries':'Preocupaciones de dinero','Family or support':'Familia o apoyo','Activity':'Actividad',
      ...bodyRegionSpanish} as Record<string,string>},
};
const askedKind:Record<string,ReportedLineKind>={'Cannot take':'cannot-take','Tried before':'tried','Taking now':'taking-now'};
// Only fixed answers are translated; a medicine name or anything the patient typed is shown as they wrote it.
const fixedDetails=['Reason','Helped','Side effects','Kind','Form'],fixedNames=[...summaryAnswers,'Name not known'];
export type ReadbackRow={label:string;value:string};
export function checkinReadback(note:string|undefined,lang:'en'|'es'):{type?:string;rows:ReadbackRow[];words:string[]}{
  const c=readbackCopy[lang],text=note??'',mode=noteCheckinMode(text),mood=noteMood(text),location=noteLocation(text);
  const own=(map:Record<string,string>,key:string)=>Object.hasOwn(map,key)?map[key]:undefined,say=(value:string)=>own(c.values,value)??value,list=(value:string)=>value.split(', ').map(say).join(', ');
  const medicines=parseMedicationReport(text).map(item=>{
    const asked=item.details.find(detail=>detail.label==='Asked under')?.value,kind=item.kind==='unidentified'&&asked&&Object.hasOwn(askedKind,asked)?askedKind[asked]:item.kind;
    const factors=item.kind==='affecting-pain'&&item.name.split(', ').every(part=>affectingFactors.includes(part as AffectingFactor));
    const name=factors?list(item.name):fixedNames.includes(item.name)?say(item.name):item.name;
    const details=item.details.filter(detail=>detail.label!=='Asked under').map(detail=>`${own(c.labels,detail.label)??detail.label}: ${fixedDetails.includes(detail.label)?list(detail.value):detail.value}`);
    return {label:c.kinds[kind],value:[name,...details].join(' · ')};
  });
  return {...(mode?{type:c.type[mode]}:{}),rows:[...(mood!==undefined?[{label:c.mood,value:mood==='declined'?c.declined:mood+'/10'}]:[]),...(location?[{label:c.where,value:say(location)}]:[]),...medicines],words:noteOwnWords(text).split('\n').filter(Boolean)};
}

/** The patient's own confirmed check-ins, newest first. */
export function patientSelfReports(data:Workspace,patientId:string):ObservationRecord[]{
  return (data.clinicalWorkflows?.slices.encounters.state.observations??[]).filter(record=>record.patientId===patientId&&record.status==='confirmed'&&record.submissionSource==='patient-self-report').sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
/** Calendar day in the viewer's time zone, so "today" matches the patient's own day. */
export function localDay(at:string|Date):string{const date=new Date(at);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
/** The last seven calendar days ending today, marking the days with at least one patient check-in. */
export function recentCheckinDays(p:Patient,records:readonly ObservationRecord[],now:Date):{day:string;date:Date;checkedIn:boolean}[]{
  const days=new Set([...records.map(record=>localDay(record.createdAt)),...p.checkins.filter(checkin=>checkin.source==='Patient self-report'&&!checkin.withdrawnAt).map(checkin=>localDay(checkin.date))]);
  return Array.from({length:7},(_,index)=>{const date=new Date(now.getFullYear(),now.getMonth(),now.getDate()-6+index);const day=localDay(date);return {day,date,checkedIn:days.has(day)};});
}
