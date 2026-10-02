import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({stdin:{contents:"export {EncounterReview} from './components/theranetrix/encounter-review'; export * from './lib/theranetrix'; export * from './lib/actions';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {EncounterReview,seedWorkspace,applyAction,actionSchema}=mod.exports;
const act=(w,a)=>applyAction(w,actionSchema.parse(a),'Clinical reviewer','2026-09-08T14:00:00Z');
const render=(data,p=data.patients[0])=>renderToStaticMarkup(React.createElement(EncounterReview,{p,ctx:{data,user:'Clinical reviewer',busy:false,save:async()=>true,open:()=>{}},changeTab:()=>{}}));

test('visit keeps all unresolved High concerns visible, including acknowledged concerns, without rendering the full record',()=>{
 const w=seedWorkspace(),p=w.patients[0];
 w.reviews=[...Array.from({length:4},(_,i)=>({id:'high-'+i,patientId:p.id,title:'Important concern '+i,detail:'Specific concern detail '+i,priority:'High',source:'Clinician',status:i===0?'Acknowledged':'Open',resolution:i===0?'Previously contacted patient':undefined,created:'2026-09-08T10:00:00Z'})),{id:'resolved',patientId:p.id,title:'Already resolved concern',detail:'Resolved detail',priority:'High',source:'Clinician',status:'Resolved',created:'2026-09-08T09:00:00Z'}];
 p.notes.unshift({id:'long-history',date:'2026-09-07',author:'Clinician',type:'Note',text:'Supporting history should be available on demand'});
 const html=render(w);
 for(let i=0;i<4;i++)assert.ok(html.includes('Specific concern detail '+i));
 for(const text of ['Previously contacted patient','High priority','Acknowledged','Not reviewed','Gabapentin','Partly helpful',p.medications[0].effects,'Regimen not recorded','Not assessed','Update response','Create care plan'])assert.ok(html.includes(text),text);
 const planSection=html.match(/<section[^>]*\bid="visit-plan"[^>]*>([\s\S]*?)<\/section>/)?.[1];
 assert.ok(planSection,'Care plan section remains accessible');
 assert.match(planSection,/<button\b(?![^>]*\sdisabled(?:=|\s|>))[^>]*>Create care plan\s*</,'An enabled creation button opens the plan editor');
 assert.ok(planSection.includes('No agreed plan yet'));
 assert.doesNotMatch(planSection,/Follow-up planned|Follow-up completed|Update plan/,'An empty record must not imply a saved plan');
 assert.ok(!html.includes('Already resolved concern'));
 assert.ok(!html.includes('Supporting history should be available on demand'));
 assert.ok(!html.includes('James Wilson'));
 assert.ok(!html.includes('Patient-specific evidence comparison'));
});

test('saving a check-in and plan updates the visit from the same patient record, preserving zero and recent direction',()=>{
 let w=seedWorkspace();
 w=act(w,{type:'checkin.add',patientId:'TN-1042',pain:0,function:0,sleep:0,note:'A new patient report with zero scores'});
 w=act(w,{type:'plan.save',patientId:'TN-1042',text:'Discuss the recorded change and confirm medication use.',owner:'Taylor, RN',followup:'2026-09-09',time:'10:30'});
 const html=render(w);
 for(const text of ['Better by 6 pts','Worse by','A new patient report with zero scores','Discuss the recorded change and confirm medication use.','Taylor, RN','10:30','Mark follow-up complete'])assert.ok(html.includes(text),text);
 assert.equal((html.match(/<strong>0<\/strong>/g)||[]).length,3);
 assert.ok(html.includes('Overall outcome changes do not establish medication efficacy.'));
 const other=render(w,w.patients[1]);
 assert.ok(!other.includes('A new patient report with zero scores'));
 assert.ok(!other.includes('Taylor, RN'));
});

test('empty and disabled data remain explicit without inventing responses or exposing hidden assessments',()=>{
 let w=act(seedWorkspace(),{type:'patient.add',name:'New Patient',dateOfBirth:'1981-04-12',condition:'Under review',clinician:'Clinician',goal:'Discuss my goals'});
 let html=render(w);
 for(const text of ['Not reviewed','Medication list not confirmed','No active medication entries','Not recorded','No prior comparison','Create care plan'])assert.ok(html.includes(text),text);
 const planSection=html.match(/<section[^>]*\bid="visit-plan"[^>]*>([\s\S]*?)<\/section>/)?.[1];
 assert.ok(planSection,'Care plan section remains accessible');
 assert.match(planSection,/<button\b(?![^>]*\sdisabled(?:=|\s|>))[^>]*>Create care plan\s*</,'An enabled creation button opens the plan editor');
 assert.ok(planSection.includes('No agreed plan yet'));
 assert.doesNotMatch(planSection,/Follow-up planned|Follow-up completed|Update plan/,'An empty record must not imply a saved plan');
 assert.ok(!html.includes('Gabapentin'));assert.ok(!html.includes('None reported'));
 w=seedWorkspace();w=act(w,{type:'checkin.add',patientId:'TN-1042',pain:9,sleep:3,function:2,note:'Distinct assessment note'});
 w=act(w,{type:'feature.toggle',feature:'assessments',enabled:false});html=render(w);
 assert.ok(html.includes('Assessments off'));
 assert.ok(!html.includes('Distinct assessment note'));assert.ok(!html.includes('Better by'));assert.ok(html.includes('Gabapentin'));
});

test('short multiline feedback stays readable and overdue activity is visible before opening details',()=>{
 const w=seedWorkspace(),p=w.patients[0];
 p.checkins=[];w.messages=[{id:'message',patientId:p.id,text:'One\nTwo\nThree\nFour\nFive',date:'2026-09-08T16:00:00Z',sender:p.name,direction:'in'}];
 w.tasks=[{id:'overdue',patientId:p.id,title:'Review needed',date:'2000-01-01',time:'10:00',type:'Care coordination',done:false}];
 const html=render(w);
 assert.ok(html.includes('One\nTwo\nThree\nFour\nFive'));
 assert.ok(!html.includes('class="visit-clamp"'));
 assert.ok(html.includes('1 overdue'));
});
