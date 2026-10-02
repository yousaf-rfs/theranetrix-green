import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const bundle=await build({stdin:{contents:"export * from './components/theranetrix/recommendation-details';export {TrendChart} from './components/theranetrix/ui';export {seedWorkspace} from './lib/theranetrix';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {RecommendationExplanation,recommendationSourceHref,TrendChart,seedWorkspace}=mod.exports;
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
test('source navigation accepts internal and HTTPS records but rejects unsafe schemes and ambiguous paths',()=>{
  assert.equal(recommendationSourceHref('/patients/p1?tab=notes'),'/patients/p1?tab=notes');
  assert.equal(recommendationSourceHref('https://example.com/evidence'),'https://example.com/evidence');
  for(const href of ['javascript:alert(1)','data:text/html,test','//example.com','/\\example.com','file:///secret'])assert.equal(recommendationSourceHref(href),undefined);
});
test('explanations retain exact sources, alternatives and gaps without manufacturing absent reasoning',()=>{
  const html=render(RecommendationExplanation,{title:'Review reported effects',rationale:['Recorded effect needs review'],sources:[{label:'Patient report',value:'Zero pain; morning effects <script>alert(1)</script>',date:'2026-09-18',href:'/patients/p1'}],considerations:['Verify current use'],alternatives:['Clarify before changing plan'],limitations:['No causal link established']});
  for(const text of ['Recorded effect needs review','Zero pain','2026-09-18','Verify current use','Clarify before changing plan','No causal link established'])assert.ok(html.includes(text));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('opens in a new tab'));
  const missing=render(RecommendationExplanation,{title:'Saved decision',rationale:[]});
  assert.ok(missing.includes('A detailed rationale has not been recorded.'));
  assert.ok(missing.includes('No supporting record or citation is attached'));
});
test('shared trend chart preserves zero and gaps without connecting across missing reports',()=>{
  const p=seedWorkspace().patients[0];p.workflowObservations=[];p.checkins=[];p.dates=['2026-09-01','2026-09-02','2026-09-10'];p.pain=[0,NaN,6];p.function=[2,3,4];p.sleep=[3,4,5];
  const html=render(TrendChart,{patient:p});
  assert.equal((html.match(/<polyline/g)??[]).length,2);
  assert.equal((html.match(/<circle/g)??[]).length,2);
  assert.ok(html.includes('2026-09-01: 0/10'));
  assert.ok(html.includes('A gap means this measure was not answered'));
});
