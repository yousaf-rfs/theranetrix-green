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
import type {Workspace} from '@/lib/theranetrix';
import {needsAction} from '@/lib/patient-overview';
import {Navigation, type Context} from './app';
import {ClinicianOverview} from './clinician-overview';
import {NeedsActionBell} from './needs-action';
import {WorkspaceAdvisorDock} from './advisor-dock';

const previewMessage = () => toast.info('Design preview', {
  description: 'This preview uses sample patients. Saving changes and other workspace screens are not included.',
  id: 'home-preview',
});

/** A presentation-only entry point. It never loads or saves a live workspace. */
export function HomePreview({data}: {data: Workspace}) {
  const attention = needsAction(data);
  const recordPatientId = useLocationParameter('patient');
  const recordPatient = data.patients.find(patient=>patient.id===recordPatientId);
  const navigatingToRecord = useRef(false);
  const navigatePreview = (search: string) => {
    setPatientPanelOpen(false);
    window.history.pushState(null, '', '/'+search);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  const showPatientDetails = (patientId: string, tab='full') => {
    navigatingToRecord.current = true;
    navigatePreview('?'+new URLSearchParams({patient:patientId,tab}).toString());
  };
  const backToWorklist = () => navigatePreview('');
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
    data, user: 'Demo care team', accessMode: 'shared', busy: false,
    open: previewMessage,
    save: async () => { previewMessage(); return false; },
    signOut: async () => { previewMessage(); },
  };

  useEffect(()=>{
    const frame=requestAnimationFrame(()=>{
      if(recordPatientId){
        window.scrollTo({top:0});
        const heading=document.querySelector<HTMLElement>('.patient-record-head h1');
        heading?.setAttribute('tabindex','-1');
        heading?.focus({preventScroll:true});
      } else if(patientTrigger.current?.isConnected){
        patientTrigger.current.focus({preventScroll:true});
        patientTrigger.current.scrollIntoView({block:'nearest'});
      }
    });
    return ()=>cancelAnimationFrame(frame);
  },[recordPatientId]);

  // Resolve existing chart links locally; no live workspace or backend is needed.
  useEffect(() => {
    function keepHome(event: globalThis.MouseEvent) {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!link) return;
      const destination = new URL(link.getAttribute('href')!, window.location.href);
      if (destination.origin !== window.location.origin) return;
      const patientMatch=destination.pathname.match(/^\/patients\/([^/]+)\/?$/);
      if(patientMatch){
        const id=decodeURIComponent(patientMatch[1]);
        if(data.patients.some(patient=>patient.id===id)){
          event.preventDefault();
          event.stopImmediatePropagation();
          const params=new URLSearchParams(destination.search);
          params.set('patient',id);
          if(!params.has('tab'))params.set('tab','full');
          navigatingToRecord.current=true;
          navigatePreview('?'+params.toString()+destination.hash);
          return;
        }
      }
      if(destination.pathname==='/'){
        if(recordPatientId&&!destination.search&&!destination.hash){
          event.preventDefault();event.stopImmediatePropagation();backToWorklist();
        }
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      previewMessage();
    }
    document.addEventListener('click', keepHome, true);
    document.addEventListener('auxclick', keepHome, true);
    return () => {
      document.removeEventListener('click', keepHome, true);
      document.removeEventListener('auxclick', keepHome, true);
    };
  }, [data, recordPatientId]);

  return <>
    <SidebarProvider className="redesign-shell" style={{'--sidebar-width': '216px'} as CSSProperties}>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <Sidebar className="thera-sidebar">
        <Navigation path={recordPatient?'/patients/'+recordPatient.id:'/'} enginePatient={recordPatient?.id??''} user="Demo care team" accessMode="shared"
          reviews={data.reviews.filter(review => review.status !== 'Resolved').length}
          replies={attention.groups.find(group => group.id === 'replies')?.rows.length ?? 0}
          notification={<NeedsActionBell attention={attention} label="Notifications"/>}/>
      </Sidebar>
      <div className="workspace-main">
        <div className="forest-mobile-navigation"><SidebarTrigger aria-label="Toggle navigation"/><BrandLogo compact/></div>
        <main className="main-content" id="main-content">
          <div hidden={!!recordPatient}><ClinicianOverview ctx={ctx} onOpenPatient={openPatient}/></div>
          {recordPatient&&<><div className="preview-record-heading"><span>Patient details</span><button type="button" onClick={backToWorklist}>Back to worklist</button></div><div className={patientStyles.page}><PatientDetail key={recordPatient.id} patient={recordPatient} ctx={ctx} onPatientChange={showPatientDetails}/></div></>}
        </main>
        {!recordPatient&&<WorkspaceAdvisorDock ctx={ctx} page="overview"/>}
        <footer className="workspace-footer" style={{justifyContent: 'flex-start', gap: 16, flexWrap: 'wrap'}}><span>Design preview · Sample patients · Changes are not saved</span><form action="/__preview/logout" method="post"><button type="submit" className="text-link">Lock preview</button></form></footer>
      </div>
      <PatientPreviewPanel patient={data.patients.find(patient => patient.id === selectedPatient) ?? null}
        ctx={ctx} open={patientPanelOpen} onOpenChange={setPatientPanelOpen}
        onPatientDetails={showPatientDetails}
        returnFocus={() => {if(!navigatingToRecord.current)patientTrigger.current?.focus();}}/>
      <Toaster position="top-right" richColors closeButton/>
    </SidebarProvider>
  </>;
}
