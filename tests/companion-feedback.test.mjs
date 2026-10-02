import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Companion feedback: other things the patient takes (F36), medicines they cannot name (F37),
// the daily quick check-in (F39) and what the patient's progress view never shows (F45).
const bundle=await build({stdin:{contents:"export {seedWorkspace} from './lib/theranetrix';export {applyAction,actionSchema} from './lib/actions';export * from './lib/patient-medication-report';export * from './lib/patient-checkin-note';export {PatientCheckin,PatientResponseHistory} from './components/theranetrix/patient-checkin';export {CompanionMedicationQuestions} from './components/theranetrix/companion-medication-questions';export {EncounterReview} from './components/theranetrix/encounter-review';export {CompanionProgress,PatientCompanionLanguage} from './components/theranetrix/workflows';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false,plugins:[{name:'css-rendering',setup(builder){builder.onLoad({filter:/\.css$/},()=>({contents:'export default {}',loader:'js'}));}}]});
const require=createRequire(process.cwd()+'/package.json');
function load(react=React){const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(name=>name==='react'?react:require(name),mod,mod.exports);return mod.exports;}
const {seedWorkspace,applyAction,actionSchema,emptyMedicationReport,emptyUnidentified,emptyAffectingPain,medicationReportNote,parseMedicationReport,affectingPainNote,mergeCheckinNote,noteMood,noteLocation,noteCheckinMode,noteOwnWords,checkinNote,readCheckinNote,checkinReadback,reportedMedicineGroups,reportedKindLabels,PatientCheckin,PatientResponseHistory,CompanionMedicationQuestions,EncounterReview,CompanionProgress,PatientCompanionLanguage}=load();
const patientId='TN-DEMO-01';
const ctx=(data,save=async()=>true)=>({data,user:'Patient companion',busy:false,save,open:()=>{}});
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
function selfReport(w,{note,pain=7,sleep=5,at,id=crypto.randomUUID()}){
  const entries=[{metric:'pain',status:'answered',value:pain},{metric:'function',status:'unanswered'},{metric:'sleep',status:'answered',value:sleep}].map(entry=>({...entry,source:'Patient self-report',recordedAt:at}));
  const command={type:'encounters.observations.save',requestId:id,patientId,encounterId:'checkin-'+id,instrument:'local-0-10',submissionStatus:'confirmed',submissionSource:'patient-self-report',patientNote:note,entries};
  return applyAction(w,actionSchema.parse({type:'workflow.apply',domain:'encounters',patientId,requestId:id,expectedSliceVersion:w.clinicalWorkflows.slices.encounters.version,command}),'Patient companion',at);
}

test('other things the patient takes keep the kind the patient chose and read back by kind',()=>{
  const report={...emptyMedicationReport(),takingNow:[{name:'Melatonin',dose:'3 mg at night',category:'supplement'},{name:'Grapefruit juice',dose:'A glass most mornings',category:'food-drink'},{name:'Sleep aid from urgent care',dose:'',category:'sleep-anxiety'},{name:'CBD gummies',dose:'',category:'herbal'},{name:'Heat wrap',dose:'',category:'other'},{name:'Ibuprofen',dose:'',category:''}]};
  const note=medicationReportNote(report);
  for(const line of ['Supplement or vitamin (patient-reported): Melatonin · Dose: 3 mg at night','Food or drink (patient-reported): Grapefruit juice · How much: A glass most mornings','Sleep or anxiety medicine (patient-reported): Sleep aid from urgent care · Dose: Not given','Herbal or CBD product (patient-reported): CBD gummies · Dose: Not given','Taking now, not on record (patient-reported): Heat wrap · Dose: Not given','Taking now, not on record (patient-reported): Ibuprofen · Dose: Not given'])assert.ok(note.split('\n').includes(line),line);
  assert.deepEqual(parseMedicationReport(note).map(line=>line.kind),['supplement','food-drink','sleep-anxiety','herbal','taking-now','taking-now']);
  assert.doesNotMatch(note,/interaction|contraindicat/i);
});

test('a medicine the patient cannot name is kept exactly as described and never matched to a drug',()=>{
  const report={...emptyMedicationReport(),cannotTakeAnswer:'yes',triedAnswer:'yes',
    cannotTake:[{name:'',reason:'Bad side effect',details:'Dizzy',unknown:{form:'Capsule',color:'white and blue',imprint:'M 365',usedFor:'back pain',source:'Dr. Lee · Main St pharmacy'}}],
    tried:[{name:'',outcome:'Did not help',effects:[],stopped:'',unknown:{...emptyUnidentified(),form:'Patch'}}],
    takingNow:[{name:'gabapenton',dose:'',category:'',unknown:emptyUnidentified()}]};
  const note=medicationReportNote(report),lines=note.split('\n');
  assert.equal(lines[0],'Unidentified medicine (patient-reported): Name not known · Asked under: Cannot take · Form: Capsule · Color: white and blue · Letters or numbers on it: M 365 · Used for: back pain · Prescriber or pharmacy: Dr. Lee, Main St pharmacy · Reason: Bad side effect · What happened: Dizzy');
  assert.equal(lines[1],'Unidentified medicine (patient-reported): Name not known · Asked under: Tried before · Form: Patch · Helped: Did not help · Side effects: Not given · Why stopped: Not given');
  assert.equal(lines[2],'Unidentified medicine (patient-reported): Name not known · Asked under: Taking now · Name as typed: gabapenton · Dose: Not given','The typed spelling is kept, not corrected');
  assert.equal(lines.length,3,'An undescribed medicine counts as an answer, so no "Yes, not named" line is added');
  const parsed=parseMedicationReport(note);
  assert.deepEqual(parsed.map(line=>line.kind),['unidentified','unidentified','unidentified']);
  assert.deepEqual(parsed[2].details,[{label:'Asked under',value:'Taking now'},{label:'Name as typed',value:'gabapenton'}]);
});

test('what else is affecting pain is optional, can be declined, and keeps the patient’s words',()=>{
  assert.equal(affectingPainNote({factors:['Stress','Money worries'],words:'New job · long shifts',declined:false}),'Also affecting pain (patient-reported): Stress, Money worries · In their words: New job, long shifts');
  assert.equal(affectingPainNote({factors:[],words:'My dog passed away',declined:false}),'Also affecting pain (patient-reported): My dog passed away');
  assert.equal(affectingPainNote({factors:['Work'],words:'ignored',declined:true}),'Also affecting pain (patient-reported): Prefer not to answer');
  assert.equal(affectingPainNote({factors:[],words:' ',declined:false}),'');
});

test('the medicine questions offer kinds with everyday examples and an "I don’t know the name" path in both languages',()=>{
  const data=seedWorkspace(),p=data.patients.find(patient=>patient.id===patientId);
  const report={...emptyMedicationReport(),cannotTakeAnswer:'yes',cannotTake:[{name:'',reason:'',details:'',unknown:emptyUnidentified()}],takingNow:[{name:'',dose:'',category:'food-drink',unknown:emptyUnidentified()}]};
  const en=render(CompanionMedicationQuestions,{p,report,onChange:()=>{},disabled:false});
  for(const text of ['Taking anything that isn’t listed above?','Sleep or anxiety medicine','Supplement or vitamin','Herbal or CBD','Food or drink','grapefruit juice, alcohol','magnesium, melatonin, vitamin D','I don’t know the name','Medicine, name not known','What form is it?','Capsule','Inhaler','Cream or gel','Letters or numbers printed on it','What do you use it for?','Who prescribed it, or which pharmacy','Bring the bottle or a photo of the label to your visit.','Your care team will work out which medicine it is.','Any part of the name you remember'])assert.ok(en.includes(text),text);
  assert.doesNotMatch(en,/interaction|contraindicat|could affect your medicines/i);
  // A toggle keeps one label, so "pressed" always reads as "I don’t know the name".
  assert.doesNotMatch(en,/I know the name/);assert.match(en,/class="medq-unknown-toggle" aria-pressed="true"[^>]*>(?:<svg[\s\S]*?<\/svg>)?I don’t know the name<\/button>/);
  assert.doesNotMatch(en,/Xanax|Ativan|Klonopin|Ambien|alprazolam|lorazepam/i,'Sleep or anxiety examples do not name specific controlled drugs');
  const es=render(CompanionMedicationQuestions,{p,report,onChange:()=>{},disabled:false,lang:'es'});
  for(const text of ['Medicamento para dormir o la ansiedad','Suplemento o vitamina','Hierbas o CBD','Comida o bebida','jugo de toronja, alcohol','No sé el nombre','Medicamento sin nombre conocido','¿Qué forma tiene?','Cápsula','Letras o números impresos','¿Para qué lo usas?','Quién lo recetó o qué farmacia','Trae el frasco o una foto de la etiqueta a tu visita.'])assert.ok(es.includes(text),text);
});

test('the clinician sees patient-reported items grouped by kind, with unnamed medicines as needing identification',()=>{
  const report={...emptyMedicationReport(),takingNow:[{name:'Melatonin',dose:'',category:'supplement'},{name:'Grapefruit juice',dose:'Daily',category:'food-drink'},{name:'Sleep aid',dose:'',category:'sleep-anxiety'},{name:'',dose:'',category:'',unknown:{...emptyUnidentified(),form:'Pill',color:'yellow'}}]};
  const note=[medicationReportNote(report),affectingPainNote({factors:['Stress','Work'],words:'',declined:false})].join('\n');
  const data=selfReport(seedWorkspace(),{note,at:'2026-09-20T15:00:00.000Z'}),p=data.patients.find(patient=>patient.id===patientId);
  const html=render(EncounterReview,{p,ctx:{...ctx(data),user:'Clinical reviewer'},changeTab:()=>{}});
  const section=html.match(/<section class="visit-patient-medicines"[\s\S]*?<\/section>/)?.[0];
  assert.ok(section,'Patient-reported section renders');
  for(const text of ['patient-reported, to verify','Supplement or vitamin','Food or drink','Sleep or anxiety medicine','Needs identification','Name not known','Form: Pill · Color: yellow','Described by the patient; not matched to a medicine','Also affecting pain','Stress, Work','not a scored questionnaire','Kinds as chosen by the patient'])assert.ok(section.includes(text),text);
  assert.doesNotMatch(section,/interaction|contraindicat|confiden/i);
});

test('the daily check-in is quick by default, keeps the full pre-visit mode, and states that answers are not watched in real time',()=>{
  const data=seedWorkspace(),p=data.patients.find(patient=>patient.id===patientId);
  const daily=render(PatientCheckin,{p,ctx:ctx(data)});
  for(const text of ['Daily check-in','About 30 seconds','Before my visit','not watching these answers in real time','use “I am worse”','call 911','call or text 988','Add more detail','aria-expanded="false"','What else is affecting your pain lately?','Money worries','Family or support'])assert.ok(daily.includes(text),text);
  assert.match(daily,/<div id="[^"]+" class="checkin-detail" hidden="">/,'Body map, function, medicines and note wait behind "Add more detail"');
  assert.ok(!daily.includes('You submit'),'The pre-visit steps belong to the pre-visit mode');
  const previsit=render(PatientCheckin,{p,ctx:ctx(data),mode:'previsit'});
  assert.match(previsit,/<div id="[^"]+" class="checkin-detail">/);assert.ok(previsit.includes('You submit'));assert.ok(!previsit.includes('Add more detail'));
  const es=render(PatientCheckin,{p,ctx:ctx(data),lang:'es'});
  for(const text of ['Registro diario','Unos 30 segundos','Antes de mi visita','no ve estas respuestas en tiempo real','usa “Estoy peor”','llama al 911','988','Añadir más detalles','¿Qué más está afectando tu dolor últimamente?','Preocupaciones de dinero'])assert.ok(es.includes(text),text);
});

test('once today’s check-in is saved the patient sees the values, a 7-day strip and an update option',()=>{
  const now=new Date(),yesterday=new Date(now.getTime()-26*3600000);
  let data=selfReport(seedWorkspace(),{note:'Mood 3/10',pain:5,at:yesterday.toISOString()});
  data=selfReport(data,{note:'Location: Left foot\nMood 6/10\nTaking now, not on record (patient-reported): Magnesium · Dose: Not given',pain:7,sleep:4,at:now.toISOString()});
  const p=data.patients.find(patient=>patient.id===patientId);
  const html=render(PatientCheckin,{p,ctx:ctx(data)});
  for(const text of ['Today’s check-in is saved','<dt>Pain</dt><dd>7/10</dd>','<dt>Sleep quality</dt><dd>4/10</dd>','<dt>Mood</dt><dd>6/10</dd>','Update today’s answers','not watching these answers in real time'])assert.ok(html.includes(text),text);
  assert.ok(!html.includes('Save my check-in'),'The form waits until the patient chooses to update');
  const strip=html.match(/<ol class="checkin-week"[\s\S]*?<\/ol>/)[0],caption=html.match(/<p class="checkin-week-caption" id="([^"]+)">Check-ins in the last 7 days<\/p>/);
  assert.ok(caption,'The strip has a visible caption');assert.match(strip,new RegExp('aria-labelledby="'+caption[1]+'"'),'The caption names the list, so it is not read twice');
  assert.match(html,/<p class="checkin-week-key" aria-hidden="true"><span class="done"><i><\/i>checked in<\/span><span><i><\/i>no check-in<\/span><\/p>/,'A key explains filled and empty dots');
  assert.equal((strip.match(/<li/g)??[]).length,7);assert.match(strip,/class="done today"/);assert.ok((strip.match(/checked in/g)??[]).length>=2);
  assert.ok(render(PatientCheckin,{p,ctx:ctx(data),lang:'es'}).includes('El registro de hoy está guardado'));
});

// A bounded hook harness exercises the update path without a browser.
function interactive(props){
  const slots=[],effects=[];let cursor=0;
  const hooks={...React,useEffect(effect,deps){if(!deps)effects.push(effect);},useLayoutEffect(){},useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useId(){const i=cursor++;if(!(i in slots))slots[i]=':r'+i+':';return slots[i];}};
  const exported=load(hooks);
  const view=()=>{cursor=0;effects.length=0;return exported.PatientCheckin(props);};
  return Object.assign(view,{slots,runEffects:()=>effects.splice(0).forEach(effect=>effect())});
}
function find(tree,predicate){
  if(!tree||typeof tree!=='object')return undefined;
  if(predicate(tree))return tree;
  for(const child of React.Children.toArray(tree.props?.children)){const match=find(child,predicate);if(match)return match;}
}

// One line of every kind the companion writes, in the order it writes them.
const everyLine=['Check-in type: Pre-visit','Location: Low back','Mood 4/10',
  'Cannot take (patient-reported): Codeine · Reason: Allergic reaction · What happened: Hives',
  'Unidentified medicine (patient-reported): Name not known · Asked under: Cannot take · Form: Capsule · Color: white · Reason: Bad side effect · What happened: Not given',
  'Tried before (patient-reported): Gabapentin (Neurontin) · Helped: Helped a little · Side effects: Dizzy, Upset stomach · Why stopped: Too sleepy',
  'Unidentified medicine (patient-reported): Name not known · Asked under: Tried before · Form: Patch · Helped: Did not help · Side effects: Not given · Why stopped: Not given',
  'Taking now, not on record (patient-reported): Ibuprofen · Dose: 200 mg',
  'Sleep or anxiety medicine (patient-reported): Zolpidem · Dose: 5mg nightly',
  'Supplement or vitamin (patient-reported): Magnesium · Dose: Not given',
  'Herbal or CBD product (patient-reported): CBD gummies · Dose: Not given',
  'Food or drink (patient-reported): Grapefruit juice · How much: A glass most mornings',
  'Unidentified medicine (patient-reported): Name not known · Asked under: Taking now · Form: Pill · Color: white · Kind: Supplement or vitamin · Name as typed: gaba · Dose: Not given',
  'Also affecting pain (patient-reported): Stress, Money worries · In their words: New job',
  'Worse after long shifts at work.'].join('\n');
const control=(tree,label)=>find(tree,node=>node.props?.label===label&&typeof node.props?.onChange==='function');
const observation=(data,encounterId)=>data.clinicalWorkflows.slices.encounters.state.observations.find(record=>record.encounterId===encounterId);
const saving=(commands,result=true)=>async(action,message)=>{commands.push({action,message});return result;};

test('updating today’s answers opens with everything already sent, replaces it, and is filed as the patient’s own update',async()=>{
  const at=new Date().toISOString(),commands=[],focused=[];
  let data=selfReport(seedWorkspace(),{note:'Check-in type: Daily\nLocation: Left foot\nMood 6/10\nCannot take (patient-reported): None\nTaking now, not on record (patient-reported): Magnesium · Dose: Not given\nAlso affecting pain (patient-reported): Stress\nPlease call after 3 pm',pain:7,at,id:'today'});
  const p=data.patients.find(patient=>patient.id===patientId);
  const view=interactive({p,ctx:ctx(data,saving(commands))});
  let tree=view();
  find(tree,node=>typeof node.props?.onUpdate==='function').props.onUpdate(observation(data,'checkin-today'));
  tree=view();
  find(tree,node=>node.type==='div'&&node.props?.tabIndex===-1).props.ref.current={focus:()=>focused.push('updating')};view.runEffects();
  assert.deepEqual(focused,['updating'],'Focus moves to the “Updating today’s check-in” banner');
  assert.equal(control(tree,'Pain').props.value,7,'Today’s answers are prefilled');
  const questions=()=>find(tree,node=>node.props?.report&&typeof node.props?.onChange==='function'),affected=()=>find(tree,node=>Array.isArray(node.props?.value?.factors));
  assert.equal(questions().props.report.cannotTakeAnswer,'no');assert.deepEqual(questions().props.report.takingNow,[{name:'Magnesium',dose:'',category:''}]);
  assert.deepEqual(affected().props.value.factors,['Stress']);
  assert.equal(find(tree,node=>node.props?.rows===3).props.value,'Please call after 3 pm','The patient’s own words are prefilled, so they can change them');
  assert.equal(find(tree,node=>node.props?.className==='checkin-detail').props.hidden,false,'Answers beyond the quick questions are shown, not hidden');
  assert.equal(find(tree,node=>node.props?.type==='submit').props.disabled,true,'Nothing has changed yet');
  control(tree,'Pain').props.onChange(8);control(tree,'Mood').props.onChange('declined');
  questions().props.onChange({...questions().props.report,cannotTakeAnswer:'yes',cannotTake:[{name:'Codeine',reason:'Allergic reaction',details:''}]});
  affected().props.onChange({factors:[],words:'',declined:true});
  tree=view();
  await find(tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});
  const {action,message}=commands[0],command=action.command;
  assert.equal(command.encounterId,'checkin-today');assert.equal(command.expectedVersion,1);assert.match(command.correctionReason,/Patient updated today’s check-in answers/);assert.equal(message,'Your check-in is saved');
  assert.equal(command.patientNote,'Check-in type: Daily\nLocation: Left foot\nMood: Prefer not to answer\nCannot take (patient-reported): Codeine · Reason: Allergic reaction · What happened: Not given\nTaking now, not on record (patient-reported): Magnesium · Dose: Not given\nAlso affecting pain (patient-reported): Prefer not to answer\nPlease call after 3 pm','The update replaces earlier answers instead of adding contradictions');
  tree=view();
  find(tree,node=>node.props?.headingRef).props.headingRef.current={focus:()=>focused.push('card')};view.runEffects();
  assert.deepEqual(focused,['updating','card'],'After saving, focus moves to the saved card’s heading');
  data=applyAction(data,actionSchema.parse(action),'Clinician account',new Date(Date.now()+1000).toISOString());
  const records=data.clinicalWorkflows.slices.encounters.state.observations.filter(record=>record.patientId===patientId&&record.submissionSource==='patient-self-report');
  assert.equal(records.length,1,'An update corrects the same check-in');
  assert.equal(records[0].version,2);assert.equal(records[0].currentEntries.find(entry=>entry.metric==='pain').value,8);
  assert.ok(records[0].entries.some(entry=>entry.metric==='pain'&&entry.value===7),'The earlier answer stays in the record history');
  const notes=data.patients.find(patient=>patient.id===patientId).notes.filter(note=>note.workflowRecordId===records[0].id);
  const update=notes.find(note=>note.workflowVersion===2),original=notes.find(note=>note.workflowVersion===1);
  assert.equal(update.type,'Patient-updated report');assert.equal(update.author,'Updated by patient','The saving account is not presented as a correcting clinician');
  assert.equal(original.type,'Patient-submitted report');assert.match(original.text,/Cannot take \(patient-reported\): None/,'What the patient sent first stays in the care team’s record');
});

test('check-in note lines are read back, and an update replaces earlier answers without dropping lines the form cannot show',()=>{
  assert.equal(noteMood('Location: Low back\nMood 0/10'),0);assert.equal(noteMood('Mood 11/10'),undefined);assert.equal(noteMood('Mood: Prefer not to answer'),'declined');assert.equal(noteLocation('Mood 4/10\nLocation: Low back'),'Low back');
  assert.equal(noteCheckinMode('Check-in type: Daily\nMood 4/10'),'daily');assert.equal(noteCheckinMode('Check-in type: Pre-visit'),'previsit');assert.equal(noteCheckinMode('Mood 4/10'),undefined,'A note saved before the type line has no type of its own');
  assert.equal(checkinNote(readCheckinNote(everyLine)),everyLine,'Every kind of line opens in the form and is written back exactly');
  assert.equal(noteOwnWords(everyLine),'Worse after long shifts at work.');
  // Notes saved by the earlier add-only update read back without the contradiction.
  const legacy=readCheckinNote('Location: Low back\nMood 5/10\nCannot take (patient-reported): None\nAlso affecting pain (patient-reported): Stress\nCannot take (patient-reported): Codeine · Reason: Not given · What happened: Not given\nCannot take (patient-reported): Codeine · Reason: Allergic reaction · What happened: Hives\nAlso affecting pain (patient-reported): Prefer not to answer');
  assert.equal(legacy.report.cannotTakeAnswer,'yes');assert.deepEqual(legacy.report.cannotTake,[{name:'Codeine',reason:'Allergic reaction',details:'Hives'}],'A named medicine wins over “None”, and the newest answer for it wins');
  assert.equal(legacy.affecting.declined,true);assert.deepEqual(legacy.kept,[]);
  const blankReport={location:'',mood:'',report:emptyMedicationReport(),affecting:emptyAffectingPain(),words:''};
  // "None" then a named allergy: the update's answer replaces the earlier one.
  const none=checkinNote({...blankReport,mode:'daily',report:{...emptyMedicationReport(),cannotTakeAnswer:'no'},affecting:{factors:['Stress'],words:'',declined:false}});
  const edited=readCheckinNote(none);edited.report={...edited.report,cannotTakeAnswer:'yes',cannotTake:[{name:'Codeine',reason:'Allergic reaction',details:''}]};edited.affecting={factors:[],words:'',declined:true};
  const replaced=mergeCheckinNote(none,checkinNote(edited));
  assert.doesNotMatch(replaced,/: None|Stress/);assert.deepEqual(parseMedicationReport(replaced).map(line=>line.name),['Codeine','Prefer not to answer']);
  // A named allergy survives an update that only answers another question, because the form opens with it.
  const allergy=checkinNote({...blankReport,mode:'daily',report:{...emptyMedicationReport(),cannotTakeAnswer:'yes',cannotTake:[{name:'Morphine',reason:'Allergic reaction',details:'Rash'}]}});
  const triedOnly=readCheckinNote(allergy);triedOnly.report.triedAnswer='unsure';
  assert.equal(mergeCheckinNote(allergy,checkinNote(triedOnly)),'Check-in type: Daily\nTried before (patient-reported): Not sure\nCannot take (patient-reported): Morphine · Reason: Allergic reaction · What happened: Rash');
  // Lines the form cannot show are kept as sent, and an update keeps the check-in's type.
  const odd='Check-in type: Pre-visit\nCannot take (patient-reported): Latex · Severity: Severe';
  assert.deepEqual(readCheckinNote(odd).kept,['Cannot take (patient-reported): Latex · Severity: Severe']);
  assert.equal(mergeCheckinNote(odd,'Check-in type: Daily\nMood 4/10'),'Check-in type: Pre-visit\nMood 4/10\nCannot take (patient-reported): Latex · Severity: Severe');
  assert.equal(mergeCheckinNote('Check-in type: Daily\nMood 5/10','Check-in type: Pre-visit\nMood 5/10'),'Check-in type: Daily\nMood 5/10','An update never turns a daily check-in into the pre-visit one; that is its own submission');
  assert.equal(mergeCheckinNote('Location: Low back\nMood 5/10\nCall me','Check-in type: Daily\nLocation: Neck\nCall me'),'Location: Neck\nCall me','A note from before the type line stays untyped, and the update’s answers replace the old ones');
  // Re-saving a long note does not grow it, so an update stays within the note limit.
  const long=checkinNote({...blankReport,mode:'daily',mood:4,words:'x'.repeat(1900)});
  assert.equal(mergeCheckinNote(long,checkinNote(readCheckinNote(long))),long);
});

test('my progress shows a plain line instead of the clinician’s withdrawal reason and no record internals',()=>{
  const data=seedWorkspace(),p=data.patients.find(patient=>patient.id===patientId);
  const withdrawal={withdrawnAt:'2026-09-17T11:00:00Z',withdrawalReason:'Clinician-only reason: attached to the wrong visit.'};
  p.checkins=[{id:'confirmed',date:'2026-09-18T10:00:00Z',pain:3,function:6,sleep:7,note:'Confirmed encounter report. Individual source statements are retained in observation history.',source:'Clinician-confirmed report'},{id:'legacy',date:'2026-09-15T10:00:00Z',pain:4,function:6,sleep:6,note:'Legacy withdrawn note',source:'Clinician-confirmed report',...withdrawal}];
  p.workflowObservations=[{id:'pain-zero',metric:'pain',status:'zero',value:0}].map(entry=>({...entry,workflowRecordId:'withdrawn-report',workflowVersion:3,encounterId:'wrong-visit',source:'Original patient report',recordedAt:'2026-09-16T10:00:00Z',confirmedAt:'2026-09-16T11:00:00Z',confirmedBy:'Original reviewer',...withdrawal}));
  for(const [lang,line] of [['en','Your care team set this check-in aside.'],['es','Tu equipo de atención apartó este registro.']]){
    const html=render(CompanionProgress,{p,ctx:ctx(data),lang});
    assert.equal((html.match(new RegExp(line.replace('.','\\.'),'g'))??[]).length,2,lang);
    assert.doesNotMatch(html,/Clinician-only reason|Original patient report|Confirmed encounter report|Legacy withdrawn note|versi[oó]n 3/);
    assert.match(html,/0\/10/,'The patient still sees their own withdrawn values');
  }
});

test('a Spanish-speaking patient reads their saved answers back in Spanish, with their own words exactly as typed',()=>{
  const lines=({type,rows,words})=>[type,...rows.map(row=>row.label+': '+row.value),...words].join('\n');
  const es=lines(checkinReadback(everyLine,'es'));
  assert.doesNotMatch(es,/patient-reported|Location:|Mood |Reason:|Asked under|Name not known|Not given|In their words|Check-in type/);
  for(const part of ['Antes de mi visita','Ánimo: 4/10','Dónde te duele: Parte baja de la espalda','Medicamento que no puedes tomar: Codeine · Motivo: Reacción alérgica · Qué pasó: Hives','Medicamento que no puedes tomar: Nombre desconocido · Forma: Cápsula · Color: white · Motivo: Efecto secundario fuerte',
    'Probado antes: Gabapentin (Neurontin) · Resultado: Ayudó un poco · Efectos secundarios: Mareo, Malestar de estómago · Por qué lo dejaste: Too sleepy','También tomas: Ibuprofen · Cantidad: 200 mg','Medicamento para dormir o la ansiedad: Zolpidem · Cantidad: 5mg nightly','Suplemento o vitamina: Magnesium','Comida o bebida: Grapefruit juice · Cantidad: A glass most mornings',
    'También tomas: Nombre desconocido · Forma: Pastilla · Color: white · Tipo: Suplemento o vitamina · Nombre que escribiste: gaba','También afecta tu dolor: Estrés, Preocupaciones de dinero · Con tus palabras: New job','Worse after long shifts at work.'])assert.ok(es.includes(part),part);
  assert.match(lines(checkinReadback('Mood: Prefer not to answer\nAlso affecting pain (patient-reported): Prefer not to answer','es')),/Ánimo: Prefiero no responder\nTambién afecta tu dolor: Prefiero no responder/);
  assert.doesNotMatch(lines(checkinReadback(everyLine,'en')),/patient-reported|Location:|In their words/,'English patients see plain labels too');
  assert.equal(checkinReadback('Location: constructor','es').rows[0].value,'constructor','Only known fixed answers are translated');
  const data=selfReport(seedWorkspace(),{note:everyLine,at:new Date().toISOString()}),p=data.patients.find(patient=>patient.id===patientId);
  const html=render(PatientResponseHistory,{p,ctx:ctx(data),lang:'es'});
  assert.ok(html.includes('Enviado por ti · Antes de mi visita'));assert.ok(html.includes('<dt>También afecta tu dolor</dt><dd>Estrés, Preocupaciones de dinero · Con tus palabras: New job</dd>'));
  assert.doesNotMatch(html,/patient-reported|Location:|Mood \d/);
  assert.equal(data.clinicalWorkflows.slices.encounters.state.observations.find(record=>record.patientNote===everyLine)?.patientNote,everyLine,'The stored English note is unchanged for the clinician view');
});

test('every check-in records its type, a quick check-in never saves the chart location, and a declined mood is kept',async()=>{
  const data=seedWorkspace(),p=data.patients.find(patient=>patient.id===patientId),commands=[];
  const view=interactive({p,ctx:ctx(data,saving(commands,false))});
  let tree=view();
  const summary=find(tree,node=>node.type==='summary');
  assert.ok(p.clinicalContext.painLocation);assert.match(renderToStaticMarkup(summary),new RegExp('Choose a body area · On your record: '+p.clinicalContext.painLocation),'The chart wording is a hint, not a chosen answer');
  control(tree,'Mood').props.onChange('declined');tree=view();
  assert.equal(find(tree,node=>node.props?.type==='submit').props.disabled,false,'A declined answer counts as an answer, as for the other scales');
  await find(tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});
  assert.equal(commands[0].action.command.patientNote,'Check-in type: Daily\nMood: Prefer not to answer','Only what the patient chose is saved');
  find(tree,node=>node.props?.role==='group'&&node.props?.['aria-label']==='Check-in type').props.children[1].props.onClick();
  control(tree,'Pain').props.onChange(4);tree=view();
  await find(tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});
  assert.equal(commands[1].action.command.patientNote,'Check-in type: Pre-visit\nMood: Prefer not to answer');
  // The saved card shows the decline and the type the patient chose.
  const saved=selfReport(seedWorkspace(),{note:'Check-in type: Daily\nMood: Prefer not to answer',at:new Date().toISOString()});
  const html=render(PatientCheckin,{p:saved.patients.find(patient=>patient.id===patientId),ctx:ctx(saved)});
  assert.ok(html.includes('<dt>Mood</dt><dd>Prefer not to answer</dd>'));assert.match(html,/Saved [^<]+ · Daily check-in/);
});

test('a note over the limit says by how much and opens the extra questions where the patient can shorten it',async()=>{
  const data=seedWorkspace(),p=data.patients.find(patient=>patient.id===patientId),commands=[];
  const view=interactive({p,ctx:ctx(data,saving(commands))});
  let tree=view();
  find(tree,node=>node.props?.rows===3).props.onChange({target:{value:'x'.repeat(1995)}});control(tree,'Pain').props.onChange(4);tree=view();
  await find(tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});
  tree=view();
  assert.equal(commands.length,0);
  assert.equal(find(tree,node=>node.props?.role==='alert').props.children,'Your answers and notes are 16 characters over the 2,000-character limit. Shorten your comment or medicine notes. Your answers are kept here.');
  assert.equal(find(tree,node=>node.props?.className==='checkin-detail').props.hidden,false);
});

test('a check-in left open past midnight starts the new day instead of changing yesterday’s record',async()=>{
  const yesterday=new Date(Date.now()-26*3600000).toISOString(),commands=[];
  let data=selfReport(seedWorkspace(),{note:'Check-in type: Daily\nMood 6/10',pain:7,at:yesterday,id:'yesterday'});
  let p=data.patients.find(patient=>patient.id===patientId);
  let view=interactive({p,ctx:ctx(data,saving(commands))});
  let tree=view();
  assert.equal(find(tree,node=>typeof node.props?.onUpdate==='function'),undefined,'Yesterday’s record is not today’s check-in');
  // The page was opened yesterday and is still showing yesterday's card.
  view.slots[view.slots.findIndex(value=>value instanceof Date)]=new Date(yesterday);
  tree=view();
  find(tree,node=>typeof node.props?.onUpdate==='function').props.onUpdate(observation(data,'checkin-yesterday'));
  tree=view();
  assert.equal(find(tree,node=>node.props?.className==='checkin-updating'),undefined,'Updating yesterday’s card starts today’s check-in instead');
  assert.equal(control(tree,'Pain').props.value,'');
  control(tree,'Pain').props.onChange(3);tree=view();
  await find(tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});
  assert.notEqual(commands[0].action.command.encounterId,'checkin-yesterday');assert.equal(commands[0].action.command.expectedVersion,undefined);
  // An update opened just before midnight and saved after it is filed as the new day's check-in.
  data=selfReport(seedWorkspace(),{note:'Check-in type: Daily\nMood 6/10',pain:7,at:new Date().toISOString(),id:'late'});p=data.patients.find(patient=>patient.id===patientId);
  view=interactive({p,ctx:ctx(data,saving(commands))});tree=view();
  const late=observation(data,'checkin-late');
  find(tree,node=>typeof node.props?.onUpdate==='function').props.onUpdate(late);tree=view();
  late.createdAt=yesterday;control(tree,'Pain').props.onChange(5);tree=view();
  await find(tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});
  const {action,message}=commands[1];
  assert.notEqual(action.command.encounterId,'checkin-late');assert.equal(action.command.expectedVersion,undefined);assert.equal(action.command.correctionReason,undefined);
  assert.equal(message,'A new day has started, so your answers were saved as today’s check-in.');
});

test('the Today tab reads as a daily check-in and keeps visit preparation as its own shortcut',()=>{
  const data=seedWorkspace(),p=data.patients.find(patient=>patient.id===patientId);
  const en=render(PatientCompanionLanguage,{p,ctx:ctx(data),onAccount:()=>{}});
  for(const text of ['How are you today?','A quick daily check-in helps your care team see how you are doing between visits.','Daily check-ins &amp; visit preparation','Prepare for my visit','Before my visit'])assert.ok(en.includes(text),text);
  assert.doesNotMatch(en,/Prepare for your next visit|before you arrive/);
  const es=render(PatientCompanionLanguage,{p:{...p,preferredLanguage:'es'},ctx:ctx(data),onAccount:()=>{}});
  for(const text of ['¿Cómo estás hoy?','Un registro diario rápido ayuda a tu equipo a ver cómo estás entre visitas.','Registros diarios y preparación de tu visita','Preparar mi visita'])assert.ok(es.includes(text),text);
  assert.doesNotMatch(es,/Prepara tu próxima visita/);
});

test('the clinician side can list every patient-reported kind with its label',()=>{
  const groups=reportedMedicineGroups(everyLine);
  assert.deepEqual(groups.map(group=>[group.kind,group.label,group.named]),[['cannot-take','Cannot take',1],['tried','Tried before',1],['taking-now','Taking now, not on the record',1],['sleep-anxiety','Sleep or anxiety medicine',1],['supplement','Supplement or vitamin',1],['herbal','Herbal or CBD product',1],['food-drink','Food or drink',1],['unidentified','Needs identification',3],['affecting-pain','Also affecting pain',1]]);
  assert.deepEqual(Object.keys(reportedKindLabels),groups.map(group=>group.kind));
  const mixed=reportedMedicineGroups('Cannot take (patient-reported): None\nCannot take (patient-reported): Codeine · Reason: Allergic reaction · What happened: Not given\nTried before (patient-reported): Not sure');
  assert.deepEqual(mixed.map(group=>[group.kind,group.named,group.alsoNone,group.rows.map(row=>row.summary)]),[['cannot-take',1,true,[true,false]],['tried',0,false,[true]]]);
});

test('the daily check-in asks four one-tap questions, so a full daily check-in is a complete report in the chart',async()=>{
  const data=seedWorkspace(),p=data.patients.find(patient=>patient.id===patientId),commands=[];
  for(const [lang,texts] of [['en',['Pain','Daily activities','0 = pain made them very hard · 10 = pain did not get in the way','Sleep quality','Mood','Pain, daily activities, sleep and mood']],['es',['Dolor','Actividades diarias','0 = el dolor las hizo muy difíciles · 10 = el dolor no las afectó','Calidad del sueño','Ánimo','Dolor, actividades diarias, sueño y ánimo']]]){
    const html=render(PatientCheckin,{p,ctx:ctx(data),lang}),quick=html.match(/<section class="previsit-section checkin-quick"[\s\S]*?<\/section>/)[0];
    for(const text of texts.slice(0,5))assert.ok(quick.includes(text),lang+': '+text);assert.ok(html.includes(texts[5]),lang+': intro');
    assert.equal((quick.match(/<fieldset class="checkin-scale"/g)??[]).length,4,'Pain, function, sleep and mood are all one tap away');
    assert.doesNotMatch(html.slice(html.indexOf('class="checkin-detail"')),/-function"/,'Function is no longer behind “Add more detail”');
  }
  const view=interactive({p,ctx:ctx(data,saving(commands))});let tree=view();
  for(const [label,value] of [['Pain',6],['Daily activities',4],['Sleep quality',5],['Mood',3]])control(tree,label).props.onChange(value);
  tree=view();await find(tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});
  const {action}=commands[0];
  assert.deepEqual(action.command.entries.map(entry=>[entry.metric,entry.value]),[['pain',6],['function',4],['sleep',5]]);assert.equal(action.command.patientNote,'Check-in type: Daily\nMood 3/10');
  const saved=applyAction(data,actionSchema.parse(action),'Patient companion',new Date().toISOString()),checkin=saved.patients.find(patient=>patient.id===patientId).checkins.find(item=>item.workflowRecordId);
  assert.deepEqual([checkin.pain,checkin.function,checkin.sleep],[6,4,5],'The daily check-in reaches the chart, the visit tab and PST');
});

test('an update keeps the check-in’s type: the type toggle is hidden, and an unchanged untyped check-in cannot be re-saved',async()=>{
  const at=new Date().toISOString();
  for(const [note,line] of [['Check-in type: Pre-visit\nMood 4/10','This stays your check-in before your visit.'],['Check-in type: Daily\nMood 4/10','This stays a daily check-in. For your visit questions, save or cancel, then choose “Before my visit”.']]){
    const data=selfReport(seedWorkspace(),{note,at,id:'typed'}),view=interactive({p:data.patients.find(patient=>patient.id===patientId),ctx:ctx(data)});
    let tree=view();find(tree,node=>typeof node.props?.onUpdate==='function').props.onUpdate(observation(data,'checkin-typed'));tree=view();
    assert.equal(find(tree,node=>node.props?.['aria-label']==='Check-in type'),undefined,'No type toggle while updating');
    assert.ok(find(tree,node=>node.type==='p'&&node.props?.children===line),line);
  }
  // A check-in saved before the type line: it opens with its answers, Save waits for a change, and the note stays untyped.
  const commands=[],data=selfReport(seedWorkspace(),{note:'Location: Left foot\nMood 6/10',pain:7,at,id:'legacy'}),view=interactive({p:data.patients.find(patient=>patient.id===patientId),ctx:ctx(data,saving(commands))});
  let tree=view();find(tree,node=>typeof node.props?.onUpdate==='function').props.onUpdate(observation(data,'checkin-legacy'));tree=view();
  assert.equal(find(tree,node=>node.props?.type==='submit').props.disabled,true,'Opening the update is not a change');
  assert.equal(find(tree,node=>node.props?.className==='checkin-updating').props.children[0].props.children.filter(Boolean).length,2,'No type is claimed for it');
  control(tree,'Pain').props.onChange(8);tree=view();
  await find(tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});
  assert.equal(commands[0].action.command.patientNote,'Location: Left foot\nMood 6/10','Nothing is added to the note, and it does not become pre-visit');
});

test('the saved card offers “Before my visit” as a new submission that leaves today’s daily check-in as sent',async()=>{
  const at=new Date().toISOString(),commands=[];
  const data=selfReport(seedWorkspace(),{note:'Check-in type: Daily\nMood 6/10',at,id:'daily'}),p=data.patients.find(patient=>patient.id===patientId);
  const card=render(PatientCheckin,{p,ctx:ctx(data)});
  assert.match(card,/>Update today’s answers<\/button>/);assert.match(card,/aria-describedby="[^"]+"[^>]*>Before my visit<\/button>/);assert.ok(card.includes('Today’s check-in stays as you sent it.'));
  const es=render(PatientCheckin,{p,ctx:ctx(data),lang:'es'});assert.match(es,/>Antes de mi visita<\/button>/);assert.ok(es.includes('Tu registro de hoy se queda como lo enviaste.'));assert.doesNotMatch(es,/Before my visit|stays as you sent/);
  const view=interactive({p,ctx:ctx(data,saving(commands))});let tree=view();
  find(tree,node=>typeof node.props?.onPrevisit==='function').props.onPrevisit();tree=view();
  assert.ok(find(tree,node=>node.props?.children==='A new check-in before your visit'),'The form says this is a separate check-in for the visit');
  assert.equal(find(tree,node=>node.props?.['aria-label']==='Check-in type'),undefined);assert.equal(find(tree,node=>node.props?.className==='checkin-detail').props.hidden,false,'The visit questions are open');
  control(tree,'Pain').props.onChange(5);tree=view();
  await find(tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});
  const {action}=commands[0];
  assert.notEqual(action.command.encounterId,'checkin-daily');assert.equal(action.command.expectedVersion,undefined);assert.equal(action.command.correctionReason,undefined);
  assert.equal(action.command.patientNote,'Check-in type: Pre-visit');
  const saved=applyAction(data,actionSchema.parse(action),'Patient companion',new Date().toISOString());
  assert.deepEqual([observation(saved,'checkin-daily').version,observation(saved,'checkin-daily').patientNote],[1,'Check-in type: Daily\nMood 6/10'],'Today’s daily check-in is not converted');
  assert.doesNotMatch(render(PatientCheckin,{p:saved.patients.find(patient=>patient.id===patientId),ctx:ctx(saved)}),/>Before my visit<\/button>/,'Once the visit check-in is saved, the card does not offer it again');
});

test('a Spanish check-in shows body areas in Spanish, one name for “Widespread”, and no English chart text',()=>{
  const data=seedWorkspace(),p=data.patients.find(patient=>patient.id===patientId),summary=html=>html.match(/<summary>[\s\S]*?<\/summary>/)[0];
  assert.ok(p.clinicalContext.painLocation);
  const es=render(PatientCheckin,{p,ctx:ctx(data),lang:'es'});
  assert.ok(summary(es).includes('Elegir una zona del cuerpo'));assert.ok(!summary(es).includes(p.clinicalContext.painLocation),'The clinician’s English chart text is not shown');
  const back={...p,clinicalContext:{...p.clinicalContext,painLocation:'Low back'}};
  assert.ok(summary(render(PatientCheckin,{p:back,ctx:ctx(data),lang:'es'})).includes('Elegir una zona del cuerpo · En tu registro: Parte baja de la espalda'),'A chart area with a Spanish name is shown in Spanish');
  const view=interactive({p,ctx:ctx(data),lang:'es'});let tree=view();
  find(tree,node=>typeof node.props?.value==='string'&&typeof node.props?.onChange==='function'&&node.props?.lang==='es').props.onChange('Low back');tree=view();
  const chosen=renderToStaticMarkup(find(tree,node=>node.type==='summary'));
  assert.ok(chosen.includes('Parte baja de la espalda'));assert.ok(!chosen.includes('Low back'));
  assert.ok(es.includes('>En todo el cuerpo</button>'));assert.equal(checkinReadback('Location: Widespread','es').rows[0].value,'En todo el cuerpo','The picker and the readback use one Spanish name');
});
