'use client';
import {RecommendationDetails} from './recommendation-details';
import {useEffect,useMemo,useState,useRef,type FormEvent} from 'react';
import {Download,SlidersHorizontal,ClipboardList,ArrowUpRight,History,Save,ChevronRight,ShieldCheck,Layers,BellRing} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Switch} from '@/components/ui/switch';
import {featureDefinitions,type Workspace} from '@/lib/theranetrix';
import {featureAvailability} from '@/lib/feature-availability';
import {defaultPlanning,planningSchema,planningSummary,plannedDefinitions,featureReviewFocus,fdaSources,answerOptions,planningVersion,type PlanningProfile} from '@/lib/configuration';
import type {Context} from './app';
import {Badge,Panel,Picker,formatDate} from './ui';
import {ADVISOR_NAME} from '@/lib/product-names';
import {CLINICIAN_RULE_BASIS,DEMO_RULE_BASIS,ruleFormKey,ruleIsOn,thresholdSummary,type SymptomChangeRule} from '@/lib/symptom-change-rule';

const sections=[{id:'runtime',title:'Available features',description:'What your team can use',icon:SlidersHorizontal},{id:'review-rule',title:'Review rule',description:'Symptom-change review flag',icon:BellRing},{id:'scope',title:'Release scope',description:'Intended use and ownership',icon:ClipboardList},{id:'fda-plan',title:'FDA planning',description:'Questions and review criteria',icon:ShieldCheck},{id:'coverage',title:'Feature coverage',description:'Available and future capabilities',icon:Layers},{id:'config-history',title:'Saved history',description:'Snapshots and exports',icon:History}];
const coverage=[
  ['Clinician workspace','Clinical review, saved engine decisions, linked patient plans, and follow-up.','Formal encounters and clinical-service validation.'],
  ['Digital Twin','Saved patient-state runs, observed trajectories, and scenario targets.','Validated predictive model, uncertainty estimation, and recalibration.'],
  ['PST','Strategy scores, priority weighting, and clinician decisions.','Clinical drug candidates, combination simulation, and mechanistic evidence.'],
  ['Shadow AI','Record-rule strategy comparison with PST, source basis, and run history.','Separately trained clinical model, literature retrieval, and validated outputs.'],
  ['MobileNetrix','Companion check-ins, goals, trends, and workspace conversations.','Live app connection, validated instruments, cadence, and notifications.'],
  [ADVISOR_NAME,'Scripted conversation, confirmed check-ins, and concern/question handoffs.','Clinician-approved rubric extensions (versioned), approved protocol education, urgent triage, and external notifications.'],
  ['Care pathways','Five sample activities, enrollment, scheduling, and completion.','Approved 29-step pathway, clinical branches, and event automation.'],
  ['Data integration','Source labels and explicit missing information.','EHR/Tabia, SMART/FHIR, labs, devices, and clinical write-back.'],
  ['Regulatory planning','Feature controls, conditional review topics, and saved configuration snapshots.','Release determination, clinical validation, complaints, and post-market controls.'],
  ['Model governance','Retained output snapshots, input revisions, decision linkage, and regression checks.','Clinical inference registry, signed models, and validated evaluations.'],
  ['Privacy and access','Shared workspace access; optional owner password protection.','Clinical roles, patient-specific access, consent, disclosures, and read-access audit.'],
  ['Reimbursement and licensing','Requirements identified.','Eligibility, time/data sufficiency, payer workflows, and instrument licenses.'],
];
const thresholdText=(value:number|null|undefined)=>value===null||value===undefined?'':String(value);
const ruleSetting=(rule:Pick<SymptomChangeRule,'basis'|'setBy'|'setAt'>)=>`${rule.basis} · set by ${rule.setBy}${rule.basis===CLINICIAN_RULE_BASIS?' (name as entered)':''} on ${formatDate(rule.setAt)}`;
/** Clinician-owned thresholds for the rule-based symptom-change review flag. With every threshold empty the rule is off.
 * The inputs start from the saved rule; the caller keys this form on the saved rule, so an undo, a reset or a new save resets them. */
function SymptomRuleSettings({ctx}:{ctx:Context}){
  const saved=ctx.data.symptomChangeRule;
  const [rise,setRise]=useState(thresholdText(saved?.painRise)),[atLeast,setAtLeast]=useState(thresholdText(saved?.painAtLeast)),[location,setLocation]=useState(saved?.newLocation??false),[clinician,setClinician]=useState('');
  const parse=(value:string)=>value.trim()===''?null:Number(value),valid=(value:number|null)=>value===null||Number.isInteger(value)&&value>=1&&value<=10;
  const thresholds={painRise:parse(rise),painAtLeast:parse(atLeast),newLocation:location},ready=valid(thresholds.painRise)&&valid(thresholds.painAtLeast)&&!!clinician.trim();
  async function save(event:FormEvent){event.preventDefault();if(!ready||ctx.busy)return;if(await ctx.save({type:'symptom-rule.save',thresholds,clinician:clinician.trim()},ruleIsOn(thresholds)?'Review rule saved':'Review rule turned off'))setClinician('');}
  return <Panel id="review-rule" title="Reported symptom change: rule-based review flag" subtitle="When a new patient check-in meets a threshold set here, a High-priority item is added to the Review queue for a clinician to look at. While that item is open, later check-ins that meet a threshold update it instead of adding another." action={<Badge tone={ruleIsOn(saved)?'teal':'neutral'}>{ruleIsOn(saved)?'Rule on':'Rule off'}</Badge>}>
    <form className="config-form symptom-rule-form" onSubmit={save}>
      <p className="symptom-rule-current"><strong>Current setting:</strong> {saved?thresholdSummary(saved):'Off: no thresholds set'}{saved&&<small>{ruleSetting(saved)}</small>}</p>
      {saved?.basis===DEMO_RULE_BASIS&&<p className="config-feature-alert">These are example values for the demo workspace, not validated thresholds. A clinician should set or clear them before any clinical use.</p>}
      <label>Pain rise since the previous check-in, in points (1 to 10)<Input type="number" inputMode="numeric" min={1} max={10} step={1} value={rise} placeholder="Empty: not used" aria-describedby="symptom-rule-help" onChange={e=>setRise(e.target.value)}/></label>
      <label>Pain reaches this score or higher from a lower previous score, on the 0 to 10 scale (1 to 10)<Input type="number" inputMode="numeric" min={1} max={10} step={1} value={atLeast} placeholder="Empty: not used" aria-describedby="symptom-rule-help" onChange={e=>setAtLeast(e.target.value)}/></label>
      <label className="engine-check-label"><input type="checkbox" checked={location} onChange={e=>setLocation(e.target.checked)}/> Flag a body-map location not reported in earlier check-ins</label>
      <label>Clinician setting these thresholds<Input required maxLength={100} value={clinician} placeholder="Name and role" onChange={e=>setClinician(e.target.value)}/></label>
      <p id="symptom-rule-help" className="subtle-notice">Leave every threshold empty and the box unticked to turn the rule off. A pain score that stays at or above the level set here does not add a new item at each check-in. TheraNetrix does not supply or validate these thresholds. The flag lists which thresholds a check-in met and is a prompt for clinician review, not an assessment; a check-in without a flag does not show that a patient is stable. It appears only in this workspace’s Review queue: no page, text or email is sent.</p>
      <div className="form-actions"><Button type="submit" disabled={ctx.busy||!ready}><Save size={16}/>Save review rule</Button></div>
    </form>
    {saved?.history?.length?<details className="config-feature-detail symptom-rule-history"><summary>Earlier settings ({saved.history.length})</summary><ul>{saved.history.map(entry=><li key={entry.setAt+entry.setBy}>{thresholdSummary(entry)} · {ruleSetting(entry)}</li>)}</ul></details>:null}
  </Panel>;
}
function download(name:string,data:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function ConfigurationSettings({ctx}:{ctx:Context}){
  const [section,setSection]=useState('runtime');
  useEffect(()=>{const sync=()=>{const id=window.location.hash.slice(1);if(sections.some(item=>item.id===id))setSection(id);};sync();window.addEventListener('hashchange',sync);return()=>window.removeEventListener('hashchange',sync);},[]);
  function navigate(id:string){setSection(id);window.history.replaceState(null,'',window.location.pathname+window.location.search+'#'+id);}
  const savedProfile=ctx.data.planning??defaultPlanning();
  const [features,setFeatures]=useState<Workspace['features']>(()=>({...ctx.data.features}));
  const [profile,setProfile]=useState<PlanningProfile>(()=>structuredClone(savedProfile));
  const [now,setNow]=useState(()=>new Date().toISOString());
  useEffect(()=>{const timer=setInterval(()=>setNow(new Date().toISOString()),60000);return()=>clearInterval(timer);},[]);
  const availability=useMemo(()=>new Map(featureDefinitions.map(feature=>[feature.id,featureAvailability(ctx.data,feature.id,now)])),[ctx.data,now]);
  const dirty=featureDefinitions.some(f=>features[f.id]!==ctx.data.features[f.id])||JSON.stringify(profile)!==JSON.stringify(savedProfile);
  const summary=planningSummary(features,profile),history=ctx.data.configurationHistory??[];
  const latestId=history[0]?.id??'';
  const [baseId,setBaseId]=useState(latestId);
  const pending=useRef<{previousId:string;profile:PlanningProfile;features:Workspace['features']}|null>(null);
  const conflict=latestId!==baseId;
  useEffect(()=>{
    const saved=pending.current;
    if(saved&&!ctx.busy&&latestId!==saved.previousId){
      if(featureDefinitions.every(f=>ctx.data.features[f.id]===saved.features[f.id])&&JSON.stringify(savedProfile)===JSON.stringify(saved.profile)){
        setFeatures({...ctx.data.features});setProfile(structuredClone(savedProfile));setBaseId(latestId);
      }
      pending.current=null;
    }
  },[ctx.busy,latestId,ctx.data.features,savedProfile]);
  async function saveConfiguration(){
    const canonical=planningSchema.parse(profile),selected={...features};
    pending.current={previousId:baseId,profile:canonical,features:selected};
    if(!await ctx.save({type:'configuration.save',features:selected,planning:canonical,baseConfigurationId:baseId},'Configuration and FDA planning snapshot saved'))pending.current=null;
  }
  useEffect(()=>{if(!dirty)return;const leave=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[dirty]);
  function reset(){setBaseId(latestId);setFeatures({...ctx.data.features});setProfile(structuredClone(savedProfile));}
  function update<K extends keyof PlanningProfile>(key:K,value:PlanningProfile[K]){if(!ctx.busy)setProfile(p=>({...p,[key]:value}));}
  function preset(mode:'coordination'|'review'|'connected'){
    const enabled=mode==='coordination'?['assessments','pathways','messages']:mode==='review'?['assessments','reviewPrompts','pathways','messages']:featureDefinitions.map(f=>f.id);
    setFeatures(Object.fromEntries(featureDefinitions.map(f=>[f.id,enabled.includes(f.id)])) as Workspace['features']);
  }
  return <div className="configuration-settings">
    <fieldset disabled={ctx.busy} className="config-controls">
      <div className="config-intro"><span className="config-icon"><SlidersHorizontal size={25}/></span><div><h2>Program configuration</h2><p>Choose the capabilities your team can use and define the scope of your release.</p><span>Planning aid only. This does not determine FDA status, clearance, or compliance.</span></div><Badge tone={dirty?'amber':'teal'}>{dirty?'Unsaved changes':'Saved configuration'}</Badge></div>
      <div className="config-layout">
        <nav className="config-section-nav" aria-label="Configuration sections">{sections.map(item=><button type="button" key={item.id} aria-current={section===item.id?'page':undefined} onClick={()=>navigate(item.id)}><item.icon size={18}/><span><strong>{item.title}</strong><small>{item.description}</small></span><ChevronRight size={15}/></button>)}</nav>
        <div className="config-section-content">
        <div hidden={section!=='runtime'}>
    <Panel id="runtime" title="Available features" subtitle="Changes apply when saved. Current availability reflects your saved settings and governance reviews." action={<Badge tone={dirty?'amber':'teal'}>{dirty?'Draft configuration':'Current configuration'}</Badge>}>
      <RecommendationDetails title="Configuration presets" label="What do these presets change?" rationale={['Presets set the feature switches in your draft configuration. Review the switches before saving.', 'Feature dependencies and saved governance reviews still determine actual availability.']} considerations={['Existing concerns and saved records remain available when an optional feature is turned off.']} limitations={['Enabling a feature does not validate its recommendations, connect an external service, or approve clinical use.']}/><div className="config-presets"><span>Start with</span><Button variant="outline" size="sm" disabled={ctx.busy} onClick={()=>preset('coordination')}>Care coordination</Button><Button variant="outline" size="sm" disabled={ctx.busy} onClick={()=>preset('review')}>Clinician review</Button><Button variant="outline" size="sm" disabled={ctx.busy} onClick={()=>preset('connected')}>Enable all</Button><small>Presets change feature switches. Governance reviews remain separate.</small></div>
      {featureDefinitions.map(f=>{
        const current=availability.get(f.id)!,changed=features[f.id]!==ctx.data.features[f.id],draftBlocked=features[f.id]&&!summary.effective[f.id];
        const flagLabel=changed?(features[f.id]?'Enable after save':'Disable after save'):(features[f.id]?'Enabled':'Disabled');
        const currentLabel=current.usable?'Usable now':current.status==='disabled'?'Currently disabled':current.status==='dependency-blocked'?'Blocked by dependency':'Blocked by governance';
        return <div className="config-feature" key={f.id}><div><div className="config-feature-title"><h3>{f.name}</h3><Badge tone={changed?'amber':'neutral'}>{flagLabel}</Badge><Badge tone={current.usable?'teal':current.enabled?'amber':'neutral'}>{currentLabel}</Badge></div><p>{f.description}</p><small>{f.mode}{f.dependency?' · Requires '+featureDefinitions.find(x=>x.id===f.dependency)?.name:''}</small>{!current.usable&&current.enabled&&<p className="config-feature-alert">{current.reason}{current.reviewHref&&<> <a href={current.reviewHref} className="text-link">Review requirements <ArrowUpRight size={12}/></a></>}</p>}{draftBlocked&&<p id={'feature-draft-'+f.id} className="config-feature-alert">This draft still has an unmet feature dependency.</p>}<details className="config-feature-detail"><summary>Availability and review details</summary><p id={'feature-availability-'+f.id}><strong>Current availability:</strong> {current.reason}{current.reviewHref&&<> <a href={current.reviewHref} className="text-link">Review governance requirements for {f.name}</a></>}</p><p className="config-review-focus">Review focus: {featureReviewFocus[f.id]}</p></details></div><Switch checked={features[f.id]} disabled={ctx.busy} aria-label={'Enable '+f.name} aria-describedby={'feature-availability-'+f.id+(draftBlocked?' feature-draft-'+f.id:'')} onCheckedChange={value=>setFeatures(current=>({...current,[f.id]:value}))}/></div>;
      })}
      <div className="panel-bottom config-core"><strong>Core records and clinical review checks stay on</strong><span>Turning off a feature never resolves an outstanding review. Existing records are retained.</span><details className="config-feature-detail"><summary>See what stays available</summary><p>Patient directory, manual medication and treatment reviews, goals, notes, care plans, scheduling, existing escalations, and audit history. Core checks retain pending reviews and flag conflicting benefit, effects, or medication-use reports against a favorable assessment. These checks remain in FDA planning when optional features are off.</p></details></div>
    </Panel>

    </div><div hidden={section!=='review-rule'}><SymptomRuleSettings key={ruleFormKey(ctx.data.symptomChangeRule)} ctx={ctx}/>
    </div><div hidden={section!=='scope'} className="config-page-section">
    <div id="scope" className="config-section-intro"><ClipboardList size={21}/><div><h2>Intended release scope</h2><p>These declarations drive planning only. They do not connect or activate future clinical services.</p></div></div>
    <div className="config-columns">
      <Panel title="Intended use and review owner"><div className="config-form">
        <label>What will the product do, for whom, and in what setting?<Textarea rows={4} maxLength={2000} disabled={ctx.busy} value={profile.intendedUse} onChange={e=>update('intendedUse',e.target.value)} placeholder="Describe the intended population, clinical purpose, claims, and use environment."/></label>
        <label>Intended users<Picker label="Intended users" value={profile.users} onChange={v=>update('users',v as PlanningProfile['users'])} options={['Not assessed','Healthcare professionals','Patients or caregivers','Both']}/></label>
        <label>Role in a clinical decision<Picker label="Role in a clinical decision" value={profile.decisionRole} onChange={v=>update('decisionRole',v as PlanningProfile['decisionRole'])} options={['Not assessed','Organize and display records','Support clinical judgment','Direct or execute treatment']}/></label>
        <label>Will a decision need a time-critical response?<Picker label="Time-critical response" value={profile.timeCritical} onChange={v=>update('timeCritical',v as PlanningProfile['timeCritical'])} options={[...answerOptions]}/></label>
        <label>Assessment owner<Input maxLength={120} disabled={ctx.busy} value={profile.owner} onChange={e=>update('owner',e.target.value)} placeholder="Person responsible for reviewing the release scope"/></label>
        <label>Rationale, evidence references, and open issues<Textarea rows={4} maxLength={3000} disabled={ctx.busy} value={profile.rationale} onChange={e=>update('rationale',e.target.value)} placeholder="Record supporting documents and the basis for your assumptions."/></label>
      </div></Panel>
      <Panel title="Future clinical capabilities" subtitle="Scope declarations only. These capabilities are not implemented in this app.">
        {plannedDefinitions.map(f=>{const selected=profile.planned[f.id],effective=summary.planned[f.id];return <div className="config-feature config-future" key={f.id}><div><h3>{f.name}</h3><p>{f.description}</p><small>Requires {f.parents.map(id=>featureDefinitions.find(x=>x.id===id)?.name).join(' or ')}</small><Badge tone={selected&&!effective?'amber':'neutral'}>{selected?effective?'Proposed for release':'Blocked by parent feature':'Outside proposed scope'}</Badge></div><Switch checked={selected} disabled={ctx.busy} aria-label={'Plan to '+f.name.toLowerCase()} onCheckedChange={v=>setProfile(p=>({...p,planned:{...p.planned,[f.id]:v}}))}/></div>;})}
        <div className="config-form"><label>Are model updates planned after release?<Picker label="Planned model updates" value={profile.plannedModelChanges} onChange={v=>update('plannedModelChanges',v as PlanningProfile['plannedModelChanges'])} options={[...answerOptions]}/></label></div>
      </Panel>
    </div>

    </div><div hidden={section!=='fda-plan'}>
    <Panel id="fda-plan" title="FDA planning for this configuration" subtitle="Conditional work items derived from your selections and declarations. No review item is automatically complete." action={<Badge tone="blue">{dirty?'Draft':'Saved selections'} · {Object.values(features).filter(Boolean).length} features requested</Badge>}>
      <div className="config-open"><h3>Open questions before release</h3><ul>{summary.questions.map(q=><li key={q}>{q}</li>)}</ul></div>
      {summary.items.map(item=><details className="config-review" key={item.id}><summary><span><strong>{item.title}</strong><small>{item.reason}</small></span><Badge tone={item.status==='Review needed'?'amber':'neutral'}>{item.status}</Badge></summary><div><p>{item.evidence}</p><div className="config-source-links">{item.sources.map(id=>{const source=fdaSources.find(s=>s.id===id)!;return <a key={id} href={source.url} target="_blank" rel="noreferrer">FDA: {source.title}<ArrowUpRight size={13}/></a>;})}</div></div></details>)}
      <div className="config-criteria"><h3>Four CDS criteria: initial screening assumptions</h3><p>These shared answers are a starting point. Assess all four separately for each function. “Yes” does not establish that every selected function meets the criteria or qualifies for the non-device exclusion.</p><div>{[
        ['permissibleInputs','1. Permissible inputs','No analysis of medical images, IVD signals, or patterns/signals from a signal acquisition system for the function being assessed.'],
        ['medicalInformation','2. Medical information','The function displays, analyzes, or prints medical information about a patient or other medical information.'],
        ['hcpSupport','3. Support for a healthcare professional','The function supports or provides recommendations to an HCP about prevention, diagnosis, or treatment.'],
        ['independentBasis','4. Independently reviewable basis','The HCP can review the basis and is not intended to rely primarily on the recommendation for an individual decision.'],
      ].map(([key,title,description])=><label key={key}><span><strong>{title}</strong><small>{description}</small></span><Picker label={title} value={profile.criteria[key as keyof PlanningProfile['criteria']]} onChange={v=>setProfile(p=>({...p,criteria:{...p.criteria,[key]:v}}))} options={[...answerOptions]}/></label>)}</div></div>
      <div className="panel-bottom config-core"><strong>Rules reviewed September 8, 2026</strong><span>FDA guidance informs these planning prompts. Applicability and a release decision require review of the actual functions, intended use, evidence, and current requirements.</span></div>
    </Panel>

    </div><div hidden={section!=='coverage'}>
    <Panel id="coverage" title="Feature coverage review" subtitle="Cross-check against the 12 domains in the TheraNetrix requirements map. In-workspace capabilities are distinct from connected production services.">
      <div className="config-coverage-head"><span>Domain</span><span>Available in this app</span><span>Still needed</span></div>
      {coverage.map(([domain,available,missing])=><div className="config-coverage-row" key={domain}><h3>{domain}</h3><p><span className="config-mobile-label">Available</span>{available}</p><p><span className="config-mobile-label">Still needed</span>{missing}</p></div>)}
      <div className="panel-bottom">Requirements reference: feature map commit 403398ce · Reviewed September 8, 2026</div>
    </Panel>

    </div><div hidden={section!=='config-history'}>
    <Panel id="config-history" title="Saved configuration history" subtitle="Each save captures requested and effective features, scope assumptions, review reasons, sources, rules version, time, and actor." action={<Button variant="outline" size="sm" disabled={!history.length} onClick={()=>download('theranetrix-configuration-history.json',history)}><Download size={15}/>Export history</Button>}>
      {history.length?history.map((entry,i)=><div className="config-history-row" key={entry.id}><History size={17}/><div><strong>{formatDate(entry.date,true)}{i===0?' · Latest saved':''}</strong><p>{entry.actor} · {entry.reason}</p><small>{Object.values(entry.effective).filter(Boolean).length} effective features · {entry.rulesVersion}</small></div><Button variant="outline" size="sm" aria-label={'Export configuration saved '+entry.date} onClick={()=>download('theranetrix-configuration-'+entry.id+'.json',entry)}><Download size={15}/>Export</Button></div>):<div className="padded"><h3>No configuration snapshot saved yet</h3><p>Save to record the current feature choices and planning assumptions. Earlier general audit entries remain in Audit history.</p></div>}
      <details className="config-sources"><summary>Official FDA sources used for this planning version</summary><div>{fdaSources.map(source=><a key={source.id} href={source.url} target="_blank" rel="noreferrer"><span>{source.title}<small>{source.date}</small></span><ArrowUpRight size={14}/></a>)}</div></details>
    </Panel>
    </div></div></div>
    </fieldset>{conflict&&<div role="alert" className="config-open"><strong>The saved configuration changed.</strong><p>Your draft is preserved. Reset to saved to load the latest choices, then review and reapply your changes before saving.</p></div>}
    <div className="config-savebar"><div><strong>{dirty?'Unsaved configuration':history.length?'Configuration saved':'Ready to save a planning snapshot'}</strong><small>{dirty?'Review the changes, then apply them to the workspace.':'Feature changes and FDA planning assumptions are recorded together.'}</small></div><div><Button variant="outline" disabled={ctx.busy||(!dirty&&!conflict)} onClick={reset}>Reset to saved</Button><Button disabled={ctx.busy||conflict||(!dirty&&history.length>0)} onClick={saveConfiguration}><Save size={16}/>{ctx.busy?'Saving...':'Save configuration'}</Button></div></div>
    <span className="sr-only">Planning rules version {planningVersion}</span>
  </div>;
}
