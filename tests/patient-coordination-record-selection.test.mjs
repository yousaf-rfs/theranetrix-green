import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';

const bundle=await build({stdin:{contents:"export {PatientCoordinationPanel} from './components/theranetrix/clinical-flows/patient-coordination';export {seedWorkspace} from './lib/theranetrix';export {ensureShowcaseData} from './lib/demo-showcase';export {applyAction,actionSchema} from './lib/actions';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false,plugins:[{name:'css-for-component-tests',setup(builder){builder.onLoad({filter:/\.css$/},()=>({contents:'export default {}',loader:'js'}));}}]});
const require=createRequire(process.cwd()+'/package.json');
function load(react=React){const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(name=>name==='react'?react:require(name),mod,mod.exports);return mod.exports;}
const {seedWorkspace,ensureShowcaseData,applyAction,actionSchema}=load();
const actor='Selection test reviewer',now='2026-09-17T12:00:00.000Z',patientId='TN-DEMO-01';
let fixture=ensureShowcaseData(seedWorkspace(),actor,now);
for(const [requestId,text] of [['selection-older','Earlier concern.'],['selection-newer','Newer concern.']])fixture=applyAction(fixture,actionSchema.parse({type:'advisor.request',patientId,requestId,text,concernUrgency:'routine'}),actor,now);
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// Component state and event handlers only; no browser or DOM implementation.
function interactive(props,location=''){
  const slots=[];let cursor=0,changed=false,search=location;
  const hooks={...React,useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],next=>{slots[index]=typeof next==='function'?next(slots[index]):next;changed=true;}];},useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];},useMemo:fn=>fn(),useSyncExternalStore:()=>search};
  const {PatientCoordinationPanel}=load(hooks);
  function expand(node){
    if(!React.isValidElement(node))return node;
    if(typeof node.type==='function'&&['PatientCoordinationEditor','RecordSelector'].includes(node.type.name))return expand(node.type(node.props));
    return {...node,props:{...node.props,children:React.Children.toArray(node.props.children).map(expand)}};
  }
  return {setLocation:value=>{search=value;},render(){let tree,count=0;do{cursor=0;changed=false;tree=expand(PatientCoordinationPanel(props));if(++count>20)throw new Error('Editor did not settle.');}while(changed);return tree;}};
}
function find(tree,predicate){if(!tree||typeof tree!=='object')return;if(predicate(tree))return tree;for(const child of React.Children.toArray(tree.props?.children)){const result=find(child,predicate);if(result)return result;}}
function text(tree){if(typeof tree==='string'||typeof tree==='number')return String(tree);return React.Children.toArray(tree?.props?.children).map(text).join('');}
function field(tree,label){const node=find(tree,node=>node.type==='label'&&text(node).startsWith(label));assert.ok(node,'Missing field '+label);return find(node,child=>['input','select','textarea'].includes(child.type));}
const change=(tree,label,value)=>field(tree,label).props.onChange({target:{value}});
const button=(tree,label)=>find(tree,node=>text(node)===label&&typeof node.props?.onClick==='function');
const submit=tree=>find(tree,node=>node.type==='form'&&!!fieldOrNull(node,'Concern')).props.onSubmit({preventDefault(){}});
function fieldOrNull(tree,label){return find(tree,node=>node.type==='label'&&text(node).startsWith(label));}
function setup(onAction=async()=>false){const workspace=structuredClone(fixture),state=workspace.clinicalWorkflows.slices['patient-coordination'].state;return {workspace,newer:state.handoffs.find(row=>row.dedupeKey==='selection-newer'),older:state.handoffs.find(row=>row.dedupeKey==='selection-older'),props:{patientId,patients:workspace.patients,state,busy:false,onAction}};}

test('switching between same-patient records requires an explicit discard of edited fields',()=>{
  const {props,newer,older}=setup(),view=interactive(props);let tree=view.render();
  assert.equal(field(tree,'Handoff record').props.value,newer.id);
  change(tree,'Concern','My unfinished note for the newer concern.');tree=view.render();
  change(tree,'Handoff record',older.id);tree=view.render();
  assert.equal(field(tree,'Handoff record').props.value,newer.id);assert.equal(field(tree,'Concern').props.value,'My unfinished note for the newer concern.');
  assert.match(text(tree),/unsaved changes or a save awaiting confirmation/);
  button(tree,'Keep editing').props.onClick();tree=view.render();assert.equal(button(tree,'Discard draft and switch record'),undefined);
  change(tree,'Handoff record',older.id);tree=view.render();button(tree,'Discard draft and switch record').props.onClick();tree=view.render();
  assert.equal(field(tree,'Handoff record').props.value,older.id);assert.equal(field(tree,'Concern').props.value,older.concern);
  change(tree,'Concern','Unfinished older concern.');tree=view.render();change(tree,'Handoff record','');tree=view.render();
  assert.equal(field(tree,'Handoff record').props.value,older.id);button(tree,'Discard draft and switch record').props.onClick();tree=view.render();
  assert.equal(field(tree,'Handoff record').props.value,'');assert.equal(field(tree,'Concern').props.value,'');
  change(tree,'Concern','An unsaved new concern.');tree=view.render();change(tree,'Handoff record',newer.id);tree=view.render();
  assert.equal(field(tree,'Handoff record').props.value,'');assert.equal(field(tree,'Concern').props.value,'An unsaved new concern.');
});

test('an in-flight save blocks stale selection handlers and an unconfirmed save retains its request',async()=>{
  const commands=[];let resolveFirst;
  const {props,newer,older}=setup(async action=>{commands.push(action);if(commands.length===1)return new Promise(resolve=>{resolveFirst=resolve;});return false;}),view=interactive(props);
  let tree=view.render();const beforeSaveSelection=field(tree,'Handoff record').props.onChange;
  submit(tree);beforeSaveSelection({target:{value:older.id}});tree=view.render();
  assert.equal(field(tree,'Handoff record').props.value,newer.id);assert.equal(field(tree,'Handoff record').props.disabled,true);assert.equal(button(tree,'Discard draft and switch record'),undefined);
  resolveFirst(false);await tick();tree=view.render();change(tree,'Handoff record',older.id);tree=view.render();
  assert.equal(field(tree,'Handoff record').props.value,newer.id,'An unedited but unconfirmed save still protects its record');
  button(tree,'Keep editing').props.onClick();tree=view.render();submit(tree);await tick();
  assert.equal(commands[0].requestId,commands[1].requestId,'Keeping the record preserves retry identity');
  tree=view.render();change(tree,'Handoff record',older.id);tree=view.render();button(tree,'Discard draft and switch record').props.onClick();tree=view.render();
  change(tree,'Handoff record',newer.id);tree=view.render();submit(tree);await tick();
  assert.notEqual(commands[2].requestId,commands[0].requestId,'Explicit discard also discards the old retry');
});

test('an incoming handoff link cannot replace an unconfirmed save even without field edits',async()=>{
  const {props,newer,older}=setup(),view=interactive(props,'?workflowRecordId='+newer.id);let tree=view.render();
  submit(tree);await tick();view.setLocation('?workflowRecordId='+older.id);tree=view.render();
  assert.equal(field(tree,'Handoff record').props.value,newer.id);assert.match(text(tree),/link points to a different handoff/);
  button(tree,'Discard draft and open linked handoff').props.onClick();tree=view.render();
  assert.equal(field(tree,'Handoff record').props.value,older.id);
});

test('an acknowledged save reconciles its record and permits a clean selection change',async()=>{
  const data=setup();let workspace=data.workspace;
  data.props.onAction=async command=>{workspace=applyAction(workspace,actionSchema.parse({type:'workflow.apply',domain:'patient-coordination',patientId,requestId:command.requestId,expectedSliceVersion:workspace.clinicalWorkflows.slices['patient-coordination'].version,command}),actor,now);data.props.state=workspace.clinicalWorkflows.slices['patient-coordination'].state;return true;};
  const view=interactive(data.props);let tree=view.render();change(tree,'Concern','Saved update for the newer concern.');tree=view.render();submit(tree);await tick();tree=view.render();
  assert.equal(field(tree,'Concern').props.value,'Saved update for the newer concern.');assert.match(text(tree),/Record saved/);
  change(tree,'Handoff record',data.older.id);tree=view.render();assert.equal(field(tree,'Handoff record').props.value,data.older.id);assert.equal(button(tree,'Discard draft and switch record'),undefined);
});
