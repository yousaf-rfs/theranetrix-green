'use client';
import {Fragment,useEffect,useId,useMemo,useRef,useState,type FormEvent} from 'react';
import {AlertCircle,ArrowRight,ArrowUpRight,Brain,Check,ChevronDown,ChevronUp,Layers,RotateCcw,Search,Send,SlidersHorizontal,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Slider} from '@/components/ui/slider';
import {Textarea} from '@/components/ui/textarea';
import {selfReportSources} from '@/lib/patient-reported-answers';
import {defaultPstPriorities,pstExclusionScope,pstHistoryNotice,pstHistorySummary,pstLabelBasis,pstModelLimits,pstProfileRuleExplanation,pstScoreBreakdown,rankPst,shadowOpinion,twinFeed,type PstFilters,type PstOption,type PstPriorities} from '@/lib/pst-library';
import {pstDecisionNote,pstHistoryBadge,pstLabeledIndicationNames,pstRankLead,pstReorderSummary,pstSharedRanks,pstStartingPrioritiesNote,pstTopCount,pstTopRows} from '@/lib/pst-view';
import {twinOverview,type EngineDecisionDetails} from '@/lib/engine-demo';
import {engineDecisionDetails,engineDecisionVerbs} from '@/lib/engine-decision';
import {visitObservations} from '@/lib/visit-observations';
import {referralPromptRules,referralStartHref,referralSuggestion} from '@/lib/medications';
import {featureEnabled,type Patient} from '@/lib/theranetrix';
import type {Context} from './app';
import {AcronymHelp,Badge,Term} from './ui';
import {RecommendationDetails} from './recommendation-details';

const prototypeLimits=['These are transparent demonstration rules, not a validated recommendation model.','No external clinical citation, interaction clearance or individualized dose verification is attached. No confidence score is shown, by design.'];
// Label status is shown for every option; none of this wording ranks on-label above off-label.
const labelDecision='Listing or ranking an option, on- or off-label, is not a claim that it is effective or preferred. The prescribing decision is the clinician’s.';
const labelHelp=`FDA label status for the recorded condition, from an example label map (${pstLabelBasis}). On-label: the condition matches a labeled indication. Off-label: it does not. Opioid labeling: the general opioid indication (immediate-release or extended-release wording), which is not condition-specific; where the label also names the recorded condition, the note says so. Not assessed: no condition is recorded, or its wording is unclear to the example map. Combination: a pair is not a labeled regimen; Why this rank lists each component. On-label only leaves out opioid-labeled rows, even where the label names the recorded condition. ${labelDecision}`;
const labelTone=(label:PstOption['label'])=>label==='On-label'?'teal':label==='Off-label'?'blue':'neutral';
const scoreColumns=[{key:'analgesia',label:'Analgesia',hint:'↑ relief',sr:'higher means more pain relief'},{key:'abuse',label:'Abuse',hint:'↑ burden',sr:'higher means more burden'},{key:'cognitive',label:'Cognitive',hint:'↑ burden',sr:'higher means more burden'},{key:'sedation',label:'Sedation',hint:'↑ burden',sr:'higher means more burden'}] as const;
const HistoryBadge=({badge}:{badge:ReturnType<typeof pstHistoryBadge>})=><span className={'badge '+badge.tone+' pst-history-badge'} title={badge.detail}>{badge.text}<span className="sr-only">. {badge.note}</span></span>;
function treatmentSources(p:Patient){
  const latest=visitObservations(p).at(-1);
  return [
    {label:'Recorded condition',value:p.condition||'Not recorded',href:`/patients/${p.id}?tab=visit`},
    {label:'Patient goal',value:p.goal||'Not recorded',href:`/patients/${p.id}?tab=visit#patient-goal`},
    ...(p.clinicalContext?.preferences?[{label:'Recorded patient priorities',value:p.clinicalContext.preferences,date:p.clinicalContext.date}]:[]),
    {label:'Medical history',value:p.clinicalContext?.medicalHistory||'Not recorded',date:p.clinicalContext?.date},
    {label:'Psychological context',value:p.clinicalContext?.psychologicalContext||'Not recorded',date:p.clinicalContext?.date},
    {label:'Physical context',value:p.clinicalContext?.physicalContext||'Not recorded',date:p.clinicalContext?.date},
    ...(latest?[{label:'Latest observations',value:`Pain: ${latest.pain??'not answered'}; function: ${latest.function??'not answered'}; sleep: ${latest.sleep??'not answered'}. Source: ${latest.source}.`,date:latest.date,href:`/patients/${p.id}?tab=outcomes`}]:[]),
    ...p.medications.map(m=>({label:`${m.name} (${m.status})`,date:m.reportedAt,value:`${m.regimen}. Benefit: ${m.benefit}. Tolerability: ${m.tolerability}. ${m.effects||'No effects text recorded.'}${m.stopReason?' Stopping reason: '+m.stopReason:''}`,href:`/patients/${p.id}?tab=visit#patient-medications`}))
  ];
}
function cautionRule(title:string){
  if(title==='Profile caution')return 'The Twin rule matches mood wording plus sleep wording or a sleep score at most 5, together with constipation wording in the record. Its wording is a prototype rule output, not a verified contraindication. PST applies its own keyword rule to the history; any exclusion it makes is listed under Rule exclusions with the words it matched.';
  if(title==='Treatment-burden caution')return 'The Twin rule matches groggy or grogginess in any medication effects, including stopped medications, or grogginess or sedation wording in the patient context. It does not confirm current impairment. In PST, grogginess in medication effects shows as a flag on the matching rows; it does not exclude them.';
  if(title==='Metabolic context')return 'The Twin rule matches diabetes wording in the patient context or medication text. Its missing-stream statement is a prototype assumption; review available external records.';
  return 'This is the fallback completeness reminder when no other Twin caution rule matched. No keyword match does not establish a complete record.';
}

function nextReviewDate(existing:string){return existing||new Date(Date.now()+7*86400000).toISOString().slice(0,10);}

export function TwinStatusHeader({p,ctx,identity=true}:{p:Patient;ctx:Context;identity?:boolean}){
  const twin=twinOverview(p);
  const alerts=ctx.data.reviews.filter(r=>r.patientId===p.id&&r.status!=='Resolved').length;
  return <div className={'twin-status-header'+(identity?'':' is-metrics')}>
    {identity&&<div><strong>{p.name}</strong><span>{twin.iasp}</span></div>}
    <div className="twin-status-metrics">
      <span><small>Twin data</small><b>{twin.model}</b></span>
      <span><small>Pain</small><b>{twin.scores.pain??'Not recorded'}{twin.scores.pain!==null&&twin.scores.pain!==undefined?'/10':''}</b></span>
      <span className={alerts?'has-alerts':''}><small>Alerts</small><b>{alerts||'None'}</b></span>
    </div>
  </div>;
}

export function RankExplanation({row,rows,all=rows,weights,p}:{row:PstOption;rows:PstOption[];all?:PstOption[];weights:PstPriorities;p:Patient}){
  const breakdown=pstScoreBreakdown(row,weights);
  const alternatives=rows.filter(other=>other.id!==row.id).slice(0,2);
  const current=p.medications.filter(m=>m.status==='Active'&&(row.name.toLowerCase().includes(m.name.toLowerCase().split(' ')[0])||m.name.toLowerCase().includes(row.name.toLowerCase().split(' ')[0])||row.componentIds?.some(id=>m.name.toLowerCase().includes(id))));
  const components=(row.componentIds??[]).flatMap(id=>all.filter(drug=>drug.id===id)),indications=pstLabeledIndicationNames(row);
  return <div className="why-drawer-body pst-explanation">
    <div className="pst-explanation-title"><div><span className="pst-eyebrow">Ranking details</span><h3>{row.name}</h3></div><strong>{row.cui}<small> / 100 <Term t="CUI"/></small></strong></div>
    <p className="pst-explanation-lead">{pstRankLead(row,rows,weights)}</p>
    <div className="pst-explanation-grid">
      <section><h4>How the score adds up</h4><p>Higher relief and lower burden increase the score. Each priority is normalized by the total weight of {breakdown.totalWeight}.</p>
        <dl className="pst-score-breakdown">{breakdown.components.map(component=><div key={component.key}><dt>{component.label}<small>{component.key==='analgesia'?component.score:`(10 − ${component.score})`} × {component.weight}/{breakdown.totalWeight||1} × 10</small></dt><dd>+{component.points.toFixed(1)}</dd></div>)}</dl>
        <p className="pst-formula-note">Total is rounded to the nearest whole number. These are prototype utility scores, not probabilities of benefit.</p>
        <p className="pst-starting-note">{pstStartingPrioritiesNote(p,weights)}</p>
      </section>
      <section><h4>Compared with the alternatives</h4>{alternatives.length?alternatives.map(other=>{
        const delta=row.cui-other.cui;
        const otherBreakdown=pstScoreBreakdown(other,weights);
        const difference=breakdown.components.map((component,i)=>({...component,delta:component.points-otherBreakdown.components[i].points})).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta))[0];
        return <div className="pst-score-comparison" key={other.id}><div><strong>{other.name}</strong><span>{other.cui} <Term t="CUI"/></span></div><p>{delta===0?'Same rounded score. Alphabetical order breaks the tie.':`${Math.abs(delta)} points ${delta>0?'below':'above'} this option.`}{difference&&Math.abs(difference.delta)>=.05?` Largest weighted difference: ${difference.label.toLowerCase()} (${difference.delta>0?'+':''}${difference.delta.toFixed(1)} for ${row.name}).`:' The weighted components are equal.'}</p></div>;
      }):<p>No other option matches the current filters.</p>}
      </section>
      <section><h4>Patient inputs to review</h4><p><strong>Condition:</strong> {p.condition||'Not recorded'}</p><p><strong>Allergies:</strong> {p.clinicalContext?.allergyStatus==='Reactions reported'?p.clinicalContext.allergies:p.clinicalContext?.allergyStatus||'Not reviewed'}</p>
        {current.map(m=><p key={m.id}><strong>{m.name} · current:</strong> {m.benefit}. {m.effects||m.tolerability}</p>)}
        {row.history.length?row.history.map((h,i)=><p key={i}><strong>{pstHistorySummary(h)}.</strong> {h.text}</p>):<p>No recorded or patient-reported history matches this option.</p>}
        <p className="pst-formula-note">{pstHistoryNotice} {pstModelLimits.items.demographics} This prototype does not validate every allergy or drug interaction.</p>
      </section>
      <section><h4>FDA label</h4><p><Badge tone={labelTone(row.label)}>{row.label}</Badge> {row.labelNote}</p>
        {row.kind==='combination'?components.map(c=><p key={c.id}><strong>{c.name}: {c.label}.</strong> {c.labelNote}</p>):<p><strong>Labeled pain indications:</strong> {indications.join('; ')||'none in this example data'}.</p>}
        <p className="pst-formula-note">Label data: {pstLabelBasis}. {labelDecision}</p>
      </section>
      <section className="pst-explanation-wide"><h4>Source and practical considerations</h4><p>{row.why}</p>{row.id==='capsaicin'&&<p className="pst-practical-note"><strong>Walkthrough feedback:</strong> Ed raised severe burning as a practical drawback of the patch on September 18. Confirm with a sourced clinical reference.</p>}
        <p><strong>Prototype library:</strong> {row.id} · {row.label} · grade {row.evidence}. The label, dose and A/B/C grade are embedded example data. No source citation is attached.</p>{row.kind==='combination'&&<p>Combination row already in the library. {pstModelLimits.items.combinations} Its example grade does not validate the combination. Its components must remain included and free of the existing rule exclusions. This does not establish interaction safety or a line of therapy.</p>}
      </section>
    </div>
  </div>;
}

export function TreatmentScreen({p,ctx,onPriorities,canDecide,blockedReason,refreshNote,onRun,runLabel='Run engines',onDecide,dataGaps=[]}:{p:Patient;ctx:Context;onPriorities?:(w:PstPriorities)=>void;canDecide?:boolean;blockedReason?:string;refreshNote?:string;onRun?:()=>void;runLabel?:string;dataGaps?:string[];onDecide?:(optionId:string,title:string,rationale?:string,details?:EngineDecisionDetails)=>void}){
  const preset=useMemo(()=>defaultPstPriorities(p),[p]);
  const [weights,setWeights]=useState(preset);
  const [committed,setCommitted]=useState(preset);
  const [reorder,setReorder]=useState({text:'',firstId:''});
  const [onLabel,setOnLabel]=useState(false);
  const [kind,setKind]=useState<NonNullable<PstFilters['kind']>>('all');
  const [excludedDrugIds,setExcludedDrugIds]=useState<string[]>([]);
  const [historyReasons,setHistoryReasons]=useState<Record<string,string>>({});
  const [query,setQuery]=useState('');
  const [focusId,setFocusId]=useState('');
  const [showAll,setShowAll]=useState(false);
  const [drugControls,setDrugControls]=useState(false);
  const [explanation,setExplanation]=useState('');
  const uid=useId(),board=useRef<HTMLDivElement>(null);
  // A saved decision clears the choice and reason, and the bar confirms what was saved.
  const decisions=ctx.data.engineDecisions?.filter(d=>d.patientId===p.id)??[],savedCount=decisions.length;
  const [openedAt]=useState(()=>new Date().toISOString());
  const [pick,setPick]=useState({count:savedCount,id:''});
  const picked=pick.count===savedCount?pick.id:'';
  const setPicked=(id:string)=>setPick({count:savedCount,id});
  const [action,setAction]=useState<'accept'|'modify'|'reject'>('accept');
  const [draft,setDraft]=useState({count:savedCount,text:''});
  const reason=draft.count===savedCount?draft.text:'';
  const setReason=(text:string)=>setDraft({count:savedCount,text});
  const justSaved=!picked&&decisions[0]&&decisions[0].date>=openedAt?decisions[0]:undefined;
  const reportSources=selfReportSources(p,ctx.data.clinicalWorkflows?.slices.encounters.state.observations??[]);
  const filters:PstFilters={kind,excludedDrugIds,query,requiredDrugIds:focusId?[focusId]:[],reportSources};
  const change=(key:keyof PstPriorities,value:number)=>{const next={...weights,[key]:value};setWeights(next);onPriorities?.(next);};
  // Say what the change did to the order when a slider is released or a key step lands, not on every drag step.
  const commit=(next:PstPriorities)=>{const after=rankPst(p,next,onLabel,filters).ranked;setReorder({text:pstReorderSummary(rankPst(p,committed,onLabel,filters).ranked.map(row=>row.id),after),firstId:after[0]?.id??''});setCommitted(next);};
  const reset=()=>{setWeights(preset);onPriorities?.(preset);commit(preset);};
  const samePriorities=(Object.keys(preset) as (keyof PstPriorities)[]).every(key=>weights[key]===preset[key]);
  const ranking=rankPst(p,weights,onLabel,filters);
  const library=rankPst(p,weights,false,{reportSources});
  const shadow=shadowOpinion(p,ctx.data,ranking.ranked);
  const feed=twinFeed(p,weights,reportSources);
  const pstOn=featureEnabled(ctx.data,'pst'),shadowOn=featureEnabled(ctx.data,'shadow'),twinOn=featureEnabled(ctx.data,'digitalTwin');
  const differ=new Set(shadow.onPst.filter(s=>s.kind==='differ').map(s=>s.optionId));
  const chosen=pstOn?ranking.ranked.find(r=>r.id===picked):undefined;
  const extra=shadowOn?shadow.extra.find(r=>r.id===picked):undefined;
  const selectedName=chosen?.name??extra?.name;
  const totalWeight=Object.values(weights).reduce((sum,value)=>sum+value,0);
  const decisionAvailable=canDecide!==false&&(pstOn||shadowOn)&&(!!extra||totalWeight>0);
  const leaders=ranking.ranked.filter(row=>row.cui===ranking.ranked[0]?.cui),ranks=pstSharedRanks(ranking.ranked);
  const rankOf=(row:(typeof ranking.ranked)[number])=>ranks[ranking.ranked.indexOf(row)];
  const referral=referralSuggestion(p,featureEnabled(ctx.data,'assessments')?visitObservations(p):[]);
  // The first ten rows by default; a tie with row ten, the patient's current medications and the row you picked or opened stay in view.
  const top=pstTopRows(ranking.ranked,showAll?Infinity:pstTopCount,[picked,explanation,...ranking.ranked.filter(row=>row.current).map(row=>row.id)]);
  const pastTrials=p.medications.filter(m=>m.status==='Stopped');
  const preferences=p.clinicalContext?.preferences?.trim();
  const drugs=library.all.filter(row=>row.kind==='drug'),needle=query.trim().toLowerCase();
  const matches=(row:PstOption)=>!needle||row.name.toLowerCase().includes(needle);
  const flagged=drugs.filter(row=>row.history.length>0);
  const nameOf=(id?:string)=>id?library.all.find(row=>row.id===id)?.name??id:undefined;
  const setDrug=(id:string,exclude:boolean)=>setExcludedDrugIds(ids=>exclude?(ids.includes(id)?ids:[...ids,id]):ids.filter(value=>value!==id));
  function toggleDrug(id:string){setExcludedDrugIds(ids=>ids.includes(id)?ids.filter(value=>value!==id):[...ids,id]);}
  const resetFilters=()=>{setKind('all');setOnLabel(false);setExcludedDrugIds([]);setHistoryReasons({});setQuery('');setFocusId('');};
  const openExplanation=(id:string)=>{setExplanation(id);requestAnimationFrame(()=>{const target=document.getElementById('pst-why-'+id);target?.scrollIntoView({block:'center'});target?.focus({preventScroll:true});});};
  // The label note separates the clinician's consideration from any claim by the software; it never ranks on- over off-label.
  const labelNotice=chosen?.label==='Off-label'?`Off-label for the recorded condition in the example label map. ${labelDecision}`:chosen?.kind==='combination'?`A combination is not a labeled regimen (${chosen.labelComponents?.map(c=>c.name+': '+c.label).join(', ')}). ${labelDecision}`:'';
  // One verb set from the button to the saved action, rationale prefix, chart note and visit PDF.
  const verb=engineDecisionVerbs[action];
  const note=pstDecisionNote({option:chosen,weights,preset,kind,onLabel,query,focus:nameOf(focusId),excluded:excludedDrugIds.map(id=>({name:nameOf(id)??id,flagged:!!library.all.find(row=>row.id===id)?.history.length,reason:historyReasons[id]}))});
  const decisionText=selectedName?`${verb}: ${selectedName}${chosen?` (example dose: ${chosen.dose})`:''}.${reason.trim()?' '+reason.trim():''}${note?'\n'+note:''}`:'';
  const tooLong=decisionText.length>2000;
  // The table header sticks below whatever is already frozen at the top: the chart header on the patient record, otherwise the top bar.
  useEffect(()=>{
    const root=board.current,frozen=[...document.querySelectorAll<HTMLElement>('.redesign-shell .topbar,.patient-chart-header')];
    if(!root)return;
    const update=()=>root.style.setProperty('--pst-sticky-top',Math.max(0,...frozen.map(el=>{const style=getComputedStyle(el);return style.position==='sticky'?(parseFloat(style.top)||0)+el.offsetHeight:0;}))+'px');
    update();
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(update):undefined;
    frozen.forEach(el=>observer?.observe(el));window.addEventListener('resize',update);
    return ()=>{observer?.disconnect();window.removeEventListener('resize',update);};
  },[]);
  async function send(e:FormEvent){
    e.preventDefault();
    if(!selectedName||!decisionAvailable||ctx.busy||tooLong)return;
    // The choice also travels as fields, so the record keeps the action, option and history even if the rationale text is edited.
    if(onDecide){onDecide(picked,selectedName,decisionText,engineDecisionDetails({action,optionId:picked,optionName:selectedName,option:chosen,stopped:pastTrials,exclusions:excludedDrugIds.map(id=>({name:nameOf(id)??id,reason:historyReasons[id]}))}));return;}
    const followup=nextReviewDate(p.nextVisit);
    if(await ctx.save({type:'plan.save',patientId:p.id,text:decisionText,owner:p.clinician,followup,time:'09:00'},'Decision saved for the chart'))setReason('');
  }
  return <div ref={board} className="treatment-board treatment-restored treatment-feedback">
    <aside className="treatment-twin-feed">
      <header className="treatment-panel-heading"><span className="pst-eyebrow">Patient context</span><h2>Digital Twin feed</h2><p>Context for your review (not used in the score)</p></header>
      {!twinOn?<p>Digital Twin is off. Enable it and assessments in Workspace settings.</p>:<>
      <dl className="treatment-feed-measures">
        <div><dt>Pain severity</dt><dd>{feed.pain}</dd></div><div><dt>Function</dt><dd>{feed.function}</dd></div><div><dt>Sleep</dt><dd>{feed.sleep}</dd></div><div><dt>Mood estimate</dt><dd>{feed.mood}</dd></div>
      </dl>
      <div className="treatment-context-fact"><span>Pain profile</span><strong>{feed.type}</strong><p>{feed.location} · {feed.duration}</p></div>
      <div className="treatment-context-fact"><span>Patient goal</span><p>{p.goal||'No goal recorded'}</p></div>
      <div className="treatment-allergy"><span>Allergies / hypersensitivities</span><strong>{feed.allergies}</strong></div>
      <section className="treatment-context-section"><h3>Current treatment</h3>{feed.current.length?feed.current.map(m=><article key={m.name}><strong>{m.name}</strong><p>{m.regimen}</p><span>{m.benefit}</span>{m.effects&&<p className="treatment-recorded-effect"><AlertCircle size={13}/>{m.effects}</p>}</article>):<p>No active medication recorded.</p>}</section>
      {pastTrials.length>0&&<details className="treatment-context-history"><summary>Previous trials <span>{pastTrials.length}</span></summary>{pastTrials.map(m=><article key={m.id}><strong>{m.name}</strong><p>{m.stopReason||m.effects||m.benefit}</p></article>)}</details>}
      {feed.cautions.length>0&&<section className="treatment-context-section"><h3>Review before deciding</h3>{feed.cautions.map(c=><div key={c.title} className="twin-feed-caution"><strong>{c.title}</strong><p>{c.body}</p><RecommendationDetails title={c.title} label="Why this caution" rationale={[cautionRule(c.title)]} sources={treatmentSources(p)} limitations={prototypeLimits}/></div>)}</section>}
      {dataGaps.length>0&&<div className="treatment-data-gaps"><h3>Unresolved data gaps</h3><ul>{dataGaps.map(gap=><li key={gap}>{gap}</li>)}</ul></div>}
      <small className="treatment-model-note">Twin data: {feed.model}. No predictive model is connected.</small>
      </>}
    </aside>
    <section className="treatment-pst">
      <header className="treatment-pst-head"><div><span className="pst-eyebrow">Compare options</span><h2><Layers size={19}/> <Term t="PST"/></h2><p>Balance pain relief with treatment burden.</p></div><Badge>Prototype</Badge></header>
      <div className="pst-priority-heading"><h3>What matters for this patient?</h3><span className="pst-priority-actions"><button type="button" className="text-link" disabled={!pstOn||ctx.busy||samePriorities} onClick={reset}><RotateCcw size={13}/> Reset to starting priorities</button><RecommendationDetails title="Comparison priorities" label="Why these priorities" rationale={['Defaults first check for groggy, grogginess or sedation wording in medical history, psychological context or any medication name/effects. A match sets pain relief 25, abuse 15, cognition 30 and sedation 30.', 'Otherwise a diabetes wording match in those same fields sets 40, 25, 20 and 15. With no match, defaults are 40, 20, 20 and 20.', 'Your slider changes override these defaults for this comparison. The sum is normalized when calculating CUI. Reset to starting priorities restores these defaults.']} sources={treatmentSources(p)} considerations={[`Current weights: pain relief ${weights.analgesia}; abuse ${weights.abuse}; cognition ${weights.cognitive}; sedation ${weights.sedation}.`,...(preferences?[`Recorded patient priorities: ${preferences}`]:[])]} limitations={['These are prototype preference presets, not values confirmed with the patient.']}/></span></div>
      {preferences&&<p className="pst-patient-preferences"><span>Recorded patient priorities</span>{preferences}</p>}
      <div className="pst-sliders">{([{id:'analgesia',label:'Pain relief',aria:'Analgesia (Pain relief)'},{id:'abuse',label:'Avoid abuse liability',aria:'Abuse liability'},{id:'cognitive',label:'Preserve cognition',aria:'Cognitive impairment'},{id:'sedation',label:'Avoid sedation',aria:'Sedation'}] as const).map(x=><div key={x.id}><label>{x.label}<strong>{weights[x.id]}</strong></label><Slider disabled={!pstOn||ctx.busy} aria-label={x.aria} value={[weights[x.id]]} min={0} max={100} step={5} onValueChange={v=>change(x.id,Array.isArray(v)?v[0]:v)} onValueCommit={v=>commit({...weights,[x.id]:Array.isArray(v)?v[0]:v})}/></div>)}</div>
      <p className="pst-reorder-status" role="status">{pstOn&&reorder.firstId===ranking.ranked[0]?.id?reorder.text:''}</p>
      <div className="pst-filter-bar"><div className="pst-category-tabs" role="group" aria-label="Treatment category">{([{id:'all',label:'All options'},{id:'single',label:'Single drugs'},{id:'combination',label:'Combinations'}] as const).map(category=><button type="button" key={category.id} disabled={!pstOn||ctx.busy} aria-pressed={kind===category.id} onClick={()=>setKind(category.id)}>{category.label}</button>)}</div><label className="engine-check-label"><input type="checkbox" disabled={!pstOn||ctx.busy} checked={onLabel} onChange={e=>setOnLabel(e.target.checked)}/> On-label only</label></div>
      {onLabel&&<p className="pst-category-note">On-label only lists rows marked On-label in the example label map. Opioid-labeled rows are left out, even where the label names the recorded condition, and so are combinations.</p>}
      <div className="pst-find-bar"><label className="pst-find"><span>Find a drug</span><span className="pst-find-input"><Search size={14} aria-hidden="true"/><input type="search" disabled={!pstOn} value={query} maxLength={60} placeholder="Name or component" onChange={e=>setQuery(e.target.value)}/></span></label><label className="pst-focus"><span>Focus on a drug</span><select disabled={!pstOn||ctx.busy} value={focusId} onChange={e=>setFocusId(e.target.value)}><option value="">All options</option>{drugs.filter(row=>!row.excluded||row.id===focusId).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label></div>
      <div className="pst-filter-tools"><button type="button" className="text-link" disabled={!pstOn} aria-expanded={drugControls} aria-controls={'pst-drug-controls-'+p.id} onClick={()=>setDrugControls(value=>!value)}><SlidersHorizontal size={14}/> Include / exclude drugs{excludedDrugIds.length>0&&<span className="pst-filter-count">{excludedDrugIds.length} excluded</span>}{drugControls?<ChevronUp size={14}/>:<ChevronDown size={14}/>}</button><span>{ranking.ranked.length} available · {library.excluded.length} rule exclusion{library.excluded.length===1?'':'s'}{flagged.length>0&&` · ${flagged.length} with recorded history`}</span></div>
      {drugControls&&<div className="pst-drug-controls" id={'pst-drug-controls-'+p.id}><div><strong>Include drugs in this comparison</strong><button type="button" className="text-link" disabled={!excludedDrugIds.length} onClick={()=>{setExcludedDrugIds([]);setHistoryReasons({});}}>Reset choices</button></div><p>Unchecking a drug also removes combinations containing it. Rule exclusions stay locked.{needle&&` Showing drugs that match “${query.trim()}”.`}</p>
        {flagged.some(matches)&&<fieldset className="pst-history-group"><legend>From recorded history</legend><p>{pstHistoryNotice} One exception: the grogginess keyword rule flags gabapentin and nortriptyline when grogginess is recorded with a different medication. A flagged drug stays in the comparison unless you exclude it; this default is a provisional prototype rule. Your exclusion and any reason you give go into the chart rationale.</p>
          {flagged.filter(matches).map(row=>{const mine=excludedDrugIds.includes(row.id),reaction=row.history.some(h=>h.kind==='reaction');return <div key={row.id} className={'pst-history-item'+(row.excluded?' is-locked':'')}>
            <div className="pst-history-item-head"><strong>{row.name}</strong>{row.excluded?<span className="pst-lock-label">{reaction?'Locked · reported reaction':pstExclusionScope(p,row)==='patient'?'Locked · record rule':'Locked · library rule'}</span>:<span className="pst-history-choice" role="group" aria-label={'Keep or exclude '+row.name}><button type="button" aria-pressed={!mine} disabled={ctx.busy} onClick={()=>setDrug(row.id,false)}>Keep</button><button type="button" aria-pressed={mine} disabled={ctx.busy} onClick={()=>setDrug(row.id,true)}>Exclude</button></span>}</div>
            <span className="pst-option-tags">{row.history.map((h,i)=><HistoryBadge key={i} badge={pstHistoryBadge(h,p)}/>)}</span>
            {row.excluded&&<small>{row.excluded}</small>}
            {mine&&!row.excluded&&<label className="pst-history-reason">Reason for excluding {row.name} (optional)<input value={historyReasons[row.id]??''} maxLength={160} disabled={ctx.busy} onChange={e=>setHistoryReasons(value=>({...value,[row.id]:e.target.value}))}/></label>}
          </div>;})}
        </fieldset>}
        <div className="pst-drug-checklist" role="group" aria-label="All drugs">{drugs.filter(matches).map(row=><label key={row.id} className={row.excluded?'is-locked':''}><input type="checkbox" aria-label={'Include '+row.name} checked={!row.excluded&&!excludedDrugIds.includes(row.id)} disabled={!!row.excluded||ctx.busy} onChange={()=>toggleDrug(row.id)}/><span><strong>{row.name}</strong>{row.excluded&&<small>{row.excluded}</small>}</span>{row.excluded&&<span className="pst-lock-label">{row.history.some(h=>h.kind==='reaction')?'Reaction':pstExclusionScope(p,row)==='patient'?'Record rule':'Library rule'}</span>}</label>)}</div>
        {!drugs.some(matches)&&<p>No drug matches “{query.trim()}”.</p>}
      </div>}
      {kind==='combination'&&<p className="pst-category-note">Existing combination options only. {pstModelLimits.items.combinations} These categories do not assign first, second or third line treatment. Interaction review is still required.</p>}
      {focusId&&<p className="pst-category-note">Focused on {nameOf(focusId)}: the comparison shows it and the combinations that contain it. <button type="button" className="text-link" onClick={()=>setFocusId('')}>Clear focus</button></p>}
      {!pstOn?<p className="pst-empty">PST is off in workspace settings.</p>:<>
      {totalWeight===0?<p className="pst-ranking-state" role="status">All priorities are zero. Set at least one priority to create a meaningful numerical comparison.</p>:leaders.length>1&&<p className="pst-ranking-state" role="status"><strong>No numerical leader.</strong> {leaders.length} options tie at {leaders[0].cui} CUI with these priorities. A tied utility score does not establish equal clinical benefit.</p>}
      <div id="treatment-ranking" className="pst-table-wrap" role="region" aria-label="Medication comparison" tabIndex={0}><table className="pst-table"><caption className="sr-only">Medication comparison with example dose, example benefit and risk scores (not model output), CUI, label status and rationale. Analgesia: higher means more pain relief. Abuse, cognitive and sedation: higher means more burden. See Model limits below the table.</caption><thead><tr><th>#</th><th>Option</th><th title="The dose these example scores assume; not a dosing suggestion. Verify against current labeling.">Dose<small className="pst-col-hint">example</small></th>{scoreColumns.map(column=><th key={column.key} title={column.key==='analgesia'?'Higher means more pain relief. Example value, not model output.':'Higher means more burden. Example value, not model output. The planned model’s side-effect estimates rest on weaker evidence than its pain-relief estimates (see Model limits).'}>{column.label}<small className="pst-col-hint" aria-hidden="true">{column.hint}</small><span className="sr-only">, {column.sr}</span></th>)}<th><span className="pst-cui-heading"><Term t="CUI"/></span></th><th><span className="pst-cui-heading">Label<AcronymHelp term="Label status" definition={labelHelp}/></span></th><th><span className="pst-why-long">Rationale</span><span className="pst-why-short">Why</span></th></tr></thead><tbody>{top.rows.map(row=>{const rank=rankOf(row);return <Fragment key={row.id}><tr className={'pst-option-row '+(chosen?.id===row.id?'is-picked':'')+(differ.has(row.id)?' is-differ':'')} onClick={()=>setPicked(row.id)}><td><label className="pst-row-choice"><input type="radio" name={'treatment-option-'+p.id} checked={chosen?.id===row.id} onChange={()=>setPicked(row.id)} aria-label={'Review '+row.name}/><span title={rank.tied?`Tied at ${row.cui} CUI; order between tied options is alphabetical`:undefined}><span aria-hidden={rank.tied||undefined}>{rank.label}</span>{rank.tied&&<span className="sr-only">Rank {rank.rank}, tied</span>}</span></label></td><td><strong>{row.name}</strong><small className="pst-option-dose">Example dose: {row.dose}</small>{row.id==='capsaicin'&&<small className="pst-practical-inline">Burning raised in review</small>}<span className="pst-option-tags">{row.kind==='combination'&&<span className="badge neutral" title={pstModelLimits.items.combinations}>Combination not validated</span>}{row.current&&<Badge tone="teal">Current</Badge>}{differ.has(row.id)&&<Badge tone="amber">Shadow differs</Badge>}{row.history.map((h,i)=><HistoryBadge key={i} badge={pstHistoryBadge(h,p,nameOf(h.componentId))}/>)}</span></td><td>{row.dose}</td><td>{row.analgesia}</td><td>{row.abuse}</td><td>{row.cognitive}</td><td>{row.sedation}</td><td className="pst-cui-cell"><b>{row.cui}</b></td><td><Badge tone={labelTone(row.label)}>{row.label}</Badge></td><td><button type="button" className="text-link pst-rationale-trigger" aria-expanded={explanation===row.id} aria-controls={'pst-why-'+row.id} aria-label={explanation===row.id?'Hide reason':'Why this rank'} onClick={e=>{e.stopPropagation();setExplanation(value=>value===row.id?'':row.id);}}><span className="pst-why-long">{explanation===row.id?'Hide reason':'Why this rank'}</span><span className="pst-why-short">{explanation===row.id?'Hide':'Why?'}</span>{explanation===row.id?<ChevronUp size={12}/>:<ChevronDown size={12}/>}</button></td></tr>{explanation===row.id&&<tr className="pst-explanation-row"><td colSpan={10} id={'pst-why-'+row.id} tabIndex={-1}><RankExplanation row={row} rows={ranking.ranked} all={library.all} weights={weights} p={p}/></td></tr>}</Fragment>;})}</tbody></table></div>
      {ranking.ranked.length>pstTopCount&&<div className="pst-show-all"><span>{showAll?`Showing all ${ranking.ranked.length} options`:`Showing ${top.rows.length} of ${ranking.ranked.length}`}{!showAll&&top.tied>0&&` · options tied at ${ranking.ranked[pstTopCount-1].cui} CUI with #${pstTopCount} are included`}{!showAll&&top.kept>0&&' · current medications and the option you picked or opened stay in view'}</span><button type="button" className="text-link" aria-controls="treatment-ranking" aria-expanded={showAll} onClick={()=>setShowAll(value=>!value)}>{showAll?`Show top ${pstTopCount}`:`Show all ${ranking.ranked.length} options`}</button></div>}
      {!ranking.ranked.length&&<div className="pst-empty"><strong>No options match this comparison.</strong><p>{kind==='combination'&&library.all.some(row=>row.kind==='combination'&&row.excluded)?'Every combination left contains a drug excluded by a rule. See Rule exclusions below.':needle||focusId?'No eligible option matches this search or focus drug. Clear them, or try another category or filter.':'Try another category or adjust the inclusion and label filters.'}</p><button type="button" className="text-link" onClick={resetFilters}>Reset comparison filters <ArrowRight size={13}/></button></div>}
      {ranking.ranked.length>pstTopCount&&<section className="pst-lowest" aria-labelledby={uid+'-lowest'}><h3 id={uid+'-lowest'}>Lowest-ranked under current priorities</h3><p>The three eligible options with the lowest CUI for these weights. A low position is a numerical result, not a clinical judgment. Rule exclusions are listed separately.</p><ul>{ranking.lowest.map(row=><li key={row.id}><span>#{rankOf(row).label}</span><strong>{row.name}</strong><b>{row.cui} CUI</b><Badge tone={labelTone(row.label)}>{row.label}</Badge>{row.current&&<Badge tone="teal">Current</Badge>}{row.history.map((h,i)=><HistoryBadge key={i} badge={pstHistoryBadge(h,p,nameOf(h.componentId))}/>)}<button type="button" className="text-link" aria-label={'Why this rank: '+row.name} onClick={()=>openExplanation(row.id)}>Why this rank</button></li>)}</ul></section>}
      <div className="pst-table-foot"><span>Scores 0–10: higher analgesia, lower burden.</span><span>{ranking.version}</span></div>
      <section className="pst-model-limits" aria-labelledby={uid+'-limits'}><h3 id={uid+'-limits'}>Model limits</h3><ul>{Object.entries(ranking.modelLimits.items).map(([key,text])=><li key={key}>{text}</li>)}</ul><small>{ranking.modelLimits.version}</small></section>
      {library.excluded.length>0&&<details id="treatment-exclusions" className="pst-profile-exclusions"><summary>Rule exclusions <span>{library.excluded.length}</span></summary><p>Existing prototype rules. These rows cannot be selected or enabled with the filters.</p>{library.excluded.map(row=><div key={row.id}><strong>{row.name}</strong><p>{row.excluded}</p><RecommendationDetails title={'Exclusion: '+row.name} label="Why excluded" rationale={pstProfileRuleExplanation(p,row)} sources={treatmentSources(p)} considerations={['This row is locked by the current prototype rules and cannot be re-enabled with inclusion filters.']} limitations={prototypeLimits}/></div>)}</details>}
      <p className="pst-provenance-note">Prototype doses, label status and grades require source verification. Open a ranking for its inputs and calculation.</p>
      </>}
    </section>
    <aside id="treatment-shadow" className="treatment-shadow">
      <header className="treatment-panel-heading"><span className="pst-eyebrow">Rule-based check</span><h2><Brain size={19}/> <Term t="Shadow AI"/></h2><p>Separate from the PST score</p></header>
      {!shadowOn?<p>Shadow AI is off in workspace settings.</p>:<>
        <h3 className="shadow-section-label">On the top-listed options</h3>
        {shadow.onPst.length?shadow.onPst.map(s=><article key={s.id} className={'shadow-card '+s.kind}><strong className="shadow-opinion-status">{s.kind==='differ'?<AlertCircle size={13}/>:<Check size={13}/>} {s.kind==='differ'?'Rule difference':'No rule difference'}</strong><b>{s.name}</b><p>{s.reason}</p><RecommendationDetails title={'Shadow view: '+s.name} label="Why this is shown" summary={s.reason} rationale={[s.kind==='differ'?'The existing rule found recorded history for this option (a stopped trial, reported effects or a grogginess keyword rule flag), or a recorded medication with Effects reported and a first-listed option with sedation score at least 6.':'The existing difference triggers did not match this row. “No rule difference” is the default rule outcome, not independent clinical confirmation.',`Shadow examines the first three options in the current filtered PST ranking. ${s.name} has sedation score ${ranking.ranked.find(row=>row.id===s.optionId)?.sedation??'not available'}/10.`]} sources={[...treatmentSources(p),{label:'Prototype row metadata',value:`${s.evidence}. These labels are not sourced or calibrated.`}]} alternatives={ranking.ranked.filter(row=>row.id!==s.optionId).slice(0,2).map(row=>`${row.name}: ${row.cui} CUI; sedation ${row.sedation}/10. Open Why this rank for the full weighted comparison.`)} limitations={prototypeLimits}/></article>):<p>No ranked option matches these filters.</p>}
        {referral&&<><h3 className="shadow-section-label">{referral.title}</h3><article className="shadow-card shadow-referral"><p>{referral.reason}</p><RecommendationDetails title={referral.title+' · '+p.name} label="Why this referral prompt" rationale={[referral.reason,'Each matched rule and the dated record behind it is listed under the sources.']} sources={referral.basis} considerations={['Confirm these reports with the patient, and decide with them whether a referral fits their goals and preferences.']} limitations={[referralPromptRules.status,'The thresholds are placeholder demo settings, not validated criteria. A matched rule does not establish that a referral is indicated.']}/><span className="shadow-option-actions shadow-referral-links">{referral.services?.map(service=><a key={service} className="text-link" href={referralStartHref(p.id,service,referral)}>Start referral: {service} <ArrowUpRight size={13}/></a>)}</span></article></>}
        <h3 className="shadow-section-label">Additional care options</h3>
        {shadow.extra.map(s=><article key={s.id} className={'shadow-card extra'+(extra?.id===s.id?' is-picked':'')}><b>{s.name}</b><p>{s.reason}</p><RecommendationDetails title={s.name} label="Why this is shown" summary={s.reason} rationale={[s.id==='glucose'?'This additional option appears when the condition or medical history contains diabetes wording. The prototype does not inspect laboratory results or device connectivity.':'This is a standard additional option shown for every patient. It has not been selected by a patient-specific benefit model.', 'The patient context below supports a discussion; it does not establish that this option is appropriate or has previously worked.']} sources={[{label:'Context used by this suggestion',value:s.data||'Not recorded'},...treatmentSources(p),{label:'Prototype category',value:`${s.evidence}. This is not a sourced evidence grade.`}]} considerations={['Check prior use, patient preference, access and suitability before adding this to the plan.']} alternatives={['These additional care options have no PST score and are not ranked against drug choices.','You may review the existing plan or choose another option without accepting this suggestion.']} limitations={prototypeLimits}/><span className="shadow-option-actions"><button type="button" className="text-link" aria-pressed={extra?.id===s.id} onClick={()=>setPicked(s.id)}>{extra?.id===s.id?<Check size={13}/>:<ArrowRight size={13}/>} Add to comparison</button></span></article>)}
        <p className="shadow-prototype-note">Rule-based prototype output. These rule labels have not been clinically validated.</p>
      </>}
    </aside>
    <form id="treatment-decision" className="treatment-decision" onSubmit={send}>
      <div className="treatment-selected-option"><small>{selectedName?'Your decision on':'Your decision'}</small><strong>{selectedName||'No option picked yet'}</strong><span>{chosen?'Example dose: '+chosen.dose:(extra?'Shadow AI care option · not ranked by PST':'Tick a row in the PST table, or “Add to comparison” under Shadow AI.')}</span></div>
      <div className="treatment-decision-actions" role="group" aria-label="Decision type">{(['accept','modify','reject'] as const).map(v=><button type="button" key={v} aria-pressed={action===v} className={action===v?'selected':''} onClick={()=>setAction(v)}>{v==='accept'?<Check size={14}/>:v==='reject'?<X size={14}/>:<AlertCircle size={14}/>}{v[0].toUpperCase()+v.slice(1)}</button>)}</div>
      <label className="treatment-reason">Reason (optional)<Textarea rows={2} maxLength={1700} value={reason} onChange={e=>setReason(e.target.value)} placeholder={selectedName?`Why ${action==='accept'?'accept':action==='modify'?'modify':'reject'} ${selectedName}? Optional; it goes in the chart.${labelNotice?'\nOff-label evidence considered (optional): ':''}`:'Your reason goes here once you pick an option.'}/></label>
      <Button type="submit" disabled={ctx.busy||!selectedName||!decisionAvailable||tooLong}><Send size={15}/>{onDecide?'Continue to patient plan':'Save to chart'}</Button>
      {labelNotice&&<p className="treatment-label-note">{labelNotice}</p>}
      {tooLong&&<p className="treatment-decision-state" role="status">The chart entry is {decisionText.length} characters, over the 2,000 limit. Shorten your reason or the exclusion reasons.</p>}
      {justSaved&&<p className="treatment-decision-saved" role="status"><Check size={15}/>Decision saved: {justSaved.rationale.split('\n')[0].split('. ')[0]}. The patient plan and follow-up are updated.</p>}{canDecide===false&&<div className="treatment-decision-state" role="status"><p>{blockedReason||'Run the engines to save a snapshot of this comparison, then record your decision against it.'}</p>{onRun&&<Button type="button" size="sm" variant="outline" onClick={onRun} disabled={ctx.busy}>{ctx.busy?'Saving…':runLabel}</Button>}</div>}<small className="treatment-decision-note">{onDecide?(refreshNote?refreshNote+' Your decision is saved only after you check the patient plan and follow-up. No medication is ordered.':'Next you’ll check the patient plan and follow-up. Nothing is saved until then, and no medication is ordered.'):'This records your decision; it does not place a medication order.'}</small>
    </form>
  </div>;
}
