'use client';
import Link from 'next/link';
import {controlWorkspace,saveWorkspaceAction,type UndoInfo} from '@/lib/workspace-client';
import {UndoControl} from './workspace-controls';
import {WorkspaceAdvisorDock} from './advisor-dock';
import {GuideButton} from './guide-dialog';
import {workspacePage} from '@/lib/workspace-advisor';
import {Fragment,useState,useEffect,useCallback,type CSSProperties,type ReactNode} from 'react';
import {Activity,LayoutDashboard,Users,Inbox,MessagesSquare,CalendarDays,Settings,Search,ChevronRight,Plus,ArrowUpRight,HeartPulse,ShieldCheck,Smartphone,RefreshCw,Stethoscope,ChevronDown,Route} from 'lucide-react';
import {SidebarProvider,Sidebar,SidebarContent,SidebarHeader,SidebarFooter,SidebarMenu,SidebarMenuItem,SidebarMenuButton,SidebarGroup,SidebarGroupLabel,SidebarGroupContent,SidebarTrigger,useSidebar} from '@/components/ui/sidebar';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Command,CommandInput,CommandList,CommandEmpty,CommandGroup,CommandItem} from '@/components/ui/command';
import {Table,TableHeader,TableHead,TableRow,TableBody,TableCell} from '@/components/ui/table';
import {toast} from 'sonner';
import {Toaster} from '@/components/ui/sonner';
import {Skeleton} from '@/components/ui/skeleton';
import {type Workspace,type Patient,featureEnabled} from '@/lib/theranetrix';
import {RecommendationDetails} from './recommendation-details';
import {patientPanelRow} from '@/lib/patient-panel';
import {type Action} from '@/lib/actions';
import {Badge,PatientName,Picker,Panel,EmptyState,PageTitle,Term,formatDate} from './ui';
import {dobText} from './patient-identity';
import {CDSS,PRODUCT_AREA} from '@/lib/terminology';
import {ClinicianOverview} from './clinician-overview';
import {PrototypeFeedback} from './prototype-feedback';
import {PatientDetail} from './patient';
import {CarePathways,ReviewQueue,Messages,Schedule,Companion,WorkspaceSettings} from './workflows';
import {EntryDialog,type EntryKind} from './forms';
import {WorkspaceSignIn} from './workspace-sign-in';
import {useLocationParameter} from './location-state';
import {FutureCapabilities} from './future-preview';
import {patientIdFromPath} from '@/lib/journey-navigation';
import {needsAction} from '@/lib/patient-overview';
import {NeedsActionBell} from './needs-action';
export type Context={data:Workspace;user:string;accessMode?:'shared'|'password';busy:boolean;signOut:()=>Promise<void>;save:(action:Action,message?:string)=>Promise<boolean>;open:(kind:EntryKind,patient?:Patient)=>void;selectEnginePatient?:(id:string)=>void;saveConflict?:boolean;undo?:UndoInfo;undoLast?:()=>Promise<boolean>;resetDemo?:()=>Promise<boolean>;reloadWorkspace?:()=>void};
const nav=[{href:'/',label:'Care overview',icon:LayoutDashboard},{href:'/patients',label:'Patients',icon:Users},{href:'/engines',label:'Treatment',icon:HeartPulse},{href:'/review-queue',label:'Review queue',icon:Inbox},{href:'/messages',label:'Messages',icon:MessagesSquare},{href:'/schedule',label:'Schedule',icon:CalendarDays}];
const enginePaths=['/engines','/digital-twin','/pst','/shadow-ai','/robo-advisor'];
function chartHref(patientId:string,tab:string){return '/patients/'+encodeURIComponent(patientId)+'?tab='+encodeURIComponent(tab);}
function navHref(href:string,enginePatient:string){
  if(href==='/engines')return enginePatient?chartHref(enginePatient,'treatment'):'/patients?open=treatment';
  if(href==='/patient-companion'&&enginePatient)return href+'?patient='+encodeURIComponent(enginePatient);
  return href;
}
function engineTab(path:string){return path==='/digital-twin'?'twin':path==='/robo-advisor'?'advisor':'treatment';}
function ChartRedirect({patientId,tab}:{patientId:string;tab:string}){
  useEffect(()=>{window.location.replace(chartHref(patientId,tab));},[patientId,tab]);
  return <EmptyState title="Opening the patient chart"/>;
}
function Navigation({path,reviews,replies,enginePatient,accessMode,user,notification}:{notification?:ReactNode;path:string;reviews:number;replies:number;enginePatient:string;accessMode:'shared'|'password';user:string}){const {setOpenMobile}=useSidebar();return <><SidebarHeader className="brand-header"><Link href="/" className="brand"><span className="brand-symbol"><Activity size={25}/></span><span>Thera<span className="brand-light">Netrix</span></span></Link><div className="workspace-name"><span className="workspace-mark"><Stethoscope size={16}/></span><div>Chronic Pain Program<small>{PRODUCT_AREA} <Term t={CDSS}/></small></div></div></SidebarHeader><SidebarContent><SidebarGroup><SidebarGroupLabel className="side-label">WORKSPACE</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{nav.map(n=><SidebarMenuItem key={n.href}><SidebarMenuButton asChild isActive={n.href==='/'?path==='/':n.href==='/engines'?enginePaths.includes(path):path.startsWith(n.href)} className="nav-link" onClick={()=>setOpenMobile(false)}><a href={navHref(n.href,enginePatient)}><n.icon size={19}/><span>{n.label}</span>{n.href==='/review-queue'&&reviews>0&&<b className="nav-count" title="Open reviews (the Needs action bell counts patients)">{reviews}<span className="sr-only"> open review{reviews===1?'':'s'}</span></b>}{n.href==='/messages'&&replies>0&&<b className="nav-count" title="Patients whose latest saved message is from the patient">{replies}<span className="sr-only"> reply needed</span></b>}</a></SidebarMenuButton></SidebarMenuItem>)}{notification&&<SidebarMenuItem className="forest-notification-item">{notification}</SidebarMenuItem>}</SidebarMenu></SidebarGroupContent></SidebarGroup><SidebarGroup className="secondary-nav"><SidebarGroupLabel className="side-label">PROGRAM</SidebarGroupLabel><SidebarMenu>{[{href:'/care-pathways',label:'Care pathways',icon:Route},{href:'/patient-companion',label:'Patient companion',icon:Smartphone},{href:'/settings',label:'Workspace settings',icon:Settings}].map(n=><SidebarMenuItem key={n.href}><SidebarMenuButton asChild isActive={path.startsWith(n.href)} className="nav-link" onClick={()=>setOpenMobile(false)}><a href={n.href+(n.href==='/patient-companion'&&enginePatient?'?patient='+encodeURIComponent(enginePatient):'')}><n.icon size={19}/><span>{n.label}</span></a></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroup></SidebarContent><SidebarFooter><div className="sidebar-note"><ShieldCheck size={19}/><div>{accessMode==='shared'?'Shared workspace':'Secure workspace'}<small>{accessMode==='shared'?'Open access':'Care team access'}</small></div></div><Link className="side-profile" href="/settings?tab=access"><span className="profile-avatar">{accessMode==='shared'?'TN':'WO'}</span><div>{user}<small>{accessMode==='shared'?'No sign-in needed':'Workspace owner'}</small></div><ChevronRight size={16}/></Link></SidebarFooter></>;}
export default function TheraNetrix({path,forestPreview=false}:{path:string;forestPreview?:boolean}){
  const [enginePatient,setEnginePatient]=useState('');
  const [data,setData]=useState<Workspace|null>(null),[version,setVersion]=useState(0),[user,setUser]=useState('Shared workspace visitor'),[accessMode,setAccessMode]=useState<'shared'|'password'>('shared'),[error,setError]=useState(''),[auth,setAuth]=useState(false),[busy,setBusy]=useState(false),[search,setSearch]=useState(false),[conflict,setConflict]=useState(false),[entry,setEntry]=useState<{kind:EntryKind;patient?:Patient}|null>(null),[undo,setUndo]=useState<UndoInfo>(null);
  const load=useCallback(()=>fetch('/api/workspace',{cache:'no-store'}).then(async response=>{
    const result=await response.json() as {data:Workspace;version:number;user:string;accessMode?:'shared'|'password';error?:string;undo?:UndoInfo;invite?:{name:string;role:'clinician'|'patient'}|null};
    if(!response.ok){setAuth(response.status===401);throw new Error(result.error);}
    setError('');setAuth(false);setData(result.data);setVersion(result.version);setUser(result.user);setAccessMode(result.accessMode??'password');setConflict(false);setUndo(result.undo??null);
  }).catch(cause=>{setError(cause instanceof Error?cause.message:'Unable to load workspace.');}),[]);
  useEffect(()=>{load();},[load]);
  useEffect(()=>{const listener=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();setSearch(v=>!v);}};window.addEventListener('keydown',listener);return()=>window.removeEventListener('keydown',listener);},[]);
  const save=async(action:Action,message='Saved to your workspace')=>{
    if(busy)return false;
    if(conflict){toast.error('Review the newer saved workspace before making another change. Your entries are still on this page.');return false;}
    setBusy(true);
    try{
      const result=await saveWorkspaceAction(version,action);
      if(!result.saved){if(result.conflict)setConflict(true);toast.error(result.conflict?'A newer workspace was saved. Copy unfinished text before using Load latest saved records. In a dialog, use its recovery action or close it to reach the workspace notice.':result.message);return false;}
      setData(result.data);setVersion(result.version);setUndo(result.undo);toast.success(message);return true;
    }catch(e){toast.error(e instanceof Error?e.message:'Unable to save. Your entry has been kept.');return false;}
    finally{setBusy(false);}
  };
  // Undo and reset replace the whole workspace, so they only run from a clean state.
  const control=async(kind:'undo'|'reset')=>{
    if(busy)return false;
    if(conflict){toast.error('Load the latest saved records before using undo or reset.');return false;}
    setBusy(true);
    try{
      const result=await controlWorkspace(version,kind);
      if(!result.saved){if(result.conflict)setConflict(true);toast.error(result.message);return false;}
      setData(result.data);setVersion(result.version);setUndo(result.undo);
      toast.success(kind==='undo'?'Undone: '+(result.undone||'last change'):'Demo data reset to the original records');return true;
    }catch{toast.error(kind==='undo'?'Unable to undo. Nothing was changed.':'Unable to reset. Nothing was changed.');return false;}
    finally{setBusy(false);}
  };
  const reloadWorkspace=()=>{if(window.confirm('Load the latest saved records? Unsaved entries may be discarded. Copy any unfinished text before continuing.'))window.location.reload();};
  const conflictNotice=conflict?<section role="alert" className="subtle-notice"><strong>A newer saved workspace is available.</strong><p>Your unfinished entries are still on this page. Copy any text you want to keep before loading the latest records.</p><Button variant="outline" disabled={busy} onClick={reloadWorkspace}>Load latest saved records</Button></section>:null;

  const open=(kind:EntryKind,patient?:Patient)=>setEntry({kind,patient});
  const signOut=async()=>{try{const response=await fetch('/api/session',{method:'DELETE'});if(!response.ok)throw new Error('Sign-out failed.');setData(null);setEntry(null);setSearch(false);await load();}catch{toast.error('Unable to sign out. Please try again.');}};
  const ctx=data?{data,user,accessMode,busy,save,open,signOut,selectEnginePatient:setEnginePatient,saveConflict:conflict,undo,undoLast:()=>control('undo'),resetDemo:()=>control('reset'),reloadWorkspace}:null;
  const active=nav.find(n=>n.href==='/'?path==='/':path.startsWith(n.href));
  const patient=data?.patients.find(p=>p.id===patientIdFromPath(path));
  const title=active?.label??(path.startsWith('/settings')?'Workspace settings':path==='/care-pathways'?'Care pathways':path==='/patient-companion'?'Patient companion':'Workspace');
  const reviews=data?.reviews.filter(r=>r.status!=='Resolved').length??0;
  if(path==='/patient-companion')return <div className="companion-standalone"><a href="#main-content" className="skip-link">Skip to content</a><main id="main-content">{conflictNotice}{error?<Panel><div className="error-panel"><h1>{auth?'Your private clinical workspace':'Workspace unavailable'}</h1><p>{error}</p>{auth?<WorkspaceSignIn onSuccess={load}/>:<Button onClick={load}><RefreshCw size={16}/>Try again</Button>}</div></Panel>:!ctx?<div className="companion-surface"><div className="companion-header"><span className="companion-brand">MobileNetrix</span></div><div className="companion-body"><p className="muted">Opening your care app…</p></div></div>:<Companion ctx={ctx}/>}</main><Toaster position="top-right" richColors closeButton/>{ctx&&<EntryDialog entry={entry} close={()=>setEntry(null)} ctx={ctx}/>}</div>;
  const attention=data?needsAction(data):null,replies=attention?.groups.find(g=>g.id==='replies')?.rows.length??0;
  return <SidebarProvider className="redesign-shell" style={{'--sidebar-width':'216px'} as CSSProperties}><a href="#main-content" className="skip-link">Skip to content</a><Sidebar className="thera-sidebar"><Navigation path={path} reviews={reviews} replies={replies} enginePatient={patient?.id??enginePatient} accessMode={accessMode} user={user} notification={forestPreview&&attention?<NeedsActionBell attention={attention} label="Notifications"/>:undefined}/></Sidebar><div className="workspace-main">{forestPreview&&<div className="forest-mobile-navigation"><SidebarTrigger aria-label="Toggle navigation"/><span>TheraNetrix</span></div>}<header className="topbar"><div className="breadcrumbs"><SidebarTrigger aria-label="Toggle navigation" className="mobile-menu"/><Link className="desktop-crumb" href="/">Care workspace</Link><ChevronRight size={14} className="desktop-crumb"/><span>{title}</span>{patient&&<><ChevronRight size={14}/><b>{patient.name}</b></>}</div><div className="top-tools">{ctx&&<UndoControl ctx={ctx}/>}{ctx&&<PrototypeFeedback ctx={ctx} path={path} screen={patient?patient.name+' · Patient record':title}/>}{ctx&&accessMode==='password'&&<Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>}<button className="search-trigger" aria-label="Find a patient" onClick={()=>setSearch(true)}><Search size={17}/><span>Search patients</span><kbd>⌘ K</kbd></button><GuideButton path={path}/>{attention&&!forestPreview&&<NeedsActionBell attention={attention}/>}<Link href="/settings?tab=access" className="top-avatar" aria-label="Account and access">{accessMode==='shared'?'TN':'WO'}</Link></div></header><main className="main-content" id="main-content">{conflictNotice}
    {error?<Panel><div className="error-panel"><h1>{auth?'Your private clinical workspace':'Workspace unavailable'}</h1><p>{error}</p>{auth?<WorkspaceSignIn onSuccess={load}/>:<Button onClick={load}><RefreshCw size={16}/>Try again</Button>}</div></Panel>:!ctx?<div className="loading-state" aria-label="Loading workspace"><Skeleton className="h-12 w-72"/><div className="stats-grid">{[1,2,3,4].map(i=><Skeleton key={i} className="h-32"/>)}</div><Skeleton className="h-96 w-full"/></div>:path==='/'?<ClinicianOverview ctx={ctx}/>:enginePaths.includes(path)?(enginePatient||ctx.data.patients.find(p=>p.demoCase==='finding-treatment')?.id||ctx.data.patients[0]?.id?<ChartRedirect patientId={enginePatient||ctx.data.patients.find(p=>p.demoCase==='finding-treatment')?.id||ctx.data.patients[0].id} tab={engineTab(path)}/>:<EmptyState title="Add a patient to open treatment"/>):path==='/patients'?<Patients ctx={ctx}/>:path.startsWith('/patients/')?(patient?<PatientDetail patient={patient} ctx={ctx}/>:<EmptyState title="Patient not found" description="Return to Patients to select an available record."/>):path==='/care-pathways'?<CarePathways ctx={ctx}/>:path==='/review-queue'?<ReviewQueue ctx={ctx}/>:path==='/messages'?<Messages ctx={ctx}/>:path==='/schedule'?<Schedule ctx={ctx}/>:path==='/patient-companion'?<Companion ctx={ctx}/>:path==='/future-capabilities'?<FutureCapabilities/>:path==='/settings'?<WorkspaceSettings ctx={ctx}/>:<EmptyState title="Page not found" description="Choose a destination from the workspace navigation."/>}
    </main>{ctx&&!patient&&workspacePage(path)&&<WorkspaceAdvisorDock ctx={ctx} page={workspacePage(path)!}/>}<footer className="workspace-footer"><span>TheraNetrix <span className="footer-divider">/</span> Connected chronic pain care</span></footer></div><Toaster position="top-right" richColors closeButton/>
    <Dialog open={search} onOpenChange={setSearch}><DialogContent className="search-dialog"><DialogHeader><DialogTitle>Find a patient</DialogTitle><DialogDescription>Search by name, MRN, patient ID, or condition.</DialogDescription></DialogHeader><Command><CommandInput placeholder="Search patients..."/><CommandList><CommandEmpty>No matching patients.</CommandEmpty><CommandGroup heading="Patient records">{data?.patients.map(p=><CommandItem key={p.id} value={[p.name,p.medicalRecordNumber,p.id,p.condition].filter(Boolean).join(' ')} onSelect={()=>{window.location.href='/patients/'+p.id;}}><PatientName patient={p} sub={[dobText(p.dateOfBirth),p.medicalRecordNumber&&'MRN '+p.medicalRecordNumber,p.condition].filter(Boolean).join(' · ')}/></CommandItem>)}</CommandGroup></CommandList></Command></DialogContent></Dialog>
    {ctx&&<EntryDialog entry={entry} close={()=>setEntry(null)} ctx={ctx}/>}
  </SidebarProvider>;
}
export function Patients({ctx}:{ctx:Context}){
  // Arriving from Treatment with no patient chosen: every row opens that patient's Treatment tab.
  const treatment=useLocationParameter('open')==='treatment',chart=(id:string)=>'/patients/'+id+(treatment?'?tab=treatment':'');
  const [query,setQuery]=useState(''),[status,setStatus]=useState('All statuses'),[condition,setCondition]=useState('All conditions'),[expanded,setExpanded]=useState<string|null>(null);
  const patients=ctx.data.patients.filter(p=>(p.name+' '+p.id+' '+(p.medicalRecordNumber??'')+' '+p.condition).toLowerCase().includes(query.toLowerCase())&&(status==='All statuses'||p.status===status)&&(condition==='All conditions'||p.condition===condition))
    .map(p=>({p,row:patientPanelRow(p,ctx.data)}))
    .sort((a,b)=>a.row.alertPriority-b.row.alertPriority||b.row.alerts-a.row.alerts||a.p.name.localeCompare(b.p.name));
  return <div className="patient-directory-redesign"><PageTitle eyebrow="CARE WORKSPACE" title="Patients" description={treatment?"Choose a patient to open their treatment comparison.":"Find a patient and pick up their care where you left off."} actions={<Button onClick={()=>ctx.open('patient')}><Plus size={16}/>Add patient</Button>}/>
    <Panel className="directory-panel"><div className="directory-heading"><div><h2>Your patient panel <span>{ctx.data.patients.length}</span></h2><p>Open alerts first · Patient reports and next visits at a glance</p></div><div className="directory-summary"><Badge tone="amber">{ctx.data.patients.filter(p=>patientPanelRow(p,ctx.data).alerts>0).length} with open alerts</Badge></div></div>
      <div className="table-toolbar"><div className="input-search"><Search size={17}/><Input aria-label="Search patient directory" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name, MRN, ID, or condition"/></div><Picker value={status} onChange={setStatus} label="Filter status" options={['All statuses','Needs review','On track','Monitoring']}/><Picker value={condition} onChange={setCondition} label="Filter condition" options={['All conditions',...Array.from(new Set(ctx.data.patients.map(p=>p.condition)))]}/>{(query||status!=='All statuses'||condition!=='All conditions')&&<Button variant="ghost" size="sm" onClick={()=>{setQuery('');setStatus('All statuses');setCondition('All conditions');}}>Clear</Button>}</div>
      <Table className="directory-table"><TableHeader><TableRow><TableHead>Patient</TableHead><TableHead>Condition / care team</TableHead><TableHead>Last check-in</TableHead><TableHead>Status</TableHead><TableHead>Next visit</TableHead><TableHead><span className="sr-only">Patient actions</span></TableHead></TableRow></TableHeader><TableBody>{patients.map(({p,row})=><Fragment key={p.id}><TableRow className={expanded===p.id?'directory-row-expanded':''}>
        <TableCell><a href={chart(p.id)}><PatientName patient={p} sub={dobText(p.dateOfBirth)+' · '+(p.medicalRecordNumber?'MRN '+p.medicalRecordNumber:p.id)+' · '+p.age+' years'}/></a></TableCell><TableCell><strong>{p.condition}</strong><small>{p.clinician}</small></TableCell><TableCell>{row.lastCheckin?formatDate(row.lastCheckin):<Badge>{featureEnabled(ctx.data,'assessments')?'No check-in yet':'Assessments off'}</Badge>}<small>{row.lastCheckin?'Patient report available':'Preparation pending'}</small></TableCell><TableCell><Badge tone={row.alertPriority===0?'rose':row.alerts?'amber':p.status==='On track'?'teal':'neutral'}>{row.alerts?row.alerts+' open alert'+(row.alerts===1?'':'s'):p.status}</Badge><RecommendationDetails title={'Review status · '+p.name} label="Why this status" rationale={[row.alerts?'This patient has '+row.alerts+' unresolved review items.':'No unresolved review items are recorded. The displayed status is the saved patient status.','The directory sorts recorded high-priority items first, then other open items, then patients without open items.']} sources={ctx.data.reviews.filter(r=>r.patientId===p.id&&r.status!=='Resolved').map(r=>({label:r.title,value:r.priority+' priority · '+r.status+'. '+r.detail,date:r.created,href:'/review-queue'}))} considerations={['Saved patient status: '+p.status]} limitations={['This ordering uses recorded review priority. It is not a clinical urgency score or a new diagnosis.']}/></TableCell><TableCell>{formatDate(p.nextVisit)}<small>{p.stage}</small></TableCell><TableCell><div className="directory-row-actions"><Button size="sm" asChild><a href={chart(p.id)}>{treatment?'Open treatment':'Open patient'}<ArrowUpRight size={14}/></a></Button><button className="triage-expand" onClick={()=>setExpanded(expanded===p.id?null:p.id)} aria-expanded={expanded===p.id} aria-controls={'directory-details-'+p.id} aria-label={'Show details for '+p.name}>Details<ChevronDown size={14}/></button></div></TableCell>
      </TableRow>{expanded===p.id&&<TableRow className="directory-detail-row"><TableCell colSpan={6}><div className="directory-details" id={'directory-details-'+p.id}><div><span>Pain syndrome</span><strong>{row.syndrome}</strong></div><div><span>Pathway step</span><strong>{row.step}</strong></div><div><span>Digital Twin</span><Badge tone={row.twin.startsWith('Reports span 30+')?'teal':'blue'}>{row.twin}</Badge></div><div><span>Pending decision</span><strong>{row.pending}</strong></div><div><span>RTM / CCM</span><strong>{row.rtm}</strong></div><div><span>Recorded status</span><strong>{p.status}</strong></div></div></TableCell></TableRow>}</Fragment>)}</TableBody></Table>
      {!patients.length&&<EmptyState title="No matching patients" description="Try another name or clear your filters."/>}<div className="panel-bottom"><span>Showing {patients.length} of {ctx.data.patients.length} patients</span><span>Sorted by alert priority</span></div>
    </Panel>
  </div>;
}
