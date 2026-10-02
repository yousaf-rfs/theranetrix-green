import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../lib/journey-navigation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022}, reportDiagnostics: true});
assert.equal(compiled.diagnostics?.length ?? 0, 0);
// Bundled rather than imported from the transpiled text: the register reads the advisor's display name from lib/product-names.ts.
const bundled = await build({entryPoints: [fileURLToPath(new URL('../lib/journey-navigation.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false});
const {journeys, chapters, findJourney, suggestedPatient, journeyHref, readJourneyContext, readinessLabels, screenLabels, patientSelectionSearch, patientIdFromPath} = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const patients = [{id: 'TN-DEMO-01', name: 'Emma Carter'}, {id: 'TN-DEMO-02', name: 'Lucas Hayes'}, {id: 'special +?/#%', name: 'Encoding Test'}];

test('the register retains all 34 journey IDs and 17 chapters', () => {
  assert.deepEqual(journeys.map(j => j.id), Array.from({length:34}, (_, i) => 'J' + String(i + 1).padStart(2,'0')));
  assert.equal(chapters.length, 17);
  assert.equal(new Set(chapters.map(c => c.id)).size, 17);
  for (const c of chapters) for (const id of c.journeys) assert.ok(findJourney(id), c.id + ' references ' + id);
});

test('all journey screens and readiness labels are explicit', () => {
  for (const j of journeys) {
    assert.ok(readinessLabels[j.readiness]); assert.ok(j.screens.length > 0); assert.ok(j.question.length > 10);
    for (const screen of j.screens) assert.ok(screenLabels[screen]);
  }
  for (let id=29; id<=34; id++) assert.equal(findJourney('J'+id).readiness, 'extension-needed');
});

for (const j of journeys) test(j.id + ' generates same-patient relative links for every guide stop', () => {
  const before = JSON.stringify(patients);
  for (let stop=0; stop<j.screens.length; stop++) {
    const link = journeyHref(j.id, stop, patients[0].id, patients);
    assert.ok(link?.startsWith('/')); assert.ok(!link.startsWith('//'));
    const url = new URL(link, 'https://example.invalid');
    assert.equal(url.origin, 'https://example.invalid');
    const context = readJourneyContext(url.pathname, url.search, patients);
    assert.equal(context.kind, 'active'); assert.equal(context.journey.id, j.id); assert.equal(context.stop, stop);
    if (j.requiresPatient) assert.equal(context.patientId, patients[0].id);
    else assert.equal(url.searchParams.has('patient'), false);
  }
  assert.equal(JSON.stringify(patients), before, 'Navigation must not mutate patient records');
});

test('missing or unknown patients never fall back to the first patient', () => {
  assert.equal(journeyHref('J04',0,'',patients), null);
  assert.equal(journeyHref('J04',0,'unknown',patients), null);
  assert.equal(journeyHref('J04',0,patients[0].id,[]), null);
});

test('suggestions require a unique exact full-name match', () => {
  assert.equal(suggestedPatient(findJourney('J04'),patients),patients[0].id);
  assert.equal(suggestedPatient(findJourney('J06'),patients),'');
  assert.equal(suggestedPatient(findJourney('J04'),[...patients,{id:'another',name:'Emma Carter'}]),'');
  assert.equal(suggestedPatient(findJourney('J04'),[{id:'x',name:'Emma Carter Smith'}]),'');
});

test('bad journey IDs and invalid positions cannot produce a navigation URL', () => {
  for (const id of ['', 'J00','J35','https://example.com','__proto__']) assert.equal(journeyHref(id,0,patients[0].id,patients),null);
  for (const stop of [-1,0.5,Infinity,NaN,100]) assert.equal(journeyHref('J04',stop,patients[0].id,patients),null);
});

test('special patient IDs are encoded and recover without changing origin', () => {
  const url = new URL(journeyHref('J04',0,patients[2].id,patients),'https://example.invalid');
  assert.equal(decodeURIComponent(url.pathname.slice('/patients/'.length)),patients[2].id);
  assert.equal(readJourneyContext(url.pathname,url.search,patients).patientId,patients[2].id);
});

test('normal app navigation has no journey context', () => {
  assert.deepEqual(readJourneyContext('/','',patients),{kind:'none'});
  assert.deepEqual(readJourneyContext('/patients/TN-DEMO-01','?tab=treatment',patients),{kind:'none'});
});

test('mismatched or malformed context stops the guide', () => {
  const base='?journey=J04&journeyPatient=TN-DEMO-01&patient=TN-DEMO-01';
  assert.equal(readJourneyContext('/patients/TN-DEMO-02',base,patients).kind,'invalid');
  assert.equal(readJourneyContext('/patients/%ZZ',base,patients).kind,'invalid');
  assert.equal(readJourneyContext('/messages',base.replace('patient=TN-DEMO-01','patient=TN-DEMO-02'),patients).kind,'invalid');
  assert.equal(readJourneyContext('/patient-companion','?journey=J04&journeyPatient=TN-DEMO-01',patients).kind,'invalid');
  assert.equal(readJourneyContext('/','?journey=unknown',patients).kind,'invalid');
  assert.equal(readJourneyContext('/',base+'&journeyStop=-1',patients).kind,'invalid');
  assert.equal(readJourneyContext('/',base+'&journeyStop=500',patients).kind,'invalid');
  assert.equal(readJourneyContext('/',base,[]).kind,'invalid');
});


test('guide position must match the actual route and tab', () => {
  for (const j of journeys) for (let stop = 0; stop < j.screens.length; stop++) {
    const url = new URL(journeyHref(j.id, stop, patients[0].id, patients), 'https://example.invalid');
    assert.equal(readJourneyContext('/unrelated', url.search, patients).kind, 'invalid');
    url.searchParams.set('tab', 'wrong-tab');
    assert.equal(readJourneyContext(url.pathname, url.search, patients).kind, 'invalid');
  }
});

test('duplicate context parameters fail closed even when the first value is valid', () => {
  const url = new URL(journeyHref('J04', 0, patients[0].id, patients), 'https://example.invalid');
  for (const key of ['journey', 'journeyStop', 'journeyPatient', 'patient', 'tab']) {
    const search = new URLSearchParams(url.search);
    search.append(key, search.get(key));
    assert.equal(readJourneyContext(url.pathname, '?' + search, patients).kind, 'invalid', key);
  }
});

test('program journeys reject injected patient context', () => {
  const url = new URL(journeyHref('J22', 0, '', patients), 'https://example.invalid');
  for (const key of ['patient', 'journeyPatient']) {
    const search = new URLSearchParams(url.search); search.set(key, patients[0].id);
    assert.equal(readJourneyContext(url.pathname, '?' + search, patients).kind, 'invalid');
  }
});

test('switching account or conversation exits the previous guide and preserves unrelated state', () => {
  const original = '?journey=J09&journeyStop=0&journeyPatient=TN-DEMO-01&patient=TN-DEMO-01&tab=plan&filter=active';
  const search = patientSelectionSearch(original, patients[2].id);
  const params = new URLSearchParams(search);
  for (const key of ['journey', 'journeyStop', 'journeyPatient']) assert.equal(params.has(key), false);
  assert.equal(params.get('patient'), patients[2].id);
  assert.equal(params.get('tab'), 'plan'); assert.equal(params.get('filter'), 'active');
  assert.equal(readJourneyContext('/patient-companion', search, patients).kind, 'none');
});

test('switching patient replaces duplicated patient parameters instead of appending', () => {
  const params = new URLSearchParams(patientSelectionSearch('?patient=a&patient=b', patients[0].id));
  assert.deepEqual(params.getAll('patient'), [patients[0].id]);
});

test('patient route decoding rejects malformed addresses without throwing', () => {
  assert.equal(patientIdFromPath('/patients/%ZZ'), null);
  assert.equal(patientIdFromPath('/settings'), null);
  assert.equal(patientIdFromPath('/patients/' + encodeURIComponent(patients[2].id)), patients[2].id);
});
