import assert from 'node:assert/strict';
import test, {after, mock} from 'node:test';
import {fileURLToPath} from 'node:url';

import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

const root=fileURLToPath(new URL('..',import.meta.url));
const vite=await createServer({
  appType:'custom',
  configFile:false,
  root,
  resolve:{alias:{'@':root}},
  server:{middlewareMode:true},
});

after(async()=>{
  await vite.close();
});

const domain=await vite.ssrLoadModule('/lib/clinical-flows/treatment-continuity.ts');
const ui=await vite.ssrLoadModule('/components/theranetrix/clinical-flows/treatment-continuity.tsx');
const {initialState,reduce,actionSchema,getSummary}=domain;
const {TreatmentContinuityPanel}=ui;

const baseContext={
  actor:'Dr. Maya Chen',
  now:'2026-09-24T14:45:00Z',
  patients:[
    {id:'p-1',name:'Avery Stone'},
    {id:'p-2',name:'Jordan Lee'},
  ],
  features:{},
};

function apply(state,action,context){
  // Existing scenarios document past milestones; keep subsequent audit events chronological.
  context??={...baseContext,now:[baseContext.now,...Object.values(state).flatMap(records=>records.map(record=>record.updatedAt).filter(Boolean))].sort().at(-1)};
  return reduce(state,actionSchema.parse(action),context);
}

test('reconciliation records keep bridge metadata, reject wrong-patient updates, and honor idempotency',()=>{
  const state=initialState();
  const snapshot=structuredClone(state);
  const action={
    type:'treatment-continuity.record-reconciliation',
    patientId:'p-1',
    requestId:'req-recon-1',
    reason:'External fill history conflicted with the patient report.',
    evidenceRef:'outside-list-17',
    source:'Outside medication history',
    sourceDate:'2026-09-16',
    status:'resolved',
    reviewer:'Dr. Maya Chen',
    resolution:'Confirmed the patient stopped gabapentin after dizziness.',
    conflicts:[{field:'gabapentin status',patientFact:'Stopped in July',externalFact:'Shown as active',outcome:'resolved'}],
    owner:'Alex Morgan, RN',
    dueDate:'2026-09-18',
    bridge:{
      medications:[{id:'med-1',name:'Gabapentin',recordedAt:'2026-09-10'}],
      clinicalContext:{recordedAt:'2026-09-12',summary:'Neuropathy follow-up'},
      integrationStatus:'manual-review',
    },
  };
  const next=apply(state,action);
  assert.deepEqual(state,snapshot);
  assert.equal(next.reconciliations[0].version,1);
  assert.equal(next.reconciliations[0].bridge.medications[0].name,'Gabapentin');
  assert.equal(next.reconciliations[0].history[0].from,'new');

  const duplicate=apply(next,action);
  assert.deepEqual(duplicate,next);

  assert.throws(()=>apply(next,{...action,resolution:'Different resolution text'}),/different payload/);
  assert.throws(()=>apply(next,{...action,requestId:'req-recon-2',patientId:'wrong'}),/Unknown patient/);
});

test('treatment experience preserves zero versus unknown, contradictory signals, stale checks, stopped, and never-started states',()=>{
  let state=apply(initialState(),{
    type:'treatment-continuity.record-experience',
    patientId:'p-1',
    id:'exp-1',
    requestId:'req-exp-1',
    reason:'Initial treatment experience documented.',
    evidenceRef:'visit-note-1',
    medicationName:'Duloxetine',
    reportedUse:'active',
    regimen:'30 mg nightly',
    regimenStartedAt:'2026-09-17',
    regimenDurationDays:0,
    reportedBenefit:'helpful',
    tolerability:'side-effects',
    functionalGoal:'Walk 15 minutes without stopping',
    patientConcern:'Morning grogginess still limits work.',
    trialStatus:'active',
    stopDate:'',
    stopReason:'',
    reassessmentDecision:'no-change',
    alternativePlan:'',
    owner:'Dr. Maya Chen',
    dueDate:'2026-09-24',
  });
  assert.equal(state.experiences[0].regimenDurationDays,0);
  assert.equal(state.experiences[0].reportedBenefit,'helpful');
  assert.equal(state.experiences[0].patientConcern,'Morning grogginess still limits work.');

  assert.throws(()=>apply(state,{
    type:'treatment-continuity.record-experience',
    patientId:'p-1',
    id:'exp-1',
    expectedVersion:1,
    requestId:'req-exp-2',
    reason:'Regimen changed.',
    evidenceRef:'',
    medicationName:'Duloxetine',
    reportedUse:'active',
    regimen:'60 mg nightly',
    regimenStartedAt:'2026-09-18',
    regimenDurationDays:null,
    reportedBenefit:'partial',
    tolerability:'tolerated',
    functionalGoal:'Walk 15 minutes without stopping',
    patientConcern:'Sleep still interrupted.',
    trialStatus:'active',
    stopDate:'',
    stopReason:'',
    reassessmentDecision:'defer',
    alternativePlan:'',
    owner:'Dr. Maya Chen',
    dueDate:'2026-09-25',
  }),/reassessment evidence/);

  state=apply(state,{
    type:'treatment-continuity.record-experience',
    patientId:'p-1',
    id:'exp-1',
    expectedVersion:1,
    requestId:'req-exp-3',
    reason:'Updated after the dose change and patient follow-up.',
    evidenceRef:'visit-note-2',
    medicationName:'Duloxetine',
    reportedUse:'stopped',
    regimen:'60 mg nightly',
    regimenStartedAt:'2026-09-18',
    regimenDurationDays:null,
    reportedBenefit:'partial',
    tolerability:'side-effects',
    functionalGoal:'Walk 20 minutes with breaks',
    patientConcern:'Stopped after worsened nausea.',
    trialStatus:'stopped',
    stopDate:'2026-09-20',
    stopReason:'Nausea and patient preference.',
    reassessmentDecision:'clinician-authored-alternative',
    alternativePlan:'Review topical lidocaine at the next clinician visit.',
    owner:'Taylor Reed, RN',
    dueDate:'2026-09-27',
  },{...baseContext,actor:'Taylor Reed, RN',now:'2026-09-25T18:00:00Z'});
  assert.equal(state.experiences[0].version,2);
  assert.equal(state.experiences[0].regimenDurationDays,null);
  assert.equal(state.experiences[0].stopReason,'Nausea and patient preference.');
  assert.equal(state.experiences[0].history[0].actor,'Taylor Reed, RN');
  assert.throws(()=>apply(state,{
    type:'treatment-continuity.record-experience',
    patientId:'p-1',
    id:'exp-1',
    expectedVersion:1,
    requestId:'req-exp-4',
    reason:'Stale retry.',
    evidenceRef:'visit-note-3',
    medicationName:'Duloxetine',
    reportedUse:'stopped',
    regimen:'60 mg nightly',
    regimenStartedAt:'2026-09-18',
    regimenDurationDays:null,
    reportedBenefit:'partial',
    tolerability:'side-effects',
    functionalGoal:'Walk 20 minutes with breaks',
    patientConcern:'Stopped after worsened nausea.',
    trialStatus:'stopped',
    stopDate:'2026-09-20',
    stopReason:'Nausea and patient preference.',
    reassessmentDecision:'defer',
    alternativePlan:'',
    owner:'Taylor Reed, RN',
    dueDate:'2026-09-27',
  }),/Stale update/);

  const neverStarted=apply(state,{
    type:'treatment-continuity.record-experience',
    patientId:'p-2',
    id:'exp-2',
    requestId:'req-exp-5',
    reason:'Patient declined to start after reviewing the option.',
    evidenceRef:'phone-note-1',
    medicationName:'Pregabalin',
    reportedUse:'never-started',
    regimen:'25 mg nightly',
    regimenStartedAt:'',
    regimenDurationDays:null,
    reportedBenefit:'unknown',
    tolerability:'unknown',
    functionalGoal:'Sleep through the night',
    patientConcern:'Concerned about sedation.',
    trialStatus:'never-started',
    stopDate:'',
    stopReason:'',
    reassessmentDecision:'patient-declined',
    alternativePlan:'',
    owner:'Dr. Maya Chen',
    dueDate:'2026-09-28',
  });
  assert.equal(neverStarted.experiences.find(record=>record.id==='exp-2').reportedUse,'never-started');
  assert.throws(()=>apply(neverStarted,{
    type:'treatment-continuity.record-experience',
    patientId:'p-2',
    id:'exp-4',
    requestId:'req-exp-7',
    reason:'Invalid active/stopped combination.',
    evidenceRef:'phone-note-3',
    medicationName:'Pregabalin',
    reportedUse:'active',
    regimen:'25 mg nightly',
    regimenStartedAt:'2026-09-17',
    regimenDurationDays:2,
    reportedBenefit:'partial',
    tolerability:'tolerated',
    functionalGoal:'Sleep through the night',
    patientConcern:'',
    trialStatus:'stopped',
    stopDate:'2026-09-19',
    stopReason:'Patient stopped quickly.',
    reassessmentDecision:'defer',
    alternativePlan:'',
    owner:'Dr. Maya Chen',
    dueDate:'2026-09-29',
  }),/cannot be reported as active/);
  assert.throws(()=>apply(neverStarted,{...neverStarted.experiences.find(record=>record.id==='exp-2')&&{
    type:'treatment-continuity.record-experience',
    patientId:'p-2',
    id:'exp-3',
    requestId:'req-exp-6',
    reason:'Invalid combination.',
    evidenceRef:'phone-note-2',
    medicationName:'Pregabalin',
    reportedUse:'active',
    regimen:'25 mg nightly',
    regimenStartedAt:'',
    regimenDurationDays:null,
    reportedBenefit:'unknown',
    tolerability:'unknown',
    functionalGoal:'Sleep through the night',
    patientConcern:'',
    trialStatus:'never-started',
    stopDate:'',
    stopReason:'',
    reassessmentDecision:'defer',
    alternativePlan:'',
    owner:'Dr. Maya Chen',
    dueDate:'2026-09-29',
  }}),/Never-started/);
});

test('lifecycle transitions require evidence, keep manual milestones local, and allow failed or not-started branches',()=>{
  let state=apply(initialState(),{
    type:'treatment-continuity.update-lifecycle',
    patientId:'p-1',
    id:'life-1',
    requestId:'req-life-1',
    reason:'Medication under consideration locally.',
    evidenceRef:'',
    medicationName:'Duloxetine',
    stage:'considered',
    manualSource:'',
    safetyPrerequisites:[],
    reviewPrerequisites:['Confirm no duplication with the outside list'],
    prescriberResponsibility:'Pain clinician will decide whether to prescribe.',
    clinicalServiceAvailable:true,
    statusNote:'Local documentation only.',
    renewalRequested:false,
    failureReason:'',
    notStartedReason:'',
    owner:'Dr. Maya Chen',
    dueDate:'2026-09-19',
  });
  assert.throws(()=>apply(initialState(),{
    type:'treatment-continuity.update-lifecycle',
    patientId:'p-1',
    id:'life-bad',
    requestId:'req-life-bad',
    reason:'Skipped ahead.',
    evidenceRef:'auth-note',
    medicationName:'Duloxetine',
    stage:'authorization-recorded',
    manualSource:'Faxed authorization note',
    safetyPrerequisites:[],
    reviewPrerequisites:[],
    prescriberResponsibility:'Clinician',
    clinicalServiceAvailable:true,
    statusNote:'',
    renewalRequested:false,
    failureReason:'',
    notStartedReason:'',
    owner:'Dr. Maya Chen',
    dueDate:'2026-09-19',
  }),/start at considered/);

  state=apply(state,{...state.lifecycles[0]&&{
    type:'treatment-continuity.update-lifecycle',
    patientId:'p-1',
    id:'life-1',
    expectedVersion:1,
    requestId:'req-life-2',
    reason:'Clinician review completed.',
    evidenceRef:'review-note-1',
    medicationName:'Duloxetine',
    stage:'clinician-review',
    manualSource:'',
    safetyPrerequisites:[],
    reviewPrerequisites:['Discuss non-medication supports'],
    prescriberResponsibility:'Pain clinician will decide whether to prescribe.',
    clinicalServiceAvailable:true,
    statusNote:'Still local.',
    renewalRequested:false,
    failureReason:'',
    notStartedReason:'',
    owner:'Dr. Maya Chen',
    dueDate:'2026-09-20',
  }});
  assert.throws(()=>apply(state,{
    type:'treatment-continuity.update-lifecycle',
    patientId:'p-1',
    id:'life-1',
    expectedVersion:2,
    requestId:'req-life-3',
    reason:'Authorization was documented.',
    evidenceRef:'',
    medicationName:'Duloxetine',
    stage:'authorization-recorded',
    manualSource:'',
    safetyPrerequisites:[],
    reviewPrerequisites:['Discuss non-medication supports'],
    prescriberResponsibility:'Pain clinician will decide whether to prescribe.',
    clinicalServiceAvailable:true,
    statusNote:'Still local.',
    renewalRequested:false,
    failureReason:'',
    notStartedReason:'',
    owner:'Dr. Maya Chen',
    dueDate:'2026-09-21',
  }),/manual source and evidence/);

  state=apply(state,{
    type:'treatment-continuity.update-lifecycle',
    patientId:'p-1',
    id:'life-1',
    expectedVersion:2,
    requestId:'req-life-4',
    reason:'Manual authorization receipt entered.',
    evidenceRef:'auth-note-1',
    medicationName:'Duloxetine',
    stage:'authorization-recorded',
    manualSource:'Prior authorization fax uploaded by coordinator.',
    safetyPrerequisites:[],
    reviewPrerequisites:['Discuss non-medication supports'],
    prescriberResponsibility:'Pain clinician will decide whether to prescribe.',
    clinicalServiceAvailable:true,
    statusNote:'No e-prescribing connection.',
    renewalRequested:false,
    failureReason:'',
    notStartedReason:'',
    owner:'Alex Morgan, NP',
    dueDate:'2026-09-21',
  },{...baseContext,actor:'Alex Morgan, NP',now:'2026-09-25T12:00:00Z'});
  assert.equal(state.lifecycles[0].manualSource,'Prior authorization fax uploaded by coordinator.');
  assert.equal(state.lifecycles[0].history[0].actor,'Alex Morgan, NP');
  state=apply(state,{
    type:'treatment-continuity.update-lifecycle',
    patientId:'p-1',
    id:'life-1',
    expectedVersion:3,
    requestId:'req-life-4b',
    reason:'Updated owner metadata without changing the current stage.',
    evidenceRef:'auth-note-1b',
    medicationName:'Duloxetine',
    stage:'authorization-recorded',
    manualSource:'Prior authorization fax uploaded by coordinator.',
    safetyPrerequisites:[],
    reviewPrerequisites:['Discuss non-medication supports'],
    prescriberResponsibility:'Pain clinician will decide whether to prescribe.',
    clinicalServiceAvailable:true,
    statusNote:'Ownership updated while staying local.',
    renewalRequested:false,
    failureReason:'',
    notStartedReason:'',
    owner:'Taylor Reed, RN',
    dueDate:'2026-09-22',
  });
  assert.equal(state.lifecycles[0].version,4);
  assert.equal(state.lifecycles[0].owner,'Taylor Reed, RN');

  const branched=apply(state,{
    type:'treatment-continuity.update-lifecycle',
    patientId:'p-2',
    id:'life-2',
    requestId:'req-life-5',
    reason:'Local consideration documented.',
    evidenceRef:'',
    medicationName:'Pregabalin',
    stage:'considered',
    manualSource:'',
    safetyPrerequisites:[],
    reviewPrerequisites:[],
    prescriberResponsibility:'Pain clinician review pending.',
    clinicalServiceAvailable:false,
    statusNote:'Service not configured for partner prescribing.',
    renewalRequested:false,
    failureReason:'',
    notStartedReason:'',
    owner:'Taylor Reed, RN',
    dueDate:'2026-09-19',
  });
  const branchedReviewed=apply(branched,{
    type:'treatment-continuity.update-lifecycle',
    patientId:'p-2',
    id:'life-2',
    expectedVersion:1,
    requestId:'req-life-6-review',
    reason:'Clinician review happened but service remains unavailable.',
    evidenceRef:'review-note-2',
    medicationName:'Pregabalin',
    stage:'clinician-review',
    manualSource:'',
    safetyPrerequisites:[],
    reviewPrerequisites:[],
    prescriberResponsibility:'Pain clinician review pending.',
    clinicalServiceAvailable:false,
    statusNote:'Still local only.',
    renewalRequested:false,
    failureReason:'',
    notStartedReason:'',
    owner:'Taylor Reed, RN',
    dueDate:'2026-09-20',
  });
  assert.throws(()=>apply(branchedReviewed,{
    type:'treatment-continuity.update-lifecycle',
    patientId:'p-2',
    id:'life-2',
    expectedVersion:2,
    requestId:'req-life-6',
    reason:'Invalid advance while the service is unavailable.',
    evidenceRef:'start-note',
    medicationName:'Pregabalin',
    stage:'authorization-recorded',
    manualSource:'Coordinator documented an outside authorization note.',
    safetyPrerequisites:['Reviewed sedation risks'],
    reviewPrerequisites:[],
    prescriberResponsibility:'Pain clinician review pending.',
    clinicalServiceAvailable:false,
    statusNote:'',
    renewalRequested:false,
    failureReason:'',
    notStartedReason:'',
    owner:'Taylor Reed, RN',
    dueDate:'2026-09-21',
  }),/Unavailable clinical services/);
  const notStarted=apply(branchedReviewed,{
    type:'treatment-continuity.update-lifecycle',
    patientId:'p-2',
    id:'life-2',
    expectedVersion:2,
    requestId:'req-life-7',
    reason:'Patient never started because transportation delayed pickup.',
    evidenceRef:'care-coordination-1',
    medicationName:'Pregabalin',
    stage:'not-started',
    manualSource:'Patient phone call',
    safetyPrerequisites:[],
    reviewPrerequisites:[],
    prescriberResponsibility:'Pain clinician review pending.',
    clinicalServiceAvailable:false,
    statusNote:'Local record only.',
    renewalRequested:false,
    failureReason:'',
    notStartedReason:'Transportation and timing barrier.',
    owner:'Taylor Reed, RN',
    dueDate:'2026-09-21',
  });
  assert.equal(notStarted.lifecycles.find(record=>record.id==='life-2').stage,'not-started');
  assert.equal(getSummary(notStarted,'p-2').open,1);
  assert.ok(getSummary(notStarted,'p-2').attention.some(item=>item.includes('exact order')),'Legacy milestone retains a concrete evidence follow-up');
});

test('access barriers and transitions preserve explicit ownership, due dates, and pending work resolution',()=>{
  mock.timers.enable({apis:['Date'],now:new Date('2026-09-17T12:00:00Z')});
  try{
  let state=apply(initialState(),{
    type:'treatment-continuity.manage-access',
    patientId:'p-1',
    id:'access-1',
    requestId:'req-access-1',
    reason:'Cost barrier reported during follow-up.',
    evidenceRef:'coord-note-1',
    barrierType:'cost',
    status:'unresolved',
    patientChoice:'Wants to keep discussing options but cannot pay this week.',
    outreach:'Coordinator called the payer and pharmacy.',
    alternatives:'Review lower-cost topical option with clinician.',
    requiresClinicianReview:true,
    resolution:'',
    owner:'Care coordinator',
    dueDate:'2026-09-10',
  });
  assert.equal(getSummary(state,'p-1').overdue,1);
  state=apply(state,{
    type:'treatment-continuity.manage-access',
    patientId:'p-1',
    id:'access-keep-open',
    requestId:'req-access-1b',
    reason:'Availability barrier also tracked locally.',
    evidenceRef:'coord-note-1b',
    barrierType:'availability',
    status:'unresolved',
    patientChoice:'Still wants treatment if stock becomes available.',
    outreach:'Coordinator called a second pharmacy.',
    alternatives:'',
    requiresClinicianReview:false,
    resolution:'',
    owner:'Care coordinator',
    dueDate:'2026-09-30',
  });
  const accessSummary=getSummary(state,'p-1');
  assert.equal(accessSummary.open,2);
  assert.equal(accessSummary.overdue,1);
  assert.ok(accessSummary.attention.includes('Alternative options need clinician review before they replace the current plan.'));
  assert.ok(accessSummary.attention.includes('Continue outreach until the barrier is resolved or explicitly declined.'));
  assert.throws(()=>apply(state,{
    type:'treatment-continuity.manage-access',
    patientId:'p-1',
    id:'access-2',
    requestId:'req-access-2',
    reason:'Missing alternatives.',
    evidenceRef:'coord-note-2',
    barrierType:'coverage',
    status:'unresolved',
    patientChoice:'Open to alternatives.',
    outreach:'Called plan.',
    alternatives:'',
    requiresClinicianReview:true,
    resolution:'',
    owner:'Care coordinator',
    dueDate:'2026-09-12',
  }),/Alternatives requiring clinician review/);
  state=apply(state,{
    type:'treatment-continuity.manage-access',
    patientId:'p-1',
    id:'access-1',
    expectedVersion:1,
    requestId:'req-access-3',
    reason:'The patient declined the alternative for now.',
    evidenceRef:'coord-note-3',
    barrierType:'cost',
    status:'patient-declined',
    patientChoice:'Declined the alternative until the next clinician review.',
    outreach:'Documented the patient preference and scheduled follow-up.',
    alternatives:'Review lower-cost topical option with clinician.',
    requiresClinicianReview:true,
    resolution:'Patient asked to defer change until the next visit.',
    owner:'Care coordinator',
    dueDate:'2026-09-24',
  });
  assert.equal(state.accessBarriers.find(record=>record.id==='access-1').status,'patient-declined');

  state=apply(state,{
    type:'treatment-continuity.record-transition',
    patientId:'p-1',
    id:'transition-1',
    requestId:'req-transition-1',
    reason:'Started handover from an outside neurologist.',
    evidenceRef:'handover-note-1',
    externalCareSource:'Outside neurologist',
    previousInstructions:'Continue duloxetine 30 mg nightly until reviewed.',
    newInstructions:'Await local clinician confirmation before changing medication.',
    discrepancies:'Outside plan listed gabapentin as active.',
    pendingWork:['Confirm current medication list','Call receiving clinician'],
    resolvedPendingWork:[],
    receivingClinician:'Dr. Maya Chen',
    ownershipAccepted:false,
    reconciledInstructions:'',
    patientCommunication:'',
    handoverStatus:'draft',
    owner:'Care coordinator',
    dueDate:'2026-09-18',
  });
  state=apply(state,{
    type:'treatment-continuity.record-transition',
    patientId:'p-1',
    id:'transition-1',
    expectedVersion:1,
    requestId:'req-transition-2',
    reason:'Receiving clinician identified but has not accepted ownership yet.',
    evidenceRef:'handover-note-2',
    externalCareSource:'Outside neurologist',
    previousInstructions:'Continue duloxetine 30 mg nightly until reviewed.',
    newInstructions:'Await local clinician confirmation before changing medication.',
    discrepancies:'Outside plan listed gabapentin as active.',
    pendingWork:['Confirm current medication list','Call receiving clinician'],
    resolvedPendingWork:[],
    receivingClinician:'Dr. Maya Chen',
    ownershipAccepted:false,
    reconciledInstructions:'',
    patientCommunication:'',
    handoverStatus:'ownership-pending',
    owner:'Care coordinator',
    dueDate:'2026-09-18',
  });
  state=apply(state,{
    type:'treatment-continuity.record-transition',
    patientId:'p-1',
    id:'transition-1',
    expectedVersion:2,
    requestId:'req-transition-2b',
    reason:'Updated ownership notes without moving the handover state.',
    evidenceRef:'handover-note-2b',
    externalCareSource:'Outside neurologist',
    previousInstructions:'Continue duloxetine 30 mg nightly until reviewed.',
    newInstructions:'Await local clinician confirmation before changing medication.',
    discrepancies:'Outside plan listed gabapentin as active.',
    pendingWork:['Confirm current medication list','Call receiving clinician'],
    resolvedPendingWork:[],
    receivingClinician:'Dr. Maya Chen',
    ownershipAccepted:false,
    reconciledInstructions:'',
    patientCommunication:'',
    handoverStatus:'ownership-pending',
    owner:'Taylor Reed, RN',
    dueDate:'2026-09-19',
  });
  assert.equal(state.transitions[0].version,3);
  assert.equal(state.transitions[0].owner,'Taylor Reed, RN');
  assert.throws(()=>apply(state,{
    type:'treatment-continuity.record-transition',
    patientId:'p-1',
    id:'transition-1',
    expectedVersion:3,
    requestId:'req-transition-3',
    reason:'Attempted to hide pending work.',
    evidenceRef:'handover-note-3',
    externalCareSource:'Outside neurologist',
    previousInstructions:'Continue duloxetine 30 mg nightly until reviewed.',
    newInstructions:'Await local clinician confirmation before changing medication.',
    discrepancies:'Outside plan listed gabapentin as active.',
    pendingWork:['Call receiving clinician'],
    resolvedPendingWork:[],
    receivingClinician:'Dr. Maya Chen',
    ownershipAccepted:true,
    reconciledInstructions:'Medication list reconciled.',
    patientCommunication:'Patient informed of the handover.',
    handoverStatus:'instructions-reconciled',
    owner:'Care coordinator',
    dueDate:'2026-09-18',
  }),/cannot disappear/);
  state=apply(state,{
    type:'treatment-continuity.record-transition',
    patientId:'p-1',
    id:'transition-1',
    expectedVersion:3,
    requestId:'req-transition-4',
    reason:'Medication list reconciled and one task closed explicitly.',
    evidenceRef:'handover-note-4',
    externalCareSource:'Outside neurologist',
    previousInstructions:'Continue duloxetine 30 mg nightly until reviewed.',
    newInstructions:'Await local clinician confirmation before changing medication.',
    discrepancies:'Outside plan listed gabapentin as active.',
    pendingWork:['Call receiving clinician'],
    resolvedPendingWork:['Confirm current medication list'],
    receivingClinician:'Dr. Maya Chen',
    ownershipAccepted:true,
    reconciledInstructions:'Medication list reconciled with the patient.',
    patientCommunication:'Patient informed that local review is pending.',
    handoverStatus:'instructions-reconciled',
    owner:'Care coordinator',
    dueDate:'2026-09-18',
  });
  state=apply(state,{
    type:'treatment-continuity.record-transition',
    patientId:'p-1',
    id:'transition-1',
    expectedVersion:4,
    requestId:'req-transition-5',
    reason:'Patient received the updated instructions.',
    evidenceRef:'handover-note-5',
    externalCareSource:'Outside neurologist',
    previousInstructions:'Continue duloxetine 30 mg nightly until reviewed.',
    newInstructions:'Await local clinician confirmation before changing medication.',
    discrepancies:'Outside plan listed gabapentin as active.',
    pendingWork:['Call receiving clinician'],
    resolvedPendingWork:['Confirm current medication list'],
    receivingClinician:'Dr. Maya Chen',
    ownershipAccepted:true,
    reconciledInstructions:'Medication list reconciled with the patient.',
    patientCommunication:'Called the patient and reviewed the current instructions.',
    handoverStatus:'patient-communicated',
    owner:'Care coordinator',
    dueDate:'2026-09-18',
  });
  assert.throws(()=>apply(state,{
    type:'treatment-continuity.record-transition',
    patientId:'p-1',
    id:'transition-1',
    expectedVersion:5,
    requestId:'req-transition-6',
    reason:'Tried to complete with open work.',
    evidenceRef:'handover-note-6',
    externalCareSource:'Outside neurologist',
    previousInstructions:'Continue duloxetine 30 mg nightly until reviewed.',
    newInstructions:'Await local clinician confirmation before changing medication.',
    discrepancies:'Outside plan listed gabapentin as active.',
    pendingWork:['Call receiving clinician'],
    resolvedPendingWork:['Confirm current medication list'],
    receivingClinician:'Dr. Maya Chen',
    ownershipAccepted:true,
    reconciledInstructions:'Medication list reconciled with the patient.',
    patientCommunication:'Called the patient and reviewed the current instructions.',
    handoverStatus:'completed',
    owner:'Care coordinator',
    dueDate:'2026-09-18',
  }),/Completed handovers require/);
  state=apply(state,{
    type:'treatment-continuity.record-transition',
    patientId:'p-1',
    id:'transition-1',
    expectedVersion:5,
    requestId:'req-transition-7',
    reason:'Receiving clinician accepted ownership and the remaining task was closed.',
    evidenceRef:'handover-note-7',
    externalCareSource:'Outside neurologist',
    previousInstructions:'Continue duloxetine 30 mg nightly until reviewed.',
    newInstructions:'Await local clinician confirmation before changing medication.',
    discrepancies:'Outside plan listed gabapentin as active.',
    pendingWork:[],
    resolvedPendingWork:['Confirm current medication list','Call receiving clinician'],
    receivingClinician:'Dr. Maya Chen',
    ownershipAccepted:true,
    reconciledInstructions:'Medication list reconciled with the patient.',
    patientCommunication:'Called the patient and reviewed the current instructions.',
    handoverStatus:'completed',
    owner:'Care coordinator',
    dueDate:'2026-09-18',
  });
  assert.equal(state.transitions[0].handoverStatus,'completed');
  assert.deepEqual(state.transitions[0].resolvedPendingWork,['Confirm current medication list','Call receiving clinician']);
  assert.equal(state.transitions[0].history.length,6);
  } finally {
    mock.timers.reset();
  }
});

test('multidisciplinary records and panel rendering surface accessible workflow state and integration boundaries',()=>{
  let state=apply(initialState(),{
    type:'treatment-continuity.update-multidisciplinary',
    patientId:'p-1',
    id:'multi-1',
    requestId:'req-multi-1',
    reason:'Documented concurrent physical therapy.',
    evidenceRef:'pt-note-1',
    functionalGoal:'Walk 20 minutes with fewer rest breaks',
    interventions:[{
      id:'intervention-1',
      title:'Physical therapy home program',
      professional:'Jamie Cole, PT',
      status:'blocked',
      accessBarrier:'Transportation is unreliable this week.',
      patientExperience:'Patient reports the exercises were manageable when transportation was available.',
      observedOutcome:'No cure claim; endurance still limited.',
      decision:'change',
    }],
    owner:'Jamie Cole, PT',
    dueDate:'2026-09-22',
  });
  state=apply(state,{
    type:'treatment-continuity.record-reconciliation',
    patientId:'p-1',
    id:'recon-2',
    requestId:'req-recon-2',
    reason:'No discrepancy remained after review.',
    evidenceRef:'med-list-2',
    source:'Patient interview',
    sourceDate:'2026-09-17',
    status:'confirmed-none',
    reviewer:'Dr. Maya Chen',
    resolution:'No discrepancies were identified in the current interview.',
    conflicts:[],
    owner:'Dr. Maya Chen',
    dueDate:'2026-09-22',
    bridge:{medications:[{id:'med-2',name:'Topical lidocaine',recordedAt:'2026-09-17'}],integrationStatus:'unconfigured'},
  });

  const html=renderToStaticMarkup(React.createElement(TreatmentContinuityPanel,{
    patientId:'p-1',
    patients:baseContext.patients,
    state,
    busy:false,
    onAction:async()=>true,
    bridge:{'p-1':{medications:[{id:'med-2',name:'Topical lidocaine',recordedAt:'2026-09-17'}],clinicalContext:{recordedAt:'2026-09-12',summary:'Neuropathy follow-up'},integrationStatus:'unconfigured'}},
    clinicalContext:{recordedAt:'2026-09-12',summary:'Neuropathy follow-up'},
  }));
  const chooserHtml=renderToStaticMarkup(React.createElement(TreatmentContinuityPanel,{
    patients:baseContext.patients,
    state,
    busy:false,
    onAction:async()=>true,
  }));

  assert.match(html,/Treatment continuity/);
  assert.match(html,/Manual documentation stays separate from any unconfigured partner integrations/);
  assert.match(html,/Existing-record bridge/);
  assert.match(html,/Integration status: unconfigured/);
  assert.match(html,/data-journey="J03"><h3>Reconciliation</);
  assert.match(html,/data-journey="J34"><h3>Multidisciplinary care</);
  assert.doesNotMatch(html.replace(/<[^>]+>/g,' '),/\bJ\d{2}\b/,'internal journey codes stay out of visible text');
  assert.match(html,/Save reconciliation/);
  assert.match(html,/Save multidisciplinary care/);
  assert.match(html,/Physical therapy home program/);
  assert.match(html,/No discrepancies were identified in the current interview/);
  assert.match(chooserHtml,/aria-label=\"Patient selection\"/);
  assert.doesNotMatch(chooserHtml,/aria-label=\"Patient selection\"[^>]*disabled/);
  assert.equal(getSummary(state,'p-1').open,2);
  assert.ok(getSummary(state,'p-1').attention.some(item=>item.includes('both sources')),'Incomplete provenance remains visible after a legacy confirmation');
});

test('existing treatment IDs cannot be reassigned to another known patient and history remains immutable',()=>{
  const command={type:'treatment-continuity.manage-access',patientId:'p-1',id:'protected-access',requestId:'protect-create',reason:'Patient reported a cost barrier.',evidenceRef:'Care note',barrierType:'cost',status:'unresolved',patientChoice:'Wants care.',outreach:'Called patient.',alternatives:'',requiresClinicianReview:false,resolution:'',owner:'Nurse',dueDate:'2026-09-25'};
  const state=apply(initialState(),command);
  const update={...command,expectedVersion:1,requestId:'protect-update',outreach:'Called pharmacy.'};
  assert.throws(()=>apply(state,{...update,patientId:'p-2'}),/wrong patient/);
  assert.throws(()=>apply(state,update,{...baseContext,now:'2026-09-23T12:00:00Z'}),/backwards/);
  assert.throws(()=>apply(initialState(),update),/does not exist/);
  assert.equal(actionSchema.safeParse({...command,dueDate:'2026-02-30'}).success,false);
  assert.equal(actionSchema.safeParse({...command,updatedBy:'Injected author'}).success,false);
  const next=apply(state,update);
  assert.equal(JSON.parse(next.accessBarriers[0].history[0].previousSnapshot).outreach,'Called patient.');
  next.accessBarriers[0].history[1].reason='Modified returned state';
  assert.equal(state.accessBarriers[0].history[0].reason,'Patient reported a cost barrier.');
});

test('reconciliation accepts exact saved medication and clinical-context timestamps without losing provenance',()=>{
  const timestamp='2026-09-20T16:34:00Z';
  const state=apply(initialState(),{type:'treatment-continuity.record-reconciliation',patientId:'p-1',requestId:'timestamp-bridge',reason:'Reviewed the saved chart records.',source:'Existing chart',sourceDate:'2026-09-20',status:'confirmed-none',reviewer:'Dr. Maya Chen',resolution:'Clinician confirmed no discrepancy.',conflicts:[],bridge:{medications:[{id:'saved-medication',name:'Recorded medicine',recordedAt:timestamp}],clinicalContext:{recordedAt:timestamp,summary:'Recorded clinical context'},integrationStatus:'unconfigured'}});
  assert.equal(state.reconciliations[0].bridge.medications[0].recordedAt,timestamp);
  assert.equal(state.reconciliations[0].bridge.clinicalContext.recordedAt,timestamp);
});

test('treatment idempotency survives more than 60 later updates without permitting changed payloads',()=>{
  const command={type:'treatment-continuity.manage-access',patientId:'p-1',id:'long-lived-access',requestId:'original-request',reason:'Initial outreach.',evidenceRef:'Care note',barrierType:'cost',status:'unresolved',patientChoice:'Wants care.',outreach:'Initial call.',alternatives:'',requiresClinicianReview:false,resolution:'',owner:'Nurse',dueDate:'2026-09-25'};
  let state=apply(initialState(),command);
  for(let index=1;index<=62;index++)state=apply(state,{...command,requestId:`follow-up-${index}`,expectedVersion:index,outreach:`Follow-up ${index}`});
  assert.deepEqual(apply(state,command),state);
  assert.throws(()=>apply(state,{...command,outreach:'Changed original content'}),/different payload/);
  assert.throws(()=>apply(state,command,{...baseContext,actor:'Another clinician'}),/different actor/);
  assert.equal(state.accessBarriers[0].version,63);
});

test('handover stages cannot assert reconciliation or communication before evidence is present',()=>{
  const command={type:'treatment-continuity.record-transition',patientId:'p-1',id:'gated-handover',requestId:'handover-draft',reason:'New handover.',externalCareSource:'Outside clinic',previousInstructions:'Prior care instructions',newInstructions:'Proposed instructions',discrepancies:'',pendingWork:['Confirm medication list'],resolvedPendingWork:[],receivingClinician:'Receiving clinician',ownershipAccepted:false,reconciledInstructions:'',patientCommunication:'',handoverStatus:'draft',owner:'Coordinator',dueDate:'2026-09-25'};
  let state=apply(initialState(),command);
  state=apply(state,{...command,requestId:'handover-ownership',expectedVersion:1,handoverStatus:'ownership-pending'});
  assert.throws(()=>apply(state,{...command,requestId:'handover-false-reconciliation',expectedVersion:2,handoverStatus:'instructions-reconciled'}),/accepted ownership/);
  state=apply(state,{...command,requestId:'handover-reconciled',expectedVersion:2,handoverStatus:'instructions-reconciled',ownershipAccepted:true,reconciledInstructions:'Receiving clinician reviewed the plan.'});
  assert.throws(()=>apply(state,{...command,requestId:'handover-false-communication',expectedVersion:3,handoverStatus:'patient-communicated',ownershipAccepted:true,reconciledInstructions:'Receiving clinician reviewed the plan.'}),/communication must be documented/);
});

test('concurrent interventions stay visible and cannot disappear or reopen silently',()=>{
  const interventions=[{id:'pt',title:'Physical therapy',professional:'Physiotherapist',status:'active',accessBarrier:'',patientExperience:'Tolerated',observedOutcome:'Walking goal in progress',decision:'continue'},{id:'ot',title:'Occupational therapy',professional:'Occupational therapist',status:'active',accessBarrier:'',patientExperience:'Tolerated',observedOutcome:'Daily activities improving',decision:'continue'}];
  const command={type:'treatment-continuity.update-multidisciplinary',patientId:'p-1',id:'concurrent-care',requestId:'multi-create',reason:'Documented concurrent care.',functionalGoal:'Maintain independence',interventions,owner:'Care team',dueDate:'2026-09-25'};
  let state=apply(initialState(),command);
  assert.throws(()=>apply(state,{...command,requestId:'multi-drop',expectedVersion:1,interventions:[interventions[0]]}),/cannot disappear/);
  state=apply(state,{...command,requestId:'multi-close',expectedVersion:1,interventions:interventions.map(item=>({...item,status:'closed',decision:'closure'}))});
  assert.throws(()=>apply(state,{...command,requestId:'multi-reopen',expectedVersion:2}),/Invalid intervention transition/);
  const html=renderToStaticMarkup(React.createElement(TreatmentContinuityPanel,{patientId:'p-1',patients:baseContext.patients,state,busy:false,onAction:async()=>true}));
  assert.match(html,/value="Physical therapy"/);assert.match(html,/value="Occupational therapy"/);
  assert.match(html,/Add intervention/);assert.match(html,/Create a new record/);
});

test('detailed reconciliation requires dated sources, owner and review while legacy facts stay readable',()=>{
  const evidence={source:'Discharge medicine list',author:'Hospital pharmacist',collectedAt:'2026-09-20T09:00:00Z',receivedAt:'2026-09-21T10:00:00Z',reference:'Discharge list page 2'};
  const command={type:'treatment-continuity.record-reconciliation',patientId:'p-1',requestId:'dated-reconciliation',reason:'Patient describes a different current regimen.',source:'Hospital discharge list',sourceDate:'2026-09-20',status:'unreviewed',conflicts:[{field:'Current medicine',patientFact:'Patient reports current use.',externalFact:'Discharge list omits this medicine.',outcome:'unreviewed'}],owner:'Care coordinator',dueDate:'2026-09-25',provenance:{patient:{...evidence,source:'Patient telephone report',author:'Patient'},external:evidence,nextAction:'Confirm current use with the usual prescriber.'}};
  assert.throws(()=>apply(initialState(),{...command,owner:''}),/responsible owner/);
  assert.throws(()=>apply(initialState(),{...command,provenance:{...command.provenance,external:{...evidence,collectedAt:'2026-09-22T09:00:00Z'}}}),/receipt cannot precede/);
  let state=apply(initialState(),command);
  const update={...command,id:state.reconciliations[0].id,expectedVersion:1,requestId:'dated-reconciliation-review',status:'resolved',resolution:'Usual prescriber confirmed the current list.',conflicts:command.conflicts.map(item=>({...item,outcome:'resolved'}))};
  assert.throws(()=>apply(state,update),/attributed completed review/);
  state=apply(state,{...update,provenance:{...command.provenance,reviewedBy:'Dr. Maya Chen',reviewedAt:baseContext.now}});
  assert.equal(domain.missingRequirements(state.reconciliations[0]).length,0);
  assert.equal(JSON.parse(state.reconciliations[0].history[0].previousSnapshot).conflicts[0].outcome,'unreviewed');
});

test('regimen-specific response cannot reuse the previous report and no-change requires agreement and follow-up',()=>{
  const command={type:'treatment-continuity.record-experience',patientId:'p-1',requestId:'period-1',reason:'Reviewed activity and treatment experience.',medicationName:'Recorded medicine',reportedUse:'active',regimen:'Regimen recorded on the current order',regimenStartedAt:'2026-09-01',regimenDurationDays:20,reportedBenefit:'helpful',tolerability:'side-effects',functionalGoal:'Complete the walk to work',patientConcern:'Walking remains harder despite reported pain relief.',trialStatus:'active',reassessmentDecision:'no-change',owner:'Dr. Maya Chen',dueDate:'2026-10-01',responseReview:{regimenVersion:1,periodStart:'2026-09-01',periodEnd:'2026-09-20',reportedAt:'2026-09-21T10:00:00Z',source:'Patient visit report',patientAgreement:'agreed'}};
  assert.throws(()=>apply(initialState(),{...command,dueDate:''}),/next review/);
  const state=apply(initialState(),command),change={...command,id:state.experiences[0].id,expectedVersion:1,requestId:'period-2',evidenceRef:'New order reviewed',regimen:'Changed recorded regimen',regimenStartedAt:'2026-09-22',regimenDurationDays:2,responseReview:{...command.responseReview,regimenVersion:2}};
  assert.throws(()=>apply(state,change),/earlier regimen/);
  const next=apply(state,{...change,responseReview:{...change.responseReview,periodStart:'2026-09-22',periodEnd:'2026-09-23',reportedAt:baseContext.now}});
  assert.equal(next.experiences[0].responseReview.regimenVersion,2);
  assert.equal(JSON.parse(next.experiences[0].history[0].previousSnapshot).responseReview.regimenVersion,1);
});

test('exact-order evidence separates authority, pharmacy receipt, dispensing and actual use',()=>{
  const orderEvidence={orderId:'external-order-492',regimen:'Exact regimen copied from the authorized order',regimenVersion:1,prescriber:'Dr. Maya Chen',authority:'manual-attestation',authorizationRef:'Signed outside prescription',authorizedAt:'2026-09-20T09:00:00Z',actualUse:'not-obtained',useReportedAt:baseContext.now,useSource:'Patient report'};
  const command={type:'treatment-continuity.update-lifecycle',patientId:'p-1',requestId:'order-1',reason:'Document the agreed medication order.',medicationName:'Recorded medicine',stage:'considered',manualSource:'Outside prescription record',evidenceRef:'Order 492',safetyPrerequisites:['Recorded review complete'],reviewPrerequisites:['Current list reviewed'],prescriberResponsibility:'Named outside prescriber',clinicalServiceAvailable:true,owner:'Care coordinator',dueDate:'2026-09-25',orderEvidence};
  let state=apply(initialState(),command),count=1;
  const save=(stage,extra={})=>{state=apply(state,{...command,id:state.lifecycles[0].id,expectedVersion:state.lifecycles[0].version,requestId:'order-'+(++count),stage,...extra});};
  save('clinician-review');
  assert.throws(()=>apply(state,{...command,id:state.lifecycles[0].id,expectedVersion:2,requestId:'order-denied',stage:'authorization-recorded',orderEvidence:{...orderEvidence,authority:'demo-service'}}),/not authorized/);
  save('authorization-recorded');save('external-transmission-reported');
  assert.throws(()=>save('dispensing-reported'),/acknowledgement/);
  const pharmacy={...orderEvidence,pharmacyReceipt:'Pharmacy confirmed receipt by telephone',pharmacyReceivedAt:'2026-09-21T10:00:00Z'};
  save('pharmacy-received',{orderEvidence:pharmacy});save('clarification-needed',{orderEvidence:{...pharmacy,clarification:'Pharmacy is checking supply.'}});save('pharmacy-received',{orderEvidence:pharmacy});
  const dispensed={...pharmacy,dispensingRef:'Pharmacy collection record',dispensedAt:'2026-09-22T10:00:00Z'};
  save('dispensing-reported',{orderEvidence:dispensed});assert.equal(state.lifecycles[0].orderEvidence.actualUse,'not-obtained');
  assert.throws(()=>save('started-reported',{orderEvidence:dispensed}),/dated patient report/);
  assert.throws(()=>save('started-reported',{orderEvidence:{...dispensed,actualUse:'started',startedAt:'2026-09-21'}}),/precede its dispensing/);
  save('started-reported',{orderEvidence:{...dispensed,actualUse:'started',startedAt:'2026-09-23'}});
  assert.equal(state.lifecycles[0].stage,'started-reported');
});

test('access verification cannot resolve an estimate or bypass clinical alternative review',()=>{
  const ref={domain:'results-referrals',id:'referral-for-p1',version:2},context={...baseContext,careActions:[{...ref,patientId:'p-1',title:'Rehabilitation referral'}]};
  const accessReview={careAction:ref,verification:'estimated',source:'Service benefits desk',checkedAt:baseContext.now,details:'Coverage estimate; eligibility is not confirmed.',alternativeDecision:'pending',patientAgreement:'not-discussed',actualStart:'not-started',actualStartSource:'Patient has not attended'};
  const command={type:'treatment-continuity.manage-access',patientId:'p-1',requestId:'access-detail-1',reason:'Resolve an appointment access barrier.',barrierType:'coverage',status:'unresolved',patientChoice:'Would like an appointment after work.',outreach:'Coordinator contacted the service.',alternatives:'Telephone consultation if appropriate.',requiresClinicianReview:true,owner:'Care coordinator',dueDate:'2026-09-26',accessReview};
  const state=apply(initialState(),command,context),update={...command,id:state.accessBarriers[0].id,expectedVersion:1,requestId:'access-detail-2',status:'resolved',resolution:'Patient and service agreed the route.'};
  assert.throws(()=>apply(state,update,context),/not confirmed/);
  assert.throws(()=>apply(state,{...update,accessReview:{...accessReview,verification:'confirmed'}},context),/must be reviewed/);
  assert.throws(()=>apply(state,{...update,patientId:'p-2'},context),/patient/);
  const next=apply(state,{...update,accessReview:{...accessReview,verification:'confirmed',alternativeDecision:'approved',reviewer:'Dr. Maya Chen',reviewedAt:baseContext.now,patientAgreement:'agreed'}},context);
  assert.equal(next.accessBarriers[0].accessReview.actualStart,'not-started');
});

test('accepted handover retains linked open work and cannot claim another patient’s result',()=>{
  const ref={domain:'results-referrals',id:'pending-result',version:4},context={...baseContext,careActions:[{...ref,patientId:'p-1',title:'Pending investigation'}]},source={source:'Discharge summary',author:'Discharge clinician',collectedAt:null,receivedAt:baseContext.now,reference:'Discharge document'};
  const handoverEvidence={source,patientAccount:'Patient describes the previous instructions.',backupOwner:'On-call clinician',acceptance:'pending',pendingTransfers:[],timezone:'Europe/Lisbon'};
  const command={type:'treatment-continuity.record-transition',patientId:'p-1',requestId:'transfer-details-1',reason:'Review hospital discharge instructions.',externalCareSource:'Hospital',previousInstructions:'Previous instructions retained.',newInstructions:'Incoming instructions retained.',discrepancies:'Medication timing differs.',pendingWork:['Review the investigation result'],resolvedPendingWork:[],receivingClinician:'Covering clinician',ownershipAccepted:false,reconciledInstructions:'',patientCommunication:'',handoverStatus:'draft',owner:'Usual care team',dueDate:'2026-09-25',handoverEvidence};
  let state=apply(initialState(),command,context),count=1;
  const save=(handoverStatus,fields={})=>{state=apply(state,{...command,id:state.transitions[0].id,expectedVersion:state.transitions[0].version,requestId:'transfer-details-'+(++count),handoverStatus,...fields},context);};
  save('ownership-pending');
  const accepted={...handoverEvidence,acceptance:'accepted',acceptedBy:'Covering clinician',acceptedAt:baseContext.now,acceptanceEvidence:'Covering clinician accepted by telephone',teachBack:'Patient described when to call the team.',pendingTransfers:[{title:command.pendingWork[0],ref,disposition:'accepted-transfer',owner:'Covering clinician',backupOwner:'On-call clinician',acceptedAt:baseContext.now,evidenceRef:'Accepted investigation follow-up'}]};
  const fields={ownershipAccepted:true,reconciledInstructions:'Reviewed current instructions.',patientCommunication:'Discussed with patient.',handoverEvidence:accepted};
  save('instructions-reconciled',fields);save('patient-communicated',fields);
  assert.throws(()=>save('completed',{...fields,handoverEvidence:{...accepted,pendingTransfers:[]}}),/remaining item/);
  save('completed',fields);assert.deepEqual(state.transitions[0].pendingWork,command.pendingWork);assert.equal(state.transitions[0].handoverEvidence.pendingTransfers[0].ref.id,'pending-result');
});

test('multidisciplinary review keeps participation dates, criteria and conflicting advice separate',()=>{
  const intervention={id:'pt',title:'Graded activity',professional:'Physiotherapist',status:'active',patientExperience:'Patient attended but found the session tiring.',observedOutcome:'Walking goal unchanged.',decision:'continue'};
  const review={interventionId:'pt',rationale:'Support the patient’s walking goal.',reviewCriterion:'Review walking duration and burden.',startedAt:'2026-09-18',participation:'attended',patientAgreement:'agreed',reviewDate:'2026-09-30',conflictingAdvice:'Different pacing advice from another professional.'};
  const command={type:'treatment-continuity.update-multidisciplinary',patientId:'p-1',requestId:'multi-details-1',reason:'Review coordinated care.',owner:'Coordinating clinician',dueDate:'2026-09-30',functionalGoal:'Walk to work',interventions:[intervention],interventionReviews:[review]};
  const state=apply(initialState(),command),update={...command,id:state.multidisciplinary[0].id,expectedVersion:1,requestId:'multi-details-2',interventions:[{...intervention,status:'completed',decision:'closure'}]};
  assert.throws(()=>apply(state,update),/conflicting advice/);
  const next=apply(state,{...update,interventionReviews:[{...review,reconciliation:'Team and patient agreed the pacing approach.'}]});
  assert.equal(next.multidisciplinary[0].interventionReviews[0].participation,'attended');
  assert.equal(next.multidisciplinary[0].interventions[0].observedOutcome,'Walking goal unchanged.');
});

test('linked access evidence rejects a foreign source even when the outer patient is correct',()=>{
  const ref={domain:'results-referrals',id:'foreign-referral',version:1};
  const command={type:'treatment-continuity.manage-access',patientId:'p-1',requestId:'foreign-access-ref',reason:'Record an access barrier.',barrierType:'transport',status:'unresolved',patientChoice:'Needs help reaching the appointment.',outreach:'Coordinator contacted transport services.',requiresClinicianReview:false,owner:'Coordinator',dueDate:'2026-09-25',accessReview:{careAction:ref,verification:'pending',source:'Transport service',checkedAt:baseContext.now,details:'Availability remains unconfirmed.',alternativeDecision:'none',patientAgreement:'agreed',actualStart:'not-started',actualStartSource:'Patient report'}};
  assert.throws(()=>apply(initialState(),command,{...baseContext,careActions:[{...ref,patientId:'p-2',title:'Another patient’s referral'}]}),/this patient/);
  assert.throws(()=>apply(initialState(),command,{...baseContext,careActions:[{...ref,version:2,patientId:'p-1',title:'Updated referral'}]}),/changed/);
});

test('isolated demonstration authorization is patient and scope bound and cannot duplicate an exact order',()=>{
  const orderEvidence={orderId:'demo-authorized-order',regimen:'Regimen copied from the fictional source order',regimenVersion:1,prescriber:'demo-prescriber',authority:'demo-service',authorizationRef:'Local demonstration authorization receipt',authorizedAt:baseContext.now,actualUse:'unknown',useReportedAt:baseContext.now,useSource:'Not yet reported by the patient'};
  const command={type:'treatment-continuity.update-lifecycle',patientId:'p-1',requestId:'demo-order-1',reason:'Review the exact recorded order.',medicationName:'Recorded medicine',stage:'considered',manualSource:'Local demonstration service',evidenceRef:'Demonstration receipt',safetyPrerequisites:['Required checks reviewed'],reviewPrerequisites:['Current use reviewed'],prescriberResponsibility:'Designated demonstration prescriber',clinicalServiceAvailable:true,owner:'Prescriber',dueDate:'2026-09-25',orderEvidence};
  let state=apply(initialState(),command);state=apply(state,{...command,id:state.lifecycles[0].id,expectedVersion:1,requestId:'demo-order-2',stage:'clinician-review'});
  const authorization={...command,id:state.lifecycles[0].id,expectedVersion:2,requestId:'demo-order-3',stage:'authorization-recorded'};
  const authority={patientId:'p-1',principalId:'demo-prescriber',canPrescribe:true,scopeSupported:true};
  assert.throws(()=>apply(state,authorization,{...baseContext,demoClinicalAuthority:{...authority,patientId:'p-2'}}),/not authorized/);
  assert.throws(()=>apply(state,authorization,{...baseContext,demoClinicalAuthority:{...authority,scopeSupported:false}}),/not authorized/);
  state=apply(state,authorization,{...baseContext,demoClinicalAuthority:authority});assert.equal(state.lifecycles[0].stage,'authorization-recorded');
  assert.throws(()=>apply(state,{...command,requestId:'duplicate-order-new-request'}),/already recorded/);
});
