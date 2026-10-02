import type {Medication} from './medications';
import type {Patient} from './theranetrix';
import {defaultPstPriorities,rankPst} from './pst-library';

export type MedicationCategory='analgesic'|'other'|'unclassified';

// Display grouping only. A drug's name cannot establish why this patient takes it.
export function medicationCategory(m:Pick<Medication,'indication'>):MedicationCategory{
  const indication=m.indication?.trim().toLowerCase()??'';
  if(!indication||/^(unknown|not (recorded|confirmed|assessed|known)|unconfirmed|unspecified|under review|none|pending|tbd|n\/a|other|neuropathy|peripheral neuropathy|diabetic neuropathy)$/.test(indication))return 'unclassified';
  if(/\b(?:no|not for|without)\s+(?:\w+\s+){0,2}(?:pain|neuralgia|migraine|headache)\b/.test(indication))return 'unclassified';
  return /\b(pain|painful|analgesia|analgesic|neuralgia|migraine|headaches?|fibromyalgia)\b/.test(indication)?'analgesic':'other';
}

export function medicationNameOptions(p:Patient):string[]{
  return Array.from(new Set([...p.medications.map(m=>m.name),...rankPst(p,defaultPstPriorities(p)).all.filter(row=>row.kind==='drug').map(row=>row.name)])).sort((a,b)=>a.localeCompare(b));
}
