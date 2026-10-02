import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const bundle=await build({stdin:{contents:"export * from './components/theranetrix/engine-workspace'; export {ClinicianOverview,ClinicianBoard} from './components/theranetrix/clinician-overview'; export {defaultDashboardLayout} from './lib/dashboard-layout'; export * from './lib/theranetrix'; export * from './lib/engine-demo'; export * from './lib/actions'; export {normalizeWorkspace} from './lib/medications';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {EngineBoard,EngineEncounterSummary,PatientPlan,seedWorkspace,normalizeWorkspace,engineRecordRevision,defaultEnginePreferences,applyAction,actionSchema}=mod.exports;
const ctx=data=>({data,user:'Reviewer',busy:false,save:async()=>false,open:()=>{}});
const render=(Component,w,p,extra={})=>renderToStaticMarkup(React.createElement(Component,{p,ctx:ctx(w),...extra}));
test('configured clinician overview exposes all patient engine answers without running or navigating',()=>{
 const w=normalizeWorkspace(seedWorkspace());w.engineRuns=[];
 const defaultHtml=render(mod.exports.ClinicianOverview,w,w.patients[0]);
 assert.ok(!defaultHtml.includes('Current engine answers'),'The default concise layout leaves engine summaries collapsed from the panel.');
 for(const p of w.patients){assert.ok(defaultHtml.includes('href="/patients/'+p.id+'"'));assert.ok(defaultHtml.includes('aria-label="Show review details for '+p.name+'"'));}
 const html=render(mod.exports.ClinicianBoard,w,w.patients[0],{layout:{...mod.exports.defaultDashboardLayout(),showEngines:true}});
 for(const p of w.patients)assert.ok(html.includes('Current engine answers for '+p.name),p.name);
 assert.equal(html.match(/Updates with saved patient data/g)?.length,w.patients.length);
 assert.ok(!html.includes('Run engines'));assert.ok(html.includes('No run required.'));
});
test('connected overview renders Twin, PST and Shadow, distinct source labels, controls and only the selected patient',()=>{
 const w=normalizeWorkspace(seedWorkspace()),p=w.patients.find(x=>x.id==='TN-DEMO-01'),html=render(EngineBoard,w,p,{initialTab:'overview'});
 for(const text of ['Digital Twin','PST','Shadow AI','Run engines','Pain relief','Different first priority','Gabapentin','Live calculation preview'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('Lucas Hayes'));assert.ok(!html.includes('Walk with my dog'));assert.ok(!html.includes('simulation'));assert.ok(!html.includes('illustrative'));
 const twin=render(EngineBoard,w,p,{initialTab:'twin'});
 for(const text of ['Difference from target','Projected course','Treatment target'])assert.ok(twin.includes(text),text);
});
test('disabled engines do not render their charts or ranking actions and the saved care plan remains',()=>{
 const w=normalizeWorkspace(seedWorkspace()),p=w.patients.find(x=>x.id==='TN-DEMO-01');w.features.assessments=false;w.features.advisor=false;w.features.pathways=false;
 const html=render(EngineBoard,w,p,{initialTab:'overview'});assert.ok(!html.includes('aria-label="Pain over time'));assert.ok(!html.includes('Profile: benefit'));assert.ok(html.includes('Digital Twin is off'));assert.ok(html.includes('No medication change is recorded'));
 const plan=render(PatientPlan,w,p);assert.ok(plan.includes(p.carePlans[0].text));
});
test('seven-minute summary automatically updates after a concern without changing historical runs',()=>{
 let w=normalizeWorkspace(seedWorkspace()),p=w.patients.find(x=>x.id==='TN-DEMO-02');w=applyAction(w,actionSchema.parse({type:'engine.run',patientId:p.id,expectedRevision:engineRecordRevision(p,w),preferences:defaultEnginePreferences}),'Reviewer','2026-09-09T12:00:00Z');
 w=applyAction(w,actionSchema.parse({type:'advisor.chat',patientId:p.id,intent:'concern',text:'New difficulty walking today.'}),'Reviewer','2026-09-09T12:01:00Z');p=w.patients.find(x=>x.id===p.id);
 const history=JSON.stringify(w.engineRuns),html=render(EngineEncounterSummary,w,p);assert.ok(html.includes('New difficulty walking today.'));assert.ok(html.includes('1 open care-team handoff'));assert.ok(html.includes('Updates with saved patient data'));assert.ok(html.includes('Inspect engines'));assert.ok(!html.includes('Run engines'));assert.equal(JSON.stringify(w.engineRuns),history);
});
test('overview answers appear before any run, preserve zero values and respect feature gates',()=>{
 const w=normalizeWorkspace(seedWorkspace()),p=w.patients.find(x=>x.id==='TN-DEMO-01');w.engineRuns=[];p.pain[p.pain.length-1]=0;
 const html=render(EngineEncounterSummary,w,p);
 for(const label of ['Digital Twin','PST','Shadow AI','Pain 0/10','Reason &amp; sources: PST review'])assert.ok(html.includes(label),label);
 assert.ok(!html.includes('Why this recommendation'),'the default detail label makes no recommendation claim');
 assert.ok(!html.includes('Run engines'));assert.ok(!html.includes('Ready for'));assert.ok(!html.includes('Lucas Hayes'));
 w.features.assessments=false;w.features.advisor=false;
 const off=render(EngineEncounterSummary,w,p);assert.equal(off.match(/Off in settings/g)?.length,3);assert.ok(!off.includes('Pain 0/10'));assert.ok(!off.includes('Suggested next check-in'));
});
test('the Digital Twin tab calls its mood-weighted number a Twin summary, not a composite, and names no model',()=>{
 const w=normalizeWorkspace(seedWorkspace()),p=w.patients.find(x=>x.id==='TN-DEMO-01');
 const html=renderToStaticMarkup(React.createElement(EngineBoard,{p,ctx:ctx(w),initialTab:'twin'}));
 assert.ok(html.includes('Twin summary (prototype)'));assert.ok(html.includes('not the visit tab’s pain · function · sleep composite'));
 assert.ok(!html.includes('Prototype composite'));assert.ok(!/Patient-specific|switches its model label/.test(html));
 const overview=readFileSync('components/theranetrix/clinician-overview.tsx','utf8');
 assert.match(overview,/label=\{s\.kind==='referral'\?'Reason & sources':undefined\}/,'the referral prompt opens with Reason & sources, not Why this recommendation');
});
test('engine names are glossary terms outside links, page headings that are glossary keys are terms, and the unused comparison views are gone',()=>{
 const w=normalizeWorkspace(seedWorkspace()),p=w.patients.find(x=>x.id==='TN-DEMO-01'),html=render(EngineEncounterSummary,w,p);
 for(const term of ['PST','Shadow AI']){
  assert.match(html,new RegExp(`<strong><button type="button" class="glossary-term" title="[^"]+"[^>]*>${term}</button></strong>`),term);
 }
 for(const link of html.match(/<a [^>]*>.*?<\/a>/g)??[])assert.doesNotMatch(link,/<button/,'no button inside a link');
 for(const [path,term] of [['/pst','PST'],['/shadow-ai','Shadow AI']]){
  const page=renderToStaticMarkup(React.createElement(mod.exports.EngineWorkspace,{ctx:ctx(w),path}));
  assert.match(page,new RegExp(`<h1><button type="button" class="glossary-term"[^>]*>${term}</button></h1>`),path);
 }
 assert.match(renderToStaticMarkup(React.createElement(mod.exports.EngineWorkspace,{ctx:ctx(w),path:'/engines'})),/<h1>Treatment<\/h1>/);
 const source=readFileSync('components/theranetrix/engine-workspace.tsx','utf8');
 for(const gone of ['TWO VIEWS, ONE CLINICIAN DECISION','function Comparison(','function FocusedEngine(','function PreferencePanel('])assert.ok(!source.includes(gone),gone);
});

