import type {State} from './program-governance';

export type GovernanceRegistry='configuration'|'protocol'|'evidence'|'release'|'operation'|'monitoring'|'readiness';
const registries={configuration:'configurations',protocol:'protocols',evidence:'evidences',release:'releases',operation:'operations',monitoring:'monitoring',readiness:'readiness'} as const;

/** Resolve our creation receipt, never whichever record happens to be newest. */
export function createdGovernanceRecordId(state:State,kind:GovernanceRegistry,requestId:string|undefined):string|undefined{
  if(!requestId)return;
  const receipt=state.receipts.find(item=>item.requestId===requestId&&item.entityType===kind&&item.expectedVersion===null);
  if(receipt&&state[registries[kind]].some(record=>record.id===receipt.entityId))return receipt.entityId;
}
