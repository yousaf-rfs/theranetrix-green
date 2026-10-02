import type {Review,Task} from '@/lib/theranetrix';
import {formatDate} from './ui';

export function ReviewHistory({review}:{review:Review}){
  if(!review.history?.length)return null;
  return <details className="record-transition-history care-record-history"><summary>Recorded review history <span>{review.history.length}</span></summary><ol>{review.history.map((entry,i)=><li key={entry.date+i}><article><header><strong>{entry.status}</strong><time dateTime={entry.date||undefined}>{entry.date?formatDate(entry.date,true):'Earlier date not recorded'}</time></header><p>{entry.resolution}</p><small>Recorded by {entry.actor}</small></article></li>)}</ol></details>;
}
export function TaskHistory({task}:{task:Task}){
  if(!task.history?.length)return null;
  return <details className="record-transition-history care-record-history"><summary>Earlier schedule states <span>{task.history.length}</span></summary><ol>{task.history.map((entry,i)=><li key={entry.changedAt+i}><article><header><strong>{entry.done?'Completed':'Pending'}</strong><span>{formatDate(entry.date)} · {entry.time}</span></header><p><strong>{entry.title}</strong><br/>{entry.owner??'Owner not recorded'}</p><small>{entry.reason} on {formatDate(entry.changedAt,true)} by {entry.changedBy}. This was the state before that change.</small></article></li>)}</ol></details>;
}
