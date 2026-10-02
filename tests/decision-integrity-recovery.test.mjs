import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';

const bundle=await build({stdin:{contents:"export {DecisionsPanel} from './components/theranetrix/clinical-flows/decisions';export {initialState,reduce,actionSchema} from './lib/clinical-flows/decisions';export {seedWorkspace} from './lib/theranetrix';export {ensureShowcaseData} from './lib/demo-showcase';export {applyWorkflowAction} from './lib/clinical-flows';export {requireGovernedUse} from './lib/clinical-flows/governance-runtime';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty','.module.css':'empty'},write:false});
const require=createRequire(process.cwd()+'/package.json');
function load(react=React){const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(name=>name==='react'?react:require(name),mod,mod.exports);return mod.exports;}
const {initialState,reduce,actionSchema,seedWorkspace,ensureShowcaseData,applyWorkflowAction,requireGovernedUse}=load();
const now='2026-09-17T15:00:00.000Z',actor='Decision integrity reviewer';
const showcase=ensureShowcaseData(seedWorkspace(),actor,now);
const fixture=()=>structuredClone(showcase);
function workflow(workspace,domain,fields){
  const requestId=crypto.randomUUID();
  return applyWorkflowAction(workspace,{type:'workflow.apply',domain,requestId,expectedSliceVersion:workspace.clinicalWorkflows.slices[domain].version,...(fields.patientId?{patientId:fields.patientId}:{}),command:{...fields,requestId}},actor,now);
}
const amend=(signed,disposition='approve')=>({type:'decisions.sign.amend',patientId:signed.patientId,encounterId:signed.encounterId,signedSnapshotId:signed.id,expectedVersion:signed.version,reason:'Review the recorded disposition',disposition,rationale:'Named review of the original artifacts',patientPlanRef:signed.patientPlanRef});
function recalled(kind){
  let workspace=fixture();const signed=workspace.clinicalWorkflows.slices.decisions.state.signedSnapshots[0];
  const ref=signed.reviewedInput.engineComparison.sourceRunSnapshot.releaseRef;
  const governance=workspace.clinicalWorkflows.slices['program-governance'].state;
  const release=governance.releases.find(row=>row.id===ref.releaseId);
  const [evidenceId,evidenceVersion]=Object.entries(release.evidenceVersions)[0];
  const target=kind==='release'?release:governance.evidences.find(row=>row.id===evidenceId);
  workspace=workflow(workspace,'program-governance',{type:'program-governance.recall-open',subject:kind==='release'?{kind,id:ref.releaseId,artifactVersion:ref.artifactVersion}:{kind,id:evidenceId,version:evidenceVersion},expectedSubjectVersion:target.version,owner:actor,reason:'Review the exact recalled artifact',evidenceRef:'review://decision-integrity'});
  return {workspace,signed,ref};
}

test('approval amendments recheck the exact recalled release or evidence; historical non-approval remains available',()=>{
  const active=fixture(),original=structuredClone(active.clinicalWorkflows.slices.decisions.state.signedSnapshots[0]);
  const approved=workflow(active,'decisions',amend(original));
  assert.equal(approved.clinicalWorkflows.slices.decisions.state.signedSnapshots[0].disposition,'approve');
  assert.deepEqual(approved.clinicalWorkflows.slices.decisions.state.signedSnapshots.find(row=>row.id===original.id),original);
  for(const kind of ['release','evidence']){
    const {workspace,signed,ref}=recalled(kind),before=structuredClone(workspace);
    assert.throws(()=>requireGovernedUse(workspace,'digitalTwin',now,ref),/recall|currently usable/i);
    assert.throws(()=>workflow(workspace,'decisions',amend(signed)),/recall|currently usable/i);
    assert.deepEqual(workspace,before,'rejected approval cannot change the original package or its history');
    const deferred=workflow(workspace,'decisions',amend(signed,'defer'));
    assert.equal(deferred.clinicalWorkflows.slices.decisions.state.signedSnapshots[0].disposition,'defer');
    assert.deepEqual(deferred.clinicalWorkflows.slices.decisions.state.signedSnapshots.find(row=>row.id===signed.id),signed);
  }
});

test('approval checks both saved artifact references when comparison and output identify different releases',()=>{
  for(const record of ['comparisonSnapshot','engineComparison']){
    const workspace=fixture(),signed=workspace.clinicalWorkflows.slices.decisions.state.signedSnapshots[0];
    const ref=signed.reviewedInput.engineComparison.sourceRunSnapshot.releaseRef;
    const other=workspace.clinicalWorkflows.slices['program-governance'].state.releases.find(row=>row.id!==ref.releaseId);
    const otherRef={releaseId:other.id,artifactVersion:other.artifactVersion};
    assert.throws(()=>requireGovernedUse(workspace,'digitalTwin',now,otherRef));
    // A retained package can identify separate model artifacts; neither may be ignored.
    signed.reviewedInput[record].sourceRunSnapshot.releaseRef=otherRef;
    assert.throws(()=>workflow(workspace,'decisions',amend(signed)),/release|scope|readiness|artifact/i);
  }
});

test('accepted approval and engine-capture retries remain historical no-ops after recall with either receipt cache',()=>{
  let workspace=fixture();const signed=workspace.clinicalWorkflows.slices.decisions.state.signedSnapshots[0];
  const requestId=crypto.randomUUID(),command={...amend(signed),requestId};
  const approval={type:'workflow.apply',domain:'decisions',patientId:signed.patientId,requestId,expectedSliceVersion:workspace.clinicalWorkflows.slices.decisions.version,command};
  workspace=applyWorkflowAction(workspace,approval,actor,now);
  const storedCapture=workspace.clinicalWorkflows.slices.decisions.state.idempotencyReceipts.map(receipt=>JSON.parse(receipt.hash)).find(receipt=>receipt.actor===actor&&receipt.action.type==='decisions.engine.capture'&&receipt.action.patientId===signed.patientId).action;
  const capture={type:'workflow.apply',domain:'decisions',patientId:storedCapture.patientId,requestId:storedCapture.requestId,expectedSliceVersion:0,command:storedCapture};
  const ref=signed.reviewedInput.engineComparison.sourceRunSnapshot.releaseRef,release=workspace.clinicalWorkflows.slices['program-governance'].state.releases.find(row=>row.id===ref.releaseId);
  workspace=workflow(workspace,'program-governance',{type:'program-governance.recall-open',subject:{kind:'release',id:ref.releaseId,artifactVersion:ref.artifactVersion},expectedSubjectVersion:release.version,owner:actor,reason:'Recall after accepting the historical commands',evidenceRef:'review://receipt-replay'});
  for(const action of [approval,capture]){
    assert.deepEqual(applyWorkflowAction(workspace,action,actor,now),workspace);
    const evicted=structuredClone(workspace),slice=evicted.clinicalWorkflows.slices.decisions;
    slice.receipts=slice.receipts.filter(receipt=>receipt.id!==action.requestId);slice.requestIds=slice.receipts.map(receipt=>receipt.id);
    assert.deepEqual(applyWorkflowAction(evicted,action,actor,now),evicted,'durable receipt replay adds no signature, audit entry, or task');
    const disabled=structuredClone(evicted);disabled.features.digitalTwin=false;
    assert.throws(()=>applyWorkflowAction(disabled,action,actor,now),/turned off/,'current capability checks still precede replay');
  }
});

// Hook/element event checks exercise real reducers, without claiming browser persistence.
let activeRunner;
const hooks={...React,
  useState(initial){const runner=activeRunner,index=runner.index++;if(!(index in runner.slots))runner.slots[index]=typeof initial==='function'?initial():initial;return [runner.slots[index],value=>{runner.slots[index]=typeof value==='function'?value(runner.slots[index]):value;}];},
  useRef(initial){const runner=activeRunner,index=runner.index++;return runner.slots[index]??={current:initial};},
  useReducer(reducer,initial,initialize){const [value,setValue]=hooks.useState(()=>initialize?initialize(initial):initial);return [value,action=>setValue(prior=>reducer(prior,action))];},
  useCallback:fn=>fn,useEffect:()=>{},
};
const ui=load(hooks);
function runner(){const value={slots:[],index:0,render(component,props){value.index=0;activeRunner=value;try{return component(props);}finally{activeRunner=undefined;}}};return value;}
function nodes(tree){if(tree==null||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(nodes);return [tree,...nodes(tree.props?.children)];}
function text(tree){if(typeof tree==='string'||typeof tree==='number')return String(tree);if(Array.isArray(tree))return tree.map(text).join('');return text(tree?.props?.children??'');}
function button(tree,label){const node=nodes(tree).find(row=>row.type==='button'&&text(row)===label);assert.ok(node,`Button exists: ${label}`);return node;}
function field(tree,label){const node=nodes(tree).find(row=>row.type==='label'&&text(row).startsWith(label));assert.ok(node,`Field exists: ${label}`);return nodes(node).find(row=>['input','textarea','select'].includes(row.type));}
const change=(tree,label,value)=>field(tree,label).props.onChange({target:{value}});
const patient={id:'patient-one',name:'Selected patient'},scope={patientId:patient.id,encounterId:'review-visit'},inputVersion='source-v1';
const context={actor,now,patients:[patient],features:{},inputVersions:[{...scope,inputVersion}]};
function draft(state,summary,extra={}){return reduce(state,{type:'decisions.draft.save',requestId:crypto.randomUUID(),...scope,expectedInputVersion:inputVersion,summary,payload:{note:`Note for ${summary}`,pendingDisposition:'defer'},...extra},context);}
function twoDrafts(){let state=draft(initialState(),'Older saved draft');const older=state.drafts[0];state=draft(state,'Newer saved draft');return {state,older,newer:state.drafts[0]};}
function editor(state,options={}){
  const selectedPatient=options.patient??patient,encounterId=options.encounterId??scope.encounterId,attempts=[];
  const props={patientId:selectedPatient.id,patients:[selectedPatient],state,busy:false,onAction:async()=>false,onRunComparison:async()=>true,clinicalContext:{actor,currentInputVersion:inputVersion,inputVersions:[{patientId:selectedPatient.id,encounterId,inputVersion}],savedRuns:options.savedRuns??[]}};
  const outer=ui.DecisionsPanel(props),parent=runner();let parentTree=parent.render(outer.type,outer.props);
  if(field(parentTree,'Encounter to open').props.value!==encounterId){
    change(parentTree,'Encounter to open',encounterId);parentTree=parent.render(outer.type,outer.props);
    nodes(parentTree).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});parentTree=parent.render(outer.type,outer.props);
  }
  const child=nodes(parentTree).find(node=>typeof node.type==='function'&&node.type.name==='EncounterDecisions');assert.ok(child);
  const innerProps={...child.props},inner=runner();
  innerProps.onAction=async action=>{
    attempts.push(action);
    if(options.fail?.(action))return false;
    innerProps.state=reduce(innerProps.state,action,{...context,patients:[{id:selectedPatient.id,name:selectedPatient.name}],inputVersions:[{patientId:selectedPatient.id,encounterId,inputVersion}]});
    return true;
  };
  return {props:innerProps,attempts,render:()=>inner.render(child.type,innerProps)};
}
async function saveProgress(view){await button(view.render(),'Save progress for later').props.onClick();}
async function saveDraft(view){const form=nodes(view.render()).find(node=>node.type==='form'&&text(node).includes('Reviewed draft and corrections'));assert.ok(form);await form.props.onSubmit({preventDefault(){}});}

test('working-copy reload restores the exact older draft identity and writes back only to that draft',async()=>{
  const {state,older,newer}=twoDrafts(),view=editor(state);
  change(view.render(),'Saved draft',older.id);
  change(view.render(),'Exact summary for sign-off','Edited older draft only');
  change(view.render(),'Draft note','Older draft recovery note');
  await saveProgress(view);
  const copy=view.props.state.workingCopies[0];assert.equal(copy.form.selectedDraftId,older.id);assert.equal(copy.form.selectedDraftVersion,older.version);
  const reopened=editor(JSON.parse(JSON.stringify(view.props.state)));
  assert.equal(field(reopened.render(),'Saved draft').props.value,newer.id);
  button(reopened.render(),'Resume saved progress').props.onClick();
  assert.equal(field(reopened.render(),'Saved draft').props.value,older.id);
  assert.equal(field(reopened.render(),'Exact summary for sign-off').props.value,'Edited older draft only');
  await saveDraft(reopened);
  assert.equal(reopened.attempts.at(-1).draftId,older.id);
  assert.equal(reopened.props.state.drafts.find(row=>row.id===older.id).summary,'Edited older draft only');
  assert.deepEqual(reopened.props.state.drafts.find(row=>row.id===newer.id),JSON.parse(JSON.stringify(newer)));
});

test('stale and legacy working-copy selections preserve text as a new draft without overwriting saved records',async()=>{
  const {state,older,newer}=twoDrafts(),view=editor(state);
  change(view.render(),'Saved draft',older.id);change(view.render(),'Exact summary for sign-off','Unfinished older text');await saveProgress(view);
  const advanced=draft(view.props.state,'Another reviewer updated the older draft',{draftId:older.id,expectedVersion:older.version});
  const stale=editor(advanced);button(stale.render(),'Resume saved progress').props.onClick();
  assert.equal(field(stale.render(),'Saved draft').props.value,'');assert.match(text(stale.render()),/changed or is unavailable/);
  await saveDraft(stale);assert.equal(stale.attempts.at(-1).draftId,undefined);
  assert.equal(stale.props.state.drafts.find(row=>row.id===older.id).summary,'Another reviewer updated the older draft');
  assert.deepEqual(stale.props.state.drafts.find(row=>row.id===newer.id),newer);
  const legacyState=reduce(state,{type:'decisions.working.save',requestId:crypto.randomUUID(),...scope,inputVersion,form:{draftSummary:'Legacy unfinished text'}},context);
  const legacy=editor(legacyState);button(legacy.render(),'Resume saved progress').props.onClick();
  assert.equal(field(legacy.render(),'Saved draft').props.value,'');assert.equal(field(legacy.render(),'Exact summary for sign-off').props.value,'Legacy unfinished text');
});

test('amendment fields and unsaved comparison preferences survive saving progress and a new editor instance',async()=>{
  const workspace=fixture(),state=workspace.clinicalWorkflows.slices.decisions.state,signed=state.signedSnapshots[0];
  const selectedPatient=workspace.patients.find(row=>row.id===signed.patientId),savedRuns=workspace.engineRuns.filter(row=>row.patientId===selectedPatient.id);
  const options={patient:selectedPatient,encounterId:signed.encounterId,savedRuns},view=editor(state,options);
  button(view.render(),'Amend this snapshot').props.onClick();
  change(view.render(),'Reason for amendment','Continue this amendment after the next review');
  change(view.render(),'Amended rationale','Unfinished amended rationale');change(view.render(),'Amended disposition','no-change');
  change(view.render(),'Amended plan reference',signed.patientPlanRef);
  change(view.render(),'relief priority','17');change(view.render(),'Alertness / lower burden priority','73');
  await saveProgress(view);
  const saved=view.props.state.workingCopies.find(row=>row.patientId===selectedPatient.id&&row.encounterId===signed.encounterId&&row.actor===actor);
  assert.equal(saved.form.amendmentId,signed.id);assert.equal(saved.form.amendmentReason,'Continue this amendment after the next review');
  const reopened=editor(JSON.parse(JSON.stringify(view.props.state)),options);button(reopened.render(),'Resume saved progress').props.onClick();
  assert.equal(field(reopened.render(),'Reason for amendment').props.value,saved.form.amendmentReason);
  assert.equal(field(reopened.render(),'Amended rationale').props.value,'Unfinished amended rationale');
  assert.equal(field(reopened.render(),'Amended disposition').props.value,'no-change');
  assert.equal(field(reopened.render(),'Amended plan reference').props.value,signed.patientPlanRef);
  assert.equal(field(reopened.render(),'relief priority').props.value,17);assert.equal(field(reopened.render(),'Alertness / lower burden priority').props.value,73);
});

test('draft switching requires explicit discard of edited text and cannot replace a pending request',async()=>{
  const {state,older,newer}=twoDrafts(),view=editor(state);
  change(view.render(),'Exact summary for sign-off','Do not discard this summary');change(view.render(),'Saved draft',older.id);
  assert.equal(field(view.render(),'Saved draft').props.value,newer.id);assert.equal(field(view.render(),'Exact summary for sign-off').props.value,'Do not discard this summary');
  button(view.render(),'Keep editing this draft').props.onClick();assert.equal(field(view.render(),'Saved draft').props.value,newer.id);
  change(view.render(),'Saved draft',older.id);button(view.render(),'Discard draft edits and switch').props.onClick();
  assert.equal(field(view.render(),'Saved draft').props.value,older.id);assert.equal(field(view.render(),'Exact summary for sign-off').props.value,older.summary);
  const pending=editor(state,{fail:action=>action.type==='decisions.draft.save'});
  change(pending.render(),'Exact summary for sign-off','Unconfirmed save');await saveDraft(pending);const original=pending.attempts[0];
  assert.equal(field(pending.render(),'Saved draft').props.disabled,true);
  change(pending.render(),'Saved draft',older.id);assert.equal(field(pending.render(),'Saved draft').props.value,newer.id);
  await saveProgress(pending);
  const restored=editor(pending.props.state);button(restored.render(),'Resume saved progress').props.onClick();
  await button(restored.render(),'Retry the same request').props.onClick();
  assert.equal(restored.attempts.at(-1).requestId,original.requestId);assert.equal(restored.attempts.at(-1).draftId,newer.id);
});

test('working-copy schema validates restored draft versions and comparison preference types',()=>{
  const command={type:'decisions.working.save',requestId:crypto.randomUUID(),...scope,inputVersion,form:{selectedDraftId:'draft',selectedDraftVersion:1,enginePreferences:{relief:20,alertness:60,routine:20}}};
  assert.equal(actionSchema.safeParse(command).success,true);
  assert.equal(actionSchema.safeParse({...command,form:{selectedDraftId:'draft'}}).success,false);
  assert.equal(actionSchema.safeParse({...command,form:{...command.form,selectedDraftVersion:0}}).success,false);
  assert.equal(actionSchema.safeParse({...command,form:{...command.form,enginePreferences:{relief:'20',alertness:60,routine:20}}}).success,false);
});
