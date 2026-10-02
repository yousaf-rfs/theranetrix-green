import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:"export * from './lib/theranetrix';export * from './lib/pst-library';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {seedWorkspace,rankPst,defaultPstPriorities,pstScoreBreakdown,pstProfileRuleExplanation,shadowOpinion}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const patient=()=>structuredClone(seedWorkspace().patients.find(p=>p.id==='TN-DEMO-01'));
const withLocks=()=>{const p=patient();p.clinicalContext={...p.clinicalContext,allergyStatus:'Reactions reported',allergies:'Lidocaine: blistering at the patch site.',medicalHistory:(p.clinicalContext?.medicalHistory??'')+' History of depression.'};return p;};
const neutral=()=>{const p=patient();p.medications=[];p.clinicalContext={...p.clinicalContext,medicalHistory:'',psychologicalContext:''};return p;};

test('ranking explanations exactly reconcile weighted components and displayed CUI',()=>{
  const p=neutral(),weights={analgesia:50,abuse:10,cognitive:20,sedation:20};
  for(const row of rankPst(p,weights).ranked){
    const explanation=pstScoreBreakdown(row,weights);
    assert.equal(explanation.totalWeight,100);
    assert.equal(Math.round(explanation.components.reduce((sum,c)=>sum+c.points,0)),row.cui);
    assert.equal(row.cui,Math.round((row.analgesia*50+(10-row.abuse)*10+(10-row.cognitive)*20+(10-row.sedation)*20)/10));
  }
  const row=rankPst(p,weights).ranked[0];
  assert.equal(pstScoreBreakdown(row,{analgesia:100,abuse:0,cognitive:0,sedation:0}).cui,row.analgesia*10);
  assert.equal(pstScoreBreakdown(row,{analgesia:0,abuse:0,cognitive:0,sedation:0}).cui,0);
});

test('manual drug exclusions remove constituent combinations without overriding profile exclusions',()=>{
  const p=neutral(),weights=defaultPstPriorities(p),original=structuredClone(p);
  const before=rankPst(p,weights);
  assert.ok(before.ranked.some(r=>r.id==='gbp-lido'));
  const filtered=rankPst(p,weights,false,{excludedDrugIds:['gabapentin']});
  assert.ok(!filtered.ranked.some(r=>r.id==='gabapentin'||r.id==='gbp-lido'));
  assert.ok(filtered.ranked.some(r=>r.id==='lidocaine'));
  assert.ok(!rankPst(p,weights,false,{excludedDrugIds:[]}).ranked.some(r=>r.id==='amitriptyline'));
  assert.deepEqual(p,original);
});

test('existing exclusions for either constituent prevent the combination from being selected',()=>{
  const p=patient(),weights=defaultPstPriorities(p);
  assert.ok(!rankPst(p,weights).excluded.some(r=>r.id==='gbp-lido'),'Flags alone never lock a combination');
  const q=neutral();q.clinicalContext={...q.clinicalContext,allergyStatus:'Reactions reported',allergies:'Lidocaine: blistering at the patch site.'};
  const combination=rankPst(q,weights).all.find(r=>r.id==='gbp-lido');
  assert.match(combination.excluded,/Lidocaine/);
  assert.match(combination.excluded,/blistering at the patch site/);
  assert.equal(combination.cui,0);
  assert.ok(!rankPst(q,weights,false,{kind:'combination'}).ranked.some(r=>r.id==='gbp-lido'));
});

test('category and label controls preserve scores and expose every eligible library option',()=>{
  const p=neutral(),weights=defaultPstPriorities(p),all=rankPst(p,weights);
  assert.equal(all.ranked.length,all.all.filter(r=>!r.excluded).length,'No silent top-ten truncation');
  const single=rankPst(p,weights,false,{kind:'single'}),combination=rankPst(p,weights,false,{kind:'combination'});
  assert.ok(single.ranked.every(r=>r.kind==='drug'));
  assert.ok(combination.ranked.length>0&&combination.ranked.every(r=>r.kind==='combination'));
  for(const row of single.ranked)assert.equal(row.cui,all.ranked.find(r=>r.id===row.id).cui);
  assert.ok(rankPst(p,weights,true).all.every(r=>r.label==='On-label'));
});

test('avoid list prioritizes excluded and lowest-score options rather than the highest-score options',()=>{
  const p=withLocks(),ranking=rankPst(p,defaultPstPriorities(p));
  assert.ok(ranking.excluded.length>=3);
  assert.ok(ranking.avoided.every(row=>row.excluded));
  assert.ok(!ranking.avoided.some(row=>row.id===ranking.ranked[0].id));
  const q=neutral(),other=rankPst(q,defaultPstPriorities(q));
  assert.ok(other.avoided[0].excluded);
  const nonExcluded=other.avoided.filter(row=>!row.excluded);
  const ascending=other.ranked.slice().sort((a,b)=>a.cui-b.cui||a.name.localeCompare(b.name));
  assert.deepEqual(nonExcluded.map(row=>row.id),ascending.slice(0,nonExcluded.length).map(row=>row.id));
});


test('exclusion details disclose constant and coarse rules without inventing patient findings',()=>{
  const p=neutral(),weights=defaultPstPriorities(p);
  const always=rankPst(p,weights).excluded.find(row=>row.id==='amitriptyline');
  assert.match(pstProfileRuleExplanation(p,always).join(' '),/always excluded/);
  p.medications=[{...patient().medications[0],name:'Lidocaine',status:'Stopped',effects:'',benefit:'Not assessed',stopReason:'Could not afford refill'}];
  const ranking=rankPst(p,weights),lidocaine=ranking.ranked.find(row=>row.id==='lidocaine');
  assert.ok(lidocaine,'A stopped trial stays in the comparison for the clinician to weigh');
  assert.ok(!ranking.excluded.some(row=>row.id==='lidocaine'));
  const explanation=pstProfileRuleExplanation(p,lidocaine).join(' ');
  assert.match(explanation,/Could not afford refill/);
  assert.match(explanation,/History flag, not an exclusion/);
  assert.doesNotMatch(explanation+JSON.stringify(ranking.all),/irritation|little relief/,'No stop reason is invented');
  assert.equal(p.medications[0].stopReason,'Could not afford refill');
});

test('additional sleep option preserves missingness instead of rendering null as a score',()=>{
  const p=neutral();p.sleep=[];p.function=[];p.pain=[];p.dates=[];
  const result=shadowOpinion(p,seedWorkspace(),rankPst(p,defaultPstPriorities(p)).ranked);
  assert.equal(result.extra.find(row=>row.id==='sleep').data,'Sleep not recorded');
  assert.doesNotMatch(result.extra.find(row=>row.id==='pacing').reason,/Function is limited/);
});

test('the demo patient keeps eligible combinations when one combination is locked',()=>{
  const p=withLocks(),weights=defaultPstPriorities(p);
  const combinations=rankPst(p,weights,false,{kind:'combination'});
  assert.ok(combinations.ranked.length>0,'Combinations must not be empty for the demo patient');
  assert.ok(combinations.ranked.every(r=>r.componentIds.length>=2));
  const locked=rankPst(p,weights).excluded.filter(r=>r.kind==='combination');
  assert.ok(locked.length>0);
  for(const row of locked){
    assert.ok(!combinations.ranked.some(r=>r.id===row.id));
    assert.ok(pstProfileRuleExplanation(p,row).some(rule=>!/No exclusion rule is active/.test(rule)),'Locked combination must explain its constituent rule: '+row.id);
  }
});
