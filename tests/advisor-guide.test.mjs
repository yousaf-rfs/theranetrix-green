import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:"export * from './lib/advisor-guide';export {advisorReply,inferAdvisorIntent} from './lib/engine-demo';export {seedWorkspace} from './lib/theranetrix';export {ensureShowcaseData} from './lib/demo-showcase';export {rankPst,defaultPstPriorities} from './lib/pst-library';export {twinOverview} from './lib/engine-demo';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {advisorSuggestions,advisorPage,advisorRouteForQuestion,advisorAnswerForQuestion,advisorAnswerText,advisorAnswerSegments,advisorRubric,ADVISOR_RUBRIC_VERSION,advisorReply,inferAdvisorIntent,seedWorkspace,ensureShowcaseData,rankPst,defaultPstPriorities,twinOverview}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const workspace=()=>ensureShowcaseData(seedWorkspace(),'Demo care team','2026-09-20T09:00:00Z');
const emma=w=>w.patients.find(p=>p.id==='TN-DEMO-01');
const pages=['visit','treatment','twin','messages','notes'];
const withoutSignedVisits=w=>{w.clinicalWorkflows.slices.encounters.state.signoffs=[];return w;};
const addReport=(p,date,pain,fn,sleep)=>{p.dates.push(date);p.pain.push(pain);p.function.push(fn);p.sleep.push(sleep);};
const clinician=(p,w,text)=>advisorReply(p,w,'question',text,'routine','en','clinician');
const sources=['components/theranetrix/encounter-review.tsx','components/theranetrix/treatment-screen.tsx','components/theranetrix/engine-workspace.tsx','components/theranetrix/patient.tsx'].map(f=>readFileSync(f,'utf8')).join('\n');

test('each record page offers its own questions, and every Show me target exists on that page',()=>{
  const w=workspace(),p=emma(w);
  for(const page of pages){
    const suggestions=advisorSuggestions(p,w,page);
    assert.ok(suggestions.length>=2,page+' needs suggested questions');
    assert.equal(new Set(suggestions.map(s=>s.question)).size,suggestions.length,page+' repeats a question');
    for(const s of suggestions){
      assert.ok(s.answer.length>0,s.id+' has no answer');
      assert.ok(sources.includes(`id="${s.target.anchor}"`),`Missing anchor ${s.target.anchor} for ${page}/${s.id}`);
      if(s.more)assert.ok(sources.includes(`<TabsContent value="${s.more.tab}"`),`${s.id} links to a record view that does not exist`);
    }
  }
  assert.equal(advisorSuggestions(p,w,'treatment')[0].target.tab,'treatment');
  assert.equal(advisorPage('pst'),'visit');assert.equal(advisorPage('treatment'),'treatment');
});

test('answers restate the saved record rather than inventing values',()=>{
  const w=workspace(),p=emma(w);
  const changes=advisorSuggestions(p,w,'visit').find(s=>s.id==='changes');
  assert.match(changes.points.join(' '),new RegExp(`Pain .*${p.pain.at(-1)}/10`));
  const med=advisorSuggestions(p,w,'visit').find(s=>s.id==='medication');
  assert.match(med.answer,/Gabapentin/);
  p.medications=[];p.medicationReconciliation={none:false};
  assert.match(advisorSuggestions(p,w,'visit').find(s=>s.id==='medication').answer,/not been confirmed/);
});

test('with no reports the trajectory question says so and still points at the trajectory',()=>{
  const w=withoutSignedVisits(workspace()),p=emma(w);
  p.dates=[];p.pain=[];p.function=[];p.sleep=[];p.workflowObservations=[];
  const changes=advisorSuggestions(p,w,'visit')[0];
  assert.match(changes.answer,/not submitted a check-in/);
  assert.equal(changes.target.anchor,'visit-observations');
});

test('without a signed visit, what changed compares reports and adds medication, plan, review and message changes',()=>{
  const w=withoutSignedVisits(workspace()),p=emma(w);
  w.reviews.push({id:'review-after',patientId:p.id,title:'New concern after the report',detail:'',priority:'Medium',source:'Test',status:'Open',created:'2026-09-21T10:00:00Z'});
  w.messages.push({id:'message-after',patientId:p.id,text:'Mornings were harder this week.',date:'2026-09-21T11:00:00Z',sender:p.name,direction:'in'});
  const changes=advisorSuggestions(p,w,'visit')[0];
  assert.equal(changes.question,'What changed since the prior report?');
  assert.match(changes.answer,/compared with .*No signed visit is on record, so this compares reports\./);
  assert.ok(changes.points.includes('Pain 5/10, unchanged'),'unchanged scores stay visible');
  assert.ok(!changes.points.some(point=>/caused them/.test(point)),'the caveat accompanies a better or worse score, not unchanged ones');
  assert.ok(changes.points.includes('Care plan updated: Review the saved plan and follow-up.'));
  assert.ok(changes.points.some(point=>/new open reviews?: .*New concern after the report/.test(point)));
  assert.ok(changes.points.includes('1 new message from Emma, latest Sep 21'));
  assert.doesNotMatch(changes.question+changes.answer,/visit on/);
});

test('with a signed visit, what changed is anchored on that visit and compares with the scores reviewed there',()=>{
  const w=workspace(),p=emma(w);
  let changes=advisorSuggestions(p,w,'visit')[0];
  assert.equal(changes.question,'What changed since the last visit on Sep 20?');
  assert.match(changes.answer,/^Signed visit Sep 20\. No new report since that visit\. No medication, context or plan changes, new open reviews or messages are recorded since then\.$/);
  assert.deepEqual(changes.points,['Pain 5/10 at the visit','Function 5/10 at the visit','Sleep 5/10 at the visit']);
  addReport(p,'2026-09-22T08:00:00Z',3,6,5);
  w.reviews.push({id:'review-before',patientId:p.id,title:'Raised before the visit',detail:'',priority:'Routine',source:'Test',status:'Open',created:'2026-09-19T10:00:00Z'},{id:'review-after',patientId:p.id,title:'Raised after the visit',detail:'',priority:'Medium',source:'Test',status:'Open',created:'2026-09-21T10:00:00Z'});
  changes=advisorSuggestions(p,w,'visit')[0];
  assert.match(changes.answer,/^Signed visit Sep 20\. 1 report since then, latest Sep 22, compared with the scores reviewed at that visit\.$/);
  assert.deepEqual(changes.points.slice(0,4),['Pain 5 → 3/10 (better)','Function 5 → 6/10 (better)','Sleep 5/10, unchanged','Score changes are patient reports. They do not show that a medication caused them.']);
  assert.ok(changes.points.some(point=>/Raised after the visit/.test(point)));
  assert.ok(!changes.points.some(point=>/Raised before the visit/.test(point)),'items from before the visit are not changes since it');
});

test('what changed respects the assessments setting and links to the sources view that has content',()=>{
  const w=workspace(),p=emma(w);
  assert.deepEqual(advisorSuggestions(p,w,'visit')[0].more,{tab:'trace',label:'Review sources & decision trace'});
  w.features.assessments=false;
  const off=advisorSuggestions(p,w,'visit')[0];
  assert.match(off.answer,/Outcome reports are turned off/);
  assert.ok(!off.points.some(point=>/^(Pain|Function|Sleep) /.test(point)),'no outcome scores while assessments are off');
  const plain=withoutSignedVisits(workspace());plain.engineRuns=[];plain.clinicalWorkflows.slices.decisions.state.signedSnapshots=[];
  assert.deepEqual(advisorSuggestions(emma(plain),plain,'visit')[0].more,{tab:'evidence',label:'Review sources & evidence readiness'});
});

test('a typed question gets the same answer, points and Show me as the suggestion it matches',()=>{
  const w=workspace(),p=emma(w);
  for(const page of pages)for(const s of advisorSuggestions(p,w,page)){
    assert.equal(advisorRouteForQuestion(s.question),s.id,s.question);
    const typed=advisorAnswerForQuestion(p,w,s.question);
    assert.equal(typed.kind,'answer');assert.equal(typed.answer,s.answer,s.question);assert.deepEqual(typed.points,s.points);assert.deepEqual(typed.target,s.target);assert.deepEqual(typed.more,s.more);
    assert.equal(clinician(p,w,s.question).reply,advisorAnswerText(typed),'the saved reply is the rubric answer');
  }
  const phrasings={'What medications is she on?':'medication','What medication is she taking?':'medication','What is the plan?':'plan','What changed since the last visit?':'changes','Anything new?':'changes','How is her sleep trending?':'trend','Why is her pain worse?':'trend','Why is capsaicin ranked first?':'top','Do PST and Shadow disagree?':'shadow','When did she start gabapentin?':'timeline','What did she try before?':'timeline','Is anything waiting for a reply?':'reply','What is her goal?':'goal','What dose is she on?':'dose','What allergies does she have?':'attention','What does CUI mean?':'define'};
  for(const [question,route] of Object.entries(phrasings))assert.equal(advisorRouteForQuestion(question),route,question);
  // One rule set: the typed ranking answer is the Treatment screen's PST ranking.
  const top=rankPst(p,defaultPstPriorities(p)).ranked[0];
  assert.ok(clinician(p,w,'What ranks first?').reply.startsWith(top.name+' scores '+top.cui+' CUI'));
  assert.equal(advisorAnswerForQuestion(p,w,'What is the goal?').target.anchor,'patient-goal');
  assert.match(advisorAnswerForQuestion(p,w,'What is PST?').answer,/^PST: Prescribing support tool\./);
});

test('recommendation and dose-change questions are declined and point to the PST comparison and Your decision',()=>{
  const w=workspace(),p=emma(w),top=rankPst(p,defaultPstPriorities(p)).ranked[0];
  for(const question of ['Should I start duloxetine?','Should we switch her to pregabalin?','Should I start?','What should I prescribe?','What would you suggest?','Which option is best?','Is there a safer option?','Do you recommend the capsaicin patch?','What is the first-line treatment?','Can I start her on duloxetine?','Start pregabalin','Should we continue gabapentin?']){
    const answer=advisorAnswerForQuestion(p,w,question),text=answer.answer+' '+answer.points.join(' ');
    assert.equal(answer.kind,'refusal',question);assert.equal(answer.route,'refuse-treatment',question);
    assert.match(answer.answer,/I do not recommend, choose or change a treatment or dose\./);
    assert.deepEqual([answer.target.anchor,answer.more.anchor],['treatment-ranking','treatment-decision']);
    assert.ok(!text.includes(top.name),'the refusal names no option');
    assert.doesNotMatch(text,/on-label|off-label|best|optimal/i);
  }
  for(const question of ['Increase gabapentin to 900 mg?','Should I double the dose?','Can we lower the gabapentin dose?','Taper the gabapentin']){
    const answer=advisorAnswerForQuestion(p,w,question);
    assert.equal(answer.route,'refuse-dose',question);
    assert.match(answer.answer,/Written schedule: Gabapentin: 300 mg orally three times daily\. No dose change is made here\./);
  }
  for(const question of ['What did she try before?','When did she start gabapentin?','Can I add a note?','Can I record a decision now?','What dose is she on?','Why did she stop gabapentin?'])assert.notEqual(advisorAnswerForQuestion(p,w,question).kind,'refusal',question);
  assert.match(clinician(p,w,'Should I start duloxetine?').reply,/^I restate Emma’s saved record\. I do not recommend/);
  w.features.pst=false;
  const off=advisorAnswerForQuestion(p,w,'Should I start duloxetine?');
  assert.equal(off.target.anchor,'treatment-decision');assert.equal(off.more,undefined);
});

test('an unmatched question gets the scope message, and the rubric is versioned and states its limits',()=>{
  const w=workspace(),p=emma(w),answer=advisorAnswerForQuestion(p,w,'Tell me a joke');
  assert.equal(answer.kind,'scope');assert.equal(answer.target,undefined);
  assert.match(answer.answer,/^That question is outside what I answer\. I restate Emma’s saved record on set topics/);
  assert.equal(advisorRubric.version,ADVISOR_RUBRIC_VERSION);
  assert.equal(advisorRubric.basis,`Prototype rules, not clinically validated. Rule set ${ADVISOR_RUBRIC_VERSION}.`);
  assert.ok(advisorRubric.declines.some(line=>/Recommending, choosing or changing a treatment, option or dose/.test(line)));
  assert.ok(advisorRubric.declines.some(line=>/matched to these topics by keywords/.test(line)),'keyword matching is not presented as understanding');
});

test('advisor answers restate the record without prescribing words or confidence labels',()=>{
  const w=workspace();
  for(const p of w.patients)for(const page of pages)for(const s of advisorSuggestions(p,w,page))
    assert.doesNotMatch([s.question,s.answer,...s.points,s.target.label,s.more?.label??''].join(' '),/\b(recommend\w*|optimal|best|first-line|confidence|suggests)\b/i,p.id+' '+page+'/'+s.id);
});

test('patient questions restate their own record in their language and never show engine rankings',()=>{
  const w=workspace(),p=emma(w);
  const ranking=advisorReply(p,w,'question','Why does PST rank this first?').reply;
  assert.match(ranking,/^Your care team reviews treatment options with you\./);assert.doesNotMatch(ranking,/first choice|Shadow|PST/);
  assert.match(advisorReply(p,w,'question','Should I keep taking the same dose?').reply,/^I can only restate the written schedule\./);
  assert.match(advisorReply(p,w,'question','What medications am I on?').reply,/^Gabapentin: /);
  p.preferredLanguage='es';
  const meds=advisorReply(p,w,'question','¿Qué medicamentos tengo?').reply;
  assert.match(meds,/^Gabapentin: /);assert.doesNotMatch(meds.split('\n')[0],/Helpful|Effects reported|Taken as recorded|Not assessed|No benefit/);
  assert.match(advisorReply(p,w,'question','¿Cómo va mi trayectoria?').reply,/^Registro de Emma/);
  assert.match(advisorReply(p,w,'question','¿Cómo va mi sueño?').reply,/^Registro de Emma/);
  assert.match(advisorReply(p,w,'question','¿Qué clasificación tiene PST?').reply,/^Tu equipo de atención revisa contigo/);
});

test('intent keywords match word forms, not only the bare stem',()=>{
  for(const text of ['My pain is worsening','I have side effects','I am concerned about sleep','Me preocupa el dolor'])assert.equal(inferAdvisorIntent(text).intent,'concern',text);
  for(const text of ['What is the plan?','When are my appointments?','¿Cuándo es mi cita?'])assert.equal(inferAdvisorIntent(text).intent,'plan',text);
  assert.equal(inferAdvisorIntent('What medications am I on?').intent,'question');
});

// Twin cautions and advisor answers state which rule matched; they never tell the clinician what to choose or leave out.
const directive=/\b(avoid\w*|prefer\w*)\b/i;
test('Twin cautions are rule matches with no avoid or prefer wording, for every seeded patient and when both rules match',()=>{
  const w=workspace();
  for(const p of w.patients)for(const c of twinOverview(p).cautions)assert.doesNotMatch(c.body,directive,p.id+' '+c.title);
  const p=structuredClone(emma(w));
  p.clinicalContext={...p.clinicalContext,medicalHistory:'Recurrent depression. Insomnia most nights. Constipation on current regimen.'};
  const cautions=twinOverview(p).cautions;
  assert.deepEqual(cautions.map(c=>c.title).slice(0,2),['Profile caution','Treatment-burden caution'],'the grogginess caution still shows when the profile rule matches');
  for(const c of cautions)assert.doesNotMatch(c.body,directive,c.title);
  assert.match(cautions[1].body,/^Rule match: grogginess recorded with Gabapentin \(current\)\. Review alertness and sedation burden before deciding\.$/);
  assert.doesNotMatch(cautions.map(c=>c.body).join(' '),/tricyclic|gabapentinoid|work interference/i,'no drug class is named as a choice, and no detail the record lacks');
  const lucas=w.patients.find(x=>x.id==='TN-DEMO-02');
  assert.match(twinOverview(lucas).cautions[0].body,/Gabapentin \(stopped\)/);
});

test('a clinician question about safety quotes the whole caution, with no directive and no cut qualifier',()=>{
  const w=workspace();
  for(const id of ['TN-DEMO-01','TN-DEMO-02','TN-1042']){
    const p=w.patients.find(x=>x.id===id),reply=clinician(p,w,'Is anything flagged for safety?').reply;
    assert.doesNotMatch(reply,directive,id);
    assert.ok(reply.includes('Treatment-burden caution: Rule match: grogginess recorded with Gabapentin'),id);
    assert.ok(reply.includes('Review alertness and sedation burden before deciding.'),id+' keeps the full sentence');
    assert.doesNotMatch(reply.split('\n').find(line=>/caution/.test(line)),/…/,id);
  }
});

test('the first-ranked answer names label status and the example-values caveat, and a tie is called a tie',()=>{
  const w=workspace();
  for(const p of w.patients){
    const top=advisorSuggestions(p,w,'treatment').find(s=>s.id==='top'),ranked=rankPst(p,defaultPstPriorities(p)).ranked;
    assert.match(top.points.join(' '),/Label status \(example, verify against current FDA labeling\): /,p.id);
    assert.ok(top.points.join(' ').includes(`${ranked[0].name} ${ranked[0].label}`),p.id);
    assert.match(top.points[0],/^Example scores, not model output: /,p.id);
    assert.ok(top.points.some(point=>/not a claim that it is effective or suitable/.test(point)),p.id);
  }
  const answer=advisorSuggestions(emma(w),w,'treatment').find(s=>s.id==='top').answer;
  assert.match(answer,/^Capsaicin 8% patch scores \d+ CUI .*\. \d options tie at \d+ CUI, so there is no numerical leader; alphabetical order lists Capsaicin 8% patch first\.$/);
  assert.doesNotMatch(answer,/Next is/);
});

test('Shadow AI answers never say the engines agree, and exclusions are not called this patient’s profile',()=>{
  const w=workspace();
  for(const p of w.patients)for(const s of advisorSuggestions(p,w,'treatment')){
    assert.doesNotMatch([s.question,s.answer,...s.points].join(' '),/\bagrees?\b|this patient’s profile|second opinion/i,p.id+'/'+s.id);
  }
  const olivia=w.patients.find(p=>p.id==='TN-1034'),shadow=advisorSuggestions(olivia,w,'treatment').find(s=>s.id==='shadow');
  assert.equal(shadow.answer,'No rule difference on the top-listed PST options. This is the default rule outcome, not independent confirmation.');
  assert.equal(clinician(olivia,w,'Does Shadow agree with PST?').reply.split('\n')[0],shadow.answer,'a typed question saves the same wording');
  const excluded=advisorSuggestions(emma(w),w,'treatment').find(s=>s.id==='excluded');
  assert.equal(excluded.answer,'No patient-specific exclusion is recorded for Emma. 1 option is excluded for every patient by a prototype library rule.');
  assert.match(excluded.points[0],/^Amitriptyline: Prototype rule: excluded for every patient/);
  const p=structuredClone(emma(w));p.clinicalContext={...p.clinicalContext,medicalHistory:'Recurrent depression.'};
  const own=advisorSuggestions(p,w,'treatment').find(s=>s.id==='excluded');
  assert.match(own.answer,/^\d+ options are excluded by prototype rules: \d+ from Emma’s record, 1 for every patient\.$/);
  assert.match(own.points[0],/^Duloxetine: Rule match: “depression”/,'record-based exclusions are listed first');
});

test('What was noted last time returns the latest clinician note, never an automatic check-in record',()=>{
  const w=workspace(),p=emma(w),before=advisorSuggestions(p,w,'notes')[0].answer;
  assert.doesNotMatch(before,/Patient-submitted report|observation report/);
  p.notes.unshift(
    {id:'wf-observation-note-0001',date:'2026-09-24T15:00:00Z',author:'Submitted by patient',type:'Patient-submitted report',text:'pain: 5/10 · Patient self-report · 2026-09-24T15:00:00.000Z'},
    {id:'wf-observation-note-0002',date:'2026-09-23T15:00:00Z',author:'Demo care team',type:'Corrected observation report',text:'sleep: 4/10 · Clinician correction'},
    {id:'wf-observation-note-0003',date:'2026-09-22T15:00:00Z',author:'Demo care team',type:'Confirmed observation report',text:'function: 6/10 · Encounter report'});
  assert.equal(advisorSuggestions(p,w,'notes')[0].answer,before,'automatic check-in records are skipped');
  p.notes.unshift({id:'progress-new',date:'2026-09-24T16:00:00Z',author:'Dr. Maya Chen',type:'Progress note',text:'Discussed morning grogginess.'});
  assert.match(advisorSuggestions(p,w,'notes')[0].answer,/^Progress note by Dr\. Maya Chen, Sep 24: Discussed morning grogginess\.$/);
  p.notes=p.notes.filter(note=>note.id.startsWith('wf-observation-note-'));
  assert.equal(advisorSuggestions(p,w,'notes')[0].answer,'No clinician note is recorded yet. Automatic check-in records are listed under Notes.');
});

test('answers mark the first PST and CUI mention as glossary terms on screen, while saved text stays plain',()=>{
  assert.deepEqual(advisorAnswerSegments('The PST ranks by CUI. PST compares; CUI is a number.'),['The ',{term:'PST'},' ranks by ',{term:'CUI'},'. PST compares; CUI is a number.']);
  assert.deepEqual(advisorAnswerSegments('No acronyms {here}, PSTX or xCUI.'),['No acronyms {here}, PSTX or xCUI.'],'literal braces and partial words stay text');
  const w=workspace(),p=emma(w);
  for(const page of ['visit','treatment','twin','messages','notes'])for(const s of advisorSuggestions(p,w,page)){
    const text=advisorAnswerText({answer:s.answer,points:s.points});
    assert.doesNotMatch(text,/[{}]/,'the saved reply carries no term markers');
    assert.equal(advisorAnswerSegments(text).map(part=>typeof part==='string'?part:part.term).join(''),text,'marking never changes the words');
  }
  const top=advisorSuggestions(p,w,'treatment').find(s=>/\bCUI\b/.test(s.answer));
  assert.ok(top&&advisorAnswerSegments(top.answer).some(part=>part.term==='CUI'),'a CUI answer defines CUI in place');
});
