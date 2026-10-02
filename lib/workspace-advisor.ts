import {activeMedications} from './medications';
import {patientPanelRow} from './patient-panel';
import {featureEnabled,type Patient,type Workspace} from './theranetrix';
import {visitObservations} from './visit-observations';

// Advisor questions for the screens outside a patient record. Each answer is read
// from the saved workspace when it is shown and lists the patients behind it, each with
// a link to the section of their record that holds the source.
export type WorkspacePage='overview'|'patients'|'reviews'|'messages'|'schedule';
export type WorkspaceItem={label:string;detail:string;href:string};
export type WorkspaceSuggestion={id:string;question:string;answer:string;items:WorkspaceItem[]};

export const workspacePageLabels:Record<WorkspacePage,string>={overview:'Care overview',patients:'Patients',reviews:'Review queue',messages:'Messages',schedule:'Schedule'};
export function workspacePage(path:string):WorkspacePage|undefined{
  return path==='/'?'overview':path==='/patients'?'patients':path==='/review-queue'?'reviews':path==='/messages'?'messages':path==='/schedule'?'schedule':undefined;
}

const day=86400000;
const shortDate=(value:string)=>{const date=new Date(value.length===10?value+'T12:00:00':value);return Number.isFinite(date.getTime())?date.toLocaleDateString('en-US',{month:'short',day:'numeric'}):value;};
const chart=(p:Patient,tab:string,anchor?:string)=>`/patients/${encodeURIComponent(p.id)}?tab=${tab}${anchor?'#'+anchor:''}`;
const plural=(count:number,word:string,many=word+'s')=>`${count} ${count===1?word:many}`;

function needsFirst(w:Workspace):WorkspaceSuggestion{
  const ranked=w.patients.map(p=>({p,row:patientPanelRow(p,w),reviews:w.reviews.filter(r=>r.patientId===p.id&&r.status!=='Resolved').sort((a,b)=>['High','Medium','Routine'].indexOf(a.priority)-['High','Medium','Routine'].indexOf(b.priority))}))
    .filter(entry=>entry.reviews.length).sort((a,b)=>a.row.alertPriority-b.row.alertPriority||b.reviews.length-a.reviews.length||a.p.name.localeCompare(b.p.name));
  const high=ranked.filter(entry=>entry.row.alertPriority===0).length;
  return {id:'first',question:'Who needs me first?',
    answer:ranked.length?`${plural(ranked.length,'patient')} ${ranked.length===1?'has':'have'} open reviews${high?`, ${high} with high priority`:''}. Highest priority first.`:'No patient has an open review.',
    items:ranked.slice(0,5).map(({p,reviews})=>({label:p.name,detail:`${reviews[0].priority} · ${reviews[0].title}${reviews.length>1?` · +${reviews.length-1} more`:''}`,href:chart(p,'visit','visit-concerns')}))};
}

function worse(w:Workspace):WorkspaceSuggestion{
  const rows=w.patients.flatMap(p=>{
    const points=visitObservations(p),latest=points.at(-1),previous=points.at(-2);
    if(!latest||!previous)return [];
    const changes=[latest.pain!==null&&previous.pain!==null&&latest.pain>previous.pain?`pain ${previous.pain} → ${latest.pain}`:'',latest.function!==null&&previous.function!==null&&latest.function<previous.function?`function ${previous.function} → ${latest.function}`:'',latest.sleep!==null&&previous.sleep!==null&&latest.sleep<previous.sleep?`sleep ${previous.sleep} → ${latest.sleep}`:''].filter(Boolean);
    return changes.length?[{label:p.name,detail:`${changes.join(', ')} · ${shortDate(latest.date)}`,href:chart(p,'visit','visit-observations')}]:[];
  });
  return {id:'worse',question:'Who reported getting worse?',answer:rows.length?`${plural(rows.length,'patient')} reported a worse score than their previous report.`:'Nobody’s latest report is worse than their previous one.',items:rows};
}

function sideEffects(w:Workspace):WorkspaceSuggestion{
  const rows=w.patients.flatMap(p=>activeMedications(p).filter(m=>m.tolerability==='Effects reported').map(m=>({label:p.name,detail:`${m.name}: ${m.effects||'effects reported'}`,href:chart(p,'visit','patient-medications')})));
  return {id:'effects',question:'Who has side effects on current medicine?',answer:rows.length?`${plural(rows.length,'current medicine')} with side effects reported.`:'No side effects are reported on current medicines.',items:rows};
}

function quiet(w:Workspace,now:number):WorkspaceSuggestion{
  const rows=w.patients.map(p=>({p,last:visitObservations(p).at(-1)?.date})).filter(({last})=>!last||now-Date.parse(last)>14*day)
    .sort((a,b)=>(a.last??'').localeCompare(b.last??''))
    .map(({p,last})=>({label:p.name,detail:last?`Last report ${shortDate(last)}`:'No report yet',href:chart(p,'visit','visit-observations')}));
  return {id:'quiet',question:'Who hasn’t checked in for two weeks?',answer:rows.length?`${plural(rows.length,'patient')} with no report in the last 14 days.`:'Everyone has reported in the last 14 days.',items:rows};
}

function noPlan(w:Workspace):WorkspaceSuggestion{
  const rows=w.patients.filter(p=>!p.carePlans.length).map(p=>({label:p.name,detail:p.nextVisit?`Next visit ${shortDate(p.nextVisit)}`:'No visit scheduled',href:chart(p,'visit','visit-plan')}));
  return {id:'plan',question:'Who has no agreed plan yet?',answer:rows.length?`${plural(rows.length,'patient')} without a saved care plan.`:'Every patient has a saved care plan.',items:rows};
}

function decisions(w:Workspace):WorkspaceSuggestion{
  const rows=w.patients.map(p=>({p,row:patientPanelRow(p,w)})).filter(({row})=>row.pending!=='None').map(({p,row})=>({label:p.name,detail:row.pending,href:chart(p,'treatment','treatment-decision')}));
  return {id:'decisions',question:'Who is waiting on a treatment decision?',answer:rows.length?`${plural(rows.length,'patient')} with a treatment option or engine run waiting on you.`:'No treatment decisions are waiting.',items:rows};
}

function reviewQuestions(w:Workspace,now:number):WorkspaceSuggestion[]{
  const open=w.reviews.filter(r=>r.status!=='Resolved'),name=(id:string)=>w.patients.find(p=>p.id===id);
  const item=(r:typeof open[number],detail:string)=>{const p=name(r.patientId);return p?[{label:p.name,detail,href:chart(p,'visit','visit-concerns')}]:[];};
  const high=open.filter(r=>r.priority==='High');
  const oldest=[...open].sort((a,b)=>a.created.localeCompare(b.created));
  const unacknowledged=open.filter(r=>r.status==='Open');
  return [
    {id:'high',question:'Which reviews are high priority?',answer:high.length?`${plural(high.length,'high-priority review')} open.`:'No high-priority reviews are open.',items:high.flatMap(r=>item(r,r.title))},
    {id:'oldest',question:'What has been waiting longest?',answer:oldest.length?`The oldest open review has waited ${Math.max(0,Math.round((now-Date.parse(oldest[0].created))/day))} days.`:'No open reviews.',items:oldest.slice(0,5).flatMap(r=>item(r,`${r.title} · since ${shortDate(r.created)}`))},
    {id:'unacknowledged',question:'Which reviews has nobody picked up?',answer:unacknowledged.length?`${plural(unacknowledged.length,'review')} not yet acknowledged.`:'Every open review has been acknowledged.',items:unacknowledged.slice(0,5).flatMap(r=>item(r,`${r.priority} · ${r.title}`))},
  ];
}

function messageQuestions(w:Workspace):WorkspaceSuggestion[]{
  const waiting=w.patients.flatMap(p=>{const thread=w.messages.filter(m=>m.patientId===p.id).sort((a,b)=>a.date.localeCompare(b.date)),last=thread.at(-1);return last&&last.direction==='in'?[{label:p.name,detail:`${shortDate(last.date)} · “${last.text.length>80?last.text.slice(0,79)+'…':last.text}”`,href:chart(p,'messages','patient-messages')}]:[];});
  const handoffs=(w.advisorTurns??[]).filter(t=>t.reviewId&&w.reviews.some(r=>r.id===t.reviewId&&r.status!=='Resolved')).flatMap(t=>{const p=w.patients.find(x=>x.id===t.patientId);return p?[{label:p.name,detail:`${shortDate(t.date)} · ${t.patientText.length>80?t.patientText.slice(0,79)+'…':t.patientText}`,href:chart(p,'messages','patient-messages')}]:[];});
  return [
    {id:'reply',question:'Who is waiting for a reply?',answer:waiting.length?`${plural(waiting.length,'patient')} sent the last message in their conversation.`:'Nobody is waiting for a reply.',items:waiting},
    {id:'handoffs',question:'Which patient concerns are still open?',answer:handoffs.length?`${plural(handoffs.length,'concern')} raised through the advisor still ${handoffs.length===1?'needs':'need'} review.`:'No open concerns from patient conversations.',items:handoffs},
  ];
}

function scheduleQuestions(w:Workspace,now:number):WorkspaceSuggestion[]{
  const today=new Date(now).toISOString().slice(0,10),week=new Date(now+7*day).toISOString().slice(0,10);
  const open=w.tasks.filter(t=>!t.done).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  const row=(t:typeof open[number])=>{const p=w.patients.find(x=>x.id===t.patientId);return p?[{label:p.name,detail:`${t.title} · ${shortDate(t.date)}${t.time?' '+t.time:''}`,href:chart(p,'visit','visit-plan')}]:[];};
  const overdue=open.filter(t=>t.date<today),soon=open.filter(t=>t.date>=today&&t.date<=week);
  return [
    {id:'overdue',question:'What is overdue?',answer:overdue.length?`${plural(overdue.length,'activity','activities')} past ${overdue.length===1?'its':'their'} date.`:'Nothing is overdue.',items:overdue.flatMap(row)},
    {id:'week',question:'What is due this week?',answer:soon.length?`${plural(soon.length,'activity','activities')} in the next 7 days.`:'Nothing is due in the next 7 days.',items:soon.flatMap(row)},
  ];
}

// Typed panel questions are matched by keyword onto the questions this page already offers; nothing else is answered.
const questionWords:Record<string,RegExp>={
  first:/\b(first|priorit\w*|urgent\w*|attention|needs? me)\b/,worse:/\b(worse|worsen\w*|deteriorat\w*|declin\w*)\b/,effects:/\b(side[- ]effects?|adverse|tolera\w*)\b/,
  quiet:/\b(check(ed)?[- ]?in|quiet|no report|two weeks|14 days|not reported|inactive)\b/,plan:/\b(plans?|agreed)\b/,decisions:/\b(decid\w*|decisions?|pending|engine runs?)\b/,
  high:/\b(high|priority)\b/,oldest:/\b(oldest|longest|waiting)\b/,unacknowledged:/\b(unacknowledged|acknowledged|picked up|nobody|unassigned)\b/,
  reply:/\b(repl(y|ies|ied)|respond\w*|unanswered|waiting)\b/,handoffs:/\b(concerns?|handoffs?)\b/,overdue:/\b(overdue|late|past due|missed)\b/,week:/\b(this week|due|upcoming|next (7|seven) days)\b/,
};
export function workspaceSuggestionsForQuestion(text:string,suggestions:WorkspaceSuggestion[]):WorkspaceSuggestion[]{
  const t=text.toLowerCase().replace(/[’‘]/g,'\'').trim();
  return t.length<3?[]:suggestions.filter(s=>questionWords[s.id]?.test(t));
}

export function workspaceSuggestions(w:Workspace,page:WorkspacePage,now=Date.now()):WorkspaceSuggestion[]{
  const assessments=featureEnabled(w,'assessments');
  if(page==='reviews')return reviewQuestions(w,now);
  if(page==='messages')return messageQuestions(w);
  if(page==='schedule')return scheduleQuestions(w,now);
  if(page==='patients')return [needsFirst(w),...(assessments?[quiet(w,now)]:[]),noPlan(w),decisions(w)];
  return [needsFirst(w),...(assessments?[worse(w)]:[]),sideEffects(w),decisions(w),...(assessments?[quiet(w,now)]:[])];
}
