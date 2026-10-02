import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:"export * from './lib/theranetrix';export * from './lib/engine-demo';export * from './lib/engine-decision';export * from './lib/actions';export * from './lib/pst-library';export * from './lib/visit-document';export {normalizeWorkspace} from './lib/medications';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {seedWorkspace,normalizeWorkspace,engineRecordRevision,defaultEnginePreferences,applyAction,actionSchema,rankPst,defaultPstPriorities,engineDecisionDetails,engineDecisionNote,markPrototypeLabel,visitDocumentHtml,medicationDecisionsHtml}=mod.exports;
const emma='TN-DEMO-01',lucas='TN-DEMO-02',now='2026-09-09T12:00:00Z',marker='(prototype, clinician to verify)';
const patient=(w,id)=>w.patients.find(p=>p.id===id);
const save=(w,action,date=now)=>applyAction(w,actionSchema.parse(action),'Dr. Test Clinician',date);
const run=(w,id=emma)=>save(w,{type:'engine.run',patientId:id,expectedRevision:engineRecordRevision(patient(w,id),w),preferences:defaultEnginePreferences});
const base=(w,id=emma)=>({type:'engine.decide',patientId:id,runId:w.engineRuns.find(r=>r.patientId===id).id,candidateId:'discuss-alternative',rationale:'Rejected: Duloxetine (example dose: 60 mg orally once daily). Mood history reviewed with the patient.',patientPlan:'We will talk about other options at the next visit.',owner:'Care coordinator',followup:'2026-09-16'});
const details={action:'reject',optionId:'duloxetine',optionName:'Duloxetine',modelledDose:'60 mg orally once daily',labelStatus:'Off-label',priorTrials:[{name:'Topical lidocaine',stopReason:'Little relief and skin irritation.'}],clinicianExclusions:[{name:'Tramadol',reason:'Seizure history discussed.'},{name:'Oxycodone ER',reason:''}]};
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/&#39;/g,'’').replace(/\s+/g,' ');

test('engine.decide accepts the optional structured fields and still accepts the older payload',()=>{
  const w=run(normalizeWorkspace(seedWorkspace())),action={...base(w),...details};
  assert.deepEqual(Object.keys(actionSchema.parse(action)).filter(key=>key in details).sort(),Object.keys(details).sort());
  assert.equal(actionSchema.safeParse(base(w)).success,true,'older decisions without the new fields still parse');
  assert.equal(actionSchema.safeParse({...action,action:'prescribe'}).success,false);
  assert.equal(actionSchema.safeParse({...action,optionName:''}).success,false);
  assert.equal(actionSchema.safeParse({...action,priorTrials:[{name:'Gabapentin',stopReason:'',dose:'300 mg'}]}).success,false,'history entries accept only name and stop reason');
  assert.equal(actionSchema.safeParse({...action,clinicianExclusions:[{name:'X',reason:'r'.repeat(501)}]}).success,false);
  assert.equal(actionSchema.safeParse({...action,priorTrials:Array.from({length:51},(_,i)=>({name:'Drug '+i,stopReason:''}))}).success,false);
});

test('a structured decision is stored as fields and heads the chart note with the clinician’s action and option',()=>{
  let w=run(normalizeWorkspace(seedWorkspace()));const meds=structuredClone(patient(w,emma).medications);
  w=save(w,{...base(w),...details,labelStatus:'Off-label '+marker});
  const d=w.engineDecisions[0],note=patient(w,emma).notes[0];
  assert.equal(d.action,'reject');assert.equal(d.optionId,'duloxetine');assert.equal(d.optionName,'Duloxetine');assert.equal(d.modelledDose,'60 mg orally once daily');
  assert.equal(d.labelStatus,'Off-label '+marker,'the prototype marker is stored once, even when the client already sent it');
  assert.deepEqual(d.priorTrials,details.priorTrials);assert.deepEqual(d.clinicianExclusions,details.clinicianExclusions);
  assert.equal(d.title,'Discuss an alternative with the prescriber','the linked approach is kept for older views');
  assert.equal(note.type,'Engine review');
  const lines=note.text.split('\n');
  assert.equal(lines[0],'Clinician decision: Rejected Duloxetine');
  assert.ok(lines.includes('Label status: Off-label (prototype label status, verify)'));
  assert.ok(lines.includes('Example dose the comparison scores assume (not a dosing suggestion): 60 mg orally once daily'));
  assert.ok(lines.includes('Clinician rationale: '+base(w).rationale));
  assert.match(lines.at(-1),/No prescription issued\.$/);
  assert.doesNotMatch(note.text,/Engine review:|recommend|optimal|first-line|confidence/i);
  assert.deepEqual(patient(w,emma).medications,meds,'recording a decision never changes medications');
  const fresh=run(normalizeWorkspace(seedWorkspace())),unmarked=save(fresh,{...base(fresh),...details});
  assert.equal(unmarked.engineDecisions[0].labelStatus,'Off-label '+marker,'the server adds the marker when it is missing');
});

test('an older-style request keeps the previous note and stores no structured fields',()=>{
  let w=run(normalizeWorkspace(seedWorkspace()));w=save(w,base(w));
  const d=w.engineDecisions[0],note=patient(w,emma).notes[0];
  for(const key of Object.keys(details))assert.equal(key in d,false,key);
  assert.equal(note.text.split('\n')[0],'Engine review: Discuss an alternative with the prescriber');
  assert.match(note.text,/No prescription issued\.$/);
});

test('the clinician’s reason is optional: an empty one saves, and the note and visit PDF say no reason was entered',()=>{
  let w=run(normalizeWorkspace(seedWorkspace()));
  assert.equal(actionSchema.safeParse({...base(w),rationale:''}).success,true);
  assert.equal(actionSchema.parse({...base(w),rationale:'   '}).rationale,'');
  assert.equal(actionSchema.safeParse({...base(w),rationale:'r'.repeat(2001)}).success,false);
  w=save(w,{...base(w),...details,rationale:''});
  const decision=w.engineDecisions.find(d=>d.patientId===emma);
  assert.equal(decision.rationale,'');
  assert.ok(patient(w,emma).notes[0].text.split('\n').includes('Clinician rationale: No reason entered'));
  assert.ok(text(medicationDecisionsHtml([decision])).includes('Clinician rationale No reason entered'));
  assert.equal(engineDecisionNote({title:'T',rationale:'  ',patientPlan:'Plan'},{id:'run-1',version:'v',revision:'r'}).split('\n')[1],'Clinician rationale: No reason entered');
});

test('the note helper and label marker stay neutral and idempotent',()=>{
  assert.equal(markPrototypeLabel('On-label'),'On-label '+marker);assert.equal(markPrototypeLabel('On-label '+marker),'On-label '+marker);assert.equal(markPrototypeLabel(marker),'');
  const runRef={id:'run-1',version:'v',revision:'r'};
  assert.equal(engineDecisionNote({title:'Review the current medication trial',rationale:'Why',patientPlan:'Plan'},runRef),'Engine review: Review the current medication trial\nClinician rationale: Why\nPatient plan: Plan\nRun: run-1 · v · record r. No prescription issued.');
  const accepted=engineDecisionNote({action:'accept',optionName:'Capsaicin 8% patch',title:'Discuss an alternative with the prescriber',rationale:'Why',patientPlan:'Plan'},runRef);
  assert.equal(accepted.split('\n')[0],'Clinician decision: Accepted Capsaicin 8% patch');assert.ok(!accepted.includes('Label status'),'no label line when none was recorded');
  assert.equal(engineDecisionNote({action:'modify',title:'Review progress on the agreed plan',rationale:'Why',patientPlan:'Plan'},runRef).split('\n')[0],'Clinician decision: Modified Review progress on the agreed plan');
});

test('decision details come from the chosen row, the stopped medications and the clinician’s exclusions',()=>{
  const w=normalizeWorkspace(seedWorkspace()),p=patient(w,emma),rows=rankPst(p,defaultPstPriorities(p)).all;
  const drug=rows.find(row=>row.id==='duloxetine'),combo=rows.find(row=>row.id==='gbp-lido');
  const stopped=p.medications.filter(m=>m.status==='Stopped');
  const single=engineDecisionDetails({action:'modify',optionId:drug.id,optionName:drug.name,option:drug,stopped,exclusions:[{name:'Tramadol',reason:'  Seizure history.  '},{name:'Oxycodone ER'}]});
  assert.equal(single.modelledDose,drug.dose);assert.equal(single.labelStatus,drug.label+' '+marker);
  assert.deepEqual(single.priorTrials,stopped.map(m=>({name:m.name,stopReason:m.stopReason?.trim()??''})));assert.ok(single.priorTrials.length>0);
  assert.deepEqual(single.clinicianExclusions,[{name:'Tramadol',reason:'Seizure history.'},{name:'Oxycodone ER',reason:''}]);
  assert.ok(!('evidence' in single)&&!('cui' in single),'no evidence grade or score is carried');
  const pair=engineDecisionDetails({action:'accept',optionId:combo.id,optionName:combo.name,option:combo,stopped:[],exclusions:[]});
  assert.equal(pair.labelStatus,`Combination (not a labeled regimen; ${combo.labelComponents.map(c=>c.name+': '+c.label).join(', ')}) ${marker}`);
  const extra=engineDecisionDetails({action:'accept',optionId:'pacing',optionName:'Work pacing and desk breaks',stopped:[],exclusions:[]});
  assert.equal('modelledDose' in extra||'labelStatus' in extra,false,'a non-drug second-opinion option carries no dose or label status');
  assert.ok(actionSchema.safeParse({type:'engine.decide',patientId:emma,runId:'r',candidateId:'c',rationale:'x',patientPlan:'y',owner:'z',followup:'2026-09-16',...single}).success);
});

test('the visit PDF lists medication decisions newest first, escaped, without scores, and prints older decisions',()=>{
  let w=run(normalizeWorkspace(seedWorkspace()));
  w=save(w,{...base(w),...details,optionName:'Duloxetine <b>DR</b>',rationale:'Rejected <img src=x onerror=alert(1)> after "review" & discussion.\nSecond line kept.',clinicianExclusions:[{name:'Tramadol',reason:'<script>alert(1)</script>'}]});
  w.engineDecisions.push({id:'legacy',runId:'old-run',patientId:emma,candidateId:'review-current',title:'Review the current medication trial',rationale:'Earlier rationale kept verbatim.',patientPlan:'Earlier plan',owner:'Care coordinator',followup:'2026-08-01',date:'2026-08-01T10:00:00Z',actor:'Dr. Earlier',planId:'plan-legacy'});
  w.engineDecisions.push({id:'other',runId:'x',patientId:lucas,candidateId:'review-current',title:'Other patient decision marker',rationale:'Other patient rationale marker',patientPlan:'p',owner:'o',followup:'2026-08-01',date:'2026-09-01T10:00:00Z',actor:'Dr. Other',planId:'x'});
  const html=visitDocumentHtml(patient(w,emma),w,now),plain=text(html);
  const meds=html.indexOf('Current medications and reported response'),decisions=html.indexOf('<h2>Medication decisions</h2>'),reviews=html.indexOf('Unresolved review items');
  assert.ok(meds>=0&&decisions>meds&&reviews>decisions,'the section sits after current medications');
  const section=html.slice(decisions,reviews);
  assert.ok(section.indexOf('Clinician decision: Rejected Duloxetine &lt;b&gt;DR&lt;/b&gt;')<section.indexOf('Clinician decision: Review the current medication trial'),'newest first');
  assert.ok(section.includes('2026-09-09 · Dr. Test Clinician'));
  assert.ok(section.includes('Rejected &lt;img src=x onerror=alert(1)&gt; after &quot;review&quot; &amp; discussion.\nSecond line kept.'),'rationale is verbatim and escaped');
  assert.ok(!html.includes('<img')&&!html.includes('<script>')&&!html.includes('<b>DR'));
  assert.ok(section.includes('Off-label (prototype, clinician to verify)'));
  assert.ok(section.includes('Topical lidocaine: stop reason: Little relief and skin irritation.'));
  assert.ok(section.includes('Tramadol: reason: &lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(text(section).includes('no prescription issued'));assert.ok(text(section).includes('this workspace does not send anything to payers'));
  assert.ok(section.includes('Earlier rationale kept verbatim.')&&section.includes('Dr. Earlier'),'older decisions still print');
  assert.ok(text(section).includes('Action Not recorded as a separate field; see the rationale'));
  assert.ok(text(section).includes('Label status Not recorded with this decision'));
  assert.ok(!plain.includes('Other patient'),'other patients’ decisions are excluded');
  assert.doesNotMatch(text(section),/\bCUI\b|\bPST\b|Shadow|\brank|agreement|evidence|grade|score|recommended|optimal|first-line|confidence/i);
  assert.ok(html.includes('not a signed encounter record'));
});

test('the decisions section handles no decisions and partial older records',()=>{
  assert.ok(text(medicationDecisionsHtml([])).includes('No medication decisions recorded in this workspace.'));
  const partial=medicationDecisionsHtml([{id:'d',patientId:emma,planId:'p',rationale:'Private <reasoning>'}]);
  assert.ok(partial.includes('Private &lt;reasoning&gt;'));assert.ok(text(partial).includes('Option not recorded'));assert.ok(text(partial).includes('Date not recorded'));
  const empty=medicationDecisionsHtml([{id:'d',patientId:emma,title:'T',rationale:'R',date:now,actor:'A',action:'accept',optionName:'Capsaicin 8% patch',priorTrials:[],clinicianExclusions:[]}]);
  assert.ok(text(empty).includes('Previously tried None recorded'));assert.ok(text(empty).includes('Clinician exclusions None'));assert.ok(text(empty).includes('Clinician decision: Accepted Capsaicin 8% patch'));assert.ok(text(empty).includes('Label status None for this option'),'a new decision on an option without label data says so, rather than “not recorded”');
});
test('one verb set runs from the buttons to the rationale prefix, note heading and history',()=>{
 const {engineDecisionHeading,engineDecisionVerbs}=mod.exports;
 assert.equal(engineDecisionHeading({action:'reject',optionName:'Gabapentin',title:'Review the current medication trial'}),'Rejected Gabapentin');
 assert.equal(engineDecisionHeading({action:'accept',title:'Discuss an alternative with the prescriber'}),'Accepted Discuss an alternative with the prescriber');
 assert.equal(engineDecisionHeading({title:'Review the current medication trial'}),'Review the current medication trial','older decisions keep their approach title');
 const screen=readFileSync('components/theranetrix/treatment-screen.tsx','utf8');
 assert.match(screen,/const verb=engineDecisionVerbs\[action\];/,'the pre-filled rationale starts with the same verb the note and PDF use');
 assert.doesNotMatch(screen,/'Agreed'/);
 assert.deepEqual(Object.values(engineDecisionVerbs),['Accepted','Modified','Rejected']);
});
