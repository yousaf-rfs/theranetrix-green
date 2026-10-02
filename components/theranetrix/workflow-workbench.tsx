'use client';
import {RecommendationDetails} from './recommendation-details';
import {CareOperationsPanel} from './care-operations-panel';
import {encounterContext,decisionSourceSnapshot,carePlanPackages,careActionReferences,decisionObservationSources} from '@/lib/clinical-flows/context';
import {engineRecordRevision} from '@/lib/engine-demo';
import {reconcileWorkflowRoute,selectWorkflow,focusWorkflowJourney,workflowOpenEvent,workflowOpenDomain,type WorkflowNavigation} from '@/lib/workflow-navigation';
import type {Action} from '@/lib/actions';
import {DemoConnectionPanel} from './demo-connection';
import {useEffect,useId,useRef,useState,useSyncExternalStore} from 'react';
import {clinicalWorkflowDomains,clinicalWorkflowWorkerProvenance,normalizeClinicalWorkflows,workflowInputRevision,workspaceCarePlans,type ClinicalWorkflowDomain} from '@/lib/clinical-flows';
import type {Patient,Workspace} from '@/lib/theranetrix';
import {referralPromptPrefill} from '@/lib/medications';
import {Panel} from './ui';
import {EncountersPanel} from './clinical-flows/encounters';
import {ResultsReferralsPanel} from './clinical-flows/results-referrals';
import {TreatmentContinuityPanel} from './clinical-flows/treatment-continuity';
import {PatientCoordinationPanel} from './clinical-flows/patient-coordination';
import {DecisionsPanel,type DecisionsClinicalContext} from './clinical-flows/decisions';
import {IntegrationAccessPanel} from './clinical-flows/integration-access';
import {ProgramGovernancePanel} from './clinical-flows/program-governance';
import styles from './workflow-workbench.module.css';

type Props={workspace:Workspace;patient?:Patient;actor?:string;mode?:'patient'|'settings';busy:boolean;onAction:(action:Action)=>Promise<boolean>};
const subscribeLocation=(listener:()=>void)=>{window.addEventListener('popstate',listener);return ()=>window.removeEventListener('popstate',listener);};
const getLocationSearch=()=>window.location.search;
const serverLocationSearch=()=>'';
const workflowDescriptions:Record<ClinicalWorkflowDomain,string>={
  encounters:'Prepare the visit, confirm observations, and record the care plan.',
  decisions:'Review supporting information and document the clinical decision.',
  'treatment-continuity':'Reconcile medication changes and transitions in care.',
  'results-referrals':'Track requested tests, review results, and coordinate referrals.',
  'patient-coordination':'Follow patient activities, check-ins, and care-team handoffs.',
  'integration-access':'Review connection records and manage access to services.',
  'program-governance':'Review protocols, release controls, and program decisions.',
};

const workflowTasks:Record<ClinicalWorkflowDomain,[string,string][]>= {
  encounters:[['J01','Prepare visit'],['J02','Review intake'],['J08','Assess patient'],['J11','Confirm observations'],['J14','Sign encounter'],['J17','Review episode']],
  decisions:[['J05','Review patient state'],['J06','Compare options'],['J07','Review engines'],['J20','Draft decision'],['J18','Review and sign']],
  'treatment-continuity':[['J03','Reconcile medications'],['J04','Review experience'],['J31','Track treatment'],['J32','Resolve access'],['J33','Accept handover'],['J34','Coordinate care']],
  'results-referrals':[['J29','Review tests and results'],['J30','Manage referrals']],
  'patient-coordination':[['J09','Patient support'],['J10','Accept handoff'],['J13','Language and access'],['J15','Update pathway'],['J16','Schedule outreach']],
  'integration-access':[['J19','Connection and launch'],['J12','Reconcile incoming data'],['J21','Access and consent']],
  'program-governance':[['J22','Configuration'],['J23','Protocols'],['J24','Evidence registry'],['J25','Release registry'],['J26','Operations'],['J27','Monitoring'],['J28','Release readiness']],
};
const workflowBasis:Record<ClinicalWorkflowDomain,string[]>={
  encounters:['Review preparation, intake, and observations before signing the encounter. Each step stores its own review status.', 'A saved report is not a confirmed observation. Corrections and prior versions remain available for review.'],
  decisions:['Inspect patient state, available options, and source records before drafting a decision.', 'Sign-off checks the reviewed source versions and current patient inputs. Saved engine rankings do not establish clinical validity.'],
  'treatment-continuity':['Reported medication use, treatment experience, and access barriers are separate records.', 'A handover stays open until receiving ownership is accepted and pending work is addressed. Dispensing alone does not establish use.'],
  'results-referrals':['Requested tests and referrals remain tracked until their recorded review and follow-up steps are complete.', 'Permitted actions depend on the current saved state and required documentation. They are workflow controls, not medical advice.'],
  'patient-coordination':['Support, handoffs, language needs, pathways, and outreach keep separate owners and statuses.', 'An urgent handoff remains visible until its recorded ownership and review requirements are met.'],
  'integration-access':['Incoming information requires identity matching and reconciliation before it updates a patient record.', 'Access and consent records describe workspace policy. A saved configuration does not establish a live external connection.'],
  'program-governance':['Evidence, protocols, and releases keep distinct versions and review histories.', 'A documented review does not itself deploy a release, validate a clinical model, or establish regulatory authorization.'],
};

export function WorkflowWorkbench(props:Props){
  // No draft text or selected encounter may follow a patient switch.
  return <Workbench key={props.patient?.id??'program'} {...props}/>;
}

function Workbench({workspace,patient,actor,mode='patient',busy,onAction}:Props){
  const id=useId();
  const workflows=normalizeClinicalWorkflows(workspace.clinicalWorkflows);
  const available=clinicalWorkflowDomains.filter(domain=>mode==='settings'?clinicalWorkflowWorkerProvenance[domain].scope==='program':domain!=='program-governance');
  const search=useSyncExternalStore(subscribeLocation,getLocationSearch,serverLocationSearch);
  const params=new URLSearchParams(search);
  const requested=available.find(domain=>domain===params.get('workflow'))??available.find(domain=>clinicalWorkflowWorkerProvenance[domain].journeys.includes(params.get('journey')??''));
  const [navigation,setNavigation]=useState<WorkflowNavigation<ClinicalWorkflowDomain>>({visited:[]});
  const currentNavigation=reconcileWorkflowRoute(navigation,requested);
  // React retries this render before committing children. An explicit new route
  // changes the destination; clearing guide parameters keeps mounted drafts.
  if(currentNavigation!==navigation)setNavigation(currentNavigation);
  const selected=currentNavigation.selected??(mode==='settings'?'integration-access':'encounters');
  const opened=currentNavigation.opened??false;
  const [error,setError]=useState('');
  const [taskNotice,setTaskNotice]=useState('');
  const [focusRequest,setFocusRequest]=useState(0),focusedRequest=useRef(0);
  const sending=useRef(false);
  const panels=useRef<HTMLDivElement>(null);
  const workflowPicker=useRef<HTMLSelectElement>(null);
  const workflowNavigation=useRef<HTMLElement>(null);
  const requestedJourney=params.get('workflowJourney');
  useEffect(()=>{
    const allowed=clinicalWorkflowDomains.filter(domain=>mode==='settings'?clinicalWorkflowWorkerProvenance[domain].scope==='program':domain!=='program-governance');
    const open=(event:Event)=>{
      const domain=workflowOpenDomain(event,allowed);if(!domain)return;
      setNavigation(previous=>selectWorkflow(previous,domain));setError('');setFocusRequest(previous=>previous+1);
    };
    window.addEventListener(workflowOpenEvent,open);
    return ()=>window.removeEventListener(workflowOpenEvent,open);
  },[mode]);
  useEffect(()=>{
    if(!opened||!requestedJourney||selected==='integration-access'||!clinicalWorkflowWorkerProvenance[selected].journeys.includes(requestedJourney))return;
    const activePanel=panels.current?.querySelector<HTMLElement>(`[data-workflow-domain="${selected}"]`);
    if(activePanel)focusWorkflowJourney(activePanel,requestedJourney);
  },[opened,requestedJourney,selected]);
  useEffect(()=>{
    if(!opened||focusedRequest.current===focusRequest)return;
    focusedRequest.current=focusRequest;
    const selectedButton=workflowNavigation.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if(selectedButton?.getClientRects().length)selectedButton.focus({preventScroll:true});else workflowPicker.current?.focus({preventScroll:true});
    panels.current?.scrollIntoView({block:'start'});
  },[focusRequest,opened]);
  function select(domain:ClinicalWorkflowDomain){setNavigation(previous=>selectWorkflow(previous,domain));setError('');setTaskNotice('');}
  function jumpToTask(journey:string){
    const active=panels.current?.querySelector<HTMLElement>(`[data-workflow-domain="${selected}"]`);
    if(active&&focusWorkflowJourney(active,journey)){setTaskNotice('');return;}
    if(active&&selected==='integration-access'){const live=active.querySelector<HTMLDetailsElement>('details');if(live)live.open=true;if(focusWorkflowJourney(active,journey)){setTaskNotice('');return;}}
    setTaskNotice('Open the relevant record below to continue this task.');
  }
  const mounted=currentNavigation.visited;
  async function dispatch(domain:ClinicalWorkflowDomain,command:{type:string;requestId:string}){
    if(busy||sending.current)return false;
    if(clinicalWorkflowWorkerProvenance[domain].scope==='patient'&&!patient){setError('Select a patient before saving.');return false;}
    sending.current=true;setError('');
    try{
      const saved=await onAction({type:'workflow.apply',domain,requestId:command.requestId,expectedSliceVersion:workflows.slices[domain].version,
        ...(clinicalWorkflowWorkerProvenance[domain].scope==='patient'?{patientId:patient!.id}:{}),command});
      if(!saved)setError('The change was not saved. Your entries have been kept. Review the error and try again.');
      return saved;
    }catch(caught){setError(caught instanceof Error?caught.message:'Unable to save this workflow.');return false;}
    finally{sending.current=false;}
  }
  const patients=workspace.patients.map(({id,name})=>({id,name}));
  const shared={patientId:patient?.id,patients,busy};
  const revision=patient?workflowInputRevision(patient,workspace):undefined;
  const observations:NonNullable<DecisionsClinicalContext['observations']>=patient?workflows.slices.encounters.state.observations.filter(row=>row.patientId===patient.id&&row.status==='confirmed').flatMap(row=>{
    const byTime=new Map<string,Partial<Record<'pain'|'function'|'sleep',number>>>();
    for(const entry of row.currentEntries){if(entry.value!==undefined)byTime.set(entry.recordedAt,{...byTime.get(entry.recordedAt),[entry.metric]:entry.value});}
    const synthetic=workflows.slices.encounters.state.intakes.some(intake=>intake.patientId===patient.id&&intake.encounterId===row.encounterId&&intake.syntheticEvaluation);
    return [...byTime].map(([collectedAt,metrics])=>({patientId:patient.id,encounterId:row.encounterId,inputVersion:revision!,collectedAt,receivedAt:row.createdAt,provenance:synthetic?'synthetic' as const:'observed' as const,metrics,sources:decisionObservationSources(workspace,patient,row.encounterId).filter(source=>source.collectedAt===collectedAt)}));
  }):[];
  const decisionContext:DecisionsClinicalContext={actor,currentInputVersion:revision,observations,savedRuns:workspace.engineRuns?.filter(run=>run.patientId===patient?.id),currentEngineRevision:patient?engineRecordRevision(patient,workspace):undefined,sourceSnapshot:patient?decisionSourceSnapshot(workspace,patient,'current-record',revision!,new Date().toISOString()):undefined,carePackages:patient?carePlanPackages(workspace,patient):undefined,
    plans:patient?.carePlans.filter(plan=>workspaceCarePlans(workspace).some(current=>current.id===plan.id&&current.patientId===patient.id)).map(plan=>({patientId:patient.id,encounterId:plan.encounterId,planRef:plan.id,updatedAt:plan.date})),
  };
  function panel(domain:ClinicalWorkflowDomain){
    switch(domain){
      case 'encounters':return <EncountersPanel {...shared} state={workflows.slices.encounters.state} clinicalContext={patient?encounterContext(workspace,patient,new Date().toISOString()):undefined} onAction={action=>dispatch(domain,action)}/>;
      case 'results-referrals':return <ResultsReferralsPanel {...shared} state={workflows.slices[domain].state} referralPrompt={patient?referralPromptPrefill(patient,workspace):undefined} onAction={action=>dispatch(domain,action)}/>;
      case 'treatment-continuity':return <TreatmentContinuityPanel {...shared} state={workflows.slices[domain].state} careActions={careActionReferences(workspace)} onAction={action=>dispatch(domain,action)} bridge={Object.fromEntries(workspace.patients.map(p=>[p.id,{medications:p.medications.map(m=>({id:m.id,name:m.name,recordedAt:m.reviewedAt||m.reportedAt})),clinicalContext:p.clinicalContext?{recordedAt:p.clinicalContext.date,summary:[p.clinicalContext.medicalHistory,p.clinicalContext.allergies,p.clinicalContext.preferences].filter(Boolean).join('\n')}:undefined,integrationStatus:'unconfigured' as const}]))}/>;
      case 'patient-coordination':return <PatientCoordinationPanel {...shared} state={workflows.slices[domain].state} onAction={action=>dispatch(domain,action)} clinicalContext={{carePlans:workspaceCarePlans(workspace),protocolAssignments:workflows.slices['program-governance'].state.protocolAssignments}}/>;
      case 'decisions':return <DecisionsPanel {...shared} state={workflows.slices.decisions.state} onAction={action=>dispatch(domain,action)} onRunComparison={preferences=>patient?onAction({type:'engine.run',patientId:patient.id,expectedRevision:engineRecordRevision(patient,workspace),preferences}):Promise.resolve(false)} clinicalContext={decisionContext}/>;
      case 'integration-access':return <div className="stack"><DemoConnectionPanel workspace={workspace} patientId={patient?.id} busy={busy} onAction={onAction}/><details><summary>Live connection configuration</summary><IntegrationAccessPanel {...shared} state={workflows.slices[domain].state} onAction={action=>dispatch(domain,action)}/></details></div>;
      case 'program-governance':return <ProgramGovernancePanel {...shared} state={workflows.slices[domain].state} patientPathways={workflows.slices['patient-coordination'].state.pathways} onAction={action=>dispatch(domain,action)}/>;
    }
  }
  return <Panel className="care-workbench" title={mode==='settings'?'Program workflows':'Clinical workflows'} subtitle={mode==='settings'?'Manage connections, access, and governed releases.':'Choose a care area to continue the patient’s care.'}
    action={<button type="button" className="text-link" aria-expanded={opened} aria-controls={id} onClick={()=>{setNavigation(previous=>({...selectWorkflow(previous,selected),opened:!opened}));setError('');}}>{opened?'Hide workflows':'Open workflows'}</button>}>
    {!opened&&<div className="care-workbench-launcher">{available.map(domain=><button type="button" key={domain} disabled={busy} onClick={()=>select(domain)}>{clinicalWorkflowWorkerProvenance[domain].title}<span aria-hidden="true">↗</span></button>)}</div>}
    <div ref={panels} id={id} hidden={!opened} className={styles.body+' care-workbench-body'}>
      <nav ref={workflowNavigation} className="care-workbench-nav" aria-label="Workflow areas"><span className="care-nav-label">Care areas</span>{available.map((domain,index)=><button type="button" key={domain} aria-pressed={domain===selected} disabled={busy} onClick={()=>select(domain)}><span className="care-nav-number" aria-hidden="true">{String(index+1).padStart(2,'0')}</span><span><strong>{clinicalWorkflowWorkerProvenance[domain].title}</strong><small>{workflowDescriptions[domain]}</small></span></button>)}</nav>
      <div className="care-workbench-main">
        <label className={styles.picker+' care-workbench-mobile-picker'}>Workflow area<select ref={workflowPicker} value={selected} onChange={event=>select(event.target.value as ClinicalWorkflowDomain)} disabled={busy}>{available.map(domain=><option key={domain} value={domain}>{clinicalWorkflowWorkerProvenance[domain].title}</option>)}</select></label>
        <div className="care-workbench-stage-heading"><span className="care-nav-label">{patient?patient.name+' · '+patient.id:'Program records'}</span><h3>{clinicalWorkflowWorkerProvenance[selected].title}</h3><p>{workflowDescriptions[selected]}</p></div>
        <div className="clinician-workflow-tools"><nav className="clinician-task-jumps" aria-label="Tasks in this care area">{workflowTasks[selected].map(([journey,label])=><button type="button" key={journey} disabled={busy} onClick={()=>jumpToTask(journey)}>{label}<span aria-hidden="true">↓</span></button>)}</nav><RecommendationDetails title={clinicalWorkflowWorkerProvenance[selected].title+' review basis'} label="Why these review steps?" rationale={workflowBasis[selected]} sources={[{label:'Workflow source',value:'Saved '+clinicalWorkflowWorkerProvenance[selected].title.toLowerCase()+' records, revision '+workflows.slices[selected].version},...(patient?[{label:'Patient context',value:patient.name+' · '+patient.id}]:[])]} limitations={['Steps describe this workspace’s documented workflow. External delivery requires a configured service.']}/>{taskNotice&&<p role="status">{taskNotice}</p>}<p className={styles.context}>Changes save to this workspace. External delivery requires a configured service.</p></div>
        {error&&<p role="alert" className={styles.error}>{error}</p>}
        {!patient&&mode==='patient'?<p>Select a patient to open clinical workflows.</p>:mounted.map(domain=><div key={domain} hidden={domain!==selected} data-workflow-domain={domain}>{panel(domain)}</div>)}
        {patient&&mounted.length>0&&<div className="care-workbench-continuity"><CareOperationsPanel key={patient.id} workspace={workspace} patient={patient} busy={busy} onAction={onAction}/></div>}
      </div>
    </div>
  </Panel>;
}
