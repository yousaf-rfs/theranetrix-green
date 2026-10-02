import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {startDemoPreview} from '../scripts/preview-demo.mjs';

const output=resolve(process.env.THERANETRIX_SCREENSHOT_DIR??resolve(tmpdir(),'theranetrix-patient-visit'));
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

  await open(page,'/patients/TN-DEMO-01','Emma Carter');
  await captureCurrent(page,'TheraNetrix-Patient-Profile-Review','/patients/TN-DEMO-01');
  const main=await page.locator('.profile-clinical-column').boundingBox();
  const rail=await page.locator('.profile-review-column').boundingBox();
  assert.ok(main.x<rail.x&&Math.abs(main.y-rail.y)<2,'Clinical summary and review queue align side by side');
  // The At a glance strip carries the current-medication summary on the first screen; its chip opens the full rows.
  const medicationChip=page.getByRole('navigation',{name:'At a glance',exact:true}).getByRole('link',{name:/^Medications/});
  const chip=await medicationChip.boundingBox();
  assert.ok(chip&&chip.y>=0&&chip.y+chip.height<900,'The current-medication summary should be visible in the initial desktop viewport');
  await medicationChip.click();
  await page.waitForFunction(()=>{const heading=[...document.querySelectorAll('.visit-medication-row h4')].find(item=>item.textContent==='Gabapentin');const header=document.querySelector('.patient-chart-header');if(!heading)return false;const box=heading.getBoundingClientRect(),top=header?header.getBoundingClientRect().bottom:0;return box.top>=top-1&&box.bottom<=innerHeight;},null,{timeout:5000});
  await page.evaluate(()=>window.scrollTo(0,0));
  const data=await page.evaluate(async()=>await(await fetch('/api/workspace')).json());
  const high=data.data.reviews.filter(r=>r.patientId==='TN-DEMO-01'&&r.priority==='High'&&r.status!=='Resolved');
  assert.equal(await page.locator('.visit-concerns .visit-review-row').count(),high.length);
  for(const concern of high)assert.ok(await page.locator('.visit-concerns').getByRole('heading',{name:concern.title,exact:true}).isVisible());
  report.checks.push('Current treatment visible on first desktop screen; every unresolved high-priority concern stays visible in the adjacent review column.');

  for(const name of ['Edit goal','Update Gabapentin response','Sources & gaps','Document action']){
    const button=page.getByRole('button',{name,exact:true}).first();
    await button.click();
    await page.getByRole('dialog').waitFor();
    if(name==='Document action'){
      const title=await page.locator('.visit-concerns .visit-review-row').first().locator('h3').innerText();
      await page.getByRole('dialog').getByRole('heading',{name:title,exact:true}).waitFor();
    }else assert.ok((await page.getByRole('dialog').innerText()).includes('Emma'),'Dialog must retain the selected patient');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({state:'hidden'});
  }
  await page.getByRole('button',{name:'Review',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({state:'hidden'});
  report.checks.push('Goal, medication response, sources, concern action, and allergy review controls open the correct patient editors.');

  await page.getByRole('button',{name:'Compare treatments',exact:true}).click();
  assert.equal(await page.locator('.pst-sliders [role="slider"]').count(),4);
  assert.ok(!await page.locator('.patient-profile-focus').count(),'Visit styling must not affect the restored treatment workspace');
  await page.getByRole('tab',{name:'Visit',exact:true}).click();
  await page.getByRole('button',{name:'View trends',exact:true}).click();
  await page.getByRole('tab',{name:'Digital Twin',exact:true}).getAttribute('aria-selected').then(value=>assert.equal(value,'true'));
  await page.getByRole('tab',{name:'Visit',exact:true}).click();
  report.checks.push('Treatment comparison retains the restored four-slider PST; trends navigation still opens the Digital Twin.');

  // Verify the existing plan save and draft recovery after reorganizing its controls.
  await page.getByRole('button',{name:'Update plan',exact:true}).click();
  const plan=page.locator('#visit-plan');
  const draft='Discuss the reported treatment experience and review progress at the scheduled follow-up.';
  await plan.locator('textarea[name="text"]').fill(draft);
  let rejected=false;
  const failOnce=async route=>{if(route.request().method()==='POST'&&!rejected){rejected=true;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Temporary preview failure. Please retry.'})});}else await route.continue();};
  await page.route('**/api/workspace',failOnce);
  await plan.getByRole('button',{name:'Save plan',exact:true}).click();
  await plan.getByRole('alert').waitFor();
  assert.equal(await plan.locator('textarea[name="text"]').inputValue(),draft);
  await page.unroute('**/api/workspace',failOnce);
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/workspace')&&r.request().method()==='POST');
  await plan.getByRole('button',{name:'Save plan',exact:true}).click();
  assert.equal((await saved).status(),200);
  await page.reload({waitUntil:'networkidle'});
  await page.locator('#visit-plan').getByText(draft,{exact:true}).waitFor();
  report.checks.push('Care plan retains its draft after a failed save, then successfully saves and survives reload.');

  await page.setViewportSize({width:1440,height:1000});
  await capture(page,'TheraNetrix-Patient-Profile-1440','/patients/TN-DEMO-01','Emma Carter');
  await page.setViewportSize({width:390,height:844});
  await capture(page,'TheraNetrix-Patient-Profile-390','/patients/TN-DEMO-01','Emma Carter');
  const mobileRail=await page.locator('.profile-review-column').boundingBox();
  const mobileClinical=await page.locator('.profile-clinical-column').boundingBox();
  assert.ok(mobileRail.y<mobileClinical.y,'Priority concerns remain first when the layout stacks');
  report.checks.push('The profile fits 1440px and 390px without horizontal page overflow; priority concerns remain first on narrow screens.');
  assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){
  if(page){await page.screenshot({path:resolve(output,'failure.png'),fullPage:false}).catch(()=>{});await writeFile(resolve(output,'failure.html'),await page.content()).catch(()=>{});}
  report.passed=false;report.failure=String(error.stack??error);console.error(report.failure);process.exitCode=1;
}finally{
  await writeFile(resolve(output,'verification.json'),JSON.stringify(report,null,2));
  if(browser)await browser.close();await preview.close();
  console.log(JSON.stringify({passed:report.passed,checks:report.checks,errors:report.errors,output}));
}
