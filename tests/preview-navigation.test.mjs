import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const bundle=await build({stdin:{contents:"export * from './lib/preview-navigation'; export {patientSelectionSearch} from './lib/journey-navigation'; export {patientRecordViewSearch} from './lib/workflow-navigation';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',write:false});
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {previewHref,previewViews,patientSelectionSearch,patientRecordViewSearch}=mod.exports;
const parsed=href=>new URL(href,'https://demo.example');

test('every workspace page remains on the single protected static entry point',()=>{
  for(const view of previewViews){
    for(const path of ['/'+view,'/'+view+'/']){
      const url=parsed(previewHref(path));
      assert.equal(url.pathname,'/');
      assert.equal(url.searchParams.get('view'),view);
    }
  }
});

test('patient chart links select the exact patient and default to the complete record',()=>{
  const url=parsed(previewHref('/patients/TN-DEMO-02'));
  assert.equal(url.pathname,'/');
  assert.equal(url.searchParams.get('patient'),'TN-DEMO-02');
  assert.equal(url.searchParams.get('tab'),'full');
  assert.equal(url.searchParams.has('view'),false);
});

test('chart links discard workspace view and stale patient without discarding workflow or anchor',()=>{
  const url=parsed(previewHref('/patients/TN-DEMO-02/','?view=messages&patient=TN-DEMO-01&tab=notes&workflow=results-referrals','#patient-history'));
  assert.equal(url.searchParams.get('patient'),'TN-DEMO-02');
  assert.equal(url.searchParams.has('view'),false);
  assert.equal(url.searchParams.get('tab'),'notes');
  assert.equal(url.searchParams.get('workflow'),'results-referrals');
  assert.equal(url.hash,'#patient-history');
});

test('encoded patient identifiers are decoded exactly once and encoded safely in query values',()=>{
  const id='DEMO A+1%2F?';
  const url=parsed(previewHref('/patients/'+encodeURIComponent(id)));
  assert.equal(url.searchParams.get('patient'),id);
  assert.equal(url.searchParams.size,2);
});

test('malformed patient path encoding is rejected instead of throwing from the click handler',()=>{
  for(const path of ['/patients/%','/patients/%ZZ','/patients/%E0%A4%A']){
    assert.equal(previewHref(path),null);
  }
});

test('workspace links retain patient filters, setting tabs, and section anchors',()=>{
  const messages=parsed(previewHref('/messages','?patient=TN-DEMO-02'));
  assert.equal(messages.searchParams.get('view'),'messages');
  assert.equal(messages.searchParams.get('patient'),'TN-DEMO-02');
  const settings=parsed(previewHref('/settings','?tab=integrations&workflow=integration-access','#connections'));
  assert.equal(settings.searchParams.get('view'),'settings');
  assert.equal(settings.searchParams.get('tab'),'integrations');
  assert.equal(settings.searchParams.get('workflow'),'integration-access');
  assert.equal(settings.hash,'#connections');
});

test('treatment entry routes open the patient selector instead of selecting an arbitrary record',()=>{
  for(const path of ['/engines','/pst','/shadow-ai','/digital-twin','/robo-advisor']){
    const url=parsed(previewHref(path));
    assert.equal(url.searchParams.get('view'),'patients');
    assert.equal(url.searchParams.get('open'),'treatment');
    assert.equal(url.searchParams.has('patient'),false);
  }
});

test('valid already-rewritten URLs keep the current chart and section context',()=>{
  for(const query of ['?view=schedule&patient=TN-DEMO-01','?patient=TN-DEMO-01&tab=full']){
    assert.equal(previewHref('/',query,'#patient-history'),'/'+query+'#patient-history');
  }
  assert.equal(previewHref('/'),'/');
});

test('unknown paths, assets and service endpoints are not converted to workspace pages',()=>{
  for(const path of ['/api/workspace','/api/session','/unknown','/patients/a/extra','/logo.svg','https://example.com/messages']){
    assert.equal(previewHref(path),null);
  }
  assert.equal(previewHref('/','?view=unknown'),null);
});

test('changing a workspace patient retains its page and drops a stale guided journey',()=>{
  const search=patientSelectionSearch('?view=messages&patient=TN-DEMO-01&journey=J04&journeyStop=2&journeyPatient=TN-DEMO-01','TN-DEMO-02');
  const params=new URLSearchParams(search);
  assert.equal(params.get('view'),'messages');
  assert.equal(params.get('patient'),'TN-DEMO-02');
  assert.equal(params.has('journey'),false);
  assert.equal(params.has('journeyStop'),false);
  assert.equal(params.has('journeyPatient'),false);
});

test('changing a record tab retains patient and workflow context',()=>{
  const params=new URLSearchParams(patientRecordViewSearch('?patient=TN-DEMO-02&tab=full&workflow=encounters','notes'));
  assert.equal(params.get('patient'),'TN-DEMO-02');
  assert.equal(params.get('tab'),'notes');
  assert.equal(params.get('workflow'),'encounters');
});
