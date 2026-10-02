import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const bundle=await build({stdin:{contents:"export {TreatmentScreen,RankExplanation,TwinStatusHeader} from './components/theranetrix/treatment-screen'; export * from './lib/theranetrix'; export * from './lib/pst-library'; export {normalizeWorkspace} from './lib/medications';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {TreatmentScreen,RankExplanation,TwinStatusHeader,seedWorkspace,normalizeWorkspace,rankPst,defaultPstPriorities,pstModelLimits}=mod.exports;
const escape=text=>text.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const workspace=()=>normalizeWorkspace(seedWorkspace());
const render=(w,id)=>renderToStaticMarkup(React.createElement(TreatmentScreen,{p:w.patients.find(p=>p.id===id),ctx:{data:w,user:'Reviewer',busy:false,save:async()=>false,open:()=>{}},canDecide:true,onDecide:()=>{}}));
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/&#x27;/g,'’').replace(/\s+/g,' ');
const section=(html,cls)=>{const start=html.indexOf('class="'+cls+'"');assert.ok(start>=0,cls);return html.slice(start,html.indexOf('</section>',start));};

test('the ranking opens on the top ten with a visible count and toggle, and keeps its anchors',()=>{
  const w=workspace(),html=render(w,'TN-DEMO-01'),p=w.patients.find(x=>x.id==='TN-DEMO-01'),ranked=rankPst(p,defaultPstPriorities(p)).ranked;
  const shown=html.match(/aria-label="Review [^"]+"/g).length;
  assert.ok(ranked.length>10&&shown>=10&&shown<ranked.length,`Shows ${shown} of ${ranked.length}`);
  assert.ok(text(html).includes(`Showing ${shown} of ${ranked.length}`));
  assert.ok(text(html).includes(`Show all ${ranked.length} options`));
  assert.ok(text(html).includes('options tied at '+ranked[9].cui+' CUI with #10 are included'),'Ties with row ten are named, never cut');
  for(const id of ['treatment-ranking','treatment-shadow','treatment-exclusions','treatment-decision'])assert.ok(html.includes(`id="${id}"`),id);
  for(const label of ['Find a drug','Focus on a drug','Reset to starting priorities','Include / exclude drugs'])assert.ok(text(html).includes(label),label);
  assert.match(html,/<input type="search"[^>]*placeholder="Name or component"/);
  assert.match(html,/<select[^>]*><option value="" selected="">All options<\/option>/);
});

test('lowest-ranked options, model limits and score directions are always on screen, in neutral wording',()=>{
  const w=workspace(),html=render(w,'TN-DEMO-01'),p=w.patients.find(x=>x.id==='TN-DEMO-01'),ranking=rankPst(p,defaultPstPriorities(p));
  const lowest=text(section(html,'pst-lowest'));
  assert.match(lowest,/Lowest-ranked under current priorities/);
  for(const row of ranking.lowest){assert.ok(lowest.includes(row.name),row.name);assert.ok(lowest.includes(row.cui+' CUI'));assert.ok(html.includes('aria-label="Why this rank: '+escape(row.name)+'"'));}
  assert.doesNotMatch(lowest,/avoid|not recommended|worst/i);
  const limits=text(section(html,'pst-model-limits'));
  for(const item of Object.values(pstModelLimits.items))assert.ok(limits.includes(item.replace(/'/g,'’')),item);
  assert.ok(limits.includes(pstModelLimits.version));
  for(const hint of ['↑ relief','↑ burden','higher means more pain relief','higher means more burden'])assert.ok(html.includes(hint),hint);
  // The displayed scores are example values; the evidence limit belongs to the planned model, not to them.
  assert.ok(html.includes('title="Higher means more burden. Example value, not model output. The planned model’s side-effect estimates rest on weaker evidence than its pain-relief estimates (see Model limits)."'));
  assert.ok(html.includes('title="Higher means more pain relief. Example value, not model output."'));
  const caption=html.match(/<caption[^>]*>([^<]*)<\/caption>/)[1];
  assert.match(caption,/example benefit and risk scores \(not model output\)/);assert.match(caption,/See Model limits below the table\./);
  assert.doesNotMatch(caption,/weaker evidence/,'the caption claims nothing about the evidence behind example values');
  assert.ok(text(html).includes('Combination not validated'));
});

test('recorded history shows on the rows with its date and reason, and patient priorities show beside the sliders',()=>{
  const w=workspace(),html=text(render(w,'TN-DEMO-01')),p=w.patients.find(x=>x.id==='TN-DEMO-01');
  assert.ok(html.includes('Tried before · stopped Jul 21, 2026 · Patient reported little relief and local skin irritation'));
  assert.ok(html.includes('Lidocaine 5% patch: Tried before · stopped Jul 21, 2026'),'Combinations name the component the history came from');
  assert.ok(html.includes('Recorded patient priorities '+p.clinicalContext.preferences));
  assert.ok(html.includes('with recorded history'));
});

test('terms are defined in place, label status is explained without favouring on-label, and Shadow uses neutral labels',()=>{
  const html=render(workspace(),'TN-DEMO-01');
  for(const term of ['PST','CUI','Shadow AI'])assert.match(html,new RegExp(`<button type="button" class="glossary-term" title="[^"]+"[^>]*>${term}</button>`),term);
  assert.match(html,/aria-label="About Label status"/);
  assert.match(html,/title="FDA label status for the recorded condition[^"]*not a claim that it is effective or preferred\. The prescribing decision is the clinician’s\."/);
  assert.ok(text(html).includes('On the top-listed options'));
  assert.match(text(html),/(No rule difference|Rule difference)/);
  for(const phrase of ['Agrees with ranking','On the leading options','Different view','confidence label','calibrated confidence','Highest CUI','Recommended','Why this recommendation','Independent view','agrees with the leading','second opinion','rules agree'])assert.ok(!html.includes(phrase),phrase);
  assert.match(text(html),/Rule-based check Shadow AI/);
  assert.doesNotMatch(text(html),/\bbest option\b|\boptimal\b|first[- ]line choice|\bto avoid\b/i);
});

test('Why this rank names the example FDA labeling, the recorded history, and the combination limit',()=>{
  const w=workspace(),p=w.patients.find(x=>x.id==='TN-DEMO-01'),weights=defaultPstPriorities(p),ranking=rankPst(p,weights);
  const drawer=row=>text(renderToStaticMarkup(React.createElement(RankExplanation,{row:ranking.ranked.find(r=>r.id===row),rows:ranking.ranked,all:ranking.all,weights,p})));
  const lidocaine=drawer('lidocaine');
  for(const phrase of ['FDA label','Labeled for postherpetic neuralgia (PHN).','Labeled pain indications: postherpetic neuralgia (PHN).','Label data: example, verify against current FDA labeling.','not a claim that it is effective or preferred','Topical lidocaine: tried before, stopped 2026-07-21.','Age and sex are not model inputs','How the score adds up','Patient inputs to review','No source citation is attached'])assert.ok(lidocaine.includes(phrase),phrase);
  const combination=drawer('pgb-dlx');
  for(const phrase of ['A combination is not a labeled regimen','Pregabalin: On-label.','Duloxetine: Off-label.',pstModelLimits.items.combinations,'Its example grade does not validate the combination.'])assert.ok(combination.includes(phrase),phrase);
});

test('the patient’s current medication stays in the default view, marked Current, even when it ranks low',()=>{
  const w=workspace();
  for(const id of ['TN-DEMO-01','TN-1047']){
    const p=w.patients.find(x=>x.id===id),ranked=rankPst(p,defaultPstPriorities(p)).ranked,html=render(w,id);
    const current=ranked.filter(row=>row.current);
    assert.ok(current.length&&current.every(row=>ranked.indexOf(row)>=10),id+' has a current medication below row ten');
    const table=html.slice(html.indexOf('<tbody>'),html.indexOf('</tbody>'));
    for(const row of current){
      assert.ok(table.includes('aria-label="Review '+escape(row.name)+'"'),id+': '+row.name+' is in the default table rows');
      const cells=table.slice(table.indexOf('aria-label="Review '+escape(row.name)+'"'));
      assert.match(cells.slice(0,cells.indexOf('</tr>')),/>Current</,id+': the pinned row carries its Current badge');
    }
    assert.ok(text(html).includes('current medications and the option you picked or opened stay in view'));
  }
  const lowest=text(section(render(w,'TN-DEMO-01'),'pst-lowest'));
  assert.match(lowest,/Gabapentin \d+ CUI .*Current.*Effects reported/,'the lowest-ranked list shows the Current and history badges too');
});

test('the toolbar counts rule exclusions with correct plurals, and the Digital Twin feed shows data coverage, not a model',()=>{
  const w=workspace(),html=text(render(w,'TN-DEMO-01'));
  assert.match(html,/\d+ available · 1 rule exclusion ·/);assert.doesNotMatch(html,/profile exclusions ·|1 rule exclusions/);
  assert.match(html,/Twin data: Reports span 30\+ days \(7 reports\)\. No predictive model is connected\./);
  assert.doesNotMatch(html,/Patient-specific|Population model/);
});
test('the Twin header shows data coverage and no composite, so the visit tab’s composite is the only one',()=>{
  const w=workspace(),p=w.patients.find(x=>x.id==='TN-DEMO-01');
  const html=text(renderToStaticMarkup(React.createElement(TwinStatusHeader,{p,ctx:{data:w}})));
  assert.match(html,/Twin data Reports span 30\+ days \(7 reports\)/);
  assert.doesNotMatch(html,/Composite|Patient-specific|Population model/);
});

test('tied rows share an "=" rank, and the slider status lives in the polite status region',()=>{
  const w=workspace(),html=render(w,'TN-DEMO-01');
  const rank=name=>{const at=html.indexOf('aria-label="Review '+escape(name)+'"');return text(html.slice(at,html.indexOf('</label>',at))).replace(/^[^>]*>/,'').trim();};
  assert.equal(rank('Capsaicin 8% patch'),'=1 Rank 1, tied');assert.equal(rank('Lidocaine 5% patch'),'=1 Rank 1, tied');
  assert.match(html,/<p class="pst-reorder-status" role="status">/);
});

test('Why this rank leads with a plain summary, says where the starting priorities come from, and defines CUI in place',()=>{
  const w=workspace(),p=w.patients.find(x=>x.id==='TN-DEMO-01'),weights=defaultPstPriorities(p),ranking=rankPst(p,weights);
  const html=renderToStaticMarkup(React.createElement(RankExplanation,{row:ranking.ranked.find(r=>r.id==='capsaicin'),rows:ranking.ranked,all:ranking.all,weights,p}));
  assert.match(text(html),/Ranking details Capsaicin 8% patch 82 \/ 100 CUI Ties with Lidocaine 5% patch at 82 CUI \(order between them is alphabetical\); 9 points above Duloxetine, mainly lower cognitive and sedation burden\./);
  assert.ok(text(html).includes('Starting priorities: keyword preset from the record (grogginess or sedation wording matched), not Digital Twin output. Changed by you: no.'));
  assert.ok((html.match(/class="glossary-term"[^>]*>CUI<\/button>/g)??[]).length>=2,'CUI is a glossary term in the title and the comparisons');
  const changed=text(renderToStaticMarkup(React.createElement(RankExplanation,{row:ranking.ranked[0],rows:ranking.ranked,weights:{...weights,sedation:50},p})));
  assert.ok(changed.includes('Changed by you: yes.'));
});

test('the Twin feed is labelled as context, the reason is optional, and a matched referral prompt shows under Shadow AI',()=>{
  const w=workspace(),html=render(w,'TN-DEMO-01'),plain=text(html);
  assert.ok(plain.includes('Digital Twin feed Context for your review (not used in the score)'));
  assert.ok(!plain.includes('Recorded inputs for this comparison'));
  const form=html.slice(html.indexOf('id="treatment-decision"'));
  assert.match(form,/<label class="treatment-reason">Reason \(optional\)<textarea/);
  assert.doesNotMatch(form.slice(0,form.indexOf('</form>')),/required/);
  const shadow=html.slice(html.indexOf('id="treatment-shadow"'),html.indexOf('id="treatment-decision"'));
  assert.ok(text(shadow).indexOf('Consider a referral')>=0&&text(shadow).indexOf('Consider a referral')<text(shadow).indexOf('Additional care options'),'the referral prompt sits above Additional care options');
  assert.ok(text(shadow).includes('The clinician decides; nothing is referred automatically.'));
  for(const service of ['Physical therapy','Pain psychology','Specialty review'])assert.match(shadow,new RegExp(`href="/patients/TN-DEMO-01\\?tab=full&amp;workflow=results-referrals&amp;workflowJourney=J30&amp;referralService=${service.replace(' ','\\+')}"[^>]*>Start referral: ${service}`),service);
  const quiet=workspace(),patient=quiet.patients.find(x=>x.id==='TN-DEMO-01');
  patient.medications=patient.medications.filter(m=>m.tolerability!=='Effects reported');patient.treatmentReview=undefined;patient.checkins=[];patient.pain=[];patient.function=[];patient.sleep=[];
  assert.ok(!text(render(quiet,'TN-DEMO-01')).includes('Consider a referral'),'no card when no referral rule matches');
});

