'use client';
import {useState} from 'react';
import {ArrowUpRight,Bell} from 'lucide-react';
import {Popover,PopoverTrigger,PopoverContent} from '@/components/ui/popover';
import type {NeedsAction} from '@/lib/patient-overview';
import {Status,formatDate} from './ui';
import styles from './needs-action.module.css';

const shown=5;
/** Top-bar bell. Rows sit in labelled groups; the badge counts patients, so one patient event listed in two groups is counted once, and its label names that unit (the sidebar Review queue badge counts reviews). Plain links reload the chart so its tab parameter applies. */
export function NeedsActionBell({attention,label}:{attention:NeedsAction;label?:string}){
  const [open,setOpen]=useState(false),{groups,patients}=attention,plural=patients===1?'':'s';
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><button type="button" className={label?"icon-btn forest-sidebar-notification":"icon-btn"} aria-label={patients?`Needs action: ${patients} patient${plural}`:'Needs action: nothing recorded'} title={patients?`Needs action: ${patients} patient${plural}, each counted once (the Review queue counts reviews)`:'Needs action: nothing recorded'}><Bell size={20}/>{label&&<span>{label}</span>}{patients>0&&<span className="notification-count" aria-hidden="true">{patients}</span>}</button></PopoverTrigger>
    <PopoverContent align={label?"start":"end"} className={styles.panel} aria-labelledby="needs-action-title">
      <div className={styles.head}><h2 id="needs-action-title">Needs action</h2><span>{patients} patient{plural} · each counted once</span></div>
      {groups.map(g=><section key={g.id} className={styles.group} aria-labelledby={'needs-action-'+g.id}>
        <div className={styles.groupHead}><h3 id={'needs-action-'+g.id}>{g.label} <span>{g.rows.length}</span></h3><small>{g.description}</small></div>
        {g.rows.length?<ul>{g.rows.slice(0,shown).map(r=><li key={r.id}><a href={r.href} onClick={()=>setOpen(false)}><span className={styles.rowTitle}><strong>{r.patientName}</strong>{r.priority&&<Status value={r.priority}/>}</span><span>{r.title}</span><small>{g.id==='reviews'?`Recorded priority · ${r.status} · ${r.detail} · ${formatDate(r.date)}`:g.id==='replies'?`${formatDate(r.date,true)} · ${r.detail}`:`${r.detail} · scheduled ${formatDate(r.date)}`}</small></a></li>)}</ul>:<p className={styles.empty}>None recorded</p>}
        {g.rows.length>shown&&<a className={'text-link '+styles.viewAll} href={g.href}>View all {g.rows.length} <ArrowUpRight size={14}/></a>}
      </section>)}
      <p className={styles.note}>Priority is the one recorded on each review, not a calculated urgency score. Reply needed means the latest message saved in this workspace is from the patient. Messages are not delivered outside this workspace.</p>
    </PopoverContent></Popover>;
}
