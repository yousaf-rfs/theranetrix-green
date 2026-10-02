import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const css={name:'css-for-ssr',setup(builder){builder.onLoad({filter:/\.css$/},()=>({contents:'export default {}',loader:'js'}));}};
const bundle=await build({stdin:{contents:"export * from './lib/theranetrix';export * from './lib/actions';export * from './lib/medications';export * from './lib/patient-overview';export * from './lib/patient-panel';export {NeedsActionBell} from './components/theranetrix/needs-action';export {PatientOverview} from './components/theranetrix/patient-overview';export {Messages} from './components/theranetrix/workflows';export {ReferralsWorkspace,referralLinkPrefill,withoutReferralLink} from './components/theranetrix/clinical-flows/results-referrals';export {feedbackRoute,requests as feedbackRequests} from './components/theranetrix/prototype-feedback';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false,plugins:[css]});
const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(process.cwd()+'/package.json'),mod,mod.exports);
const {seedWorkspace,normalizeWorkspace,applyAction,actionSchema,patientSuggestions,referralPromptRules,referralStartHref,referralPromptPrefill,needsAction,reviewQueueStatus,overviewRecommendationDetails,NeedsActionBell,PatientOverview,Messages,ReferralsWorkspace,referralLinkPrefill,withoutReferralLink,feedbackRoute,feedbackRequests}=mod.exports;
const now='2026-09-24T10:00:00Z',today='2026-09-24';
const act=(w,a)=>applyAction(w,actionSchema.parse(a),'Clinical reviewer',now);
const ctx=w=>({data:w,user:'Clinical reviewer',busy:false,save:async()=>true,open:()=>{},signOut:async()=>{}});
const patient=(w,id)=>w.patients.find(p=>p.id===id);
const group=(result,id)=>result.groups.find(g=>g.id===id);

// F15: needs-action bell ------------------------------------------------------
test('needs-action rows sit in labelled groups with recorded priority High first and deep links',()=>{
 const w=normalizeWorkspace(seedWorkspace()),result=needsAction(w,today);
 assert.deepEqual(result.groups.map(g=>g.label),['Open reviews','Reply needed','Overdue activities']);
 const reviews=group(result,'reviews').rows;
 assert.equal(reviews.length,w.reviews.filter(r=>r.status!=='Resolved').length);
 const rank={High:0,Medium:1,Routine:2};
 assert.ok(reviews.every((r,i)=>i===0||rank[reviews[i-1].priority]<=rank[r.priority]),'High first');
 for(const r of reviews)assert.equal(r.href,'/review-queue?patient='+encodeURIComponent(r.patientId));
 // Elena and James sent the latest message in the seed; Sarah's latest message is the care team's reply.
 const replies=group(result,'replies').rows,latest=id=>w.messages.filter(m=>m.patientId===id).sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
 assert.ok(['TN-1038','TN-1051'].every(id=>replies.some(r=>r.patientId===id))&&!replies.some(r=>r.patientId==='TN-1042'));
 assert.deepEqual(replies.map(r=>r.patientId).sort(),w.patients.filter(p=>latest(p.id)?.direction==='in').map(p=>p.id).sort());
 for(const r of replies)assert.equal(r.href,'/patients/'+r.patientId+'?tab=messages');
 const tasks=group(result,'tasks').rows;
 // An overdue row opens the Schedule filtered to that patient, where the activity is listed (not the top of the visit tab).
 assert.ok(tasks.length>0&&tasks.every(r=>r.date<today&&r.href==='/schedule?patient='+encodeURIComponent(r.patientId)));
 assert.ok(!group(needsAction(w,'2026-09-01'),'tasks').rows.some(r=>r.date>='2026-09-01'),'future activities are not overdue');
});
test('the bell counts each patient once, so one patient request is not counted in two groups',()=>{
 let w=normalizeWorkspace(seedWorkspace());w.tasks=[];
 const before=needsAction(w,today);
 // A companion help request saves an inbound message and opens a review through its handoff.
 w=act(w,{type:'advisor.request',patientId:'TN-1034',requestId:'framing-help',text:'My pain is worse after walking.',concernUrgency:'routine'});
 const after=needsAction(w,today);
 assert.ok(group(after,'reviews').rows.some(r=>r.patientId==='TN-1034'),'listed under open reviews');
 assert.ok(group(after,'replies').rows.some(r=>r.patientId==='TN-1034'),'listed under reply needed');
 assert.equal(after.patients,before.patients+1,'one new patient adds one to the badge');
 assert.equal(after.patients,new Set(after.groups.flatMap(g=>g.rows.map(r=>r.patientId))).size);
});
test('reply needed follows the latest message by date, respects the messaging setting, and reviews follow their handoff',()=>{
 let w=normalizeWorkspace(seedWorkspace());
 w.messages.unshift({id:'late-reply',patientId:'TN-1051',text:'We will review next steps at your visit.',date:'2026-09-09T09:00:00Z',sender:'Care team',direction:'out'});
 assert.ok(!group(needsAction(w,today),'replies').rows.some(r=>r.patientId==='TN-1051'),'a later care-team reply clears reply needed');
 w.features.messages=false;
 assert.equal(group(needsAction(w,today),'replies').rows.length,0);
 const review={id:'r',patientId:'TN-1042',title:'t',detail:'d',priority:'High',source:'s',status:'Open',created:now,workflowRecordId:'h'};
 const handoffs=phase=>({clinicalWorkflows:{slices:{'patient-coordination':{state:{handoffs:[{id:'h',patientId:'TN-1042',phase}]}}}}});
 assert.equal(reviewQueueStatus(review,handoffs('closed')),'Resolved');
 assert.equal(reviewQueueStatus(review,handoffs('reviewed')),'Acknowledged');
 assert.equal(reviewQueueStatus(review,{}),'Open');
});
test('the bell names what it counts and never implies an urgency score or message delivery',()=>{
 const w=normalizeWorkspace(seedWorkspace()),attention=needsAction(w,today);
 const html=renderToStaticMarkup(React.createElement(NeedsActionBell,{attention}));
 assert.match(html,new RegExp('aria-label="Needs action: '+attention.patients+' patients"'));
 assert.match(html,new RegExp('notification-count[^>]*>'+attention.patients+'<'));
 assert.match(html,new RegExp('title="Needs action: '+attention.patients+' patients, each counted once \\(the Review queue counts reviews\\)"'));
 // The sidebar Review queue badge counts reviews, so it names that unit for screen readers and on hover.
 assert.match(readFileSync('components/theranetrix/app.tsx','utf8'),/<b className="nav-count" title="Open reviews \(the Needs action bell counts patients\)">\{reviews\}<span className="sr-only"> open review\{reviews===1\?'':'s'\}<\/span><\/b>/);
 const source=readFileSync('components/theranetrix/needs-action.tsx','utf8');
 assert.match(source,/not a calculated urgency score/);assert.match(source,/Messages are not delivered outside this workspace/);
 assert.doesNotMatch(source,/urgency score:|risk score:/i);
});
test('conversations whose latest message is from the patient show Reply needed',()=>{
 const w=normalizeWorkspace(seedWorkspace());
 const html=renderToStaticMarkup(React.createElement(Messages,{ctx:ctx(w)}));
 const rows=[...html.matchAll(/<button[^>]*class="conversation [^"]*"[^>]*>([\s\S]*?)<\/button>/g)].map(m=>m[1]);
 const flagged=rows.filter(row=>row.includes('Reply needed'));
 assert.equal(flagged.length,needsAction(w,today).groups.find(g=>g.id==='replies').rows.length);
 assert.ok(flagged.some(row=>row.includes('Elena Rodriguez'))&&flagged.some(row=>row.includes('James Wilson')));
 assert.ok(!flagged.some(row=>row.includes('Sarah Mitchell')));
});

// F40: EHR as the system of record --------------------------------------------
test('the complete record names the EHR as the system of record and the workspace as a working copy',()=>{
 const w=normalizeWorkspace(seedWorkspace());
 const html=renderToStaticMarkup(React.createElement(PatientOverview,{p:patient(w,'TN-1042'),ctx:ctx(w),changeTab:()=>{}}));
 assert.match(html,/System of record/);assert.match(html,/\(not connected\) · this workspace holds a working copy/);
 assert.doesNotMatch(html,/Record source/);
 const source=readFileSync('components/theranetrix/workflows.tsx','utf8');
 assert.match(source,/remains the record of truth\. TheraNetrix is planned to interoperate with Epic, Oracle Health \(Cerner\) and other EHRs through/);
 assert.equal((source.match(/'Patient matching by MRN \(planned\)\.'/g)||[]).length,2,'listed under the Tabia and SMART on FHIR requirements');
});

// F28: referral prompts -------------------------------------------------------
test('referral prompts use a labelled placeholder rule set and never refer automatically',()=>{
 assert.match(referralPromptRules.status,/provisional, pending clinical team criteria/);
 assert.deepEqual([...referralPromptRules.services],['Physical therapy','Pain psychology','Specialty review']);
 const w=normalizeWorkspace(seedWorkspace()),p=patient(w,'TN-DEMO-01'),suggestions=patientSuggestions(p,w),referral=suggestions.find(s=>s.kind==='referral');
 assert.ok(referral,'reported medication effects match the prompt');
 assert.equal(referral.title,'Consider a referral');assert.equal(referral.attention,false);
 assert.equal(suggestions.at(-1),referral,'listed last, after every review prompt');assert.notEqual(suggestions[0].kind,'referral');
 assert.match(referral.reason,/^Prototype rules matched: .*medication effects reported/);
 assert.match(referral.reason,/nothing is referred automatically/);assert.match(referral.reason,/provisional, pending clinical team criteria/);
 assert.doesNotMatch(referral.reason,/recommend|should refer|best|optimal|first-line|confidence/i);
 assert.ok(referral.basis.length&&referral.basis.every(b=>b.label&&b.value&&b.date),'each piece of evidence is dated');
 assert.ok(!patientSuggestions(patient(w,'TN-1038'),w).some(s=>s.kind==='referral'),'an improving patient with no reported effects has no prompt');
 w.features.reviewPrompts=false;assert.ok(!patientSuggestions(p,w).some(s=>s.kind==='referral'),'off with record-based prompts');
});
test('each referral criterion lists its triggering evidence with dates',()=>{
 const w=normalizeWorkspace(seedWorkspace()),base=patient(w,'TN-1038');
 const fresh=()=>({...structuredClone(base),medications:[],checkins:[],workflowObservations:[]});
 const find=p=>patientSuggestions(p,w).find(s=>s.kind==='referral');
 // Goal not met at the last two reviews of the current goal.
 const review=(goalStatus,date)=>({direction:'Finding a treatment',goalStatus,goalEvidence:'Walks 5 minutes before resting.',decision:'',monitoring:'',options:[],date,author:'Reviewer',goalAtReview:base.goal});
 let p=fresh();p.treatmentReview={...review('Partly met','2026-09-14'),history:[review('Not yet met','2026-08-20')]};
 let r=find(p);assert.match(r.reason,/goal recorded as not yet met or partly met at the last 2 reviews/);assert.deepEqual(r.basis.map(b=>b.date),['2026-09-14','2026-08-20']);
 p.treatmentReview.history=[review('Met','2026-08-20')];assert.equal(find(p),undefined,'one unmet review is not enough');
 // Pain and function not improved against the first report.
 p=fresh();p.pain=[6,6,7,6];p.function=[4,4,4,5];p.sleep=[5,5,5,5];p.dates=['2026-08-01','2026-08-15','2026-09-01','2026-09-15'];
 r=find(p);assert.match(r.reason,/neither pain nor function 2 or more points better than the first report in the last 3 reports/);
 assert.deepEqual(r.basis.map(b=>b.date),['2026-08-15','2026-09-01','2026-09-15']);assert.match(r.basis[0].label,/first report 6\/10, 4\/10 on 2026-08-01/);
 p.pain=[6,6,7,3];assert.equal(find(p),undefined,'a 2-point improvement in the latest report clears it');
 // Persistently low function.
 p=fresh();p.pain=[6,4,3,2];p.function=[2,3,2,3];p.sleep=[5,5,5,5];p.dates=['2026-08-01','2026-08-15','2026-09-01','2026-09-15'];
 r=find(p);assert.match(r.reason,/function 3\/10 or lower in the last 3 reports/);
 // Two medications stopped for effects.
 const stopped=(id,name,stopReason,tolerability='Effects reported')=>({id,name,regimen:'',indication:'',status:'Stopped',started:'2026-06-01',stopped:'2026-07-01',stopReason,benefit:'No benefit',tolerability,adherence:'Not assessed',effects:tolerability==='Effects reported'?'Dizziness':'',reportedAt:'2026-07-01',source:'Clinician entry',reviewedAt:'',reviewedBy:'',history:[]});
 p=fresh();p.medications=[stopped('a','Drug A','Stopped for side effects: dizziness')];assert.equal(find(p),undefined,'one stop is below the placeholder threshold');
 p.medications.push(stopped('c','Drug C','No benefit; well tolerated','No effects reported'));assert.equal(find(p),undefined,'a stop without recorded effects does not count');
 p.medications.push(stopped('b','Drug B','Intolerance: nausea'));r=find(p);assert.match(r.reason,/2 medications stopped for effects/);assert.deepEqual(r.basis.map(b=>b.date),['2026-07-01','2026-07-01']);
});
test('Start referral opens the J30 form prefilled with the service and dated evidence',()=>{
 const w=normalizeWorkspace(seedWorkspace()),p=patient(w,'TN-DEMO-01'),referral=patientSuggestions(p,w).find(s=>s.kind==='referral');
 const url=new URL(referralStartHref(p.id,'Pain psychology',referral),'https://example.test');
 assert.equal(url.pathname,'/patients/TN-DEMO-01');
 assert.equal(url.searchParams.get('workflow'),'results-referrals');assert.equal(url.searchParams.get('workflowJourney'),'J30');
 assert.equal(url.searchParams.get('referralService'),'Pain psychology');
 // No clinical text travels in the link: the form rebuilds the dated evidence from the record.
 assert.deepEqual([...url.searchParams.keys()].sort(),['referralService','tab','workflow','workflowJourney']);
 assert.doesNotMatch(url.search,/Gabapentin|effects|2026-09-08/);
 assert.equal(new URL(referralStartHref(p.id,'Cardiology',referral),'https://example.test').searchParams.get('referralService'),null,'a service the prompt does not list is left out');
 const prompt=referralPromptPrefill(p,w),reason=prompt.reason;
 assert.deepEqual([...prompt.services],[...referralPromptRules.services]);
 assert.ok(reason.length<=1000);assert.match(reason,/prototype rule/);assert.match(reason,/2026-09-08 · Gabapentin: effects reported/);
 const html=renderToStaticMarkup(React.createElement(PatientOverview,{p,ctx:ctx(w),changeTab:()=>{}}));
 assert.match(html,/Referral to consider/);
 for(const service of referralPromptRules.services)assert.ok(html.includes('Start referral: '+service),service);
 // The worklist details show the same dated evidence.
 const details=overviewRecommendationDetails(p,w,referral);
 assert.ok(details.sources.some(s=>s.label==='Gabapentin: effects reported'&&s.date==='2026-09-08'));
});

test('the referral form reads the link once: it prefills only a service the current prompt lists, and the link is then removed',()=>{
 const w=normalizeWorkspace(seedWorkspace()),p=patient(w,'TN-DEMO-01'),prompt=referralPromptPrefill(p,w);
 assert.deepEqual(referralLinkPrefill('Pain psychology',prompt),{receivingService:'Pain psychology',reason:prompt.reason});
 for(const unknown of ['Cardiology','','pain psychology',null,undefined])assert.equal(referralLinkPrefill(unknown,prompt),undefined,String(unknown));
 assert.equal(referralLinkPrefill('Pain psychology',undefined),undefined,'no current prompt, no prefill');
 assert.equal(withoutReferralLink({pathname:'/patients/TN-DEMO-01',search:'?tab=full&workflow=results-referrals&workflowJourney=J30&referralService=Pain+psychology&referralReason=old+evidence',hash:'#j30'}),'/patients/TN-DEMO-01?tab=full&workflow=results-referrals&workflowJourney=J30#j30');
 assert.equal(withoutReferralLink({pathname:'/patients/TN-DEMO-01',search:'?referralService=x',hash:''}),'/patients/TN-DEMO-01');
 const render=search=>{globalThis.window={location:{search,pathname:'/patients/TN-DEMO-01',hash:''}};try{return renderToStaticMarkup(React.createElement(ReferralsWorkspace,{patientId:p.id,records:[],busy:false,onAction:async()=>{},referralPrompt:prompt}));}finally{delete globalThis.window;}};
 const linked=render('?referralService=Pain+psychology&referralReason=Typed+into+the+URL');
 assert.match(linked,/Prefilled from a referral prompt \(prototype rule\)/);assert.match(linked,/value="Pain psychology"/);assert.match(linked,/2026-09-08 · Gabapentin: effects reported/);
 assert.doesNotMatch(linked,/Typed into the URL/,'a reason in the URL is never used');
 for(const search of ['?referralService=Cardiology','?referralService=%3Cb%3EAny%3C%2Fb%3E',''])assert.doesNotMatch(render(search),/Prefilled from|<form/,search||'no link');
 const source=readFileSync('components/theranetrix/clinical-flows/results-referrals.tsx','utf8');
 assert.match(source,/history\.replaceState\(null,'',withoutReferralLink\(window\.location\)\)/);assert.match(source,/onDone=\{closeForm\}/);
 assert.doesNotMatch(source,/useLocationParameter\('referralReason'\)/);
});

// F16: feedback requests --------------------------------------------------------
test('saved screen feedback keeps navigation parameters only',()=>{
 assert.equal(feedbackRoute('/patients/TN-DEMO-01','?tab=full&workflow=results-referrals&workflowJourney=J30&referralService=Pain+psychology&referralReason=2026-09-08+Gabapentin'),'/patients/TN-DEMO-01?tab=full&workflow=results-referrals&workflowJourney=J30');
 assert.equal(feedbackRoute('/review-queue','?patient=TN-1042&q=pain'),'/review-queue?patient=TN-1042');
 assert.equal(feedbackRoute('/','?anything=1'),'/');
});
test('screen feedback accepts every request type without touching patient records',()=>{
 const w=normalizeWorkspace(seedWorkspace());
 for(const intent of ['Question','Change','Keep','Hide','Remove','Prioritize']){
   const next=act(w,{type:'prototype.feedback.add',path:'/patients/TN-DEMO-01?tab=treatment',screen:'Treatment',priority:'Nice-to-have',intent,text:'Review this card.'});
   assert.equal(next.prototypeFeedback[0].intent,intent);assert.deepEqual(next.patients,w.patients);
 }
 assert.throws(()=>actionSchema.parse({type:'prototype.feedback.add',path:'/',screen:'Care overview',priority:'Must-have',intent:'Delete',text:'x'}));
 const source=readFileSync('components/theranetrix/prototype-feedback.tsx','utf8');
 assert.match(source,/Review request only\. Nothing on screen is hidden or deleted until the team reviews it\./);
});
test('feedback pins record request types and tell reviewers nothing is hidden or deleted',()=>{
 const styles=[],listeners={};
 const sandbox={window:{FBAnchor:{configure(){}}},location:{pathname:'/',search:''},history:{},URLSearchParams,PopStateEvent:class{},
   document:{querySelector:()=>null,head:{appendChild:node=>styles.push(node)},createElement:()=>({setAttribute(){},textContent:''}),addEventListener:(type,fn)=>{listeners[type]=fn;}}};
 vm.runInNewContext(readFileSync('public/feedback-pin/theranetrix-config.js','utf8'),sandbox);
 const cfg=sandbox.window.FEEDBACK_CONFIG,levels=JSON.parse(JSON.stringify(cfg.importance));
 assert.deepEqual(levels.map(l=>l.value),['question','keep','hide','change','prioritize','remove']);
 // The pin composer and the Feedback dialog offer the same request types, labels and order.
 assert.deepEqual(levels.map(l=>[l.value,l.label]),feedbackRequests.map(r=>[r.value.toLowerCase(),r.label]));
 // feedback.js defaults a new pin to "medium", else the middle entry.
 assert.ok(!levels.some(l=>['blocker','high','medium','low'].includes(l.value)));
 assert.equal(levels[Math.floor(levels.length/2)].value,'change');
 assert.ok(levels.every(l=>l.label&&/^#[0-9a-f]{6}$/i.test(l.color)&&!['#dc2626','#087f75'].includes(l.color.toLowerCase())));
 assert.match(styles[0].textContent,/\.fb-composer::after \{ content: "Review request only\. Nothing on screen is hidden or deleted until the team reviews it\./);
 // The select is renamed once the composer takes focus.
 const select={getAttribute:()=>'Importance',setAttribute(name,value){this[name]=value;}};
 listeners.focusin({target:{closest:()=>({querySelector:()=>select})}});
 assert.equal(select['aria-label'],'Request type');
});
test('feedback pins saved with an earlier severity keep showing it, and editing only the text keeps it',()=>{
 const sandbox={window:{FBAnchor:{configure(){}}},location:{pathname:'/',search:''},history:{},URLSearchParams,PopStateEvent:class{},document:{querySelector:()=>null,head:{appendChild(){}},createElement:()=>({setAttribute(){},textContent:''}),addEventListener(){}}};
 vm.runInNewContext(readFileSync('public/feedback-pin/theranetrix-config.js','utf8'),sandbox);
 const engine=readFileSync('public/feedback-pin/feedback.js','utf8'),cut=(from,to)=>{const start=engine.indexOf(from);return engine.slice(start,engine.indexOf(to,start)+to.length);};
 const levels=cut('var IMPORTANCE_DEFAULTS','\n  }\n'),escape=cut('function escapeHtml','\n  }\n'),composer=cut('var currentImp','.join("");'),save=cut('var impValue','IMPORTANCE_DEFAULT;');
 const run=importance=>vm.runInNewContext(`${levels}\n${escape}\nvar editing={importance:${JSON.stringify(importance)}};\n${composer}\nvar importance=(impOptions.match(/<option value="([^"]*)" selected>/)||[])[1];${save}\n({impOptions,impValue,importanceFor,IMPORTANCE_DEFAULT})`,{cfg:sandbox.window.FEEDBACK_CONFIG});
 const legacy=run('blocker');
 assert.ok(legacy.impOptions.startsWith('<option value="blocker" selected>Blocker (earlier severity)</option><option value="question">Question</option>'),'the earlier value is listed first and stays selected');
 assert.equal((legacy.impOptions.match(/ selected/g)||[]).length,1);
 assert.equal(legacy.impValue,'blocker','saving without touching the select keeps it');
 assert.deepEqual({...legacy.importanceFor('medium')},{value:'medium',label:'Medium (earlier severity)',color:'#6b7280',legacy:true},'ring, chip and export keep a label');
 assert.equal(legacy.importanceFor('constructor').label,'constructor');assert.equal(legacy.importanceFor(''),null);
 const fresh=run(undefined);
 assert.equal(fresh.IMPORTANCE_DEFAULT,'change');assert.match(fresh.impOptions,/^<option value="question">/);assert.match(fresh.impOptions,/<option value="change" selected>Suggest a change<\/option>/);
 assert.equal(run('keep').impOptions.match(/<option value="keep" selected>Keep as is<\/option>/)?.length,1);assert.doesNotMatch(run('keep').impOptions,/earlier severity/);
});

// Tablet landscape Treatment: the frozen header stack stays within about a third of the screen.
test('on the Treatment tab at 901-1250px the chart header scrolls away under the identity pin and the table header sticks below it',()=>{
 const sheet=readFileSync('app/redesign-treatment.css','utf8'),start=sheet.indexOf('@media(min-width:901px) and (max-width:1250px){\n  .feedback-patient:has(');
 assert.ok(start>0);const block=sheet.slice(start,sheet.indexOf('\n}\n',start));
 const scope='.feedback-patient:has(.patient-tabs>[data-state=active] .treatment-feedback)';
 assert.ok(block.split('\n').slice(1).every(line=>line.trim().startsWith('/*')||line.trim().startsWith(scope)),'every rule is limited to the active Treatment tab');
 assert.match(block,/\.patient-chart-header\{position:relative;top:auto\}/);
 const pin=block.match(/\.patient-identity-pin\{([^}]*)\}/)[1],top=Number(pin.match(/top:(\d+)px/)[1]),height=Number(pin.match(/height:(\d+)px/)[1]);
 assert.match(pin,/position:sticky/);assert.match(block,/\.patient-identity-pin\.is-pinned\{visibility:visible\}/);
 const thead=Number(block.match(/\.pst-table thead th\{top:(\d+)px\}/)[1]);
 assert.equal(thead,top+height,'the table header sticks right below the pin');
 // About 70px for a two-line table header with direction hints: the frozen stack is under a third of a 768px landscape screen.
 assert.ok(thead+70<=768/3,`frozen stack ${thead+70}px`);
 assert.match(block,/--chart-anchor-offset:106px/);
});

// F12: touch targets ------------------------------------------------------------
test('tablet touch rules only apply to coarse pointers and load after every other sheet',()=>{
 const sheet=readFileSync('app/tablet.css','utf8'),layout=readFileSync('app/layout.tsx','utf8');
 const imports=[...layout.matchAll(/import "\.\/([\w-]+\.css)";/g)].map(m=>m[1]);
 assert.equal(imports.at(-1),'tablet.css');
 const body=sheet.replace(/\/\*[\s\S]*?\*\//g,'').trim();
 assert.match(body,/^@media \(pointer:coarse\)\{[\s\S]*\}$/,'every rule sits inside the coarse-pointer query');
 for(const selector of ['.pst-category-tabs button','[data-slot=slider','.advisor-dock-head button','.patient-allergy-dismiss','.checkin-chips button','.patient-allergy-chip'])
   assert.ok(sheet.includes(selector),selector);
 assert.ok((body.match(/44px/g)||[]).length>=8);
});
