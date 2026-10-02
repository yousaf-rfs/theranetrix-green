import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ADVISOR_NAME} from './fixtures/product-names.mjs';
const bundle=await build({stdin:{contents:"export * from './lib/guide-content';export {glossary} from './lib/glossary';export {GuideButton} from './components/theranetrix/guide-dialog';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {guideSections,guideScreenFor,guideSegments,glossary,GuideButton}=mod.exports;
const texts=guideSections.flatMap(s=>[s.title,s.intro??'',...(s.steps??[]).flatMap(step=>[step.title,step.text]),...(s.screens??[]).flatMap(entry=>[entry.name,entry.text]),...(s.items??[])]);

test('the guide covers organization, screens, the calculation, limits and where to find explanations',()=>{
  assert.deepEqual(guideSections.map(s=>s.id),['flow','screens','calculation','limits','help']);
  assert.deepEqual(guideSections[0].steps.map(step=>step.title),['Patient check-ins','Digital Twin record','PST and Shadow AI comparisons','Your decision','Plan']);
  const all=texts.join('\n');
  for(const phrase of [/example scores/,/{CUI}.*not a probability of benefit/,/Exclusions are rule-based/,/Flags on a row/,/does not prescribe/,/no single numeric confidence or assurance score/,/{EHR} remains the source of truth/,/Off-label use is a prescribing decision for the clinician/,/not a claim that it is effective or suitable/,/Starting priorities come from a keyword preset on the record/,/{Digital Twin} scores \(pain, function, sleep, mood\) are shown for context and do not change the PST order/])assert.match(all,phrase);
});

test('guide wording describes what matched and leaves the decision to the clinician',()=>{
  for(const text of texts){
    assert.doesNotMatch(text,/\brecommend\w*|\boptimal\b|\bbest\b|first-line|\bto avoid\b|\bpreferred\b/i,text);
    assert.doesNotMatch(text,/\bFDA\b|cleared|approved/i,text);
    assert.doesNotMatch(text,/\bconfidence\b(?! or assurance score)/i,'confidence only appears to say there is none: '+text);
    assert.doesNotMatch(text,/off-label[^.]*(lower|inferior|less)/i,text);
  }
});

test('every braced term is a glossary term, and the advisor is named from its constant',()=>{
  for(const text of texts)for(const part of guideSegments(text))if(typeof part!=='string')assert.ok(Object.hasOwn(glossary,part.term),part.term+' is not in the glossary');
  assert.deepEqual(guideSegments('The {PST} compares.'),['The ',{term:'PST'},' compares.']);
  assert.ok(texts.some(text=>text.includes('{'+ADVISOR_NAME+'}')));
  assert.doesNotMatch(readFileSync('lib/guide-content.ts','utf8'),/robo\s+advisor/i);
});

test('the guide opens at the entry for the current screen',()=>{
  const screens=new Set(guideSections.find(s=>s.id==='screens').screens.map(entry=>entry.id));
  const cases=[['/',null,'overview'],['/patients',null,'patients'],['/patients/TN-DEMO-01',null,'visit'],['/patients/TN-DEMO-01','advisor','visit'],['/patients/TN-DEMO-01','treatment','treatment'],['/patients/TN-DEMO-01','pst','treatment'],['/patients/TN-DEMO-01','twin','twin'],['/patients/TN-DEMO-01','messages','record-messages'],['/patients/TN-DEMO-01','notes','notes'],['/patients/TN-DEMO-01','trace','more'],['/patients/TN-DEMO-01','evidence','more'],['/review-queue',null,'reviews'],['/messages',null,'inbox'],['/schedule',null,'schedule'],['/care-pathways',null,'pathways'],['/settings',null,'settings'],['/digital-twin',null,'twin'],['/engines',null,'treatment']];
  for(const [path,tab,screen] of cases){assert.equal(guideScreenFor(path,tab),screen,path+' '+tab);assert.ok(screens.has(screen),screen);}
  assert.equal(guideScreenFor('/future-capabilities',null),'','unknown screens open at the top');
});

test('the top-bar "?" is a labelled button that opens the guide dialog',()=>{
  const html=renderToStaticMarkup(React.createElement(GuideButton,{path:'/'}));
  assert.match(html,/^<button type="button" class="icon-btn" aria-label="How TheraNetrix works" title="How TheraNetrix works" aria-haspopup="dialog" aria-expanded="false"/);
  assert.match(readFileSync('components/theranetrix/app.tsx','utf8'),/<GuideButton path=\{path\}\/>/);
});
test('the guide lists only the rules that exclude a row, and says flagged history stays ranked',()=>{
 const items=guideSections.find(s=>s.id==='calculation').items,exclusions=items.find(text=>/^Exclusions are rule-based/.test(text)),flags=items.find(text=>/^Flags on a row/.test(text));
 assert.doesNotMatch(exclusions,/side effect|current trial|grogg/i,'reported effects and the grogginess rule flag a row; they do not exclude it');
 for(const phrase of [/allergy record names the drug/,/keyword rule/,/for every patient \(amitriptyline\)/,/combination is excluded when either of its drugs is/])assert.match(exclusions,phrase);
 for(const phrase of [/the row stays ranked/,/side effects reported on a current trial/,/a stopped trial/,/grogginess keyword rule/])assert.match(flags,phrase);
 assert.doesNotMatch(texts.join(' '),/agrees (with|or differs)|where it agrees/,'Shadow AI is described by rule differences');
});
