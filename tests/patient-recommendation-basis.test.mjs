import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:"export * from './lib/patient-recommendation-basis';export {patientSuggestions} from './lib/medications';export {seedWorkspace} from './lib/theranetrix';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {patientRecommendationBasis,patientCautionBasis,patientSuggestions,seedWorkspace}=mod.exports;
test('side-effect explanation cites only active medications matching the rule with their report dates',()=>{
 const w=seedWorkspace(),p=w.patients[0],base=p.medications[0];
 p.medications=[{...base,id:'one',name:'Matching drug',status:'Active',tolerability:'Effects reported',effects:'Reported fatigue',reportedAt:'2026-09-01'},{...base,id:'two',name:'Unrelated drug',status:'Active',tolerability:'No effects reported',effects:''},{...base,id:'three',name:'Stopped drug',status:'Stopped',tolerability:'Effects reported',effects:'Earlier effects'}];
 const suggestion=patientSuggestions(p,w).find(s=>s.title==='Review reported side effects');
 const basis=patientRecommendationBasis(p,w,suggestion);
 assert.equal(basis.sources.length,1);assert.match(basis.sources[0].label,/Matching drug/);assert.equal(basis.sources[0].date,'2026-09-01');assert.match(basis.sources[0].value,/Reported fatigue/);assert.match(basis.limitations.join(' '),/not a prescribing recommendation/);
});
test('missing medication records explain reconciliation without inventing an observation date',()=>{
 const w=seedWorkspace(),p=w.patients[0];p.medications=[];delete p.medicationReconciliation;
 const suggestion=patientSuggestions(p,w).find(s=>s.title==='Reconcile the medication list');const basis=patientRecommendationBasis(p,w,suggestion);
 assert.equal(basis.sources.length,1);assert.equal(basis.sources[0].date,undefined);assert.match(basis.sources[0].value,/No active entries/);
});
test('disabled optional prompts do not leak medication assessments into general plan rationale',()=>{
 const w=seedWorkspace(),p=w.patients[0];w.features.reviewPrompts=false;
 const basis=patientRecommendationBasis(p,w,patientSuggestions(p,w)[0]);assert.deepEqual(basis.sources.map(s=>s.label),['Patient goal','Latest care plan']);
});
test('a saved review rationale remains attributed to its patient and recorded priority',()=>{
 const w=seedWorkspace(),p=w.patients[0];w.reviews.push({id:'specific',patientId:p.id,title:'Review dizziness',detail:'Patient reported dizziness today.',source:'Patient message',priority:'High',status:'Open',created:'2026-09-19'});
 const basis=patientRecommendationBasis(p,w,{title:'Review dizziness',reason:'Patient reported dizziness today.',kind:'review',attention:true});assert.equal(basis.sources[0].date,'2026-09-19');assert.match(basis.sources[0].label,/High priority/);assert.match(basis.sources[0].href,new RegExp(p.id));
});
test('prototype caution basis flags historical text scanning and absent clinical evidence',()=>{
 const w=seedWorkspace(),p=w.patients[0];const basis=patientCautionBasis(p,'Profile caution');assert.match(basis.rationale.join(' '),/text/);assert.match(basis.limitations.join(' '),/historical medications/);assert.match(basis.limitations.join(' '),/No published guideline/);
 const fallback=patientCautionBasis(p,'Record completeness');assert.match(fallback.rationale[0],/fallback/);
});
test('partial latest reports and true zero replace stale symptom comparisons and source citations',()=>{
 const w=seedWorkspace(),p=w.patients[0];w.features.assessments=true;p.dates=['2026-09-01','2026-09-02'];p.pain=[3,8];p.function=[7,4];p.sleep=[5,5];p.checkins=[];
 const entry=(id,metric,status,value,extra={})=>({id,workflowRecordId:'current',workflowVersion:1,metric,status,value,recordedAt:'2026-09-19T09:00:00Z',source:'Patient report',...extra});
 p.workflowObservations=[entry('pain','pain','zero',0),entry('function','function','unanswered',undefined),entry('sleep','sleep','declined',undefined)];
 assert.ok(!patientSuggestions(p,w).some(s=>s.title==='Review the latest symptom change'),'No stale raw-array warning after a new partial report.');
 p.workflowObservations.push(entry('corrected','pain','answered',9,{correctedFromEntryId:'pain',workflowVersion:2}));
 const suggestion=patientSuggestions(p,w).find(s=>s.title==='Review the latest symptom change');assert.ok(suggestion);
 const basis=patientRecommendationBasis(p,w,suggestion);assert.equal(basis.sources.find(s=>s.label==='Pain · latest report').value,'9/10');assert.equal(basis.sources.find(s=>s.label==='Function · latest report').value,'unanswered');assert.equal(basis.sources.find(s=>s.label==='Pain · latest report').date,'2026-09-19T09:00:00Z');
 w.features.assessments=false;assert.ok(!patientSuggestions(p,w).some(s=>s.title==='Review the latest symptom change'));
});
