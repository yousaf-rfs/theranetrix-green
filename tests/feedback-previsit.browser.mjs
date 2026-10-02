import assert from 'node:assert/strict';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// Isolated component interaction checks. Persistence and clinical commands are
// covered separately; these checks exercise failure recovery and draft behavior.
const bundle=await build({stdin:{contents:`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {seedWorkspace} from './lib/theranetrix';
import {PatientCheckin} from './components/theranetrix/patient-checkin';
import {CompanionMeds} from './components/theranetrix/companion-meds';
import {MedicationPanel} from './components/theranetrix/medications';
const data=seedWorkspace(),p=data.patients.find(p=>p.id==='TN-DEMO-01');
window.calls=[];window.succeed=false;
const ctx={data,busy:false,save:async action=>{window.calls.push(action);return window.succeed;}};
const mode=new URLSearchParams(location.search).get('mode');
const view=mode==='dose'?<CompanionMeds p={p} ctx={ctx}/>:mode==='review'?<MedicationPanel p={p} ctx={ctx} inline/>:<PatientCheckin p={p} ctx={ctx} mode="previsit"/>;
createRoot(document.getElementById('app')).render(view);
`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,define:{'process.env.NODE_ENV':'"production"'}});
const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<html><head><meta name="viewport" content="width=device-width"/></head><body><div id="app"></div><script>'+bundle.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.THERANETRIX_CHROMIUM_PATH?{executablePath:process.env.THERANETRIX_CHROMIUM_PATH}:{}),args:JSON.parse(process.env.THERANETRIX_BROWSER_ARGS??'[]'),env:{...process.env,FONTCONFIG_PATH:process.env.FONTCONFIG_PATH??'/etc/fonts'}});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const url='http://127.0.0.1:'+server.address().port;
  await page.goto(url);
  const tried=page.getByRole('group',{name:'Have you tried other medicines for this pain?'});
  await tried.getByRole('button',{name:'Yes',exact:true}).click();
  await page.getByRole('group',{name:'Tap the ones you tried'}).getByRole('button',{name:/^Topical lidocaine/}).click();
  await page.getByRole('group',{name:'Did it help? Topical lidocaine'}).getByRole('button',{name:'Did not help'}).click();
  await page.getByRole('group',{name:'Any side effects? Topical lidocaine'}).getByRole('button',{name:'Skin irritation'}).click();
  await page.getByRole('textbox',{name:'Why did you stop?'}).fill('Stopped because it burned');
  await page.getByPlaceholder('Not in the list? Type the name').fill('Cyclobenzaprine');await page.getByPlaceholder('Not in the list? Type the name').press('Enter');
  await page.getByLabel('Medication name',{exact:true}).fill('Gabapentin');
  await page.getByRole('button',{name:'Save my check-in',exact:true}).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Why did you stop?'}).first().inputValue(),'Stopped because it burned','A failed save keeps the answers');
  assert.equal(await page.getByLabel('Medication name',{exact:true}).inputValue(),'Gabapentin');
  await page.evaluate(()=>window.succeed=true);
  await page.getByRole('button',{name:'Save my check-in',exact:true}).click();
  await page.getByRole('heading',{name:'Your check-in is saved',exact:true}).waitFor();
  let calls=await page.evaluate(()=>window.calls);
  assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1],'Unchanged retry keeps its request ID and submission');
  assert.equal(calls[1].command.submissionSource,'patient-self-report');
  assert.match(calls[1].command.patientNote,/Tried before \(patient-reported\): Topical lidocaine · Helped: Did not help · Side effects: Skin irritation · Why stopped: Stopped because it burned/);
  assert.match(calls[1].command.patientNote,/Tried before \(patient-reported\): Cyclobenzaprine/);
  assert.match(calls[1].command.patientNote,/Taking now, not on record \(patient-reported\): Gabapentin/,'A typed name is reported without an extra Add step');
  assert.ok(calls.every(call=>call.type==='workflow.apply'),'Medication report must not update the regimen automatically');
  console.log('PASS previsit medicine questions, typed names, failed-save draft retention, stable retry and patient-report provenance');

  await page.goto(url+'?mode=review');
  await page.getByRole('button',{name:'Review / edit',exact:true}).first().click();
  await page.getByRole('textbox',{name:'Reason for use'}).fill('Recorded reason updated by clinician');
  await page.getByRole('button',{name:'Save review',exact:true}).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Reason for use'}).inputValue(),'Recorded reason updated by clinician');
  await page.evaluate(()=>window.succeed=true);
  await page.getByRole('button',{name:'Save review',exact:true}).click();
  await page.getByRole('button',{name:'Add medication record'}).waitFor();
  calls=await page.evaluate(()=>window.calls);
  assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
  await page.getByRole('button',{name:'Add medication record'}).click();
  assert.equal(await page.getByRole('textbox',{name:'Reason for use'}).inputValue(),'','New drug must not inherit the patient pain indication');
  console.log('PASS clinician medication failed-save recovery and unassigned indication for new drugs');

  await page.goto(url+'?mode=dose');
  const effects=page.getByRole('textbox',{name:'Any side effects with this dose?'}).first();
  await effects.fill('Lightheaded after this dose');
  await page.getByRole('button',{name:'Taken',exact:true}).first().click();
  await page.getByRole('alert').waitFor();
  assert.equal(await effects.inputValue(),'Lightheaded after this dose');
  await page.evaluate(()=>window.succeed=true);
  await page.getByRole('button',{name:'Taken',exact:true}).first().click();
  await page.getByRole('status').waitFor();
  assert.equal(await effects.inputValue(),'');
  calls=await page.evaluate(()=>window.calls);
  assert.equal(calls.length,2);assert.equal(calls[1].effects,'Lightheaded after this dose');
  assert.deepEqual(errors,[]);
  console.log('PASS dose side-effect failed-save recovery and confirmation');
}finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
