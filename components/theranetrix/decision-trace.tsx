import type {Workspace} from '@/lib/theranetrix';
import type {State} from '@/lib/clinical-flows/decisions';
import {formatDate} from './ui';

type Snapshot=State['signedSnapshots'][number];
function linkedRunIds(snapshot:Snapshot,patientId:string):string[]{
  return [snapshot.reviewedInput.comparisonSnapshot,snapshot.reviewedInput.engineComparison]
    .filter(row=>row.patientId===patientId&&row.encounterId===snapshot.encounterId&&row.sourceRunId&&(!row.sourceRunSnapshot||row.sourceRunSnapshot.id===row.sourceRunId&&row.sourceRunSnapshot.patientId===patientId))
    .map(row=>row.sourceRunId!);
}

export function signedDecisionsForTrace(workspace:Workspace,patientId:string,runId?:string,unlinkedOnly=false):Snapshot[]{
  const runs=new Set(workspace.engineRuns?.filter(run=>run.patientId===patientId).map(run=>run.id)??[]);
  return (workspace.clinicalWorkflows?.slices.decisions.state.signedSnapshots??[]).filter(snapshot=>{
    if(snapshot.patientId!==patientId)return false;
    const ids=linkedRunIds(snapshot,patientId);
    return runId?runs.has(runId)&&ids.includes(runId):!unlinkedOnly||!ids.some(id=>runs.has(id));
  });
}

/** Show immutable text from the signature, without substituting today's plan. */
export function SignedDecisionTrace({workspace,patientId,runId,unlinkedOnly=false}:{workspace:Workspace;patientId:string;runId?:string;unlinkedOnly?:boolean}){
  const snapshots=signedDecisionsForTrace(workspace,patientId,runId,unlinkedOnly);
  if(!snapshots.length)return null;
  const dispositions={approve:'Approved',defer:'Deferred',reject:'Rejected','no-change':'No change'};
  return <section aria-label="Immutable signed decisions"><h3>{unlinkedOnly?'Other signed decision records':'Immutable signed decisions'}</h3>{snapshots.map(snapshot=><article key={snapshot.id} className="engine-history">
    <h4>{dispositions[snapshot.disposition]} · {formatDate(snapshot.createdAt,true)}</h4>
    <p>{snapshot.displayedOutputs.summary}</p><p><strong>Recorded rationale:</strong> {snapshot.rationale}</p>
    <p><strong>Patient instructions at signing:</strong> {snapshot.carePackage?.instructions??snapshot.patientPlanSnapshot?.summary??'Instructions were not included in this historical record.'}</p>
    <small>{snapshot.actor} · Encounter {snapshot.encounterId} · revision {snapshot.version}{snapshot.amendmentOf?' · amendment':''}</small>
    <details><summary>Signed record references</summary><p>Signed record: {snapshot.id}{snapshot.amendmentOf?` · amends ${snapshot.amendmentOf}`:''}</p><p>Plan reference: {snapshot.patientPlanRef}</p><p>PST output: {snapshot.displayedOutputs.pstOutputId} · Shadow output: {snapshot.displayedOutputs.shadowOutputId}</p><p>Evidence versions: {snapshot.evidenceVersions.join(', ')||'Not recorded'}</p><p>Model versions: {snapshot.modelVersions.join(', ')||'Not recorded'}</p><p>Configuration versions: {snapshot.configurationVersions.join(', ')||'Not recorded'}</p></details>
  </article>)}<p><a className="text-link" href={'/patients/'+encodeURIComponent(patientId)+'?workflow=decisions&workflowJourney=J18'}>Open Decisions workspace</a></p></section>;
}
