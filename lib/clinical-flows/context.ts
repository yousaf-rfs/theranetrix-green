import {checkinSource} from '../visit-observations';
import type {Patient,Workspace} from '../theranetrix';
import {openCareWork} from '../care-operations';
import type {ReviewEvidence,ReceivingWork} from './encounters';
import type {DecisionCarePackage,DecisionSourceSnapshot,DecisionObservationSource} from './decisions';
import type {TreatmentRecord} from './treatment-continuity';
import {workflowBridgeId} from './bridges';
import {z} from 'zod';
const recordedInstant=(value:string)=>z.string().datetime({offset:true}).safeParse(value).success;

export function encounterContext(w:Workspace,p:Patient,now:string){
  const dependencies=openCareWork(w,p.id),state=w.clinicalWorkflows!.slices.encounters.state;
  const receivingWork:ReceivingWork[]=dependencies.map(row=>{
    const handoff=w.clinicalWorkflows!.slices['patient-coordination'].state.handoffs.find(h=>h.id===row.sourceId);
    return {...row,...(handoff?{priority:handoff.priority,fallbackOwner:handoff.fallbackOwner,coverageExpectation:handoff.coverageExpectation,status:handoff.phase}:{})};
  });
  const observations:ReviewEvidence['observations']=state.observations.filter(r=>r.patientId===p.id&&r.status==='confirmed').flatMap(r=>r.currentEntries.map(e=>({recordId:r.id,entryId:e.id,version:r.version,metric:e.metric,status:e.status,...(e.value!==undefined?{value:e.value}:{}),recordedAt:e.recordedAt,source:e.source})));
  const workflowRecords=new Set(state.observations.filter(r=>r.patientId===p.id).map(r=>r.id));
  const supersededCheckins=new Set(p.checkins.map(checkin=>checkin.supersedes).filter(Boolean));
  for(const checkin of p.checkins){
    if(checkin.withdrawnAt||supersededCheckins.has(checkin.id)||checkin.workflowRecordId&&workflowRecords.has(checkin.workflowRecordId))continue;
    // Advisor and earlier check-ins are real saved sources too. Keep their
    // original dates and values without duplicating workflow projections.
    for(const metric of ['pain','function','sleep'] as const)observations.push({recordId:checkin.id,entryId:workflowBridgeId('checkin-entry',p.id,checkin.id,metric),version:checkin.workflowVersion??1,metric,status:checkin[metric]===0?'zero':'answered',value:checkin[metric],recordedAt:checkin.date,source:checkinSource(checkin)});
  }
  const reviewEvidence:ReviewEvidence={patientId:p.id,capturedAt:now,goal:{text:p.goal},observations,pendingWork:dependencies.map(({id,revision,title})=>({id,revision,title}))};
  return {closureDependencies:dependencies,receivingWork,reviewEvidence};
}
export function decisionSourceSnapshot(w:Workspace,p:Patient,encounterId:string,inputVersion:string,now:string):DecisionSourceSnapshot{
  const facts:Record<string,string>={Condition:p.condition,Goal:p.goal,'Allergy status':p.clinicalContext?.allergyStatus??'Not reviewed',Allergies:p.clinicalContext?.allergies??'Not recorded'};
  for(const m of p.medications)facts['Medication '+m.name]=[m.regimen,m.status,m.benefit,m.tolerability,m.effects,m.reportedAt].filter(Boolean).join(' · ');
  for(const metric of ['pain','function','sleep'] as const){const active=w.clinicalWorkflows?.slices.encounters.state.observations.filter(r=>r.patientId===p.id&&r.status==='confirmed').flatMap(r=>r.currentEntries).filter(e=>e.metric===metric).sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt)).at(-1);facts[metric]=active?[active.value??active.status,active.recordedAt,active.source].join(' · '):p[metric].length?[p[metric].at(-1),p.dates.at(-1)].join(' · '):'Not recorded';}
  for(const r of w.reviews.filter(r=>r.patientId===p.id&&r.status!=='Resolved'))facts['Open concern '+r.id]=r.title+' · '+r.detail;
  const superseded=new Set(p.carePlans.map(plan=>plan.supersedes).filter(Boolean));
  for(const plan of p.carePlans.filter(plan=>!superseded.has(plan.id)))facts['Care plan '+plan.id]=plan.text;
  return {patientId:p.id,encounterId,inputVersion,capturedAt:now,facts};
}
export function carePlanPackages(w:Workspace,p:Patient):DecisionCarePackage[]{
  return p.carePlans.map(plan=>({patientId:p.id,planId:plan.id,patientName:p.name,instructions:plan.text,owner:plan.owner,followUp:{date:plan.followup,time:plan.time,...(plan.timezone?{timezone:plan.timezone}:{})},notes:p.notes.filter(note=>note.workflowRecordId===plan.workflowRecordId&&plan.workflowRecordId&&recordedInstant(note.date)).map(note=>({id:note.id,at:note.date,actor:note.author,text:note.text})),tasks:w.tasks.filter(task=>task.patientId===p.id&&task.planId===plan.id).map(task=>({id:task.id,title:task.title,...(task.owner?{owner:task.owner}:{}),dueAt:[task.date,task.time,task.timezone].filter(Boolean).join(' '),done:task.done,history:task.history?.filter(h=>recordedInstant(h.changedAt)).map(h=>({at:h.changedAt,actor:h.changedBy,reason:h.reason,status:h.done?'completed':'open'}))}))}));
}
export function careActionReferences(w:Workspace){
  const s=w.clinicalWorkflows!.slices;
  const treatment=s['treatment-continuity'].state;
  const treatmentTitle=(record:TreatmentRecord)=>{
    switch(record.kind){
      case 'reconciliation':return 'Reconciliation: '+record.source;
      case 'experience':return 'Treatment response: '+record.medicationName+' — '+record.regimen;
      case 'lifecycle':return 'Medication order: '+record.medicationName;
      case 'access':return 'Access: '+record.barrierType+' — '+record.patientChoice;
      case 'transition':return 'Care transition: '+record.externalCareSource;
      case 'multidisciplinary':return 'Multidisciplinary care: '+record.functionalGoal;
    }
  };
  return [
    ...[...s['results-referrals'].state.results,...s['results-referrals'].state.referrals].map(r=>({domain:'results-referrals' as const,id:r.id,version:r.version,patientId:r.patientId,title:'requestLabel' in r?r.requestLabel:r.clinicalQuestion,owner:r.owner})),
    ...[...treatment.reconciliations,...treatment.experiences,...treatment.lifecycles,...treatment.accessBarriers,...treatment.transitions,...treatment.multidisciplinary].map(r=>({domain:'treatment-continuity' as const,id:r.id,version:r.version,patientId:r.patientId,title:treatmentTitle(r),owner:r.owner})),
    ...s.encounters.state.signoffs.map(r=>({domain:'encounters' as const,id:r.id,version:r.version,patientId:r.patientId,title:r.patientFacingPlan,owner:r.owner})),
  ];
}
export function decisionObservationSources(w:Workspace,p:Patient,encounterId:string):DecisionObservationSource[]{
  return w.clinicalWorkflows!.slices.encounters.state.observations.filter(r=>r.patientId===p.id&&r.encounterId===encounterId&&r.status==='confirmed').flatMap(r=>r.currentEntries.map(entry=>{
    const projected=p.workflowObservations?.find(row=>row.id===entry.id&&!row.withdrawnAt);
    return {entryId:entry.id,recordId:r.id,recordVersion:r.version,metric:entry.metric,status:entry.status,...(entry.value!==undefined?{value:entry.value}:{}),source:entry.source,collectedAt:entry.recordedAt,...(projected?{confirmedAt:projected.confirmedAt,confirmedBy:projected.confirmedBy}:{}),...(entry.correctedFromEntryId?{correctedFromEntryId:entry.correctedFromEntryId}:{})};
  }));
}
