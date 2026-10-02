import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {ADVISOR_SENDER} from './fixtures/product-names.mjs';
const compiled=await build({stdin:{contents:"export * from './lib/theranetrix';export * from './lib/engine-demo';export * from './lib/actions';export * from './lib/medications';export * from './lib/patient-export';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {seedWorkspace,normalizeWorkspace,buildEngineOutput,engineRecordRevision,applyAction,actionSchema,defaultEnginePreferences,patientExport}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const emma='TN-DEMO-01',lucas='TN-DEMO-02',now='2026-09-09T12:00:00Z';
const init=()=>normalizeWorkspace(seedWorkspace());
const patient=(w,id)=>w.patients.find(p=>p.id===id);
const save=(w,action,date=now)=>applyAction(w,actionSchema.parse(action),'Test clinician',date);
const run=(w,id=emma,prefs=defaultEnginePreferences)=>save(w,{type:'engine.run',patientId:id,expectedRevision:engineRecordRevision(patient(w,id),w),preferences:prefs});
const decide=(w,id=emma)=>save(w,{type:'engine.decide',patientId:id,runId:w.engineRuns.find(r=>r.patientId===id).id,candidateId:'review-current',rationale:'Review the burden against the patient goal.',patientPlan:'Bring the symptom notes to the agreed review.',owner:'Care coordinator',followup:'2026-09-16'});

test('two cases produce distinct repeatable rankings without mutating records or inventing observations',()=>{
 const w=init(),before=structuredClone(w),a=buildEngineOutput(patient(w,emma),w),b=buildEngineOutput(patient(w,lucas),w);
 assert.equal(a.agreement,false);assert.equal(b.agreement,true);assert.notEqual(a.pstOrder[0],a.shadowOrder[0]);assert.equal(b.pstOrder[0],'monitor-plan');
 assert.deepEqual(a,buildEngineOutput(patient(w,emma),w));assert.deepEqual(w,before);
 assert.equal(a.points.filter(p=>p.pain!==null).length,patient(w,emma).pain.length);assert.equal(a.points.filter(p=>p.pain===null).length,3);
 assert.match(a.basis.join(' '),/not a confidence interval/);assert.match(a.basis.join(' '),/not drug efficacy/);
 const changed=buildEngineOutput(patient(w,emma),w,{relief:0,alertness:0,routine:100});assert.notEqual(a.pstOrder[0],changed.pstOrder[0]);
});

test('saved runs are isolated and a foreign run cannot be used for a decision',()=>{
 const w=run(init()),r=w.engineRuns[0];assert.equal(r.patientId,emma);assert.equal(r.actor,'Test clinician');assert.equal(r.date,now);
 assert.throws(()=>save(w,{type:'engine.decide',patientId:lucas,runId:r.id,candidateId:'review-current',rationale:'Review',patientPlan:'Follow up',owner:'Clinician',followup:'2026-09-16'}),/not found for this patient/);
 assert.equal(patientExport(patient(w,lucas),w).engineRuns.length,0);
 assert.equal(engineRecordRevision(patient(w,emma),w),r.revision);
});

test('new Robo concern keeps history, invalidates a run, and updates the next calculation',()=>{
 let w=run(init(),lucas);const old=structuredClone(w.engineRuns[0]);
 w=save(w,{type:'advisor.chat',patientId:lucas,text:'Today was much harder; please review my treatment.',intent:'progress',checkin:{pain:10,function:0,sleep:0}},'2026-09-09T12:01:00Z');
 assert.equal(patient(w,lucas).pain.at(-1),10);assert.equal(patient(w,lucas).function.at(-1),0);assert.equal(patient(w,lucas).status,'Needs review');
 assert.equal(w.advisorTurns[0].intent,'concern');assert.ok(w.advisorTurns[0].reviewId);assert.ok(w.advisorTurns[0].checkinId);assert.equal(w.messages.filter(m=>m.patientId===lucas).at(-1).sender,ADVISOR_SENDER);
 assert.deepEqual(w.engineRuns[0],old);assert.notEqual(engineRecordRevision(patient(w,lucas),w),old.revision);
 assert.throws(()=>decide(w,lucas),/New information arrived/);
 w=run(w,lucas);assert.equal(w.engineRuns.length,2);assert.equal(w.engineRuns[0].shadowOrder[0],'review-current');assert.equal(w.engineRuns[0].points.filter(p=>p.pain!==null).at(-1).pain,10);
});

test('decision links exact run to the patient plan and one scheduled follow-up without clearing concerns',()=>{
 let w=run(init());const runId=w.engineRuns[0].id,meds=structuredClone(patient(w,emma).medications),concerns=w.reviews.filter(r=>r.patientId===emma);
 w=decide(w);const p=patient(w,emma),d=w.engineDecisions[0];
 assert.equal(d.runId,runId);assert.equal(d.planId,p.carePlans[0].id);assert.equal(p.carePlans[0].text,d.patientPlan);assert.equal(w.tasks.filter(t=>t.id==='medication-followup-'+emma).length,1);assert.equal(w.tasks.find(t=>t.id==='medication-followup-'+emma).planId,d.planId);
 assert.deepEqual(p.medications,meds);assert.deepEqual(w.reviews.filter(r=>r.patientId===emma),concerns);assert.equal(p.status,'Needs review');
 w=save(w,{type:'advisor.chat',patientId:emma,intent:'plan',text:'What is my plan?'});assert.match(w.advisorTurns.at(-1).reply,/Bring the symptom notes/);assert.match(w.advisorTurns.at(-1).reply,/2026-09-16/);
 assert.equal(patientExport(patient(w,emma),w).engineDecisions.length,1);
});

test('runtime dependencies gate all new engine and advisor actions',()=>{
 let w=init();w.features.shadow=false;let out=buildEngineOutput(patient(w,emma),w);assert.equal(out.agreement,null);assert.deepEqual(out.shadowOrder,[]);assert.ok(out.pstOrder.length);
 w.features.pst=false;out=buildEngineOutput(patient(w,emma),w);assert.deepEqual(out.candidates,[]);
 w.features.digitalTwin=false;assert.throws(()=>run(w),/turned off/);assert.deepEqual(buildEngineOutput(patient(w,emma),w).points,[]);
 w=init();w.features.messages=false;assert.throws(()=>save(w,{type:'advisor.chat',patientId:emma,intent:'concern',text:'Please review'}),/turned off/);
 w=init();w.features.assessments=false;assert.throws(()=>save(w,{type:'advisor.chat',patientId:emma,intent:'progress',text:'Progress',checkin:{pain:2,function:7,sleep:8}}),/turned off/);
 assert.doesNotThrow(()=>save(w,{type:'advisor.chat',patientId:emma,intent:'plan',text:'What is my plan?'}));
});

test('missing data and free text do not acquire synthetic clinical observations',()=>{
 let w=save(init(),{type:'patient.add',name:'New sample',dateOfBirth:'1996-06-30',condition:'Not assessed',clinician:'Test clinician',goal:'Set a goal'}),p=w.patients[0];const out=buildEngineOutput(p,w);
 assert.deepEqual(out.points,[]);assert.deepEqual(out.candidates,[]);const before=structuredClone(p);
 w=save(w,{type:'advisor.chat',patientId:p.id,intent:'question',text:'Should I double my dose?'});p=patient(w,p.id);
 assert.deepEqual(p.pain,before.pain);assert.deepEqual(p.medications,before.medications);assert.ok(w.advisorTurns.at(-1).reviewId);assert.match(w.advisorTurns.at(-1).reply,/human response/);
});

test('stale run requests and invalid preference/date inputs are rejected',()=>{
 let w=init(),revision=engineRecordRevision(patient(w,emma),w);w=save(w,{type:'goal.update',patientId:emma,goal:'A different goal'});
 assert.throws(()=>save(w,{type:'engine.run',patientId:emma,expectedRevision:revision,preferences:defaultEnginePreferences}),/record changed/);
 assert.equal(actionSchema.safeParse({type:'engine.run',patientId:emma,expectedRevision:'x',preferences:{relief:0,alertness:0,routine:0}}).success,false);
 assert.equal(actionSchema.safeParse({type:'advisor.chat',patientId:emma,intent:'progress',text:'Update',checkin:{pain:11,function:0,sleep:0}}).success,false);
});

test('an open Robo concern keeps its effect after a plan question until the review is resolved',()=>{
 let w=save(init(),{type:'advisor.chat',patientId:lucas,intent:'concern',text:'I need help reviewing a new difficulty.'});const reviewId=w.advisorTurns.at(-1).reviewId;
 w=save(w,{type:'advisor.chat',patientId:lucas,intent:'plan',text:'What is my plan?'});
 let out=buildEngineOutput(patient(w,lucas),w);assert.equal(out.shadowOrder[0],'review-current');assert.match(out.summary,/concerns/);
 assert.throws(()=>save(w,{type:'review.update',id:reviewId,status:'Resolved',resolution:'Queue-only closure cannot finish an open handoff.'}),/Complete the handoff/);
 out=buildEngineOutput(patient(w,lucas),w);assert.equal(out.shadowOrder[0],'review-current');assert.match(out.summary,/concerns/);
});
