import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ADVISOR_NAME} from './fixtures/product-names.mjs';
const bundle=await build({stdin:{contents:"export {AdvisorDock} from './components/theranetrix/advisor-dock';export {ADVISOR_RUBRIC_VERSION} from './lib/advisor-guide';export {advisorReply} from './lib/engine-demo';export {seedWorkspace} from './lib/theranetrix';export {ensureShowcaseData} from './lib/demo-showcase';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {AdvisorDock,ADVISOR_RUBRIC_VERSION,advisorReply,seedWorkspace,ensureShowcaseData}=mod.exports;
const workspace=()=>ensureShowcaseData(seedWorkspace(),'Demo care team','2026-09-20T09:00:00Z');
const ctx=data=>({data,user:'Reviewer',busy:false,save:async()=>false,open:()=>{}});
const render=(w,p,page='visit')=>renderToStaticMarkup(React.createElement(AdvisorDock,{p,ctx:ctx(w),startOpen:true,page}));
const ask=(w,p,text,date)=>{const response=advisorReply(p,w,'question',text,'routine','en','clinician');w.advisorTurns=[...(w.advisorTurns??[]),{id:'turn-'+date,patientId:p.id,date,patientText:text,reply:response.reply,summary:response.summary,intent:'question',audience:'clinician'}];};

test('the record dock says what it answers, what it will not do, and its rule version',()=>{
  const w=workspace(),p=w.patients.find(x=>x.id==='TN-DEMO-01'),html=render(w,p);
  assert.ok(html.includes('<summary>What the '+ADVISOR_NAME+' answers</summary>'));
  assert.match(html,/Recommending, choosing or changing a treatment, option or dose/);
  assert.ok(html.includes('Prototype rules, not clinically validated. Rule set '+ADVISOR_RUBRIC_VERSION+'.'));
  assert.ok(html.includes('placeholder="Ask about this patient’s record…"'));
  assert.doesNotMatch(html,/Ask anything/);
});

test('earlier typed questions keep their Show me links, including a declined recommendation',()=>{
  const w=workspace(),p=w.patients.find(x=>x.id==='TN-DEMO-01');
  ask(w,p,'What medications is she on?','2026-09-20T10:00:00Z');ask(w,p,'Should I start duloxetine?','2026-09-20T10:05:00Z');ask(w,p,'Tell me a joke','2026-09-20T10:10:00Z');
  const html=render(w,p),history=html.slice(html.indexOf('Earlier questions'));
  assert.ok(history.includes('Medications &amp; response'),'the medication question links to Medications & response');
  assert.ok(history.includes('PST comparison')&&history.includes('Go to Your decision'),'the refusal links to the PST comparison and Your decision');
  assert.match(history,/I restate Emma’s saved record\. I do not recommend, choose or change a treatment or dose\./);
  assert.equal((history.match(/Show me · /g)??[]).length,2,'the out-of-scope question has no Show me');
  assert.doesNotMatch(history.slice(0,history.indexOf('What the '+ADVISOR_NAME)),/class="advisor-show-me"/,'history links avoid the teal button whose label the history styles would grey out');
});

test('the closed dock suggests the change question anchored on the signed visit',()=>{
  const w=workspace(),p=w.patients.find(x=>x.id==='TN-DEMO-01');
  const html=renderToStaticMarkup(React.createElement(AdvisorDock,{p,ctx:ctx(w),page:'visit'}));
  assert.match(html,/Suggested question<\/small>What changed since the last visit on Sep 20\?/);
});

test('advisor answers define PST in place with the glossary term, in suggestions and saved replies',()=>{
  const w=workspace(),p=w.patients.find(x=>x.id==='TN-DEMO-01');
  ask(w,p,'Should I start duloxetine?','2026-09-20T10:05:00Z');
  const saved=w.advisorTurns.at(-1).reply;
  assert.match(saved,/\bPST\b/);assert.doesNotMatch(saved,/[{}]/,'the saved reply stays plain text');
  const html=render(w,p,'treatment'),history=html.slice(html.indexOf('Earlier questions'));
  assert.match(history,/<button type="button" class="glossary-term" title="Prescribing support tool\.[^"]*"[^>]*>PST<\/button>/,'the saved reply defines PST');
  assert.equal((history.slice(0,history.indexOf('</li>')).match(/class="glossary-term"/g)??[]).length,1,'only the first mention in a reply is marked');
  assert.doesNotMatch(html,/\{PST\}|\{CUI\}/);
});
