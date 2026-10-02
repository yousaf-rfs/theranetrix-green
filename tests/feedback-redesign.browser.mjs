import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {startDemoPreview} from '../scripts/preview-demo.mjs';
import {ADVISOR_NAME} from './fixtures/product-names.mjs';

const output=resolve(process.env.THERANETRIX_SCREENSHOT_DIR??resolve(tmpdir(),'theranetrix-feedback-review'));
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

  await open(page,'/patients/TN-DEMO-01?tab=treatment','Emma Carter');
  const launcher=page.getByRole('button',{name:'Ask '+ADVISOR_NAME+' about Emma Carter',exact:true});
  const launcherRect=await launcher.boundingBox(),decisionRect=await page.locator('.treatment-decision').boundingBox();
  assert.ok(launcherRect.y+launcherRect.height<decisionRect.y,'Advisor launcher must leave the decision controls clear');
  await launcher.click();
  const advisor=page.getByRole('dialog',{name:ADVISOR_NAME+' for Emma Carter',exact:true});
  await advisor.waitFor();
  const advisorRect=await advisor.boundingBox();
  assert.ok(advisorRect.y>=56&&advisorRect.y+advisorRect.height<decisionRect.y,'Advisor panel must fit between the header and treatment decision');
  await captureCurrent(page,'20-Advisor-Desktop','/patients/TN-DEMO-01?tab=treatment (Advisor open)');
  await advisor.getByRole('button',{name:'Close '+ADVISOR_NAME,exact:true}).press('Escape');
  assert.ok(await launcher.evaluate(el=>el===document.activeElement),'Closing Advisor returns keyboard focus');
  report.checks.push('Advisor opens within the viewport, leaves treatment decision controls clear, and returns focus after Escape.');

  await open(page,'/patient-companion?patient=TN-DEMO-01');
  await page.getByRole('button',{name:'Before my visit',exact:true}).click();
  await page.getByText('Medications and how they feel',{exact:true}).scrollIntoViewIfNeeded();
  await captureCurrent(page,'21-Previsit-Medications','/patient-companion?patient=TN-DEMO-01 (medication preparation)');

  await open(page,'/patients/TN-DEMO-01','Emma Carter');
  const nav=await page.getByRole('tablist',{name:'Patient record sections'}).boundingBox();
  const identity=await page.getByRole('heading',{name:'Emma Carter',exact:true}).boundingBox();
  assert.ok(nav.y<identity.y,'Patient navigation must appear above patient identity');
  await page.evaluate(()=>scrollTo(0,800));
  const sticky=await page.locator('.patient-chart-header').boundingBox();
  assert.ok(sticky.y>=55&&sticky.y<58,'Patient identifiers and note actions stay below the fixed global header');
  // Demo patients carry fictional seeded identifiers; editing them still records the clinician's values.
  await page.getByRole('button',{name:'MRN DEMO-000109',exact:true}).waitFor();
  await page.getByRole('button',{name:/DOB May 5, 1974/}).click();
  let editor=page.getByRole('dialog');
  await editor.getByLabel('Date of birth',{exact:true}).fill('1974-04-20');
  await editor.getByLabel('Medical record number',{exact:true}).fill('DEMO-MRN-001');
  await editor.getByRole('button',{name:'Save identifiers',exact:true}).click();
  await editor.waitFor({state:'hidden'});
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('button',{name:/DOB Apr 20, 1974/}).waitFor();
  await page.getByRole('button',{name:'MRN DEMO-MRN-001',exact:true}).waitFor();
  await page.getByText('Workspace ID TN-DEMO-01',{exact:true}).waitFor();
  // One visit heading; where the visit stands comes from the recorded encounter strip, not a view toggle.
  await page.getByRole('heading',{name:'Visit review',exact:true}).waitFor();
  assert.equal(await page.getByRole('group',{name:'Review view mode'}).count(),0,'No Pre-visit/In visit toggle that only swaps the heading');
  await page.getByRole('heading',{name:/^Latest recorded encounter · /}).waitFor();
  await page.locator('.visit-trajectory svg').waitFor();
  assert.ok(await page.getByText('Analgesic medications',{exact:false}).first().isVisible());
  report.checks.push('Tabs precede patient identity; chart header stays visible while scrolling; recorded DOB/MRN survive reload; one visit heading with the recorded encounter strip, and in-place trajectory work.');

  await page.getByRole('button',{name:'Feedback on this screen',exact:true}).click();
  editor=page.getByRole('dialog');
  await editor.getByLabel('Your feedback',{exact:true}).fill('Keep the full comparison and clearer treatment grouping.');
  await editor.getByRole('button',{name:'Save feedback',exact:true}).click();
  await editor.getByRole('status').getByText('Saved to this workspace for review.').waitFor();
  await captureCurrent(page,'22-Screen-Feedback','/patients/TN-DEMO-01 (feedback dialog)');
  await editor.getByRole('button',{name:'Close',exact:true}).first().click();
  const feedbackState=await page.evaluate(async()=>await(await fetch('/api/workspace')).json());
  assert.equal(feedbackState.data.prototypeFeedback[0].priority,'Must-have');
  assert.equal(feedbackState.data.prototypeFeedback[0].text,'Keep the full comparison and clearer treatment grouping.');
  report.checks.push('Screen feedback persists with route, priority, request type, and author.');

  const newPage=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Visit PDF',exact:true}).click();
  const printPage=await newPage;await printPage.waitForLoadState('domcontentloaded');
  assert.ok((await printPage.locator('body').innerText()).includes('DEMO-MRN-001'));
  assert.ok((await printPage.locator('body').innerText()).includes('not a signed encounter record'));
  await printPage.screenshot({path:resolve(output,'17-Visit-PDF.png'),fullPage:false});
  await printPage.close();
  report.checks.push('One-click visit summary opens a print/PDF document for the correct patient without exposing other patient records.');

  await open(page,'/','Care overview');
  await page.getByRole('button',{name:'Customize',exact:true}).click();
  editor=page.getByRole('dialog');
  const columnRows=editor.locator('.dashboard-column-list').first().locator('li');
  const firstName=await columnRows.first().locator('span').first().innerText();
  await columnRows.first().locator('.dashboard-drag-handle').dragTo(columnRows.nth(1));
  assert.notEqual(await columnRows.first().locator('span').first().innerText(),firstName,'Drag must reorder dashboard columns');
  await editor.getByLabel('Dashboard name',{exact:true}).fill('Feedback review layout');
  await editor.getByRole('button',{name:'Save dashboard',exact:true}).click();
  await editor.waitFor({state:'hidden'});
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('combobox',{name:'Dashboard profile',exact:true}).getByText('Feedback review layout',{exact:true}).waitFor();
  report.checks.push('Dashboard columns reorder by drag, save as a profile, and persist after reload.');

  // A real plan write must reach the route, survive reload, create a follow-up,
  // and remain visible to the same patient in the companion.
  await open(page,'/','Care overview');
  await page.getByRole('textbox',{name:'Search clinical overview'}).fill('Emma Carter');
  assert.equal(await page.locator('.triage-patient').count(),1);
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
  report.checks.push('Patient filtering, direct plan access, failed-save draft recovery, plan retry, reload, linked follow-up, and patient-side plan visibility pass.');

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

  const newPatient=await page.evaluate(async()=>{
    let state=await(await fetch('/api/workspace')).json();
    const response=await fetch('/api/workspace',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:state.version,action:{type:'patient.add',name:'Taylor Morgan',dateOfBirth:'1980-02-14',condition:'Pain assessment pending',clinician:'Demo care team',goal:'Return to daily walks'}})});
    if(!response.ok)throw new Error(await response.text());
    const result=await response.json();return result.data.patients.find(p=>p.name==='Taylor Morgan').id;
  });
  await capture(page,'18-Patient-No-Data','/patients/'+newPatient,'Taylor Morgan');
  await page.getByText('Waiting for the first report',{exact:true}).waitFor();
  assert.ok(!(await page.locator('.visit-metrics').innerText()).includes('50'));
  await page.evaluate(async id=>{
    const state=await(await fetch('/api/workspace')).json();
    const response=await fetch('/api/workspace',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:state.version,action:{type:'checkin.add',patientId:id,pain:6,function:4,sleep:5,note:'Initial patient report before the appointment.'}})});
    if(!response.ok)throw new Error(await response.text());
  },newPatient);
  await capture(page,'19-Patient-First-Report','/patients/'+newPatient,'Taylor Morgan');
  await page.getByRole('heading',{name:'Baseline recorded',exact:true}).waitFor();
  report.checks.push('A newly added patient shows explicit no-data and first-report states without invented clinical scores or visit counts.');

  // Page-level responsive verification, including the most complex workspace.
  await page.setViewportSize({width:1024,height:900});
  await capture(page,'13-Treatment-1024','/patients/TN-DEMO-01?tab=treatment','Emma Carter');
  await page.getByRole('button',{name:'Ask '+ADVISOR_NAME+' about Emma Carter',exact:true}).click();
  await captureCurrent(page,'23-Advisor-1024','/patients/TN-DEMO-01?tab=treatment (Advisor open)');
  const tabletAdvisor=await page.getByRole('dialog',{name:ADVISOR_NAME+' for Emma Carter',exact:true}).boundingBox();
  assert.ok(tabletAdvisor.x>=0&&tabletAdvisor.x+tabletAdvisor.width<=1024&&tabletAdvisor.y>=56&&tabletAdvisor.y+tabletAdvisor.height<=900,'Tablet Advisor fits the viewport');
  await page.setViewportSize({width:1440,height:1000});
  await open(page,'/patients/TN-DEMO-01?tab=treatment','Emma Carter');
  const desktopLauncher=await page.locator('.advisor-dock-fab').boundingBox(),desktopDecision=await page.locator('.treatment-decision').boundingBox();
  assert.ok(desktopLauncher.y+desktopLauncher.height<desktopDecision.y,'Advisor stays clear at 1440px');
  await page.setViewportSize({width:390,height:844});
  await capture(page,'14-Patient-390','/patients/TN-DEMO-01','Emma Carter');
  await capture(page,'15-Companion-390','/patient-companion?patient=TN-DEMO-01');
  report.checks.push('Treatment reflows at 1024px; patient chart and companion fit 390px.');

  // Patient identity stays on screen while scrolling at tablet and phone widths.
  for(const [width,height] of [[1024,768],[820,1180],[390,844]]){
    await page.setViewportSize({width,height});
    await open(page,'/patients/TN-DEMO-01','Emma Carter');
    const pin=page.locator('.patient-identity-pin');
    if(width<=900)assert.ok(!await pin.isVisible(),width+'px: the identity pin stays hidden while the full header is on screen');
    await page.evaluate(()=>scrollTo(0,800));
    if(width>900){
      const header=await page.locator('.patient-chart-header').boundingBox();
      assert.ok(header.y>=55&&header.y<58,width+'px: the chart header stays pinned');
      assert.ok(await page.getByRole('button',{name:/DOB Apr 20, 1974/}).isVisible(),width+'px: DOB stays visible');
      continue;
    }
    await page.locator('.patient-identity-pin.is-pinned').waitFor();
    const box=await pin.boundingBox(),allergy=await page.locator('.patient-identity-pin-allergy').boundingBox(),text=await pin.innerText();
    assert.ok(box.y>=55&&box.y<58&&box.height<=36,width+'px: one-line identity pin sits under the top bar');
    assert.ok(allergy.x+allergy.width<=box.x+box.width,width+'px: allergy status is not cut off');
    for(const value of ['Emma Carter','4/20/1974','DEMO-MRN-001','Not reviewed'])assert.ok(text.includes(value),width+'px: pinned identity shows '+value);
    await captureCurrent(page,'24-Identity-Pin-'+width,'/patients/TN-DEMO-01 (scrolled)');
  }
  await page.setViewportSize({width:820,height:1180});
  await open(page,'/patients/TN-DEMO-01','Emma Carter');
  // iPad portrait can hide and restore the navigation rail.
  await page.getByRole('button',{name:'Toggle navigation',exact:true}).click();
  await page.locator('[data-slot=sidebar][data-state=collapsed]').waitFor({state:'attached'});
  await page.getByRole('button',{name:'Toggle navigation',exact:true}).click();
  await page.locator('[data-slot=sidebar][data-state=expanded]').waitFor({state:'attached'});
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog',{name:'Find a patient'}).getByPlaceholder('Search patients...').fill('DEMO-MRN-001');
  await page.getByRole('option',{name:/Emma Carter/}).first().waitFor();
  await page.keyboard.press('Escape');
  report.checks.push('Name, DOB, MRN and allergy status stay pinned while scrolling at 1024, 820 and 390px; the navigation rail can be hidden at 820px; patient search matches MRN.');
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
