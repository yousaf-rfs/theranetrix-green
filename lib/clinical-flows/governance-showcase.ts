import {engineVersion} from '../engine-demo';
import {featureEnabled,type Workspace,type FeatureKey} from '../theranetrix';
import {applyWorkflowAction,normalizeClinicalWorkflows} from './index';
import {type Action,type Capability,type State} from './program-governance';

const fixturePrefix=`Local demonstration · ${engineVersion}`;
const evidenceLocator=`local-demo://program-review/${engineVersion}`;
const reviewer='Local program demonstration reviewer';
const dependencies:Partial<Record<Capability,Capability>>={digitalTwin:'assessments',pst:'digitalTwin',shadow:'digitalTwin',advisor:'messages'};
const owned=<T extends {title:string;revisions:{record:Record<string,unknown>}[]}>(records:T[],title:string)=>records.find(record=>record.title===title||record.revisions.some(revision=>revision.record.title===title));

/** Adds a named local demonstration review through ordinary commands; edited fixture records are never reapproved. */
export function ensureGovernanceShowcase(source:Workspace,actor:string,now:string):Workspace{
  let data=structuredClone(source);
  data.clinicalWorkflows=normalizeClinicalWorkflows(data.clinicalWorkflows);
  const state=():State=>data.clinicalWorkflows!.slices['program-governance'].state;
  const save=(command:Action)=>{
    data=applyWorkflowAction(data,{type:'workflow.apply',domain:'program-governance',requestId:command.requestId,expectedSliceVersion:data.clinicalWorkflows!.slices['program-governance'].version,command},actor,now);
  };
  const id=()=>crypto.randomUUID();
  const reason='Named local review of demonstration records; no clinical performance, payer eligibility, deployment, or production approval.';
  let configuration=state().configurations.find(record=>record.id===state().activeConfigurationId);
  if(!configuration){
    // A deliberately deactivated or edited fixture remains deactivated or edited.
    if(owned(state().configurations,`${fixturePrefix} configuration`)||state().configurations.some(record=>record.status==='inactive'))return data;
    const capabilities=(Object.keys(data.features) as FeatureKey[]).filter(key=>featureEnabled(data,key));
    if(!capabilities.length)return data;
    save({type:'program-governance.configuration-save-draft',requestId:id(),record:{title:`${fixturePrefix} configuration`,capabilityChoices:capabilities,allowedCadence:['manual-only'],languages:['English'],communicationSettings:['in-app'],displayReferences:['Demonstration patient records and attributed local review'],safetyEssentials:['Patient identity','Named owner','Source dates','Demonstration scope'],nonHideableSafetyEssentials:['Patient identity','Named owner','Source dates','Demonstration scope']}});
    configuration=state().configurations[0];
    save({type:'program-governance.configuration-review',requestId:id(),id:configuration.id,expectedVersion:configuration.version,reviewNote:reason});
    configuration=state().configurations.find(record=>record.id===configuration!.id)!;
    save({type:'program-governance.configuration-activate',requestId:id(),id:configuration.id,expectedVersion:configuration.version,reason});
    configuration=state().configurations.find(record=>record.id===configuration!.id)!;
  }
  if(configuration.status!=='active'||configuration.capabilityChoices.some(capability=>!featureEnabled(data,capability)||dependencies[capability]&&!configuration!.capabilityChoices.includes(dependencies[capability]!)))return data;
  const configurationId=configuration.id,configurationVersion=configuration.version;
  let evidence=owned(state().evidences,`${fixturePrefix} checklist`);
  if(!evidence){
    save({type:'program-governance.evidence-save-draft',requestId:id(),record:{title:`${fixturePrefix} checklist`,indication:'Rule-based record review demonstration',population:'Workspace patient records used in local walkthroughs',endpoint:'Attributed documentation, version retention, and explicit review boundaries',supportingSources:[{title:'Named local demonstration review record',locator:evidenceLocator,kind:'supporting',publicationDate:now.slice(0,10),retracted:false}],rights:'owned'}});
    evidence=state().evidences[0];
    save({type:'program-governance.evidence-request-review',requestId:id(),id:evidence.id,expectedVersion:evidence.version,reason});
    evidence=state().evidences.find(record=>record.id===evidence!.id)!;
    save({type:'program-governance.evidence-record-review',requestId:id(),id:evidence.id,expectedVersion:evidence.version,outcome:'approved',reviewer,reason});
    evidence=state().evidences.find(record=>record.id===evidence!.id)!;
  }
  if(evidence.status!=='approved'||evidence.rightsExpiry&&evidence.rightsExpiry<=now.slice(0,10)||state().recalls.some(recall=>recall.subject.kind==='evidence'&&recall.subject.id===evidence!.id))return data;
  let release=owned(state().releases,`${fixturePrefix} artifact`);
  if(!release){
    save({type:'program-governance.release-save-draft',requestId:id(),record:{title:`${fixturePrefix} artifact`,modelId:engineVersion,softwareId:engineVersion,configurationId,intendedUse:'Rule-based demonstration of attributed workspace record review and care coordination. No clinical eligibility or clearance is inferred.',evidenceRefIds:[evidence.id],modelClaims:['Demonstration only; no clinical-performance claim.'],evaluation:{agreementSummary:'Output ordering and source references can be inspected in the local demonstration.',performanceSummary:'Named local workflow review; no clinical performance evaluation asserted.',limitations:'External clinical validation, partner authorization, payer decisions, and production readiness are outside this local record.'},unresolvedConditions:[],overrideTrainingPolicy:'Named manual review of clinician overrides; no learning pipeline'}});
    release=state().releases[0];
    save({type:'program-governance.release-record-review',requestId:id(),id:release.id,expectedVersion:release.version,reviewer,decision:'approved',unresolvedConditions:[],reason});
    release=state().releases.find(record=>record.id===release!.id)!;
  }
  if(release.modelId!==engineVersion||release.configurationId!==configurationId||release.configurationVersion!==configurationVersion||release.decision!=='approved'||release.reviewRequired||state().recalls.some(recall=>recall.subject.kind==='release'&&recall.subject.id===release!.id))return data;
  if(owned(state().readiness,`${fixturePrefix} permitted scope`))return data;
  const mandatoryGates=[{id:'local-record-review',title:'Named local record review',required:true,disposition:'satisfied' as const,evidenceRef:evidenceLocator},{id:'demo-boundaries',title:'Demonstration boundaries recorded',required:true,disposition:'satisfied' as const,evidenceRef:`${evidenceLocator}/boundaries`}];
  save({type:'program-governance.readiness-save-draft',requestId:id(),record:{title:`${fixturePrefix} permitted scope`,functions:['Rule-based workspace record review demonstration'],claims:['Working local documentation and version-control demonstration only'],partnerAssets:['Locally generated demonstration records'],partnerRights:['No external partner rights asserted'],partnerResponsibilities:['Review actual service contracts before any external use'],evidenceRefIds:[evidence.id],blockingConditions:[],mandatoryGates,releaseRef:{releaseId:release.id,artifactVersion:release.artifactVersion},scope:{capabilities:[...configuration.capabilityChoices],populationRefs:['workspace-patient-records'],permittedRoles:['workspace-owner'],inputRefs:['attributed-workspace-patient-records'],outputRefs:['rule-based-record-review'],claimRefs:['local-demonstration-only'],environment:'demo'}}});
  const readiness=state().readiness[0];
  save({type:'program-governance.readiness-record-decision',requestId:id(),id:readiness.id,expectedVersion:readiness.version,reviewer,decision:'proposed',blockingConditions:[],mandatoryGates,reviewEvidence:evidenceLocator,reason});
  return data;
}
