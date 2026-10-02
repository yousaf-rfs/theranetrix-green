import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {startDemoPreview} from '../scripts/preview-demo.mjs';

// Follow actual review detours. Drafts stay with the same patient, source records
// open without replacing the current comparison, and URL navigation shows the
// requested destination after the workspace's asynchronous load.
const output=resolve(process.env.THERANETRIX_NAVIGATION_DIR??resolve(tmpdir(),'theranetrix-navigation-review'));
await mkdir(output,{recursive:true});
const preview=await startDemoPreview({appPort:3102,port:3132,logPath:resolve(output,'app.log')});
const report={checks:[],errors:[],passed:false};let browser;
function pass(message){report.checks.push(message);console.log('PASS '+message);}
async function ready(){for(let i=0;i<180;i++){try{if((await fetch('http://127.0.0.1:3102/')).ok)return;}catch{}await new Promise(ok=>setTimeout(ok,500));}throw Error('Preview unavailable');}
async function open(page,url){await page.goto(preview.url+url,{waitUntil:'networkidle',timeout:90000});await page.locator('.loading-state').waitFor({state:'hidden'});}
async function route(page,search){await page.evaluate(search=>{history.pushState(null,'',search);dispatchEvent(new PopStateEvent('popstate'));},search);}
try{
  await ready();browser=await chromium.launch({headless:true,...(process.env.THERANETRIX_CHROMIUM_PATH?{executablePath:process.env.THERANETRIX_CHROMIUM_PATH}:{}),args:JSON.parse(process.env.THERANETRIX_BROWSER_ARGS??'[]'),env:{...process.env,FONTCONFIG_PATH:'/etc/fonts'}});
  const page=await browser.newPage({viewport:{width:1600,height:1100}});page.on('pageerror',error=>report.errors.push(error.message));
  await open(page,'/patient-companion?patient=TN-DEMO-01');
  // The daily check-in keeps the note and medicine questions behind "Add more detail".
  await page.getByRole('button',{name:'Add more detail',exact:true}).click();
  const checkin=page.locator('.checkin-note textarea');await checkin.fill('Check-in draft preserved during medication review');
  await page.getByRole('group',{name:'Pain',exact:true}).getByRole('button',{name:'0',exact:true}).click();
  await page.getByLabel('Medication name',{exact:true}).fill('Medication draft');
  await page.getByRole('tab',{name:'Medications',exact:true}).click();
  const effects=page.getByRole('textbox',{name:'Any side effects with this dose? Optional'}).first();await effects.fill('Dose note before reviewing my plan');
  await page.getByRole('tab',{name:'Messages',exact:true}).click();
  const message=page.getByRole('textbox',{name:'Message text',exact:true});await message.fill('Message draft preserved during plan review');
  await page.getByRole('tab',{name:'My care plan',exact:true}).click();
  await page.getByRole('tab',{name:'Check-in',exact:true}).click();
  assert.equal(await checkin.inputValue(),'Check-in draft preserved during medication review');
  assert.equal(await page.getByLabel('Medication name',{exact:true}).inputValue(),'Medication draft');
  assert.equal(await page.getByRole('group',{name:'Pain',exact:true}).getByRole('button',{name:'0',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('tab',{name:'Medications',exact:true}).click();assert.equal(await effects.inputValue(),'Dose note before reviewing my plan');
  await page.getByRole('tab',{name:'Messages',exact:true}).click();assert.equal(await message.inputValue(),'Message draft preserved during plan review');
  await page.getByRole('region',{name:'Conversation history',exact:true}).focus();assert.equal(await page.evaluate(()=>document.activeElement?.className),'message-history');
  pass('Companion check-in, zero score, medication report, dose note and message survive review detours; history receives keyboard focus');
  await page.getByRole('combobox',{name:'Account',exact:true}).click();await page.getByRole('option').nth(1).click();
  await page.getByRole('tab',{name:'Check-in',exact:true}).click();assert.equal(await checkin.inputValue(),'');
  await page.getByRole('tab',{name:'Messages',exact:true}).click();assert.equal(await message.inputValue(),'');
  pass('Switching patient accounts clears drafts instead of carrying them to another patient');

  await open(page,'/patients/TN-DEMO-01?tab=treatment');
  const slider=page.getByRole('slider',{name:'Analgesia (Pain relief)',exact:true});await slider.focus();await slider.press('ArrowRight');
  const value=await slider.getAttribute('aria-valuenow');
  await page.getByRole('tab',{name:'Messages',exact:true}).click();
  const clinicianMessage=page.getByRole('textbox',{name:'Message text',exact:true});await clinicianMessage.fill('Clinician draft while reviewing the treatment');
  await page.getByRole('tab',{name:'Treatment',exact:true}).click();assert.equal(await slider.getAttribute('aria-valuenow'),value);
  await page.getByRole('tab',{name:'Messages',exact:true}).click();assert.equal(await clinicianMessage.inputValue(),'Clinician draft while reviewing the treatment');
  pass('Clinician messages and PST preferences survive patient-record tab changes');
  await page.getByRole('tab',{name:'Notes',exact:true}).click();
  await route(page,'?tab=outcomes');await page.getByRole('heading',{name:'Patient-reported outcomes',exact:true}).waitFor();
  await page.goBack();await page.getByRole('heading',{name:'Encounter documentation',exact:true}).waitFor();
  const note=page.locator('.document-note').first();await note.locator('summary').focus();await page.keyboard.press('Enter');assert.equal(await note.evaluate(el=>el.open),true);await page.keyboard.press('Enter');assert.equal(await note.evaluate(el=>el.open),false);
  pass('Patient record follows new URLs and browser Back after manual tab choice; notes expand and collapse from the keyboard');

  await route(page,'?tab=treatment');await slider.waitFor({state:'visible'});
  await slider.focus();await slider.press('ArrowRight');const sourceReviewValue=await slider.getAttribute('aria-valuenow');
  await page.getByRole('button',{name:'Why these priorities: Comparison priorities',exact:true}).click();
  const source=page.locator('.recommendation-dialog a[href$="#patient-medications"]').first();
  assert.equal(await source.getAttribute('target'),'_blank');
  const [popup]=await Promise.all([page.waitForEvent('popup'),source.click()]);
  await popup.waitForLoadState('networkidle');await popup.locator('#patient-medications').waitFor();
  await popup.waitForFunction(()=>document.activeElement?.id==='patient-medications');
  assert.match(popup.url(),/\/patients\/TN-DEMO-01\?tab=visit#patient-medications$/);
  const position=await popup.locator('#patient-medications').boundingBox();assert.ok(position.y>=0&&position.y<700,'Source destination stays visible in the initial viewport');
  assert.equal(await page.getByRole('slider',{name:'Analgesia (Pain relief)',exact:true,includeHidden:true}).getAttribute('aria-valuenow'),sourceReviewValue);assert.equal(await page.locator('.recommendation-dialog').isVisible(),true);
  await popup.close();await page.getByRole('button',{name:'Back to review',exact:true}).click();
  pass('Opening supporting records preserves PST preferences and focuses the correct patient medication section in a separate tab');

  await open(page,'/settings?tab=features&workflow=program-governance');
  await page.getByRole('tab',{name:'Integrations',exact:true}).click();assert.match(page.url(),/workflow=program-governance/);
  await route(page,'?tab=access');await page.getByRole('heading',{name:'Workspace access',exact:true}).waitFor();
  await page.goBack();await page.getByRole('heading',{name:'Connection walkthrough',exact:true}).waitFor();
  pass('Settings follows explicit URL and Back navigation and retains workflow route parameters on tab changes');
  assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=String(error.stack??error);console.error(report.failure);process.exitCode=1;}
finally{await writeFile(resolve(output,'verification.json'),JSON.stringify(report,null,2));if(browser)await browser.close();await preview.close();console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors}));}
