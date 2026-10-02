import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
// Label status is derived from the recorded condition only when its wording is plain. Negation or doubt before or after the
// term, or written against its abbreviation, leaves label status to the clinician ('Not assessed'), never a derived On-label.
const compiled=await build({stdin:{contents:"export {seedWorkspace} from './lib/theranetrix';export {rankPst} from './lib/pst-library';export {pstConditionMatch} from './lib/pst-drugs';export {twinOverview} from './lib/engine-demo';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {seedWorkspace,rankPst,pstConditionMatch,twinOverview}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const neutral=condition=>{const p=structuredClone(seedWorkspace().patients.find(x=>x.id==='TN-DEMO-01'));p.condition=condition;p.medications=[];p.checkins=[];p.clinicalContext={...p.clinicalContext,allergyStatus:'None reported',allergies:'',medicalHistory:'',psychologicalContext:''};return p;};
const row=(condition,id)=>rankPst(neutral(condition),{analgesia:40,abuse:20,cognitive:20,sedation:20}).all.find(r=>r.id===id);
const dpnDrugs=['pregabalin','duloxetine','capsaicin'],phnDrugs=['gabapentin','pregabalin','lidocaine','capsaicin'];

// [recorded condition, indications matched, indications left unclear]
const cases=[
  // Negation after the term, or against the abbreviation.
  ['Peripheral neuropathy (non-DPN)',[],['dpn']],
  ['Neuropathy, not DPN',[],['dpn']],
  ['DPN excluded',[],['dpn']],
  ['DPN - excluded',[],['dpn']],
  ['Diabetic neuropathy ruled out',[],['dpn']],
  ['Diabetic neuropathy, not confirmed',[],['dpn']],
  ['Negative for DPN',[],['dpn']],
  ['Acute herpes zoster without postherpetic neuralgia',[],['phn']],
  ['Non-PHN neuralgia',[],['phn']],
  ['PHN ruled out',[],['phn']],
  ['PHN: ruled out',[],['phn']],
  ['PHN, resolved',[],['phn']],
  ['Herpes zoster, no PHN',[],['phn']],
  ['No fibromyalgia',[],['fibromyalgia']],
  ['DPN and PHN excluded',[],['phn','dpn']],
  ['PHN r/o',[],['phn']],
  ['DPN, rule out',[],['dpn']],
  ['PHN, left T4 dermatome, now resolved',[],['phn']],
  ['Postherpetic neuralgia, which was ruled out',[],['phn']],
  // A qualifier about another condition, in its own clause, does not negate this one.
  ['DPN; osteoarthritis ruled out',['dpn'],['msk']],
  ['Fibromyalgia; PHN excluded',['fibromyalgia'],['phn']],
  ['Painful DPN, knee pain; gout ruled out',['dpn'],[]],
  // Doubt anywhere leaves every named indication unclear.
  ['Possible DPN',[],['dpn']],
  ['DPN?',[],['dpn']],
  ['Suspected diabetic neuropathy',[],['dpn']],
  ['Rule out PHN',[],['phn']],
  ['PHN (query)',[],['phn']],
  ['PHN vs trigeminal neuralgia',[],['phn','tn']],
  // Plain wording still matches, including qualifiers that do not negate the term.
  ['Painful diabetic peripheral neuropathy',['dpn'],[]],
  ['Diabetic polyneuropathy',['dpn'],[]],
  ['Painful DPN of the feet',['dpn'],[]],
  ['Diabetic peripheral neuropathy without foot ulcer',['dpn'],[]],
  ['Postherpetic neuralgia',['phn'],[]],
  ['Post-herpetic neuralgia, left T6, no allodynia',['phn'],[]],
  ['History of postherpetic neuralgia',['phn'],[]],
  ['Not DPN, PHN',['phn'],['dpn']],
  ['Non-specific chronic low back pain',['msk'],[]],
  ['Chronic low back pain, non-radicular',['msk'],[]],
  ['Trigeminal neuralgia',['tn'],[]],
];

test('condition matching: each wording is matched, left unclear or not named, as the table says',()=>{
  for(const [condition,matched,unclear] of cases)assert.deepEqual(pstConditionMatch(condition),{matched,unclear},condition);
});

test('negated or doubtful DPN and PHN wording never gives a derived On-label; the row keeps the verify caveat',()=>{
  const unclear=cases.filter(([,matched])=>!matched.length);
  for(const [condition,,names] of unclear)for(const id of [...(names.includes('dpn')?dpnDrugs:[]),...(names.includes('phn')?phnDrugs:[])]){
    const r=row(condition,id);
    assert.equal(r.label,'Not assessed',condition+' · '+id);
    assert.doesNotMatch(r.labelNote,/^Labeled for/,condition+' · '+id);
    assert.match(r.labelNote,/cannot classify for .*such as negated, uncertain or loosely phrased wording\. Label status is not assessed; the clinician reviews it\./,condition+' · '+id);
    assert.equal(r.labelBasis,'example, verify against current FDA labeling');
  }
  assert.equal(row('Painful diabetic peripheral neuropathy','pregabalin').label,'On-label');
  assert.equal(row('Post-herpetic neuralgia, left T6, no allodynia','lidocaine').label,'On-label');
  assert.equal(row('Not DPN, PHN','gabapentin').label,'On-label','a PHN statement in its own clause still matches');
  // The Twin's pain-profile line reads the condition with the same rules.
  assert.doesNotMatch(twinOverview(neutral('PHN ruled out')).iasp,/postherpetic/);
  assert.doesNotMatch(twinOverview(neutral('DPN excluded')).iasp,/diabetic/);
});
