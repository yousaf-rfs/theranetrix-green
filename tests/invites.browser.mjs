import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {startDemoPreview} from '../scripts/preview-demo.mjs';

// The invite dashboard end to end: set up the admin password, create personal links, open them as the invited
// people (each in their own browser), check that visitors without a link still get in, turn a link off, and replace a link.
const output=resolve(process.env.THERANETRIX_INVITES_DIR??resolve(tmpdir(),'theranetrix-invites'));
await mkdir(output,{recursive:true});
const preview=await startDemoPreview({appPort:3104,port:3134,logPath:resolve(output,'app.log')});
const report={checks:[],errors:[],passed:false};let browser;
function pass(message){report.checks.push(message);console.log('PASS '+message);}
async function ready(){for(let i=0;i<180;i++){try{if((await fetch('http://127.0.0.1:3104/')).ok)return;}catch{}await new Promise(ok=>setTimeout(ok,500));}throw Error('Preview unavailable');}
async function person(){const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));return page;}
const workspace=page=>page.evaluate(async()=>{const response=await fetch('/api/workspace',{cache:'no-store'});return {status:response.status,body:await response.json()};});
const linkFor=(page,name)=>page.getByRole('textbox',{name:'Invite link for '+name,exact:true}).inputValue();
try{
  await ready();
  browser=await chromium.launch({headless:true,...(process.env.THERANETRIX_CHROMIUM_PATH?{executablePath:process.env.THERANETRIX_CHROMIUM_PATH}:{}),args:JSON.parse(process.env.THERANETRIX_BROWSER_ARGS??'[]'),env:{...process.env,FONTCONFIG_PATH:'/etc/fonts'}});
  const admin=await person();admin.on('dialog',dialog=>dialog.accept());
  await admin.goto(preview.url+'/admin',{waitUntil:'networkidle',timeout:90000});
  await admin.getByRole('heading',{name:'Set up your invite dashboard'}).waitFor();
  await admin.getByLabel('New admin password').fill('short');await admin.getByLabel('Confirm password').fill('short');
  await admin.getByRole('button',{name:'Set password and continue'}).click();
  assert.ok(await admin.getByLabel('New admin password').evaluate(input=>!input.checkValidity()),'a short password is refused');
  await admin.getByLabel('New admin password').fill('correct horse battery');await admin.getByLabel('Confirm password').fill('correct horse battery');
  await admin.getByRole('button',{name:'Set password and continue'}).click();
  await admin.getByRole('heading',{name:'Invites',exact:true}).waitFor();
  await admin.getByText('No invites yet. Create the first one above.').waitFor();
  pass('first visit sets the admin password and opens an empty dashboard');

  await admin.getByLabel('Name').fill('Dr. Jordan Lee');await admin.getByLabel(/^Email/).fill('jordan@example.com');await admin.getByLabel(/^Note/).fill('CTO');
  await admin.getByRole('button',{name:'Create invite link'}).click();
  await admin.getByRole('status').getByText('Dr. Jordan Lee').waitFor();
  const jordanLink=await linkFor(admin,'Dr. Jordan Lee');
  assert.match(jordanLink,/^http:\/\/127\.0\.0\.1:3134\/i\/[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{32}$/);
  assert.match(await admin.getByRole('link',{name:'Email link'}).first().getAttribute('href'),/^mailto:jordan%40example\.com\?subject=Your%20TheraNetrix%20link&body=.*%2Fi%2F/);
  await admin.getByLabel('Name').fill('Pat Rivera');await admin.getByLabel('Patient companion').check();
  await admin.getByRole('button',{name:'Create invite link'}).click();
  await admin.getByRole('status').getByText('Pat Rivera').waitFor();
  const patLink=await linkFor(admin,'Pat Rivera');
  assert.notEqual(patLink,jordanLink);
  assert.equal(await admin.getByText('Not opened yet').count(),2);
  pass('each invite gets its own link, with an email draft when an address is given');

  const jordan=await person();
  await jordan.goto(jordanLink,{waitUntil:'networkidle',timeout:90000});
  assert.equal(new URL(jordan.url()).pathname,'/');
  await jordan.locator('.loading-state').waitFor({state:'hidden'});
  let read=await workspace(jordan);assert.equal(read.status,200);assert.equal(read.body.user,'Dr. Jordan Lee');assert.deepEqual(read.body.invite,{name:'Dr. Jordan Lee',role:'clinician'});
  const jordanId=jordanLink.split('/i/')[1].slice(0,12);
  assert.ok(preview.db.prepare('SELECT owner_id FROM workspaces WHERE owner_id = ?').get('invite:'+jordanId),'Jordan has their own copy of the demo');
  pass('opening a clinician link signs that person in to their own workspace');

  const pat=await person();
  await pat.goto(patLink,{waitUntil:'networkidle',timeout:90000});
  assert.equal(new URL(pat.url()).pathname,'/patient-companion');
  await pat.goto(preview.url+'/',{waitUntil:'networkidle',timeout:90000});
  assert.equal(new URL(pat.url()).pathname,'/','the home page is never redirected away');
  pass('a patient link opens the companion, and the home page still opens normally');

  await admin.reload({waitUntil:'networkidle'});
  await admin.getByText('Opened once · last active just now').first().waitFor();
  pass('the dashboard shows who opened their link and when they were last active');

  const stranger=await person();
  read=await workspace(await (async()=>{await stranger.goto(preview.url+'/',{waitUntil:'networkidle',timeout:90000});return stranger;})());
  assert.equal(read.status,200,'a visitor without a link opens the shared workspace');assert.equal(read.body.invite,undefined);const visitor=read.body.user;
  await stranger.locator('.loading-state').waitFor({state:'hidden'});
  assert.equal(await stranger.getByRole('heading',{name:'Invitation needed'}).count(),0);
  assert.equal(await admin.getByRole('switch').count(),0,'there is no invite-only switch to lock people out');
  await admin.getByText('Anyone with the site’s Vercel password can open TheraNetrix.').waitFor();
  assert.equal((await workspace(jordan)).body.user,'Dr. Jordan Lee','invited people are signed in by name');
  pass('the site password is the only gate: visitors without a link still get in, invited people are named');

  const jordanRow=admin.getByRole('listitem').filter({hasText:'Dr. Jordan Lee'});
  await jordanRow.getByRole('button',{name:'Turn off'}).click();
  await jordanRow.getByText('Off',{exact:true}).waitFor();
  assert.equal((await workspace(jordan)).body.user,visitor,'a turned-off link stops signing that person in straight away');
  const again=await person();
  await again.goto(jordanLink,{waitUntil:'networkidle'});
  await again.getByRole('heading',{name:'This link is not active'}).waitFor();
  await jordanRow.getByRole('button',{name:'Turn back on'}).click();
  await jordanRow.getByText('Active',{exact:true}).waitFor();
  assert.equal((await workspace(jordan)).body.user,'Dr. Jordan Lee','turning it back on restores the same link');
  pass('turning a link off stops it signing that person in, and turning it back on restores it');

  const patRow=admin.getByRole('listitem').filter({hasText:'Pat Rivera'});
  await patRow.getByRole('button',{name:'New link'}).click();
  await admin.waitForFunction(old=>document.querySelector('input[aria-label="Invite link for Pat Rivera"]')?.value!==old,patLink);
  const newPatLink=await linkFor(admin,'Pat Rivera');
  assert.equal((await workspace(pat)).body.user,visitor,'sessions from the old link end');
  const old=await person();await old.goto(patLink,{waitUntil:'networkidle'});await old.getByRole('heading',{name:'This link is not active'}).waitFor();
  const fresh=await person();await fresh.goto(newPatLink,{waitUntil:'networkidle',timeout:90000});
  assert.equal(new URL(fresh.url()).pathname,'/patient-companion');assert.equal((await workspace(fresh)).body.user,'Pat Rivera');
  pass('a new link replaces the old one and ends sessions opened from it');

  await admin.getByRole('button',{name:'Several people'}).click();
  assert.ok(await admin.getByLabel('The shared workspace').isChecked(),'a group invite defaults to the shared workspace');
  await admin.getByLabel('People, one per line').fill('Alex Kim, alex@example.com\nSam Ortiz <sam@example.com>\njordan@example.com\n');
  await admin.getByRole('button',{name:'Create 3 invite links'}).click();
  await admin.getByText('2 links ready.').waitFor();
  await admin.getByText('Already invited, left as they are: Jordan').waitFor();
  const alexLink=await linkFor(admin,'Alex Kim'),samLink=await linkFor(admin,'Sam Ortiz');
  assert.notEqual(alexLink,samLink);
  const alex=await person();await alex.goto(alexLink,{waitUntil:'domcontentloaded',timeout:90000});
  read=await workspace(alex);assert.equal(read.body.user,'Alex Kim');
  assert.ok(!preview.db.prepare('SELECT owner_id FROM workspaces WHERE owner_id LIKE ?').get('invite:'+alexLink.split('/i/')[1].slice(0,12)),'a shared-workspace invite does not get its own copy');
  await admin.context().grantPermissions(['clipboard-read','clipboard-write']);
  await admin.getByRole('button',{name:'Copy all links'}).click();
  const all=await admin.evaluate(()=>navigator.clipboard.readText());
  assert.match(all,/^Alex Kim <alex@example\.com>: http:\/\/127\.0\.0\.1:3134\/i\//m);assert.match(all,/^Sam Ortiz <sam@example\.com>: /m);
  pass('several people can be invited at once into the shared workspace, and all links copied together');

  const phone=await (await browser.newContext({viewport:{width:390,height:844},storageState:await admin.context().storageState()})).newPage();
  await phone.goto(preview.url+'/admin',{waitUntil:'networkidle'});await phone.getByRole('heading',{name:'People'}).waitFor();
  assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no sideways scrolling on a phone');
  await phone.screenshot({path:resolve(output,'dashboard-phone.png'),fullPage:true});
  await admin.screenshot({path:resolve(output,'dashboard-desktop.png'),fullPage:true});
  pass('the dashboard fits a phone screen');

  await admin.getByRole('button',{name:'Sign out'}).click();
  await admin.getByRole('heading',{name:'Sign in to invites'}).waitFor();
  assert.equal((await admin.evaluate(async()=>(await fetch('/api/admin/invites')).status)),401);
  await admin.getByLabel('Admin password').fill('wrong password');await admin.getByRole('button',{name:'Sign in'}).click();
  await admin.getByText('That password did not match. Please try again.').waitFor();
  await admin.getByLabel('Admin password').fill('correct horse battery');await admin.getByRole('button',{name:'Sign in'}).click();
  await admin.getByRole('heading',{name:'People'}).waitFor();
  pass('signing out locks the dashboard; the admin password signs back in');

  assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=String(error.stack??error);console.error(report.failure);process.exitCode=1;}
finally{await writeFile(resolve(output,'verification.json'),JSON.stringify(report,null,2));if(browser)await browser.close();await preview.close();console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors}));}
