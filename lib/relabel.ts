import type {Workspace} from './theranetrix';
import {engineRecordRevision} from './engine-demo';
import {LEGACY_ADVISOR_NAME} from './product-names';

// Wording the app used to write into saved records. A workspace saved under the
// old wording keeps it forever, so it is rewritten on load.
const replacements:[string,string][]=[
  [' · synthetic showcase',''],
  [LEGACY_ADVISOR_NAME+' · scripted demo',LEGACY_ADVISOR_NAME],
  ['Synthetic engine review: ','Engine review: '],
  ['Synthetic case with no current pain medication.','No current pain medication.'],
  ['Synthetic treatment-selection case. ',''],
  ['Synthetic improving case. ',''],
  ['Ran synthetic Digital Twin','Ran Digital Twin'],
  [LEGACY_ADVISOR_NAME+' demo exchange',LEGACY_ADVISOR_NAME+' exchange'],
  ['against synthetic engine run ','against engine run '],
  ['Loaded synthetic feature demonstration records','Loaded program records'],
  ['connected-engine-demo-v1','connected-engine-v1'],
  ['This demo does not change your medication.','No medication is changed by this message.'],
  ['A favorable demo score does not clear','A favorable score does not clear'],
  ['The two demo rule sets ordered','The two rule sets ordered'],
  ['Synthetic example','Patient report'],
  [' This is a synthetic example record.',''],
  ['The five-stage sample pathway is an operational demonstration and is not the clinical protocol.','The five-stage pathway is the operational track and is not the clinical protocol.'],
  ['Evaluation build used to review a chronic-pain treatment workflow with synthetic records only.','Chronic-pain treatment workflow reviewed against records held in this workspace.'],
  ['Regulatory review owner','Dr. Maya Chen'],
  ['Stored synthetic trajectory; time not recorded','Outcome history; time not recorded'],
];
const rewrite=(text:string)=>replacements.reduce((value,[from,to])=>value.split(from).join(to),text);
function walk(value:unknown):unknown{
  if(typeof value==='string')return rewrite(value);
  if(Array.isArray(value))return value.map(walk);
  if(value&&typeof value==='object'){const record=value as Record<string,unknown>;for(const key of Object.keys(record))record[key]=walk(record[key]);return record;}
  return value;
}
// Rewriting record text changes the fingerprint a saved engine run was taken
// against, which would age every run in the workspace. Runs that matched the
// record before the rewrite are re-fingerprinted against the rewritten record;
// runs that were already historical stay historical.
export function relabelLegacyRecords(w:Workspace):Workspace{
  const json=JSON.stringify(w);
  if(!replacements.some(([from])=>json.includes(from)))return w;
  const before=new Map(w.patients.map(p=>[p.id,engineRecordRevision(p,w)]));
  walk(w);
  for(const p of w.patients){
    const was=before.get(p.id),now=engineRecordRevision(p,w);
    if(!was||was===now)continue;
    for(const run of w.engineRuns??[])if(run.patientId===p.id&&run.revision===was)run.revision=now;
  }
  return w;
}
