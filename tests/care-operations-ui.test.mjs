import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({stdin:{contents:"export {CareOperationsPanel} from './components/theranetrix/care-operations-panel';export {PatientCoordinationPanel} from './components/theranetrix/clinical-flows/patient-coordination';export {seedWorkspace} from './lib/theranetrix';export {ensureShowcaseData} from './lib/demo-showcase';export {applyAction,actionSchema} from './lib/actions';export {workflowBridgeId} from './lib/clinical-flows/bridges';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false,plugins:[{name:'css-for-component-tests',setup(builder){builder.onLoad({filter:/\.css$/},()=>({contents:'export default {}',loader:'js'}));}}]});
const require=createRequire(process.cwd()+'/package.json');
function load(react=React){const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(name=>name==='react'?react:require(name),mod,mod.exports);return mod.exports;}
const {CareOperationsPanel,seedWorkspace,ensureShowcaseData,applyAction,actionSchema,workflowBridgeId}=load();
const now='2026-09-17T12:00:00.000Z',actor='UI review clinician';
const fixture=ensureShowcaseData(seedWorkspace(),actor,now);
const init=()=>structuredClone(fixture);
const patient=(workspace,id)=>workspace.patients.find(record=>record.id===id);
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// Component-state and event-handler checks, not browser or provider verification.
function interactive(name,props,location=''){
  const slots=[];let cursor=0,changed=false,search=location;
  const hooks={...React,useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],next=>{slots[index]=typeof next==='function'?next(slots[index]):next;changed=true;}];},useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];},useMemo:fn=>fn(),useSyncExternalStore:()=>search};
  const components=load(hooks);
  function expand(node){
    if(!React.isValidElement(node))return node;
    if(typeof node.type==='function'&&['CareOperationsEditor','PatientCoordinationEditor','RecordSelector'].includes(node.type.name))return expand(node.type(node.props));
    return {...node,props:{...node.props,children:React.Children.toArray(node.props.children).map(expand)}};
  }
  return {props,setLocation:value=>{search=value;},render(){let tree,attempts=0;do{changed=false;cursor=0;tree=expand(components[name](props));if(++attempts>15)throw new Error('Component state did not settle.');}while(changed);return tree;}};
}
function find(tree,predicate){if(!tree||typeof tree!=='object')return undefined;if(predicate(tree))return tree;for(const child of React.Children.toArray(tree.props?.children)){const result=find(child,predicate);if(result)return result;}}
function text(tree){if(typeof tree==='string'||typeof tree==='number')return String(tree);return React.Children.toArray(tree?.props?.children).map(text).join('');}
function section(tree,title){return find(tree,node=>node.type==='details'&&text(find(node,child=>child.type==='summary')).startsWith(title));}
function field(tree,label){const node=find(tree,node=>node.type==='label'&&text(node).startsWith(label));assert.ok(node,'Label found: '+label);return find(node,child=>['input','select','textarea'].includes(child.type));}
const change=(tree,label,value)=>field(tree,label).props.onChange({target:{value}});
function propsFor(workspace,id,onAction=async()=>false){return {workspace,patient:patient(workspace,id),busy:false,onAction};}

test('care-operation editors load saved states and keep independent drafts',()=>{
  const workspace=init(),p=patient(workspace,'TN-DEMO-01');
  const view=interactive('CareOperationsPanel',propsFor(workspace,p.id));
  let tree=view.render(),monitor=section(tree,'Monitoring and missing reports'),coverage=section(tree,'Coverage and service hours'),remote=section(tree,'Remote visit');
  const savedMonitoring=workspace.careOperations.monitoring.find(record=>record.patientId===p.id);
  assert.equal(field(monitor,'Monitoring state').props.value,savedMonitoring.status);
  assert.equal(field(monitor,'Reason and agreed next step').props.value,savedMonitoring.reason);
  const oldCoverageOwner=field(coverage,'Accepted owner').props.value,oldRemoteOwner=field(remote,'Responsible clinician or coordinator').props.value;
  change(monitor,'Responsible clinician or coordinator','Monitoring follow-up owner');change(monitor,'Reason and agreed next step','Patient chose a callback tomorrow.');
  tree=view.render();monitor=section(tree,'Monitoring and missing reports');coverage=section(tree,'Coverage and service hours');remote=section(tree,'Remote visit');
  assert.equal(field(monitor,'Responsible clinician or coordinator').props.value,'Monitoring follow-up owner');
  assert.equal(field(coverage,'Accepted owner').props.value,oldCoverageOwner);
  assert.equal(field(remote,'Responsible clinician or coordinator').props.value,oldRemoteOwner);
  assert.notEqual(field(remote,'Assessment or recovery details').props.value,'Patient chose a callback tomorrow.');
});

test('Priya remote recovery updates the displayed interrupted encounter, not the latest assessment',async()=>{
  let workspace=init();const id='TN-DEMO-03',prior=workspace.careOperations.remoteVisits.find(record=>record.patientId===id),commands=[];
  assert.equal(prior.status,'interrupted');
  const props=propsFor(workspace,id,async command=>{commands.push(command);workspace=applyAction(workspace,actionSchema.parse(command),actor,now);props.workspace=workspace;props.patient=patient(workspace,id);return true;});
  const view=interactive('CareOperationsPanel',props);let tree=view.render(),remote=section(tree,'Remote visit');
  assert.equal(field(remote,'Visit encounter').props.value,prior.encounterId);
  assert.equal(field(remote,'Encounter ID').props.value,prior.encounterId);
  assert.equal(field(remote,'Visit state').props.value,'interrupted');
  change(remote,'Visit state','alternative-arranged');change(remote,'Channel','phone');change(remote,'Assessment or recovery details','Priya agreed to a telephone callback at the recorded time.');
  tree=view.render();remote=section(tree,'Remote visit');find(remote,node=>node.type==='form').props.onSubmit({preventDefault(){}});await tick();view.render();
  assert.equal(commands[0].command.encounterId,prior.encounterId);
  const saved=workspace.careOperations.remoteVisits[0];assert.equal(saved.encounterId,prior.encounterId);assert.equal(saved.status,'alternative-arranged');assert.equal(saved.channel,'phone');
  const task=workspace.tasks.find(record=>record.id===workflowBridgeId('remote-recovery',id,prior.encounterId));assert.ok(task);assert.equal(task.done,false);
  assert.equal(workspace.careOperations.remoteVisits.filter(record=>record.patientId===id&&record.encounterId!==prior.encounterId).length,0);
});

test('dirty drafts survive a newer saved record and require explicit reload before saving',async()=>{
  let workspace=init();const id='TN-DEMO-01',commands=[],props=propsFor(workspace,id,async command=>{commands.push(command);return false;});
  const view=interactive('CareOperationsPanel',props);let tree=view.render();change(section(tree,'Monitoring and missing reports'),'Reason and agreed next step','My unfinished callback note.');
  workspace=applyAction(workspace,actionSchema.parse({type:'care.operations',patientId:id,requestId:'concurrent-monitoring',expectedVersion:workspace.careOperations.version,command:{kind:'monitoring',status:'paused',owner:'Covering clinician',nextAttemptAt:'2026-09-18T12:00:00Z',reason:'Pause agreed during another review.'}}),'Covering clinician',now);
  props.workspace=workspace;tree=view.render();let monitor=section(tree,'Monitoring and missing reports');
  assert.equal(field(monitor,'Reason and agreed next step').props.value,'My unfinished callback note.');
  assert.match(text(monitor),/saved record changed/i);assert.equal(find(monitor,node=>node.type==='fieldset').props.disabled,true);
  find(monitor,node=>node.type==='form').props.onSubmit({preventDefault(){}});await tick();assert.equal(commands.length,0);
  tree=view.render();monitor=section(tree,'Monitoring and missing reports');find(monitor,node=>node.type==='button'&&text(node)==='Discard draft and load saved record').props.onClick();
  tree=view.render();monitor=section(tree,'Monitoring and missing reports');
  assert.equal(field(monitor,'Monitoring state').props.value,'paused');assert.equal(field(monitor,'Responsible clinician or coordinator').props.value,'Covering clinician');
  assert.equal(field(monitor,'Reason and agreed next step').props.value,'Pause agreed during another review.');
  assert.equal(find(monitor,node=>node.type==='fieldset').props.disabled,false);
});

test('uncertain care-operation replies retain the same request and cannot append a duplicate update',async()=>{
  let server=init();const id='TN-DEMO-01',commands=[],props=propsFor(server,id,async command=>{commands.push(command);server=applyAction(server,actionSchema.parse(command),actor,now);if(commands.length===1)return false;props.workspace=server;return true;});
  const view=interactive('CareOperationsPanel',props);let tree=view.render(),monitor=section(tree,'Monitoring and missing reports');
  const before=server.careOperations.monitoring.length;change(monitor,'Reason and agreed next step','A retry-safe callback note.');
  tree=view.render();find(section(tree,'Monitoring and missing reports'),node=>node.type==='form').props.onSubmit({preventDefault(){}});await tick();
  tree=view.render();monitor=section(tree,'Monitoring and missing reports');assert.match(text(monitor),/not saved/);assert.equal(field(monitor,'Reason and agreed next step').props.value,'A retry-safe callback note.');
  find(monitor,node=>node.type==='form').props.onSubmit({preventDefault(){}});await tick();
  assert.equal(commands[0].requestId,commands[1].requestId);assert.equal(server.careOperations.monitoring.length,before+1);
});

function coordinationFixture(){
  let workspace=init();const id='TN-DEMO-01';
  for(const [requestId,content] of [['older-link','Earlier concern: call after lunch.'],['newer-link','Newer concern: review the activity log.']])workspace=applyAction(workspace,actionSchema.parse({type:'advisor.request',patientId:id,requestId,text:content,concernUrgency:'routine'}),actor,now);
  const state=workspace.clinicalWorkflows.slices['patient-coordination'].state;
  return {workspace,older:state.handoffs.find(record=>record.dedupeKey==='older-link'),newer:state.handoffs.find(record=>record.dedupeKey==='newer-link'),props:{patientId:id,patients:workspace.patients,state,busy:false,onAction:async()=>false}};
}

test('handoff links select the exact patient-owned record and reject missing or foreign records',()=>{
  const {props,older,newer}=coordinationFixture();
  const view=interactive('PatientCoordinationPanel',props,'?workflowRecordId='+older.id);let tree=view.render();
  assert.equal(field(tree,'Handoff record').props.value,older.id);
  assert.equal(field(tree,'Concern').props.value,older.concern);
  assert.ok(text(field(tree,'Handoff record')).includes(older.concern));
  view.setLocation('?workflowRecordId='+newer.id);tree=view.render();assert.equal(field(tree,'Handoff record').props.value,newer.id);
  for(const location of ['?workflowRecordId=missing-handoff','?workflowRecordId='+older.id]){
    const invalid=interactive('PatientCoordinationPanel',{...props,patientId:location.includes('missing')?props.patientId:'TN-DEMO-02'},location).render();
    assert.match(text(invalid),/not available for the selected patient/);assert.equal(find(invalid,node=>node.type==='form'),undefined);
  }
});

test('a new linked handoff cannot silently replace an unsaved handoff draft',()=>{
  const {props,older,newer}=coordinationFixture();const view=interactive('PatientCoordinationPanel',props,'?workflowRecordId='+older.id);
  let tree=view.render();change(tree,'Concern','Unfinished note for the earlier concern.');view.setLocation('?workflowRecordId='+newer.id);tree=view.render();
  assert.equal(field(tree,'Concern').props.value,'Unfinished note for the earlier concern.');assert.match(text(tree),/link points to a different handoff/);
  find(tree,node=>text(node)==='Discard draft and open linked handoff'&&typeof node.props?.onClick==='function').props.onClick();
  tree=view.render();assert.equal(field(tree,'Handoff record').props.value,newer.id);assert.equal(field(tree,'Concern').props.value,newer.concern);
});

test('switching back to the local checklist restores its draft and proxy documentation is explicit',()=>{
  const {props}=coordinationFixture();
  props.clinicalContext={protocolAssignments:[{id:'assignment',version:1,patientId:props.patientId,encounterId:'assigned-encounter',protocolId:'reviewed-protocol',protocolVersion:2,protocolSnapshot:{steps:[{id:'approved-step',title:'Approved follow-up',owner:'Coordinator',prerequisites:[],openQuestion:'Review the agreed activity log.'}]}}]};
  const view=interactive('PatientCoordinationPanel',props);let tree=view.render();change(tree,'Pathway record','');tree=view.render();change(tree,'Pathway key','my-local-checklist');
  tree=view.render();change(tree,'Assigned protocol','assignment');tree=view.render();assert.equal(field(tree,'Pathway key').props.value,'reviewed-protocol');
  change(tree,'Assigned protocol','');tree=view.render();assert.equal(field(tree,'Assigned protocol').props.value,'');assert.equal(field(tree,'Pathway key').props.value,'my-local-checklist');
  assert.equal(field(tree,'Pathway key').props.readOnly,false);assert.match(text(tree),/Saving it does not grant or revoke access/);
  assert.ok(find(tree,node=>node.type==='a'&&node.props.href==='/patients/'+props.patientId+'?workflow=integration-access'));
});

test('saved care-operation status is also present in the rendered accessible form',()=>{
  const workspace=init(),html=renderToStaticMarkup(React.createElement(CareOperationsPanel,propsFor(workspace,'TN-DEMO-03')));
  assert.match(html,/Visit encounter/);assert.match(html,/<option value="interrupted" selected="">interrupted/);assert.match(html,/story-completion-v2-TN-DEMO-03/);
});
