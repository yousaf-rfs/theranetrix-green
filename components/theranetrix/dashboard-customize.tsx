'use client';
import {useState,useEffect,useSyncExternalStore,useRef,type ReactNode,type FormEvent} from 'react';
import {Settings2,ArrowUp,ArrowDown,GripVertical} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {defaultDashboardLayout,dashboardColumns,dashboardColumnLabels,dashboardFilters,type DashboardLayout,type DashboardProfile} from '@/lib/dashboard-layout';
import {Picker} from './ui';
import type {Context} from './app';
import {reviewSections,reviewSectionLabels,reorderDashboardItems} from '@/lib/dashboard-layout';

function storedDashboardProfile(){try{return localStorage.getItem('theranetrix-dashboard-layout')??'';}catch{return '';}}
function subscribeDashboardProfile(listener:()=>void){window.addEventListener('storage',listener);return()=>window.removeEventListener('storage',listener);}

export function DoctorDashboard({ctx,children}:{ctx:Context;children:(layout:DashboardLayout,controls:ReactNode,key:string)=>ReactNode}){
  const stored=useSyncExternalStore(subscribeDashboardProfile,storedDashboardProfile,()=>''),[selected,setSelected]=useState<string|null>(null),[open,setOpen]=useState(false);
  const active=selected??stored;
  const profiles=ctx.data.dashboardProfiles??[],profile=profiles.find(p=>p.id===active);
  function select(id:string){setSelected(id);try{localStorage.setItem('theranetrix-dashboard-layout',id);}catch{}}
  const layout=profile?.layout??defaultDashboardLayout();
  return <>{children(layout,<><Picker label="Dashboard profile" value={profile?.id??'full-overview'} onChange={select} options={[{value:'full-overview',label:'Full overview'},...profiles.map(p=>({value:p.id,label:p.name}))]}/><Button variant="outline" onClick={()=>setOpen(true)}><Settings2 size={16}/>Customize</Button></>,(profile?.id??'default')+(profile?.revision??''))}<Dialog open={open} onOpenChange={v=>{if(!ctx.busy)setOpen(v);}}><DialogContent className="dashboard-customize-dialog"><DialogHeader><DialogTitle>Customize my dashboard</DialogTitle><DialogDescription>Choose what appears in your patient panel and chart. Profiles are shared; this device remembers your selection.</DialogDescription></DialogHeader>{open&&<DashboardForm ctx={ctx} profile={profile} onSaved={(id)=>{select(id);setOpen(false);}} close={()=>setOpen(false)}/>}</DialogContent></Dialog></>;
}
function DashboardForm({ctx,profile,onSaved,close}:{ctx:Context;profile?:DashboardProfile;onSaved:(id:string)=>void;close:()=>void}){
  const [draft,setDraft]=useState(()=>structuredClone(profile?.layout??defaultDashboardLayout()));
  const [name,setName]=useState(profile?.name??'My review dashboard');
  const [base]=useState(profile?.revision??'');
  const [error,setError]=useState(''),[saving,setSaving]=useState(false),[announcement,setAnnouncement]=useState('');
  const [dragged,setDragged]=useState<{group:'columns'|'reviewSections';id:string}|null>(null);
  const savingRef=useRef(false),errorRef=useRef<HTMLParagraphElement>(null);
  const [copy,setCopy]=useState(!profile);
  const conflict=!!profile&&!copy&&base!==profile.revision;
  function reorder(group:'columns'|'reviewSections',from:string,to:string){
    if(group==='columns'){
      const columns=reorderDashboardItems(draft.columns,from,to);
      setDraft({...draft,columns});
      setAnnouncement('Patient panel columns reordered. '+columns.map(c=>dashboardColumnLabels[c]).join(', ')+'.');
    }else{
      const sections=reorderDashboardItems(draft.reviewSections??[...reviewSections],from,to);
      setDraft({...draft,reviewSections:sections});
      setAnnouncement('Patient chart sections reordered. '+sections.map(c=>reviewSectionLabels[c]).join(', ')+'.');
    }
  }
  function move(column:DashboardLayout['columns'][number],direction:number){const index=draft.columns.indexOf(column),target=draft.columns[index+direction];if(target)reorder('columns',column,target);}
  async function save(e:FormEvent){
    e.preventDefault();if(savingRef.current||ctx.busy||pendingName!==null||conflict)return;
    savingRef.current=true;setSaving(true);setError('');
    try{
      const id=copy?undefined:profile?.id;
      const ok=await ctx.save({type:'dashboard.save',id,baseRevision:id?base:'',name,layout:draft},'Dashboard saved');
      if(ok){if(id)onSaved(id);else setPendingName(name.trim());}
      else setError('Not saved. Your draft is still here. Review the workspace message and try again.');
    }catch{setError('The dashboard could not be saved. Your draft is still here. Try again.');}
    finally{savingRef.current=false;setSaving(false);}
  }
  useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
  const [pendingName,setPendingName]=useState<string|null>(null);
  useEffect(()=>{if(pendingName){const saved=ctx.data.dashboardProfiles?.find(p=>p.name===pendingName);if(saved)onSaved(saved.id);}},[ctx.data.dashboardProfiles,pendingName,onSaved]);
  return <form onSubmit={save} className="dashboard-customize-form"><fieldset disabled={ctx.busy||saving||pendingName!==null}>
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p><label>Dashboard name<Input required maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label>
    {profile&&<label className="twin-setting-toggle"><Checkbox checked={copy} onCheckedChange={v=>setCopy(v===true)}/>Save as a separate dashboard</label>}
    <details className="dashboard-settings-group" open><summary>Patient panel columns<span>Choose and reorder</span></summary><div className="dashboard-settings-group-body"><p id="dashboard-reorder-help">Drag the handle to reorder, or use the up and down buttons. Patient identity and priority always remain visible.</p>
    <ol className="dashboard-column-list">{draft.columns.map((column,index)=><li key={column} className={dragged?.group==='columns'&&dragged.id===column?'is-dragging':''} onDragOver={e=>{if(dragged?.group==='columns'){e.preventDefault();e.dataTransfer.dropEffect='move';}}} onDrop={e=>{e.preventDefault();if(dragged?.group==='columns')reorder('columns',dragged.id,column);setDragged(null);}}><button type="button" className="dashboard-drag-handle" draggable aria-label={'Drag '+dashboardColumnLabels[column]+' to reorder'} aria-describedby="dashboard-reorder-help" onDragStart={e=>{setDragged({group:'columns',id:column});e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',column);}} onDragEnd={()=>setDragged(null)}><GripVertical size={16}/></button><span>{dashboardColumnLabels[column]}</span><Button type="button" size="sm" variant="outline" disabled={index===0} aria-label={'Move '+dashboardColumnLabels[column]+' earlier'} onClick={()=>move(column,-1)}><ArrowUp size={16}/></Button><Button type="button" size="sm" variant="outline" disabled={index===draft.columns.length-1} aria-label={'Move '+dashboardColumnLabels[column]+' later'} onClick={()=>move(column,1)}><ArrowDown size={16}/></Button><Button type="button" size="sm" variant="outline" disabled={draft.columns.length===1} onClick={()=>setDraft({...draft,columns:draft.columns.filter(c=>c!==column)})} aria-label={'Hide '+dashboardColumnLabels[column]}>Hide</Button></li>)}</ol>
    <div className="dashboard-hidden-columns">{dashboardColumns.filter(c=>!draft.columns.includes(c)).map(column=><Button type="button" variant="outline" key={column} onClick={()=>setDraft({...draft,columns:[...draft.columns,column]})}>Show {dashboardColumnLabels[column]}</Button>)}</div>
    </div></details><details className="dashboard-settings-group"><summary>Patient chart sections<span>Order and visibility</span></summary><div className="dashboard-settings-group-body"><p>Safety, unresolved concerns, patient goal, and the care plan always remain visible.</p>
    <div className="dashboard-hidden-columns">{[{name:'Complete synopsis',sections:[...reviewSections]},{name:'Medication follow-up',sections:['medications','pst','shadow','outcomes','twin','advisor','evidence','pathway','notes'] as typeof reviewSections[number][]},{name:'Progress review',sections:['outcomes','twin','advisor','medications','pathway','pst','shadow','evidence','notes'] as typeof reviewSections[number][]}].map(preset=><Button type="button" variant="outline" key={preset.name} onClick={()=>setDraft({...draft,reviewSections:preset.sections})}>{preset.name}</Button>)}</div>
    <ol className="dashboard-column-list">{(draft.reviewSections??[...reviewSections]).map((section,index)=>{const sections=draft.reviewSections??[...reviewSections];const move=(offset:number)=>{const target=sections[index+offset];if(target)reorder('reviewSections',section,target);};return <li key={section} className={dragged?.group==='reviewSections'&&dragged.id===section?'is-dragging':''} onDragOver={e=>{if(dragged?.group==='reviewSections'){e.preventDefault();e.dataTransfer.dropEffect='move';}}} onDrop={e=>{e.preventDefault();if(dragged?.group==='reviewSections')reorder('reviewSections',dragged.id,section);setDragged(null);}}><button type="button" className="dashboard-drag-handle" draggable aria-label={'Drag '+reviewSectionLabels[section]+' to reorder'} onDragStart={e=>{setDragged({group:'reviewSections',id:section});e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',section);}} onDragEnd={()=>setDragged(null)}><GripVertical size={16}/></button><span>{reviewSectionLabels[section]}</span><Button type="button" size="sm" variant="outline" disabled={index===0} aria-label={'Move '+reviewSectionLabels[section]+' up'} onClick={()=>move(-1)}><ArrowUp size={16}/></Button><Button type="button" size="sm" variant="outline" disabled={index===sections.length-1} aria-label={'Move '+reviewSectionLabels[section]+' down'} onClick={()=>move(1)}><ArrowDown size={16}/></Button><Button type="button" size="sm" variant="outline" disabled={sections.length===1} onClick={()=>setDraft({...draft,reviewSections:sections.filter(s=>s!==section)})}>Hide</Button></li>;})}</ol>
    <div className="dashboard-hidden-columns">{reviewSections.filter(s=>!(draft.reviewSections??reviewSections).includes(s)).map(section=><Button type="button" variant="outline" key={section} onClick={()=>setDraft({...draft,reviewSections:[...(draft.reviewSections??reviewSections),section]})}>Show {reviewSectionLabels[section]}</Button>)}</div>
    </div></details><details className="dashboard-settings-group"><summary>Additional dashboard sections<span>Summary, engines, examples</span></summary><div className="dashboard-settings-group-body">{([{key:'showSummary',label:'Patient summary counts'},{key:'showEngines',label:'Show engine summaries under each patient'},{key:'showEngineIntro',label:'Engine workspace shortcut'},{key:'showDemoLinks',label:'Expand sample patient journeys'}] as const).map(item=><label className="twin-setting-toggle" key={item.key}><Checkbox checked={draft[item.key]} onCheckedChange={v=>setDraft({...draft,[item.key]:v===true})}/>{item.label}</label>)}
    </div></details><details className="dashboard-settings-group" open><summary>Starting view<span>Filters and display</span></summary><div className="dashboard-settings-group-body"><div className="dashboard-filter-grid"><label>Starting patient filter<Picker label="Starting patient filter" value={draft.filter} onChange={filter=>setDraft({...draft,filter:filter as DashboardLayout['filter']})} options={[...dashboardFilters]}/></label><label>Starting clinician filter<Picker label="Starting clinician filter" value={draft.clinician} onChange={clinician=>setDraft({...draft,clinician})} options={Array.from(new Set(['All clinicians',draft.clinician,...ctx.data.patients.map(p=>p.clinician)]))}/></label><label>Patient order<Picker label="Patient order" value={draft.sort} onChange={sort=>setDraft({...draft,sort:sort as DashboardLayout['sort']})} options={[{value:'priority',label:'Priority first'},{value:'name',label:'Patient name'},{value:'visit',label:'Next visit'}]}/></label><label>Display density<Picker label="Display density" value={draft.density} onChange={density=>setDraft({...draft,density:density as DashboardLayout['density']})} options={[{value:'comfortable',label:'Comfortable'},{value:'compact',label:'Compact'}]}/></label></div>
    </div></details><div className="dashboard-layout-preview"><strong>Panel preview</strong><p>Patient & priority → {draft.columns.map(c=>dashboardColumnLabels[c]).join(' → ')}</p><p>{draft.showEngines?'Engine summaries appear below each patient.':'Open the patient chart to view engine summaries.'} All records remain available in the patient chart.</p></div>
    <Button type="button" variant="outline" onClick={()=>setDraft(defaultDashboardLayout())}>Reset draft to full overview</Button>
    {conflict&&<p role="alert">This profile changed while you were editing. Reopen the editor to use the latest layout, or save a separate dashboard.</p>}{error&&<p role="alert" ref={errorRef} tabIndex={-1}>{error}</p>}
    <div className="form-actions"><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button type="submit" disabled={conflict||!name.trim()}>{ctx.busy||saving?'Saving…':'Save dashboard'}</Button></div>
  </fieldset></form>;
}
