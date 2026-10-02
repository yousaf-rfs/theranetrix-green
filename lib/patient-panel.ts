import {visitObservations} from './visit-presentation';
import {twinOverview} from './engine-demo';
import {featureEnabled,pathwaySteps,type Patient,type Workspace} from './theranetrix';

export function patientPanelRow(p:Patient,w:Workspace){
  const twin=twinOverview(p);
  const alerts=w.reviews.filter(r=>r.patientId===p.id&&r.status!=='Resolved');
  const step=pathwaySteps.find(s=>!p.completed.includes(s.id));
  const logs=p.doseLogs??[];
  const taken=logs.filter(l=>l.status==='taken').length;
  const adherence=logs.length?Math.round(taken/logs.length*100):p.adherence>0?p.adherence:p.medications.some(m=>m.status==='Active'&&m.adherence==='Taken as recorded')?92:p.medications.some(m=>m.status==='Active'&&m.adherence==='Missed doses')?61:null;
  const pending=p.treatmentReview?.options.find(o=>o.status==='For discussion')?.title??((w.engineRuns??[]).some(r=>r.patientId===p.id&&!(w.engineDecisions??[]).some(d=>d.runId===r.id))?'Awaiting clinician decision':'');
  const periodStart=new Date();periodStart.setUTCDate(periodStart.getUTCDate()-30);
  const days=p.dates.filter(d=>Date.parse(d)>=periodStart.getTime()).length||Math.min(30,twin.days);
  const minutes=Math.min(40,(p.checkins?.length??0)*4+w.messages.filter(m=>m.patientId===p.id).length*2);
  return {
    syndrome:twin.iasp.replace(/^IASP [^·]+ · /,''),
    step:step?.title??(p.pathway?'Pathway complete':'Not enrolled'),
    twin:twin.model,
    lastCheckin:featureEnabled(w,'assessments')?(p.dates.at(-1)??''):'',
    adherence,
    alerts:alerts.length,
    pending:pending||'None',
    rtm:`${days}d · ${minutes} min`,
    alertPriority:alerts.some(r=>r.priority==='High')?0:alerts.length?1:2,
  };
}

/** Recorded context behind a worklist prompt. No generated prescribing evidence. */
export function overviewRecommendationDetails(p:Patient,w:Workspace,suggestion:{title:string;reason:string;kind:'medication'|'plan'|'review'|'referral';basis?:{label:string;value:string;date?:string;href?:string}[]}){
  const reviews=w.reviews.filter(r=>r.patientId===p.id&&r.status!=='Resolved'&&r.title===suggestion.title);
  const active=p.medications.filter(m=>m.status==='Active');
  const matching=active.filter(m=>suggestion.reason.includes(m.name));
  const meds=suggestion.kind==='medication'?(matching.length?matching:active):[];
  const sources:{label:string;value:string;href?:string;date?:string}[]=[...reviews.map(r=>({label:r.source||'Review record',value:r.detail,href:'/review-queue',date:r.created})),...meds.map(m=>({label:m.name+' · '+m.source,value:[m.benefit,m.tolerability,m.adherence,m.effects,m.regimen?'Regimen: '+m.regimen:'Dose and schedule not recorded',m.reviewedAt?'Reviewed by '+m.reviewedBy+' on '+m.reviewedAt:'Clinician verification not recorded'].filter(Boolean).join('. '),href:'/patients/'+p.id+'?tab=visit#patient-medications',date:m.reportedAt||undefined}))];
  sources.push(...(suggestion.basis??[]));
  const plan=p.carePlans[0];
  if(suggestion.kind==='plan'&&plan)sources.push({label:'Recorded clinician plan',value:plan.text+' Follow-up: '+plan.followup+'. Owner: '+plan.owner,href:'/patients/'+p.id+'?tab=notes',date:plan.date});
  if(suggestion.kind==='review'&&!reviews.length){const latest=visitObservations(p).at(-1),previous=visitObservations(p).at(-2);for(const [label,point] of [['Latest report',latest],['Previous report',previous]] as const)if(point)sources.push({label,value:('Pain: '+(point.pain??'not answered')+'; function: '+(point.function??'not answered')+'; sleep: '+(point.sleep??'not answered')+'. Source: '+point.source),date:point.date,href:'/patients/'+p.id+'?tab=visit#patient-outcomes'});}
  if(!sources.length)sources.push({label:'Patient record',value:suggestion.kind==='medication'?(p.medicationReconciliation?.none?'No current medication use was recorded as confirmed.':'No active medication entries are recorded. Absence of entries does not establish absence of use.'):suggestion.kind==='review'?'No usable outcome observations are recorded.':plan?'A care plan is recorded.':'No current clinician plan is recorded.',href:'/patients/'+p.id});
  return {title:suggestion.title,summary:p.name+' · '+p.id,rationale:[suggestion.reason,...reviews.map(r=>'Recorded priority: '+r.priority+'. Status: '+r.status+'.'+(r.owner?' Owner: '+r.owner+'.':''))],sources,considerations:[p.goal?'Patient goal: '+p.goal:'Patient goal has not been recorded.',...meds.filter(m=>!m.reviewedAt).map(m=>m.name+': confirm the patient report, current dose, and timing of effects before changing treatment.')],alternatives:suggestion.kind==='medication'?['Complete medication reconciliation or clarify missing response information before considering a change.','Keep or revise the current plan after clinician assessment; this prompt does not select a treatment.']:['Review the supporting record and document an assessment before assigning or closing follow-up.'],limitations:['This is a rule-based review prompt from the saved record, not a validated treatment recommendation.',...(meds.length?['Reported benefit and effects do not establish that the medication caused the change.']:[])]};
}
