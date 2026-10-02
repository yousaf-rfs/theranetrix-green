'use client';
import {useId,useState,type ReactNode} from 'react';
import {RecommendationDetails} from './recommendation-details';
import {SignedDecisionTrace} from './decision-trace';
import {Button} from '@/components/ui/button';
import {reviewSections,reviewSectionLabels,type DashboardLayout} from '@/lib/dashboard-layout';
import {buildEngineOutput,defaultEnginePreferences,engineRecordRevision} from '@/lib/engine-demo';
import {engineDecisionHeading,unmarkPrototypeLabel} from '@/lib/engine-decision';
import {featureEnabled,type Patient} from '@/lib/theranetrix';
import {observedMetrics} from '@/lib/observations';
import {patientSnapshot} from '@/lib/patient-overview';
import {DoctorDashboard} from './dashboard-customize';
import {MedicationGroups,PlanForm} from './medications';
import {PatientReviewDialog} from './patient-overview';
import {ClinicalContextDialog} from './patient-context';
import {Badge,MiniTrend,Panel,DetailLines,formatDate} from './ui';
import type {Context} from './app';
import {ADVISOR_NAME} from '@/lib/product-names';

type Props={p:Patient;ctx:Context;changeTab:(tab:string)=>void};
const synopsisGroups:{id:string;title:string;description:string;sections:typeof reviewSections[number][]}[]=[
 {id:'state',title:'Patient state',description:'Medication response and changes in reported outcomes.',sections:['medications','outcomes']},
 {id:'engines',title:'Engine outputs',description:'Patient context, the PST strategy comparison, and Shadow AI rule differences.',sections:['twin','pst','shadow']},
 {id:'coordination',title:'Care and follow-up',description:'Patient conversations and upcoming care activities.',sections:['advisor','pathway']},
 {id:'evidence',title:'Evidence and sources',description:'What supports this review and what remains unavailable.',sections:['evidence']},
 {id:'documentation',title:'Documentation',description:'The latest saved clinical notes.',sections:['notes']},
];
function groupedReviewSections(sections:readonly typeof reviewSections[number][]){
 const groups:(typeof synopsisGroups[number]&{category:string})[]=[];
 for(const section of sections){
  const group=synopsisGroups.find(group=>group.sections.includes(section))!;
  const previous=groups.at(-1);
  if(previous?.category===group.id)previous.sections.push(section);
  else groups.push({...group,id:group.id+'-'+groups.length,category:group.id,sections:[section]});
 }
 return groups;
}
export function PatientSynopsis(props:Props){return <DoctorDashboard ctx={props.ctx}>{(layout,controls,key)=><div key={key}><div className="synopsis-controls">{controls}</div><SynopsisBoard {...props} layout={layout}/></div>}</DoctorDashboard>;}

export function SynopsisBoard({p,ctx,changeTab,layout}:{layout:DashboardLayout}&Props){
 const sectionPrefix=useId();
 const [editing,setEditing]=useState(false),[reviewId,setReviewId]=useState<string|null>(null),[contextOpen,setContextOpen]=useState(false);
 const lastRun=ctx.data.engineRuns?.find(r=>r.patientId===p.id),output=buildEngineOutput(p,ctx.data,lastRun?.preferences??defaultEnginePreferences);
 const snapshot=patientSnapshot(p,ctx.data),plan=p.carePlans[0],sections=layout.reviewSections??reviewSections;
 const groups=groupedReviewSections(sections);
 const reviews=ctx.data.reviews.filter(r=>r.patientId===p.id&&r.status!=='Resolved');
 const turns=ctx.data.advisorTurns?.filter(t=>t.patientId===p.id)??[],lastTurn=turns.at(-1);
 const selectedReview=reviews.find(r=>r.id===reviewId);
 const metrics=observedMetrics(p,ctx.data);
 const enabled=(key:Parameters<typeof featureEnabled>[1])=>featureEnabled(ctx.data,key);
 const go=(tab:string,label:string)=><Button size="sm" variant="outline" onClick={()=>changeTab(tab)}>{label}</Button>;
 const off=(name:string)=><p>{name} is off in workspace settings. Existing concerns remain above.</p>;
 const rows=(items:string[])=>items.length?<ul>{items.map((s,i)=><li key={i}>{s}</li>)}</ul>:<p>No information recorded.</p>;
 const strategy=(kind:'pst'|'shadow')=>{const ids=kind==='pst'?output.pstOrder:output.shadowOrder;return !enabled(kind)?off(kind==='pst'?'PST':'Shadow AI'):<><Badge>Strategy ranking</Badge>{ids.length?ids.slice(0,2).map((id,i)=>{const c=output.candidates.find(c=>c.id===id)!;return <div key={id}><strong>{i+1}. {c.title}</strong><p>{c.reason}</p><small>{c.watch}</small><RecommendationDetails title={c.title} label="Why this priority?" rationale={[c.reason,...output.basis.filter(b=>!b.startsWith('The dashed'))]} sources={output.sources.map(source=>({label:source.label,value:source.value,date:source.date}))} considerations={[c.watch]} alternatives={ids.filter(other=>other!==id).map(other=>{const alternative=output.candidates.find(candidate=>candidate.id===other);return alternative?alternative.title+': '+alternative.reason:'';}).filter(Boolean)} limitations={['This is a prototype record-rule ranking, not a validated clinical recommendation.',...output.gaps]}/></div>}):<p>More observations are needed. No ranking is inferred.</p>}{kind==='shadow'&&<p>{output.agreement===null?'No paired ranking available.':output.agreement?'Same first priority as PST.':'Different first priority from PST.'} Agreement is not a confidence score.</p>}<details><summary>Basis and limitations</summary>{rows(output.basis.filter(b=>!b.startsWith('The dashed')))}</details>{go(kind,'Open '+(kind==='pst'?'PST':'Shadow AI'))}</>;};
 const content:Record<typeof reviewSections[number],ReactNode>={
  medications:<>{snapshot.medications.length?<MedicationGroups variant="compact" medications={snapshot.medications} render={m=><div className="synopsis-medication" key={m.id}><strong>{m.name}</strong><p>{m.regimen||'Regimen unknown'} · {m.indication||'Indication not recorded'}</p><Badge tone={m.benefit==='Helpful'?'teal':'amber'}>{m.benefit}</Badge><p>{m.tolerability==='Effects reported'?m.effects:m.tolerability} · {m.adherence}</p><small>Reported {formatDate(m.reportedAt)}</small></div>}/>:<p>{p.medicationReconciliation?.none?'No current medications reported.':'Medication list not confirmed.'}</p>}<p className="muted">Outcome changes do not establish medication efficacy.</p>{go('treatment','Review and update treatment')}</>,
  outcomes:enabled('assessments')?<><div className="synopsis-metrics">{metrics.map(m=><div key={m.key}><span>{m.key==='function'?'Daily function':m.key==='sleep'?'Sleep':'Pain'}</span><strong>{m.last??'Unknown'}{m.last!==undefined&&' / 10'}</strong><small>{m.recent===null?'No prior comparison':m.recent===0?'Unchanged':`${m.key==='pain'?(m.recent<0?'Better':'Worse'):(m.recent>0?'Better':'Worse')} by ${Math.abs(m.recent)} points`}</small><MiniTrend values={p[m.key]} color={m.key==='pain'?'#238b7c':m.key==='function'?'#6b81c5':'#c18a42'}/></div>)}</div><p>Latest {p.dates.at(-1)?formatDate(p.dates.at(-1)!):'not recorded'}. Patient self-reports.</p>{go('outcomes','Inspect observations')}</>:off('Assessments'),
  twin:enabled('digitalTwin')?<><p>{output.summary}</p><p>{p.dates.length} recorded observation dates. Goal: {p.goal}</p><Badge>Observed patient state</Badge><p>Clinical prediction, validated uncertainty, and recalibration are not connected.</p><details><summary>Patient context</summary>{rows([p.clinicalContext?.physicalContext,p.clinicalContext?.psychologicalContext,p.clinicalContext?.socialContext].filter((s):s is string=>!!s))}</details>{go('twin','Open Digital Twin')}</>:off('Digital Twin'),
  pst:strategy('pst'),shadow:strategy('shadow'),
  advisor:enabled('advisor')?<>{lastTurn?<><blockquote>{lastTurn.patientText}</blockquote><small>{formatDate(lastTurn.date,true)}</small><p>{lastTurn.summary}</p></>:<p>No Advisor exchange yet.</p>}<p>{turns.filter(t=>t.reviewId&&reviews.some(r=>r.id===t.reviewId)).length} unresolved Advisor handoffs.</p><details><summary>Latest reply</summary><p>{lastTurn?.reply||'No reply recorded.'}</p></details>{go('advisor','Open '+ADVISOR_NAME)} <a className="text-link" href={'/patient-companion?patient='+encodeURIComponent(p.id)}>Patient view</a></>:off(ADVISOR_NAME),
  pathway:enabled('pathways')?<><p>{p.pathway||'Not enrolled'} · {p.stage}</p>{snapshot.tasks.length?snapshot.tasks.slice(0,3).map(t=><div key={t.id}><strong>{t.title}</strong><p>{formatDate(t.date)} · {t.owner||p.clinician}</p><Button size="sm" variant="outline" disabled={ctx.busy} onClick={()=>ctx.save({type:'task.toggle',id:t.id,done:true},'Activity completed')}>Complete activity</Button></div>):<p>No outstanding activities.</p>}{go('pathway','Open care pathway')}</>:off('Care pathways'),
  evidence:<><Badge tone="amber">Evidence services not connected</Badge><p>Literature support, reviewed treatment-use label status, and model validation scope are not available. Priority scores are not evidence grades.</p><details><summary>Current sources and gaps</summary>{output.sources.map((s,i)=><p key={i}><strong>{s.label}</strong>: {s.value} · {formatDate(s.date)}</p>)}{rows(output.gaps)}</details>{go('evidence','Inspect evidence readiness')} {go('trace','Saved output trace')}</>,
  notes:<>{p.notes[0]?<><Badge>{p.notes[0].type}</Badge><p>{p.notes[0].text}</p><small>{p.notes[0].author} · {formatDate(p.notes[0].date,true)}</small></>:<p>No notes recorded.</p>}<div>{go('notes','All documentation')} <Button size="sm" onClick={()=>ctx.open('note',p)}>Add note</Button></div></>,
 };
 return <div className={'synopsis-workspace care-synopsis synopsis-'+layout.density}>
  <div className="synopsis-safety"><strong>Allergies: {p.clinicalContext?.allergyStatus==='Reactions reported'?p.clinicalContext.allergies:p.clinicalContext?.allergyStatus??'Not reviewed'}</strong><Button size="sm" variant="outline" onClick={()=>setContextOpen(true)}>Review context</Button><span>External clinical records and interaction checking are not connected.</span></div>
  <Panel title="This review" action={<Badge tone={reviews.length?'amber':'neutral'}>{reviews.length} open {reviews.length===1?'concern':'concerns'}</Badge>}><div className="synopsis-body"><div className="care-review-summary"><div><span className="care-nav-label">Current picture</span><h3>{output.summary}</h3></div><div className="care-patient-goal"><span className="care-nav-label">Patient goal</span><p>{p.goal}</p></div></div>{p.recordReviewRequiredSince&&<Badge tone="amber">Clinical record requires review</Badge>}{reviews.length?<div className="synopsis-concerns">{reviews.map(r=><article key={r.id}><div><strong>{r.title}</strong><Badge tone={r.priority==='High'?'rose':'amber'}>{r.priority}</Badge></div><p><DetailLines text={r.detail}/></p><Button size="sm" variant="outline" onClick={()=>setReviewId(r.id)}>Document action</Button></article>)}</div>:<p className="care-review-empty">No open care-team review items. This does not establish treatment safety.</p>}<div className="synopsis-controls">{go('visit','Detailed encounter review')}<Button variant="outline" size="sm" onClick={()=>ctx.open('escalation',p)}>Add concern</Button></div></div></Panel>
  {snapshot.medications.some(m=>m.tolerability==='Effects reported'||m.adherence==='Not taking'||m.adherence==='Missed doses')&&<div className="synopsis-safety" aria-label="Medication concerns remain visible">{snapshot.medications.filter(m=>m.tolerability==='Effects reported'||m.adherence==='Not taking'||m.adherence==='Missed doses').map(m=><p key={m.id}><strong>{m.name}:</strong> {m.tolerability==='Effects reported'?m.effects:''} · {m.adherence} · Reported {formatDate(m.reportedAt)}</p>)}{go('treatment','Review medication concerns')}</div>}
  <nav className="care-review-nav" aria-label="Patient review sections">{groups.map(group=><a key={group.id} href={'#'+sectionPrefix+'-'+group.id}>{group.title}</a>)}<a href={'#'+sectionPrefix+'-plan'}>Plan and follow-up</a></nav>
  {groups.map(group=><section className={'care-review-group care-review-group-'+group.category} key={group.id} id={sectionPrefix+'-'+group.id}><header><h2>{group.title}</h2><p>{group.description}</p></header><div className="synopsis-grid">{group.sections.map(section=><Panel key={section} title={reviewSectionLabels[section]}><div className="synopsis-body">{content[section]}</div></Panel>)}</div></section>)}
  {sections.length<reviewSections.length&&<p className="muted">{reviewSections.length-sections.length} optional sections hidden by this profile. Safety, open concerns, and plan remain visible. Use Customize my dashboard to restore sections.</p>}
  <Panel id={sectionPrefix+'-plan'} className="care-review-plan" title="Decision, plan, and follow-up"><div className="synopsis-body">{editing||!plan?<PlanForm p={p} ctx={ctx} compact close={()=>setEditing(false)}/>:<><p className="care-plan-text">{plan.text}</p><div className="care-plan-followup"><div><span>Follow-up owner</span><strong>{plan.owner}</strong></div><div><span>Review date</span><strong>{formatDate(plan.followup)} · {plan.time}</strong></div></div><small>Saved by {plan.author} · {formatDate(plan.date,true)}</small><div className="synopsis-controls"><Button onClick={()=>setEditing(true)}>Update plan</Button>{go('pst','Review strategy and record decision')}</div></>}</div></Panel>
  <PatientReviewDialog review={selectedReview} close={()=>setReviewId(null)} ctx={ctx}/><ClinicalContextDialog p={p} ctx={ctx} open={contextOpen} close={()=>setContextOpen(false)}/>
 </div>;
}

export function PatientEvidenceView({p,ctx}:{p:Patient;ctx:Context}){
 const output=buildEngineOutput(p,ctx.data);
 return <div className="stack care-evidence-view">
  <Panel title="Treatment-use and evidence readiness" subtitle="Patient medication records are not a curated treatment-use library."><div className="synopsis-body">
   <div className="care-evidence-notice"><Badge tone="amber">Reviewed evidence and label alignment unavailable</Badge><p>Each use needs its own indication, population, regimen, endpoint, literature assertions, and review. No global treatment evidence score is inferred.</p></div>
   <div className="care-evidence-treatments">{p.medications.length?p.medications.map(m=><article className="care-evidence-treatment" key={m.id}><header><h3>{m.name}</h3><Badge>{m.status}</Badge></header><p>{m.indication||'Indication unknown'} · {m.regimen||'Regimen unknown'}</p><dl><dt>Observed response</dt><dd>{m.benefit} · Reported {formatDate(m.reportedAt)}</dd><dt>Reviewed use status</dt><dd>Not recorded</dd><dt>Population and endpoint applicability</dt><dd>Not reviewed</dd><dt>Supporting and conflicting literature</dt><dd>Not connected</dd><dt>Model validation for this use</dt><dd>Not available</dd></dl><RecommendationDetails title={m.name+' evidence readiness'} label="Inspect record and evidence gaps" rationale={['This view contains the patient’s recorded medication and reported response. It does not assign a literature evidence grade.']} sources={[{label:'Medication regimen',value:m.regimen||'Not recorded'},{label:'Recorded indication',value:m.indication||'Not recorded'},{label:'Patient-reported benefit',value:m.benefit,date:m.reportedAt}]} limitations={['Treatment-use status, population applicability, supporting and conflicting literature, and model validation have not been reviewed in a connected evidence service.', 'An observed outcome change does not establish that the medication caused it.']}/></article>):<p>No medications recorded.</p>}</div>
  </div></Panel>
  <div className="care-evidence-source-layout"><Panel title="Source records" action={<Badge>{output.sources.length} sources</Badge>}><div className="synopsis-body care-evidence-sources">{output.sources.map((s,i)=><article key={i}><strong>{s.label}</strong><p>{s.value}</p><small>{formatDate(s.date,true)}</small></article>)}</div></Panel><Panel title="Missing inputs" action={<Badge tone="amber">{output.gaps.length} gaps</Badge>}><div className="synopsis-body"><ul className="care-evidence-gaps">{output.gaps.map(g=><li key={g}>{g}</li>)}</ul></div></Panel></div>
 </div>;
}

export function OutputTraceView({p,ctx}:{p:Patient;ctx:Context}){
 const runs=ctx.data.engineRuns?.filter(r=>r.patientId===p.id)??[];
 return <Panel title="Saved outputs and decision trace" subtitle="Historical demo results, not a regulatory evidence register."><div className="synopsis-body"><p>Current overview findings are calculated from saved patient records. Only explicitly saved engine runs appear here. Historical outputs are not replaced by today’s calculation.</p>{!runs.length?<p>No saved outputs yet in engine run history. Signed decision records are shown separately below.</p>:runs.map(run=><details key={run.id} className="engine-history"><summary>{formatDate(run.date,true)} · {run.actor} · {run.revision===engineRecordRevision(p,ctx.data)?'Current record':'Historical record'}</summary><p>{run.summary}</p><dl><dt>Output ID</dt><dd>{run.id}</dd><dt>Rule version</dt><dd>{run.version}</dd><dt>Input fingerprint</dt><dd>{run.revision}</dd></dl><h3>Saved source excerpts</h3>{run.sources.map((s,i)=><p key={i}><strong>{s.label}:</strong> {s.value} · {formatDate(s.date)}</p>)}<h3>Saved strategy outputs</h3>{run.candidates.map(c=><p key={c.id}>{c.title} · PST {run.enabled.pst?c.pstScore:'off'} · Shadow {run.enabled.shadow?c.shadowScore:'off'}</p>)}<h3>Linked decisions</h3>{ctx.data.engineDecisions?.filter(d=>d.patientId===p.id&&d.runId===run.id).map(d=><blockquote key={d.id}><strong>{engineDecisionHeading(d)}</strong>{d.action&&<p><small>Clinical approach linked to this run: {d.title}{d.labelStatus?` · Label status: ${unmarkPrototypeLabel(d.labelStatus)} (prototype label status, verify)`:''}</small></p>}<p>{d.rationale}</p><p>{d.patientPlan}</p><small>{d.actor} · {formatDate(d.date,true)}</small></blockquote>)}<p>Each run keeps its saved source excerpts and calculation rules. Linked signed records retain the observations, decisions, and versions reviewed at signing.</p><SignedDecisionTrace workspace={ctx.data} patientId={p.id} runId={run.id}/></details>)}<SignedDecisionTrace workspace={ctx.data} patientId={p.id} unlinkedOnly/></div></Panel>;
}
