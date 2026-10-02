import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:"export * from './components/theranetrix/engine-recommendation';export * from './lib/engine-demo';export * from './lib/theranetrix';export {normalizeWorkspace} from './lib/medications';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false,plugins:[{name:'details-props',setup(build){build.onResolve({filter:/^\.\/recommendation-details$/},()=>({path:'details-props',namespace:'test'}));build.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export function RecommendationDetails(){return null;}'}));}}]});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {EngineRecommendation,AdvisorAnswerDetails,buildEngineOutput,defaultEnginePreferences,seedWorkspace,normalizeWorkspace}=mod.exports;

test('strategy explanation preserves exact snapshot scores, sources, alternatives, and clinical limitations',()=>{
 const w=normalizeWorkspace(seedWorkspace()),p=w.patients[0],output=buildEngineOutput(p,w,defaultEnginePreferences),candidate=output.candidates[0];
 const props=EngineRecommendation({output,candidateId:candidate.id}).props;
 assert.equal(props.title,candidate.title);assert.ok(props.rationale.includes(candidate.reason));
 assert.ok(props.rationale.some(text=>text.includes(`PST ${candidate.pstScore}/100`)));
 assert.ok(props.rationale.some(text=>text.includes('pain relief '+output.preferences.relief)));
 assert.equal(props.sources.length,output.sources.length);assert.equal(props.sources[0].date,output.sources[0].date);
 assert.ok(props.sources.every(source=>source.href.startsWith('/patients/'+encodeURIComponent(p.id))));
 assert.equal(props.alternatives.length,output.candidates.length-1);assert.ok(props.limitations.some(text=>text.includes('not independent clinical models')));
 assert.deepEqual(props.considerations,[candidate.watch,...output.gaps]);
});

test('Advisor does not present current data as historical evidence or cross-link another patient snapshot',()=>{
 const w=normalizeWorkspace(seedWorkspace()),p=w.patients[0],other=w.patients[1];
 w.engineRuns=[{...buildEngineOutput(other,w,defaultEnginePreferences),id:'wrong-patient',date:'2026-09-01',actor:'Reviewer'}];
 const turn={id:'t1',patientId:p.id,date:'2026-09-02',patientText:'Why?',reply:'Saved historical answer',summary:'Historical question',intent:'question',runId:'wrong-patient'};
 const props=AdvisorAnswerDetails({turn,p,data:w}).props;
 assert.equal(props.sources[0].date,turn.date);assert.ok(props.rationale.includes('Saved response: '+turn.reply));
 assert.ok(props.limitations.some(text=>text.includes('No complete source snapshot')));
 assert.ok(!JSON.stringify(props).includes(other.goal));assert.ok(props.sources.some(source=>source.value.includes('may differ')));
});

test('Advisor attached snapshot retains original source excerpt rather than current edited record',()=>{
 const w=normalizeWorkspace(seedWorkspace()),p=w.patients[0],run={...buildEngineOutput(p,w,defaultEnginePreferences),id:'original-run',date:'2026-09-01',actor:'Reviewer'};w.engineRuns=[run];
 const originalGoal=p.goal;p.goal='Changed after answer';
 const props=AdvisorAnswerDetails({turn:{id:'t2',patientId:p.id,date:'2026-09-02',patientText:'Why?',reply:'Old answer',summary:'Question',intent:'question',runId:run.id},p,data:w}).props;
 assert.ok(props.sources.some(source=>source.value===originalGoal));assert.ok(!props.sources.some(source=>source.value===p.goal));
 assert.ok(props.limitations.some(text=>text.includes('does not retain a complete snapshot')));
});
