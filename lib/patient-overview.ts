import type {Patient,Review,Workspace} from './theranetrix';
import {activeMedications,followupState,priorityReviews} from './medications';
import {ADVISOR_HANDOFF_SOURCE} from './product-names';

export type ClinicalContextFields = {
  allergyStatus:'Not reviewed'|'None reported'|'Reactions reported'; allergies:string;
  medicalHistory:string; priorTreatments:string; painLocation:string; painDuration:string;
  physicalContext:string; psychologicalContext:string; socialContext:string;
  coordinator:string; preferences:string;
};
export type ClinicalContext = ClinicalContextFields & {date:string;author:string;history:(ClinicalContextFields & {date:string;author:string})[]};
export const emptyClinicalContext:ClinicalContextFields={allergyStatus:'Not reviewed',allergies:'',medicalHistory:'',priorTreatments:'',painLocation:'',painDuration:'',physicalContext:'',psychologicalContext:'',socialContext:'',coordinator:'',preferences:''};

/** The patient's conversation in date order. The last entry decides whether a reply is needed. */
export function patientMessages(p:Pick<Patient,'id'>,w:Workspace){return w.messages.filter(m=>m.patientId===p.id).sort((a,b)=>a.date.localeCompare(b.date));}
export function patientSnapshot(p:Patient,w:Workspace,today=new Date().toISOString().slice(0,10)){
  const reviews=priorityReviews(w,p),medications=activeMedications(p);
  const tasks=w.tasks.filter(t=>t.patientId===p.id&&!t.done).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  const messages=patientMessages(p,w);
  const lastMessage=messages.at(-1);
  const gaps:{label:string;detail:string;kind:'context'|'medication'|'integration'}[]=[];
  if(!p.clinicalContext||p.clinicalContext.allergyStatus==='Not reviewed')gaps.push({label:'Allergies need review',detail:'No reviewed allergy status is recorded.',kind:'context'});
  if(!p.clinicalContext?.medicalHistory)gaps.push({label:'Medical history incomplete',detail:'A clinician-reviewed history has not been recorded.',kind:'context'});
  if(!medications.length&&!p.medicationReconciliation?.none)gaps.push({label:'Medication list unconfirmed',detail:'Current medication use has not been reconciled.',kind:'medication'});
  else if(medications.some(m=>!m.regimen))gaps.push({label:'Medication details incomplete',detail:'Dose, route, or schedule still needs confirmation.',kind:'medication'});
  gaps.push({label:'EHR / Tabia not connected',detail:'The EHR remains the system of record. Outside records, labs, vitals, and EHR updates are unavailable in this prototype.',kind:'integration'});
  return {reviews,medications,tasks,messages,lastMessage,replyNeeded:lastMessage?.direction==='in',gaps,followup:followupState(p,w,today),handoffs:reviews.filter(r=>r.source===ADVISOR_HANDOFF_SOURCE)};
}
export function patientActivity(p:Patient,w:Workspace){
  const items:{id:string;date:string;title:string;detail:string;source:string}[]=[
    ...p.notes.map(n=>({id:'note-'+n.id,date:n.date,title:n.type,detail:n.text,source:n.author})),
    ...(w.features.assessments?p.checkins:[]).map(c=>({id:'checkin-'+c.id,date:c.date,title:c.source==='Stored trajectory'?'Stored outcome observation':'Patient check-in',detail:`Pain ${c.pain}/10 · Function ${c.function}/10 · Sleep ${c.sleep}/10${c.note?' · '+c.note:''}`,source:c.source==='Stored trajectory'?'Outcome history; time not recorded':'Patient self-report'})),
    ...w.audit.filter(a=>a.patientId===p.id&&!/^Saved |^Recorded patient check-in|^Recorded clinician plan/.test(a.action)).map(a=>({id:'audit-'+a.id,date:a.date,title:a.action,detail:'Saved to this patient record.',source:a.actor})),
  ];
  return items.sort((a,b)=>b.date.localeCompare(a.date));
}

/** Review status as the Review queue shows it: a review linked to a care-team handoff follows the handoff's saved phase. */
export function reviewQueueStatus(r:Review,w:Workspace):Review['status']{
  const handoff=w.clinicalWorkflows?.slices['patient-coordination']?.state.handoffs.find(h=>h.id===r.workflowRecordId&&h.patientId===r.patientId);
  if(!handoff)return r.status;
  return handoff.phase==='closed'?'Resolved':['ownership-accepted','reviewed','action-documented','response-recorded'].includes(handoff.phase)?'Acknowledged':'Open';
}
export type NeedsActionRow={id:string;patientId:string;patientName:string;title:string;detail:string;date:string;href:string;priority?:Review['priority'];status?:Review['status']};
export type NeedsActionGroup={id:'reviews'|'replies'|'tasks';label:string;description:string;href:string;rows:NeedsActionRow[]};
/**
 * Needs-action items for the top-bar bell, in labelled groups. Rows use recorded data only:
 * the recorded review priority (not an urgency score), the latest saved message, and the
 * scheduled activity date. One patient event can appear in two groups (a patient request
 * saves a message and opens a review), so the badge counts distinct patients, never rows. The Review queue
 * badge counts open reviews, so the two numbers differ by design; each names its unit. An overdue activity opens
 * the Schedule filtered to that patient, where the activity is listed.
 */
export function needsAction(w:Workspace,today=new Date().toISOString().slice(0,10)){
  const name=(id:string)=>w.patients.find(p=>p.id===id)?.name??id,chart=(id:string,tab:string)=>'/patients/'+encodeURIComponent(id)+'?tab='+tab;
  const rank={High:0,Medium:1,Routine:2};
  const reviews:NeedsActionRow[]=w.reviews.map(r=>({...r,status:reviewQueueStatus(r,w)})).filter(r=>r.status!=='Resolved').sort((a,b)=>rank[a.priority]-rank[b.priority]||a.created.localeCompare(b.created))
    .map(r=>({id:'review-'+r.id,patientId:r.patientId,patientName:name(r.patientId),title:r.title,detail:r.source,date:r.created,href:'/review-queue?patient='+encodeURIComponent(r.patientId),priority:r.priority,status:r.status}));
  const replies:NeedsActionRow[]=w.features.messages?w.patients.flatMap(p=>{const last=patientMessages(p,w).at(-1);return last?.direction==='in'?[{id:'reply-'+p.id,patientId:p.id,patientName:p.name,title:'Latest message is from the patient',detail:last.text,date:last.date,href:chart(p.id,'messages')}]:[];}).sort((a,b)=>a.date.localeCompare(b.date)):[];
  const tasks:NeedsActionRow[]=w.tasks.filter(t=>!t.done&&t.workflowDisposition!=='deferred'&&!!t.date&&t.date<today).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))
    .map(t=>({id:'task-'+t.id,patientId:t.patientId,patientName:name(t.patientId),title:t.title,detail:t.type,date:t.date,href:'/schedule?patient='+encodeURIComponent(t.patientId)}));
  const groups:NeedsActionGroup[]=[
    {id:'reviews',label:'Open reviews',description:'Recorded priority, High first',href:'/review-queue',rows:reviews},
    {id:'replies',label:'Reply needed',description:'Latest saved message is from the patient',href:'/messages',rows:replies},
    {id:'tasks',label:'Overdue activities',description:'Scheduled date has passed',href:'/schedule',rows:tasks},
  ];
  return {groups,patients:new Set(groups.flatMap(g=>g.rows.map(r=>r.patientId))).size};
}
export type NeedsAction=ReturnType<typeof needsAction>;
