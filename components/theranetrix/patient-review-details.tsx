'use client';
import Link from 'next/link';
import {Pill,ClipboardList,Activity,ArrowRight,ArrowUpRight,ArrowDownRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {type Patient,featureEnabled} from '@/lib/theranetrix';
import {type DashboardLayout} from '@/lib/dashboard-layout';
import {activeMedications,patientSuggestions,priorityReviews,followupState} from '@/lib/medications';
import {visitObservations} from '@/lib/visit-presentation';
import {overviewRecommendationDetails} from '@/lib/patient-panel';
import {type Context} from './app';
import {Badge,DetailLines,formatDate} from './ui';
import {MedicationGroups,MedicationSummary} from './medications';
import {RecommendationDetails} from './recommendation-details';

function OutcomeSummary({p}:{p:Patient}){
  const points=visitObservations(p),latest=points.at(-1),previous=points.at(-2);
  return <div className="overview-outcomes"><div className="outcome-comparison"><span>Previous to latest report</span><small>Self-reported, 0 to 10</small></div>{(['pain','function','sleep'] as const).map(key=>{
    const before=previous?.[key],last=latest?.[key],diff=before!=null&&last!=null?last-before:null;
    const tone=diff===null||diff===0?'':(key==='pain'?diff<0:diff>0)?'text-teal':'text-rose';
    return <div className="overview-metric" key={key}><span>{key==='function'?'Function':key==='pain'?'Pain':'Sleep'}</span><strong>{before!=null&&last!=null?<>{before}<ArrowRight size={12}/>{last}</>:last??'Not recorded'}</strong><span className={tone}>{diff===null?'':diff===0?'No change':<>{diff<0?<ArrowDownRight size={14}/>:<ArrowUpRight size={14}/>} {Math.abs(diff)} pt{Math.abs(diff)!==1?'s':''}</>}</span></div>;
  })}<small>{previous&&latest?formatDate(previous.date)+' to '+formatDate(latest.date):latest?'First report '+formatDate(latest.date):'Waiting for a first check-in'}</small><small>Lower pain, higher function and sleep are better. Missing answers stay unscored.</small></div>;
}

export function PatientReviewDetails({p,ctx,columns=['medications','outcomes','plan'],onReviewMedications,onReviewPlan}:{
  p:Patient;ctx:Context;columns?:DashboardLayout['columns'];
  onReviewMedications:()=>void;onReviewPlan:()=>void;
}) {
  const {data}=ctx,meds=activeMedications(p),reviews=priorityReviews(data,p),suggestions=patientSuggestions(p,data),plan=p.carePlans[0];
  const followup=followupState(p,data,new Date().toISOString().slice(0,10));
  return <>
              <div className="triage-context"><div><span>Patient goal</span><p>{p.goal||'Not recorded'}</p></div><div><span>Care team</span><p>{p.clinician}</p><small>{p.id} · {p.age} years · {p.stage}</small></div><div><span>Next visit</span><p>{formatDate(p.nextVisit)}</p></div></div>
              {reviews.length>0&&<div className="triage-open-reviews"><h3>Open reviews</h3>{reviews.map(review=><div key={review.id}><Badge tone={review.priority==='High'?'rose':'amber'}>{review.priority}</Badge><p><strong>{review.title}</strong><span><DetailLines text={review.detail}/></span><RecommendationDetails {...overviewRecommendationDetails(p,data,{title:review.title,reason:review.detail,kind:'review'})} label="Review details"/></p></div>)}<Link className="text-link" href="/review-queue">Open review queue <ArrowUpRight size={14}/></Link></div>}
              <div className="triage-detail-grid">{columns.map(column=>column==='medications'?<section className="triage-detail-section" key={column}><h3><Pill size={16}/>Medication response</h3>{meds.length?<MedicationGroups variant="compact" medications={meds} render={m=><MedicationSummary medication={m} key={m.id}/>}/>:<p>{p.medicationReconciliation?.none?'No current medications reported. Confirmed '+formatDate(p.medicationReconciliation.date)+' by '+p.medicationReconciliation.author+'.':'No active medication entries. Current use needs reconciliation.'}</p>}<Button variant="outline" size="sm" onClick={onReviewMedications} aria-label={'Edit medication details for '+p.name}>Review medications</Button></section>:column==='outcomes'?<section className="triage-detail-section" key={column}><h3><Activity size={16}/>Outcome changes</h3>{featureEnabled(data,'assessments')?<OutcomeSummary p={p}/>:<Badge>Assessments off</Badge>}</section>:<section className="triage-detail-section" key={column}><h3><ClipboardList size={16}/>Next steps and plan</h3><div className="triage-suggestions">{suggestions.map(s=><div key={s.title}><strong>{s.title}</strong><p>{s.reason}</p><RecommendationDetails {...overviewRecommendationDetails(p,data,s)} label={s.kind==='referral'?'Reason & sources':undefined}/></div>)}</div>{plan?<div className="triage-recorded-plan"><span>Recorded clinician plan</span><p>{plan.text}</p><strong className={followup.overdue?'text-rose':''}>{followup.completed?'Completed · ':followup.overdue?'Overdue · ':''}Review {formatDate(plan.followup)} at {plan.time}</strong><small>{plan.owner} · Saved {formatDate(plan.date)} by {plan.author}</small>{followup.task&&!followup.completed&&<button className="text-link" disabled={ctx.busy} onClick={()=>ctx.save({type:'task.toggle',id:followup.task!.id,done:true},'Follow-up completed')}>Mark follow-up complete</button>}</div>:<p className="muted">No clinician plan recorded.</p>}<Button size="sm" variant="outline" onClick={onReviewPlan} aria-label={'Edit care plan for '+p.name}>{plan?'Update plan':'Record plan'}</Button></section>)}</div>
              {!columns.includes('medications')||!columns.includes('plan')?<div className="triage-extra-actions">{!columns.includes('medications')&&<Button size="sm" variant="outline" onClick={onReviewMedications}>Review medications</Button>}{!columns.includes('plan')&&<Button size="sm" variant="outline" onClick={onReviewPlan}>{plan?'Update plan':'Record plan'}</Button>}</div>:null}
  </>;
}
