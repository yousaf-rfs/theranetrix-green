'use client';

import {useEffect, useRef, useState, type CSSProperties} from 'react';
import {BrandLogo} from './brand-logo';
import {PatientPreviewPanel} from './patient-preview-panel';
import {PatientDetail} from './patient';
import patientStyles from './patient-details.module.css';
import {useLocationParameter} from './location-state';
import {toast} from 'sonner';
import {Toaster} from '@/components/ui/sonner';
import {SidebarProvider, Sidebar, SidebarTrigger} from '@/components/ui/sidebar';
import type {Workspace, Patient} from '@/lib/theranetrix';
import {needsAction} from '@/lib/patient-overview';
import {Navigation, Patients, type Context} from './app';
import {CarePathways, ReviewQueue, Messages, Schedule, Companion, WorkspaceSettings} from './workflows';
import {EntryDialog, type EntryKind} from './forms';
import {FutureCapabilities} from './future-preview';
import {EmptyState, PageTitle} from './ui';
import {applyAction, actionSchema} from '@/lib/actions';
import {previewHref} from '@/lib/preview-navigation';
import {workspacePage} from '@/lib/workspace-advisor';
import screenStyles from './workspace-pages.module.css';
import clinicalStyles from './clinical-pages.module.css';
import communicationStyles from './communication-pages.module.css';
import {ClinicianOverview} from './clinician-overview';
import {NeedsActionBell} from './needs-action';
import {WorkspaceAdvisorDock} from './advisor-dock';

const previewMessage = () => toast.info('Design preview', {
  description: 'This sample workspace has no live services connected. Changes reset when you refresh.',
  id: 'home-preview',
});

/** A presentation-only entry point. It never loads or saves a live workspace. */
export function HomePreview({data: initialData}: {data: Workspace}) {
  const [data, setData] = useState(initialData);
  const dataRef = useRef(data);
  const [entry, setEntry] = useState<{kind: EntryKind; patient?: Patient} | null>(null);
  const view = useLocationParameter('view');
  const recordTab = useLocationParameter('tab');
  const treatmentPicker = useLocationParameter('open') === 'treatment';
  const returnLocation = useRef('/');
  const attention = needsAction(data);
  const recordPatientId = useLocationParameter('patient');
  const recordPatient = !view ? data.patients.find(patient=>patient.id===recordPatientId) : undefined;
  const activePath = recordPatient ? (recordTab==='treatment'?'/engines':'/patients/'+recordPatient.id) : view==='patients'&&treatmentPicker?'/engines':view?'/'+view:'/';
  const advisorPage = workspacePage(activePath);
  const navigatingToRecord = useRef(false);
  const navigatePreview = (search: string) => {
    setPatientPanelOpen(false);
    setEntry(null);
    window.history.pushState(null, '', search.startsWith('/')?search:'/'+search);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  const showPatientDetails = (patientId: string, tab='full') => {
    if(!recordPatient)returnLocation.current=window.location.pathname+window.location.search;
    navigatingToRecord.current = true;
    navigatePreview('?'+new URLSearchParams({patient:patientId,tab}).toString());
  };
  const backToWorklist = () => navigatePreview(returnLocation.current);
  const [selectedPatient, setSelectedPatient] = useState<string | null>(null);
  const [patientPanelOpen, setPatientPanelOpen] = useState(false);
  const patientTrigger = useRef<HTMLElement | null>(null);
  const openPatient = (patientId: string, trigger: HTMLElement) => {
    navigatingToRecord.current = false;
    patientTrigger.current = trigger;
    setSelectedPatient(patientId);
    setPatientPanelOpen(true);
  };
  const ctx: Context = {
    data, user: 'Demo care team', accessMode: 'shared', busy: false, preview: true,
    open: (kind,patient)=>setEntry({kind,patient}),
    save: async (action) => {
      try {
        const updated=applyAction(dataRef.current,actionSchema.parse(action),'Demo care team');
        dataRef.current=updated; setData(updated);
        toast.success('Updated in this demo', {description:'Sample data only. Changes reset on refresh.'});
        return true;
      } catch(error) {
        toast.error(error instanceof Error?error.message:'Unable to update the sample record.');
        return false;
      }
    },
    signOut: async () => { previewMessage(); },
  };

  useEffect(()=>{
    const frame=requestAnimationFrame(()=>{
      if(recordPatient){
        if(window.location.hash)return;
        window.scrollTo({top:0});
        const heading=document.querySelector<HTMLElement>('.patient-record-head h1');
        heading?.setAttribute('tabindex','-1');
        heading?.focus({preventScroll:true});
      } else if(!view&&patientTrigger.current?.isConnected){
        patientTrigger.current.focus({preventScroll:true});
        patientTrigger.current.scrollIntoView({block:'nearest'});
      } else {
        window.scrollTo({top:0});
        const heading=Array.from(document.querySelectorAll<HTMLElement>('#main-content h1')).find(node=>!node.closest('[hidden]'));
        heading?.setAttribute('tabindex','-1'); heading?.focus({preventScroll:true});
      }
    });
    return ()=>cancelAnimationFrame(frame);
  },[recordPatient?.id,view]);

  // Resolve existing chart links locally; no live workspace or backend is needed.
  useEffect(() => {
    function keepHome(event: globalThis.MouseEvent) {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!link || link.hasAttribute('data-directory-patient')) return;
      const destination = new URL(link.getAttribute('href')!, window.location.href);
      if (destination.origin !== window.location.origin) return;
      // Hash-only section links and downloads keep their own behavior.
      const raw=link.getAttribute('href')!;
      if(raw.startsWith('#')||link.hasAttribute('download'))return;
      const target=previewHref(destination.pathname,destination.search,destination.hash);
      if(target===null){ event.preventDefault(); event.stopImmediatePropagation(); previewMessage(); return; }
      if(!view&&!recordPatient&&target==='/')return;
      if(destination.pathname===window.location.pathname&&destination.search===window.location.search&&destination.hash)return;
      event.preventDefault(); event.stopImmediatePropagation();
      if(destination.pathname.startsWith('/patients/')){
        if(!recordPatient)returnLocation.current=window.location.pathname+window.location.search;
        navigatingToRecord.current=true;
      }
      navigatePreview(target);
    }
    document.addEventListener('click', keepHome, true);
    document.addEventListener('auxclick', keepHome, true);
    return () => {
      document.removeEventListener('click', keepHome, true);
      document.removeEventListener('auxclick', keepHome, true);
    };
  }, [data, recordPatientId, view]);

  return <>
    <SidebarProvider className="redesign-shell" style={{'--sidebar-width': '216px'} as CSSProperties}>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <Sidebar className="thera-sidebar">
        <Navigation path={activePath} enginePatient={recordPatient?.id??''} user="Demo care team" accessMode="shared"
          reviews={data.reviews.filter(review => review.status !== 'Resolved').length}
          replies={attention.groups.find(group => group.id === 'replies')?.rows.length ?? 0}
          notification={<NeedsActionBell attention={attention} label="Notifications"/>}/>
      </Sidebar>
      <div className="workspace-main">
        <div className="forest-mobile-navigation"><SidebarTrigger aria-label="Toggle navigation"/><BrandLogo compact/></div>
        <main className="main-content" id="main-content">
          <div hidden={!!recordPatientId||!!view}><ClinicianOverview ctx={ctx} onOpenPatient={openPatient}/></div>
          {view&&<div className={[screenStyles.screens,communicationStyles.communication].join(' ')} key={view+':'+(recordPatientId??'')}>
            {view==='patients'?<Patients ctx={ctx} onOpenPatient={openPatient}/>:view==='review-queue'?<ReviewQueue ctx={ctx}/>:view==='messages'?<Messages ctx={ctx}/>:view==='schedule'?<Schedule ctx={ctx}/>:view==='care-pathways'?<div className={clinicalStyles.clinical}><CarePathways ctx={ctx}/></div>:view==='patient-companion'?<><PageTitle title="Patient companion" description="See the patient's check-ins, care plan, and messages."/><div className="companion-preview"><Companion ctx={ctx}/></div></>:view==='settings'?<WorkspaceSettings ctx={ctx}/>:view==='future-capabilities'?<FutureCapabilities/>:<EmptyState title="Page not found" description="Choose a page from the workspace navigation."/>}
          </div>}
          {!view&&recordPatientId&&!recordPatient&&<EmptyState title="Patient not found" description="Choose an available record from Patients."/>}
          {recordPatient&&<><div className="preview-record-heading"><span>Patient details</span><button type="button" onClick={backToWorklist}>Back to worklist</button></div><div className={patientStyles.page}><PatientDetail key={recordPatient.id} patient={recordPatient} ctx={ctx} onPatientChange={showPatientDetails}/></div></>}
        </main>
        {!recordPatient&&advisorPage&&<WorkspaceAdvisorDock ctx={ctx} page={advisorPage}/>}
        <footer className="workspace-footer" style={{justifyContent: 'flex-start', gap: 16, flexWrap: 'wrap'}}><span>Sample workspace · Changes reset on refresh</span><form action="/__preview/logout" method="post"><button type="submit" className="text-link">Lock preview</button></form></footer>
      </div>
      <PatientPreviewPanel patient={data.patients.find(patient => patient.id === selectedPatient) ?? null}
        ctx={ctx} open={patientPanelOpen} onOpenChange={setPatientPanelOpen}
        onPatientDetails={showPatientDetails}
        returnFocus={() => {if(!navigatingToRecord.current)patientTrigger.current?.focus();}}/>
      <EntryDialog entry={entry} close={()=>setEntry(null)} ctx={ctx}/>
      <Toaster position="top-right" richColors closeButton/>
    </SidebarProvider>
  </>;
}
