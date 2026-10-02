import assert from 'node:assert/strict';
import test from 'node:test';
import {readdirSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {build} from 'esbuild';
import {ADVISOR_NAME,ADVISOR_SENDER,ADVISOR_HANDOFF_SOURCE,ADVISOR_SUMMARY_LABEL,ADVISOR_EXCHANGE_LABEL,ADVISOR_INTEGRATION_NAME,LEGACY_ADVISOR_NAME} from './fixtures/product-names.mjs';
const compiled=await build({stdin:{contents:"export {seedWorkspace,featureDefinitions} from './lib/theranetrix';export {applyAction,actionSchema} from './lib/actions';export {patientSnapshot} from './lib/patient-overview';export {reviewSectionLabels} from './lib/dashboard-layout';export {screenLabels} from './lib/journey-navigation';export {relabelLegacyRecords} from './lib/relabel';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {seedWorkspace,featureDefinitions,applyAction,actionSchema,patientSnapshot,reviewSectionLabels,screenLabels,relabelLegacyRecords}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

// The placeholder name, spelled out. The route slug (/robo-advisor) and the RoboAdvisor
// component identifier are not the displayed name, so they do not match.
const spelledOut=/robo\s+advisor/i;
const files=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(dir,entry.name)):[join(dir,entry.name)]);

test('the advisor name is spelled out only in lib/product-names.ts',()=>{
  assert.ok(spelledOut.test('Ask Robo Advisor about Emma'));assert.ok(!spelledOut.test("'/robo-advisor'"));assert.ok(!spelledOut.test('export function RoboAdvisor('));
  const offenders=['components','lib'].flatMap(dir=>files(dir)).filter(file=>relative(process.cwd(),file)!==join('lib','product-names.ts'))
    .flatMap(file=>readFileSync(file,'utf8').split('\n').flatMap((line,index)=>spelledOut.test(line)?[`${relative(process.cwd(),file)}:${index+1}`]:[]));
  assert.deepEqual(offenders,[],'Use ADVISOR_NAME or a derived constant from lib/product-names.ts instead of the literal name');
});

test('saved-record keys derive from the name, and the legacy name stays fixed',()=>{
  assert.equal(ADVISOR_SENDER,ADVISOR_NAME);
  assert.equal(ADVISOR_HANDOFF_SOURCE,ADVISOR_NAME+' handoff');assert.equal(ADVISOR_SUMMARY_LABEL,ADVISOR_NAME+' summary');assert.equal(ADVISOR_EXCHANGE_LABEL,ADVISOR_NAME+' exchange');
  assert.ok(ADVISOR_INTEGRATION_NAME.endsWith(ADVISOR_NAME));
  assert.equal(LEGACY_ADVISOR_NAME,'Robo Advisor');
});

test('settings, navigation, review sections and seeded handoffs read the configured name',()=>{
  assert.equal(featureDefinitions.find(f=>f.id==='advisor').name,ADVISOR_NAME);
  assert.equal(screenLabels.advisor,ADVISOR_NAME);assert.ok(reviewSectionLabels.advisor.startsWith(ADVISOR_NAME));
  const w=seedWorkspace(),elena=w.patients.find(p=>p.id==='TN-1051');
  assert.ok(patientSnapshot(elena,w).handoffs.some(r=>r.source===ADVISOR_HANDOFF_SOURCE),'the seeded handoff is found by its source key');
});

test('a patient advisor exchange saves the sender and audit label from the constants',()=>{
  const w=seedWorkspace(),p=w.patients[0];
  const next=applyAction(w,actionSchema.parse({type:'advisor.chat',patientId:p.id,intent:'progress',text:'I walked a little further this week.'}),'Clinical reviewer','2026-09-08T14:00:00Z');
  assert.equal(next.messages.filter(m=>m.patientId===p.id).at(-1).sender,ADVISOR_SENDER);
  assert.ok(next.audit[0].action.startsWith(ADVISOR_EXCHANGE_LABEL));
});

test('legacy advisor wording is normalized to the legacy name, never rewritten to a new one',()=>{
  const w=seedWorkspace(),p=w.patients[0];
  w.messages.push({id:'legacy',patientId:p.id,date:'2026-09-01T10:00:00Z',text:'Old reply',sender:LEGACY_ADVISOR_NAME+' · scripted demo',direction:'out'});
  w.audit.unshift({id:'legacy-audit',date:'2026-09-01T10:00:00Z',action:LEGACY_ADVISOR_NAME+' demo exchange',patientId:p.id});
  const out=relabelLegacyRecords(w);
  assert.equal(out.messages.find(m=>m.id==='legacy').sender,LEGACY_ADVISOR_NAME);
  assert.equal(out.audit.find(a=>a.id==='legacy-audit').action,LEGACY_ADVISOR_NAME+' exchange');
});
