import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({stdin:{contents:"export * from './lib/theranetrix';export * from './lib/configuration';export * from './lib/actions';export * from './lib/treatment-review';export * from './lib/medications';export * from './lib/demo-insights';export {Patients} from './components/theranetrix/app';export {CompanionProgress} from './components/theranetrix/workflows';export {ConfigurationSettings} from './components/theranetrix/configuration-settings';export {ClinicianOverview} from './components/theranetrix/clinician-overview';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false,outdir:'.test-build'});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {seedWorkspace,featureDefinitions,defaultPlanning,planningSummary,applyAction,actionSchema,treatmentCourse,patientSuggestions,demoInsights,Patients,CompanionProgress,ConfigurationSettings,ClinicianOverview}=mod.exports;
const act=(w,a)=>applyAction(w,actionSchema.parse(a),'Verified reviewer','2026-09-08T18:00:00Z');
const render=(component,data,props={})=>renderToStaticMarkup(React.createElement(component,{ctx:{data,user:'Verified reviewer',busy:false,save:async()=>true,open:()=>{}},...props}));
const item=(summary,id)=>summary.items.find(x=>x.id===id);

test('effective dependencies govern proposed scope and every blocked proposal stays visible',()=>{
 const w=seedWorkspace(),p=defaultPlanning();p.planned.predictiveTwin=true;p.planned.patientMedicalAdvice=true;
 w.features.assessments=false;const s=planningSummary(w.features,p);
 assert.equal(s.effective.digitalTwin,false);assert.equal(s.effective.pst,false);assert.equal(s.effective.shadow,false);
 assert.equal(s.planned.predictiveTwin,false);assert.equal(s.planned.patientMedicalAdvice,true);
 assert.ok(s.questions.some(q=>q.includes('Predict patient outcomes is requested but blocked')));
 assert.equal(item(s,'device-review').status,'Review needed');assert.equal(item(s,'pccp').status,'Conditional');
});
test('turning everything off never determines an exemption or completes release evidence',()=>{
 const features=Object.fromEntries(featureDefinitions.map(f=>[f.id,false])),p=defaultPlanning();const s=planningSummary(features,p);
 assert.equal(item(s,'scope').status,'Review needed');assert.equal(item(s,'dependencies').status,'Review needed');assert.equal(item(s,'cyber').status,'Review needed');
 assert.equal(item(s,'cds').status,'Review needed');assert.equal(item(s,'device-review').status,'Outside selected scope');assert.equal(s.scopeIncomplete,true);
 assert.ok(s.items.every(x=>x.status!=='Complete'));assert.ok(s.questions.some(q=>q.includes('release approval remain incomplete')));
});
test('clinical support remains in scope with PST or Shadow, and patient-facing declarations require review',()=>{
 const w=seedWorkspace(),p=defaultPlanning();w.features.reviewPrompts=false;p.users='Both';
 let s=planningSummary(w.features,p);assert.equal(item(s,'cds').status,'Review needed');assert.equal(item(s,'device-review').status,'Review needed');
 w.features.pst=false;w.features.shadow=false;p.users='Healthcare professionals';s=planningSummary(w.features,p);assert.equal(item(s,'cds').status,'Review needed');
 for(const k of Object.keys(p.criteria))p.criteria[k]='Yes';w.features.reviewPrompts=true;s=planningSummary(w.features,p);
 assert.equal(item(s,'cds').status,'Review needed');assert.ok(s.questions.some(q=>q.includes('supporting evidence')));
});
test('all future clinical behavior and explicit model updates prompt conditional AI change review',()=>{
 const w=seedWorkspace();for(const key of ['signalOrImageAnalysis','timeCriticalAlerts','automatedTreatmentActions']){const p=defaultPlanning();p.planned[key]=true;assert.equal(item(planningSummary(w.features,p),'pccp').status,'Conditional',key);}
 const p=defaultPlanning();p.plannedModelChanges='Yes';assert.equal(item(planningSummary(w.features,p),'pccp').status,'Conditional');
});
test('atomic configuration save snapshots actor, effective scope, assumptions, rules, and sources without losing history',()=>{
 const w=seedWorkspace(),before=structuredClone(w),p=defaultPlanning();p.intendedUse='Evaluate clinician review workflows with synthetic records';p.owner='Product reviewer';p.planned.predictiveTwin=true;
 const features={...w.features,assessments:false};let next=act(w,{type:'configuration.save',features,planning:p});
 assert.deepEqual(w,before);assert.deepEqual(next.patients,w.patients);assert.deepEqual(next.reviews,w.reviews);
 const entry=next.configurationHistory[0];assert.equal(entry.actor,'Verified reviewer');assert.equal(entry.requested.digitalTwin,true);assert.equal(entry.effective.digitalTwin,false);assert.equal(entry.effectivePlanned.predictiveTwin,false);assert.equal(entry.sources.length,8);assert.equal(entry.items.length,8);assert.ok(entry.rulesVersion);assert.ok(next.audit[0].action.includes(entry.id));
 next=act(next,{type:'feature.toggle',feature:'assessments',enabled:true});assert.equal(next.configurationHistory.length,2);assert.deepEqual(next.configurationHistory[1],entry);assert.equal(next.configurationHistory[0].effectivePlanned.predictiveTwin,true);
 assert.throws(()=>actionSchema.parse({type:'configuration.save',features:{...features,shadow:'false'},planning:p}));
});
test('directory and patient progress suppress assessment values and notes while retaining records',()=>{
 let w=act(seedWorkspace(),{type:'checkin.add',patientId:'TN-DEMO-02',pain:0,function:9,sleep:8,note:'Distinct retained assessment narrative'});
 const before=structuredClone(w.patients);w=act(w,{type:'feature.toggle',feature:'assessments',enabled:false});const p=w.patients.find(p=>p.id==='TN-DEMO-02');
 const directory=render(Patients,w),progress=render(CompanionProgress,w,{p,lang:'en'});
 assert.ok(directory.includes('Assessments off'));assert.ok(!directory.includes('class="table-trend"'));assert.ok(!directory.includes('/10'));
 assert.ok(progress.includes('Assessments off'));assert.ok(!progress.includes('Distinct retained'));assert.ok(!progress.includes('/10'));assert.deepEqual(w.patients,before);
 assert.ok(render(CompanionProgress,w,{p,lang:'es'}).includes('Registros desactivados'));
});
test('disabling charts and prompts cannot clear a newer record or remove an existing review status',()=>{
 let w=act(seedWorkspace(),{type:'checkin.add',patientId:'TN-DEMO-02',pain:8,function:2,sleep:3,note:'Newer data requiring clinician review'});
 const original=structuredClone(w.patients.find(p=>p.id==='TN-DEMO-02').treatmentReview);
 w=act(w,{type:'configuration.save',features:{...w.features,assessments:false,reviewPrompts:false},planning:defaultPlanning()});const p=w.patients.find(p=>p.id==='TN-DEMO-02');
 assert.equal(treatmentCourse(p,w).needsRecheck,true);assert.deepEqual(p.treatmentReview,original);assert.equal(p.status,'Needs review');assert.equal(w.reviews.filter(r=>r.patientId===p.id).length,0);
 assert.ok(patientSuggestions(p,w).every(s=>!s.attention));const insights=demoInsights(p,w);assert.deepEqual(insights.shadow,[]);assert.deepEqual(insights.pst,[]);assert.equal(insights.revision,'disabled');
 w.patients=[p];const html=render(ClinicianOverview,w);
 const summaryButtons=[...html.matchAll(/<button[^>]*class="triage-summary-card[^"]*"[^>]*>([\s\S]*?)<\/button>/g)].map(match=>match[1]);
 const needsReview=summaryButtons.find(button=>button.includes('Need review'));
 assert.ok(needsReview,'The review filter remains available when prompts are disabled.');
 assert.match(needsReview,/<strong>1<\/strong>/,'The persisted review status still contributes to the count.');
 assert.match(html,/<span class="badge amber">Needs review<\/span>/,'The patient priority remains visible before expanding details.');
 assert.ok(html.includes('Assessments off'));
 assert.ok(html.includes('aria-label="Show review details for '+p.name+'"'),'The retained patient record can still be expanded.');
});
test('disabled writes reject without changing records, while outstanding handoffs remain resolvable',()=>{
 const w=act(seedWorkspace(),{type:'configuration.save',features:{...seedWorkspace().features,messages:false,pathways:false},planning:defaultPlanning()}),before=structuredClone(w);
 for(const action of [{type:'message.send',patientId:'TN-1042',text:'Blocked',direction:'out'},{type:'advisor.request',patientId:'TN-1042',text:'Blocked'},{type:'pathway.enroll',patientId:'TN-1042'},{type:'pathway.step',patientId:'TN-1042',step:'intake',complete:true}]){assert.throws(()=>act(w,action),/turned off/);assert.deepEqual(w,before);}
 const next=act(w,{type:'review.update',id:'rev-3',status:'Resolved',resolution:'Reviewed the retained handoff with the care team.'});assert.equal(next.reviews.find(r=>r.id==='rev-3').status,'Resolved');
});
test('settings expose real controls, future scope, all 12 coverage domains, and evidence limitations',()=>{
 const html=render(ConfigurationSettings,seedWorkspace());
 for(const text of ['Enable Record-based review prompts','Future clinical capabilities','not implemented in this app','FDA planning for this configuration','initial screening assumptions','Saved configuration history','Save configuration','Reimbursement and licensing','Model governance','No configuration snapshot saved yet'])assert.ok(html.includes(text),text);
 assert.equal((html.match(/class="config-coverage-row"/g)||[]).length,12);assert.equal((html.match(/role="switch"/g)||[]).length,14);
});
