import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
// Rule outputs say what a rule matched, in the words the rest of the app uses for it.
const css={name:'css-for-ssr',setup(builder){builder.onLoad({filter:/\.css$/},()=>({contents:'export default {}',loader:'js'}));}};
const bundle=await build({stdin:{contents:"export {TreatmentScreen} from './components/theranetrix/treatment-screen';export {SynopsisBoard} from './components/theranetrix/review-workspace';export {feedbackRoute} from './components/theranetrix/prototype-feedback';export {defaultDashboardLayout} from './lib/dashboard-layout';export {seedWorkspace} from './lib/theranetrix';export {normalizeWorkspace} from './lib/medications';export {twinOverview,twinDataLabel,buildEngineOutput} from './lib/engine-demo';export {advisorSuggestions} from './lib/advisor-guide';export {guideSections} from './lib/guide-content';export {patientPanelRow} from './lib/patient-panel';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false,plugins:[css]});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {TreatmentScreen,SynopsisBoard,feedbackRoute,defaultDashboardLayout,seedWorkspace,normalizeWorkspace,twinOverview,twinDataLabel,buildEngineOutput,advisorSuggestions,guideSections,patientPanelRow}=mod.exports;
const workspace=()=>normalizeWorkspace(seedWorkspace());
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
/** Emma with only the history, reports and medicines a test gives her. */
function patient(w,{history='',reports=[]}={}){
  const p=structuredClone(w.patients.find(x=>x.id==='TN-DEMO-01'));
  p.clinicalContext={...p.clinicalContext,medicalHistory:history,psychologicalContext:'',physicalContext:'',socialContext:''};p.condition='Postherpetic neuralgia';p.medications=[];p.checkins=[];p.workflowObservations=[];
  p.dates=reports.map(r=>r[0]);p.pain=reports.map(r=>r[1]);p.function=reports.map(r=>r[2]);p.sleep=reports.map(r=>r[3]);
  return p;
}

test('the library-wide exclusion is listed under Rule exclusions on the Treatment screen, in the advisor link and in the guide',()=>{
  const w=workspace(),p=w.patients.find(x=>x.id==='TN-DEMO-01');
  const html=renderToStaticMarkup(React.createElement(TreatmentScreen,{p,ctx:{data:w,user:'Reviewer',busy:false,save:async()=>false,open:()=>{}},canDecide:true,onDecide:()=>{}}));
  assert.match(html,/<details id="treatment-exclusions"[^>]*><summary>Rule exclusions <span>1<\/span><\/summary>/);
  assert.doesNotMatch(text(html),/profile exclusion/i);
  assert.equal(advisorSuggestions(p,w,'treatment').find(s=>s.id==='excluded').target.label,'Rule exclusions');
  const guide=JSON.stringify(guideSections);
  assert.match(guide,/listed under Rule exclusions, with the rule that matched/);assert.match(guide,/comparison with its rule exclusions/);
  assert.doesNotMatch(guide,/profile exclusion/i);
});

test('saved screen feedback keeps the Treatment directory parameter',()=>{
  assert.equal(feedbackRoute('/patients','?open=treatment'),'/patients?open=treatment');
  assert.equal(feedbackRoute('/patients','?open=treatment&q=Emma'),'/patients?open=treatment');
});

test('the Twin profile caution names the match it made: sleep wording, the latest sleep score, or both',()=>{
  const w=workspace(),history='Recurrent depression. Constipation on current regimen.',caution=p=>twinOverview(p).cautions.find(c=>c.title==='Profile caution')?.body;
  assert.equal(caution(patient(w,{history,reports:[['2026-08-01',6,5,6],['2026-09-01',6,5,4]]})),'Rule match: mood and constipation wording in the record, with a latest sleep score of 4/10. Review this history before deciding.');
  assert.equal(caution(patient(w,{history:history+' Insomnia most nights.',reports:[['2026-09-01',6,5,7]]})),'Rule match: mood, sleep and constipation wording in the record. Review this history before deciding.');
  assert.equal(caution(patient(w,{history:history+' Insomnia most nights.',reports:[['2026-09-01',6,5,5]]})),'Rule match: mood, sleep and constipation wording in the record, with a latest sleep score of 5/10. Review this history before deciding.');
  assert.equal(caution(patient(w,{history,reports:[['2026-09-01',6,5,6]]})),undefined,'no sleep wording and a sleep score above 5 is no match');
});

test('the Twin data label states the span between reports and how many there are',()=>{
  const w=workspace();
  const sparse=patient(w,{reports:[['2026-08-01',6,5,6],['2026-09-01',6,5,6]]});
  assert.equal(twinOverview(sparse).model,'Reports span 30+ days (2 reports)','two reports 31 days apart are not 30 days of reports');
  assert.equal(twinOverview(patient(w,{reports:[['2026-09-01',6,5,6],['2026-09-10',6,5,6],['2026-09-20',6,5,6]]})).model,'Reports span under 30 days (3 reports)');
  assert.equal(twinDataLabel(1,1),'1 report');assert.equal(twinDataLabel(0,0),'No reports yet');
  assert.equal(patientPanelRow(sparse,w).twin,'Reports span 30+ days (2 reports)');
  // The Patients directory badge reads the same prefix.
  assert.match(readFileSync('components/theranetrix/app.tsx','utf8'),/<Badge tone=\{row\.twin\.startsWith\('Reports span 30\+'\)\?'teal':'blue'\}>\{row\.twin\}<\/Badge>/);
});

test('the synopsis and engine basis describe Shadow as rule differences, not an independent review',()=>{
  const w=workspace(),p=w.patients[0];
  const html=text(renderToStaticMarkup(React.createElement(SynopsisBoard,{p,ctx:{data:w,busy:false,open:()=>{},save:async()=>true},layout:defaultDashboardLayout(),changeTab:()=>{}})));
  assert.match(html,/Patient context, the PST strategy comparison, and Shadow AI rule differences\./);
  const basis=buildEngineOutput(p,w).basis.join(' ');
  assert.match(basis,/Shadow sorts the same strategy set by the PST utility plus record-rule adjustments: \+25/);
  assert.doesNotMatch(html+basis,/independent review|independently sorts/i);
});
