import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {ADVISOR_HANDOFF_SOURCE} from './fixtures/product-names.mjs';

const compiled=await build({stdin:{contents:"export * from './lib/theranetrix';export * from './lib/demo-showcase';export * from './lib/engine-demo';export * from './lib/actions';export * from './lib/medications';export * from './lib/treatment-review';export * from './lib/patient-overview';export * from './lib/patient-twin-settings';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {seedWorkspace,normalizeWorkspace,ensureShowcaseData,showcaseVersion,engineRecordRevision,buildEngineOutput,applyAction,actionSchema,treatmentCourse,patientSuggestions,patientSnapshot,patientTwinPreferences}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const emma='TN-DEMO-01',lucas='TN-DEMO-02',noMed='TN-DEMO-03';
const showcase=()=>ensureShowcaseData(seedWorkspace());
const patient=(w,id)=>w.patients.find(p=>p.id===id);

test('the clean seed stays clean and the showcase is opt-in',()=>{
 const plain=seedWorkspace();
 assert.equal(plain.showcaseVersion,undefined);
 assert.equal(plain.engineRuns,undefined);assert.equal(plain.advisorTurns,undefined);assert.equal(plain.engineDecisions,undefined);
 assert.equal(plain.dashboardProfiles,undefined);assert.equal(plain.planning,undefined);assert.equal(plain.configurationHistory,undefined);
 assert.equal(plain.patients.length,10);
 // normalizeWorkspace must not inject demonstration records into a saved workspace.
 assert.equal(normalizeWorkspace(seedWorkspace()).showcaseVersion,undefined);
});

test('every feature area has saved records',()=>{
 const w=showcase();
 assert.equal(w.showcaseVersion,showcaseVersion);
 assert.equal(w.patients.length,11);
 assert.ok(w.engineRuns.length>=4,'saved Digital Twin / PST / Shadow runs');
 assert.ok(w.engineDecisions.length>=1,'recorded clinician decision');
 assert.ok(w.advisorTurns.length>=6,'Robo Advisor conversation history');
 assert.ok(w.dashboardProfiles.length>=3,'saved doctor dashboards');
 assert.ok(w.configurationHistory.length>=1,'FDA planning snapshot');
 assert.ok(w.planning.intendedUse.length>0,'saved planning profile');
 assert.ok(w.audit.length>=16,'audit history');
 assert.ok(w.patients.some(p=>p.twinPreferences),'patient Digital Twin customization');
 assert.ok(w.tasks.some(t=>t.done&&t.history?.length),'a completed activity retaining history');
 assert.ok(w.reviews.some(r=>r.status==='Resolved'&&r.history?.length>=2),'a resolved review with transition history');
 for(const turn of ['progress','concern','plan','question'])assert.ok(w.advisorTurns.some(t=>t.intent===turn),'advisor intent: '+turn);
 assert.ok(w.advisorTurns.some(t=>t.checkinId),'a confirmed check-in from the advisor');
 assert.ok(w.advisorTurns.some(t=>t.reviewId),'a care-team handoff from the advisor');
});

test('seeding is idempotent and never duplicates or replaces records',()=>{
 const once=showcase(),twice=ensureShowcaseData(structuredClone(once));
 assert.deepEqual(twice,once);
 // A second independent pass over an already-seeded workspace changes nothing.
 assert.equal(twice.engineRuns.length,once.engineRuns.length);
 assert.equal(twice.patients.length,once.patients.length);
 // Repeated normalizeWorkspace passes must not add recovered observation rows.
 const normalized=normalizeWorkspace(structuredClone(once));
 assert.deepEqual(normalizeWorkspace(structuredClone(normalized)),normalized);
 for(const id of [emma,lucas,noMed]){
   const p=patient(normalized,id);
   assert.equal(p.checkins.length,p.dates.length,id+' has one source row per observation');
   assert.deepEqual([...p.checkins].sort((a,b)=>b.date.localeCompare(a.date)),p.checkins,id+' check-ins stay newest-first');
 }
});

test('an existing workspace keeps its own edits when the showcase loads',()=>{
 const w=normalizeWorkspace(seedWorkspace());
 patient(w,'TN-1042').goal='Operator edited goal';
 patient(w,'TN-1038').clinicalContext={allergyStatus:'None reported',allergies:'',medicalHistory:'Operator authored history',priorTreatments:'',painLocation:'',painDuration:'',physicalContext:'',psychologicalContext:'',socialContext:'',coordinator:'',preferences:'',date:'2026-09-10T00:00:00Z',author:'Operator',history:[]};
 w.dashboardProfiles=[{id:'operator',name:'Operator dashboard',layout:{columns:['plan'],showEngines:true,showSummary:true,showDemoLinks:true,showEngineIntro:true,density:'compact',filter:'All patients',sort:'name',clinician:'All clinicians'},revision:'r1',updatedAt:'2026-09-10T00:00:00Z',updatedBy:'Operator'}];
 const loaded=ensureShowcaseData(w);
 assert.equal(patient(loaded,'TN-1042').goal,'Operator edited goal');
 assert.equal(patient(loaded,'TN-1038').clinicalContext.medicalHistory,'Operator authored history');
 assert.equal(patient(loaded,'TN-1038').clinicalContext.author,'Operator');
 assert.deepEqual(loaded.dashboardProfiles.map(p=>p.id),['operator']);
 assert.ok(loaded.engineRuns.length>=4,'records that were genuinely absent are still added');
});

test('saved runs match the record they were computed from, and the decided run is superseded',()=>{
 const w=normalizeWorkspace(showcase());
 for(const id of [emma,lucas]){
   const p=patient(w,id),runs=w.engineRuns.filter(r=>r.patientId===id);
   assert.equal(runs.length,4,id+' retains prior runs and a current governed story run');
   // Newest first, and the newest run's fingerprint matches the live record so the
   // UI shows a current, decidable run rather than a stale one.
   assert.ok(runs[0].date>=runs[1].date,id+' runs are newest-first');
   assert.equal(runs[0].revision,engineRecordRevision(p,w),id+' newest run is current');
   assert.notEqual(runs[1].revision,engineRecordRevision(p,w),id+' older run is historical');
   assert.deepEqual(runs[0].candidates,buildEngineOutput(p,w,runs[0].preferences).candidates,id+' run reproduces from the record');
 }
 const decision=w.engineDecisions.find(d=>d.patientId===emma);
 assert.ok(decision,'the finding-treatment case has a recorded decision');
 assert.equal(decision.runId,w.engineRuns.filter(r=>r.patientId===emma).at(-1).id,'the decision references the original, exact run');
 assert.ok(!w.engineDecisions.some(d=>d.runId===w.engineRuns.filter(r=>r.patientId===emma)[0].id),'the current run is still open for a decision');
 let plan=patient(w,emma).carePlans[0];while(plan.supersedes&&plan.supersedes!==decision.planId)plan=patient(w,emma).carePlans.find(row=>row.id===plan.supersedes);assert.equal(plan.supersedes,decision.planId,'the signed amendment chain retains the original decision plan');
 assert.equal(w.tasks.filter(t=>t.id==='medication-followup-'+emma).length,1,'one current follow-up task');
 assert.ok(w.tasks.find(t=>t.id==='medication-followup-'+emma).history?.length,'the prior follow-up state is retained');
});

test('the two engines disagree in one case and agree in the other',()=>{
 const w=normalizeWorkspace(showcase());
 const emmaRun=w.engineRuns.filter(r=>r.patientId===emma)[0];
 assert.equal(emmaRun.agreement,false,'reported effects and an open concern split the demo rankings');
 assert.equal(emmaRun.shadowOrder[0],'review-current');
 assert.notEqual(emmaRun.pstOrder[0],emmaRun.shadowOrder[0]);
 const lucasRun=w.engineRuns.filter(r=>r.patientId===lucas)[0];
 assert.equal(lucasRun.agreement,true);
 assert.equal(lucasRun.pstOrder[0],'monitor-plan');
 for(const run of [emmaRun,lucasRun]){
   assert.match(run.basis.join(' '),/not a confidence interval/);
   assert.match(run.basis.join(' '),/not drug efficacy/);
   assert.ok(run.gaps.length,'unresolved data gaps stay visible on a saved run');
 }
});

test('the improving case is resolved and clean, the finding-treatment case still needs review',()=>{
 const w=normalizeWorkspace(showcase());
 const l=patient(w,lucas);
 assert.equal(l.status,'On track');
 assert.equal(l.recordReviewRequiredSince,undefined,'a new clinician assessment cleared the pending flag');
 assert.equal(treatmentCourse(l,w).needsRecheck,false,'no newer record than the saved assessment');
 const e=patient(w,emma);
 assert.equal(e.status,'Needs review');
 assert.ok(treatmentCourse(e,w).needsRecheck,'the new self-report post-dates the saved assessment');
 assert.ok(w.reviews.some(r=>r.patientId===emma&&r.source===ADVISOR_HANDOFF_SOURCE&&r.status!=='Resolved'),'the concern handoff is still open');
});

test('missing-data states are preserved, and confirmed absence is a separate record',()=>{
 const w=normalizeWorkspace(showcase());
 // TN-1047 keeps its unreviewed history and allergy gap.
 const gaps=patientSnapshot(patient(w,'TN-1047'),w).gaps.map(g=>g.label);
 assert.ok(gaps.includes('Allergies need review'));
 assert.ok(gaps.includes('Medical history incomplete'));
 // TN-1055 keeps an empty, never-reconciled medication list.
 const unconfirmed=patient(w,'TN-1055');
 assert.equal(unconfirmed.medications.length,0);
 assert.equal(unconfirmed.medicationReconciliation,undefined);
 assert.ok(patientSuggestions(unconfirmed,w).some(s=>s.title==='Reconcile the medication list'));
 // TN-DEMO-03 records a confirmed absence instead, so both states are demonstrable.
 const confirmed=patient(w,noMed);
 assert.equal(confirmed.medications.length,0);
 assert.equal(confirmed.medicationReconciliation.none,true);
 assert.ok(confirmed.medicationReconciliation.date&&confirmed.medicationReconciliation.author);
 assert.ok(!patientSuggestions(confirmed,w).some(s=>s.title==='Reconcile the medication list'));
 // An unassessed response still has somewhere to show.
 assert.ok(patientSuggestions(patient(w,'TN-1049'),w).some(s=>s.title==='Ask about benefit and tolerability'));
 // Every mapped integration gap stays labelled rather than simulated.
 assert.ok(patientSnapshot(patient(w,emma),w).gaps.some(g=>g.kind==='integration'));
});

test('patient Digital Twin customization is per patient and keeps its revision history',()=>{
 const w=normalizeWorkspace(showcase());
 const e=patient(w,emma),l=patient(w,lucas),sarah=patient(w,'TN-1042');
 assert.equal(patientTwinPreferences(e).primary,'function');
 assert.deepEqual(patientTwinPreferences(e).measures,['pain','function']);
 assert.equal(e.twinPreferences.history.length,1,'an earlier saved display revision is retained');
 assert.ok(e.twinPreferences.explanation.length>0,'a care-team note is shown to the patient');
 assert.equal(patientTwinPreferences(sarah).primary,'sleep');
 assert.equal(patientTwinPreferences(sarah).showMedications,false,'a hidden section is demonstrated');
 assert.notDeepEqual(patientTwinPreferences(e),patientTwinPreferences(l));
 // Display settings are excluded from the engine fingerprint, so they never
 // invalidate a saved run.
 const before=engineRecordRevision(e,w);
 e.twinPreferences.primary='pain';
 assert.equal(engineRecordRevision(e,w),before);
});

test('showcase.load fills an existing workspace once and is then rejected',()=>{
 let w=normalizeWorkspace(seedWorkspace());
 w=applyAction(w,actionSchema.parse({type:'showcase.load'}),'Owner','2026-09-16T12:00:00Z');
 assert.equal(w.showcaseVersion,showcaseVersion);
 assert.ok(w.engineRuns.length>=4);assert.ok(w.advisorTurns.length>=6);
 assert.equal(w.audit[0].actor,'Owner');
 assert.throws(()=>applyAction(w,actionSchema.parse({type:'showcase.load'}),'Owner'),/already loaded/);
});

test('every saved record is attributed and dated, and nothing claims to be clinical',()=>{
 const w=normalizeWorkspace(showcase());
 for(const run of w.engineRuns){assert.ok(run.actor&&run.date&&run.version&&run.revision);}
 for(const decision of w.engineDecisions){assert.ok(decision.actor&&decision.date&&decision.rationale&&decision.patientPlan);}
 for(const entry of w.audit){assert.ok(entry.actor&&entry.date&&entry.action);}
 for(const profile of w.dashboardProfiles){assert.ok(profile.updatedBy&&profile.updatedAt&&profile.revision);}
 for(const p of w.patients){
   if(p.clinicalContext)assert.ok(p.clinicalContext.author&&p.clinicalContext.date,p.id+' context attribution');
   if(p.treatmentReview)assert.ok(p.treatmentReview.author&&p.treatmentReview.date,p.id+' assessment attribution');
   for(const m of p.medications)assert.equal(m.source,'Patient report',p.id+' medication keeps its recorded source');
 }
 const snapshot=w.configurationHistory[0];
 assert.ok(snapshot.items.length&&snapshot.questions.length,'planning items and open questions are recorded');
 assert.ok(snapshot.sources.length,'official guidance sources are captured');
 assert.match(w.planning.rationale,/not as evidence of compliance/);
});

// Rendered checks: the saved records must actually reach the screen, and the
// engine board must show a current run rather than an empty or stale state.
const {createRequire}=await import('node:module');
const React=(await import('react')).default;
const {renderToStaticMarkup}=await import('react-dom/server');
const uiBundle=await build({stdin:{contents:"export {EngineBoard} from './components/theranetrix/engine-workspace';export {PatientDigitalTwin} from './components/theranetrix/patient-digital-twin';export {ShowcaseRecords,Schedule,Messages} from './components/theranetrix/workflows';export {MedicationPanel} from './components/theranetrix/medications';export {EngineEncounterSummary} from './components/theranetrix/live-engine-summary';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false,plugins:[{name:'css-for-ssr',setup(builder){builder.onLoad({filter:/\.css$/},()=>({contents:'export default {}',loader:'js'}));}}]});
const ui={exports:{}};new Function('require','module','exports',uiBundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),ui,ui.exports);
const context=w=>({data:w,user:'Owner',busy:false,save:async()=>true,open:()=>{},signOut:async()=>{}});
const render=(C,props)=>renderToStaticMarkup(React.createElement(C,props));

test('the engine board shows a current saved run, its history, and the recorded decision',()=>{
 const w=normalizeWorkspace(showcase()),p=patient(w,emma);
 const overview=render(ui.exports.EngineBoard,{p,ctx:context(w),initialTab:'overview'});
 assert.ok(!overview.includes('No saved runs yet'),'no empty run state');
 assert.ok(!overview.includes('New information since this run'),'the latest run is not stale');
 assert.ok(overview.includes('Saved strategy snapshot')||overview.includes('Decision recorded'),'the current saved strategy state is visible');
 assert.ok(!overview.includes('Live calculation preview'),'a current saved run is not presented as an unsaved preview');
 assert.ok(overview.includes('Different first priority'),'the PST/Shadow disagreement is visible');
 assert.ok(overview.includes('Clinician-authored plan'),'the current signed plan is attributed to the clinician');
 const compare=render(ui.exports.EngineBoard,{p,ctx:context(w),initialTab:'compare'});
 assert.ok(compare.includes('Select a strategy to record your own rationale'),'a new decision can still be recorded');
 const history=render(ui.exports.EngineBoard,{p,ctx:context(w),initialTab:'history'});
 assert.match(history,/Run history \(4\)/);
 assert.ok(history.includes('Current inputs')&&history.includes('Historical inputs'),'run provenance is distinguishable');
 // The patient-facing twin shows the care-team note from the saved display settings.
 assert.ok(render(ui.exports.PatientDigitalTwin,{p,ctx:context(w)}).includes('A note from your care team'));
});


test('a confirmed reconciliation never also shows the unreviewed-list prompt',()=>{
 const w=normalizeWorkspace(showcase());
 const render=(C,props)=>renderToStaticMarkup(React.createElement(C,props));
 const confirmed=render(ui.exports.MedicationPanel,{p:patient(w,noMed),ctx:context(w),inline:true});
 assert.ok(confirmed.includes('Confirmed no current medications reported'),'the attributed reconciliation is shown');
 assert.ok(!confirmed.includes('No medication entries are recorded'),'and it is not contradicted by the unreviewed-list prompt');
 // The prompt must still appear for a list that was never reconciled.
 const unreviewed=render(ui.exports.MedicationPanel,{p:patient(w,'TN-1055'),ctx:context(w),inline:true});
 assert.ok(unreviewed.includes('No medication entries are recorded'));
 // Also holds for a reconciliation created through the live action, not just the seed.
 const live=applyAction(normalizeWorkspace(seedWorkspace()),actionSchema.parse({type:'medication.none',patientId:'TN-1055'}),'Reviewer','2026-09-16T12:00:00Z');
 const after=render(ui.exports.MedicationPanel,{p:patient(live,'TN-1055'),ctx:context(live),inline:true});
 assert.ok(after.includes('Confirmed no current medications reported'));
 assert.ok(!after.includes('No medication entries are recorded'));
});

test('every patient with a saved run opens on a current one, with older runs historical',()=>{
 const w=normalizeWorkspace(showcase());
 const withRuns=[...new Set(w.engineRuns.map(r=>r.patientId))];
 assert.deepEqual(withRuns.sort(),['TN-1042','TN-DEMO-01','TN-DEMO-02','TN-DEMO-03']);
 for(const id of withRuns){
   const p=patient(w,id),runs=w.engineRuns.filter(r=>r.patientId===id),current=engineRecordRevision(p,w);
   assert.equal(runs[0].revision,current,id+' newest run matches the live record');
   for(const older of runs.slice(1))assert.notEqual(older.revision,current,id+' older run is historical');
 }
});

test('no screen is left blank except the deliberate missing-data patient',()=>{
 const w=normalizeWorkspace(showcase());
 const render=(C,props)=>renderToStaticMarkup(React.createElement(C,props));
 // Robert Chen is the missing-data demonstration: no context, no messages, no plan.
 const bare=w.patients.filter(p=>!w.messages.some(m=>m.patientId===p.id)).map(p=>p.id);
 assert.deepEqual(bare,['TN-1047'],'only the gap-demo patient has no conversation');
 assert.ok(!patient(w,'TN-1047').clinicalContext,'TN-1047 keeps its unreviewed history');
 assert.ok(!patient(w,'TN-1055').medicationReconciliation,'TN-1055 keeps its never-reconciled list');
 assert.equal(patient(w,'TN-1049').medications[0].benefit,'Not assessed','TN-1049 keeps its unassessed response');
 // Every other patient has a scheduled visit and an advisor-reachable record.
 const schedule=render(ui.exports.Schedule,{ctx:context(w)});assert.ok(schedule.includes('Complete remote assessment'));assert.ok(schedule.includes('Contact patient about missing report'));assert.ok(w.tasks.some(task=>!task.done&&task.patientId===emma),'remaining work stays visible beside scheduled visits');
 // Exactly one conversation row reads empty, and it is the gap-demo patient's.
 const messagesHtml=render(ui.exports.Messages,{ctx:context(w)});
 const conversationRows=[...messagesHtml.matchAll(/<button[^>]*class="conversation [^"]*"[^>]*>([\s\S]*?)<\/button>/g)].map(match=>match[1]);
 assert.equal(conversationRows.length,w.patients.length,'every patient retains a conversation row');
 const emptyConversations=conversationRows.filter(row=>row.includes('No messages yet'));
 assert.equal(emptyConversations.length,1,'only one empty conversation row');
 assert.ok(emptyConversations[0].includes('Robert Chen'),'the empty row belongs to the missing-data patient');
 for(const p of w.patients.filter(patient=>patient.id!=='TN-1047'))assert.ok(conversationRows.some(row=>row.includes(p.name)&&!row.includes('No messages yet')),p.name+' retains a populated conversation preview');
 assert.ok(w.reviews.some(r=>r.status==='Acknowledged'),'the Acknowledged queue filter has an example');
 // The Robo Advisor card is populated wherever a patient has a conversation.
 for(const id of ['TN-1042','TN-DEMO-03'])
   assert.ok(!render(ui.exports.EngineEncounterSummary,{p:patient(w,id),ctx:context(w)}).includes('No patient exchange yet'),id);
 // The patient-facing twin carries a care-team note in both languages.
 for(const lang of ['en','es'])
   assert.ok(render(ui.exports.PatientDigitalTwin,{p:patient(w,noMed),ctx:context(w),lang}).match(/A note from your care team|Una nota de tu equipo/),lang);
});

test('a workspace seeded at an older version receives records added since',()=>{
 // Simulate a workspace created before the current seed: keep its records but
 // roll the marker back, exactly as a live workspace from an earlier deploy looks.
 const older=normalizeWorkspace(showcase());
 older.showcaseVersion=1;
 const before={
   patients:older.patients.length,
   runs:older.engineRuns.length,
   turns:older.advisorTurns.length,
 };
 // An operator edit made on that older workspace must survive the upgrade.
 patient(older,'TN-1042').goal='Operator goal set before the upgrade';
 const upgraded=ensureShowcaseData(older);
 assert.equal(upgraded.showcaseVersion,showcaseVersion,'marker moves to the current version');
 assert.equal(patient(upgraded,'TN-1042').goal,'Operator goal set before the upgrade','edits survive');
 // Nothing is duplicated by re-running the seeders over existing records.
 assert.equal(upgraded.patients.length,before.patients,'no duplicate patients');
 assert.equal(upgraded.engineRuns.length,before.runs,'no duplicate runs');
 assert.equal(upgraded.advisorTurns.length,before.turns,'no duplicate advisor turns');
 assert.equal(new Set(upgraded.messages.map(m=>m.id)).size,upgraded.messages.length,'message ids stay unique');
 assert.equal(new Set(upgraded.tasks.map(t=>t.id)).size,upgraded.tasks.length,'task ids stay unique');
 // And a workspace already at the current version is untouched.
 assert.deepEqual(ensureShowcaseData(structuredClone(upgraded)),upgraded);
});

test('the care overview is populated for every patient but the missing-record example',()=>{
 const w=normalizeWorkspace(showcase());
 // TN-1047 is the one incomplete record. Everyone else must carry the three
 // things the landing screen renders per patient.
 for(const p of w.patients){
   const expectEmpty=p.id==='TN-1047';
   const hasAdvisor=w.advisorTurns.some(t=>t.patientId===p.id);
   const hasPlan=(p.carePlans??[]).length>0;
   if(expectEmpty){
     assert.ok(!hasAdvisor,'TN-1047 keeps an empty advisor card');
     assert.ok(!hasPlan,'TN-1047 keeps no care plan');
   }else{
     assert.ok(hasAdvisor,p.id+' has a Robo Advisor transcript');
     assert.ok(hasPlan,p.id+' has a clinician plan');
   }
   assert.ok(p.nextVisit||expectEmpty,p.id+' has a scheduled next visit');
 }
 // Exactly one patient demonstrates an unassessed treatment response.
 const unassessed=w.patients.filter(p=>(p.medications??[]).some(m=>m.status==='Active'&&m.benefit==='Not assessed'));
 assert.deepEqual(unassessed.map(p=>p.id),['TN-1049']);
});

test('showcase seeding works in the first hour after midnight UTC',()=>{
  // The referral story schedules a consultation for "today" and completes it an hour earlier.
  // Between 00:00 and 01:00 UTC that hour used to fall on the previous day and seeding threw.
  for(const at of ['2026-09-25T00:00:00.000Z','2026-09-25T00:10:00.000Z','2026-09-25T00:59:59.000Z','2026-09-25T13:00:00.000Z']){
    const w=ensureShowcaseData(normalizeWorkspace(seedWorkspace()),'Showcase test',at);
    assert.equal(w.showcaseVersion,showcaseVersion,at);
  }
});
