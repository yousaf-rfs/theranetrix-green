import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({stdin:{contents:"export * from './lib/theranetrix';export * from './lib/demo-showcase';export * from './lib/demo-identity';export {normalizeWorkspace} from './lib/medications';export {applyAction,actionSchema} from './lib/actions';export {engineRecordRevision} from './lib/engine-demo';export {PatientDetail} from './components/theranetrix/patient';export {birthDateShort,dobText} from './components/theranetrix/patient-identity';export {Patients} from './components/theranetrix/app';export {ClinicianOverview} from './components/theranetrix/clinician-overview';export {AdvisorDock} from './components/theranetrix/advisor-dock';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false,loader:{'.css':'empty','.module.css':'empty'}});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {seedWorkspace,ensureShowcaseData,demoIdentities,hasDemoIdentity,normalizeWorkspace,applyAction,actionSchema,engineRecordRevision,PatientDetail,birthDateShort,dobText,Patients,ClinicianOverview,AdvisorDock}=mod.exports;
const now='2026-09-19T12:00:00Z';
const showcase=()=>ensureShowcaseData(seedWorkspace(),'Identity reviewer',now);
const ageOn=(dob,day)=>Number(day.slice(0,4))-Number(dob.slice(0,4))-(day.slice(5)<dob.slice(5)?1:0);
// A saved workspace from before identifiers were seeded.
const strip=w=>{for(const p of w.patients){delete p.dateOfBirth;delete p.medicalRecordNumber;}return w;},legacy=()=>strip(showcase());

test('every seed and demo patient has a fictional DOB and DEMO- MRN that match the displayed age',()=>{
  const w=showcase();
  assert.deepEqual(w.patients.map(p=>p.id).sort(),Object.keys(demoIdentities).sort());
  const mrns=new Set();
  for(const p of w.patients){
    const d=demoIdentities[p.id];
    assert.equal(p.name,d.name);assert.equal(p.age,d.age,p.name);
    assert.match(p.dateOfBirth,/^\d{4}-(\d{2})-\1$/,p.name+': synthetic day-equals-month pattern');
    assert.match(p.medicalRecordNumber,/^DEMO-\d{6}$/);mrns.add(p.medicalRecordNumber.toLowerCase());
    // Consistent on the demo reference date, across every record date, and through the rest of 2026.
    for(const day of ['2026-07-28','2026-09-08','2026-09-24','2026-12-31',...p.dates.map(date=>date.slice(0,10))])assert.equal(ageOn(p.dateOfBirth,day),p.age,p.name+' on '+day);
  }
  assert.equal(mrns.size,w.patients.length,'MRNs are unique');
  assert.ok(!mrns.has('mrn-42'),'seeded MRNs stay clear of test values');
  // Only the showcase adds Priya Raman; the plain seed already carries the other ten.
  assert.equal(seedWorkspace().patients.filter(p=>p.dateOfBirth&&p.medicalRecordNumber).length,10);
});

test('normalizing a saved workspace backfills only untouched fixed demo patients and empty fields',()=>{
  const w=legacy(),find=id=>w.patients.find(p=>p.id===id);
  find('TN-1042').identityHistory=[{dateOfBirth:'1972-02-02',medicalRecordNumber:'DEMO-000101',date:now,actor:'Clinician'}];
  find('TN-1038').dateOfBirth='1964-07-15';
  find('TN-1051').name='Elena Rodriguez-Park';
  find('TN-1047').age=69;
  w.patients.push({...structuredClone(find('TN-1034')),id:'TN-5A1B2C3D',name:'Taylor Morgan',medicalRecordNumber:'DEMO-000107'});
  const next=normalizeWorkspace(w),get=id=>next.patients.find(p=>p.id===id);
  assert.equal(get('TN-1042').dateOfBirth,undefined,'a cleared identity with history is never refilled');assert.equal(get('TN-1042').medicalRecordNumber,undefined);
  assert.equal(get('TN-1038').dateOfBirth,'1964-07-15','a recorded DOB is kept');assert.equal(get('TN-1038').medicalRecordNumber,'DEMO-000102','the empty MRN is filled');
  assert.equal(get('TN-1051').dateOfBirth,undefined,'a renamed patient is left alone');
  assert.equal(get('TN-1047').dateOfBirth,undefined,'a changed age is left alone');
  assert.equal(get('TN-1031').dateOfBirth,'1981-03-03');assert.equal(get('TN-1031').medicalRecordNumber,undefined,'an MRN already in use is not duplicated');
  assert.equal(get('TN-5A1B2C3D').dateOfBirth,undefined,'an added patient is never given demo identifiers');
  for(const id of ['TN-DEMO-01','TN-DEMO-02','TN-DEMO-03','TN-1055','TN-1049','TN-1034'])assert.deepEqual([get(id).dateOfBirth,get(id).medicalRecordNumber],[demoIdentities[id].dateOfBirth,demoIdentities[id].medicalRecordNumber]);
  assert.deepEqual(normalizeWorkspace(structuredClone(next)),next,'the backfill is idempotent');
});

test('backfilled or edited identifiers do not age saved engine runs',()=>{
  const current=showcase(),old=strip(structuredClone(current)),next=normalizeWorkspace(structuredClone(old));
  for(const p of current.patients){
    const revision=engineRecordRevision(p,current);
    assert.equal(engineRecordRevision(old.patients.find(o=>o.id===p.id),old),revision,p.name+': identifiers are not engine inputs');
    assert.equal(engineRecordRevision(next.patients.find(o=>o.id===p.id),next),revision,p.name+': the backfill keeps the revision');
  }
  assert.ok(current.engineRuns.some(run=>run.revision===engineRecordRevision(current.patients.find(p=>p.id===run.patientId),current)),'the showcase has current saved runs to protect');
  // Clearing identifiers in the dialog is recorded and survives every later normalize.
  const cleared=applyAction(current,actionSchema.parse({type:'patient.identity.update',patientId:'TN-DEMO-01',dateOfBirth:'',medicalRecordNumber:''}),'Clinician',now);
  const emma=normalizeWorkspace(cleared).patients.find(p=>p.id==='TN-DEMO-01');
  assert.equal(emma.dateOfBirth,undefined);assert.equal(emma.medicalRecordNumber,undefined);assert.equal(emma.identityHistory[0].medicalRecordNumber,'DEMO-000109');
  assert.equal(hasDemoIdentity(emma),false);assert.equal(hasDemoIdentity(current.patients.find(p=>p.id==='TN-DEMO-01')),true);
});

test('the chart header labels MRN and workspace ID, and the identity pin repeats name, DOB, MRN and allergy status',()=>{
  const w=showcase(),render=p=>renderToStaticMarkup(React.createElement(PatientDetail,{patient:p,ctx:{data:w,user:'Identity reviewer',busy:false,save:async()=>true,open(){},signOut:async()=>{}}}));
  const emma=w.patients.find(p=>p.id==='TN-DEMO-01'),html=render(emma);
  assert.match(html,/<button type="button" class="patient-dob-control" aria-haspopup="dialog">DOB <strong>May 5, 1974<\/strong><\/button>/);
  assert.match(html,/<button type="button" class="patient-dob-control" aria-haspopup="dialog">MRN <strong>DEMO-000109<\/strong><\/button>/);
  assert.match(html,/<span class="patient-record-id">Workspace ID TN-DEMO-01<\/span>/);
  const pin=html.slice(html.indexOf('<div class="patient-identity-pin"'));
  assert.match(pin,/^<div class="patient-identity-pin" aria-hidden="true"><strong>Emma Carter<\/strong><span><small>DOB<\/small> 5\/5\/1974<\/span><span><small>MRN<\/small> DEMO-000109<\/span><span class="patient-identity-pin-allergy is-unreviewed">/);
  assert.match(pin.slice(0,pin.indexOf('</div>')),/<small>Allergies:<\/small> <span>Not reviewed<\/span>/);
  const unrecorded={...structuredClone(emma),dateOfBirth:undefined,medicalRecordNumber:undefined,clinicalContext:{...emma.clinicalContext,allergyStatus:'Reactions reported',allergies:'Penicillin (hives)'}};
  const missing=render(unrecorded);
  assert.match(missing,/>MRN <strong>not recorded<\/strong><\/button>/);assert.match(missing,/>DOB <strong>not recorded<\/strong><\/button>/);
  assert.match(missing,/<span class="is-missing"><small>DOB<\/small> not recorded<\/span><span class="is-missing"><small>MRN<\/small> not recorded<\/span><span class="patient-identity-pin-allergy has-reactions">/);
  assert.match(missing,/<small>Allergies:<\/small> <span>Penicillin \(hives\)<\/span>/);
  assert.equal(birthDateShort('1974-05-05'),'5/5/1974');assert.equal(birthDateShort('1981-12-31'),'12/31/1981');
});

test('the date of birth sits beside the patient name in the directory, care overview and advisor header',()=>{
  const w=showcase(),emma=w.patients.find(p=>p.id==='TN-DEMO-01');
  emma.dateOfBirth=undefined;
  const ctx={data:w,user:'Identity reviewer',busy:false,save:async()=>true,open(){},signOut:async()=>{}};
  const dob=p=>dobText(p.dateOfBirth);
  assert.equal(dobText('1974-05-05'),'DOB 5/5/1974');assert.equal(dobText(undefined),'DOB not recorded');
  const directory=renderToStaticMarkup(React.createElement(Patients,{ctx}));
  for(const p of w.patients)assert.ok(directory.includes('<strong>'+p.name+'</strong><small>'+dob(p)+' · '),p.name+' directory row shows '+dob(p));
  assert.ok(directory.includes('<strong>Emma Carter</strong><small>DOB not recorded · MRN DEMO-000109 · 52 years</small>'),'a missing DOB reads as not recorded');
  const overview=renderToStaticMarkup(React.createElement(ClinicianOverview,{ctx}));
  const lucas=w.patients.find(p=>p.id==='TN-DEMO-02');
  assert.ok(overview.includes('<div class="overview-patient-meta"><span>'+dob(lucas)+'</span><span>MRN '+lucas.medicalRecordNumber+'</span>'),'care overview rows show the DOB first');
  const dock=renderToStaticMarkup(React.createElement(AdvisorDock,{p:lucas,ctx,startOpen:true,page:'visit'}));
  assert.ok(dock.includes('<small>Lucas Hayes · '+dob(lucas)+' · This visit</small>'),'advisor header names the patient with DOB');
  assert.ok(renderToStaticMarkup(React.createElement(AdvisorDock,{p:emma,ctx,startOpen:true,page:'visit'})).includes('<small>Emma Carter · DOB not recorded · This visit</small>'));
});
