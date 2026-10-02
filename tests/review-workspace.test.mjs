import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ADVISOR_NAME} from './fixtures/product-names.mjs';
const bundle=await build({stdin:{contents:"export {SynopsisBoard,OutputTraceView} from './components/theranetrix/review-workspace'; export {defaultDashboardLayout,reviewSections} from './lib/dashboard-layout'; export {seedWorkspace} from './lib/theranetrix'; export {normalizeWorkspace} from './lib/medications'; export {applyAction,actionSchema} from './lib/actions'; export {engineRecordRevision,defaultEnginePreferences} from './lib/engine-demo'; export {EngineBoard} from './components/theranetrix/engine-workspace';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {SynopsisBoard,OutputTraceView,defaultDashboardLayout,reviewSections,seedWorkspace,normalizeWorkspace,applyAction,actionSchema,engineRecordRevision,defaultEnginePreferences,EngineBoard}=mod.exports;
const render=(w,layout)=>renderToStaticMarkup(React.createElement(SynopsisBoard,{p:w.patients[0],ctx:{data:w,busy:false,open:()=>{},save:async()=>true},layout,changeTab:()=>{}}));
test('synopsis covers all engines without requiring a saved run',()=>{
 const w=normalizeWorkspace(seedWorkspace()),markup=render(w,defaultDashboardLayout());
 for(const title of ['Medication response','Digital Twin','PST strategy comparison','Shadow AI review',ADVISOR_NAME+' and patient voice','Sources and evidence gaps','Decision, plan, and follow-up'])assert.ok(markup.includes(title),title);
 assert.ok(markup.includes('Clinical prediction, validated uncertainty'));assert.ok(markup.includes('Evidence services not connected'));
});
test('saved review layout preserves order after reload and cannot suppress mandatory concerns or plan',()=>{
 let w=normalizeWorkspace(seedWorkspace());w.reviews.push({id:'mandatory-concern',patientId:w.patients[0].id,title:'Concern must stay',detail:'Needs clinical review',priority:'High',source:'Test',status:'Open',created:'2026-09-11'});
 const layout={...defaultDashboardLayout(),reviewSections:['advisor','medications'],density:'compact'};
 w=applyAction(w,actionSchema.parse({type:'dashboard.save',baseRevision:'',name:'Patient review',layout}),'Reviewer');
 w=normalizeWorkspace(JSON.parse(JSON.stringify(w)));assert.deepEqual(w.dashboardProfiles[0].layout.reviewSections,['advisor','medications']);
 const markup=render(w,w.dashboardProfiles[0].layout);
 assert.ok(markup.indexOf(ADVISOR_NAME+' and patient voice')<markup.indexOf('Medication response'));
 assert.ok(markup.includes('Concern must stay'));assert.ok(markup.includes('Allergies:'));assert.ok(markup.includes('Decision, plan, and follow-up'));assert.ok(!markup.includes('Sources and evidence gaps'));assert.ok(markup.includes('synopsis-compact'));
});
test('invalid review sections are rejected and legacy layouts remain valid',()=>{
 for(const sections of [[],['twin','twin'],['made-up']])assert.equal(actionSchema.safeParse({type:'dashboard.save',baseRevision:'',name:'Test',layout:{...defaultDashboardLayout(),reviewSections:sections}}).success,false);
 assert.equal(actionSchema.safeParse({type:'dashboard.save',baseRevision:'',name:'Legacy',layout:defaultDashboardLayout()}).success,true);
 assert.equal(reviewSections.length,9);
});
test('saved output trace is patient-isolated and does not claim missing full provenance',()=>{
 const w=normalizeWorkspace(seedWorkspace());
 const markup=renderToStaticMarkup(React.createElement(OutputTraceView,{p:w.patients[0],ctx:{data:w}}));
 assert.ok(markup.includes('No saved outputs yet'));assert.ok(!markup.includes(w.patients[1].name));
});
test('decision history and the decision trace show the recorded action and option, and older decisions keep their approach title',()=>{
 const id='TN-DEMO-01',patient=w=>w.patients.find(p=>p.id===id),act=(w,action)=>applyAction(w,actionSchema.parse(action),'Dr. Test Clinician','2026-09-09T12:00:00Z');
 let w=normalizeWorkspace(seedWorkspace());w.engineRuns=[];w.engineDecisions=[];
 const decide=(w,extra)=>act(w,{type:'engine.decide',patientId:id,runId:w.engineRuns.find(r=>r.patientId===id).id,candidateId:'review-current',rationale:'Morning grogginess reviewed with the patient.',patientPlan:'Keep noting morning alertness.',owner:'Care coordinator',followup:'2026-09-16',...extra});
 const run=w=>act(w,{type:'engine.run',patientId:id,expectedRevision:engineRecordRevision(patient(w),w),preferences:defaultEnginePreferences});
 w=decide(run(w),{action:'reject',optionId:'gabapentin',optionName:'Gabapentin',labelStatus:'On-label'});
 w=decide(run(w),{});
 const ctx={data:w,user:'Reviewer',busy:false,open:()=>{},save:async()=>false};
 for(const markup of [renderToStaticMarkup(React.createElement(OutputTraceView,{p:patient(w),ctx})),renderToStaticMarkup(React.createElement(EngineBoard,{p:patient(w),ctx,initialTab:'history'}))]){
   const quotes=markup.match(/<blockquote>.*?<\/blockquote>/g);
   assert.equal(quotes.length,2);
   const structured=quotes.find(q=>q.includes('Rejected Gabapentin')),legacy=quotes.find(q=>!q.includes('Rejected'));
   assert.match(structured,/<strong>Rejected Gabapentin<\/strong>/);
   assert.match(structured,/Clinical approach linked to this run: Review the current medication trial · Label status: On-label \(prototype label status, verify\)/);
   assert.match(legacy,/<strong>Review the current medication trial<\/strong>/);assert.doesNotMatch(legacy,/Clinical approach linked/);
 }
});

