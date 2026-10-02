import type {Review,Task} from './theranetrix';

export function retainReviewTransition(r:Review,status:'Acknowledged'|'Resolved',resolution:string,actor:string,date:string){
  const history=r.history??[];
  if(!history.length&&r.resolution)history.push({status:r.status,resolution:r.resolution,actor:r.updatedBy??'Earlier author not recorded',date:r.updatedAt??''});
  r.history=[{status,resolution,actor,date},...history];r.status=status;r.resolution=resolution;r.updatedAt=date;r.updatedBy=actor;
}
export function retainTaskState(t:Task,actor:string,date:string,reason:string,planId?:string){
  const {history,...state}=t;
  t.history=[{...state,planId:state.planId??planId,changedAt:date,changedBy:actor,reason},...(history??[])];
}
