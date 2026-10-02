import assert from 'node:assert/strict';

/** Exercises the real shared-owner boundary. Provider identity is deliberately unavailable. */
export async function runScenarios(driver){
  let sequence=0;
  const suffix=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  const action=(verb,fields={})=>({type:`integration-access.${verb}`,requestId:`integration-qa-${suffix}-${++sequence}`,expectedVersion:driver.state().version,...fields});
  const sourceId=`qa-source-${suffix}`;
  const draftSource={sourceId,label:'Demonstration hospital connection draft',freshUntil:'2099-01-01T00:00:00.000Z',enabled:false,adapterMode:'unconfigured'};
  const sourceCommand=action('source.save',{source:draftSource});
  let state=await driver.apply(sourceCommand);
  assert.equal(state.sourceConfigs[sourceId].adapterMode,'unconfigured');
  assert.equal(state.sourceConfigs[sourceId].enabled,false);
  assert.equal(state.adapter.mode,'unconfigured');
  const afterSave=structuredClone(state);
  state=await driver.apply(sourceCommand);
  assert.deepEqual(state,afterSave,'Exact source draft retries are idempotent across persisted reloads.');
  await driver.expectRejected(action('source.save',{source:{...draftSource,enabled:true,adapterMode:'configured'}}));
  await driver.expectRejected(action('launch.validate',{context:{patientId:driver.patientId,encounterId:'ENC-qa',organizationId:'ORG-ALPHA',principalId:'claimed-clinician'}}));
  assert.equal(driver.state().launch.status,'not-validated');
  driver.record('J19','external-blocked');

  const acceptedCount=driver.state().acceptedEvents.length;
  const bridgeCount=driver.state().bridgeObservations.length;
  const event={sourceId,eventId:`qa-event-${suffix}`,patientId:driver.patientId,organizationId:'ORG-ALPHA',metric:'pain',value:5,unit:'score-0-10',observedAt:driver.now,receivedAt:driver.now,provenance:'ehr'};
  await driver.expectRejected(action('event.ingest',{envelope:event}));
  await driver.expectRejected({...action('event.ingest',{envelope:event}),actor:{kind:'server-adapter',verified:true,id:'browser-claim',organizationId:'ORG-ALPHA'}});
  assert.equal(driver.state().acceptedEvents.length,acceptedCount);
  assert.equal(driver.state().bridgeObservations.length,bridgeCount);
  driver.record('J12','external-blocked');

  const activePolicy=structuredClone(driver.state().policy);
  const permissions=activePolicy.permissions.filter(item=>!(item.role==='workspace-owner'&&item.action==='records.read'));
  permissions.push({role:'workspace-owner',action:'records.read',allow:true});
  const policyDraft={...activePolicy,version:activePolicy.version+1,permissions};
  state=await driver.apply(action('policy.draft',{policy:policyDraft}));
  assert.deepEqual(state.policy,activePolicy,'Editing an evaluation policy draft does not grant clinical permissions.');
  assert.equal(state.policyDraft.version,activePolicy.version+1);
  await driver.expectRejected(action('policy.replace',{policy:policyDraft}));
  await driver.expectRejected({...action('policy.replace',{policy:policyDraft}),principal:{id:'claimed-clinician',verifiedServerIdentity:true}});
  const outboxBefore=structuredClone(driver.state().outbox);
  state=await driver.apply(action('outbox.manual-evidence',{patientId:driver.patientId,note:'Demonstration manual report: receiving office was called. Provider delivery remains unverified.'}));
  assert.equal(state.externalEvidence[0].kind,'manual-report');
  assert.equal(state.externalEvidence[0].patientId,driver.patientId);
  assert.deepEqual(state.outbox,outboxBefore,'A manual report never creates or acknowledges an outbox record.');
  await driver.expectRejected(action('outbox.prepare',{patientId:driver.patientId,sourceId,encounterId:'ENC-qa',noteId:'qa-note',payloadDigest:'browser-claim',expectedPolicyVersion:activePolicy.version}));
  await driver.expectRejected(action('outbox.acknowledge',{outboxId:'invented-outbox'}));
  await driver.expectRejected(action('outbox.manual-evidence',{patientId:'TN-UNKNOWN',note:'Must be rejected for an unknown patient.'}));
  const prior=action('outbox.manual-evidence',{patientId:driver.patientId,note:'Demonstration version conflict test.'});
  await driver.apply(action('outbox.manual-evidence',{patientId:driver.patientId,note:'Demonstration newer report.'}));
  await driver.expectRejected(prior);
  assert.deepEqual(driver.state().policy,activePolicy);
  assert.deepEqual(driver.state().outbox,outboxBefore);
  driver.record('J21','external-blocked');
}

/** Fresh curated workspace. The API driver persists and reloads every accepted command. */
export async function runDemoConnectionScenarios(driver){
  const patientId=driver.patientId??'TN-DEMO-01';
  const patient=()=>driver.workspace().patients.find(item=>item.id===patientId);
  const connection=()=>driver.workspace().demoConnection;
  const local=()=>connection().patients[patientId];
  const apply=command=>driver.applyConnection(command);
  const reject=command=>driver.expectConnectionRejected(command);
  const live=structuredClone(driver.workspace().clinicalWorkflows.slices['integration-access']);
  const other=structuredClone(driver.workspace().patients.filter(item=>item.id!==patientId));
  const initialCount=patient().pain.length;
  await apply({operation:'connect'});await apply({operation:'open-chart'});await apply({operation:'import-readings'});
  assert.equal(patient().pain.length,initialCount+1);
  await apply({operation:'set-scope',scope:'data-use',allowed:false});
  await reject({operation:'retry-import'});
  await apply({operation:'set-scope',scope:'data-use',allowed:true});
  await apply({operation:'set-source-mode',mode:'offline'});
  await reject({operation:'retry-import'});
  assert.equal(patient().pain.length,initialCount+1);
  assert.ok(connection().recovery.owner);
  await apply({operation:'set-source-mode',mode:'read-only'});
  await apply({operation:'retry-import'});await apply({operation:'prepare-note'});
  await reject({operation:'queue-delivery'});
  await apply({operation:'set-source-mode',mode:'online'});
  await apply({operation:'replay-imports',scenario:'reconnection'});
  const importCount=local().imports.length;
  await apply({operation:'replay-imports',scenario:'reconnection'});
  assert.equal(patient().pain.length,initialCount+2);assert.equal(local().imports.length,importCount);
  await apply({operation:'replay-imports',scenario:'changed-duplicate'});
  assert.ok(local().imports.some(record=>record.status==='quarantined'&&record.reason.includes('reused')&&record.owner));
  await apply({operation:'queue-delivery'});assert.equal(local().deliveries[0].status,'pending');
  await apply({operation:'receive-delivery',outcome:'partial'});
  const received=structuredClone(local().deliveries[0].parts[0]);assert.equal(local().deliveries[0].status,'partial');
  await apply({operation:'retry-delivery',waitForReceipt:true});
  assert.deepEqual(local().deliveries[0].parts[0],received);
  await apply({operation:'receive-delivery',outcome:'complete'});
  assert.equal(local().deliveries[0].status,'received');assert.deepEqual(local().deliveries[0].parts.map(part=>part.attempts),[1,2]);
  await reject({operation:'queue-delivery'});
  await apply({operation:'check-access',role:'coordinator',action:'edit-record'});assert.equal(local().accessChecks[0].allowed,false);
  await apply({operation:'set-proxy',allowed:true,recipient:'Case caregiver'});
  await apply({operation:'check-access',role:'proxy',action:'read-plan'});assert.equal(local().accessChecks[0].allowed,true);
  await apply({operation:'set-scope',scope:'sharing',allowed:false});
  await apply({operation:'check-access',role:'proxy',action:'read-plan'});assert.equal(local().accessChecks[0].allowed,false);
  await reject({operation:'prepare-note'});
  assert.equal(local().scopes.messaging,true);assert.equal(local().scopes['care-participation'],true);
  assert.deepEqual(driver.workspace().clinicalWorkflows.slices['integration-access'],live,'Local receipt scenarios never enable provider attestations.');
  assert.deepEqual(driver.workspace().patients.filter(item=>item.id!==patientId),other,'The selected story does not modify other charts.');
  return {acceptedReports:local().imports.filter(record=>record.status==='accepted').length,receivedParts:local().deliveries[0].parts.filter(part=>part.status==='received').length};
}
