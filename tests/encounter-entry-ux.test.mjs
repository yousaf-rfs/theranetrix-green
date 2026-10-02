import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({stdin:{contents:"export * from './components/theranetrix/clinical-flows/encounters';export {EntryDialog} from './components/theranetrix/forms';export {initialState,reduce as reduceEncounters,actionSchema} from './lib/clinical-flows/encounters';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty','.module.css':'empty'},write:false});
const require=createRequire(process.cwd()+'/package.json');
function load(react=React){const runtimeModule={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(name=>name==='react'?react:require(name),runtimeModule,runtimeModule.exports);return runtimeModule.exports;}
const ui=load(),now='2026-09-17T12:00:00.000Z',patientId='patient-1',encounterId='closed-review';
const context={actor:'Named clinician',now,patients:[{id:patientId,name:'Mina Vale'}],features:{assessments:true},closureDependencies:[]};
function closedRecord(){
  let state=ui.initialState();
  const apply=fields=>(state=ui.reduceEncounters(state,{patientId,encounterId,requestId:crypto.randomUUID(),...fields},context));
  apply({type:'encounters.observations.save',instrument:'local-0-10',submissionStatus:'confirmed',entries:[{metric:'pain',status:'zero',value:0},{metric:'function',status:'declined'},{metric:'sleep',status:'answered',value:7}].map(entry=>({...entry,source:'Patient report',recordedAt:now}))});
  apply({type:'encounters.episode.save',goalEvidence:'Walking goal reviewed with the patient.',observedOutcomes:'Dated observations reviewed.',priorInterventions:'Activity pacing',ongoingInterventions:'Agreed self-management',patientExperience:'Patient agrees with the review.',remainingConcerns:[],decision:'closure',pendingWorkDisposition:'No outstanding work.',pendingWorkOwner:'Named clinician',status:'reviewed'});
  apply({type:'encounters.episode.close',id:state.episodes[0].id,expectedVersion:state.episodes[0].version,reason:'Reviewed before closing.'});
  return state;
}

test('the closed-episode form creates a permitted attributed correction and retains original/missing values',()=>{
  let state=closedRecord();
  const original=structuredClone(state.observations[0]),closed=structuredClone(state.episodes[0]);
  const command=ui.buildObservationCorrection(original,original.version,'pain',{value:'2',source:'Patient clarification',recordedAt:now,reason:'Patient clarified the pain response.'},'closed-correction');
  assert.equal(command.type,'encounters.observations.correct');
  state=ui.reduceEncounters(state,command,context);
  const record=state.observations[0];
  assert.equal(record.currentEntries.find(row=>row.metric==='pain').value,2);
  assert.equal(record.currentEntries.find(row=>row.metric==='function').status,'declined');
  assert.deepEqual(record.entries.slice(0,3),original.entries);
  assert.equal(record.entries.at(-1).correctedFromEntryId,original.currentEntries.find(row=>row.metric==='pain').id);
  assert.equal(record.history.at(-1).actor,context.actor);
  assert.deepEqual(state.episodes[0],closed);
  assert.deepEqual(ui.reduceEncounters(state,command,context),state,'lost-response retry retains one correction');
  const zero=ui.buildObservationCorrection(record,record.version,'sleep',{value:'0',source:'Patient clarification',recordedAt:now,reason:'Patient clarified the response.'});
  assert.equal(zero.replacement.status,'zero');assert.equal(zero.replacement.value,0);
  const missing=ui.buildObservationCorrection(record,record.version,'sleep',{value:'unanswered',source:'Patient clarification',recordedAt:now,reason:'Patient did not answer this measure.'});
  assert.equal(missing.replacement.status,'unanswered');assert.equal(missing.replacement.value,undefined);
  const stale=ui.buildObservationCorrection(record,original.version,'sleep',{value:'declined',source:'Patient clarification',recordedAt:now,reason:'Patient declined.'});
  assert.throws(()=>ui.reduceEncounters(state,stale,context),/changed|version/i);
  const markup=renderToStaticMarkup(React.createElement(ui.EncountersPanel,{patientId,patients:context.patients,state,busy:false,onAction:async()=>true,clinicalContext:{closureDependencies:[]}}));
  assert.match(markup,/This episode is closed/);assert.match(markup,/Measure to correct/);assert.match(markup,/Save observation correction/);
  assert.doesNotMatch(markup,/>Save observations</);
  assert.match(markup,/Observation history/);
});

test('encounter validation identifies the field without exposing a raw schema dump',()=>{
  const record=closedRecord().observations[0];
  let invalid;
  try{ui.buildObservationCorrection(record,record.version,'pain',{value:'1',source:'',recordedAt:'bad-date',reason:''});}catch(error){invalid=error;}
  const message=ui.encounterValidationMessage(invalid);
  assert.match(message,/Reason: Enter a value/);assert.match(message,/Observation source/);assert.match(message,/Observation time/);
  assert.doesNotMatch(message,/"code"|"path"|invalid_string|\{\s*"/);
  assert.equal(ui.encounterValidationMessage(new Error('Choose a whole number.')),'Choose a whole number.');
});

// Exercise component event contracts in Node. This is a hook/element harness,
// not a browser: Radix's focus trapping and pointer/keyboard integration are not simulated.
let active;
const hooks={...React,
  useState:initial=>{const runner=active,index=runner.index++;if(!(index in runner.slots))runner.slots[index]=typeof initial==='function'?initial():initial;return [runner.slots[index],value=>{runner.slots[index]=typeof value==='function'?value(runner.slots[index]):value;}];},
  useRef:initial=>{const runner=active,index=runner.index++;return runner.slots[index]??=( {current:initial} );},
  useMemo:factory=>factory(),
  useEffect:effect=>{active.effects.push(effect);},
};
const interactive=load(hooks);
function runner(){const harness={slots:[],effects:[],index:0,render(component,props){harness.index=0;harness.effects=[];active=harness;try{return component(props);}finally{active=undefined;}},flush(){for(const effect of harness.effects)effect();}};return harness;}
function nodes(tree){if(tree==null||typeof tree==='boolean')return [];if(Array.isArray(tree))return tree.flatMap(nodes);if(typeof tree!=='object')return [];return [tree,...nodes(tree.props?.children)];}
const component=(tree,name)=>nodes(tree).find(node=>typeof node.type==='function'&&node.type.name===name);
const input=(tree,predicate)=>nodes(tree).find(predicate);
const labels=tree=>nodes(tree).flatMap(node=>React.Children.toArray(node.props?.children).filter(child=>typeof child==='string')).join(' ');
const p={id:patientId,name:'Mina Vale',goal:'Walk with María for twenty minutes',preferredLanguage:'en'};
function dialog(entry={kind:'note',patient:p},save=async()=>true){
  let closed=0;
  const ctx={busy:false,data:{patients:[p]},save};
  const outer=interactive.EntryDialog({entry,close:()=>{closed++;},ctx});
  const state=runner();
  return {ctx,state,outer,render:()=>state.render(outer.type,outer.props),get closed(){return closed;}};
}

test('dialog dismissal requires an explicit discard after edits and stays blocked during a pending save',()=>{
  const clean=dialog();component(clean.render(),'Dialog').props.onOpenChange(false);assert.equal(clean.closed,1);
  const d=dialog();let tree=d.render(),form=component(tree,'EntryForm');
  form.props.onDirty();component(tree,'Dialog').props.onOpenChange(false);
  assert.equal(d.closed,0);tree=d.render();assert.equal(component(tree,'AlertDialog').props.open,true);
  component(tree,'AlertDialog').props.onOpenChange(false);
  tree=d.render();assert.equal(component(tree,'AlertDialog').props.open,false);assert.equal(d.closed,0);
  component(tree,'EntryForm').props.cancel();tree=d.render();assert.equal(component(tree,'AlertDialog').props.open,true);
  component(tree,'EntryForm').props.onSaving(true);
  component(tree,'AlertDialogAction').props.onClick();assert.equal(d.closed,0);
  component(tree,'EntryForm').props.onSaving(false);
  component(tree,'AlertDialogAction').props.onClick();assert.equal(d.closed,1);
  const busy=dialog();busy.ctx.busy=true;component(busy.render(),'Dialog').props.onOpenChange(false);assert.equal(busy.closed,0);
});

test('failed note saves keep the exact draft, show a focusable error and do not close the dialog',async()=>{
  const attempted=[];
  const d=dialog({kind:'note',patient:p},async action=>{attempted.push(action);return false;});
  const node=component(d.render(),'EntryForm'),formState=runner();
  let form=formState.render(node.type,node.props);
  const text=input(form,item=>item.props?.rows===7);
  text.props.onChange({target:{value:'Unfinished note: the patient asked about the next review.'}});form.props.onChange();
  form=formState.render(node.type,node.props);
  const nativeFormData=globalThis.FormData;
  globalThis.FormData=class{get(){return null;}};
  try{await form.props.onSubmit({preventDefault(){},currentTarget:{}});}finally{globalThis.FormData=nativeFormData;}
  form=formState.render(node.type,node.props);
  assert.equal(d.closed,0);assert.equal(attempted.length,1);
  assert.equal(attempted[0].text,'Unfinished note: the patient asked about the next review.');
  assert.equal(input(form,item=>item.props?.rows===7).props.value,attempted[0].text);
  const error=input(form,item=>item.props?.role==='alert');assert.ok(error);assert.equal(error.props.tabIndex,-1);
  let focused=0;error.props.ref.current={focus(){focused++;}};formState.flush();assert.equal(focused,1);
  component(d.render(),'Dialog').props.onOpenChange(false);assert.equal(d.closed,0);assert.equal(component(d.render(),'AlertDialog').props.open,true);
});

test('Spanish goal editing uses Spanish controls and preserves the original goal text',()=>{
  const d=dialog({kind:'goal',patient:{...p,preferredLanguage:'es'}});
  const tree=d.render(),node=component(tree,'EntryForm');
  assert.match(labels(tree),/Actualizar objetivo/);assert.match(labels(tree),/¿Descartar los cambios sin guardar\?/);
  assert.equal(input(tree,item=>item.props?.['aria-label']==='Cerrar').props.type,'button');
  // Render the actual form with React's server renderer; UI primitives and labels are real.
  const realOuter=ui.EntryDialog({entry:{kind:'goal',patient:{...p,preferredLanguage:'es'}},close:()=>{},ctx:d.ctx});
  assert.ok(realOuter,'the patient-specific dialog is available');
  const formState=runner(),element=formState.render(node.type,node.props);
  const markup=renderToStaticMarkup(element);
  assert.match(markup,/lang="es"/);assert.match(markup,/Objetivo del paciente/);assert.match(markup,/Cancelar/);assert.match(markup,/>\s*Guardar</);
  assert.match(markup,/Walk with María for twenty minutes/);
  assert.doesNotMatch(markup,/Patient goal|>Save<|>Cancel</);
});
