import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const bundle=await build({stdin:{contents:"export * from './lib/theranetrix';export * from './lib/actions';export * from './lib/medications';export * from './lib/treatment-review';export * from './lib/demo-insights';export {EncounterReview} from './components/theranetrix/encounter-review';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {seedWorkspace,normalizeWorkspace,applyAction,actionSchema,treatmentCourse,daysBetween,demoInsights,EncounterReview}=mod.exports;
const findingId='TN-DEMO-01',improvingId='TN-DEMO-02';
const act=(w,a)=>applyAction(w,actionSchema.parse(a),'Reviewer','2026-09-08T15:00:00Z');
const get=(w,id)=>w.patients.find(p=>p.id===id);
const render=(w,p)=>renderToStaticMarkup(React.createElement(EncounterReview,{p,ctx:{data:w,user:'Reviewer',busy:false,save:async()=>true,open:()=>{}},changeTab:()=>{}}));

test('two contrasting cases have coherent records, reported response, prior trials, goal evidence, and follow-up',()=>{
 const w=seedWorkspace(),a=get(w,findingId),b=get(w,improvingId);
 assert.equal(treatmentCourse(a,w).direction,'Finding a treatment');assert.equal(treatmentCourse(b,w).direction,'Monitoring benefit');assert.equal(treatmentCourse(b,w).needsRecheck,false);
 for(const p of [a,b]){assert.equal(p.checkins.length,p.dates.length);assert.deepEqual(p.checkins.map(c=>c.pain).reverse(),p.pain);assert.equal(p.carePlans[0].followup,w.tasks.find(t=>t.id==='medication-followup-'+p.id).date);assert.equal(p.medications[0].history[0].reportedAt,p.medications[0].reportedAt);assert.equal(p.treatmentReview.goalAtReview,p.goal);assert.ok(p.medications[1].stopReason);}
 assert.equal(daysBetween(a.medications[0].regimenSince,a.medications[0].reportedAt),28);assert.equal(daysBetween(b.medications[0].regimenSince,b.medications[0].reportedAt),35);assert.equal(daysBetween('','2026-09-08'),null);
 const html=render(w,a),other=render(w,b);
 for(const text of ['28 days on this regimen','Topical lidocaine','Previously tried','Partly met','Options discussed with the clinician','For discussion','No alternative has been selected','Gabapentin'])assert.ok(html.includes(text),text);
 for(const text of ['35 days on this regimen','Monitoring benefit','Goal: Met','60 mg orally once daily','Agreed','Deferred','20-minute walks','Taylor Reed'])assert.ok(other.includes(text),text);
 assert.ok(!other.includes('Morning grogginess interferes with concentration'));
});

test('legacy upgrade adds only absent cases once, preserving saved patients, feature settings and edited examples',()=>{
 const w=seedWorkspace();delete w.demoCasesVersion;w.patients=w.patients.filter(p=>!p.demoCase);w.tasks=w.tasks.filter(t=>!t.patientId.startsWith('TN-DEMO'));w.messages=w.messages.filter(m=>!m.patientId.startsWith('TN-DEMO'));w.reviews=w.reviews.filter(r=>!r.patientId.startsWith('TN-DEMO'));w.patients[0].goal='User edit';w.patients[1].medications=[];w.features.assessments=false;const existing=structuredClone(w.patients);
 normalizeWorkspace(w);assert.deepEqual(w.patients.slice(0,8),existing);assert.equal(w.features.assessments,false);assert.equal(w.patients.length,10);
 get(w,improvingId).medications=[];const saved=structuredClone(w);assert.deepEqual(normalizeWorkspace(w),saved);assert.equal(get(w,improvingId).medications.length,0);
});

test('new medication concerns supersede the favorable assessment and refresh the shared simulation',()=>{
 let w=seedWorkspace();const p=get(w,improvingId),m=p.medications[0],old=demoInsights(p,w);
 w=act(w,{type:'medication.save',patientId:p.id,id:m.id,name:m.name,regimen:m.regimen,indication:m.indication,started:m.started,status:'Active',benefit:'Partly helpful',tolerability:'Effects reported',effects:'New patient-reported concern',adherence:'Taken as recorded',reportedAt:'2026-09-08'});
 const updated=get(w,p.id);assert.equal(updated.medications[0].regimenSince,m.regimenSince);assert.equal(updated.medications[0].history.length,3);assert.equal(treatmentCourse(updated,w).needsRecheck,true);assert.notEqual(demoInsights(updated,w).revision,old.revision);assert.ok(render(w,updated).includes('New information needs review'));
 assert.equal(updated.treatmentReview.direction,'Monitoring benefit');assert.ok(demoInsights(updated,w).shadow.some(f=>f.id==='assessment-stale'));
});

test('goal changes invalidate attainment and saved decisions retain prior history and patient isolation',()=>{
 let w=seedWorkspace();const before=structuredClone(get(w,findingId));w=act(w,{type:'goal.update',patientId:improvingId,goal:'Walk for 40 minutes'});
 assert.equal(treatmentCourse(get(w,improvingId),w).goalStatus,'Needs review');
 const previous=get(w,improvingId).treatmentReview;
 const action={type:'treatment.review',patientId:improvingId,direction:'Monitoring benefit',goalStatus:'Partly met',goalEvidence:'Current 20 minutes; new target 40 minutes.',decision:'Review progress toward the revised walking goal.',monitoring:'Review at the scheduled follow-up.',options:previous.options};
 assert.throws(()=>act(w,{...action,goalEvidence:''}),/evidence/);
 w=act(w,action);const p=get(w,improvingId);assert.equal(p.treatmentReview.goalAtReview,p.goal);assert.equal(p.treatmentReview.history[0].goalStatus,'Met');assert.equal(p.treatmentReview.history[0].goalAtReview,previous.goalAtReview);assert.equal(treatmentCourse(p,w).needsRecheck,false);assert.deepEqual(get(w,findingId),before);assert.equal(w.audit[0].patientId,improvingId);assert.equal(p.notes[0].type,'Treatment review');
});

test('regimen and stop dates validate correctly and preserve the reason for previous discontinuation',()=>{
 const w=seedWorkspace(),p=get(w,findingId),m=p.medications[1];
 const action={type:'medication.save',patientId:p.id,id:m.id,name:m.name,regimen:m.regimen,indication:m.indication,started:m.started,status:m.status,benefit:m.benefit,tolerability:m.tolerability,effects:m.effects,adherence:m.adherence,reportedAt:m.reportedAt};
 const saved=act(w,action);assert.equal(get(saved,p.id).medications[1].stopReason,m.stopReason);assert.equal(get(saved,p.id).medications[1].stopped,m.stopped);
 assert.throws(()=>act(w,{...action,stopped:'2026-06-30'}),/stop date/);assert.throws(()=>act(w,{...action,regimenSince:'2026-08-01'}),/regimen date/);assert.throws(()=>act(w,{...action,stopped:'2026-09-09'}),/future/);
});

test('turning assessments off suppresses outcome and model outputs for the richer cases',()=>{
 let w=seedWorkspace();w=act(w,{type:'feature.toggle',feature:'assessments',enabled:false});const p=get(w,improvingId),html=render(w,p),insight=demoInsights(p,w);
 assert.ok(html.includes('Assessments off'));assert.ok(html.includes('Duloxetine'));assert.ok(html.includes('Monitoring benefit'));assert.deepEqual(insight.metrics,[]);assert.deepEqual(insight.shadow,[]);assert.deepEqual(insight.pst,[]);
});

test('a changed follow-up updates the panel date and visit task, and prompts review of the older treatment decision',()=>{
 let w=seedWorkspace();w=act(w,{type:'plan.save',patientId:improvingId,text:'New agreed follow-up plan.',owner:'Taylor Reed, RN',followup:'2026-09-30',time:'11:00'});
 const p=get(w,improvingId),task=w.tasks.find(t=>t.id==='medication-followup-'+p.id);
 assert.equal(p.nextVisit,'2026-09-30');assert.equal(task.date,p.nextVisit);assert.equal(task.type,'Phone call');assert.equal(task.time,'11:00');assert.equal(treatmentCourse(p,w).needsRecheck,true);assert.equal(p.status,'Needs review');assert.equal(w.tasks.filter(t=>t.id===task.id).length,1);
});
