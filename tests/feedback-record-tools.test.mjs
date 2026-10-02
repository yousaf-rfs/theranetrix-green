import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:"export * from './lib/theranetrix';export * from './lib/actions';export * from './lib/visit-document';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {seedWorkspace,applyAction,actionSchema,visitDocumentHtml}=mod.exports;
const now='2026-09-19T12:00:00Z';
const act=(workspace,action)=>applyAction(workspace,actionSchema.parse(action),'Clinical reviewer',now);

test('recorded DOB and MRN persist with history, reject invalid identifiers, and do not mutate another patient',()=>{
  const before=seedWorkspace(),id=before.patients[0].id,other=before.patients[1];
  const next=act(before,{type:'patient.identity.update',patientId:id,dateOfBirth:'1974-04-20',medicalRecordNumber:'MRN-42'});
  const patient=next.patients.find(p=>p.id===id);
  assert.equal(patient.age,52);assert.equal(patient.dateOfBirth,'1974-04-20');assert.equal(patient.medicalRecordNumber,'MRN-42');
  assert.equal(patient.identityHistory[0].actor,'Clinical reviewer');assert.deepEqual(patient.identityHistory[0],{dateOfBirth:'1972-02-02',medicalRecordNumber:'DEMO-000101',date:now,actor:'Clinical reviewer'});
  assert.equal(before.patients[0].dateOfBirth,'1972-02-02');assert.equal(before.patients[0].medicalRecordNumber,'DEMO-000101');
  assert.deepEqual(next.patients.find(p=>p.id===other.id),other);
  assert.throws(()=>act(next,{type:'patient.identity.update',patientId:other.id,dateOfBirth:'1960-02-20',medicalRecordNumber:'mrn-42'}),/already assigned/);
  assert.throws(()=>act(next,{type:'patient.identity.update',patientId:id,dateOfBirth:'2027-01-01',medicalRecordNumber:''}),/future/);
  assert.throws(()=>actionSchema.parse({type:'patient.identity.update',patientId:id,dateOfBirth:'1974-02-30',medicalRecordNumber:''}),/Invalid date/);
});

test('review feedback retains classification, route, author, and exact text without changing patient records',()=>{
  const before=seedWorkspace();const text='Keep the four priorities. Make rationale easier to compare.';
  const next=act(before,{type:'prototype.feedback.add',path:'/patients/TN-DEMO-01?tab=treatment',screen:'Treatment',priority:'Must-have',intent:'Change',text});
  assert.deepEqual(next.patients,before.patients);assert.equal(next.prototypeFeedback[0].text,text);assert.equal(next.prototypeFeedback[0].priority,'Must-have');assert.equal(next.prototypeFeedback[0].author,'Clinical reviewer');assert.equal(next.prototypeFeedback[0].date,now);
  assert.throws(()=>actionSchema.parse({type:'prototype.feedback.add',path:'https://example.com',screen:'Treatment',priority:'Urgent',intent:'Change',text}));
});

test('visit document uses the selected record, escapes record text, and excludes conversations and other patients',()=>{
  const workspace=seedWorkspace(),p=workspace.patients[0];p.goal='<script>alert("test")</script>';p.dateOfBirth='1974-04-20';p.medicalRecordNumber='MRN-42';
  workspace.messages.push({id:'private',patientId:p.id,text:'Private conversation marker',date:now,sender:p.name,direction:'in'});
  const html=visitDocumentHtml(p,workspace,now);
  assert.ok(html.includes('MRN-42'));assert.ok(html.includes('1974-04-20'));assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('Private conversation marker'));assert.ok(!html.includes(workspace.patients[1].name));
  assert.ok(html.includes('not a signed encounter record'));assert.ok(html.includes('No agreed care plan recorded.'));
  assert.throws(()=>visitDocumentHtml({...p,id:'missing'},workspace,now),/not found/);
});
