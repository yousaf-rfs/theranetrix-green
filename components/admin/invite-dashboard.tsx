'use client';
import {useCallback,useEffect,useMemo,useState,type FormEvent} from 'react';
import {Check,Copy,KeyRound,Link2,LogOut,Mail,Plus,RefreshCw,UserRound,Users} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {Toaster} from '@/components/ui/sonner';
import styles from './invite-dashboard.module.css';

type Role='clinician'|'patient';
type Space='own'|'shared';
type Invite={id:string;name:string;email:string;role:Role;workspace:Space;note:string;createdAt:string;revokedAt:string|null;openCount:number;lastOpenedAt:string|null;lastSeenAt:string|null;link:string};
type Status={configured:boolean;signedIn:boolean};

const roleLabel:Record<Role,string>={clinician:'Clinician workspace',patient:'Patient companion'};
const spaceLabel:Record<Space,string>={own:'Own copy of the demo',shared:'Shared workspace'};
const absolute=(path:string)=>typeof window==='undefined'?path:window.location.origin+path;
function ago(iso:string|null,now:number){
  if(!iso)return '';
  const minutes=Math.round((now-Date.parse(iso))/60000);
  if(minutes<2)return 'just now';if(minutes<60)return minutes+' min ago';
  const hours=Math.round(minutes/60);if(hours<24)return hours+(hours===1?' hour ago':' hours ago');
  return new Date(iso).toLocaleDateString(undefined,{month:'short',day:'numeric'});
}
function activity(invite:Invite,now:number){
  if(invite.revokedAt)return 'Turned off '+ago(invite.revokedAt,now);
  if(!invite.openCount)return 'Not opened yet';
  const opened=`Opened ${invite.openCount===1?'once':invite.openCount+' times'}`;
  return invite.lastSeenAt?`${opened} · last active ${ago(invite.lastSeenAt,now)}`:opened;
}
const mailto=(invite:Invite)=>'mailto:'+encodeURIComponent(invite.email)+'?subject='+encodeURIComponent('Your TheraNetrix link')+'&body='+encodeURIComponent(`Hi ${invite.name},\n\nHere is your personal link to TheraNetrix:\n${absolute(invite.link)}\n\nIt signs you in on the device where you open it. It is just for you, so please don't forward it.\n`);

async function call<T>(url:string,init?:RequestInit):Promise<T>{
  const response=await fetch(url,{cache:'no-store',...init,headers:{'Content-Type':'application/json',...init?.headers}});
  const result=await response.json().catch(()=>({})) as T&{error?:string};
  if(!response.ok)throw new Error(result.error??'Something went wrong. Please try again.');
  return result;
}
async function copy(text:string,done='Link copied'){try{await navigator.clipboard.writeText(text);toast.success(done);}catch{toast.error('Copy did not work. Select the link and copy it.');}}

export function InviteDashboard(){
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState('');
  const refresh=useCallback(()=>call<Status>('/api/admin/session').then(setStatus).catch(cause=>setError(cause.message)),[]);
  useEffect(()=>{refresh();},[refresh]);
  return <div className={styles.page}>
    <header className={styles.brand}><span className={styles.mark}><Link2 size={18}/></span><span>Thera<b>Netrix</b></span><span className={styles.divider}/>Invites</header>
    {error?<section className={styles.card} role="alert"><h1>Invites unavailable</h1><p className={styles.muted}>{error}</p><Button onClick={()=>{setError('');refresh();}}><RefreshCw size={15}/>Try again</Button></section>
      :!status?<p className={styles.muted} aria-live="polite">Loading…</p>
      :!status.signedIn?<SignIn setup={!status.configured} onDone={refresh}/>
      :<Dashboard onSignOut={refresh}/>}
    <Toaster position="top-right" richColors closeButton/>
  </div>;
}

function SignIn({setup,onDone}:{setup:boolean;onDone:()=>void}){
  const [password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event:FormEvent){
    event.preventDefault();setError('');
    if(setup&&password!==confirm){setError('The two passwords do not match.');return;}
    setBusy(true);
    try{await call('/api/admin/session',{method:'POST',body:JSON.stringify({password,setup})});onDone();}
    catch(cause){setError(cause instanceof Error?cause.message:'Sign-in failed.');}finally{setBusy(false);}
  }
  return <form className={styles.card+' '+styles.narrow} onSubmit={submit}>
    <span className={styles.icon}><KeyRound size={18}/></span>
    <h1>{setup?'Set up your invite dashboard':'Sign in to invites'}</h1>
    <p className={styles.muted}>{setup?'Choose the password you will use to manage invites. Only you need it; the people you invite use their own links.':'Enter your admin password to manage invite links.'}</p>
    <div className={styles.field}><Label htmlFor="admin-password">{setup?'New admin password':'Admin password'}</Label><Input id="admin-password" type="password" autoComplete={setup?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} minLength={setup?10:1} required disabled={busy}/>{setup&&<small className={styles.muted}>At least 10 characters.</small>}</div>
    {setup&&<div className={styles.field}><Label htmlFor="admin-password-confirm">Confirm password</Label><Input id="admin-password-confirm" type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required disabled={busy}/></div>}
    {error&&<p className={styles.error} role="alert">{error}</p>}
    <Button type="submit" disabled={busy||!password}>{busy?'Please wait…':setup?'Set password and continue':'Sign in'}</Button>
  </form>;
}

function Dashboard({onSignOut}:{onSignOut:()=>void}){
  const [invites,setInvites]=useState<Invite[]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(''),[created,setCreated]=useState<string>('');
  const [now,setNow]=useState(()=>Date.now());
  const load=useCallback(()=>call<{invites:Invite[]}>('/api/admin/invites').then(result=>{setInvites(result.invites);setError('');setNow(Date.now());}).catch(cause=>setError(cause.message)),[]);
  useEffect(()=>{load();const timer=setInterval(load,60_000);return ()=>clearInterval(timer);},[load]);
  const replace=(invite:Invite)=>setInvites(list=>list?.map(item=>item.id===invite.id?invite:item)??null);
  async function change(invite:Invite,action:'revoke'|'restore'|'new-link'){
    if(action==='new-link'&&!window.confirm(`Make a new link for ${invite.name}? Their current link stops working, and they will need the new one.`))return;
    if(action==='revoke'&&!window.confirm(`Turn off ${invite.name}'s link? They lose access straight away. You can turn it back on later.`))return;
    setBusy(invite.id);
    try{const result=await call<{invite:Invite}>('/api/admin/invites',{method:'PATCH',body:JSON.stringify({id:invite.id,action})});replace(result.invite);setNow(Date.now());
      toast.success(action==='revoke'?'Link turned off':action==='restore'?'Link turned back on':'New link ready. Send it to '+invite.name+'.');}
    catch(cause){toast.error(cause instanceof Error?cause.message:'The change was not saved.');}finally{setBusy('');}
  }
  async function signOut(){try{await call('/api/admin/session',{method:'DELETE'});onSignOut();}catch{toast.error('Sign-out did not work. Please try again.');}}
  const active=invites?.filter(invite=>!invite.revokedAt)??[],opened=active.filter(invite=>invite.openCount>0).length;
  return <main className={styles.layout}>
    <div className={styles.titleRow}>
      <div><h1>Invites</h1><p className={styles.muted}>Give each person their own link to TheraNetrix. Opening it signs them in on that device.</p></div>
      <Button variant="outline" onClick={signOut}><LogOut size={15}/>Sign out</Button>
    </div>
    <section className={styles.card} aria-labelledby="access-heading">
      <h2 id="access-heading">Site access</h2>
      <p className={styles.muted}>Anyone with the site’s Vercel password can open TheraNetrix. A personal link adds a name: opening it signs that person in under their own name, in their own copy of the demo or the shared workspace. Invited people still enter the site password first.</p>
    </section>
    <NewInvite onCreated={added=>{setInvites(list=>[...added,...(list??[])]);setCreated(added[0]?.id??'');setNow(Date.now());}}/>
    <section aria-labelledby="people-heading">
      <div className={styles.listHead}><h2 id="people-heading">People</h2>{invites&&<span className={styles.listMeta}><span className={styles.muted}>{active.length} active · {opened} opened</span>{active.length>0&&<Button variant="outline" size="sm" onClick={()=>copy(active.map(invite=>`${invite.name}${invite.email?' <'+invite.email+'>':''}: ${absolute(invite.link)}`).join('\n'),`${active.length} links copied`)}><Copy size={14}/>Copy all links</Button>}</span>}</div>
      {error?<div className={styles.card} role="alert"><p>{error}</p><Button variant="outline" onClick={load}><RefreshCw size={15}/>Try again</Button></div>
        :!invites?<p className={styles.muted}>Loading invites…</p>
        :!invites.length?<div className={styles.empty}><Users size={22}/><p>No invites yet. Create the first one above.</p></div>
        :<ul className={styles.list}>{invites.map(invite=><li key={invite.id} className={styles.person+(invite.revokedAt?' '+styles.off:'')+(created===invite.id?' '+styles.fresh:'')}>
          <div className={styles.personHead}>
            <span className={styles.avatar} aria-hidden="true"><UserRound size={16}/></span>
            <div className={styles.who}><strong>{invite.name}</strong>{invite.email&&<span>{invite.email}</span>}</div>
            <div className={styles.tags}><span className={styles.tag}>{roleLabel[invite.role]}</span><span className={styles.tag}>{spaceLabel[invite.workspace]}</span><span className={invite.revokedAt?styles.tagOff:styles.tagOn}>{invite.revokedAt?'Off':'Active'}</span></div>
          </div>
          {invite.note&&<p className={styles.note}>{invite.note}</p>}
          <p className={styles.activity}>{activity(invite,now)}</p>
          {!invite.revokedAt&&<div className={styles.linkRow}><Input readOnly value={absolute(invite.link)} aria-label={'Invite link for '+invite.name} onFocus={e=>e.currentTarget.select()}/><Button variant="outline" onClick={()=>copy(absolute(invite.link))} aria-label={'Copy link for '+invite.name}><Copy size={15}/>Copy</Button></div>}
          <div className={styles.actions}>
            {!invite.revokedAt&&invite.email&&<Button asChild variant="ghost" size="sm"><a href={mailto(invite)}><Mail size={14}/>Email link</a></Button>}
            {!invite.revokedAt&&<Button variant="ghost" size="sm" disabled={busy===invite.id} onClick={()=>change(invite,'new-link')}><RefreshCw size={14}/>New link</Button>}
            <Button variant="ghost" size="sm" disabled={busy===invite.id} onClick={()=>change(invite,invite.revokedAt?'restore':'revoke')}>{invite.revokedAt?<><Check size={14}/>Turn back on</>:'Turn off'}</Button>
          </div>
        </li>)}</ul>}
    </section>
  </main>;
}

function NewInvite({onCreated}:{onCreated:(invites:Invite[])=>void}){
  const blank={name:'',email:'',note:'',role:'clinician' as Role,workspace:'own' as Space};
  const [several,setSeveral]=useState(false),[list,setList]=useState('');
  const [form,setForm]=useState(blank),[busy,setBusy]=useState(false),[error,setError]=useState(''),[last,setLast]=useState<Invite[]>([]),[skipped,setSkipped]=useState<string[]>([]);
  const set=<K extends keyof typeof blank>(key:K,value:(typeof blank)[K])=>setForm(current=>({...current,[key]:value}));
  // A group invite defaults to the shared workspace, so everyone in it sees the same records.
  const mode=(value:boolean)=>{setSeveral(value);setError('');set('workspace',value?'shared':'own');};
  const lines=list.split(/\r?\n/).filter(line=>line.trim()).length;
  async function submit(event:FormEvent){
    event.preventDefault();setBusy(true);setError('');setSkipped([]);
    try{
      if(several){const result=await call<{invites:Invite[];skipped:string[]}>('/api/admin/invites',{method:'POST',body:JSON.stringify({people:list,role:form.role,workspace:form.workspace,note:form.note})});onCreated(result.invites);setLast(result.invites);setSkipped(result.skipped);setList('');setForm({...blank,workspace:'shared'});}
      else{const {invite}=await call<{invite:Invite}>('/api/admin/invites',{method:'POST',body:JSON.stringify(form)});onCreated([invite]);setLast([invite]);setForm(blank);}
    }catch(cause){setError(cause instanceof Error?cause.message:'The invite was not created.');}finally{setBusy(false);}
  }
  const choice=useMemo(()=>({role:[['clinician','Clinician workspace'],['patient','Patient companion']] as const,workspace:[['own','Their own copy of the demo'],['shared','The shared workspace']] as const}),[]);
  return <section className={styles.card} aria-labelledby="new-heading">
    <div className={styles.newHead}><h2 id="new-heading">New invite</h2>
      <div className={styles.segment} role="group" aria-label="How many people"><button type="button" aria-pressed={!several} onClick={()=>mode(false)} disabled={busy}>One person</button><button type="button" aria-pressed={several} onClick={()=>mode(true)} disabled={busy}>Several people</button></div></div>
    <form className={styles.form} onSubmit={submit}>
      {several?<div className={styles.field+' '+styles.wide}><Label htmlFor="invite-list">People, one per line</Label><Textarea id="invite-list" value={list} onChange={e=>setList(e.target.value)} rows={6} required disabled={busy} placeholder={'Jordan Lee, jordan@example.com\nSam Ortiz <sam@example.com>\nalex.kim@example.com'}/><small className={styles.muted}>Name and email, or just an email. Each person gets their own link. Anyone who already has an active invite for that email is skipped.</small></div>
      :<><div className={styles.field}><Label htmlFor="invite-name">Name</Label><Input id="invite-name" value={form.name} onChange={e=>set('name',e.target.value)} maxLength={80} required disabled={busy} placeholder="e.g. Dr. Jordan Lee"/></div>
      <div className={styles.field}><Label htmlFor="invite-email">Email <span className={styles.optional}>optional</span></Label><Input id="invite-email" type="email" value={form.email} onChange={e=>set('email',e.target.value)} maxLength={160} disabled={busy} placeholder="For the Email link button"/></div></>}
      <fieldset className={styles.choices}><legend>Link opens</legend>{choice.role.map(([value,label])=><label key={value} className={styles.choice}><input type="radio" name="invite-role" value={value} checked={form.role===value} onChange={()=>set('role',value)} disabled={busy}/>{label}</label>)}</fieldset>
      <fieldset className={styles.choices}><legend>Workspace</legend>{choice.workspace.map(([value,label])=><label key={value} className={styles.choice}><input type="radio" name="invite-workspace" value={value} checked={form.workspace===value} onChange={()=>set('workspace',value)} disabled={busy}/>{label}</label>)}</fieldset>
      <p className={styles.hint+' '+styles.wide}>{form.workspace==='own'?'They get a fresh copy of the demo data. What they change stays in their copy and never affects anyone else.':`${several?'Everyone':'They'} work${several?'':'s'} in the same workspace and see${several?'':'s'} the same records. Changes are recorded under each person’s name.`}</p>
      <div className={styles.field+' '+styles.wide}><Label htmlFor="invite-note">Note <span className={styles.optional}>optional, only you see it</span></Label><Input id="invite-note" value={form.note} onChange={e=>set('note',e.target.value)} maxLength={300} disabled={busy} placeholder={several?'e.g. Discovery Weekly group':'e.g. CTO, usability session on Oct 2'}/></div>
      {error&&<p className={styles.error+' '+styles.wide} role="alert">{error}</p>}
      <div className={styles.wide}><Button type="submit" disabled={busy||(several?!lines:!form.name.trim())}><Plus size={15}/>{busy?'Creating…':several?`Create ${lines||''} invite link${lines===1?'':'s'}`.replace('  ',' '):'Create invite link'}</Button></div>
    </form>
    {(last.length>0||skipped.length>0)&&<div className={styles.created} role="status">
      {last.length===1?<><p><Check size={15}/> Link ready for <strong>{last[0].name}</strong>. Send it to them; it only works for this invite.</p><div className={styles.linkRow}><Input readOnly value={absolute(last[0].link)} aria-label={'New invite link for '+last[0].name} onFocus={e=>e.currentTarget.select()}/><Button onClick={()=>copy(absolute(last[0].link))}><Copy size={15}/>Copy link</Button>{last[0].email&&<Button asChild variant="outline"><a href={mailto(last[0])}><Mail size={15}/>Email</a></Button>}</div></>
        :last.length>1?<p><Check size={15}/> {last.length} links ready. Each person is listed below with their own link and Email button.</p>:null}
      {skipped.length>0&&<p>Already invited, left as they are: {skipped.join(', ')}.</p>}
    </div>}
  </section>;
}
