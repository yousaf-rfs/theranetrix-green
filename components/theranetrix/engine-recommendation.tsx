'use client';
import type {EngineOutput,AdvisorTurn} from '@/lib/engine-demo';
import type {Patient,Workspace} from '@/lib/theranetrix';
import {RecommendationDetails} from './recommendation-details';
import {ADVISOR_SUMMARY_LABEL} from '@/lib/product-names';

export function engineSources(output:EngineOutput){
  const base='/patients/'+encodeURIComponent(output.patientId);
  return output.sources.map(source=>({...source,href:base+(source.label==='Patient goal'?'?tab=visit#patient-goal':source.label==='Latest observations'?'?tab=twin':source.label===ADVISOR_SUMMARY_LABEL?'?tab=visit':'?tab=visit#patient-medications')}));
}
export function EngineRecommendation({output,candidateId,title,label}:{output:EngineOutput;candidateId?:string;title?:string;label?:string}){
  const candidate=output.candidates.find(item=>item.id===candidateId);
  return <RecommendationDetails title={title??candidate?.title??'Engine review basis'} label={label} summary={candidate?.reason??output.summary}
    rationale={candidate?[candidate.reason,`PST ${candidate.pstScore}/100; Shadow ${candidate.shadowScore}/100. These are rule-based priority scores, not probabilities of benefit.`,`Assumed strategy profile: benefit ${candidate.benefit}/10, burden ${candidate.burden}/10, routine fit ${candidate.routine}/10.`,`Applied priorities: pain relief ${output.preferences.relief}, alertness ${output.preferences.alertness}, routine ${output.preferences.routine}.`,...output.signals]:[output.summary,...output.signals]}
    sources={engineSources(output)} considerations={[...(candidate?[candidate.watch]:[]),...output.gaps]}
    alternatives={output.candidates.filter(item=>item.id!==candidateId).map(item=>`${item.title}: PST ${item.pstScore}/100; Shadow ${item.shadowScore}/100. ${item.reason} ${item.watch}`)}
    limitations={[`Rule version: ${output.version}. Record revision: ${output.revision}.`,...output.basis,'Source links open the current record. A saved snapshot preserves the excerpts shown here; the linked record may have changed.','The goal source date is the recorded context or enrollment date, not a verified date of goal entry.']}/>;
}
export function AdvisorAnswerDetails({turn,p,data}:{turn:AdvisorTurn;p:Patient;data:Workspace}){
  const snapshot=turn.runId?data.engineRuns?.find(run=>run.id===turn.runId&&run.patientId===p.id):undefined;
  const base='/patients/'+encodeURIComponent(p.id);
  return <RecommendationDetails label="Reason & sources" title="Why the Advisor gave this answer" summary={turn.summary}
    rationale={[`Saved question: ${turn.patientText}`,`Saved response: ${turn.reply}`,turn.reviewId?'This conversation created a care-team review. It did not change medication.':'This answer does not record a clinician decision or change medication.']}
    sources={[{label:'Saved conversation',value:turn.summary,date:turn.date},...(snapshot?engineSources(snapshot):[]),{label:'Current patient record',value:'Open the current observations, medications, goal, and plan. Current content may differ from the record at the time of this answer.',href:base+'?tab=visit'},...(turn.reviewId?[{label:'Care-team review',value:turn.reviewId,href:'/review-queue?patient='+encodeURIComponent(p.id)}]:[])]}
    considerations={snapshot?.gaps??[]} alternatives={['Open the source record to verify the answer before deciding.','Use the treatment comparison and record your own clinical rationale.']}
    limitations={[snapshot?'The linked engine snapshot preserves its own source excerpts. The Advisor does not retain a complete snapshot of all plan and medication fields used in its answer.':'No complete source snapshot is attached to this conversation. The exact historical inputs cannot be reconstructed from current records.','Responses use prototype record rules. They are not retrieved clinical guidance or a validated treatment recommendation.']}/>;
}
