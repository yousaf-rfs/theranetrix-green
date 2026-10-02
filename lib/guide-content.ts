import {ADVISOR_NAME} from './product-names';
import {CDSS} from './terminology';
import type {GlossaryTerm} from './glossary';

// "How TheraNetrix works": the general orientation opened from the "?" in the top bar. It
// explains the system, not a specific result; each result keeps its own "Why this" details.
// Text in {braces} names a glossary term and renders as a <Term>. Wording rules: describe what
// each part does and which rules matched. Never rank, endorse, prescribe, or claim validation
// or clinical evidence; example values are called example values.
export type GuideScreen={id:string;name:string;text:string};
export type GuideSection={id:string;title:string;intro?:string;steps?:{title:string;text:string}[];screens?:GuideScreen[];items?:string[];tone?:'limits'};

export const guideSections:GuideSection[]=[
  {id:'flow',title:'How the system is organized',intro:`TheraNetrix is a prototype {${CDSS}} for chronic pain. It brings the patient’s reports and record together, shows which rules matched, and leaves each treatment decision to you.`,
    steps:[
      {title:'Patient check-ins',text:'Patients report pain, daily function and sleep on 0–10 scales, answer medicine questions, and send messages from the MobileNetrix patient app. Each answer is saved with its date and source.'},
      {title:'Digital Twin record',text:'The {Digital Twin} keeps those check-ins together with medications, clinical context and care-team notes as one record over time, and lists what is still missing.'},
      {title:'PST and Shadow AI comparisons',text:'{PST} orders drug and combination options by how closely their example scores match the priorities you weight. {Shadow AI} reads the same record with a separate set of prototype rules and flags rule differences on the top-listed PST options. Neither one prescribes.'},
      {title:'Your decision',text:'You review the options with their flags and exclusions, then record Accept, Modify or Reject with your reason, against the saved snapshot you reviewed.'},
      {title:'Plan',text:'The agreed plan, its owner and the follow-up date are saved to the patient’s record. The next check-ins start the cycle again.'},
    ],
    items:[`The {${ADVISOR_NAME}} answers questions about the saved record at each step and links to the section each answer comes from.`]},
  {id:'screens',title:'What each screen is for',screens:[
    {id:'overview',name:'Care overview',text:'Patient reports and priorities across your panel, for your next review.'},
    {id:'patients',name:'Patients',text:'Find a patient and open their record. Patients with open alerts are listed first.'},
    {id:'visit',name:'This visit',text:'The first tab of a patient record: goal, reported trajectory, medications and response, items that need attention, what changed since the prior report, and the agreed plan.'},
    {id:'treatment',name:'Treatment',text:'The {PST} comparison with its rule exclusions, the {Shadow AI} view, and Your decision, where you record Accept, Modify or Reject with a reason.'},
    {id:'twin',name:'Digital Twin',text:'The patient over time: observed trend, medication start and stop dates, context, and what is still missing.'},
    {id:'record-messages',name:'Messages (patient record)',text:'The conversation with this patient.'},
    {id:'notes',name:'Notes',text:'Care-team notes and automatic check-in records.'},
    {id:'more',name:'More views',text:'Observation history, care pathway, complete synopsis and record, evidence readiness, and the decision trace of saved outputs and signed decisions.'},
    {id:'reviews',name:'Review queue',text:'Patient concerns and handoffs waiting for a person, with their priority and status.'},
    {id:'inbox',name:'Messages',text:'Review messages and reply to patients in one place.'},
    {id:'schedule',name:'Schedule',text:'Visits, check-ins and follow-up, by date.'},
    {id:'pathways',name:'Care pathways',text:'Each patient’s progress from preparation through follow-up.'},
    {id:'settings',name:'Workspace settings',text:'Turn capabilities on or off, manage access, and load or reset the program records.'},
  ]},
  {id:'calculation',title:'How the comparison is calculated',items:[
    'Each {PST} option carries example scores from 0 to 10 for pain relief and for three burdens: abuse liability, cognitive effects and sedation. They are prototype values, not validated predictions for this patient.',
    'Starting priorities come from a keyword preset on the record: grogginess or sedation wording, then diabetes wording, otherwise a neutral preset. You can change them with the sliders. {Digital Twin} scores (pain, function, sleep, mood) are shown for context and do not change the PST order.',
    'You set how much each priority matters. The {CUI} adds pain relief and the inverted burden scores, each weighted by its share of the total weight, on a scale to 100. A higher CUI is a closer numerical match to your priorities, not a probability of benefit.',
    'Exclusions are rule-based. An option is listed under Rule exclusions, with the rule that matched, and is not ranked only when the allergy record names the drug, when a prototype keyword rule matches (depression, insomnia or constipation wording in the history excludes duloxetine and nortriptyline), or when the prototype library excludes it for every patient (amitriptyline). A combination is excluded when either of its drugs is.',
    'Flags on a row point to record entries for you to weigh, and the row stays ranked: a current medication, side effects reported on a current trial, a stopped trial, patient-reported answers, and the grogginess keyword rule.',
    'Label status is example data; verify it against current labeling. It does not change the CUI. Listing or ranking an option, on- or off-label, is not a claim that it is effective or suitable for this patient. Off-label use is a prescribing decision for the clinician.',
    '{Shadow AI} applies its own prototype rules to the same record. It flags rule differences on the top-listed PST options and lists non-drug care that PST does not rank. No rule difference is the default rule outcome, not independent confirmation. It never changes the PST order.',
    'Open Why this rank on any row for its full calculation and the rules that matched.',
  ]},
  {id:'limits',title:'Limits of this prototype',tone:'limits',items:[
    'Scores, doses, label status and evidence grades are example values. They are not validated; check them against current labeling and your own sources.',
    'There is no single numeric confidence or assurance score. Each output shows its inputs and the rules that matched instead.',
    'The software does not prescribe. It shows which rules matched; you choose the treatment and record your reason.',
    'The {EHR} remains the source of truth. No live EHR connection is set up; this record holds what the care team and patients entered here.',
    'A change in patient-reported scores does not show that a medication caused it.',
    'Regulatory status has not been determined for any function in this prototype.',
  ]},
  {id:'help',title:'Where to find explanations',items:[
    'Why this … buttons beside a result open its reasons, what to check, limitations and supporting records.',
    'Why this rank on a PST row shows how its CUI adds up and how it compares with the alternatives.',
    'Terms with a dotted underline show their definition when you hover over or select them.',
    `The {${ADVISOR_NAME}} (bottom right) answers questions about the saved record and links to each source. Its “What the ${ADVISOR_NAME} answers” list shows its topics and limits.`,
    'Sources & gaps on This visit, and Evidence readiness and Decision trace under More views, show the saved sources behind each output.',
  ]},
];

const recordViews=['outcomes','pathway','overview','full','evidence','trace'];
/** The "What each screen is for" entry the guide opens at, from the path and the patient record tab. '' opens at the top. */
export function guideScreenFor(path:string,tab?:string|null):string{
  if(path.startsWith('/patients/')){
    const t=tab??'visit';
    return ['treatment','pst','shadow','engines'].includes(t)?'treatment':t==='twin'?'twin':t==='messages'?'record-messages':t==='notes'?'notes':recordViews.includes(t)?'more':'visit';
  }
  if(['/engines','/digital-twin','/pst','/shadow-ai','/robo-advisor'].includes(path))return path==='/digital-twin'?'twin':'treatment';
  return path==='/'?'overview':path==='/patients'?'patients':path==='/review-queue'?'reviews':path==='/messages'?'inbox':path==='/schedule'?'schedule':path==='/care-pathways'?'pathways':path.startsWith('/settings')?'settings':'';
}

/** Split guide text into plain strings and glossary terms. */
export function guideSegments(text:string):(string|{term:GlossaryTerm})[]{
  return text.split(/\{([^}]+)\}/).map((part,index)=>index%2?{term:part as GlossaryTerm}:part).filter(part=>part!=='');
}
