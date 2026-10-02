// Prototype interface previews for capabilities the app does not implement yet.
// Values are fabricated so the intended screens read like a finished product in a
// review or client walkthrough. Nothing here is computed, retrieved, scored, or
// predicted, and none of it is clinical output or clinical guidance.
// This file imports nothing from the clinical modules, so a preview can never be
// wired into, or mistaken for, a real workspace record.
// Licensed instrument item wording is NOT reproduced anywhere in this file.

export const previewNotice='Design preview';

export type Capability={
  id:string;name:string;domain:string;eyebrow:string;headline:string;summary:string;
  standsInFor:string;requires:string[];
};

export const capabilities:Capability[]=[
  {id:'twin',name:'Predictive Digital Twin',domain:'Digital Twin',eyebrow:'PATIENT MODEL',
   headline:'An expected trajectory, its uncertainty, and side-by-side what-ifs.',
   summary:'The twin projects where this patient is heading on their current treatment, with an uncertainty interval around it, and compares that against the alternatives the clinician is weighing.',
   standsInFor:'The Digital Twin in the app today plots recorded check-ins against a labelled care target. It makes no prediction.',
   requires:['A patient-outcome model trained on a defined cohort, with a documented training window and feature set.','Calibration evidence and prospective validation before a predicted value reaches a clinician.','Versioned twin states so a saved prediction can be reproduced and audited.','Regulatory assessment: predicting a patient outcome is a different intended use from displaying records.']},
  {id:'pst',name:'Treatment candidate generation and ranking',domain:'PST',eyebrow:'STRATEGY ENGINE',
   headline:'Generated regimen candidates, scored and ranked with a clinical utility index.',
   summary:'PST enumerates single agents, combinations and non-drug programmes, screens them against this patient’s constraints, and orders what remains by modelled relief against treatment burden.',
   standsInFor:'The PST that ships today ranks a fixed prototype library of single drugs and drug combinations, with example doses and label status, by how closely their example scores match the weights the clinician sets. Non-drug options are listed separately by Shadow AI. PST does not generate candidates, and its doses, label status and scores are example values to verify against current labeling.',
   requires:['A curated drug and combination knowledge base with mechanism and interaction data.','Separately validated benefit and burden prediction models per candidate.','Contraindication and interaction screening against a maintained clinical source.','Prescribing-safety review and regulatory assessment: ranked treatment options are a device function.']},
  {id:'shadow',name:'Shadow AI model and evidence retrieval',domain:'Shadow AI',eyebrow:'RULE-BASED REVIEW',
   headline:'A separate model that checks the PST options against the record and the evidence, inside one CDSS workflow with one clinician decision.',
   summary:'Shadow reads a different feature set to check each PST option against the patient record, then shows the literature for and against the ranked option so the clinician can see where the check and the ranking differ. Both sit in the same review, and the clinician records one decision.',
   standsInFor:'The Shadow that ships today shares the record simulator with PST, so its agreement adds no separate weight.',
   requires:['A model developed and trained separately from PST, with its own documented inputs.','A licensed literature corpus and retrieval pipeline with citation provenance.','An agreement measure with a defined statistical meaning.','Independent evaluation before any agreement claim is shown to a clinician.']},
  {id:'integration',name:'Tabia, EHR and SMART on FHIR',domain:'Data Integration',eyebrow:'CLINICAL DATA LAYER',
   headline:'Live record exchange, field mapping, and clinician write-back.',
   summary:'Records arrive from the EHR, laboratory and clinical data layer, reconcile against the workspace, and clinician decisions are written back to the source of truth.',
   standsInFor:'Every record in the app today is entered and held in this workspace. Outside records, labs and imaging are labelled unavailable.',
   requires:['An authorised partner sandbox and a documented API contract per connection.','Server-managed credentials, patient identity mapping, and consent enforcement.','Payload validation, sync reconciliation and failure handling with operator visibility.','End-to-end verification with each partner, plus write-back safety review.']},
  {id:'instruments',name:'Validated instrument scoring',domain:'MobileNetrix',eyebrow:'MEASUREMENT',
   headline:'Licensed instruments, scored to their published algorithms, on a set cadence.',
   summary:'BPI, PROMIS-29, PEG, SOAPP-R and COMM administered on their own cadence, scored by subscale, and reported against the interpretation bands from each instrument’s documentation.',
   standsInFor:'The app today records three unvalidated 0–10 self-reports and states that named instruments are not reconstructed or scored.',
   requires:['A licence for each instrument. Item wording belongs to the rights-holders and is delivered through their item bank, not authored in the product.','The published scoring algorithm and interpretation bands per instrument and subscale.','A configured administration cadence with reminders and missed-assessment handling.','Clinical review of how a score changes a care decision.']},
  {id:'pathway',name:'Peripheral Neuropathy Care Plan X-1',domain:'Care Pathway Execution',eyebrow:'PROTOCOL',
   headline:'The full multi-stage protocol with clinical branching and automated events.',
   summary:'The complete protocol runs as staged steps with named owners, decision branches at the points where a protocol stops being a checklist, and event automation between them.',
   standsInFor:'The app today runs a five-step operational sample pathway, documented as separate from the clinical protocol.',
   requires:['The approved X-1 protocol content. It was never supplied to this project, so the steps shown are a placeholder of the right shape and length.','Clinical branch logic, entry and exit criteria, and escalation rules per step.','Event automation and multichannel delivery through the execution partner.','Clinical governance sign-off on any automated treatment action.']},
  {id:'mobile',name:'MobileNetrix app and connected devices',domain:'MobileNetrix',eyebrow:'PATIENT APPLICATION',
   headline:'The native app, device streams, and scheduled patient reminders.',
   summary:'The patient app carries its own identity, streams wearable and home-device data into the record, and drives adherence through a scheduled reminder ladder.',
   standsInFor:'The companion today runs inside the clinician’s own session, with no separate patient authentication, device data, or notifications.',
   requires:['The existing MobileNetrix application and its data contract.','Separate patient authentication and authorisation, distinct from the clinician workspace.','Device and wearable integrations with calibration and data-quality handling.','A notification service, delivery receipts, and a quiet-hours policy.']},
  {id:'billing',name:'Remote monitoring eligibility and billing',domain:'Reimbursement / Licensing',eyebrow:'COMMERCIAL',
   headline:'Time and data sufficiency tracked against payer requirements.',
   summary:'Accrued clinician minutes and transmitting days are measured per patient against the requirement for each billing code, so eligibility is visible before a claim is prepared.',
   standsInFor:'Nothing ships for this domain. The feature coverage document records it as absent.',
   requires:['Authoritative, current payer rules per code and per region, read from a maintained source rather than authored in the product.','Auditable time capture tied to identified clinician activity.','Eligibility reviewed by billing and compliance before any claim is submitted.','Instrument and content licence enforcement where a code depends on it.']},
  {id:'governance',name:'Clinical roles, consent and access audit',domain:'Privacy / Data Protection',eyebrow:'GOVERNANCE',
   headline:'Per-role permissions, patient consent state, and a read-access disclosure log.',
   summary:'Permissions are enforced per clinical role, consent is recorded with its scope and expiry, and every read of a patient record is accounted for.',
   standsInFor:'One shared access code opens a single owner workspace today, so everyone who signs in holds every permission, and reads are not logged.',
   requires:['Per-organisation and per-patient authorisation, replacing the shared owner workspace.','Consent capture, scope, expiry and revocation, enforced on every read and write.','Read-access logging and disclosure accounting suitable for a health-record system.','A security and privacy review of the production deployment.']},
];

// 1. Predictive Digital Twin -------------------------------------------------
export type ForecastPoint={date:string;observed:number|null;predicted:number|null;low:number|null;high:number|null};
export const twinForecast:ForecastPoint[]=[
  {date:'2026-07-28',observed:7,predicted:null,low:null,high:null},
  {date:'2026-08-11',observed:6,predicted:null,low:null,high:null},
  {date:'2026-08-25',observed:6,predicted:null,low:null,high:null},
  {date:'2026-09-08',observed:6,predicted:6.0,low:6.0,high:6.0},
  {date:'2026-09-22',observed:null,predicted:5.4,low:4.6,high:6.2},
  {date:'2026-10-06',observed:null,predicted:4.8,low:3.7,high:5.9},
  {date:'2026-10-20',observed:null,predicted:4.3,low:3.0,high:5.7},
  {date:'2026-11-03',observed:null,predicted:4.0,low:2.5,high:5.6},
];
export const twinHeadline=[
  {label:'Projected pain at 12 weeks',value:'4.0',unit:'/10'},
  {label:'Uncertainty interval',value:'2.5 – 5.6',unit:''},
  {label:'Change from today',value:'−2.0',unit:'points'},
];
export const twinModelCard=[
  {label:'Model',value:'twin-pain-trajectory v2.4'},
  {label:'Training cohort',value:'4,812 chronic pain patients · 18-month observation window'},
  {label:'Features',value:'34 inputs across medication response, self-report, activity and clinical context'},
  {label:'Calibration',value:'Interval coverage reported per population and time window, with its method and cohort shown alongside. No single summary score stands in for it.'},
  {label:'Last recalibrated',value:'30 August 2026, after a 0.04 drift in discrimination'},
  {label:'Reproducibility',value:'Twin state pinned per run, so any saved prediction re-derives exactly'},
];
export type Scenario={id:string;name:string;detail:string;projected:string;interval:string;note:string;
  change:string;grogginess:string;forecast:[number,number,number][]};
// forecast rows are [predicted, low, high] for the four future fortnights.
export const twinScenarios:Scenario[]=[
  {id:'continue',name:'Continue current regimen',detail:'Gabapentin 300 mg three times daily, unchanged.',
   projected:'5.8',interval:'4.9 – 6.7',change:'−0.2',grogginess:'Unchanged',
   note:'Modest further improvement, with morning grogginess persisting at the current dose.',
   forecast:[[5.9,5.2,6.6],[5.9,5.1,6.7],[5.8,5.0,6.6],[5.8,4.9,6.7]]},
  {id:'adjust',name:'Adjust the current regimen',detail:'Redistribute to 200 mg morning and 400 mg at night.',
   projected:'4.6',interval:'3.5 – 5.7',change:'−1.4',grogginess:'Improved',
   note:'Greater modelled relief with the sedative load shifted overnight, at the cost of a titration period.',
   forecast:[[5.6,4.9,6.3],[5.2,4.3,6.1],[4.9,3.9,5.9],[4.6,3.5,5.7]]},
  {id:'add-nonpharm',name:'Add a paced-activity programme',detail:'Eight-week structured programme alongside current treatment.',
   projected:'4.2',interval:'3.1 – 5.3',change:'−1.8',grogginess:'Unchanged',
   note:'Largest modelled functional change and the lowest added treatment burden of the three.',
   forecast:[[5.4,4.7,6.1],[4.9,4.0,5.8],[4.5,3.5,5.5],[4.2,3.1,5.3]]},
];
export const twinFutureDates=['2026-09-22','2026-10-06','2026-10-20','2026-11-03'];
export const twinObserved:[string,number][]=[['2026-07-28',7],['2026-08-11',6],['2026-08-25',6],['2026-09-08',6]];

// 2. PST candidate generation ------------------------------------------------
// `evidence` is never a single letter grade: evidence quality would be shown per source (design, population, limitations).
export type Candidate={rank:number;regimen:string;kind:'Single agent'|'Combination'|'Non-drug';mechanism:string;benefit:string;burden:string;cui:string;evidence:string;flags:string[]};
const perSource='Per-source review · example';
export const pstCandidates:Candidate[]=[
  {rank:1,regimen:'Duloxetine 60 mg once daily',kind:'Single agent',mechanism:'SNRI · descending inhibition',benefit:'7.8',burden:'3.1',cui:'0.74',evidence:perSource,flags:[]},
  {rank:2,regimen:'Pregabalin 150 mg twice daily + lidocaine 5% patch',kind:'Combination',mechanism:'Alpha-2-delta ligand + peripheral sodium channel',benefit:'8.2',burden:'4.6',cui:'0.71',evidence:perSource,flags:['Renal dosing check','Sedation risk']},
  {rank:3,regimen:'Paced activity programme with sleep routine',kind:'Non-drug',mechanism:'Behavioural and functional',benefit:'5.9',burden:'1.4',cui:'0.66',evidence:perSource,flags:[]},
  {rank:4,regimen:'Amitriptyline 25 mg at night',kind:'Single agent',mechanism:'TCA · noradrenergic reuptake',benefit:'6.4',burden:'5.2',cui:'0.58',evidence:perSource,flags:['Anticholinergic load','Cardiac review over 65']},
];
export const candidateDetail:Record<string,{why:string;against:string;monitor:string;alternativesConsidered:string}>={
  'Duloxetine 60 mg once daily':{
    why:'Highest utility of the set: strong modelled benefit with the lowest burden of the drug options, and a once-daily schedule that fits the patient’s stated wish to stay alert at work.',
    against:'Shadow ranks this second, placing the non-drug programme first on adverse-effect burden.',
    monitor:'Nausea in the first fortnight, blood pressure at four weeks, and whether desk-work tolerance actually moves.',
    alternativesConsidered:'Ranked above pregabalin combination on burden, and above amitriptyline on both burden and anticholinergic load.'},
  'Pregabalin 150 mg twice daily + lidocaine 5% patch':{
    why:'Highest modelled benefit of any candidate, pairing a central and a peripheral mechanism.',
    against:'Highest burden of the top three, twice-daily dosing plus a patch, and it needs a renal dosing check at eGFR 62.',
    monitor:'Sedation and peripheral oedema, renal function at eight weeks, and local skin reaction at the patch site.',
    alternativesConsidered:'Ranked below duloxetine because the added benefit does not offset the burden at this patient’s stated priorities.'},
  'Amitriptyline 25 mg at night':{
    why:'Long-established option with a night-time schedule that may help the reported sleep disruption.',
    against:'Highest burden of the drug options and an anticholinergic load the patient is already sensitive to.',
    monitor:'Morning sedation, dry mouth, and a cardiac review if the patient passes 65.',
    alternativesConsidered:'Ranked fourth: its modelled benefit is above the paced-activity programme, but the highest burden of the set brings its utility below it.'},
  'Paced activity programme with sleep routine':{
    why:'Lowest burden by a wide margin, with benefit close to the drug options at twelve weeks. Shadow ranks this first.',
    against:'Slower onset than a drug, and it depends on the patient sustaining the programme.',
    monitor:'Programme attendance, walking tolerance, and whether sleep gains hold past week six.',
    alternativesConsidered:'Ranked third by PST: the lowest burden of the set places its utility above amitriptyline, and its lower modelled benefit places it below the two drug options ranked above it.'},
};
export const pstSearchSummary=[
  {label:'Candidate space',value:'1,284 regimens enumerated: 47 single agents, 1,201 pairs, 36 non-drug programmes.'},
  {label:'Constraints applied',value:'Reported codeine reaction, eGFR 62, no cardiac history, and the patient’s stated preference to stay alert during the workday.'},
  {label:'Excluded and why',value:'215 excluded: 148 on interaction risk, 44 on renal dosing, 23 on the recorded allergy. Label status does not exclude a candidate; off-label use is a prescribing decision for the clinician.'},
  {label:'Utility definition',value:'CUI = 0.45 modelled benefit + 0.35 inverse burden + 0.20 regimen simplicity, normalised to 1.0.'},
];

// 3. Shadow model and evidence ----------------------------------------------
export const shadowComparison=[
  {row:'Model inputs',pst:'34 features · self-report, medication response, activity',shadow:'21 features · claims history, comorbidity, prior trial outcomes'},
  {row:'First-ranked option',pst:'Duloxetine 60 mg once daily',shadow:'Paced activity programme with sleep routine'},
  {row:'Agreement',pst:'Rank correlation 0.62 across the candidate set',shadow:'Differs on first choice, agrees on the top three'},
];
// Structured placeholders, not references: no title, journal, figure or finding here is real.
// A retrieved source would fill each field; until then every field says it was not retrieved.
export const citationsNotice='Illustrative, not real references';
const notRetrieved='Not retrieved · placeholder';
export const shadowCitations=[
  {option:'Duloxetine 60 mg once daily',stance:'Supporting',
   fields:[{label:'Source',value:notRetrieved},{label:'Study design',value:notRetrieved},{label:'Population studied',value:notRetrieved},{label:'Indication match',value:notRetrieved},{label:'Endpoint',value:notRetrieved},{label:'Key limitations',value:notRetrieved}]},
  {option:'Paced activity programme with sleep routine',stance:'Opposing the first-ranked option',
   fields:[{label:'Source',value:notRetrieved},{label:'Study design',value:notRetrieved},{label:'Population studied',value:notRetrieved},{label:'Indication match',value:notRetrieved},{label:'Endpoint',value:notRetrieved},{label:'Key limitations',value:notRetrieved}]},
];

// 4. Data integration --------------------------------------------------------
export const connections=[
  {name:'Tabia',protocol:'Clinical data layer',scope:'Normalised records, care events, write-back',status:'Connected',sync:'2 minutes ago',records:'14,208'},
  {name:'Epic',protocol:'SMART on FHIR',scope:'Patient and encounter context on launch',status:'Illustrative · not connected',sync:'Example only',records:'Example only'},
  {name:'Laboratory',protocol:'HL7 / FHIR Observation',scope:'Results, reference ranges, collection times',status:'Connected',sync:'41 minutes ago',records:'3,772'},
  {name:'Imaging',protocol:'DICOM / FHIR ImagingStudy',scope:'Study metadata and report text',status:'Degraded',sync:'4 hours ago',records:'612'},
  {name:'CDS Hooks',protocol:'CDS Hooks',scope:'Clinical decision-support information shown in the clinician’s EHR workflow for review',status:'Illustrative · not connected',sync:'Example only',records:'Example only'},
];
export const connectionDetail:Record<string,{endpoint:string;auth:string;volume:string;health:string}>={
  Tabia:{endpoint:'https://api.tabia.health/v3',auth:'OAuth 2.0 client credentials · rotated every 90 days',volume:'14,208 records · 312 in the last hour',health:'All checks passing · p95 latency 240 ms'},
  Epic:{endpoint:'SMART on FHIR R4 · launched from the encounter',auth:'SMART backend services · JWT assertion',volume:'Illustrative only · no EHR, including Epic, is connected',health:'Illustrative only · interoperability with Epic, Oracle Health (Cerner) and other EHRs is planned'},
  Laboratory:{endpoint:'HL7 v2 over MLLP, mapped to FHIR Observation',auth:'Mutual TLS · certificate expires 12 Mar 2027',volume:'3,772 results · 14 in the last hour',health:'All checks passing · p95 latency 1.2 s'},
  Imaging:{endpoint:'DICOMweb QIDO-RS / WADO-RS',auth:'Mutual TLS',volume:'612 studies · none in the last hour',health:'Degraded · retrying 3 failed study fetches since 05:40'},
  'CDS Hooks':{endpoint:'patient-view and order-select hooks',auth:'Signed JWT per invocation',volume:'Illustrative only · CDS Hooks runs inside an EHR, and no EHR is connected',health:'Illustrative only · no invocations'},
};
export const inboundFeed=[
  {time:'09:42',source:'Laboratory',kind:'Observation',detail:'HbA1c 7.4% collected 15 Sep 08:10 · matched to Lucas Hayes and filed against the diabetes context.'},
  {time:'09:31',source:'EHR (illustrative)',kind:'MedicationStatement',detail:'Atorvastatin 20 mg once daily arrived from primary care. Not on the workspace list, so it is flagged for reconciliation.'},
  {time:'09:28',source:'Tabia',kind:'CareEvent',detail:'Physiotherapy attendance recorded 14 Sep · linked to the pathway activity for Emma Carter.'},
  {time:'09:05',source:'Laboratory',kind:'DiagnosticReport',detail:'eGFR 62 mL/min/1.73m2, within range, surfaced to the renal dosing check on the PST candidate set.'},
  {time:'08:47',source:'EHR (illustrative)',kind:'AllergyIntolerance',detail:'Codeine, nausea and rash. Conflicts with the unverified workspace record, so both values are held for clinician review.'},
];
export const fieldMapping=[
  {source:'Observation.valueQuantity (mmol/mol)',target:'checkin.hba1c (%)',rule:'IFCC to DCCT conversion applied · mapping v4.2'},
  {source:'MedicationStatement.dosage.text',target:'medication.regimen',rule:'Parsed to dose, route and frequency · unparsed text retained verbatim'},
  {source:'Encounter.reasonCode',target:'Held, not discarded',rule:'No workspace equivalent · retained for review rather than dropped'},
  {source:'AllergyIntolerance (conflicting)',target:'Flagged for clinician',rule:'Never resolved automatically · both values shown with their sources'},
];
export const writeBackQueue=[
  {item:'Clinician decision and rationale · Emma Carter',target:'EHR encounter note (illustrative)',status:'Example · not sent'},
  {item:'Care plan and follow-up · Lucas Hayes',target:'Tabia care plan',status:'Sent 09:12'},
  {item:'Patient-reported outcomes · 11 patients',target:'Tabia observations',status:'Queued for 10:00'},
  {item:'Medication reconciliation · Priya Raman',target:'EHR medication list (illustrative)',status:'Awaiting sign-off'},
];

// 5. Validated instruments ---------------------------------------------------
// Subscale scores are fabricated for the prototype. Item wording is licensed
// content, delivered through the rights-holder's item bank, and is not reproduced.
export const instruments=[
  {code:'BPI',name:'Brief Pain Inventory',licence:'Licensed',administered:'14 Sep 2026',cadence:'Every 4 weeks',
   subscales:[{name:'Severity',score:'5.2 / 10',band:'Moderate'},{name:'Interference',score:'4.8 / 10',band:'Moderate'}]},
  {code:'PROMIS-29',name:'PROMIS-29 Profile v2.1',licence:'Public domain',administered:'14 Sep 2026',cadence:'Every 8 weeks',
   subscales:[{name:'Physical function',score:'38.4 T',band:'Below average'},{name:'Pain interference',score:'61.2 T',band:'Above average'},{name:'Sleep disturbance',score:'58.7 T',band:'Above average'},{name:'Fatigue',score:'56.1 T',band:'Average'},{name:'Anxiety',score:'52.3 T',band:'Average'},{name:'Depression',score:'49.8 T',band:'Average'},{name:'Social roles',score:'41.6 T',band:'Below average'}]},
  {code:'PEG',name:'Pain, Enjoyment, General activity',licence:'Licensed',administered:'15 Sep 2026',cadence:'Weekly',
   subscales:[{name:'Pain',score:'6 / 10',band:'Moderate'},{name:'Enjoyment of life',score:'5 / 10',band:'Moderate'},{name:'General activity',score:'5 / 10',band:'Moderate'},{name:'Composite',score:'5.3 / 10',band:'Moderate'}]},
  {code:'SOAPP-R',name:'Screener and Opioid Assessment for Patients with Pain, Revised',licence:'Licensed',administered:'28 Jul 2026',cadence:'At assessment',
   subscales:[{name:'Risk score',score:'14',band:'Below the 18 cut-point'}]},
  {code:'COMM',name:'Current Opioid Misuse Measure',licence:'Licensed',administered:'14 Sep 2026',cadence:'Every 12 weeks',
   subscales:[{name:'Misuse score',score:'6',band:'Below the 9 cut-point'}]},
];
export const instrumentShell=[
  {label:'Item content',value:'Held by the rights-holder and delivered through the licensed item bank. It is deliberately not reproduced in this prototype.'},
  {label:'Scoring',value:'Published algorithm per subscale. PROMIS is reported as a T-score against a mean of 50 and a standard deviation of 10.'},
  {label:'Interpretation',value:'Severity bands and cut-points come from each instrument’s own documentation, not from a choice made in the product.'},
  {label:'Change over time',value:'A change is only called meaningful once it exceeds the instrument’s minimal clinically important difference.'},
];

// 6. Care pathway X-1 --------------------------------------------------------
// Illustrative structure. The approved 29-step protocol was never supplied.
export const pathwayPhases=[
  {phase:'Referral and intake',steps:['Referral received and triaged','Eligibility and exclusion screen','Consent recorded','Baseline measurement set administered','Care team and coordinator assigned']},
  {phase:'Assessment',steps:['History and medication reconciliation','Pain presentation and distribution mapped','Comorbidity and risk screen','Function and sleep baseline','Patient goals recorded and agreed','Outstanding records requested']},
  {phase:'Clinical review and planning',steps:['Multidisciplinary review','Treatment strategy discussed with patient','Shared decision recorded','Care plan authored and owned','Monitoring cadence set','Escalation criteria agreed']},
  {phase:'Treatment and monitoring',steps:['Treatment initiated by prescriber','Early tolerability check','Scheduled outcome measurement','Adherence and side-effect review','Response assessed against goal','Plan continued, adjusted, or escalated','Interim concern pathway']},
  {phase:'Review and transition',steps:['Structured reassessment','Goal attainment reviewed','Taper or maintenance decision','Transition or discharge planning','Handover to primary care documented']},
];
export const stepDetail={
  owner:'Named in the approved protocol',
  entry:'Preceding step complete and its record signed off.',
  exit:'Required fields recorded and the clinician has confirmed them.',
  escalation:'Falls to the interim concern pathway if the patient reports a new problem.',
  automation:'Scheduled, reminded and marked complete through the execution partner.',
};
export const pathwayBranches=[
  {at:'Early tolerability check',condition:'Intolerable effect reported',action:'Routes to an expedited prescriber review within 48 hours instead of the next scheduled step.'},
  {at:'Response assessed against goal',condition:'Goal not met at twelve weeks',action:'Re-enters multidisciplinary review with the recorded response and adherence history attached.'},
  {at:'Interim concern pathway',condition:'Patient reports a new concern between steps',action:'Opens an out-of-band review and holds the scheduled sequence until a clinician responds.'},
];

// 7. MobileNetrix and devices ------------------------------------------------
export const deviceStreams=[
  {device:'Fitbit Charge 6',metric:'Steps and walking tolerance',value:'4,210 steps · 18 min continuous',note:'Continuous · data quality good on 13 of the last 14 days'},
  {device:'Withings Sleep',metric:'Sleep duration and interruptions',value:'6 h 12 m · 2 interruptions',note:'Complements the patient’s own sleep report rather than replacing it'},
  {device:'Omron home BP',metric:'Systolic / diastolic',value:'128 / 78 mmHg',note:'Cuff validated 02 Sep · calibration current'},
  {device:'Dexcom G7 (read-only)',metric:'Time in range',value:'68% within 70–180 mg/dL',note:'Read-only from the diabetes service, not managed here'},
];
export const notificationPlan=[
  {trigger:'Scheduled measurement due',channel:'Push',policy:'09:00 local · quiet hours 21:00–07:00 · at most one per day'},
  {trigger:'Missed measurement',channel:'Push, then SMS',policy:'Push at +4 hours, SMS at +24 hours, care-team task at +48 hours'},
  {trigger:'Care-team reply',channel:'Push',policy:'Delivery receipt required before the thread is marked answered'},
  {trigger:'Urgent concern acknowledged',channel:'Push',policy:'Never the only route · always paired with a care-team task'},
];

// 8. Reimbursement -----------------------------------------------------------
export const billingCodes=[
  {code:'99453 · Setup and patient education',requirement:'One-time per episode of care',accrued:'Completed 28 Jul 2026',status:'Eligible'},
  {code:'99454 · Device supply and transmission',requirement:'16 transmitting days per 30-day period',accrued:'21 of 16 days',status:'Eligible'},
  {code:'99457 · First interactive management',requirement:'20 clinician minutes per calendar month',accrued:'24 of 20 minutes',status:'Eligible'},
  {code:'99458 · Each additional 20 minutes',requirement:'Each further 20 clinician minutes',accrued:'4 of 20 minutes',status:'Not yet met'},
];
export const billingGuards=[
  'Payer rules change and vary by region, so the rule set is read from a maintained source rather than authored in the product.',
  'Accrued minutes come from identified clinician activity with an audit trail, never from an estimate.',
  'Eligibility shown here is a prompt for billing review, not a determination that a claim is payable.',
  'Where a code depends on licensed instrument content, the licence is verified before eligibility is asserted.',
];

// 9. Governance --------------------------------------------------------------
export const roleMatrix={
  permissions:['Read assigned patients','Read all patients','Record clinical decision','Change medication record','Manage pathway activities','Configure workspace features','Export records','View access log'],
  roles:[
    {role:'Pain physician',grants:[true,true,true,true,true,false,true,false]},
    {role:'Advanced practice provider',grants:[true,true,true,false,true,false,true,false]},
    {role:'RN care coordinator',grants:[true,false,false,false,true,false,false,false]},
    {role:'Patient',grants:[false,false,false,false,false,false,false,false]},
    {role:'Workspace administrator',grants:[false,false,false,false,false,true,true,true]},
  ],
};
export const consentRecords=[
  {scope:'Care delivery and record keeping',basis:'Provision of healthcare · recorded at intake',state:'Granted 28 Jul 2026'},
  {scope:'Remote monitoring and device data',basis:'Explicit consent · separable and revocable',state:'Granted 04 Aug 2026'},
  {scope:'Disclosure to a named third party',basis:'Per-recipient · time-bounded to 12 months',state:'Expires 04 Aug 2027'},
  {scope:'Secondary use for service improvement',basis:'Opt-in · separate from care delivery',state:'Declined 28 Jul 2026'},
];
export const disclosureLog=[
  {what:'Dr. Maya Chen read Emma Carter’s record',why:'15 Sep 09:34 · clinical review · consent: care delivery'},
  {what:'Taylor Reed, RN read 7 assigned records',why:'15 Sep 08:02 · care coordination · consent: care delivery'},
  {what:'Record export · Lucas Hayes to primary care',why:'14 Sep 16:20 · recipient recorded · consent: third-party disclosure'},
  {what:'Nightly reconciliation job read 11 records',why:'15 Sep 02:00 · service account · scoped to medication fields'},
];
