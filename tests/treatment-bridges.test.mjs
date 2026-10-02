import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {runScenarios} from './fixtures/treatment-continuity-scenarios.mjs';

const bundle=await build({stdin:{contents:"export {initialState,reduce} from './lib/clinical-flows/treatment-continuity'; export * from './lib/clinical-flows/treatment-bridges';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {initialState,reduce,projectTreatmentWork,treatmentBridgeId}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const now='2026-09-24T14:00:00Z',actor='Clinician who recorded the source',patientId='TN-1042';
const context={actor,now,patients:[{id:patientId,name:'Sarah Mitchell'},{id:'TN-1038',name:'James Wilson'}],features:{}};
function workspace(){return {patients:context.patients.map(item=>({...item,notes:[],carePlans:[],nextVisit:'2026-09-30'})),tasks:[],reviews:[],messages:[],audit:[],features:{},clinicalWorkflows:{slices:{'treatment-continuity':{state:initialState()}}}};}
const state=w=>w.clinicalWorkflows.slices['treatment-continuity'].state;
const patient=w=>w.patients.find(item=>item.id===patientId);
const references=w=>Object.values(state(w)).flatMap(records=>records.filter(item=>item.kind).map(item=>({domain:'treatment-continuity',id:item.id,version:item.version,patientId:item.patientId,title:item.kind})));
function apply(w,command,options={}){const next=structuredClone(w);next.clinicalWorkflows.slices['treatment-continuity'].state=reduce(state(w),{patientId,encounterId:'continuity-visit',requestId:crypto.randomUUID(),reason:'Reviewed the current source.',owner:'Care coordinator',dueDate:'2026-09-25',...command},{...context,careActions:references(w),...options});return projectTreatmentWork(next,{actor:'Unrelated bridge caller',now:'2026-09-26T12:00:00Z'});}
const evidence={source:'Patient telephone report',author:'Patient',collectedAt:null,receivedAt:now,reference:'Dated conversation note'};
const reconciliation={type:'treatment-continuity.record-reconciliation',id:'source-review',source:'Outside medication list',sourceDate:'2026-09-23',status:'unreviewed',conflicts:[{field:'Current use',patientFact:'Stopped taking it',externalFact:'Listed as active',outcome:'unreviewed'}],provenance:{patient:evidence,external:{...evidence,source:'Hospital medication list',author:'Discharge pharmacist'},nextAction:'Confirm the current list with the prescriber.'}};

test('all continuity journeys project attributed notes and owned tasks without signing plans or sending messages',async()=>{
  let w=workspace();const journeys=[];
  await runScenarios({patientId,now,state:()=>state(w),apply:async command=>{w=apply(w,command);return state(w);},expectRejected:async command=>{const before=structuredClone(w);assert.throws(()=>apply(w,command));assert.deepEqual(w,before);},record:(id,status)=>journeys.push([id,status])});
  assert.deepEqual(journeys.map(([id])=>id),['J03','J04','J31','J32','J33','J34']);
  const records=Object.values(state(w)).flatMap(rows=>rows.filter(row=>row.kind));
  assert.equal(patient(w).notes.length,records.reduce((sum,row)=>sum+row.version,0));
  assert.ok(patient(w).notes.every(note=>note.author===actor&&note.workflowVersion&&note.text.includes('Source version:')));
  assert.ok(w.tasks.every(task=>task.workflowDomain==='treatment-continuity'&&task.type==='Care coordination'&&task.time===''));
  assert.ok(w.tasks.some(task=>task.title==='Confirm whether agreed care has started'&&!task.done));
  const handover=state(w).transitions[0],pending=w.tasks.find(task=>task.workflowRecordId===handover.id&&task.title.startsWith('Transition follow-up:'));
  assert.equal(handover.handoverStatus,'completed');assert.equal(pending.done,false);assert.equal(pending.owner,'Covering clinician');
  assert.match(patient(w).notes.find(note=>note.workflowRecordId===handover.id).text,/backup: On-call clinician/);
  assert.deepEqual(patient(w).carePlans,[]);assert.deepEqual(w.messages,[]);assert.equal(patient(w).nextVisit,'2026-09-30');
  assert.deepEqual(w.patients[1],workspace().patients[1]);
  assert.deepEqual(projectTreatmentWork(w,{actor:'Other caller',now:'2026-10-01T00:00:00Z'}),w);
});

test('source versions and attribution survive later projection and manual task edits survive unrelated source updates',()=>{
  const initial=workspace(),snapshot=structuredClone(initial);
  let w=apply(initial,reconciliation);assert.deepEqual(initial,snapshot);
  const original=structuredClone(patient(w).notes[0]),task=w.tasks[0];task.done=true;task.owner='Accepted covering coordinator';
  w=apply(w,{...reconciliation,expectedVersion:1,reviewer:'Second reviewer'},{actor:'Second source author',now:'2026-09-25T10:00:00Z'});
  assert.equal(w.tasks[0].done,true);assert.equal(w.tasks[0].owner,'Accepted covering coordinator');assert.equal(w.tasks[0].workflowVersion,2);
  assert.equal(w.tasks[0].history[0].done,true);assert.equal(w.tasks[0].history[0].changedBy,'Second source author');
  assert.deepEqual(patient(w).notes.find(note=>note.id===original.id),original);assert.equal(patient(w).notes[0].supersedes,original.id);
  const newConflict={field:'Dose',patientFact:'Reports a different dose',externalFact:'Old dose remains listed',outcome:'unreviewed'};
  w=apply(w,{...reconciliation,expectedVersion:2,conflicts:[...reconciliation.conflicts,newConflict]},{actor:'Third source author',now:'2026-09-26T10:00:00Z'});
  assert.equal(w.tasks[0].done,false);assert.equal(w.tasks[0].history[0].done,true);assert.equal(patient(w).notes[0].author,'Third source author');
  const rebuilt=structuredClone(w);rebuilt.patients[0].notes=[];rebuilt.tasks=[];
  const projected=projectTreatmentWork(rebuilt,{actor:'Migration caller',now});
  assert.deepEqual(projected.patients[0].notes,patient(w).notes);assert.equal(projected.tasks[0].workflowVersion,3);
});

test('actual start sets an agreed response interval without turning a proposed date into treatment exposure',()=>{
  let w=apply(workspace(),reconciliation);
  const accessReview={careAction:{domain:'treatment-continuity',id:'source-review',version:1},verification:'confirmed',source:'Service coordinator',checkedAt:now,details:'Service confirmed coverage.',alternativeDecision:'none',patientAgreement:'agreed',actualStart:'not-started',actualStartSource:'Patient has not started yet',followUpDaysAfterStart:7};
  const command={type:'treatment-continuity.manage-access',id:'access-start',barrierType:'coverage',status:'resolved',patientChoice:'Agreed to start when available.',outreach:'Coordinator confirmed service availability.',requiresClinicianReview:false,resolution:'Access confirmed; the actual start remains pending.',dueDate:'2026-09-15',accessReview};
  w=apply(w,command);
  assert.equal(w.tasks.find(task=>task.workflowRecordId==='access-start'&&task.title==='Resolve the recorded care access barrier').done,true);
  assert.equal(w.tasks.find(task=>task.workflowRecordId==='access-start'&&task.title==='Confirm whether agreed care has started').done,false);
  assert.equal(w.tasks.some(task=>task.workflowRecordId==='access-start'&&task.title==='Review care after the actual start'),false);
  w=apply(w,{...command,expectedVersion:1,accessReview:{...accessReview,actualStart:'started',actualStartAt:'2026-09-20',actualStartSource:'Patient confirmed first attendance'}});
  const followup=w.tasks.find(task=>task.title==='Review care after the actual start');
  assert.equal(followup.date,'2026-09-27');assert.equal(followup.time,'');assert.equal(followup.done,false);
  const confirmation=w.tasks.find(task=>task.workflowRecordId==='access-start'&&task.title==='Confirm whether agreed care has started');
  assert.equal(confirmation.date,'2026-09-20');assert.equal(confirmation.done,true);assert.equal(confirmation.history[0].done,false);
  assert.deepEqual(patient(w).carePlans,[]);assert.equal(patient(w).nextVisit,'2026-09-30');
  assert.throws(()=>apply(w,{...command,expectedVersion:2,accessReview:{...accessReview,followUpDaysAfterStart:0}}));
  const prior=structuredClone(followup);followup.done=true;
  w=apply(w,{...command,expectedVersion:2,accessReview:{...accessReview,actualStart:'started',actualStartAt:'2026-09-20',actualStartSource:'Patient repeated the attendance date'}});
  assert.equal(w.tasks.find(task=>task.id===prior.id).done,true);
});

test('source identity collisions and mismatched historical patients cannot overwrite another patient',()=>{
  let w=apply(workspace(),reconciliation),other=structuredClone(w.patients[1]);
  w.tasks[0].patientId='TN-1038';assert.throws(()=>projectTreatmentWork(w,{actor,now}),/identity collision/);assert.deepEqual(w.patients[1],other);
  w=apply(apply(workspace(),reconciliation),{...reconciliation,expectedVersion:1,reviewer:'Reviewing clinician'});
  const record=state(w).reconciliations[0],previous=JSON.parse(record.history[0].previousSnapshot);previous.patientId='TN-1038';record.history[0].previousSnapshot=JSON.stringify(previous);
  assert.throws(()=>projectTreatmentWork(w,{actor,now}),/snapshot does not match/);
  assert.notEqual(treatmentBridgeId('task',patientId,'access','shared','review'),treatmentBridgeId('task',patientId,'reconciliation','shared','review'));
  assert.notEqual(treatmentBridgeId('task',patientId,'access','shared','review'),treatmentBridgeId('task','TN-1038','access','shared','review'));
});
