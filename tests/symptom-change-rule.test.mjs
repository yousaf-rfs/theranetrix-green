import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// The rule-based symptom-change review flag (feedback F38): off unless thresholds are set,
// fires once per new or corrected patient check-in, and only lists what it matched.
const css={name:'css-for-ssr',setup(builder){builder.onLoad({filter:/\.css$/},()=>({contents:'export default {}',loader:'js'}));}};
const bundle=await build({stdin:{contents:"export {seedWorkspace} from './lib/theranetrix';export {applyAction,actionSchema} from './lib/actions';export * from './lib/symptom-change-rule';export {BodyMap} from './components/theranetrix/body-map';export {ConfigurationSettings} from './components/theranetrix/configuration-settings';export {ReviewQueue} from './components/theranetrix/workflows';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false,plugins:[css]});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {seedWorkspace,applyAction,actionSchema,SYMPTOM_CHANGE_SOURCE,DEMO_RULE_BASIS,CLINICIAN_RULE_BASIS,evaluateSymptomChange,checkinLocation,bodyMapLocations,ruleIsOn,ruleFormKey,thresholdSummary,BodyMap,ConfigurationSettings,ReviewQueue}=mod.exports;
const patientId='TN-1042',actor='Patient companion';
const flags=(w,id=patientId)=>w.reviews.filter(review=>review.patientId===id&&review.source===SYMPTOM_CHANGE_SOURCE);
const act=(w,action,at='2026-09-24T18:00:00.000Z',by='Dr. Maya Chen')=>applyAction(w,actionSchema.parse(action),by,at);
const encounters=(w,command,at)=>act(w,{type:'workflow.apply',domain:'encounters',patientId:command.patientId,requestId:command.requestId,expectedSliceVersion:w.clinicalWorkflows.slices.encounters.version,command},at,actor);
function checkin(w,{pain,location,at,id=crypto.randomUUID(),patient=patientId,extra={}}){
  const entries=['pain','function','sleep'].map(metric=>metric==='pain'&&pain!==undefined?{metric,status:pain===0?'zero':'answered',value:pain,source:'Patient self-report',recordedAt:at}:{metric,status:'unanswered',source:'Patient self-report',recordedAt:at});
  return encounters(w,{type:'encounters.observations.save',requestId:id,patientId:patient,encounterId:'checkin-'+id,instrument:'local-0-10',submissionStatus:'confirmed',submissionSource:'patient-self-report',patientNote:location?`Location: ${location}`:'',entries,...extra},at);
}
const record=(w,id)=>w.clinicalWorkflows.slices.encounters.state.observations.find(item=>item.encounterId==='checkin-'+id);

test('a patient check-in that meets the demo thresholds creates one High-priority rule-based review with previous and current values',()=>{
  let w=seedWorkspace();
  assert.equal(w.symptomChangeRule.basis,DEMO_RULE_BASIS,'The demo workspace labels its example thresholds');
  w=checkin(w,{pain:4,location:'Right foot',at:'2026-09-20T15:00:00.000Z'});
  assert.equal(flags(w).length,0,'6 → 4 with no earlier body-map location meets nothing');
  w=checkin(w,{pain:9,location:'Left foot',at:'2026-09-24T15:00:00.000Z'});
  const [review]=flags(w);
  assert.equal(flags(w).length,1);
  assert.equal(review.title,'Reported symptom change (rule-based review flag): Pain 4 → 9/10 · new location: left foot');
  assert.equal(review.priority,'High');assert.equal(review.status,'Open');assert.equal(review.owner,w.patients.find(p=>p.id===patientId).clinician);
  for(const text of ['pain rose 5 points since the previous check-in (threshold: a rise of 3 or more)','pain reached 9/10 from 4/10 (threshold: reaching 8/10 or higher)','Previous: pain 4/10 on Sep 20, 2026 (patient check-in)','body-map locations reported before: Right foot','This check-in: pain 9/10 · location: Left foot on Sep 24, 2026','Demo setting, not a validated threshold; set by Demo workspace','This is a prompt for clinician review, not an assessment of the patient.'])assert.ok(review.detail.includes(text),text);
  assert.doesNotMatch(review.title+review.detail,/confiden|interaction|contraindicat|clinically significant|deteriorat|recommend/i);
  assert.equal(w.patients.find(p=>p.id===patientId).status,'Needs review');
});

test('a one-point rise at the same location does not create a review',()=>{
  let w=checkin(seedWorkspace(),{pain:5,location:'Right foot',at:'2026-09-20T15:00:00.000Z'});
  w=checkin(w,{pain:6,location:'Right foot',at:'2026-09-24T15:00:00.000Z'});
  assert.equal(flags(w).length,0);
  // The first check-in is compared with the stored record (6/10 on Sep 8): a fall is never flagged.
  assert.equal(evaluateSymptomChange(w.symptomChangeRule,[{date:'2026-09-08',pain:6,location:null,source:'recorded check-in'}],{date:'2026-09-20T15:00:00.000Z',pain:7,location:null,source:'patient check-in'}),null);
});

test('the rule is off when no thresholds are set, including after a clinician clears them',()=>{
  let w=seedWorkspace();delete w.symptomChangeRule;
  w=checkin(w,{pain:4,location:'Right foot',at:'2026-09-20T15:00:00.000Z'});w=checkin(w,{pain:10,location:'Left foot',at:'2026-09-24T15:00:00.000Z'});
  assert.equal(flags(w).length,0,'Unset means off');
  w=act(seedWorkspace(),{type:'symptom-rule.save',thresholds:{painRise:null,painAtLeast:null,newLocation:false},clinician:'Dr. Maya Chen, pain physician'});
  assert.equal(ruleIsOn(w.symptomChangeRule),false);assert.equal(w.audit[0].action,'Turned off symptom-change review rule');
  w=checkin(w,{pain:10,location:'Left foot',at:'2026-09-24T15:00:00.000Z'});
  assert.equal(flags(w).length,0,'Cleared thresholds mean off');
});

test('a new body-map location is detected only against earlier structured locations',()=>{
  let w=act(seedWorkspace(),{type:'symptom-rule.save',thresholds:{painRise:null,painAtLeast:null,newLocation:true},clinician:'Dr. Maya Chen, pain physician'});
  w=checkin(w,{pain:4,location:'Both feet, worse at night',at:'2026-09-19T15:00:00.000Z'});
  w=checkin(w,{pain:4,location:'Right foot',at:'2026-09-20T15:00:00.000Z'});
  assert.equal(flags(w).length,0,'Free-text chart wording is not a location, so the first body-map answer has nothing to compare with');
  w=checkin(w,{pain:4,location:'Left foot',at:'2026-09-22T15:00:00.000Z'});
  assert.deepEqual(flags(w).map(review=>review.title),['Reported symptom change (rule-based review flag): Pain 4 → 4/10 · new location: left foot']);
  assert.match(flags(w)[0].detail,/Set by a clinician in workspace settings; set by Dr\. Maya Chen, pain physician on Sep 24, 2026/);
  w=checkin(w,{pain:4,location:'Right foot',at:'2026-09-23T15:00:00.000Z'});
  assert.equal(flags(w).length,1,'A location reported before is not new');
  assert.equal(checkinLocation('Location: Left foot\nMood 5/10'),'Left foot');assert.equal(checkinLocation('Location: left foot'),null);assert.equal(checkinLocation('My left foot hurts'),null);
});

test('every body-map region is readable by the rule',()=>{
  const html=renderToStaticMarkup(React.createElement(BodyMap,{value:'',onChange:()=>{}}));
  const labels=[...html.matchAll(/<button type="button"[^>]*>([^<]+)<\/button>/g)].map(match=>match[1]);
  assert.equal(labels.length,bodyMapLocations.length);
  for(const label of labels)assert.equal(checkinLocation('Location: '+label),label,label);
});

test('replays and later threshold changes do not re-flag earlier check-ins; withdrawn check-ins are not "previous"',()=>{
  let w=checkin(seedWorkspace(),{pain:4,location:'Right foot',at:'2026-09-20T15:00:00.000Z',id:'first'});
  w=act(w,{type:'symptom-rule.save',thresholds:{painRise:1,painAtLeast:4,newLocation:true},clinician:'Dr. Maya Chen'},'2026-09-21T09:00:00.000Z');
  w=checkin(w,{pain:3,patient:'TN-1038',at:'2026-09-21T10:00:00.000Z'});
  assert.equal(flags(w).length,0,'An earlier check-in is not re-checked when another check-in is saved or thresholds change');
  const first=record(w,'first');
  w=encounters(w,{type:'encounters.observations.withdraw',requestId:'withdraw-first',patientId,encounterId:first.encounterId,id:first.id,expectedVersion:first.version,reason:'Entered for the wrong day.'},'2026-09-22T09:00:00.000Z');
  w=act(w,{type:'symptom-rule.save',thresholds:{painRise:null,painAtLeast:null,newLocation:true},clinician:'Dr. Maya Chen'},'2026-09-22T09:30:00.000Z');
  w=checkin(w,{pain:7,location:'Left foot',at:'2026-09-24T15:00:00.000Z'});
  assert.equal(flags(w).length,0,'The withdrawn Right foot report is not an earlier location');
  const before=structuredClone(w.reviews);
  w=checkin(w,{pain:2,patient:'TN-1038',at:'2026-09-24T16:00:00.000Z'});
  assert.deepEqual(w.reviews.filter(review=>review.patientId===patientId),before.filter(review=>review.patientId===patientId));
});

test('a patient correction re-checks the rule and annotates the flag instead of removing it',()=>{
  let w=checkin(seedWorkspace(),{pain:4,location:'Right foot',at:'2026-09-20T15:00:00.000Z'});
  w=checkin(w,{pain:9,location:'Right foot',at:'2026-09-24T15:00:00.000Z',id:'today'});
  assert.equal(flags(w).length,1);
  const saved=record(w,'today');
  w=checkin(w,{pain:5,location:'Right foot',at:'2026-09-24T16:00:00.000Z',id:'today-fix',extra:{encounterId:saved.encounterId,expectedVersion:saved.version,correctionReason:'Patient updated today’s check-in answers in the companion.'}});
  const [review]=flags(w);
  assert.equal(flags(w).length,1);assert.equal(review.status,'Open');assert.equal(review.workflowVersion,2);
  assert.match(review.detail,/no longer meet the set thresholds; this flag stays for clinician review/);
  assert.match(review.history[0].resolution,/Earlier title: Reported symptom change \(rule-based review flag\): Pain 4 → 9\/10/);
});

test('clinicians set thresholds in Settings; the save keeps who set them and the earlier setting',()=>{
  let w=act(seedWorkspace(),{type:'symptom-rule.save',thresholds:{painRise:4,painAtLeast:null,newLocation:false},clinician:'  Dr. Maya Chen, pain physician '});
  assert.deepEqual({...w.symptomChangeRule,history:undefined},{painRise:4,painAtLeast:null,newLocation:false,setBy:'Dr. Maya Chen, pain physician',recordedBy:'Dr. Maya Chen',setAt:'2026-09-24T18:00:00.000Z',basis:CLINICIAN_RULE_BASIS,history:undefined});
  assert.equal(w.symptomChangeRule.history[0].basis,DEMO_RULE_BASIS);
  assert.match(w.audit[0].action,/^Set symptom-change review rule: pain rise of 4 or more points/);
  for(const bad of [{painRise:0,painAtLeast:null,newLocation:false},{painRise:null,painAtLeast:11,newLocation:false},{painRise:2.5,painAtLeast:null,newLocation:false}])assert.throws(()=>actionSchema.parse({type:'symptom-rule.save',thresholds:bad,clinician:'Dr. Maya Chen'}));
  assert.throws(()=>actionSchema.parse({type:'symptom-rule.save',thresholds:{painRise:3,painAtLeast:null,newLocation:false},clinician:' '}));
  const html=renderToStaticMarkup(React.createElement(ConfigurationSettings,{ctx:{data:seedWorkspace(),busy:false,save:async()=>true,user:'Dr. Maya Chen'}}));
  for(const text of ['Reported symptom change: rule-based review flag','Demo setting, not a validated threshold','Pain rise since the previous check-in','Pain reaches this score or higher from a lower previous score','later check-ins that meet a threshold update it','Flag a body-map location not reported in earlier check-ins','Clinician setting these thresholds','TheraNetrix does not supply or validate these thresholds','not an assessment'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html.match(/id="review-rule"[\s\S]*?<\/form>/)[0],/confiden|recommend|clinically significant|deteriorat/i);
});

// Review fixes: the pain level is a crossing, repeated matches update the open flag, and corrections are attributed.
const clinician=(w,command,at)=>act(w,{type:'workflow.apply',domain:'encounters',patientId:command.patientId,requestId:command.requestId,expectedSliceVersion:w.clinicalWorkflows.slices.encounters.version,command},at,'Dr. Maya Chen');
function correct(w,id,metric,value,at,reason='Entry error confirmed with patient by phone.'){
  const saved=record(w,id);
  return clinician(w,{type:'encounters.observations.correct',requestId:'fix-'+id+'-'+metric+'-'+at,patientId:saved.patientId,encounterId:saved.encounterId,expectedVersion:saved.version,reason,replacement:{metric,status:'answered',value,source:'Patient self-report',recordedAt:at}},at);
}
const resolve=(w,review)=>act(w,{type:'review.update',id:review.id,status:'Resolved',resolution:'Reviewed with the patient.'},'2026-09-24T19:00:00.000Z');

test('pain that stays at or above the level does not raise a new High review at every daily check-in',()=>{
  let w=seedWorkspace();
  // Robert Chen's recorded pain is already 8/10, so a first check-in at 8/10 has not reached the level.
  w=checkin(w,{pain:8,patient:'TN-1047',at:'2026-09-21T15:00:00.000Z'});
  assert.equal(flags(w,'TN-1047').length,0,'8/10 after 8/10 is not a crossing');
  for(const [day,id] of [['21','d1'],['22','d2'],['23','d3']])w=checkin(w,{pain:8,at:`2026-09-${day}T15:00:00.000Z`,id});
  assert.equal(flags(w).length,1,'three daily check-ins at 8/10 raise one flag');
  assert.equal(flags(w)[0].title,'Reported symptom change (rule-based review flag): Pain 6 → 8/10','the flag shows the check-in that reached the level');
  assert.match(flags(w)[0].detail,/pain reached 8\/10 from 6\/10 \(threshold: reaching 8\/10 or higher\)/);
  assert.doesNotMatch(w.reviews.map(review=>review.title).join('\n'),/Pain 8 → 8\/10/);
  assert.ok(thresholdSummary(w.symptomChangeRule).includes('pain reaching 8/10 or higher from a previous score below 8/10'));
  // With no earlier score, a first report at the level matches.
  assert.match(evaluateSymptomChange(w.symptomChangeRule,[],{date:'2026-09-24',pain:9,location:null,source:'patient check-in'}).detail,/pain reported at 9\/10 with no earlier score/);
});

test('while a flag is open, a later check-in that meets the rule updates it; after it is resolved a new match raises a new flag',()=>{
  let w=checkin(seedWorkspace(),{pain:4,location:'Right foot',at:'2026-09-20T15:00:00.000Z'});
  w=checkin(w,{pain:9,location:'Right foot',at:'2026-09-21T15:00:00.000Z',id:'high'});
  w=checkin(w,{pain:9,location:'Left foot',at:'2026-09-22T15:00:00.000Z',id:'moved'});
  const [flag]=flags(w);
  assert.equal(flags(w).length,1,'one open flag per patient');
  // The flag shows the later check-in and keeps the unreviewed 5-point rise in its title and detail.
  assert.equal(flag.title,'Reported symptom change (rule-based review flag): Pain 9 → 9/10 · new location: left foot · earlier: Pain 4 → 9/10');
  assert.ok(flag.detail.includes('\nEarlier, not yet reviewed: pain 9/10 · location: Right foot on Sep 21, 2026 (patient check-in). Thresholds met: pain rose 5 points since the previous check-in (threshold: a rise of 3 or more); pain reached 9/10 from 4/10 (threshold: reaching 8/10 or higher).\nRule: '));
  assert.equal(flag.workflowRecordId,record(w,'moved').id);assert.equal(flag.status,'Open');
  assert.match(flag.history[0].resolution,/^A later check-in on Sep 22, 2026 met the set thresholds; this flag now shows it and keeps the earlier check-in in its detail\. Earlier title: .*Pain 4 → 9\/10$/);
  // A correction of the check-in the flag no longer shows does not take it back.
  w=checkin(w,{pain:10,location:'Right foot',at:'2026-09-22T16:00:00.000Z',id:'high-fix',extra:{encounterId:record(w,'high').encounterId,expectedVersion:record(w,'high').version,correctionReason:'Patient updated today’s check-in answers in the companion.'}});
  assert.equal(flags(w).length,1);assert.equal(flags(w)[0].title,flag.title);
  w=resolve(w,flags(w)[0]);
  w=checkin(w,{pain:9,location:'Left foot',at:'2026-09-23T15:00:00.000Z'});
  assert.equal(flags(w).length,1,'sustained pain at a known location stays quiet after the flag is resolved');
  w=checkin(w,{pain:3,location:'Left foot',at:'2026-09-24T09:00:00.000Z'});
  w=checkin(w,{pain:8,location:'Left foot',at:'2026-09-24T15:00:00.000Z'});
  assert.deepEqual(flags(w).map(review=>review.status),['Open','Resolved'],'a new crossing after the resolved flag raises a new one');
});

test('moving an open flag keeps every earlier trigger, and reopening an acknowledged flag is recorded',()=>{
  let w=checkin(seedWorkspace(),{pain:4,location:'Right foot',at:'2026-09-20T15:00:00.000Z'});
  w=checkin(w,{pain:9,location:'Right foot',at:'2026-09-21T15:00:00.000Z',id:'high'});
  w=act(w,{type:'review.update',id:flags(w)[0].id,status:'Acknowledged',resolution:'Called the patient; reviewing at the visit.'},'2026-09-21T18:00:00.000Z');
  w=checkin(w,{pain:9,location:'Left foot',at:'2026-09-22T15:00:00.000Z',id:'moved'});
  let [flag]=flags(w);
  assert.equal(flag.status,'Open','a new match is not hidden under an acknowledgement');
  assert.match(flag.history[0].resolution,/This flag was acknowledged; it is open again because this check-in has not been reviewed\./);
  assert.deepEqual(flag.history.slice(1).map(entry=>[entry.status,entry.actor]),[['Acknowledged','Dr. Maya Chen']],'the acknowledgement stays in the history');
  assert.match(flag.detail,/\nEarlier, acknowledged, not resolved: pain 9\/10 · location: Right foot on Sep 21, 2026 \(patient check-in\)\. Thresholds met: pain rose 5 points/);
  w=checkin(w,{pain:2,location:'Left foot',at:'2026-09-23T15:00:00.000Z'});
  w=checkin(w,{pain:8,location:'Neck',at:'2026-09-24T15:00:00.000Z',id:'third'});
  [flag]=flags(w);
  assert.equal(flags(w).length,1);
  assert.equal(flag.title,'Reported symptom change (rule-based review flag): Pain 2 → 8/10 · new location: neck · earlier: Pain 9 → 9/10, new location: left foot; Pain 4 → 9/10');
  const lines=flag.detail.split('\n');
  assert.deepEqual(lines.map(line=>line.split(':')[0]),['Thresholds met','Previous','This check-in','Earlier, not yet reviewed','Earlier, acknowledged, not resolved','Rule','This is a prompt for clinician review, not an assessment of the patient.']);
  assert.match(lines[3],/Left foot on Sep 22, 2026 .*body-map location "Left foot" was not reported/);
  // A patient update of the check-in the flag shows re-checks it and keeps the earlier triggers; a change the rule does not read adds nothing.
  const third=record(w,'third');
  w=checkin(w,{pain:10,location:'Neck',at:'2026-09-24T16:00:00.000Z',id:'third-fix',extra:{encounterId:third.encounterId,expectedVersion:third.version,correctionReason:'Patient updated today’s check-in answers in the companion.'}});
  [flag]=flags(w);
  assert.match(flag.title,/: Pain 2 → 10\/10 · new location: neck · earlier: Pain 9 → 9\/10, new location: left foot; Pain 4 → 9\/10$/);
  assert.deepEqual(flag.detail.split('\n').slice(3,5),lines.slice(3,5));
  const before=structuredClone(flag);
  w=correct(w,'third','sleep',5,'2026-09-24T19:30:00.000Z');
  assert.deepEqual({...flags(w)[0],workflowVersion:before.workflowVersion},before);
  // An earlier-dated check-in that meets the rule does not take the flag back, and is kept too.
  w=checkin(w,{pain:9,location:'Head',at:'2026-09-21T16:00:00.000Z'});
  [flag]=flags(w);
  assert.equal(flag.workflowRecordId,record(w,'third').id);
  assert.equal(flag.workflowVersion,record(w,'third').version,'the flag keeps the version of the check-in it shows');
  assert.match(flag.title,/; Pain 9 → 9\/10, new location: head$/);
  assert.match(flag.detail,/\nEarlier, not yet reviewed: pain 9\/10 · location: Head on Sep 21, 2026 .*\nRule: /);
  assert.match(flag.history[0].resolution,/^An earlier-dated check-in on Sep 21, 2026 met the set thresholds; it is kept in this flag's detail, which still shows the latest check-in\.$/);
});

test('a clinician correction never reopens a resolved flag and is attributed to the clinician with the reason',()=>{
  let w=checkin(seedWorkspace(),{pain:4,location:'Right foot',at:'2026-09-20T15:00:00.000Z'});
  w=checkin(w,{pain:9,location:'Right foot',at:'2026-09-24T15:00:00.000Z',id:'today'});
  w=resolve(w,flags(w)[0]);
  const resolved=structuredClone(flags(w)[0]);
  // A sleep typo fix changes nothing the rule reads.
  w=correct(w,'today','sleep',5,'2026-09-24T19:30:00.000Z');
  assert.equal(flags(w)[0].status,'Resolved');assert.deepEqual(flags(w)[0].history,resolved.history);assert.equal(flags(w)[0].title,resolved.title);
  // A pain correction that still meets the rule updates the flag but leaves it resolved.
  w=correct(w,'today','pain',10,'2026-09-24T19:40:00.000Z');
  let [flag]=flags(w);
  assert.equal(flag.status,'Resolved');assert.equal(flag.title,'Reported symptom change (rule-based review flag): Pain 4 → 10/10');
  assert.equal(flag.history[0].resolution,'This check-in was corrected by Dr. Maya Chen on Sep 24, 2026: Entry error confirmed with patient by phone. The rule was checked again. Earlier title: Reported symptom change (rule-based review flag): Pain 4 → 9/10');
  // A correction below the thresholds annotates the flag in the same words.
  w=correct(w,'today','pain',4,'2026-09-24T19:50:00.000Z','Typed 10 instead of 4');
  [flag]=flags(w);
  assert.equal(flag.status,'Resolved');
  assert.match(flag.detail,/\nThis check-in was corrected by Dr\. Maya Chen on Sep 24, 2026: Typed 10 instead of 4\. The new values no longer meet the set thresholds; this flag stays for clinician review\.$/);
  assert.doesNotMatch(flag.history.map(entry=>entry.resolution).join('\n')+flag.detail,/The patient updated/);
  w=correct(w,'today','sleep',6,'2026-09-24T19:55:00.000Z');
  assert.deepEqual(flags(w)[0].history,flag.history,'a further fix that changes nothing the rule matched adds nothing');
  // A clinician correction that newly meets the rule does not raise a flag of its own.
  let v=checkin(seedWorkspace(),{pain:4,location:'Right foot',at:'2026-09-20T15:00:00.000Z',id:'quiet'});
  v=correct(v,'quiet','pain',9,'2026-09-24T19:30:00.000Z');
  assert.equal(flags(v).length,0);
});

test('the patient’s own update of a resolved flag’s check-in reopens it when what the rule matched changes',()=>{
  let w=checkin(seedWorkspace(),{pain:4,location:'Right foot',at:'2026-09-20T15:00:00.000Z'});
  w=checkin(w,{pain:9,location:'Right foot',at:'2026-09-24T15:00:00.000Z',id:'today'});
  w=resolve(w,flags(w)[0]);
  const saved=record(w,'today');
  w=checkin(w,{pain:10,location:'Right foot',at:'2026-09-24T20:00:00.000Z',id:'today-again',extra:{encounterId:saved.encounterId,expectedVersion:saved.version,correctionReason:'Patient updated today’s check-in answers in the companion.'}});
  const [flag]=flags(w);
  assert.equal(flag.status,'Open');assert.match(flag.history[0].resolution,/^The patient updated this check-in in the companion on Sep 24, 2026\. The rule was checked again\./);
});

test('the rule keeps every earlier setting and the Settings form restarts from the saved rule after a save, undo or reset',()=>{
  let w=seedWorkspace();const seeded=ruleFormKey(w.symptomChangeRule);
  for(let index=0;index<25;index++)w=act(w,{type:'symptom-rule.save',thresholds:{painRise:1+index%9,painAtLeast:null,newLocation:false},clinician:'Dr. Maya Chen'},new Date(Date.UTC(2026,8,1,0,index)).toISOString());
  assert.equal(w.symptomChangeRule.history.length,25,'no cap on the rule history');
  assert.equal(w.symptomChangeRule.history.at(-1).basis,DEMO_RULE_BASIS,'the first (demo) setting is still there');
  assert.notEqual(ruleFormKey(w.symptomChangeRule),seeded,'a save gives the form a new identity');
  assert.equal(ruleFormKey(seedWorkspace().symptomChangeRule),seeded,'an undo or reset back to the seeded rule restores its identity');
  assert.equal(ruleFormKey(undefined),'off');
  const source=readFileSync('components/theranetrix/configuration-settings.tsx','utf8');
  assert.match(source,/<SymptomRuleSettings key=\{ruleFormKey\(ctx\.data\.symptomChangeRule\)\} ctx=\{ctx\}\/>/);
  const html=renderToStaticMarkup(React.createElement(ConfigurationSettings,{ctx:{data:w,busy:false,save:async()=>true,user:'Dr. Maya Chen'}}));
  assert.match(html,/Earlier settings \(25\)/);assert.match(html,/set by Dr\. Maya Chen \(name as entered\)/);
});

test('the Review queue shows a flag’s detail as separate lines',()=>{
  let w=checkin(seedWorkspace(),{pain:4,location:'Right foot',at:'2026-09-20T15:00:00.000Z'});
  w=checkin(w,{pain:9,location:'Left foot',at:'2026-09-24T15:00:00.000Z'});
  const html=renderToStaticMarkup(React.createElement(ReviewQueue,{ctx:{data:w,busy:false,save:async()=>true,open:()=>{},user:'Dr. Maya Chen'}}));
  const concern=[...html.matchAll(/<p class="review-visible-concern">([\s\S]*?)<\/p>/g)].map(match=>match[1]).find(text=>text.includes('Thresholds met:'));
  const lines=[...concern.matchAll(/<span class="block">([^<]*)<\/span>/g)].map(match=>match[1]);
  assert.equal(lines.length,flags(w)[0].detail.split('\n').length);
  assert.ok(lines[0].startsWith('Thresholds met:')&&lines[1].startsWith('Previous:')&&lines[2].startsWith('This check-in:')&&lines[3].startsWith('Rule:'));
});
