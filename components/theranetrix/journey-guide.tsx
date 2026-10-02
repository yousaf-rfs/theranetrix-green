'use client';
import {useEffect, useId, useRef, useState, type MouseEvent} from 'react';
import Link from 'next/link';
import {chapters, findJourney, journeys, journeyHref, readJourneyContext, readinessLabels, screenLabels, suggestedPatient, type JourneyContext, type JourneyPatient} from '@/lib/journey-navigation';
import {clinicalWorkflowDomains,clinicalWorkflowWorkerProvenance} from '@/lib/clinical-flows';
import styles from './journey-guide.module.css';

type Props = {path: string; patients: readonly JourneyPatient[]; busy: boolean};

function workflowDomain(journeyId:string){
  return clinicalWorkflowDomains.find(domain=>clinicalWorkflowWorkerProvenance[domain].journeys.includes(journeyId));
}

/** Direct workflow links preserve explicit patient identity and exit the screen guide. */
export function journeyWorkflowHref(journeyId:string,patientId:string,patients:readonly JourneyPatient[]):string|null{
  const journey=findJourney(journeyId),domain=workflowDomain(journeyId);
  if(!journey||!domain)return null;
  if(journey.requiresPatient){
    if(!patientId||!patients.some(patient=>patient.id===patientId))return null;
    return '/patients/'+encodeURIComponent(patientId)+'?workflow='+encodeURIComponent(domain)+'&workflowJourney='+journeyId;
  }
  if(patientId)return null;
  return '/settings?workflow='+encodeURIComponent(domain)+'&workflowJourney='+journeyId;
}

function workflowReadinessLabel(journeyId:string){
  const journey=findJourney(journeyId);
  return workflowDomain(journeyId)?'Workflow available':journey?readinessLabels[journey.readiness]:'Workflow unavailable';
}

/** Optional navigation aid. Never writes records, claims completion, or grants a role. */
export function JourneyGuide({path, patients, busy}: Props) {
  const formId = useId();
  const editedForms = useRef(new Set<HTMLFormElement>());
  useEffect(() => {
    const changed = (event: Event) => {
      const element = event.target;
      if (!(element instanceof Element) || element.closest('[data-journey-guide]')) return;
      const form = element.closest('form');
      if (form) editedForms.current.add(form);
    };
    document.addEventListener('input', changed, true);
    document.addEventListener('change', changed, true);
    return () => {
      document.removeEventListener('input', changed, true);
      document.removeEventListener('change', changed, true);
    };
  }, []);
  const guardNavigation = (event: MouseEvent<HTMLElement>) => {
    if (!(event.target instanceof Element) || !event.target.closest('a[href]')) return;
    if (busy) { event.preventDefault(); return; }
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const hasEditedForm = [...editedForms.current].some(form => form.isConnected);
    if (hasEditedForm && !window.confirm('Leave this screen? An edited form may contain unsaved changes. Cancel to save it before continuing.')) event.preventDefault();
  };
  const [context, setContext] = useState<JourneyContext>({kind: 'none'});
  const [chapterId, setChapterId] = useState('all');
  const [selectedId, setSelectedId] = useState('J04');
  const [patientId, setPatientId] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const sync = () => setContext(readJourneyContext(window.location.pathname, window.location.search, patients));
    // Existing patient tabs call replaceState rather than a router. Observe those
    // changes so dropping the journey query also removes the old guide.
    const history = window.history, replace = history.replaceState, push = history.pushState;
    const observedReplace: History['replaceState'] = function(...args) { replace.apply(history, args); sync(); };
    const observedPush: History['pushState'] = function(...args) { push.apply(history, args); sync(); };
    history.replaceState = observedReplace;
    history.pushState = observedPush;
    sync();
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      if (history.replaceState === observedReplace) history.replaceState = replace;
      if (history.pushState === observedPush) history.pushState = push;
    };
  }, [path, patients]);

  if (context.kind === 'invalid') return <aside data-journey-guide onClickCapture={guardNavigation} className={styles.guide} aria-label="Journey navigation stopped">
    <strong>Journey navigation stopped</strong><p>{context.reason}</p>
    {busy?<span role="status">Finish saving before navigating.</span>:<Link href="/">Return to Care overview</Link>}
  </aside>;

  if (context.kind === 'active') {
    const {journey: item, patientId: activeId, stop} = context;
    const activePatient = patients.find(p => p.id === activeId);
    const next = journeyHref(item.id, stop + 1, activeId, patients);
    const previous = journeyHref(item.id, stop - 1, activeId, patients);
    const workflowHref=journeyWorkflowHref(item.id,activeId,patients);
    return <aside data-journey-guide onClickCapture={guardNavigation} className={styles.guide} aria-label="Patient journey guide">
      <div className={styles.heading}><div><span className={styles.eyebrow}>GUIDED JOURNEY {item.id}</span>
        <h2>{item.title}</h2><p>{activePatient ? 'Guide links for ' + activePatient.name : 'Program operations'} | Guide stop {stop + 1} of {item.screens.length}</p>
      </div><span className={styles.status}>{workflowReadinessLabel(item.id)}</span></div>
      <p className={styles.question}>{item.question}</p>
      <details><summary>Related screens and workflow scope</summary>
        <nav aria-label="Journey screen links" className={styles.stops}>{item.screens.map((screen, index) => {
          const href = journeyHref(item.id, index, activeId, patients);
          return href && !busy ? <a key={index} href={href} aria-current={index === stop ? 'step' : undefined}><span>{index + 1}</span>{screenLabels[screen]}</a> : <span key={index}>{screenLabels[screen]}</span>;
        })}</nav>
        <p className={styles.note}>Use Open workflow to record and review this journey. The screen guide remains available for exploring related information. Visiting a screen does not complete a clinical task; external services and approvals still require their own setup and evidence.</p>
      </details>
      <div className={styles.actions}>
        {workflowHref && !busy && <a className={styles.primary} href={workflowHref}>Open workflow</a>}
        {previous && !busy && <a href={previous}>Previous guide screen</a>}
        {next && !busy && <a href={next}>Next guide screen</a>}
        {!busy && <Link href="/">Exit guide to Care overview</Link>}
        {busy && <span role="status">Finish saving before navigating.</span>}
      </div>
      <p className={styles.note}>Save open forms before navigating. Edited forms trigger a leave-page confirmation. Changing the patient in Account or Messages exits the guide. Guide positions are not clinical completion records; access permissions are unchanged.</p>
    </aside>;
  }

  if (path !== '/') return null;
  const selected = findJourney(selectedId)!;
  const chapter = chapters.find(item => item.id === chapterId);
  const query = search.trim().toLowerCase();
  const ordered = chapter ? chapter.journeys.map(id => findJourney(id)!) : journeys;
  const visible = ordered.filter(item => !query || [item.id, item.title, item.category, item.suggestedPatient].join(' ').toLowerCase().includes(query));
  const visibleSelection = visible.some(item => item.id === selected.id);
  const href = visibleSelection ? journeyHref(selected.id, 0, patientId, patients) : null;
  const workflowHref=visibleSelection?journeyWorkflowHref(selected.id,patientId,patients):null;
  const choose = (id: string) => {
    const item = findJourney(id);
    if (!item) return;
    setSelectedId(item.id);
    setPatientId(item.requiresPatient ? suggestedPatient(item, patients) : '');
  };
  return <details data-journey-guide onClickCapture={guardNavigation} className={styles.launcher}>
    <summary><span className={styles.launcherMark} aria-hidden="true">{journeys.length}</span><div><strong>Explore patient journeys</strong><span>{journeys.length} journeys across the existing application</span></div></summary>
    <div className={styles.body}>
      <p>Choose a journey and patient record to open its workflow, or explore the related screens. Choosing a journey does not create patients, change records, or switch your access role.</p>
      <div className={styles.fields}>
        <label htmlFor={formId + '-chapter'}>Presentation chapter<select aria-label="Presentation chapter" id={formId + '-chapter'} value={chapterId} disabled={busy} onChange={event => {
          const id = event.target.value; setChapterId(id); setSearch('');
          const match = chapters.find(item => item.id === id);
          if (match) choose(match.journeys[0]);
        }}><option value="all">All chapters</option>{chapters.map(item => <option key={item.id} value={item.id}>{item.id} - {item.title}</option>)}</select></label>
        <label htmlFor={formId + '-search'}>Find a journey<input aria-label="Find a journey" id={formId + '-search'} value={search} onChange={event => setSearch(event.target.value)} placeholder="Patient, capability, or journey ID" type="search" /></label>
        <label htmlFor={formId + '-journey'}>Journey<select aria-label="Journey" id={formId + '-journey'} value={visibleSelection ? selectedId : ''} disabled={busy || !visible.length} onChange={event => choose(event.target.value)}>
          {!visibleSelection && <option value="">Choose a matching journey</option>}
          {chapter ? visible.map(item => <option key={item.id} value={item.id}>{item.id} - {item.title}</option>) : Array.from(new Set(visible.map(item => item.category))).map(category => <optgroup key={category} label={category}>{visible.filter(item => item.category === category).map(item => <option key={item.id} value={item.id}>{item.id} - {item.title}</option>)}</optgroup>)}
        </select></label>
        {selected.requiresPatient && <label htmlFor={formId + '-patient'}>Patient record<select aria-label="Patient record" id={formId + '-patient'} value={patientId} disabled={busy} onChange={event => setPatientId(event.target.value)}><option value="">Select a patient explicitly</option>{patients.map(patient => <option key={patient.id} value={patient.id}>{patient.name} ({patient.id})</option>)}</select></label>}
      </div>
      {!visible.length && <p role="status">No matching journeys. Clear the search or choose another chapter.</p>}
      {visibleSelection && <div className={styles.selection}>
        <div className={styles.heading}><h3>{selected.id} - {selected.title}</h3><span className={styles.status}>{workflowReadinessLabel(selected.id)}</span></div>
        <p className={styles.question}>{selected.question}</p>
        {selected.suggestedPatient && <p className={styles.note}>Suggested story: {selected.suggestedPatient}. Proposed cases may not exist yet; no different patient is substituted automatically. Choosing another record does not populate that scenario.</p>}
        <p className={styles.note}>Open the workflow to record and review this journey. The related screen guide starts with {screenLabels[selected.screens[0]]}. External services and approvals require their own setup and evidence.</p>
        <div className={styles.actions}>{workflowHref && !busy && <a className={styles.primary} href={workflowHref}>Open workflow</a>}{href && !busy ? <a href={href}>Open related screen</a> : <button type="button" disabled>{busy ? 'Saving in progress' : 'Choose an available patient to continue'}</button>}</div>
      </div>}
    </div>
  </details>;
}
