import {pstDrugs} from './pst-drugs';
import type {Patient} from './theranetrix';

// What a patient tells us about medicines before a visit: ones they cannot take, ones
// they tried and how it went, and anything they take that is not on the record. The
// answers travel inside the check-in note in a fixed line format so the clinician view
// can list them, and they stay patient-reported until a clinician verifies them.
// Kinds (sleep or anxiety medicine, supplement, ...) are chosen by the patient, never
// inferred from a name, and a medicine the patient cannot name is kept as described.

export type CannotTakeReason='Allergic reaction'|'Bad side effect'|'Told not to take it'|'Other';
export type TriedOutcome='Helped'|'Helped a little'|'Did not help'|'Not sure';
export type IntakeCategory='sleep-anxiety'|'supplement'|'herbal'|'food-drink'|'other';
/** A medicine the patient cannot name, as they describe it. Nothing here is matched to a drug. */
export type Unidentified={form:string;color:string;imprint:string;usedFor:string;source:string};
export type CannotTake={name:string;reason:CannotTakeReason|'';details:string;unknown?:Unidentified};
export type Tried={name:string;outcome:TriedOutcome|'';effects:string[];stopped:string;unknown?:Unidentified};
export type TakingNow={name:string;dose:string;category?:IntakeCategory|'';unknown?:Unidentified};
export type YesNo='yes'|'no'|'unsure'|'';
export type AffectingFactor='Stress'|'Work'|'Sleep problems'|'Money worries'|'Family or support'|'Activity';
export type AffectingPain={factors:AffectingFactor[];words:string;declined:boolean};
export type MedicationReport={cannotTakeAnswer:YesNo;triedAnswer:YesNo;cannotTake:CannotTake[];tried:Tried[];takingNow:TakingNow[]};

export const cannotTakeReasons:CannotTakeReason[]=['Allergic reaction','Bad side effect','Told not to take it','Other'];
export const triedOutcomes:TriedOutcome[]=['Helped','Helped a little','Did not help','Not sure'];
export const sideEffectOptions=['None','Drowsy or groggy','Dizzy','Upset stomach','Constipation','Skin irritation','Weight gain','Trouble thinking','Other'];
export const emptyMedicationReport=():MedicationReport=>({cannotTakeAnswer:'',triedAnswer:'',cannotTake:[],tried:[],takingNow:[]});
export const intakeCategories:IntakeCategory[]=['sleep-anxiety','supplement','herbal','food-drink','other'];
export const intakeCategoryLabels:Record<IntakeCategory,string>={'sleep-anxiety':'Sleep or anxiety medicine',supplement:'Supplement or vitamin',herbal:'Herbal or CBD product','food-drink':'Food or drink',other:'Other'};
export const medicineForms=['Pill','Capsule','Patch','Cream or gel','Liquid','Injection','Inhaler'];
export const emptyUnidentified=():Unidentified=>({form:'',color:'',imprint:'',usedFor:'',source:''});
export const affectingFactors:AffectingFactor[]=['Stress','Work','Sleep problems','Money worries','Family or support','Activity'];
export const emptyAffectingPain=():AffectingPain=>({factors:[],words:'',declined:false});

// Everyday names patients recognise, keyed by the library name used in the record.
const everydayNames:Record<string,string>={
  'Gabapentin':'Gabapentin (Neurontin)','Pregabalin':'Pregabalin (Lyrica)','Duloxetine':'Duloxetine (Cymbalta)','Venlafaxine':'Venlafaxine (Effexor)',
  'Nortriptyline':'Nortriptyline (Pamelor)','Amitriptyline':'Amitriptyline (Elavil)','Lidocaine 5% patch':'Lidocaine patch (Lidoderm)','Capsaicin 8% patch':'Capsaicin patch (Qutenza)',
  'Tramadol':'Tramadol (Ultram)','Tapentadol ER':'Tapentadol (Nucynta)','Oxycodone ER':'Oxycodone (OxyContin)','Carbamazepine':'Carbamazepine (Tegretol)',
};
const everydayPainRelief=['Ibuprofen (Advil, Motrin)','Naproxen (Aleve)','Acetaminophen (Tylenol)','Aspirin'];
const commonAllergies=['Penicillin','Sulfa drugs','Codeine','Morphine','Aspirin','Ibuprofen (Advil, Motrin)'];
const displayName=(name:string)=>everydayNames[name]??name;
// The active ingredient is the first word that is not a form: "Topical lidocaine" and "Lidocaine patch (Lidoderm)" are one medicine.
export const baseName=(name:string)=>name.toLowerCase().replace(/\(.*?\)/g,' ').split(/[^a-z]+/).find(word=>word&&!['topical','oral','extended','release','er','sr','cream','gel','patch'].includes(word))??name.toLowerCase();
// One entry per medicine: the first spelling wins, so a name from the patient's own record is kept.
const unique=(names:string[])=>{const seen=new Set<string>();return names.filter(name=>{const key=baseName(name);if(!name||seen.has(key))return false;seen.add(key);return true;});};

/** Options relevant to this patient: their own record first, then their condition, then everyday medicines. */
export function medicationChoices(p:Patient){
  const stopped=p.medications.filter(m=>m.status==='Stopped').map(m=>m.name);
  // Medicines already current are not "tried before"; one medicine appears once under its everyday name.
  const current=new Set(p.medications.filter(m=>m.status==='Active').map(m=>baseName(m.name)));
  const condition=pstDrugs.filter(row=>row.kind==='drug').map(row=>displayName(row.name));
  const reactions=p.clinicalContext?.allergyStatus==='Reactions reported'?(p.clinicalContext.allergies.match(/^[^:;,.]+/)?.[0].trim()??''):'';
  return {
    fromRecord:unique([...stopped,...(reactions?[reactions]:[])]),
    tried:unique([...stopped,...condition,...everydayPainRelief]).filter(name=>!current.has(baseName(name))),
    cannotTake:unique([...(reactions?[reactions]:[]),...stopped,...commonAllergies,...condition]),
  };
}

const clean=(text:string)=>text.replace(/[\n\r]+/g,' ').replace(/\s*·\s*/g,', ').trim();
export const cannotTakePrefix='Cannot take (patient-reported)';
export const triedPrefix='Tried before (patient-reported)';
export const takingNowPrefix='Taking now, not on record (patient-reported)';
export const unidentifiedPrefix='Unidentified medicine (patient-reported)';
export const affectingPainPrefix='Also affecting pain (patient-reported)';
// "Other" and rows with no kind chosen keep the original taking-now line.
export const categoryPrefixes:Record<Exclude<IntakeCategory,'other'>,string>={'sleep-anxiety':'Sleep or anxiety medicine (patient-reported)',supplement:'Supplement or vitamin (patient-reported)',herbal:'Herbal or CBD product (patient-reported)','food-drink':'Food or drink (patient-reported)'};
const described=(row:{name:string;unknown?:Unidentified})=>!!row.unknown||!!row.name.trim();
// Only what the patient entered is written; the description is never looked up against a drug list.
const unidentifiedLine=(asked:string,unknown:Unidentified,rest:string[])=>[`${unidentifiedPrefix}: Name not known`,`Asked under: ${asked}`,
  ...([['Form',unknown.form],['Color',unknown.color],['Letters or numbers on it',unknown.imprint],['Used for',unknown.usedFor],['Prescriber or pharmacy',unknown.source]] as const).filter(([,value])=>clean(value)).map(([label,value])=>`${label}: ${clean(value)}`),...rest].join(' · ');

/** One line per medicine, readable on its own and parseable by the clinician view. */
export function medicationReportNote(report:MedicationReport):string{
  const listed=(answer:YesNo,rows:{name:string;unknown?:Unidentified}[])=>answer==='yes'&&rows.some(described);
  const cannotTake=(row:CannotTake)=>[`Reason: ${row.reason||'Not given'}`,`What happened: ${clean(row.details)||'Not given'}`];
  const tried=(row:Tried)=>[`Helped: ${row.outcome||'Not given'}`,`Side effects: ${row.effects.length?row.effects.join(', '):'Not given'}`,`Why stopped: ${clean(row.stopped)||'Not given'}`];
  const amount=(row:TakingNow)=>`${row.category==='food-drink'?'How much':'Dose'}: ${clean(row.dose)||'Not given'}`;
  return [
    ...(!listed(report.cannotTakeAnswer,report.cannotTake)&&report.cannotTakeAnswer?[`${cannotTakePrefix}: ${report.cannotTakeAnswer==='no'?'None':report.cannotTakeAnswer==='yes'?'Yes, not named':'Not sure'}`]:[]),
    ...(!listed(report.triedAnswer,report.tried)&&report.triedAnswer?[`${triedPrefix}: ${report.triedAnswer==='no'?'None':report.triedAnswer==='yes'?'Yes, not named':'Not sure'}`]:[]),
    ...(report.cannotTakeAnswer==='yes'?report.cannotTake:[]).filter(described).map(row=>row.unknown?unidentifiedLine('Cannot take',row.unknown,cannotTake(row)):[`${cannotTakePrefix}: ${clean(row.name)}`,...cannotTake(row)].join(' · ')),
    ...(report.triedAnswer==='yes'?report.tried:[]).filter(described).map(row=>row.unknown?unidentifiedLine('Tried before',row.unknown,tried(row)):[`${triedPrefix}: ${clean(row.name)}`,...tried(row)].join(' · ')),
    ...report.takingNow.filter(described).map(row=>row.unknown?unidentifiedLine('Taking now',row.unknown,[...(row.category?[`Kind: ${intakeCategoryLabels[row.category]}`]:[]),...(row.name.trim()?[`Name as typed: ${clean(row.name)}`]:[]),amount(row)])
      :`${row.category&&row.category!=='other'?categoryPrefixes[row.category]:takingNowPrefix}: ${clean(row.name)} · ${amount(row)}`),
  ].join('\n');
}
export const hasMedicationReport=(report:MedicationReport)=>medicationReportNote(report).length>0;

/** The optional "What else is affecting your pain lately?" answer, in the patient's own choices and words. */
export function affectingPainNote(answer:AffectingPain):string{
  if(answer.declined)return `${affectingPainPrefix}: Prefer not to answer`;
  const words=clean(answer.words);
  if(!answer.factors.length)return words?`${affectingPainPrefix}: ${words}`:'';
  return `${affectingPainPrefix}: ${answer.factors.join(', ')}${words?` · In their words: ${words}`:''}`;
}

export type ReportedLineKind='cannot-take'|'tried'|'taking-now'|Exclude<IntakeCategory,'other'>|'unidentified'|'affecting-pain';
export type ReportedMedicationLine={kind:ReportedLineKind;name:string;details:{label:string;value:string}[]};
const linePrefixes:[string,ReportedLineKind][]=[[cannotTakePrefix,'cannot-take'],[triedPrefix,'tried'],[takingNowPrefix,'taking-now'],...(Object.entries(categoryPrefixes) as [Exclude<IntakeCategory,'other'>,string][]).map(([kind,prefix]):[string,ReportedLineKind]=>[prefix,kind]),[unidentifiedPrefix,'unidentified'],[affectingPainPrefix,'affecting-pain']];
/** Read the lines back out of a saved check-in note. Other note text is ignored. */
export function parseMedicationReport(note:string):ReportedMedicationLine[]{
  return note.split('\n').flatMap(line=>{
    const kind=linePrefixes.find(([prefix])=>line.startsWith(prefix+':'))?.[1];
    if(!kind)return [];
    const [first,...rest]=line.slice(line.indexOf(':')+1).split(' · ');
    return [{kind,name:first.trim(),details:rest.map(part=>{const at=part.indexOf(':');return {label:part.slice(0,at).trim(),value:part.slice(at+1).trim()};}).filter(detail=>detail.value&&detail.value!=='Not given')}];
  });
}

/** Clinician-facing name for every patient-reported line kind, in display order. Kinds are the patient's own choice. */
export const reportedKindLabels:Record<ReportedLineKind,string>={'cannot-take':'Cannot take',tried:'Tried before','taking-now':'Taking now, not on the record','sleep-anxiety':'Sleep or anxiety medicine',supplement:'Supplement or vitamin',herbal:'Herbal or CBD product','food-drink':'Food or drink',unidentified:'Needs identification','affecting-pain':'Also affecting pain'};
export const reportedKinds=Object.keys(reportedKindLabels) as ReportedLineKind[];
const summaryAnswer:Record<string,Exclude<YesNo,''>>={'None':'no','Yes, not named':'yes','Not sure':'unsure'};
/** Answers that name nothing: a "None", "Yes, not named" or "Not sure" summary, or a declined "affecting pain" question. */
export const summaryAnswers=[...Object.keys(summaryAnswer),'Prefer not to answer'];
export type ReportedGroup={kind:ReportedLineKind;label:string;rows:(ReportedMedicationLine&{summary:boolean})[];named:number;alsoNone:boolean};
/** Every patient-reported line in a note, grouped by kind in display order with the kind's label. `named` counts rows
 *  that name or describe something; `alsoNone` marks a group where a "None" sits beside named rows, for the clinician to confirm. */
export function reportedMedicineGroups(note:string):ReportedGroup[]{
  const lines=parseMedicationReport(note).map(line=>({...line,summary:!line.details.length&&summaryAnswers.includes(line.name)}));
  return reportedKinds.flatMap(kind=>{const rows=lines.filter(line=>line.kind===kind),named=rows.filter(row=>!row.summary).length;return rows.length?[{kind,label:reportedKindLabels[kind],rows,named,alsoNone:named>0&&rows.some(row=>row.summary&&row.name==='None')}]:[];});
}

const categoryByLabel=Object.fromEntries(intakeCategories.map(category=>[intakeCategoryLabels[category],category])) as Record<string,IntakeCategory>;
/** The saved lines back as the answers the companion form shows, so an update edits what was sent instead of adding
 *  to it. A named medicine wins over a "None" or "Not sure" for the same question, the newest answer for one medicine
 *  or for "affecting pain" wins, and a line that would not be written back exactly is kept as sent. */
export function medicationAnswersFromNote(note:string):{report:MedicationReport;affecting:AffectingPain;kept:string[]}{
  const report=emptyMedicationReport(),kept:string[]=[],said:{cannotTakeAnswer?:YesNo;triedAnswer?:YesNo}={};let affecting=emptyAffectingPain();
  const named=<T extends {name:string;unknown?:Unidentified}>(rows:T[],row:T)=>[...rows.filter(item=>row.unknown||item.unknown||item.name.toLowerCase()!==row.name.toLowerCase()),row];
  for(const line of note.split('\n')){
    const item=parseMedicationReport(line)[0];if(!item)continue;
    const value=(label:string)=>item.details.find(detail=>detail.label===label)?.value??'',asked=item.kind==='unidentified'?value('Asked under'):'';
    const unknown=item.kind==='unidentified'?{unknown:{form:value('Form'),color:value('Color'),imprint:value('Letters or numbers on it'),usedFor:value('Used for'),source:value('Prescriber or pharmacy')}}:{};
    const summary=line.includes(' · ')||!Object.hasOwn(summaryAnswer,item.name)?undefined:summaryAnswer[item.name];
    let written='',apply=()=>{};
    if(item.kind==='affecting-pain'){
      const parts=item.name.split(', '),answer:AffectingPain=item.name==='Prefer not to answer'&&!item.details.length?{factors:[],words:'',declined:true}
        :parts.every(part=>affectingFactors.includes(part as AffectingFactor))?{factors:parts as AffectingFactor[],words:value('In their words'),declined:false}:{factors:[],words:item.name,declined:false};
      written=affectingPainNote(answer);apply=()=>{affecting=answer;};
    }else if((item.kind==='cannot-take'||item.kind==='tried')&&summary){
      const key=item.kind==='cannot-take'?'cannotTakeAnswer':'triedAnswer';
      written=medicationReportNote({...emptyMedicationReport(),[key]:summary});apply=()=>{said[key]=summary;};
    }else if(item.kind==='cannot-take'||asked==='Cannot take'){
      const row:CannotTake={name:asked?'':item.name,reason:value('Reason') as CannotTakeReason,details:value('What happened'),...unknown};
      written=medicationReportNote({...emptyMedicationReport(),cannotTakeAnswer:'yes',cannotTake:[row]});apply=()=>{report.cannotTake=named(report.cannotTake,row);};
    }else if(item.kind==='tried'||asked==='Tried before'){
      const row:Tried={name:asked?'':item.name,outcome:value('Helped') as TriedOutcome,effects:value('Side effects')?value('Side effects').split(', '):[],stopped:value('Why stopped'),...unknown};
      written=medicationReportNote({...emptyMedicationReport(),triedAnswer:'yes',tried:[row]});apply=()=>{report.tried=named(report.tried,row);};
    }else{
      const category:IntakeCategory|''=asked?Object.hasOwn(categoryByLabel,value('Kind'))?categoryByLabel[value('Kind')]:'':item.kind==='taking-now'||item.kind==='unidentified'?'':item.kind;
      const row:TakingNow={name:asked?value('Name as typed'):item.name,dose:value(category==='food-drink'?'How much':'Dose'),category,...unknown};
      written=medicationReportNote({...emptyMedicationReport(),takingNow:[row]});apply=()=>{report.takingNow.push(row);};
    }
    if(written===line)apply();else kept.push(line);
  }
  report.cannotTakeAnswer=report.cannotTake.length?'yes':said.cannotTakeAnswer??'';
  report.triedAnswer=report.tried.length?'yes':said.triedAnswer??'';
  return {report,affecting,kept};
}
