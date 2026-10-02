import {twinOverview} from './engine-demo';
import {activeMedications} from './medications';
import {baseName,reportedKindLabels} from './patient-medication-report';
import {currentCheckins,latestReportedAnswers} from './patient-reported-answers';
import {pstConditionMatch,pstDrugs,pstIndications,pstLabelBasis,type PstDrug,type PstIndication} from './pst-drugs';
import type {Patient,Workspace} from './theranetrix';

export {pstIndications,pstLabelBasis,type PstIndication} from './pst-drugs';
export type PstPriorities={analgesia:number;abuse:number;cognitive:number;sedation:number};
/** FDA-label alignment of a row against the recorded condition. Opioid labeling and combinations get their own neutral status. */
export type PstLabelStatus='On-label'|'Off-label'|'Opioid labeling'|'Combination'|'Not assessed';
/** Recorded or patient-reported history matched to a row by active ingredient. Only a recorded reaction excludes the row; everything else is a flag.
 *  `onRecord` marks a medicine the patient reports taking that is also an active medication on the record. */
export type PstHistory={kind:'tried'|'effects-reported'|'reaction'|'cannot-take'|'reported-current'|'rule-flag';source:'record'|'patient-reported';name:string;text:string;date?:string;componentId?:string;onRecord?:true};
export type PstOption={
  id:string;name:string;kind:'drug'|'combination'|'non-drug';dose:string;
  label:PstLabelStatus;labelNote:string;labeledIndications:PstIndication[];labelBasis:typeof pstLabelBasis;labelComponents?:{id:string;name:string;label:PstLabelStatus}[];
  evidence:string;analgesia:number;abuse:number;cognitive:number;sedation:number;cui:number;
  why:string;excluded?:string;current?:boolean;componentIds?:string[];history:PstHistory[];
};
/** reportSources: the patient's current self-reports (selfReportSources). Without them PST reads the patient's check-ins only. */
export type PstFilters={kind?:'all'|'single'|'combination';excludedDrugIds?:string[];query?:string;requiredDrugIds?:string[];reportSources?:readonly {date:string;note?:string}[]};
export type ShadowSuggestion={id:string;name:string;kind:'agree'|'differ'|'extra';reason:string;data:string;evidence:string;optionId?:string};

/** What the scores can and cannot say. The model named here is planned; nothing on screen is its output. */
export const pstModelLimits={
  version:'PST model limits v1',
  items:{
    scores:'Scores shown are example values, not model output.',
    combinations:'The planned pharmacology model is calibrated on published single-drug data and does not support combination predictions. Combination scores here are example values, not validated predictions.',
    sideEffects:'The planned model’s side-effect estimates (abuse liability, cognitive effects, sedation) rest on weaker evidence than its pain-relief estimates.',
    demographics:'Age and sex are not model inputs. Weigh them, and any prior reactions, in your own review.',
    placebo:'Placebo response is not modeled.',
  },
} as const;
/** How recorded history reaches the rows. Only a recorded reaction excludes a row; everything else stays ranked for the clinician to weigh. */
export const pstHistoryNotice='Recorded history is matched to rows by active-ingredient name. Drug classes are not matched: a reaction recorded for one opioid does not flag the others. Patient-reported answers are shown as unverified flags and never exclude a row.';
/** One neutral statement for wherever label status is shown. */
export const pstLabelNotice='Label status is example data; verify against current FDA labeling. Off-label use is a prescribing decision for the clinician. Listing or ranking an option, on- or off-label, is not a claim that it is effective or suitable for this patient.';

/** The keyword preset that sets the starting priorities, and the rule that matched. It reads record wording only, never Digital Twin scores. */
export function pstPriorityPreset(p:Patient):{weights:PstPriorities;rule:string}{
  const blob=[p.clinicalContext?.psychologicalContext,p.clinicalContext?.medicalHistory,...p.medications.map(m=>m.effects+' '+m.name)].join(' ').toLowerCase();
  if(/groggy|grogginess|sedat/.test(blob))return {weights:{analgesia:25,abuse:15,cognitive:30,sedation:30},rule:'grogginess or sedation wording matched'};
  if(/diabet/.test(blob))return {weights:{analgesia:40,abuse:25,cognitive:20,sedation:15},rule:'diabetes wording matched'};
  return {weights:{analgesia:40,abuse:20,cognitive:20,sedation:20},rule:'no keyword matched, neutral preset'};
}
export function defaultPstPriorities(p:Patient):PstPriorities{return pstPriorityPreset(p).weights;}

export function pstScoreBreakdown(row:Pick<PstOption,keyof PstPriorities>,w:PstPriorities){
  const total=w.analgesia+w.abuse+w.cognitive+w.sedation||1;
  const components=([{key:'analgesia',label:'Pain relief'},{key:'abuse',label:'Lower abuse liability'},{key:'cognitive',label:'Less cognitive impairment'},{key:'sedation',label:'Less sedation'}] as const).map(({key,label})=>({key,label,score:row[key],utility:key==='analgesia'?row[key]:10-row[key],weight:w[key],points:(key==='analgesia'?row[key]:10-row[key])*w[key]/total*10}));
  return {components,totalWeight:w.analgesia+w.abuse+w.cognitive+w.sedation,cui:Math.round(components.reduce((sum,c)=>sum+c.points,0))};
}

/** Labeled indications that the recorded condition matches in the example label map. Negated wording (“non-diabetic”) never matches. */
export function pstConditionIndications(p:Patient):PstIndication[]{return pstConditionMatch(p.condition??'').matched;}
const indicationNames=(drug:PstDrug,ids:PstIndication[])=>ids.map(id=>pstIndications[id].name+(drug.labelScope?.[id]?' '+drug.labelScope[id]:'')).join('; ');
const opioidIndications:PstIndication[]=['opioid','opioidEr'];
function labelStatus(p:Patient,drug:PstDrug,conditions:PstIndication[]):{label:PstLabelStatus;labelNote:string}{
  const opioid=drug.labeledIndications.filter(id=>opioidIndications.includes(id)),others=drug.labeledIndications.filter(id=>!opioidIndications.includes(id));
  const matched=others.filter(id=>conditions.includes(id)),unclear=others.filter(id=>pstConditionMatch(p.condition??'').unclear.includes(id));
  const unclearNote=`The recorded condition (${p.condition}) has wording this example map cannot classify for ${unclear.map(id=>pstIndications[id].name).join('; ')}, such as negated, uncertain or loosely phrased wording.`;
  // Opioid rows keep their own neutral status; a condition-specific indication is named in the note, not shown as On-label.
  if(opioid.length)return {label:'Opioid labeling',labelNote:matched.length?`Opioid labeling that names the recorded condition: ${indicationNames(drug,matched)}. General opioid indication: ${indicationNames(drug,opioid)}.`
    :`Labeled for ${indicationNames(drug,opioid)}; not condition-specific.${others.length?` The label also names ${indicationNames(drug,others)}.${unclear.length?' '+unclearNote+' The clinician reviews that match.':''}`:''}`};
  if(!p.condition?.trim())return {label:'Not assessed',labelNote:'No condition is recorded, so label status is not assessed.'};
  if(matched.length)return {label:'On-label',labelNote:`Labeled for ${indicationNames(drug,matched)}.`};
  if(unclear.length)return {label:'Not assessed',labelNote:`${unclearNote} Label status is not assessed; the clinician reviews it. Labeled pain indications: ${indicationNames(drug,drug.labeledIndications)}.`};
  return {label:'Off-label',labelNote:`Not labeled for the recorded condition (${p.condition}) in this example map. ${drug.labeledIndications.length?`Labeled pain indications: ${indicationNames(drug,drug.labeledIndications)}.`:'No labeled pain indication in this example data.'}`};
}

const groggyMedications=(p:Patient)=>(p.medications??[]).filter(m=>/grogg(y|iness)/i.test(m.effects));
const medicationLabel=(m:Patient['medications'][number])=>`${m.name} (${m.status==='Stopped'?'stopped':'current'})`;
const sentence=(text:string)=>text.trim().replace(/\.+$/,'');
// Case-sensitive, as the original prototype rule was written.
const moodWords=(p:Patient)=>[...new Set(((p.clinicalContext?.medicalHistory??'')+' '+(p.clinicalContext?.psychologicalContext??'')).match(/depress\w*|constipat\w*|insomnia/g)??[])];
/** Rows the prototype library excludes for every patient, whatever the record says. */
export const pstLibraryExclusions:ReadonlySet<string>=new Set(['amitriptyline']);
/** The existing prototype profile rules, worded as the match they found. */
function profileRule(p:Patient,id:string):string|undefined{
  const mood=moodWords(p);
  const moodText=mood.length?`Rule match: ${mood.map(word=>`“${word}”`).join(', ')} in the recorded history.`:'';
  const rules=id==='duloxetine'?[moodText]:id==='nortriptyline'?[moodText]:pstLibraryExclusions.has(id)?['Prototype rule: excluded for every patient because of its high example sedation and cognitive scores. Not a patient-specific finding.']:[];
  return rules.filter(Boolean).join(' ')||undefined;
}

/** The grogginess keyword rule flags gabapentin and nortriptyline for clinician review. It no longer
 * excludes them: grogginess is often recorded with the patient's current gabapentin, and the
 * clinician decides whether to keep, adjust or exclude it. */
function groggyFlag(p:Patient,drug:PstDrug):PstHistory[]{
  if(drug.id!=='gabapentin'&&drug.id!=='nortriptyline')return [];
  // Grogginess recorded on this same drug already shows in its own history; flag only the other drug.
  const groggy=groggyMedications(p).filter(m=>baseName(m.name)!==baseName(drug.name));
  return groggy.length?[{kind:'rule-flag',source:'record',name:'Grogginess keyword rule',text:`Rule match: grogginess recorded with ${groggy.map(medicationLabel).join(', ')}. Flagged for review, not excluded.`}]:[];
}

/** The patient's own medicine answers, still unverified: each question's answer from the newest check-in that answered it,
 *  so a later check-in that answers only another question keeps an earlier cannot-take answer. Only the current version of an
 *  updated check-in is read, so an answer the patient removed is not shown. A medicine with no name and the "affecting your
 *  pain" answer never match a row. */
function reportedMedicines(p:Patient,sources?:readonly {date:string;note?:string}[]){
  return latestReportedAnswers(sources??currentCheckins({checkins:p.checkins??[],workflowObservations:p.workflowObservations})).filter(line=>line.kind!=='unidentified'&&line.question!=='affecting-pain').map(line=>({...line,date:line.date.slice(0,10)}));
}
function drugHistory(p:Patient,drug:PstDrug,reported:ReturnType<typeof reportedMedicines>):PstHistory[]{
  const key=baseName(drug.name),same=(name:string)=>baseName(name)===key,ctx=p.clinicalContext,onRecord=activeMedications(p).some(m=>same(m.name));
  const reactions=ctx?.allergyStatus==='Reactions reported'?(ctx.allergies??'').split(/[;\n]+/).map(text=>text.trim()).filter(text=>new RegExp(`\\b${key}\\b`,'i').test(text)):[];
  return [
    ...(p.medications??[]).filter(m=>m.status==='Stopped'&&same(m.name)).map(m=>({kind:'tried' as const,source:'record' as const,name:m.name,date:m.stopped||undefined,text:[m.stopReason?`Stop reason: ${m.stopReason}`:'No stop reason recorded.',m.effects?`Effects: ${m.effects}`:'',m.benefit!=='Not assessed'?`Benefit: ${m.benefit}.`:''].filter(Boolean).join(' ')})),
    ...activeMedications(p).filter(m=>m.tolerability==='Effects reported'&&same(m.name)).map(m=>({kind:'effects-reported' as const,source:'record' as const,name:m.name,date:m.reportedAt||undefined,text:m.effects||'Effects reported; detail not recorded.'})),
    ...reactions.map(text=>({kind:'reaction' as const,source:'record' as const,name:'Allergy record',date:ctx?.date?.slice(0,10)||undefined,text})),
    // Something the patient takes now is its own flag, never a past trial; the kind is the patient's own choice. When the
    // record already lists it as active, the flag says only that the patient also reports taking it.
    ...reported.filter(line=>same(line.name)).map(line=>({kind:line.question==='cannot-take'?'cannot-take' as const:line.question==='tried'?'tried' as const:'reported-current' as const,source:'patient-reported' as const,name:line.name,date:line.date,
      text:[...(line.kind!==line.question?[`Kind chosen by the patient: ${reportedKindLabels[line.kind]}`]:[]),...line.details.map(d=>`${d.label}: ${d.value}`)].join(' · ')||'No details given.',...(line.question==='taking-now'&&onRecord?{onRecord:true as const}:{})})),
  ];
}

function library(p:Patient,sources?:readonly {date:string;note?:string}[]):Omit<PstOption,'cui'>[]{
  const conditions=pstConditionIndications(p),reported=reportedMedicines(p,sources);
  const current=new Set(activeMedications(p).map(m=>baseName(m.name)));
  const drugs=pstDrugs.filter(drug=>drug.kind==='drug').map(drug=>{
    const history=[...drugHistory(p,drug,reported),...groggyFlag(p,drug)];
    const reaction=history.filter(h=>h.kind==='reaction').map(h=>`Rule match: the allergy record names ${baseName(drug.name)}: “${h.text}”`).join(' ');
    return {...drug,...labelStatus(p,drug,conditions),labelBasis:pstLabelBasis,history,current:current.has(baseName(drug.name))||undefined,excluded:[reaction,profileRule(p,drug.id)].filter(Boolean).join(' ')||undefined};
  });
  const combinations=pstDrugs.filter(row=>row.kind==='combination').map(row=>{
    const components=(row.componentIds??[]).flatMap(id=>drugs.filter(drug=>drug.id===id));
    return {...row,label:'Combination' as const,labelNote:`A combination is not a labeled regimen. Components: ${components.map(c=>`${c.name}, ${c.label}`).join('; ')}.`,labelComponents:components.map(c=>({id:c.id,name:c.name,label:c.label})),labelBasis:pstLabelBasis,history:components.flatMap(c=>c.history.map(h=>({...h,componentId:c.id})))};
  });
  return [...drugs,...combinations];
}

/** Human summary of one history flag, naming the matched record. */
export function pstHistorySummary(h:PstHistory):string{
  // A patient-reported date is when the check-in was sent, never a stop date.
  const reported=h.source==='patient-reported'?`${h.date?`, reported ${h.date}`:''} (patient-reported, not verified)`:'';
  if(h.kind==='reaction')return 'The allergy record names this drug';
  if(h.kind==='rule-flag')return 'Keyword rule flag';
  if(h.kind==='cannot-take')return `${h.name}: the patient reports they cannot take it${reported}`;
  if(h.kind==='reported-current')return h.onRecord?`${h.name}: the patient also reports taking it${reported}`:`${h.name}: the patient reports taking it now, not on the record${reported}`;
  if(h.kind==='effects-reported')return `${h.name}: effects reported on the current trial`;
  return `${h.name}: tried before${h.source==='record'&&h.date?`, stopped ${h.date}`:''}${reported}`;
}

export function rankPst(p:Patient,priorities:PstPriorities,onLabelOnly=false,filters:PstFilters={}){
  const source=library(p,filters.reportSources),query=filters.query?.trim().toLowerCase();
  const names=(row:Omit<PstOption,'cui'>)=>[row.name,...(row.componentIds??[]).map(id=>source.find(drug=>drug.id===id)?.name??id)];
  const rows=source.map(row=>{
    const components=source.filter(drug=>row.componentIds?.includes(drug.id)&&drug.excluded);
    const excluded=row.excluded||components.map(c=>`${c.name}: ${c.excluded}`).join(' ')||undefined;
    return {...row,excluded,cui:excluded?0:pstScoreBreakdown(row,priorities).cui};
  }).filter(row=>(!onLabelOnly||row.label==='On-label')&&(!filters.kind||filters.kind==='all'||(filters.kind==='single'?row.kind==='drug':row.kind==='combination'))&&!filters.excludedDrugIds?.some(id=>row.id===id||row.componentIds?.includes(id))
    &&(!query||names(row).some(name=>name.toLowerCase().includes(query)))&&(filters.requiredDrugIds??[]).every(id=>row.id===id||!!row.componentIds?.includes(id)));
  const ranked=[...rows].filter(r=>!r.excluded).sort((a,b)=>b.cui-a.cui||a.name.localeCompare(b.name));
  // The bottom three eligible rows under the current weights; rule exclusions are listed separately.
  const lowest=ranked.slice(-3);
  const avoided=[...rows].sort((a,b)=>(b.excluded?1:0)-(a.excluded?1:0)||a.cui-b.cui||a.name.localeCompare(b.name)).slice(0,3);
  const excluded=rows.filter(r=>r.excluded);
  return {ranked,lowest,avoided,excluded,all:rows,version:'PST-CUI v1.5',modelLimits:pstModelLimits};
}

export function shadowOpinion(p:Patient,w:Workspace,ranked:PstOption[]): {onPst:ShadowSuggestion[];extra:ShadowSuggestion[]}{
  const twin=twinOverview(p),effects=p.medications.filter(m=>m.tolerability==='Effects reported');
  const top=ranked.slice(0,3);
  const onPst=top.map((row,i)=>{
    const recorded=row.history.filter(h=>h.source==='record');
    const sedating=effects.length>0&&row.sedation>=6&&i===0;
    const differ=recorded.length>0||sedating;
    const reason=recorded.length?`${recorded.every(h=>h.kind==='rule-flag')?'A keyword rule flags this option':'Recorded history matches this option'}: ${recorded.map(h=>`${pstHistorySummary(h)}. ${h.text}`).join(' ')}`:sedating?`Effects are recorded with ${effects.map(m=>m.name).join(', ')}, and this option has a sedation score of ${row.sedation}/10.`:'No Shadow rule matched this option. Review its fit with the recorded patient context.';
    return {id:'shadow-'+row.id,name:row.name,kind:differ?'differ':'agree',optionId:row.id,reason,data:`Pain ${twin.scores.pain==null?'not recorded':`${twin.scores.pain}/10`} · ${twin.scores.location} · ${twin.cautions[0]?.title??'no recorded caution'}`,evidence:row.evidence+' · '+row.label} as ShadowSuggestion;
  });
  const extra:ShadowSuggestion[]=[
    {id:'pacing',name:'Work pacing and desk breaks',kind:'extra',reason:'Discuss pacing against the recorded activity needs and patient goal.',data:p.clinicalContext?.physicalContext||p.goal,evidence:'Care-plan education'},
    {id:'sleep',name:'Sleep-routine support',kind:'extra',reason:'Review reported sleep alongside benefit and burden of the current plan.',data:twin.scores.sleep==null?'Sleep not recorded':`Sleep ${twin.scores.sleep}/10`,evidence:'Behavioral sleep guidance'},
    {id:'pt',name:'Physical therapy / paced walking',kind:'extra',reason:'Non-drug option PST does not rank. Supports the recorded activity goal.',data:p.goal,evidence:'Rehab pathway'},
    {id:'psych',name:'Pain psychology review',kind:'extra',reason:'Mood and frustration are in the biopsychosocial panel; not a drug row.',data:p.clinicalContext?.psychologicalContext||'Mood not recorded',evidence:'Interdisciplinary branch'},
  ];
  if(/diabet/.test((p.condition+' '+(p.clinicalContext?.medicalHistory??'')).toLowerCase()))extra.push({id:'glucose',name:'Confirm glucose and renal labs',kind:'extra',reason:'Device and lab streams are missing from the twin; they gate dose changes.',data:'CGM not connected · EHR labs missing',evidence:'Metabolic caution'});
  return {onPst,extra};
}

export function twinFeed(p:Patient,priorities:PstPriorities,reportSources?:PstFilters['reportSources']){
  const twin=twinOverview(p),meds=activeMedications(p);
  const ranking=rankPst(p,priorities,false,{reportSources});
  const ctx=p.clinicalContext;
  return {
    pain:twin.scores.pain==null?'Not recorded':`${twin.scores.pain}/10`,
    function:twin.scores.function==null?'Not recorded':`${twin.scores.function}/10`,
    sleep:twin.scores.sleep==null?'Not recorded':`${twin.scores.sleep}/10`,
    mood:twin.scores.mood!=null?`${twin.scores.mood}/10`:'Not recorded',
    type:twin.iasp,
    location:twin.scores.location,
    duration:ctx?.painDuration||'Duration not recorded',
    allergies:ctx?.allergyStatus==='Reactions reported'?ctx.allergies:ctx?.allergyStatus==='None reported'?'None reported':'Not reviewed',
    current:meds.map(m=>({name:m.name,regimen:m.regimen,benefit:m.benefit,effects:m.tolerability==='Effects reported'?m.effects:''})),
    excluded:ranking.excluded.map(r=>({name:r.name,reason:r.excluded||''})),
    cautions:twin.cautions,
    comorbidities:twin.comorbidities,
    priorities,
    model:twin.model,
    alerts:twin.cautions.map(c=>c.title),
  };
}

/** Whether a row's exclusion comes from this patient's record (the allergy record or a keyword rule) or from a library rule that applies to every patient. */
export function pstExclusionScope(p:Patient,row:Pick<PstOption,'id'|'componentIds'|'history'|'excluded'>):'patient'|'library'|undefined{
  if(!row.excluded)return undefined;
  const ids=[row.id,...(row.componentIds??[])];
  return row.history.some(h=>h.kind==='reaction')||ids.some(id=>!pstLibraryExclusions.has(id)&&!!profileRule(p,id))?'patient':'library';
}

/** Explain the existing demonstration rules without treating them as clinical evidence. */
export function pstProfileRuleExplanation(p:Patient,row:PstOption):string[]{
  const rules:string[]=[];
  const groggy=groggyMedications(p),mood=moodWords(p);
  const history=[p.clinicalContext?.medicalHistory,p.clinicalContext?.psychologicalContext].filter(Boolean).join(' ');
  const covers=(id:string)=>row.id===id||!!row.componentIds?.includes(id);
  const reactions=row.history.filter(h=>h.kind==='reaction');
  const allergies=p.clinicalContext?.allergyStatus==='Reactions reported'?p.clinicalContext.allergies:'';
  if(reactions.length)rules.push(`The allergy record is marked Reactions reported and names a drug in this row: ${reactions.map(h=>`“${h.text}”`).join('; ')}. A recorded reaction locks the row. Matching uses drug names only; related drugs in the same class are not matched.`);
  if((covers('gabapentin')||covers('nortriptyline'))&&groggy.length)rules.push(`The existing rule matches “groggy” or “grogginess” in medication effects, including stopped trials: ${groggy.map(m=>`${medicationLabel(m)}: ${sentence(m.effects)}`).join('; ')}. On that match it flags gabapentin and nortriptyline when the grogginess was recorded with a different medication. Grogginess recorded on a drug itself shows as that drug’s own history flag. Neither is excluded. This is a prototype keyword rule, not a verified contraindication.`);
  if((covers('duloxetine')||covers('nortriptyline'))&&mood.length)rules.push(`The existing case-sensitive text rule matches ${mood.map(word=>`“${word}”`).join(', ')} in medical or psychological history: ${history}. On that match it excludes duloxetine and tricyclics. This is a prototype keyword rule, not a verified contraindication.`);
  if(pstLibraryExclusions.has(row.id))rules.push('This row is always excluded by the prototype library. No patient-specific condition is needed to trigger it.');
  if(row.kind==='combination'&&row.excluded)rules.push('The combination is excluded when either constituent drug is excluded.');
  if(!rules.length)rules.push('No exclusion rule is active for this row. Absence of an exclusion is not confirmation of suitability.');
  if(allergies&&!reactions.length)rules.push(`The allergy record lists reactions, but none names a drug in this row: “${sentence(allergies)}”. Drug classes are not matched.`);
  for(const h of row.history.filter(h=>h.kind!=='reaction'))rules.push(`History flag, not an exclusion: ${pstHistorySummary(h)}. ${h.text}`);
  return rules;
}
