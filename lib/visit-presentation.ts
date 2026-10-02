import {featureEnabled,type Patient,type Workspace} from './theranetrix';
import type {ObservationRecord,SignoffRecord} from './clinical-flows/encounters';
import {activeMedications,followupState} from './medications';
import {patientSnapshot} from './patient-overview';
import {baseName,intakeCategories,parseMedicationReport,reportedKindLabels,type ReportedLineKind,type ReportedMedicationLine} from './patient-medication-report';
import {checkinKind,noteCheckinMode,noteLocation,noteMood,noteOwnWords} from './patient-checkin-note';
import {reportedQuestion} from './patient-reported-answers';

import {visitMetrics,visitObservations,type VisitMetric,type VisitObservation} from './visit-observations';
export {visitMetrics,visitObservations,type VisitMetric,type VisitObservation} from './visit-observations';

export function visitRecordState(p:Patient,w:Workspace){
  const observations=visitObservations(p);
  // Several check-ins, signed amendments or encounter artifacts must never create fictional visits.
  const signedEncounterIds=new Set(w.clinicalWorkflows?.slices.encounters.state.signoffs.filter(record=>record.patientId===p.id&&record.status==='signed').map(record=>record.encounterId)??[]);
  return {reportCount:observations.length,dataState:observations.length===0?'No reports yet':observations.length===1?'First report':'Repeat reports',signedEncounters:signedEncounterIds.size};
}

// Prototype composite on 0–10, higher = worse: mean(pain, 10 − function, 10 − sleep).
// Observed scores only; any missing measure makes it unavailable. No inferred mood term.
export function outcomeComposite(point?:Pick<VisitObservation,VisitMetric>|null):number|null{
  if(!point||visitMetrics.some(key=>typeof point[key]!=='number'))return null;
  return Math.round((point.pain!+(10-point.function!)+(10-point.sleep!))/3*10)/10;
}
export function prototypeComposite(p:Patient){
  const points=visitObservations(p),current=points.at(-1),previous=points.at(-2);
  const missing=visitMetrics.filter(key=>!current||current[key]===null);
  const value=outcomeComposite(current),prior=outcomeComposite(previous);
  // A partial latest report never borrows older scores. The newest complete report is returned beside it, with its own
  // date, so the clinician sees the last value that one report fully supports.
  const complete=value===null?[...points].reverse().find(point=>outcomeComposite(point)!==null):undefined;
  return {value,previous:prior,delta:value!==null&&prior!==null?Math.round((value-prior)*10)/10:null,since:previous?.date??null,missing,
    date:current?.date??null,declined:missing.filter(key=>current?.statuses?.[key]==='declined'),lastComplete:complete?{value:outcomeComposite(complete)!,date:complete.date}:null};
}

// One-line synopsis for the top of the visit tab. Every value is already recorded elsewhere on the page.
export function visitGlance(p:Patient,w:Workspace,today=new Date().toISOString().slice(0,10)){
  const snapshot=patientSnapshot(p,w,today),plan=p.carePlans[0],meds=snapshot.medications;
  const points=featureEnabled(w,'assessments')?visitObservations(p):[],latest=points.at(-1),prior=points.at(-2);
  return {
    report:latest?{date:latest.date,since:prior?.date??null,metrics:visitMetrics.map(key=>{const value=latest[key],before=prior?.[key]??null,change=value!==null&&before!==null?value-before:null;return {key,value,status:value===null?(latest.statuses?.[key]==='declined'?'declined':'not answered'):'answered',change,tone:(change===null||change===0?'neutral':(key==='pain'?change<0:change>0)?'better':'worse') as 'neutral'|'better'|'worse'};})}:null,
    // The same count or priority the Needs attention rail shows as its badge.
    highPriority:snapshot.reviews.filter(r=>r.priority==='High').length,topPriority:snapshot.reviews[0]?.priority??null,
    medications:{count:meds.length,sideEffects:meds.filter(m=>m.tolerability==='Effects reported').length,missedUse:meds.filter(m=>m.adherence==='Missed doses'||m.adherence==='Not taking').length,confirmedNone:!!p.medicationReconciliation?.none},
    followup:plan?{date:plan.followup,time:plan.time,owner:plan.owner,state:(snapshot.followup.completed?'completed':snapshot.followup.overdue?'overdue':'planned') as 'completed'|'overdue'|'planned'}:null,
  };
}

// Visits come only from encounter preparation, assessment and sign-off records, plus the saved plan.
// Patient check-ins ('checkin-' encounters, self-report observations) are reports, never visits.
export type VisitStep={id:'pre'|'in'|'post';label:string;state:'done'|'current'|'pending';status:string;date:string|null;followup?:{date:string;state:'due'|'overdue'|'completed';bookingConfirmed:boolean}};
export type RecordedEncounter={encounterId:string;date:string;status:string;steps:VisitStep[]};
type EncounterRow={patientId:string;encounterId:string;createdAt:string;updatedAt:string};
const assessmentStatus={completed:'Assessment recorded',deferred:'Assessment deferred','urgent-review':'Routed for urgent review','out-of-scope':'Recorded as out of scope',draft:'Assessment in draft'} as const;
export function visitProgression(p:Patient,w:Workspace,today=new Date().toISOString().slice(0,10)):{latest:RecordedEncounter|null;encounters:RecordedEncounter[]}{
  const state=w.clinicalWorkflows?.slices.encounters.state;
  const own=<T extends EncounterRow>(rows:readonly T[]|undefined)=>(rows??[]).filter(row=>row.patientId===p.id&&!row.encounterId.startsWith('checkin-'));
  const newest=<T extends EncounterRow>(rows:T[]):T|undefined=>[...rows].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
  const preparations=own(state?.preparations),assessments=own(state?.assessments),signoffs=own(state?.signoffs);
  const plan=p.carePlans[0],followup=followupState(p,w,today);
  const signedAt=(record:SignoffRecord)=>record.history.find(item=>item.to==='signed')?.at??record.updatedAt;
  const encounters=[...new Set([...preparations,...assessments,...signoffs].map(row=>row.encounterId))].map(encounterId=>{
    const mine=<T extends EncounterRow>(rows:T[])=>rows.filter(row=>row.encounterId===encounterId);
    const prep=newest(mine(preparations)),assessment=newest(mine(assessments)),group=mine(signoffs);
    const signed=group.filter(record=>record.status==='signed').sort((a,b)=>signedAt(b).localeCompare(signedAt(a)))[0],open=newest(group.filter(record=>record.status!=='signed'));
    const date=[...mine(preparations),...mine(assessments),...group].map(row=>row.createdAt).sort()[0];
    const pre:VisitStep=prep?{id:'pre',label:'Pre-visit',state:prep.status==='draft'?'current':'done',status:prep.status==='clinician-reviewed'?'Preparation reviewed':prep.status==='prepared'?'Prepared':'Preparation in draft',date:prep.updatedAt}:{id:'pre',label:'Pre-visit',state:'pending',status:'No preparation recorded',date:null};
    const during:VisitStep=assessment?{id:'in',label:'In visit',state:assessment.status==='draft'?'current':'done',status:assessmentStatus[assessment.status],date:assessment.updatedAt}:{id:'in',label:'In visit',state:'pending',status:'No assessment recorded',date:null};
    // The latest saved plan speaks for follow-up only when it came from this sign-off, or was saved outside any encounter after this one began.
    const ownPlan=plan&&(signed?plan.workflowRecordId===signed.id:!plan.encounterId&&plan.date>=date)?plan:undefined;
    const due=(on:string,booked:boolean)=>({date:on,state:(ownPlan&&followup.completed?'completed':ownPlan&&followup.overdue?'overdue':'due') as 'due'|'overdue'|'completed',bookingConfirmed:booked});
    const post:VisitStep=signed?{id:'post',label:'Post-visit',state:'done',status:(signed.amendedFromId?'Amendment signed in workspace':'Signed in workspace')+(open?' · amendment in progress':''),date:signedAt(signed),followup:due((signed.signedSnapshot?.followUp??signed.followUp).date,false)}
      :open?{id:'post',label:'Post-visit',state:'current',status:open.status==='reviewed'?'Sign-off reviewed, not signed':'Sign-off in draft',date:open.updatedAt}
      :ownPlan?{id:'post',label:'Post-visit',state:'current',status:'Plan saved, not signed',date:ownPlan.date,followup:due(ownPlan.followup,!!ownPlan.appointmentBooked)}
      :{id:'post',label:'Post-visit',state:'pending',status:'Not signed',date:null};
    const furthest=[post,during,pre].find(step=>step.state!=='pending')??pre;
    return {encounterId,date,status:furthest.status,steps:[pre,during,post]};
  }).sort((a,b)=>a.date.localeCompare(b.date)||a.encounterId.localeCompare(b.encounterId));
  return {latest:encounters.at(-1)??null,encounters};
}

// The patient's latest pre-visit questionnaire (companion self-report) and whether a clinician marked it reviewed.
// A review is an attributed audit entry for that record version, so an updated answer needs a new review.
// Daily check-ins are never the questionnaire: they do not replace it or reset its review, and the card lists the
// newest one separately. A note saved before the check-in type was recorded is never assumed to be the questionnaire
// (see checkinKind); it is listed with the daily check-ins, as daily or with its type not recorded.
export function questionnaireReviewLabel(record:{id:string;version:number;createdAt:string}){return `Reviewed pre-visit questionnaire · submitted ${record.createdAt.slice(0,10)} · record ${record.id} v${record.version}`;}
export type QuestionnaireAnswer=number|'Declined'|'Not answered';
const summaryNames=['None','Yes, not named','Not sure'];
const chosenKinds:ReportedLineKind[]=intakeCategories.filter(kind=>kind!=='other');
/** The patient's confirmed self-reports, newest first; on a timestamp tie the later-saved record wins. */
function selfReports(p:Patient,w:Workspace):ObservationRecord[]{
  const rows=(w.clinicalWorkflows?.slices.encounters.state.observations??[]).filter(row=>row.patientId===p.id&&row.status==='confirmed'&&row.submissionSource==='patient-self-report');
  return rows.map((row,index)=>({row,index})).sort((a,b)=>b.row.createdAt.localeCompare(a.row.createdAt)||b.index-a.index).map(item=>item.row);
}
const answerOf=(record:ObservationRecord,metric:VisitMetric):QuestionnaireAnswer=>{const entry=record.currentEntries.find(item=>item.metric===metric);return entry&&(entry.status==='answered'||entry.status==='zero')&&typeof entry.value==='number'?entry.value:entry?.status==='declined'?'Declined':'Not answered';};
const moodOf=(note?:string)=>{const mood=noteMood(note);return mood==='declined'?'Declined' as const:mood??null;};
export function latestQuestionnaire(p:Patient,w:Workspace){
  const record=selfReports(p,w).find(row=>checkinKind(row)==='previsit');
  if(!record)return null;
  const note=record.patientNote??'',lines=parseMedicationReport(note);
  // Every medicine answer counts once, filed under the question it answers: a kind the patient chose is something taken
  // now, and a medicine they could not name counts where it was asked, with how many of that count have no name.
  // Only an unnamed medicine with no question is counted on its own. "What else is affecting your pain" is not a medicine.
  const medicines=lines.filter(line=>line.kind!=='affecting-pain');
  const answered=(question:string)=>medicines.filter(line=>reportedQuestion(line)===question&&!summaryNames.includes(line.name));
  const named=(question:string)=>answered(question).length,unnamed=(question:string)=>answered(question).filter(line=>line.kind==='unidentified').length;
  // "Taking now" asks for medicines not on the record, but a patient may still name one that is: that one is counted apart.
  const active=activeMedications(p).map(m=>baseName(m.name)),onRecord=(line:ReportedMedicationLine)=>line.kind!=='unidentified'&&active.includes(baseName(line.name));
  const alsoOnRecord=answered('taking-now').filter(onRecord).length;
  const review=w.audit.find(entry=>entry.patientId===p.id&&entry.action===questionnaireReviewLabel(record));
  return {record,submittedAt:record.createdAt,updatedAt:record.updatedAt,
    answers:{pain:answerOf(record,'pain'),function:answerOf(record,'function'),sleep:answerOf(record,'sleep')},
    mood:moodOf(note),location:noteLocation(note),
    // The patient's own words only; fixed check-in lines and every medicine or "affecting pain" line are summarized instead.
    concerns:noteOwnWords(note),
    affecting:lines.filter(line=>line.kind==='affecting-pain').map(line=>[line.name,...line.details.map(detail=>`${detail.label}: ${detail.value}`)].join(' · ')).join('; '),
    medicines:{answered:medicines.length>0,cannotTake:named('cannot-take'),tried:named('tried'),takingNow:named('taking-now')-alsoOnRecord,alsoOnRecord,
      notNamed:{cannotTake:unnamed('cannot-take'),tried:unnamed('tried'),takingNow:unnamed('taking-now'),other:medicines.filter(line=>line.kind==='unidentified'&&!reportedQuestion(line)).length},
      allergicReaction:medicines.some(line=>reportedQuestion(line)==='cannot-take'&&line.details.some(detail=>detail.label==='Reason'&&detail.value==='Allergic reaction')),
      kinds:chosenKinds.filter(kind=>medicines.some(line=>line.kind===kind)).map(kind=>reportedKindLabels[kind])},
    review:review?{actor:review.actor,date:review.date}:null};
}
/** How many of the patient's check-ins were saved before the check-in type was recorded. They are never taken for the
 *  pre-visit questionnaire, so the visit tab says they exist instead of implying nothing was sent. */
export function untypedCheckinCount(p:Patient,w:Workspace){return selfReports(p,w).filter(row=>!noteCheckinMode(row.patientNote)).length;}
/** The newest check-in that is not the pre-visit questionnaire, shown beside it and never as it: a daily check-in, or a
 *  note saved before the type was recorded (`kind` undefined). Function shows only when answered; older daily check-ins did not ask it. */
export function latestDailyCheckin(p:Patient,w:Workspace){
  const record=selfReports(p,w).find(row=>checkinKind(row)!=='previsit');
  if(!record)return null;
  const fn=answerOf(record,'function');
  return {record,kind:checkinKind(record),date:record.createdAt,answers:{pain:answerOf(record,'pain'),sleep:answerOf(record,'sleep'),...(fn==='Not answered'?{}:{function:fn})},mood:moodOf(record.patientNote)};
}
/** The patient's own words from their newest check-in that has any: the current version of each confirmed self-report,
 *  plus check-ins saved outside the workflow records. Fixed check-in lines and medicine answers are summarized elsewhere,
 *  and `skipRecordId` leaves out a record whose words are already shown (the questionnaire). */
export function latestPatientWords(p:Patient,w:Workspace,skipRecordId?:string):{text:string;date:string}|null{
  const records=selfReports(p,w).filter(record=>record.id!==skipRecordId).map(record=>({text:noteOwnWords(record.patientNote),date:record.updatedAt}));
  const saved=p.checkins.filter(checkin=>!checkin.withdrawnAt&&!checkin.workflowRecordId&&checkin.source!=='Clinician-confirmed report').map(checkin=>({text:noteOwnWords(checkin.note),date:checkin.date}));
  return [...records,...saved].filter(item=>item.text).sort((a,b)=>b.date.localeCompare(a.date))[0]??null;
}

export type VisitChange={id:string;label:string;detail:string;target:'outcomes'|'medications'|'context'|'plan';medicationId?:string;tone:'better'|'concern'|'neutral'};
export function changesSincePriorReport(p:Patient):{since:string|null;latest:string|null;items:VisitChange[]}{
  const points=visitObservations(p),current=points.at(-1),previous=points.at(-2);
  if(!current||!previous)return {since:null,latest:current?.date??null,items:[]};
  const items:VisitChange[]=[];
  for(const key of visitMetrics){
    const value=current[key],before=previous[key];
    if(value===null||before===null||value===before)continue;
    const better=key==='pain'?value<before:value>before;
    items.push({id:key,label:key==='function'?'Daily function':key==='sleep'?'Sleep quality':'Pain',detail:`${before} → ${value} / 10`,target:'outcomes',tone:better?'better':'concern'});
  }
  items.push(...recordChangesSince(p,previous.date));
  return {since:previous.date,latest:current.date,items};
}

/** Medication, clinical-context and care-plan entries recorded after a date (compared by day). */
export function recordChangesSince(p:Patient,since:string):VisitChange[]{
  const cutoff=since.slice(0,10),items:VisitChange[]=[];
  for(const medication of p.medications){
    if(medication.reportedAt.slice(0,10)<=cutoff)continue;
    const prior=[...medication.history].filter(report=>report.reportedAt.slice(0,10)<=cutoff).sort((a,b)=>b.reportedAt.localeCompare(a.reportedAt))[0];
    if(!prior)continue; // A newly entered record is not evidence that treatment was newly started.
    const changed=[prior.regimen!==medication.regimen?'Regimen updated':null,prior.benefit!==medication.benefit?`Benefit: ${medication.benefit.toLowerCase()}`:null,prior.tolerability!==medication.tolerability||prior.effects!==medication.effects?'Tolerability report updated':null,prior.adherence!==medication.adherence?`Use: ${medication.adherence.toLowerCase()}`:null,prior.status!==medication.status?`Status: ${medication.status.toLowerCase()}`:null].filter(Boolean);
    if(changed.length)items.push({id:'medication-'+medication.id,label:medication.name,detail:changed.join(' · '),target:'medications',medicationId:medication.id,tone:medication.tolerability==='Effects reported'||medication.benefit==='No benefit'?'concern':'neutral'});
  }
  if(p.clinicalContext&&p.clinicalContext.date.slice(0,10)>cutoff&&p.clinicalContext.history.length)items.push({id:'context',label:'Clinical context updated',detail:'Review the recorded history and preferences.',target:'context',tone:'neutral'});
  const plan=p.carePlans[0];
  if(plan&&plan.date.slice(0,10)>cutoff)items.push({id:'plan',label:'Care plan updated',detail:'Review the saved plan and follow-up.',target:'plan',tone:'neutral'});
  return items;
}
