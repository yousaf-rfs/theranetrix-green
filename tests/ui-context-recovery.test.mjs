import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:"export * from './lib/workspace-client'; export * from './lib/patient-selection';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {saveWorkspaceAction,selectedPatient}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('explicit unknown or empty patient context cannot open a different writable chart',()=>{
  const patients=[{id:'emma'},{id:'lucas'}];
  assert.equal(selectedPatient(patients,'unknown'),undefined);
  assert.equal(selectedPatient(patients,''),undefined);
  assert.equal(selectedPatient(patients,'lucas'),patients[1]);
  assert.equal(selectedPatient(patients,null),patients[0]);
  assert.equal(selectedPatient(patients,'unknown','lucas'),patients[1]);
  assert.equal(selectedPatient([],null),undefined);
});

test('a conflict retains the submitted version and draft and never automatically reloads records',async()=>{
  const calls=[],action={type:'goal.update',patientId:'lucas',goal:'Unfinished patient wording'};
  const result=await saveWorkspaceAction(7,action,async(url,options)=>{
    calls.push({url,options});
    return new Response(JSON.stringify({error:'Workspace changed in another session.',data:{patients:[]},version:8}),{status:409});
  });
  assert.deepEqual(result,{saved:false,conflict:true,message:'Workspace changed in another session.'});
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.method,'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body),{version:7,action});
  assert.equal('data' in result,false);
  assert.equal(action.goal,'Unfinished patient wording');
});

test('only a successful save makes replacement workspace data available',async()=>{
  const action={type:'goal.update',patientId:'lucas',goal:'Walk to the park'};
  const denied=await saveWorkspaceAction(7,action,async()=>new Response(JSON.stringify({error:'Access changed.',data:{patients:[]}}),{status:400}));
  assert.deepEqual(denied,{saved:false,conflict:false,message:'Access changed.'});
  const data={patients:[{id:'lucas',goal:action.goal}]};
  const saved=await saveWorkspaceAction(7,action,async()=>Response.json({data,version:8}));
  assert.deepEqual(saved,{saved:true,data,version:8,undo:null});
});
