import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const bundle=await build({stdin:{contents:"export {ClinicianBoard} from './components/theranetrix/clinician-overview'; export {defaultDashboardLayout,reorderDashboardItems} from './lib/dashboard-layout'; export {seedWorkspace} from './lib/theranetrix'; export {normalizeWorkspace} from './lib/medications'; export {applyAction,actionSchema} from './lib/actions'; export {engineRecordRevision} from './lib/engine-demo';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {ClinicianBoard,defaultDashboardLayout,seedWorkspace,normalizeWorkspace,applyAction,actionSchema,engineRecordRevision,reorderDashboardItems}=mod.exports;
const render=(data,layout)=>renderToStaticMarkup(React.createElement(ClinicianBoard,{ctx:{data,busy:false,open:()=>{}},layout}));
test('named dashboard profiles persist without changing patients or clinical model inputs',()=>{
 const w=normalizeWorkspace(seedWorkspace()),before=engineRecordRevision(w.patients[0],w),layout=defaultDashboardLayout();
 const saved=applyAction(w,actionSchema.parse({type:'dashboard.save',baseRevision:'',name:'Dr. Morgan',layout}),'Owner','2026-09-11T12:00:00Z');
 const reloaded=normalizeWorkspace(JSON.parse(JSON.stringify(saved)));
 assert.equal(reloaded.dashboardProfiles[0].name,'Dr. Morgan');assert.deepEqual(reloaded.dashboardProfiles[0].layout,layout);
 assert.deepEqual(saved.patients,w.patients);assert.equal(JSON.stringify(reloaded.patients),JSON.stringify(w.patients));assert.equal(engineRecordRevision(reloaded.patients[0],reloaded),before);assert.equal(w.dashboardProfiles,undefined);
 const second=applyAction(reloaded,actionSchema.parse({type:'dashboard.save',baseRevision:'',name:'Dr. Taylor',layout:{...layout,showEngines:true}}),'Owner');
 assert.equal(second.dashboardProfiles.length,2);assert.equal(second.dashboardProfiles[0].layout.showEngines,false);
});
test('column ordering and section visibility change the dashboard while priority remains visible',()=>{
 const w=normalizeWorkspace(seedWorkspace()),layout={...defaultDashboardLayout(),columns:['plan','outcomes'],showEngines:false,showSummary:false,showDemoLinks:false,showEngineIntro:false,density:'compact'};
 const html=render(w,layout),head=html.match(/<div class="triage-column-head"[^>]*>([\s\S]*?)<\/div>/)?.[1];
 assert.ok(head,'The configured patient grid has column headings.');
 assert.deepEqual([...head.matchAll(/<span>(.*?)<\/span>/g)].map(match=>match[1]),['Patient / preparation','Review focus','Latest report','Review']);
 const rows=[...html.matchAll(/<article class="triage-patient[^"]*">([\s\S]*?)<\/article>/g)].map(match=>match[1]);
 assert.equal(rows.length,w.patients.length);
 for(const row of rows){
   assert.ok(row.indexOf('triage-patient-identity')<row.indexOf('triage-preview-plan'),'Patient identity stays first.');
   assert.ok(row.indexOf('triage-preview-plan')<row.indexOf('triage-preview-outcomes'),'Patient cells follow the chosen order.');
   assert.ok(row.includes('triage-priority'),'Priority remains visible.');
   assert.ok(row.includes('aria-expanded="false"'),'Secondary clinical details start collapsed.');
 }
 assert.ok(!html.includes('triage-preview-medications'));assert.ok(!html.includes('Current engine answers'));
 assert.ok(!html.includes('aria-label="Filter patients by review need"'));assert.ok(html.includes('dashboard-density-compact'));
 const engines=render(w,{...layout,showEngines:true});
 assert.equal((engines.match(/aria-label="Current engine answers for /g)||[]).length,w.patients.length,'An enabled engine overview retains every patient summary.');
 assert.ok(engines.includes('Clinical engine insights'));
});
test('saved clinician filter and name ordering apply on opening the dashboard',()=>{
 const w=normalizeWorkspace(seedWorkspace()),clinician=w.patients[0].clinician;
 const html=render(w,{...defaultDashboardLayout(),clinician,sort:'name',showDemoLinks:false,showEngines:false});
 const included=w.patients.filter(p=>p.clinician===clinician).sort((a,b)=>a.name.localeCompare(b.name));
 for(let i=1;i<included.length;i++)assert.ok(html.indexOf('/patients/'+included[i-1].id)<html.indexOf('/patients/'+included[i].id));
 for(const p of w.patients.filter(p=>p.clinician!==clinician))assert.ok(!html.includes('/patients/'+p.id));
});
test('server rejects stale updates, duplicate names and invalid layouts',()=>{
 const base={type:'dashboard.save',baseRevision:'',name:'My dashboard',layout:defaultDashboardLayout()};
 let w=applyAction(normalizeWorkspace(seedWorkspace()),actionSchema.parse(base),'Doctor');const p=w.dashboardProfiles[0];
 assert.throws(()=>applyAction(w,actionSchema.parse({...base,id:p.id}),'Doctor'),/dashboard changed/);
 assert.throws(()=>applyAction(w,actionSchema.parse(base),'Doctor'),/different name/);
 assert.throws(()=>applyAction(w,actionSchema.parse({...base,id:'missing'}),'Doctor'),/not found/);
 for(const columns of [[],['outcomes','outcomes'],['invented']])assert.equal(actionSchema.safeParse({...base,layout:{...base.layout,columns}}).success,false);
 w=applyAction(w,actionSchema.parse({...base,id:p.id,baseRevision:p.revision,name:'Updated dashboard'}),'Doctor');assert.equal(w.dashboardProfiles.length,1);assert.equal(w.dashboardProfiles[0].name,'Updated dashboard');
});

test('reordering preserves all visible items and safely ignores cross-list drops',()=>{
 const columns=['medications','outcomes','plan'];
 assert.deepEqual(reorderDashboardItems(columns,'medications','plan'),['outcomes','plan','medications']);
 assert.deepEqual(reorderDashboardItems(columns,'plan','medications'),['plan','medications','outcomes']);
 assert.deepEqual(reorderDashboardItems(columns,'pst','plan'),columns);
 assert.deepEqual(reorderDashboardItems(columns,'plan','shadow'),columns);
 assert.deepEqual(columns,['medications','outcomes','plan']);
});
test('the worklist offers direct medication and plan actions without expanding patient detail',()=>{
 const w=normalizeWorkspace(seedWorkspace()),html=render(w,defaultDashboardLayout());
 for(const p of w.patients){
  assert.ok(html.includes('aria-label="Review medications for '+p.name+'"'));
  assert.ok(html.includes('plan for '+p.name+'"'));
 }
 assert.ok(html.includes('Pre-visit preparation'));
 assert.ok(!html.includes('Second visit'));
 const p=w.patients[0];p.dates=[];p.pain=[];p.function=[];p.sleep=[];p.checkins=[];
 const empty=render(w,{...defaultDashboardLayout(),filter:'All patients'});
 assert.ok(empty.includes('Awaiting patient report'));
});
test('every worklist row exposes its review reason even when the plan column is hidden',()=>{
 const w=normalizeWorkspace(seedWorkspace());
 for(const columns of [['medications','outcomes','plan'],['outcomes']]){
   const html=render(w,{...defaultDashboardLayout(),columns,showEngines:false,showDemoLinks:false});
   const rows=[...html.matchAll(/<article class="triage-patient[^"]*">([\s\S]*?)<\/article>/g)].map(match=>match[1]);
   assert.equal(rows.length,w.patients.length);
   for(const row of rows)assert.match(row,/aria-label="Why this review:/,'Reason is available before expanding or opening the patient.');
 }
});
