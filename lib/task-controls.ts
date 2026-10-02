import type {Task,Workspace} from './theranetrix';
import {workflowBridgeId} from './clinical-flows/bridges';
import {treatmentBridgeId} from './clinical-flows/treatment-bridges';
import {validateState as validateTreatmentState} from './clinical-flows/treatment-continuity';

/** Navigation remains available even for an independently completed follow-up. */
export function taskWorkflowDestination(workspace:Workspace,task:Task):string|undefined{
  const slices=workspace.clinicalWorkflows?.slices;
  if(task.workflowDomain==='program-governance')return 'program-governance';
  if(task.workflowDomain==='treatment-continuity')return 'treatment-continuity';
  if(slices&&task.workflowRecordId){
    const id=task.workflowRecordId;
    if([...slices['patient-coordination'].state.handoffs,...slices['patient-coordination'].state.scheduling,...slices['patient-coordination'].state.pathways].some(r=>r.id===id&&r.patientId===task.patientId))return 'patient-coordination';
    if([...slices['results-referrals'].state.results,...slices['results-referrals'].state.referrals].some(r=>r.id===id&&r.patientId===task.patientId))return 'results-referrals';
    if(task.encounterId&&task.id===workflowBridgeId('clarification',task.patientId,task.encounterId))return 'encounters';
  }
  if(workspace.careOperations?.remoteVisits.some(r=>r.patientId===task.patientId&&task.id===workflowBridgeId('remote-recovery',r.patientId,r.encounterId))||task.id===workflowBridgeId('monitoring-recovery',task.patientId,'monitoring'))return 'care-operations';
}

function isAccessResponseTask(workspace:Workspace,task:Task):boolean{
  if(task.workflowDomain!=='treatment-continuity'||task.workflowDisposition==='deferred')return false;
  const slice=workspace.clinicalWorkflows?.slices['treatment-continuity'];if(!slice)return false;
  try{
    const source=validateTreatmentState(slice.state).accessBarriers.find(record=>record.id===task.workflowRecordId&&record.patientId===task.patientId);
    const review=source?.accessReview;
    return !!source&&task.workflowVersion===source.version&&review?.actualStart==='started'&&!!review.actualStartAt&&!!review.followUpDaysAfterStart&&task.id===treatmentBridgeId('task',source.patientId,'access',source.id,'response');
  }catch{return false;}
}

/** Derived milestones need their domain transition; the access review is independent work. */
export function taskWorkflow(workspace:Workspace,task:Task):string|undefined{
  return isAccessResponseTask(workspace,task)?undefined:taskWorkflowDestination(workspace,task);
}
