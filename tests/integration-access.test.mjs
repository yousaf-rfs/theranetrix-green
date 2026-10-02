import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

const bundle=await build({stdin:{contents:"export * from './lib/clinical-flows/integration-access';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {initialState,reduce,authorize,validateState,inspectState,normalizeState,getSummary,actionSchema}=mod.exports;
const root=fileURLToPath(new URL('..',import.meta.url));
const vite=await createServer({appType:'custom',configFile:false,root,resolve:{alias:{'@':root}},server:{middlewareMode:true}});
after(async()=>{await vite.close();});

const now='2026-09-17T12:00:00.000Z';
const patients=[{id:'TN-DEMO-01',name:'Synthetic Alpha'},{id:'TN-DEMO-02',name:'Synthetic Beta'},{id:'TN-DEMO-03',name:'Synthetic Other Tenant'}];
const ownerContext={actor:'Workspace Owner',now,patients,features:{}};
let sequence=0;
function principal(overrides={}){
  return {id:'clinician-1',name:'Clinician One',organizationId:'ORG-ALPHA',role:'clinician',verifiedServerIdentity:true,
    relationships:[{patientId:'TN-DEMO-01',kind:'care-team',organizationId:'ORG-ALPHA'}],
    consents:['read','write','export','integration'].map(scope=>({patientId:'TN-DEMO-01',scope,granted:true,grantedAt:'2026-09-01T00:00:00.000Z'})),...overrides};
}
const admin=()=>principal({id:'admin-1',role:'integration-admin',relationships:[],consents:[]});
function trustedContext(who=principal(),extras={}){
  return {...ownerContext,actor:who.id,integrationAccess:{actorKind:'server',organizationId:who.organizationId,verified:true,principal:who,trustedSourceIds:['ehr-primary'],trustedAdapterId:'adapter-main',...extras}};
}
function adapterContext(extras={},who=principal()){
  return {...trustedContext(who,{actorKind:'server-adapter',...extras}),actor:'adapter-main'};
}
function seeded(){
  const state=initialState();
  state.policy.patientOrganizations={'TN-DEMO-01':'ORG-ALPHA','TN-DEMO-02':'ORG-ALPHA','TN-DEMO-03':'ORG-BETA'};
  return state;
}
function command(state,type,fields={},requestId=`req-${++sequence}`){return {type:`integration-access.${type}`,requestId,expectedVersion:state.version,...fields};}
function apply(state,type,fields={},context=ownerContext){return reduce(state,command(state,type,fields),context);}
function configured(){
  return apply(seeded(),'source.save',{source:{sourceId:'ehr-primary',label:'Primary EHR',freshUntil:'2027-01-01T00:00:00.000Z',enabled:true,adapterMode:'configured'}},trustedContext(admin()));
}
function envelope(overrides={}){
  return {sourceId:'ehr-primary',eventId:`event-${++sequence}`,patientId:'TN-DEMO-01',organizationId:'ORG-ALPHA',metric:'pain',value:5,unit:'score-0-10',observedAt:'2026-09-17T10:00:00.000Z',receivedAt:'2026-09-17T10:05:00.000Z',provenance:'ehr',...overrides};
}
function ingest(state,event){return apply(state,'event.ingest',{envelope:event},adapterContext());}
function prepare(state,noteId='note-1',ctx=trustedContext()){
  const note={noteId,patientId:'TN-DEMO-01',encounterId:'ENC-101',payloadDigest:'sha256-synthetic-'+noteId,savedAt:'2026-09-17T11:00:00.000Z',savedBy:'clinician-1'};
  return apply(state,'outbox.prepare',{patientId:note.patientId,sourceId:'ehr-primary',encounterId:note.encounterId,noteId:note.noteId,payloadDigest:note.payloadDigest,expectedPolicyVersion:state.policy.version},{...ctx,integrationAccess:{...ctx.integrationAccess,savedNote:note}});
}
function attempted(){
  let state=prepare(configured());
  const outboxId=state.outbox[0].id;
  state=apply(state,'outbox.pending',{outboxId},trustedContext());
  return apply(state,'outbox.attempt',{outboxId},adapterContext());
}
function receiptFor(state,overrides={}){
  const row=state.outbox[0];
  return {outboxId:row.id,attemptId:row.attemptId,adapterId:'adapter-main',providerMessageId:`provider-${++sequence}`,status:'acknowledged',...overrides};
}

test('default state denies clinical privileges and normalization rejects malformed persisted data',()=>{
  const state=initialState();
  assert.equal(state.policy.sharedOwnerEvaluation,true);
  assert.deepEqual(state.policy.patientOrganizations,{});
  assert.notStrictEqual(initialState(),initialState());
  assert.deepEqual(normalizeState(undefined),initialState());
  assert.equal(inspectState(state).ok,true);
  for(const malformed of [null,{},[],{...state,outbox:null},{...state,policy:{...state.policy,sharedOwnerEvaluation:false}}]){
    assert.equal(inspectState(malformed).ok,false);
    assert.throws(()=>validateState(malformed));
  }
  assert.equal(authorize(null,'records.read','TN-DEMO-01',state.policy,now).allowed,false);
  assert.equal(authorize(principal(),'records.read','TN-DEMO-01',null,now).allowed,false);
  assert.equal(authorize(principal(),'records.read','TN-DEMO-01',seeded().policy,'not-a-time').allowed,false);
});

test('shared owner can save separate drafts and manual reports without asserting live connectivity',()=>{
  let state=initialState();
  const original=structuredClone(state);
  state=apply(state,'source.save',{source:{sourceId:'ehr-new',label:'Hospital EHR',freshUntil:'2027-01-01T00:00:00Z',enabled:false,adapterMode:'unconfigured'}});
  assert.deepEqual(original,initialState());
  assert.equal(state.sourceConfigs['ehr-new'].freshUntil,'2027-01-01T00:00:00.000Z');
  assert.equal(getSummary(state,now).connectedSources,0);
  const active=structuredClone(state.policy);
  const draft={...state.policy,version:state.policy.version+1,permissions:[{role:'workspace-owner',action:'records.read',allow:true}]};
  state=apply(state,'policy.draft',{policy:draft});
  assert.deepEqual(state.policy,active);
  assert.deepEqual(state.policyDraft,draft);
  state=apply(state,'outbox.manual-evidence',{patientId:'TN-DEMO-01',note:'External coordinator reports a phone call. This is unverified.'});
  assert.equal(state.externalEvidence[0].kind,'manual-report');
  assert.equal(state.externalEvidence[0].reporter,ownerContext.actor);
  assert.equal(state.outbox.length,0);
  assert.equal(state.launch.status,'not-validated');
  assert.equal(state.acceptedEvents.length,0);
  assert.equal(inspectState(state).ok,true);
});

test('browser actor, role, clock, and receipt claims are rejected by strict action schemas',()=>{
  const state=initialState();
  const source=command(state,'source.save',{source:{sourceId:'ehr-primary',label:'EHR',freshUntil:'2027-01-01T00:00:00Z',enabled:false,adapterMode:'unconfigured'}});
  for(const injected of [{actor:{kind:'server',verified:true}},{principal:principal()},{serverNow:now},{integrationAccess:{verified:true}},{adapterContext:{status:'acknowledged'}}]){
    assert.equal(actionSchema.safeParse({...source,...injected}).success,false);
    assert.throws(()=>reduce(state,{...source,...injected},ownerContext));
  }
  assert.throws(()=>reduce(state,source,undefined));
  assert.throws(()=>apply(state,'source.save',{source:{...source.source,enabled:true,adapterMode:'configured'}}),/trusted server/i);
  assert.throws(()=>apply(state,'policy.replace',{policy:{...state.policy,version:2}}),/trusted server/i);
  assert.throws(()=>apply(state,'outbox.manual-evidence',{patientId:'TN-FOREIGN',note:'Not in this workspace.'}),/outside the current workspace/i);
});

test('authorization denies forged principals, cross-tenant and cross-patient access, and administrator clinical access',()=>{
  const policy=seeded().policy;
  assert.equal(authorize(principal({verifiedServerIdentity:false}),'records.read','TN-DEMO-01',policy,now).allowed,false);
  assert.equal(authorize(principal({organizationId:'ORG-BETA'}),'records.read','TN-DEMO-01',policy,now).allowed,false);
  assert.equal(authorize(principal(),'records.write','TN-DEMO-02',policy,now).allowed,false);
  assert.equal(authorize(principal(),'records.read','unknown',policy,now).allowed,false);
  assert.equal(authorize(principal(),'records.export','TN-DEMO-01',policy,now).allowed,true);
  const weakened={...policy,permissions:[{role:'workspace-owner',action:'records.read',allow:true},{role:'clinician',action:'records.write',allow:true}]};
  assert.equal(authorize(principal({role:'workspace-owner'}),'records.read','TN-DEMO-01',weakened,now).allowed,false);
  assert.equal(authorize(principal({relationships:[],consents:[]}),'records.write','TN-DEMO-01',weakened,now).allowed,false);
  const duplicates={...policy,permissions:[...policy.permissions,{role:'clinician',action:'records.read',allow:true}]};
  assert.equal(authorize(principal(),'records.read','TN-DEMO-01',duplicates,now).allowed,false);
});

test('authorization honors timezone offsets, expiry boundaries, future grants and later consent revocation',()=>{
  const policy=seeded().policy;
  const expiresNow=principal({relationships:[{patientId:'TN-DEMO-01',kind:'care-team',organizationId:'ORG-ALPHA',expiresAt:'2026-09-17T14:00:00+02:00'}]});
  assert.equal(authorize(expiresNow,'records.read','TN-DEMO-01',policy,now).allowed,false);
  const futureConsent=principal({consents:[{patientId:'TN-DEMO-01',scope:'read',granted:true,grantedAt:'2026-09-17T13:00:00Z'}]});
  assert.equal(authorize(futureConsent,'records.read','TN-DEMO-01',policy,now).allowed,false);
  const latestRevoked=principal();
  latestRevoked.consents.push({patientId:'TN-DEMO-01',scope:'read',granted:false,grantedAt:'2026-09-17T11:00:00Z'});
  assert.equal(authorize(latestRevoked,'records.read','TN-DEMO-01',policy,now).allowed,false);
  const proxy=principal({role:'proxy',relationships:[{patientId:'TN-DEMO-01',kind:'proxy',organizationId:'ORG-ALPHA'},{patientId:'TN-DEMO-01',kind:'proxy',organizationId:'ORG-ALPHA',revokedAt:'2026-09-16T20:00:00Z'}]});
  assert.equal(authorize(proxy,'records.read','TN-DEMO-01',policy,now).allowed,false);
  const expiredLatest=principal();
  expiredLatest.consents.push({patientId:'TN-DEMO-01',scope:'read',granted:true,grantedAt:'2026-09-16T00:00:00Z',expiresAt:'2026-09-17T12:00:00Z'});
  assert.equal(authorize(expiredLatest,'records.read','TN-DEMO-01',policy,now).allowed,false);
});

test('validated launch is bound to server-attested principal, patient, encounter and organization',()=>{
  const requested={patientId:'TN-DEMO-01',encounterId:'ENC-100',organizationId:'ORG-ALPHA',principalId:'clinician-1'};
  assert.throws(()=>apply(seeded(),'launch.validate',{context:requested}),/trusted server/i);
  assert.throws(()=>apply(seeded(),'launch.validate',{context:requested},trustedContext()),/server-validated launch exactly/i);
  const ctx=trustedContext(principal(),{launchContext:requested});
  let state=apply(seeded(),'launch.validate',{context:requested},ctx);
  assert.equal(state.launch.status,'verified');
  assert.throws(()=>apply(state,'launch.validate',{context:{...requested,encounterId:'ENC-forged'}},ctx),/server-validated launch exactly/i);
  const wrongPatient={...requested,patientId:'TN-DEMO-03'};
  state=apply(state,'launch.validate',{context:wrongPatient},trustedContext(principal(),{launchContext:wrongPatient}));
  assert.equal(state.launch.status,'blocked');
  assert.match(state.launch.reason,/do not match policy/i);
  assert.throws(()=>apply(state,'launch.validate',{context:requested},{...ctx,actor:'another-user'}),/does not match the trusted actor/i);
});

test('ingestion requires scoped adapter context and quarantines invalid envelopes',()=>{
  const base=configured();
  assert.throws(()=>apply(base,'event.ingest',{envelope:envelope()}),/trusted server/i);
  assert.throws(()=>apply(base,'event.ingest',{envelope:envelope()},trustedContext()),/trusted server/i);
  assert.throws(()=>apply(base,'event.ingest',{envelope:envelope()},adapterContext({trustedSourceIds:[]})),/outside the trusted adapter/i);
  assert.throws(()=>apply(base,'event.ingest',{envelope:envelope({organizationId:'ORG-BETA'})},adapterContext()),/organization differs/i);
  const original=structuredClone(base);
  assert.throws(()=>ingest(base,envelope({patientId:'TN-DEMO-03'})),/Cross-organization/);
  assert.throws(()=>ingest(base,envelope({patientId:'TN-UNKNOWN'})),/outside the current workspace/);
  assert.deepEqual(base,original,'Unauthorized patient events fail before modifying any record.');
  for(const [patch,reason] of [
    [{metric:'sleep',unit:'hours'},'Unit mismatch for metric.'],
    [{value:11},'Value is outside the metric range.'],
    [{observedAt:'2026-09-17T11:00:00Z',receivedAt:'2026-09-17T10:00:00Z'},'Received time precedes observed time.'],
    [{observedAt:'2026-09-17T13:00:00Z',receivedAt:'2026-09-17T13:01:00Z'},'Event time is in the future.'],
    [{correctedEventId:'missing-event'},'Correction target not found.'],
  ]){
    const state=ingest(base,envelope(patch));
    assert.equal(state.quarantinedEvents[0].reason,reason);
    assert.equal(state.bridgeObservations.length,0);
    assert.equal(state.audit[0].allowed,false);
  }
  const expired=structuredClone(base);expired.sourceConfigs['ehr-primary'].freshUntil='2026-09-17T14:00:00+02:00';
  assert.equal(ingest(expired,envelope()).quarantinedEvents[0].reason,'Source freshness expired.');
  assert.equal(getSummary(expired,now).connectedSources,0);
});

test('duplicate, out-of-order and corrected events preserve provenance without double-counting active observations',()=>{
  let state=configured();
  const first=envelope({eventId:'event-first',observedAt:'2026-09-17T11:00:00+02:00',receivedAt:'2026-09-17T09:01:00Z'});
  state=ingest(state,first);
  assert.equal(state.acceptedEvents[0].observedAt,'2026-09-17T09:00:00.000Z');
  state=ingest(state,first);
  assert.equal(state.quarantinedEvents[0].reason,'Duplicate stable event ID.');
  state=ingest(state,envelope({eventId:'older',observedAt:'2026-09-17T08:00:00Z'}));
  assert.equal(state.acceptedEvents[0].outOfOrder,true);
  state=ingest(state,envelope({eventId:'between',observedAt:'2026-09-17T08:30:00Z'}));
  assert.equal(state.acceptedEvents[0].outOfOrder,true,'Compare against greatest observation time, not latest arrival.');
  state=ingest(state,envelope({eventId:'correction',correctedEventId:'event-first',value:6}));
  assert.equal(state.acceptedEvents.length,4);
  assert.equal(state.bridgeObservations.length,3);
  assert.equal(state.bridgeObservations.some(item=>item.eventId==='event-first'),false);
  const corrected=state.bridgeObservations.find(item=>item.eventId==='correction');
  assert.equal(corrected.correctedEventId,'event-first');
  assert.equal(corrected.sourceId,'ehr-primary');
  assert.equal(corrected.organizationId,'ORG-ALPHA');
  assert.equal(corrected.receivedAt,'2026-09-17T10:05:00.000Z');
  state=ingest(state,envelope({eventId:'forked-correction',correctedEventId:'event-first'}));
  assert.equal(state.quarantinedEvents[0].reason,'Correction target has already been superseded.');
  assert.equal(inspectState(state).ok,true);
});

test('corrections cannot target another patient or metric and reconciliation cannot bypass that guard',()=>{
  let state=ingest(configured(),envelope({eventId:'patient-one'}));
  const wrongPatient=envelope({eventId:'wrong-patient',patientId:'TN-DEMO-02',correctedEventId:'patient-one'});
  assert.throws(()=>ingest(state,wrongPatient),/active care relationship/);
  const authorizedForSecond=principal({relationships:[{patientId:'TN-DEMO-02',kind:'care-team',organizationId:'ORG-ALPHA'}],consents:principal().consents.map(consent=>({...consent,patientId:'TN-DEMO-02'}))});
  state=apply(state,'event.ingest',{envelope:wrongPatient},adapterContext({},authorizedForSecond));
  assert.match(state.quarantinedEvents[0].reason,/different patient/i);
  state=ingest(state,envelope({eventId:'wrong-metric',metric:'sleep',correctedEventId:'patient-one'}));
  const quarantined=state.quarantinedEvents[0];
  assert.match(quarantined.reason,/different patient, organization, or metric/i);
  assert.throws(()=>apply(state,'event.reconcile',{quarantineId:quarantined.id,resolution:{accept:true,note:'Synthetic review of correction target.'}},trustedContext()),/Correction target belongs/i);
  assert.equal(state.acceptedEvents.length,1);
  assert.equal(state.quarantinedEvents[0].resolved,undefined);
});

test('ingestion requires current patient consent and relationships before new events or exact replays',()=>{
  const base=configured(),event=envelope({eventId:'consent-bound-event'});
  const request=command(base,'event.ingest',{envelope:event},'consent-bound-request');
  const saved=reduce(base,request,adapterContext());
  assert.equal(saved.acceptedEvents.length,1);
  const revoked=principal();revoked.consents.push({patientId:'TN-DEMO-01',scope:'integration',granted:false,grantedAt:'2026-09-17T11:00:00.000Z'});
  const missing=principal();missing.consents=missing.consents.filter(consent=>consent.scope!=='integration');
  const expired=principal();expired.consents=expired.consents.map(consent=>consent.scope==='integration'?{...consent,expiresAt:now}:consent);
  const future=principal();future.consents=future.consents.map(consent=>consent.scope==='integration'?{...consent,grantedAt:'2026-09-18T00:00:00.000Z'}:consent);
  for(const context of [adapterContext({principal:undefined}),adapterContext({},revoked),adapterContext({},missing),adapterContext({},expired),adapterContext({},future),adapterContext({},principal({relationships:[]}))]){
    const before=structuredClone(saved);
    assert.throws(()=>reduce(base,request,context),/principal|consent|relationship/i);
    assert.throws(()=>reduce(saved,request,context),/principal|consent|relationship/i);
    assert.deepEqual(saved,before,'Denied replays preserve the existing observation and its history.');
  }
});

test('accepting a held event rechecks integration consent without discarding its source history',()=>{
  const state=ingest(configured(),envelope({metric:'sleep',unit:'hours'}));
  const quarantineId=state.quarantinedEvents[0].id,before=structuredClone(state),revoked=principal();
  revoked.consents.push({patientId:'TN-DEMO-01',scope:'integration',granted:false,grantedAt:'2026-09-17T11:00:00.000Z'});
  assert.throws(()=>apply(state,'event.reconcile',{quarantineId,resolution:{accept:true,unit:'score-0-10',value:5,note:'Source score reviewed.'}},trustedContext(revoked)),/consent for integration/);
  assert.deepEqual(state,before);
  const accepted=apply(state,'event.reconcile',{quarantineId,resolution:{accept:true,unit:'score-0-10',value:5,note:'Source score reviewed.'}},trustedContext());
  assert.equal(accepted.acceptedEvents.length,1);assert.equal(accepted.quarantinedEvents[0].event.unit,'hours');
});

test('reconciliation rechecks source, duplicate IDs, values and timing; unit corrections need explicit corrected values',()=>{
  let state=ingest(configured(),envelope({eventId:'unit-error',metric:'sleep',unit:'hours',value:7}));
  const quarantineId=state.quarantinedEvents[0].id;
  const reconcile={quarantineId,resolution:{accept:true,unit:'score-0-10',note:'Reviewed original provider score and corrected unit mapping.'}};
  assert.throws(()=>apply(state,'event.reconcile',reconcile),/trusted server/i);
  assert.throws(()=>apply(state,'event.reconcile',reconcile,trustedContext()),/explicit corrected value/i);
  state=apply(state,'event.reconcile',{...reconcile,resolution:{...reconcile.resolution,value:4}},trustedContext());
  assert.equal(state.quarantinedEvents[0].resolved.accepted,true);
  assert.equal(state.acceptedEvents[0].value,4);
  assert.equal(state.acceptedEvents[0].reconciledFrom,quarantineId);
  assert.equal(state.bridgeObservations[0].unit,'score-0-10');
  const duplicate=envelope({eventId:'unit-error'});
  state=ingest(state,duplicate);
  assert.throws(()=>apply(state,'event.reconcile',{quarantineId:state.quarantinedEvents[0].id,resolution:{accept:true,note:'Try to bypass the stable event ID.'}},trustedContext()),/Duplicate stable event ID/i);
  let stale=ingest(configured(),envelope({unit:'hours',metric:'sleep'}));
  stale.sourceConfigs['ehr-primary'].freshUntil='2026-09-16T00:00:00Z';
  assert.throws(()=>apply(stale,'event.reconcile',{quarantineId:stale.quarantinedEvents[0].id,resolution:{accept:true,unit:'score-0-10',value:5,note:'Provider score verified.'}},trustedContext()),/Source freshness expired/i);
});

test('evaluation quarantine rejection is explicit and never accepts clinical data',()=>{
  let state=ingest(configured(),envelope({unit:'wrong'}));
  const quarantineId=state.quarantinedEvents[0].id;
  state=apply(state,'event.reconcile',{quarantineId,resolution:{accept:false,note:'Invalid units; requesting a corrected source event.'}});
  assert.equal(state.quarantinedEvents[0].resolved.accepted,false);
  assert.equal(state.quarantinedEvents[0].resolved.by,ownerContext.actor);
  assert.equal(state.acceptedEvents.length,0);
  assert.equal(state.bridgeObservations.length,0);
  assert.throws(()=>apply(state,'event.reconcile',{quarantineId,resolution:{accept:false,note:'Repeat review.'}}),/already reconciled/i);
});

test('write-back requires a trusted existing note, scoped source, current write and integration grants',()=>{
  let state=configured();
  const fields={patientId:'TN-DEMO-01',sourceId:'ehr-primary',encounterId:'ENC-101',noteId:'note-1',payloadDigest:'fake',expectedPolicyVersion:state.policy.version};
  assert.throws(()=>apply(state,'outbox.prepare',fields),/trusted server/i);
  assert.throws(()=>apply(state,'outbox.prepare',fields,trustedContext()),/trusted locally saved note/i);
  const noWrite=principal();noWrite.consents=noWrite.consents.filter(item=>item.scope!=='write');
  assert.throws(()=>prepare(state,'note-1',trustedContext(noWrite)),/patient consent/i);
  state=prepare(state);
  assert.equal(state.outbox[0].status,'prepared');
  assert.equal(state.localWritebackNotes[0].savedBy,'clinician-1');
  assert.equal(state.localWritebackNotes[0].savedAt,'2026-09-17T11:00:00.000Z');
  assert.equal(state.outbox[0].preparedBy,'clinician-1');
  assert.equal(state.outbox[0].providerMessageId,undefined);
  state=prepare(state);
  assert.equal(state.outbox.length,1,'Semantic retries retain one outbox item for one note revision.');
  assert.equal(state.localWritebackNotes.length,1);
});

test('write-back rechecks revoked grants and policy changes before dispatch',()=>{
  let state=prepare(configured());
  const outboxId=state.outbox[0].id;
  state=apply(state,'outbox.pending',{outboxId},trustedContext());
  const revoked=principal();revoked.consents.push({patientId:'TN-DEMO-01',scope:'integration',granted:false,grantedAt:'2026-09-17T11:00:00Z'});
  assert.throws(()=>apply(state,'outbox.attempt',{outboxId},adapterContext({},revoked)),/patient consent/i);
  const changed=structuredClone(state);changed.policy.version++;
  assert.throws(()=>apply(changed,'outbox.attempt',{outboxId},adapterContext()),/Policy version is stale/i);
  assert.equal(state.outbox[0].status,'pending');
  assert.equal(state.outbox[0].attempts,0);
});

test('provider receipts require trusted adapter context bound to the exact attempt',()=>{
  let state=attempted();
  const row=state.outbox[0],receipt=receiptFor(state);
  assert.equal(row.status,'attempted');
  assert.equal(row.attempts,1);
  assert.throws(()=>apply(state,'outbox.acknowledge',{outboxId:row.id}),/trusted server/i);
  assert.throws(()=>apply(state,'outbox.acknowledge',{outboxId:row.id},adapterContext()),/exact outbox attempt/i);
  assert.throws(()=>apply(state,'outbox.acknowledge',{outboxId:row.id},adapterContext({receipt:{...receipt,attemptId:'forged-attempt'}})),/exact outbox attempt/i);
  assert.throws(()=>apply(state,'outbox.acknowledge',{outboxId:row.id},{...adapterContext({receipt}),actor:'forged-adapter'}),/Untrusted adapter/i);
  assert.throws(()=>apply(state,'outbox.acknowledge',{outboxId:row.id},adapterContext({organizationId:'ORG-BETA',receipt})),/outside the trusted adapter/i);
  state=apply(state,'outbox.acknowledge',{outboxId:row.id},adapterContext({receipt}));
  assert.equal(state.outbox[0].status,'acknowledged');
  assert.equal(state.outbox[0].providerMessageId,receipt.providerMessageId);
  assert.equal(inspectState(state).ok,true);
});

test('retries reject stale receipts and manually reported evidence never becomes an acknowledgement',()=>{
  let state=attempted();
  const outboxId=state.outbox[0].id,firstAttempt=state.outbox[0].attemptId;
  state=apply(state,'outbox.acknowledge',{outboxId},adapterContext({receipt:receiptFor(state,{status:'failed',retryable:true})}));
  assert.equal(state.outbox[0].status,'retryable');
  state=apply(state,'outbox.retry',{outboxId},trustedContext());
  state=apply(state,'outbox.attempt',{outboxId},adapterContext());
  assert.equal(state.outbox[0].attempts,2);
  assert.notEqual(state.outbox[0].attemptId,firstAttempt);
  assert.throws(()=>apply(state,'outbox.acknowledge',{outboxId},adapterContext({receipt:receiptFor(state,{attemptId:firstAttempt})})),/exact outbox attempt/i);
  state=apply(state,'outbox.manual-evidence',{patientId:'TN-DEMO-01',outboxId,note:'The receiving office verbally reports delivery.'});
  assert.equal(state.externalEvidence[0].kind,'manual-report');
  assert.equal(state.outbox[0].status,'attempted');
  assert.equal(state.outbox[0].providerMessageId,undefined);
  assert.throws(()=>apply(state,'outbox.manual-evidence',{patientId:'TN-DEMO-02',outboxId,note:'Wrong patient evidence.'}),/patient do not match/i);
});

test('disabled or stale adapters produce failed attempts, not provider success',()=>{
  let state=prepare(configured());
  const outboxId=state.outbox[0].id;
  state=apply(state,'outbox.pending',{outboxId},trustedContext());
  state=apply(state,'source.save',{source:{...state.sourceConfigs['ehr-primary'],enabled:false}},trustedContext(admin()));
  state=apply(state,'outbox.attempt',{outboxId},adapterContext());
  assert.equal(state.outbox[0].status,'failed');
  assert.equal(state.outbox[0].attempts,0);
  assert.match(state.outbox[0].failureReason,/unavailable/i);
  assert.equal(state.outbox[0].providerMessageId,undefined);
  assert.equal(inspectState(state).ok,true);
});

test('idempotency is exact and actor-bound; stale writes and prototype keys are rejected without mutating input',()=>{
  const before=initialState();
  const action=command(before,'outbox.manual-evidence',{patientId:'TN-DEMO-01',note:'Reported by an external coordinator.'},'one-request');
  const state=reduce(before,action,ownerContext);
  assert.deepEqual(before,initialState());
  assert.deepEqual(reduce(state,action,ownerContext),state);
  assert.throws(()=>reduce(state,{...action,note:'Changed payload'},ownerContext),/already used for a different/i);
  assert.throws(()=>reduce(state,action,{...ownerContext,actor:'Another Owner'}),/already used for a different/i);
  assert.throws(()=>reduce(state,{...action,requestId:'new-request'},ownerContext),/State version mismatch/i);
  for(const reserved of ['constructor','__proto__','prototype']) assert.throws(()=>reduce(state,{...action,requestId:reserved},ownerContext));
  const version=state.version;
  assert.throws(()=>apply(state,'outbox.manual-evidence',{patientId:'TN-FOREIGN',note:'Unknown patient'}));
  assert.equal(state.version,version);
});

test('state validation detects fake receipts, mismatched bridge observations and unlinked evidence',()=>{
  const state=ingest(configured(),envelope({eventId:'original'}));
  const corrupted=structuredClone(state);corrupted.bridgeObservations[0].value=7;
  assert.equal(inspectState(corrupted).ok,false);
  assert.throws(()=>validateState(corrupted),/Bridge observation differs/i);
  const fake=attempted();fake.outbox[0].status='acknowledged';
  assert.equal(inspectState(fake).ok,false);
  const evidence=initialState();evidence.externalEvidence.push({id:'fake-evidence',patientId:'TN-DEMO-01',outboxId:'missing',note:'Unlinked claim',reportedAt:now,reporter:'Owner',kind:'manual-report'});
  assert.equal(inspectState(evidence).ok,false);
});

test('panel exposes working evaluation drafts and labels blocked clinical integrations truthfully',async()=>{
  const {IntegrationAccessPanel}=await vite.ssrLoadModule('/components/theranetrix/clinical-flows/integration-access.tsx');
  const html=renderToStaticMarkup(React.createElement(IntegrationAccessPanel,{state:initialState(),patients,busy:false,onAction:async()=>true}));
  assert.match(html,/Workspace connection settings/);
  assert.match(html,/Save source draft/);
  assert.match(html,/Save policy draft/);
  assert.match(html,/Save manual report/);
  assert.match(html,/EHR launch is blocked/);
  assert.match(html,/Workspace ownership does not grant clinical access/);
  assert.match(html,/They do not mark write-back as delivered or acknowledged/);
  assert.doesNotMatch(html,/Mark as acknowledged|Accept quarantined event|Connect EHR/);
});

test('source configuration and live policies require the correct administrator and preserve tenant isolation',()=>{
  const state=configured();
  const source={...state.sourceConfigs['ehr-primary'],label:'Attempted edit'};
  assert.throws(()=>apply(state,'source.save',{source},trustedContext()),/authorized administrator/i);
  assert.throws(()=>apply(state,'source.save',{source},trustedContext(admin(),{organizationId:'ORG-BETA'})),/does not match the trusted actor and organization/i);
  assert.throws(()=>apply(state,'source.save',{source:{...source,organizationId:'ORG-BETA'}},trustedContext(admin())),/different organization/i);
  const remapped={...state.policy,version:state.policy.version+1,patientOrganizations:{...state.policy.patientOrganizations,'TN-DEMO-01':'ORG-BETA'}};
  assert.throws(()=>apply(state,'policy.replace',{policy:remapped},trustedContext(admin())),/another organization/i);
  const permissions=state.policy.permissions.map(item=>item.role==='clinician'&&item.action==='records.read'?{...item,allow:false}:item);
  assert.throws(()=>apply(state,'policy.replace',{policy:{...state.policy,version:2,permissions}},trustedContext(admin())),/another organization/i);
});

test('provider failure receipts are retained across retries and cannot be reused for later attempts',()=>{
  let state=attempted();
  const outboxId=state.outbox[0].id;
  const failed=receiptFor(state,{status:'failed',retryable:true,providerMessageId:'stable-provider-failure'});
  state=apply(state,'outbox.acknowledge',{outboxId},adapterContext({receipt:failed}));
  assert.equal(state.providerReceipts[0].status,'failed');
  assert.equal(state.providerReceipts[0].attemptId,failed.attemptId);
  state=apply(state,'outbox.retry',{outboxId},trustedContext());
  state=apply(state,'outbox.attempt',{outboxId},adapterContext());
  assert.equal(state.providerReceipts.length,1);
  assert.equal(state.outbox[0].providerMessageId,undefined);
  assert.throws(()=>apply(state,'outbox.acknowledge',{outboxId},adapterContext({receipt:receiptFor(state,{providerMessageId:failed.providerMessageId})})),/already been used for another outbox attempt/i);
  state=apply(state,'outbox.acknowledge',{outboxId},adapterContext({receipt:receiptFor(state)}));
  assert.equal(state.providerReceipts.length,2);
  assert.equal(state.outbox[0].status,'acknowledged');
});


test('a verified user cannot reject another organization’s quarantine or alter its policy version',()=>{
  const state=ingest(configured(),envelope({unit:'invalid'}));
  const quarantineId=state.quarantinedEvents[0].id;
  const other=principal({id:'other-admin',organizationId:'ORG-BETA',role:'integration-admin'});
  assert.throws(()=>apply(state,'event.reconcile',{quarantineId,resolution:{accept:false,note:'Wrong-tenant queue edit.'}},trustedContext(other)),/outside the trusted adapter/i);
  assert.throws(()=>apply(state,'policy.replace',{policy:{...state.policy,version:state.policy.version+1}},trustedContext(admin())),/another organization/i);
  assert.equal(state.quarantinedEvents[0].resolved,undefined);
});
