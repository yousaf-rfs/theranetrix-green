import {featureDefinitions,featureEnabled,type FeatureKey,type Workspace} from './theranetrix';
import {requireGovernedUse} from './clinical-flows/governance-runtime';

export type FeatureAvailability={
  enabled:boolean;
  usable:boolean;
  status:'disabled'|'dependency-blocked'|'governance-blocked'|'available';
  reason:string;
  reviewHref?:string;
};

/** Current saved availability. Draft switches do not change the running workspace. */
export function featureAvailability(workspace:Workspace,feature:FeatureKey,now:string):FeatureAvailability{
  const definition=featureDefinitions.find(item=>item.id===feature)!;
  const enabled=workspace.features[feature];
  if(!enabled)return {enabled,usable:false,status:'disabled',reason:'Disabled in the saved workspace configuration.'};
  if(!featureEnabled(workspace,feature)){
    const dependency=featureDefinitions.find(item=>item.id===definition.dependency);
    return {enabled,usable:false,status:'dependency-blocked',reason:`Requires ${dependency?.name??'its parent feature'} and its dependencies to be enabled.`};
  }
  // All enabled comparison engines share the artifact selected for the Digital Twin run.
  // Other record workflows are currently governed by their feature and dependency flags.
  if(['digitalTwin','pst','shadow'].includes(feature)){
    try{
      const releaseRef=requireGovernedUse(workspace,'digitalTwin',now);
      for(const capability of ['pst','shadow'] as const){
        if(featureEnabled(workspace,capability))requireGovernedUse(workspace,capability,now,releaseRef);
      }
    }catch(cause){
      return {enabled,usable:false,status:'governance-blocked',reason:cause instanceof Error?cause.message:'Current release and readiness reviews are required.',reviewHref:'/settings?workflow=program-governance'};
    }
    return {enabled,usable:true,status:'available',reason:'New engine runs are available under the current saved configuration and governance checks.'};
  }
  return {enabled,usable:true,status:'available',reason:'Available under the saved feature and dependency settings.'};
}
