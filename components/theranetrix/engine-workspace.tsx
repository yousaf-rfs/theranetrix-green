'use client';
import {visitObservations} from '@/lib/visit-observations';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useLocationParameter} from './location-state';
import {SignedDecisionTrace} from './decision-trace';
import {Bot,Play,ArrowUpRight,Check,Clock,Send,AlertCircle,Database,ChevronRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Checkbox} from '@/components/ui/checkbox';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {buildEngineOutput,defaultEnginePreferences,engineRecordRevision,inferAdvisorIntent,twinOverview,type EngineDecisionDetails,type EngineOutput,type EnginePreferences,type EngineRun} from '@/lib/engine-demo';
import {decisionRationaleText,engineDecisionHeading,engineDecisionVerbs,unmarkPrototypeLabel} from '@/lib/engine-decision';
import {featureEnabled,type Patient} from '@/lib/theranetrix';
import type {Context} from './app';
import {reviewedPlanTranslation} from '@/lib/clinical-flows/patient-coordination';
import {Badge,Panel,formatDate,EmptyState,Term} from './ui';
import {isGlossaryTerm} from '@/lib/glossary';
import {RecommendationDetails} from './recommendation-details';
import {EngineRecommendation,AdvisorAnswerDetails} from './engine-recommendation';
import {RecordedTrendChart} from './patient-digital-twin';
import {TreatmentScreen,TwinStatusHeader} from './treatment-screen';
import {AdvisorDock} from './advisor-dock';
import {ADVISOR_NAME,ADVISOR_SENDER} from '@/lib/product-names';
export {AdvisorDock};

// Four nav entries open this page at different tabs; the heading follows the one clicked.
const enginePageHeadings:Record<string,{title:string;tab:string}>={
  '/engines':{title:'Treatment',tab:'treatment'},
  '/digital-twin':{title:'Digital Twin',tab:'twin'},
  '/pst':{title:'PST',tab:'treatment'},
  '/shadow-ai':{title:'Shadow AI',tab:'treatment'},
  '/robo-advisor':{title:ADVISOR_NAME,tab:'treatment'},
};
export function EngineWorkspace({ctx,path}:{ctx:Context;path:string}){
  const requested=useLocationParameter('patient'),[selectedPatient,setPatientId]=useState<string>();
  const patientId=selectedPatient??ctx.data.patients.find(p=>p.id===requested)?.id??ctx.data.patients.find(p=>p.id==='TN-DEMO-01')?.id??ctx.data.patients[0]?.id??'';
  const selectEnginePatient=ctx.selectEnginePatient;
  useEffect(()=>{selectEnginePatient?.(patientId);},[patientId,selectEnginePatient]);
  const p=ctx.data.patients.find(p=>p.id===patientId);
  if(!p)return <EmptyState title="Add a patient to open the engines"/>;
  const heading=enginePageHeadings[path]??enginePageHeadings['/engines'];
  const initialTab=heading.tab==='advisor'?'treatment':heading.tab;
  return <div className="engine-workspace"><TwinStatusHeader p={p} ctx={ctx}/><div className="engine-page-heading"><div><h1>{isGlossaryTerm(heading.title)?<Term t={heading.title}/>:heading.title}</h1></div><a className="text-link" href={'/patients/'+p.id}>Open clinical record <ArrowUpRight size={16}/></a></div><div className="engine-patient-bar"><div className="engine-case-buttons">{ctx.data.patients.filter(x=>x.demoCase).map(x=><button key={x.id} className={x.id===p.id?'selected':''} onClick={()=>{setPatientId(x.id);window.history.replaceState(null,'',path+'?patient='+x.id);}}><span className="engine-avatar" style={{background:x.color}}>{x.initials}</span><strong>{x.name}</strong>{x.id===p.id&&<Check size={16}/>}</button>)}</div></div><EngineBoard key={p.id} p={p} ctx={ctx} initialTab={initialTab}/><AdvisorDock p={p} ctx={ctx} startOpen={path==='/robo-advisor'}/></div>;
}

export function EngineBoard({p,ctx,initialTab,embedded=false}:{p:Patient;ctx:Context;initialTab:string;embedded?:boolean}){
  const runs=ctx.data.engineRuns?.filter(r=>r.patientId===p.id)??[],latest=runs[0];
  const [tab,setTab]=useState(['pst','shadow','compare','overview'].includes(initialTab)?'treatment':initialTab);
  const [preferences]=useState<EnginePreferences>(latest?.preferences??defaultEnginePreferences),[preview,setPreview]=useState(false),[basis,setBasis]=useState(false),[selected,setSelected]=useState<{runId:string;candidateId:string;optionTitle?:string;rationale?:string;details?:EngineDecisionDetails}|null>(null);
  const differentWeights=!!latest&&JSON.stringify(preferences)!==JSON.stringify(latest.preferences);
  const staleSaved=!!latest&&latest.revision!==engineRecordRevision(p,ctx.data);
  const useSaved=!preview&&!differentWeights&&!!latest&&!staleSaved;
  const output=useSaved?latest:buildEngineOutput(p,ctx.data,preferences);
  const saved=useSaved,stale=false;
  const decided=saved&&ctx.data.engineDecisions?.some(d=>d.runId===latest?.id);
  const selectCandidate=(id:string,optionTitle?:string,rationale?:string,details?:EngineDecisionDetails)=>{if(latest&&latest.candidates.some(candidate=>candidate.id===id))setSelected({runId:latest.id,candidateId:id,optionTitle,rationale,details});};
  const twin=featureEnabled(ctx.data,'digitalTwin'),pst=featureEnabled(ctx.data,'pst'),shadow=featureEnabled(ctx.data,'shadow');
  const canDecide=saved&&!stale&&(pst||shadow)&&!ctx.data.engineDecisions?.some(d=>d.runId===latest?.id);
  // A missing or out-of-date snapshot no longer blocks a decision: continuing saves a
  // fresh run first, then opens the decision against that exact run.
  const canRefresh=twin&&(pst||shadow)&&!ctx.busy;
  const [pending,setPending]=useState<{candidateId:string;optionTitle?:string;rationale?:string;details?:EngineDecisionDetails}|null>(null);
  // Once the fresh run is saved, the pending choice opens against it, provided that run
  // still includes the chosen option (a run with no observations has no options at all).
  const pendingInRun=!!pending&&canDecide&&!!latest&&latest.candidates.some(candidate=>candidate.id===pending.candidateId);
  const decision=selected??(pendingInRun?{runId:latest!.id,...pending!}:null);
  const selectedRun=ctx.data.engineRuns?.find(r=>r.id===decision?.runId&&r.patientId===p.id);
  async function decide(candidateId:string,optionTitle?:string,rationale?:string,details?:EngineDecisionDetails){
    if(canDecide){setPending(null);selectCandidate(candidateId,optionTitle,rationale,details);return;}
    if(!canRefresh)return;
    setPending({candidateId,optionTitle,rationale,details});
    if(!await ctx.save({type:'engine.run',patientId:p.id,expectedRevision:engineRecordRevision(p,ctx.data),preferences},'Fresh engine snapshot saved for '+p.name)){setPending(null);return;}
    setPreview(false);
  }
  const blockedReason=!pst&&!shadow?'PST and Shadow AI are both off in Workspace settings.':!latest?'No snapshot saved yet. Run the engines to save one, then record your decision against it.':staleSaved?'The patient record changed after the last snapshot. Re-run the engines so your decision uses current data.':!saved?'You changed the priorities. Re-run the engines to save them before deciding.':decided?'A decision is already recorded for this snapshot. Re-run the engines to record another.':undefined;
  async function run(){setPending(null);if(await ctx.save({type:'engine.run',patientId:p.id,expectedRevision:engineRecordRevision(p,ctx.data),preferences},'Engine run saved for '+p.name))setPreview(false);}
  return <>
    {<div className="engine-run-toolbar redesign-run-toolbar"><div><strong>{tab==='twin'?(saved?'Observation snapshot saved':'Current patient record'):saved?(decided?'Decision recorded · plan updated':'Saved strategy snapshot'):'Live calculation preview'}</strong><small>{saved?formatDate(latest.date,true)+' · '+latest.actor:tab==='twin'?'Check-ins update this view automatically.':'Save a strategy snapshot to link your clinical decision to these inputs.'}</small></div><div><Button variant="outline" onClick={()=>setBasis(true)}><Database size={15}/>Inputs & logic</Button><Button onClick={run} disabled={ctx.busy||!twin||Object.values(preferences).every(x=>!x)}><Play size={15}/>{ctx.busy?'Saving…':tab==='twin'?(saved?'Refresh snapshot':'Save analysis snapshot'):saved?'Re-run engines':'Run engines'}</Button></div></div>}
    <Tabs value={tab} onValueChange={setTab}>{!embedded&&<TabsList variant="line" className="engine-tabs"><TabsTrigger value="twin">Digital Twin</TabsTrigger><TabsTrigger value="treatment">Treatment</TabsTrigger><TabsTrigger value="history">Run history ({runs.length})</TabsTrigger></TabsList>}
      <TabsContent value="twin"><TwinPanel p={p} output={output} enabled={twin} saved={saved}/></TabsContent>
      <TabsContent value="treatment"><TreatmentScreen p={p} ctx={ctx} dataGaps={output.gaps} canDecide={canDecide||(twin&&(pst||shadow))} blockedReason={canDecide||(twin&&(pst||shadow))?undefined:blockedReason} refreshNote={!canDecide&&twin&&(pst||shadow)?'Continuing saves a fresh engine snapshot first, so your decision links to current data.':undefined} onDecide={(id,title,rationale,details)=>void decide(id==='gabapentin'?'review-current':id==='pacing'||id==='sleep'||id==='pt'||id==='psych'?'monitor-plan':'discuss-alternative',title,rationale,details)}/>{!embedded&&<p className="engine-chart-note">{output.agreement===false?'Different first priority between PST utility and Shadow AI. ':'PST and Shadow AI can be inspected together on this screen. '}{canDecide?'Select a strategy to record your own rationale and patient-facing next steps.':'Save a current run to enable a clinician decision. A new run is required after the patient record changes.'}</p>}{!embedded&&<PatientPlan p={p} ctx={ctx}/>}</TabsContent>
      <TabsContent value="history"><Panel title="Saved runs and clinician decisions" subtitle="Each run preserves the displayed results, source excerpts, preferences, and rule version."><div className="engine-panel-body">{!runs.length?<p>No saved runs yet. Use Run engines to create the first snapshot.</p>:runs.map(r=><details className="engine-history" key={r.id}><summary><span><strong>{formatDate(r.date,true)}</strong><small>{r.actor} · {r.revision}</small></span><Badge>{r.revision===engineRecordRevision(p,ctx.data)?'Current inputs':'Historical inputs'}</Badge></summary><p>{r.summary}</p><EngineRecommendation output={r} title="Saved run: reasons and sources"/><p>{r.enabled.pst&&r.enabled.shadow?(r.agreement?'Both rankings shared the first priority.':'The rankings differed on the first priority.'):'Single-engine run; no agreement comparison.'}</p>{r.candidates.map(c=><p key={c.id}>{c.title}: PST {r.enabled.pst?c.pstScore:'off'} / Shadow {r.enabled.shadow?c.shadowScore:'off'}</p>)}{ctx.data.engineDecisions?.filter(d=>d.patientId===p.id&&d.runId===r.id).map(d=><blockquote key={d.id}><strong>{engineDecisionHeading(d)}</strong>{d.action&&<p><small>Clinical approach linked to this run: {d.title}{d.labelStatus?` · Label status: ${unmarkPrototypeLabel(d.labelStatus)} (prototype label status, verify)`:''}</small></p>}<p>{decisionRationaleText(d.rationale)}</p><p>Patient plan: {d.patientPlan}</p><small>{d.actor} · {formatDate(d.date,true)}</small></blockquote>)}<small>{r.version}</small><SignedDecisionTrace workspace={ctx.data} patientId={p.id} runId={r.id}/></details>)}<SignedDecisionTrace workspace={ctx.data} patientId={p.id} unlinkedOnly/></div></Panel></TabsContent>
    </Tabs>
    <Dialog open={basis} onOpenChange={setBasis}><DialogContent className="engine-dialog"><DialogHeader><DialogTitle>Inputs & inspectable logic</DialogTitle><DialogDescription>{p.name} · {output.version} · {output.revision}</DialogDescription></DialogHeader><div className="engine-dialog-scroll"><h3>Source records</h3>{output.sources.map((s,i)=><article key={i}><strong>{s.label}</strong><p>{s.value}</p><small>{formatDate(s.date,true)}</small></article>)}<h3>How outputs are computed</h3>{output.basis.map(b=><p key={b}>{b}</p>)}<h3>Unresolved data gaps</h3><ul>{output.gaps.map(g=><li key={g}>{g}</li>)}</ul></div></DialogContent></Dialog>
    <Dialog open={!!decision} onOpenChange={v=>{if(!v){setSelected(null);setPending(null);}}}><DialogContent className="engine-dialog"><DialogHeader><DialogTitle>Record the clinician’s decision</DialogTitle><DialogDescription>A clinician-authored plan linked to the saved run. This does not prescribe or change medication.</DialogDescription></DialogHeader>{decision&&selectedRun&&<DecisionForm key={decision.runId+decision.candidateId} p={p} ctx={ctx} run={selectedRun} candidateId={decision.candidateId} optionTitle={decision.optionTitle} initialRationale={decision.rationale} details={decision.details} close={()=>{setSelected(null);setPending(null);}}/>}</DialogContent></Dialog>
  </>;
}

function TwinPanel({p,output,enabled,saved}:{p:Patient;output:EngineOutput;enabled:boolean;saved:boolean}){
  const [measure,setMeasure]=useState<'all'|'pain'|'function'|'sleep'>('all');
  const twin=twinOverview(p),observed=output.points.filter(row=>row.pain!==null),lastObserved=observed.at(-1);
  const first=observed[0],change=lastObserved&&first&&observed.length>1?Math.round((lastObserved.pain!-first.pain!)*10)/10:null;
  const gapCount=output.gaps.length,activeMeds=p.medications.filter(m=>m.status==='Active');
  const sourceRows=visitObservations(p),latestReport=sourceRows.at(-1),firstReport=sourceRows[0];
  return <Panel className="feedback-twin-panel" title="Digital Twin" subtitle="Recorded outcomes, treatment history, and the context behind them." action={<Badge tone={enabled?'teal':'neutral'}>{enabled?'Observed record':'Off in settings'}</Badge>}>
    {!enabled?<div className="feedback-twin-empty"><h3>Digital Twin is off</h3><p>Enable Digital Twin and assessments in Workspace settings to review recorded trends.</p></div>:<>
      <div className="feedback-twin-summary"><div><span className="feedback-section-label">Latest recorded measures</span><p>{latestReport?formatDate(latestReport.date):'Waiting for the first check-in'}{saved?' · Inputs match the saved snapshot':''}</p></div><a className="text-link" href={'/patients/'+encodeURIComponent(p.id)+'?tab=outcomes'}>Observation history <ArrowUpRight size={15}/></a><EngineRecommendation output={output} title="Record review: inputs and reasoning" label="Review inputs & reasoning"/></div>
      <div className="feedback-twin-metrics">{([{key:'pain',label:'Pain',direction:'Lower means less pain'},{key:'function',label:'Daily function',direction:'Higher means better function'},{key:'sleep',label:'Sleep quality',direction:'Higher means better sleep'}] as const).map(metric=>{
        const value=latestReport?.[metric.key],prior=firstReport?.[metric.key],delta=value!=null&&prior!=null&&sourceRows.length>1?Math.round((value-prior)*10)/10:null;
        return <article key={metric.key} aria-label={'Latest recorded '+metric.label.toLowerCase()}><span>{metric.label}</span><strong>{value??'Not recorded'}{value!=null&&<small>/10</small>}</strong><p>{delta===null?'No comparison yet':delta===0?'No change from first report':`${Math.abs(delta)} ${Math.abs(delta)===1?'point':'points'} ${delta<0?'lower':'higher'} from first report`}</p><small>{metric.direction}</small></article>;
      })}<article className="feedback-twin-goal"><span>Patient goal</span><p>{p.goal||'No goal recorded'}</p><small>Patient-stated goal</small></article></div>
      <div className="feedback-twin-grid"><div className="feedback-twin-main">
        <section id="twin-trajectory" className="feedback-observed-chart" aria-labelledby="observed-trajectory-heading"><div className="feedback-chart-title"><div><h3 id="observed-trajectory-heading">Observed trajectory</h3><p>{sourceRows.length>1?`${sourceRows.length} dated reports · ${formatDate(firstReport.date)} to ${formatDate(latestReport!.date)}`:sourceRows.length===1?'First recorded report. More reports are needed to show a trend.':'No recorded observations yet.'}</p></div><div className="feedback-measure-switch" role="group" aria-label="Trajectory measure">{(['all','pain','function','sleep'] as const).map(key=><button key={key} type="button" aria-pressed={measure===key} onClick={()=>setMeasure(key)}>{key==='all'?'All':key==='function'?'Function':key==='sleep'?'Sleep':'Pain'}</button>)}</div></div>
          <RecordedTrendChart patient={p} metric={measure}/>
          <p className="feedback-chart-reading">{latestReport?.pain==null?'Pain was not answered in the latest report.':change===null?'A trend will appear after a second recorded report.':`Pain is ${change===0?'unchanged':`${Math.abs(change)} ${Math.abs(change)===1?'point':'points'} ${change<0?'lower':'higher'}`} from the first report.`} These are check-ins, not a count of visits.</p>
          <details className="feedback-twin-detail"><summary>View values and sources <span>{sourceRows.length} records</span></summary><div className="feedback-source-table"><table><caption className="sr-only">Recorded pain, function, and sleep observations</caption><thead><tr><th>Date</th><th>Pain</th><th>Function</th><th>Sleep</th><th>Source</th></tr></thead><tbody>{sourceRows.map((row,index)=><tr key={row.date+index}><td>{formatDate(row.date)}</td><td>{row.pain??'Missing'}</td><td>{row.function??'Missing'}</td><td>{row.sleep??'Missing'}</td><td>{row.source}</td></tr>)}</tbody></table>{!sourceRows.length&&<p>No dated observations have been recorded.</p>}</div></details>
        </section>
        <section className="feedback-twin-context"><h3>Patient context</h3><div>{[{title:'Physical',value:p.clinicalContext?.physicalContext||p.clinicalContext?.medicalHistory||p.condition},{title:'Psychological',value:p.clinicalContext?.psychologicalContext||'Not recorded'},{title:'Social & access',value:p.clinicalContext?.socialContext||'Not recorded'}].map(item=><article key={item.title}><span>{item.title}</span><p>{item.value}</p></article>)}</div></section>
        <details className="feedback-twin-detail feedback-prototype-scenario"><summary><span><strong>Prototype scenario</strong><small>Projected course and model assumptions</small></span><Badge>Separate from observations</Badge></summary><div className="feedback-prototype-content"><p>This rule-based scenario is not a validated patient forecast. Its target and shaded range are program assumptions.</p><TwinScenarioChart output={output}/><div className="feedback-scenario-legend"><span>Observed pain</span><span>Assumed target</span><span>Projected course</span></div><div className="feedback-scenario-metrics"><span>Treatment target <strong>{lastObserved?.target??'Not available'}{lastObserved?'/10':''}</strong><small>Program assumption: a three-point reduction over the observed period</small></span><span>Difference from target <strong>{lastObserved?Math.round((lastObserved.pain!-lastObserved.target)*10)/10:'Not available'}</strong><small>Observed pain minus assumed target</small></span><span>Twin summary (prototype) <strong>{twin.composite!==null?twin.composite+'/100':'Not available'}</strong><small>Higher is better · includes a derived mood estimate · not the visit tab’s pain · function · sleep composite, and not a validated score</small></span></div><details><summary>Calculation logic and source inputs</summary>{output.basis.map(item=><p key={item}>{item}</p>)}<p>Twin summary (prototype) = ((10 − pain) + function + sleep + derived mood) ÷ 40 × 100. Mood is inferred by the prototype, not a recorded questionnaire score.</p><p>The Twin data label changes after {twin.ramp} days of recorded reports ({twin.model}). It describes how long reports span, not a model: no predictive model is connected, and elapsed time does not establish data completeness.</p>{output.sources.map((source,index)=><article key={index}><strong>{source.label}</strong><p>{source.value}</p><small>{source.date?formatDate(source.date,true):'Date not recorded'}</small></article>)}</details></div></details>
      </div><aside className="feedback-twin-rail" aria-label="Digital Twin record context">
        <section><h3>Record coverage</h3><dl>{[['Self-report',sourceRows.length?`${sourceRows.length} dated reports`:'Not recorded'],['Medication reports',activeMeds.length?`${activeMeds.length} active`:p.medicationReconciliation?.none?'None reported':'Not reconciled'],['Clinical context',p.clinicalContext?'Recorded':'Not recorded'],['External records & labs','Not connected'],['Wearables & devices','Not connected']].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
        <section id="twin-missing" className="feedback-twin-missing"><h3><AlertCircle size={16}/>Still needed <span>{gapCount}</span></h3><ul>{output.gaps.map(gap=><li key={gap}>{gap}</li>)}</ul></section>
        <section id="twin-timeline"><h3>Treatment timeline</h3>{twin.events.length?<ol className="feedback-treatment-events">{[...twin.events].sort((a,b)=>b.date.localeCompare(a.date)).map(event=><li key={event.kind+event.date+event.label} data-kind={event.kind}><small>{formatDate(event.date)}</small><strong>{event.label}</strong></li>)}</ol>:<p>No medication start or stop dates recorded.</p>}<a className="text-link" href={'/patients/'+encodeURIComponent(p.id)+'?tab=treatment'}>Review treatments <ArrowUpRight size={14}/></a></section>
        <p className="feedback-twin-source-note">Trend source: saved patient reports. Medication events show recorded timing, not proof of treatment effect.</p>
      </aside></div>
    </>}
  </Panel>;
}

function TwinScenarioChart({output}:{output:EngineOutput}){
  const rows=output.points,W=720,H=240,left=36,right=28,top=20,bottom=32;
  if(!rows.length)return <p>No observations are available to construct a scenario.</p>;
  const x=(i:number)=>left+i*(W-left-right)/Math.max(1,rows.length-1),y=(v:number)=>top+(10-v)*(H-top-bottom)/10;
  const lastObserved=rows.findLastIndex(row=>row.pain!==null);
  const line=(key:'pain'|'scenario'|'target')=>{let previous=false;return rows.map((row,index)=>{if(row[key]===null){previous=false;return '';}const segment=(previous?'L':'M')+[x(index),y(row[key]!)].join(',');previous=true;return segment;}).join(' ');};
  const future=rows.map((row,index)=>({row,index})).filter(({row,index})=>row.low!==null&&index>=Math.max(0,lastObserved));
  const band=future.map(({row,index})=>`${x(index)},${y(row.high!)}`).concat([...future].reverse().map(({row,index})=>`${x(index)},${y(row.low!)}`)).join(' ');
  const ticks=[0,lastObserved,rows.length-1].filter((index,pos,all)=>index>=0&&all.indexOf(index)===pos);
  return <svg className="engine-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Prototype scenario: observed pain and assumed projected course"><title>Prototype scenario, not a validated forecast</title>
    {[0,2,4,6,8,10].map(value=><g key={value}><line x1={left} y1={y(value)} x2={W-right} y2={y(value)} stroke="#e3e9ed"/><text x={left-10} y={y(value)+4} textAnchor="end">{value}</text></g>)}
    {lastObserved>=0&&<rect x={x(lastObserved)} y={top} width={W-right-x(lastObserved)} height={H-top-bottom} fill="#f5f2fb"/>}{band&&<polygon points={band} fill="#e3d8f6"/>}
    <path d={line('pain')} stroke="#087f75" strokeWidth={3} fill="none"/><path d={line('target')} stroke="#517aa7" strokeWidth={2} strokeDasharray="6 5" fill="none"/><path d={line('scenario')} stroke="#8562ab" strokeWidth={2.5} strokeDasharray="5 4" fill="none"/>
    {rows.map((row,index)=>row.pain!==null&&<circle key={index} cx={x(index)} cy={y(row.pain)} r={3.5} fill="white" stroke="#087f75" strokeWidth={2}><title>{`${formatDate(row.date)}: pain ${row.pain}/10`}</title></circle>)}
    {ticks.map(index=><text key={index} x={x(index)} y={H-8} textAnchor={index===0?'start':index===rows.length-1?'end':'middle'}>{formatDate(rows[index].date)}</text>)}
  </svg>;
}

function DecisionForm({p,ctx,run,candidateId,optionTitle,initialRationale,details,close}:{p:Patient;ctx:Context;run:EngineRun;candidateId:string;optionTitle?:string;initialRationale?:string;details?:EngineDecisionDetails;close:()=>void}){
  const candidate=run.candidates.find(c=>c.id===candidateId)!;
  const [rationale,setRationale]=useState(initialRationale??''),[plan,setPlan]=useState(''),[owner,setOwner]=useState(p.clinicalContext?.coordinator||p.clinician),[date,setDate]=useState('');
  const stale=run.revision!==engineRecordRevision(p,ctx.data);
  const [confirmed,setConfirmed]=useState(false),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const submitting=useRef(false),errorRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(error||ctx.saveConflict)errorRef.current?.focus();},[error,ctx.saveConflict]);
  async function submit(e:FormEvent){
    e.preventDefault();
    if(stale||!confirmed||ctx.busy||submitting.current||ctx.saveConflict||!plan.trim())return;
    submitting.current=true;setSaving(true);setError('');
    try{
      if(await ctx.save({type:'engine.decide',patientId:p.id,runId:run.id,candidateId,rationale,patientPlan:plan,owner,followup:date,...details},'Decision, patient plan, and follow-up saved'))close();
      else setError('Your decision was not saved. Your rationale, patient plan, owner, and review date are still here. Try again.');
    }catch{
      setError('Your decision was not saved. Your rationale, patient plan, owner, and review date are still here. Try again.');
    }finally{submitting.current=false;setSaving(false);}
  }
  return <form onSubmit={submit} className="engine-form" aria-busy={ctx.busy||saving}>{(error||ctx.saveConflict)&&<div className="care-form-error" role="alert" tabIndex={-1} ref={errorRef}>{ctx.saveConflict?'A newer workspace was saved. Your decision draft is still here. Copy any changes you want to keep before loading the latest records.':error}{ctx.saveConflict&&ctx.reloadWorkspace&&<Button type="button" variant="outline" disabled={ctx.busy||saving} onClick={ctx.reloadWorkspace}>Load latest saved records</Button>}</div>}<fieldset disabled={ctx.busy||saving}>{optionTitle&&<div className="decision-selected-option"><small>Selected option{details?.action?' · '+engineDecisionVerbs[details.action]:''}</small><strong>{optionTitle}</strong>{details?.labelStatus&&<small>Label status: {details.labelStatus}</small>}</div>}<div className="decision-strategy"><small>Clinical approach linked to this run</small><strong>{candidate.title}</strong><p>{candidate.watch}</p></div>{stale&&<p role="alert">New information arrived. Close this form and re-run the engines before saving.</p>}<label>Reason (optional)<Textarea value={rationale} onChange={e=>setRationale(e.target.value)} maxLength={2000} rows={3}/></label><label>Agreed next steps for the patient<Textarea required value={plan} onChange={e=>setPlan(e.target.value)} maxLength={2000} rows={3} placeholder="Write the plan the patient should see."/></label><div className="engine-form-row"><label>Follow-up owner<Input required value={owner} onChange={e=>setOwner(e.target.value)} maxLength={100}/></label><label>Review date · 9:00 AM<Input required type="date" min={new Date().toISOString().slice(0,10)} value={date} onChange={e=>setDate(e.target.value)}/></label></div><label className="engine-check-label"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed the selected option, rationale, patient plan and follow-up.</label><Button disabled={ctx.busy||saving||stale||ctx.saveConflict||!confirmed||!plan.trim()} type="submit">{saving?'Saving decision…':'Save decision & patient plan'}</Button></fieldset></form>;
}

export function RoboAdvisor({p,ctx,lang='en',audience='patient',variant='panel'}:{p:Patient;ctx:Context;lang?:'en'|'es';audience?:'clinician'|'patient';variant?:'panel'|'widget'}){
  const es=lang==='es',clinician=audience==='clinician';
  const enabled=featureEnabled(ctx.data,'advisor'),assessments=featureEnabled(ctx.data,'assessments');
  const latestReport=visitObservations(p).at(-1);
  const [text,setText]=useState(''),[attach,setAttach]=useState(false),[pain,setPain]=useState(latestReport?.pain??5),[fn,setFn]=useState(latestReport?.function??5),[sleep,setSleep]=useState(latestReport?.sleep??5),[urgency,setUrgency]=useState<'routine'|'urgent'>('routine');
  const turns=(ctx.data.advisorTurns??[]).filter(t=>t.patientId===p.id&&(clinician?t.audience==='clinician':t.audience!=='clinician'));
  const pendingRequest=useRef<{signature:string;id:string}|null>(null);
  const sending=useRef(false);
  const [saveError,setSaveError]=useState('');
  async function send(e:FormEvent){
    e.preventDefault();if(ctx.busy||sending.current)return;
    const guessed=inferAdvisorIntent(text);
    const command={type:'advisor.chat' as const,patientId:p.id,text,intent:guessed.intent,concernUrgency:clinician?'routine':urgency,language:lang,audience,...(!clinician&&attach&&assessments?{checkin:{pain,function:fn,sleep}}:{})};
    const signature=JSON.stringify(command);
    if(pendingRequest.current?.signature!==signature)pendingRequest.current={signature,id:crypto.randomUUID()};
    sending.current=true;setSaveError('');
    try{if(await ctx.save({...command,requestId:pendingRequest.current.id},es?'Conversación guardada':'Conversation saved')){pendingRequest.current=null;setText('');setAttach(false);}else setSaveError(es?'No se ha guardado. Tu mensaje sigue aquí para volver a intentarlo.':'Your message was not saved. It is still here so you can try again.');}
    catch{setSaveError(es?'No se ha guardado. Tu mensaje sigue aquí para volver a intentarlo.':'Your message was not saved. It is still here so you can try again.');}
    finally{sending.current=false;}
  }
  const quickActions:{id:string;label:string;text:string}[]=clinician?[
    {id:'rank',label:'Why do PST and Shadow differ?',text:'Why do PST and Shadow disagree for this patient?'},
    {id:'pain',label:'Pain trajectory',text:'What is the recorded pain, function and sleep trajectory?'},
    {id:'plan',label:'Saved plan',text:'What is the saved care plan and follow-up?'},
    {id:'meds',label:'Recorded medication',text:'What medication is on the record, including benefit and side effects?'}
  ]:es?[
    {id:'plan',label:'Revisar mi plan',text:'¿Cuál es mi plan actual y cuándo debo volver a hablar con mi equipo?'},
    {id:'pain',label:'Ver mi dolor',text:'¿Cuál es mi trayectoria de dolor, función y sueño?'},
    {id:'meds',label:'Mi medicación',text:'¿Qué medicación consta en mi registro, incluyendo beneficio y efectos?'},
    {id:'concern',label:'Compartir una dificultad',text:'Tengo una dificultad con mi tratamiento y quisiera hablar con mi equipo.'}
  ]:[
    {id:'plan',label:'Saved plan',text:'What is my current care plan and next follow-up?'},
    {id:'pain',label:'Pain trajectory',text:'What is the recorded pain, function and sleep trajectory?'},
    {id:'meds',label:'Recorded medication',text:'What medication is on the record, including benefit and side effects?'},
    {id:'concern',label:'Report a difficulty',text:'I am having a difficulty with my treatment and would like to speak with my care team.'}
  ];
  const body=<div className={variant==='widget'?'advisor-widget-body':'engine-panel-body advisor-bot'} lang={lang}>
    {!enabled?<p>{es?'Esta conversación no está disponible. Tu equipo puede ayudarte por otra vía.':'This conversation is unavailable. Your care team can help you use another contact route.'}</p>:<>
      <div className="advisor-conversation" aria-live="polite">{clinician&&<AdvisorRecordLinks p={p} ctx={ctx}/>}<div className="advisor-bubble"><Bot size={19}/><p>{clinician?`Do you have any questions about ${p.name}? I can help you review this record and find the relevant screen.`:(es?`Hola, ${p.name.split(' ')[0]}. Pregúntame por tu plan, tus registros o tu medicación.`:`Hello ${p.name.split(' ')[0]}. Ask about your plan, your check-ins, or your medication.`)}</p></div>
        {turns.slice(-8).map(t=><div key={t.id}><div className="advisor-bubble patient"><small>{clinician?'You':'Patient'}</small><p>{t.patientText}</p><small>{formatDate(t.date,true)}</small></div><div className="advisor-bubble"><Bot size={18}/><div><p>{t.reply}</p>{clinician&&<AdvisorAnswerDetails turn={t} p={p} data={ctx.data}/>} {variant!=='widget'&&<small>{es?'Conversación guardada en su idioma original':'Saved conversation in its original language'}</small>}{t.reviewId&&<a href={'/review-queue?patient='+encodeURIComponent(p.id)} className="text-link">{es?'Solicitud guardada para el equipo':'Care-team review created'} <ArrowUpRight size={14}/></a>}{t.checkinId&&<Badge tone="teal">{es?'Respuestas confirmadas guardadas':'Confirmed check-in saved'}</Badge>}</div></div></div>)}
        {!clinician&&ctx.data.messages.filter(m=>m.patientId===p.id&&m.direction==='out'&&m.sender!==ADVISOR_SENDER).slice(-2).map(m=><div className="advisor-bubble" key={m.id}><div><strong>{m.sender}</strong><p>{m.text}</p><small>{formatDate(m.date,true)} · {es?'Mensaje del equipo en su idioma original':'Care-team message in its original language'}</small></div></div>)}
      </div>
      {saveError&&<p role="alert">{saveError}</p>}
      <form onSubmit={send} className="engine-form"><fieldset disabled={ctx.busy}><legend className="sr-only">{clinician?'Question about this patient':es?'Tu mensaje':'Patient update'}</legend>
        <div className="advisor-quick-actions">{quickActions.map(item=><Button key={item.id} size="sm" variant="outline" type="button" onClick={()=>setText(item.text)}>{item.label}</Button>)}</div>
        <div className="advisor-composer"><Textarea required aria-label={clinician?'Question about this patient':es?'Tu mensaje':'Your message'} value={text} onChange={e=>setText(e.target.value)} maxLength={2000} rows={variant==='widget'?2:3} placeholder={clinician?`Ask about ${p.name.split(' ')[0]}…`:es?'Escribe una pregunta…':'Ask a question…'}/><Button type="submit" disabled={!text.trim()||ctx.busy}><Send size={15}/>{ctx.busy?(es?'Guardando…':'Saving…'):(es?'Guardar mensaje':'Send')}</Button></div>
        {!clinician&&<label>{es?'¿Es urgente tu preocupación?':'Is your concern urgent?'}<select value={urgency} onChange={event=>setUrgency(event.target.value as 'routine'|'urgent')}><option value="routine">{es?'Solicitud habitual':'Standard request'}</option><option value="urgent">{es?'Tengo una preocupación urgente':'I have an urgent concern'}</option></select></label>}
        {!clinician&&assessments&&<label className="engine-check-label"><Checkbox checked={attach} onCheckedChange={v=>setAttach(!!v)}/>{es?'Adjuntar valores de dolor, función y sueño que he confirmado':'Attach confirmed pain, function and sleep scores'}</label>}
        {!clinician&&attach&&assessments&&<div className="engine-checkin">{[{label:es?'Dolor':'Pain',value:pain,set:setPain},{label:es?'Función':'Function',value:fn,set:setFn},{label:es?'Sueño':'Sleep',value:sleep,set:setSleep}].map(m=><label key={m.label}>{m.label} /10<Input aria-label={(es?'Valor confirmado: ':'Confirmed ')+m.label} type="number" min={0} max={10} step={1} required value={m.value} onChange={e=>m.set(Number(e.target.value))}/></label>)}</div>}
      </fieldset></form>{variant!=='widget'&&<p className="engine-chart-note">{clinician?'Answers from the saved record. It does not change the care plan.':es?'El asistente conserva tus palabras y no cambia la medicación.':'The advisor keeps your original words and does not change medication.'}</p>}
    </>}
  </div>;
  return variant==='widget'?body:<Panel title={ADVISOR_NAME} subtitle={clinician?`Ask about ${p.name}. Answers come from this record.`:(es?'Pregunta en texto libre. Las respuestas salen del registro guardado.':'Ask a question. Answers come from this saved record.')} action={<Badge tone="amber">{enabled?(es?'Disponible':'Available'):(es?'Desactivado':'Off')}</Badge>}>{body}</Panel>;
}

function AdvisorRecordLinks({p,ctx}:{p:Patient;ctx:Context}){
  const note=[...p.notes].sort((a,b)=>b.date.localeCompare(a.date))[0],cutoff=note?.date;
  const newer=(date:string)=>!!date&&Number.isFinite(Date.parse(date))&&(!cutoff||date.slice(0,10)>=cutoff.slice(0,10));
  const observations=visitObservations(p),reports=observations.filter(row=>newer(row.date)).length;
  const medications=p.medications.filter(m=>newer(m.reportedAt)||newer(m.started)||!!m.stopped&&newer(m.stopped));
  const plans=p.carePlans.filter(plan=>newer(plan.date));
  const messages=ctx.data.messages.filter(message=>message.patientId===p.id&&newer(message.date));
  const base='/patients/'+encodeURIComponent(p.id),currentPlan=p.carePlans[0];
  const links=[
    {label:'Goal',value:p.goal||'No goal recorded',note:'Current goal; change history unavailable',href:base+'?tab=visit#patient-goal',on:true},
    {label:'Medications',value:medications.length?`${medications.length} ${cutoff?'new or updated':'recorded'} medication report${medications.length===1?'':'s'}`:cutoff?'No medication updates since this note':p.medicationReconciliation?.none?'None reported':'No medication report recorded',note:medications.map(m=>m.name).join(', '),href:base+'?tab=visit#patient-medications',on:true},
    {label:'Treatment',value:plans.length?`${plans.length} ${cutoff?'new':'saved'} plan${plans.length===1?'':'s'}`:currentPlan?'Existing plan on file':'No saved plan',note:currentPlan?.followup?'Follow-up '+formatDate(currentPlan.followup):'',href:base+'?tab=treatment',on:featureEnabled(ctx.data,'pst')||featureEnabled(ctx.data,'shadow')},
    {label:'Messages',value:messages.length?`${messages.length} ${cutoff?'new':'recorded'} message${messages.length===1?'':'s'}`:cutoff?'No messages since this note':'No messages recorded',note:'Open conversation',href:base+'?tab=messages',on:featureEnabled(ctx.data,'messages')},
    {label:'Trends',value:reports?`${reports} ${cutoff?'new':'dated'} check-in${reports===1?'':'s'}`:cutoff?'No check-ins since this note':'No dated check-ins',note:observations.length?'Latest '+formatDate(observations.at(-1)!.date):'',href:base+'?tab=twin',on:featureEnabled(ctx.data,'digitalTwin')},
  ];
  return <details className="advisor-record-review"><summary><span>{cutoff?'Since the latest saved note':'Available patient record'}<small>{cutoff?formatDate(cutoff,true):'No earlier note to compare'}</small></span><ChevronRight size={15}/></summary><div><p className="advisor-review-basis">{cutoff?`Records dated on or after the note saved by ${note.author}. This is a record update, not a confirmed visit comparison.`:'Open the source records below. A previous visit has not been established.'}</p>{links.filter(item=>item.on).map(item=><a key={item.label} href={item.href}><span><strong>{item.label}</strong><span>{item.value}</span>{item.note&&<small>{item.note}</small>}</span><ArrowUpRight size={15}/></a>)}</div></details>;
}

export function PatientPlan({p,ctx,lang='en',patientMode=false}:{p:Patient;ctx:Context;lang?:'en'|'es';patientMode?:boolean}){
  const es=lang==='es',plan=p.carePlans[0],decision=ctx.data.engineDecisions?.find(d=>d.patientId===p.id&&d.planId===plan?.id);
  const translation=plan?reviewedPlanTranslation(ctx.data.clinicalWorkflows?.slices['patient-coordination'].state,p.id,plan.id,plan.workflowVersion??1,lang):undefined;
  return <Panel title={es?'Tu plan de atención':'Your care plan'} subtitle={es?'Las instrucciones guardadas con tu equipo.':'The instructions saved with your care team.'}><div className="engine-panel-body" lang={lang}>
    {plan?<><Badge tone="teal">{es?'Plan guardado por el equipo':'Clinician-authored plan'}</Badge>
      {es&&!translation&&<p role="status">No hay una traducción revisada al español de este plan. Se muestran las instrucciones originales; pide ayuda a tu equipo o a un intérprete.</p>}
      <p className="engine-plan-text">{translation?.translatedText??plan.text}</p>
      <RecommendationDetails title={patientMode?(es?'Sobre tu plan guardado':'About your saved plan'):'Why this care plan was selected'} label={patientMode?(es?'¿Por qué está esto en mi plan?':'Why this is in my plan'):'Why this plan'} summary={translation?.translatedText??plan.text} rationale={patientMode?[(es?'Estas son las instrucciones que tu equipo guardó para ti. Pídele que explique el motivo de cada paso.':'These are the instructions your care team saved for you. Ask your team to explain the reason for each step.')]:[decision?decisionRationaleText(decision.rationale):'A separate clinician rationale was not recorded with this plan.']} sources={[{label:es?'Plan guardado':'Saved care plan',value:plan.author,date:plan.date}]} considerations={[`${es?'Responsable del seguimiento':'Follow-up owner'}: ${plan.owner}`,`${es?'Seguimiento':'Follow-up'}: ${formatDate(plan.followup)}`]} limitations={patientMode?[es?'Solo se muestran las instrucciones aprobadas para el paciente.':'This view shows the approved patient instructions.']:['This is a saved clinician plan, not a new engine recommendation.']}/>

      {translation&&<small>{es?'Traducción revisada por':'Translation reviewed by'} {translation.translationReviewer} · {es?'versión del plan':'plan version'} {translation.planRef!.planVersion} · {formatDate(translation.updatedAt,true)}</small>}
      <div className="engine-plan-followup"><Clock size={18}/><div><strong>{plan.appointmentBooked===false?(es?'Seguimiento previsto: ':'Follow-up due: '):''}{formatDate(plan.followup)}{plan.time?' · '+plan.time:''}{plan.timezone?' · '+plan.timezone:''}</strong><span>{plan.owner}</span>{plan.appointmentBooked===false&&<small>{es?'Cita aún no reservada':'Appointment not booked'}</small>}</div></div>
      {patientMode&&<div className="companion-when-call"><strong>{es?'Cuándo llamar':'When to call'}</strong><ul><li>{es?'Si el dolor se mueve de sitio':'If the pain moves to a new place'}</li><li>{es?'Si no puedes hacer lo que te importa':'If you cannot do the activities that matter'}</li><li>{es?'Si el medicamento te deja grogui o te sienta mal':'If the medicine leaves you groggy or unwell'}</li><li>{es?'Emergencia: 911. Crisis de salud mental: 988':'Emergency: 911. Mental health crisis: 988'}</li></ul></div>}
      {!patientMode&&decision&&<p><strong>{es?'Razonamiento clínico':'Clinician rationale'}</strong><br/>{decisionRationaleText(decision.rationale)}</p>}
      <small>{es?'Guardado':'Saved'} {formatDate(plan.date,true)} {es?'por':'by'} {plan.author}</small>
      {!patientMode&&<p><a className="text-link" href={'/patient-companion?patient='+encodeURIComponent(p.id)}>{es?'Abrir la vista del paciente':'Open patient companion'} <ArrowUpRight size={15}/></a></p>}
    </>:<p>{es?'Todavía no hay un plan acordado.':'No agreed plan recorded yet.'}</p>}
  </div></Panel>;
}

export {EngineEncounterSummary} from './live-engine-summary';
