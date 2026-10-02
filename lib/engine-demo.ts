import {featureEnabled,type Patient,type Workspace} from './theranetrix';
import {activeMedications} from './medications';
import {visitObservations} from './visit-observations';
import {reviewedPlanTranslation} from './clinical-flows/patient-coordination';
import {ADVISOR_NAME,ADVISOR_SUMMARY_LABEL} from './product-names';
import {pstConditionMatch,pstPlainConditionMatch} from './pst-drugs';
// advisor-guide also imports this module; both only call each other inside functions.
import {advisorAnswerForQuestion,advisorAnswerText} from './advisor-guide';

export const engineVersion='connected-engine-v1';
const observationInputVersion='record-observations-v2';
export type EnginePreferences={relief:number;alertness:number;routine:number};
export const defaultEnginePreferences:EnginePreferences={relief:40,alertness:40,routine:20};
export type EngineCandidate={id:string;title:string;benefit:number;burden:number;routine:number;pstScore:number;shadowScore:number;reason:string;watch:string};
export type EngineSource={label:string;value:string;date:string};
export type EngineOutput={revision:string;version:string;patientId:string;preferences:EnginePreferences;sources:EngineSource[];gaps:string[];summary:string;signals:string[];points:{date:string;pain:number|null;target:number;scenario:number|null;low:number|null;high:number|null}[];candidates:EngineCandidate[];pstOrder:string[];shadowOrder:string[];agreement:boolean|null;enabled:{twin:boolean;pst:boolean;shadow:boolean;advisor:boolean};basis:string[];};
export type EngineRun=EngineOutput & {id:string;date:string;actor:string;releaseRef?:{releaseId:string;artifactVersion:number}};
/** Structured copy of the clinician's choice. Optional: older decisions carry only the approach title and free-text rationale. modelledDose is the example dose the comparison scores assume, not a dosing suggestion. labelStatus is prototype label data, stored with the marker "(prototype, clinician to verify)". priorTrials and clinicianExclusions are snapshots taken when the decision was made. */
export type EngineDecisionDetails={action?:'accept'|'modify'|'reject';optionId?:string;optionName?:string;modelledDose?:string;labelStatus?:string;priorTrials?:{name:string;stopReason:string}[];clinicianExclusions?:{name:string;reason:string}[]};
export type EngineDecision={id:string;runId:string;patientId:string;candidateId:string;title:string;rationale:string;patientPlan:string;owner:string;followup:string;date:string;actor:string;planId:string}&EngineDecisionDetails;
export type AdvisorTurn={id:string;patientId:string;date:string;patientText:string;reply:string;summary:string;intent:'progress'|'concern'|'plan'|'question';audience?:'clinician'|'patient';runId?:string;reviewId?:string;checkinId?:string;handoffId?:string};
const round=(n:number)=>Math.round(n*10)/10;
const clamp=(n:number)=>Math.max(0,Math.min(10,n));
function hash(value:unknown){let n=2166136261;for(const c of JSON.stringify(value))n=Math.imul(n^c.charCodeAt(0),16777619);return (n>>>0).toString(16).padStart(8,'0');}
// Identifiers (DOB, MRN) are not engine inputs, so recording or backfilling them keeps saved runs current.
// Age, which a DOB change recomputes, still counts. Undefined keys drop out of the JSON, so older revisions hold.
export function engineRecordRevision(p:Patient,w:Workspace){const {twinPreferences,...clinicalPatient}=p;return hash({version:engineVersion,observationInputVersion,patient:{...clinicalPatient,dateOfBirth:undefined,medicalRecordNumber:undefined,identityHistory:undefined},features:w.features,reviews:w.reviews.filter(r=>r.patientId===p.id),messages:w.messages.filter(m=>m.patientId===p.id),tasks:w.tasks.filter(t=>t.patientId===p.id&&t.workflowDomain!=='decisions'),advisor:w.advisorTurns?.filter(t=>t.patientId===p.id)});}
export function buildEngineOutput(p:Patient,w:Workspace,preferences:EnginePreferences=defaultEnginePreferences):EngineOutput{
  const enabled={twin:featureEnabled(w,'digitalTwin'),pst:featureEnabled(w,'pst'),shadow:featureEnabled(w,'shadow'),advisor:featureEnabled(w,'advisor')};
  const observations=visitObservations(p),latest=observations.at(-1),prior=observations.at(-2);
  const meds=activeMedications(p),last=latest?.pain,previous=prior?.pain,functionNow=latest?.function;
  const hasMeasurements=observations.some(row=>row.pain!==null||row.function!==null||row.sleep!==null);
  const effects=meds.some(m=>m.tolerability==='Effects reported'),helpful=meds.some(m=>m.benefit==='Helpful');
  const lastTurn=w.advisorTurns?.filter(t=>t.patientId===p.id).at(-1);
  const recentConcern=!!w.advisorTurns?.some(t=>t.patientId===p.id&&t.intent==='concern'&&w.reviews.some(r=>r.id===t.reviewId&&r.status!=='Resolved'));
  const worsening=last!=null&&previous!=null&&last>previous;
  const open=w.reviews.filter(r=>r.patientId===p.id&&r.status!=='Resolved');
  const gaps=[...(!hasMeasurements?['No observations recorded.']:[]),...(latest&&['pain','function','sleep'].some(key=>latest[key as 'pain'|'function'|'sleep']===null)?['The latest report has unanswered or declined measures. Older values are not used as current scores.']:[]),...(!meds.length&&!p.medicationReconciliation?.none?['Current medications are not reconciled.']:[]),...(p.clinicalContext?.allergyStatus!=='None reported'?['Allergies and reported reactions need clinician review.']:[]),'External records, labs, and drug-interaction checks are not connected.'];
  const signals=[...(effects?['Current medication report includes side effects.']:[]),...(worsening?['Pain rose since the previous check-in.']:[]),...(recentConcern?[`An unresolved ${ADVISOR_NAME} concern needs review.`]:[]),...(helpful?['Patient reports helpful medication.']:[]),...((functionNow??0)>=7?['Latest reported function is at least 7/10.']:[]),...(open.length?[`${open.length} unresolved care-team review item${open.length===1?'':'s'}.`]:[])];
  const total=preferences.relief+preferences.alertness+preferences.routine||1;
  const candidates:EngineCandidate[]=(!enabled.pst&&!enabled.shadow)||!hasMeasurements?[]:[
    {id:'review-current',title:'Review the current medication trial',benefit:effects?6:7,burden:effects?6:3,routine:8,pstScore:0,shadowScore:0,reason:meds.length?`${meds.map(m=>m.name+' is reported as '+m.benefit.toLowerCase()).join('; ')}. Weigh the recorded response against treatment burden.`:'Confirm the current treatment before comparing strategies.',watch:'Reconcile current use, tolerability, and missing clinical information.'},
    {id:'discuss-alternative',title:'Discuss an alternative with the prescriber',benefit:8,burden:3,routine:4,pstScore:0,shadowScore:0,reason:'Illustrates a different treatment strategy when relief or tolerability does not match the patient goal.',watch:'No alternative drug or dose is selected. Suitability is unknown until clinician assessment.'},
    {id:'monitor-plan',title:'Review progress on the agreed plan',benefit:helpful?8:4,burden:effects?6:2,routine:10,pstScore:0,shadowScore:0,reason:helpful?'Reported medication benefit supports reviewing the existing plan at follow-up. Check the recorded function separately.':'Use scheduled follow-up to clarify benefit, burden, and progress toward the goal.',watch:'A favorable score does not clear side effects, contraindications, or open concerns.'},
  ];
  for(const c of candidates){c.pstScore=Math.round((c.benefit*preferences.relief+(10-c.burden)*preferences.alertness+c.routine*preferences.routine)/total*10);c.shadowScore=c.pstScore;
    if(c.id==='review-current')c.shadowScore+=effects||worsening||recentConcern?25:0;
    if(c.id==='discuss-alternative')c.shadowScore+=effects?4:0;
    if(c.id==='monitor-plan')c.shadowScore+=(helpful&&!effects&&!worsening&&!recentConcern?12:0)-(worsening||recentConcern?25:0);
    c.shadowScore=Math.max(0,Math.min(100,c.shadowScore));}
  const ordered=(key:'pstScore'|'shadowScore')=>[...candidates].sort((a,b)=>b[key]-a[key]||a.id.localeCompare(b.id)).map(c=>c.id);
  const points:EngineOutput['points']=[];
  const firstPain=observations.find(row=>row.pain!==null)?.pain;
  if(enabled.twin&&firstPain!=null){const length=observations.length;
    observations.forEach((row,i)=>points.push({date:row.date,pain:row.pain,target:round(clamp(firstPain-3*i/Math.max(1,length-1))),scenario:i===length-1?row.pain:null,low:null,high:null}));
    // A missing latest pain answer cannot seed a forecast from a stale earlier value.
    if(last!=null&&latest){
      const slope=helpful&&!effects&&!recentConcern?-0.35:-0.12;
      for(let i=1;i<=3;i++){const d=new Date(latest.date.length===10?latest.date+'T12:00:00Z':latest.date);d.setUTCDate(d.getUTCDate()+7*i);const scenario=round(clamp(last+slope*i));points.push({date:d.toISOString().slice(0,10),pain:null,target:round(clamp(firstPain-3-0.3*i)),scenario,low:round(clamp(scenario-1.4)),high:round(clamp(scenario+1.4))});}
    }
  }
  const measure=(key:'pain'|'function'|'sleep')=>latest?.[key]!=null?latest[key]+'/10':latest?.statuses?.[key]??'not recorded';
  const sources:EngineSource[]=[{label:'Patient goal',value:p.goal||'Not recorded',date:''},...meds.map(m=>({label:m.name,value:`${m.benefit}; ${m.tolerability}; ${m.adherence}. ${m.effects}`,date:m.reportedAt})),...(enabled.twin?[{label:'Latest observations',value:latest?`Pain ${measure('pain')}; function ${measure('function')}; sleep ${measure('sleep')}. Source: ${latest.source}.`:'No observations recorded.',date:latest?.date??''}]:[]),...(lastTurn?[{label:ADVISOR_SUMMARY_LABEL,value:lastTurn.summary,date:lastTurn.date}]:[])];
  const pstOrder=enabled.pst?ordered('pstScore'):[],shadowOrder=enabled.shadow?ordered('shadowScore'):[];
  return {version:engineVersion,revision:engineRecordRevision(p,w),patientId:p.id,preferences:{...preferences},enabled,sources,gaps,signals,points,candidates,pstOrder,shadowOrder,agreement:pstOrder.length&&shadowOrder.length?pstOrder[0]===shadowOrder[0]:null,
    summary:effects||worsening||recentConcern?'Review treatment burden and the latest patient concerns before the next decision.':helpful?'Patient reports medication benefit. Review current function, goals, and any remaining concerns.':'Clarify response and patient priorities before deciding the next step.',
    basis:[`Observation inputs: ${observationInputVersion}. Current confirmed reports include partial answers and corrections; withdrawn entries are omitted. Missing latest measures are not filled from earlier reports.`,'Strategy profiles: benefit, burden, and routine values are program assumptions, not drug efficacy estimates.','PST utility = weighted benefit + low burden + routine fit, normalized to 100.','Shadow sorts the same strategy set by the PST utility plus record-rule adjustments: +25 for reviewing the current trial when effects, worsening, or a new concern are present; +4 for discussing alternatives with reported effects; +12 for monitoring when helpful without these concerns; -25 for monitoring with worsening or a new concern. Scores are bounded to 0–100.','The dashed target is a three-point reduction across the observed period. The future scenario changes pain by -0.35/week for helpful treatment without effects or a new concern, otherwise -0.12/week. The ±1.4 band is a scenario range, not a confidence interval.','These are two transparent rule sets, not independent clinical models or retrieved medical evidence.']};
}


export type TwinDomain={name:string;pct:number;note:string};
export type TwinCaution={title:string;body:string};
export type TwinSourceStatus={name:string;last:string;status:'Synced'|'Missing'|'Partial';detail:string};
export type TwinOverview={
  mrn:string;sex:string;iasp:string;comorbidities:string[];team:string;enrolled:string;
  /** `model` is a data-coverage label (how far apart the first and last reports are, and how many there are), not a model: no predictive model is connected. */
  days:number;ramp:number;model:string;
  /** `composite` is shown as “Twin summary (prototype)”: ((10 − pain) + function + sleep + inferred mood) ÷ 40 × 100, higher is better.
   * It is not the visit tab’s composite (pain · function · sleep, 0–10, higher is worse), and no screen calls it a composite. */
  domains:TwinDomain[];composite:number|null;
  scores:{pain:number|null;location:string;function:number|null;sleep:number|null;mood:number|null};
  cautions:TwinCaution[];sources:TwinSourceStatus[];
  events:{date:string;label:string;kind:'start'|'stop'}[];
};
function iaspSyndrome(condition:string){
  // Same wording rules as the example label map: “post herpetic” matches, “non-diabetic” does not.
  // Each term is read on its own: a negated or doubtful one ("no diabetic neuropathy", "suspected fibromyalgia", "PHN ruled
  // out") is not classified, and a qualifier about another condition ("diabetes ruled out") does not hide this one.
  const {matched}=pstConditionMatch(condition),plain=(pattern:RegExp)=>pstPlainConditionMatch(condition,pattern);
  if(matched.includes('phn'))return 'IASP I-2 · Peripheral neuropathic pain (postherpetic neuralgia)';
  if(matched.includes('dpn'))return 'IASP I-1 · Peripheral neuropathy (diabetic)';
  if(plain(/chemotherapy/))return 'IASP I-2 · Peripheral neuropathic pain (CIPN)';
  if(plain(/fibromyalgia/))return 'IASP II-1 · Chronic primary pain (fibromyalgia)';
  if(plain(/neuropath/))return 'IASP I-1 · Peripheral neuropathy';
  return 'IASP · '+condition;
}
/** How far apart the first and last reports are, and how many there are: a long span can hold only a few reports. */
export const twinDataLabel=(days:number,reports:number)=>reports<1?'No reports yet':reports===1?'1 report':`Reports span ${days>=30?'30+ days':'under 30 days'} (${reports} reports)`;
function sexFromPronouns(pronouns:string){
  const t=pronouns.toLowerCase();
  if(t.includes('she'))return 'Female';
  if(t.includes('he'))return 'Male';
  return 'Not recorded';
}
export function twinOverview(p:Patient):TwinOverview{
  const ctx=p.clinicalContext;
  const blob=[ctx?.medicalHistory,ctx?.psychologicalContext,ctx?.physicalContext,ctx?.socialContext,p.condition,...p.medications.map(m=>m.effects+' '+m.name)].join(' ').toLowerCase();
  const observations=visitObservations(p),latest=observations.at(-1);
  const first=observations[0]?.date,lastDate=latest?.date;
  const days=first&&lastDate?Math.max(1,Math.round((Date.parse(lastDate)-Date.parse(first))/86400000)+1):0;
  const selfReport=Math.min(100,Math.round(observations.filter(row=>row.pain!==null&&row.function!==null&&row.sleep!==null).length/7*100));
  const medsComplete=p.medications.some(m=>m.status==='Active'&&m.regimen)?90:p.medicationReconciliation?.none?80:20;
  const psycho=ctx?.psychologicalContext?70:15;
  const social=ctx?.socialContext?80:20;
  const ehr=10,devices=/diabet/.test(blob)?20:0;
  const mood=latest?.sleep!=null&&latest?.function!=null?clamp(round((latest.sleep+latest.function)/2+(/frustrat|discourag|low mood|depress/.test(blob)?-1.5:/confident|better mood/.test(blob)?1.2:0))):null;
  const comorbidities=[ctx?.medicalHistory,ctx?.painDuration].filter(Boolean).join(' ').split(/\. /).map(s=>s.replace(/\.$/,'').trim()).filter(s=>s.length>12).slice(0,3);
  // A caution states which rule matched and what to review. It never names a drug to choose or leave out: the clinician
  // decides, and PST shows its own flags and exclusions. Each sentence stands alone, so a quote cut at a sentence keeps its qualifier.
  const cautions:TwinCaution[]=[];
  const sleepWording=/insomnia|sleep|fragment/.test(blob),lowSleep=latest?.sleep!=null&&latest.sleep<=5?latest.sleep:null;
  if(/depress|low mood/.test(blob)&&(sleepWording||lowSleep!==null)&&/constipat/.test(blob)){
    // Names what matched: sleep wording, the latest sleep score, or both.
    cautions.push({title:'Profile caution',body:`Rule match: mood${sleepWording?', sleep':''} and constipation wording in the record${lowSleep!==null?`, with a latest sleep score of ${lowSleep}/10`:''}. Review this history before deciding.`});
  }
  const groggy=p.medications.filter(m=>/grogg(y|iness)/i.test(m.effects??''));
  if(groggy.length||/groggy|grogginess|sedat/.test(blob)){
    cautions.push({title:'Treatment-burden caution',body:`Rule match: ${groggy.length?'grogginess recorded with '+groggy.map(m=>`${m.name} (${m.status==='Stopped'?'stopped':'current'})`).join(', '):'grogginess or sedation wording in the record'}. Review alertness and sedation burden before deciding.`});
  }
  if(/diabet/.test(blob))cautions.push({title:'Metabolic context',body:'Rule match: diabetes wording in the record. Glucose, A1c and renal function are not in this chart; confirm them before any dose change.'});
  if(!cautions.length)cautions.push({title:'Record completeness',body:'Outside records, labs and device streams are not in this chart. Confirm contraindications before a medication change.'});
  const lastObs=lastDate??p.enrolled;
  return {
    mrn:p.id,sex:sexFromPronouns(p.pronouns),iasp:iaspSyndrome(p.condition),comorbidities:comorbidities.length?comorbidities:[p.condition],
    team:[p.clinician,ctx?.coordinator].filter(Boolean).join(' · '),enrolled:p.enrolled,days,ramp:30,model:twinDataLabel(days,observations.length),
    domains:[
      {name:'Self-report',pct:selfReport,note:observations.length?`${observations.length} check-ins`:'No check-ins'},
      {name:'Medications',pct:medsComplete,note:p.medications.filter(m=>m.status==='Active').map(m=>m.name).join(', ')||'Unreconciled'},
      {name:'Psycho screening',pct:psycho,note:ctx?.psychologicalContext?'Context recorded':'Not recorded'},
      {name:'Social / access',pct:social,note:ctx?.socialContext?'Support recorded':'Not recorded'},
      {name:'EHR / labs',pct:ehr,note:'Last sync not available'},
      {name:'Devices',pct:devices,note:/diabet/.test(blob)?'Glucose stream not connected':'No device stream'},
    ],
    composite:latest?.pain!=null&&latest?.function!=null&&latest?.sleep!=null&&mood!==null?Math.round((((10-latest.pain)+latest.function+latest.sleep+mood)/40)*100):null,
    scores:{pain:latest?.pain??null,location:ctx?.painLocation||'Not recorded',function:latest?.function??null,sleep:latest?.sleep??null,mood},
    cautions,
    sources:[
      {name:'MobileNetrix',last:lastObs,status:observations.length?'Synced':'Missing',detail:observations.length?'Pain, function and sleep check-ins.':'No self-report stream.'},
      {name:'EHR',last:'Never',status:'Missing',detail:'Problem list, labs and meds not imported.'},
      {name:'Devices',last:'Never',status:devices? 'Partial':'Missing',detail:/diabet/.test(blob)?'CGM expected for diabetic neuropathy; not connected.':'No wearable or CGM linked.'},
    ],
    events:p.medications.flatMap(m=>{
      const name=m.name.replace(/^Topical\s+/i,'').replace(/\s+\d+.*$/,'').trim();
      return [
        ...(m.started?[{date:m.started,label:`${name} started`,kind:'start' as const}]:[]),
        ...(m.stopped?[{date:m.stopped,label:`${name} stopped`,kind:'stop' as const}]:[]),
      ];
    }),
  };
}

export function advisorReply(p:Patient,w:Workspace,intent:AdvisorTurn['intent'],patientText:string,concernUrgency?:'routine'|'urgent',language?:'en'|'es',audience:'clinician'|'patient'='patient'){
  const spanish=(language??p.preferredLanguage)==='es',plan=p.carePlans[0],firstName=p.name.split(' ')[0];
  const queueStatus=spanish
    ?`Tu solicitud${concernUrgency==='urgent'?' marcada como urgente':''} quedó guardada en la lista de revisión de este espacio para que una persona del equipo la revise. Aún no se ha confirmado que el equipo la haya recibido.`
    :`Your request${concernUrgency==='urgent'?' marked urgent':''} is saved in this workspace’s care-team review queue for a human response. Receipt by your care team has not been confirmed.`;
  const extraReview=concernUrgency==='urgent'?'\n'+queueStatus:'';
  // Clinician questions use the one advisor rubric (lib/advisor-guide.ts), so a typed answer matches
  // the suggested question and Show me link the dock offers for the same topic.
  if(audience==='clinician')return {reply:advisorAnswerText(advisorAnswerForQuestion(p,w,patientText)),summary:'Clinician question: '+patientText};
  if(intent==='concern')return {
    reply:spanish?`Gracias por contármelo, ${firstName}. ${queueStatus} ¿Qué cambió y cuándo empezó? Este mensaje no cambia ningún medicamento.`:`Thank you for telling me, ${firstName}. ${queueStatus} What changed, and when did it start? No medication is changed by this message.`,
    summary:'Patient reported a concern: '+patientText,
  };
  if(intent==='plan'){
    if(!plan)return {reply:(spanish?'Todavía no hay un plan de atención guardado. Puedes pedirle a tu equipo que acuerden los próximos pasos.':'There is no saved care plan yet. You can ask your care team to agree on the next steps.')+extraReview,summary:'Patient asked to review the saved care plan: '+patientText};
    const translation=spanish?reviewedPlanTranslation(w.clinicalWorkflows?.slices['patient-coordination'].state,p.id,plan.id,plan.workflowVersion??1,'es'):undefined;
    const instructions=spanish
      ?translation?`Tu plan de atención: ${translation.translatedText}\nTraducción de la versión ${plan.workflowVersion??1} revisada por ${translation.translationReviewer}.`:`La traducción al español de este plan todavía necesita revisión. Puedes pedir ayuda con el idioma a tu equipo.\nPlan guardado en su idioma original: ${plan.text}`
      :`Your saved care plan: ${plan.text}`;
    const followup=plan.followup?[plan.followup,plan.time,plan.timezone].filter(Boolean).join(' '):spanish?'Fecha pendiente':'Date not recorded';
    const schedule=spanish
      ?`${plan.appointmentBooked===true?'Cita registrada':'Seguimiento solicitado; cita sin confirmar'}: ${followup}. Responsable: ${plan.owner}. ¿Qué te gustaría que tu equipo aclare?`
      :`${plan.appointmentBooked===true?'Recorded appointment':'Follow-up requested; appointment not confirmed'}: ${followup}, with ${plan.owner}. What would you like your team to clarify?`;
    return {reply:instructions+'\n'+schedule+extraReview,summary:'Patient asked to review the saved care plan: '+patientText};
  }
  if(intent==='progress')return {
    reply:(spanish?`Gracias, ${firstName}. Guardamos tu mensaje junto a tu objetivo, en sus palabras originales: “${p.goal}”. ¿Qué te resultó más fácil hoy? ¿Qué siguió siendo difícil?`:`Thanks, ${firstName}. Your update is recorded against your goal: “${p.goal}”. What felt easier today, and was anything still difficult?`)+extraReview,
    summary:'Patient shared progress: '+patientText,
  };
  const fromRecord=answerFromRecord(p,patientText,spanish);
  return {reply:(fromRecord??(spanish?'Puedo ayudarte a registrar cómo vas, consultar tu plan guardado o anotar una preocupación para tu equipo. ':'I can help you record progress, review your saved plan, or record a concern for your care team. '))+'\n'+queueStatus,summary:'Patient asked a question: '+patientText};
}

export function inferAdvisorIntent(text:string):{intent:AdvisorTurn['intent'];concernUrgency:'routine'|'urgent'}{
  const t=text.toLowerCase();
  const concernUrgency=/\b(urgent|immediately|right now|ahora|urgente)\b/.test(t)?'urgent':'routine';
  if(/\b(worsen\w*|worse|side effects?|groggy|grogginess|difficult\w*|worried|concern\w*|please review|need help|dificultad\w*|preocup\w*)\b/.test(t))return {intent:'concern',concernUrgency};
  if(/\b((my|the|care|mi|el) plan|follow-?ups?|appointments?|citas?)\b/.test(t))return {intent:'plan',concernUrgency};
  if(/\b(today was|how i('ve| have) been|progress update|i was able|cómo me ha ido)\b/.test(t))return {intent:'progress',concernUrgency};
  return {intent:'question',concernUrgency};
}

// Patient questions only; clinician questions use the rubric in advisor-guide.ts. Replies restate the
// patient's own record in their language and never show engine rankings or care-team internals.
const benefitEs={'Not assessed':'beneficio por revisar','Helpful':'te ayuda','Partly helpful':'te ayuda en parte','No benefit':'sin beneficio'} as const;
const tolerabilityEs={'Not assessed':'efectos por revisar','No effects reported':'sin efectos secundarios registrados','Effects reported':'efectos secundarios registrados'} as const;
const adherenceEs={'Not assessed':'uso por revisar','Taken as recorded':'lo tomas como está registrado','Missed doses':'dosis olvidadas','Not taking':'no lo estás tomando'} as const;
function answerFromRecord(p:Patient,text:string,spanish:boolean){
  const t=text.toLowerCase();
  const meds=activeMedications(p);
  if(/\b(dos(e|es|age|ing|is)|double|taper\w*|refill\w*|missed)\b/.test(t)){
    const regimen=meds.length?meds.map(m=>`${m.name}: ${m.regimen||(spanish?'pauta no registrada':'regimen not recorded')}`).join('; '):(spanish?'No hay medicación activa registrada.':'No active medication is recorded.');
    return spanish
      ?`Puedo repetir la pauta escrita, no cambiarla. ${regimen} Ningún cambio de dosis se hace aquí.`
      :`I can only restate the written schedule. ${regimen} No dose change is made here.`;
  }
  if(/\b(shadow|pst|rank\w*|desacuer\w*|clasificaci\w*)\b/.test(t))return spanish?'Tu equipo de atención revisa contigo las opciones de tratamiento. Aquí no se comparan ni se eligen tratamientos.':'Your care team reviews treatment options with you. Treatments are not compared or chosen here.';
  // JavaScript \b is ASCII-only, so "sueño" (ending in ñ) sits outside the bounded group.
  if(/\b(twin|pain|trajector\w*|trayector\w*|function\w*|sleep\w*|dolor\w*|funci[oó]n)\b|\bsueño/.test(t)){
    const observations=visitObservations(p),latest=observations.at(-1),first=observations[0];
    const missing=spanish?'sin respuesta':'not answered';
    const score=(value:number|null|undefined)=>value!=null?value+' /10':missing;
    return spanish
      ?`Registro de ${p.name}: dolor ${score(first?.pain)} → ${score(latest?.pain)}. Función ${score(latest?.function)}. Sueño ${score(latest?.sleep)}. Último registro: ${latest?.date??'sin registro'}. Objetivo: ${p.goal}. Observaciones actuales de este paciente.`
      :`Recorded for ${p.name}: pain ${score(first?.pain)} → ${score(latest?.pain)}. Function ${score(latest?.function)}. Sleep ${score(latest?.sleep)}. Latest report: ${latest?.date??'not recorded'}. Goal: ${p.goal}. Current recorded observations for this patient.`;
  }
  if(/\b(medicat\w*|medicament\w*|medicin\w*|gabapentin\w*|duloxetin\w*)\b/.test(t)){
    if(!meds.length)return spanish?'No hay medicación activa registrada.':'No active medication is recorded.';
    return meds.map(m=>spanish?`${m.name}: ${benefitEs[m.benefit]}; ${tolerabilityEs[m.tolerability]}; ${adherenceEs[m.adherence]}.${m.effects?' '+m.effects:''}`:`${m.name}: ${m.benefit}; ${m.tolerability}; ${m.adherence}. ${m.effects}`).join('\n');
  }
  if(/\b(goals?|objetivos?)\b/.test(t))return (spanish?'Objetivo del paciente: ':'Patient goal: ')+p.goal;
  return null;
}

