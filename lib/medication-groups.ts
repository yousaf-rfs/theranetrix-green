import type {Medication} from './medications';
import {medicationCategory,type MedicationCategory} from './medication-presentation';

// One label set wherever current medications are split by their recorded indication:
// the visit tab, the Complete synopsis, the care overview and the visit export.
export const medicationGroups:readonly {id:MedicationCategory;title:string;description:string;empty:string}[]=[
  {id:'analgesic',title:'Analgesic medications',description:'Recorded for pain or related symptoms.',empty:'No medications with a recorded pain indication.'},
  {id:'other',title:'Other medications',description:'Recorded for another reason.',empty:'No other medications classified from the recorded indications.'},
  {id:'unclassified',title:'Indication needs confirmation',description:'Verify the indication before grouping.',empty:'No unclassified medication entries.'},
];
export const medicationGroupingNote='Grouped by recorded indication. Confirm purpose and current use. Drug-interaction checking is not connected.';
export function groupMedications<T extends Pick<Medication,'indication'>>(medications:readonly T[]){
  return medicationGroups.map(group=>({...group,medications:medications.filter(m=>medicationCategory(m)===group.id)}));
}
