'use client';
import {useState} from 'react';
import {Search,Plus,FileText,ChevronDown} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {Patient} from '@/lib/theranetrix';
import type {Context} from './app';
import {Badge,Panel,Picker,EmptyState,formatDate} from './ui';

export function PatientNotes({p,ctx}:{p:Patient;ctx:Context}){
  const [query,setQuery]=useState(''),[type,setType]=useState('All note types'),[count,setCount]=useState(10);
  const notes=[...p.notes].sort((a,b)=>b.date.localeCompare(a.date)).filter(n=>(type==='All note types'||n.type===type)&&[n.text,n.author,n.type].join(' ').toLowerCase().includes(query.toLowerCase()));
  return <Panel title="Encounter documentation" subtitle="Latest first. Search the saved discussion, reasoning, and next steps." className="clinician-notes" action={<Button onClick={()=>ctx.open('note',p)}><Plus size={15}/>Add note</Button>}>
    <div className="clinician-record-toolbar"><label className="clinician-record-search"><Search size={17}/><Input aria-label="Search patient notes" value={query} onChange={e=>{setQuery(e.target.value);setCount(10);}} placeholder="Search notes or author"/></label><Picker label="Filter note type" value={type} onChange={value=>{setType(value);setCount(10);}} options={['All note types',...new Set(p.notes.map(n=>n.type))]}/><span role="status">{notes.length} note{notes.length===1?'':'s'}</span></div>
    {notes.slice(0,count).map(n=><details className="document-note" key={n.id}><summary><header><Badge tone={n.type==='Care plan'?'teal':'neutral'}>{n.type}</Badge><time dateTime={n.date}>{formatDate(n.date,true)}</time></header><p className="clinician-note-preview">{n.text.split('\n')[0]}</p><small><FileText size={14}/>{n.author}<span>Read full note <ChevronDown size={14}/></span></small></summary><div className="clinician-note-full"><p>{n.text}</p></div></details>)}
    {!notes.length&&<EmptyState title={p.notes.length?'No matching notes':'No documentation yet'} description={p.notes.length?'Try another phrase or note type.':'Add the discussion and agreed next steps when ready.'}/>}
    {notes.length>count&&<div className="clinician-record-more"><Button variant="outline" onClick={()=>setCount(value=>value+10)}>Show 10 more notes</Button><span>{Math.min(count,notes.length)} of {notes.length} shown</span></div>}
  </Panel>;
}
