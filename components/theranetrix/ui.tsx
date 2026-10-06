'use client';
import {useId,type ReactNode,type CSSProperties} from 'react';
import {ArrowDownRight,ArrowUpRight,ChevronDown,ChevronRight,Inbox,Info} from 'lucide-react';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {Popover,PopoverTrigger,PopoverContent} from '@/components/ui/popover';
import {Progress} from '@/components/ui/progress';
import {Empty,EmptyHeader,EmptyMedia,EmptyTitle,EmptyDescription} from '@/components/ui/empty';
import {visitObservations,visitMetrics} from '@/lib/visit-observations';
import {type Patient,latest} from '@/lib/theranetrix';
import {glossary,glossaryEntry,type GlossaryTerm} from '@/lib/glossary';
function DefinitionPopover({term,definition,children}:{term:string;definition:string;children:ReactNode}){return <Popover><PopoverTrigger asChild>{children}</PopoverTrigger><PopoverContent className="acronym-popover" side="bottom"><strong>{term}</strong><p>{definition}</p></PopoverContent></Popover>;}
/** Info button beside a term. Its text comes from lib/glossary.ts; pass definition only for a term the glossary does not hold. */
export function AcronymHelp({term,definition=glossaryEntry(term)?.definition??''}:{term:string;definition?:string}){return <DefinitionPopover term={term} definition={definition}><button type="button" className="acronym-help" title={definition} aria-label={'About '+term}><Info size={14}/></button></DefinitionPopover>;}
/** A glossary term in running text or a heading: dotted underline, definition on hover (title) and on tap, click, or Enter (popover). The term itself is the button, so a heading keeps its plain name. Do not place inside a link or another button. */
export function Term({t,children}:{t:GlossaryTerm;children?:ReactNode}){const {definition}=glossary[t];return <DefinitionPopover term={t} definition={definition}><button type="button" className="glossary-term" title={definition}>{children??t}</button></DefinitionPopover>;}
export function Badge({children,tone='neutral'}:{children:ReactNode;tone?:string}){return <span className={'badge '+tone}>{children}</span>;}
export function Status({value}:{value:string}){return <Badge tone={['Needs review','High','Open'].includes(value)?'rose':['On track','Resolved','Completed'].includes(value)?'teal':['Monitoring','Medium','Acknowledged'].includes(value)?'amber':'neutral'}>{value}</Badge>;}
export function Avatar({patient,size='normal'}:{patient:Patient;size?:string}){
  // A stable visual hue keeps each patient's avatar consistent when filtering or sorting.
  const avatarHue=(Array.from(patient.id).reduce((hash,char)=>(hash*31+char.charCodeAt(0))>>>0,0)%360)*137.508%360;
  return <span className={'patient-avatar '+size} style={{background:patient.color,'--patient-avatar-color':patient.color,'--patient-avatar-hue':avatarHue} as CSSProperties}>{patient.initials}</span>;
}
export function PatientName({patient,sub}:{patient:Patient;sub?:string}){return <div className="person"><Avatar patient={patient}/><div><strong>{patient.name}</strong><small>{sub??patient.id}</small></div></div>;}
export function Picker({value,onChange,options,label,className=''}:{value:string;onChange:(v:string)=>void;options:(string|{value:string;label:string})[];label:string;className?:string}){return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} className={'picker '+className}><SelectValue placeholder={label}/></SelectTrigger><SelectContent>{options.map(o=>{const v=typeof o==='string'?o:o.value;return <SelectItem key={v} value={v}>{typeof o==='string'?o:o.label}</SelectItem>;})}</SelectContent></Select>;}
export function Panel({title,subtitle,action,children,className='',id,journey}:{title?:string;subtitle?:string;action?:ReactNode;children:ReactNode;className?:string;id?:string;journey?:string}){const headingId=useId();return <section id={id} aria-labelledby={title?headingId:undefined} className={'panel '+className}>{title&&<div className="panel-head"><div><h2 id={headingId} data-journey={journey}>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>{action}</div>}{children}</section>;}
export function DetailSection({title,description,meta,children,defaultOpen=false,className=''}:{title:string;description?:string;meta?:ReactNode;children:ReactNode;defaultOpen?:boolean;className?:string}){return <details className={'detail-section '+className} open={defaultOpen||undefined}><summary><span className="detail-section-heading"><strong>{title}</strong>{description&&<small>{description}</small>}</span>{meta&&<span className="detail-section-meta">{meta}</span>}<ChevronDown className="detail-section-chevron" size={17}/></summary><div className="detail-section-content">{children}</div></details>;}
export function EmptyState({title='Nothing here yet',description='New items will appear here.'}:{title?:string;description?:string}){return <Empty className="empty-state"><EmptyHeader><EmptyMedia variant="icon"><Inbox/></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader></Empty>;}
export function PageTitle({eyebrow,title,description,actions}:{eyebrow?:string;title:string;description?:string;actions?:ReactNode}){return <div className="page-title"><div>{eyebrow&&<div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description&&<p>{description}</p>}</div><div className="page-actions">{actions}</div></div>;}
export function MiniTrend({values,color='#238b7c'}:{values:number[];color?:string}){if(values.length<2)return <span className="muted">No trend yet</span>;const points=values.slice(-7).map((v,i,a)=>`${i*75/(a.length-1)},${30-v*2.5}`).join(' ');return <svg viewBox="-3 0 82 36" width="82" height="36" aria-label={'Trend: '+values.join(', ')} role="img"><polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;}
export function TrendChart({patient,metric='pain',all=false}:{patient:Patient;metric?:'pain'|'sleep'|'function';all?:boolean}){
  const points=visitObservations(patient).slice(-7),keys=all?visitMetrics:[metric];
  if(!points.length)return <EmptyState title="Waiting for a first check-in" description="A patient check-in will start this timeline."/>;
  const colors={pain:'#238b7c',function:'#6b81c5',sleep:'#a97628'},times=points.map(p=>Date.parse(p.date)),span=times.at(-1)!-times[0];
  const x=(i:number)=>points.length===1?300:span?50+(times[i]-times[0])*500/span:50+i*500/(points.length-1),y=(v:number)=>190-v*15;
  return <div className="trend-chart"><svg viewBox="0 0 585 240" role="img" aria-label={`${patient.name}: ${all?'pain, daily function, and sleep':metric} self-reports on a scale from 0 to 10`}>
    {[0,2,4,6,8,10].map(v=><g key={v}><line x1="45" y1={y(v)} x2="560" y2={y(v)} stroke="#dce4e9" strokeDasharray="3 4"/><text x="23" y={y(v)+4} textAnchor="middle" fill="#546979" fontSize="12">{v}</text></g>)}
    {keys.map(key=>{const segments:string[][]=[];let segment:string[]=[];points.forEach((point,i)=>{if(point[key]===null){if(segment.length)segments.push(segment);segment=[];}else segment.push(`${x(i)},${y(point[key]!)}`);});if(segment.length)segments.push(segment);return <g key={key}>{segments.map((line,i)=><polyline key={i} points={line.join(' ')} fill="none" stroke={colors[key]} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>)}{points.map((point,i)=>point[key]===null?null:<circle key={i} cx={x(i)} cy={y(point[key]!)} r="4.5" fill="white" stroke={colors[key]} strokeWidth="2"><title>{point.date+': '+point[key]+'/10 · '+point.source}</title></circle>)}</g>;})}
    {[...new Set([0,Math.floor((points.length-1)/2),points.length-1])].map(i=><text key={i} x={x(i)} y="220" textAnchor="middle" fill="#546979" fontSize="12">{formatDate(points[i].date)}</text>)}
  </svg>{all&&<div className="legend"><span><i style={{background:colors.pain}}/>Pain: lower is better</span><span><i style={{background:colors.function}}/>Daily function: higher is better</span><span><i style={{background:colors.sleep}}/>Sleep quality: higher is better</span></div>}{points.some(point=>keys.some(key=>point[key]===null))&&<p className="chart-foot">A gap means this measure was not answered in that report.</p>}</div>;
}
export function Outcome({title,value,unit='/ 10',change,inverse=false}:{title:string;value:number|string;unit?:string;change?:number;inverse?:boolean}){const good=change!==undefined&&(inverse?change<=0:change>=0);return <div className="outcome"><p>{title}</p><strong>{value}<small>{unit}</small></strong>{change!==undefined&&<span className={good?'text-teal':'text-rose'}>{change<=0?<ArrowDownRight size={15}/>:<ArrowUpRight size={15}/>} {Math.abs(change)} from baseline</span>}</div>;}
export function Completion({value,label}:{value:number;label?:string}){return <div className="completion"><div><span>{label??'Complete'}</span><strong>{value}%</strong></div><Progress value={value} aria-label={label??'Completion'}/></div>;}
export function PatientLink({patient}:{patient:Patient}){return <a className="patient-link" href={'/patients/'+patient.id}><PatientName patient={patient}/><ChevronRight size={17}/></a>;}
export function formatDate(d:string,withTime=false){if(!d)return 'Not scheduled';const date=new Date(d.length===10?d+'T12:00:00':d);return date.toLocaleDateString('en-US',{month:'short',day:'numeric',...(withTime&&d.length>10?{hour:'numeric',minute:'2-digit'}:{})});}
export {latest};

/** A saved review detail can hold several lines (a rule-based flag lists what matched, the values and the rule); each shows as its own line. */
export function DetailLines({text}:{text:string}){return <>{text.split('\n').filter(line=>line.trim()).map((line,index)=><span key={index} className="block">{line}</span>)}</>;}

/** Height covered by the sticky bars at the top of a patient record once the page scrolls: the top bar, the
 * sticky chart header (where it is sticky) and the pinned identity line (tablet and phone widths). Section
 * jumps land below this so a target is never hidden under a sticky bar. */
export function stickyRecordOffset():number{
  const bottom=(selector:string,pinned:boolean)=>{const el=document.querySelector<HTMLElement>(selector);if(!el)return 0;const style=getComputedStyle(el);if(style.display==='none')return 0;
    if(pinned){const top=parseFloat(style.top);return style.position==='sticky'&&Number.isFinite(top)?top+el.offsetHeight:0;}
    return Math.max(0,el.getBoundingClientRect().bottom);};
  const navigation=bottom('.patient-tabs > .patient-record-flow',true);
  if(navigation)return Math.max(bottom('.topbar',false),navigation);
  return Math.max(bottom('.topbar',false),bottom('.patient-chart-header',false),bottom('.patient-identity-pin',true));
}
