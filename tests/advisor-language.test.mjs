import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({stdin:{contents:"export {advisorReply,buildEngineOutput} from './lib/engine-demo';export {seedWorkspace} from './lib/theranetrix';export {normalizeWorkspace} from './lib/medications';export {applyAction,actionSchema} from './lib/actions';export * as coordination from './lib/clinical-flows/patient-coordination';export {CompanionProgress,Schedule} from './components/theranetrix/workflows';export {EngineBoard} from './components/theranetrix/engine-workspace';export {ObservationHistory,numericObservationSource} from './components/theranetrix/clinical-flows/observation-history';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false,plugins:[{name:'css-rendering',setup(builder){builder.onLoad({filter:/\.css$/},()=>({contents:'export default {}',loader:'js'}));}}]});
const require=createRequire(process.cwd()+'/package.json');
function load(react=React){const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(name=>name==='react'?react:require(name),mod,mod.exports);return mod.exports;}
const {advisorReply,buildEngineOutput,seedWorkspace,normalizeWorkspace,applyAction,actionSchema,coordination,CompanionProgress,EngineBoard,ObservationHistory,numericObservationSource}=load();
const now='2026-09-17T12:00:00Z',patientId='TN-DEMO-01';
const patient=workspace=>workspace.patients.find(record=>record.id===patientId);
const ctx=data=>({data,user:'Reviewing clinician',busy:false,save:async()=>false,open:()=>{}});
const render=(Component,workspace,extra={})=>renderToStaticMarkup(React.createElement(Component,{p:patient(workspace),ctx:ctx(workspace),...extra}));
function fixture(){
  const workspace=normalizeWorkspace(seedWorkspace()),p=patient(workspace);
  p.preferredLanguage='es';
  p.carePlans=[{id:'current-plan',workflowVersion:3,text:'Bring your activity notes to the next review.',owner:'Alex Morgan',followup:'2026-09-24',time:'10:00',timezone:'Europe/Madrid',appointmentBooked:false,date:now,author:'Reviewing clinician'}];
  const command={type:'patient-coordination.language.save',requestId:'reviewed-spanish',patientId,encounterId:'language-review',planId:p.carePlans[0].id,planVersion:3,preferredLanguage:'es',instructionsLanguage:'es',sourceText:p.carePlans[0].text,translatedText:'Trae tus notas de actividad a la próxima revisión.',translationStatus:'translated',translationReviewer:'Lucía Pérez, intérprete',accessibilityPreferences:[],teachBack:'The patient explained when to bring the notes.',sharedDevice:false,proxyStatus:'none',verifiedPatientAuth:false};
  workspace.clinicalWorkflows.slices['patient-coordination'].state=coordination.reduce(coordination.initialState(),coordination.actionSchema.parse(command),{actor:'Reviewing clinician',now,patients:workspace.patients,carePlans:[{id:'current-plan',patientId,version:3,summary:p.carePlans[0].text}]});
  return workspace;
}

test('Spanish advisor uses only the reviewed current plan and preserves the original request',()=>{
  const workspace=fixture(),before=structuredClone(workspace),request='¿Podemos hablar de mi plan? No quiero cambiar mis palabras.';
  const response=advisorReply(patient(workspace),workspace,'plan',request);
  assert.match(response.reply,/Trae tus notas de actividad a la próxima revisión/);
  assert.match(response.reply,/versión 3 revisada por Lucía Pérez/);
  assert.match(response.reply,/Seguimiento solicitado; cita sin confirmar: 2026-09-24 10:00 Europe\/Madrid/);
  assert.doesNotMatch(response.reply,/Bring your activity notes|Your saved care plan/);
  assert.ok(response.summary.endsWith(request));
  assert.deepEqual(workspace,before);
});

test('obsolete, foreign, and newly pending translations fall back to the current original plan',()=>{
  const variants=[
    workspace=>{patient(workspace).carePlans[0].workflowVersion=4;},
    workspace=>{patient(workspace).carePlans[0].id='replacement-plan';},
    workspace=>{workspace.clinicalWorkflows.slices['patient-coordination'].state.language[0].patientId='another-patient';},
    workspace=>{const state=workspace.clinicalWorkflows.slices['patient-coordination'].state;state.language.unshift({...state.language[0],id:'new-review',updatedAt:'2026-09-17T12:01:00Z',translationStatus:'pending-review',translationReviewer:undefined,translatedText:undefined});},
  ];
  for(const change of variants){
    const workspace=fixture();change(workspace);
    const response=advisorReply(patient(workspace),workspace,'plan','Quiero revisar el plan.');
    assert.match(response.reply,/traducción al español de este plan todavía necesita revisión/);
    assert.match(response.reply,/Plan guardado en su idioma original: Bring your activity notes/);
    assert.doesNotMatch(response.reply,/Trae tus notas|versión 3 revisada/);
  }
});

test('saved language controls the response, missing plans remain explicit, and question replies do not claim delivery',()=>{
  const workspace=fixture(),p=patient(workspace),original='¿Quién revisa mi pregunta?';
  const spanish=advisorReply(p,workspace,'question',original);
  assert.match(spanish.reply,/quedó guardada en la lista de revisión de este espacio/);
  assert.match(spanish.reply,/Aún no se ha confirmado que el equipo la haya recibido/);
  assert.ok(spanish.summary.endsWith(original));
  p.carePlans=[];
  assert.match(advisorReply(p,workspace,'plan',original).reply,/Todavía no hay un plan de atención guardado/);
  p.preferredLanguage='en';
  const english=advisorReply(p,workspace,'question',original);
  assert.match(english.reply,/saved in this workspace’s care-team review queue for a human response/);
  assert.match(english.reply,/Receipt by your care team has not been confirmed/);
  assert.doesNotMatch(english.reply,/I’ve sent|receives a human response/);
  delete p.preferredLanguage;
  assert.match(advisorReply(p,workspace,'progress',original).reply,/Your update is recorded/);
});

test('Spanish progress and concern keep the original goal and distinguish urgent requests from clinical triage',()=>{
  const workspace=fixture(),p=patient(workspace),original='Me cuesta subir las escaleras por la mañana.';
  const progress=advisorReply(p,workspace,'progress',original,'urgent');
  assert.match(progress.reply,/¿Qué te resultó más fácil hoy/);
  assert.ok(progress.reply.includes(p.goal));
  assert.match(progress.reply,/marcada como urgente/);
  const concern=advisorReply(p,workspace,'concern',original,'urgent');
  assert.match(concern.reply,/¿Qué cambió y cuándo empezó/);
  assert.match(concern.reply,/Este mensaje no cambia ningún medicamento/);
  assert.ok(concern.summary.endsWith(original));
  assert.doesNotMatch(concern.reply,/evaluación clínica|equipo ha recibido/);
});

test('saving an urgent plan or progress request preserves intent, original wording, and the local handoff',()=>{
  for(const intent of ['plan','progress']){
    const workspace=fixture(),text='Me preocupa cómo me siento. Necesito que revisen mi mensaje.';
    const saved=applyAction(workspace,actionSchema.parse({type:'advisor.chat',patientId,requestId:'urgent-'+intent,intent,text,concernUrgency:'urgent'}),'Patient companion',now);
    const turn=saved.advisorTurns.at(-1),handoff=saved.clinicalWorkflows.slices['patient-coordination'].state.handoffs.find(record=>record.id===turn.handoffId);
    assert.equal(turn.intent,intent);assert.equal(turn.patientText,text);assert.ok(turn.summary.endsWith(text));
    assert.equal(handoff.concern,text);assert.equal(handoff.priority,'high');assert.equal(handoff.urgencySource.type,'patient-request');
    assert.equal(handoff.phase,'locally-saved');assert.equal(handoff.deliveryStatus,'pending');
    assert.match(turn.reply,/marcada como urgente/);assert.match(turn.reply,/Aún no se ha confirmado/);
    assert.equal(saved.messages.filter(message=>message.patientId===patientId&&message.direction==='in').at(-1).text,text);
    assert.deepEqual(patient(saved).pain,patient(workspace).pain);
  }
  const workspace=fixture();
  const saved=applyAction(workspace,actionSchema.parse({type:'advisor.chat',patientId,requestId:'routine-concern',intent:'concern',text:'Quiero hablar sobre mis actividades.',concernUrgency:'routine'}),'Patient companion',now);
  assert.equal(saved.clinicalWorkflows.slices['patient-coordination'].state.handoffs.at(-1).priority,'routine');
});

test('withdrawn values remain labelled history in the companion and clinician observations',()=>{
  const workspace=fixture(),p=patient(workspace);
  p.dates=['2026-09-17'];p.pain=[2];p.function=[6];p.sleep=[7];
  const withdrawal={withdrawnAt:'2026-09-17T11:00:00Z',withdrawalReason:'These responses were attached to the wrong visit.'};
  p.checkins=[{id:'current',date:now,pain:2,function:6,sleep:7,note:'Current patient report',source:'Patient self-report'},{id:'withdrawn',date:'2026-09-16T10:00:00Z',pain:0,function:8,sleep:4,note:'Withdrawn original report',workflowRecordId:'withdrawn-report',workflowVersion:1,...withdrawal}];
  p.workflowObservations=[{id:'pain-zero',metric:'pain',status:'zero',value:0},{id:'function-declined',metric:'function',status:'declined'},{id:'sleep-unanswered',metric:'sleep',status:'unanswered'}].map(entry=>({...entry,workflowRecordId:'withdrawn-report',workflowVersion:1,encounterId:'wrong-visit',source:'Original patient report',recordedAt:'2026-09-16T10:00:00Z',confirmedAt:'2026-09-16T11:00:00Z',confirmedBy:'Original reviewer',...withdrawal}));
  const before=structuredClone(p),html=render(CompanionProgress,workspace,{lang:'es'}),historyStart=html.indexOf('<details');
  assert.ok(historyStart>0);assert.match(html.slice(historyStart),/Registros retirados/);
  assert.match(html.slice(historyStart),/0\/10/);assert.match(html.slice(historyStart),/No quiso responder/);assert.match(html.slice(historyStart),/Sin respuesta/);
  assert.doesNotMatch(html.slice(0,historyStart),/Withdrawn original report|wrong-visit/);
  assert.match(html,/Current patient report/);
  const clinician=renderToStaticMarkup(React.createElement(ObservationHistory,{patient:p}));
  assert.match(clinician,/Withdrawn report/);assert.match(clinician,/Withdrawn entries/);assert.match(clinician,/0 \/ 10 · Zero response/);
  assert.doesNotMatch(clinician,/data-observation-current="true"|Current confirmed responses|All measures answered/);
  assert.equal((clinician.match(/data-observation-withdrawn="true"/g)??[]).length,3);
  assert.deepEqual(p,before);
  const sameValues={dates:['2026-09-16'],pain:[0],function:[8],sleep:[4],checkins:[{...p.checkins[1],source:'Clinician-confirmed report',trajectoryIndex:0}]};
  assert.equal(numericObservationSource(sameValues,0),'Stored trajectory','A value with no matching check-in is the stored trajectory, not a borrowed source');
});

test('a historical engine run stays visibly historical after an observation changes and a decision exists',()=>{
  const workspace=fixture(),p=patient(workspace),output=buildEngineOutput(p,workspace);
  workspace.engineRuns=[{...output,id:'old-run',date:now,actor:'Reviewing clinician'}];
  workspace.engineDecisions=[{id:'decision',runId:'old-run',patientId,candidateId:'review-current',title:'Earlier review',rationale:'Reviewed the earlier record.',patientPlan:'Earlier plan',owner:'Reviewing clinician',followup:'2026-09-24',date:now,actor:'Reviewing clinician',planId:'earlier-plan'}];
  p.pain.pop();p.function.pop();p.sleep.pop();p.dates.pop();
  const html=render(EngineBoard,workspace,{initialTab:'history'});
  assert.match(html,/Historical inputs/);
  assert.match(html,/Earlier review/);
  const twin=render(EngineBoard,workspace,{initialTab:'twin'});
  assert.match(twin,/Latest recorded pain/);
  assert.doesNotMatch(twin,/>Pain saved in this run</);
});

test('schedule separates superseded work and directs source-owned tasks to their workflow',()=>{
  let workspace=fixture();
  workspace=applyAction(workspace,actionSchema.parse({type:'advisor.request',patientId,requestId:'schedule-source',text:'Please review the saved concern.',concernUrgency:'routine'}),'Patient companion',now);
  const handoff=workspace.clinicalWorkflows.slices['patient-coordination'].state.handoffs[0];
  const sourceTask=workspace.tasks.find(task=>task.workflowRecordId===handoff.id);
  assert.ok(sourceTask);
  workspace.tasks=[sourceTask,{id:'withdrawn-work',patientId,title:'Old optional activity',date:'2026-09-18',time:'',type:'Care coordination',done:true,workflowDisposition:'deferred',workflowDomain:'decisions',workflowRecordId:'old-choice',owner:'Reviewing clinician'}];
  const {Schedule}=load({...React,useState:initial=>React.useState(initial==='Open'?'All activities':initial)});
  const html=render(Schedule,workspace);
  assert.match(html,/Open workflow/);assert.match(html,/Managed in workflow/);assert.match(html,/workflow=patient-coordination/);
  assert.equal((html.match(/href="[^"]*workflow=patient-coordination[^"]*"/g)??[]).length,1,'source-owned activity has one workflow action');
  assert.match(html,/Withdrawn \/ superseded/);assert.match(html,/View source history/);
  assert.match(html,/workflow=decisions/);assert.doesNotMatch(html,/>Completed<\/span>/);
  const checkboxes=[...html.matchAll(/<button\b[^>]*role="checkbox"[^>]*>/g)].map(match=>match[0]);
  assert.equal(checkboxes.length,2);assert.ok(checkboxes.every(button=>/\bdisabled=""/.test(button)));
});
