import {featureDefinitions,featureEnabled,type Patient,type Workspace} from './theranetrix';
import {requireDemoExportScope,type ExportAudience} from './demo-connection';

export function patientExport(p:Patient,w:Workspace,date=new Date().toISOString(),audience:ExportAudience='internal'){
  const scope=requireDemoExportScope(w,p.id,audience,date);
  if(audience!=='internal'){
    const stored=w.patients.find(patient=>patient.id===p.id)!;
    const superseded=new Set(stored.carePlans.map(plan=>plan.supersedes).filter(Boolean));
    const plan=stored.carePlans.find(plan=>!superseded.has(plan.id));
    if(!plan)throw new Error('Save a patient care plan before preparing instructions.');
    return structuredClone({audience,recipient:scope.recipient,accessScope:scope.accessScope,...(scope.grantId?{grantId:scope.grantId}:{}),exportedAt:date,
      patient:{id:stored.id,name:stored.name},
      plan:{id:plan.id,version:plan.workflowVersion??1,text:plan.text,goal:plan.workflowGoal??stored.goal,owner:plan.owner,followup:plan.followup,time:plan.time,...(plan.timezone?{timezone:plan.timezone}:{}),...(typeof plan.appointmentBooked==='boolean'?{appointmentBooked:plan.appointmentBooked}:{})},
      notice:'Prepared patient instructions. This copy has not been sent to an external recipient.'});
  }
  return structuredClone({notice:'Not a clinical export. Retained records are included even when their workflow is off.',exportedAt:date,
    patient:p,reviews:w.reviews.filter(r=>r.patientId===p.id),tasks:w.tasks.filter(t=>t.patientId===p.id),messages:w.messages.filter(m=>m.patientId===p.id),audit:w.audit.filter(a=>a.patientId===p.id),engineRuns:w.engineRuns?.filter(r=>r.patientId===p.id)??[],engineDecisions:w.engineDecisions?.filter(d=>d.patientId===p.id)??[],advisorTurns:w.advisorTurns?.filter(t=>t.patientId===p.id)??[],
    configurationAtExport:{requested:w.features,effective:Object.fromEntries(featureDefinitions.map(f=>[f.id,featureEnabled(w,f.id)])),snapshotId:w.configurationHistory?.[0]?.id??null}});
}
