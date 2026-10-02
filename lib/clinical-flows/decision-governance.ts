import type {Workspace} from '../theranetrix';
import type {Action,State} from './decisions';
import {requireGovernedUse} from './governance-runtime';

type SignAction=Extract<Action,{type:'decisions.sign.capture'|'decisions.sign.amend'}>;

/** An amendment adopts the original reviewed artifacts, never today's replacement. */
export function requireDecisionApprovalUse(workspace:Workspace,command:SignAction,now:string):void{
  if(command.disposition!=='approve')return;
  const state=workspace.clinicalWorkflows?.slices.decisions.state;
  const inScope=(row:{patientId:string;encounterId:string})=>row.patientId===command.patientId&&row.encounterId===command.encounterId;
  let comparison:State['comparisonSnapshots'][number]|undefined,outputs:State['engineComparisons'][number]|undefined;
  if(command.type==='decisions.sign.amend'){
    const signed=state?.signedSnapshots.find(row=>row.id===command.signedSnapshotId&&inScope(row));
    if(!signed)throw new Error('Signed snapshot not found.');
    comparison=signed.reviewedInput.comparisonSnapshot;
    outputs=signed.reviewedInput.engineComparison;
  }else{
    const draft=state?.drafts.find(row=>row.id===command.draftId&&inScope(row));
    if(!draft)throw new Error('Draft not found for sign-off.');
    comparison=state?.comparisonSnapshots.find(row=>row.id===draft.payload.comparisonSnapshotId&&inScope(row));
    outputs=state?.engineComparisons.find(row=>row.id===draft.payload.engineComparisonId&&inScope(row));
  }
  const runs=[comparison?.sourceRunSnapshot,outputs?.sourceRunSnapshot].filter(run=>run!==undefined);
  if(!runs.length){requireGovernedUse(workspace,'digitalTwin',now);return;}
  for(const run of runs)for(const capability of ['digitalTwin','pst','shadow'] as const){
    requireGovernedUse(workspace,capability,now,run.releaseRef);
  }
}
