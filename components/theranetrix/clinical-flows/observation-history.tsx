'use client';

import {useId} from 'react';
import type {Patient} from '@/lib/theranetrix';
import type {ObservationRecord} from '@/lib/clinical-flows/encounters';
import {patientUpdatedCheckin} from '@/lib/patient-checkin-note';
import {checkinSource,workflowEntrySource} from '@/lib/visit-observations';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {Badge,Panel,formatDate} from '../ui';

type Entry=NonNullable<Patient['workflowObservations']>[number];
const metrics=['pain','function','sleep'] as const;
const metricLabels={pain:'Pain',function:'Daily function',sleep:'Sleep quality'};

/** Only return a source attached to the existing numeric trajectory record. */
export function numericObservationSource(patient:Pick<Patient,'dates'|'pain'|'function'|'sleep'|'checkins'>,index:number):string{
  const matches=patient.checkins.filter(checkin=>!checkin.withdrawnAt&&checkin.date.slice(0,10)===patient.dates[index]&&checkin.pain===patient.pain[index]&&checkin.function===patient.function[index]&&checkin.sleep===patient.sleep[index]);
  const projected=matches.find(checkin=>checkin.trajectoryIndex===index);
  if(projected)return checkinSource(projected);
  const sources=[...new Set(matches.filter(checkin=>!checkin.workflowRecordId).map(checkin=>checkin.source).filter((source):source is NonNullable<typeof source>=>!!source))];
  if(sources.length)return sources.join('; ');
  return checkinSource(matches.find(checkin=>!checkin.workflowRecordId));
}

// Patient companion check-ins are saved under a 'checkin-' encounter. Their original answers are the
// patient's own, not clinician-confirmed; later corrections show who saved them. Reviews are recorded separately.
const patientCheckin=(entry:Entry)=>entry.encounterId.startsWith('checkin-');

function RecordedTime({value}:{value:string}){
  return <time dateTime={value} title={value}>{formatDate(value,true)}</time>;
}

function response(entry:Entry){
  if(entry.status==='declined')return 'Declined — no numeric response';
  if(entry.status==='unanswered')return 'Unanswered — no numeric response';
  if(typeof entry.value!=='number'||!Number.isFinite(entry.value))return 'Value not recorded';
  return `${entry.value} / 10${entry.status==='zero'?' · Zero response':''}`;
}

/** `selfReports` (the patient's own check-in records) lets a same-day update made by the patient read as the patient's, not as the
 *  signed-in account's. Each version is attributed from its own confirmation event, so a patient update later superseded by
 *  another update or a clinician correction still reads as the patient's. */
export function ObservationHistory({patient,selfReports=[]}:{patient:Pick<Patient,'id'|'workflowObservations'>;selfReports?:readonly ObservationRecord[]}){
  const prefix=useId();
  const entries=patient.workflowObservations??[];
  if(!entries.length)return null;
  const anchors=new Map(entries.map((entry,index)=>[entry.id,`${prefix}-observation-${index}`]));
  const reports=new Map<string,Entry[]>();
  for(const entry of entries)reports.set(entry.workflowRecordId,[...(reports.get(entry.workflowRecordId)??[]),entry]);
  const grouped=[...reports.entries()].sort(([,a],[,b])=>Math.max(...b.map(entry=>Date.parse(entry.confirmedAt)))-Math.max(...a.map(entry=>Date.parse(entry.confirmedAt))));
  function rows(records:Entry[],all:Entry[],kind:'Current'|'Superseded'|'Withdrawn'){
    const checkin=patientCheckin(records[0]);
    return <Table aria-label={`${kind} confirmed responses for encounter ${records[0].encounterId}`}>
      <TableHeader><TableRow><TableHead scope="col">Measure</TableHead><TableHead scope="col">Response</TableHead><TableHead scope="col">Recorded source and time</TableHead><TableHead scope="col">{checkin?'Submitted or updated by':'Confirmed by'}</TableHead><TableHead scope="col">Revision</TableHead></TableRow></TableHeader>
      <TableBody>{records.map(entry=>{
        const previous=entry.correctedFromEntryId?all.find(candidate=>candidate.id===entry.correctedFromEntryId):undefined;
        const next=all.filter(candidate=>candidate.correctedFromEntryId===entry.id);
        return <TableRow key={entry.id} id={anchors.get(entry.id)} data-observation-status={entry.status} data-observation-current={kind==='Current'} data-observation-withdrawn={!!entry.withdrawnAt}>
          <TableCell>{metricLabels[entry.metric]}</TableCell>
          <TableCell className="whitespace-normal">{response(entry)}</TableCell>
          <TableCell className="whitespace-normal"><div>{workflowEntrySource(entry.source)}</div><small>Recorded <RecordedTime value={entry.recordedAt}/></small></TableCell>
          <TableCell className="whitespace-normal">{checkin&&!entry.correctedFromEntryId?<><div>Submitted by patient</div><small>Submitted <RecordedTime value={entry.confirmedAt}/></small></>:checkin?<><div>{(()=>{const record=selfReports.find(item=>item.id===entry.workflowRecordId);return record&&patientUpdatedCheckin(record,entry.confirmedAt)?'Updated by patient':entry.confirmedBy||'Not recorded';})()}</div><small>Updated <RecordedTime value={entry.confirmedAt}/></small></>:<><div>{entry.confirmedBy||'Confirming clinician not recorded'}</div><small>Confirmed <RecordedTime value={entry.confirmedAt}/></small></>}</TableCell>
          <TableCell className="whitespace-normal"><div><Badge tone={kind==='Current'?'teal':'neutral'}>{kind}</Badge> · version {entry.workflowVersion}</div>
            {entry.withdrawnAt&&<div>Withdrawn <RecordedTime value={entry.withdrawnAt}/>{entry.withdrawalReason&&<p>{entry.withdrawalReason}</p>}</div>}
            {previous&&<a className="text-link" href={`#${anchors.get(previous.id)}`}>View earlier {metricLabels[entry.metric].toLowerCase()} entry</a>}
            {entry.correctedFromEntryId&&!previous&&<div>Earlier entry is unavailable.</div>}
            {next.map(correction=><div key={correction.id}><a className="text-link" href={`#${anchors.get(correction.id)}`}>View {metricLabels[entry.metric].toLowerCase()} correction · version {correction.workflowVersion}</a></div>)}
          </TableCell>
        </TableRow>;
      })}</TableBody>
    </Table>;
  }
  return <Panel title="Confirmed encounter observations" subtitle="Current responses and their recorded sources. Corrected and withdrawn answers remain in history." className="mt-5">
    <div className="padded stack">{grouped.map(([recordId,all])=>{
      const superseded=new Set(all.flatMap(entry=>entry.correctedFromEntryId?[entry.correctedFromEntryId]:[]));
      const current=all.filter(entry=>!entry.withdrawnAt&&!superseded.has(entry.id)).sort((a,b)=>metrics.indexOf(a.metric)-metrics.indexOf(b.metric));
      const history=all.filter(entry=>!entry.withdrawnAt&&superseded.has(entry.id)).sort((a,b)=>Date.parse(b.confirmedAt)-Date.parse(a.confirmedAt));
      const withdrawn=all.filter(entry=>!!entry.withdrawnAt).sort((a,b)=>Date.parse(b.confirmedAt)-Date.parse(a.confirmedAt));
      const missing=metrics.filter(metric=>!current.some(entry=>entry.metric===metric));
      const numeric=current.filter(entry=>(entry.status==='answered'||entry.status==='zero')&&typeof entry.value==='number'&&Number.isFinite(entry.value)).length;
      const partial=missing.length>0||numeric<metrics.length;
      return <section className="stack" key={recordId} aria-label={`Encounter ${all[0].encounterId} observations`}>
        <div className="panel-bottom"><h3>{patientCheckin(all[0])?<>Patient check-in · submitted <RecordedTime value={[...all].sort((a,b)=>a.confirmedAt.localeCompare(b.confirmedAt))[0].confirmedAt}/></>:<>Encounter {all[0].encounterId}</>}</h3><Badge tone={withdrawn.length&&!current.length?'neutral':partial?'amber':'teal'}>{withdrawn.length&&!current.length?'Withdrawn report':partial?'Partial report':'All measures answered'}</Badge></div>
        {withdrawn.length&&!current.length?<p className="muted">These responses were withdrawn from current use. The original values and sources are preserved below.</p>:<p className="muted">{numeric} of {metrics.length} measures have numeric responses.{missing.length?` Not submitted: ${missing.map(metric=>metricLabels[metric]).join(', ')}.`:''}</p>}
        {current.length>0&&rows(current,all,'Current')}
        {history.length>0&&<div className="stack"><h4>Superseded entries</h4>{rows(history,all,'Superseded')}</div>}
        {withdrawn.length>0&&<div className="stack"><h4>Withdrawn entries</h4>{rows(withdrawn,all,'Withdrawn')}</div>}
      </section>;
    })}</div>
  </Panel>;
}
