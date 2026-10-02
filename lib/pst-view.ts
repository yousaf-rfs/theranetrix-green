import {pstDrugs} from './pst-drugs';
import {pstHistorySummary,pstIndications,pstLabelBasis,pstPriorityPreset,pstScoreBreakdown,type PstHistory,type PstOption,type PstPriorities} from './pst-library';
import type {Patient} from './theranetrix';

// Display helpers for the PST table. They restate the record and the clinician's current
// comparison settings. None of them scores, ranks, endorses or excludes an option.

/** How many rows the table shows before "Show all". */
export const pstTopCount=10;

/** Rows shown by default: the first `limit`, every row tied with the last of them (a cut never splits a tie), and any row in `keep`: the Treatment screen keeps the rows the clinician picked or opened and the patient's current medications. */
export function pstTopRows<T extends {id:string;cui:number}>(ranked:T[],limit:number,keep:string[]=[]):{rows:T[];tied:number;kept:number}{
  if(ranked.length<=limit)return {rows:ranked,tied:0,kept:0};
  const cut=ranked[limit-1].cui,tied=ranked.slice(limit).filter(row=>row.cui===cut).length;
  const rows=ranked.filter((row,i)=>i<limit||row.cui===cut||keep.includes(row.id));
  return {rows,tied,kept:rows.length-limit-tied};
}

const day=(date?:string)=>{if(!date)return '';const value=new Date(date.length===10?date+'T12:00:00':date);return Number.isFinite(value.getTime())?value.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):date;};
const clean=(text:string)=>text.trim().replace(/\.+$/,'');

/** One history flag as a row badge. `detail` (hover and the Why this rank drawer) names the matched record, so a match on another form of the drug is visible; `note` is the shorter text a screen reader hears after the badge. */
export function pstHistoryBadge(h:PstHistory,p:Pick<Patient,'medications'>,component?:string):{text:string;detail:string;note:string;tone:'amber'|'rose'|'blue';locked:boolean}{
  const prefix=component?component+': ':'',detail=`${pstHistorySummary(h)}. ${h.text}`,record=`Matched record: ${h.name}.`;
  if(h.kind==='reaction')return {text:`${prefix}Reported reaction · ${clean(h.text)}`,detail:`Allergy record${h.date?` (clinical context dated ${h.date})`:''}: ${h.text}`,note:'From the allergy record.',tone:'rose',locked:true};
  if(h.source==='patient-reported')return {text:prefix+(h.kind==='cannot-take'?'Patient-reported: cannot take':h.kind==='reported-current'?'Patient-reported: taking now':'Patient-reported: tried before'),detail,note:detail,tone:'blue',locked:false};
  if(h.kind==='rule-flag')return {text:prefix+'Rule flag · grogginess recorded',detail,note:h.text,tone:'amber',locked:false};
  if(h.kind==='effects-reported')return {text:prefix+'Effects reported',detail,note:`${h.name}: ${h.text}`,tone:'amber',locked:false};
  const reason=(p.medications??[]).find(m=>m.status==='Stopped'&&m.name===h.name&&(m.stopped||undefined)===h.date)?.stopReason?.trim();
  return {text:`${prefix}Tried before · ${h.date?'stopped '+day(h.date):'stop date not recorded'} · ${reason?clean(reason):'no stop reason recorded'}`,detail,note:record,tone:'amber',locked:false};
}

/** Labeled pain indications for a single drug in the example label map, with any scope the label adds. */
export function pstLabeledIndicationNames(row:Pick<PstOption,'id'|'labeledIndications'>):string[]{
  const scope=pstDrugs.find(drug=>drug.id===row.id)?.labelScope;
  return row.labeledIndications.map(id=>pstIndications[id].name+(scope?.[id]?' '+scope[id]:''));
}

/** Announce only a change in the first-listed option, in neutral wording. */
export function pstReorderMessage(before:string[],after:Pick<PstOption,'id'|'name'>[]):string{
  const first=after[0];
  if(!first||before[0]===first.id)return '';
  const was=before.indexOf(first.id);
  return `Order updated: ${first.name} is now listed first with these priorities (${was<0?'not listed before':'was #'+(was+1)}).`;
}

const names=(list:string[])=>list.length<3?list.join(' and '):`${list.slice(0,-1).join(', ')} and ${list.at(-1)}`;
const others=(rows:{name:string}[])=>rows.length>2?`${rows.length} other options`:names(rows.map(row=>row.name));

/** Always says what a slider change did to the order: a new first-listed option (pstReorderMessage), how many options moved while the first stayed, or that the order is unchanged. */
export function pstReorderSummary(before:string[],after:Pick<PstOption,'id'|'name'|'cui'>[]):string{
  const first=after[0];
  if(!first)return '';
  const leader=pstReorderMessage(before,after);
  if(leader)return leader;
  const moved=after.filter((row,i)=>before[i]!==row.id).length,ties=after.slice(1).filter(row=>row.cui===first.cui);
  if(!moved)return 'Order unchanged.';
  return `${moved} option${moved===1?'':'s'} moved; ${first.name} still first${ties.length?` (tied with ${others(ties)} at ${first.cui} CUI)`:''}.`;
}

/** Rank labels for the table: rows tied on the rounded CUI share the rank of the first of them, marked "=" (=1, =1, 3). Order inside a tie is alphabetical. */
export function pstSharedRanks<T extends {cui:number}>(ranked:T[]):{rank:number;tied:boolean;label:string}[]{
  return ranked.map(row=>{const rank=ranked.findIndex(other=>other.cui===row.cui)+1,tied=ranked.filter(other=>other.cui===row.cui).length>1;return {rank,tied,label:(tied?'=':'')+rank};});
}

const burdenNames={abuse:'abuse liability',cognitive:'cognitive',sedation:'sedation'} as const;
/** The main weighted differences between two rows, read from `row`'s side: the largest, and any at least half as large. */
function mainDifference(row:Pick<PstOption,keyof PstPriorities|'cui'>,other:Pick<PstOption,keyof PstPriorities|'cui'>,weights:PstPriorities):string{
  const ahead=row.cui>=other.cui,theirs=pstScoreBreakdown(other,weights).components;
  const gaps=pstScoreBreakdown(row,weights).components.map((c,i)=>({key:c.key,gap:(c.points-theirs[i].points)*(ahead?1:-1)})).filter(g=>g.gap>=.05);
  const largest=Math.max(0,...gaps.map(g=>g.gap)),main=gaps.filter(g=>g.gap>=largest/2);
  const burdens=main.flatMap(g=>g.key==='analgesia'?[]:[burdenNames[g.key]]);
  return [...(main.some(g=>g.key==='analgesia')?[ahead?'more pain relief':'less pain relief']:[]),...(burdens.length?[`${ahead?'lower':'higher'} ${names(burdens)} burden`]:[])].join(' and ');
}
/** The plain sentence that opens Why this rank: the rows tied with this one, then the gap to the nearest row above it, or below it when nothing is above. Built from the same weighted components as Compared with the alternatives. */
export function pstRankLead(row:Pick<PstOption,'id'|'name'|'cui'|keyof PstPriorities>,ranked:Pick<PstOption,'id'|'name'|'cui'|keyof PstPriorities>[],weights:PstPriorities):string{
  const rest=ranked.filter(other=>other.id!==row.id);
  if(!rest.length)return `The only option that matches the current filters, at ${row.cui} CUI.`;
  const ties=rest.filter(other=>other.cui===row.cui),above=rest.filter(other=>other.cui>row.cui).at(-1),next=above??rest.find(other=>other.cui<row.cui);
  const gap=next&&Math.abs(row.cui-next.cui),why=next&&mainDifference(row,next,weights);
  return [
    ties.length?`Ties with ${others(ties)} at ${row.cui} CUI (order between them is alphabetical)`:above?'':`Listed first at ${row.cui} CUI`,
    next?`${gap} point${gap===1?'':'s'} ${above?'below':'above'} ${next.name}${why?', mainly '+why:''}`:'',
  ].filter(Boolean).join('; ')+'.';
}

/** Where the starting priorities came from: the keyword preset on the record, never Digital Twin output, and whether the clinician has changed them. */
export function pstStartingPrioritiesNote(p:Patient,weights:PstPriorities):string{
  const preset=pstPriorityPreset(p),changed=(Object.keys(weights) as (keyof PstPriorities)[]).some(key=>weights[key]!==preset.weights[key]);
  return `Starting priorities: keyword preset from the record (${preset.rule}), not Digital Twin output. Changed by you: ${changed?'yes':'no'}.`;
}

export type PstDecisionContext={option?:PstOption;weights:PstPriorities;preset:PstPriorities;kind:string;onLabel:boolean;query?:string;focus?:string;excluded:{name:string;flagged:boolean;reason?:string}[]};
/** The comparison lines appended to the charted rationale: label status, weights, filters, and the clinician's own exclusions with any reason given. */
export function pstDecisionNote({option,weights,preset,kind,onLabel,query,focus,excluded}:PstDecisionContext):string{
  if(!option)return '';
  const changed=(Object.keys(weights) as (keyof PstPriorities)[]).some(key=>weights[key]!==preset[key]);
  const manual=excluded.filter(item=>!item.flagged).map(item=>item.name),flagged=excluded.filter(item=>item.flagged);
  const label=option.labelComponents?.length?`${option.label} (not a labeled regimen; ${option.labelComponents.map(c=>c.name+': '+c.label).join(', ')})`:option.label;
  return [
    `Label status of chosen option: ${label} (${pstLabelBasis}).`,
    `Comparison weights${changed?' (changed from the starting priorities)':''}: analgesia ${weights.analgesia}, abuse ${weights.abuse}, cognitive ${weights.cognitive}, sedation ${weights.sedation}.`,
    `Comparison filters: ${kind}; on-label only ${onLabel?'yes':'no'}${query?.trim()?`; search “${query.trim()}”`:''}${focus?`; focus drug ${focus}`:''}; manually excluded ${manual.join(', ')||'none'}.`,
    ...(flagged.length?[`Excluded by the clinician after reviewing recorded history: ${flagged.map(item=>`${item.name} (${item.reason?.trim()?'reason: '+clean(item.reason):'no reason given'})`).join('; ')}.`]:[]),
  ].join('\n');
}
