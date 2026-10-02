import {parseMedicationReport,type ReportedMedicationLine} from './patient-medication-report';
import type {Patient} from './theranetrix';

// The companion asks four separate questions: medicines the patient cannot take, medicines they tried before, what
// else they take now (with a kind they choose) and what else is affecting their pain. A check-in can answer any of
// them, so each question's latest answer comes from the newest check-in that answered that question. A later check-in
// that answers only another question never hides an earlier answer. Everything here stays patient-reported.
export type ReportedQuestion='cannot-take'|'tried'|'taking-now'|'affecting-pain';
export const reportedQuestions:ReportedQuestion[]=['cannot-take','tried','taking-now','affecting-pain'];
const askedUnder:Record<string,ReportedQuestion>={'Cannot take':'cannot-take','Tried before':'tried','Taking now':'taking-now'};
/** The question a saved line answers. Kinds (sleep or anxiety medicine, supplement, ...) are written only for things taken
 *  now, and a medicine the patient cannot name carries the question it was asked under. */
export function reportedQuestion(line:Pick<ReportedMedicationLine,'kind'|'details'>):ReportedQuestion|undefined{
  if(line.kind==='unidentified'){const asked=line.details.find(detail=>detail.label==='Asked under')?.value??'';return Object.hasOwn(askedUnder,asked)?askedUnder[asked]:undefined;}
  return line.kind==='cannot-take'||line.kind==='tried'||line.kind==='affecting-pain'?line.kind:'taking-now';
}
export type ReportedAnswer=ReportedMedicationLine&{question:ReportedQuestion;date:string};
/** Each question's lines from the newest source that answered it, dated with that source. Newest first; a later source wins a date tie. */
export function latestReportedAnswers(sources:readonly {date:string;note?:string}[]):ReportedAnswer[]{
  const newest=sources.map((source,index)=>({date:source.date,index,lines:parseMedicationReport(source.note??'')})).sort((a,b)=>b.date.localeCompare(a.date)||b.index-a.index);
  return reportedQuestions.flatMap(question=>{
    const source=newest.find(item=>item.lines.some(line=>reportedQuestion(line)===question));
    return source?source.lines.filter(line=>reportedQuestion(line)===question).map(line=>({...line,question,date:source.date})):[];
  });
}
/** Check-ins still in use. Withdrawn ones are left out, and a workflow record contributes only a check-in projected from its
 *  current version: an answer the patient removed in an update never comes back from the version it replaced. A current
 *  version that did not project a check-in (a measure left unanswered) leaves no check-in for that record. */
export function currentCheckins(p:Pick<Patient,'checkins'|'workflowObservations'>):Patient['checkins']{
  const latest=new Map<string,number>();
  for(const item of [...(p.workflowObservations??[]),...p.checkins])if(item.workflowRecordId)latest.set(item.workflowRecordId,Math.max(latest.get(item.workflowRecordId)??0,item.workflowVersion??0));
  return p.checkins.filter(checkin=>!checkin.withdrawnAt&&(!checkin.workflowRecordId||(checkin.workflowVersion??0)>=latest.get(checkin.workflowRecordId)!));
}
/** Every current patient self-report for PST and the visit: each confirmed self-report record's current answers, plus the
 *  check-ins still in use. A record whose current version projected no check-in (medicine answers only, or a measure left
 *  unanswered in an update) still counts, so an answer the patient kept is not lost and one they removed does not return.
 *  A record is dated as its check-in is, from when the patient answered, so a later clinician correction does not make its
 *  answers look newer than a check-in the patient sent after it. */
export type SelfReportRecord={patientId:string;status:string;submissionSource?:string;createdAt:string;patientNote?:string;currentEntries:readonly {metric:string;recordedAt:string}[]};
export function selfReportSources(p:Pick<Patient,'id'|'checkins'|'workflowObservations'>,records:readonly SelfReportRecord[]):{date:string;note:string}[]{
  return [
    ...records.filter(r=>r.patientId===p.id&&r.status==='confirmed'&&r.submissionSource==='patient-self-report').map(r=>({date:r.currentEntries.find(entry=>entry.metric==='pain')?.recordedAt??r.createdAt,note:r.patientNote??''})),
    ...currentCheckins(p).map(c=>({date:c.date,note:c.note??''})),
  ];
}
