'use client';
import {ArrowUpRight,FileSearch} from 'lucide-react';
import {Dialog,DialogTrigger,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogClose} from '@/components/ui/dialog';

export type RecommendationSource={label:string;value:string;href?:string;date?:string};
export type RecommendationDetailsProps={title:string;summary?:string;rationale:string[];sources?:RecommendationSource[];considerations?:string[];alternatives?:string[];limitations?:string[];label?:string};

export function recommendationSourceHref(href?:string){
  if(!href)return undefined;
  if(href.startsWith('/')&&!href.startsWith('//')&&!href.includes('\\'))return href;
  try{const url=new URL(href);return url.protocol==='https:'?url.href:undefined;}catch{return undefined;}
}
function Reasons({title,items,className=''}:{title:string;items:string[];className?:string}){
  if(!items.length)return null;
  return <section className={'recommendation-section '+className}><h3>{title}</h3><ul>{items.map((text,i)=><li key={i}>{text}</li>)}</ul></section>;
}
function SourceDate({value}:{value:string}){
  const date=new Date(value.length===10?value+'T12:00:00':value);
  const text=Number.isFinite(date.getTime())?date.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',...(value.length>10?{hour:'numeric',minute:'2-digit',timeZoneName:'short'} as const:{})}):value;
  return <time className="recommendation-source-date" dateTime={Number.isFinite(date.getTime())?value:undefined}>{text}</time>;
}

/** The explanation presents supplied records and rules, never generates a clinical justification. */
export function RecommendationExplanation({title,summary,rationale,sources=[],considerations=[],alternatives=[],limitations=[]}:RecommendationDetailsProps){
  return <div className="recommendation-explanation" data-recommendation={title}>
    {summary&&<p className="recommendation-summary">{summary}</p>}
    <div className="recommendation-explanation-grid"><div>
      <Reasons title="Why this is shown" items={rationale.length?rationale:['A detailed rationale has not been recorded.']}/>
      <Reasons title="What to check before acting" items={considerations} className="recommendation-considerations"/>
      <Reasons title="Alternatives and trade-offs" items={alternatives}/>
      <Reasons title="Limitations and missing information" items={limitations} className="recommendation-limitations"/>
    </div><aside className="recommendation-sources" aria-label="Supporting records"><h3>Supporting records</h3>
      {sources.length?sources.map((source,i)=>{const href=recommendationSourceHref(source.href);return <article key={i}><h4>{source.label}</h4>{source.date&&<SourceDate value={source.date}/>}<p>{source.value}</p>{href&&<a href={href} target="_blank" rel="noopener noreferrer" className="recommendation-source-link" aria-label={'Open source: '+source.label+' (opens in a new tab)'}>Open source <span>(new tab)</span><ArrowUpRight size={14}/></a>}</article>;}):<p className="recommendation-source-empty">No supporting record or citation is attached to this item.</p>}
    </aside></div>
  </div>;
}

export function RecommendationDetails(props:RecommendationDetailsProps){
  const label=props.label??'Reason & sources';
  return <Dialog><DialogTrigger asChild><button type="button" className="recommendation-trigger" aria-label={label+': '+props.title} onClick={event=>event.stopPropagation()}><FileSearch size={15}/><span>{label}</span></button></DialogTrigger>
    <DialogContent className="recommendation-dialog" onClick={event=>event.stopPropagation()}>
      <DialogHeader><span className="recommendation-eyebrow">Reasoning & supporting records</span><DialogTitle>{props.title}</DialogTitle><DialogDescription>Review the basis for this item and the information that still needs your judgment.</DialogDescription></DialogHeader>
      <div className="recommendation-scroll"><RecommendationExplanation {...props}/></div>
      <footer className="recommendation-footer"><span>Reviewing this explanation does not change the record.</span><DialogClose asChild><button type="button">Back to review</button></DialogClose></footer>
    </DialogContent>
  </Dialog>;
}
