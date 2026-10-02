'use client';
import {Activity,Layers,Brain,ArrowUpRight} from 'lucide-react';
import {buildEngineOutput,defaultEnginePreferences} from '@/lib/engine-demo';
import {visitObservations} from '@/lib/visit-observations';
import type {Patient} from '@/lib/theranetrix';
import type {Context} from './app';
import {formatDate,Term} from './ui';
import {EngineRecommendation} from './engine-recommendation';
import {RecommendationDetails} from './recommendation-details';

/** Current derived answers, never a historical snapshot or a write on render. */
export function EngineEncounterSummary({p,ctx,compact=false}:{p:Patient;ctx:Context;compact?:boolean}){
  const previousRun=ctx.data.engineRuns?.find(r=>r.patientId===p.id);
  const output=buildEngineOutput(p,ctx.data,previousRun?.preferences??defaultEnginePreferences);
  const pst=output.candidates.find(c=>c.id===output.pstOrder[0]);
  const shadow=output.candidates.find(c=>c.id===output.shadowOrder[0]);
  const observations=visitObservations(p),latest=observations.at(-1),first=observations[0];
  const turns=ctx.data.advisorTurns?.filter(t=>t.patientId===p.id)??[];
  const handoffs=turns.filter(t=>t.reviewId&&ctx.data.reviews.some(r=>r.id===t.reviewId&&r.patientId===p.id&&r.status!=='Resolved'));
  const cards=[
    {name:'Digital Twin' as const,icon:Activity,on:output.enabled.twin,href:'/patients/'+encodeURIComponent(p.id)+'?tab=twin',job:'Observed trajectory',
      answer:latest?.pain!=null?`Pain ${latest.pain}/10${observations.length>1&&first.pain!==null?` · ${Math.abs(Math.round((latest.pain!-first.pain!)*10)/10)} ${latest.pain!<first.pain!?'lower':latest.pain!>first.pain!?'higher':'change'} since first report`:''}`:latest?'Pain not answered in latest report':'No observations recorded',
      detail:latest?`Latest function ${latest.function??'not answered'}${latest.function!==null?'/10':''}. Observed ${formatDate(latest.date)}. Recorded check-ins are separate from projected model scenarios.`:'A confirmed check-in is needed. No patient trajectory is inferred.'},
    {name:'PST' as const,icon:Layers,on:output.enabled.pst,href:'/patients/'+encodeURIComponent(p.id)+'?tab=treatment',job:'Weighted strategy comparison',answer:pst?.title??'More input needed',
      detail:pst?`${pst.reason} Priorities: relief ${output.preferences.relief}, alertness ${output.preferences.alertness}, routine ${output.preferences.routine}.`:'No strategy ranking without recorded observations.'},
    {name:'Shadow AI' as const,icon:Brain,on:output.enabled.shadow,href:'/patients/'+encodeURIComponent(p.id)+'?tab=treatment',job:'Record-based second review',answer:shadow?.title??'More input needed',
      detail:`${output.summary} ${output.agreement===false?'Different first priority from PST.':output.agreement===true?'Same first priority as PST.':'No paired ranking available.'}`},
  ];
  return <section className={'encounter-engines live-engine-summary feedback-engine-summary'+(compact?' is-compact':'')} aria-label={'Current engine answers for '+p.name} data-revision={output.revision}>
    <div className="engine-section-title"><h2>Clinical engine insights</h2><span className="live-engine-status">Updates with saved patient data</span></div>
    <div className="encounter-engine-cards">{cards.map(({name,icon:Icon,on,href,job,answer,detail})=><article key={name} className={'live-engine-card '+(name==='Shadow AI'?'is-shadow':name==='PST'?'is-pst':'is-twin')}><div className="live-engine-card-heading"><Icon size={18}/><strong>{name==='Digital Twin'?name:<Term t={name}/>}</strong><a href={href} aria-hidden="true" tabIndex={-1}><ArrowUpRight size={15}/></a></div><a href={href}><small>{job}</small><p className="live-engine-answer">{on?answer:'Off in settings'}</p><span className="feedback-engine-open">{name==='Digital Twin'?'View trajectory':'Review comparison'}</span></a>{on&&(name==='Digital Twin'?<RecommendationDetails title="Recorded trajectory" label="Reason & sources" summary={answer} rationale={[detail]} sources={observations.map(row=>({label:'Recorded pain',value:row.pain===null?(row.statuses?.pain??'Not recorded'):`${row.pain}/10`,date:row.date,href}))} limitations={['Observed change does not establish medication efficacy. Missing observations are not estimated.']}/>:<EngineRecommendation output={output} candidateId={name==='PST'?pst?.id:shadow?.id} title={name+' review: '+answer}/>)}</article>)}</div>
    <div className="engine-encounter-foot"><span>{handoffs.length?`${handoffs.length} open care-team handoff${handoffs.length===1?'':'s'}. ${handoffs.at(-1)?.patientText??''}`:'Current record · prototype calculations. No run required.'}</span><a href={'/patients/'+p.id+'?tab=treatment'} className="text-link">Inspect engines <ArrowUpRight size={15}/></a></div>
    {!compact&&<details className="live-engine-basis"><summary>Sources & calculation logic</summary><p>Calculated from the current saved record. {previousRun?'Uses priorities from the latest saved run; historical results remain unchanged.':'Uses default patient priorities until a comparison is saved.'}</p>{output.sources.map((s,i)=><p key={i}><strong>{s.label}: </strong>{s.value} <small>{formatDate(s.date,true)}</small></p>)}{output.enabled.shadow&&output.signals.map(s=><p key={s}>{s}</p>)}{output.gaps.map(g=><p key={g}>{g}</p>)}{output.basis.map(b=><p key={b}>{b}</p>)}</details>}
  </section>;
}