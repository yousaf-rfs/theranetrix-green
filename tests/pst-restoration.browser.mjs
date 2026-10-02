import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {startDemoPreview} from '../scripts/preview-demo.mjs';

const output=resolve(process.env.THERANETRIX_SCREENSHOT_DIR??resolve(tmpdir(),'theranetrix-pst-restoration'));
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

  await open(page,'/patients/TN-DEMO-01?tab=treatment','Emma Carter');
  const sliders=page.locator('.pst-sliders [role="slider"]');
  assert.equal(await sliders.count(),4);
  for(const slider of await sliders.all())assert.ok(await slider.isVisible(),'All four live priorities must be visible without expanding anything');
  const headers=await page.locator('.pst-table th').allTextContents();
  for(const label of ['Dose','Analgesia','Abuse','Cognitive','Sedation','CUI','Label'])assert.ok(headers.some(h=>h.trim().startsWith(label)),'Missing simultaneous comparison column '+label);
  const feed=await page.locator('.treatment-twin-feed').boundingBox(),shadow=await page.locator('.treatment-shadow').boundingBox(),table=await page.locator('.treatment-pst').boundingBox();
  assert.ok(feed.x<table.x&&table.x<shadow.x,'Twin feed, PST, and Shadow must be alongside each other on desktop');
  assert.ok(Math.abs(feed.y-table.y)<20&&Math.abs(table.y-shadow.y)<20,'Three comparison panels should start together');
  const decisionBar=await page.locator('.treatment-decision').boundingBox();
  assert.ok(decisionBar.y>=0&&decisionBar.y+decisionBar.height<=1101,'Desktop decision bar must stay available without scrolling past the comparison');
  await captureCurrent(page,'TheraNetrix-PST-Restored','/patients/TN-DEMO-01?tab=treatment');
  await page.evaluate(()=>window.scrollTo(0,document.querySelector('.treatment-board').getBoundingClientRect().top+window.scrollY-20));
  await captureCurrent(page,'TheraNetrix-PST-Restored-Workbench','/patients/TN-DEMO-01?tab=treatment');
  assert.match(await page.locator('.pst-show-all').innerText(),/Showing \d+ of \d+/,'The ranking opens on the top ten with a visible count');
  const topCount=await page.locator('.pst-option-row').count();
  await page.getByRole('button',{name:/^Show all \d+ options$/}).click();
  assert.ok(await page.locator('.pst-option-row').count()>topCount,'Show all reveals every eligible option');
  await page.getByRole('button',{name:'Show top 10',exact:true}).click();
  assert.equal(await page.locator('.pst-option-row').count(),topCount);
  assert.ok(await page.locator('.pst-model-limits').isVisible(),'Model limits stay visible under the table');
  assert.match(await page.locator('.pst-lowest').innerText(),/Lowest-ranked under current priorities/);
  assert.doesNotMatch(await page.locator('.pst-lowest').innerText(),/avoid/i);
  assert.match(await page.locator('.pst-table tbody').innerText(),/Tried before · stopped/,'The stopped lidocaine trial is flagged on its row');
  assert.match(await page.locator('.treatment-shadow').innerText(),/On the top-listed options/);
  const before=await page.locator('.pst-table tbody').innerText();
  await sliders.first().focus();await sliders.first().press('End');
  assert.equal(await sliders.first().getAttribute('aria-valuenow'),'100');
  assert.notEqual(await page.locator('.pst-table tbody').innerText(),before,'Changing priority must update live rankings/scores');
  const allCount=await page.locator('.pst-table tbody tr').count();
  await page.getByRole('checkbox',{name:'On-label only',exact:true}).check();
  assert.ok(await page.locator('.pst-table tbody tr').count()<allCount,'On-label filter must narrow the comparison');
  assert.ok(!(await page.locator('.pst-table tbody').innerText()).includes('Off-label'));
  await page.getByRole('checkbox',{name:'On-label only',exact:true}).uncheck();
  await page.getByRole('button',{name:/Include \/ exclude drugs/}).click();
  const includeVenlafaxine=page.getByRole('checkbox',{name:'Include Venlafaxine',exact:true});
  await includeVenlafaxine.uncheck();
  assert.equal(await page.getByRole('radio',{name:'Review Venlafaxine',exact:true}).count(),0,'Explicitly excluded drug must leave the comparison');
  await includeVenlafaxine.check();
  assert.equal(await page.getByRole('radio',{name:'Review Venlafaxine',exact:true}).count(),1,'Included eligible drug returns to the comparison');
  assert.ok(!(await page.getByRole('checkbox',{name:'Include Lidocaine 5% patch',exact:true}).isDisabled()),'A recorded stopped trial is a flag the clinician weighs, not a locked exclusion');
  assert.equal(await page.getByRole('radio',{name:'Review Lidocaine 5% patch',exact:true}).count(),1,'The previously tried lidocaine stays selectable in the comparison');
  assert.ok(!(await page.getByRole('checkbox',{name:'Include Gabapentin',exact:true}).isDisabled()),'Grogginess with the current gabapentin is a flag the clinician weighs, not a lock');
  assert.ok(await page.getByRole('checkbox',{name:'Include Amitriptyline',exact:true}).isDisabled(),'The library-wide amitriptyline rule remains a locked exclusion');
  assert.equal(await page.getByRole('radio',{name:'Review Amitriptyline',exact:true}).count(),0,'A locked profile exclusion cannot appear as a selectable row');
  await page.getByRole('button',{name:/Include \/ exclude drugs/}).click();
  await page.getByRole('button',{name:'Combinations',exact:true}).click();
  assert.ok(await page.locator('.pst-option-row').count()>0,'Combinations must list the eligible combination options');
  assert.ok((await page.locator('.pst-table tbody').innerText()).includes('Duloxetine + capsaicin 8% patch'),'An eligible combination must be shown');
  await page.getByRole('button',{name:'All options',exact:true}).click();
  const why=page.locator('.pst-table').getByRole('button',{name:'Why this rank',exact:true}).first();
  await why.click();await page.locator('.pst-table .why-drawer-body').first().waitFor();
  const explanation=await page.locator('.pst-table .why-drawer-body').first().innerText();
  for(const phrase of ['How the score adds up','Compared with the alternatives','Patient inputs to review','No source citation is attached'])assert.ok(explanation.includes(phrase),'Missing ranking explanation: '+phrase);
  await page.evaluate(()=>{
    const panel=document.querySelector('.pst-explanation');
    const header=document.querySelector('.patient-chart-header');
    const offset=header?header.getBoundingClientRect().bottom+16:80;
    window.scrollTo(0,panel.getBoundingClientRect().top+window.scrollY-offset);
  });
  await captureCurrent(page,'TheraNetrix-PST-Rank-Explanation','/patients/TN-DEMO-01?tab=treatment');
  report.checks.push('Visible weighting sliders change live scores; all dose/score columns remain available; label filtering and per-option rationale work.');
  const actions=[];page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/api/workspace'))actions.push(request.postDataJSON());});
  const extraCard=page.locator('.treatment-shadow .shadow-card.extra').first();
  const extraName=await extraCard.locator('b').innerText();
  await extraCard.getByRole('button',{name:'Add to comparison',exact:true}).click();
  await page.locator('.treatment-decision textarea').fill('Review this selected additional option with the patient.');
  await page.locator('.treatment-decision button[type="submit"]').click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  assert.ok((await dialog.innerText()).includes(extraName),'The actual Shadow option must reach the patient-plan dialog');
  assert.equal(actions.length,0,'Opening the final decision must not prematurely save a care plan');
  report.checks.push('A Shadow-only option reaches the correct staged decision without silently selecting a PST medication or writing a premature plan.');
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:1024,height:900});
  await capture(page,'TheraNetrix-PST-Restored-Tablet','/patients/TN-DEMO-01?tab=treatment','Emma Carter');
  const tabletTable=await page.locator('#treatment-ranking').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));
  assert.ok(tabletTable.scroll<=tabletTable.client+1,`Every score, CUI, Label and Why column fits the tablet width (${tabletTable.scroll}/${tabletTable.client})`);
  assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){
  if(page){await page.screenshot({path:resolve(output,'failure.png'),fullPage:false}).catch(()=>{});await writeFile(resolve(output,'failure.html'),await page.content()).catch(()=>{});}
  report.passed=false;report.failure=String(error.stack??error);console.error(report.failure);process.exitCode=1;
}finally{
  await writeFile(resolve(output,'verification.json'),JSON.stringify(report,null,2));
  if(browser)await browser.close();await preview.close();
  console.log(JSON.stringify({passed:report.passed,checks:report.checks,errors:report.errors,output}));
}
