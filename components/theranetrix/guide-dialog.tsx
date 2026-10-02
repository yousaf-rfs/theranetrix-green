'use client';
import {useRef} from 'react';
import {CircleHelp} from 'lucide-react';
import {Dialog,DialogClose,DialogContent,DialogDescription,DialogHeader,DialogTitle,DialogTrigger} from '@/components/ui/dialog';
import {guideScreenFor,guideSections,guideSegments} from '@/lib/guide-content';
import {useLocationParameter} from './location-state';
import {Badge,Term} from './ui';

function GuideText({text}:{text:string}){return <>{guideSegments(text).map((part,index)=>typeof part==='string'?part:<Term key={index} t={part.term}/>)}</>;}

/** Top-bar "?" that opens the "How TheraNetrix works" guide at the entry for the current screen. */
export function GuideButton({path}:{path:string}){
  const tab=useLocationParameter('tab'),screen=guideScreenFor(path,tab),body=useRef<HTMLDivElement>(null);
  const jump=(id:string)=>{const target=body.current?.querySelector<HTMLElement>('#guide-'+id);target?.scrollIntoView({block:'start'});target?.focus({preventScroll:true});};
  return <Dialog>
    <DialogTrigger asChild><button type="button" className="icon-btn" aria-label="How TheraNetrix works" title="How TheraNetrix works"><CircleHelp size={20}/></button></DialogTrigger>
    <DialogContent className="recommendation-dialog" onOpenAutoFocus={event=>{if(!screen)return;event.preventDefault();jump('screen-'+screen);}}>
      <DialogHeader><span className="recommendation-eyebrow">Guide · prototype</span><DialogTitle>How TheraNetrix works</DialogTitle><DialogDescription>General orientation. For a specific result, open its Why this… details.</DialogDescription></DialogHeader>
      <div ref={body} className="recommendation-scroll recommendation-explanation">
        <nav aria-label="Guide sections"><ul className="flex flex-wrap gap-x-4 gap-y-1 mb-5">{guideSections.map(section=><li key={section.id}><button type="button" className="text-link" onClick={()=>jump(section.id)}>{section.title}</button></li>)}</ul></nav>
        {guideSections.map(section=><section key={section.id} id={'guide-'+section.id} tabIndex={-1} aria-labelledby={'guide-'+section.id+'-title'} className={'recommendation-section'+(section.tone==='limits'?' recommendation-considerations':'')}>
          <h3 id={'guide-'+section.id+'-title'}>{section.title}</h3>
          {section.intro&&<p className="text-[13px] leading-relaxed mb-3"><GuideText text={section.intro}/></p>}
          {section.steps&&<ol className="list-decimal pl-5 grid gap-2.5 text-[13px] leading-relaxed mb-3">{section.steps.map(step=><li key={step.title}><strong>{step.title}.</strong> <GuideText text={step.text}/></li>)}</ol>}
          {section.screens&&<ul>{section.screens.map(entry=><li key={entry.id} id={'guide-screen-'+entry.id} tabIndex={-1} className={entry.id===screen?'advisor-spotlight':undefined}><strong>{entry.name}</strong>{entry.id===screen&&<> <Badge tone="teal">This screen</Badge></>}: <GuideText text={entry.text}/></li>)}</ul>}
          {section.items&&<ul>{section.items.map(item=><li key={item}><GuideText text={item}/></li>)}</ul>}
        </section>)}
      </div>
      <footer className="recommendation-footer"><span>Reading this guide does not change the record.</span><DialogClose asChild><button type="button">Close guide</button></DialogClose></footer>
    </DialogContent>
  </Dialog>;
}
