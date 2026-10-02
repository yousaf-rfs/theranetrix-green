import {visitObservations} from './visit-observations';
import type {Patient, Workspace} from './theranetrix';
import {normalizeClinicalWorkflows} from './clinical-flows';
import {ensureObservationRecords} from './observations';
import {ensureTreatmentDemoCases} from './demo-cases';
import {relabelLegacyRecords} from './relabel';
import {ensureDemoIdentities} from './demo-identity';
import {medicationCategory} from './medication-presentation';

export const benefits = ['Not assessed', 'Helpful', 'Partly helpful', 'No benefit'] as const;
export const tolerabilities = ['Not assessed', 'No effects reported', 'Effects reported'] as const;
export const medicationAdherence = ['Not assessed', 'Taken as recorded', 'Missed doses', 'Not taking'] as const;
export type MedicationReport = {
  benefit: typeof benefits[number]; tolerability: typeof tolerabilities[number];
  adherence: typeof medicationAdherence[number]; effects: string; reportedAt: string;
};
export type Medication = MedicationReport & {
  id: string; name: string; regimen: string; indication: string; status: 'Active'|'Stopped';
  started: string; source: 'Patient report'|'Clinician entry';
  regimenSince?: string; stopped?: string; stopReason?: string;
  reviewedAt: string; reviewedBy: string;
  history: (MedicationReport & {date:string;author:string;name:string;regimen:string;status:'Active'|'Stopped';regimenSince?:string;stopped?:string;stopReason?:string;started?:string;indication?:string})[];
};
export type CarePlan = {id:string;text:string;owner:string;followup:string;time:string;date:string;author:string;encounterId?:string;workflowRecordId?:string;workflowVersion?:number;workflowGoal?:string;timezone?:string;appointmentBooked?:boolean;supersedes?:string};
export type SuggestionBasis = {label:string;value:string;date?:string;href?:string};
export type Suggestion = {title:string;reason:string;kind:'medication'|'plan'|'review'|'referral';attention:boolean;basis?:SuggestionBasis[];services?:readonly string[]};

const examples:Record<string,{name:string;medication:string;benefit:Medication['benefit'];indication?:string;effects?:string;adherence?:Medication['adherence']}> = {
  'TN-1042':{name:'Sarah Mitchell',medication:'Gabapentin',benefit:'Partly helpful',indication:'Painful peripheral neuropathy',effects:'Patient reports morning grogginess.'},
  'TN-1038':{name:'James Wilson',medication:'Acetaminophen',benefit:'Helpful'},
  'TN-1051':{name:'Elena Rodriguez',medication:'Duloxetine',benefit:'Partly helpful'},
  'TN-1047':{name:'Robert Chen',medication:'Gabapentin',benefit:'No benefit',indication:'Painful peripheral neuropathy',adherence:'Missed doses'},
  'TN-1034':{name:'Olivia Bennett',medication:'Acetaminophen',benefit:'Helpful'},
  'TN-1031':{name:'Grace Park',medication:'Duloxetine',benefit:'Helpful'},
  'TN-1049':{name:'David Anderson',medication:'Gabapentin',benefit:'Not assessed',indication:'Painful peripheral neuropathy'},
};
// One fictional medication taken for another reason, so the "Other medications" group has an example.
// It is listed second: the showcase enriches only a patient's first medication.
const otherExamples:Record<string,{name:string;medication:string;indication:string}> = {
  'TN-1038':{name:'James Wilson',medication:'Levothyroxine',indication:'Hypothyroidism (example record)'},
};
// These are explicitly fictional reports, never clinical efficacy or prescribing data.
export function sampleMedications(p:Pick<Patient,'id'|'name'|'condition'>):Medication[]{
  const e=examples[p.id];if(!e||e.name!==p.name)return [];
  const other=otherExamples[p.id];
  return [{id:'sample-med-'+p.id,name:e.medication,regimen:'',indication:e.indication??p.condition,status:'Active',started:'',
    benefit:e.benefit,tolerability:e.effects?'Effects reported':e.benefit==='Not assessed'?'Not assessed':'No effects reported',
    effects:e.effects??'',adherence:e.adherence??'Not assessed',reportedAt:'2026-09-08',
    source:'Patient report',reviewedAt:'',reviewedBy:'',history:[]},
    ...(other?[{id:'sample-other-med-'+p.id,name:other.medication,regimen:'',indication:other.indication,status:'Active' as const,started:'',
      benefit:'Helpful' as const,tolerability:'No effects reported' as const,effects:'',adherence:'Taken as recorded' as const,reportedAt:'2026-09-08',
      source:'Patient report' as const,reviewedAt:'',reviewedBy:'',history:[]}]:[])];
}
// Idempotent JSON upgrade. An explicitly saved empty list is never reseeded.
export function normalizeWorkspace(w:Workspace):Workspace{
  w.features.reviewPrompts??=true;
  w.clinicalWorkflows=normalizeClinicalWorkflows(w.clinicalWorkflows);
  for(const p of w.patients){p.medications??=sampleMedications(p);p.carePlans??=[];}
  return ensureDemoIdentities(relabelLegacyRecords(ensureObservationRecords(ensureTreatmentDemoCases(clinicianFacingReviews(w)))));
}
function clinicianFacingReviews(w:Workspace){
  for(const review of w.reviews){
    if(review.title.startsWith('Human handoff: '))review.title=review.title.slice('Human handoff: '.length);
    if(review.source==='Human handoff')review.source='Patient concern';
    if(review.detail.includes('Local phase:')){
      const concern=review.detail.split('\n')[0];
      review.detail=[concern,review.owner?`Owner: ${review.owner}`:''].filter(Boolean).join('\n');
    }
  }
  for(const patient of w.patients){
    for(const note of patient.notes){
      if(note.text.includes('Local phase:'))note.text=note.text.split('\n')[0];
    }
  }
  return w;
}
export function activeMedications(p:Patient){return (p.medications??[]).filter(m=>m.status==='Active');}
export function priorityReviews(w:Workspace,p:Patient){
  const rank={High:0,Medium:1,Routine:2};
  return w.reviews.filter(r=>r.patientId===p.id&&r.status!=='Resolved').sort((a,b)=>rank[a.priority]-rank[b.priority]||b.created.localeCompare(a.created));
}
export function followupState(p:Patient,w:Workspace,today=new Date().toISOString().slice(0,10)){
  const plan=p.carePlans?.[0],legacyId='medication-followup-'+p.id;
  const task=w.tasks.find(t=>t.patientId===p.id&&t.planId===plan?.id&&(t.id===legacyId||t.id.startsWith('wf-followup-')))
    ??w.tasks.find(t=>t.id===legacyId&&(!t.planId||t.planId===plan?.id));
  return {task,completed:!!task?.done,overdue:!!p.carePlans?.[0]&&!task?.done&&p.carePlans[0].followup<today};
}
export function patientSuggestions(p:Patient,w:Workspace):Suggestion[]{
  if(w.features.reviewPrompts===false)return [{title:'Review the patient record',reason:'Document your clinical assessment and agreed next steps.',kind:'plan',attention:false}];
  const meds=activeMedications(p),items:Suggestion[]=[];
  // Pain-response prompts cover medications recorded for pain or with an unconfirmed indication.
  // Side-effect and missed-dose prompts stay on for every medication.
  const painMeds=meds.filter(m=>medicationCategory(m)!=='other');
  const add=(title:string,reason:string,kind:Suggestion['kind']='medication',attention=true)=>items.push({title,reason,kind,attention});
  const concerns=meds.filter(m=>m.tolerability==='Effects reported');
  if(concerns.length)add('Review reported side effects',concerns.map(m=>`${m.name}: ${m.effects}`).join(' '));
  const noBenefit=painMeds.filter(m=>m.benefit==='No benefit');
  if(noBenefit.length)add('Reassess reported benefit',noBenefit.map(m=>`${m.name}: no benefit reported on ${m.reportedAt}.`).join(' '));
  const missed=meds.filter(m=>m.adherence==='Missed doses'||m.adherence==='Not taking');
  if(missed.length)add('Clarify medication use',missed.map(m=>`${m.name}: ${m.adherence.toLowerCase()}.`).join(' '));
  if(!meds.length&&!p.medicationReconciliation?.none)add('Reconcile the medication list','No active medication entries. Confirm current use, including whether the patient takes no medication.');
  const unassessed=painMeds.filter(m=>m.benefit==='Not assessed'||m.tolerability==='Not assessed');
  if(unassessed.length)add('Ask about benefit and tolerability',unassessed.map(m=>m.name).join(', ')+': the response assessment is incomplete.');
  const partial=painMeds.filter(m=>m.benefit==='Partly helpful');
  if(partial.length)add('Discuss remaining symptoms and goals',partial.map(m=>m.name).join(', ')+': only partial benefit reported.');
  const observations=w.features.assessments?visitObservations(p):[],current=observations.at(-1),previous=observations.at(-2);
  if(current&&previous&&((current.pain!==null&&previous.pain!==null&&current.pain>previous.pain)||(current.function!==null&&previous.function!==null&&current.function<previous.function)))add('Review the latest symptom change','Pain increased or function declined since the prior check-in. Discuss the change with the patient.','review');
  const review=priorityReviews(w,p)[0];if(review)add(review.title,review.detail,'review');
  const missingRegimen=painMeds.filter(m=>!m.regimen);
  if(missingRegimen.length)add('Confirm dose and schedule',missingRegimen.map(m=>m.name).join(', ')+': the recorded regimen is incomplete.');
  const unknownUse=painMeds.filter(m=>m.adherence==='Not assessed');
  if(unknownUse.length)add('Confirm how medication is being taken',unknownUse.map(m=>m.name).join(', ')+': use has not been assessed.');
  if(w.features.assessments&&!observations.length)add('Collect a first outcome check-in','No recorded outcome reports are available.','review');
  if(!p.carePlans?.length)add('Record the next review plan','Assign an owner and follow-up date.','plan',false);
  if(!items.length)add('Review progress toward the patient’s goal','Discuss the recorded benefit, tolerability, and outcome trends at follow-up.','plan',false);
  // Last, so a referral prompt never replaces the briefing's suggested next step.
  const referral=referralSuggestion(p,observations);if(referral)items.push(referral);
  return items;
}

/**
 * PLACEHOLDER referral-prompt thresholds: provisional, pending clinical team criteria.
 * Demo settings, not validated. The clinical team replaces these values; until then every
 * referral prompt shows `status` on screen. A prompt only suggests that the clinician
 * consider a referral. Nothing is referred, booked, or sent automatically.
 */
export const referralPromptRules={
  status:'Prototype rule: referral criteria are provisional, pending clinical team criteria.',
  goalNotMetReviews:2,  // the latest reviews of the current goal all record Not yet met or Partly met
  recentReports:3,      // the latest outcome reports compared with the first report
  minImprovement:2,     // pain and function each less than this many points better than the first report count as not improved (flat or worse)
  effectStops:2,        // stopped medications whose recorded tolerability is Effects reported
  lowFunction:3,        // function at or below this value in every recent report counts as persistently low
  services:['Physical therapy','Pain psychology','Specialty review'],
} as const;
const day=(date?:string)=>date?date.slice(0,10):'date not recorded';
export function referralSuggestion(p:Patient,observations:ReturnType<typeof visitObservations>):Suggestion|undefined{
  const rules=referralPromptRules,href='/patients/'+encodeURIComponent(p.id),matched:string[]=[],basis:SuggestionBasis[]=[];
  const reviews=p.treatmentReview?[p.treatmentReview,...p.treatmentReview.history].filter(r=>r.goalAtReview===p.goal).slice(0,rules.goalNotMetReviews):[];
  if(reviews.length===rules.goalNotMetReviews&&reviews.every(r=>r.goalStatus==='Not yet met'||r.goalStatus==='Partly met')){
    matched.push(`goal recorded as not yet met or partly met at the last ${reviews.length} reviews`);
    for(const r of reviews)basis.push({label:'Goal review: '+r.goalStatus,value:r.goalEvidence||'No goal evidence recorded.',date:r.date,href:href+'?tab=visit#patient-goal'});
  }
  const scored=observations.filter(o=>o.pain!==null&&o.function!==null),first=scored[0],recent=scored.slice(1).slice(-rules.recentReports);
  if(first&&recent.length===rules.recentReports&&recent.every(o=>first.pain!-o.pain!<rules.minImprovement&&o.function!-first.function!<rules.minImprovement)){
    matched.push(`neither pain nor function ${rules.minImprovement} or more points better than the first report in the last ${recent.length} reports`);
    for(const o of recent)basis.push({label:`Outcome report: pain ${o.pain}/10, function ${o.function}/10 (first report ${first.pain}/10, ${first.function}/10 on ${day(first.date)})`,value:'Source: '+o.source,date:o.date,href:href+'?tab=twin'});
  }
  const effects=activeMedications(p).filter(m=>m.tolerability==='Effects reported');
  const stops=(p.medications??[]).filter(m=>m.status==='Stopped'&&m.tolerability==='Effects reported');
  if(effects.length||stops.length>=rules.effectStops){
    matched.push([effects.length?'medication effects reported':'',stops.length>=rules.effectStops?`${stops.length} medications stopped for effects`:''].filter(Boolean).join(' and '));
    for(const m of effects)basis.push({label:m.name+': effects reported',value:m.effects||'Details not recorded.',date:m.reportedAt||undefined,href:href+'?tab=visit#patient-medications'});
    if(stops.length>=rules.effectStops)for(const m of stops)basis.push({label:m.name+': stopped for effects',value:m.stopReason||m.effects||'Stopping reason not recorded.',date:m.stopped||undefined,href:href+'?tab=visit#patient-medications'});
  }
  const functionReports=observations.filter(o=>o.function!==null).slice(-rules.recentReports);
  if(functionReports.length===rules.recentReports&&functionReports.every(o=>o.function!<=rules.lowFunction)){
    matched.push(`function ${rules.lowFunction}/10 or lower in the last ${functionReports.length} reports`);
    for(const o of functionReports)basis.push({label:`Function report: ${o.function}/10`,value:'Source: '+o.source,date:o.date,href:href+'?tab=twin'});
  }
  if(!matched.length)return undefined;
  return {title:'Consider a referral',kind:'referral',attention:false,services:rules.services,basis,
    reason:`Prototype rules matched: ${matched.join('; ')}. Services to consider: physical therapy, pain psychology, or specialty review. The clinician decides; nothing is referred automatically. ${rules.status}`};
}
/** The referral prompt's dated evidence as text for the referral form's reason. */
export function referralEvidenceText(basis:readonly SuggestionBasis[]=[]){
  return ['Referral prompt (prototype rule; criteria pending clinical team). Evidence:',...basis.map(b=>'- '+day(b.date)+' · '+b.label)].join('\n').slice(0,1000);
}
export type ReferralPromptPrefill={services:readonly string[];reason:string};
/** This patient's current referral prompt for the J30 form: the services it lists and its dated evidence, rebuilt from the record. Undefined when no prompt matches now. */
export function referralPromptPrefill(p:Patient,w:Workspace):ReferralPromptPrefill|undefined{
  const s=referralSuggestion(p,w.features.assessments?visitObservations(p):[]);
  return s?{services:s.services??[],reason:referralEvidenceText(s.basis)}:undefined;
}
/**
 * J30 referral form for this patient with one of the prompt's services. The link carries only the service name: the form
 * rebuilds the dated evidence from the record (referralPromptPrefill), so no clinical text goes into the URL, browser
 * history, request logs or saved feedback. The clinician reviews and edits every field before saving; nothing is sent.
 */
export function referralStartHref(patientId:string,service:string,s:Pick<Suggestion,'services'>){
  return '/patients/'+encodeURIComponent(patientId)+'?'+new URLSearchParams({tab:'full',workflow:'results-referrals',workflowJourney:'J30',...(s.services?.includes(service)?{referralService:service}:{})}).toString();
}
