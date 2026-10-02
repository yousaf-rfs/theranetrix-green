import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({stdin:{contents:"export * from './lib/theranetrix';export * from './lib/actions';export * from './lib/configuration';export * from './lib/medications';export * from './lib/demo-insights';export * from './lib/treatment-review';export * from './lib/patient-overview';export * from './lib/patient-export';export {EncounterReview} from './components/theranetrix/encounter-review';export {TreatmentForm} from './components/theranetrix/treatment-course';export {ReviewHistory,TaskHistory} from './components/theranetrix/record-history';export {formatDate} from './components/theranetrix/ui';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {seedWorkspace,applyAction,actionSchema,defaultPlanning,planningSummary,normalizeWorkspace,patientExport,demoInsights,treatmentCourse,patientActivity,EncounterReview,TreatmentForm,ReviewHistory,TaskHistory,formatDate}=mod.exports;
const act=(w,a,now='2026-09-08T18:00:00Z')=>applyAction(w,actionSchema.parse(a),'Verified clinician',now);
const patient=(w,id='TN-DEMO-02')=>w.patients.find(p=>p.id===id);
const render=(component,w,props={})=>renderToStaticMarkup(React.createElement(component,{ctx:{data:w,user:'Verified clinician',busy:false,save:async()=>true,open:()=>{}},p:patient(w),changeTab:()=>{},close:()=>{},...props}));
const medAction=(p,changes={})=>{const m=p.medications[0];return {type:'medication.save',patientId:p.id,id:m.id,name:m.name,regimen:m.regimen,indication:m.indication,status:m.status,started:m.started,reportedAt:m.reportedAt,benefit:m.benefit,tolerability:m.tolerability,adherence:m.adherence,effects:m.effects,...changes};};
const treatmentAction=p=>({type:'treatment.review',patientId:p.id,direction:'Monitoring benefit',goalStatus:'Not assessed',goalEvidence:'',decision:'Reviewed the updated record with the patient.',monitoring:'Follow up with the care team.',options:[]});

test('every AI toggle combination preserves assessment metrics until assessments themselves are disabled',()=>{
 for(const pst of [true,false])for(const shadow of [true,false]){
   const w=seedWorkspace();w.features.pst=pst;w.features.shadow=shadow;
   const p=patient(w),d=demoInsights(p,w),html=render(EncounterReview,w);
   assert.equal(d.metrics.length,3);assert.equal(d.metrics.find(m=>m.key==='pain').last,3);
   assert.ok(html.includes('<strong>3</strong>'));assert.ok(html.includes('<strong>8</strong>'));assert.ok(html.includes('<strong>7</strong>'));
   assert.equal(d.pst.length>0,pst);assert.equal(d.shadow.length>0,shadow);
   w.features.assessments=false;const off=demoInsights(p,w);assert.deepEqual(off.metrics,[]);assert.deepEqual(off.pst,[]);assert.deepEqual(off.shadow,[]);
 }
});
test('clinical changes flag original patients without a treatment review, independent of optional prompts',()=>{
 for(const mode of ['medication','checkin']){
   let w=seedWorkspace();w.features.reviewPrompts=false;w.features.pst=false;w.features.shadow=false;const p=patient(w,'TN-1038');assert.equal(p.status,'On track');
   w=act(w,mode==='medication'?medAction(p,{benefit:'No benefit',tolerability:'Effects reported',effects:'New reported grogginess',adherence:'Not taking'}):{type:'checkin.add',patientId:p.id,pain:10,function:0,sleep:0,note:'New report'});
   assert.equal(patient(w,p.id).status,'Needs review');assert.ok(patient(w,p.id).recordReviewRequiredSince);
   w=act(w,{type:'review.add',patientId:p.id,title:'Another review',detail:'Separate concern',priority:'Routine'});const id=w.reviews[0].id;
   w=act(w,{type:'review.update',id,status:'Resolved',resolution:'This separate concern was reviewed.'});assert.equal(patient(w,p.id).status,'Needs review');
 }
});
test('a fresh clinician treatment assessment clears the pending data-review flag',()=>{
 let w=act(seedWorkspace(),{type:'goal.update',patientId:'TN-1038',goal:'Review a new functional goal'});const p=patient(w,'TN-1038');
 w=act(w,treatmentAction(p));assert.equal(patient(w,p.id).recordReviewRequiredSince,undefined);assert.equal(patient(w,p.id).status,'On track');
});
test('every review transition retains rationale, status, actor and date, including legacy text',()=>{
 let w=seedWorkspace();w.reviews[0].status='Acknowledged';w.reviews[0].resolution='Legacy rationale with unknown author';
 w=act(w,{type:'review.update',id:'rev-1',status:'Acknowledged',resolution:'First attributed clinical rationale'});
 w=act(w,{type:'review.update',id:'rev-1',status:'Resolved',resolution:'Resolution after reviewing response'},'2026-09-08T18:01:00Z');
 w=act(w,{type:'review.update',id:'rev-1',status:'Resolved',resolution:'Amended resolution'},'2026-09-08T18:02:00Z');
 const r=w.reviews.find(r=>r.id==='rev-1');assert.equal(r.history.length,4);assert.equal(r.resolution,'Amended resolution');
 assert.equal(r.history[1].status,'Resolved');assert.equal(r.history[2].actor,'Verified clinician');assert.equal(r.history[3].date,'');
 const html=render(ReviewHistory,w,{review:r});for(const text of ['First attributed clinical rationale','Resolution after reviewing response','Legacy rationale with unknown author','Earlier date not recorded'])assert.ok(html.includes(text));
});
test('medication history preserves previous start and indication without filling older unknown history',()=>{
 let w=seedWorkspace(),p=patient(w),m=p.medications[0];const oldStart=m.started,oldIndication=m.indication;
 // Mimic a saved v8 record whose current snapshot lacks these fields.
 delete m.history[0].started;delete m.history[0].indication;delete m.history[1].started;delete m.history[1].indication;
 w=act(w,medAction(p,{started:'2026-07-30',indication:'Updated recorded indication'}));m=patient(w).medications[0];
 assert.equal(m.history[0].started,'2026-07-30');assert.equal(m.history[1].started,oldStart);assert.equal(m.history[1].indication,oldIndication);
 assert.equal(m.history[2].started,undefined);assert.equal(m.history[2].indication,undefined);
});
test('source observation recovery preserves new entries and does not invent dates, notes or duplicate zero scores',()=>{
 let w=seedWorkspace();for(const p of w.patients){assert.equal(p.checkins.length,p.dates.length);assert.deepEqual(p.checkins.map(c=>c.pain).reverse(),p.pain);}
 const p=patient(w,'TN-1038');p.checkins=[];w=act(w,{type:'checkin.add',patientId:p.id,pain:0,function:0,sleep:0,note:'Preserve my note'});
 const updated=patient(w,p.id);assert.equal(updated.checkins.length,8);assert.equal(updated.checkins[0].note,'Preserve my note');
 const before=structuredClone(w);normalizeWorkspace(w);assert.deepEqual(w,before);
 const recovered=updated.checkins.filter(c=>c.source==='Stored trajectory');assert.equal(recovered.length,7);assert.ok(recovered.every(c=>c.date.length===10&&!c.note));
 const activity=patientActivity(updated,w).find(a=>a.title==='Stored outcome observation');assert.ok(activity.source.includes('time not recorded'));assert.ok(!/AM|PM/.test(formatDate(activity.date,true)));
});
test('new follow-up retains earlier completion and plan linkage while keeping one current task',()=>{
 let w=seedWorkspace(),p=patient(w);const original=structuredClone(p.carePlans[0]),id='medication-followup-'+p.id;
 w=act(w,{type:'task.toggle',id,done:true});w=act(w,{type:'plan.save',patientId:p.id,text:'Next agreed plan',owner:'Next reviewer',followup:'2026-10-01',time:'10:15'});
 const task=w.tasks.find(t=>t.id===id);assert.equal(task.done,false);assert.equal(task.date,'2026-10-01');assert.equal(task.planId,patient(w).carePlans[0].id);
 const completed=task.history.find(h=>h.done);assert.equal(completed.planId,original.id);assert.equal(completed.date,original.followup);assert.equal(completed.time,original.time);assert.equal(completed.owner,original.owner);
 assert.equal(w.tasks.filter(t=>t.id===id).length,1);assert.ok(render(TaskHistory,w,{task}).includes('Completed'));
});
test('unrelated scheduled activities do not acquire a treatment-plan link',()=>{
 let w=act(seedWorkspace(),{type:'task.add',patientId:'TN-DEMO-02',title:'Separate administrative activity',date:'2026-09-10',time:'11:00',taskType:'Care coordination'});const id=w.tasks.at(-1).id;
 w=act(w,{type:'task.toggle',id,done:true});assert.equal(w.tasks.find(t=>t.id===id).history[0].planId,undefined);
});
test('new goal does not prefill previous goal evidence and stale goal-specific saves fail',()=>{
 let w=seedWorkspace(),p=patient(w),oldGoal=p.goal,oldEvidence=p.treatmentReview.goalEvidence;
 w=act(w,{type:'goal.update',patientId:p.id,goal:'A different patient priority'});p=patient(w);
 const html=render(TreatmentForm,w);assert.ok(!html.includes(oldEvidence));assert.ok(html.includes('A different patient priority'));
 assert.throws(()=>act(w,{...treatmentAction(p),expectedGoal:oldGoal}),/goal changed/);assert.equal(p.treatmentReview.goalAtReview,oldGoal);
});
test('configuration revisions reject stale drafts and export the always-on review checks',()=>{
 let w=seedWorkspace();w.features=Object.fromEntries(Object.keys(w.features).map(k=>[k,false]));const p=defaultPlanning();p.users='Healthcare professionals';p.decisionRole='Organize and display records';p.timeCritical='No';
 const summary=planningSummary(w.features,p);assert.equal(summary.clinical,true);assert.equal(summary.items.find(i=>i.id==='cds').status,'Review needed');assert.ok(summary.questions.some(q=>q.includes('always-on')));
 w=act(w,{type:'configuration.save',features:w.features,planning:{...p,owner:' Reviewer '},baseConfigurationId:''});assert.equal(w.planning.owner,'Reviewer');assert.equal(w.configurationHistory[0].coreFunctions[0].mode,'Always on');
 assert.throws(()=>act(w,{type:'configuration.save',features:w.features,planning:p,baseConfigurationId:''}),/configuration changed/);
 const current=w.configurationHistory[0].id;w=act(w,{type:'configuration.save',features:w.features,planning:p,baseConfigurationId:current});assert.equal(w.configurationHistory.length,2);
});
test('simulation provenance changes when medication reconciliation changes its findings',()=>{
 let w=act(seedWorkspace(),{type:'patient.add',name:'Synthetic blank patient',dateOfBirth:'1978-03-21',condition:'Under review',clinician:'Clinician',goal:'Set a goal'});const p=w.patients[0],before=demoInsights(p,w);
 w=act(w,{type:'medication.none',patientId:p.id});const after=demoInsights(w.patients[0],w);assert.notEqual(after.revision,before.revision);assert.ok(after.pst.some(f=>f.detail.includes('no current medications reported')));
});


test('patient export retains linked histories and isolates the selected patient even when workflows are off',()=>{
 let w=act(seedWorkspace(),{type:'review.update',id:'demo-01-concern',status:'Acknowledged',resolution:'Patient-specific review note'});const p=patient(w,'TN-DEMO-01');
 w=act(w,{type:'task.toggle',id:'medication-followup-'+p.id,done:true});w.features.messages=false;w.features.assessments=false;
 const data=patientExport(patient(w,p.id),w,'2026-09-08T18:05:00Z');assert.equal(data.reviews[0].history[0].resolution,'Patient-specific review note');assert.ok(data.tasks[0].history.length);assert.ok(data.messages.length);assert.ok(data.audit.length);
 for(const key of ['reviews','tasks','messages','audit'])assert.ok(data[key].every(r=>r.patientId===p.id));assert.ok(!JSON.stringify(data).includes('Lucas Hayes'));
 assert.equal(data.configurationAtExport.effective.shadow,false);data.patient.goal='Mutated export';assert.notEqual(patient(w,p.id).goal,'Mutated export');
});
