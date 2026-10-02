import type {EngineDecisionDetails} from './engine-demo';
import type {PstOption} from './pst-library';

// Structured fields for a clinician's decision on one compared option. They restate what the
// clinician chose and what the record showed at that moment. None of them is an order, a dose
// suggestion or a verified label claim, and none carries a rank, score or evidence grade.

/** The one verb set for a decision: the Accept / Modify / Reject buttons, the saved action, the rationale prefix, the chart note and the visit PDF. */
export const engineDecisionVerbs={accept:'Accepted',modify:'Modified',reject:'Rejected'} as const;
/** A saved decision's heading: the clinician's verb and option when recorded; an older decision keeps its approach title. */
export function engineDecisionHeading(d:Pick<EngineDecisionDetails,'action'|'optionName'>&{title:string}){return d.action?`${engineDecisionVerbs[d.action]} ${d.optionName??d.title}`:d.title;}
/** Label status comes from an example label map, so it is stored and printed with this marker. */
export const prototypeLabelMarker='(prototype, clinician to verify)';
export function unmarkPrototypeLabel(text:string){const value=text.trim();return (value.endsWith(prototypeLabelMarker)?value.slice(0,-prototypeLabelMarker.length):value).trim();}
/** Adds the prototype marker exactly once. */
export function markPrototypeLabel(text:string){const value=unmarkPrototypeLabel(text);return value?`${value} ${prototypeLabelMarker}`:'';}

/** What TreatmentScreen sends with a decision: the chosen row as displayed, stopped medications from the record, and the clinician's own exclusions with any reason given. */
export function engineDecisionDetails({action,optionId,optionName,option,stopped,exclusions}:{action:NonNullable<EngineDecisionDetails['action']>;optionId:string;optionName:string;option?:Pick<PstOption,'dose'|'label'|'labelComponents'>;stopped:{name:string;stopReason?:string}[];exclusions:{name:string;reason?:string}[]}):EngineDecisionDetails{
  const label=option?.labelComponents?.length?`${option.label} (not a labeled regimen; ${option.labelComponents.map(c=>c.name+': '+c.label).join(', ')})`:option?.label;
  return {action,optionId,optionName,...(option?{modelledDose:option.dose}:{}),...(label?{labelStatus:markPrototypeLabel(label)}:{}),
    priorTrials:stopped.slice(0,50).map(m=>({name:m.name,stopReason:m.stopReason?.trim()??''})),
    clinicianExclusions:exclusions.slice(0,50).map(e=>({name:e.name,reason:e.reason?.trim()??''}))};
}

/** The clinician's reason is optional; an empty one prints as this. */
export const noReasonEntered='No reason entered';
export function decisionRationaleText(rationale?:string){return rationale?.trim()?rationale:noReasonEntered;}
/** Text of the saved 'Engine review' note. With an action it is headed by the clinician's verb and the option; without one it keeps the older approach heading. It always ends with "No prescription issued." */
export function engineDecisionNote(d:EngineDecisionDetails&{title:string;rationale:string;patientPlan:string},run:{id:string;version:string;revision:string}){
  return [
    d.action?`Clinician decision: ${engineDecisionHeading(d)}`:`Engine review: ${d.title}`,
    ...(d.labelStatus?[`Label status: ${unmarkPrototypeLabel(d.labelStatus)} (prototype label status, verify)`]:[]),
    ...(d.modelledDose?[`Example dose the comparison scores assume (not a dosing suggestion): ${d.modelledDose}`]:[]),
    `Clinician rationale: ${decisionRationaleText(d.rationale)}`,
    `Patient plan: ${d.patientPlan}`,
    ...(d.action&&d.optionName?[`Clinical approach linked to this run: ${d.title}`]:[]),
    `Run: ${run.id} · ${run.version} · record ${run.revision}. No prescription issued.`,
  ].join('\n');
}
