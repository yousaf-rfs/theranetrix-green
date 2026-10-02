import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const result=await build({stdin:{contents:"export {overviewRecommendationDetails} from './lib/patient-panel';export {seedWorkspace} from './lib/theranetrix';export {normalizeWorkspace} from './lib/medications';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',write:false});
const mod={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {overviewRecommendationDetails,seedWorkspace,normalizeWorkspace}=mod.exports;
test('medication review explanation keeps patient-specific report attribution and verification gaps',()=>{
 const w=normalizeWorkspace(seedWorkspace()),p=w.patients.find(p=>p.medications.some(m=>m.effects)),m=p.medications.find(m=>m.effects),before=JSON.stringify(w);
 const detail=overviewRecommendationDetails(p,w,{title:'Review reported side effects',reason:m.name+': '+m.effects,kind:'medication'});
 assert.ok(detail.sources.some(source=>source.label.includes(m.name)&&source.value.includes(m.effects)&&source.date===m.reportedAt));
 assert.ok(detail.sources.some(source=>source.value.includes('Clinician verification not recorded')));
 assert.ok(detail.limitations.some(text=>text.includes('do not establish')));
 assert.equal(JSON.stringify(w),before,'Opening rationale never mutates the record');
});
test('concern explanations use only matching unresolved patient concerns',()=>{
 const w=normalizeWorkspace(seedWorkspace()),p=w.patients[0];
 w.reviews=[{id:'a',patientId:p.id,title:'Review symptom',detail:'Own recorded concern',priority:'High',status:'Open',source:'Patient report',created:'2026-09-18'}, {id:'b',patientId:'other',title:'Review symptom',detail:'Other patient',priority:'High',status:'Open',source:'Patient report',created:'2026-09-18'}, {id:'c',patientId:p.id,title:'Review symptom',detail:'Resolved item',priority:'High',status:'Resolved',source:'Patient report',created:'2026-09-18'}];
 const detail=overviewRecommendationDetails(p,w,{title:'Review symptom',reason:'Own recorded concern',kind:'review'});
 assert.equal(detail.sources.length,1);assert.equal(detail.sources[0].value,'Own recorded concern');
 assert.ok(detail.rationale.some(text=>text.includes('High')&&text.includes('Open')));
});
test('outcome rationale represents absent values as unanswered, preserving zero',()=>{
 const w=normalizeWorkspace(seedWorkspace()),p=w.patients[0];p.dates=['2026-09-18'];p.pain=[0];p.function=[];p.sleep=[];p.workflowObservations=[];p.checkins=[];
 const detail=overviewRecommendationDetails(p,w,{title:'Review latest report',reason:'Discuss the submitted report.',kind:'review'});
 assert.match(detail.sources[0].value,/Pain: 0; function: not answered; sleep: not answered/);
 assert.equal(detail.sources[0].date,'2026-09-18');
});
