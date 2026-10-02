import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:"export * from './lib/theranetrix';export * from './lib/pst-library';export * from './lib/pst-view';export {ensureShowcaseData} from './lib/demo-showcase';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {seedWorkspace,ensureShowcaseData,rankPst,defaultPstPriorities,pstPriorityPreset,pstTopRows,pstTopCount,pstHistoryBadge,pstReorderMessage,pstReorderSummary,pstSharedRanks,pstRankLead,pstStartingPrioritiesNote,pstDecisionNote,pstLabeledIndicationNames}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const byId=id=>structuredClone(ensureShowcaseData(seedWorkspace()).patients.find(p=>p.id===id));
const banned=/first[- ]line|first choice|\bprefer|\bavoid|recommend|optimal|\bbest\b|confiden/i;

test('the default view shows ten rows, never splits a tie at row ten, and keeps a picked or opened row in view',()=>{
  const james=byId('TN-1038'),ranked=rankPst(james,defaultPstPriorities(james)).ranked;
  assert.equal(pstTopCount,10);
  const cut=ranked[9].cui,tiedAfter=ranked.slice(10).filter(r=>r.cui===cut).length;
  assert.ok(tiedAfter>0,'The neutral preset has ties across row ten in the seed data');
  const top=pstTopRows(ranked,10);
  assert.equal(top.rows.length,10+tiedAfter);assert.equal(top.tied,tiedAfter);assert.equal(top.kept,0);
  assert.deepEqual(top.rows.map(r=>r.id),ranked.slice(0,10+tiedAfter).map(r=>r.id),'Order is the ranking order');
  const last=ranked.at(-1);assert.ok(!top.rows.includes(last));
  const kept=pstTopRows(ranked,10,[last.id,'']);
  assert.ok(kept.rows.includes(last));assert.equal(kept.kept,1);assert.equal(kept.rows.at(-1),last);
  assert.equal(pstTopRows(ranked,Infinity).rows.length,ranked.length);
  const few=ranked.slice(0,4);assert.deepEqual(pstTopRows(few,10),{rows:few,tied:0,kept:0});
});

test('history badges restate the recorded stop date and reason, and name the matched record in their detail',()=>{
  const emma=byId('TN-DEMO-01'),ranking=rankPst(emma,defaultPstPriorities(emma));
  const lidocaine=ranking.ranked.find(r=>r.id==='lidocaine'),badge=pstHistoryBadge(lidocaine.history[0],emma);
  assert.equal(badge.text,'Tried before · stopped Jul 21, 2026 · Patient reported little relief and local skin irritation; discontinuation recorded by the prior clinician');
  assert.match(badge.detail,/^Topical lidocaine: tried before, stopped 2026-07-21\./);
  assert.equal(badge.note,'Matched record: Topical lidocaine.');assert.equal(badge.tone,'amber');assert.equal(badge.locked,false);
  const combination=ranking.ranked.find(r=>r.id==='pgb-lido'),inherited=combination.history.find(h=>h.componentId==='lidocaine');
  assert.match(pstHistoryBadge(inherited,emma,'Lidocaine 5% patch').text,/^Lidocaine 5% patch: Tried before · stopped Jul 21, 2026/);
  const reaction=pstHistoryBadge({kind:'reaction',source:'record',name:'Allergy record',text:'Lidocaine: blistering at the patch site.',date:'2026-09-01'},emma);
  assert.equal(reaction.text,'Reported reaction · Lidocaine: blistering at the patch site');assert.equal(reaction.tone,'rose');assert.equal(reaction.locked,true);
  assert.equal(pstHistoryBadge({kind:'tried',source:'patient-reported',name:'Pregabalin',text:'No details given.',date:'2026-09-02'},emma).text,'Patient-reported: tried before');
  assert.equal(pstHistoryBadge({kind:'cannot-take',source:'patient-reported',name:'Tramadol',text:'Reason: nausea',date:'2026-09-02'},emma).text,'Patient-reported: cannot take');
  assert.equal(pstHistoryBadge({kind:'effects-reported',source:'record',name:'Gabapentin',text:'Morning grogginess.'},emma).text,'Effects reported');
  const now=pstHistoryBadge({kind:'reported-current',source:'patient-reported',name:'Nortriptyline',text:'Dose: 10 mg at night',date:'2026-09-20'},emma);
  assert.deepEqual([now.text,now.tone,now.locked],['Patient-reported: taking now','blue',false]);assert.doesNotMatch(now.detail,/tried before|stopped/);
  assert.equal(pstHistoryBadge({kind:'tried',source:'record',name:'Unknown',text:'No stop reason recorded.'},emma).text,'Tried before · stop date not recorded · no stop reason recorded');
});

test('a reorder is announced only when the first-listed option changes, in neutral wording',()=>{
  const emma=byId('TN-DEMO-01'),before=rankPst(emma,defaultPstPriorities(emma)).ranked,after=rankPst(emma,{analgesia:100,abuse:15,cognitive:30,sedation:30}).ranked;
  const message=pstReorderMessage(before.map(r=>r.id),after);
  assert.equal(message,`Order updated: ${after[0].name} is now listed first with these priorities (was #${before.findIndex(r=>r.id===after[0].id)+1}).`);
  assert.doesNotMatch(message,banned);
  assert.equal(pstReorderMessage(before.map(r=>r.id),before),'');
  assert.equal(pstReorderMessage([],[]),'');
  assert.match(pstReorderMessage(['a'],[{id:'b',name:'B'}]),/\(not listed before\)/);
});

test('a slider change always gets a status: a new first option, how many moved, or an unchanged order',()=>{
  const emma=byId('TN-DEMO-01'),preset=defaultPstPriorities(emma),before=rankPst(emma,preset).ranked,ids=before.map(r=>r.id);
  assert.equal(pstReorderSummary(ids,before),'Order unchanged.');
  const leader=rankPst(emma,{analgesia:100,abuse:15,cognitive:30,sedation:30}).ranked;
  assert.notEqual(leader[0].id,before[0].id);
  assert.equal(pstReorderSummary(ids,leader),pstReorderMessage(ids,leader),'A new first-listed option keeps the existing message');
  const rows=[{id:'a',name:'A',cui:82},{id:'b',name:'B',cui:82},{id:'d',name:'D',cui:70},{id:'c',name:'C',cui:70}];
  assert.equal(pstReorderSummary(['a','b','c','d'],rows),'2 options moved; A still first (tied with B at 82 CUI).');
  assert.equal(pstReorderSummary(['a','c','b'],[{id:'a',name:'A',cui:90},{id:'b',name:'B',cui:80},{id:'c',name:'C',cui:70}]),'2 options moved; A still first.');
  assert.equal(pstReorderSummary(['a','e','b','c','d'],[{id:'a',name:'A',cui:5},{id:'b',name:'B',cui:5},{id:'c',name:'C',cui:5},{id:'d',name:'D',cui:5},{id:'e',name:'E',cui:1}]),'4 options moved; A still first (tied with 3 other options at 5 CUI).');
  assert.equal(pstReorderSummary([],[]),'');
  for(const text of [pstReorderSummary(ids,before),pstReorderSummary(['a','b','c','d'],rows)])assert.doesNotMatch(text,banned);
});

test('rows tied on CUI share a rank marked "=", and the next row takes its ordinal place',()=>{
  const emma=byId('TN-DEMO-01'),ranked=rankPst(emma,defaultPstPriorities(emma)).ranked,ranks=pstSharedRanks(ranked);
  assert.deepEqual(ranked.slice(0,2).map(r=>[r.name,r.cui]),[['Capsaicin 8% patch',82],['Lidocaine 5% patch',82]],'demo: the two patches tie at 82');
  assert.deepEqual(ranks.slice(0,2),[{rank:1,tied:true,label:'=1'},{rank:1,tied:true,label:'=1'}]);
  assert.deepEqual(pstSharedRanks([{cui:9},{cui:8},{cui:8},{cui:8},{cui:7}]).map(r=>r.label),['1','=2','=2','=2','5']);
  assert.deepEqual(pstSharedRanks([{cui:3}]),[{rank:1,tied:false,label:'1'}]);
  assert.deepEqual(pstSharedRanks([]),[]);
});

test('Why this rank opens with one plain sentence built from the weighted components',()=>{
  const emma=byId('TN-DEMO-01'),weights=defaultPstPriorities(emma),ranked=rankPst(emma,weights).ranked,row=id=>ranked.find(r=>r.id===id);
  assert.equal(pstRankLead(row('capsaicin'),ranked,weights),'Ties with Lidocaine 5% patch at 82 CUI (order between them is alphabetical); 9 points above Duloxetine, mainly lower cognitive and sedation burden.');
  assert.equal(pstRankLead(row('lidocaine'),ranked,weights),'Ties with Capsaicin 8% patch at 82 CUI (order between them is alphabetical); 9 points above Duloxetine, mainly lower cognitive and sedation burden.');
  assert.match(pstRankLead(row('duloxetine'),ranked,weights),/^Ties with Duloxetine \+ capsaicin 8% patch at 73 CUI \(order between them is alphabetical\); 9 points below Lidocaine 5% patch, mainly higher cognitive and sedation burden\.$/);
  const a={id:'a',name:'A',cui:80,analgesia:8,abuse:2,cognitive:2,sedation:2},b={id:'b',name:'B',cui:60,analgesia:6,abuse:2,cognitive:2,sedation:2},even={analgesia:25,abuse:25,cognitive:25,sedation:25};
  assert.equal(pstRankLead(a,[a,b],even),'Listed first at 80 CUI; 20 points above B, mainly more pain relief.');
  assert.equal(pstRankLead(b,[a,b],even),'20 points below A, mainly less pain relief.');
  assert.equal(pstRankLead(a,[a],even),'The only option that matches the current filters, at 80 CUI.');
  for(const r of ranked)assert.doesNotMatch(pstRankLead(r,ranked,weights),banned,r.name);
});

test('the starting priorities are a keyword preset on the record, never Digital Twin output',()=>{
  const emma=byId('TN-DEMO-01'),preset=pstPriorityPreset(emma);
  assert.deepEqual(preset.weights,defaultPstPriorities(emma));
  assert.equal(pstStartingPrioritiesNote(emma,preset.weights),'Starting priorities: keyword preset from the record (grogginess or sedation wording matched), not Digital Twin output. Changed by you: no.');
  assert.match(pstStartingPrioritiesNote(emma,{...preset.weights,analgesia:60}),/Changed by you: yes\.$/);
  const plain={...emma,clinicalContext:{...emma.clinicalContext,psychologicalContext:'',medicalHistory:''},medications:[]};
  assert.match(pstStartingPrioritiesNote(plain,defaultPstPriorities(plain)),/\(no keyword matched, neutral preset\)/);
  const diabetic={...plain,clinicalContext:{...plain.clinicalContext,medicalHistory:'Type 2 diabetes'}};
  assert.equal(pstPriorityPreset(diabetic).rule,'diabetes wording matched');
  const twinOnly={...emma,pain:[9,9,9],function:[1,1,1],sleep:[1,1,1]};
  assert.deepEqual(pstPriorityPreset(twinOnly).weights,preset.weights,'Twin scores do not move the preset');
});

test('the charted comparison note carries label status, weights, filters and the clinician’s exclusions with reasons',()=>{
  const emma=byId('TN-DEMO-01'),preset=defaultPstPriorities(emma),ranking=rankPst(emma,preset);
  const duloxetine=ranking.ranked.find(r=>r.id==='duloxetine');
  assert.equal(pstDecisionNote({option:undefined,weights:preset,preset,kind:'all',onLabel:false,excluded:[]}),'','A Shadow-only option adds no PST comparison lines');
  const plain=pstDecisionNote({option:duloxetine,weights:preset,preset,kind:'all',onLabel:false,excluded:[]});
  assert.equal(plain,[
    'Label status of chosen option: Off-label (example, verify against current FDA labeling).',
    `Comparison weights: analgesia ${preset.analgesia}, abuse ${preset.abuse}, cognitive ${preset.cognitive}, sedation ${preset.sedation}.`,
    'Comparison filters: all; on-label only no; manually excluded none.',
  ].join('\n'));
  const combination=ranking.ranked.find(r=>r.id==='pgb-dlx');
  const note=pstDecisionNote({option:combination,weights:{...preset,analgesia:60},preset,kind:'combination',onLabel:false,query:' pregab ',focus:'Pregabalin',excluded:[{name:'Venlafaxine',flagged:false},{name:'Lidocaine 5% patch',flagged:true,reason:'Irritation on the earlier trial.'},{name:'Capsaicin 8% patch',flagged:true,reason:'  '}]});
  assert.match(note,/^Label status of chosen option: Combination \(not a labeled regimen; Pregabalin: On-label, Duloxetine: Off-label\)/);
  assert.match(note,/Comparison weights \(changed from the starting priorities\): analgesia 60,/);
  assert.match(note,/Comparison filters: combination; on-label only no; search “pregab”; focus drug Pregabalin; manually excluded Venlafaxine\./);
  assert.match(note,/Excluded by the clinician after reviewing recorded history: Lidocaine 5% patch \(reason: Irritation on the earlier trial\); Capsaicin 8% patch \(no reason given\)\.$/);
  assert.doesNotMatch(note,banned);
});

test('labeled indications keep the scope the example label map adds',()=>{
  const p=byId('TN-DEMO-01'),all=rankPst(p,defaultPstPriorities(p)).all,row=id=>all.find(r=>r.id===id);
  assert.deepEqual(pstLabeledIndicationNames(row('capsaicin')),['postherpetic neuralgia (PHN)','painful diabetic peripheral neuropathy (DPN) of the feet']);
  assert.deepEqual(pstLabeledIndicationNames(row('venlafaxine')),[]);
  assert.deepEqual(pstLabeledIndicationNames(row('pgb-dlx')),[],'A combination has no labeled indication of its own');
});
