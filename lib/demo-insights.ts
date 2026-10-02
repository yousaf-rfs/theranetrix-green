import {featureEnabled,type Patient,type Workspace} from './theranetrix';
import {activeMedications,priorityReviews,followupState} from './medications';
import {observedMetrics} from './observations';
import {treatmentCourse,daysBetween} from './treatment-review';

export const demoRulesVersion='demo-record-rules-v4';
export type DemoFinding={id:string;title:string;detail:string;basis:string;attention:boolean};
export function demoInsights(p:Patient,w:Workspace){
  const enabledPst=featureEnabled(w,'pst'),enabledShadow=featureEnabled(w,'shadow');
  const metrics=observedMetrics(p,w);
  if(!enabledPst&&!enabledShadow)return {version:demoRulesVersion,revision:'disabled',patientId:p.id,metrics,pst:[],shadow:[],enabledPst,enabledShadow,summary:'Shadow AI is turned off.',nextStep:'Record a clinician plan'};
  const meds=activeMedications(p),reviews=priorityReviews(w,p);
  const course=treatmentCourse(p,w);
  const observations=featureEnabled(w,'assessments');
  const pst:DemoFinding[]=[],shadow:DemoFinding[]=[];
  const add=(target:DemoFinding[],id:string,title:string,detail:string,basis:string,attention=false)=>{if((target===pst&&enabledPst)||(target===shadow&&enabledShadow))target.push({id,title,detail,basis,attention});};
  for(const m of meds){
    add(pst,'med-'+m.id,m.name+' · '+m.benefit,
      `Reported use: ${m.adherence.toLowerCase()}. ${m.tolerability==='Effects reported'?m.effects:m.tolerability==='No effects reported'?'No side effects reported.':'Side effects not assessed.'}`,
      `Medication report ${m.reportedAt}; ${m.regimen||'regimen not recorded'}.`,m.benefit==='No benefit'||m.tolerability==='Effects reported');
    if(m.tolerability==='Effects reported')add(shadow,'effects-'+m.id,'Benefit and tolerability need separate review',`${m.name} is reported as ${m.benefit.toLowerCase()}, while the same report records: ${m.effects}`,`Medication ${m.id} · ${m.reportedAt}`,true);
    if(m.adherence==='Missed doses'||m.adherence==='Not taking')add(shadow,'use-'+m.id,'Reported use limits interpretation',`${m.name}: ${m.adherence.toLowerCase()}; benefit is ${m.benefit.toLowerCase()}. Confirm the report before attributing the outcome to treatment.`,`Medication ${m.id} · ${m.reportedAt}`,true);
    if(!m.regimen)add(pst,'regimen-'+m.id,'Confirm the recorded regimen',`${m.name} has no recorded dose, route, or schedule.`, `Medication ${m.id}`,true);
    const elapsed=daysBetween(m.regimenSince??'',m.reportedAt);
    if(elapsed!==null)add(pst,'duration-'+m.id,'Time on the recorded regimen',`${m.name}: ${elapsed} days on the recorded regimen as of the response report. This does not establish an adequate trial or treatment efficacy.`,`Regimen since ${m.regimenSince} · report ${m.reportedAt}`);
  }
  for(const m of course.priorTrials)add(pst,'prior-'+m.id,'Prior trial · '+m.name,`${m.benefit}; ${m.tolerability==='Effects reported'?m.effects:m.tolerability}. Stopped: ${m.stopReason||'reason not recorded'}.`,`Medication history · ${m.started||'start unknown'} to ${m.stopped||'stop date unknown'}`);
  if(course.record){
    const r=course.record;
    add(pst,'treatment-direction','Recorded treatment direction',r.direction+'. '+r.decision,`Clinician assessment · ${r.date}`);
    add(pst,'goal-progress','Progress toward the patient goal',course.changedGoal?'The patient goal changed after this assessment. Reassess attainment.':r.goalStatus+'. '+r.goalEvidence,`Clinician-recorded patient report · ${r.date}`,course.changedGoal);
    r.options.forEach((o,i)=>add(pst,'option-'+i,'Clinician option · '+o.title,`${o.status}. ${o.rationale} Review: ${o.considerations}`,`Clinician-entered discussion option · ${r.date}`));
    if(course.needsRecheck)add(shadow,'assessment-stale','Recheck the recorded treatment assessment','New information or a changed goal needs review alongside the saved treatment direction. The previous assessment is retained.',`Treatment assessment · ${r.date}`,true);
    else add(shadow,'treatment-context',r.direction==='Monitoring benefit'?'Benefit is reported; keep monitoring':'Treatment selection remains open',r.direction==='Monitoring benefit'?'The record contains reported benefit and a monitoring plan. Confirm that reported benefit and tolerability still hold.':r.decision,`Clinician review · ${r.date}`);
  }
  if(!meds.length)add(pst,'no-med','Medication context',p.medicationReconciliation?.none?'The record confirms no current medications reported.':'No active medication entries; current use remains unconfirmed.','Workspace medication list',!p.medicationReconciliation?.none);
  for(const metric of metrics){
    const label=metric.key==='function'?'Daily function':metric.key==='sleep'?'Sleep quality':'Pain';
    if(metric.last===undefined)continue;
    const firstDate=p.dates[0],lastDate=p.dates.at(-1);
    const text=metric.delta===null?`${label}: one observation, ${metric.last}/10 on ${lastDate}; not enough observations for a trend.`:`${label}: ${metric.first} → ${metric.last}/10 (${metric.delta>0?'+':''}${metric.delta} points), ${firstDate} to ${lastDate}.`;
    const worsening=metric.recent!==null&&(metric.key==='pain'?metric.recent>0:metric.recent<0);
    const headline=worsening?label+' worsened since the prior check-in':label+' · recorded trend';
    add(shadow,'outcome-'+metric.key,headline,text+(metric.recent!==null?` Most recent interval: ${metric.previous} → ${metric.last}.`:''),`${metric.count} patient-reported observations`,worsening);
  }
  const pain=metrics.find(m=>m.key==='pain');
  if(pain?.delta!==null&&pain?.delta!==undefined&&pain.delta<0&&meds.some(m=>m.benefit==='No benefit'))add(shadow,'discordance','Overall progress differs from medication report','Pain is below the first observation, but at least one medication is reported as providing no benefit. Preserve both observations; neither establishes drug efficacy.','Pain history + medication response',true);
  add(pst,'goal','Patient priority',p.clinicalContext?.preferences||p.goal,p.clinicalContext?.preferences?'Recorded treatment preferences':'Patient-stated goal');
  if(p.clinicalContext?.allergyStatus==='Reactions reported')add(shadow,'allergies','Reported reaction in the record',p.clinicalContext.allergies,'Clinical context · '+p.clinicalContext.date,true);
  else if(!p.clinicalContext||p.clinicalContext.allergyStatus==='Not reviewed')add(shadow,'allergy-gap','Allergy status is unknown','No reviewed allergy status is recorded. Unknown is not the same as no allergies.','Clinical context',true);
  if(reviews[0])add(shadow,'review-'+reviews[0].id,reviews[0].title,reviews[0].detail,`${reviews[0].priority} priority · ${reviews[0].source} · ${reviews[0].created}`,true);
  const plan=p.carePlans[0],followup=followupState(p,w);
  add(pst,'plan',plan?'Recorded follow-up':'No agreed plan recorded',plan?`${plan.owner} · ${plan.followup} at ${plan.time} · ${followup.completed?'completed':followup.overdue?'overdue':'pending'}. ${plan.text}`:'Record the agreed next step, owner, and review date.',plan?'Clinician plan · '+plan.date:'Care plan record',!plan||followup.overdue);
  const signature=JSON.stringify({version:demoRulesVersion,id:p.id,medicationReconciliation:p.medicationReconciliation,reviewRequiredSince:p.recordReviewRequiredSince,needsRecheck:course.needsRecheck,meds,priorTrials:course.priorTrials,treatmentReview:course.record,context:p.clinicalContext,goal:p.goal,metrics,dates:observations?p.dates:[],reviews,plan,done:followup.completed,overdue:followup.overdue,features:w.features});
  let checksum=2166136261;for(let i=0;i<signature.length;i++)checksum=Math.imul(checksum^signature.charCodeAt(i),16777619);
  const sort=(items:DemoFinding[])=>items.sort((a,b)=>Number(b.attention)-Number(a.attention));
  const summary=reviews[0]?.detail??(course.needsRecheck?'New information needs review alongside the last recorded treatment assessment.':shadow.find(f=>f.attention)?.detail??shadow.find(f=>f.id==='treatment-context')?.detail??shadow[0]?.detail??'No observations are available for this patient.');
  return {version:demoRulesVersion,revision:(checksum>>>0).toString(16).padStart(8,'0'),patientId:p.id,metrics,
    pst:enabledPst?sort(pst):[],shadow:enabledShadow?sort(shadow):[],enabledPst,enabledShadow,
    summary:enabledShadow?summary:'Shadow AI is turned off.',
    nextStep:!enabledShadow?'Record a clinician plan':reviews[0]?`Review: ${reviews[0].title}`:meds.some(m=>m.tolerability==='Effects reported')?'Review reported side effects with the patient':!plan?'Record the next review plan':'Review progress toward the patient’s goal'};
}
