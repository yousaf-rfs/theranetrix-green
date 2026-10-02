import {z} from 'zod';
import type {Workspace} from '../theranetrix';
import {applyWorkflowAction} from './index';
import {validateState as validateReferrals} from './results-referrals';
import {validateState as validateTreatment} from './treatment-continuity';
import {validateState as validateEncounters} from './encounters';

const id=z.string().trim().min(1).max(200);
const version=z.number().int().positive();
const text=z.string().trim().min(1).max(2000);
const sourceRefSchema=z.object({domain:z.enum(['results-referrals','treatment-continuity']),id,version}).strict();
export const linkedPlanPreparationSchema=z.object({patientId:id,source:sourceRefSchema,signoffId:id,signoffVersion:version,patientInstructions:text,rationale:text}).strict();
export type LinkedPlanPreparation=z.infer<typeof linkedPlanPreparationSchema>;
export type PlanSource={ref:z.infer<typeof sourceRefSchema>;title:string;summary:string};
const reconciledReferralStatuses=new Set(['plan-reconciled','communicated','transfer-pending','transferred','closed']);

/** List reviewed sources in this chart; a received document alone is not a plan. */
export function planSources(workspace:Workspace,patientId:string):PlanSource[]{
  if(!workspace.patients.some(patient=>patient.id===patientId))return [];
  const slices=workspace.clinicalWorkflows?.slices;
  if(!slices)return [];
  const referrals=validateReferrals(slices['results-referrals'].state);
  const treatment=validateTreatment(slices['treatment-continuity'].state);
  const sources:PlanSource[]=[];
  for(const row of referrals.referrals){
    if(row.patientId!==patientId||row.duplicateOfId||!reconciledReferralStatuses.has(row.status)||!row.specialistAdvice||!row.reviewSummary.trim()||!row.reconciliationPlan.trim()||!row.history.some(event=>event.to==='plan-reconciled'))continue;
    sources.push({ref:{domain:'results-referrals',id:row.id,version:row.version},title:`Referral · ${row.receivingService}`,summary:row.reconciliationPlan});
  }
  for(const row of treatment.transitions){
    if(row.patientId!==patientId||row.handoverStatus!=='completed'||!row.ownershipAccepted||!row.reconciledInstructions?.trim()||!row.patientCommunication?.trim())continue;
    sources.push({ref:{domain:'treatment-continuity',id:row.id,version:row.version},title:`Care transition · ${row.externalCareSource}`,summary:row.reconciledInstructions});
  }
  for(const row of treatment.multidisciplinary){
    const reviews=row.interventionReviews;
    if(row.patientId!==patientId||!reviews||reviews.length!==row.interventions.length||new Set(reviews.map(review=>review.interventionId)).size!==reviews.length)continue;
    if(!row.interventions.every(item=>reviews.some(review=>review.interventionId===item.id&&review.patientAgreement!=='not-discussed'&&(!review.conflictingAdvice?.trim()||!!review.reconciliation?.trim()))))continue;
    const summary=[`Patient goal: ${row.functionalGoal}`,...row.interventions.map(item=>{
      const review=reviews.find(entry=>entry.interventionId===item.id)!;
      return `${item.title} · ${item.professional}: ${item.decision}. ${review.rationale} Review: ${review.reviewCriterion}.${review.reconciliation?` Reconciliation: ${review.reconciliation}`:''} Patient agreement: ${review.patientAgreement}.`;
    })].join('\n');
    sources.push({ref:{domain:'treatment-continuity',id:row.id,version:row.version},title:'Multidisciplinary care review',summary});
  }
  return sources;
}

/** Create an attributed amendment draft through the normal workflow reducer. */
export function prepareLinkedPlan(workspace:Workspace,input:LinkedPlanPreparation,actor:string,now:string,requestId:string):Workspace{
  const action=linkedPlanPreparationSchema.parse(input);
  id.parse(requestId);
  if(!actor.trim()||!z.string().datetime({offset:true}).safeParse(now).success)throw new Error('Plan preparation requires the verified actor and server timestamp.');
  if(!workspace.patients.some(patient=>patient.id===action.patientId))throw new Error('Patient not found.');
  const slices=workspace.clinicalWorkflows?.slices;
  if(!slices)throw new Error('No signed encounter is available for plan preparation.');
  const source=planSources(workspace,action.patientId).find(row=>row.ref.domain===action.source.domain&&row.ref.id===action.source.id);
  if(!source)throw new Error('Select a reviewed and reconciled plan source from this patient record.');
  if(source.ref.version!==action.source.version)throw new Error('The plan source changed. Review its current version before preparing the plan.');
  const encounters=validateEncounters(slices.encounters.state);
  const signoff=encounters.signoffs.find(row=>row.id===action.signoffId&&row.patientId===action.patientId);
  if(!signoff||signoff.status!=='signed'||!signoff.signedSnapshot)throw new Error('Select a signed encounter from the same patient record.');
  if(signoff.version!==action.signoffVersion)throw new Error('The signed encounter changed. Reload its current version before preparing the plan.');
  // The target encounter is resolved from the saved signature, never asserted
  // by the browser. Earlier encounters may supply continuity information.
  const amendmentReason=`Prepared from reviewed source ${source.ref.domain}/${source.ref.id} at version ${source.ref.version}. Clinical review and a new signature are required before these instructions replace the current plan.`;
  return applyWorkflowAction(workspace,{
    type:'workflow.apply',domain:'encounters',patientId:action.patientId,requestId,expectedSliceVersion:slices.encounters.version,
    command:{type:'encounters.signoff.amend',patientId:action.patientId,encounterId:signoff.encounterId,requestId,id:signoff.id,expectedVersion:action.signoffVersion,amendmentReason,rationale:action.rationale,patientFacingPlan:action.patientInstructions},
  },actor,now);
}
