import assert from 'node:assert/strict';

// This is documentation workflow acceptance only. Every evidence locator below is
// labelled synthetic and none is an external clinical, legal, or deployment approval.
export async function runScenarios(driver){
  const suffix=crypto.randomUUID();
  const date=driver.now.slice(0,10);
  const make=(type,fields={})=>({type:`program-governance.${type}`,requestId:crypto.randomUUID(),...fields});
  const current=(collection,id)=>driver.state()[collection].find(record=>record.id===id);
  const edit=(collection,id,fields={})=>({id,expectedVersion:current(collection,id).version,...fields});
  const latest=(collection)=>driver.state()[collection][0];
  const synthetic='Synthetic acceptance review; documentation only.';
  const evidenceLocator=`synthetic://governance/${suffix}`;
  const features=driver.workspace().features;
  const existingActive=driver.state().configurations.find(record=>record.id===driver.state().activeConfigurationId);
  const essentials=[...new Set(['Named reviewer',...(existingActive?.nonHideableSafetyEssentials??[])])];
  const capabilities=['assessments','messages','reviewPrompts','pathways'].filter(key=>features[key]).slice(0,2);
  assert.ok(capabilities.length,'Acceptance scenario needs one enabled standalone capability.');

  const configuration={title:`Synthetic configuration ${suffix}`,capabilityChoices:capabilities,allowedCadence:['weekly'],languages:['English'],communicationSettings:['in-app'],displayReferences:['Synthetic evaluation settings'],safetyEssentials:essentials,nonHideableSafetyEssentials:essentials};
  await driver.apply(make('configuration-save-draft',{record:configuration}));
  const configId=latest('configurations').id;
  await driver.expectRejected(make('configuration-activate',edit('configurations',configId,{reason:synthetic})));
  await driver.apply(make('configuration-review',edit('configurations',configId,{reviewNote:synthetic})));
  await driver.apply(make('configuration-activate',edit('configurations',configId,{reason:synthetic})));
  assert.equal(driver.state().activeConfigurationId,configId);
  assert.equal(current('configurations',configId).status,'active');
  await driver.expectRejected(make('configuration-save-draft',edit('configurations',configId,{record:{...configuration,title:'Attempt to rewrite active configuration'}})));
  assert.equal(current('configurations',configId).revisions.find(version=>version.version===1).record.status,'draft');
  driver.record('J22','passed');

  const protocol={title:`Synthetic operational protocol ${suffix}`,owner:'Acceptance operations reviewer',evidenceLocator,publicationChecks:{sourceVersion:'synthetic-1',rightsEvidence:evidenceLocator,clinicalReview:evidenceLocator,implementationReview:evidenceLocator,fixtureEvidence:evidenceLocator,migrationPolicy:'Preserve assigned versions until explicit migration review',rollbackPlan:'Retain earlier published snapshots'},unresolvedQuestions:[],steps:[{id:'review-note',title:'Review the synthetic operational note',owner:'Acceptance operations reviewer',kind:'action',prerequisites:[],nextStepIds:['handoff'],branchStepIds:[],openQuestion:''},{id:'handoff',title:'Record the documented owner handoff',owner:'Acceptance coordinator',kind:'handoff',prerequisites:['review-note'],nextStepIds:[],branchStepIds:[],openQuestion:''}]};
  await driver.apply(make('protocol-save-draft',{record:protocol}));
  const protocolId=latest('protocols').id;
  await driver.expectRejected(make('protocol-record-publication',edit('protocols',protocolId,{evidenceRef:evidenceLocator,reason:synthetic})));
  await driver.apply(make('protocol-request-review',edit('protocols',protocolId,{reason:synthetic})));
  await driver.apply(make('protocol-record-review',edit('protocols',protocolId,{outcome:'reviewed',reviewer:'Acceptance protocol reviewer',evidenceLocator,reason:synthetic})));
  await driver.apply(make('protocol-record-publication',edit('protocols',protocolId,{evidenceRef:evidenceLocator,reason:synthetic})));
  const published=structuredClone(current('protocols',protocolId));
  await driver.apply(make('protocol-assign-episode',{patientId:driver.patientId,encounterId:`governance-${suffix}`,protocolId,expectedProtocolVersion:published.version,expectedAssignmentVersion:0,reason:synthetic}));
  await driver.apply(make('protocol-save-draft',edit('protocols',protocolId,{record:{...protocol,title:`Revised synthetic protocol ${suffix}`,steps:protocol.steps.map((step,index)=>index===0?{...step,title:'Revised operational note instruction'}:step)}})));
  const assigned=driver.state().protocolAssignments.find(record=>record.patientId===driver.patientId&&record.encounterId===`governance-${suffix}`);
  assert.equal(assigned.protocolVersion,published.version);
  assert.deepEqual(assigned.protocolSnapshot,published);
  assert.equal(current('protocols',protocolId).revisions.find(revision=>revision.version===published.version).record.steps[0].title,protocol.steps[0].title);
  await driver.apply(make('protocol-request-review',edit('protocols',protocolId,{reason:synthetic})));
  await driver.apply(make('protocol-record-review',edit('protocols',protocolId,{outcome:'reviewed',reviewer:'Acceptance implementation reviewer',evidenceLocator,reason:synthetic})));
  await driver.apply(make('protocol-record-publication',edit('protocols',protocolId,{evidenceRef:evidenceLocator,reason:synthetic})));
  const episode=driver.workspace().clinicalWorkflows?.slices['patient-coordination'].state.pathways.find(record=>record.protocolAssignmentId===assigned.id);
  const migration={id:assigned.id,expectedVersion:assigned.version,...(episode?.version?{expectedEpisodeVersion:episode.version}:{}),targetProtocolId:protocolId,expectedProtocolVersion:current('protocols',protocolId).version,stageMap:protocol.steps.map(step=>({oldStepId:step.id,newStepId:step.id,carryStatus:false})),pendingWork:[],reason:synthetic,evidenceRef:evidenceLocator};
  await driver.expectRejected(make('protocol-migrate-episode',migration));
  await driver.apply(make('protocol-migrate-episode',{...migration,pendingWork:protocol.steps.map(step=>({oldStepId:step.id,disposition:'carry',owner:step.owner,evidenceRef:evidenceLocator}))}));
  const migrated=current('protocolAssignments',assigned.id);
  assert.equal(migrated.protocolVersion,current('protocols',protocolId).version);
  assert.deepEqual(migrated.revisions[0].record.protocolSnapshot,published);
  driver.record('J23','passed');

  const evidence={title:`Synthetic evidence memo ${suffix}`,indication:'Operational evaluation only',population:'Synthetic records',endpoint:'Documented workflow completion',supportingSources:[{title:'Synthetic dated evidence memo',locator:evidenceLocator,kind:'supporting',publicationDate:date,retracted:false}],rights:'owned'};
  await driver.apply(make('evidence-save-draft',{record:evidence}));
  const evidenceId=latest('evidences').id;
  await driver.expectRejected(make('evidence-record-review',edit('evidences',evidenceId,{outcome:'approved',reviewer:'Acceptance evidence reviewer',reason:synthetic})));
  await driver.apply(make('evidence-request-review',edit('evidences',evidenceId,{reason:synthetic})));
  await driver.apply(make('evidence-record-review',edit('evidences',evidenceId,{outcome:'approved',reviewer:'Acceptance evidence reviewer',reason:synthetic})));
  assert.equal(current('evidences',evidenceId).status,'approved');
  driver.record('J24','passed');

  const release={title:`Synthetic release ${suffix}`,modelId:'synthetic-review-model',softwareId:'acceptance-software',configurationId:configId,intendedUse:'Synthetic operational documentation workflow',evidenceRefIds:[evidenceId],modelClaims:['Synthetic documented evaluation result'],evaluation:{agreementSummary:'Agreement is descriptive only.',performanceSummary:'Synthetic fixture evidence only.',limitations:'No clinical validation or deployment.'},unresolvedConditions:['Synthetic checklist review pending'],overrideTrainingPolicy:'Manual review only'};
  await driver.apply(make('release-save-draft',{record:release}));
  const releaseId=latest('releases').id;
  await driver.expectRejected(make('release-record-review',edit('releases',releaseId,{reviewer:'Acceptance release reviewer',decision:'approved',unresolvedConditions:release.unresolvedConditions,reason:synthetic})));
  await driver.apply(make('release-record-review',edit('releases',releaseId,{reviewer:'Acceptance release reviewer',decision:'conditional-review',unresolvedConditions:release.unresolvedConditions,reason:synthetic})));
  await driver.apply(make('release-record-rollout',edit('releases',releaseId,{note:'Synthetic rollout observation only; no deployment occurred.'})));
  await driver.apply(make('release-record-rollback',edit('releases',releaseId,{note:'Synthetic rollback observation only; no rollback occurred.'})));
  await driver.apply(make('release-record-review',edit('releases',releaseId,{reviewer:'Acceptance release reviewer',decision:'approved',unresolvedConditions:[],reason:'Synthetic checklist reviewed. This is a documentation decision only.'})));
  assert.equal(current('releases',releaseId).decision,'approved');
  assert.equal(current('releases',releaseId).configurationVersion,current('configurations',configId).version);
  assert.equal(current('releases',releaseId).rolloutRecords.length,1);
  assert.equal(current('releases',releaseId).rollbackRecords.length,1);
  assert.equal(current('releases',releaseId).history[0].from,'conditional-review');
  driver.record('J25','passed');

  const operation={title:`Synthetic incident ${suffix}`,kind:'incident',affectedServices:['Synthetic evaluation service'],owner:'Acceptance operations reviewer',severity:'low',actionsTaken:['Documented synthetic investigation.'],evidenceRef:evidenceLocator,restoreOutcome:'not-applicable'};
  await driver.apply(make('operation-report',{record:operation}));
  const operationId=latest('operations').id;
  await driver.expectRejected(make('operation-close',edit('operations',operationId,{evidenceRef:evidenceLocator,reason:synthetic})));
  await driver.apply(make('operation-confirm',edit('operations',operationId,{owner:operation.owner,severity:operation.severity,reason:synthetic})));
  await driver.apply(make('operation-review',edit('operations',operationId,{evidenceRef:evidenceLocator,reason:synthetic})));
  const reconciliation={expectedEventManifestRef:`synthetic://event-manifest/${suffix}`,reconciliationEvidence:evidenceLocator,reviewer:operation.owner,events:[{eventId:`missing-event-${suffix}`,service:'Synthetic downstream service',owner:operation.owner,status:'missing',sourceReceipt:'',evidenceRef:''}],coverage:[],correctiveActions:['Review local event fixture'],remainingRisks:[]};
  await driver.apply(make('operation-reconcile',edit('operations',operationId,{record:reconciliation,reason:synthetic})));
  await driver.expectRejected(make('operation-close',edit('operations',operationId,{evidenceRef:evidenceLocator,reason:synthetic})));
  await driver.apply(make('operation-reconcile',edit('operations',operationId,{record:{...reconciliation,events:reconciliation.events.map(event=>({...event,status:'replayed',sourceReceipt:`synthetic://replay/${suffix}`,evidenceRef:evidenceLocator}))},reason:synthetic})));
  await driver.apply(make('operation-close',edit('operations',operationId,{evidenceRef:evidenceLocator,reason:synthetic})));
  assert.equal(current('operations',operationId).status,'closed');
  assert.equal(current('operations',operationId).closeEvidence,evidenceLocator);
  await driver.expectRejected(make('operation-report',edit('operations',operationId,{record:operation})));
  driver.record('J26','passed');

  const monitoring={serviceDate:date,activity:`Synthetic service review ${suffix}`,source:'Acceptance documentation',evidenceRef:evidenceLocator,missingDocumentation:[],patientId:driver.patientId,performerId:`Synthetic performer ${suffix}`,serviceCode:'DEMO-REVIEW',intervals:[{startAt:`${date}T00:00:00Z`,endAt:`${date}T00:01:00Z`,sourceEventId:`synthetic-service-${suffix}`}],ruleRef:{id:`demo-rule-${suffix}`,version:'1',payer:'Synthetic demonstration payer',jurisdiction:'Synthetic demonstration jurisdiction',effectiveFrom:date,effectiveTo:date,reviewer:'Synthetic rule reviewer',evidenceRef:evidenceLocator}};
  await driver.apply(make('monitoring-record-service',{record:monitoring}));
  const monitoringId=latest('monitoring').id;
  await driver.expectRejected(make('monitoring-record-service',{record:{...monitoring,activity:monitoring.activity.toUpperCase().replaceAll(' ','  ')}}));
  await driver.apply(make('monitoring-record-decision',edit('monitoring',monitoringId,{decision:'clarify',findings:[],reason:synthetic})));
  await driver.expectRejected(make('monitoring-export',edit('monitoring',monitoringId,{evidenceRef:evidenceLocator})));
  await driver.apply(make('monitoring-record-decision',edit('monitoring',monitoringId,{decision:'accept',findings:[],reason:synthetic})));
  assert.equal(current('monitoring',monitoringId).status,'reviewed');
  assert.equal(current('monitoring',monitoringId).decision,'accept');
  await driver.apply(make('monitoring-export',edit('monitoring',monitoringId,{evidenceRef:evidenceLocator})));
  assert.equal(current('monitoring',monitoringId).exportRecords[0].snapshot.ruleRef.version,'1');
  driver.record('J27','passed');

  const gates=[{id:'synthetic-evidence',title:'Synthetic evidence memo review',required:true,disposition:'open',evidenceRef:''},{id:'synthetic-partner',title:'Synthetic partner documentation review',required:true,disposition:'open',evidenceRef:''}];
  const readiness={releaseRef:{releaseId,artifactVersion:current('releases',releaseId).artifactVersion},scope:{capabilities,populationRefs:['synthetic-acceptance'],permittedRoles:['synthetic-reviewer'],inputRefs:['synthetic-fixture'],outputRefs:['synthetic-documentation'],claimRefs:['synthetic-only'],environment:'demo'},title:`Synthetic readiness ${suffix}`,functions:['Operational documentation'],claims:['Synthetic workflow coverage only'],partnerAssets:['Synthetic memo'],partnerRights:['Synthetic fixture ownership'],partnerResponsibilities:['Document synthetic review'],evidenceRefIds:[evidenceId],blockingConditions:[],mandatoryGates:gates};
  await driver.apply(make('readiness-save-draft',{record:readiness}));
  const readinessId=latest('readiness').id;
  await driver.expectRejected(make('readiness-record-decision',edit('readiness',readinessId,{reviewer:'Acceptance readiness reviewer',decision:'proposed',blockingConditions:[],mandatoryGates:[{...gates[0],disposition:'satisfied',evidenceRef:evidenceLocator}],reviewEvidence:evidenceLocator,reason:synthetic})));
  await driver.apply(make('readiness-record-decision',edit('readiness',readinessId,{reviewer:'Acceptance readiness reviewer',decision:'proposed',blockingConditions:[],mandatoryGates:gates.map(gate=>({...gate,disposition:'satisfied',evidenceRef:evidenceLocator})),reviewEvidence:evidenceLocator,reason:synthetic})));
  const proposed=structuredClone(current('readiness',readinessId));
  assert.equal(proposed.decision,'proposed');
  assert.match(proposed.regulatoryAuthorizationNote,/external gate/);

  await driver.apply(make('evidence-save-draft',edit('evidences',evidenceId,{record:{...evidence,endpoint:'Updated synthetic workflow endpoint requires another review'}})));
  assert.equal(current('releases',releaseId).reviewRequired,true);
  assert.equal(current('releases',releaseId).decision,'pending');
  assert.equal(current('readiness',readinessId).reviewRequired,true);
  assert.equal(current('readiness',readinessId).decision,'conditional-review');
  assert.equal(current('readiness',readinessId).revisions.find(revision=>revision.version===proposed.version).record.decision,'proposed');
  await driver.apply(make('evidence-withdraw',edit('evidences',evidenceId,{reason:'Synthetic evidence withdrawn after the documented revision.'})));
  assert.equal(current('evidences',evidenceId).status,'withdrawn');
  driver.record('J28','passed');
}
