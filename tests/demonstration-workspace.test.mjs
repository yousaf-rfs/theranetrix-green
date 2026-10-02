import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({stdin:{contents:"export {seedWorkspace} from './lib/theranetrix';export {ensureShowcaseData} from './lib/demo-showcase';export {applyAction,actionSchema} from './lib/actions';export {workflowInputRevision} from './lib/clinical-flows';export {PatientCheckin,PatientResponseHistory} from './components/theranetrix/patient-checkin';export {DemoConnectionPanel} from './components/theranetrix/demo-connection';export {PatientStories} from './components/theranetrix/patient-stories';export {previewDemoAccess,isDemoAccessCheckCurrent,requireDemoExportScope} from './lib/demo-connection';export {patientExport} from './lib/patient-export';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false,plugins:[{name:'css-rendering',setup(builder){builder.onLoad({filter:/\.css$/},()=>({contents:'export default {}',loader:'js'}));}}]});
const loaded={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),loaded,loaded.exports);
const {seedWorkspace,ensureShowcaseData,applyAction,actionSchema,workflowInputRevision,PatientCheckin,PatientResponseHistory,DemoConnectionPanel,PatientStories,previewDemoAccess,isDemoAccessCheckCurrent,requireDemoExportScope,patientExport}=loaded.exports;
const now='2026-09-17T16:00:00.000Z',actor='Demonstration owner',patientId='TN-DEMO-01';
const seed=()=>ensureShowcaseData(seedWorkspace(),actor,now);
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const ctx=data=>({data,user:actor,busy:false,save:async()=>true,open:()=>{},signOut:async()=>{}});
const connection=(data,command,at=now)=>applyAction(data,actionSchema.parse({type:'demonstration.connection',patientId,requestId:crypto.randomUUID(),expectedVersion:data.demoConnection?.version??0,command}),actor,at);

test('patient stories are idempotent and resumable with current decision inputs and retained source history',()=>{
  const data=seed();assert.deepEqual(ensureShowcaseData(structuredClone(data),actor,now),data);
  for(const id of data.workflowShowcase.patientIds){
    const patient=data.patients.find(patient=>patient.id===id),slices=data.clinicalWorkflows.slices;
    assert.ok(slices.encounters.state.preparations.some(record=>record.patientId===id&&record.status==='clinician-reviewed'));
    assert.ok(slices.encounters.state.signoffs.some(record=>record.patientId===id&&record.status==='signed'));
    assert.equal(slices.decisions.state.drafts.find(record=>record.patientId===id).expectedInputVersion,workflowInputRevision(patient,data));
    assert.ok(patient.carePlans[0].supersedes);assert.ok(patient.carePlans.some(plan=>plan.id===patient.carePlans[0].supersedes));
  }
  assert.equal(data.clinicalWorkflows.slices['results-referrals'].state.results[0].status,'received');
  assert.equal(data.clinicalWorkflows.slices['patient-coordination'].state.handoffs[0].phase,'locally-saved');
  const governance=data.clinicalWorkflows.slices['program-governance'].state;const release=governance.releases.find(row=>row.title==='Connected care walkthrough');assert.ok(release.unresolvedConditions.length,'Local review does not clear the separate release conditions.');assert.ok(governance.readiness.some(row=>row.decision==='proposed'&&row.scope?.environment==='demo'));assert.ok(!governance.readiness.some(row=>row.decision==='proposed'&&row.scope?.environment==='production'),'local readiness never approves production');
});

test('loading the patient stories retains disabled capabilities and existing edited records',()=>{
  for(const disabled of [['assessments'],['digitalTwin'],['messages'],['assessments','digitalTwin','pst','shadow'],['advisor','messages'],['pathways'],Object.keys(seedWorkspace().features)]){
    const source=seedWorkspace();for(const key of disabled)source.features[key]=false;
    source.patients.find(patient=>patient.id===patientId).goal='A personal goal edited by the owner';
    const features=structuredClone(source.features),data=ensureShowcaseData(source,actor,now);
    assert.deepEqual(data.features,features);assert.equal(data.patients.find(patient=>patient.id===patientId).goal,'A personal goal edited by the owner');
    if(disabled.includes('assessments'))assert.equal(data.clinicalWorkflows.slices.encounters.state.observations.length,0);
    if(disabled.includes('digitalTwin'))assert.equal(data.clinicalWorkflows.slices.decisions.state.drafts.length,0);
  }
});

test('proxy expiry, revoked consent and actor-bound replay are checked by the demonstration service',()=>{
  let data=connection(seed(),{operation:'connect'});data=connection(data,{operation:'set-proxy',allowed:true});
  data=connection(data,{operation:'check-access',role:'proxy'},'2026-09-19T16:00:00.000Z');assert.equal(data.demoConnection.patients[patientId].accessChecks[0].allowed,false);
  data=connection(data,{operation:'set-consent',allowed:false});assert.throws(()=>connection(data,{operation:'set-proxy',allowed:true}),/sharing permission/);
  const action=actionSchema.parse({type:'demonstration.connection',patientId,requestId:'actor-bound-demo',expectedVersion:data.demoConnection.version,command:{operation:'check-access',role:'clinician'}});
  data=applyAction(data,action,actor,now);assert.throws(()=>applyAction(data,action,'Different owner',now),/different action or actor/);
  assert.deepEqual(data.clinicalWorkflows.slices['integration-access'],seed().clinicalWorkflows.slices['integration-access']);
});

test('check-in forms start unanswered in both languages and preserve zero as a deliberate choice',()=>{
  const data=seed(),patient=data.patients.find(patient=>patient.id===patientId);
  for(const lang of ['en','es']){
    const html=render(PatientCheckin,{p:patient,ctx:ctx(data),lang});
    // The four one-tap questions: pain, daily activities, sleep and mood.
    assert.equal((html.match(/<option value="" selected="">/g)??[]).length,4);
    assert.equal((html.match(/<option value="0">0 \/ 10<\/option>/g)??[]).length,4);
    assert.equal((html.match(/<option value="declined">/g)??[]).length,4);
    assert.doesNotMatch(html,/<option value="5" selected/);
    assert.match(html,lang==='en'?/Only the answers you choose/:/Solo se guardarán/);
  }
});

test('a newer encounter plan blocks delivery even when the old plan remains active in its own encounter',()=>{
  let data=connection(seed(),{operation:'connect'});data=connection(data,{operation:'open-chart'});data=connection(data,{operation:'prepare-note'});
  const patient=data.patients.find(patient=>patient.id===patientId),original=structuredClone(patient.carePlans[0]);
  patient.carePlans.unshift({...original,id:'separate-new-encounter-plan',encounterId:'next-encounter',workflowRecordId:'next-record',text:'Latest plan from another encounter.',date:'2026-09-17T16:30:00.000Z',supersedes:undefined});
  assert.throws(()=>connection(data,{operation:'deliver-note'},'2026-09-17T17:00:00.000Z'),/care plan changed/);
  assert.equal(data.demoConnection.patients[patientId].deliveries[0].status,'prepared');
});

test('opening a demonstration chart binds an existing encounter for that patient',()=>{
  let data=connection(seed(),{operation:'connect'});data=connection(data,{operation:'open-chart'});
  assert.equal(data.demoConnection.patients[patientId].chartEncounterId,'review-'+patientId);
  data.clinicalWorkflows.slices.encounters.state.preparations=data.clinicalWorkflows.slices.encounters.state.preparations.filter(record=>record.patientId!==patientId);
  assert.throws(()=>connection(data,{operation:'open-chart'}),/no matching encounter/);
  assert.throws(()=>connection(data,{operation:'prepare-note'}),/Open this patient/);
});

test('patient response history displays skipped answers and the retained note',()=>{
  let data=seed();const id='patient-self-report-ui',command={type:'encounters.observations.save',requestId:id,patientId,encounterId:id,instrument:'local-0-10',submissionStatus:'confirmed',submissionSource:'patient-self-report',patientNote:'Ask about the next appointment.',entries:[{metric:'pain',status:'zero',value:0},{metric:'function',status:'declined'},{metric:'sleep',status:'unanswered'}].map(entry=>({...entry,source:'Patient self-report',recordedAt:now}))};
  data=applyAction(data,{type:'workflow.apply',domain:'encounters',patientId,requestId:id,expectedSliceVersion:data.clinicalWorkflows.slices.encounters.version,command},actor,now);
  const html=render(PatientResponseHistory,{p:data.patients.find(patient=>patient.id===patientId),ctx:ctx(data)});
  assert.match(html,/Pain: 0\/10/);assert.match(html,/Daily activities: Prefer not to answer/);assert.match(html,/Sleep quality: Not answered/);assert.match(html,/Ask about the next appointment/);
});

test('demonstration screens show usable stories, local delivery status and explicit patient context',()=>{
  let data=seed();
  const stories=render(PatientStories,{workspace:data,busy:false});
 for(const name of ['Emma Carter','Lucas Hayes','Priya Raman'])assert.ok(stories.includes(name),name+' remains available in the optional sample journeys.');
 assert.match(stories,/<details class="sample-journeys">/,'Sample journeys start collapsed.');
 assert.ok(stories.includes('Sample patient journeys'));
 for(const id of ['TN-DEMO-01','TN-DEMO-02','TN-DEMO-03'])assert.ok(stories.includes('href="/patients/'+id+'?tab=visit"'),'Each sample retains its chart link.');
 assert.ok(stories.includes('href="/patient-companion?patient=TN-DEMO-03"'),'The connected-care sample still opens the correct companion.');
 assert.match(render(PatientStories,{workspace:data,busy:false,expanded:true}),/<details class="sample-journeys" open="">/,'A dashboard profile can expand sample journeys.');
  const wrong=render(DemoConnectionPanel,{workspace:data,patientId:'TN-1042',busy:false,onAction:async()=>true});assert.match(wrong,/Choose a patient story/);assert.doesNotMatch(wrong,/Open chart<\/button>/);
  for(const command of [{operation:'connect'},{operation:'open-chart'},{operation:'prepare-note'},{operation:'simulate-delivery-failure'},{operation:'retry-delivery'}])data=connection(data,command);
  const html=render(DemoConnectionPanel,{workspace:data,patientId,busy:false,onAction:async()=>true});assert.match(html,/Received by demo inbox/);assert.match(html,/2 delivery attempts/);assert.match(html,/Connection mode applies to every patient story in this workspace/);assert.match(html,/Consent and sharing choices below apply only to Emma Carter/);assert.doesNotMatch(html.replace(/<[^>]*>/g,''),/synthetic/i);
});

test('permission scopes stay independent and saved access verdicts expire when permissions change',()=>{
  let data=connection(seed(),{operation:'connect'});
  data=connection(data,{operation:'check-access',role:'clinician',action:'read-chart'});
  const check=data.demoConnection.patients[patientId].accessChecks[0];
  assert.equal(isDemoAccessCheckCurrent(check,data.demoConnection,patientId,'clinician','read-chart',now),true);
  data=connection(data,{operation:'set-consent',allowed:false});
  assert.equal(isDemoAccessCheckCurrent(check,data.demoConnection,patientId,'clinician','read-chart',now),false);
  const staleHtml=render(DemoConnectionPanel,{workspace:data,patientId,busy:false,onAction:async()=>true});
  assert.match(staleHtml,/Check access again/);assert.doesNotMatch(staleHtml,/>Access allowed</);
  data=connection(data,{operation:'set-consent',allowed:true});
  data=connection(data,{operation:'set-scope',scope:'messaging',allowed:false});
  data=connection(data,{operation:'set-scope',scope:'care-participation',allowed:false});
  const preview=(role,action)=>previewDemoAccess(data.demoConnection,patientId,role,action,now);
  assert.equal(preview('patient','send-message').allowed,false);assert.equal(preview('patient','submit-checkin').allowed,false);
  assert.equal(preview('patient','read-plan').allowed,true);assert.equal(preview('clinician','read-chart').allowed,true);
  assert.equal(preview('coordinator','edit-record').allowed,false);assert.equal(preview('coordinator','share-plan').allowed,true);
  assert.equal(preview('patient','read-chart').allowed,false);
  assert.equal(data.demoConnection.patients[patientId].scopeHistory.length,2);
  assert.ok(data.demoConnection.patients[patientId].scopeHistory.every(row=>row.actor===actor&&row.at===now));
});

test('proxy copies are patient-scoped, time-limited and invalidated by sharing revocation',()=>{
  let data=connection(seed(),{operation:'connect'});
  assert.throws(()=>requireDemoExportScope(data,patientId,'proxy',now),/proxy grant/);
  data=connection(data,{operation:'set-proxy',allowed:true,recipient:'Alex Caregiver'});
  data=connection(data,{operation:'check-access',role:'proxy',action:'read-plan'});
  const check=data.demoConnection.patients[patientId].accessChecks[0],grant=requireDemoExportScope(data,patientId,'proxy',now);
  assert.equal(grant.recipient,'Alex Caregiver');assert.ok(grant.grantId);
  assert.throws(()=>requireDemoExportScope(data,'TN-DEMO-02','proxy',now),/proxy grant/);
  const expired='2026-09-18T16:00:00.000Z';
  assert.equal(isDemoAccessCheckCurrent(check,data.demoConnection,patientId,'proxy','read-plan',expired),false);
  assert.throws(()=>requireDemoExportScope(data,patientId,'proxy',expired),/proxy grant/);
  const damaged=structuredClone(data);damaged.demoConnection.patients[patientId].proxyUntil='not-a-time';
  assert.throws(()=>requireDemoExportScope(damaged,patientId,'proxy',now),/proxy grant/,'An unreadable saved expiry must fail closed.');
  data=connection(data,{operation:'set-scope',scope:'sharing',allowed:false});
  assert.throws(()=>requireDemoExportScope(data,patientId,'proxy',now),/sharing permission/);
  assert.throws(()=>requireDemoExportScope(data,patientId,'patient',now),/sharing permission/);
  assert.equal(requireDemoExportScope(data,patientId,'internal',now).audience,'internal');
  assert.equal(data.demoConnection.patients[patientId].accessChecks[0].allowed,true,'The original check remains historical evidence.');
});

test('patient and proxy export projections exclude nested internal content and retain the current plan',()=>{
  let data=connection(seed(),{operation:'connect'});data=connection(data,{operation:'set-proxy',allowed:true});
  const patient=data.patients.find(patient=>patient.id===patientId),secret='INTERNAL-NOTE-NOT-FOR-PATIENT';
  patient.notes.unshift({id:'sensitive-note',date:now,author:actor,text:secret,type:'Internal note'});
  patient.carePlans[0].internalExtra=secret;
  data.messages.push({id:'private-conversation',patientId,date:now,sender:actor,direction:'out',text:secret});
  data.advisorTurns??=[];data.advisorTurns.push({patientId,text:secret});
  for(const audience of ['patient','proxy']){
    const projected=patientExport(patient,data,now,audience),text=JSON.stringify(projected);
    assert.doesNotMatch(text,/INTERNAL-NOTE-NOT-FOR-PATIENT/);
    assert.equal(projected.plan.id,patient.carePlans[0].id);assert.equal(projected.plan.text,patient.carePlans[0].text);
    assert.deepEqual(Object.keys(projected.patient).sort(),['id','name']);
    assert.equal(projected.messages,undefined);assert.equal(projected.advisorTurns,undefined);assert.equal(projected.patient.notes,undefined);
  }
  assert.match(JSON.stringify(patientExport(patient,data,now,'internal')),/INTERNAL-NOTE-NOT-FOR-PATIENT/);
});

test('offline and read-only modes preserve saved reports and reject prohibited new work and replays',()=>{
  let data=connection(seed(),{operation:'connect'});data=connection(data,{operation:'open-chart'});
  const importAction=actionSchema.parse({type:'demonstration.connection',patientId,requestId:'permission-checked-import',expectedVersion:data.demoConnection.version,command:{operation:'import-readings'}});
  data=applyAction(data,importAction,actor,now);const patientBefore=structuredClone(data.patients.find(patient=>patient.id===patientId));
  data=connection(data,{operation:'set-source-mode',mode:'offline'});
  assert.throws(()=>connection(data,{operation:'retry-import'}),/offline/);
  assert.throws(()=>applyAction(data,importAction,actor,now),/offline/);
  assert.deepEqual(data.patients.find(patient=>patient.id===patientId),patientBefore);
  assert.ok(data.demoConnection.recovery.owner);
  const offlineHtml=render(DemoConnectionPanel,{workspace:data,patientId,busy:false,onAction:async()=>true});assert.match(offlineHtml,/Previously received records remain available/);
  data=connection(data,{operation:'set-source-mode',mode:'read-only'});
  data=connection(data,{operation:'retry-import'});data=connection(data,{operation:'prepare-note'});
  assert.throws(()=>connection(data,{operation:'queue-delivery'}),/read access only/);
  data=connection(data,{operation:'set-scope',scope:'data-use',allowed:false});
  assert.throws(()=>applyAction(data,importAction,actor,now),/Data use permission/);
  assert.deepEqual(data.patients.find(patient=>patient.id===patientId),patientBefore);
});

test('reconnection replays stable source events without duplicate observations or repeated quarantine items',()=>{
  let data=connection(JSON.parse(JSON.stringify(seed())),{operation:'connect'});data=connection(data,{operation:'open-chart'});data=connection(data,{operation:'import-readings'});
  const baseline=data.patients.find(patient=>patient.id===patientId).pain.length,live=structuredClone(data.clinicalWorkflows.slices['integration-access']),neighbor=structuredClone(data.patients.find(patient=>patient.id==='TN-DEMO-02'));
  data=connection(data,{operation:'set-source-mode',mode:'offline'});data=connection(data,{operation:'set-source-mode',mode:'online'});
  data=connection(data,{operation:'replay-imports',scenario:'reconnection'});data=JSON.parse(JSON.stringify(data));
  assert.equal(data.patients.find(patient=>patient.id===patientId).pain.length,baseline+1);assert.equal(data.demoConnection.patients[patientId].replayCursor,'reconnection-1');
  const imports=data.demoConnection.patients[patientId].imports.length;
  data=connection(data,{operation:'replay-imports',scenario:'reconnection'},'2026-09-17T17:00:00.000Z');
  assert.equal(data.patients.find(patient=>patient.id===patientId).pain.length,baseline+1);assert.equal(data.demoConnection.patients[patientId].imports.length,imports);
  data=connection(data,{operation:'replay-imports',scenario:'changed-duplicate'});const held=data.demoConnection.patients[patientId].imports.find(record=>record.reason.includes('reused'));
  assert.equal(held.status,'quarantined');assert.ok(held.owner);assert.equal(held.observationId,undefined);
  const heldCount=data.demoConnection.patients[patientId].imports.length;
  data=connection(data,{operation:'replay-imports',scenario:'changed-duplicate'});assert.equal(data.demoConnection.patients[patientId].imports.length,heldCount);
  data=connection(data,{operation:'replay-imports',scenario:'invalid-unit'});assert.equal(data.demoConnection.patients[patientId].imports.at(-1).status,'quarantined');
  data=connection(data,{operation:'replay-imports',scenario:'late'});assert.equal(data.patients.find(patient=>patient.id===patientId).pain.length,baseline+2);
  assert.deepEqual(data.clinicalWorkflows.slices['integration-access'],live);assert.deepEqual(data.patients.find(patient=>patient.id==='TN-DEMO-02'),neighbor);
});

test('partial inbox receipts retain received parts and retry only missing items after reload',()=>{
  let data=connection(seed(),{operation:'connect'});data=connection(data,{operation:'open-chart'});data=connection(data,{operation:'prepare-note'});
  data=connection(data,{operation:'queue-delivery'});
  assert.equal(data.demoConnection.patients[patientId].deliveries[0].status,'pending');assert.equal(data.demoConnection.patients[patientId].deliveries[0].receipt,undefined);
  data=connection(data,{operation:'receive-delivery',outcome:'partial'});data=JSON.parse(JSON.stringify(data));
  const partial=data.demoConnection.patients[patientId].deliveries[0],received=structuredClone(partial.parts[0]);
  assert.equal(partial.status,'partial');assert.ok(partial.owner);assert.equal(partial.parts[1].status,'failed');
  assert.match(render(DemoConnectionPanel,{workspace:data,patientId,busy:false,onAction:async()=>true}),/Partially received by demo inbox/);
  data=connection(data,{operation:'retry-delivery',waitForReceipt:true});assert.deepEqual(data.demoConnection.patients[patientId].deliveries[0].parts[0],received);
  data=connection(data,{operation:'receive-delivery',outcome:'complete'});
  const complete=data.demoConnection.patients[patientId].deliveries[0];assert.equal(complete.status,'received');assert.equal(complete.parts[0].attempts,1);assert.equal(complete.parts[1].attempts,2);assert.equal(complete.attemptHistory.length,4);
  assert.deepEqual(data.demoConnection.patients[patientId].deliveries[0].parts[0],received);
  const before=structuredClone(data);data=connection(data,{operation:'receive-delivery',outcome:'complete'});assert.deepEqual(data,before,'Repeated local receipts do not duplicate a delivery or audit.');
  assert.throws(()=>connection(data,{operation:'prepare-note'}),/already prepared/);assert.throws(()=>connection(data,{operation:'queue-delivery'}),/already received/);
});

test('late receipts retain the original delivery snapshot after the care plan changes',()=>{
  let data=connection(seed(),{operation:'connect'});data=connection(data,{operation:'open-chart'});data=connection(data,{operation:'prepare-note'});data=connection(data,{operation:'queue-delivery'});
  const original=structuredClone(data.demoConnection.patients[patientId].deliveries[0]);
  const patient=data.patients.find(patient=>patient.id===patientId),plan=patient.carePlans[0];
  patient.carePlans.unshift({...plan,id:'amended-plan-demo',text:'Updated patient instructions.',date:'2026-09-17T16:30:00.000Z',workflowVersion:plan.workflowVersion+1,supersedes:plan.id});
  data=connection(data,{operation:'prepare-note'},'2026-09-17T17:00:00.000Z');
  data=connection(data,{operation:'receive-delivery',deliveryId:original.id,outcome:'complete'},'2026-09-17T17:01:00.000Z');
  const deliveries=data.demoConnection.patients[patientId].deliveries;
  assert.equal(deliveries[0].status,'prepared');assert.equal(deliveries[0].supersedesDeliveryId,original.id);
  assert.equal(deliveries[1].status,'received');assert.equal(deliveries[1].text,original.text);assert.equal(deliveries[1].planVersion,original.planVersion);
});
