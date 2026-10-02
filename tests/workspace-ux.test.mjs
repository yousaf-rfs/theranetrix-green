import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';

const bundle=await build({stdin:{contents:"export {MessageThread,Messages,Schedule,ReviewQueue,Companion,WorkspaceSettings} from './components/theranetrix/workflows';export {seedWorkspace} from './lib/theranetrix';export {ensureShowcaseData} from './lib/demo-showcase';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false,loader:{'.css':'empty','.module.css':'empty'}});
const require=createRequire(process.cwd()+'/package.json');
function load(hooks=React){const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(name=>name==='react'?hooks:require(name),mod,mod.exports);return mod.exports;}
const {seedWorkspace,ensureShowcaseData}=load();
const workspace=ensureShowcaseData(seedWorkspace(),'UX reviewer','2026-09-17T12:00:00Z');
const patient=workspace.patients.find(row=>row.id==='TN-DEMO-02');
const ctx=(extra={})=>({data:workspace,busy:false,user:'UX reviewer',save:async()=>true,open(){},...extra});
// Component handlers and React state only; these checks do not run a browser.
function component(name,props,search=''){
  const slots=[];let cursor=0;
  const hooks={...React,useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];},useSyncExternalStore:()=>search};
  const api=load(hooks);
  return {render(){cursor=0;return api[name](props);}};
}
function find(node,predicate){if(!node||typeof node!=='object')return; if(predicate(node))return node;for(const child of React.Children.toArray([node.props?.children,node.props?.actions,node.props?.action])){const result=find(child,predicate);if(result)return result;}}
function text(node){if(typeof node==='string')return node;return React.Children.toArray(node?.props?.children).map(text).join('');}

test('shared workspace access shows direct access and no sign-out control',()=>{
  const tree=component('WorkspaceSettings',{ctx:ctx({accessMode:'shared',user:'Shared workspace visitor'})},'?tab=access').render();
  const panel=find(tree,node=>node.props?.title==='Workspace access');assert.ok(panel);
  assert.match(text(panel),/Everyone with the link shares the same records/);
  assert.equal(find(panel,node=>typeof node.props?.onClick==='function'&&text(node)==='Sign out'),undefined);
  assert.doesNotMatch(text(panel),/protected by an access code|Workspace owner/);
});

test('message request locks its composer and preserves the draft after a failed save',async()=>{
  let finish;const commands=[];
  const view=component('MessageThread',{p:patient,ctx:ctx({save:action=>{commands.push(action);return new Promise(resolve=>{finish=resolve;});}})});
  let tree=view.render();find(tree,node=>node.props?.['aria-label']==='Message text').props.onChange({target:{value:'Please review this concern.'}});
  tree=view.render();const saving=find(tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});
  tree=view.render();assert.equal(find(tree,node=>node.props?.['aria-label']==='Message text').props.disabled,true);
  await find(tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});assert.equal(commands.length,1);
  finish(false);await saving;tree=view.render();
  assert.equal(find(tree,node=>node.props?.['aria-label']==='Message text').props.value,'Please review this concern.');
  assert.match(text(find(tree,node=>node.props?.role==='alert')),/not saved/);
  assert.equal(commands[0].patientId,patient.id);
});

test('explicit unavailable companion and message links expose no writable other-patient thread',()=>{
  for(const name of ['Messages','Companion']){
    const tree=component(name,{ctx:ctx()},'?patient=unavailable-chart').render();
    assert.ok(find(tree,node=>node.props?.title==='Patient not found'),name);
    assert.equal(find(tree,node=>node.type?.name==='MessageThread'||node.type?.name==='PatientCompanionLanguage'),undefined,name);
  }
});

test('patient-filtered schedule and review creation keep the selected patient',()=>{
  for(const [name,label,kind] of [['Schedule','Schedule activity','task'],['ReviewQueue','New escalation','escalation']]){
    const opened=[];const tree=component(name,{ctx:ctx({open:(...args)=>opened.push(args)})},'?patient='+patient.id).render();
    const button=find(tree,node=>typeof node.props?.onClick==='function'&&text(node)===label);assert.ok(button,label);button.props.onClick();
    assert.deepEqual(opened,[[kind,patient]]);
    if(name==='Schedule'){
      const rows=[];function visit(node){if(!node||typeof node!=='object')return;if(node.props?.className?.startsWith('agenda-item'))rows.push(node);React.Children.toArray(node.props?.children).forEach(visit);}visit(tree);
      assert.equal(rows.length,workspace.tasks.filter(task=>task.patientId===patient.id&&!task.done).length);assert.ok(rows.length);for(const row of rows){const patientLink=find(row,node=>node.props?.className==='agenda-patient');assert.ok(patientLink);assert.equal(patientLink.props.href,'/patients/'+patient.id);assert.equal(text(patientLink),patient.name);}
    }
  }
});

test('handoff links identify the exact reviewed concern and its patient',()=>{
  const tree=component('ReviewQueue',{ctx:ctx()}).render();
  const handoffs=workspace.clinicalWorkflows.slices['patient-coordination'].state.handoffs;
  let count=0;
  for(const review of workspace.reviews.filter(row=>row.status!=='Resolved')){
    if(!handoffs.some(row=>row.id===review.workflowRecordId&&row.patientId===review.patientId))continue;
    const href='/patients/'+encodeURIComponent(review.patientId)+'?workflow=patient-coordination&workflowJourney=J10&workflowRecordId='+encodeURIComponent(review.workflowRecordId);
    assert.ok(find(tree,node=>node.props?.href===href));count++;
  }
  assert.ok(count>0);
});
