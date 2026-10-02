import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const accessibility=process.env.THERANETRIX_CHECK_ACCESSIBILITY==='1';
const require=createRequire(import.meta.url);
import http from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {startDemoPreview} from '../scripts/preview-demo.mjs';
const output=resolve(process.env.THERANETRIX_SCREENSHOT_DIR??resolve(tmpdir(),'theranetrix-clinician-review'));
await mkdir(output,{recursive:true});
const preview=await startDemoPreview({logPath:resolve(output,'app.log')});
const report={accessibility:[],pages:[],explanations:[],tasks:[],errors:[],passed:false};let browser,page;
async function ready(){await new Promise((ok,fail)=>{const deadline=Date.now()+90000;const check=()=>{const req=http.get('http://127.0.0.1:3000/',res=>{res.resume();if(res.statusCode===200)ok();else if(Date.now()>deadline)fail(Error('Preview unavailable'));else setTimeout(check,500);});req.on('error',e=>Date.now()>deadline?fail(e):setTimeout(check,500));};check();});}
async function open(url){await page.goto(preview.url+url,{waitUntil:'networkidle',timeout:90000});await page.locator('.loading-state').waitFor({state:'hidden'});await page.evaluate(()=>document.fonts.ready);}
async function shot(name,url){
  if(accessibility){
    const violations=await page.evaluate(async()=>{const result=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});return result.violations.map(item=>({id:item.id,impact:item.impact,nodes:item.nodes.map(node=>({target:node.target,summary:node.failureSummary}))}));});
    report.accessibility.push({name,violations});
  }
  const info=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,title:document.querySelector('main h1,main h2')?.textContent}));
  assert.ok(info.scrollWidth<=info.width+1,name+': page overflow');
  await page.screenshot({path:resolve(output,name+'.png'),fullPage:false});
  report.pages.push({name,url,...info});console.log('Captured '+name);
}
async function reasons(screen,capture=false){
  const triggers=page.locator('.recommendation-trigger:visible');const count=await triggers.count();
  for(let i=0;i<count;i++){
    const trigger=triggers.nth(i),name=await trigger.getAttribute('aria-label');
    await trigger.evaluate(el=>el.scrollIntoView({block:'center'}));await trigger.click();
    const dialog=page.locator('.recommendation-dialog');await dialog.waitFor();
    assert.ok(await dialog.getByRole('heading',{name:'Why this is shown',exact:true}).isVisible());
    assert.ok((await dialog.locator('.recommendation-section').first().innerText()).length>30);
    assert.ok(await dialog.getByRole('heading',{name:'Supporting records',exact:true}).isVisible());
    const bounds=await dialog.boundingBox(),viewport=page.viewportSize();
    assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width+1&&bounds.y+bounds.height<=viewport.height+1,'Explanation fits viewport: '+name);
    if(capture&&i===0)await shot(screen+'-Reason',page.url());
    await dialog.getByRole('button',{name:'Back to review',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    await page.waitForFunction(el=>document.activeElement===el,await trigger.elementHandle(),{timeout:2000});
    report.explanations.push({screen,name});
  }
}
try{
 await ready();browser=await chromium.launch({headless:true,...(process.env.THERANETRIX_CHROMIUM_PATH?{executablePath:process.env.THERANETRIX_CHROMIUM_PATH}:{}),args:JSON.parse(process.env.THERANETRIX_BROWSER_ARGS??'[]'),env:{...process.env,FONTCONFIG_PATH:'/etc/fonts'}});
 page=await browser.newPage({viewport:{width:Number(process.env.THERANETRIX_DESKTOP_WIDTH)||1600,height:Number(process.env.THERANETRIX_DESKTOP_HEIGHT)||1100},deviceScaleFactor:1,reducedMotion:'reduce'});if(accessibility)await page.addInitScript({path:require.resolve('axe-core/axe.min.js')});page.on('pageerror',e=>report.errors.push(e.message));
 const scenes=[['01-Care-Overview','/'],['02-Patient-Visit','/patients/TN-DEMO-01'],['03-Treatment','/patients/TN-DEMO-01?tab=treatment'],['04-Digital-Twin','/patients/TN-DEMO-01?tab=twin'],['05-Patients','/patients'],['06-Review-Queue','/review-queue'],['07-Messages','/messages'],['08-Schedule','/schedule'],['09-Settings','/settings'],['10-Care-Pathways','/care-pathways'],['11-Patient-Companion','/patient-companion?patient=TN-DEMO-01'],['12-Notes','/patients/TN-DEMO-01?tab=notes'],['13-Outcomes','/patients/TN-DEMO-01?tab=outcomes'],['14-Patient-Pathway','/patients/TN-DEMO-01?tab=pathway'],['15-Complete-Record','/patients/TN-DEMO-01?tab=full'],['16-Synopsis','/patients/TN-DEMO-01?tab=overview'],['17-Evidence','/patients/TN-DEMO-01?tab=evidence'],['18-Decision-Trace','/patients/TN-DEMO-01?tab=trace'],['19-Integrations','/settings?tab=integrations'],['20-Access','/settings?tab=access'],['21-Audit','/settings?tab=audit'],['22-Future-Capabilities','/future-capabilities']];
 for(const [name,url] of scenes){await open(url);await shot(name,url);await reasons(name,['01-Care-Overview','02-Patient-Visit','03-Treatment','04-Digital-Twin','06-Review-Queue'].includes(name));}
 await open('/patients/TN-DEMO-01?tab=notes');const search=page.getByRole('textbox',{name:'Search patient notes'});await search.fill('unlikely absent note text');await page.getByText('No matching notes',{exact:true}).waitFor();await search.fill('');
 await open('/patient-companion?patient=TN-DEMO-01');
 for(const [name,tab] of [['23-Companion-Medications','Medications'],['24-Companion-Progress','My progress'],['25-Companion-Plan','My care plan'],['26-Companion-Messages','Messages']]){await page.getByRole('tab',{name:tab,exact:true}).click();await shot(name,'/patient-companion?patient=TN-DEMO-01#'+tab);await reasons(name,tab==='Medications'||tab==='My care plan');}
 const domains=['encounters','decisions','treatment-continuity','results-referrals','patient-coordination','integration-access','program-governance'];
 for(const [index,domain] of domains.entries()){
   const url=(domain==='program-governance'?'/settings':'/patients/TN-DEMO-01')+'?workflow='+domain;
   await open(url);await page.locator('.clinician-task-jumps').waitFor();
   await page.locator('.care-workbench').evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().top+window.scrollY-(location.pathname==='/settings'?76:270)));
   await shot((27+index)+'-Workflow-'+domain,url);
   const jumps=page.locator('.clinician-task-jumps button');
   for(let i=0;i<await jumps.count();i++){
     const button=jumps.nth(i),label=await button.innerText();await button.evaluate(el=>el.scrollIntoView({block:'center'}));await button.click();
     const focus=await page.evaluate(()=>({tag:document.activeElement?.tagName,text:document.activeElement?.textContent?.slice(0,150)}));
     assert.ok(['SUMMARY','LEGEND'].includes(focus.tag)||focus.tag?.match(/^H[1-6]$/),domain+' task did not focus the requested section: '+label+' '+JSON.stringify(focus));
     report.tasks.push({domain,label,focus:focus.text});
   }
   // The workflow-level rationale covers saved source/version and purpose.
   const why=page.locator('.clinician-workflow-tools .recommendation-trigger');await why.evaluate(el=>el.scrollIntoView({block:'center'}));await why.click();await page.locator('.recommendation-dialog').waitFor();await page.getByRole('button',{name:'Back to review',exact:true}).click();
 }
 await page.setViewportSize({width:1024,height:900});await open('/patients/TN-DEMO-01?tab=treatment');await shot('34-Treatment-Tablet',page.url());await reasons('34-Treatment-Tablet',true);
 await page.setViewportSize({width:390,height:844});await open('/patients/TN-DEMO-01');await shot('35-Patient-Mobile',page.url());await reasons('35-Patient-Mobile',true);
 await open('/patient-companion?patient=TN-DEMO-01');await shot('36-Companion-Mobile',page.url());await reasons('36-Companion-Mobile');
 assert.deepEqual(report.errors,[]);if(accessibility)assert.deepEqual(report.accessibility.filter(item=>item.violations.length),[],'Automated accessibility violations');report.passed=true;
}catch(error){report.failure=String(error.stack??error);console.error(report.failure);process.exitCode=1;if(page)await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});
}finally{await writeFile(resolve(output,'verification.json'),JSON.stringify(report,null,2));if(browser)await browser.close();await preview.close();console.log(JSON.stringify({passed:report.passed,screens:report.pages.length,explanations:report.explanations.length,tasks:report.tasks.length,errors:report.errors}));}
