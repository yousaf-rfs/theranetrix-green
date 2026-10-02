import assert from 'node:assert/strict';
import test from 'node:test';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ADVISOR_NAME} from './fixtures/product-names.mjs';
const bundle=await build({stdin:{contents:"export {glossary,glossaryEntry} from './lib/glossary';export * from './lib/terminology';export {AcronymHelp,Term} from './components/theranetrix/ui';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {glossary,glossaryEntry,AcronymHelp,Term,CDSS,PRODUCT_CATEGORY,PRODUCT_DESCRIPTION}=mod.exports;
const escape=text=>text.replaceAll('&','&amp;').replaceAll('"','&quot;');
const source=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?source(join(dir,entry.name)):/\.tsx?$/.test(entry.name)&&entry.name!=='glossary.ts'?[readFileSync(join(dir,entry.name),'utf8')]:[]);

test('every glossary entry has a short form and a definition in support-only wording',()=>{
  const entries=Object.entries(glossary);
  assert.ok(entries.length>=10);
  for(const [term,entry] of entries){
    assert.ok(entry.short.trim()&&entry.short!==term,term+' short form');
    assert.ok(entry.definition.trim().length>40,term+' definition');
    assert.doesNotMatch(entry.short+' '+entry.definition,/recommend|optimal|best|confidence|validated/i,term);
    assert.doesNotMatch(entry.definition,/\bFDA\b|cleared|approved/i,term+' makes no regulatory claim');
  }
});

test('the glossary only holds terms the UI renders, and no model names it does not show',()=>{
  for(const term of ['QSP','ISB'])assert.equal(glossaryEntry(term),undefined,term);
  const code=[...source('components'),...source('lib')].join('\n');
  for(const term of Object.keys(glossary))assert.ok(code.includes(term),term+' appears in the UI source');
  assert.ok(glossaryEntry(ADVISOR_NAME),'the advisor is defined under its configured name');
  assert.equal(glossaryEntry('toString'),undefined);
});

test('CUI keeps the existing wording, and any definition still passed on the ranking table matches it',()=>{
  assert.match(glossary.CUI.definition,/^Clinical Utility Index\. .*not a probability of benefit\./);
  const passed=readFileSync('components/theranetrix/treatment-screen.tsx','utf8').match(/<AcronymHelp term="CUI" definition="([^"]*)"/);
  if(passed)assert.equal(passed[1],glossary.CUI.definition);
  assert.match(glossary.PST.definition,/does not prescribe/);assert.match(glossary.PST.definition,/example values/);
});

test('Term renders the text itself as a dotted, titled button that opens the definition',()=>{
  const html=renderToStaticMarkup(React.createElement('h2',null,React.createElement(Term,{t:'PST'})));
  assert.match(html,/^<h2><button type="button" class="glossary-term" title="[^"]+"[^>]*>PST<\/button><\/h2>$/);
  assert.ok(html.includes('title="'+escape(glossary.PST.definition)+'"'));
  assert.match(html,/aria-haspopup="dialog"/);assert.match(html,/aria-expanded="false"/);
  assert.match(renderToStaticMarkup(React.createElement(Term,{t:'CUI'},'Clinical Utility Index')),/>Clinical Utility Index<\/button>$/);
});

test('AcronymHelp reads its text from the glossary unless a definition is passed',()=>{
  const fromGlossary=renderToStaticMarkup(React.createElement(AcronymHelp,{term:'CUI'}));
  assert.ok(fromGlossary.includes('title="'+escape(glossary.CUI.definition)+'"'));assert.ok(fromGlossary.includes('aria-label="About CUI"'));
  assert.ok(renderToStaticMarkup(React.createElement(AcronymHelp,{term:'XYZ',definition:'Local definition text.'})).includes('title="Local definition text."'));
});

test('terminology standardizes on CDSS with its expansion',()=>{
  assert.equal(CDSS,'CDSS');assert.equal(PRODUCT_CATEGORY,'clinical decision support system (CDSS)');
  assert.ok(PRODUCT_DESCRIPTION.includes('a clinical decision support system (CDSS) for chronic pain care'));
  assert.equal(glossary[CDSS].short,'Clinical decision support system');
  assert.doesNotMatch(PRODUCT_DESCRIPTION,/recommend/i);
});
test('Shadow AI is defined by rule differences, never as agreement or an independent view',()=>{
 const shadow=glossary['Shadow AI'].definition;
 assert.match(shadow,/flags rule differences on the top-listed PST options/);assert.match(shadow,/not an independent clinical model/);
 assert.doesNotMatch(shadow,/\bagree/i);
});
