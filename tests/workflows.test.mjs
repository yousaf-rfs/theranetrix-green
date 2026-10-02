import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:"export * from './lib/theranetrix'; export * from './lib/actions'; export * from './lib/clinical-flows';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {seedWorkspace,applyAction,actionSchema,featureEnabled,normalizeClinicalWorkflows,clinicalWorkflowDomains}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const actor='tester@example.test',when='2026-09-08T14:00:00Z';
const act=(w,a)=>applyAction(w,actionSchema.parse(a),actor,when);
const preparation=(overrides={})=>({type:'encounters.preparation.save',requestId:'workflow-preparation-1',patientId:'TN-1042',encounterId:'workflow-encounter-1',reasonForVisit:'Discuss function and the existing walking goal.',changesSinceLastReviewedEncounter:'Patient requested a review.',sourceDates:['2026-09-08'],preparationOwner:'Assigned clinician',openQuestions:[],missingInputs:[],patientGoal:'Walk with family.',status:'draft',...overrides});
const workflow=(command,expectedSliceVersion=0,domain='encounters')=>({type:'workflow.apply',domain,patientId:command.patientId,requestId:command.requestId,expectedSliceVersion,command});

test('seeded patient statuses and next visits match review and schedule records',()=>{
 const w=seedWorkspace();for(const p of w.patients){if(w.reviews.some(r=>r.patientId===p.id&&r.status!=='Resolved'))assert.equal(p.status,'Needs review');if(p.nextVisit)assert.ok(w.tasks.some(t=>t.patientId===p.id&&!t.done&&t.type!=='Care coordination'&&t.date===p.nextVisit));}
});
test('patient check-in updates all series, keeps baseline, and preserves source state',()=>{
 const w=seedWorkspace(),before=structuredClone(w);const next=act(w,{type:'checkin.add',patientId:w.patients[0].id,pain:4,sleep:7,function:6,note:'New sample check-in'});
 assert.deepEqual(w,before);const p=next.patients[0];assert.equal(p.pain.at(-1),4);assert.equal(p.sleep.at(-1),7);assert.equal(p.function.at(-1),6);assert.equal(p.dates.length,p.pain.length);assert.equal(p.baseline,7);assert.equal(next.audit[0].actor,actor);assert.equal(next.audit[0].patientId,p.id);
});
test('capability dependencies disable model views and reject disabled mutations',()=>{
 let w=act(seedWorkspace(),{type:'feature.toggle',feature:'assessments',enabled:false});assert.equal(featureEnabled(w,'digitalTwin'),false);assert.equal(featureEnabled(w,'pst'),false);assert.equal(featureEnabled(w,'shadow'),false);
 assert.throws(()=>act(w,{type:'checkin.add',patientId:w.patients[0].id,pain:4,sleep:5,function:6,note:''}),/turned off/);
 w=act(w,{type:'feature.toggle',feature:'messages',enabled:false});assert.equal(featureEnabled(w,'advisor'),false);assert.throws(()=>act(w,{type:'advisor.request',patientId:w.patients[0].id,text:'Please review'}),/turned off/);
});
test('care-team request links message, queue, patient status, and audit',()=>{
 const w=seedWorkspace(),id=w.patients[1].id;const next=act(w,{type:'advisor.request',patientId:id,text:'I would like a review.'});assert.equal(next.reviews[0].patientId,id);assert.equal(next.reviews[0].source,'Patient concern');const handoff=next.clinicalWorkflows.slices['patient-coordination'].state.handoffs.find(record=>record.id===next.reviews[0].workflowRecordId);assert.equal(handoff?.patientId,id);assert.equal(handoff?.concern,'I would like a review.');assert.equal(next.messages.at(-1).text,'I would like a review.');assert.equal(next.patients[1].status,'Needs review');assert.equal(next.audit[0].patientId,id);
});
test('resolving and reopening reviews recomputes patient status',()=>{
 let w=seedWorkspace();w=act(w,{type:'review.update',id:'rev-1',status:'Resolved',resolution:'Discussed next steps.'});assert.equal(w.patients[0].status,'Monitoring');w=act(w,{type:'review.update',id:'rev-1',status:'Acknowledged',resolution:'Further review needed.'});assert.equal(w.patients[0].status,'Needs review');
});
test('duplicate enrollment cannot destroy completed care activities',()=>{
 const w=seedWorkspace(),p=w.patients[0];assert.throws(()=>act(w,{type:'pathway.enroll',patientId:p.id}),/already enrolled/);const next=act(w,{type:'pathway.step',patientId:p.id,step:'review',complete:true});assert.ok(next.patients[0].completed.includes('review'));assert.equal(next.patients[0].stage,'Care plan');
});
test('schedule derives earliest unfinished visit and audits completion against patient',()=>{
 let w=seedWorkspace(),id=w.patients[0].id;w=act(w,{type:'task.add',patientId:id,title:'Later follow-up',date:'2026-09-10',time:'09:30',taskType:'Video visit'});assert.equal(w.patients[0].nextVisit,'2026-09-08');w=act(w,{type:'task.toggle',id:'task-1',done:true});assert.equal(w.patients[0].nextVisit,'2026-09-10');assert.equal(w.audit[0].patientId,id);
});
test('server validation rejects impossible dates and out-of-range self-reports',()=>{
 for(const date of ['2026-02-30','2026-04-31','2026-02-29'])assert.equal(actionSchema.safeParse({type:'task.add',patientId:'TN-1042',title:'Visit',date,time:'10:00',taskType:'Video visit'}).success,false);
 assert.equal(actionSchema.safeParse({type:'checkin.add',patientId:'TN-1042',pain:11,sleep:5,function:5,note:''}).success,false);
 assert.throws(()=>act(seedWorkspace(),{type:'goal.update',patientId:'unknown',goal:'Test'}),/not found/);
});
test('new patient begins without fabricated observations and gets patient-linked audit',()=>{
 const w=act(seedWorkspace(),{type:'patient.add',name:'Test Patient',dateOfBirth:'1981-04-12',condition:'Sample condition',clinician:'Sample clinician',goal:'Sample goal'});const p=w.patients[0];assert.equal(p.pain.length,0);assert.equal(p.pathway,'');assert.equal(p.nextVisit,'');assert.equal(w.audit[0].patientId,p.id);const next=act(w,{type:'pathway.enroll',patientId:p.id});assert.equal(next.patients[0].stage,'Intake');
});
test('a new patient records the date of birth, derives age from it, and is a duplicate only on name and DOB',()=>{
 const add=(w,overrides={})=>act(w,{type:'patient.add',name:'Test Patient',dateOfBirth:'1981-09-09',condition:'Sample condition',clinician:'Sample clinician',goal:'Sample goal',...overrides});
 let w=add(seedWorkspace());const p=w.patients[0];
 assert.equal(p.dateOfBirth,'1981-09-09');assert.equal(p.age,44,'age is calculated on the action date, before the birthday');
 assert.equal(add(seedWorkspace(),{dateOfBirth:'1981-09-08'}).patients[0].age,45,'the birthday itself counts');
 assert.throws(()=>actionSchema.parse({type:'patient.add',name:'No DOB',condition:'c',clinician:'c',goal:'g'}),'date of birth is required');
 assert.throws(()=>actionSchema.parse({type:'patient.add',name:'Bad DOB',dateOfBirth:'1981-02-30',condition:'c',clinician:'c',goal:'g'}),'an impossible date is rejected');
 assert.throws(()=>add(seedWorkspace(),{dateOfBirth:'2026-09-09'}),/cannot be in the future/);
 assert.throws(()=>add(seedWorkspace(),{dateOfBirth:'2010-01-01'}),/aged 18 to 120/);
 assert.throws(()=>add(seedWorkspace(),{dateOfBirth:'1900-01-01'}),/aged 18 to 120/);
 assert.throws(()=>add(w,{name:' test patient '}),/name and date of birth already exists.*Patient identity review/);
 const twin=add(w,{dateOfBirth:'1981-09-10'});assert.equal(twin.patients.filter(x=>x.name==='Test Patient').length,2,'the same name with another DOB is a different person');
 assert.equal(add(w,{name:'Other Patient'}).patients[0].name,'Other Patient','the same DOB with another name is allowed');
});
test('legacy workspace upgrades empty scaffolds to real domain state without changing patient data',()=>{
 const seeded=seedWorkspace(),legacy=structuredClone(seeded);delete legacy.clinicalWorkflows;
 const normalized=normalizeClinicalWorkflows(legacy.clinicalWorkflows);
 const collections={'results-referrals':'results','treatment-continuity':'reconciliations',encounters:'preparations','patient-coordination':'support',decisions:'observedReviews','integration-access':'acceptedEvents','program-governance':'configurations'};
 assert.equal(normalized.version,1);assert.equal(Object.keys(normalized.slices).length,clinicalWorkflowDomains.length);
 for(const domain of clinicalWorkflowDomains){const slice=normalized.slices[domain];assert.equal(slice.version,0);assert.deepEqual(slice.state[collections[domain]],[]);assert.ok(Object.keys(slice.state).length>0);assert.equal(slice.worker.status,'ready');assert.equal(slice.requestIds.length,0);assert.equal(slice.receipts.length,0);}
 const scaffold={version:1,slices:Object.fromEntries(clinicalWorkflowDomains.map(domain=>[domain,{version:0,state:{},requestIds:[]}]))};
 assert.deepEqual(normalizeClinicalWorkflows(scaffold),normalized);
 assert.deepEqual(legacy.patients,seeded.patients);
 const corrupted=structuredClone(normalized);corrupted.slices.encounters.version=1;corrupted.slices.encounters.state={};
 assert.throws(()=>normalizeClinicalWorkflows(corrupted),/Required/);
});

test('workflow dispatcher saves real commands and rejects invalid domain, scope, versions and forged fields',()=>{
 const w=seedWorkspace(),before=structuredClone(w),command=preparation(),base=workflow(command);
 assert.equal(actionSchema.safeParse({...base,actor:'forged'}).success,false);
 assert.throws(()=>act(w,{...base,command:{...command,actor:'forged'}}),/Unrecognized key/);
 assert.throws(()=>act(w,{...base,command:{...command,extra:true}}),/Unrecognized key/);
 assert.throws(()=>act(w,{...base,domain:'patient-coordination'}),/Invalid discriminator/);
 assert.throws(()=>act(w,{...base,expectedSliceVersion:1}),/changed in another session/);
 assert.throws(()=>act(w,{...base,patientId:'TN-1038'}),/patient context/);
 assert.throws(()=>act(w,{...base,requestId:'different-envelope-request'}),/request identity/);
 const policy={type:'integration-access.policy.draft',requestId:'policy-scope-check',expectedVersion:0,policy:{version:2,sharedOwnerEvaluation:true,patientOrganizations:{},permissions:[]}};
 assert.throws(()=>act(w,{...workflow(policy,0,'integration-access'),patientId:'TN-1042'}),/must not include a patient envelope/);
 const acknowledgement={type:'integration-access.outbox.acknowledge',requestId:'untrusted-receipt',expectedVersion:0,outboxId:'unsent-outbox'};
 assert.throws(()=>act(w,workflow(acknowledgement,0,'integration-access')),/trusted|server|adapter/i);
 const saved=act(w,base),slice=saved.clinicalWorkflows.slices.encounters;
 assert.equal(slice.version,1);assert.equal(slice.state.preparations.length,1);assert.equal(slice.state.preparations[0].reasonForVisit,command.reasonForVisit);assert.equal(slice.updatedBy,actor);
 assert.equal(saved.audit[0].actor,actor);assert.equal(saved.audit[0].patientId,command.patientId);assert.match(saved.audit[0].action,/encounters.preparation.save/);
 assert.deepEqual(w,before);
});

test('shared dispatcher enforces disabled capabilities and dependencies before workflow mutation',()=>{
 let w=act(seedWorkspace(),{type:'feature.toggle',feature:'assessments',enabled:false});
 const observations={type:'encounters.observations.save',requestId:'feature-observation',patientId:'TN-1042',encounterId:'feature-encounter',instrument:'local-0-10',submissionStatus:'confirmed',entries:[{metric:'pain',status:'answered',value:4,source:'Patient self-report',recordedAt:when}]};
 const before=structuredClone(w);
 assert.throws(()=>act(w,workflow(observations)),/turned off/);
 assert.deepEqual(w,before);
 w=act(w,{type:'feature.toggle',feature:'messages',enabled:false});
 assert.equal(featureEnabled(w,'advisor'),false);
 const support={type:'patient-coordination.support.save',requestId:'feature-support',patientId:'TN-DEMO-01',encounterId:'feature-support-encounter',conversationDate:'2026-09-08',planId:'demo-01-plan',planVersion:1,goalText:w.patients.find(patient=>patient.id==='TN-DEMO-01').goal,approvedEducation:[],reminderChannel:'none',optedOut:true,dueCheckInDate:'2026-09-09',originalText:'Request for plan support.',attributedSummary:'Patient requested support.',summaryAuthor:'Assigned clinician',participationMode:'staff-recorded',participant:'patient',recordedSource:'Patient conversation'};
 const disabled=structuredClone(w);
 assert.throws(()=>act(w,workflow(support,0,'patient-coordination')),/turned off/);
 assert.deepEqual(w,disabled);
});

test('workflow request replay is actor-bound and does not repeat mutations or audit events',()=>{
 const envelope=workflow(preparation()),saved=act(seedWorkspace(),envelope),before=structuredClone(saved);
 assert.deepEqual(act(saved,envelope),saved);
 assert.throws(()=>applyAction(saved,actionSchema.parse(envelope),'another-actor@example.test',when),/different workflow command|actor/);
 assert.throws(()=>act(saved,{...envelope,command:{...envelope.command,reasonForVisit:'Changed request content.'}}),/different workflow command/);
 assert.deepEqual(saved,before);
});

test('domain receipts retain actor-bound replay protection after eviction from the 50-entry shared cache',()=>{
 const original=workflow(preparation());let w=act(seedWorkspace(),original);
 for(let index=1;index<=51;index++){
  const slice=w.clinicalWorkflows.slices.encounters;
  w=act(w,workflow(preparation({requestId:`workflow-preparation-${index+1}`,expectedVersion:slice.state.preparations[0].version,reasonForVisit:`Updated review reason ${index}.`}),slice.version));
 }
 const slice=w.clinicalWorkflows.slices.encounters,before=structuredClone(w);
 assert.equal(slice.receipts.length,50);assert.ok(!slice.receipts.some(receipt=>receipt.id===original.requestId));
 const replay={...original,expectedSliceVersion:slice.version};
 assert.deepEqual(act(w,replay),w);
 assert.throws(()=>applyAction(w,actionSchema.parse(replay),'different-replay-actor@example.test',when),/actor|different/);
 assert.deepEqual(w,before);
});
