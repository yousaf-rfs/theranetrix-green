/** Runs against the built app with synthetic workspace API responses; no live records. */
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const {chromium} = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3100';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Only an isolated local server is permitted');
const out = process.env.QA_ARTIFACT_DIR || '/tmp/journey-browser-artifacts';
await mkdir(out, {recursive: true});
const compiled = await build({stdin: {contents: "export * from './lib/theranetrix';export * from './lib/demo-showcase';export * from './lib/medications';export * from './lib/journey-navigation';", resolveDir: process.cwd()}, bundle: true, platform: 'node', format: 'esm', write: false});
const {seedWorkspace, ensureShowcaseData, normalizeWorkspace, journeys, journeyHref} = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const data = normalizeWorkspace(ensureShowcaseData(seedWorkspace()));
const emma = 'TN-DEMO-01', lucas = 'TN-DEMO-02';
const link = (id, stop = 0) => journeyHref(id, stop, emma, data.patients);
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(base)).ok) break; } catch { /* server starting */ }
  if (i === 59) throw new Error('Built app did not start');
  await new Promise(resolve => setTimeout(resolve, 500));
}
const browser = await chromium.launch({headless: true});
const results = [], warnings = [];
async function check(name, run, {allowPost = false, width = 1440} = {}) {
  const context = await browser.newContext({viewport: {width, height: 1000}, serviceWorkers: 'block'});
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [], posts = [];
  let releasePost;
  const pending = new Promise(resolve => { releasePost = resolve; });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') warnings.push({name, text: message.text()}); });
  await page.route('**/api/workspace', async route => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      await pending;
      await route.fulfill({status: 503, json: {error: 'QA simulated save failure; no records changed.'}});
    } else await route.fulfill({json: {data, version: 1, user: 'Synthetic QA reviewer'}});
  });
  await page.route('**/api/session', route => route.fulfill({json: {ok: true}}));
  try {
    await run(page, {posts, releasePost});
    assert.deepEqual(errors, [], 'Uncaught browser errors');
    if (!allowPost) assert.equal(posts.length, 0, 'Navigation must not save clinical records');
    results.push({name, status: 'pass'});
    console.log('PASS ' + name);
  } catch (error) {
    results.push({name, status: 'fail', error: String(error)});
    console.error('FAIL ' + name + ': ' + error);
    await page.screenshot({path: out + '/failure-' + results.length + '.png', fullPage: true}).catch(() => {});
  } finally { releasePost(); await context.close(); }
}
const stopped = page => page.getByRole('complementary', {name: 'Journey navigation stopped', exact: true});
async function pick(page, label, option) {
  await page.getByRole('combobox', {name: label, exact: true}).click();
  await page.getByRole('option', {name: option, exact: true}).click();
}

await check('Home starts with a patient chart, not a journey bar', async page => {
  await page.goto(base);
  await page.getByText('Start here').waitFor();
  assert.equal(await page.locator('[data-journey-guide]').count(), 0);
  await page.getByRole('link', {name: 'Open this visit'}).first().click();
  await page.getByRole('heading', {name: 'Emma Carter'}).waitFor();
  await page.getByRole('heading', {name: 'What changed?'}).waitFor();
  await page.getByRole('heading', {name: 'Is treatment helping?'}).waitFor();
  assert.doesNotMatch(await page.locator('body').innerText(), /Local phase:|authorized-human|Explore patient journeys/);
  await page.screenshot({path: out + '/emma-visit.png'});
});
await check('Lucas visit shows observed progress', async page => {
  await page.goto(base + '/patients/' + lucas + '?tab=visit');
  await page.getByRole('heading', {name: 'Lucas Hayes'}).waitFor();
  await page.getByRole('heading', {name: 'What changed?'}).waitFor();
  await page.screenshot({path: out + '/lucas-visit.png'});
});
await check('Review queue uses clinician language', async page => {
  await page.goto(base + '/review-queue');
  const text = await page.locator('body').innerText();
  assert.doesNotMatch(text, /Local phase:|authorized-human|not-attempted/);
});
const seen = new Set();
for (const j of journeys) for (let stop = 0; stop < j.screens.length; stop++) {
  const screen = j.screens[stop]; if (seen.has(screen)) continue; seen.add(screen);
  await check('Built app destination: ' + screen, async page => {
    await page.goto(base + link(j.id, stop));
    assert.equal(new URL(page.url()).searchParams.get('journey'), j.id);
    assert.equal(await stopped(page).count(), 0);
    if (j.requiresPatient) await page.getByText('Emma Carter').first().waitFor();
    if (screen === 'visit') await page.screenshot({path: out + '/active-encounter.png'});
  });
}
await check('Ordinary record-view navigation still works', async page => {
  await page.goto(base + link('J04'));
  await pick(page, 'Record view', 'Observation history');
  await page.getByRole('heading', {name: 'Patient-reported outcomes', exact: true}).waitFor();
});
await check('Companion account switch survives reload', async page => {
  await page.goto(base + link('J09'));
  const initialAccountLabel=data.patients.find(patient=>patient.id===emma).preferredLanguage==='es'?'Cuenta':'Account';
  await pick(page, initialAccountLabel, 'Lucas Hayes');
  assert.equal(new URL(page.url()).searchParams.get('patient'), lucas);
  await page.reload(); await page.getByRole('combobox', {name: 'Account', exact: true}).waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="Account"]')?.textContent.includes('Lucas Hayes'));
});
await check('Message patient switch retains the right thread', async page => {
  await page.goto(base + link('J09', 3));
  await page.locator('.conversation-list button').filter({hasText: 'Lucas Hayes'}).click();
  assert.equal(new URL(page.url()).searchParams.get('patient'), lucas);
  assert.ok((await page.locator('.thread-header').textContent()).includes('Lucas Hayes'));
});
await check('Queue patient filter keeps the selected patient', async page => {
  await page.goto(base + link('J10', 1));
  await pick(page, 'Review patient', 'Lucas Hayes');
  assert.equal(new URL(page.url()).searchParams.get('patient'), lucas);
});
await check('Unknown patient address does not crash the workspace', async page => {
  await page.goto(base + '/patients/%25ZZ');
  await page.locator('#main-content').waitFor();
  assert.equal(await stopped(page).count(), 0);
});
await check('Narrow-screen home stays inside the viewport', async page => {
  await page.goto(base);
  await page.getByText('Start here').waitFor();
  const box = await page.locator('#main-content').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 391);
  await page.screenshot({path: out + '/home-mobile.png'});
}, {width: 390});
await browser.close();
const report = {scope: 'Built Next app, Chromium, synthetic intercepted workspace API; clinician demo path; no live clinical or partner integration testing', results, warnings, passed: results.filter(r => r.status === 'pass').length, failed: results.filter(r => r.status === 'fail').length};
await writeFile(out + '/report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({passed: report.passed, failed: report.failed}));
if (report.failed) process.exitCode = 1;
