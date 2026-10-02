import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ADVISOR_NAME} from './fixtures/product-names.mjs';
const bundle=await build({stdin:{contents:"export {PatientOverview} from './components/theranetrix/patient-overview'; export * from './lib/theranetrix'; export * from './lib/actions'; export * from './lib/patient-overview'; export {patientSuggestions} from './lib/medications';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {PatientOverview,seedWorkspace,applyAction,actionSchema,patientSnapshot,patientActivity,emptyClinicalContext,patientSuggestions}=mod.exports;
const when='2026-09-08T14:00:00Z',actor='Clinical reviewer';
const act=(w,a)=>applyAction(w,actionSchema.parse(a),actor,when);
const render=(data,p=data.patients[0])=>renderToStaticMarkup(React.createElement(PatientOverview,{p,ctx:{data,user:actor,busy:false,save:async()=>true,open:()=>{}},changeTab:()=>{}}));

test('patient overview exposes medication, plan, models, context, messages and care actions for the selected patient',()=>{
 let w=seedWorkspace();w=act(w,{type:'plan.save',patientId:'TN-1042',text:'Discuss grogginess and daily activity goals.',owner:'Taylor, RN',followup:'2026-09-09',time:'10:30'});w.patients[1].notes[0].text='Different patient private note';const html=render(w);
 for(const text of ['What needs a decision','Gabapentin','Partly helpful','Discuss grogginess','Taylor, RN','PST','Shadow AI',ADVISOR_NAME+' handoffs','Clinical &amp; biopsychosocial context','Save reply','Mark follow-up complete','Record completeness','Not reviewed'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('Different patient private note'));assert.ok(!html.includes('James Wilson'));
});
test('new patient has no invented medication, completed allergy review, pathway, outcomes or model result',()=>{
 const w=act(seedWorkspace(),{type:'patient.add',name:'New Patient',dateOfBirth:'1981-04-12',condition:'Under review',clinician:'Clinician',goal:'Discuss my goals'});const html=render(w);
 for(const text of ['Not reviewed','No active medication entries','Not enrolled in a pathway','No agreed plan recorded','Not recorded','Observed-data demo connected'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('Gabapentin'));assert.ok(!html.includes('None reported at last review'));assert.ok(!html.includes('5 of 5 activities'));
});
test('disabled assessments stop derived prompts and check-in history while clinician records remain',()=>{
 let w=seedWorkspace();w=act(w,{type:'checkin.add',patientId:'TN-1042',pain:9,sleep:3,function:2,note:'Distinct assessment note'});assert.ok(patientSuggestions(w.patients[0],w).some(s=>s.title==='Review the latest symptom change'));
 w=act(w,{type:'feature.toggle',feature:'assessments',enabled:false});const p=w.patients[0],html=render(w);assert.ok(html.includes('Assessments off'));assert.ok(html.includes('Observed outcomes'));assert.ok(!html.includes('Distinct assessment note'));assert.ok(!patientSuggestions(p,w).some(s=>s.title==='Review the latest symptom change'));assert.ok(!patientActivity(p,w).some(e=>e.title==='Patient check-in'));assert.ok(html.includes('Gabapentin'));
});
test('clinical context saves history and patient-specific audit without losing prior state',()=>{
 const w=seedWorkspace(),original=structuredClone(w),id=w.patients[0].id;const action={type:'context.update',patientId:id,...emptyClinicalContext,allergyStatus:'Reactions reported',allergies:'Sample allergen: reported rash',medicalHistory:'Reviewed sample history',preferences:'Prioritize clear thinking and walking comfort',coordinator:'Taylor, RN'};
 const next=act(w,action);assert.deepEqual(w,original);assert.deepEqual(next.patients[1],w.patients[1]);assert.equal(next.patients[0].clinicalContext.author,actor);assert.equal(next.audit[0].patientId,id);
 const changed=act(next,{...action,allergyStatus:'None reported',allergies:''});assert.equal(changed.patients[0].clinicalContext.allergies,'');assert.equal(changed.patients[0].clinicalContext.history[0].allergies,action.allergies);assert.equal(changed.patients[0].notes.length,w.patients[0].notes.length);
 assert.throws(()=>act(w,{...action,allergies:''}),/allergen/);assert.throws(()=>act(w,{...action,patientId:'unknown'}),/not found/);
});
test('snapshot preserves clinical priority, correct patient and chronological conversation state',()=>{
 const w=seedWorkspace(),p=w.patients[0];w.reviews.unshift({id:'new-routine',patientId:p.id,title:'Routine',detail:'Routine',priority:'Routine',status:'Open',source:'Test',created:'2026-09-08T15:00:00Z'});w.messages.unshift({id:'new-message',patientId:p.id,text:'Latest patient message',date:'2026-09-08T16:00:00Z',sender:p.name,direction:'in'});const snapshot=patientSnapshot(p,w);assert.equal(snapshot.reviews[0].priority,'High');assert.equal(snapshot.lastMessage.text,'Latest patient message');assert.equal(snapshot.replyNeeded,true);assert.ok(snapshot.tasks.every(t=>t.patientId===p.id));assert.ok(snapshot.gaps.some(g=>g.label==='Allergies need review'));
});
