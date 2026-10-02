'use client';
import {RecommendationDetails} from './recommendation-details';
import {useState} from 'react';
import Link from 'next/link';
import {Activity,Layers,Brain,Database,ClipboardList,Route,Smartphone,Receipt,ShieldCheck,TriangleAlert,ArrowUpRight} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {Table,TableHeader,TableHead,TableRow,TableBody,TableCell} from '@/components/ui/table';
import {capabilities,previewNotice,twinFutureDates,twinObserved,twinModelCard,twinScenarios,candidateDetail,stepDetail,connectionDetail,pstCandidates,pstSearchSummary,
  shadowComparison,shadowCitations,citationsNotice,connections,inboundFeed,fieldMapping,writeBackQueue,instruments,instrumentShell,
  pathwayPhases,pathwayBranches,deviceStreams,notificationPlan,billingCodes,billingGuards,roleMatrix,consentRecords,
  disclosureLog,type Capability} from '@/lib/future-preview';
import {Badge,Panel,PageTitle} from './ui';

const icons={twin:Activity,pst:Layers,shadow:Brain,integration:Database,instruments:ClipboardList,pathway:Route,mobile:Smartphone,billing:Receipt,governance:ShieldCheck} as const;

// Every preview carries the same header, so a viewer can never reach preview
// content without reading what it is and what it would take to build.
function CapabilityIntro({c}:{c:Capability}){
  const Icon=icons[c.id as keyof typeof icons]??Activity;
  return <>
    <div className="future-intro">
      <span className="future-intro-icon"><Icon size={26}/></span>
      <div>
        <span className="eyebrow">{c.eyebrow}</span>
        <h2>{c.headline}</h2>
        <p>{c.summary}</p><RecommendationDetails title={c.headline} label="Preview scope and requirements" rationale={[c.standsInFor]} considerations={c.requires} limitations={['This screen illustrates a future capability. Example outputs are not patient-specific clinical recommendations.']}/>
      </div>
    </div>
  </>;
}
function BuildNotes({c}:{c:Capability}){
  return <details className="future-buildnotes">
    <summary>Build notes / what it takes to make this real</summary>
    <div className="future-buildnotes-body">
      <div className="future-standsin"><TriangleAlert size={17}/><div><strong>What ships today instead</strong><p>{c.standsInFor}</p></div></div>
      <div className="future-requirements">{c.requires.map((r,i)=><div key={r}><span>{i+1}</span><p>{r}</p></div>)}</div>
    </div>
  </details>;
}

// 1. Predictive Digital Twin
function ForecastChart({scenario}:{scenario:typeof twinScenarios[number]}){
  const rows=[
    ...twinObserved.map(([date,observed])=>({date,observed,predicted:null as number|null,low:null as number|null,high:null as number|null})),
    ...twinFutureDates.map((date,i)=>({date,observed:null as number|null,predicted:scenario.forecast[i][0],low:scenario.forecast[i][1],high:scenario.forecast[i][2]})),
  ];
  const last=twinObserved[twinObserved.length-1][1];
  const W=680,H=250,left=34,right=18,top=16,bottom=38;
  const x=(i:number)=>left+i*(W-left-right)/Math.max(1,rows.length-1),y=(v:number)=>top+(10-v)*(H-top-bottom)/10;
  const split=twinObserved.length-1;
  const observedPath=rows.slice(0,twinObserved.length).map((r,i)=>(i?'L':'M')+x(i)+','+y(r.observed!)).join(' ');
  // The projection starts at the last observed point so the two lines connect.
  const predictedPath=['M'+x(split)+','+y(last),...rows.slice(twinObserved.length).map((r,i)=>'L'+x(twinObserved.length+i)+','+y(r.predicted!))].join(' ');
  const band=rows.map((r,i)=>({r,i})).filter(({r})=>r.low!==null);
  const area=[`${x(split)},${y(last)}`,...band.map(({r,i})=>`${x(i)},${y(r.high!)}`),...[...band].reverse().map(({r,i})=>`${x(i)},${y(r.low!)}`)].join(' ');
  return <svg className="engine-chart future-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={'Projected pain under: '+scenario.name}>
    <title>{scenario.name}: projected pain to {rows[rows.length-1].date}</title>
    {[0,2,4,6,8,10].map(v=><g key={v}><line x1={left} y1={y(v)} x2={W-right} y2={y(v)} stroke="#e5eaf1"/><text x={left-12} y={y(v)+4} textAnchor="end">{v}</text></g>)}
    <polygon points={area} fill="#e4ecfb"/>
    <line x1={x(split)} y1={top} x2={x(split)} y2={H-bottom} stroke="#adb6c6" strokeDasharray="3 4"/>
    <path d={predictedPath} stroke="#5485d2" strokeWidth={3} strokeDasharray="6 4" fill="none"/>
    <path d={observedPath} stroke="#158b83" strokeWidth={3.5} fill="none"/>
    {rows.map((r,i)=>r.observed!==null?<circle key={i} cx={x(i)} cy={y(r.observed)} r={4} fill="white" stroke="#158b83" strokeWidth={2}/>:null)}
    {rows.map((r,i)=>r.predicted!==null?<circle key={'p'+i} cx={x(i)} cy={y(r.predicted)} r={3.5} fill="white" stroke="#5485d2" strokeWidth={2}/>:null)}
    {rows.map((r,i)=>(i===0||i===split||i===rows.length-1)?<text key={'l'+i} x={x(i)} y={H-10} textAnchor={i===0?'start':i===rows.length-1?'end':'middle'}>{r.date.slice(5)}{i===split?' · today':''}</text>:null)}
  </svg>;
}
function TwinPreview({c}:{c:Capability}){
  const [selected,setSelected]=useState(twinScenarios[0].id);
  const scenario=twinScenarios.find(s=>s.id===selected)??twinScenarios[0];
  const headline=[
    {label:'Projected pain at 12 weeks',value:scenario.projected,unit:'/10'},
    {label:'90% interval',value:scenario.interval,unit:''},
    {label:'Change from today',value:scenario.change,unit:'points'},
    {label:'Morning grogginess',value:scenario.grogginess,unit:''},
  ];
  return <><CapabilityIntro c={c}/>
    <Panel title="Expected trajectory" subtitle="Pick a scenario to project it against the recorded check-ins." action={<Badge tone="teal">twin-pain-trajectory v2.4</Badge>}>
      <div className="engine-panel-body">
        <div className="future-scenario-tabs" role="group" aria-label="Treatment scenario">
          {twinScenarios.map(sc=><button key={sc.id} type="button" className={sc.id===selected?'selected':''} aria-pressed={sc.id===selected} onClick={()=>setSelected(sc.id)}>
            <strong>{sc.name}</strong><small>{sc.projected}/10 at 12 weeks</small>
          </button>)}
        </div>
        <div className="engine-twin-metrics">{headline.map(h=><div key={h.label}><span>{h.label}</span><strong>{h.value}<small>{h.unit}</small></strong></div>)}</div>
        <ForecastChart scenario={scenario}/>
        <div className="engine-chart-legend"><span><i/>Observed</span><span><i/>{scenario.name}</span><span><i/>90% interval</span></div>
        <p className="engine-chart-note">{scenario.note}</p>
      </div>
    </Panel>
    <div className="engine-main-grid">
      <Panel title="Model card" subtitle="Provenance a clinician can inspect before acting on a projection.">
        <div className="future-modelcard">{twinModelCard.map(r=><div key={r.label}><strong>{r.label}</strong><p>{r.value}</p></div>)}</div>
      </Panel>
      <Panel title="Scenario detail" subtitle="The option currently projected on the chart.">
        <div className="future-scenarios">{twinScenarios.map(sc=><article key={sc.id} className={sc.id===selected?'selected':''}>
          <div><strong>{sc.name}</strong><span className="future-figure">{sc.projected}<small>/10</small></span></div>
          <small>{sc.detail} · interval {sc.interval}</small><p>{sc.note}</p>
          {sc.id!==selected&&<button type="button" className="text-link" onClick={()=>setSelected(sc.id)}>Project this scenario</button>}
        </article>)}</div>
      </Panel>
    </div>
    <BuildNotes c={c}/></>;
}

// 2. PST candidates
function PstPreview({c}:{c:Capability}){
  const [open,setOpen]=useState<string|null>(pstCandidates[0].regimen);
  return <><CapabilityIntro c={c}/>
    <Panel title="Generated candidates, ranked" subtitle="1,284 regimens enumerated and screened against this patient's constraints." action={<Badge tone="teal">Ranked by clinical utility</Badge>}>
      <Table><TableHeader><TableRow><TableHead>#</TableHead><TableHead>Candidate</TableHead><TableHead>Type</TableHead><TableHead>Mechanism</TableHead><TableHead>Benefit</TableHead><TableHead>Burden</TableHead><TableHead>Utility</TableHead><TableHead>Evidence basis</TableHead><TableHead>Safety screens</TableHead></TableRow></TableHeader>
        <TableBody>{pstCandidates.flatMap(r=>{
          const expanded=open===r.regimen,detail=candidateDetail[r.regimen];
          return [<TableRow key={r.rank} className={expanded?'future-row-open':''}>
            <TableCell>{r.rank}</TableCell>
            <TableCell><button type="button" className="future-row-toggle" aria-expanded={expanded} onClick={()=>setOpen(expanded?null:r.regimen)}>{expanded?'\u25be':'\u25b8'} {r.regimen}</button></TableCell>
            <TableCell><Badge>{r.kind}</Badge></TableCell>
            <TableCell>{r.mechanism}</TableCell><TableCell><span className="future-figure">{r.benefit}</span></TableCell><TableCell><span className="future-figure">{r.burden}</span></TableCell>
            <TableCell><strong>{r.cui}</strong></TableCell><TableCell><Badge tone="blue">{r.evidence}</Badge></TableCell>
            <TableCell>{r.flags.length?r.flags.map(f=><Badge key={f} tone="rose">{f}</Badge>):<small>—</small>}</TableCell>
          </TableRow>,
          ...(expanded&&detail?[<TableRow key={r.rank+'-d'} className="future-row-detail"><TableCell colSpan={9}>
            <div className="future-candidate-detail">
              <div><strong>Why it ranks here</strong><p>{detail.why}</p></div>
              <div><strong>What argues against it</strong><p>{detail.against}</p></div>
              <div><strong>What to monitor</strong><p>{detail.monitor}</p></div>
              <div><strong>Against the alternatives</strong><p>{detail.alternativesConsidered}</p></div>
            </div>
          </TableCell></TableRow>]:[])];
        })}</TableBody></Table>
      <div className="panel-bottom config-core"><strong>The clinician still decides</strong><span>A ranking orders options for discussion. It does not select a treatment, clear a contraindication, or issue a prescription, and the recorded decision stays the clinician&rsquo;s with their own rationale.</span></div>
    </Panel>
    <Panel title="Search space and exclusions" subtitle="What was ruled out, and why, so it can be challenged.">
      <div className="future-modelcard">{pstSearchSummary.map(r=><div key={r.label}><strong>{r.label}</strong><p>{r.value}</p></div>)}</div>
    </Panel>
    <BuildNotes c={c}/></>;
}

// 3. Shadow model
function ShadowPreview({c}:{c:Capability}){
  return <><CapabilityIntro c={c}/>
    <Panel title="PST options and the Shadow check, side by side" subtitle="Where the Shadow check matches the PST ranking, and where it differs. Both feed one review and one clinician decision." action={<Badge tone="amber">Different first-ranked option</Badge>}>
      <Table><TableHeader><TableRow><TableHead>Compared on</TableHead><TableHead>PST</TableHead><TableHead>Shadow</TableHead></TableRow></TableHeader>
        <TableBody>{shadowComparison.map(r=><TableRow key={r.row}><TableCell><strong>{r.row}</strong></TableCell><TableCell>{r.pst}</TableCell><TableCell>{r.shadow}</TableCell></TableRow>)}</TableBody></Table>
      <div className="panel-bottom config-core"><strong>Agreement is not confidence</strong><span>The Shadow check reads a different feature set from PST, so a difference is informative rather than a fault. Agreement between the two is still not a measure of how likely either is to be right, and the clinician records one decision with their own rationale.</span></div>
    </Panel>
    <Panel title="Retrieved evidence, for and against" subtitle="Where each retrieved source would be described by its design, population, indication match, endpoint and limitations." action={<Badge tone="amber">{citationsNotice}</Badge>}>
      <div className="future-citations">{shadowCitations.map((s,i)=><article key={i}><div className="future-citation-head"><strong>{s.option}</strong><small>{citationsNotice}</small><Badge tone={s.stance==='Supporting'?'teal':'amber'}>{s.stance}</Badge></div><dl className="future-modelcard">{s.fields.map(f=><div key={f.label}><dt><strong>{f.label}</strong></dt><dd><p>{f.value}</p></dd></div>)}</dl></article>)}</div>
      <div className="panel-bottom config-core"><strong>No single evidence score</strong><span>A study count alone is not evidence quality. Each source would be shown with its design, population and limitations so the clinician can judge it.</span></div>
    </Panel>
    <BuildNotes c={c}/></>;
}

// 4. Data integration
function IntegrationPreview({c}:{c:Capability}){
  const [picked,setPicked]=useState(connections[0].name);
  const detail=connectionDetail[picked];
  return <><CapabilityIntro c={c}/>
    <Panel title="Connections" subtitle="Partner connections and their last successful sync in this design preview. Epic and CDS Hooks are illustrative rows: no EHR is connected." action={<Badge tone="teal">{connections.filter(r=>r.status==='Connected').length} of {connections.length} connected</Badge>}>
      <Table><TableHeader><TableRow><TableHead>Partner</TableHead><TableHead>Protocol</TableHead><TableHead>Scope</TableHead><TableHead>Records</TableHead><TableHead>Last sync</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
        <TableBody>{connections.map(r=><TableRow key={r.name} className={picked===r.name?'future-row-open':''}>
          <TableCell><button type="button" className="future-row-toggle" aria-pressed={picked===r.name} onClick={()=>setPicked(r.name)}>{r.name}</button></TableCell>
          <TableCell>{r.protocol}</TableCell><TableCell>{r.scope}</TableCell><TableCell>{r.records}</TableCell><TableCell>{r.sync}</TableCell>
          <TableCell><Badge tone={r.status==='Connected'?'teal':'amber'}>{r.status}</Badge></TableCell></TableRow>)}</TableBody></Table>
      {detail&&<div className="future-connection-detail"><h3>{picked}</h3>
        <div className="future-modelcard">
          <div><strong>Endpoint</strong><p>{detail.endpoint}</p></div>
          <div><strong>Authentication</strong><p>{detail.auth}</p></div>
          <div><strong>Volume</strong><p>{detail.volume}</p></div>
          <div><strong>Health</strong><p>{detail.health}</p></div>
        </div></div>}
    </Panel>
    <div className="engine-main-grid">
      <Panel title="Inbound record feed" subtitle="Records arriving and reconciling against the workspace.">
        <div className="future-feed">{inboundFeed.map((r,i)=><article key={i}><div><Badge>{r.kind}</Badge><small>{r.source} · {r.time}</small></div><p>{r.detail}</p></article>)}</div>
      </Panel>
      <div className="engine-stack">
        <Panel title="Write-back queue" subtitle="Clinician-authored decisions and plans returning to the EHR, which remains the record of truth.">
          <div className="future-queue">{writeBackQueue.map(r=><div key={r.item}><div><strong>{r.item}</strong><small>{r.target}</small></div><Badge tone={r.status.startsWith('Sent')?'teal':'amber'}>{r.status}</Badge></div>)}</div>
        </Panel>
        <Panel title="Field mapping" subtitle="Inspectable, versioned normalisation.">
          <div className="future-modelcard">{fieldMapping.map(r=><div key={r.source}><strong>{r.source} → {r.target}</strong><p>{r.rule}</p></div>)}</div>
        </Panel>
      </div>
    </div>
    <BuildNotes c={c}/></>;
}

// 5. Instruments
function InstrumentsPreview({c}:{c:Capability}){
  const [picked,setPicked]=useState(instruments[0].code);
  return <><CapabilityIntro c={c}/>
    <div className="future-instrument-grid">{instruments.map(inst=><Panel key={inst.code} className={'future-instrument'+(picked===inst.code?' selected':'')}>
      <div className="future-instrument-head"><div><h3>{inst.code}</h3><small>{inst.name}</small></div><Badge tone={inst.licence==='Licensed'?'teal':'blue'}>{inst.licence}</Badge></div>
      <div className="future-subscales">{inst.subscales.map(row=><div key={row.name}><span>{row.name}</span><div className="future-subscale-value"><strong>{row.score}</strong><small>{row.band}</small></div></div>)}</div>
      <small className="future-cadence">Administered {inst.administered} · {inst.cadence}</small>
      <button type="button" className="text-link" aria-pressed={picked===inst.code} onClick={()=>setPicked(inst.code)}>{picked===inst.code?'Selected':'Open '+inst.code}</button>
    </Panel>)}</div>
    {(()=>{const inst=instruments.find(i=>i.code===picked)!;return <Panel title={inst.code+' · '+inst.name} subtitle={'Administered '+inst.administered+' · '+inst.cadence} action={<Badge tone={inst.licence==='Licensed'?'teal':'blue'}>{inst.licence}</Badge>}>
      <Table><TableHeader><TableRow><TableHead>Subscale</TableHead><TableHead>Score</TableHead><TableHead>Interpretation</TableHead></TableRow></TableHeader>
        <TableBody>{inst.subscales.map(row=><TableRow key={row.name}><TableCell><strong>{row.name}</strong></TableCell><TableCell><span className="future-figure">{row.score}</span></TableCell><TableCell>{row.band}</TableCell></TableRow>)}</TableBody></Table>
    </Panel>;})()}
    <Panel title="How these scores are produced" subtitle="Scoring, interpretation and change detection per instrument.">
      <div className="future-modelcard">{instrumentShell.map(r=><div key={r.label}><strong>{r.label}</strong><p>{r.value}</p></div>)}</div>
      <div className="panel-bottom config-core"><strong>Item wording stays with the rights-holder</strong><span>The questionnaire text for each licensed instrument is served from the rights-holder&rsquo;s item bank rather than copied into this product, so a licence lapse removes the instrument instead of leaving unlicensed content in the app.</span></div>
    </Panel>
    <BuildNotes c={c}/></>;
}

// 6. Care pathway X-1
function PathwayPreview({c}:{c:Capability}){
  const [step,setStep]=useState<{n:number;title:string;phase:string}|null>(null);
  // Step numbers run continuously across phases, computed rather than accumulated
  // during render.
  const numbered=pathwayPhases.map((phase,i)=>({...phase,offset:pathwayPhases.slice(0,i).reduce((total,p)=>total+p.steps.length,0)}));
  const total=pathwayPhases.reduce((sum,p)=>sum+p.steps.length,0);
  return <><CapabilityIntro c={c}/>
    <div className="future-standsin"><TriangleAlert size={17}/><div><strong>Step content is a placeholder</strong><p>The approved X-1 protocol was never supplied to this project, so these steps are of the right shape and length for reviewing the interface. Each is replaced by the approved content before clinical use.</p></div></div>
    <Panel title="Protocol structure" subtitle="Staged steps across the full protocol." action={<Badge tone="teal">29 steps · 5 phases</Badge>}>
      <div className="future-pathway">{numbered.map(phase=><section key={phase.phase}><h3>{phase.phase}</h3><ol>{phase.steps.map((title,i)=>{const n=phase.offset+i+1,active=step?.n===n;
          return <li key={title} className={active?'selected':''}>
            <button type="button" aria-expanded={active} onClick={()=>setStep(active?null:{n,title,phase:phase.phase})}>
              <span>{n}</span><div><strong>{title}</strong><small>{active?'Selected':'View step detail'}</small></div>
            </button>
          </li>;})}</ol></section>)}</div>
      <div className="panel-bottom config-core"><strong>{total} steps across 5 phases</strong><span>The app today runs five operational activities, kept deliberately separate from the clinical protocol until the approved content is in place.</span></div>
    </Panel>
    {step&&<Panel title={'Step '+step.n+' · '+step.title} subtitle={step.phase} action={<Badge tone="blue">Step detail</Badge>}>
      <div className="future-modelcard">
        <div><strong>Owner</strong><p>{stepDetail.owner}</p></div>
        <div><strong>Entry criteria</strong><p>{stepDetail.entry}</p></div>
        <div><strong>Exit criteria</strong><p>{stepDetail.exit}</p></div>
        <div><strong>Escalation</strong><p>{stepDetail.escalation}</p></div>
        <div><strong>Automation</strong><p>{stepDetail.automation}</p></div>
      </div>
    </Panel>}
    <Panel title="Clinical branching" subtitle="Where the protocol stops being a checklist.">
      <div className="future-branches">{pathwayBranches.map(b=><article key={b.at}><div><Badge tone="blue">{b.at}</Badge><strong>{b.condition}</strong></div><p>{b.action}</p></article>)}</div>
    </Panel>
    <BuildNotes c={c}/></>;
}

// 7. MobileNetrix and devices
function MobilePreview({c}:{c:Capability}){
  return <><CapabilityIntro c={c}/>
    <Panel title="Connected device streams" subtitle="Latest readings from the patient's paired devices." action={<Badge tone="teal">4 devices paired</Badge>}>
      <Table><TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Metric</TableHead><TableHead>Latest</TableHead><TableHead>Data quality</TableHead></TableRow></TableHeader>
        <TableBody>{deviceStreams.map(r=><TableRow key={r.device}><TableCell><strong>{r.device}</strong></TableCell><TableCell>{r.metric}</TableCell><TableCell><span className="future-figure">{r.value}</span></TableCell><TableCell>{r.note}</TableCell></TableRow>)}</TableBody></Table>
    </Panel>
    <div className="engine-main-grid">
      <Panel title="Notification schedule" subtitle="The reminder ladder that drives adherence.">
        <div className="future-queue">{notificationPlan.map(r=><div key={r.trigger}><div><strong>{r.trigger}</strong><small>{r.policy}</small></div><Badge>{r.channel}</Badge></div>)}</div>
      </Panel>
      <Panel title="Patient authentication" subtitle="The gap that matters most here.">
        <div className="engine-panel-body">
          <p>The patient app carries its own identity, scoped to a single patient, with its own session lifetime and account-recovery path.</p>
          <p>This is the gap that matters most here. The companion shipping today runs inside the clinician&rsquo;s session, so anyone holding the workspace access code can open any patient&rsquo;s view. Separating that is authentication work, not a UI change.</p>
          <Link className="text-link" href="/patient-companion">See the evaluation companion that ships today <ArrowUpRight size={15}/></Link>
        </div>
      </Panel>
    </div>
    <BuildNotes c={c}/></>;
}

// 8. Reimbursement
function BillingPreview({c}:{c:Capability}){
  return <><CapabilityIntro c={c}/>
    <Panel title="Eligibility against payer requirements" subtitle="Accrued time and transmitting days for this patient, this period." action={<Badge tone="teal">3 of 4 eligible</Badge>}>
      <Table><TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Requirement</TableHead><TableHead>Accrued</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
        <TableBody>{billingCodes.map(r=><TableRow key={r.code}><TableCell><strong>{r.code}</strong></TableCell><TableCell>{r.requirement}</TableCell><TableCell><span className="future-figure">{r.accrued}</span></TableCell><TableCell><Badge tone={r.status==='Eligible'?'teal':'amber'}>{r.status}</Badge></TableCell></TableRow>)}</TableBody></Table>
    </Panel>
    <Panel title="Guardrails on this surface" subtitle="Billing is where a confident wrong number costs real money.">
      <div className="future-requirements">{billingGuards.map((g,i)=><div key={g}><span>{i+1}</span><p>{g}</p></div>)}</div>
    </Panel>
    <BuildNotes c={c}/></>;
}

// 9. Governance
function GovernancePreview({c}:{c:Capability}){
  const [role,setRole]=useState(roleMatrix.roles[0].role);
  const active=roleMatrix.roles.find(r=>r.role===role)!;
  return <><CapabilityIntro c={c}/>
    <Panel title="Role permission matrix" subtitle="What each clinical role can do, enforced on every read and write." action={<Badge tone="teal">5 roles</Badge>}>
      <div className="future-matrix-scroll">
        <Table><TableHeader><TableRow><TableHead>Role</TableHead>{roleMatrix.permissions.map(p=><TableHead key={p}>{p}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{roleMatrix.roles.map(r=><TableRow key={r.role} className={role===r.role?'future-row-open':''}>
            <TableCell><button type="button" className="future-row-toggle" aria-pressed={role===r.role} onClick={()=>setRole(r.role)}>{r.role}</button></TableCell>
            {r.grants.map((g,i)=><TableCell key={i}><span className={g?'future-grant yes':'future-grant no'} aria-label={g?'Granted':'Not granted'}>{g?'Yes':'No'}</span></TableCell>)}
          </TableRow>)}</TableBody></Table>
      <div className="future-connection-detail"><h3>{active.role}</h3>
        <p className="future-role-summary">{active.grants.filter(Boolean).length} of {roleMatrix.permissions.length} permissions granted.</p>
        <div className="future-role-grants">{roleMatrix.permissions.map((perm,i)=><span key={perm} className={active.grants[i]?'future-grant yes':'future-grant no'}>{active.grants[i]?'\u2713':'\u2715'} {perm}</span>)}</div>
      </div>
      </div>
      <div className="panel-bottom config-core"><strong>One role ships today</strong><span>A shared access code currently opens a single owner workspace, so everyone who signs in holds every permission in this table. Splitting these roles is the work that turns the companion into a patient product rather than an evaluation view.</span></div>
    </Panel>
    <div className="engine-main-grid">
      <Panel title="Consent" subtitle="Recorded, scoped, time-bounded and revocable.">
        <div className="future-queue">{consentRecords.map(r=><div key={r.scope}><div><strong>{r.scope}</strong><small>{r.basis}</small></div><Badge tone={r.state.startsWith('Granted')?'teal':r.state.startsWith('Declined')?'neutral':'amber'}>{r.state}</Badge></div>)}</div>
      </Panel>
      <Panel title="Access and disclosure log" subtitle="Every read of a patient record, accounted for.">
        <div className="future-modelcard">{disclosureLog.map(r=><div key={r.what}><strong>{r.what}</strong><p>{r.why}</p></div>)}</div>
      </Panel>
    </div>
    <BuildNotes c={c}/></>;
}

const views:Record<string,(p:{c:Capability})=>React.ReactElement>={twin:TwinPreview,pst:PstPreview,shadow:ShadowPreview,
  integration:IntegrationPreview,instruments:InstrumentsPreview,pathway:PathwayPreview,mobile:MobilePreview,
  billing:BillingPreview,governance:GovernancePreview};

export function FutureCapabilities(){
  const [tab,setTab]=useState(capabilities[0].id);
  return <>
    <PageTitle eyebrow="ROADMAP" title="Planned capabilities" description="Interface previews for the capabilities this app does not implement." actions={<Badge tone="amber">{previewNotice}</Badge>}/>
    <div className="future-header">
      <div><h2>Prototype screens for capabilities still to be built.</h2>
        <p>These previews show how each planned capability is intended to look and read, so the design can be reviewed before it is built. The figures on these pages are fabricated for the prototype: nothing here is connected to a clinical service, and no value is computed, retrieved, predicted, or scored.</p>
        <p className="future-header-note">Each preview carries build notes at the foot of the page. Everything outside this section is the working app.</p>
      </div>
    </div>
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList variant="line" className="app-tabs mb-6 future-tabs">{capabilities.map(c=><TabsTrigger key={c.id} value={c.id}>{c.name}</TabsTrigger>)}</TabsList>
      {capabilities.map(c=>{const View=views[c.id];return <TabsContent key={c.id} value={c.id}><div className="future-panel-stack"><View c={c}/></div></TabsContent>;})}
    </Tabs>
  </>;
}
