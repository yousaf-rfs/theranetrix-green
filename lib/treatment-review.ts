import type {Patient,Workspace} from './theranetrix';
import {activeMedications,priorityReviews} from './medications';

export const treatmentDirections=['Finding a treatment','Monitoring benefit','Reassessment needed'] as const;
export const goalStatuses=['Not assessed','Not yet met','Partly met','Met'] as const;
export type TreatmentOption={title:string;status:'For discussion'|'Agreed'|'Deferred';rationale:string;considerations:string};
export type TreatmentReviewFields={direction:typeof treatmentDirections[number];goalStatus:typeof goalStatuses[number];goalEvidence:string;decision:string;monitoring:string;options:TreatmentOption[]};
export type TreatmentReview=TreatmentReviewFields&{date:string;author:string;goalAtReview:string;history:(TreatmentReviewFields&{date:string;author:string;goalAtReview:string})[]};
export const emptyTreatmentReview:TreatmentReviewFields={direction:'Finding a treatment',goalStatus:'Not assessed',goalEvidence:'',decision:'',monitoring:'',options:[]};

export function treatmentCourse(p:Patient,w:Workspace){
  const record=p.treatmentReview,meds=activeMedications(p),reviews=priorityReviews(w,p);
  const concerns=meds.some(m=>m.benefit==='No benefit'||m.tolerability==='Effects reported'||m.adherence==='Missed doses'||m.adherence==='Not taking');
  const changedGoal=!!record&&record.goalAtReview!==p.goal;
  const newerData=!!record&&(!!p.recordReviewRequiredSince||(p.medicationReconciliation?.date??'')>record.date||p.medications.some(m=>m.reviewedAt>record.date)||p.checkins.some(c=>c.date>record.date)||(p.clinicalContext?.date??'')>record.date||(p.carePlans[0]?.date??'')>record.date);
  const direction=record?.direction??'Not reviewed';
  // A saved favorable assessment never conceals subsequent concerns.
  const needsRecheck=!!record&&(changedGoal||newerData||(direction==='Monitoring benefit'&&(concerns||reviews.some(r=>r.priority==='High'))));
  return {record,direction,changedGoal,newerData,needsRecheck,goalStatus:changedGoal?'Needs review':record?.goalStatus??'Not assessed',
    priorTrials:p.medications.filter(m=>m.status==='Stopped').sort((a,b)=>(b.stopped||b.reportedAt).localeCompare(a.stopped||a.reportedAt))};
}
export function daysBetween(start:string,end:string){
  if(!start||!end)return null;
  const days=Math.floor((Date.parse(end.slice(0,10)+'T12:00:00Z')-Date.parse(start.slice(0,10)+'T12:00:00Z'))/86400000);
  return Number.isFinite(days)&&days>=0?days:null;
}
