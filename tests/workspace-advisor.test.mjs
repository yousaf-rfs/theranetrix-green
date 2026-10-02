import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:"export * from './lib/workspace-advisor';export {seedWorkspace} from './lib/theranetrix';export {ensureShowcaseData} from './lib/demo-showcase';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {workspaceSuggestions,workspaceSuggestionsForQuestion,workspacePage,seedWorkspace,ensureShowcaseData}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const now=Date.parse('2026-09-23T12:00:00Z');
const workspace=()=>ensureShowcaseData(seedWorkspace(),'Demo care team','2026-09-20T09:00:00Z');

test('each clinician screen outside a record gets its own questions',()=>{
  assert.equal(workspacePage('/'),'overview');assert.equal(workspacePage('/review-queue'),'reviews');assert.equal(workspacePage('/patients/TN-DEMO-01'),undefined);
  const w=workspace();
  for(const page of ['overview','patients','reviews','messages','schedule']){
    const suggestions=workspaceSuggestions(w,page,now);
    assert.ok(suggestions.length>=2,page);
    for(const s of suggestions){
      assert.ok(s.answer.length>0);
      for(const item of s.items)assert.match(item.href,/^\/patients\/[^?]+\?tab=(visit|treatment|messages)(#[a-z-]+)?$/,s.id+' links into a record');
    }
  }
});

test('who needs me first puts high-priority reviews first and names the review',()=>{
  const w=workspace(),first=workspaceSuggestions(w,'overview',now).find(s=>s.id==='first');
  assert.ok(first.items.length>0);
  assert.match(first.items[0].detail,/^High · /);
  const open=new Set(w.reviews.filter(r=>r.status!=='Resolved').map(r=>r.patientId));
  assert.ok(first.items.every(item=>w.patients.some(p=>p.name===item.label&&open.has(p.id))));
});

test('answers follow the record: resolving every review empties the list',()=>{
  const w=workspace();for(const review of w.reviews)review.status='Resolved';
  const first=workspaceSuggestions(w,'overview',now).find(s=>s.id==='first');
  assert.equal(first.items.length,0);assert.match(first.answer,/No patient has an open review/);
  assert.match(workspaceSuggestions(w,'reviews',now)[0].answer,/No high-priority reviews/);
});

test('side effects and quiet patients are read from medicines and report dates',()=>{
  const w=workspace();
  const effects=workspaceSuggestions(w,'overview',now).find(s=>s.id==='effects');
  assert.ok(effects.items.some(item=>item.label==='Emma Carter'&&/Gabapentin/.test(item.detail)));
  const quiet=workspaceSuggestions(w,'overview',now).find(s=>s.id==='quiet');
  assert.ok(!quiet.items.some(item=>item.label==='Emma Carter'),'Emma reported within 14 days');
});

test('a typed panel question opens only the matching questions this page already offers',()=>{
  const w=workspace(),overview=workspaceSuggestions(w,'overview',now),ids=text=>workspaceSuggestionsForQuestion(text,overview).map(s=>s.id);
  assert.deepEqual(ids('Who got worse this week?'),['worse']);
  assert.deepEqual(ids('Any side effects?'),['effects']);
  assert.deepEqual(ids('Who needs me first?'),['first']);
  assert.deepEqual(ids('Who is waiting on a treatment decision?'),['decisions']);
  assert.deepEqual(ids('What should I prescribe?'),[],'no panel question answers a treatment choice');
  assert.deepEqual(ids('ok'),[]);
  const reviews=workspaceSuggestions(w,'reviews',now);
  assert.deepEqual(workspaceSuggestionsForQuestion('Which ones are high priority?',reviews).map(s=>s.id),['high']);
  assert.deepEqual(workspaceSuggestionsForQuestion('What has been waiting longest?',reviews).map(s=>s.id),['oldest']);
});
