import {z} from 'zod';
import type {Patient} from './theranetrix';

export const twinMeasures=['pain','function','sleep'] as const;
export const twinPreferencesSchema=z.object({
  measures:z.array(z.enum(twinMeasures)).min(1,'Choose at least one measure.').max(3).refine(v=>new Set(v).size===v.length,'Choose each measure only once.'),
  primary:z.enum(twinMeasures),
  showGoal:z.boolean(),showMedications:z.boolean(),showPlan:z.boolean(),
  explanation:z.string().trim().max(1200),
}).strict().refine(v=>v.measures.includes(v.primary),'The starting chart must be a visible measure.');
export type TwinPreferences=z.infer<typeof twinPreferencesSchema>;
export type TwinPreferencesRevision=TwinPreferences&{id:string;date:string;author:string};
export type SavedTwinPreferences=TwinPreferencesRevision&{history?:TwinPreferencesRevision[]};
export function defaultTwinPreferences():TwinPreferences{return {measures:[...twinMeasures],primary:'pain',showGoal:true,showMedications:true,showPlan:true,explanation:''};}
export function patientTwinPreferences(p:Patient):TwinPreferences {
  const saved=p.twinPreferences;
  if(!saved)return defaultTwinPreferences();
  return {measures:[...saved.measures],primary:saved.primary,showGoal:saved.showGoal,showMedications:saved.showMedications,showPlan:saved.showPlan,explanation:saved.explanation};
}
