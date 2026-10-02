import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
const bundle=await build({stdin:{contents:"export {seedWorkspace} from './lib/theranetrix';export {medicationCategory,medicationNameOptions} from './lib/medication-presentation';export {PatientCheckin} from './components/theranetrix/patient-checkin';export {medicationReportNote,parseMedicationReport,medicationChoices,emptyMedicationReport} from './lib/patient-medication-report';export {MedicationPanel} from './components/theranetrix/medications';export {CompanionMeds} from './components/theranetrix/companion-meds';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const loaded={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(require,loaded,loaded.exports);
const {seedWorkspace,medicationCategory,medicationNameOptions,PatientCheckin,medicationReportNote,parseMedicationReport,medicationChoices,emptyMedicationReport,MedicationPanel,CompanionMeds}=loaded.exports;
const ctx=data=>({data,busy:false,save:async()=>true});
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));

test('medication display groups follow recorded use, never drug identity',()=>{
  assert.equal(medicationCategory({name:'Duloxetine',indication:'Painful diabetic peripheral neuropathy'}),'analgesic');
  assert.equal(medicationCategory({name:'Duloxetine',indication:'Depression'}),'other');
  assert.equal(medicationCategory({name:'Gabapentin',indication:'Epilepsy'}),'other');
  for(const indication of ['', 'Not recorded','Unknown','Under review','Other','N/A','None','Unconfirmed','Peripheral neuropathy','Not for pain'])assert.equal(medicationCategory({name:'Gabapentin',indication}),'unclassified',indication);
});

test('name suggestions preserve the recorded patient medications and omit combination/non-drug options',()=>{
  const data=seedWorkspace(),p=data.patients.find(p=>p.id==='TN-DEMO-01'),before=structuredClone(p);
  p.medications.push({...p.medications[0],id:'other',name:'Patient entered medication'});
  const names=medicationNameOptions(p);
  assert.ok(names.includes('Patient entered medication'));
  assert.ok(names.includes('Pregabalin'));
  assert.ok(!names.some(name=>name.includes(' + ')));
  assert.equal(names.length,new Set(names).size);
  assert.deepEqual(p.medications.slice(0,-1),before.medications);
});

test('patient medicine answers keep what was said, never invent missing detail, and read back for the clinician',()=>{
  const report={...emptyMedicationReport(),cannotTakeAnswer:'yes',triedAnswer:'yes',
    cannotTake:[{name:' Penicillin ',reason:'Allergic reaction',details:' Hives · as a child '}],
    tried:[{name:'Gabapentin',outcome:'Helped a little',effects:['Drowsy or groggy'],stopped:''},{name:'',outcome:'',effects:[],stopped:''}],
    takingNow:[{name:'Magnesium',dose:''}]};
  const before=structuredClone(report),note=medicationReportNote(report);
  assert.match(note,/Cannot take \(patient-reported\): Penicillin · Reason: Allergic reaction · What happened: Hives, as a child/);
  assert.match(note,/Tried before \(patient-reported\): Gabapentin · Helped: Helped a little · Side effects: Drowsy or groggy · Why stopped: Not given/);
  assert.match(note,/Taking now, not on record \(patient-reported\): Magnesium · Dose: Not given/);
  assert.equal(note.split('\n').length,3,'Blank rows are not reported');
  assert.deepEqual(report,before);
  const lines=parseMedicationReport('Location: arm\n'+note);
  assert.deepEqual(lines.map(line=>[line.kind,line.name]),[['cannot-take','Penicillin'],['tried','Gabapentin'],['taking-now','Magnesium']]);
  assert.ok(!lines[1].details.some(detail=>detail.label==='Why stopped'),'Not-given details are dropped from the clinician view');
  const none=medicationReportNote({...emptyMedicationReport(),cannotTakeAnswer:'no',triedAnswer:'unsure'});
  assert.deepEqual(parseMedicationReport(none).map(line=>line.name),['None','Not sure']);
  assert.equal(medicationReportNote(emptyMedicationReport()),'');
});

test('medicine choices put the patient’s own record first and do not list current medicines as tried',()=>{
  const data=seedWorkspace(),emma=data.patients.find(p=>p.id==='TN-DEMO-01');
  const choices=medicationChoices(emma);
  assert.equal(choices.tried[0],'Topical lidocaine');
  assert.ok(!choices.tried.some(name=>/gabapentin/i.test(name)),'Current gabapentin is not a previous trial');
  assert.ok(!choices.tried.some(name=>/Lidocaine patch/.test(name)),'One entry per medicine');
  assert.ok(choices.tried.some(name=>/Acetaminophen/.test(name)));
  assert.ok(choices.cannotTake.includes('Penicillin'));
});

test('previsit screen distinguishes patient submission from clinician verification and keeps medication history entry visible',()=>{
  const data=seedWorkspace(),p=data.patients.find(p=>p.id==='TN-DEMO-01');
  const html=render(PatientCheckin,{p,ctx:ctx(data),mode:'previsit'});
  for(const text of ['Patient report','You submit','Clinician verifies','Is there any medicine you can’t take?','Have you tried other medicines for this pain?','Taking anything that isn’t listed above?','Medication name','do not change your prescription'])assert.ok(html.includes(text),text);
  assert.match(html,/<option value="Pregabalin \(Lyrica\)">/);
  assert.doesNotMatch(html,/<input[^>]+value="75 mg/);
});

test('clinician review separates recorded analgesic, other, unknown and previously tried medicines',()=>{
  const data=seedWorkspace(),p=data.patients.find(p=>p.id==='TN-DEMO-01');
  p.medications.push({...p.medications[0],id:'mood',name:'Same drug for another indication',indication:'Depression'},{...p.medications[0],id:'unknown',name:'Unverified medication',indication:''});
  const html=render(MedicationPanel,{p,ctx:ctx(data),inline:true});
  for(const text of ['aria-label="Analgesic medications"','aria-label="Other medications"','aria-label="Indication needs confirmation"','Previously tried','Morning grogginess','Review / edit'])assert.ok(html.includes(text),text);
  assert.equal((html.match(/Same drug for another indication/g)??[]).length,1);
});

test('dose logging shows side effect field directly and identifies whether medication was reviewed',()=>{
  const data=seedWorkspace(),p=data.patients.find(p=>p.id==='TN-DEMO-01');
  p.medications[0].reviewedAt='';
  const html=render(CompanionMeds,{p,ctx:ctx(data)});
  for(const text of ['To verify','Recorded tolerance','Record a dose','Any side effects with this dose?','Saved when','Taken','Missed']){
    if(text==='Saved when')assert.ok(html.includes('Your note is saved when'));else assert.ok(html.includes(text),text);
  }
  assert.doesNotMatch(html,/<details[^>]*class="companion-med-effects"/);
});

test('companion preserves exact medication instructions instead of inferring a schedule from substrings',()=>{
  const data=seedWorkspace(),p=data.patients.find(p=>p.id==='TN-DEMO-01');
  p.medications=[{...p.medications[0],name:'Reported medicine',regimen:'Tramadol formulation reported; verify instructions',indication:''}];
  const html=render(CompanionMeds,{p,ctx:ctx(data)});
  assert.match(html,/Tramadol formulation reported; verify instructions/);
  assert.doesNotMatch(html,/This morning|Tonight|Morning and night|What you agreed with your team/);
  assert.match(html,/Reason not recorded/);
  assert.match(html,/Why is this medication listed/);
  p.medications[0].regimen='';
  assert.match(render(CompanionMeds,{p,ctx:ctx(data)}),/Schedule not recorded/);
});

test('companion most recent dose log follows timestamps even when records arrive out of order',()=>{
  const data=seedWorkspace(),p=data.patients.find(p=>p.id==='TN-DEMO-01');
  p.medications=[p.medications[0]];
  p.doseLogs=[{id:'old',medicationId:p.medications[0].id,name:p.medications[0].name,status:'taken',date:'2026-09-17T08:00:00Z'},{id:'new',medicationId:p.medications[0].id,name:p.medications[0].name,status:'missed',date:'2026-09-18T08:00:00Z'}];
  const html=render(CompanionMeds,{p,ctx:ctx(data)});
  assert.match(html,/Last log<!-- -->: <!-- -->Missed|Last log: Missed/);
});
