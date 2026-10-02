import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({stdin:{contents:"export {PatientDigitalTwin} from './components/theranetrix/patient-digital-twin'; export {applyAction,actionSchema} from './lib/actions'; export {engineRecordRevision} from './lib/engine-demo'; export {defaultTwinPreferences} from './lib/patient-twin-settings'; export {seedWorkspace} from './lib/theranetrix'; export {normalizeWorkspace} from './lib/medications';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {PatientDigitalTwin,seedWorkspace,normalizeWorkspace}=mod.exports;
const {applyAction,actionSchema,engineRecordRevision,defaultTwinPreferences}=mod.exports;
const render=(w,p,extra={})=>renderToStaticMarkup(React.createElement(PatientDigitalTwin,{p,ctx:{data:w,busy:false},...extra}));
test('doctor preferences persist per patient without altering clinical inputs or other patients',()=>{
 const w=normalizeWorkspace(seedWorkspace()),p=w.patients[0],before=structuredClone(p),revision=engineRecordRevision(p,w);
 const preferences={...defaultTwinPreferences(),measures:['sleep'],primary:'sleep',showGoal:false,showMedications:false,showPlan:false,explanation:'Focus on your sleep check-ins.'};
 const action=actionSchema.parse({type:'patient.twin.configure',patientId:p.id,baseId:'',preferences});
 const saved=applyAction(w,action,'Dr. Reviewer','2026-09-11T10:00:00Z');
 const reloaded=normalizeWorkspace(JSON.parse(JSON.stringify(saved))),updated=reloaded.patients[0];
 assert.deepEqual(updated.twinPreferences.measures,['sleep']);assert.equal(updated.twinPreferences.author,'Dr. Reviewer');
 const {twinPreferences,...clinical}=updated;assert.deepEqual(clinical,before);
 assert.equal(engineRecordRevision(updated,reloaded),revision);assert.deepEqual(reloaded.patients[1],w.patients[1]);assert.equal(w.patients[0].twinPreferences,undefined);
 const html=render(reloaded,updated);assert.ok(html.includes('Sleep quality'));assert.ok(html.includes('Focus on your sleep check-ins.'));
 for(const hidden of ['Daily activities','Your medication reports','Your agreed next step','What matters to you'])assert.ok(!html.includes(hidden),hidden);
 assert.ok(html.includes('What is behind this view?'));
});
test('settings retain attributed history and reject stale editors',()=>{
 let w=normalizeWorkspace(seedWorkspace()),id=w.patients[0].id;
 const first={type:'patient.twin.configure',patientId:id,baseId:'',preferences:defaultTwinPreferences()};
 w=applyAction(w,actionSchema.parse(first),'First doctor','2026-09-11T10:00:00Z');
 const old=structuredClone(w.patients[0].twinPreferences);
 assert.throws(()=>applyAction(w,actionSchema.parse(first),'Second doctor'),/settings changed/);
 w=applyAction(w,actionSchema.parse({...first,baseId:old.id,preferences:{...first.preferences,showGoal:false}}),'Second doctor','2026-09-11T11:00:00Z');
 assert.equal(w.patients[0].twinPreferences.history[0].id,old.id);assert.equal(w.patients[0].twinPreferences.history[0].author,'First doctor');
 assert.equal(w.audit[0].patientId,id);assert.equal(w.audit[0].actor,'Second doctor');
});
test('server validates choices and prevents hiding mandatory explanation labels',()=>{
 const w=normalizeWorkspace(seedWorkspace()),base={type:'patient.twin.configure',patientId:w.patients[0].id,baseId:'',preferences:defaultTwinPreferences()};
 for(const fields of [{measures:[]},{measures:['sleep'],primary:'pain'},{measures:['pain','pain']},{showProvenance:false},{explanation:'x'.repeat(1201)}])assert.equal(actionSchema.safeParse({...base,preferences:{...base.preferences,...fields}}).success,false);
 assert.throws(()=>applyAction(w,actionSchema.parse({...base,patientId:'missing'}),'Doctor'),/Patient not found/);
});
test('patient twin shows the selected patient, current records, and no prediction claims',()=>{
 const w=normalizeWorkspace(seedWorkspace()),p=w.patients.find(p=>p.id==='TN-DEMO-01');
 const html=render(w,p);
 for(const text of ['Your Digital Twin','Daily activities','Sleep quality','Your medication reports','No engine snapshot'])assert.ok(html.includes(text),text);
 assert.ok(html.includes(p.goal));assert.ok(!html.includes('Lucas Hayes'));assert.ok(!html.includes('Run engines'));
});
test('zero and missing measures are distinct and the view follows changed records',()=>{
 const w=normalizeWorkspace(seedWorkspace()),p=w.patients[0];
 p.pain=[0];p.dates=['2026-09-11'];p.function=[];p.sleep=[];
 const before=render(w,p);assert.ok(before.includes('0<small>/10'));assert.ok(before.includes('Not recorded'));
 p.pain.push(3);p.dates.push('2026-09-12');
 const after=render(w,p);assert.ok(after.includes('3 points higher'));assert.ok(after.includes('3<small>/10'));
});
test('assessment dependency hides twin records, and compact mode retains the main results',()=>{
 const w=normalizeWorkspace(seedWorkspace()),p=w.patients[0];
 const compact=render(w,p,{compact:true,onExplore:()=>{}});assert.ok(compact.includes('Explore my Digital Twin'));assert.ok(!compact.includes('Your medication reports'));
 w.features.assessments=false;
 const off=render(w,p);assert.ok(off.includes('This view is turned off'));assert.ok(!off.includes(p.goal));assert.ok(!off.includes('Your medication reports'));
});
