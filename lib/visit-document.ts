import type {Patient,Workspace} from './theranetrix';
import {groupMedications,medicationGroupingNote} from './medication-groups';
import type {EngineDecision} from './engine-demo';
import {decisionRationaleText,engineDecisionVerbs,markPrototypeLabel} from './engine-decision';

const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
/** Clinician-recorded medication decisions, newest first. Only the clinician's own record and the patient history snapshot: never a rank, score, second-opinion agreement or evidence grade. Older decisions without the structured fields still print their approach and rationale. */
export function medicationDecisionsHtml(decisions:EngineDecision[]){
  const items=(rows:string[],empty:string)=>rows.length?'<ul>'+rows.map(text=>'<li>'+escape(text)+'</li>').join('')+'</ul>':escape(empty);
  const entry=(d:EngineDecision)=>{
    const option=d.optionName??d.title??'Option not recorded',verb=d.action?engineDecisionVerbs[d.action]:undefined;
    return `<article class="decision"><h3>${escape(verb?`Clinician decision: ${verb} ${option}`:`Clinician decision: ${option}`)}</h3><small>${escape(String(d.date??'').slice(0,10)||'Date not recorded')} · ${escape(d.actor||'Clinician not recorded')}</small><dl>`
      +`<dt>Action</dt><dd>${escape(verb??'Not recorded as a separate field; see the rationale')}</dd><dt>${d.optionName?'Option':'Approach'}</dt><dd>${escape(option)}</dd>`
      +`<dt>Clinician rationale</dt><dd class="verbatim">${escape(decisionRationaleText(d.rationale))}</dd>`
      +`<dt>Label status</dt><dd>${escape(d.labelStatus?markPrototypeLabel(d.labelStatus):verb?'None for this option':'Not recorded with this decision')}</dd>`
      +`<dt>Previously tried</dt><dd>${d.priorTrials?items(d.priorTrials.map(t=>`${t.name}: ${t.stopReason?.trim()?'stop reason: '+t.stopReason.trim():'no stop reason recorded'}`),'None recorded'):'Not recorded with this decision'}</dd>`
      +`<dt>Clinician exclusions</dt><dd>${d.clinicianExclusions?items(d.clinicianExclusions.map(e=>`${e.name}: ${e.reason?.trim()?'reason: '+e.reason.trim():'no reason given'}`),'None'):'Not recorded with this decision'}</dd></dl></article>`;
  };
  const sorted=[...decisions].sort((a,b)=>String(b.date??'').localeCompare(String(a.date??'')));
  return `<section><h2>Medication decisions</h2><p>Decisions and rationale recorded by the clinician, newest first. They are not a system recommendation and not orders: no prescription issued. Label status is prototype data; verify against current labeling. Review before sharing, for example with a payer; this workspace does not send anything to payers.</p>${sorted.length?sorted.map(entry).join(''):'<p>No medication decisions recorded in this workspace.</p>'}</section>`;
}
export function visitDocumentHtml(patient:Patient,workspace:Workspace,generatedAt=new Date().toISOString()){
  const p=workspace.patients.find(item=>item.id===patient.id);
  if(!p)throw new Error('Patient not found.');
  const plan=p.carePlans[0],context=p.clinicalContext;
  const list=(items:string[])=>items.length?'<ul>'+items.map(text=>'<li>'+escape(text)+'</li>').join('')+'</ul>':'<p>Not recorded.</p>';
  const reviews=workspace.reviews.filter(item=>item.patientId===p.id&&item.status!=='Resolved');
  const note=p.notes.find(item=>item.type==='Visit summary'||item.type==='Progress note');
  const active=p.medications.filter(m=>m.status==='Active');
  const medications=active.length?groupMedications(active).filter(group=>group.medications.length).map(group=>`<h3>${escape(group.title)} (${group.medications.length})</h3>`+list(group.medications.map(m=>`${m.name} · ${m.regimen||'Regimen not recorded'}\nRecorded indication: ${m.indication||'Not recorded'}\nBenefit: ${m.benefit}. Tolerability: ${m.tolerability}${m.effects?'. '+m.effects:''}\nReported: ${m.reportedAt||'Not recorded'}. Reviewed: ${m.reviewedAt||'Not confirmed'}${m.reviewedBy?' by '+m.reviewedBy:''}`))).join('')+`<small>${escape(medicationGroupingNote)}</small>`:list([]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(p.name)} | TheraNetrix visit summary</title><style>
    @page{size:A4;margin:18mm}*{box-sizing:border-box}body{font:12px/1.55 Arial,sans-serif;color:#17313f;margin:30px auto;max-width:760px;padding:0 20px}h1{font-size:25px;margin:5px 0}h2{font-size:14px;border-bottom:1px solid #dce4e8;padding-bottom:7px;margin:24px 0 10px}h3{font-size:12px;color:#546979;margin:12px 0 4px}.decision h3{font-size:13px;color:#17313f;margin:16px 0 2px}.decision{break-inside:avoid;border-left:2px solid #dce4e8;padding-left:12px;margin-bottom:12px}.decision dl{margin-top:6px}.decision dd ul{margin:0;padding-left:18px}.verbatim{white-space:pre-wrap}p{white-space:pre-wrap;margin:7px 0}small{color:#546979}header{border-bottom:2px solid #087f75;padding-bottom:18px}dl{display:grid;grid-template-columns:145px 1fr;gap:5px 18px}dt{color:#546979}dd{margin:0}li{padding-bottom:6px;white-space:pre-wrap}footer{margin-top:28px;border-top:1px solid #dce4e8;padding-top:12px;font-size:10px;color:#546979}.print-actions{display:flex;gap:10px;margin-bottom:25px}button{padding:10px 16px;background:#087f75;color:#fff;border:0;border-radius:5px;cursor:pointer}section{break-inside:avoid}@media print{body{padding:0;margin:0;max-width:none}.print-actions{display:none}a{color:inherit}}
    </style></head><body><div class="print-actions"><button onclick="window.print()">Print / save PDF</button><button onclick="window.close()">Close</button></div><header><small>THERANETRIX · WORKSPACE VISIT SUMMARY</small><h1>${escape(p.name)}</h1><p>MRN: ${escape(p.medicalRecordNumber||'Not recorded')} · DOB: ${escape(p.dateOfBirth||'Not recorded')} · Workspace ID: ${escape(p.id)}</p><p>${escape(p.condition)} · ${escape(p.clinician)}</p></header>
    <section><h2>Goal and current context</h2><p>${escape(p.goal||'Goal not recorded')}</p><dl><dt>Allergies</dt><dd>${escape(context?.allergyStatus==='Reactions reported'?context.allergies:context?.allergyStatus??'Not reviewed')}</dd><dt>Latest report</dt><dd>${escape(p.dates.at(-1)||'Not recorded')}</dd><dt>Patient reports /10</dt><dd>Pain ${escape(p.pain.at(-1)??'Not recorded')} · Function ${escape(p.function.at(-1)??'Not recorded')} · Sleep ${escape(p.sleep.at(-1)??'Not recorded')}</dd></dl></section>
    <section><h2>Current medications and reported response</h2>${medications}</section>
    ${medicationDecisionsHtml((workspace.engineDecisions??[]).filter(item=>item.patientId===p.id))}
    <section><h2>Unresolved review items</h2>${list(reviews.map(r=>`${r.priority} · ${r.title}\n${r.detail}\nStatus: ${r.status}`))}</section>
    <section><h2>Latest saved care plan</h2><p>${escape(plan?.text||'No agreed care plan recorded.')}</p>${plan?`<p>Owner: ${escape(plan.owner)} · Follow-up: ${escape(plan.followup)} ${escape(plan.time)}</p><small>Saved by ${escape(plan.author)} · ${escape(plan.date)} · Plan ${escape(plan.id)}</small>`:''}</section>
    ${note?`<section><h2>Latest saved documentation</h2><p>${escape(note.text)}</p><small>${escape(note.type)} · ${escape(note.author)} · ${escape(note.date)}</small></section>`:''}
    <footer>Generated ${escape(generatedAt)} from the current TheraNetrix workspace. This copy has not been sent to an EHR and is not a signed encounter record. Review before adding it to the medical record. Updated copies replace earlier working copies.</footer></body></html>`;
}
