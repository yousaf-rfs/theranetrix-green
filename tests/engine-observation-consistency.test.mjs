import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const bundle=await build({stdin:{contents:"export * from './lib/engine-demo';export * from './lib/visit-presentation';export {seedWorkspace} from './lib/theranetrix';export {PatientDigitalTwin,RecordedTrendChart} from './components/theranetrix/patient-digital-twin';export {EngineBoard} from './components/theranetrix/engine-workspace';export {EngineEncounterSummary} from './components/theranetrix/live-engine-summary';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {seedWorkspace,visitObservations,buildEngineOutput,twinOverview,advisorReply,prototypeComposite,engineRecordRevision,PatientDigitalTwin,RecordedTrendChart,EngineBoard,EngineEncounterSummary}=mod.exports;
const reportDate='2026-09-19T09:00:00Z';
function fixture(){const w=seedWorkspace(),p=w.patients[0];p.dates=['2026-09-01','2026-09-02'];p.pain=[3,8];p.function=[7,4];p.sleep=[5,5];p.checkins=[];return {w,p};}
const entry=(id,metric,status,value,extra={})=>({id,workflowRecordId:'latest-report',workflowVersion:1,metric,status,...(value===undefined?{}:{value}),recordedAt:reportDate,source:'Patient self-report',...extra});
const render=(Component,w,p,extra={})=>renderToStaticMarkup(React.createElement(Component,{p,ctx:{data:w,busy:false,user:'Reviewer',save:async()=>false,open:()=>{}},...extra}));

test('latest partial report and true zero agree across engine sources, Twin, Advisor, and current UI',()=>{
 const {w,p}=fixture();p.workflowObservations=[entry('pain','pain','zero',0),entry('function','function','unanswered'),entry('sleep','sleep','declined')];
 const before=structuredClone(w),output=buildEngineOutput(p,w),source=output.sources.find(s=>s.label==='Latest observations');
 assert.equal(source.date,reportDate);assert.match(source.value,/Pain 0\/10; function unanswered; sleep declined/);assert.ok(!output.signals.includes('Pain rose since the previous check-in.'));
 assert.deepEqual(twinOverview(p).scores,{pain:0,location:'Not recorded',function:null,sleep:null,mood:null});assert.equal(twinOverview(p).composite,null);
 const reply=advisorReply(p,w,'question','What is my pain trajectory?').reply;assert.match(reply,/pain 3 \/10 → 0 \/10/);assert.match(reply,/Function not answered/);assert.ok(reply.includes(reportDate));
 const patientHtml=render(PatientDigitalTwin,w,p);assert.match(patientHtml,/<span>Pain<\/span><strong>0<small>\/10/);assert.match(patientHtml,/<span>Daily activities<\/span><strong>Not recorded/);
 const clinicianHtml=render(EngineBoard,w,p,{initialTab:'twin'});assert.match(clinicianHtml,/aria-label="Latest recorded pain"><span>Pain<\/span><strong>0<small>\/10/);assert.match(clinicianHtml,/aria-label="Latest recorded daily function"><span>Daily function<\/span><strong>Not recorded/);
 assert.match(render(EngineEncounterSummary,w,p),/Pain 0\/10/);assert.deepEqual(w,before);
});

test('a corrected latest pain replaces its predecessor and withdrawn reports are not current',()=>{
 const {w,p}=fixture();p.workflowObservations=[entry('old-pain','pain','answered',9),entry('corrected-pain','pain','zero',0,{workflowVersion:2,correctedFromEntryId:'old-pain'})];
 assert.equal(visitObservations(p).at(-1).pain,0);assert.equal(twinOverview(p).scores.pain,0);assert.match(buildEngineOutput(p,w).sources.find(s=>s.label==='Latest observations').value,/Pain 0\/10/);
 p.workflowObservations.forEach(row=>row.withdrawnAt='2026-09-20T10:00:00Z');
 const after=buildEngineOutput(p,w);assert.equal(after.sources.find(s=>s.label==='Latest observations').date,'2026-09-02');assert.equal(twinOverview(p).scores.pain,8);assert.ok(!after.points.some(row=>row.date===reportDate));
});

test('a missing latest pain is shown as missing and cannot continue a stale forecast',()=>{
 const {w,p}=fixture();p.workflowObservations=[entry('pain','pain','declined'),entry('function','function','answered',6),entry('sleep','sleep','unanswered')];
 const output=buildEngineOutput(p,w);assert.equal(output.points.at(-1).date,reportDate);assert.equal(output.points.at(-1).pain,null);assert.equal(output.points.at(-1).scenario,null);assert.ok(!output.points.some(row=>row.low!==null));
 assert.match(render(EngineEncounterSummary,w,p),/Pain not answered in latest report/);assert.match(render(PatientDigitalTwin,w,p),/<span>Pain<\/span><strong>Not recorded/);
 const chart=renderToStaticMarkup(React.createElement(RecordedTrendChart,{patient:p,metric:'function'}));assert.match(chart,/Daily activities 6\/10/);
 assert.match(output.gaps.join(' '),/Older values are not used as current scores/);
});

test('a first workflow observation is usable without a legacy trajectory projection',()=>{
 const {w,p}=fixture();p.dates=[];p.pain=[];p.function=[];p.sleep=[];
 p.workflowObservations=[entry('pain','pain','zero',0),entry('function','function','answered',6),entry('sleep','sleep','answered',7)];
 const output=buildEngineOutput(p,w);assert.ok(output.candidates.length);assert.equal(output.points[0].pain,0);assert.equal(output.points[0].date,reportDate);assert.equal(twinOverview(p).scores.function,6);assert.notEqual(prototypeComposite(p).value,null);assert.equal(prototypeComposite(p).value,2.3,"mean(pain 0, 10-function 6, 10-sleep 7)");
 p.workflowObservations=[entry('function','function','answered',6)];assert.deepEqual(buildEngineOutput(p,w).points,[]);assert.equal(twinOverview(p).scores.pain,null);assert.equal(twinOverview(p).scores.function,6);assert.equal(twinOverview(p).composite,null);
});

test('recalculation after a new partial report preserves immutable saved source excerpts',()=>{
 const {w,p}=fixture(),run={...buildEngineOutput(p,w),id:'old-run',date:'2026-09-02T10:00:00Z',actor:'Reviewer'};w.engineRuns=[run];const snapshot=structuredClone(run);
 p.workflowObservations=[entry('pain','pain','zero',0)];const current=buildEngineOutput(p,w);
 assert.notEqual(engineRecordRevision(p,w),run.revision);assert.match(current.sources.find(s=>s.label==='Latest observations').value,/Pain 0\/10/);assert.match(run.sources.find(s=>s.label==='Latest observations').value,/Pain 8\/10/);assert.deepEqual(run,snapshot);
});

// Old runs used the same clinical rule version but different observation sources.
test('source normalization version invalidates a legacy run without rewriting its history',()=>{
 const {w,p}=fixture(),{twinPreferences,...clinicalPatient}=p;let n=2166136261;
 const legacyInputs={version:'connected-engine-v1',patient:clinicalPatient,features:w.features,reviews:w.reviews.filter(r=>r.patientId===p.id),messages:w.messages.filter(m=>m.patientId===p.id),tasks:w.tasks.filter(t=>t.patientId===p.id&&t.workflowDomain!=='decisions'),advisor:w.advisorTurns?.filter(t=>t.patientId===p.id)};
 for(const c of JSON.stringify(legacyInputs))n=Math.imul(n^c.charCodeAt(0),16777619);const legacyRevision=(n>>>0).toString(16).padStart(8,'0');
 assert.notEqual(engineRecordRevision(p,w),legacyRevision);assert.match(buildEngineOutput(p,w).basis.join(' '),/record-observations-v2/);
});
