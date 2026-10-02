import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const bundle=await build({stdin:{contents:"export * from './lib/visit-presentation'; export {seedWorkspace} from './lib/theranetrix'; export {twinOverview} from './lib/engine-demo'; export {EncounterReview} from './components/theranetrix/encounter-review';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {seedWorkspace,visitObservations,visitRecordState,prototypeComposite,outcomeComposite,changesSincePriorReport,twinOverview,EncounterReview}=mod.exports;
const report=(id,metric,status,value,extra={})=>({id,workflowRecordId:'partial',workflowVersion:1,encounterId:'encounter-a',metric,status,...(value===undefined?{}:{value}),source:'Patient self-report',recordedAt:'2026-09-19T09:00:00Z',confirmedAt:'2026-09-19T09:01:00Z',confirmedBy:'Clinician',...extra});
const render=(w,p=w.patients[0])=>renderToStaticMarkup(React.createElement(EncounterReview,{p,ctx:{data:w,user:'Clinician',busy:false,save:async()=>true,open:()=>{}},changeTab:()=>{}}));

test('report counts never manufacture visits from check-ins or signed amendments',()=>{
  const w=seedWorkspace(),p=w.patients[0],count=p.dates.length;
  assert.equal(visitRecordState(p,w).reportCount,count);
  assert.equal(visitRecordState(p,w).signedEncounters,0);
  w.clinicalWorkflows.slices.encounters.state.signoffs=[{patientId:p.id,encounterId:'visit-a',status:'signed'},{patientId:p.id,encounterId:'visit-a',status:'signed'},{patientId:p.id,encounterId:'visit-b',status:'draft'},{patientId:'other',encounterId:'visit-c',status:'signed'}];
  assert.equal(visitRecordState(p,w).signedEncounters,1);
  p.dates=[];p.pain=[];p.function=[];p.sleep=[];
  assert.equal(visitRecordState(p,w).dataState,'No reports yet');
  p.dates=['2026-09-19'];p.pain=[0];p.function=[0];p.sleep=[0];
  assert.equal(visitRecordState(p,w).dataState,'First report');
});

test('prototype composite is mean(pain, 10 − function, 10 − sleep) from observed values, with change since the prior report',()=>{
  const w=seedWorkspace(),p=w.patients[0];
  p.dates=['2026-09-01','2026-09-08'];p.pain=[7,6];p.function=[3,4];p.sleep=[4,5];p.checkins=[];p.workflowObservations=[];
  assert.equal(outcomeComposite({pain:6,function:4,sleep:5}),5.7);
  assert.equal(outcomeComposite({pain:0,function:10,sleep:10}),0,'Best possible answers give 0.');
  assert.equal(outcomeComposite({pain:10,function:0,sleep:0}),10,'Worst possible answers give 10: higher is worse, like pain.');
  assert.deepEqual(prototypeComposite(p),{value:5.7,previous:6.7,delta:-1,since:'2026-09-01',missing:[],date:'2026-09-08',declined:[],lastComplete:null});
  p.pain[1]=0;p.function[1]=0;p.sleep[1]=0;
  assert.equal(prototypeComposite(p).value,6.7,'True zeros are retained.');
  // Identical reports give identical composites: no inferred, keyword-driven mood term.
  const a=structuredClone(p),b=structuredClone(p);a.clinicalContext={psychologicalContext:'Feels discouraged and frustrated'};b.clinicalContext={psychologicalContext:'Confident, better mood'};
  assert.equal(prototypeComposite(a).value,prototypeComposite(b).value);
  assert.notEqual(twinOverview(a).composite,twinOverview(b).composite,'The twin’s mood-weighted summary differs; the visit composite does not use it.');
  p.sleep.pop();
  assert.equal(prototypeComposite(p).value,null,'Missing sleep never receives a default.');
  assert.ok(prototypeComposite(p).missing.includes('sleep'));
  p.sleep=[4,5];p.function=[null,4];
  assert.equal(prototypeComposite(p).delta,null,'No change is shown when the prior report is incomplete.');
});

test('the latest partial report replaces stale headline scores and suppresses the full-score composite',()=>{
  const w=seedWorkspace(),p=w.patients[0],count=p.dates.length;
  p.workflowObservations=[report('pain','pain','zero',0),report('function','function','unanswered'),report('sleep','sleep','declined')];
  const points=visitObservations(p),last=points.at(-1);
  assert.equal(points.length,count+1);
  assert.equal(last.pain,0);assert.equal(last.function,null);assert.equal(last.sleep,null);
  assert.equal(last.statuses.function,'unanswered');assert.equal(last.statuses.sleep,'declined');
  assert.equal(prototypeComposite(p).value,null);
  const html=render(w);
  assert.match(html,/<strong>0<\/strong>/);assert.match(html,/<strong>Unanswered<\/strong>/);assert.match(html,/<strong>Declined<\/strong>/);
  assert.match(html,/Composite \(pain · function · sleep\)/);
  assert.match(html,/Prototype · not a validated pain measure/);
  assert.match(html,/No default scores are substituted/);
  assert.doesNotMatch(html,/Composite summary|\/ 100|estimated mood used/i);
});

test('after a daily check-in without function the tile names the gap and the last complete report, never mixing dates',()=>{
  const w=seedWorkspace(),p=w.patients[0];
  p.dates=['2026-09-01','2026-09-08'];p.pain=[7,6];p.function=[3,4];p.sleep=[4,5];p.checkins=[];
  // A daily check-in where the patient skipped function: pain and sleep only.
  p.workflowObservations=[report('d-pain','pain','answered',8,{workflowRecordId:'daily'}),report('d-fn','function','unanswered',undefined,{workflowRecordId:'daily'}),report('d-sleep','sleep','answered',3,{workflowRecordId:'daily'})];
  const composite=prototypeComposite(p);
  assert.equal(composite.value,null,'The partial latest report still has no composite of its own');
  assert.deepEqual(composite.missing,['function']);assert.deepEqual(composite.declined,[]);assert.equal(composite.date,'2026-09-19T09:00:00Z');
  assert.deepEqual(composite.lastComplete,{value:5.7,date:'2026-09-08'},'The newest complete report, dated, with nothing carried forward from other days');
  const tile=render(w).match(/<div class="visit-composite">[\s\S]*?<\/details><\/div>/)[0];
  assert.match(tile,/Daily function not answered in the Sep 19(, 2026)? report/);
  assert.match(tile,/Last complete report: 5\.7 \/ 10 · Sep 8/);
  assert.match(tile,/it is not combined with newer answers/);
  assert.doesNotMatch(tile,/Needs all three measures/);
  p.workflowObservations=p.workflowObservations.map(row=>row.metric==='sleep'?{...row,status:'declined',value:undefined}:row);
  assert.match(render(w),/Daily function not answered, Sleep quality declined in the Sep 19(, 2026)? report/);
  p.dates=[];p.pain=[];p.function=[];p.sleep=[];
  assert.equal(prototypeComposite(p).lastComplete,null,'No complete report means no fallback value');
});

test('a check-in with every measure unanswered never replaces the latest answered report',()=>{
  const w=seedWorkspace(),p=w.patients[0],count=p.dates.length,index=count-1;
  p.workflowObservations=['pain','function','sleep'].map(metric=>report('blank-'+metric,metric,'unanswered',undefined,{workflowRecordId:'blank'}));
  const points=visitObservations(p),last=points.at(-1);
  assert.equal(points.length,count,'A blank submission adds no trajectory point');
  assert.equal(last.pain,p.pain[index]);assert.equal(last.function,p.function[index]);assert.equal(last.sleep,p.sleep[index]);
  assert.doesNotMatch(render(w),/<strong>Unanswered<\/strong>/);
  p.workflowObservations.push(report('declined-sleep','sleep','declined',undefined,{workflowRecordId:'declined'}));
  assert.equal(visitObservations(p).length,count+1,'An explicit decline is still a report');
});

test('corrected and withdrawn entries cannot become current, and projection does not duplicate a report',()=>{
  const w=seedWorkspace(),p=w.patients[0],index=p.dates.length-1;
  const sourceDate=p.dates[index]+'T09:00:00Z';
  p.workflowObservations=[report('old-pain','pain','answered',9,{recordedAt:sourceDate}),report('new-pain','pain','answered',p.pain[index],{workflowVersion:2,correctedFromEntryId:'old-pain',recordedAt:sourceDate}),report('fn','function','answered',p.function[index],{recordedAt:sourceDate}),report('sleep','sleep','answered',p.sleep[index],{recordedAt:sourceDate})];
  p.checkins.push({id:'projection',date:sourceDate,pain:p.pain[index],function:p.function[index],sleep:p.sleep[index],note:'',workflowRecordId:'partial',trajectoryIndex:index,source:'Clinician-confirmed report'});
  let points=visitObservations(p);
  assert.equal(points.length,p.dates.length);assert.equal(points.at(-1).pain,p.pain[index]);
  p.workflowObservations.push(report('declined-pain','pain','declined',undefined,{workflowVersion:3,correctedFromEntryId:'new-pain',recordedAt:sourceDate}));
  points=visitObservations(p);assert.equal(points.length,p.dates.length);assert.equal(points.at(-1).pain,null);
  const withdrawn=structuredClone(p);withdrawn.workflowObservations.forEach(row=>row.withdrawnAt='2026-09-20T10:00:00Z');withdrawn.dates=[];withdrawn.pain=[];withdrawn.function=[];withdrawn.sleep=[];
  assert.equal(visitObservations(withdrawn).length,0);
});

test('change summaries compare actual available scores and recorded medication history only',()=>{
  const w=seedWorkspace(),p=w.patients[0];
  p.dates=['2026-09-01','2026-09-08'];p.pain=[7,5];p.function=[4,6];p.sleep=[5,5];
  p.clinicalContext=undefined;p.carePlans=[];
  const m=p.medications[0];m.reportedAt='2026-09-08';m.benefit='Helpful';m.history=[{...m,reportedAt:'2026-09-01',benefit:'Partly helpful',date:'2026-09-01',author:'Clinician'}];
  const summary=changesSincePriorReport(p);
  assert.equal(summary.since,'2026-09-01');
  assert.deepEqual(summary.items.filter(item=>item.target==='outcomes').map(item=>[item.id,item.tone]),[['pain','better'],['function','better']]);
  assert.equal(summary.items.find(item=>item.target==='medications').medicationId,m.id);
  m.history=[];assert.ok(!changesSincePriorReport(p).items.some(item=>item.target==='medications'),'A newly recorded medication is not falsely presented as newly started.');
  p.dates=['2026-09-08'];p.pain=[5];p.function=[6];p.sleep=[5];
  assert.deepEqual(changesSincePriorReport(p).items,[]);
});

test('every observation row names a source, including check-ins saved before sources existed',()=>{
  const w=seedWorkspace(),p=w.patients.find(x=>x.checkins.length)??w.patients[0];
  p.checkins=p.checkins.map(({source,...checkin})=>checkin);
  for(const row of visitObservations(p))assert.ok(row.source&&!/not recorded/i.test(row.source),'Missing source on '+row.date);
  assert.ok(visitObservations(p).some(row=>row.source==='Patient check-in'));
  p.checkins=[];
  assert.ok(visitObservations(p).every(row=>row.source==='Stored trajectory'));
});
