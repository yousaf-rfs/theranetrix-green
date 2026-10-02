import type {Workspace} from '../theranetrix';
import {retainTaskState} from '../record-history';
import {workflowBridgeId} from './bridge-identity';
import {treatmentTaskIds} from './treatment-bridges';
import {validateState,type CareActionRef,type TransitionRecord} from './treatment-continuity';

type Assignment=NonNullable<TransitionRecord['handoverEvidence']>['pendingTransfers'][number];
type Source={version:number;taskIds:string[]};
function retainsVersion(record:{version:number;history:readonly unknown[]},ref:CareActionRef){
  // Each source update appends one immutable event and source IDs cannot be
  // reused. A complete event chain proves the accepted version is retained.
  return record.version===record.history.length&&ref.version<=record.version&&!!record.history[ref.version-1];
}

function assignmentSource(workspace:Workspace,patientId:string,ref:CareActionRef):Source|undefined{
  const slices=workspace.clinicalWorkflows!.slices;
  if(ref.domain==='treatment-continuity'){
    const state=slices['treatment-continuity'].state;
    const matches=[...state.reconciliations,...state.experiences,...state.lifecycles,...state.accessBarriers,...state.transitions,...state.multidisciplinary].filter(record=>record.patientId===patientId&&record.id===ref.id);
    if(matches.length!==1||!retainsVersion(matches[0],ref))return;
    return {version:matches[0].version,taskIds:treatmentTaskIds(matches[0])};
  }
  if(ref.domain==='results-referrals'){
    const state=slices['results-referrals'].state;
    const matches=[...state.results,...state.referrals].filter(record=>record.patientId===patientId&&record.id===ref.id);
    if(matches.length!==1||!retainsVersion(matches[0],ref))return;
    const record=matches[0],kind='requestLabel' in record?'result':'referral';
    return {version:record.version,taskIds:[workflowBridgeId(kind+'-work',patientId,record.id)]};
  }
  const matches=slices.encounters.state.signoffs.filter(record=>record.patientId===patientId&&record.id===ref.id);
  if(matches.length!==1||!retainsVersion(matches[0],ref))return;
  const record=matches[0],snapshot=record.signedSnapshot;
  return {version:record.version,taskIds:snapshot?[workflowBridgeId('followup',patientId,record.encounterId),workflowBridgeId('clarification',patientId,record.encounterId),...snapshot.pendingWork.map(item=>workflowBridgeId('work',patientId,record.encounterId,item.title.trim().toLowerCase()))]:[]};
}

/** Acceptance assigns responsibility; later source versions still require their own clinical review. */
export function projectAcceptedWorkAssignments(workspace:Workspace,context:{actor:string;now:string}):Workspace{
  if(!workspace.clinicalWorkflows)return workspace;
  const state=validateState(workspace.clinicalWorkflows.slices['treatment-continuity'].state);
  const assignments=new Map<string,{transition:TransitionRecord;transfer:Assignment;source:Source}>();
  for(const transition of state.transitions){
    const evidence=transition.handoverEvidence;
    if(transition.handoverStatus!=='completed'||!transition.ownershipAccepted||evidence?.acceptance!=='accepted'||evidence.acceptedBy!==transition.receivingClinician||!evidence.acceptedAt||!evidence.acceptanceEvidence||Date.parse(evidence.acceptedAt)>Date.parse(transition.updatedAt))continue;
    for(const transfer of evidence.pendingTransfers){
      if(transfer.disposition!=='accepted-transfer'||!transition.pendingWork.includes(transfer.title)||Date.parse(transfer.acceptedAt)>Date.parse(transition.updatedAt))continue;
      const source=assignmentSource(workspace,transition.patientId,transfer.ref);
      // Acceptance stays pinned to its recorded version. This projection carries
      // its owner forward, and never updates that reference or marks work done.
      if(!source||source.version<transfer.ref.version)continue;
      const key=JSON.stringify([transition.patientId,transfer.ref.domain,transfer.ref.id]),prior=assignments.get(key);
      if(prior){
        const acceptedAt=Date.parse(transfer.acceptedAt),priorAcceptedAt=Date.parse(prior.transfer.acceptedAt);
        if(priorAcceptedAt>acceptedAt||priorAcceptedAt===acceptedAt&&Date.parse(prior.transition.updatedAt)>=Date.parse(transition.updatedAt))continue;
      }
      assignments.set(key,{transition,transfer,source});
    }
  }
  let next=workspace;
  for(const {transition,transfer,source} of assignments.values()){
    for(const task of workspace.tasks){
      if(task.patientId!==transition.patientId||task.workflowRecordId!==transfer.ref.id||!source.taskIds.includes(task.id)||task.done||task.workflowDisposition==='deferred'||task.owner===transfer.owner)continue;
      if(next===workspace)next=structuredClone(workspace);
      const target=next.tasks.find(item=>item.id===task.id)!;
      retainTaskState(target,context.actor,context.now,`Accepted transfer to ${transfer.owner} (${transfer.acceptedAt}): ${transfer.evidenceRef}`);
      target.owner=transfer.owner;
    }
  }
  return next;
}
