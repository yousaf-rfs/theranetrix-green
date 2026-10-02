import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';

// Exercise the actual workspace GET/POST, command schemas, reducers, bridges,
// normalization, prepared SQL and optimistic writes. Only storage and the
// verified-session boundary are substituted. This does not test the production
// Vercel authentication adapter or a live PostgreSQL connection.
const db=new DatabaseSync(':memory:');
db.exec("CREATE TABLE invites (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', role TEXT NOT NULL, workspace TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT NOT NULL, revoked_at TEXT, link_version INTEGER NOT NULL DEFAULT 1, open_count INTEGER NOT NULL DEFAULT 0, last_opened_at TEXT, last_seen_at TEXT)");db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
db.exec(await readFile(new URL('../drizzle/0000_left_ikaris.sql',import.meta.url),'utf8'));
db.exec('CREATE TABLE workspace_history (owner_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, label TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY (owner_id, version))');
const testKey=`theranetrixWorkflowApi_${crypto.randomUUID().replaceAll('-','')}`;
let workspaceUpdateCount=0;
globalThis[testKey]={prepare(sql){return {bind(...values){return {
  async first(){return db.prepare(sql).get(...values)??null;},
  async run(){if(/^\s*UPDATE\s+workspaces\b/i.test(sql))workspaceUpdateCount++;const result=db.prepare(sql).run(...values);return {meta:{changes:Number(result.changes)}};},
};}};}};
const bundle=await build({
  stdin:{contents:"export * from './app/api/workspace/route'; export {clinicalWorkflowDomains,clinicalWorkflowWorkerProvenance,workspaceCarePlans,workflowInputRevision} from './lib/clinical-flows'; export {openCareWork} from './lib/care-operations';",resolveDir:process.cwd()},
  bundle:true,platform:'node',format:'esm',write:false,
  plugins:[{name:'isolated-sql-and-verified-identity',setup(builder){
    builder.onResolve({filter:/^@\/lib\/postgres-workspace$/},()=>({path:'storage',namespace:'workflow-api-test'}));
    builder.onResolve({filter:/^@\/lib\/vercel-session$/},()=>({path:'identity',namespace:'workflow-api-test'}));
    builder.onLoad({filter:/.*/,namespace:'workflow-api-test'},({path})=>({
      contents:path==='storage'?`export const postgresWorkspace=globalThis[${JSON.stringify(testKey)}];`:"export {workspaceIdentity as vercelIdentity} from './lib/workspace-identity';",
      loader:'js',resolveDir:process.cwd(),
    }));
  }}],
});
const {GET,POST,clinicalWorkflowDomains,clinicalWorkflowWorkerProvenance,workspaceCarePlans,workflowInputRevision,openCareWork}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+'\n//# sourceURL=clinical-workflow-api-test-bundle.mjs').toString('base64'));
const origin='https://theranetrix.test';
const url=origin+'/api/workspace';
const actor='workflow-clinician@example.test';
const headers=(email=actor)=>({'oai-authenticated-user-email':email,'oai-authenticated-user-full-name':'Verified Test Clinician'});
const read=async(identity=headers())=>{
  const response=await GET(new Request(url,{headers:identity}));
  const body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));
  return body;
};
const post=(version,action,identity=headers(),extraHeaders={})=>POST(new Request(url,{method:'POST',headers:{...identity,'content-type':'application/json',origin,...extraHeaders},body:JSON.stringify({version,action})}));
const reset=()=>db.exec('DELETE FROM workspaces');
const patientId='TN-1042';
const preparation=(overrides={})=>({type:'encounters.preparation.save',requestId:crypto.randomUUID(),patientId,encounterId:'api-boundary-encounter',reasonForVisit:'Synthetic API acceptance review.',changesSinceLastReviewedEncounter:'',sourceDates:[],preparationOwner:'Named clinician',openQuestions:[],missingInputs:[],patientGoal:'Synthetic walking goal.',status:'draft',...overrides});
const envelope=(workspace,domain,command,overrides={})=>({type:'workflow.apply',domain,requestId:command.requestId,expectedSliceVersion:workspace.data.clinicalWorkflows.slices[domain].version,...(clinicalWorkflowWorkerProvenance[domain].scope==='patient'?{patientId:command.patientId}:{}),command,...overrides});

async function assertRejectedWithoutWrite(workspace,action,{identity=headers(),status=400,version=workspace.version,pattern}={}){
  const response=await post(version,action,identity);
  const body=await response.json();
  assert.equal(response.status,status,JSON.stringify(body));
  if(pattern)assert.match(body.error,pattern);
  assert.deepEqual(await read(identity),workspace,'Rejected commands must leave the persisted workspace unchanged.');
}

test.after(()=>{db.close();delete globalThis[testKey];});

test('demonstration connection persists imports, duplicate checks, correction history and delivery recovery without enabling live integrations',async()=>{
  reset();let workspace=await read();const id='TN-DEMO-01';
  const live=structuredClone(workspace.data.clinicalWorkflows.slices['integration-access']);
  const other=structuredClone(workspace.data.patients.find(patient=>patient.id==='TN-DEMO-02'));
  const apply=async(command,options={})=>{
    const action={type:'demonstration.connection',requestId:crypto.randomUUID(),expectedVersion:workspace.data.demoConnection?.version??0,patientId:id,command,...options};
    const response=await post(workspace.version,action),saved=await response.json();assert.equal(response.status,200,JSON.stringify(saved));workspace=saved;assert.deepEqual(await read(),workspace);return action;
  };
  await apply({operation:'connect'});await apply({operation:'open-chart'});
  const initialCount=workspace.data.patients.find(patient=>patient.id===id).pain.length;
  const action=await apply({operation:'import-readings'});
  const imported=structuredClone(workspace.data.demoConnection);
  assert.equal(workspace.data.patients.find(patient=>patient.id===id).pain.length,initialCount+1);
  assert.equal(imported.patients[id].imports.filter(record=>record.status==='quarantined').length,1);
  await apply(action.command,action);assert.deepEqual(workspace.data.demoConnection,imported,'An exact retry keeps the activity history unchanged.');
  await apply({operation:'retry-import'});assert.equal(workspace.data.patients.find(patient=>patient.id===id).pain.length,initialCount+1);
  await apply({operation:'resolve-import',resolution:'correct'});
  const corrected=workspace.data.demoConnection.patients[id].imports.find(record=>record.status==='corrected');
  assert.equal(corrected.sourcePatientId,'unmatched-chart','The original mismatch is retained.');assert.ok(corrected.replacementObservationId);
  assert.equal(workspace.data.patients.find(patient=>patient.id===id).pain.length,initialCount+2);
  assert.deepEqual(workspace.data.patients.find(patient=>patient.id==='TN-DEMO-02'),other,'The neighboring patient was never changed.');
  await apply({operation:'prepare-note'});await apply({operation:'simulate-delivery-failure'});
  const prepared=workspace.data.demoConnection.patients[id].deliveries[0];assert.equal(prepared.status,'failed');assert.equal(prepared.attempts,1);
  await apply({operation:'retry-delivery'});
  const delivered=workspace.data.demoConnection.patients[id].deliveries[0];assert.equal(delivered.status,'received');assert.equal(delivered.attempts,2);assert.match(delivered.receipt,/^DEMO-/);assert.ok(delivered.receivedAt);
  assert.deepEqual(workspace.data.clinicalWorkflows.slices['integration-access'],live,'No real provider or identity state changed.');
  const base={type:'demonstration.connection',patientId:id,requestId:crypto.randomUUID(),expectedVersion:workspace.data.demoConnection.version,command:{operation:'deliver-note'}};
  await assertRejectedWithoutWrite(workspace,base,{pattern:/already received/});
  await assertRejectedWithoutWrite(workspace,{...base,patientId:'TN-1042'},{pattern:/demonstration stories/});
  await assertRejectedWithoutWrite(workspace,{...base,command:{operation:'connect',providerReceipt:'forged'}});
  await assertRejectedWithoutWrite(workspace,{...base,expectedVersion:0,command:{operation:'connect'}},{pattern:/connection changed/});
  await assertRejectedWithoutWrite(workspace,{...action,command:{operation:'connect'}},{pattern:/different action/});
});

test('demonstration access respects consent, patient-specific proxy grants and stale care plans',async()=>{
  reset();let workspace=await read();const id='TN-DEMO-01';
  const make=command=>({type:'demonstration.connection',patientId:id,requestId:crypto.randomUUID(),expectedVersion:workspace.data.demoConnection?.version??0,command});
  const apply=async command=>{const response=await post(workspace.version,make(command));const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));workspace=body;assert.deepEqual(await read(),workspace);};
  await apply({operation:'connect'});await apply({operation:'check-access',role:'proxy'});assert.equal(workspace.data.demoConnection.patients[id].accessChecks[0].allowed,false);
  await apply({operation:'set-proxy',allowed:true});await apply({operation:'check-access',role:'proxy'});assert.equal(workspace.data.demoConnection.patients[id].accessChecks[0].allowed,true);
  const other=await post(workspace.version,{...make({operation:'check-access',role:'proxy'}),patientId:'TN-DEMO-02'});workspace=await other.json();assert.equal(other.status,200);assert.equal(workspace.data.demoConnection.patients['TN-DEMO-02'].accessChecks[0].allowed,false);
  await apply({operation:'open-chart'});await apply({operation:'prepare-note'});await apply({operation:'set-consent',allowed:false});
  for(const operation of ['open-chart','deliver-note','import-readings'])await assertRejectedWithoutWrite(workspace,make({operation}));
  await apply({operation:'check-access',role:'clinician'});assert.equal(workspace.data.demoConnection.patients[id].accessChecks[0].allowed,false);
  await apply({operation:'set-consent',allowed:true});await apply({operation:'open-chart'});
  const response=await post(workspace.version,{type:'plan.save',patientId:id,text:'A new agreed plan after the delivery was prepared.',owner:'Care coordinator',followup:new Date(Date.now()+86400000).toISOString().slice(0,10),time:'10:00'});workspace=await response.json();assert.equal(response.status,200);
  await assertRejectedWithoutWrite(workspace,make({operation:'deliver-note'}),{pattern:/care plan changed/});
  await apply({operation:'prepare-note'});await apply({operation:'deliver-note'});assert.equal(workspace.data.demoConnection.patients[id].deliveries.length,2);
});

test('demonstration outage, granular access, replay and partial receipts persist through the real API',async(t)=>{
  reset();let workspace=await read();const id='TN-DEMO-01',counts={accepted:0,rejected:0};
  const {runDemoConnectionScenarios}=await import('./fixtures/integration-access-scenarios.mjs');
  const action=command=>({type:'demonstration.connection',patientId:id,requestId:crypto.randomUUID(),expectedVersion:workspace.data.demoConnection?.version??0,command});
  const outcome=await runDemoConnectionScenarios({
    patientId:id,workspace:()=>workspace.data,
    applyConnection:async command=>{
      const beforeVersion=workspace.data.demoConnection?.version??0;
      const response=await post(workspace.version,action(command)),saved=await response.json();
      assert.equal(response.status,200,`${command.operation}: ${JSON.stringify(saved)}`);
      assert.equal(saved.version,workspace.version+1);
      assert.equal(saved.data.demoConnection.version,beforeVersion+1);
      assert.equal(saved.data.audit[0].actor,actor);
      const reload=await read();assert.deepEqual(reload,saved,`${command.operation} survives a fresh API reload.`);
      workspace=reload;counts.accepted++;return workspace.data.demoConnection;
    },
    expectConnectionRejected:async command=>{await assertRejectedWithoutWrite(workspace,action(command));counts.rejected++;},
  });
  assert.deepEqual(outcome,{acceptedReports:2,receivedParts:2});
  assert.deepEqual(counts,{accepted:22,rejected:5});
  t.diagnostic(`${counts.accepted} connection commands persisted and reloaded; ${counts.rejected} unsafe transitions rejected without a write.`);
});

test('patient check-ins save zero, declined and unanswered responses with a note and stable retries',async()=>{
  reset();let workspace=await read();const patientBefore=structuredClone(workspace.data.patients.find(patient=>patient.id===patientId));
  const requestId=crypto.randomUUID(),recordedAt=new Date().toISOString();
  const command={type:'encounters.observations.save',requestId,patientId,encounterId:'patient-checkin-'+requestId,instrument:'local-0-10',submissionStatus:'confirmed',submissionSource:'patient-self-report',patientNote:'I want to discuss sleep at my next visit.',entries:[{metric:'pain',status:'zero',value:0},{metric:'function',status:'declined'},{metric:'sleep',status:'unanswered'}].map(entry=>({...entry,source:'Patient self-report',recordedAt}))};
  const action=envelope(workspace,'encounters',command);
  const response=await post(workspace.version,action);workspace=await response.json();assert.equal(response.status,200,JSON.stringify(workspace));assert.deepEqual(await read(),workspace);
  const patient=workspace.data.patients.find(patient=>patient.id===patientId),record=workspace.data.clinicalWorkflows.slices.encounters.state.observations.find(record=>record.encounterId===command.encounterId);
  assert.equal(record.patientNote,command.patientNote);assert.equal(record.submissionSource,'patient-self-report');
  assert.equal(record.currentEntries.find(entry=>entry.metric==='pain').value,0);
  assert.equal(record.currentEntries.find(entry=>entry.metric==='function').value,undefined);assert.equal(record.currentEntries.find(entry=>entry.metric==='sleep').value,undefined);
  assert.deepEqual(patient.pain,patientBefore.pain,'Partial check-ins never create invented trajectory values.');assert.match(patient.notes[0].text,/I want to discuss sleep/);
  const replay=await post(workspace.version,action),body=await replay.json();assert.equal(replay.status,200);assert.deepEqual(body.data,workspace.data);workspace=body;
  await assertRejectedWithoutWrite(workspace,{...action,command:{...command,patientNote:'Different note on the same request.'}},{pattern:/different workflow command/});
  const complete={...command,requestId:crypto.randomUUID(),encounterId:'patient-complete-'+requestId,entries:['pain','function','sleep'].map(metric=>({metric,status:'zero',value:0,source:'Patient self-report',recordedAt}))};
  const saved=await post(workspace.version,envelope(workspace,'encounters',complete));workspace=await saved.json();assert.equal(saved.status,200);
  const checkin=workspace.data.patients.find(patient=>patient.id===patientId).checkins[0];assert.equal(checkin.source,'Patient self-report');assert.equal(checkin.note,command.patientNote);assert.equal(checkin.pain,0);assert.equal(checkin.function,0);assert.equal(checkin.sleep,0);
});

test('all 34 workflow journeys persist through the real API with one domain-specific rejection each',async(t)=>{
  reset();
  let workspace=await read();
  const initial=structuredClone(workspace);
  const otherInitial=await read(headers('other-workflow-clinician@example.test'));
  const recorded=new Map();
  const counts={accepted:0,rejected:0,transfers:0};
  // Encounter sign-off supplies the actual plan consumed by coordination. The
  // governance fixture runs last so feature changes cannot skew earlier tests.
  const domains=['results-referrals','treatment-continuity','encounters','patient-coordination','decisions','integration-access','program-governance'];
  for(const domain of domains){
    const {runScenarios}=await import(`./fixtures/${domain}-scenarios.mjs`);
    const driver={
      patientId,now:new Date().toISOString(),
      state:()=>workspace.data.clinicalWorkflows.slices[domain].state,
      workspace:()=>workspace.data,
      get inputVersion(){return workflowInputRevision(workspace.data.patients.find(patient=>patient.id===patientId),workspace.data);},
      get carePlans(){return workspaceCarePlans(workspace.data).filter(plan=>plan.patientId===patientId);},
      get planRef(){return workspace.data.patients.find(patient=>patient.id===patientId).carePlans[0]?.id;},
      apply:async command=>{
        const previousSlice=workspace.data.clinicalWorkflows.slices[domain];
        const response=await post(workspace.version,envelope(workspace,domain,command));
        const saved=await response.json();
        assert.equal(response.status,200,`${domain} ${command.type}: ${JSON.stringify(saved)}`);
        const nextSlice=saved.data.clinicalWorkflows.slices[domain];
        assert.equal(nextSlice.updatedBy,actor,'Workflow metadata must use the authenticated server actor.');
        const isRetry=previousSlice.receipts.some(receipt=>receipt.id===command.requestId);
        assert.equal(saved.version,workspace.version+(isRetry?0:1));
        assert.equal(nextSlice.version,previousSlice.version+(isRetry?0:1));
        assert.ok(nextSlice.receipts.some(receipt=>receipt.id===command.requestId));
        if(isRetry)assert.deepEqual(nextSlice,previousSlice,'Exact replay must preserve workflow history and metadata.');
        const reload=await read();
        assert.deepEqual(reload,saved,`${command.type} must survive fresh API reload.`);
        workspace=reload;
        counts.accepted++;
        return nextSlice.state;
      },
      expectRejected:async command=>{
        await assertRejectedWithoutWrite(workspace,envelope(workspace,domain,command));
        counts.rejected++;
      },
      acceptEpisodeWork:async encounterId=>{
        const work=openCareWork(workspace.data,patientId).filter(item=>!item.encounterId||item.encounterId===encounterId);
        assert.ok(work.some(item=>item.title==='Progress review'),'The acceptance includes the existing unscoped progress-review task.');
        const command={type:'care.operations',patientId,requestId:crypto.randomUUID(),expectedVersion:workspace.data.careOperations?.version??0,command:{kind:'transfer',work:work.map(({id,revision})=>({id,revision})),owner:'Acceptance clinician',backup:'Acceptance coverage clinician',dueAt:new Date(Date.now()+7*86_400_000).toISOString(),timezone:'UTC',evidence:'The receiving clinician accepted each listed item before episode closure.'}};
        const response=await post(workspace.version,command),saved=await response.json();
        assert.equal(response.status,200,JSON.stringify(saved));assert.equal(saved.version,workspace.version+1);
        const reload=await read();assert.deepEqual(reload,saved);workspace=reload;
        const after=openCareWork(workspace.data,patientId);
        for(const item of work){
          assert.equal(after.find(row=>row.id===item.id&&row.revision===item.revision)?.acceptedOwner,'Acceptance clinician');
          assert.ok(workspace.data.careOperations.transfers.some(row=>row.workId===item.id&&row.revision===item.revision&&row.actor===actor),'Each acceptance retains the exact source revision and authenticated actor.');
        }
        counts.transfers++;
      },
      record:(journey,status)=>{
        assert.ok(clinicalWorkflowWorkerProvenance[domain].journeys.includes(journey),`${journey} belongs to ${domain}.`);
        assert.ok(!recorded.has(journey),`${journey} must be recorded exactly once.`);
        assert.ok(['passed','external-blocked'].includes(status),`${journey}: unexpected status ${status}`);
        recorded.set(journey,{domain,status});
      },
    };
    await runScenarios(driver);
    if(domain==='encounters'){
      const signoffs=driver.state().signoffs.filter(item=>item.patientId===patientId&&item.status==='signed');
      const latest=signoffs.at(-1);
      const patient=workspace.data.patients.find(item=>item.id===patientId);
      const currentPlan=patient.carePlans.find(plan=>plan.workflowRecordId===latest.id);
      assert.ok(currentPlan,'The signed encounter must be projected into the actual patient care plan.');
      assert.equal(patient.carePlans.filter(plan=>plan.workflowRecordId===latest.id).length,1,'Signed amendments must not duplicate care plans.');
      assert.equal(patient.carePlans[0].id,currentPlan.id,'The patient companion must use the latest signed plan.');
      assert.equal(currentPlan.text,latest.patientFacingPlan);
      assert.equal(currentPlan.appointmentBooked,false);
      assert.equal(currentPlan.supersedes,patient.carePlans.find(plan=>plan.workflowRecordId===latest.amendedFromId)?.id);
      assert.ok(currentPlan.supersedes,'The amendment preserves and supersedes its signed original.');
      const observation=driver.state().observations.find(item=>item.patientId===patientId);
      const projectedObservations=patient.workflowObservations.filter(item=>item.workflowRecordId===observation.id);
      assert.equal(projectedObservations.length,observation.entries.length);
      assert.ok(projectedObservations.some(item=>item.metric==='sleep'&&item.status==='declined'&&item.value===undefined));
      assert.ok(projectedObservations.some(item=>item.metric==='pain'&&item.value===0));
      assert.ok(projectedObservations.some(item=>item.correctedFromEntryId));
      assert.ok(patient.notes.some(note=>note.text.includes(latest.patientFacingPlan)&&note.author===actor),'Signed encounter note must be visible in the existing patient chart.');
      assert.ok(workspace.data.tasks.some(task=>task.patientId===patientId&&task.title==='Review walking log'),'Pending encounter work must reach the existing task list.');
      // The fixture has declined sleep. A missing score must never become 0.
      const priorCheckins=new Set(initial.data.patients.find(item=>item.id===patientId).checkins.map(item=>item.id));
      assert.ok(!patient.checkins.some(item=>!priorCheckins.has(item.id)&&item.pain===0&&item.function===5&&item.sleep===0),'Declined sleep must never be projected as a numeric zero.');
      const response=await post(workspace.version,{type:'advisor.chat',patientId,intent:'plan',text:'What is my agreed plan?'});
      assert.equal(response.status,200);
      workspace=await response.json();
      assert.ok(workspace.data.advisorTurns.at(-1).reply.includes(latest.patientFacingPlan),'Patient companion must read the signed care plan.');
      assert.deepEqual(await read(),workspace);
    }
  }
  const expected=Array.from({length:34},(_,index)=>`J${String(index+1).padStart(2,'0')}`);
  assert.deepEqual([...recorded.keys()].sort(),expected);
  assert.deepEqual(counts,{accepted:172,rejected:71,transfers:1},'Every fixture command and explicit care-work acceptance must pass through the persisted API driver.');
  for(const [journey,{status}] of recorded){
    if(['J12','J19','J21'].includes(journey))assert.equal(status,'external-blocked');
    else assert.equal(status,'passed');
  }
  const other=await read(headers('other-workflow-clinician@example.test'));
  assert.deepEqual(other,otherInitial,'Changes must be isolated by authenticated workspace, including the populated initial records.');
  assert.ok(!other.data.audit.some(item=>item.actor===actor));
  const signedIds=new Set(workspace.data.clinicalWorkflows.slices.encounters.state.signoffs.map(record=>record.id));
  assert.ok(!other.data.patients.find(item=>item.id===patientId).carePlans.some(plan=>signedIds.has(plan.workflowRecordId)));
  t.diagnostic(`${recorded.size} journeys: ${[...recorded.values()].filter(item=>item.status==='passed').length} passed, ${[...recorded.values()].filter(item=>item.status==='external-blocked').length} external-blocked; ${counts.accepted} accepted workflow commands with fresh reload, ${counts.transfers} care-work transfer, ${counts.rejected} rejected commands with unchanged persisted data.`);
});

test('workflow commands enforce patient, domain, request identity, strict metadata, and all version boundaries',async()=>{
  reset();
  let workspace=await read();
  const command=preparation();
  const firstEnvelope=envelope(workspace,'encounters',command);
  for(const action of [
    {...firstEnvelope,patientId:'TN-1038'},
    {...firstEnvelope,domain:'decisions'},
    {...firstEnvelope,requestId:'mismatched-request'},
    {...firstEnvelope,actor:'forged-clinician'},
    {...firstEnvelope,now:'1900-01-01T00:00:00Z'},
    {...firstEnvelope,state:{signoffs:[]}},
    {...firstEnvelope,command:{...command,actor:'forged-clinician'}},
    {...firstEnvelope,command:{...command,reasonForVisit:'Changed',unexpected:true}},
    {...firstEnvelope,patientId:'missing-patient',command:{...command,patientId:'missing-patient'}},
  ])await assertRejectedWithoutWrite(workspace,action);
  const response=await post(workspace.version,firstEnvelope);
  assert.equal(response.status,200);
  const originalWorkspace=workspace;
  workspace=await response.json();
  const currentRecord=workspace.data.clinicalWorkflows.slices.encounters.state.preparations[0];
  assert.equal(currentRecord.history[0].actor,actor);
  assert.equal(workspace.data.audit[0].actor,actor);
  const nextCommand=preparation({expectedVersion:currentRecord.version});
  await assertRejectedWithoutWrite(workspace,envelope(workspace,'encounters',nextCommand),{version:originalWorkspace.version,status:409,pattern:/workspace changed/});
  await assertRejectedWithoutWrite(workspace,envelope(workspace,'encounters',nextCommand,{expectedSliceVersion:0}),{pattern:/workflow changed/});
  await assertRejectedWithoutWrite(workspace,envelope(workspace,'encounters',preparation({expectedVersion:2})),{pattern:/changed in another session/});
  const otherPatientBefore=structuredClone(workspace.data.patients.find(patient=>patient.id==='TN-1038'));
  assert.deepEqual(otherPatientBefore,originalWorkspace.data.patients.find(patient=>patient.id==='TN-1038'));
});

test('idempotent retries do not duplicate workflow history, audit, or downstream records',async()=>{
  reset();
  let workspace=await read();
  const command=preparation();
  const firstEnvelope=envelope(workspace,'encounters',command);
  const response=await post(workspace.version,firstEnvelope);
  assert.equal(response.status,200);
  workspace=await response.json();
  const retry=await post(workspace.version,firstEnvelope);
  assert.equal(retry.status,200,'An exact command retry uses its recorded request receipt even with the old slice version.');
  const repeated=await retry.json();
  assert.deepEqual(repeated.data,workspace.data,'An idempotent retry must not add audit/history or bridge records.');
  workspace=repeated;
  await assertRejectedWithoutWrite(workspace,envelope(workspace,'encounters',{...command,patientGoal:'Different payload under the same request ID.'}),{pattern:/already used/});
  assert.deepEqual(await read(),workspace);
});

test('a lost response can be retried at the original workspace version without another SQL update',async()=>{
  reset();
  const original=await read(),command=preparation(),action=envelope(original,'encounters',command);
  // The server commits, but the client never uses this response to advance its version.
  const first=await post(original.version,action);assert.equal(first.status,200);
  let persisted=await read();assert.equal(persisted.version,original.version+1);
  const next=preparation({encounterId:'independent-work-after-lost-response'});
  const later=await post(persisted.version,envelope(persisted,'encounters',next));assert.equal(later.status,200);
  persisted=await later.json();assert.equal(persisted.version,original.version+2);
  const writes=workspaceUpdateCount,row={...db.prepare('SELECT owner_id,data,version,updated_at FROM workspaces').get()};
  const retry=await post(original.version,action),recovered=await retry.json();
  assert.equal(retry.status,200,JSON.stringify(recovered));
  assert.deepEqual(recovered,persisted,'The recorded request returns the latest saved workspace without losing later work.');
  assert.equal(workspaceUpdateCount,writes,'An exact receipt retry must not issue another workspace UPDATE.');
  assert.deepEqual({...db.prepare('SELECT owner_id,data,version,updated_at FROM workspaces').get()},row,'The exact persisted row is unchanged.');
  assert.deepEqual(await read(),persisted);
  await assertRejectedWithoutWrite(persisted,{...action,command:{...command,patientGoal:'Changed payload after the response was lost.'}},{version:original.version,pattern:/already used|different workflow command/});
  const newCommand=preparation({encounterId:'new-command-with-stale-workspace'});
  await assertRejectedWithoutWrite(persisted,envelope(persisted,'encounters',newCommand),{version:original.version,status:409,pattern:/workspace changed/});
  assert.equal(workspaceUpdateCount,writes,'Neither a mismatched request nor a new stale command may issue an UPDATE.');
});

test('lost-response recovery uses durable receipts after the shared workflow cache evicts the original command',async()=>{
  reset();
  const original=await read(),command=preparation({encounterId:'durable-replay-encounter'}),action=envelope(original,'encounters',command);
  let response=await post(original.version,action);assert.equal(response.status,200);
  let persisted=await response.json();
  for(let index=0;index<50;index++){
    const slice=persisted.data.clinicalWorkflows.slices.encounters;
    const record=slice.state.preparations.find(row=>row.encounterId===command.encounterId);
    const update=preparation({encounterId:command.encounterId,expectedVersion:record.version,reasonForVisit:`Later saved review ${index}.`});
    response=await post(persisted.version,envelope(persisted,'encounters',update));assert.equal(response.status,200);
    persisted=await response.json();
  }
  const slice=persisted.data.clinicalWorkflows.slices.encounters;
  assert.ok(!slice.receipts.some(receipt=>receipt.id===action.requestId));
  assert.ok(slice.state.receipts.some(receipt=>receipt.requestId===action.requestId));
  const writes=workspaceUpdateCount;
  const retry=await post(original.version,action),recovered=await retry.json();
  assert.equal(retry.status,200,JSON.stringify(recovered));
  assert.deepEqual(recovered,persisted,'The unchanged original envelope recovers the latest saved workspace.');
  await assertRejectedWithoutWrite(persisted,{...action,command:{...command,patientGoal:'Different content under the accepted request ID.'}},{version:original.version,pattern:/already used|different|request/i});
  const newCommand=preparation({encounterId:'new-command-after-cache-eviction'});
  const staleNewAction={...envelope(persisted,'encounters',newCommand),expectedSliceVersion:action.expectedSliceVersion};
  await assertRejectedWithoutWrite(persisted,staleNewAction,{version:original.version,status:409,pattern:/workspace changed/});
  await assertRejectedWithoutWrite(persisted,staleNewAction,{pattern:/workflow changed/});
  assert.equal(workspaceUpdateCount,writes,'Durable replay and rejected stale commands must not issue an UPDATE.');
});

test('historical patient and caregiver exports recheck current sharing permissions before receipt replay',async()=>{
  reset();let workspace=await read();const id='TN-DEMO-01',domain='decisions';
  const save=async action=>{
    const response=await post(workspace.version,action),saved=await response.json();
    assert.equal(response.status,200,JSON.stringify(saved));assert.deepEqual(await read(),saved);workspace=saved;
    return workspace.data.clinicalWorkflows.slices.decisions.state;
  };
  const state=()=>workspace.data.clinicalWorkflows.slices.decisions.state;
  const applyConnection=command=>save({type:'demonstration.connection',patientId:id,requestId:crypto.randomUUID(),expectedVersion:workspace.data.demoConnection?.version??0,command});
  const {runScenarios}=await import('./fixtures/decisions-scenarios.mjs');
  await runScenarios({
    patientId:id,now:new Date().toISOString(),state,workspace:()=>workspace.data,
    inputVersion:()=>workflowInputRevision(workspace.data.patients.find(patient=>patient.id===id),workspace.data),
    apply:command=>save(envelope(workspace,domain,command)),
    expectRejected:command=>assertRejectedWithoutWrite(workspace,envelope(workspace,domain,command)),record:()=>{},
  });
  const signed=structuredClone(state().signedSnapshots.find(record=>record.patientId===id));
  assert.ok(signed.carePackage?.instructions||signed.patientPlanSnapshot?.summary,'The selected historical record retains patient instructions.');
  const exportAction=audience=>envelope(workspace,domain,{type:'decisions.export.capture',patientId:id,encounterId:signed.encounterId,signedSnapshotId:signed.id,format:'json',audience,requestId:crypto.randomUUID()});
  await assertRejectedWithoutWrite(workspace,exportAction('proxy'),{pattern:/proxy grant/});
  await applyConnection({operation:'set-proxy',allowed:true,recipient:'Documented caregiver'});
  const proxyAction=exportAction('proxy'),originalProxyVersion=workspace.version;
  await save(proxyAction);
  const proxyCopy=state().exports.find(record=>record.audience==='proxy');
  assert.equal(proxyCopy.recipient,'Documented caregiver');assert.equal(proxyCopy.grantId,workspace.data.demoConnection.patients[id].proxyGrantId);
  assert.deepEqual(proxyCopy.accessScope,['patient-plan']);
  const limited=JSON.parse(proxyCopy.content);
  assert.equal(limited.signedSnapshotId,signed.id);assert.equal(limited.historicalVersion,signed.version);
  assert.equal(limited.plan.instructions,signed.carePackage?.instructions??signed.patientPlanSnapshot.summary);
  assert.deepEqual(Object.keys(limited).sort(),['encounterId','historicalVersion','patientId','patientName','plan','scope','signedAt','signedSnapshotId'].sort());
  assert.ok(!('rationale' in limited));assert.ok(!('reviewedInput' in limited));assert.ok(!('snapshot' in limited));
  await save({type:'plan.save',patientId:id,text:'A later care plan that was not part of the historical decision.',owner:'Care coordinator',followup:new Date(Date.now()+86400000).toISOString().slice(0,10),time:'10:00'});
  const patientAction=exportAction('patient'),originalPatientVersion=workspace.version;
  await save(patientAction);
  const patientCopy=state().exports.find(record=>record.audience==='patient');
  assert.equal(JSON.parse(patientCopy.content).plan.instructions,limited.plan.instructions,'A historical export never substitutes the new current plan.');
  await applyConnection({operation:'set-consent',allowed:false});
  const writes=workspaceUpdateCount;
  await assertRejectedWithoutWrite(workspace,proxyAction,{version:originalProxyVersion,pattern:/sharing permission/});
  await assertRejectedWithoutWrite(workspace,patientAction,{version:originalPatientVersion,pattern:/sharing permission/});
  assert.equal(workspaceUpdateCount,writes,'Revoked sharing blocks accepted-receipt retries before any SQL update.');
  await save(exportAction('internal'));
  assert.deepEqual(JSON.parse(state().exports.find(record=>record.audience==='internal').content).snapshot,signed,'The owner archive retains the selected complete historical snapshot.');
  await applyConnection({operation:'set-consent',allowed:true});await applyConnection({operation:'set-proxy',allowed:false});
  await assertRejectedWithoutWrite(workspace,proxyAction,{version:originalProxyVersion,pattern:/proxy grant/});
  await applyConnection({operation:'set-proxy',allowed:true,recipient:'New designated caregiver'});
  await assertRejectedWithoutWrite(workspace,proxyAction,{version:originalProxyVersion,pattern:/recipient or grant changed/});
  await save(exportAction('patient'));
  await applyConnection({operation:'set-scope',scope:'sharing',allowed:false});
  await assertRejectedWithoutWrite(workspace,exportAction('patient'),{pattern:/sharing permission/});
  const forged=exportAction('internal');
  await assertRejectedWithoutWrite(workspace,{...forged,command:{...forged.command,recipient:'Browser-chosen recipient',accessScope:['all-records']}});
});

test('confirmed numeric observations and corrections update existing patient charts once and retain originals',async()=>{
  reset();
  let workspace=await read();
  const before=structuredClone(workspace.data.patients.find(patient=>patient.id===patientId));
  const otherBefore=structuredClone(workspace.data.patients.find(patient=>patient.id==='TN-1038'));
  const recordedAt=new Date(Date.now()-60_000).toISOString();
  const encounterId='complete-observation-api';
  const command={type:'encounters.observations.save',requestId:crypto.randomUUID(),patientId,encounterId,instrument:'local-0-10',submissionStatus:'confirmed',entries:[
    {metric:'pain',status:'zero',value:0,source:'Synthetic patient report',recordedAt},
    {metric:'function',status:'answered',value:5,source:'Synthetic patient report',recordedAt},
    {metric:'sleep',status:'answered',value:6,source:'Synthetic patient report',recordedAt},
  ]};
  let response=await post(workspace.version,envelope(workspace,'encounters',command));
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  workspace=await response.json();
  let patient=workspace.data.patients.find(item=>item.id===patientId);
  const oldIds=new Set(before.checkins.map(item=>item.id));
  const added=patient.checkins.filter(item=>!oldIds.has(item.id));
  assert.equal(added.length,1);
  assert.deepEqual([added[0].pain,added[0].function,added[0].sleep],[0,5,6]);
  assert.equal(patient.pain.length,before.pain.length+1);
  assert.equal(patient.pain.at(-1),0);
  const record=workspace.data.clinicalWorkflows.slices.encounters.state.observations.find(record=>record.patientId===patientId&&record.encounterId===encounterId);
  const correction={type:'encounters.observations.correct',requestId:crypto.randomUUID(),patientId,encounterId,expectedVersion:record.version,reason:'Patient clarified the pain rating; original zero remains in history.',replacement:{metric:'pain',status:'answered',value:2,source:'Synthetic patient clarification',recordedAt}};
  const correctionEnvelope=envelope(workspace,'encounters',correction);
  response=await post(workspace.version,correctionEnvelope);
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  workspace=await response.json();
  patient=workspace.data.patients.find(item=>item.id===patientId);
  const projected=patient.checkins.filter(item=>!oldIds.has(item.id));
  assert.equal(projected.filter(item=>item.trajectoryIndex!==undefined).length,1,'Only the corrected observation version remains in the chart.');
  assert.equal(patient.checkins.find(item=>item.id===added[0].id).pain,0,'The original source report remains immutable.');
  assert.equal(projected.find(item=>item.supersedes===added[0].id).pain,2);
  assert.equal(patient.pain.length,before.pain.length+1);
  assert.equal(patient.pain.at(-1),2);
  const evidence=patient.workflowObservations.filter(item=>item.workflowRecordId===record.id);
  assert.equal(evidence.length,4);
  assert.ok(evidence.some(item=>item.metric==='pain'&&item.value===0));
  assert.ok(evidence.some(item=>item.metric==='pain'&&item.value===2&&item.correctedFromEntryId));
  assert.deepEqual(workspace.data.patients.find(item=>item.id==='TN-1038'),otherBefore);
  response=await post(workspace.version,correctionEnvelope);
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).data,workspace.data,'Retried corrections cannot add chart points.');
  assert.deepEqual((await read()).data,workspace.data);
});

test('anonymous and cross-origin requests cannot apply workflow commands or create private data',async()=>{
  reset();
  const anonymous=await GET(new Request(url));
  assert.equal(anonymous.status,401);
  assert.equal(db.prepare('SELECT count(*) AS count FROM workspaces').get().count,0);
  const command=preparation();
  const anonymousPost=await post(1,{type:'workflow.apply',domain:'encounters',patientId,requestId:command.requestId,expectedSliceVersion:0,command},{});
  assert.equal(anonymousPost.status,401);
  assert.equal(db.prepare('SELECT count(*) AS count FROM workspaces').get().count,0);
  const workspace=await read();
  const forbidden=await post(workspace.version,envelope(workspace,'encounters',command),headers(),{origin:'https://untrusted.test'});
  assert.equal(forbidden.status,403);
  assert.deepEqual(await read(),workspace);
});

test('legacy empty workflow snapshots migrate without losing existing chart data and can then save real commands',async()=>{
  reset();
  const initial=await read();
  const legacy=structuredClone(initial.data);
  legacy.patients[0].goal='Preserve the existing saved patient goal.';
  delete legacy.clinicalWorkflows;
  db.prepare('UPDATE workspaces SET data = ?').run(JSON.stringify(legacy));
  let workspace=await read();
  assert.equal(workspace.data.patients[0].goal,legacy.patients[0].goal);
  for(const domain of clinicalWorkflowDomains){
    assert.equal(workspace.data.clinicalWorkflows.slices[domain].version,0);
    assert.notDeepEqual(workspace.data.clinicalWorkflows.slices[domain].state,{},`${domain} must have its real typed initial state.`);
  }
  const scaffold=structuredClone(workspace.data);
  for(const domain of clinicalWorkflowDomains)scaffold.clinicalWorkflows.slices[domain].state={};
  db.prepare('UPDATE workspaces SET data = ?').run(JSON.stringify(scaffold));
  workspace=await read();
  assert.equal(workspace.data.patients[0].goal,legacy.patients[0].goal);
  const command=preparation();
  const response=await post(workspace.version,envelope(workspace,'encounters',command));
  assert.equal(response.status,200);
  workspace=await response.json();
  assert.equal(workspace.data.clinicalWorkflows.slices.encounters.state.preparations[0].reasonForVisit,command.reasonForVisit);
  assert.equal(workspace.data.patients[0].goal,legacy.patients[0].goal);
  assert.deepEqual(await read(),workspace);
});

test('malformed saved workflow slices fail reload without resetting or rewriting the stored row',async(t)=>{
  reset();
  const baseline=await read();
  const originalRow=db.prepare('SELECT owner_id,data,version,updated_at FROM workspaces').get();
  const errors=t.mock.method(console,'error',()=>{});
  const corruptions=[
    data=>{data.clinicalWorkflows.slices=[];},
    data=>{delete data.clinicalWorkflows.slices;},
    data=>{data.clinicalWorkflows.slices.encounters.version=1;delete data.clinicalWorkflows.slices.encounters.state;},
  ];
  for(const corrupt of corruptions){
    const damaged=structuredClone(baseline.data);
    corrupt(damaged);
    const serialized=JSON.stringify(damaged);
    db.prepare('UPDATE workspaces SET data = ? WHERE owner_id = ?').run(serialized,originalRow.owner_id);
    try{
      const response=await GET(new Request(url,{headers:headers()}));
      assert.equal(response.status,503,'Saved-state corruption must be reported instead of silently resetting clinical records.');
      assert.match((await response.json()).error,/could not load/);
      assert.deepEqual({...db.prepare('SELECT owner_id,data,version,updated_at FROM workspaces').get()},{...originalRow,data:serialized},'A failed reload must preserve the exact stored row for recovery.');
    }finally{
      db.prepare('UPDATE workspaces SET data = ? WHERE owner_id = ?').run(originalRow.data,originalRow.owner_id);
    }
    assert.deepEqual(await read(),baseline,'Restoring the saved row must recover all records.');
  }
  assert.equal(errors.mock.callCount(),3);
});

function reviewCommand(inputVersion,encounterId,overrides={}){
  const timestamp=new Date(Date.now()-60_000).toISOString();
  return {type:'decisions.review.capture',requestId:crypto.randomUUID(),patientId,encounterId,expectedVersion:0,inputVersion,collectedAt:timestamp,receivedAt:timestamp,provenance:'synthetic',metrics:{pain:{prior:5,current:4},function:{prior:5,current:6},sleep:{prior:5,current:5}},contradictoryMetrics:[],clinicalInterpretation:'Synthetic observation review for an API regression.',goal:'Synthetic patient walking goal.',nextMonitoringQuestion:'Review the next reported walking outcome.',...overrides};
}

test('superseded signed plans are excluded from trusted coordination and decision references',async()=>{
  reset();
  let workspace=await read();
  const apply=async(domain,command)=>{
    const response=await post(workspace.version,envelope(workspace,domain,command));
    const saved=await response.json();
    assert.equal(response.status,200,`${command.type}: ${JSON.stringify(saved)}`);
    workspace=saved;
    assert.deepEqual(await read(),workspace);
    return workspace.data.clinicalWorkflows.slices[domain].state;
  };
  const encounterId='superseded-plan-encounter';
  const base=()=>({requestId:crypto.randomUUID(),patientId,encounterId});
  let encounters=await apply('encounters',{...base(),type:'encounters.assessment.save',presentingProblem:'Synthetic walking review.',painDistributionPhenotype:'',timeline:'',relevantExamination:'',comorbidContext:'',psychologicalContext:'',socialContext:'',workingAssessment:'Clinician documented the current assessment.',alternatives:[],supportingFindings:[],refutingFindings:[],uncertainty:'Review walking progress.',furtherWorkup:'',route:'continue-local',deferReason:''});
  const followUpDate=new Date(Date.now()+7*86_400_000).toISOString().slice(0,10);
  encounters=await apply('encounters',{...base(),type:'encounters.signoff.saveDraft',assessmentRecordId:encounters.assessments.find(record=>record.patientId===patientId&&record.encounterId===encounterId).id,rationale:'Synthetic reviewed plan.',patientFacingPlan:'Original agreed walking instructions.',disposition:{selected:[],rejected:[],deferred:[],noChange:true},owner:'Named clinician',followUp:{date:followUpDate,time:'10:00',timezone:'UTC'},pendingWork:[],teachBack:'Patient restated the instructions.'});
  for(const type of ['encounters.signoff.review','encounters.signoff.sign']){
    const record=encounters.signoffs.at(-1);
    encounters=await apply('encounters',{...base(),type,id:record.id,expectedVersion:record.version,reason:'Reviewed and documented explicitly.'});
  }
  const original=encounters.signoffs.find(record=>record.patientId===patientId&&record.encounterId===encounterId);
  encounters=await apply('encounters',{...base(),type:'encounters.signoff.amend',id:original.id,expectedVersion:original.version,amendmentReason:'Clarify the agreed walking instructions.',patientFacingPlan:'Amended walking instructions reviewed with the patient.'});
  for(const type of ['encounters.signoff.review','encounters.signoff.sign']){
    const record=encounters.signoffs.at(-1);
    encounters=await apply('encounters',{...base(),type,id:record.id,expectedVersion:record.version,reason:'Reviewed and signed the amendment explicitly.'});
  }
  const patient=workspace.data.patients.find(item=>item.id===patientId);
  const oldPlan=patient.carePlans.find(plan=>plan.workflowRecordId===original.id);
  const currentPlan=patient.carePlans.find(plan=>plan.workflowRecordId===encounters.signoffs.at(-1).id);
  assert.equal(currentPlan.supersedes,oldPlan.id);
  assert.ok(!workspaceCarePlans(workspace.data).some(plan=>plan.id===oldPlan.id));
  assert.ok(workspaceCarePlans(workspace.data).some(plan=>plan.id===currentPlan.id));
  const support={...base(),type:'patient-coordination.support.save',conversationDate:new Date().toISOString().slice(0,10),planId:oldPlan.id,planVersion:oldPlan.workflowVersion,goalText:patient.goal,approvedEducation:['Pain plan copy'],reminderChannel:'phone',optedOut:false,dueCheckInDate:followUpDate,originalText:'Patient asked for support with the current plan.',attributedSummary:'Staff documented the request.',summaryAuthor:'Named coordinator',participationMode:'staff-recorded',participant:'patient',recordedSource:'Synthetic staff-recorded contact'};
  await assertRejectedWithoutWrite(workspace,envelope(workspace,'patient-coordination',support),{pattern:/plan/i});
  await apply('patient-coordination',{...support,requestId:crypto.randomUUID(),planId:currentPlan.id,planVersion:currentPlan.workflowVersion});

  // Capture valid current source records first, so the sign-off rejection is
  // specifically the superseded care plan and not a missing prerequisite.
  const decisionEncounter='superseded-plan-decision';
  const decisionBase=()=>({requestId:crypto.randomUUID(),patientId,encounterId:decisionEncounter});
  const inputVersion=workflowInputRevision(workspace.data.patients.find(item=>item.id===patientId),workspace.data);
  let decisions=await apply('decisions',reviewCommand(inputVersion,decisionEncounter));
  const observedReviewId=decisions.observedReviews[0].id;
  const evidence={id:'synthetic-reference',title:'Synthetic workflow reference',locator:'Synthetic acceptance fixture',version:'evidence-1',reviewDate:new Date().toISOString().slice(0,10)};
  decisions=await apply('decisions',{...decisionBase(),type:'decisions.comparison.capture',expectedVersion:0,inputVersion,preferenceSummary:'Patient walking goal.',preferenceWeights:{relief:25,function:50,sleep:15,safety:10},options:[{id:'review-plan',title:'Discuss the existing plan',status:'for-discussion',rationale:'Synthetic discussion option.',applicability:'Requires clinician review.',evidenceRefs:[evidence.id]}],disposition:'defer',rationale:'Document the current clinician review.',safetyReview:'Manual synthetic review.',missingInputs:[],evidenceRefs:[evidence]});
  const comparisonSnapshotId=decisions.comparisonSnapshots[0].id;
  decisions=await apply('decisions',{...decisionBase(),type:'decisions.outputs.capture',expectedVersion:0,inputVersion,pst:{outputId:'pst-reference-test',summary:'Synthetic discussion output.',limitations:['Synthetic fixture.']},shadow:{outputId:'shadow-reference-test',summary:'Synthetic independent discussion output.',limitations:['Synthetic fixture.']},agreement:'partial',limitations:['Synthetic evidence only.'],supportingEvidence:[evidence],conflictingEvidence:[],clarificationRequests:[],clinicianDisposition:'defer',dispositionExplanation:'The clinician deferred further change.',suitability:'unsupported',provenance:'synthetic',modelVersions:['model-1'],configurationVersions:['config-1']});
  decisions=await apply('decisions',{...decisionBase(),type:'decisions.draft.save',expectedInputVersion:inputVersion,summary:'Reviewed synthetic decision summary.',payload:{observedReviewId,comparisonSnapshotId,engineComparisonId:decisions.engineComparisons[0].id,pendingDisposition:'defer'}});
  const draft=decisions.drafts[0];
  const sign={...decisionBase(),type:'decisions.sign.capture',draftId:draft.id,expectedDraftVersion:draft.version,expectedInputVersion:inputVersion,disposition:'defer',rationale:'Clinician documented deferral after review.',patientPlanRef:oldPlan.id,evidenceVersions:['evidence-1'],modelVersions:['model-1'],configurationVersions:['config-1'],displayedSummary:draft.summary};
  await assertRejectedWithoutWrite(workspace,envelope(workspace,'decisions',sign),{pattern:/saved care plan/});
  decisions=await apply('decisions',{...sign,requestId:crypto.randomUUID(),patientPlanRef:currentPlan.id});
  assert.equal(decisions.signedSnapshots[0].patientPlanRef,currentPlan.id);
  assert.equal(decisions.signedSnapshots[0].patientPlanSnapshot.id,currentPlan.id);
});

test('unprojected source workflow changes invalidate decision inputs until the source is reviewed again',async()=>{
  reset();
  let workspace=await read();
  const apply=async(domain,command)=>{
    const response=await post(workspace.version,envelope(workspace,domain,command));
    const saved=await response.json();
    assert.equal(response.status,200,`${command.type}: ${JSON.stringify(saved)}`);
    workspace=saved;
    assert.deepEqual(await read(),workspace);
    return workspace.data.clinicalWorkflows.slices[domain].state;
  };
  const encounterId='source-counter-decision';
  const oldInput=workflowInputRevision(workspace.data.patients.find(item=>item.id===patientId),workspace.data);
  let decisions=await apply('decisions',reviewCommand(oldInput,encounterId));
  const originalObserved=structuredClone(decisions.observedReviews[0]);
  const draftCommand={type:'decisions.draft.save',requestId:crypto.randomUUID(),patientId,encounterId,expectedInputVersion:oldInput,summary:'Saved review before the preparation changed.',payload:{observedReviewId:originalObserved.id,pendingDisposition:'defer'}};
  decisions=await apply('decisions',draftCommand);
  const draft=structuredClone(decisions.drafts[0]);
  const legacyPatient=structuredClone(workspace.data.patients.find(item=>item.id===patientId));
  await apply('encounters',preparation({encounterId:'nonprojected-source-preparation',reasonForVisit:'A new preparation record changes the reviewed source context.'}));
  assert.deepEqual(workspace.data.patients.find(item=>item.id===patientId),legacyPatient,'Preparation does not change legacy projected patient fields.');
  const newInput=workflowInputRevision(workspace.data.patients.find(item=>item.id===patientId),workspace.data);
  assert.notEqual(newInput,oldInput,'The source-domain counter must still change the authoritative revision.');
  const stale={...draftCommand,requestId:crypto.randomUUID(),draftId:draft.id,expectedVersion:draft.version};
  await assertRejectedWithoutWrite(workspace,envelope(workspace,'decisions',stale),{pattern:/Source input version changed/});
  await assertRejectedWithoutWrite(workspace,envelope(workspace,'decisions',{...stale,requestId:crypto.randomUUID(),expectedInputVersion:newInput}),{pattern:/different source input version/});
  decisions=await apply('decisions',reviewCommand(newInput,encounterId,{expectedVersion:originalObserved.version,clinicalInterpretation:'Reviewed again after the new preparation information.'}));
  const latest=decisions.observedReviews[0];
  decisions=await apply('decisions',{...stale,requestId:crypto.randomUUID(),expectedInputVersion:newInput,payload:{observedReviewId:latest.id,pendingDisposition:'defer'},summary:'Saved review after revisiting the new source information.'});
  assert.equal(decisions.drafts[0].expectedInputVersion,newInput);
  assert.deepEqual(decisions.observedReviews.find(item=>item.id===originalObserved.id),originalObserved);
  assert.equal(decisions.drafts[0].version,draft.version+1);
});
