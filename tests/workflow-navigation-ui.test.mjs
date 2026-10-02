import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

const bundle=await build({entryPoints:['lib/workflow-navigation.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {reconcileWorkflowRoute,selectWorkflow,patientRecordViewSearch,focusWorkflowJourney,openWorkflow,workflowOpenEvent,workflowOpenDomain}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('an explicit launch reopens the same hidden domain on every request and rejects unavailable areas',()=>{
  const priorWindow=globalThis.window,target=new EventTarget();globalThis.window=target;
  let state={...reconcileWorkflowRoute({visited:[]},'integration-access'),opened:false},accepted=0;
  const listener=event=>{const domain=workflowOpenDomain(event,['integration-access','program-governance']);if(domain){state=selectWorkflow(state,domain);accepted++;}};
  target.addEventListener(workflowOpenEvent,listener);
  try{
    openWorkflow('integration-access');assert.equal(state.opened,true);assert.equal(state.selected,'integration-access');
    state={...state,opened:false};openWorkflow('integration-access');assert.equal(state.opened,true);assert.equal(accepted,2);
    const unchanged=state;openWorkflow('encounters');assert.strictEqual(state,unchanged,'A settings workbench cannot open a patient-only domain.');
    target.dispatchEvent(new CustomEvent(workflowOpenEvent,{detail:{domain:['integration-access']}}));
    target.dispatchEvent(new Event(workflowOpenEvent));assert.equal(accepted,2);
    assert.deepEqual(state.visited,['integration-access'],'Repeated launches retain the same mounted domain.');
  }finally{target.removeEventListener(workflowOpenEvent,listener);if(priorWindow===undefined)delete globalThis.window;else globalThis.window=priorWindow;}
});

test('leaving a screen guide retains its selected, open and mounted workflow',()=>{
  const deepLink=reconcileWorkflowRoute({visited:[]},'decisions');
  const recordView=reconcileWorkflowRoute(deepLink,undefined);
  assert.equal(recordView.selected,'decisions');assert.equal(recordView.opened,true);
  assert.deepEqual(recordView.visited,['decisions'],'The existing form remains mounted after guide parameters disappear.');
  assert.strictEqual(reconcileWorkflowRoute(recordView,undefined),recordView,'Repeated renders without a route change must not schedule state updates.');
});

test('record-view navigation preserves an explicit workflow while exiting the guide',()=>{
  const next=new URLSearchParams(patientRecordViewSearch('?journey=J18&journeyStop=1&journeyPatient=p1&patient=p1&workflow=decisions&workflowJourney=J18&tab=visit&filter=active','outcomes'));
  assert.equal(next.get('tab'),'outcomes');assert.equal(next.get('patient'),'p1');assert.equal(next.get('workflow'),'decisions');assert.equal(next.get('workflowJourney'),'J18');assert.equal(next.get('filter'),'active');
  for(const key of ['journey','journeyStop','journeyPatient'])assert.equal(next.has(key),false,'A record-view change leaves the old guided screen sequence.');
});

test('manual workflow choice and hidden drafts survive unrelated URL changes',()=>{
  const started=reconcileWorkflowRoute({visited:[]},'decisions');
  const chosen=selectWorkflow(started,'encounters');
  assert.strictEqual(reconcileWorkflowRoute(chosen,'decisions'),chosen,'A still-present launch address cannot override a manual workflow choice.');
  const hidden={...chosen,opened:false};
  const withoutGuide=reconcileWorkflowRoute(hidden,undefined);
  assert.equal(withoutGuide.selected,'encounters');assert.equal(withoutGuide.opened,false);
  assert.deepEqual(withoutGuide.visited,['decisions','encounters']);
  const nextRoute=reconcileWorkflowRoute(withoutGuide,'results-referrals');
  assert.equal(nextRoute.selected,'results-referrals');assert.equal(nextRoute.opened,true);
  assert.deepEqual(nextRoute.visited,['decisions','encounters','results-referrals']);
});

function destinationTree(tagName='LEGEND',text='Review and sign the encounter',journey='J14'){
  const effects=[];
  const outer={open:false,parentElement:null};
  const inner={open:false,parentElement:{closest:selector=>selector==='details'?outer:null}};
  const heading={tagName,textContent:text,attributes:{'data-journey':journey},closest:selector=>selector==='details'?inner:null,
    getAttribute(name){return this.attributes[name]??null;},
    setAttribute(name,value){this.attributes[name]=value;},
    focus(options){effects.push({kind:'focus',options,allDisclosuresOpen:inner.open&&outer.open});},
    scrollIntoView(options){effects.push({kind:'scroll',options});},
  };
  const unrelated={...heading,tagName:'H3',textContent:'A different section',attributes:{'data-journey':'J140'},focus(){throw new Error('Focused the wrong journey.');}};
  const root={querySelectorAll:selector=>[unrelated,heading].filter(node=>selector.split(',').includes(node.tagName.toLowerCase())),contains:node=>[outer,inner,heading,unrelated].includes(node)};
  return {root,heading,inner,outer,effects};
}

test('a journey represented by a legend opens nested disclosures and receives keyboard focus',()=>{
  const tree=destinationTree();
  assert.equal(focusWorkflowJourney(tree.root,'J14'),true);
  assert.equal(tree.heading.attributes.tabindex,'-1');
  assert.deepEqual(tree.effects,[{kind:'focus',options:{preventScroll:true},allDisclosuresOpen:true},{kind:'scroll',options:{block:'start'}}]);
});

test('native summary destinations keep their keyboard behavior and missing destinations do not steal focus',()=>{
  const tree=destinationTree('SUMMARY','Review and sign');
  assert.equal(focusWorkflowJourney(tree.root,'J14'),true);
  assert.equal(tree.heading.attributes.tabindex,undefined,'Native summary remains in its ordinary tab sequence.');
  const missing=destinationTree();
  assert.equal(focusWorkflowJourney(missing.root,'J15'),false);
  assert.equal(focusWorkflowJourney(missing.root,'J14.*'),false);
  assert.deepEqual(missing.effects,[]);assert.equal(missing.inner.open,false);assert.equal(missing.outer.open,false);
});
