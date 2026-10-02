'use client';
import {useEffect,useId,useMemo,useRef,useState,type FormEvent} from 'react';
import {ArrowRight,Bot,ChevronDown,Lightbulb,Send,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {advisorAnswerForQuestion,advisorAnswerSegments,advisorPage,advisorPageLabels,advisorRubric,advisorSuggestions,type AdvisorPage,type AdvisorTarget} from '@/lib/advisor-guide';
import {inferAdvisorIntent} from '@/lib/engine-demo';
import {featureEnabled,type Patient} from '@/lib/theranetrix';
import {workspacePageLabels,workspaceSuggestions,workspaceSuggestionsForQuestion,type WorkspacePage} from '@/lib/workspace-advisor';
import {patientRecordViewSearch} from '@/lib/workflow-navigation';
import type {Context} from './app';
import {AdvisorAnswerDetails} from './engine-recommendation';
import {dobText} from './patient-identity';
import {Term,formatDate,stickyRecordOffset} from './ui';
import {ADVISOR_NAME} from '@/lib/product-names';

// Move to the section that holds the answer and mark it briefly. Inside the patient
// record this switches tab in place; elsewhere it opens the record at that section.
// `current` is the record tab on screen (More views included), not the advisor page it maps to.
function showTarget(p:Patient,current:string|undefined,target:AdvisorTarget){
  if(!document.querySelector('.feedback-patient')){window.location.href=`/patients/${encodeURIComponent(p.id)}?tab=${target.tab}${target.anchor?'#'+target.anchor:''}`;return;}
  if(current!==target.tab){window.history.replaceState(null,'',patientRecordViewSearch(window.location.search,target.tab));window.dispatchEvent(new PopStateEvent('popstate'));}
  let attempts=0;
  const find=()=>{
    // An id can repeat across tabs (a hidden copy stays mounted), so take the visible one. With no anchor, open the view at its top.
    const element=target.anchor?[...document.querySelectorAll<HTMLElement>('#'+CSS.escape(target.anchor))].find(e=>e.getClientRects().length):document.querySelector<HTMLElement>(`.feedback-patient [role="tabpanel"][id$="-content-${target.tab}"]`);
    if(!element||!element.getClientRects().length){if(++attempts<90)requestAnimationFrame(find);return;}
    for(let disclosure=element.closest('details');disclosure;disclosure=disclosure.parentElement?.closest('details')??null)disclosure.open=true;
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Keep the section below the sticky bars; tall sections start at their top.
    const header=stickyRecordOffset();
    const room=window.innerHeight-Math.max(0,header),height=element.getBoundingClientRect().height;
    const top=element.getBoundingClientRect().top+window.scrollY-Math.max(0,header)-(height<room*.7?(room-height)/2:16);
    window.scrollTo({top:Math.max(0,top),behavior:reduced?'auto':'smooth'});
    if(!target.anchor)return;
    element.classList.remove('advisor-spotlight');void element.offsetWidth;element.classList.add('advisor-spotlight');
    window.setTimeout(()=>element.classList.remove('advisor-spotlight'),2600);
  };
  requestAnimationFrame(find);
}

/** Answer text with PST and CUI defined in place, the same glossary terms the guide dialog shows. */
function AdvisorText({text}:{text:string}){return <>{advisorAnswerSegments(text).map((part,index)=>typeof part==='string'?part:<Term key={index} t={part.term}/>)}</>;}

function ShowMe({target,onShow}:{target:AdvisorTarget;onShow:(target:AdvisorTarget)=>void}){
  return <button type="button" className="advisor-show-me" onClick={()=>onShow(target)}><span>Show me</span><small>{target.label}</small><ArrowRight size={15}/></button>;
}
/** The links under an answer: Show me for its source section, then a second view when there is one.
 *  Compact links (outline buttons) sit in the Earlier questions list. */
function AnswerLinks({target,more,compact=false,onShow}:{target?:AdvisorTarget;more?:AdvisorTarget;compact?:boolean;onShow:(target:AdvisorTarget)=>void}){
  const link=(to:AdvisorTarget,text:string)=><Button type="button" variant="outline" size="sm" className="h-auto whitespace-normal text-left" onClick={()=>onShow(to)}>{text}<ArrowRight size={14} aria-hidden="true"/></Button>;
  if(compact)return <div className="flex flex-wrap gap-2 mt-2">{target&&link(target,'Show me · '+target.label)}{more&&link(more,more.label)}</div>;
  return <>{target&&<ShowMe target={target} onShow={onShow}/>}{more&&<div className="mt-2">{link(more,more.label)}</div>}</>;
}

/** What the rubric answers, what it declines, and its version. Clinician-facing; the patient record dock only. */
function RubricDisclosure(){
  return <details className="advisor-history"><summary>What the {ADVISOR_NAME} answers</summary>
    <p className="mt-2">Questions about this patient’s saved record. Each answer links to the section that holds its source.</p>
    <ul className="list-disc pl-5">{advisorRubric.answers.map(item=><li key={item}>{item}</li>)}</ul>
    <p className="mt-2"><strong>It does not answer</strong></p>
    <ul className="list-disc pl-5">{advisorRubric.declines.map(item=><li key={item}>{item}</li>)}</ul>
    <p className="mt-2">Your questions and its answers are saved with the record. {advisorRubric.basis}</p>
  </details>;
}

function ClinicianAdvisor({p,ctx,page,activeId,setActiveId,asked,setAsked,onShow}:{p:Patient;ctx:Context;page:AdvisorPage;activeId:string;setActiveId:(id:string)=>void;asked:string;setAsked:(question:string)=>void;onShow:(target:AdvisorTarget)=>void}){
  const suggestions=useMemo(()=>advisorSuggestions(p,ctx.data,page),[p,ctx.data,page]);
  const turns=(ctx.data.advisorTurns??[]).filter(t=>t.patientId===p.id&&t.audience==='clinician');
  const [text,setText]=useState(''),[error,setError]=useState('');
  const pending=useRef<{signature:string;id:string}|null>(null),sending=useRef(false),list=useRef<HTMLUListElement>(null);
  const answered=asked?[...turns].reverse().find(t=>t.patientText===asked):undefined;
  const earlier=turns.filter(t=>t.id!==answered?.id).slice(-6).reverse();
  // Links are read from the same rubric that wrote the reply, so they point where the answer came from.
  const links=(question:string)=>advisorAnswerForQuestion(p,ctx.data,question);
  const typed=answered?links(answered.patientText):undefined;
  const pick=(id:string)=>{setActiveId(id);requestAnimationFrame(()=>list.current?.querySelector<HTMLElement>(`[aria-controls="advisor-answer-${id}"]`)?.focus());};
  async function send(event?:FormEvent){
    event?.preventDefault();
    const question=text.trim();
    if(!question||ctx.busy||sending.current)return;
    const command={type:'advisor.chat' as const,patientId:p.id,text:question,intent:inferAdvisorIntent(question).intent,concernUrgency:'routine' as const,language:'en' as const,audience:'clinician' as const};
    const signature=JSON.stringify(command);
    if(pending.current?.signature!==signature)pending.current={signature,id:crypto.randomUUID()};
    sending.current=true;setError('');
    try{
      if(await ctx.save({...command,requestId:pending.current.id},'Question saved')){pending.current=null;setAsked(question);setText('');setActiveId('');}
      else setError('Your question was not saved. It is still here so you can try again.');
    }catch{setError('Your question was not saved. It is still here so you can try again.');}
    finally{sending.current=false;}
  }
  return <div className="advisor-guide">
    <div className="advisor-guide-scroll" aria-live="polite">
      <p className="advisor-guide-label">Suggested for {advisorPageLabels[page]}</p>
      <ul ref={list} className="advisor-suggestions">{suggestions.map(s=>{
        const open=activeId===s.id;
        return <li key={s.id} className={open?'is-open':''}>
          <button type="button" className="advisor-question" aria-expanded={open} aria-controls={'advisor-answer-'+s.id} onClick={()=>setActiveId(open?'':s.id)}><span>{s.question}</span><ChevronDown size={16} aria-hidden="true"/></button>
          {open&&<div className="advisor-answer" id={'advisor-answer-'+s.id}><p><AdvisorText text={s.answer}/></p>{s.points.length>0&&<ul>{s.points.map(point=><li key={point}><AdvisorText text={point}/></li>)}</ul>}<AnswerLinks target={s.target} more={s.more} onShow={onShow}/></div>}
        </li>;
      })}</ul>
      {answered&&typed&&<section className="advisor-typed" aria-label="Answer to your question">
        <p className="advisor-guide-label">Your question</p>
        <p className="advisor-you">{answered.patientText}</p>
        <div className="advisor-answer"><p className="whitespace-pre-line"><AdvisorText text={answered.reply}/></p><AnswerLinks target={typed.target} more={typed.more} onShow={onShow}/>
          {typed.kind==='scope'&&<div className="flex flex-wrap gap-2 mt-2" role="group" aria-label="Suggested questions">{suggestions.map(s=><Button key={s.id} type="button" variant="outline" size="sm" className="h-auto whitespace-normal text-left" onClick={()=>pick(s.id)}>{s.question}</Button>)}</div>}
          <AdvisorAnswerDetails turn={answered} p={p} data={ctx.data}/></div>
      </section>}
      {earlier.length>0&&<details className="advisor-history"><summary>Earlier questions <span>{earlier.length}</span></summary><ol>{earlier.map(t=>{const answer=links(t.patientText);return <li key={t.id}><strong>{t.patientText}</strong><p className="whitespace-pre-line"><AdvisorText text={t.reply}/></p><small>{formatDate(t.date,true)}</small>{answer.target&&<AnswerLinks compact target={answer.target} more={answer.more} onShow={onShow}/>}</li>;})}</ol></details>}
      <RubricDisclosure/>
    </div>
    <form className="advisor-ask" onSubmit={send}>
      <Textarea aria-label="Question about this patient" rows={1} maxLength={2000} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send();}}} placeholder="Ask about this patient’s record…"/>
      <Button type="submit" size="icon" aria-label="Send question" disabled={!text.trim()||ctx.busy}><Send size={16}/></Button>
    </form>
    {error&&<p className="advisor-error" role="alert">{error}</p>}
    <p className="advisor-guide-foot">Answers come from the saved record. Decisions stay with you.</p>
  </div>;
}

export function AdvisorDock({p,ctx,startOpen=false,page:tab}:{p:Patient;ctx:Context;startOpen?:boolean;page?:string}){
  const page=advisorPage(tab??'treatment');
  const [choice,setChoice]=useState<{patientId:string;requested:boolean;open:boolean}>();
  const open=choice?.patientId===p.id&&choice.requested===startOpen?choice.open:startOpen;
  const setOpen=(value:boolean)=>setChoice({patientId:p.id,requested:startOpen,open:value});
  const [active,setActive]=useState({key:'',id:''});
  const activeId=active.key===p.id+':'+page?active.id:'';
  const setActiveId=(id:string)=>setActive({key:p.id+':'+page,id});
  const [dismissed,setDismissed]=useState<string[]>([]);
  // The latest typed question lives here, not in the panel, so its answer and links survive close and reopen.
  const [question,setQuestion]=useState({patientId:'',text:''});
  const asked=question.patientId===p.id?question.text:'';
  const setAsked=(text:string)=>setQuestion({patientId:p.id,text});
  const dialogId=useId(),trigger=useRef<HTMLButtonElement>(null),closeControl=useRef<HTMLButtonElement>(null),dock=useRef<HTMLDivElement>(null),wasOpen=useRef(open);
  const enabled=featureEnabled(ctx.data,'advisor');
  const top=useMemo(()=>enabled?advisorSuggestions(p,ctx.data,page)[0]:undefined,[enabled,p,ctx.data,page]);
  const nudgeKey=p.id+':'+page;
  useEffect(()=>{if(open)(document.getElementById(dialogId)?.querySelector<HTMLElement>('.advisor-suggestions>li.is-open .advisor-question, .advisor-question')??closeControl.current)?.focus();else if(wasOpen.current)trigger.current?.focus();wasOpen.current=open;},[open,dialogId]);
  useEffect(()=>{
    const element=dock.current,chart=element?.closest('.feedback-patient')?.querySelector('.patient-tabs');
    if(!element||!chart)return;
    let observed:Element|null=null;
    const place=()=>{
      const height=observed&&getComputedStyle(observed).position==='sticky'?observed.getBoundingClientRect().height+24:20;
      element.style.setProperty('--advisor-bottom',height+'px');
    };
    const resize=new ResizeObserver(place);
    const sync=()=>{
      const decision=chart.querySelector('.treatment-decision');
      if(decision!==observed){resize.disconnect();observed=decision;if(observed)resize.observe(observed);}
      place();
    };
    const changes=new MutationObserver(sync);
    changes.observe(chart,{childList:true,subtree:true});
    window.addEventListener('resize',place);sync();
    return()=>{resize.disconnect();changes.disconnect();window.removeEventListener('resize',place);};
  },[p.id,enabled]);
  if(!enabled)return null;
  const close=()=>setOpen(false);
  const openAdvisor=()=>{setDismissed(keys=>[...keys,nudgeKey]);setOpen(true);};
  const openWith=(id:string)=>{setActiveId(id);openAdvisor();};
  const show=(target:AdvisorTarget)=>{setDismissed(keys=>[...keys,p.id+':'+target.tab]);setOpen(false);showTarget(p,tab,target);};
  const nudge=!open&&top&&!dismissed.includes(nudgeKey);
  return <div ref={dock} className="advisor-dock feedback-advisor-dock">
    {open&&<div id={dialogId} className="advisor-dock-panel advisor-guide-panel" role="dialog" aria-modal="false" aria-label={ADVISOR_NAME+' for '+p.name} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();close();}}}>
      <header className="advisor-dock-head"><span className="advisor-head-icon"><Bot size={18}/></span><div><strong>{ADVISOR_NAME}</strong><small>{p.name} · {dobText(p.dateOfBirth)} · {advisorPageLabels[page]}</small></div><button ref={closeControl} type="button" aria-label={'Close '+ADVISOR_NAME} onClick={close}><X size={18}/></button></header>
      <ClinicianAdvisor key={p.id} p={p} ctx={ctx} page={page} activeId={activeId} setActiveId={setActiveId} asked={asked} setAsked={setAsked} onShow={show}/>
    </div>}
    {nudge&&<div className="advisor-nudge"><button type="button" className="advisor-nudge-open" onClick={()=>openWith(top.id)}><Lightbulb size={16} aria-hidden="true"/><span><small>Suggested question</small>{top.question}</span></button><button type="button" className="advisor-nudge-dismiss" aria-label="Dismiss suggested question" onClick={()=>setDismissed(keys=>[...keys,nudgeKey])}><X size={14}/></button></div>}
    <button ref={trigger} type="button" className="advisor-dock-fab" hidden={open} aria-expanded={open} aria-controls={open?dialogId:undefined} aria-label={'Ask '+ADVISOR_NAME+' about '+p.name} onClick={openAdvisor}><Bot size={20}/><span>Ask about this patient</span></button>
  </div>;
}

/** The advisor (ADVISOR_NAME) on screens outside a patient record: questions about the whole panel, each
 *  answer listing the patients behind it with a link straight to the relevant section. */
export function WorkspaceAdvisorDock({ctx,page}:{ctx:Context;page:WorkspacePage}){
  const [open,setOpen]=useState(false),[active,setActive]=useState({page:'',id:''}),[dismissed,setDismissed]=useState<string[]>([]),[query,setQuery]=useState('');
  const dialogId=useId(),trigger=useRef<HTMLButtonElement>(null),wasOpen=useRef(false);
  const enabled=featureEnabled(ctx.data,'advisor');
  const suggestions=useMemo(()=>enabled?workspaceSuggestions(ctx.data,page):[],[enabled,ctx.data,page]);
  const activeId=active.page===page?active.id:'';
  const setActiveId=(id:string)=>setActive({page,id});
  useEffect(()=>{if(open)document.getElementById(dialogId)?.querySelector<HTMLElement>('.advisor-suggestions>li.is-open .advisor-question, .advisor-question')?.focus();else if(wasOpen.current)trigger.current?.focus();wasOpen.current=open;},[open,dialogId]);
  if(!enabled||!suggestions.length)return null;
  const top=suggestions[0],nudge=!open&&!dismissed.includes(page);
  const openWith=(id:string)=>{setDismissed(keys=>[...keys,page]);setActiveId(id);setOpen(true);};
  const matches=query.trim()?ctx.data.patients.filter(p=>(p.name+' '+p.id+' '+p.condition).toLowerCase().includes(query.trim().toLowerCase())).slice(0,5):[];
  const questions=matches.length?[]:workspaceSuggestionsForQuestion(query,suggestions);
  const openQuestion=(id:string)=>{setActiveId(id);setQuery('');requestAnimationFrame(()=>document.getElementById(dialogId)?.querySelector<HTMLElement>(`[aria-controls="workspace-answer-${id}"]`)?.focus());};
  return <div className="advisor-dock feedback-advisor-dock workspace-advisor-dock">
    {open&&<div id={dialogId} className="advisor-dock-panel advisor-guide-panel" role="dialog" aria-modal="false" aria-label={ADVISOR_NAME+' for your patient panel'} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setOpen(false);}}}>
      <header className="advisor-dock-head"><span className="advisor-head-icon"><Bot size={18}/></span><div><strong>{ADVISOR_NAME}</strong><small>Your patient panel · {workspacePageLabels[page]}</small></div><button type="button" aria-label={'Close '+ADVISOR_NAME} onClick={()=>setOpen(false)}><X size={18}/></button></header>
      <div className="advisor-guide">
        <div className="advisor-guide-scroll" aria-live="polite">
          <p className="advisor-guide-label">Suggested for {workspacePageLabels[page]}</p>
          <ul className="advisor-suggestions">{suggestions.map(s=>{const isOpen=activeId===s.id;return <li key={s.id} className={isOpen?'is-open':''}>
            <button type="button" className="advisor-question" aria-expanded={isOpen} aria-controls={'workspace-answer-'+s.id} onClick={()=>setActiveId(isOpen?'':s.id)}><span>{s.question}</span>{s.items.length>0&&<b className="advisor-count">{s.items.length}</b>}<ChevronDown size={16} aria-hidden="true"/></button>
            {isOpen&&<div className="advisor-answer" id={'workspace-answer-'+s.id}><p><AdvisorText text={s.answer}/></p>{s.items.length>0&&<ul className="advisor-patient-list">{s.items.map((item,index)=><li key={item.href+index}><a href={item.href}><strong>{item.label}</strong><span>{item.detail}</span><ArrowRight size={14} aria-hidden="true"/></a></li>)}</ul>}</div>}
          </li>;})}</ul>
        </div>
        <div className="advisor-ask advisor-find"><label className="sr-only" htmlFor={dialogId+'-find'}>Find a patient to ask about, or a question above</label><Textarea id={dialogId+'-find'} rows={1} value={query} maxLength={80} placeholder="Type a patient’s name or a question…" onChange={e=>setQuery(e.target.value)}/></div>
        {matches.length>0&&<ul className="advisor-patient-list advisor-find-results">{matches.map(p=><li key={p.id}><a href={'/patients/'+encodeURIComponent(p.id)+'?tab=advisor'}><strong>{p.name}</strong><span>{p.condition} · open with the advisor</span><ArrowRight size={14} aria-hidden="true"/></a></li>)}</ul>}
        {questions.length>0&&<div className="advisor-find-results flex flex-wrap gap-2" role="group" aria-label="Matching questions">{questions.map(s=><Button key={s.id} type="button" variant="outline" size="sm" className="h-auto whitespace-normal text-left" onClick={()=>openQuestion(s.id)}>{s.question}</Button>)}</div>}
        {query.trim().length>2&&!matches.length&&!questions.length&&<p className="advisor-find-results text-xs" role="status">No patient or listed question matches. Here the advisor answers the questions above; open a patient for questions about their record.</p>}
        <p className="advisor-guide-foot">Answers come from the saved record. Decisions stay with you.</p>
      </div>
    </div>}
    {nudge&&<div className="advisor-nudge"><button type="button" className="advisor-nudge-open" onClick={()=>openWith(top.id)}><Lightbulb size={16} aria-hidden="true"/><span><small>Suggested question</small>{top.question}</span></button><button type="button" className="advisor-nudge-dismiss" aria-label="Dismiss suggested question" onClick={()=>setDismissed(keys=>[...keys,page])}><X size={14}/></button></div>}
    <button ref={trigger} type="button" className="advisor-dock-fab" hidden={open} aria-expanded={open} aria-controls={open?dialogId:undefined} aria-label={'Ask '+ADVISOR_NAME+' about your patients'} onClick={()=>{setDismissed(keys=>[...keys,page]);setOpen(true);}}><Bot size={20}/><span>Ask about your patients</span></button>
  </div>;
}
