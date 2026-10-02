import {instruments} from './future-preview';
import {ADVISOR_NAME} from './product-names';
import {CDSS,CDSS_EXPANDED} from './terminology';

// Definitions for the acronyms and product terms the clinician UI shows, read by
// <Term> and <AcronymHelp> in components/theranetrix/ui.tsx. Add a term only once a
// screen renders it. Definitions describe what each part does and where it stops; they
// never rank, endorse, or claim clinical evidence. For an acronym, the definition
// opens with its expansion.
export type GlossaryEntry={short:string;definition:string};
const instrumentName=(code:string)=>instruments.find(i=>i.code===code)?.name??code;
const notScored='It is not connected or scored in this prototype.';
const notBilling='Nothing shown in this prototype is a billing determination.';

export const glossary={
  PST:{short:'Prescribing support tool',definition:'Prescribing support tool. It ranks drug and combination options by how closely their scores match the priorities you weight. The scores are prototype example values. PST compares options and does not prescribe; the treatment decision is yours.'},
  CUI:{short:'Clinical Utility Index',definition:'Clinical Utility Index. This prototype combines pain relief and inverted burden scores using your relative weights. Higher means a better numerical match to those priorities, not a probability of benefit. Open Why this rank for the calculation.'},
  'Shadow AI':{short:'Rule-based review alongside PST',definition:'A separate set of prototype rules that reads the same saved record as PST. It flags rule differences on the top-listed PST options and lists non-drug care that PST does not rank. It is not an independent clinical model and never changes the PST ranking.'},
  'Digital Twin':{short:'The patient’s record over time',definition:'One view of this patient over time: check-ins, pain, function and sleep trends, medications, and clinical context. In this prototype it is assembled from the saved record; predictive models are not connected.'},
  [ADVISOR_NAME]:{short:'Guided record assistant',definition:'A guided assistant that answers questions from the saved record and links to the section holding each source, so you can check it there. With patients it uses scripted replies, saves confirmed check-ins, and passes concerns and questions to the care team. It is not a live conversational model; decisions stay with the clinician.'},
  [CDSS]:{short:CDSS_EXPANDED[0].toUpperCase()+CDSS_EXPANDED.slice(1),definition:'Clinical decision support system. Software that brings patient information together and shows which rules matched, so the clinician can weigh the options. The clinician makes every treatment decision. Regulatory status has not been determined for any function in this prototype.'},
  EHR:{short:'Electronic health record',definition:'Electronic health record. The clinic’s system of record for charts, orders, and results, such as Epic or Cerner. No live EHR connection is set up in this prototype.'},
  MRN:{short:'Medical record number',definition:'Medical record number. The identifier a clinic’s record system gives each patient. Numbers in this prototype are synthetic demo values.'},
  'SMART on FHIR':{short:'EHR app launch standard',definition:'A standard that lets an app open from inside the EHR with the current patient and encounter already selected, using HL7 FHIR (Fast Healthcare Interoperability Resources) data. It is not connected in this prototype.'},
  BPI:{short:instrumentName('BPI'),definition:instrumentName('BPI')+'. A patient questionnaire on pain severity and how much pain interferes with daily life. '+notScored},
  PROMIS:{short:'Patient-Reported Outcomes Measurement Information System',definition:'Patient-Reported Outcomes Measurement Information System. A family of patient questionnaires on physical function, pain interference, sleep, mood, and social roles. '+notScored},
  PEG:{short:instrumentName('PEG'),definition:instrumentName('PEG')+'. A three-question scale on pain intensity and how pain affects enjoyment of life and general activity. '+notScored},
  'SOAPP-R':{short:instrumentName('SOAPP-R'),definition:instrumentName('SOAPP-R')+'. A patient questionnaire that screens for risk of opioid misuse when long-term opioid therapy is being considered. '+notScored},
  COMM:{short:instrumentName('COMM'),definition:instrumentName('COMM')+'. A patient questionnaire that screens for current signs of opioid misuse in people already taking opioids. '+notScored},
  RTM:{short:'Remote therapeutic monitoring',definition:'Remote therapeutic monitoring. A billing category for reviewing patient-reported therapy data, such as adherence and response, between visits. '+notBilling},
  CCM:{short:'Chronic care management',definition:'Chronic care management. A billing category for care-coordination time outside visits for patients with ongoing chronic conditions. '+notBilling},
} satisfies Record<string,GlossaryEntry>;
export type GlossaryTerm=keyof typeof glossary;
export function isGlossaryTerm(term:string):term is GlossaryTerm{return Object.hasOwn(glossary,term);}
export function glossaryEntry(term:string):GlossaryEntry|undefined{return Object.hasOwn(glossary,term)?(glossary as Record<string,GlossaryEntry>)[term]:undefined;}
