import {buildEngineOutput,engineRecordRevision,twinOverview} from './engine-demo';
import {getSourceComparison} from './clinical-flows/encounters';
import {activeMedications} from './medications';
import {defaultPstPriorities,pstExclusionScope,pstLabelBasis,rankPst,shadowOpinion} from './pst-library';
import {featureEnabled,type Patient,type Workspace} from './theranetrix';
import {visitMetrics,visitObservations,type VisitObservation} from './visit-observations';
import {changesSincePriorReport,recordChangesSince} from './visit-presentation';
import {glossary,type GlossaryTerm} from './glossary';
import {guideSegments} from './guide-content';
import {selfReportSources} from './patient-reported-answers';

// Page-aware prompts for the clinician advisor. Each answer is read from the
// saved record at the moment it is shown and points at the exact section that
// holds the source, so the clinician can verify it there.
export type AdvisorPage='visit'|'treatment'|'twin'|'messages'|'notes';
/** Record tabs a Show me link can open: the five pages plus two More views, which open at the top of the view. */
export type AdvisorTab=AdvisorPage|'trace'|'evidence';
export type AdvisorTarget={tab:AdvisorTab;anchor?:string;label:string};
export type AdvisorSuggestion={id:string;question:string;answer:string;points:string[];target:AdvisorTarget;more?:AdvisorTarget};

export const advisorPageLabels:Record<AdvisorPage,string>={visit:'This visit',treatment:'Treatment',twin:'Digital Twin',messages:'Messages',notes:'Notes'};
export function advisorPage(tab:string):AdvisorPage{return tab==='treatment'||tab==='twin'||tab==='messages'||tab==='notes'?tab:'visit';}

const shortDate=(value:string)=>{const date=new Date(value.length===10?value+'T12:00:00':value);return Number.isFinite(date.getTime())?date.toLocaleDateString('en-US',{month:'short',day:'numeric'}):value;};
const metricNames={pain:'Pain',function:'Function',sleep:'Sleep'} as const;
const firstName=(p:Patient)=>p.name.split(' ')[0];
const clip=(text:string,length=140)=>text.length>length?text.slice(0,length-1).trimEnd()+'…':text;
/** Whole sentences up to `length`, so a quote never drops a qualifier from the middle of a sentence. A first sentence longer than that is clipped. */
const clipSentences=(text:string,length=140)=>{
  if(text.length<=length)return text;
  const sentences=text.match(/[^.!?]+[.!?]+(\s+|$)/g)??[text];
  let kept='';for(const sentence of sentences){if((kept+sentence).trimEnd().length>length)break;kept+=sentence;}
  return kept.trim()||clip(text,length);
};
const plural=(count:number,word:string)=>`${count} ${word}${count===1?'':'s'}`;
// Date-only values compare by day; two timestamps compare by time.
const isAfter=(value:string,anchor:string)=>value.length===10||anchor.length===10?value.slice(0,10)>anchor.slice(0,10):Date.parse(value)>Date.parse(anchor);

type Scores=Pick<VisitObservation,'pain'|'function'|'sleep'>;
function compare(latest:Scores,earlier:Scores){
  return visitMetrics.map(key=>{
    const now=latest[key],before=earlier[key];
    if(now===null)return `${metricNames[key]} not answered`;
    if(before===null)return `${metricNames[key]} ${now}/10`;
    if(now===before)return `${metricNames[key]} ${now}/10, unchanged`;
    const better=key==='pain'?now<before:now>before;
    return `${metricNames[key]} ${before} → ${now}/10 (${better?'better':'worse'})`;
  });
}
// Keep the record's caveat next to any better/worse line: a reported change is not evidence of drug effect.
const withCaveat=(lines:string[])=>lines.some(line=>/\((better|worse)\)$/.test(line))?[...lines,'Score changes are patient reports. They do not show that a medication caused them.']:lines;

/** The latest signed encounter that kept the sources reviewed at signing, read through the encounter source comparison. */
function lastSignedVisit(p:Patient,w:Workspace){
  const state=w.clinicalWorkflows?.slices.encounters.state;
  if(!state)return undefined;
  const reviewed=getSourceComparison({...state,preparations:[],episodes:[],signoffs:state.signoffs.filter(record=>record.status==='signed')},p.id).lastReviewed;
  if(!reviewed)return undefined;
  const value=(metric:'pain'|'function'|'sleep')=>[...reviewed.observations].filter(row=>row.metric===metric).sort((a,b)=>Date.parse(b.recordedAt)-Date.parse(a.recordedAt)||b.version-a.version)[0]?.value??null;
  return {date:reviewed.capturedAt,scores:{pain:value('pain'),function:value('function'),sleep:value('sleep')}};
}
/** Outcome scores since the last signed visit, compared with the scores reviewed there: the lines "What changed since the
 *  last visit" gives, for the visit rail to show beside its report-to-report comparison. Null without a signed visit. */
export function sinceSignedVisit(p:Patient,w:Workspace){
  const visit=lastSignedVisit(p,w);if(!visit)return null;
  const since=(featureEnabled(w,'assessments')?visitObservations(p):[]).filter(o=>isAfter(o.date,visit.date)),current=since.at(-1);
  return {date:visit.date,reports:since.length,latest:current?.date??null,points:current?withCaveat(compare(current,visit.scores)):[]};
}

// Everything recorded after the comparison point besides outcome scores: medication, context and
// plan entries (the same rules as the visit rail), open reviews raised and patient messages received.
function otherChanges(p:Patient,w:Workspace,since:string,items=recordChangesSince(p,since)){
  const reviews=w.reviews.filter(r=>r.patientId===p.id&&r.status!=='Resolved'&&isAfter(r.created,since));
  const inbound=w.messages.filter(m=>m.patientId===p.id&&m.direction==='in'&&isAfter(m.date,since)).sort((a,b)=>a.date.localeCompare(b.date));
  return [...items.map(item=>`${item.label}: ${item.detail}`),
    ...(reviews.length?[`${plural(reviews.length,'new open review')}: ${clip(reviews.map(r=>r.title).join('; '),120)}`]:[]),
    ...(inbound.length?[`${plural(inbound.length,'new message')} from ${firstName(p)}, latest ${shortDate(inbound.at(-1)!.date)}`]:[])];
}

function trajectory(p:Patient,w:Workspace):AdvisorSuggestion{
  const assessments=featureEnabled(w,'assessments'),points=assessments?visitObservations(p):[],latest=points.at(-1),previous=points.at(-2),first=points[0];
  const target={tab:'visit',anchor:'visit-observations',label:'Patient trajectory'} as const;
  const traced=!!w.engineRuns?.some(r=>r.patientId===p.id)||!!w.clinicalWorkflows?.slices.decisions.state.signedSnapshots.some(s=>s.patientId===p.id);
  const more:AdvisorTarget=traced?{tab:'trace',label:'Review sources & decision trace'}:{tab:'evidence',label:'Review sources & evidence readiness'};
  // Say "visit" only when the comparison really starts at a signed encounter; otherwise compare reports.
  const visit=lastSignedVisit(p,w);
  if(visit){
    const since=points.filter(o=>isAfter(o.date,visit.date)),current=since.at(-1),other=otherChanges(p,w,visit.date);
    const lead=!assessments?'Outcome reports are turned off in this workspace.':current?`${plural(since.length,'report')} since then, latest ${shortDate(current.date)}, compared with the scores reviewed at that visit.`:'No new report since that visit.';
    return {id:'changes',question:`What changed since the last visit on ${shortDate(visit.date)}?`,
      answer:`Signed visit ${shortDate(visit.date)}. ${lead}${other.length?'':' No medication, context or plan changes, new open reviews or messages are recorded since then.'}`,
      points:[...(current?withCaveat(compare(current,visit.scores)):assessments?visitMetrics.map(key=>`${metricNames[key]} ${visit.scores[key]===null?'not recorded':visit.scores[key]+'/10'} at the visit`):[]),...other],target,more};
  }
  const question='What changed since the prior report?';
  if(!assessments)return {id:'changes',question,answer:'Outcome reports are turned off in this workspace, so there is no prior report to compare with.',points:[],target,more};
  if(!latest)return {id:'changes',question:'What has the patient reported?',answer:`${firstName(p)} has not submitted a check-in yet.`,points:[],target,more};
  if(!previous)return {id:'changes',question,answer:`Only one report so far, from ${shortDate(latest.date)}. The next check-in adds a comparison.`,points:compare(latest,latest),target,more};
  const overall=first!==previous&&first.pain!==null&&latest.pain!==null?` Since the first report on ${shortDate(first.date)}, pain went ${first.pain} → ${latest.pain}/10.`:'';
  const other=otherChanges(p,w,previous.date,changesSincePriorReport(p).items.filter(item=>item.target!=='outcomes'));
  return {id:'changes',question,answer:`Latest report ${shortDate(latest.date)}, compared with ${shortDate(previous.date)}.${overall} No signed visit is on record, so this compares reports.`,points:[...withCaveat(compare(latest,previous)),...other],target,more};
}

function attention(p:Patient,w:Workspace):AdvisorSuggestion{
  const reviews=w.reviews.filter(r=>r.patientId===p.id&&r.status!=='Resolved').sort((a,b)=>['High','Medium','Routine'].indexOf(a.priority)-['High','Medium','Routine'].indexOf(b.priority));
  const allergies=p.clinicalContext?.allergyStatus;
  const points=[...reviews.slice(0,3).map(r=>`${r.priority} · ${r.title}`),...(!allergies||allergies==='Not reviewed'?['Allergies have not been reviewed']:[]),...twinOverview(p).cautions.slice(0,1).map(c=>`${c.title}: ${clipSentences(c.body)}`)];
  const answer=reviews.length?`${reviews.length} open review${reviews.length===1?'':'s'}${reviews.filter(r=>r.priority==='High').length?`, ${reviews.filter(r=>r.priority==='High').length} high priority`:''}.`:'No open reviews for this patient.';
  return {id:'attention',question:'What needs my attention first?',answer,points,target:reviews.length?{tab:'visit',anchor:'visit-concerns',label:'Needs attention'}:{tab:'visit',anchor:'patient-goal',label:'Patient goal'}};
}

function medication(p:Patient):AdvisorSuggestion{
  const meds=activeMedications(p);
  return {id:'medication',question:'Is the current medication helping?',
    answer:meds.length?meds.map(m=>`${m.name}: ${m.benefit.toLowerCase()}${m.tolerability==='Effects reported'?', with side effects reported':''}.`).join(' '):p.medicationReconciliation?.none?'No current medication is reported.':'The medication list has not been confirmed.',
    points:meds.flatMap(m=>[m.regimen?`${m.name} ${m.regimen}`:'',m.tolerability==='Effects reported'&&m.effects?`Reported: ${clip(m.effects,110)}`:'']).filter(Boolean),
    target:{tab:'visit',anchor:'patient-medications',label:'Medications & response'}};
}

function plan(p:Patient,tab:AdvisorPage='visit'):AdvisorSuggestion{
  const current=p.carePlans[0];
  return {id:'plan',question:'What is the plan and next follow-up?',
    answer:current?clip(current.text,180):'No agreed plan is recorded yet.',
    points:current?[`Follow-up ${shortDate(current.followup)}${current.time?' at '+current.time:''} · ${current.owner}`,`Saved ${shortDate(current.date)} by ${current.author}`]:p.nextVisit?[`Next visit ${shortDate(p.nextVisit)}`]:[],
    target:{tab:tab==='notes'?'visit':tab,anchor:'visit-plan',label:'Agreed plan & follow-up'}};
}

function treatment(p:Patient,w:Workspace):AdvisorSuggestion[]{
  const weights=defaultPstPriorities(p),ranking=rankPst(p,weights,false,{reportSources:selfReportSources(p,w.clinicalWorkflows?.slices.encounters.state.observations??[])}),[top,next]=ranking.ranked,tied=top?ranking.ranked.filter(r=>r.cui===top.cui).length:0;
  const shadow=shadowOpinion(p,w,ranking.ranked),differ=shadow.onPst.filter(s=>s.kind==='differ');
  const heaviest=(Object.entries(weights) as [keyof typeof weights,number][]).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([key])=>({analgesia:'pain relief',abuse:'abuse liability',cognitive:'cognition',sedation:'sedation'})[key]);
  const runs=w.engineRuns?.filter(r=>r.patientId===p.id)??[],latest=runs[0];
  const decided=!!latest&&!!w.engineDecisions?.some(d=>d.runId===latest.id);
  const stale=!!latest&&latest.revision!==engineRecordRevision(p,w);
  const suggestions:AdvisorSuggestion[]=[];
  // A rank is a numerical match to the weighted example scores. The answer names label status and the example-values caveat, and a tie is a tie.
  if(featureEnabled(w,'pst'))suggestions.push({id:'top',question:'What ranks first, and why?',
    answer:top?`${top.name} scores ${top.cui} CUI with the default priorities, which weigh ${heaviest.join(' and ')} most.${tied>1?` ${tied} options tie at ${top.cui} CUI, so there is no numerical leader; alphabetical order lists ${top.name} first.`:next?` Next is ${next.name} at ${next.cui}.`:''}`:'No option is available with the current exclusions.',
    points:top?[`Example scores, not model output: pain relief ${top.analgesia}/10 · sedation ${top.sedation}/10 · cognitive load ${top.cognitive}/10`,
      `Label status (${pstLabelBasis}): ${top.name} ${top.label}${next?`; ${next.name} ${next.label}`:''}`,
      'Listing or ranking an option, on- or off-label, is not a claim that it is effective or suitable for this patient.',
      'Open “Why this rank” on the row for the full calculation']:[],
    target:{tab:'treatment',anchor:'treatment-ranking',label:'PST ranking'}});
  // Shadow reads the same record with its own rules. No difference is the default rule outcome, never agreement or confirmation.
  if(featureEnabled(w,'shadow'))suggestions.push({id:'shadow',question:'Does Shadow AI flag a rule difference?',
    answer:differ.length?`Shadow AI rules flag a difference on ${differ.map(s=>s.name).join(', ')}.`:shadow.onPst.length?'No rule difference on the top-listed PST options. This is the default rule outcome, not independent confirmation.':'No PST option is listed for Shadow AI to compare.',
    points:[...differ.map(s=>clip(s.reason,110)),...shadow.extra.slice(0,2).map(s=>`Also lists: ${s.name}`)],
    target:{tab:'treatment',anchor:'treatment-shadow',label:'Shadow AI'}});
  // Exclusions from this patient's record come first; a library-wide rule is never called this patient's profile.
  const scope=(r:typeof ranking.excluded[number])=>pstExclusionScope(p,r);
  const own=ranking.excluded.filter(r=>scope(r)==='patient'),library=ranking.excluded.filter(r=>scope(r)!=='patient');
  if(featureEnabled(w,'pst')&&ranking.excluded.length)suggestions.push({id:'excluded',question:'What is excluded, and why?',
    answer:own.length?`${plural(ranking.excluded.length,'option')} ${ranking.excluded.length===1?'is':'are'} excluded by prototype rules: ${own.length} from ${firstName(p)}’s record${library.length?`, ${library.length} for every patient`:''}.`
      :`No patient-specific exclusion is recorded for ${firstName(p)}. ${plural(library.length,'option')} ${library.length===1?'is':'are'} excluded for every patient by a prototype library rule.`,
    points:[...own,...library].slice(0,4).map(r=>`${r.name}: ${clip(r.excluded??'',80)}`),
    target:{tab:'treatment',anchor:'treatment-exclusions',label:'Rule exclusions'}});
  suggestions.push({id:'decide',question:'Can I record a decision now?',
    answer:!latest?'Not yet. Run the engines first to save a snapshot to decide against.':stale?'Not yet. The record changed after the last snapshot, so re-run the engines first.':decided?'A decision is already recorded for the latest snapshot. Re-run the engines to record another.':'Yes. Pick an option in the table, choose Accept, Modify or Reject, and give your reason.',
    points:latest?[`Latest snapshot ${shortDate(latest.date)} · ${latest.actor}`]:[],
    target:{tab:'treatment',anchor:'treatment-decision',label:'Your decision'}});
  return suggestions;
}

function twin(p:Patient,w:Workspace):AdvisorSuggestion[]{
  const points=visitObservations(p),first=points[0],latest=points.at(-1),overview=twinOverview(p);
  const trend=first&&latest&&points.length>1?compare(latest,first):[];
  return [
    {id:'trend',question:`Is ${firstName(p)} improving?`,answer:trend.length?`${points.length} reports from ${shortDate(first.date)} to ${shortDate(latest!.date)}.`:'A trend needs at least two reports.',points:trend,target:{tab:'twin',anchor:'twin-trajectory',label:'Observed trajectory'}},
    {id:'missing',question:'What is missing from the record?',answer:'These gaps limit what the engines can use.',points:buildEngineOutput(p,w).gaps.slice(0,4),target:{tab:'twin',anchor:'twin-missing',label:'Still needed'}},
    {id:'timeline',question:'When did medications start or stop?',answer:overview.events.length?`${overview.events.length} recorded medication event${overview.events.length===1?'':'s'}.`:'No start or stop dates are recorded.',points:[...overview.events].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4).map(e=>`${shortDate(e.date)} · ${e.label}`),target:{tab:'twin',anchor:'twin-timeline',label:'Treatment timeline'}},
  ];
}

function messages(p:Patient,w:Workspace):AdvisorSuggestion[]{
  const thread=w.messages.filter(m=>m.patientId===p.id).sort((a,b)=>a.date.localeCompare(b.date));
  const lastIn=[...thread].reverse().find(m=>m.direction==='in'),last=thread.at(-1);
  const waiting=!!last&&last.direction==='in';
  const target={tab:'messages',anchor:'patient-messages',label:'Conversation'} as const;
  return [
    {id:'reply',question:'Is anything waiting for a reply?',answer:waiting?`Yes. ${firstName(p)}’s message from ${shortDate(last.date)} has no reply yet.`:thread.length?'No. The latest message is from the care team.':'There are no messages yet.',points:waiting?[`“${clip(last.text,120)}”`]:[],target},
    {id:'said',question:`What did ${firstName(p)} last say?`,answer:lastIn?`${shortDate(lastIn.date)}: “${clip(lastIn.text,160)}”`:'No messages from the patient are recorded.',points:[],target},
  ];
}

/** Notes the bridge writes for a check-in (confirmed, corrected or patient-submitted): automatic records, not clinician notes. */
const automaticNote=(note:Patient['notes'][number])=>/observation report|patient-submitted report/i.test(note.type)||note.author==='Submitted by patient'||note.id.startsWith('wf-observation-note-');
function notes(p:Patient,w:Workspace):AdvisorSuggestion[]{
  // The latest clinician-authored note; automatic check-in records are never the answer.
  const latest=p.notes.filter(note=>!automaticNote(note)).sort((a,b)=>b.date.localeCompare(a.date))[0];
  return [
    {id:'lastnote',question:'What was noted last time?',answer:latest?`${latest.type} by ${latest.author}, ${shortDate(latest.date)}: ${clip(latest.text,160)}`:p.notes.length?'No clinician note is recorded yet. Automatic check-in records are listed under Notes.':'No notes are recorded yet.',points:[],target:{tab:'notes',anchor:'patient-notes',label:'Notes'}},
    plan(p,'notes'),
    attention(p,w),
  ];
}

export function advisorSuggestions(p:Patient,w:Workspace,page:AdvisorPage):AdvisorSuggestion[]{
  if(page==='treatment')return treatment(p,w);
  if(page==='twin')return twin(p,w);
  if(page==='messages')return messages(p,w);
  if(page==='notes')return notes(p,w);
  return [trajectory(p,w),attention(p,w),medication(p),plan(p)];
}

// ---------------------------------------------------------------------------
// Typed questions. One rubric: a question is matched by keywords onto the same
// suggestions the dock offers, so a typed answer and its Show me always agree.
// Recommendation and dose-change phrasing is declined, and anything unmatched
// gets the scope message. Fixed rules only; no text is generated.
// ---------------------------------------------------------------------------
export const ADVISOR_RUBRIC_VERSION='advisor-rubric-v2';
export const advisorRubric={version:ADVISOR_RUBRIC_VERSION,
  answers:['What changed since the prior report, or since the last signed visit when there is one','What needs attention: open reviews, allergy review and profile cautions','Current medications, reported response and the written schedule','The agreed plan, follow-up and patient goal','The PST ranking with label status, Shadow AI rule differences and rule exclusions','Whether a decision can be recorded now','The Digital Twin trend, gaps in the record and medication start and stop dates','Messages waiting for a reply, the latest clinician note, and what a term on screen means'],
  declines:['Recommending, choosing or changing a treatment, option or dose','Anything outside this patient’s saved record','Open conversation: a question is matched to these topics by keywords, and any other question gets this list'],
  basis:`Prototype rules, not clinically validated. Rule set ${ADVISOR_RUBRIC_VERSION}.`};

// Words that make a question about a treatment or dose. A keyword list for matching, not a formulary.
const drugWords=String.raw`dos\w*|mg|medicat\w*|medicine\w*|meds?|drugs?|treatments?|therap(y|ies)|options?|combinations?|opioids?|nsaids?|gabapentin\w*|pregabalin|duloxetine|milnacipran|amitriptyline|nortriptyline|lidocaine|capsaicin|tramadol|tapentadol|oxycodone|morphine|hydrocodone|buprenorphine|naproxen|ibuprofen|celecoxib|diclofenac|acetaminophen|venlafaxine|carbamazepine|baclofen|tizanidine|cyclobenzaprine`;
const doseVerbs=String.raw`increase|decrease|reduce|raise|lower|double|halve|titrat\w*|up-?titrat\w*|taper\w*|wean\w*|adjust\w*|bump|go up|go down`;
const strongVerbs=String.raw`prescribe|switch|restart|${doseVerbs}`;
const weakVerbs=String.raw`start|add|try|trial|stop|discontinue|continue|change|give|use|begin|combine`;
const withDrug=String.raw`[^?.!]{0,40}\b(${drugWords})\b`;
const refuseDose=[new RegExp(String.raw`\b(${doseVerbs})\b${withDrug}`),/\b(dos\w*|mg)\b[^?.!]{0,30}\b(increase\w*|decrease\w*|higher|lower|up|down|change\w*|adjust\w*|doubl\w*)\b/];
const refuseTreatment=[
  new RegExp(String.raw`\b(should|shall) (i|we|she|he|they)\b[^?.!]{0,40}\b((${strongVerbs})\b|(${weakVerbs})\b(${withDrug}|\s*[?.!]?$))`),
  new RegExp(String.raw`\b(can|could|may) (i|we)\b[^?.!]{0,30}\b(${strongVerbs}|${weakVerbs})\b${withDrug}`),
  /\b(what|which)\b[^?.!]{0,30}\b(should|would|do|can) (i|we|you)\b[^?.!]{0,30}\b(prescribe|give|start|try|switch|recommend|suggest|use|choose|pick)\b/,
  /\b(what|which)\b[^?.!]{0,30}\bshould (she|he|they) (take|get|be on|use|try|start)\b/,
  /\b(recommend\w*|advisable|first[- ]line)\b/,
  /\b(best|safest|safer|optimal|ideal|preferred)\b[^?.!]{0,30}\b(options?|drugs?|treatments?|medications?|medicines?|choices?|therap(y|ies)|combinations?)\b/,
  /\b(options?|drugs?|treatments?|medications?|medicines?|choices?|therap(y|ies)|combinations?)\b[^?.!]{0,20}\b(is|are|would be)\b[^?.!]{0,10}\b(best|safest|optimal|ideal)\b/,
  new RegExp(String.raw`^(please )?(${strongVerbs}|${weakVerbs})\b${withDrug}`),
];
// Checked in order; the first match answers. Each id is a suggestion above, or a typed-only answer (dose, goal).
const routes:{id:string;page?:AdvisorPage;pattern:RegExp}[]=[
  {id:'dose',pattern:/\b(dos(e|es|age|ing)|mg|refill\w*|missed dos\w*)\b/},
  {id:'changes',page:'visit',pattern:/\bwhat('?s| has| have| is)? (new|changed)\b|\bchang\w*\b[^?.!]*\bsince\b|\bsince (the |her |his |their )?(last|prior|previous) (visit|report|encounter|check-?in|review)\b|\banything new\b/},
  {id:'missing',page:'twin',pattern:/\b(missing|gaps?|incomplete|still needed|not (recorded|connected))\b/},
  {id:'shadow',page:'treatment',pattern:/\bshadow\b|\bdisagree\w*|\bsecond (view|opinion)\b|\b(pst|engines?|rankings?)\b[^?.!]{0,30}\b(agree|differ)\w*|\b(agree|differ)\w*\b[^?.!]{0,30}\b(pst|engines?|rankings?)\b/},
  {id:'excluded',page:'treatment',pattern:/\b(rul(e|ed|es) out|exclu\w*|contraindicat\w*|can'?t (take|have)|cannot (take|have))\b/},
  {id:'top',page:'treatment',pattern:/\b(rank\w*|pst|cui|utility|options?|alternatives?)\b|\bwhy\b[^?.!]{0,40}\b(first|top|higher|lower|above|below)\b/},
  {id:'decide',page:'treatment',pattern:/\b(decid\w*|decision|accept|reject|snapshot|re-?run)\b/},
  {id:'timeline',page:'twin',pattern:/\bwhen did\b|\b(started|stopped|timeline|start date|stop date|previously tried|tried (before|previously)|try before|prior (trials?|medications?|treatments?)|past (trials?|medications?|treatments?)|(medication|treatment) history)\b/},
  {id:'medication',page:'visit',pattern:/\b(medicat\w*|medicine\w*|meds?|drugs?|prescri\w*|tablets?|pills?|patch(es)?|side[- ]effects?|adverse|tolera\w*|benefit\w*|regimen|adheren\w*|taking|gabapentin\w*|pregabalin|duloxetine)\b/},
  {id:'plan',page:'visit',pattern:/\b(plans?|planned|follow[- ]?ups?|appointments?|next (visit|steps?|review)|scheduled?|agreed)\b/},
  {id:'goal',pattern:/\bgoals?\b/},
  {id:'attention',page:'visit',pattern:/\b(attention|urgent\w*|priorit\w*|concerns?|reviews?|flag\w*|alerts?|worr\w*|safety|cautions?|allerg\w*)\b|\bneeds? me\b/},
  {id:'trend',page:'twin',pattern:/\b(improv\w*|better|worse|trends?|trending|over time|progress\w*|baseline)\b/},
  {id:'changes',page:'visit',pattern:/\b(pain|function\w*|sleep\w*|trajector\w*|scores?|reports?|check-?ins?|outcomes?)\b/},
  {id:'reply',page:'messages',pattern:/\b(waiting (for|on) (a )?repl\w*|unanswered|repl(y|ies|ied)|respond\w*)\b/},
  {id:'said',page:'messages',pattern:/\b(said|say|says|messages?|messaged|wrote|told|conversation|asked)\b/},
  {id:'lastnote',page:'notes',pattern:/\b(notes?|noted|documented|documentation|last time|charted)\b/},
];
const unavailable:Record<string,string>={top:'PST',excluded:'PST',shadow:'Shadow AI'};
const escape=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// "What is PST?", "What does CUI mean?", "Define Digital Twin": the glossary answers before the record does.
function definedTerm(t:string){
  return (Object.keys(glossary) as GlossaryTerm[]).sort((a,b)=>b.length-a.length).find(term=>new RegExp(String.raw`^(what('?s| is| are)|define|explain)( an?| the)? ${escape(term.toLowerCase())}( mean| stand for)?\??$|^what does (the |an? )?${escape(term.toLowerCase())} (mean|stand for|do)\??$`).test(t));
}
const normalize=(text:string)=>text.toLowerCase().replace(/[’‘]/g,'\'').replace(/\s+/g,' ').trim();

export type AdvisorAnswerKind='answer'|'refusal'|'scope';
export type AdvisorTypedAnswer={kind:AdvisorAnswerKind;route:string;answer:string;points:string[];target?:AdvisorTarget;more?:AdvisorTarget};

/** Which rubric rule a typed question falls under: 'refuse-dose', 'refuse-treatment', 'define', a route id, or 'scope'. */
export function advisorRouteForQuestion(text:string):string{
  const t=normalize(text);
  if(refuseDose.some(pattern=>pattern.test(t)))return 'refuse-dose';
  if(refuseTreatment.some(pattern=>pattern.test(t)))return 'refuse-treatment';
  if(definedTerm(t))return 'define';
  return routes.find(route=>route.pattern.test(t))?.id??'scope';
}

/** The saved-record answer to a clinician's typed question, with the section that holds its source. */
export function advisorAnswerForQuestion(p:Patient,w:Workspace,text:string):AdvisorTypedAnswer{
  const route=advisorRouteForQuestion(text),first=firstName(p),meds=activeMedications(p),pst=featureEnabled(w,'pst');
  const schedule=meds.length?meds.map(m=>`${m.name}: ${m.regimen||'regimen not recorded'}`).join('; ')+'.':'No active medication is recorded.';
  const decision:AdvisorTarget={tab:'treatment',anchor:'treatment-decision',label:'Your decision'};
  if(route==='refuse-dose'||route==='refuse-treatment')return {kind:'refusal',route,
    answer:`I restate ${first}’s saved record. I do not recommend, choose or change a treatment or dose.${route==='refuse-dose'?` Written schedule: ${schedule} No dose change is made here.`:''}`,
    points:[...(pst?['The PST comparison shows how each option matches the priorities you weight, and which prototype rules matched.']:[]),'Your decision and your reason are recorded under Your decision.'],
    target:pst?{tab:'treatment',anchor:'treatment-ranking',label:'PST comparison'}:decision,more:pst?{...decision,label:'Go to Your decision'}:undefined};
  if(route==='define'){const term=definedTerm(normalize(text))!;return {kind:'answer',route,answer:`${term}: ${glossary[term].definition}`,points:[]};}
  if(route==='dose')return {kind:'answer',route,answer:`I can only restate the written schedule. ${schedule} No dose change is made here.`,points:[],target:{tab:'visit',anchor:'patient-medications',label:'Medications & response'}};
  if(route==='goal')return {kind:'answer',route,answer:p.goal?`Patient goal: ${p.goal}`:'No patient goal is recorded.',points:[],target:{tab:'visit',anchor:'patient-goal',label:'Patient goal'}};
  const page=routes.find(r=>r.id===route)?.page;
  const suggestion=page?advisorSuggestions(p,w,page).find(s=>s.id===route):undefined;
  if(suggestion)return {kind:'answer',route,answer:suggestion.answer,points:suggestion.points,target:suggestion.target,more:suggestion.more};
  if(route==='excluded'&&pst)return {kind:'answer',route,answer:`No option is excluded by the prototype rules for ${first}.`,points:[],target:{tab:'treatment',anchor:'treatment-ranking',label:'PST ranking'}};
  if(unavailable[route])return {kind:'answer',route,answer:`${unavailable[route]} is turned off in this workspace.`,points:[]};
  return {kind:'scope',route:'scope',answer:`That question is outside what I answer. I restate ${first}’s saved record on set topics: changes, what needs attention, medications, the plan and goal, the PST and Shadow AI comparison, the Digital Twin, messages and notes. Try one of the suggested questions.`,points:[]};
}

/** The reply text saved with the question: the answer, then its supporting points. */
export function advisorAnswerText(answer:AdvisorTypedAnswer){return [answer.answer,...answer.points.map(point=>'• '+point)].join('\n');}

// Acronyms an answer may use that the clinician can define in place. Answers and saved replies stay plain text;
// marking happens only when an answer is shown, so advisorAnswerText and the record never carry braces.
const advisorTerms:readonly GlossaryTerm[]=['PST','CUI'];
const advisorTermPattern=new RegExp('\\b('+advisorTerms.join('|')+')\\b','g');
/** Answer text split for display with the guide's segmenter: the first mention of each advisor acronym becomes a glossary term. Literal braces in the text stay text. */
export function advisorAnswerSegments(text:string):(string|{term:GlossaryTerm})[]{
  const seen=new Set<string>();
  const marked=text.replace(/\{/g,'\uE000').replace(/\}/g,'\uE001').replace(advisorTermPattern,term=>seen.has(term)?term:(seen.add(term),'{'+term+'}'));
  return guideSegments(marked).map(part=>typeof part==='string'?part.replace(/\uE000/g,'{').replace(/\uE001/g,'}'):part);
}
