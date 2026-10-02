// The prototype PST library. Doses, 0–10 scores, A/B/C letters and labeled indications are embedded
// example data, not sourced, calibrated or validated values. This module has no imports so the
// companion medication questions can list the same drugs without depending on the ranking logic.

/** Labeled pain indications the example label map knows. Opioid labeling (immediate-release and extended-release wording) is not condition-specific. */
export type PstIndication='phn'|'dpn'|'fibromyalgia'|'msk'|'sci'|'tn'|'opioid'|'opioidEr';
export const pstLabelBasis='example, verify against current FDA labeling' as const;
/** The recorded condition in one form for matching: lower case, with hyphens and runs of spaces read as one space, so “Post-herpetic”, “post herpetic” and “postherpetic” compare alike. */
export const pstConditionText=(condition:string)=>condition.toLowerCase().replace(/[-‐‑–—]+/g,' ').replace(/\s+/g,' ').trim();
/** Recorded-condition wording that maps to each labeled indication, read from pstConditionText. `negated` wording never matches;
 * `unclear` wording names the area without a match the example map can classify, so label status is left to the clinician. Opioid labeling matches no condition.
 * Every match is also read against the negation and doubt around it (plainMatch), so negated or doubtful wording before or after the term, or its abbreviation, is unclear too. */
export const pstIndications:Record<PstIndication,{name:string;match?:RegExp;negated?:RegExp;unclear?:RegExp}>={
  phn:{name:'postherpetic neuralgia (PHN)',match:/\bpost ?herpetic|\bphn\b/,negated:/\b(non|not|no|without) (post ?herpetic|phn\b)/},
  dpn:{name:'painful diabetic peripheral neuropathy (DPN)',match:/\bdiabetic (peripheral )?(poly)?neuropath|\bdpnp?\b/,negated:/\b(non|not|no|without|pre) ?diabet/,unclear:/diabet.*neuropath|neuropath.*diabet/},
  fibromyalgia:{name:'fibromyalgia',match:/fibromyalgia/},
  msk:{name:'chronic musculoskeletal pain, including chronic low back pain',match:/low back|musculoskeletal|osteoarthritis/},
  sci:{name:'neuropathic pain after spinal cord injury',match:/spinal cord injury/},
  tn:{name:'trigeminal neuralgia',match:/trigeminal/},
  opioid:{name:'pain severe enough to need an opioid analgesic, when alternative treatments are inadequate'},
  opioidEr:{name:'severe and persistent pain that needs an extended period of daily opioid treatment, when alternative treatments are inadequate'},
};
// A derived match needs plain wording. Any doubt ("possible", "?", "vs", "or") anywhere leaves every named indication unclear.
// "non"/"pre" negate the word right after them ("non DPN", but not "non specific low back pain"); other negation negates what
// follows it in the same clause ("without PHN", "neuropathy, not DPN"). A qualifier after the term negates it in the term's own
// clause ("DPN excluded", "PHN r/o") or when a later clause opens with it ("PHN, ruled out", "PHN, left T4, now resolved"). A
// later clause with a qualifier about something else ("DPN; osteoarthritis ruled out") says nothing about the term and ends the scan.
const clauseBreak=/[,;:()[\]{}.]| but | however /g;
const negatedBefore=/\b(not|no|without|negative for|denies|denied|absence of|absent|free of|excluding|excluded|ruled out|rule out|r\/o|never)\b/;
const negatedAfter=/\b(excluded|ruled out|rule out|r\/o|not (present|confirmed|supported|seen|found|diagnosed|likely|the diagnosis)|unlikely|negative|absent|resolved|denied|no longer)\b/;
const filler=/^(\s|\b(which|that|was|were|is|are|has|have|had|been|now|since|later|then|subsequently|also)\b)*/;
/** True when what follows a term negates it: the rest of its own clause, or a later clause that opens with a qualifier. */
function negatedLater(after:string){
  const [own='',...later]=after.replace(/^\w*/,'').split(clauseBreak);
  if(negatedAfter.test(own))return true;
  for(const clause of later){
    const rest=clause.replace(filler,''),found=rest.match(negatedAfter);
    if(found)return found.index===0;
  }
  return false;
}
const doubtful=/\?|\b(possible|possibly|probable|probably|suspected|suspect|suspicion|query|queried|questionable|presumed|presumptive|likely|unlikely|differential|versus|vs|or|either|unconfirmed|to be confirmed|tbc|pending)\b/;
/** True when the pattern matches and no match of it is negated or doubted. */
function plainMatch(text:string,pattern:RegExp){
  const found=[...text.matchAll(new RegExp(pattern.source,'g'))];
  return found.length>0&&!doubtful.test(text)&&found.every(({0:term,index=0})=>{
    const before=text.slice(0,index),clause=before.slice(Math.max(0,...[...before.matchAll(clauseBreak)].map(cut=>(cut.index??0)+cut[0].length)));
    return !/\b(non|pre) ?$/.test(before)&&!negatedBefore.test(clause)&&!negatedLater(text.slice(index+term.length));
  });
}
/** Whether the recorded condition names this wording plainly, read with the same negation and doubt rules as the label map. */
export const pstPlainConditionMatch=(condition:string,pattern:RegExp)=>plainMatch(pstConditionText(condition),pattern);
/** How the recorded condition reads against the example label map: indications it matches, and indications whose wording is present but unclear (negated, doubtful or loosely phrased). */
export function pstConditionMatch(condition:string):{matched:PstIndication[];unclear:PstIndication[]}{
  const text=pstConditionText(condition),ids=Object.keys(pstIndications) as PstIndication[];
  const matched=ids.filter(id=>{const rule=pstIndications[id];return !!rule.match&&plainMatch(text,rule.match)&&!rule.negated?.test(text);});
  return {matched,unclear:ids.filter(id=>{const rule=pstIndications[id];return !matched.includes(id)&&(!!rule.match?.test(text)||!!rule.unclear?.test(text));})};
}
export type PstDrug={
  id:string;name:string;kind:'drug'|'combination';dose:string;evidence:string;analgesia:number;abuse:number;cognitive:number;sedation:number;
  why:string;labeledIndications:PstIndication[];labelScope?:Partial<Record<PstIndication,string>>;componentIds?:string[];
};
export const pstDrugs:PstDrug[]=[
  {id:'gabapentin',name:'Gabapentin',kind:'drug',dose:'300 mg orally three times daily',labeledIndications:['phn'],evidence:'A',analgesia:6,abuse:1,cognitive:6,sedation:7,why:'Gabapentinoid used for neuropathic pain, with notable sedation and cognitive scores in this example library. Line of therapy is not assessed.'},
  {id:'pregabalin',name:'Pregabalin',kind:'drug',dose:'75 mg orally twice daily',labeledIndications:['dpn','phn','fibromyalgia','sci'],evidence:'A',analgesia:7,abuse:3,cognitive:5,sedation:6,why:'Gabapentinoid listed next to gabapentin so their example burden scores can be compared.'},
  {id:'lidocaine',name:'Lidocaine 5% patch',kind:'drug',dose:'Apply to the painful area 12 hours on, 12 hours off',labeledIndications:['phn'],evidence:'B',analgesia:5,abuse:0,cognitive:1,sedation:1,why:'Topical patch with low systemic sedation and cognitive scores in this example library.'},
  {id:'capsaicin',name:'Capsaicin 8% patch',kind:'drug',dose:'Clinic-applied patch, 30–60 minutes',labeledIndications:['phn','dpn'],labelScope:{dpn:'of the feet'},evidence:'B',analgesia:5,abuse:0,cognitive:1,sedation:1,why:'Clinic-applied topical patch with low systemic sedation and cognitive scores in this example library.'},
  {id:'duloxetine',name:'Duloxetine',kind:'drug',dose:'60 mg orally once daily',labeledIndications:['dpn','fibromyalgia','msk'],evidence:'A',analgesia:7,abuse:1,cognitive:3,sedation:3,why:'SNRI used for neuropathic and musculoskeletal pain. Mood and gastrointestinal history are relevant to this option.'},
  {id:'venlafaxine',name:'Venlafaxine',kind:'drug',dose:'75 mg orally once daily',labeledIndications:[],evidence:'B',analgesia:6,abuse:1,cognitive:3,sedation:3,why:'SNRI listed next to duloxetine for comparison.'},
  {id:'nortriptyline',name:'Nortriptyline',kind:'drug',dose:'25 mg orally at night',labeledIndications:[],evidence:'B',analgesia:6,abuse:1,cognitive:5,sedation:6,why:'Secondary-amine tricyclic with sedating and anticholinergic effects.'},
  {id:'amitriptyline',name:'Amitriptyline',kind:'drug',dose:'25 mg orally at night',labeledIndications:[],evidence:'B',analgesia:6,abuse:1,cognitive:7,sedation:8,why:'Tertiary-amine tricyclic with high cognitive and sedation scores in this example library.'},
  {id:'tramadol',name:'Tramadol',kind:'drug',dose:'50 mg orally every 6 hours as needed',labeledIndications:['opioid'],evidence:'C',analgesia:6,abuse:6,cognitive:4,sedation:5,why:'Opioid analgesic. Its abuse liability and sedation scores lower its CUI when those priorities carry weight.'},
  {id:'tapentadol',name:'Tapentadol ER',kind:'drug',dose:'50 mg orally twice daily',labeledIndications:['opioidEr','dpn'],labelScope:{dpn:'severe enough to need an extended period of daily opioid treatment, when alternative treatments are inadequate'},evidence:'B',analgesia:7,abuse:7,cognitive:4,sedation:5,why:'Opioid / NRI. Its abuse liability score lowers its CUI when that priority carries weight. Line of therapy is not assessed.'},
  {id:'oxycodone',name:'Oxycodone ER',kind:'drug',dose:'10 mg orally twice daily',labeledIndications:['opioidEr'],evidence:'C',analgesia:8,abuse:9,cognitive:5,sedation:6,why:'Full opioid agonist with a high abuse liability score, which lowers its CUI when that priority carries weight. Line of therapy is not assessed.'},
  {id:'carbamazepine',name:'Carbamazepine',kind:'drug',dose:'200 mg orally twice daily',labeledIndications:['tn'],evidence:'B',analgesia:6,abuse:1,cognitive:5,sedation:4,why:'Sodium-channel anticonvulsant. Line of therapy is not assessed.'},
  {id:'gbp-lido',name:'Gabapentin + lidocaine patch',kind:'combination',componentIds:['gabapentin','lidocaine'],dose:'Gabapentin 300 mg TID plus 5% patch',labeledIndications:[],evidence:'B',analgesia:7,abuse:1,cognitive:6,sedation:7,why:'Prototype combination with its own example scores. No interaction assessment is available.'},
  {id:'pgb-dlx',name:'Pregabalin + duloxetine',kind:'combination',componentIds:['pregabalin','duloxetine'],dose:'Pregabalin 75 mg BID plus duloxetine 60 mg daily',labeledIndications:[],evidence:'A',analgesia:8,abuse:3,cognitive:6,sedation:6,why:'Gabapentinoid plus SNRI. The burden of both drugs adds up. No interaction assessment is available.'},
  {id:'dlx-cap',name:'Duloxetine + capsaicin 8% patch',kind:'combination',componentIds:['duloxetine','capsaicin'],dose:'Duloxetine 60 mg daily plus clinic-applied patch',labeledIndications:[],evidence:'C',analgesia:7,abuse:1,cognitive:3,sedation:3,why:'Systemic SNRI plus a topical patch; the patch adds little to the example sedation score. No interaction assessment is available.'},
  {id:'pgb-cap',name:'Pregabalin + capsaicin 8% patch',kind:'combination',componentIds:['pregabalin','capsaicin'],dose:'Pregabalin 75 mg BID plus clinic-applied patch',labeledIndications:[],evidence:'C',analgesia:7,abuse:3,cognitive:5,sedation:6,why:'Gabapentinoid plus a topical patch; the patch adds little to the example sedation score. No interaction assessment is available.'},
  {id:'pgb-lido',name:'Pregabalin + lidocaine patch',kind:'combination',componentIds:['pregabalin','lidocaine'],dose:'Pregabalin 75 mg BID plus 5% patch',labeledIndications:[],evidence:'C',analgesia:7,abuse:3,cognitive:5,sedation:6,why:'Gabapentinoid plus a topical patch; the patch adds little to the example sedation score. No interaction assessment is available.'},
  {id:'gbp-nort',name:'Gabapentin + nortriptyline',kind:'combination',componentIds:['gabapentin','nortriptyline'],dose:'Gabapentin 300 mg TID plus nortriptyline 25 mg at night',labeledIndications:[],evidence:'B',analgesia:8,abuse:1,cognitive:7,sedation:8,why:'Gabapentinoid plus tricyclic. Sedation and anticholinergic load from both drugs add up. No interaction assessment is available.'},
];
