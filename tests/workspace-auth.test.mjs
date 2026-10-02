import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';

// Bind the real route handlers to an isolated SQLite database, using the same
// prepared SQL as D1. No test identity or database fallback enters production.
const db=new DatabaseSync(':memory:');
db.exec("CREATE TABLE invites (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', role TEXT NOT NULL, workspace TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT NOT NULL, revoked_at TEXT, link_version INTEGER NOT NULL DEFAULT 1, open_count INTEGER NOT NULL DEFAULT 0, last_opened_at TEXT, last_seen_at TEXT)");db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
db.exec(await readFile(new URL('../drizzle/0000_left_ikaris.sql',import.meta.url),'utf8'));
db.exec('CREATE TABLE workspace_history (owner_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, label TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY (owner_id, version))');
const binding={prepare(sql){return {bind(...values){return {async first(){return db.prepare(sql).get(...values)??null;},async run(){const result=db.prepare(sql).run(...values);return {meta:{changes:Number(result.changes)}};}};}};}};
const testKey='theranetrixAuthTestBinding';
globalThis[testKey]={DB:binding};
const output=await build({stdin:{contents:"export * from './app/api/workspace/route';export {engineRecordRevision} from './lib/engine-demo';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'isolated-storage-and-verified-session',setup(b){b.onResolve({filter:/^@\/lib\/postgres-workspace$/},()=>({path:'database',namespace:'test-env'}));b.onResolve({filter:/^@\/lib\/vercel-session$/},()=>({path:'identity',namespace:'test-env'}));b.onLoad({filter:/.*/,namespace:'test-env'},args=>({contents:args.path==='database'?`export const postgresWorkspace=globalThis[${JSON.stringify(testKey)}].DB;`:`export {workspaceIdentity as vercelIdentity} from './lib/workspace-identity';`,loader:'js',resolveDir:process.cwd()}));}}]});
const {GET,POST,engineRecordRevision}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const url='https://theranetrix.test/api/workspace';
const emailHeaders=(email)=>({'oai-authenticated-user-email':email,'oai-authenticated-user-full-name':'Test%20User','oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8'});
const get=(headers)=>GET(new Request(url,{headers}));
const post=(headers,version,action)=>POST(new Request(url,{method:'POST',headers:{...headers,'content-type':'application/json',origin:'https://theranetrix.test'},body:JSON.stringify({version,action})}));
const reset=()=>db.exec('DELETE FROM workspaces');

test('engine run, exact-run decision, patient plan, and advisor exchange survive authenticated reload',async()=>{
 reset();const headers=emailHeaders('engine-owner@example.test'),patientId='TN-DEMO-01';let state=await(await get(headers)).json();
 let p=state.data.patients.find(p=>p.id===patientId);
 const start=await post(headers,state.version,{type:'engine.run',patientId,expectedRevision:engineRecordRevision(p,state.data),preferences:{relief:40,alertness:40,routine:20}});assert.equal(start.status,200);state=await start.json();
 const runId=state.data.engineRuns[0].id;
 const decision=await post(headers,state.version,{type:'engine.decide',patientId,runId,candidateId:'review-current',rationale:'Discuss the recorded side effects.',patientPlan:'Bring your symptom notes to the next review.',owner:'Care coordinator',followup:new Date().toISOString().slice(0,10)});assert.equal(decision.status,200);state=await decision.json();
 const chat=await post(headers,state.version,{type:'advisor.chat',patientId,intent:'plan',text:'What is my plan?'});assert.equal(chat.status,200);
 state=await(await get(headers)).json();assert.equal(state.data.engineRuns[0].id,runId);assert.equal(state.data.engineDecisions[0].runId,runId);assert.match(state.data.advisorTurns.at(-1).reply,/Bring your symptom notes/);
 assert.equal(state.data.engineRuns[0].actor,'engine-owner@example.test');assert.equal(state.data.tasks.filter(t=>t.id==='medication-followup-'+patientId).length,1);
 const other=await(await get(emailHeaders('other-engine-owner@example.test'))).json();
 assert.ok(!other.data.engineRuns?.some(r=>r.id===runId));assert.ok(!other.data.engineDecisions?.some(d=>d.runId===runId));
 assert.ok(!other.data.advisorTurns?.some(t=>/Bring your symptom notes/.test(t.reply)));
});

test('malformed action envelopes return a client error without creating workspace data',async()=>{
 reset();const headers={...emailHeaders('malformed@example.test'),'content-type':'application/json',origin:'https://theranetrix.test'};
 for(const body of ['null','[]','42','"text"','{']){const response=await POST(new Request(url,{method:'POST',headers,body}));assert.equal(response.status,400,body);}
 assert.equal(db.prepare('SELECT count(*) AS count FROM workspaces').get().count,0);
});

test('signed-in email-only requests load, save, and reload the same workspace',async()=>{
 reset();const headers=emailHeaders('owner@example.test');const first=await get(headers);assert.equal(first.status,200);const j=await first.json();assert.equal(j.data.patients.length,11);assert.equal(j.user,'owner@example.test');assert.ok(!('ownerKey' in j));
 const saved=await post(headers,j.version,{type:'goal.update',patientId:'TN-1042',goal:'Persisted after sign-in'});assert.equal(saved.status,200);
 const reloaded=await(await get(headers)).json();assert.equal(reloaded.version,j.version+1);assert.equal(reloaded.data.patients[0].goal,'Persisted after sign-in');
 const key=db.prepare('SELECT owner_id FROM workspaces').get().owner_id;assert.match(key,/^verified-email:v1:[a-f0-9]{64}$/);assert.ok(!key.includes('owner@example.test'));
});
test('an ID appearing later preserves email-backed records and writes',async()=>{
 reset();const email=emailHeaders('owner@example.test');const first=await(await get(email)).json();await post(email,first.version,{type:'goal.update',patientId:'TN-1042',goal:'Keep existing data'});
 const both={...email,'oai-authenticated-user-id':'stable-owner-42'};const j=await(await get(both)).json();assert.equal(j.data.patients[0].goal,'Keep existing data');
 assert.equal((await post(both,j.version,{type:'goal.update',patientId:'TN-1042',goal:'Saved with ID present'})).status,200);
 const reloaded=await(await get(email)).json();assert.equal(reloaded.data.patients[0].goal,'Saved with ID present');assert.equal(db.prepare('SELECT count(*) AS count FROM workspaces').get().count,1);
});
test('legacy stable-ID records retain their original key and contents',async()=>{
 reset();const headers={'oai-authenticated-user-id':'existing-owner'};const first=await(await get(headers)).json();await post(headers,first.version,{type:'goal.update',patientId:'TN-1042',goal:'Existing ID record'});
 const both={...headers,...emailHeaders('owner@example.test')};const j=await(await get(both)).json();assert.equal(j.data.patients[0].goal,'Existing ID record');assert.equal((await post(both,j.version,{type:'goal.update',patientId:'TN-1042',goal:'Legacy key preserved'})).status,200);assert.equal(db.prepare('SELECT owner_id FROM workspaces').get().owner_id,'existing-owner');
});
test('anonymous requests fail before creating or reading a workspace',async()=>{
 reset();assert.equal((await get({})).status,401);assert.equal((await get({'oai-authenticated-user-full-name':'Unverified display name'})).status,401);assert.equal((await post({},1,{type:'goal.update',patientId:'TN-1042',goal:'Unauthorized'})).status,401);assert.equal(db.prepare('SELECT count(*) AS count FROM workspaces').get().count,0);
});
test('different verified accounts cannot read or overwrite each other',async()=>{
 reset();const a=emailHeaders('Alice@example.test'),b=emailHeaders('alice@example.test');const first=await(await get(a)).json();await post(a,first.version,{type:'goal.update',patientId:'TN-1042',goal:'Account A private change'});const other=await(await get(b)).json();assert.notEqual(other.data.patients[0].goal,'Account A private change');assert.equal(other.version,1);assert.equal(db.prepare('SELECT count(*) AS count FROM workspaces').get().count,2);
});
test('stale versions cannot overwrite a saved change',async()=>{
 reset();const headers=emailHeaders('owner@example.test');const first=await(await get(headers)).json();assert.equal((await post(headers,first.version,{type:'goal.update',patientId:'TN-1042',goal:'First save'})).status,200);assert.equal((await post(headers,first.version,{type:'goal.update',patientId:'TN-1042',goal:'Stale save'})).status,409);assert.equal((await(await get(headers)).json()).data.patients[0].goal,'First save');
});

test('legacy saved data upgrades and medication plans persist through the authenticated API',async()=>{
 reset();const headers=emailHeaders('owner@example.test');const first=await(await get(headers)).json();const legacy=first.data;legacy.patients[0].goal='Preserve this saved goal';delete legacy.patients[0].medications;delete legacy.patients[0].carePlans;db.prepare('UPDATE workspaces SET data = ?').run(JSON.stringify(legacy));
 const j=await(await get(headers)).json(),p=j.data.patients[0],m=p.medications[0];assert.equal(p.goal,'Preserve this saved goal');
 const action={type:'medication.save',patientId:p.id,id:m.id,name:m.name,regimen:m.regimen,indication:m.indication,started:'',status:'Active',benefit:'Helpful',tolerability:'Effects reported',effects:'Reported grogginess',adherence:'Taken as recorded',reportedAt:'2026-09-08'};
 const medSave=await post(headers,j.version,action);assert.equal(medSave.status,200);const saved=await medSave.json();
 const date=new Date().toISOString().slice(0,10),plan={type:'plan.save',patientId:p.id,text:'Review the reported effects and patient goals.',owner:'Assigned reviewer',followup:date,time:'10:30'};
 assert.equal((await post(headers,saved.version,plan)).status,200);assert.equal((await post(headers,saved.version,plan)).status,409);
 const reloaded=await(await get(headers)).json();assert.equal(reloaded.data.patients[0].medications[0].benefit,'Helpful');assert.equal(reloaded.data.patients[0].medications[0].history.length,2);assert.equal(reloaded.data.patients[0].goal,'Preserve this saved goal');assert.equal(reloaded.data.patients[0].carePlans.length,1);assert.equal(reloaded.data.tasks.filter(t=>t.id==='medication-followup-'+p.id).length,1);
});

test('clinical context and prior allergy history survive authenticated save and reload',async()=>{
 reset();const headers=emailHeaders('context-owner@example.test');const first=await(await get(headers)).json();const action={type:'context.update',patientId:'TN-1042',allergyStatus:'Reactions reported',allergies:'Sample allergen: reported rash',medicalHistory:'Sample reviewed history',priorTreatments:'',painLocation:'Feet',painDuration:'',physicalContext:'',psychologicalContext:'',socialContext:'',coordinator:'Taylor, RN',preferences:'Prioritize daily function'};
 const response=await post(headers,first.version,action);assert.equal(response.status,200);const saved=await response.json();assert.equal((await post(headers,saved.version,{...action,allergyStatus:'None reported',allergies:''})).status,200);
 const reloaded=await(await get(headers)).json();const p=reloaded.data.patients[0];assert.equal(p.clinicalContext.preferences,action.preferences);assert.equal(p.clinicalContext.history[0].allergies,action.allergies);assert.equal(p.clinicalContext.author,'context-owner@example.test');assert.equal(reloaded.data.patients.find(x=>x.id==='TN-1047').clinicalContext,undefined);
});

test('feature configuration persists atomically with server-attributed snapshots and enforces gates after reload',async()=>{
 reset();const headers=emailHeaders('configuration-owner@example.test');const first=await(await get(headers)).json();
 const planning={intendedUse:'Synthetic evaluation of care coordination',users:'Healthcare professionals',decisionRole:'Organize and display records',timeCritical:'No',criteria:{permissibleInputs:'Not assessed',medicalInformation:'Not assessed',hcpSupport:'Not assessed',independentBasis:'Not assessed'},planned:{predictiveTwin:true,treatmentRecommendations:false,patientMedicalAdvice:false,timeCriticalAlerts:false,automatedTreatmentActions:false,signalOrImageAnalysis:false},plannedModelChanges:'Not assessed',owner:'Product reviewer',rationale:'Future prediction service is not implemented.'};
 const features={...first.data.features,assessments:false,reviewPrompts:false};
 const response=await post(headers,first.version,{type:'configuration.save',features,planning,actor:'Forged actor',effective:{digitalTwin:true}});assert.equal(response.status,200);
 const reloaded=await(await get(headers)).json();assert.equal(reloaded.version,first.version+1);assert.equal(reloaded.data.features.assessments,false);assert.equal(reloaded.data.planning.owner,'Product reviewer');
 const snapshot=reloaded.data.configurationHistory[0];assert.equal(snapshot.actor,'configuration-owner@example.test');assert.equal(snapshot.effective.digitalTwin,false);assert.equal(snapshot.effectivePlanned.predictiveTwin,false);assert.equal(snapshot.profile.planned.predictiveTwin,true);
 const checkin={type:'checkin.add',patientId:'TN-DEMO-02',pain:3,function:8,sleep:8,note:'Blocked after configuration change'};
 assert.equal((await post(headers,first.version,checkin)).status,409);assert.equal((await post(headers,reloaded.version,checkin)).status,400);
 const after=await(await get(headers)).json();assert.deepEqual(after,reloaded);
 const other=await(await get(emailHeaders('separate-owner@example.test'))).json();assert.equal(other.data.features.assessments,true);assert.ok(!other.data.configurationHistory?.some(entry=>entry.id===snapshot.id));assert.equal(other.data.planning.owner,'Dr. Maya Chen');
});
test('real workflow commands persist after legacy migration and remain isolated between authenticated owners',async()=>{
 reset();
 const headers=emailHeaders('workflow-owner@example.test');
 const first=await(await get(headers)).json();
 const legacy=structuredClone(first.data);delete legacy.clinicalWorkflows;
 db.prepare('UPDATE workspaces SET data = ?').run(JSON.stringify(legacy));
 const reloaded=await(await get(headers)).json();
 const empty={preparations:[],intakes:[],assessments:[],observations:[],signoffs:[],episodes:[],receipts:[]};
 assert.equal(reloaded.data.clinicalWorkflows.version,1);
 assert.equal(reloaded.data.clinicalWorkflows.slices.encounters.version,0);
 assert.deepEqual(reloaded.data.clinicalWorkflows.slices.encounters.state,empty);
 assert.equal(reloaded.data.patients[0].goal,first.data.patients[0].goal);
 const command={type:'encounters.preparation.save',requestId:'req-enc-1',patientId:'TN-1042',encounterId:'auth-persisted-encounter',reasonForVisit:'Private follow-up request from the first owner.',changesSinceLastReviewedEncounter:'Patient requested a review of the saved walking goal.',sourceDates:[new Date().toISOString().slice(0,10)],preparationOwner:'Assigned clinician',openQuestions:[],missingInputs:[],patientGoal:'Walk with family.',status:'draft'};
 const action={type:'workflow.apply',domain:'encounters',patientId:command.patientId,requestId:command.requestId,expectedSliceVersion:0,command};
 const response=await post(headers,reloaded.version,action);
 assert.equal(response.status,200);
 const accepted=await response.json();
 const after=await(await get(headers)).json();
 assert.equal(after.version,reloaded.version+1);
 assert.deepEqual(after,accepted);
 const slice=after.data.clinicalWorkflows.slices.encounters,record=slice.state.preparations[0];
 assert.equal(slice.version,1);assert.equal(record.reasonForVisit,command.reasonForVisit);
 assert.equal(slice.updatedBy,'workflow-owner@example.test');
 assert.ok(record.history.every(entry=>entry.actor==='workflow-owner@example.test'));
 assert.ok(after.data.audit.some(entry=>entry.action==='Saved encounters.preparation.save'&&entry.actor==='workflow-owner@example.test'&&entry.patientId===command.patientId));
 const forged=await post(headers,after.version,{...action,command:{...command,requestId:'forged-command',actor:'different-owner@example.test'},requestId:'forged-command'});
 assert.equal(forged.status,400);
 assert.equal((await post(headers,reloaded.version,{...action,requestId:'stale-workspace',command:{...command,requestId:'stale-workspace',expectedVersion:record.version}})).status,409);
 assert.equal((await post(headers,after.version,{...action,requestId:'stale-slice',command:{...command,requestId:'stale-slice',expectedVersion:record.version}})).status,400);
 assert.deepEqual(await(await get(headers)).json(),after);
 const replay=await post(headers,after.version,action);assert.equal(replay.status,200);
 const replayed=await replay.json();
 assert.equal(replayed.data.clinicalWorkflows.slices.encounters.version,1);
 assert.equal(replayed.data.clinicalWorkflows.slices.encounters.state.preparations.length,1);
 assert.deepEqual(replayed.data.audit,after.data.audit);
 const otherHeaders=emailHeaders('other-workflow-owner@example.test');
 const other=await(await get(otherHeaders)).json();
 assert.ok(!other.data.clinicalWorkflows.slices.encounters.state.preparations.some(record=>record.encounterId===command.encounterId&&record.patientId===command.patientId),'Another owner must not receive this encounter.');
 assert.ok(!other.data.clinicalWorkflows.slices.encounters.state.receipts.some(receipt=>receipt.requestId===command.requestId));
 assert.ok(!other.data.audit.some(entry=>entry.action==='Saved encounters.preparation.save'&&entry.patientId===command.patientId));
 const otherSave=await post(otherHeaders,other.version,{...action,expectedSliceVersion:other.data.clinicalWorkflows.slices.encounters.version,command:{...command,reasonForVisit:'Second owner independent request.'}});
 assert.equal(otherSave.status,200);
 const otherReloaded=await(await get(otherHeaders)).json();
 const otherRecord=otherReloaded.data.clinicalWorkflows.slices.encounters.state.preparations.find(record=>record.encounterId===command.encounterId&&record.patientId===command.patientId);
 assert.equal(otherRecord.reasonForVisit,'Second owner independent request.');
 // Entity identifiers may be deterministic; the authenticated workspace owns their scope.
 assert.equal(otherRecord.id,record.id);
 assert.notEqual(otherRecord.reasonForVisit,record.reasonForVisit);
 assert.equal(otherReloaded.data.clinicalWorkflows.slices.encounters.updatedBy,'other-workflow-owner@example.test');
 assert.deepEqual(await(await get(headers)).json(),replayed);
});
