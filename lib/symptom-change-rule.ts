import {z} from 'zod';
import type {ObservationRecord} from './clinical-flows/encounters';
import {workflowBridgeId} from './clinical-flows/bridge-identity';
import {noteLocation,patientCheckinUpdateReason} from './patient-checkin-note';
import type {Patient,Review,Workspace} from './theranetrix';

// A rule-based review flag for a new patient check-in. Clinicians set the thresholds in
// Settings; with none set the rule is off. It lists which of those thresholds a check-in
// met and asks for clinician review. It does not score risk, judge clinical significance
// or notify anyone outside this workspace's Review queue.

export const SYMPTOM_CHANGE_SOURCE='Reported symptom change (rule-based review flag)';
export const DEMO_RULE_BASIS='Demo setting, not a validated threshold';
export const CLINICIAN_RULE_BASIS='Set by a clinician in workspace settings';
export const symptomChangeThresholdsSchema=z.object({painRise:z.number().int().min(1).max(10).nullable(),painAtLeast:z.number().int().min(1).max(10).nullable(),newLocation:z.boolean()}).strict();
export type SymptomChangeThresholds=z.infer<typeof symptomChangeThresholdsSchema>;
type RuleSetting=SymptomChangeThresholds&{setBy:string;recordedBy:string;setAt:string;basis:string};
export type SymptomChangeRule=RuleSetting&{history?:RuleSetting[]};

/** Settings form identity: it changes when the rule is saved, undone or reset, so the form's inputs start again from the saved rule. */
export const ruleFormKey=(rule?:Pick<SymptomChangeRule,'setAt'>|null)=>rule?.setAt??'off';
export const ruleIsOn=(rule?:SymptomChangeThresholds|null):rule is SymptomChangeThresholds=>!!rule&&(rule.painRise!==null||rule.painAtLeast!==null||rule.newLocation);
/** The demo workspace starts with example values so the flag can be shown. They are labeled as such everywhere they appear. */
export const demoSymptomChangeRule=():SymptomChangeRule=>({painRise:3,painAtLeast:8,newLocation:true,setBy:'Demo workspace',recordedBy:'Demo workspace',setAt:'2026-07-28T12:00:00.000Z',basis:DEMO_RULE_BASIS});
/** Every earlier setting is kept, newest first, with who set it and when. */
export function nextSymptomChangeRule(previous:SymptomChangeRule|undefined,thresholds:SymptomChangeThresholds,clinician:string,actor:string,at:string):SymptomChangeRule{
  if(!previous)return {...thresholds,setBy:clinician.trim(),recordedBy:actor,setAt:at,basis:CLINICIAN_RULE_BASIS,history:[]};
  const {history=[],...setting}=previous;
  return {...thresholds,setBy:clinician.trim(),recordedBy:actor,setAt:at,basis:CLINICIAN_RULE_BASIS,history:[setting,...history]};
}
export function thresholdSummary(rule:SymptomChangeThresholds):string{
  if(!ruleIsOn(rule))return 'Off: no thresholds set';
  return [rule.painRise!==null&&`pain rise of ${rule.painRise} or more points since the previous check-in`,rule.painAtLeast!==null&&`pain reaching ${rule.painAtLeast}/10 or higher from a previous score below ${rule.painAtLeast}/10`,rule.newLocation&&'a body-map location not reported in earlier check-ins'].filter(Boolean).join('; ');
}

// Only body-map regions are compared. A typed or chart location is free text and is never matched.
export const bodyMapLocations=['Head','Neck','Right chest','Left chest','Abdomen','Right arm','Left arm','Right hand','Left hand','Low back','Right thigh','Left thigh','Right foot','Left foot','Widespread'];
export function checkinLocation(note?:string):string|null{const value=noteLocation(note);return bodyMapLocations.includes(value)?value:null;}

export type CheckinReport={date:string;pain:number|null;location:string|null;source:string};
const score=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=10;
const time=(value:string)=>Date.parse(value);
export function recordReport(record:ObservationRecord):CheckinReport{
  const pain=record.currentEntries.find(entry=>entry.metric==='pain');
  const date=record.currentEntries.map(entry=>entry.recordedAt).filter(value=>Number.isFinite(time(value))).sort().at(-1)??record.updatedAt;
  return {date,pain:pain&&(pain.status==='answered'||pain.status==='zero')&&score(pain.value)?pain.value:null,location:checkinLocation(record.patientNote),source:record.submissionSource==='patient-self-report'?'patient check-in':'confirmed report'};
}
/** Confirmed reports before this check-in: other confirmed records, plus stored scores that no workflow record projected. Withdrawn records are left out. */
export function earlierReports(patient:Patient,records:readonly ObservationRecord[],current:ObservationRecord):CheckinReport[]{
  const projected=new Set(patient.checkins.filter(checkin=>checkin.workflowRecordId&&checkin.trajectoryIndex!==undefined).map(checkin=>checkin.trajectoryIndex));
  const stored=patient.dates.flatMap((date,index):CheckinReport[]=>projected.has(index)||!score(patient.pain[index])||!Number.isFinite(time(date))?[]:[{date,pain:patient.pain[index],location:null,source:'recorded check-in'}]);
  const before=time(recordReport(current).date);
  return [...records.filter(record=>record.patientId===patient.id&&record.status==='confirmed'&&record.id!==current.id).map(recordReport),...stored].filter(report=>time(report.date)<before).sort((a,b)=>time(a.date)-time(b.date));
}

const REVIEW_PROMPT='This is a prompt for clinician review, not an assessment of the patient.';
const day=(value:string)=>Number.isFinite(time(value))?new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}):'date not recorded';
export type SymptomChangeResult={title:string;detail:string;matched:string[]};
/** Which set thresholds this check-in met, with previous and current values. Null when the rule is off or nothing matched. */
export function evaluateSymptomChange(rule:SymptomChangeRule|undefined,earlier:readonly CheckinReport[],current:CheckinReport):SymptomChangeResult|null{
  if(!rule||!ruleIsOn(rule))return null;
  const previous=[...earlier].reverse().find(report=>report.pain!==null),located=earlier.filter(report=>report.location);
  const rise=previous&&current.pain!==null?current.pain-previous.pain!:null;
  // A missing earlier location means there is nothing to compare, not a new location.
  const newLocation=rule.newLocation&&current.location&&located.length>0&&!located.some(report=>report.location===current.location)?current.location:null;
  const matched=[
    ...(rule.painRise!==null&&rise!==null&&rise>=rule.painRise?[`pain rose ${rise} points since the previous check-in (threshold: a rise of ${rule.painRise} or more)`]:[]),
    // The pain level matches when a score reaches it, not on every check-in that stays at or above it.
    ...(rule.painAtLeast!==null&&current.pain!==null&&current.pain>=rule.painAtLeast&&(!previous||previous.pain!<rule.painAtLeast)?[previous?`pain reached ${current.pain}/10 from ${previous.pain}/10 (threshold: reaching ${rule.painAtLeast}/10 or higher)`:`pain reported at ${current.pain}/10 with no earlier score (threshold: ${rule.painAtLeast}/10 or higher)`]:[]),
    ...(newLocation?[`body-map location "${newLocation}" was not reported in earlier check-ins`]:[]),
  ];
  if(!matched.length)return null;
  const pain=current.pain===null?'Pain not answered':previous?`Pain ${previous.pain} → ${current.pain}/10`:`Pain ${current.pain}/10`;
  const latestLocated=located.at(-1);
  return {matched,title:`${SYMPTOM_CHANGE_SOURCE}: ${pain}${newLocation?` · new location: ${newLocation.toLowerCase()}`:''}`,detail:[
    `Thresholds met: ${matched.join('; ')}.`,
    `Previous: ${previous?`pain ${previous.pain}/10 on ${day(previous.date)} (${previous.source})`:'no earlier pain score to compare'}${located.length?` · body-map locations reported before: ${[...new Set(located.map(report=>report.location))].join(', ')} (latest ${day(latestLocated!.date)})`:''}.`,
    `This check-in: ${current.pain!==null?`pain ${current.pain}/10`:'pain not answered'}${current.location?` · location: ${current.location}`:''} on ${day(current.date)} (${current.source}).`,
    `Rule: ${thresholdSummary(rule)}. ${rule.basis}; set by ${rule.setBy} on ${day(rule.setAt)}.`,
    REVIEW_PROMPT,
  ].join('\n')};
}

const RULE_ACTOR='Symptom-change review rule',CLEARED='The new values no longer meet the set thresholds; this flag stays for clinician review.';
// A flag keeps every check-in that met the rule while it was open: the one it shows, plus one "Earlier" detail line and
// title entry for each earlier one, so moving the flag to a newer check-in never hides a trigger nobody has resolved.
const UNREVIEWED='Earlier, not yet reviewed: ',ACKNOWLEDGED='Earlier, acknowledged, not resolved: ',EARLIER_TITLE=' · earlier: ',earlierLabel=/^Earlier, (not yet reviewed|acknowledged, not resolved): /;
type Shown=Pick<Review,'title'|'detail'>;
const titleParts=(title:string)=>{const [current,earlier]=title.split(EARLIER_TITLE);return {current,summary:current.replace(SYMPTOM_CHANGE_SOURCE+': ','').replace(' · ',', '),earlier:earlier?earlier.split('; '):[]};};
const earlierLines=(detail:string,label?:string)=>detail.split('\n').filter(line=>earlierLabel.test(line)).map(line=>label?line.replace(earlierLabel,label):line);
/** The check-in a flag shows, as one Earlier line: its values, what it met and any later note on it. Flags saved before this line existed read the same way. */
function earlierLine(flag:Shown,label:string){
  const lines=flag.detail.split('\n').filter(line=>!earlierLabel.test(line)),checkin=lines.find(line=>line.startsWith('This check-in: '));
  const notes=lines.filter(line=>line.trim()&&line!==REVIEW_PROMPT&&!/^(Thresholds met|Previous|This check-in|Rule): /.test(line));
  return label+[checkin?checkin.slice('This check-in: '.length):titleParts(flag.title).summary+'.',lines.find(line=>line.startsWith('Thresholds met: ')),...notes].filter(Boolean).join(' ');
}
/** A flag's title and detail with these Earlier entries in place of its old ones: titles after the current summary, lines before the rule line. */
const withEarlier=(shown:Shown,titles:string[],lines:string[]):Shown=>{
  const detail=shown.detail.split('\n').filter(line=>!earlierLabel.test(line)),at=detail.findIndex(line=>line.startsWith('Rule: '));detail.splice(at<0?detail.length:at,0,...lines);
  return {title:titleParts(shown.title).current+(titles.length?EARLIER_TITLE+titles.join('; '):''),detail:detail.join('\n')};
};
// The companion saves a patient's update of today's check-in with this reason (patient-checkin.tsx). Every save in this
// prototype shares one session actor, so the recorded reason, not the actor, tells a patient update from a clinician correction.
/** Null for a check-in's first confirmation; otherwise who changed it, worded for the review history. */
export function checkinChange(record:Pick<ObservationRecord,'history'>):{byPatient:boolean;text:string}|null{
  const confirmed=record.history.filter(item=>item.to==='confirmed'),event=confirmed.at(-1);
  if(!event||confirmed.length<2)return null;
  const byPatient=event.reason===patientCheckinUpdateReason&&!event.evidenceRef;
  return {byPatient,text:byPatient?`The patient updated this check-in in the companion on ${day(event.at)}.`:`This check-in was corrected by ${event.actor} on ${day(event.at)}: ${event.reason.trim().replace(/\.+$/,'')}.`};
}
/**
 * Run once per new or corrected patient check-in. While a patient has an open flag, a later check-in that meets the rule
 * updates that flag instead of adding another High review: the flag shows the later check-in and keeps each earlier one
 * in its title and detail. New matches set the flag to Open, and the history says when that reopens an acknowledged flag. A correction
 * updates the flag of the check-in it changed, and only when what the rule matched changed. A resolved flag is reopened
 * only by the patient's own update of that check-in, never by a clinician correction, and a clinician correction never
 * raises a new flag. Flags are annotated, never removed.
 */
export function flagSymptomChange(workspace:Workspace,patient:Patient,record:ObservationRecord,records:readonly ObservationRecord[]){
  if(record.status!=='confirmed'||record.submissionSource!=='patient-self-report')return;
  const flags=workspace.reviews.filter(review=>review.patientId===patient.id&&review.source===SYMPTOM_CHANGE_SOURCE),own=flags.find(review=>review.workflowRecordId===record.id);
  if(own?.workflowVersion===record.version)return;
  const report=recordReport(record),result=evaluateSymptomChange(workspace.symptomChangeRule,earlierReports(patient,records,record),report),change=checkinChange(record),at=record.updatedAt;
  // The flag's version is that of the check-in it shows; only a flag that now shows this check-in takes this version.
  const annotate=(review:Review,status:Review['status'],resolution:string,fields:Partial<Review>,version=record.version)=>{
    Object.assign(review,{...fields,status,history:[{status,resolution,actor:RULE_ACTOR,date:at},...(review.history??[])],workflowVersion:version,updatedAt:at,updatedBy:RULE_ACTOR});
    if(status!=='Resolved')patient.status='Needs review';
  };
  if(own){
    // Nothing the rule matched changed (a sleep or note fix, the same answers sent again, or still below every threshold): the flag is left as it is.
    const updated=result&&withEarlier(result,titleParts(own.title).earlier,earlierLines(own.detail));
    if(updated?.title===own.title||!result&&own.history?.[0]?.actor===RULE_ACTOR&&own.history[0].resolution.includes(CLEARED)){own.workflowVersion=record.version;return;}
    const text=`${change?.text??'This check-in changed.'} ${result?'The rule was checked again.':CLEARED}`;
    annotate(own,result&&own.status==='Resolved'&&change?.byPatient?'Open':own.status,`${text} Earlier title: ${own.title}`,updated??{detail:`${own.detail}\n${text}`});
    return;
  }
  if(!result||change&&!change.byPatient)return;
  const open=flags.find(review=>review.status!=='Resolved'),shown=open&&records.find(item=>item.id===open.workflowRecordId);
  // The open flag moves to the newest check-in that met the rule; an older check-in does not take it back but is kept as an
  // Earlier line. Either way the flag is Open again. An acknowledgement covered what the flag held then, so those lines say so.
  if(open){
    const acknowledged=open.status==='Acknowledged',parts=titleParts(open.title),kept=earlierLines(open.detail,acknowledged?ACKNOWLEDGED:undefined);
    const reopened=acknowledged?' This flag was acknowledged; it is open again because this check-in has not been reviewed.':'';
    if(!shown||time(recordReport(shown).date)<=time(report.date))annotate(open,'Open',`A later check-in on ${day(report.date)} met the set thresholds; this flag now shows it and keeps the earlier check-in in its detail.${reopened} Earlier title: ${open.title}`,{...withEarlier(result,[parts.summary,...parts.earlier],[earlierLine(open,acknowledged?ACKNOWLEDGED:UNREVIEWED),...kept]),workflowRecordId:record.id,encounterId:record.encounterId});
    else annotate(open,'Open',`An earlier-dated check-in on ${day(report.date)} met the set thresholds; it is kept in this flag's detail, which still shows the latest check-in.${reopened}`,withEarlier(open,[...parts.earlier,titleParts(result.title).summary],[...kept,earlierLine(result,UNREVIEWED)]),open.workflowVersion);
    return;
  }
  const base=workflowBridgeId('symptom-change-review',patient.id,record.id),id=workspace.reviews.some(review=>review.id===base)?workflowBridgeId('symptom-change-review',patient.id,record.id,String(record.version)):base;
  if(workspace.reviews.some(review=>review.id===id))throw new Error('Symptom-change review identity collision.');
  workspace.reviews.unshift({id,patientId:patient.id,encounterId:record.encounterId,workflowRecordId:record.id,workflowVersion:record.version,title:result.title,detail:result.detail,priority:'High',source:SYMPTOM_CHANGE_SOURCE,status:'Open',created:at,owner:patient.clinician});
  patient.status='Needs review';
}
