'use client';
import {baseName,reportedKindLabels,reportedKinds} from '@/lib/patient-medication-report';
import {latestReportedAnswers,selfReportSources} from '@/lib/patient-reported-answers';
import {sinceSignedVisit} from '@/lib/advisor-guide';
import {normalizeClinicalWorkflows} from '@/lib/clinical-flows';
import {RecordedTrajectory} from './recorded-trajectory';
import {RecommendationDetails} from './recommendation-details';
import {patientRecommendationBasis,patientCautionBasis} from '@/lib/patient-recommendation-basis';
import {useState} from 'react';
import Link from 'next/link';
import {ArrowRight,ArrowUpRight,Check,ClipboardCheck,ClipboardList,Info,TriangleAlert} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Accordion,AccordionItem,AccordionTrigger,AccordionContent} from '@/components/ui/accordion';
import {featureEnabled,type Patient,type Review,type Workspace} from '@/lib/theranetrix';
import {patientSnapshot} from '@/lib/patient-overview';
import {activeMedications,patientSuggestions,type Medication} from '@/lib/medications';
import {twinOverview} from '@/lib/engine-demo';
import {medicationGroupingNote} from '@/lib/medication-groups';
import {changesSincePriorReport,untypedCheckinCount,latestDailyCheckin,latestPatientWords,latestQuestionnaire,prototypeComposite,visitGlance,visitMetrics,visitObservations,visitProgression,visitRecordState,type QuestionnaireAnswer,type VisitChange,type VisitStep} from '@/lib/visit-presentation';
import {type Context} from './app';
import {Badge,Panel,Term,formatDate} from './ui';
import {MedicationDialog,MedicationGroups,PlanForm} from './medications';
import {ClinicalContextDialog} from './patient-context';
import {PatientReviewDialog,PatientEvidence} from './patient-overview';
import {EngineEncounterSummary} from './engine-workspace';
import {daysBetween,treatmentCourse} from '@/lib/treatment-review';
import {TreatmentDecisionHistory,priorTrialGroups} from './treatment-course';

type Props={p:Patient;ctx:Context;changeTab:(tab:string)=>void};
const metricLabels={pain:'Pain',function:'Daily function',sleep:'Sleep quality'};
export function EncounterReview({p,ctx,changeTab}:Props){
  const [contextOpen,setContextOpen]=useState(false),[medication,setMedication]=useState<string|null>(null);
  const [reviewId,setReviewId]=useState<string|null>(null),[evidence,setEvidence]=useState(false);
  const [editingPlan,setEditingPlan]=useState(false),[showPlan,setShowPlan]=useState(false);
  const [supportingOpen,setSupportingOpen]=useState<string[]>([]);
  const course=treatmentCourse(p,ctx.data),twin=twinOverview(p);
  const snapshot=patientSnapshot(p,ctx.data),context=p.clinicalContext,plan=p.carePlans[0];
  const assessments=featureEnabled(ctx.data,'assessments'),messaging=featureEnabled(ctx.data,'messages');
  const observations=assessments?visitObservations(p):[],current=observations.at(-1),previous=observations.at(-2);
  const recordState=visitRecordState(p,ctx.data),composite=prototypeComposite(p);
  const changes=assessments?changesSincePriorReport(p):{since:null,latest:null,items:[] as VisitChange[]};
  // The same comparison the Advisor gives for "What changed since the last visit", shown beside the report-to-report one.
  const sinceVisit=assessments?sinceSignedVisit(p,ctx.data):null;
  // Every unresolved high-priority item remains visible, regardless of count.
  const highReviews=snapshot.reviews.filter(r=>r.priority==='High');
  const visibleReviews=highReviews.length?highReviews:snapshot.reviews.slice(0,1);
  const otherReviews=snapshot.reviews.filter(r=>!visibleReviews.some(v=>v.id===r.id));
  const review=ctx.data.reviews.find(r=>r.id===reviewId&&r.patientId===p.id);
  const medPrompts=patientSuggestions(p,ctx.data).filter(s=>s.kind==='medication');
  const incoming=messaging?snapshot.messages.filter(m=>m.direction==='in').at(-1):undefined;
  const questionnaire=assessments?latestQuestionnaire(p,ctx.data):null,daily=assessments?latestDailyCheckin(p,ctx.data):null;
  // The latest questionnaire has its own card; "From the patient" shows the patient's own words from other check-ins, or a message.
  // The words come from each check-in's current record, so a check-in with a measure left unanswered still counts.
  // Fixed check-in lines and medicine answers are summarized on the card and under Medications instead.
  const words=assessments?latestPatientWords(p,ctx.data,questionnaire?.record.id):null;
  const feedback=words&&(!incoming||words.date>incoming.date)?{text:words.text,date:words.date,source:'Patient check-in'}:incoming?{text:incoming.text,date:incoming.date,source:'Patient message'}:undefined;
  const nextActivity=snapshot.tasks[0],today=new Date().toISOString().slice(0,10);
  const overdueActivities=snapshot.tasks.filter(t=>t.date<today).length;
  const priorText=context?.priorTreatments?.trim()&&!/^(not recorded|none|unknown|n\/a)\.?$/i.test(context.priorTreatments.trim())?context.priorTreatments.trim():'';
  // A report can leave a measure unanswered or declined, so name what the latest report is missing and when it was sent.
  const compositeGap=!composite.date?'No report yet':composite.missing.map(key=>metricLabels[key]+(composite.declined.includes(key)?' declined':' not answered')).join(', ')+' in the '+formatDate(composite.date)+' report';
  const focusPlan=()=>{setEditingPlan(true);requestAnimationFrame(()=>{document.getElementById('visit-plan')?.scrollIntoView({behavior:'smooth',block:'nearest'});document.querySelector<HTMLTextAreaElement>('#visit-plan textarea')?.focus({preventScroll:true});});};
  const reviewChange=(item:VisitChange)=>{
    if(item.target==='medications')setMedication(item.medicationId??'list');
    else if(item.target==='context')setContextOpen(true);
    else if(item.target==='plan')document.getElementById('visit-plan')?.scrollIntoView({behavior:'smooth',block:'center'});
    else changeTab('outcomes');
  };
  return <div className="encounter-review patient-visit-focus">
    <header className="profile-visit-heading">
      {/* One heading for every stage: where the visit stands comes from the recorded encounter steps below, not from a view setting. */}
      <div><h2>Visit review</h2><p>Review the patient’s reports, discuss options and agree on a plan.</p></div>
      <div className="profile-visit-actions"><Button onClick={()=>changeTab('treatment')}>Compare treatments <ArrowRight size={16}/></Button></div>
    </header>
    <div className="visit-record-status"><span className="visit-record-state"><span aria-hidden="true"/>{assessments?recordState.dataState:'Assessments off'}</span><span>{assessments?`${recordState.reportCount} recorded report${recordState.reportCount===1?'':'s'}`:'Outcome collection is turned off'}{recordState.signedEncounters?` · ${recordState.signedEncounters} signed encounter${recordState.signedEncounters===1?'':'s'}`:''}</span><button className="text-link" onClick={()=>setEvidence(true)}>Sources &amp; gaps <ArrowUpRight size={14}/></button></div>
    <VisitGlance p={p} data={ctx.data}/>
    <VisitProgress p={p} data={ctx.data}/>
    <div className="profile-visit-layout">
      <div className="profile-clinical-column">
        <section id="patient-goal" className="visit-patient-priority" aria-labelledby="visit-goal-heading"><div><span id="visit-goal-heading">Patient goal</span><blockquote>{p.goal||'Patient goal not recorded'}</blockquote></div><div className="visit-goal-status">{course.record&&<Badge tone={course.needsRecheck?'amber':course.goalStatus==='Met'?'teal':'neutral'}>{course.needsRecheck?'Goal needs review':'Goal: '+course.goalStatus}</Badge>}<button className="text-link" onClick={()=>ctx.open('goal',p)}>Edit goal</button></div></section>
        <Panel id="visit-observations" className="visit-outcomes" title="Patient trajectory" action={assessments?<button className="text-link" onClick={()=>changeTab('twin')}>View trends <ArrowUpRight size={14}/></button>:undefined}>
          {assessments?<>
            <div className="visit-metrics">{visitMetrics.map(key=>{const value=current?.[key]??null,before=previous?.[key]??null,delta=value!==null&&before!==null?value-before:null;const worse=delta!==null&&(key==='pain'?delta>0:delta<0);return <div key={key}><span>{metricLabels[key]}</span><div><strong>{value??(current?.statuses?.[key]==='declined'?'Declined':current?.statuses?.[key]==='unanswered'?'Unanswered':'Not recorded')}</strong>{value!==null&&<small>/ 10</small>}</div><b className={delta===null||delta===0?'':worse?'text-rose':'text-teal'}>{delta===null?'No prior comparison':delta===0?'Unchanged':`${worse?'Worse':'Better'} by ${Math.abs(delta)} pt${Math.abs(delta)===1?'':'s'}`}</b></div>;})}<div className="visit-composite"><span>Composite (pain · function · sleep)</span><div><strong>{composite.value!==null?composite.value.toFixed(1):'Unavailable'}</strong>{composite.value!==null&&<small>/ 10</small>}</div><b className={composite.delta===null||composite.delta===0?'':composite.delta>0?'text-rose':'text-teal'}>{composite.value===null?compositeGap:composite.delta===null?'No prior comparison':composite.delta===0?'Unchanged':`${composite.delta>0?'Worse':'Better'} by ${Math.abs(composite.delta).toFixed(1)}`}</b>{composite.value===null&&composite.lastComplete&&<small>Last complete report: {composite.lastComplete.value.toFixed(1)} / 10 · {formatDate(composite.lastComplete.date)}</small>}<span className="visit-composite-flag">Prototype · not a validated pain measure</span><details className="visit-composite-help"><summary><Info size={13}/> How it is calculated</summary><div><strong>Prototype · not a validated pain measure</strong><p>Mean of pain, 10 − daily function and 10 − sleep quality, on a 0–10 scale. Higher means worse, the same direction as pain. Only the patient’s recorded answers are used; mood is not included or estimated.</p>{composite.missing.length>0&&<p>Unavailable: current {composite.missing.map(key=>metricLabels[key].toLowerCase()).join(', ')} data are missing or not aligned. No default scores are substituted.{composite.lastComplete?' The last complete report is shown with its own date; it is not combined with newer answers.':''}</p>}{composite.value!==null&&composite.since&&<p>Change compares the latest report with the report of {formatDate(composite.since)}.</p>}<p>It is not a scored instrument such as <Term t="PEG"/> or <Term t="BPI"/>. Overall outcome changes do not establish medication efficacy.</p></div></details></div></div>
            {observations.length>=2?<RecordedTrajectory points={observations}/>:<div className="visit-trajectory-empty"><span className="visit-step-count">{observations.length?'01':'00'}</span><div><h3>{observations.length?'Baseline recorded':'Waiting for the first report'}</h3><p>{observations.length?'The next report will add a trajectory. Reports and check-ins do not establish a visit count.':'The patient can complete a check-in before the appointment. Submitted answers populate this review.'}</p>{!observations.length&&<Link className="text-link" href={'/patient-companion?patient='+encodeURIComponent(p.id)}>Open patient questionnaire <ArrowUpRight size={14}/></Link>}</div></div>}
            <div className="visit-observation-foot"><span>{current?'Latest report '+formatDate(current.date):'No observation date'}{previous?' · compared with '+formatDate(previous.date):''}</span><details><summary>Source data &amp; interpretation</summary><p>Recorded reports on local 0–10 scales. Sources are listed with each report; missing or declined responses have no numeric value. Lower pain and higher function and sleep are better. Overall outcome changes do not establish medication efficacy. Reports are not visits.</p>{observations.length>0&&<div className="visit-source-table"><table><caption>Recorded observations</caption><thead><tr><th>Date</th><th>Pain</th><th>Function</th><th>Sleep</th><th>Source</th></tr></thead><tbody>{observations.map((point,index)=><tr key={point.date+index}><td>{formatDate(point.date)}</td>{visitMetrics.map(key=><td key={key}>{point[key]??(point.statuses?.[key]==='declined'?'Declined':point.statuses?.[key]==='unanswered'?'Unanswered':'Not recorded')}</td>)}<td>{point.source}</td></tr>)}</tbody></table></div>}</details></div>
          </>:<div className="visit-body"><p>Outcome collection and views are turned off.</p></div>}
        </Panel>
        <Panel id="patient-medications" className="visit-treatment" title="Medications & response" subtitle={course.needsRecheck?'New information needs review · Previous assessment: '+course.direction:'Treatment review: '+course.direction} action={<button className="text-link" onClick={()=>setMedication('list')}>Reconcile list <ArrowUpRight size={14}/></button>}>
          {snapshot.medications.length?<MedicationGroups variant="visit" medications={snapshot.medications} render={m=><MedicationRow key={m.id} m={m} update={()=>setMedication(m.id)}/>}/>:<div className="visit-medication-groups"><div className="visit-empty-medications"><strong>{p.medicationReconciliation?.none?'No current medications reported':'Medication list not confirmed'}</strong><p>{p.medicationReconciliation?.none?'Confirmed '+formatDate(p.medicationReconciliation.date):'No active medication entries. Confirm current use with the patient.'}</p><Button variant="outline" onClick={()=>setMedication('list')}>Reconcile medications</Button></div></div>}
          <PreviouslyTried trials={course.priorTrials} freeText={priorText} open={()=>setMedication('list')}/>
          <PatientReportedMedicines p={p} data={ctx.data}/><div className="visit-treatment-cautions">{twin.cautions.map(c=><div className="visit-clinical-caution" key={c.title}><TriangleAlert size={16}/><div><strong>{c.title}</strong><span className="visit-rule-label">Prototype context check</span><p>{c.body}</p><RecommendationDetails title={c.title} summary={c.body} label="Why this caution" {...patientCautionBasis(p,c.title)}/></div></div>)}</div><div className="visit-medication-foot"><span>{medicationGroupingNote}</span>{medPrompts.length>0&&<details><summary>Discussion prompts</summary><ul>{medPrompts.map(s=><li key={s.title}><strong>{s.title}</strong><RecommendationDetails title={s.title} {...patientRecommendationBasis(p,ctx.data,s)}/></li>)}</ul></details>}</div>
        </Panel>
        <Panel id="visit-plan" className="visit-plan" title="Agreed plan & follow-up" action={plan&&!editingPlan?<button className="text-link" onClick={focusPlan}>Update plan</button>:<ClipboardList size={18}/>}>
          <div className="visit-body">{editingPlan?<PlanForm key={p.id+(plan?.id??'')} p={p} ctx={ctx} compact close={()=>setEditingPlan(false)}/>:plan?<><p className={'visit-plan-text '+(showPlan||plan.text.length<=200?'':'visit-clamp')}>{plan.text}</p>{plan.text.length>200&&<button className="text-link" aria-expanded={showPlan} onClick={()=>setShowPlan(!showPlan)}>{showPlan?'Show less':'Read full plan'}</button>}<div className="visit-followup"><Badge tone={snapshot.followup.completed?'teal':snapshot.followup.overdue?'rose':'blue'}>{snapshot.followup.completed?'Follow-up completed':snapshot.followup.overdue?'Follow-up overdue':'Follow-up planned'}</Badge><strong>{formatDate(plan.followup)} · {plan.time}</strong><span>{plan.owner}</span><small>Saved {formatDate(plan.date)} · {plan.author}</small></div>{snapshot.followup.task&&!snapshot.followup.completed&&<Button variant="outline" disabled={ctx.busy} onClick={()=>ctx.save({type:'task.toggle',id:snapshot.followup.task!.id,done:true},'Follow-up completed')}><Check size={15}/>Mark follow-up complete</Button>}</>:<div className="visit-empty-plan"><h3>No agreed plan yet</h3><p>Record the decision, owner, and follow-up after reviewing treatment.</p><Button onClick={focusPlan}>Create care plan</Button></div>}{editingPlan&&!plan&&<small>Saving the plan also schedules the follow-up.</small>}</div>
        </Panel>
      </div>
      <aside className="profile-review-column" aria-label="Visit review queue">
        {(questionnaire||daily)&&<QuestionnaireCard p={p} ctx={ctx} questionnaire={questionnaire} daily={daily&&(!questionnaire||daily.date>questionnaire.submittedAt)?daily:null}/>}
        {visibleReviews.length>0?<section id="visit-concerns" className="visit-concerns" aria-label="Unresolved priority concerns"><div className="visit-concerns-heading"><TriangleAlert size={17}/><h2>Needs attention</h2><Badge tone={highReviews.length?'rose':'amber'}>{highReviews.length?`${highReviews.length} high priority`:visibleReviews[0].priority+' priority'}</Badge></div>{visibleReviews.map(r=><ReviewRow key={r.id} review={r} onReview={setReviewId}/>)}</section>:<section id="visit-concerns" className="profile-clear-review"><Check size={18}/><div><h2>No unresolved concerns</h2><button className="text-link" onClick={()=>ctx.open('escalation',p)}>Add review item</button></div></section>}
        <section className="visit-changes" aria-labelledby="visit-changes-title"><div className="visit-rail-heading"><h2 id="visit-changes-title">Since the prior report</h2><p>{changes.since?'Compared with '+formatDate(changes.since):assessments?'A prior report is needed for comparison.':'Assessments are off.'}</p></div>{changes.items.length?<div>{changes.items.map(item=><button className={'visit-change-row '+item.tone} key={item.id} onClick={()=>reviewChange(item)}><span className="visit-change-marker" aria-hidden="true"/><span><strong>{item.label}</strong><small>{item.detail}</small></span><ArrowUpRight size={15}/><span className="sr-only">Review {item.label.toLowerCase()}</span></button>)}</div>:<p className="visit-change-empty">{changes.since?'No changes found in comparable recorded outcomes or medication history.':'Changes will appear when another report is available.'}</p>}{sinceVisit&&<p className="visit-change-empty"><strong>Since the last signed visit, {formatDate(sinceVisit.date)}:</strong> {sinceVisit.points.length?sinceVisit.points.join(' · '):'No new report since that visit.'}</p>}<p className="visit-change-note">{sinceVisit?'Record-based summary. “Since the prior report” compares reports, not visits; the signed-visit line compares with the scores reviewed at that visit.':'Record-based summary. This is not a comparison of completed visits.'}</p></section>
        {feedback&&<section className="visit-patient-voice"><div className="visit-rail-heading"><h2>From the patient</h2><p>{feedback.source} · {formatDate(feedback.date)}</p></div><p className="visit-patient-quote">{feedback.text}</p>{messaging&&<button className="text-link" onClick={()=>changeTab('messages')}>{snapshot.replyNeeded?'Reply to patient':'Open conversation'} <ArrowUpRight size={14}/></button>}</section>}
        {(snapshot.tasks.length>0||snapshot.replyNeeded)&&<div className="visit-open-work"><h3>Next steps</h3>{snapshot.tasks.length>0&&<a href="#visit-supporting" onClick={()=>setSupportingOpen(current=>current.includes('reviews')?current:[...current,'reviews'])}><CalendarLabel overdue={overdueActivities}/><span><strong>{snapshot.tasks.length} outstanding activit{snapshot.tasks.length===1?'y':'ies'}</strong><small>{overdueActivities?`${overdueActivities} overdue`:nextActivity?'Next '+formatDate(nextActivity.date):''}</small></span><ArrowUpRight size={15}/></a>}{messaging&&snapshot.replyNeeded&&!feedback&&<button onClick={()=>changeTab('messages')}><span className="visit-open-work-dot"/><span><strong>Patient reply needed</strong><small>Open the latest conversation</small></span><ArrowUpRight size={15}/></button>}</div>}
        <button className="text-link visit-complete-record" onClick={()=>changeTab('full')}>Open complete record <ArrowUpRight size={14}/></button>
      </aside>
    </div>

    <EngineEncounterSummary p={p} ctx={ctx} compact/>
    <Accordion type="multiple" value={supportingOpen} onValueChange={setSupportingOpen} className="visit-supporting" id="visit-supporting" aria-label="Supporting patient record">
      <AccordionItem value="reviews"><AccordionTrigger><span>Reviews & care activities <small>{otherReviews.length} other unresolved · {snapshot.tasks.length} outstanding{overdueActivities?` · ${overdueActivities} overdue`:''}</small></span></AccordionTrigger><AccordionContent>{!snapshot.reviews.length&&<p>No unresolved review items.</p>}{otherReviews.map(r=><ReviewRow key={r.id} review={r} onReview={setReviewId}/>)}{snapshot.tasks.map(t=><div className="visit-task" key={t.id}><div><strong>{t.title}</strong><p className={t.date<today?'text-rose':''}>{t.date<today?'Overdue · ':''}{formatDate(t.date)} · {t.time} · {t.owner??p.clinician}</p></div><Button variant="outline" disabled={ctx.busy} onClick={()=>ctx.save({type:'task.toggle',id:t.id,done:true},'Activity completed')}>Complete</Button></div>)}<div className="visit-detail-links"><button className="text-link" onClick={()=>ctx.open('escalation',p)}>Add review item</button><button className="text-link" onClick={()=>changeTab('pathway')}>Care pathway</button><button className="text-link" onClick={()=>ctx.open('task',p)}>Schedule activity</button></div></AccordionContent></AccordionItem>
      <AccordionItem value="context"><AccordionTrigger><span>Clinical history & context <small>{context?.medicalHistory?'History recorded':'Medical history not recorded'} · {p.notes.length} notes</small></span></AccordionTrigger><AccordionContent><div className="visit-context-grid">{[['Medical history',context?.medicalHistory],['Previous treatments',context?.priorTreatments],['Physical',context?.physicalContext],['Psychological',context?.psychologicalContext],['Social & support',context?.socialContext],['Pain presentation',[context?.painLocation,context?.painDuration].filter(Boolean).join(' · ')]].map(([label,value])=><div key={label}><strong>{label}</strong><p>{value||'Not recorded'}</p></div>)}</div><div className="visit-detail-links"><button className="text-link" onClick={()=>setContextOpen(true)}>Update context</button><button className="text-link" onClick={()=>changeTab('notes')}>All documentation</button><button className="text-link" onClick={()=>ctx.open('note',p)}>Add note</button></div></AccordionContent></AccordionItem>
      <details className="visit-treatment-history"><summary><span>Treatment decisions <small>{course.record?.options.length??0} options discussed{course.record?.history.length?` · ${course.record.history.length} earlier decision${course.record.history.length===1?'':'s'}`:''}</small></span></summary><div className="visit-treatment-history-body"><div className="visit-context-grid"><section><h3>Options discussed with the clinician</h3>{course.record?<><p>{course.record.goalEvidence}</p><p>{course.record.decision}</p>{course.record.options.map((o,i)=><article className="visit-history-item" key={i}><strong>{o.title}</strong> <Badge>{o.status}</Badge><p>{o.rationale}</p>{o.considerations&&<p className="visit-option-considerations"><strong>Decision context: </strong>{o.considerations}</p>}<RecommendationDetails title={o.title} label="Why this option was discussed" rationale={[o.rationale||'Rationale not recorded']} considerations={o.considerations?[o.considerations]:[]} sources={[{label:'Saved treatment review · '+course.record?.author,value:course.record?.decision||'Decision not recorded',date:course.record?.date}]} limitations={['This is the rationale recorded in the treatment review, not independently verified evidence.']}/></article>)}</>:<p>Not reviewed: no treatment review recorded.</p>}</section></div>{course.record&&<TreatmentDecisionHistory history={course.record.history}/>}<div className="visit-detail-links"><button className="text-link" onClick={()=>changeTab('treatment')}>Open treatment workspace <ArrowUpRight size={14}/></button></div></div></details>
    </Accordion>

    <ClinicalContextDialog p={p} open={contextOpen} close={()=>setContextOpen(false)} ctx={ctx}/>
    <MedicationDialog patientId={medication?p.id:null} initialMedicationId={medication&&medication!=='list'?medication:undefined} close={()=>setMedication(null)} ctx={ctx}/>
    <PatientReviewDialog review={review} close={()=>setReviewId(null)} ctx={ctx}/>
    <PatientEvidence p={p} ctx={ctx} open={evidence} close={()=>setEvidence(false)}/>
  </div>;
}
function CalendarLabel({overdue}:{overdue:number}){return <span className={'visit-open-work-dot'+(overdue?' is-overdue':'')}/>;}
function ReviewRow({review:r,onReview}:{review:Review;onReview:(id:string)=>void}){
  const normalize=(text:string)=>text.trim().replace(/[.!]$/,'');
  const detail=r.detail.split('\n').map(line=>line.trim()).filter(Boolean).filter(line=>normalize(line)!==normalize(r.title)).join('\n');
  return <article className="visit-review-row"><div><h3>{r.title}</h3>{detail&&<p>{detail}</p>}<small>{r.priority} priority · {r.source} · {formatDate(r.created)} · {r.status}</small><RecommendationDetails title={r.title} label="Why this needs review" rationale={[r.detail||r.title]} sources={[{label:r.source,value:r.priority+' priority · '+r.status,date:r.created}]} considerations={['Confirm the current concern and document the action taken. Acknowledging a review does not resolve it.']} limitations={['Priority is the recorded review classification. It is not a validated risk score or an independent clinical assessment.']}/>{r.resolution&&<details className="visit-inline-details"><summary>Previously recorded action</summary><p className="visit-prior-action">{r.resolution}</p></details>}</div><Button variant="outline" onClick={()=>onReview(r.id)}>Document action</Button></article>;
}
const metricShort={pain:'Pain',function:'Function',sleep:'Sleep'};
// One scannable line of chips; each jumps to the section that holds the full record. No composite here.
function VisitGlance({p,data}:{p:Patient;data:Workspace}){
  const {report,highPriority,topPriority,medications:meds,followup}=visitGlance(p,data);
  const shift=(change:number|null)=>change===null?'no prior comparison':change===0?'unchanged':`${Math.abs(change)} point${Math.abs(change)===1?'':'s'} ${change>0?'higher':'lower'}`;
  const reportLabel=!featureEnabled(data,'assessments')?'Assessments off':report?report.metrics.map(m=>`${metricLabels[m.key]} ${m.value??m.status}${m.value===null?'':', '+shift(m.change)}`).join('; '):'No report yet';
  const medFlags=[meds.sideEffects?`Side effects reported (${meds.sideEffects})`:'',meds.missedUse?`Missed or not taking (${meds.missedUse})`:''].filter(Boolean);
  return <nav className="visit-glance" aria-label="At a glance">
    <a href="#visit-observations" aria-label={'Latest report: '+reportLabel+'. Go to patient trajectory.'}><span>Latest report</span><strong>{report?report.metrics.map(m=><span key={m.key} className={m.tone==='worse'?'text-rose':m.tone==='better'?'text-teal':''}>{metricShort[m.key]} {m.value??'–'}{m.change!==null&&m.change!==0&&<small>{m.change>0?' ↑':' ↓'}{Math.abs(m.change)}</small>}</span>):reportLabel}</strong></a>
    <a href="#visit-concerns" className={highPriority?'is-concern':''}><span>Needs attention</span><strong>{highPriority?`${highPriority} high priority`:topPriority?`${topPriority} priority`:'None open'}</strong></a>
    <a href="#patient-medications" className={medFlags.length?'is-concern':''}><span>Medications</span><strong>{meds.count?`${meds.count} current`:meds.confirmedNone?'None reported':'List not confirmed'}{medFlags.map(flag=><small key={flag}>{flag}</small>)}</strong></a>
    <a href="#visit-plan" className={followup?.state==='overdue'?'is-concern':''}><span>Follow-up</span><strong>{followup?<>{followup.state==='completed'?'Completed':followup.state==='overdue'?'Overdue':formatDate(followup.date)}<small>{followup.state==='planned'?followup.owner:formatDate(followup.date)+' · '+followup.owner}</small></>:'No agreed plan'}</strong></a>
  </nav>;
}
const followupLabel=(f:NonNullable<VisitStep['followup']>)=>(f.state==='completed'?'Follow-up completed':f.state==='overdue'?'Follow-up overdue since '+formatDate(f.date):'Follow-up due '+formatDate(f.date))+(f.bookingConfirmed||f.state==='completed'?'':' · appointment booking not confirmed');
// Recorded encounter steps only, read as history: the latest encounter and where it got to. Patient check-ins never count as visits.
function VisitProgress({p,data}:{p:Patient;data:Workspace}){
  const {latest,encounters}=visitProgression(p,data),shown=encounters.slice(-4);
  return <section className="visit-progress" aria-labelledby={'visit-progress-'+p.id}>
    <h2 id={'visit-progress-'+p.id}>{latest?'Latest recorded encounter · '+formatDate(latest.date):'Recorded encounters'}</h2>
    {latest?<ol>{latest.steps.map(step=><li key={step.id} className={'is-'+step.state} aria-current={step.state==='current'?'step':undefined}><span className="visit-progress-dot" aria-hidden="true"/><strong>{step.label}</strong><span>{step.status}{step.date?' · '+formatDate(step.date):''}</span>{step.followup&&<small>· {followupLabel(step.followup)}</small>}</li>)}</ol>
      :<p className="visit-progress-empty"><strong>No recorded encounter</strong><span>Patient check-ins are reports, not visits. Steps appear once a visit is prepared, assessed or signed in Clinical workflows.</span></p>}
    {encounters.length>0&&<p className="visit-history-row"><span>Visit history</span>{encounters.length>shown.length&&<small>{encounters.length-shown.length} earlier</small>}{shown.map((item,index)=><span key={item.encounterId}>Encounter {encounters.length-shown.length+index+1} · {formatDate(item.date)} · {item.status}</span>)}<small className="visit-progress-note">Workspace records only. Signing here does not file a note to the EHR.</small></p>}
  </section>;
}
// Stopped medications at a glance, split by recorded indication like current medications. Wording stays neutral: what was recorded, not a judgment.
function PreviouslyTried({trials,freeText,open}:{trials:Medication[];freeText:string;open:()=>void}){
  return <section className="visit-previously-tried" aria-label="Previously tried medications">
    <h3>Previously tried{trials.length>0&&<span>{trials.length}</span>}</h3>
    {trials.length?priorTrialGroups(trials).map(group=><div className="visit-previously-group" role="group" aria-label={'Previously tried · '+group.title} key={group.id}><h4>{group.title}<span>{group.medications.length}</span></h4><ul>{group.medications.map(m=><li key={m.id}><strong>{m.name}</strong><span>{m.stopped?'Stopped '+formatDate(m.stopped):'Stop date not recorded'}</span><span>{m.benefit==='Not assessed'?'Benefit not assessed':'Reported benefit: '+m.benefit}</span><span>{m.stopReason?'Reason for stopping: '+m.stopReason:'Reason for stopping not recorded'}</span></li>)}</ul></div>)
      :freeText?<p className="visit-previously-free-text"><small>Recorded as free text – not yet structured</small>{freeText}</p>
      :<p className="visit-medication-empty">No previous medication trials recorded.</p>}
    <button className="text-link" onClick={open}>Medication history <ArrowUpRight size={13}/></button>
  </section>;
}
// The patient's latest pre-visit questionnaire as submitted, with who reviewed it. Reviewing does not change the answers.
// A newer daily check-in is listed beside it; it never replaces the questionnaire or resets its review.
type Questionnaire=ReturnType<typeof latestQuestionnaire>;
function QuestionnaireCard({p,ctx,questionnaire:q,daily}:{p:Patient;ctx:Context;questionnaire:Questionnaire;daily:ReturnType<typeof latestDailyCheckin>}){
  const show=(value:QuestionnaireAnswer)=>typeof value==='number'?value+' / 10':value;
  // Each medicine is counted once, under the question it answers; a medicine the patient could not name qualifies that count.
  const detail=(parts:string[])=>parts.length?' ('+parts.join('; ')+')':'',unnamed=(count:number)=>count?[`name not known for ${count}`]:[];
  const meds=q?.medicines,medicines=!meds?'':!meds.answered?'No medicine answers':[meds.cannotTake?`${meds.cannotTake} cannot take${detail([...(meds.allergicReaction?['allergic reaction reported']:[]),...unnamed(meds.notNamed.cannotTake)])}`:'',meds.tried?`${meds.tried} tried before${detail(unnamed(meds.notNamed.tried))}`:'',
    meds.takingNow?`${meds.takingNow} taking now, not on the record${detail([...(meds.kinds.length?[meds.kinds.map(kind=>kind[0].toLowerCase()+kind.slice(1)).join(', ')]:[]),...unnamed(meds.notNamed.takingNow)])}`:'',meds.alsoOnRecord?`${meds.alsoOnRecord} taking now, also on the record`:'',meds.notNamed.other?`${meds.notNamed.other} not named, described by the patient`:''].filter(Boolean).join(' · ')||'No medicines named';
  const untyped=q?0:untypedCheckinCount(p,ctx.data);
  const dailyLine=daily&&[`Pain ${show(daily.answers.pain)}`,`Sleep ${show(daily.answers.sleep)}`,...(daily.answers.function!==undefined?[`Function ${show(daily.answers.function)}`]:[]),...(daily.mood!==null?[`Mood ${show(daily.mood)}`]:[])].join(' · ');
  return <section id="visit-questionnaire" className="visit-questionnaire" aria-labelledby={'visit-questionnaire-'+p.id}>
    <div className="visit-questionnaire-heading"><ClipboardCheck size={17}/><h2 id={'visit-questionnaire-'+p.id}>Pre-visit questionnaire</h2>{q&&!q.review&&<Badge tone="amber">Awaiting clinician review</Badge>}</div>
    {q?<>
      <p className="visit-questionnaire-meta">Completed by the patient · submitted {formatDate(q.submittedAt,true)}{q.updatedAt!==q.submittedAt?' · updated '+formatDate(q.updatedAt,true):''}</p>
      <dl className="visit-questionnaire-answers"><div><dt>Pain</dt><dd>{show(q.answers.pain)}</dd></div><div><dt>Sleep</dt><dd>{show(q.answers.sleep)}</dd></div><div><dt>Function</dt><dd>{show(q.answers.function)}</dd></div>{q.mood!==null&&<div><dt>Mood</dt><dd>{show(q.mood)}</dd></div>}</dl>
      {typeof q.mood==='number'&&<small>Mood is one 0–10 self-rating, not a mood or depression screen.</small>}
      {q.location&&<p><span>Where it hurts:</span> {q.location}</p>}
      {q.concerns&&<p><span>Concerns:</span> {q.concerns}</p>}
      {q.affecting&&<p><span>Also affecting pain:</span> {q.affecting}</p>}
      <p><span>Medicines:</span> {medicines}{meds?.answered?' · patient-reported, to verify':''}</p>
    </>:<p className="visit-questionnaire-meta">{untyped?`No check-in is recorded as the pre-visit questionnaire. ${untyped} earlier check-in${untyped===1?' was':'s were'} saved before the check-in type was recorded and ${untyped===1?'stays':'stay'} in the patient trajectory.`:'No pre-visit questionnaire submitted yet.'}</p>}
    {daily&&<p className="visit-questionnaire-daily"><span>{daily.kind==='daily'?'Latest daily check-in':'Latest check-in, type not recorded'}, {formatDate(daily.date,true)}:</span> {dailyLine}</p>}
    {daily&&q&&<small>Daily check-ins appear in the patient trajectory. They do not replace these answers or their review.</small>}
    {q&&<>{q.review?<p className="visit-questionnaire-reviewed"><Check size={14}/>Reviewed by {q.review.actor} · {formatDate(q.review.date,true)}</p>:<Button variant="outline" disabled={ctx.busy} onClick={()=>ctx.save({type:'questionnaire.review',patientId:p.id,recordId:q.record.id,version:q.record.version},'Questionnaire marked reviewed')}><Check size={15}/>Mark reviewed</Button>}
    <small>Marking reviewed records who read these answers and when. It does not change or validate them.</small></>}
  </section>;
}
function MedicationRow({m,update}:{m:Medication;update:()=>void}){
  const duration=daysBetween(m.regimenSince??'',m.reportedAt);
  return <article className="visit-medication-row"><div className="visit-medication-name"><h4>{m.name}</h4><p className={!m.regimen?'visit-unknown':''}>{m.regimen||'Regimen not recorded'}</p><span>{m.indication||'Indication not recorded'}</span></div><div className="visit-medication-response"><Badge tone={m.benefit==='Helpful'?'teal':m.benefit==='No benefit'?'rose':'neutral'}>{m.benefit==='Not assessed'?'Benefit not assessed':m.benefit}</Badge><p className={m.tolerability==='Effects reported'?'text-rose':''}><span>Side effects: </span>{m.tolerability==='Effects reported'?m.effects||'Effects reported; detail not recorded':m.tolerability==='Not assessed'?'Not assessed':'None reported'}</p><small>Use: {m.adherence}</small></div><div className="visit-medication-actions"><button className="text-link" onClick={update} aria-label={'Update '+m.name+' response'}>Update response <ArrowUpRight size={13}/></button><details><summary>Report details</summary><p>{m.source} · {formatDate(m.reportedAt)}</p><p>Started {m.started?formatDate(m.started):'date unknown'}.{duration!==null?' '+duration+' days on this regimen at report.':' Time on current regimen unknown.'}</p><p>Clinician review: {m.reviewedAt?formatDate(m.reviewedAt)+' · '+m.reviewedBy:'Not reviewed'}</p></details></div></article>;
}

// What the patient reported about medicines, until a clinician verifies it: each question's latest answer, taken from the
// newest check-in that answered it, so a later check-in that answers only another question keeps the earlier answers.
// Only current versions are read: an answer the patient removed in an update does not come back from the earlier version.
function PatientReportedMedicines({p,data}:{p:Patient;data:Workspace}){
  // A submission with scores also becomes a check-in; one with only medicine answers stays on the observation record. Read both.
  const lines=latestReportedAnswers(selfReportSources(p,normalizeClinicalWorkflows(data.clinicalWorkflows).slices.encounters.state.observations));
  // "Taking now" asks for medicines not on the record; one the patient names that is on it is marked, not called missing.
  const active=activeMedications(p).map(m=>baseName(m.name)),onRecord=(row:typeof lines[number])=>row.question==='taking-now'&&row.kind!=='unidentified'&&active.includes(baseName(row.name));
  if(!lines.length)return null;
  const dates=[...new Set(lines.map(line=>formatDate(line.date)))],when=(rows:typeof lines)=>dates.length>1?' · '+[...new Set(rows.map(row=>formatDate(row.date)))].join(', '):'';
  // Kinds are the patient's own choice; nothing here is inferred from a medicine name.
  const chosenKinds=lines.some(line=>['sleep-anxiety','supplement','herbal','food-drink'].includes(line.kind));
  return <section className="visit-patient-medicines" aria-label="Medicines reported by the patient">
    <h3>Reported by the patient <small>{dates.length>1?'Latest answer to each question':dates[0]} · patient-reported, to verify</small></h3>
    {reportedKinds.map(kind=>{const rows=lines.filter(line=>line.kind===kind);return rows.length?<div key={kind} className={'visit-reported-'+kind}><span>{kind==='taking-now'&&rows.every(onRecord)?'Taking now, also on the record':reportedKindLabels[kind]}{when(rows)}</span><ul>{rows.map((row,i)=><li key={row.name+i}><strong>{row.name==='None'?'None reported':row.name}</strong>{onRecord(row)&&<em>Also on the record</em>}{row.details.length>0&&<span>{row.details.map(d=>d.label+': '+d.value).join(' · ')}</span>}</li>)}</ul>
      {kind==='unidentified'&&<small>Described by the patient; not matched to a medicine. Identity not yet confirmed against the bottle, label or pharmacy record.</small>}{kind==='affecting-pain'&&<small>The patient’s own choices and words; not a scored questionnaire.</small>}</div>:null;})}
    {chosenKinds&&<small>Kinds as chosen by the patient.</small>}
  </section>;
}
