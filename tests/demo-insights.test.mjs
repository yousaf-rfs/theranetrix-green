import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
const out=await build({stdin:{contents:"export * from './lib/theranetrix';export * from './lib/demo-insights';export * from './lib/actions';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {seedWorkspace,demoInsights,applyAction,actionSchema}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
test('simulation is patient-specific, deterministic, and does not modify the source record',()=>{
 const w=seedWorkspace(),before=structuredClone(w),a=demoInsights(w.patients[0],w),b=demoInsights(w.patients[1],w);
 assert.deepEqual(w,before);assert.deepEqual(a,demoInsights(w.patients[0],w));assert.notEqual(a.revision,b.revision);assert.equal(a.summary,w.reviews.find(r=>r.patientId===w.patients[0].id&&r.priority==='High').detail);assert.ok(!JSON.stringify(b).includes('Sarah'));assert.ok(a.shadow.some(f=>f.detail.includes('7 → 6/10')));
});
test('a saved check-in refreshes the simulation and keeps zero outcomes valid',()=>{
 const w=seedWorkspace(),p=w.patients[0],first=demoInsights(p,w);const next=applyAction(w,actionSchema.parse({type:'checkin.add',patientId:p.id,pain:0,function:9,sleep:8,note:''}),'Tester','2026-09-08T17:00:00Z');const insight=demoInsights(next.patients[0],next);
 assert.notEqual(insight.revision,first.revision);assert.equal(insight.metrics.find(m=>m.key==='pain').last,0);assert.ok(insight.shadow.some(f=>f.detail.includes('7 → 0/10')));
});
test('recorded benefit remains distinct from overall improvement and unknown is not favorable',()=>{
 const w=seedWorkspace(),p=w.patients[0];p.pain=[7,2];p.dates=['2026-09-01','2026-09-08'];p.medications[0].benefit='No benefit';let d=demoInsights(p,w);assert.ok(d.shadow.some(f=>f.id==='discordance'));assert.ok(d.pst.some(f=>f.title.includes('No benefit')));
 p.medications[0].benefit='Not assessed';p.medications[0].tolerability='Not assessed';d=demoInsights(p,w);assert.ok(d.pst.some(f=>f.detail.includes('Side effects not assessed')));assert.ok(!d.shadow.some(f=>f.id==='discordance'));
});
test('disabled dependencies remove engine outputs and new records never acquire invented observations',()=>{
 let w=seedWorkspace();w.features.assessments=false;let d=demoInsights(w.patients[0],w);assert.equal(d.enabledShadow,false);assert.deepEqual(d.shadow,[]);assert.deepEqual(d.pst,[]);assert.deepEqual(d.metrics,[]);
 w=applyAction(seedWorkspace(),actionSchema.parse({type:'patient.add',name:'New',dateOfBirth:'1982-01-15',condition:'Unspecified',clinician:'Reviewer',goal:'Record goals'}),'Tester');d=demoInsights(w.patients[0],w);assert.ok(d.shadow.every(f=>!f.id.startsWith('outcome-')));assert.ok(d.pst.some(f=>f.detail.includes('unconfirmed')));
});
