import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({stdin:{contents:"export {FutureCapabilities} from './components/theranetrix/future-preview';export * from './lib/future-preview';export {seedWorkspace} from './lib/theranetrix';export {normalizeWorkspace} from './lib/medications';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {FutureCapabilities,capabilities,previewNotice,seedWorkspace,normalizeWorkspace}=mod.exports;

// Radix renders only the active tab server-side, so force each tab's initial state.
const original=React.useState;
function renderTab(id){
  let first=true;
  React.useState=(init)=>{if(first){first=false;return original.call(React,id);}return original.call(React,init);};
  try{return renderToStaticMarkup(React.createElement(FutureCapabilities));}finally{React.useState=original;}
}
const tabs=Object.fromEntries(capabilities.map(c=>[c.id,renderTab(c.id)]));
const visible=html=>html.replace(/<svg[\s\S]*?<\/svg>/g,' ').replace(/<[^>]+>/g,' ').replace(/&[a-z]+;/g,' ').replace(/\s+/g,' ');

test('every planned capability has a preview that renders',()=>{
 assert.equal(capabilities.length,9);
 for(const c of capabilities){
   const html=tabs[c.id];
   assert.ok(html.length>2000,c.id+' rendered');
   assert.ok(html.includes(c.headline),c.id+' shows its headline');
   assert.ok(html.includes(previewNotice),c.id+' carries the preview badge');
   assert.ok(html.includes('What ships today instead'),c.id+' says what ships instead');
   assert.ok(html.includes('Build notes'),c.id+' carries build notes');
   assert.ok(c.requires.length>=3,c.id+' names at least three requirements');
 }
});

// A prototype is meant to look real, so fabricated figures are expected here.
// What must still hold is that licensed questionnaire content is never reproduced,
// and that every screen is labelled as a preview.
test('licensed instrument wording is never reproduced',()=>{
 const text=visible(tabs.instruments);
 // Subscale names and scores are fine; actual item/question wording is not.
 assert.match(text,/Item wording stays with the rights-holder/);
 assert.match(text,/not reproduced in this prototype/);
 // No questionnaire-style item text should appear on the page.
 assert.doesNotMatch(text,/In the last 24 hours/i);
 assert.doesNotMatch(text,/Please rate your pain by/i);
 assert.doesNotMatch(text,/circle the (one )?number/i);
 assert.doesNotMatch(text,/How often (have|did) you/i);
});

test('every preview is labelled as a preview, not a working feature',()=>{
 for(const c of capabilities)assert.ok(tabs[c.id].includes(previewNotice),c.id+' carries the preview badge');
 const page=renderTab(capabilities[0].id);
 assert.match(visible(page),/figures on these pages are fabricated for the prototype/);
 assert.match(visible(page),/nothing here is connected to a clinical service/);
});

test('the pathway steps do not pose as the approved protocol',()=>{
 assert.match(visible(tabs.pathway),/approved X-1 protocol was never supplied/);
});

test('each preview keeps its build notes',()=>{
 for(const c of capabilities){
   assert.ok(tabs[c.id].includes('Build notes'),c.id+' has build notes');
   assert.ok(tabs[c.id].includes('What ships today instead'),c.id+' says what ships instead');
   assert.ok(tabs[c.id].includes(c.standsInFor),c.id+' states its current-state text');
 }
});

test('the preview module is isolated from the clinical workspace',()=>{
 // A preview must never be able to write into, or read from, a real record.
 const source=bundle.outputFiles[0].text;
 assert.ok(!/future-preview[\s\S]{0,400}applyAction/.test(source),'previews do not reach the action API');
 // Rendering the previews leaves the seeded workspace untouched.
 const before=JSON.stringify(normalizeWorkspace(seedWorkspace()));
 renderTab('twin');renderTab('pst');
 assert.equal(JSON.stringify(normalizeWorkspace(seedWorkspace())),before);
 // FutureCapabilities takes no workspace context at all.
 assert.equal(FutureCapabilities.length,0,'the component accepts no props');
});

// The previews are meant to be worked through, not just read. These assert the
// selectable state exists and that each selection changes what is rendered.
test('the twin preview projects whichever scenario is selected',()=>{
 const {twinScenarios,twinFutureDates}=mod.exports;
 assert.equal(twinScenarios.length,3);
 for(const s of twinScenarios){
   assert.equal(s.forecast.length,twinFutureDates.length,s.id+' has a point per future date');
   for(const [predicted,low,high] of s.forecast){
     assert.ok(low<=predicted&&predicted<=high,s.id+' interval contains its projection');
     assert.ok(low>=0&&high<=10,s.id+' stays on the 0-10 scale');
   }
   assert.ok(s.projected&&s.interval&&s.change,s.id+' has headline values');
   assert.ok(!('confidence' in s),s.id+' carries no confidence field');
 }
 // Each scenario must be distinguishable, or selecting one would look broken.
 const series=twinScenarios.map(s=>JSON.stringify(s.forecast));
 assert.equal(new Set(series).size,3,'every scenario projects a different curve');
 // The default selection renders scenario-specific copy and controls.
 const html=tabs.twin;
 assert.ok(html.includes('future-scenario-tabs'),'scenario picker rendered');
 assert.equal((html.match(/aria-pressed/g)||[]).length>=3,true,'each scenario is a pressable control');
 assert.ok(html.includes(twinScenarios[0].projected),'the selected projection is shown');
});

test('each preview exposes controls a reviewer can operate',()=>{
 // Twin scenario picker, PST row toggles, connection picker, instrument picker,
 // pathway step buttons, and the role picker.
 const expected={twin:'future-scenario-tabs',pst:'future-row-toggle',integration:'future-row-toggle',
   instruments:'Open PROMIS-29',pathway:'future-pathway',governance:'future-row-toggle'};
 for(const [id,marker] of Object.entries(expected))
   assert.ok(tabs[id].includes(marker),id+' renders its control ('+marker+')');
 // Expandable detail is keyed to a single selection, so only one opens at a time.
 assert.equal((tabs.pst.match(/future-candidate-detail/g)||[]).length,1,'one PST detail row at a time');
 assert.equal((tabs.integration.match(/future-connection-detail/g)||[]).length,1,'one connection detail');
 // The pathway starts with nothing selected, so it must not render step detail.
 assert.ok(!tabs.pathway.includes('Entry criteria'),'pathway step detail is closed until a step is picked');
});

test('interactive preview data is complete for every selectable item',()=>{
 const {pstCandidates,candidateDetail,connections,connectionDetail,roleMatrix,instruments}=mod.exports;
 for(const c of pstCandidates)assert.ok(candidateDetail[c.regimen],'detail for candidate: '+c.regimen);
 for(const c of connections)assert.ok(connectionDetail[c.name],'detail for connection: '+c.name);
 for(const r of roleMatrix.roles)assert.equal(r.grants.length,roleMatrix.permissions.length,r.role+' has a grant per permission');
 for(const i of instruments)assert.ok(i.subscales.length>0&&i.subscales.every(s=>s.name&&s.score&&s.band),i.code+' subscales complete');
});

// M12: no single numerical confidence or assurance score, and no invented literature.
test('no preview shows a confidence or single-number assurance score',()=>{
 for(const c of capabilities){
   const text=visible(tabs[c.id]);
   assert.doesNotMatch(text,/Stated confidence|Model confidence|confidence label|Brier/i,c.id+' shows no confidence score');
 }
 const {twinModelCard,shadowComparison}=mod.exports;
 assert.ok(!shadowComparison.some(r=>/confidence/i.test(r.row)),'no confidence row in the model comparison');
 assert.ok(!twinModelCard.some(r=>/Brier/.test(r.value)),'no Brier score on the model card');
});
test('preview evidence is a labelled placeholder, never a journal-style citation',()=>{
 const {shadowCitations,citationsNotice}=mod.exports;
 const text=visible(tabs.shadow);
 assert.equal(citationsNotice,'Illustrative, not real references');
 assert.match(text,/Illustrative, not real references/);
 for(const c of shadowCitations){
   assert.ok(!('journal' in c)&&!('year' in c)&&!('finding' in c),'no journal, year or finding fields');
   assert.ok(c.fields.every(f=>/placeholder/.test(f.value)),'every evidence field is marked as a placeholder');
 }
 assert.doesNotMatch(text,/Pain Medicine|Journal of Pain Research|number-needed-to-treat|first-line/i);
 assert.match(text,/study count alone is not evidence quality/i);
});
test('the PST preview states what ships today, including drug and combination options',()=>{
 const pst=capabilities.find(c=>c.id==='pst');
 assert.doesNotMatch(pst.standsInFor,/never names a drug/);
 assert.match(pst.standsInFor,/single drugs and drug combinations/);
 assert.match(pst.standsInFor,/example values/);
});
test('the integration preview frames the EHR as the record of truth and Epic as illustrative',()=>{
 const {connections,writeBackQueue,inboundFeed}=mod.exports;
 const epic=connections.find(c=>c.name==='Epic');
 assert.notEqual(epic.status,'Connected');assert.match(epic.status,/Illustrative/);assert.doesNotMatch(epic.records,/\d/);
 assert.ok(!inboundFeed.some(r=>r.source==='Epic'),'no inbound record claims to come from a connected Epic');
 // The CDS channel into the EHR carries decision-support information, not recommendations; clinician-authored items keep their own names.
 assert.match(connections.find(c=>c.name==='CDS Hooks').scope,/Clinical decision-support information/);
 assert.doesNotMatch(connections.find(c=>c.name==='CDS Hooks').scope,/recommendation/i);
 assert.ok(writeBackQueue.some(r=>r.item.startsWith('Clinician decision and rationale')));
 assert.ok(!writeBackQueue.some(r=>/recommendation/i.test(r.item)));
 const text=visible(tabs.integration);
 assert.match(text,/remains the record of truth/);assert.match(text,/no EHR is connected/i);
});
test('EHR-side preview rows are illustrative, off-label is not an exclusion, and no candidate carries a single evidence grade',()=>{
 const {connections,connectionDetail,writeBackQueue,pstCandidates,pstSearchSummary}=mod.exports;
 const hooks=connections.find(c=>c.name==='CDS Hooks');
 assert.notEqual(hooks.status,'Connected');assert.match(hooks.status,/Illustrative/);assert.doesNotMatch(hooks.sync+hooks.records,/Live|\d/);
 assert.doesNotMatch(connectionDetail['CDS Hooks'].volume+connectionDetail['CDS Hooks'].health,/Live|invocations today|checks passing/);
 assert.ok(!writeBackQueue.some(r=>/\bEHR\b/.test(r.target)&&r.status.startsWith('Sent')),'nothing is shown as sent to an EHR');
 const excluded=pstSearchSummary.find(r=>r.label==='Excluded and why').value;
 assert.doesNotMatch(excluded,/licensed indication|outside the label/i);assert.match(excluded,/Label status does not exclude a candidate/);
 const counts=excluded.match(/\d+/g).map(Number);assert.equal(counts[0],counts.slice(1).reduce((a,b)=>a+b,0),'the total matches its parts');
 assert.ok(!pstCandidates.some(c=>/grade\s*[A-D]\b/i.test(c.evidence)),'no single letter grade per regimen');
 assert.doesNotMatch(visible(tabs.pst),/Grade [A-D]\b/);
});
test('the Shadow preview is framed as a check inside one CDSS workflow, not an independent second opinion',()=>{
 const shadow=capabilities.find(c=>c.id==='shadow');
 assert.equal(shadow.eyebrow,'RULE-BASED REVIEW');assert.equal(shadow.name,'Shadow AI model and evidence retrieval');
 for(const text of [shadow.name,shadow.eyebrow,shadow.headline,shadow.summary,shadow.standsInFor])assert.doesNotMatch(text,/independent|second opinion/i,text);
 const text=visible(tabs.shadow);
 assert.match(text,/one clinician decision/);
 assert.doesNotMatch(text,/second opinion|Two models, compared|genuinely independent/i);
});
test('PST preview ranks agree with their utility values and use modelled, not predicted, wording',()=>{
 const {pstCandidates,candidateDetail,pstSearchSummary,twinScenarios}=mod.exports;
 pstCandidates.forEach((c,i)=>{assert.equal(c.rank,i+1);if(i)assert.ok(Number(pstCandidates[i-1].cui)>=Number(c.cui),c.regimen+' is not ranked above a higher utility');});
 const ordinal=['first','second','third','fourth'];
 for(const c of pstCandidates){const d=candidateDetail[c.regimen];for(const [i,word] of ordinal.entries())if(new RegExp('Ranked '+word+'\\b').test(d.alternativesConsidered))assert.equal(c.rank,i+1,c.regimen+' text matches its rank');}
 const copy=[capabilities.find(c=>c.id==='pst').summary,...Object.values(candidateDetail).flatMap(d=>Object.values(d)),...pstSearchSummary.map(r=>r.value),...twinScenarios.map(s=>s.note)].join(' ');
 assert.doesNotMatch(copy,/predicted benefit|Strongest projected|ranks what survives|\bprefer(?:s|red|ring)?\b/i);
});
