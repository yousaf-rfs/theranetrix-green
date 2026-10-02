import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:"export * from './lib/theranetrix';export * from './lib/pst-library';export {ensureShowcaseData} from './lib/demo-showcase';export {medicationReportNote,emptyMedicationReport,emptyUnidentified} from './lib/patient-medication-report';export {latestReportedAnswers,reportedQuestion} from './lib/patient-reported-answers';export {twinOverview} from './lib/engine-demo';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {seedWorkspace,ensureShowcaseData,rankPst,defaultPstPriorities,pstProfileRuleExplanation,shadowOpinion,pstModelLimits,pstLabelNotice,pstHistoryNotice,pstHistorySummary,medicationReportNote,emptyMedicationReport,emptyUnidentified,latestReportedAnswers,reportedQuestion,twinOverview,pstExclusionScope}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const byId=id=>structuredClone(seedWorkspace().patients.find(p=>p.id===id));
const neutral=(condition='Postherpetic neuralgia')=>{const p=byId('TN-DEMO-01');p.condition=condition;p.medications=[];p.checkins=[];p.clinicalContext={...p.clinicalContext,allergyStatus:'None reported',allergies:'',medicalHistory:'',psychologicalContext:''};return p;};
const weights={analgesia:40,abuse:20,cognitive:20,sedation:20};
const row=(p,id,filters)=>rankPst(p,weights,false,filters).all.find(r=>r.id===id);
const med=(changes)=>({...byId('TN-DEMO-01').medications[0],history:[],...changes});

test('a stopped trial is flagged with the recorded reason and date, stays ranked, and flows into its combinations',()=>{
  const lucas=byId('TN-DEMO-02'),ranking=rankPst(lucas,defaultPstPriorities(lucas));
  const gabapentin=ranking.all.find(r=>r.id==='gabapentin');
  const tried=gabapentin.history.find(h=>h.kind==='tried');
  assert.equal(tried.source,'record');assert.equal(tried.name,'Gabapentin');assert.equal(tried.date,'2026-07-20');
  assert.match(tried.text,/persistent daytime grogginess and limited reported benefit/);
  assert.match(tried.text,/Daytime grogginess during the prior trial/);
  const combination=ranking.all.find(r=>r.id==='gbp-nort');
  assert.ok(combination.history.some(h=>h.kind==='tried'&&h.componentId==='gabapentin'),'Combinations inherit component history');
  const emma=byId('TN-DEMO-01'),emmaRanking=rankPst(emma,defaultPstPriorities(emma));
  const lidocaine=emmaRanking.ranked.find(r=>r.id==='lidocaine');
  assert.ok(lidocaine,'The stopped topical lidocaine trial stays ranked; the clinician decides');
  assert.deepEqual(lidocaine.history.map(h=>[h.kind,h.source,h.name,h.date]),[['tried','record','Topical lidocaine','2026-07-21']]);
  assert.match(lidocaine.history[0].text,/little relief and local skin irritation/);
  assert.ok(emmaRanking.ranked.find(r=>r.id==='pgb-lido').history.some(h=>h.componentId==='lidocaine'));
  assert.match(pstHistorySummary(lidocaine.history[0]),/Topical lidocaine: tried before, stopped 2026-07-21/);
  const shadow=shadowOpinion(emma,seedWorkspace(),emmaRanking.ranked).onPst.find(s=>s.optionId==='lidocaine');
  assert.equal(shadow.kind,'differ','Shadow names the recorded prior trial');assert.match(shadow.reason,/Topical lidocaine/);
});

test('reported effects on a current medication flag the row without excluding it',()=>{
  const p=neutral();p.medications=[med({name:'Pregabalin',status:'Active',tolerability:'Effects reported',effects:'Dizziness after the evening dose.'})];
  const ranking=rankPst(p,weights),pregabalin=ranking.ranked.find(r=>r.id==='pregabalin');
  assert.ok(pregabalin&&pregabalin.current);
  assert.deepEqual(pregabalin.history.map(h=>[h.kind,h.source,h.text]),[['effects-reported','record','Dizziness after the evening dose.']]);
  assert.ok(ranking.ranked.find(r=>r.id==='pgb-dlx').history.some(h=>h.componentId==='pregabalin'));
});

test('a recorded reaction naming the drug locks the row and its combinations with the recorded allergy text',()=>{
  const p=neutral();p.clinicalContext={...p.clinicalContext,allergyStatus:'Reactions reported',allergies:'Penicillin: rash; Pregabalin: facial swelling within a day of starting.'};
  const ranking=rankPst(p,weights);
  const pregabalin=ranking.excluded.find(r=>r.id==='pregabalin');
  assert.match(pregabalin.excluded,/Pregabalin: facial swelling within a day of starting/);
  assert.doesNotMatch(pregabalin.excluded,/Penicillin/,'Only the segment naming the drug is carried');
  for(const id of ['pgb-dlx','pgb-cap','pgb-lido'])assert.ok(ranking.excluded.some(r=>r.id===id)&&!ranking.ranked.some(r=>r.id===id),id);
  assert.match(pstProfileRuleExplanation(p,pregabalin).join(' '),/drug names only/);
  const unreviewed=neutral();unreviewed.clinicalContext={...p.clinicalContext,allergyStatus:'Not reviewed'};
  assert.ok(rankPst(unreviewed,weights).ranked.some(r=>r.id==='pregabalin'),'Allergy text only counts when reactions are recorded');
});

test('reaction matching is by name only and says so for other rows',()=>{
  const p=neutral();p.clinicalContext={...p.clinicalContext,allergyStatus:'Reactions reported',allergies:'Codeine: nausea and a rash.'};
  const tramadol=rankPst(p,weights).ranked.find(r=>r.id==='tramadol');
  assert.ok(tramadol);assert.equal(tramadol.history.length,0);
  assert.match(pstProfileRuleExplanation(p,tramadol).join(' '),/Drug classes are not matched/);
  assert.match(pstHistoryNotice,/Drug classes are not matched/);
});

test('patient-reported tried and cannot-take answers flag rows as unverified and never exclude them',()=>{
  const p=neutral(),report={...emptyMedicationReport(),triedAnswer:'yes',cannotTakeAnswer:'yes',tried:[{name:'Duloxetine (Cymbalta)',outcome:'Did not help',effects:['Upset stomach'],stopped:'Stomach upset'}],cannotTake:[{name:'Tramadol (Ultram)',reason:'Bad side effect',details:'Very dizzy'}]};
  p.checkins=[{id:'old',date:'2026-09-01T08:00:00Z',pain:5,sleep:5,function:5,note:medicationReportNote({...emptyMedicationReport(),cannotTakeAnswer:'yes',cannotTake:[{name:'Capsaicin patch (Qutenza)',reason:'Other',details:''}]})},
    {id:'new',date:'2026-09-08T08:00:00Z',pain:5,sleep:5,function:5,note:'Feeling about the same.\n'+medicationReportNote(report)},
    {id:'withdrawn',date:'2026-09-09T08:00:00Z',pain:5,sleep:5,function:5,note:medicationReportNote({...report,tried:[{...report.tried[0],name:'Venlafaxine'}]}),withdrawnAt:'2026-09-09T09:00:00Z'}];
  const ranking=rankPst(p,weights);
  const duloxetine=ranking.ranked.find(r=>r.id==='duloxetine'),tramadol=ranking.ranked.find(r=>r.id==='tramadol');
  assert.ok(duloxetine&&tramadol,'Patient-reported answers are flags only');
  assert.deepEqual(duloxetine.history.map(h=>[h.kind,h.source,h.date]),[['tried','patient-reported','2026-09-08']]);
  assert.match(duloxetine.history[0].text,/Helped: Did not help/);
  assert.deepEqual(tramadol.history.map(h=>[h.kind,h.source]),[['cannot-take','patient-reported']]);
  assert.match(pstHistorySummary(tramadol.history[0]),/not verified/);
  assert.ok(ranking.ranked.find(r=>r.id==='dlx-cap').history.some(h=>h.componentId==='duloxetine'&&h.source==='patient-reported'));
  assert.equal(ranking.all.find(r=>r.id==='capsaicin').history.length,0,'Only the newest check-in with medicine answers is read');
  assert.equal(ranking.all.find(r=>r.id==='venlafaxine').history.length,0,'Withdrawn check-ins are ignored');
  assert.ok(!shadowOpinion(p,seedWorkspace(),ranking.ranked).onPst.some(s=>s.kind==='differ'&&/Cymbalta|Ultram/.test(s.reason)),'Shadow reads only the record');
});

test('a medicine the patient takes now is its own flag, never a past trial, and a report date is never a stop date',()=>{
  const p=neutral();
  p.checkins=[{id:'now',date:'2026-09-20T08:00:00Z',pain:5,sleep:5,function:5,note:medicationReportNote({...emptyMedicationReport(),triedAnswer:'yes',tried:[{name:'Pregabalin',outcome:'Did not help',effects:[],stopped:''}],
    takingNow:[{name:'Nortriptyline',dose:'10 mg at night',category:'sleep-anxiety'},{name:'Duloxetine',dose:'',category:'herbal'},{name:'Venlafaxine',dose:'',category:'other'}]})}];
  const all=rankPst(p,weights).all,history=id=>all.find(r=>r.id===id).history.map(h=>[h.kind,h.source]);
  for(const id of ['nortriptyline','duloxetine','venlafaxine'])assert.deepEqual(history(id),[['reported-current','patient-reported']],id);
  assert.ok(all.find(r=>r.id==='gbp-nort').history.some(h=>h.kind==='reported-current'&&h.componentId==='nortriptyline'));
  const nort=all.find(r=>r.id==='nortriptyline').history[0];
  assert.match(nort.text,/Kind chosen by the patient: Sleep or anxiety medicine · Dose: 10 mg at night/);
  assert.equal(pstHistorySummary(nort),'Nortriptyline: the patient reports taking it now, not on the record, reported 2026-09-20 (patient-reported, not verified)');
  assert.doesNotMatch(all.map(r=>r.history.map(pstHistorySummary).join(' ')).join(' '),/stopped 2026-09-20/,'The check-in date is never shown as a stop date');
  assert.equal(pstHistorySummary(all.find(r=>r.id==='pregabalin').history[0]),'Pregabalin: tried before, reported 2026-09-20 (patient-reported, not verified)');
  assert.ok(!all.find(r=>r.id==='nortriptyline').current,'Current stays a record fact');
});

test('each medicine question is read from the newest check-in that answered it, with unnamed medicines filed where they were asked',()=>{
  const unnamed=medicationReportNote({...emptyMedicationReport(),cannotTakeAnswer:'yes',cannotTake:[{name:'',reason:'Allergic reaction',details:'',unknown:emptyUnidentified()}],takingNow:[{name:'Melatonin',dose:'',category:'supplement'}]});
  const answers=latestReportedAnswers([{date:'2026-09-20',note:unnamed},{date:'2026-09-21',note:'Tried before (patient-reported): None'},{date:'2026-09-22',note:'Also affecting pain (patient-reported): Work\nTaking now, not on record (patient-reported): Heat wrap · Dose: Not given'}]);
  assert.deepEqual(answers.map(a=>[a.question,a.kind,a.name,a.date]),[['cannot-take','unidentified','Name not known','2026-09-20'],['tried','tried','None','2026-09-21'],['taking-now','taking-now','Heat wrap','2026-09-22'],['affecting-pain','affecting-pain','Work','2026-09-22']]);
  assert.equal(reportedQuestion({kind:'sleep-anxiety',details:[]}),'taking-now');
  assert.equal(reportedQuestion({kind:'unidentified',details:[{label:'Asked under',value:'Tried before'}]}),'tried');
  assert.equal(reportedQuestion({kind:'unidentified',details:[]}),undefined,'An unnamed medicine is never filed by guesswork');
});

test('a later check-in that answers only "affecting your pain" keeps the earlier cannot-take answer',()=>{
  const p=neutral();
  p.checkins=[{id:'allergy',date:'2026-09-20T08:00:00Z',pain:5,sleep:5,function:5,note:medicationReportNote({...emptyMedicationReport(),cannotTakeAnswer:'yes',cannotTake:[{name:'Duloxetine',reason:'Allergic reaction',details:'Rash'}]})},
    {id:'pain',date:'2026-09-22T08:00:00Z',pain:5,sleep:5,function:5,note:'Also affecting pain (patient-reported): Stress'},
    {id:'foggy',date:'2026-09-23T08:00:00Z',pain:5,sleep:5,function:5,note:'Also affecting pain (patient-reported): Gabapentin makes me foggy'}];
  const all=rankPst(p,weights).all;
  assert.deepEqual(all.find(r=>r.id==='duloxetine').history.map(h=>[h.kind,h.date]),[['cannot-take','2026-09-20']]);
  assert.equal(all.find(r=>r.id==='gabapentin').history.length,0,'The patient’s words about their pain never match a row');
  // A newer answer to the same question does replace the earlier one.
  p.checkins.push({id:'none',date:'2026-09-24T08:00:00Z',pain:5,sleep:5,function:5,note:'Cannot take (patient-reported): None'});
  assert.equal(rankPst(p,weights).all.find(r=>r.id==='duloxetine').history.length,0);
});

test('the grogginess rule matches the seed wording, flags instead of locking, and the lidocaine stop rule is gone',()=>{
  const emma=byId('TN-DEMO-01'),lucas=byId('TN-DEMO-02');
  const emmaRank=rankPst(emma,defaultPstPriorities(emma));
  assert.ok(!emmaRank.excluded.some(r=>r.id==='gabapentin'),'Grogginess with the current gabapentin is a flag, so the clinician can still keep or adjust it');
  assert.ok(emmaRank.ranked.some(r=>r.id==='gabapentin'));
  assert.deepEqual(emmaRank.all.find(r=>r.id==='gabapentin').history.map(h=>h.kind),['effects-reported'],'Grogginess on gabapentin itself shows once, through its own history');
  const nort=emmaRank.all.find(r=>r.id==='nortriptyline').history.find(h=>h.kind==='rule-flag');
  assert.match(nort.text,/Rule match: grogginess recorded with Gabapentin \(current\)\. Flagged for review, not excluded\./);
  assert.match(rankPst(lucas,defaultPstPriorities(lucas)).all.find(r=>r.id==='nortriptyline').history.find(h=>h.kind==='rule-flag').text,/Gabapentin \(stopped\)/);
  assert.ok(!rankPst(emma,weights).excluded.some(r=>r.id==='lidocaine'));
  // The explanation says what the rule does on each row: grogginess on gabapentin itself is gabapentin's own history flag.
  for(const id of ['gabapentin','nortriptyline'])assert.match(pstProfileRuleExplanation(emma,emmaRank.all.find(r=>r.id===id)).join(' '),/flags gabapentin and nortriptyline when the grogginess was recorded with a different medication\. Grogginess recorded on a drug itself shows as that drug’s own history flag\. Neither is excluded\./,id);
  assert.equal(pstHistorySummary(nort),'Keyword rule flag');
  // The Twin caution beside the table agrees with the flag: it names the match and asks for review, never to leave a class out.
  assert.ok(emmaRank.ranked.some(r=>r.id==='nortriptyline'),'nortriptyline stays ranked with its rule flag');
  const caution=twinOverview(emma).cautions.find(c=>c.title==='Treatment-burden caution');
  assert.match(caution.body,/^Rule match: grogginess recorded with Gabapentin \(current\)\./);assert.doesNotMatch(caution.body,/avoid|tricyclic|prefer/i);
});

test('label status is judged against the recorded condition with corrected example indications',()=>{
  const status=(condition,id)=>row(neutral(condition),id).label;
  const cases={
    'Postherpetic neuralgia':{gabapentin:'On-label',pregabalin:'On-label',lidocaine:'On-label',capsaicin:'On-label',duloxetine:'Off-label',carbamazepine:'Off-label'},
    'Painful diabetic peripheral neuropathy':{gabapentin:'Off-label',pregabalin:'On-label',duloxetine:'On-label',capsaicin:'On-label',lidocaine:'Off-label'},
    'Fibromyalgia':{pregabalin:'On-label',duloxetine:'On-label',gabapentin:'Off-label',lidocaine:'Off-label'},
    'Chronic low back pain':{duloxetine:'On-label',pregabalin:'Off-label',gabapentin:'Off-label'},
    'Neuropathic pain after spinal cord injury':{pregabalin:'On-label',duloxetine:'Off-label',gabapentin:'Off-label'},
    'Peripheral neuropathy':{gabapentin:'Off-label',pregabalin:'Off-label',duloxetine:'Off-label'},
  };
  for(const [condition,expected] of Object.entries(cases))for(const [id,label] of Object.entries(expected))assert.equal(status(condition,id),label,condition+' · '+id);
  assert.match(row(neutral('Painful diabetic peripheral neuropathy'),'capsaicin').labelNote,/of the feet/);
  assert.match(row(neutral('Chronic low back pain'),'gabapentin').labelNote,/Not labeled for the recorded condition \(Chronic low back pain\).*postherpetic neuralgia/);
  assert.equal(row(neutral(''),'gabapentin').label,'Not assessed');
  for(const condition of [...Object.keys(cases),'']){
    const p=neutral(condition),all=rankPst(p,weights).all;
    for(const id of ['tramadol','tapentadol','oxycodone']){const r=all.find(x=>x.id===id);assert.equal(r.label,'Opioid labeling','opioid rows keep their neutral status');
      if(id==='tapentadol'&&/diabetic/i.test(condition))assert.match(r.labelNote,/^Opioid labeling that names the recorded condition: painful diabetic peripheral neuropathy \(DPN\) severe enough to need an extended period of daily opioid treatment/);
      else assert.match(r.labelNote,/not condition-specific/);}
    for(const r of all){assert.equal(r.labelBasis,'example, verify against current FDA labeling');assert.ok(Array.isArray(r.labeledIndications));}
    for(const r of all.filter(x=>x.kind==='combination')){
      assert.equal(r.label,'Combination');assert.match(r.labelNote,/not a labeled regimen/);
      assert.deepEqual(r.labelComponents.map(c=>[c.id,c.label]),r.componentIds.map(id=>[id,all.find(x=>x.id===id).label]));
    }
    assert.ok(rankPst(p,weights,true).all.every(r=>r.label==='On-label'),'On-label only keeps condition-labeled single drugs');
  }
  assert.match(pstLabelNotice,/Off-label use is a prescribing decision for the clinician/);
});

test('condition wording: spelling variants of postherpetic match, negated or loose diabetes wording is not assessed',()=>{
  const status=(condition,id)=>row(neutral(condition),id);
  for(const condition of ['Post herpetic neuralgia','Post-herpetic neuralgia','Postherpetic neuralgia','POST  HERPETIC neuralgia'])
    for(const id of ['gabapentin','pregabalin','lidocaine','capsaicin'])assert.equal(status(condition,id).label,'On-label',condition+' · '+id);
  for(const condition of ['Non-diabetic peripheral neuropathy','Neuropathy (not diabetic)','Peripheral neuropathy, no diabetes','Prediabetic neuropathy','Neuropathy without diabetes','Neuropathy in a diabetic patient']){
    for(const id of ['pregabalin','duloxetine','capsaicin']){
      const r=status(condition,id);
      assert.equal(r.label,'Not assessed',condition+' · '+id);
      assert.doesNotMatch(r.labelNote,/^Labeled for/,'no derived On-label note');
      assert.match(r.labelNote,/cannot classify for painful diabetic peripheral neuropathy \(DPN\).*clinician reviews it/);
    }
    assert.equal(status(condition,'gabapentin').label,'Off-label','a drug with no DPN labeling is judged as before');
    assert.match(status(condition,'tapentadol').labelNote,/not condition-specific.*wording this example map cannot classify/);
    assert.ok(!rankPst(neutral(condition),weights,true).all.some(r=>['pregabalin','duloxetine','capsaicin'].includes(r.id)),'On-label only leaves out unassessed rows');
  }
  assert.equal(status('Painful diabetic peripheral neuropathy','pregabalin').label,'On-label');
  assert.equal(status('Diabetic polyneuropathy','duloxetine').label,'On-label');
  // The Twin's pain-profile line reads the condition with the same rules.
  const iasp=condition=>twinOverview(neutral(condition)).iasp;
  assert.equal(iasp('Post herpetic neuralgia'),'IASP I-2 · Peripheral neuropathic pain (postherpetic neuralgia)');
  assert.equal(iasp('Non-diabetic peripheral neuropathy'),'IASP I-1 · Peripheral neuropathy');
  assert.equal(iasp('Painful diabetic peripheral neuropathy'),'IASP I-1 · Peripheral neuropathy (diabetic)');
});

test('opioid indication wording separates immediate-release and extended-release labeling',()=>{
  const all=rankPst(neutral('Chronic low back pain'),weights).all,note=id=>all.find(r=>r.id===id).labelNote;
  assert.match(note('tramadol'),/^Labeled for pain severe enough to need an opioid analgesic, when alternative treatments are inadequate; not condition-specific\./);
  for(const id of ['oxycodone','tapentadol'])assert.match(note(id),/^Labeled for severe and persistent pain that needs an extended period of daily opioid treatment, when alternative treatments are inadequate; not condition-specific\./,id);
  assert.doesNotMatch(all.map(r=>r.labelNote).join(' '),/pain severe enough to need an opioid;/,'the old immediate-release sentence is no longer used for every opioid');
});

test('exclusion scope separates this patient’s record from rules that apply to every patient',()=>{
  const emma=byId('TN-DEMO-01'),ranking=rankPst(emma,defaultPstPriorities(emma));
  assert.deepEqual(ranking.excluded.map(r=>[r.id,pstExclusionScope(emma,r)]),[['amitriptyline','library']]);
  const p=neutral();p.clinicalContext={...p.clinicalContext,allergyStatus:'Reactions reported',allergies:'Pregabalin: facial swelling.',medicalHistory:'Recurrent depression.'};
  const scoped=rankPst(p,weights).excluded.map(r=>[r.id,pstExclusionScope(p,r)]);
  for(const id of ['pregabalin','pgb-dlx','duloxetine','nortriptyline','dlx-cap','gbp-nort'])assert.deepEqual(scoped.find(([x])=>x===id),[id,'patient'],id);
  assert.deepEqual(scoped.find(([x])=>x==='amitriptyline'),['amitriptyline','library']);
  assert.equal(pstExclusionScope(p,rankPst(p,weights).ranked[0]),undefined);
});

test('Shadow words a row with no rule difference as no rule match, and names a keyword rule flag as a rule',()=>{
  const w=seedWorkspace(),p=neutral();
  const shadow=shadowOpinion(p,w,rankPst(p,weights).ranked).onPst;
  assert.ok(shadow.every(s=>s.kind==='agree'&&s.reason.startsWith('No Shadow rule matched this option.')));
  assert.ok(!shadow.some(s=>/\bagree/i.test(s.reason)));
  const emma=byId('TN-DEMO-01'),nort=rankPst(emma,defaultPstPriorities(emma),false,{query:'nortriptyline'}).ranked;
  const card=shadowOpinion(emma,w,nort).onPst.find(s=>s.optionId==='nortriptyline');
  assert.equal(card.kind,'differ');assert.match(card.reason,/^A keyword rule flags this option: Keyword rule flag\./);
});

test('search and required-drug filters narrow by name or component and keep scores',()=>{
  const p=neutral(),all=rankPst(p,weights);
  const lido=rankPst(p,weights,false,{query:'LIDO'});
  assert.deepEqual(lido.all.map(r=>r.id).sort(),['gbp-lido','lidocaine','pgb-lido']);
  assert.deepEqual(rankPst(p,weights,false,{query:'5%'}).all.map(r=>r.id).sort(),['gbp-lido','lidocaine','pgb-lido'],'Component names are searched');
  assert.equal(rankPst(p,weights,false,{query:'  '}).all.length,all.all.length);
  assert.deepEqual(rankPst(p,weights,false,{requiredDrugIds:['pregabalin']}).all.map(r=>r.id).sort(),['pgb-cap','pgb-dlx','pgb-lido','pregabalin']);
  assert.deepEqual(rankPst(p,weights,false,{requiredDrugIds:['pregabalin','duloxetine']}).all.map(r=>r.id),['pgb-dlx']);
  assert.deepEqual(rankPst(p,weights,false,{requiredDrugIds:['pregabalin'],kind:'combination',query:'capsaicin'}).all.map(r=>r.id),['pgb-cap']);
  for(const r of lido.ranked)assert.equal(r.cui,all.ranked.find(x=>x.id===r.id).cui);
});

test('lowest lists the bottom three eligible rows under the current weights',()=>{
  const p=byId('TN-DEMO-01'),ranking=rankPst(p,defaultPstPriorities(p));
  assert.deepEqual(ranking.lowest.map(r=>r.id),ranking.ranked.slice(-3).map(r=>r.id));
  assert.ok(ranking.lowest.every(r=>!r.excluded));
  const relief=rankPst(p,{analgesia:100,abuse:0,cognitive:0,sedation:0});
  assert.deepEqual(relief.lowest.map(r=>r.id),relief.ranked.slice(-3).map(r=>r.id));
  assert.notDeepEqual(relief.lowest.map(r=>r.id),ranking.lowest.map(r=>r.id),'Weights change the lowest rows');
  assert.equal(rankPst(p,weights,false,{requiredDrugIds:['pregabalin','duloxetine']}).lowest.length,1);
  assert.ok(Array.isArray(ranking.avoided)&&ranking.version);
});

test('model limits are versioned, returned with the ranking, and describe the planned model without naming a partner',()=>{
  const p=neutral(),ranking=rankPst(p,weights);
  assert.equal(ranking.modelLimits,pstModelLimits);
  assert.match(pstModelLimits.version,/v\d/);
  const text=Object.values(pstModelLimits.items).join(' ');
  for(const phrase of [/example values, not model output/,/single-drug data/,/combination predictions/,/weaker evidence than its pain-relief/,/Age and sex are not model inputs/,/prior reactions/,/Placebo response is not modeled/])assert.match(text,phrase);
  assert.doesNotMatch(text,/\bISB\b|Institute|confidence|\d+%/);
});

test('no rule, label or shadow text uses directive or confidence wording, and Shadow carries no confidence field',()=>{
  const w=ensureShowcaseData(seedWorkspace());
  const banned=/first[- ]line|first choice|\bprefer|\bavoid|\breserve|more relief|recommend|optimal|\bbest\b|confiden|studied together/i;
  const strings=[pstLabelNotice,pstHistoryNotice,...Object.values(pstModelLimits.items)];
  for(const p of w.patients){
    const ranking=rankPst(p,defaultPstPriorities(p)),shadow=shadowOpinion(p,w,ranking.ranked);
    for(const r of ranking.all)strings.push(r.why,r.labelNote,r.excluded??'',...pstProfileRuleExplanation(p,r),...r.history.map(pstHistorySummary));
    strings.push(...twinOverview(p).cautions.map(c=>c.body));
    for(const s of [...shadow.onPst,...shadow.extra]){assert.ok(!('confidence' in s),s.id);strings.push(s.reason,s.evidence);}
  }
  for(const text of strings)assert.doesNotMatch(text,banned,text);
});

test('the Twin never classifies negated or unclear condition wording as a syndrome',()=>{
  for(const condition of ['Diabetic neuropathy ruled out','PHN ruled out','Postherpetic neuralgia excluded']){
    const p=byId('TN-DEMO-01');p.condition=condition;
    assert.equal(twinOverview(p).iasp,'IASP · '+condition,condition);
  }
  // Only the diabetic part is negated here; it is still a peripheral neuropathy.
  const q=byId('TN-DEMO-01');q.condition='Neuropathy, not DPN';
  assert.equal(twinOverview(q).iasp,'IASP I-1 · Peripheral neuropathy');
  const p=byId('TN-DEMO-01');p.condition='Painful diabetic peripheral neuropathy';
  assert.equal(twinOverview(p).iasp,'IASP I-1 · Peripheral neuropathy (diabetic)');
  // Each term is read on its own: negated or doubtful wording is not classified, and a qualifier about another condition
  // does not hide this one.
  const iaspOf=condition=>{const r=byId('TN-DEMO-01');r.condition=condition;return twinOverview(r).iasp;};
  for(const condition of ['No diabetic neuropathy','Suspected fibromyalgia','Neuropathy r/o','PHN, now resolved'])assert.equal(iaspOf(condition),'IASP · '+condition,condition);
  assert.equal(iaspOf('Chemotherapy-induced neuropathy; diabetes ruled out'),'IASP I-2 · Peripheral neuropathic pain (CIPN)');
  assert.equal(iaspOf('Fibromyalgia; PHN excluded'),'IASP II-1 · Chronic primary pain (fibromyalgia)');
  assert.equal(iaspOf('Peripheral neuropathy; osteoarthritis ruled out'),'IASP I-1 · Peripheral neuropathy');
});
