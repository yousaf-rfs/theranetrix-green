import {engineVersion,type EngineRun} from '../engine-demo';
import {featureEnabled,type FeatureKey,type Workspace} from '../theranetrix';
import {evaluateRuntimeUse,initialState,validateState,type Capability,type Context,type GovernedEvidenceRef,type GovernedUsage,type ReleaseRef,type State} from './program-governance';

type StampedRun=EngineRun&{releaseRef?:ReleaseRef};
type SavedEvidence={id:string;version:string};
function governanceState(workspace:Workspace):State{return validateState(workspace.clinicalWorkflows?.slices['program-governance'].state??initialState());}
function exactRelease(state:State,ref:ReleaseRef|undefined){
  if(!ref||!Number.isInteger(ref.artifactVersion)||ref.artifactVersion<1)return false;
  const record=state.releases.find(item=>item.id===ref.releaseId);
  return !!record&&(record.artifactVersion===ref.artifactVersion||record.revisions.some(revision=>(revision.record.artifactVersion??1)===ref.artifactVersion));
}
function boundedId(kind:string,...parts:string[]){
  let first=2166136261,second=2246822507;
  for(const letter of JSON.stringify(parts)){first=Math.imul(first^letter.charCodeAt(0),16777619);second=Math.imul(second^letter.charCodeAt(0),3266489909);}
  return `gov-${kind}-${(first>>>0).toString(16).padStart(8,'0')}${(second>>>0).toString(16).padStart(8,'0')}`;
}

/** Uses saved identities only. Engine labels and unqualified version strings never establish an artifact mapping. */
export function governedContext(workspace:Workspace):Pick<Context,'governedUsages'|'usageCoverage'|'patientPathways'> & {usageCoverageIssues:string[]}{
  const state=governanceState(workspace),usages:GovernedUsage[]=[],issues:string[]=[];
  const seen=new Map<string,string>();
  const knownPatient=(patientId:string)=>workspace.patients.some(patient=>patient.id===patientId);
  function evidenceReferences(refs:readonly SavedEvidence[],sourceId:string):GovernedEvidenceRef[]{
    const result:GovernedEvidenceRef[]=[];
    for(const ref of refs){
      const record=state.evidences.find(item=>item.id===ref.id),version=/^[1-9]\d*$/.test(ref.version)?Number(ref.version):NaN;
      if(!record||!Number.isSafeInteger(version)||record.version!==version&&!record.revisions.some(revision=>revision.version===version)){issues.push(`Evidence mapping is incomplete for ${sourceId}: ${ref.id}.`);continue;}
      if(!result.some(item=>item.evidenceId===ref.id&&item.version===version))result.push({evidenceId:ref.id,version});
    }
    return result;
  }
  function add(input:{patientId:string;encounterId:string;sourceId:string;sourceVersion:number;releaseRefs:readonly (ReleaseRef|undefined)[];evidence:readonly SavedEvidence[];needsRelease:boolean}){
    if(!knownPatient(input.patientId)){issues.push(`Saved output ${input.sourceId} references an unavailable patient.`);return;}
    const evidenceRefs=evidenceReferences(input.evidence,input.sourceId),refs=new Map<string,ReleaseRef>();
    for(const ref of input.releaseRefs){if(!ref)continue;if(exactRelease(state,ref))refs.set(`${ref.releaseId}:${ref.artifactVersion}`,ref);else issues.push(`Release mapping is incomplete for ${input.sourceId}.`);}
    if(input.needsRelease&&!refs.size)issues.push(`Saved output ${input.sourceId} has no exact released-artifact reference.`);
    // Different reviewed model artifacts remain separate impact sources even in one signed package.
    const references=refs.size?[...refs.values()]:[undefined];
    for(const ref of references){
      const sourceId=references.length>1?boundedId('output',input.sourceId,ref!.releaseId,String(ref!.artifactVersion)):input.sourceId;
      const usage:GovernedUsage={patientId:input.patientId,encounterId:input.encounterId,sourceId,sourceVersion:input.sourceVersion,...(ref?{releaseRef:structuredClone(ref)}:{}),evidenceRefs:structuredClone(evidenceRefs)};
      const key=JSON.stringify([usage.patientId,usage.encounterId,usage.sourceId,usage.sourceVersion]),fingerprint=JSON.stringify(usage);
      const prior=seen.get(key);
      if(prior&&prior!==fingerprint)issues.push(`Conflicting saved references exist for ${input.sourceId}.`);
      if(!prior){seen.set(key,fingerprint);usages.push(usage);}
    }
  }
  for(const run of (workspace.engineRuns??[]) as StampedRun[])add({patientId:run.patientId,encounterId:boundedId('engine-episode',run.patientId,run.id),sourceId:run.id,sourceVersion:1,releaseRefs:[run.releaseRef],evidence:[],needsRelease:true});
  const decisions=workspace.clinicalWorkflows?.slices.decisions.state;
  for(const row of decisions?.comparisonSnapshots??[])add({patientId:row.patientId,encounterId:row.encounterId,sourceId:row.id,sourceVersion:row.version,releaseRefs:[row.sourceRunSnapshot?.releaseRef],evidence:row.evidenceRefs,needsRelease:!!row.sourceRunId||!row.evidenceRefs.length});
  for(const row of decisions?.engineComparisons??[])add({patientId:row.patientId,encounterId:row.encounterId,sourceId:row.id,sourceVersion:row.version,releaseRefs:[row.sourceRunSnapshot?.releaseRef],evidence:[...row.supportingEvidence,...row.conflictingEvidence],needsRelease:true});
  for(const row of decisions?.signedSnapshots??[]){
    const comparison=row.reviewedInput.comparisonSnapshot,outputs=row.reviewedInput.engineComparison;
    add({patientId:row.patientId,encounterId:row.encounterId,sourceId:row.id,sourceVersion:row.version,releaseRefs:[comparison.sourceRunSnapshot?.releaseRef,outputs.sourceRunSnapshot?.releaseRef],evidence:[...comparison.evidenceRefs,...outputs.supportingEvidence,...outputs.conflictingEvidence],needsRelease:true});
  }
  return {governedUsages:usages,usageCoverage:issues.length?'partial':'complete',usageCoverageIssues:[...new Set(issues)],patientPathways:structuredClone(workspace.clinicalWorkflows?.slices['patient-coordination'].state.pathways??[])};
}

/** Three arguments generate with the current reviewed artifact. A fourth argument adopts that exact saved artifact. */
export function requireGovernedUse(workspace:Workspace,capability:Capability,now:string,releaseRef?:ReleaseRef):ReleaseRef|undefined{
  const adopting=arguments.length>=4,state=governanceState(workspace);
  const configured=!!state.activeConfigurationId||state.releases.length>0||state.readiness.length>0||state.recalls.length>0;
  const features=Object.fromEntries((Object.keys(workspace.features) as FeatureKey[]).map(key=>[key,featureEnabled(workspace,key)]));
  const input={capability,environment:'demo' as const,populationRef:'workspace-patient-records',role:'workspace-owner'};
  if(adopting&&configured&&!releaseRef)throw new Error('This saved output has no exact release reference. Review a newly generated, governed output before adopting it.');
  const context={now,features};
  let ref=releaseRef;
  const engineCapability=['digitalTwin','pst','shadow','advisor'].includes(capability);
  if(!adopting&&configured){
    const candidates=state.releases.filter(release=>(!engineCapability||release.modelId===engineVersion)&&evaluateRuntimeUse(state,{...input,releaseRef:{releaseId:release.id,artifactVersion:release.artifactVersion}},context).allowed);
    if(candidates.length!==1){const policy=evaluateRuntimeUse(state,input,context);throw new Error(policy.reasons.length?policy.reasons.join(' '):'Choose one currently reviewed artifact matching the running demonstration engine.');}
    ref={releaseId:candidates[0].id,artifactVersion:candidates[0].artifactVersion};
  }
  if(ref&&engineCapability){
    const release=state.releases.find(item=>item.id===ref!.releaseId);
    // Historical artifacts are evaluated below; a new release cannot silently replace a saved one.
    const artifact=release?.artifactVersion===ref.artifactVersion?release:release?.revisions.find(revision=>(revision.record.artifactVersion??1)===ref!.artifactVersion)?.record;
    if(!artifact||artifact.modelId!==engineVersion)throw new Error('The selected release does not identify the running demonstration engine.');
  }
  const result=evaluateRuntimeUse(state,{...input,...(ref?{releaseRef:ref}:{})},context);
  if(!result.allowed)throw new Error(result.reasons.join(' '));
  return result.releaseRef?structuredClone(result.releaseRef):undefined;
}
