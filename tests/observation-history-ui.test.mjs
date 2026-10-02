import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({stdin:{contents:"export * from './components/theranetrix/clinical-flows/observation-history';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {ObservationHistory,numericObservationSource}=mod.exports;
const entry=(id,metric,status,value,extra={})=>({id,workflowRecordId:'report-1',workflowVersion:1,encounterId:'encounter-1',metric,status,...(value===undefined?{}:{value}),source:'Original patient statement via interpreter',recordedAt:'2026-09-17T12:00:00Z',confirmedAt:'2026-09-17T13:00:00Z',confirmedBy:'First reviewing clinician',...extra});
const render=entries=>renderToStaticMarkup(React.createElement(ObservationHistory,{patient:{id:'TN-TEST',workflowObservations:entries}}));
const rows=html=>[...html.matchAll(/<tr\b[^>]*data-observation-status="[^"]+"[^>]*>[\s\S]*?<\/tr>/g)].map(match=>match[0]);

test('partial observations show actual zero, unanswered and declined responses with their source provenance',()=>{
  const entries=[entry('zero','pain','zero',0),entry('missing','function','unanswered'),entry('declined','sleep','declined')];
  const original=structuredClone(entries),html=render(entries);
  assert.match(html,/Partial report/);
  assert.match(html,/1 of 3 measures have numeric responses/);
  assert.match(html,/0 \/ 10 · Zero response/);
  assert.match(html,/Unanswered — no numeric response/);
  assert.match(html,/Declined — no numeric response/);
  assert.match(html,/Original patient statement via interpreter/);
  assert.match(html,/First reviewing clinician/);
  assert.match(html,/datetime="2026-09-17T12:00:00Z"/i);
  assert.match(html,/datetime="2026-09-17T13:00:00Z"/i);
  assert.doesNotMatch(html,/NaN|undefined|Patient self-report/);
  assert.equal(rows(html).filter(row=>row.includes('/ 10')).length,1,'Missing responses never receive numeric values.');
  assert.deepEqual(entries,original);
});

test('correction chains retain original values and clinicians, with working links in both directions',()=>{
  const entries=[entry('pain-original','pain','zero',0),entry('pain-correction','pain','answered',2,{workflowVersion:2,source:'Patient clarification',confirmedAt:'2026-09-18T09:00:00Z',confirmedBy:'Correcting clinician',correctedFromEntryId:'pain-original'}),entry('pain-withdrawn','pain','declined',undefined,{workflowVersion:3,source:'Patient withdrew the response',confirmedAt:'2026-09-19T09:00:00Z',confirmedBy:'Latest reviewing clinician',correctedFromEntryId:'pain-correction'})];
  const html=render(entries),renderedRows=rows(html);
  const current=renderedRows.filter(row=>row.includes('data-observation-current="true"'));
  const history=renderedRows.filter(row=>row.includes('data-observation-current="false"'));
  assert.equal(current.length,1);assert.match(current[0],/Declined — no numeric response/);assert.match(current[0],/Latest reviewing clinician/);
  assert.equal(history.length,2);assert.ok(history.some(row=>row.includes('0 / 10 · Zero response')&&row.includes('First reviewing clinician')));assert.ok(history.some(row=>row.includes('2 / 10')&&row.includes('Correcting clinician')));
  const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
  const links=[...html.matchAll(/href="#([^"]+)"/g)].map(match=>match[1]);
  assert.equal(links.length,4);for(const link of links)assert.ok(ids.has(link),`Correction link resolves: ${link}`);
  assert.match(html,/Superseded entries/);assert.match(html,/Not submitted: Daily function, Sleep quality/);
});

test('separate encounters keep their current values, and absent source entries remain absent',()=>{
  assert.equal(render(undefined),'');
  const html=render([entry('one','pain','answered',4),entry('two','pain','answered',7,{workflowRecordId:'report-2',encounterId:'encounter-2'})]);
  assert.equal(rows(html).length,2);
  assert.ok(rows(html).every(row=>row.includes('data-observation-current="true"')));
  assert.match(html,/Encounter encounter-1/);assert.match(html,/Encounter encounter-2/);
  assert.match(html,/Not submitted: Daily function, Sleep quality/);
  assert.doesNotMatch(html,/Superseded entries/);
});

test('numeric history uses saved sources and never substitutes obsolete corrected check-ins',()=>{
  const patient={dates:['2026-09-17'],pain:[2],function:[5],sleep:[6],checkins:[{id:'current',date:'2026-09-17T12:00:00Z',pain:2,function:5,sleep:6,source:'Clinician-confirmed report',workflowRecordId:'report',trajectoryIndex:0},{id:'earlier',date:'2026-09-17T12:00:00Z',pain:0,function:5,sleep:6,source:'Clinician-confirmed report',workflowRecordId:'report'}]};
  assert.equal(numericObservationSource(patient,0),'Clinician-confirmed report');
  const withoutCurrent={...patient,checkins:patient.checkins.slice(1)};
  assert.equal(numericObservationSource(withoutCurrent,0),'Stored trajectory');
  const stored={...patient,checkins:[{id:'stored',date:'2026-09-17',pain:2,function:5,sleep:6,source:'Stored trajectory'}]};
  assert.equal(numericObservationSource(stored,0),'Stored trajectory');
});
