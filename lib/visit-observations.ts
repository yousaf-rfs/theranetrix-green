import type {Patient} from './theranetrix';

export const visitMetrics=['pain','function','sleep'] as const;
export type VisitMetric=typeof visitMetrics[number];
export type VisitObservation={date:string;pain:number|null;function:number|null;sleep:number|null;source:string;statuses?:Partial<Record<VisitMetric,'answered'|'zero'|'unanswered'|'declined'>>};
// Every observation row names where it came from. A check-in saved before sources were
// recorded is still a patient check-in; a score with no check-in behind it is the stored
// trajectory the workspace was seeded or migrated with.
export function checkinSource(checkin?:{source?:string}):string{return checkin?(checkin.source||'Patient check-in'):'Stored trajectory';}
export const workflowEntrySource=(source?:string)=>source||'Clinical workflow record';
const recordedScore=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=10;

// A trajectory row is an observation, not an encounter. Keep gaps as gaps.
export function visitObservations(p:Patient):VisitObservation[]{
  const points:VisitObservation[]=p.dates.flatMap((date,index)=>{
    if(!date||!Number.isFinite(Date.parse(date)))return [];
    const source=p.checkins.find(report=>!report.withdrawnAt&&report.trajectoryIndex===index)??p.checkins.find(report=>!report.withdrawnAt&&!report.workflowRecordId&&report.date.slice(0,10)===date.slice(0,10)&&visitMetrics.every(key=>report[key]===p[key][index]));
    const point={date,pain:recordedScore(p.pain[index])?p.pain[index]:null,function:recordedScore(p.function[index])?p.function[index]:null,sleep:recordedScore(p.sleep[index])?p.sleep[index]:null,source:checkinSource(source)};
    return visitMetrics.some(key=>point[key]!==null)?[point]:[];
  });
  const records=new Map<string,NonNullable<Patient['workflowObservations']>>();
  for(const entry of p.workflowObservations??[])records.set(entry.workflowRecordId,[...(records.get(entry.workflowRecordId)??[]),entry]);
  for(const [recordId,entries] of records){
    const superseded=new Set(entries.flatMap(entry=>entry.correctedFromEntryId?[entry.correctedFromEntryId]:[]));
    const current=entries.filter(entry=>!entry.withdrawnAt&&!superseded.has(entry.id));
    if(!current.length)continue;
    const latest=[...current].sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt))[0];
    if(!latest.recordedAt||!Number.isFinite(Date.parse(latest.recordedAt)))continue;
    const point:VisitObservation={date:latest.recordedAt,pain:null,function:null,sleep:null,source:[...new Set(current.map(entry=>workflowEntrySource(entry.source)))].join('; '),statuses:{}};
    for(const key of visitMetrics){
      const entry=current.filter(row=>row.metric===key).sort((a,b)=>b.workflowVersion-a.workflowVersion)[0];
      if(!entry)continue;
      point.statuses![key]=entry.status;
      if((entry.status==='answered'||entry.status==='zero')&&recordedScore(entry.value))point[key]=entry.value;
    }
    // A submission with every measure left unanswered carries no report. It must not
    // replace the latest answered scores. Declined and zero remain real responses.
    if(visitMetrics.every(key=>point[key]===null&&(point.statuses![key]??'unanswered')==='unanswered'))continue;
    const projection=p.checkins.find(report=>!report.withdrawnAt&&report.workflowRecordId===recordId&&report.trajectoryIndex!==undefined);
    // Replace the matching projected row rather than count the same report twice.
    const projectedIndex=projection?points.findIndex(row=>row.date.slice(0,10)===p.dates[projection.trajectoryIndex!]?.slice(0,10)&&visitMetrics.every(key=>row[key]===projection[key])):-1;
    if(projectedIndex>=0)points[projectedIndex]=point;else points.push(point);
  }
  return points.sort((a,b)=>a.date.localeCompare(b.date));
}

