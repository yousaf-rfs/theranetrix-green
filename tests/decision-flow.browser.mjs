import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {startDemoPreview} from '../scripts/preview-demo.mjs';

// The treatment decision bar must work when the saved engine snapshot is out of date,
// which is the normal state once a patient reports anything new.
const output=resolve(process.env.THERANETRIX_SCREENSHOT_DIR??resolve(tmpdir(),'theranetrix-decision-flow'));
await mkdir(output,{recursive:true});
const preview=await startDemoPreview({logPath:resolve(output,'app.log')});
let browser;
const waitForApp=()=>new Promise((ready,reject)=>{const deadline=Date.now()+120000;const attempt=()=>{const req=http.get('http://127.0.0.1:3000/',res=>{res.resume();if(res.statusCode===200)ready();else if(Date.now()>deadline)reject(new Error('App returned '+res.statusCode));else setTimeout(attempt,500);});req.on('error',error=>Date.now()>deadline?reject(error):setTimeout(attempt,500));};attempt();});
const workspace=async()=>(await fetch(preview.url+'/api/workspace')).json();
const act=async action=>{const current=await workspace();const response=await fetch(preview.url+'/api/workspace',{method:'POST',headers:{'content-type':'application/json',origin:preview.url},body:JSON.stringify({version:current.version,action})});assert.ok(response.ok,await response.text());};
try{
  await waitForApp();
  await act({type:'checkin.add',patientId:'TN-DEMO-01',pain:5,sleep:5,function:5,note:'Decision flow check'});
  const before=(await workspace()).data;
  const runsBefore=before.engineRuns.filter(r=>r.patientId==='TN-DEMO-01').length,decisionsBefore=(before.engineDecisions??[]).filter(d=>d.patientId==='TN-DEMO-01').length;
  browser=await chromium.launch({headless:true,...(process.env.THERANETRIX_CHROMIUM_PATH?{executablePath:process.env.THERANETRIX_CHROMIUM_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(preview.url+'/patients/TN-DEMO-01?tab=treatment',{waitUntil:'load',timeout:120000});
  await page.locator('.pst-table').waitFor({timeout:90000});
  const bar=page.locator('.treatment-decision');
  assert.match(await bar.innerText(),/No option picked yet/);
  assert.match(await bar.innerText(),/saves a fresh engine snapshot/,'An out-of-date snapshot is explained, not a dead end');
  await page.getByRole('radio',{name:'Review Duloxetine',exact:true}).check();
  await page.getByRole('button',{name:'Modify',exact:true}).click();
  await bar.getByLabel('Reason (optional)').fill('Grogginess on gabapentin limits desk work.');
  const next=bar.getByRole('button',{name:'Continue to patient plan'});
  assert.ok(await next.isEnabled(),'Continue must be available with an out-of-date snapshot');
  await next.click();
  const dialog=page.getByRole('dialog',{name:/Record the clinician/});await dialog.waitFor({timeout:30000});
  assert.match(await dialog.innerText(),/Duloxetine/);
  assert.match(await dialog.innerText(),/Selected option · Modified/,'The dialog shows the action that will be stored');
  assert.equal((await workspace()).data.engineRuns.filter(r=>r.patientId==='TN-DEMO-01').length,runsBefore+1,'Continuing saves exactly one fresh snapshot');
  await dialog.getByLabel('Agreed next steps for the patient').fill('We will discuss switching to duloxetine at your visit.');
  await dialog.getByLabel(/Review date/).fill(new Date(Date.now()+7*864e5).toISOString().slice(0,10));
  await dialog.getByLabel(/I reviewed the selected option/).check();
  await dialog.getByRole('button',{name:/Save decision/}).click();
  await dialog.waitFor({state:'hidden',timeout:30000});
  await page.locator('.treatment-decision-saved').waitFor({timeout:10000});
  assert.match(await bar.innerText(),/Decision saved: Modified: Duloxetine/);
  assert.match(await bar.innerText(),/No option picked yet/,'The bar resets after saving');
  const after=(await workspace()).data,emma=after.patients.find(p=>p.id==='TN-DEMO-01');
  assert.equal(after.engineDecisions.filter(d=>d.patientId==='TN-DEMO-01').length,decisionsBefore+1);
  assert.equal(emma.carePlans[0].text,'We will discuss switching to duloxetine at your visit.');
  const saved=after.engineDecisions.find(d=>d.patientId==='TN-DEMO-01');
  assert.equal(saved.action,'modify');assert.equal(saved.optionId,'duloxetine');assert.equal(saved.optionName,'Duloxetine');assert.match(saved.labelStatus,/\(prototype, clinician to verify\)$/);
  assert.ok(Array.isArray(saved.priorTrials)&&Array.isArray(saved.clinicianExclusions),'History and exclusions are stored as fields');
  assert.equal(emma.notes[0].text.split('\n')[0],'Clinician decision: Modified Duloxetine');assert.match(emma.notes[0].text,/No prescription issued/);
  await page.screenshot({path:resolve(output,'decision-saved.png')});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,output}));
}catch(error){console.error(error.stack??error);process.exitCode=1;}
finally{if(browser)await browser.close();await preview.close();}
