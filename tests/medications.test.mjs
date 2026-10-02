import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:"export * from './lib/theranetrix'; export * from './lib/actions'; export * from './lib/medications';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {seedWorkspace,applyAction,actionSchema,normalizeWorkspace,patientSuggestions,priorityReviews,followupState}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const when='2026-09-08T14:00:00Z',actor='Reviewer';
const act=(w,a)=>applyAction(w,actionSchema.parse(a),actor,when);
const review=(p,changes={})=>{const m=p.medications[0];return {type:'medication.save',patientId:p.id,id:m.id,name:m.name,regimen:m.regimen,indication:m.indication,started:m.started,status:m.status,benefit:m.benefit,tolerability:m.tolerability,adherence:m.adherence,effects:m.effects,reportedAt:m.reportedAt,...changes};};

test('legacy JSON upgrade is idempotent and preserves saved records and explicit empty lists',()=>{
 const w=seedWorkspace();w.patients[0].goal='User-saved goal';const notes=structuredClone(w.patients[0].notes);delete w.patients[0].medications;delete w.patients[0].carePlans;w.patients[1].medications=[];
 const upgraded=normalizeWorkspace(w);assert.equal(upgraded.patients[0].goal,'User-saved goal');assert.deepEqual(upgraded.patients[0].notes,notes);assert.equal(upgraded.patients[0].medications[0].source,'Patient report');assert.deepEqual(upgraded.patients[1].medications,[]);
 assert.deepEqual(normalizeWorkspace(structuredClone(upgraded)),upgraded);
});
test('medication assessment saves only the correct patient and retains its original report',()=>{
 const w=seedWorkspace(),before=structuredClone(w);const next=act(w,review(w.patients[0],{benefit:'Helpful'}));assert.deepEqual(w,before);assert.deepEqual(next.patients.slice(1),w.patients.slice(1));const m=next.patients[0].medications[0];assert.equal(m.benefit,'Helpful');assert.equal(m.history[0].author,actor);assert.equal(m.history[1].benefit,'Partly helpful');assert.equal(m.history[1].author,'Patient report');assert.equal(next.audit[0].patientId,w.patients[0].id);
 assert.throws(()=>act(w,review(w.patients[0],{patientId:w.patients[1].id})),/not found/);
});
test('drug changes cannot inherit prior benefit and regimen changes require reassessment',()=>{
 const w=seedWorkspace(),p=w.patients[1];assert.throws(()=>act(w,review(p,{name:'Different medication'})),/new medication record/);
 assert.throws(()=>act(w,review(p,{regimen:'Updated recorded regimen'})),/Confirm/);
 const next=act(w,review(p,{regimen:'Updated recorded regimen',responseConfirmed:true}));assert.equal(next.patients[1].medications[0].regimen,'Updated recorded regimen');
 const unknown=act(w,review(p,{regimen:'Updated recorded regimen',benefit:'Not assessed',tolerability:'Not assessed',adherence:'Not assessed'}));assert.equal(unknown.patients[1].medications[0].benefit,'Not assessed');
});
test('missing assessment differs from reported concerns and symptom improvement does not change benefit',()=>{
 const w=seedWorkspace(),p=w.patients[0];p.pain=[7,0];p.function=[3,9];p.sleep=[4,8];p.medications[0].benefit='No benefit';
 const suggestions=patientSuggestions(p,w);assert.ok(suggestions.some(s=>s.title==='Review reported side effects'));assert.ok(suggestions.some(s=>s.title==='Reassess reported benefit'));assert.equal(p.medications[0].benefit,'No benefit');
 p.medications[0].benefit='Not assessed';p.medications[0].tolerability='Not assessed';const unknown=patientSuggestions(p,w);assert.ok(unknown.some(s=>s.title==='Ask about benefit and tolerability'));assert.ok(!unknown.some(s=>s.title==='Reassess reported benefit'));
});
test('confirmed absence of current medication differs from an unreviewed empty list',()=>{
 const w=seedWorkspace(),p=w.patients[5];assert.equal(p.medications.length,0);assert.ok(patientSuggestions(p,w).some(s=>s.title==='Reconcile the medication list'));
 const next=act(w,{type:'medication.none',patientId:p.id});assert.ok(!patientSuggestions(next.patients[5],next).some(s=>s.title==='Reconcile the medication list'));assert.equal(next.patients[5].medicationReconciliation.author,actor);
 assert.throws(()=>act(w,{type:'medication.none',patientId:w.patients[0].id}),/active entries/);
});
test('plan, owner, schedule, completion and audit remain consistent with models disabled',()=>{
 let w=seedWorkspace();w.features.pst=false;w.features.shadow=false;const p=w.patients[0];const action={type:'plan.save',patientId:p.id,text:'Discuss reported grogginess and remaining goals.',owner:'Taylor, RN',followup:'2026-09-09',time:'10:30'};
 w=act(w,action);let task=w.tasks.find(t=>t.id==='medication-followup-'+p.id);assert.equal(task.owner,action.owner);assert.equal(task.time,'10:30');assert.equal(w.patients[0].carePlans[0].author,actor);assert.equal(w.patients[0].notes[0].type,'Care plan');assert.equal(w.audit[0].patientId,p.id);assert.equal(followupState(w.patients[0],w,'2026-09-10').overdue,true);
 w=act(w,{type:'task.toggle',id:task.id,done:true});assert.equal(followupState(w.patients[0],w,'2026-09-10').overdue,false);assert.equal(followupState(w.patients[0],w,'2026-09-10').completed,true);
 w=act(w,{...action,followup:'2026-09-12'});assert.equal(w.tasks.filter(t=>t.id===task.id).length,1);assert.equal(w.patients[0].carePlans.length,2);assert.equal(followupState(w.patients[0],w,'2026-09-10').completed,false);
});
test('invalid clinical record dates and missing tolerability descriptions are rejected',()=>{
 const w=seedWorkspace(),p=w.patients[0];assert.throws(()=>act(w,review(p,{reportedAt:'2026-09-09'})),/future/);assert.throws(()=>act(w,review(p,{started:'2026-09-09'})),/after/);assert.throws(()=>act(w,review(p,{effects:''})),/Describe/);assert.equal(actionSchema.safeParse(review(p,{reportedAt:'2026-02-30'})).success,false);
});
test('a newer routine review cannot conceal an unresolved high-priority review',()=>{
 const w=seedWorkspace(),p=w.patients[0];w.reviews.unshift({id:'routine',patientId:p.id,title:'Routine update',detail:'Routine',priority:'Routine',source:'Test',status:'Open',created:'2026-09-08T15:00:00Z'});assert.equal(priorityReviews(w,p)[0].priority,'High');
});
