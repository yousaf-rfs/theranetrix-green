import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {startDemoPreview} from '../scripts/preview-demo.mjs';

const output=resolve(process.env.THERANETRIX_SCREENSHOT_DIR??resolve(tmpdir(),'theranetrix-redesign-review'));
await mkdir(output,{recursive:true});
const preview=await startDemoPreview({logPath:resolve(output,'app.log')});
let browser,page;
const report={mode:'Local synthetic records, real workspace route, isolated SQLite storage',pages:[],checks:[],errors:[]};

const waitForApp=()=>new Promise((resolveReady,reject)=>{
  const deadline=Date.now()+90000;
  const attempt=()=>{
    const req=http.get('http://127.0.0.1:3000/',res=>{res.resume();if(res.statusCode===200)resolveReady();else if(Date.now()>deadline)reject(new Error('App returned '+res.statusCode));else setTimeout(attempt,500);});
    req.on('error',error=>Date.now()>deadline?reject(error):setTimeout(attempt,500));req.setTimeout(60000,()=>req.destroy(new Error('App startup request timed out')));
  };attempt();
});

async function open(page,url,heading){
  await page.goto(preview.url+url,{waitUntil:'networkidle',timeout:90000});
  if(report.errors.length)throw new Error(report.errors.join('\n'));
  if(heading)await page.getByRole('heading',{name:heading,exact:true}).first().waitFor({timeout:30000});
  else await page.locator('.loading-state').waitFor({state:'hidden'});
  await page.evaluate(()=>document.fonts.ready);
}
async function capture(page,name,url,heading){
  await open(page,url,heading);
  await captureCurrent(page,name,url);
}
async function captureCurrent(page,name,url){
  await page.screenshot({path:resolve(output,name+'.png'),fullPage:false,style:'nextjs-portal { display:none !important; }'});
  const info=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,text:document.querySelector('main')?.innerText??'',headings:[...document.querySelectorAll('h1,h2,h3')].map(e=>e.textContent)}));
  await writeFile(resolve(output,name+'.txt'),info.text);
  report.pages.push({name,url,width:info.width,scrollWidth:info.scrollWidth,height:info.height,headings:info.headings});
  assert.ok(info.scrollWidth<=info.width+1,`${name}: horizontal page overflow (${info.scrollWidth}/${info.width})`);
  assert.ok(!/Workspace unavailable|Application error: a client-side exception/.test(info.text),name+': failed to load');
  console.log('Captured '+name+' ('+info.height+'px document)');
}

try{
  await waitForApp();
  browser=await chromium.launch({headless:true,...(process.env.THERANETRIX_CHROMIUM_PATH?{executablePath:process.env.THERANETRIX_CHROMIUM_PATH}:{}),args:JSON.parse(process.env.THERANETRIX_BROWSER_ARGS??'[]'),env:{...process.env,FONTCONFIG_PATH:process.env.FONTCONFIG_PATH??'/etc/fonts'}});
  const context=await browser.newContext({viewport:{width:1600,height:1100},deviceScaleFactor:1,colorScheme:'light',reducedMotion:'reduce'});
  page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.stack??error.message));
  page.on('requestfailed',request=>{const reason=request.failure()?.errorText;if(reason!=='net::ERR_ABORTED')console.error('Request failed:',request.url(),reason);});
  page.on('response',response=>{if(response.status()>=400)console.error('HTTP error:',response.status(),response.url());});
  page.on('console',message=>{if(message.type()==='error')console.error('Browser console:',message.text(),JSON.stringify(message.location()));});
  const scenes=[
    ['01-Care-Overview','/','Care overview'],
    ['02-Patient-Visit','/patients/TN-DEMO-01','Emma Carter'],
    ['03-Treatment','/patients/TN-DEMO-01?tab=treatment','Emma Carter'],
    ['04-Digital-Twin','/patients/TN-DEMO-01?tab=twin','Emma Carter'],
    ['05-Patients','/patients','Patients'],
    ['06-Review-Queue','/review-queue','Review queue'],
    ['07-Messages','/messages','Messages'],
    ['08-Schedule','/schedule','Schedule'],
    ['09-Settings','/settings','Workspace settings'],
    ['10-Care-Pathways','/care-pathways','Care pathways'],
    ['11-Patient-Companion','/patient-companion?patient=TN-DEMO-01'],
    ['12-Clinical-Workflow','/patients/TN-DEMO-01?workflow=decisions&workflowJourney=J06','Emma Carter'],
  ];
  for(const scene of scenes)await capture(page,...scene);
  report.checks.push('All 12 primary screens render without horizontal overflow at 1600px.');

  // A real plan write must reach the route, survive reload, create a follow-up,
  // and remain visible to the same patient in the companion.
  await open(page,'/','Care overview');
  await page.getByRole('textbox',{name:'Search clinical overview'}).fill('Emma Carter');
  assert.equal(await page.locator('.triage-patient').count(),1);
  await page.getByRole('button',{name:'Show review details for Emma Carter'}).click();
  await page.getByRole('button',{name:'Update plan for Emma Carter'}).click();
  const dialog=page.getByRole('dialog');
  await dialog.waitFor();
  const planText='Review sample patient progress and reported treatment experience at the planned follow-up.';
  await dialog.locator('textarea[name="text"]').fill(planText);
  await captureCurrent(page,'16-Care-Plan-Form','/ (care-plan dialog)');
  let failedSaveInjected=false;
  const rejectOnce=async route=>{if(route.request().method()==='POST'&&!failedSaveInjected){failedSaveInjected=true;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Temporary preview test failure. Please retry.'})});}else await route.continue();};
  await page.route('**/api/workspace',rejectOnce);
  await dialog.getByRole('button',{name:'Save plan',exact:true}).click();
  await dialog.getByRole('alert').waitFor();
  await page.unroute('**/api/workspace',rejectOnce);
  assert.equal(await dialog.locator('textarea[name="text"]').inputValue(),planText,'A failed save must keep the draft');
  assert.ok(await dialog.isVisible(),'A failed save must keep the dialog open');
  const saved=page.waitForResponse(response=>response.url().endsWith('/api/workspace')&&response.request().method()==='POST');
  await dialog.getByRole('button',{name:'Save plan',exact:true}).click();
  const saveResponse=await saved;
  assert.equal(saveResponse.status(),200,await saveResponse.text());
  await dialog.waitFor({state:'hidden'});
  await page.reload({waitUntil:'networkidle'});
  const state=await page.evaluate(async()=>await(await fetch('/api/workspace')).json());
  const emma=state.data.patients.find(patient=>patient.id==='TN-DEMO-01');
  assert.equal(emma.carePlans[0].text,planText);
  assert.ok(state.data.tasks.some(task=>task.patientId===emma.id&&task.id==='medication-followup-'+emma.id));
  await open(page,'/patient-companion?patient=TN-DEMO-01');
  await page.getByRole('tab',{name:'My care plan',exact:true}).click();
  await page.getByText(planText,{exact:true}).waitFor();
  report.checks.push('Patient filtering, Quick review, failed-save draft recovery, plan retry, reload, linked follow-up, and patient-side plan visibility pass.');

  // The clinician reply must appear in the selected patient's companion.
  await open(page,'/messages?patient=TN-DEMO-01','Messages');
  const messageText='Sample review: your follow-up is recorded in your care plan.';
  await page.getByRole('textbox',{name:'Message text',exact:true}).fill(messageText);
  const messageSaved=page.waitForResponse(response=>response.url().endsWith('/api/workspace')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  assert.equal((await messageSaved).status(),200);
  await open(page,'/patient-companion?patient=TN-DEMO-01');
  await page.getByRole('tab',{name:'Messages',exact:true}).click();
  await page.getByText(messageText,{exact:true}).waitFor();
  report.checks.push('A clinician reply reaches the same patient conversation in the companion.');

  // Switching sections should preserve an unfinished configuration draft.
  await open(page,'/settings','Workspace settings');
  const settingsNav=page.getByRole('navigation',{name:'Configuration sections'});
  await settingsNav.getByRole('button',{name:/Release scope/}).click();
  const owner=page.getByRole('textbox',{name:'Assessment owner',exact:true});
  await owner.fill('Preview draft owner');
  await settingsNav.getByRole('button',{name:/Feature coverage/}).click();
  await settingsNav.getByRole('button',{name:/Release scope/}).click();
  assert.equal(await owner.inputValue(),'Preview draft owner');
  await page.getByRole('tab',{name:'Integrations',exact:true}).click();
  await page.getByRole('tab',{name:'Capabilities & planning',exact:true}).click();
  assert.equal(await owner.inputValue(),'Preview draft owner');
  report.checks.push('Unfinished release-scope settings survive section and settings-tab changes.');

  // Page-level responsive verification, including the most complex workspace.
  await page.setViewportSize({width:1024,height:900});
  await capture(page,'13-Treatment-1024','/patients/TN-DEMO-01?tab=treatment','Emma Carter');
  await page.setViewportSize({width:390,height:844});
  await capture(page,'14-Patient-390','/patients/TN-DEMO-01','Emma Carter');
  await capture(page,'15-Companion-390','/patient-companion?patient=TN-DEMO-01');
  report.checks.push('Treatment reflows at 1024px; patient chart and companion fit 390px.');
  assert.deepEqual(report.errors,[],'Client-side errors');
  report.passed=true;
}catch(error){
  if(page){await page.screenshot({path:resolve(output,'failure.png'),fullPage:false}).catch(()=>{});await writeFile(resolve(output,'failure.html'),await page.content()).catch(()=>{});}
  report.passed=false;report.failure=String(error.stack??error);console.error(report.failure);process.exitCode=1;
}finally{
  await writeFile(resolve(output,'verification.json'),JSON.stringify(report,null,2));
  if(browser)await browser.close();await preview.close();
  console.log(JSON.stringify({passed:report.passed,screens:report.pages.length,checks:report.checks,errors:report.errors,output}));
}
