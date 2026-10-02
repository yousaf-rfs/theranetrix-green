import {applyCareOperations,careOperationsActionSchema,coverageAt} from './care-operations';
import {workflowBridgeId} from './clinical-flows/bridges';
import {applyDemoConnection,demoConnectionActionSchema} from './demo-connection';
import {z} from 'zod';
import {benefits,tolerabilities,medicationAdherence,normalizeWorkspace} from './medications';
import {featureEnabled,initials,pathwaySteps,type Workspace,type FeatureKey} from './theranetrix';
import {treatmentDirections,goalStatuses,treatmentCourse} from './treatment-review';
import {questionnaireReviewLabel} from './visit-presentation';
import {checkinKind} from './patient-checkin-note';
import {featureSchema,planningSchema,configurationSnapshot,defaultPlanning} from './configuration';
import {retainReviewTransition,retainTaskState} from './record-history';
import {buildEngineOutput,engineRecordRevision,advisorReply,engineVersion} from './engine-demo';
import {engineDecisionNote,markPrototypeLabel} from './engine-decision';
import {twinPreferencesSchema} from './patient-twin-settings';
import {dashboardLayoutSchema} from './dashboard-layout';
import {ensureShowcaseData,showcaseVersion} from './demo-showcase';
import {applyWorkflowAction,workflowApplyActionSchema,canonicalCommand} from './clinical-flows';
import {requireGovernedUse} from './clinical-flows/governance-runtime';
import {taskWorkflow} from './task-controls';
import {ADVISOR_EXCHANGE_LABEL,ADVISOR_SENDER} from './product-names';
import {nextSymptomChangeRule,ruleIsOn,symptomChangeThresholdsSchema,thresholdSummary} from './symptom-change-rule';
const text=z.string().trim().min(1).max(6000);
const patientId=z.string().min(1).max(100);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>!Number.isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s,'Invalid date');
export const actionSchema=z.discriminatedUnion('type',[
  workflowApplyActionSchema,
  demoConnectionActionSchema,
  careOperationsActionSchema,
  z.object({type:z.literal('patient.identity.update'),patientId,dateOfBirth:z.union([date,z.literal('')]),medicalRecordNumber:z.string().trim().max(100)}).strict(),
  z.object({type:z.literal('prototype.feedback.add'),path:z.string().min(1).max(2000).refine(s=>s.startsWith('/')&&!s.startsWith('//'),'Use a workspace route'),screen:text.max(150),priority:z.enum(['Must-have','Nice-to-have']),intent:z.enum(['Question','Change','Keep','Hide','Remove','Prioritize']),text:text.max(3000)}).strict(),
  z.object({type:z.literal('patient.language.set'),patientId,language:z.enum(['en','es'])}).strict(),
  z.object({type:z.literal('dashboard.save'),id:z.string().max(100).optional(),baseRevision:z.string().max(100),name:z.string().trim().min(1).max(80),layout:dashboardLayoutSchema}),
  z.object({type:z.literal('patient.twin.configure'),patientId,baseId:z.string().max(100),preferences:twinPreferencesSchema}),
  z.object({type:z.literal('engine.run'),patientId,expectedRevision:text.max(100),preferences:z.object({relief:z.number().int().min(0).max(100),alertness:z.number().int().min(0).max(100),routine:z.number().int().min(0).max(100)}).refine(v=>v.relief+v.alertness+v.routine>0,'Choose at least one priority.')}),
  // Optional structured copy of the choice. modelledDose is the example dose the scores assume, not a dosing suggestion; labelStatus is prototype label data.
  z.object({type:z.literal('engine.decide'),patientId,runId:text.max(100),candidateId:text.max(100),rationale:z.string().trim().max(2000),patientPlan:text.max(2000),owner:text.max(100),followup:date,action:z.enum(['accept','modify','reject']).optional(),optionId:text.max(100).optional(),optionName:text.max(150).optional(),modelledDose:text.max(200).optional(),labelStatus:text.max(400).optional(),priorTrials:z.array(z.object({name:text.max(100),stopReason:z.string().trim().max(1000)}).strict()).max(50).optional(),clinicianExclusions:z.array(z.object({name:text.max(150),reason:z.string().trim().max(500)}).strict()).max(50).optional()}),
  z.object({type:z.literal('advisor.chat'),patientId,requestId:z.string().min(1).max(200).optional(),text:text.max(2000),intent:z.enum(['progress','concern','plan','question']),concernUrgency:z.enum(['routine','urgent']).optional(),language:z.enum(['en','es']).optional(),audience:z.enum(['clinician','patient']).optional(),checkin:z.object({pain:z.number().int().min(0).max(10),function:z.number().int().min(0).max(10),sleep:z.number().int().min(0).max(10)}).optional()}),
  z.object({type:z.literal('patient.add'),name:text.max(100),dateOfBirth:date,condition:text.max(150),clinician:text.max(100),goal:text.max(500)}),
  z.object({type:z.literal('medication.save'),patientId,id:z.string().max(100).optional(),name:text.max(100),regimen:z.string().trim().max(200),indication:text.max(150),status:z.enum(['Active','Stopped']),started:z.union([date,z.literal('')]),benefit:z.enum(benefits),tolerability:z.enum(tolerabilities),adherence:z.enum(medicationAdherence),effects:z.string().trim().max(1000),reportedAt:date,regimenSince:z.union([date,z.literal('')]).optional(),stopped:z.union([date,z.literal('')]).optional(),stopReason:z.string().trim().max(1000).optional(),responseConfirmed:z.boolean().optional()}),
  z.object({type:z.literal('medication.none'),patientId}),
  z.object({type:z.literal('treatment.review'),patientId,expectedGoal:z.string().max(500).optional(),direction:z.enum(treatmentDirections),goalStatus:z.enum(goalStatuses),goalEvidence:z.string().trim().max(2000),decision:text.max(2000),monitoring:text.max(2000),options:z.array(z.object({title:text.max(150),status:z.enum(['For discussion','Agreed','Deferred']),rationale:text.max(1000),considerations:text.max(1000)})).max(4)}),
  z.object({type:z.literal('context.update'),patientId,allergyStatus:z.enum(['Not reviewed','None reported','Reactions reported']),allergies:z.string().trim().max(2000),medicalHistory:z.string().trim().max(3000),priorTreatments:z.string().trim().max(2000),painLocation:z.string().trim().max(500),painDuration:z.string().trim().max(200),physicalContext:z.string().trim().max(2000),psychologicalContext:z.string().trim().max(2000),socialContext:z.string().trim().max(2000),coordinator:z.string().trim().max(100),preferences:z.string().trim().max(1000)}),
  z.object({type:z.literal('plan.save'),patientId,text:text.max(2000),owner:text.max(100),followup:date,time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)}),
  z.object({type:z.literal('note.add'),patientId,text,typeLabel:z.enum(['Progress note','Care plan','Visit summary'])}),
  z.object({type:z.literal('goal.update'),patientId,goal:text.max(500)}),
  z.object({type:z.literal('checkin.add'),patientId,pain:z.number().int().min(0).max(10),sleep:z.number().int().min(0).max(10),function:z.number().int().min(0).max(10),note:z.string().trim().max(2000)}),
  z.object({type:z.literal('pathway.step'),patientId,step:z.enum(['intake','baseline','review','plan','followup']),complete:z.boolean()}),
  z.object({type:z.literal('pathway.enroll'),patientId}),
  z.object({type:z.literal('review.update'),id:text.max(100),status:z.enum(['Acknowledged','Resolved']),resolution:text}),
  z.object({type:z.literal('review.add'),patientId,title:text.max(150),detail:text,priority:z.enum(['High','Medium','Routine'])}),
  z.object({type:z.literal('questionnaire.review'),patientId,recordId:z.string().min(1).max(200),version:z.number().int().min(1)}).strict(),
  z.object({type:z.literal('message.send'),patientId,text,direction:z.enum(['in','out'])}),
  z.object({type:z.literal('patient.dose.log'),patientId,medicationId:z.string().min(1).max(100),status:z.enum(['taken','missed']),effects:z.string().trim().max(1000).optional()}),
  z.object({type:z.literal('advisor.request'),patientId,requestId:z.string().min(1).max(200).optional(),text,concernUrgency:z.enum(['routine','urgent']).optional()}),
  z.object({type:z.literal('task.add'),patientId,title:text.max(200),date,time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),taskType:z.enum(['Video visit','Phone call','Care coordination'])}),
  z.object({type:z.literal('task.toggle'),id:text.max(100),done:z.boolean()}),
  z.object({type:z.literal('configuration.save'),features:featureSchema,planning:planningSchema,baseConfigurationId:z.string().max(100).optional()}),
  z.object({type:z.literal('showcase.load')}),
  z.object({type:z.literal('symptom-rule.save'),thresholds:symptomChangeThresholdsSchema,clinician:text.max(100)}).strict(),
  z.object({type:z.literal('feature.toggle'),feature:z.enum(['reviewPrompts','assessments','digitalTwin','pst','shadow','advisor','pathways','messages']),enabled:z.boolean()}),
]);
export type Action=z.infer<typeof actionSchema>;
export function applyAction(w:Workspace,a:Action,actor:string,now=new Date().toISOString()):Workspace {
  const data:Workspace=normalizeWorkspace(structuredClone(w));
  const p='patientId' in a?data.patients.find(p=>p.id===a.patientId):undefined;
  if('patientId' in a&&a.patientId!==undefined&&!p)throw new Error('Patient not found.');
  const requireFeature=(key:FeatureKey)=>{if(!featureEnabled(data,key))throw new Error('This capability is currently turned off in workspace settings.');};
  const replayKey=(a.type==='advisor.chat'||a.type==='advisor.request')&&a.requestId?a.requestId:undefined;
  const replayFingerprint=replayKey?canonicalCommand({actor,action:a}):undefined;
  if(replayKey){requireFeature('advisor');const receipt=data.actionReceipts?.find(r=>r.id===replayKey);if(receipt){if(receipt.fingerprint!==replayFingerprint)throw new Error('This request ID was already used for a different action.');return data;}}
  function routeConcern(patient:NonNullable<typeof p>,concern:string,urgency:'routine'|'urgent'|undefined,requestId:string){
    const coverage=coverageAt(data,patient.id,now),owner=coverage?.owner.trim()||patient.clinicalContext?.coordinator.trim()||patient.clinician.trim();
    const encounterId=data.clinicalWorkflows?.slices.encounters.state.assessments.filter(r=>r.patientId===patient.id).at(-1)?.encounterId??patient.id+'-encounter';
    const command={type:'patient-coordination.handoff.save',requestId,patientId:patient.id,encounterId,concern,dedupeKey:requestId,priority:urgency==='urgent'?'high':'routine',urgencySourceType:'patient-request',urgencySource:urgency==='urgent'?'Patient requested urgent review; awaiting clinical triage':'Patient request; clinical urgency not yet assessed',responsibleTeam:'Care team',responsiblePerson:owner,coverageExpectation:coverage?`Accepted cover until ${coverage.endsAt} (${coverage.timezone})`:'Coverage not confirmed. Contact the usual service or its out-of-hours route.',fallbackOwner:coverage?.backup??patient.clinician,phase:'locally-saved',deliveryStatus:'pending',dueAt:coverage?.endsAt??now,deliveryEvidenceSource:'none',patientContactStatus:'not-attempted',transitionReason:'Patient concern recorded with original wording and an accountable review owner.'};
    const updated=applyWorkflowAction(data,{type:'workflow.apply',domain:'patient-coordination',patientId:patient.id,requestId,expectedSliceVersion:data.clinicalWorkflows!.slices['patient-coordination'].version,command},actor,now);
    Object.assign(data,updated);
    const handoff=data.clinicalWorkflows!.slices['patient-coordination'].state.handoffs.find(h=>h.dedupeKey===requestId)!;
    return {handoffId:handoff.id,reviewId:workflowBridgeId('handoff-review',patient.id,handoff.id)};
  }
  let label='';
  let affectedPatientId=p?.id;
  switch(a.type){
    case 'care.operations':return applyCareOperations(data,a,actor,now);
    case 'patient.identity.update':{
      if(a.dateOfBirth>now.slice(0,10))throw new Error('Date of birth cannot be in the future.');
      if(a.medicalRecordNumber&&data.patients.some(other=>other.id!==p!.id&&other.medicalRecordNumber?.toLowerCase()===a.medicalRecordNumber.toLowerCase()))throw new Error('That medical record number is already assigned to another patient.');
      if(a.dateOfBirth){
        const current=now.slice(0,10),age=Number(current.slice(0,4))-Number(a.dateOfBirth.slice(0,4))-(current.slice(5)<a.dateOfBirth.slice(5)?1:0);
        if(age<18||age>120)throw new Error('This workspace supports adult patients aged 18 to 120. Check the date of birth.');
        p!.age=age;
      }
      p!.identityHistory=[{dateOfBirth:p!.dateOfBirth??'',medicalRecordNumber:p!.medicalRecordNumber??'',date:now,actor},...(p!.identityHistory??[])];
      p!.dateOfBirth=a.dateOfBirth||undefined;p!.medicalRecordNumber=a.medicalRecordNumber||undefined;
      label='Updated recorded patient identifiers';break;
    }
    case 'prototype.feedback.add':{
      data.prototypeFeedback=[{id:crypto.randomUUID(),path:a.path,screen:a.screen,priority:a.priority,intent:a.intent,text:a.text,date:now,author:actor},...(data.prototypeFeedback??[])];
      label='Added prototype feedback: '+a.priority+' · '+a.screen;break;
    }
    case 'patient.language.set':p!.preferredLanguage=a.language;label='Updated preferred language';break;
    case 'demonstration.connection':return applyDemoConnection(data,a,actor,now);
    case 'workflow.apply':return applyWorkflowAction(data,a,actor,now);
    case 'dashboard.save':{
      const profiles=data.dashboardProfiles??[];
      const previous=a.id?profiles.find(profile=>profile.id===a.id):undefined;
      if(a.id&&!previous)throw new Error('Dashboard profile not found.');
      if((previous?.revision??'')!==a.baseRevision)throw new Error('This dashboard changed. Reopen customization to review the latest saved layout.');
      if(!previous&&profiles.length>=30)throw new Error('The workspace already has 30 dashboard profiles. Update an existing profile.');
      if(profiles.some(profile=>profile.id!==previous?.id&&profile.name.toLowerCase()===a.name.toLowerCase()))throw new Error('Choose a different name for this dashboard.');
      const profile={id:previous?.id??crypto.randomUUID(),name:a.name,layout:structuredClone(a.layout),revision:crypto.randomUUID(),updatedAt:now,updatedBy:actor};
      data.dashboardProfiles=previous?profiles.map(existing=>existing.id===profile.id?profile:existing):[...profiles,profile];
      label='Saved doctor dashboard: '+a.name;break;
    }
    case 'patient.twin.configure':{
      const previous=p!.twinPreferences;
      if(a.baseId!==(previous?.id??''))throw new Error('These settings changed in another session. Close and reopen the editor to review the latest settings.');
      const history=previous?(()=>{const {history:older,...revision}=previous;return [revision,...(older??[])];})():[];
      p!.twinPreferences={...a.preferences,measures:[...a.preferences.measures],id:crypto.randomUUID(),date:now,author:actor,history};
      label='Customized patient Digital Twin display';break;
    }
    case 'engine.run':{
      requireFeature('digitalTwin');
      const releaseRef=requireGovernedUse(data,'digitalTwin',now);
      for(const capability of ['pst','shadow'] as const)if(featureEnabled(data,capability))requireGovernedUse(data,capability,now,releaseRef);
      if(a.expectedRevision!==engineRecordRevision(p!,data))throw new Error('The patient record changed. Review the latest inputs before running again.');
      const output=buildEngineOutput(p!,data,a.preferences);
      data.engineRuns=[{...output,id:crypto.randomUUID(),date:now,actor,...(releaseRef?{releaseRef}:{})},...(data.engineRuns??[])];
      label='Ran Digital Twin / PST / Shadow engines: '+output.revision;break;
    }
    case 'engine.decide':{
      requireFeature('digitalTwin');
      if(!featureEnabled(data,'pst')&&!featureEnabled(data,'shadow'))throw new Error('Enable a comparison engine to record this decision.');
      const run=data.engineRuns?.find(r=>r.id===a.runId&&r.patientId===a.patientId);
      if(!run)throw new Error('Engine run not found for this patient.');
      requireGovernedUse(data,'digitalTwin',now,run.releaseRef);
      for(const capability of ['pst','shadow'] as const)if(featureEnabled(data,capability))requireGovernedUse(data,capability,now,run.releaseRef);
      if(run.revision!==engineRecordRevision(p!,data))throw new Error('New information arrived after this run. Re-run the engines and review the result before saving a decision.');
      if(data.engineDecisions?.some(d=>d.runId===run.id))throw new Error('A decision is already saved for this run. Run again for a new decision.');
      const candidate=run.candidates.find(c=>c.id===a.candidateId);
      if(!candidate)throw new Error('Choose a strategy from the displayed run.');
      if(a.followup<now.slice(0,10))throw new Error('Choose today or a future follow-up date.');
      const planId=crypto.randomUUID(),id=crypto.randomUUID();
      const labelStatus=a.labelStatus&&markPrototypeLabel(a.labelStatus);
      const details={...(a.action?{action:a.action}:{}),...(a.optionId?{optionId:a.optionId}:{}),...(a.optionName?{optionName:a.optionName}:{}),...(a.modelledDose?{modelledDose:a.modelledDose}:{}),...(labelStatus?{labelStatus}:{}),...(a.priorTrials?{priorTrials:a.priorTrials}:{}),...(a.clinicianExclusions?{clinicianExclusions:a.clinicianExclusions}:{})};
      const decision={id,runId:run.id,patientId:p!.id,candidateId:candidate.id,title:candidate.title,rationale:a.rationale,patientPlan:a.patientPlan,owner:a.owner,followup:a.followup,date:now,actor,planId,...details};
      data.engineDecisions=[decision,...(data.engineDecisions??[])];
      const oldPlan=p!.carePlans[0];
      p!.carePlans.unshift({id:planId,date:now,author:actor,text:a.patientPlan,owner:a.owner,followup:a.followup,time:'09:00',...(oldPlan?{supersedes:oldPlan.id}:{})});
      p!.notes.unshift({id:crypto.randomUUID(),date:now,author:actor,type:'Engine review',text:engineDecisionNote(decision,run)});
      const taskId='medication-followup-'+p!.id,task=data.tasks.find(t=>t.id===taskId);
      if(task)retainTaskState(task,actor,now,'Follow-up updated after engine review',oldPlan?.id);
      const fields={id:taskId,patientId:p!.id,title:'Treatment review',owner:a.owner,date:a.followup,time:'09:00',type:task?.type??'Care coordination',done:false,planId};
      if(task)Object.assign(task,fields);else data.tasks.push(fields);
      label='Saved clinician decision against engine run '+run.id;break;
    }
    case 'advisor.chat':{
      requireFeature('advisor');if(a.checkin)requireFeature('assessments');
      const worsening=!!a.checkin&&((p!.pain.at(-1)!<a.checkin.pain)||(p!.function.at(-1)!>a.checkin.function));
      const medicationQuestion=/\b(dose|dosage|refill|prescription)\b|(?:change|stop|increase|decrease|double).{0,40}(?:medication|medicine|drug)/i.test(a.text);
      const intent=worsening?'concern':medicationQuestion?'question':a.intent;
      const audience=a.audience??'patient';
      const response=advisorReply(p!,data,intent,a.text,a.concernUrgency,a.language,audience);
      const id=crypto.randomUUID(),needsReview=audience!=='clinician'&&(intent==='concern'||intent==='question'||a.concernUrgency==='urgent');
      const routed=needsReview?routeConcern(p!,a.text,a.concernUrgency,a.requestId??id):undefined,reviewId=routed?.reviewId;
      const currentPatient=data.patients.find(patient=>patient.id===p!.id)!;
      let checkinId:string|undefined;
      if(a.checkin){checkinId=crypto.randomUUID();if(!currentPatient.pain.length)currentPatient.baseline=a.checkin.pain;currentPatient.checkins.unshift({id:checkinId,date:now,...a.checkin,note:a.text,source:'Patient self-report'});currentPatient.pain.push(a.checkin.pain);currentPatient.function.push(a.checkin.function);currentPatient.sleep.push(a.checkin.sleep);currentPatient.dates.push(now.slice(0,10));}
      const reply=response.reply+(a.checkin?((a.language??currentPatient.preferredLanguage)==='es'?' También se guardaron tus respuestas confirmadas sobre dolor, función y sueño.':' Your confirmed pain, function, and sleep check-in has also been saved.'):'');
      const run=data.engineRuns?.find(r=>r.patientId===currentPatient.id);
      data.advisorTurns=[...(data.advisorTurns??[]),{id,patientId:currentPatient.id,date:now,patientText:a.text,reply,summary:response.summary,intent,audience,runId:run?.id,reviewId,checkinId,handoffId:routed?.handoffId}];
      if(audience!=='clinician')data.messages.push({id:crypto.randomUUID(),patientId:currentPatient.id,date:now,text:a.text,sender:currentPatient.name,direction:'in'},{id:crypto.randomUUID(),patientId:currentPatient.id,date:now,text:reply,sender:ADVISOR_SENDER,direction:'out'});
      if(audience!=='clinician'&&(a.checkin||reviewId)){currentPatient.recordReviewRequiredSince=now;currentPatient.status='Needs review';}
      label=ADVISOR_EXCHANGE_LABEL+(reviewId?' and care-team handoff':'')+(checkinId?' with confirmed check-in':'');break;
    }
    case 'patient.add':{
      // Age is derived from the recorded date of birth, never entered separately.
      const today=now.slice(0,10),age=Number(today.slice(0,4))-Number(a.dateOfBirth.slice(0,4))-(today.slice(5)<a.dateOfBirth.slice(5)?1:0);
      if(a.dateOfBirth>today)throw new Error('Date of birth cannot be in the future.');
      if(age<18||age>120)throw new Error('This workspace supports adult patients aged 18 to 120. Check the date of birth.');
      if(data.patients.some(existing=>existing.name.trim().toLowerCase()===a.name.trim().toLowerCase()&&existing.dateOfBirth===a.dateOfBirth))throw new Error('A patient with this name and date of birth already exists. Open Patient identity review to check the existing chart before creating another.');
      const id='TN-'+crypto.randomUUID().slice(0,8).toUpperCase();affectedPatientId=id;
      data.patients.unshift({id,name:a.name,initials:initials(a.name),age,dateOfBirth:a.dateOfBirth,pronouns:'Not recorded',condition:a.condition,clinician:a.clinician,goal:a.goal,color:'#e1f1e9',enrolled:now.slice(0,10),stage:'Intake',status:'Monitoring',nextVisit:'',baseline:0,pain:[],sleep:[],function:[],dates:[],adherence:0,completed:[],pathway:'',notes:[],checkins:[],medications:[],carePlans:[]});label='Added sample patient '+a.name;break;
    }
    case 'medication.save':{
      if(a.reportedAt>now.slice(0,10))throw new Error('The response date cannot be in the future.');
      if(a.started&&a.started>a.reportedAt)throw new Error('The start date cannot be after the response date.');
      if(a.tolerability==='Effects reported'&&!a.effects)throw new Error('Describe the reported side effects.');
      const existing=a.id?p!.medications.find(m=>m.id===a.id):undefined;
      if(a.id&&!existing)throw new Error('Medication entry not found for this patient.');
      if(existing&&existing.name!==a.name)throw new Error('Add a new medication record for a different medication name.');
      if(existing&&existing.regimen!==a.regimen&&(a.benefit!=='Not assessed'||a.tolerability!=='Not assessed'||a.adherence!=='Not assessed')&&!a.responseConfirmed)throw new Error('Confirm that the responses apply to the updated regimen.');
      const regimenSince=a.regimenSince??(existing?.regimen===a.regimen?existing?.regimenSince:'')??'';
      const stopped=a.status==='Stopped'?(a.stopped??existing?.stopped??''):'';
      const stopReason=a.status==='Stopped'?(a.stopReason??existing?.stopReason??''):'';
      if(regimenSince&&(regimenSince>a.reportedAt||(a.started&&regimenSince<a.started)))throw new Error('The regimen date must be between treatment start and the response date.');
      if(stopped&&(stopped>now.slice(0,10)||(a.started&&stopped<a.started)||(regimenSince&&stopped<regimenSince)))throw new Error('The stop date must follow treatment start and regimen date, and cannot be in the future.');
      const {type,patientId,id,responseConfirmed,...fields}=a;
      const report={benefit:a.benefit,tolerability:a.tolerability,adherence:a.adherence,effects:a.tolerability==='Effects reported'?a.effects:'',reportedAt:a.reportedAt};
      const priorHistory=existing?(existing.history.length?existing.history.map((h,i)=>i===0&&h.date===existing.reviewedAt&&h.reportedAt===existing.reportedAt&&h.regimen===existing.regimen&&h.status===existing.status?{...h,started:h.started??existing.started,indication:h.indication??existing.indication}:h):[{benefit:existing.benefit,tolerability:existing.tolerability,adherence:existing.adherence,effects:existing.effects,reportedAt:existing.reportedAt,date:existing.reviewedAt||existing.reportedAt,author:existing.reviewedBy||existing.source,name:existing.name,regimen:existing.regimen,status:existing.status,started:existing.started,indication:existing.indication,regimenSince:existing.regimenSince,stopped:existing.stopped,stopReason:existing.stopReason}]):[];
      const medication={...fields,...report,regimenSince,stopped,stopReason,id:existing?.id??crypto.randomUUID(),source:'Clinician entry' as const,reviewedAt:now,reviewedBy:actor,history:[{...report,date:now,author:actor,name:a.name,regimen:a.regimen,status:a.status,started:a.started,indication:a.indication,regimenSince,stopped,stopReason},...priorHistory]};
      if(existing)p!.medications[p!.medications.indexOf(existing)]=medication;else p!.medications.push(medication);
      if(p!.medications.some(m=>m.status==='Active'))delete p!.medicationReconciliation;
      label='Reviewed medication record: '+a.name;break;
    }
    case 'medication.none':{
      if(p!.medications.some(m=>m.status==='Active'))throw new Error('Review the active entries before confirming no current medications.');
      p!.medicationReconciliation={date:now,author:actor,none:true};
      label='Confirmed no current medications reported';break;
    }
    case 'treatment.review':{
      if(a.expectedGoal!==undefined&&a.expectedGoal!==p!.goal)throw new Error('The patient goal changed. Reopen the treatment review and reassess the current goal.');
      if(a.goalStatus!=='Not assessed'&&!a.goalEvidence)throw new Error('Record the patient evidence for the goal assessment.');
      const {type,patientId,expectedGoal,...fields}=a,previous=p!.treatmentReview;
      const history=previous?[(({history,...record})=>record)(previous),...previous.history]:[];
      p!.treatmentReview={...fields,goalAtReview:p!.goal,date:now,author:actor,history};
      p!.notes.unshift({id:crypto.randomUUID(),date:now,author:actor,type:'Treatment review',text:fields.direction+'\nGoal: '+fields.goalStatus+'\n'+fields.goalEvidence+'\nDecision: '+fields.decision+'\nMonitoring: '+fields.monitoring});
      label='Recorded treatment direction and goal progress';break;
    }
    case 'context.update':{
      if(a.allergyStatus==='Reactions reported'&&!a.allergies)throw new Error('Record the reported allergen and reaction.');
      const {type,patientId,...fields}=a;
      const previous=p!.clinicalContext;
      const history=previous?[(({history,...record})=>record)(previous),...previous.history]:[];
      p!.clinicalContext={...fields,allergies:a.allergyStatus==='Reactions reported'?a.allergies:'',date:now,author:actor,history};
      label='Updated clinical context and allergy review';break;
    }
    case 'plan.save':{
      if(a.followup<now.slice(0,10))throw new Error('Choose today or a future follow-up date.');
      const previousPlan=p!.carePlans[0];
      p!.carePlans.unshift({id:crypto.randomUUID(),text:a.text,owner:a.owner,followup:a.followup,time:a.time,date:now,author:actor,...(previousPlan?{supersedes:previousPlan.id}:{})});
      p!.notes.unshift({id:crypto.randomUUID(),date:now,author:actor,type:'Care plan',text:a.text+'\nFollow-up: '+a.followup+' at '+a.time+' · Owner: '+a.owner});
      const followupId='medication-followup-'+p!.id;
      const task=data.tasks.find(t=>t.id===followupId);
      if(task)retainTaskState(task,actor,now,'Follow-up updated',previousPlan?.id);
      const fields={planId:p!.carePlans[0].id,patientId:p!.id,title:'Treatment review',owner:a.owner,date:a.followup,time:a.time,type:task?.type??'Care coordination',done:false};
      if(task)Object.assign(task,fields);else data.tasks.push({id:followupId,...fields});
      label='Recorded clinician plan and follow-up';break;
    }
    case 'note.add':p!.notes.unshift({id:crypto.randomUUID(),date:now,author:actor,text:a.text,type:a.typeLabel});label='Saved '+a.typeLabel.toLowerCase();break;
    case 'goal.update':p!.goal=a.goal;label='Updated patient goal';break;
    case 'checkin.add':{
      requireFeature('assessments');
      if(!p!.pain.length)p!.baseline=a.pain;
      p!.checkins.unshift({id:crypto.randomUUID(),date:now,pain:a.pain,sleep:a.sleep,function:a.function,note:a.note,source:'Patient self-report'});
      p!.pain.push(a.pain);p!.sleep.push(a.sleep);p!.function.push(a.function);p!.dates.push(now.slice(0,10));
      label='Recorded patient check-in';break;
    }
    case 'pathway.enroll':requireFeature('pathways');if(p!.pathway)throw new Error('This patient is already enrolled.');p!.pathway='Chronic pain follow-up';p!.stage='Intake';p!.completed=[];label='Enrolled in sample care pathway';break;
    case 'pathway.step':{
      requireFeature('pathways');if(!p!.pathway)throw new Error('Enroll this patient in a pathway first.');
      p!.completed=a.complete?Array.from(new Set([...p!.completed,a.step])):p!.completed.filter(s=>s!==a.step);
      p!.stage=pathwaySteps.find(s=>!p!.completed.includes(s.id))?.stage??'Completed';
      label=(a.complete?'Completed: ':'Reopened: ')+pathwaySteps.find(s=>s.id===a.step)!.title;break;
    }
    case 'review.update':{
      const r=data.reviews.find(r=>r.id===a.id);if(!r)throw new Error('Review item not found.');
      const handoff=data.clinicalWorkflows?.slices['patient-coordination'].state.handoffs.find(item=>item.id===r.workflowRecordId);
      if(handoff&&a.status==='Resolved'&&handoff.phase!=='closed')throw new Error('Complete the handoff action and patient response before resolving this review. Open Patient coordination to finish the handoff.');
      const recall=data.clinicalWorkflows?.slices['program-governance'].state.recalls.find(item=>item.id===r.workflowRecordId);
      if(recall&&a.status==='Resolved'&&recall.impacts.some(impact=>impact.patientId===r.patientId&&impact.disposition==='pending'))throw new Error('Review each affected output in Program governance before resolving this recall.');
      retainReviewTransition(r,a.status,a.resolution,actor,now);label=a.status+' review: '+r.title;break;
    }
    case 'review.add':data.reviews.unshift({id:crypto.randomUUID(),patientId:a.patientId,title:a.title,detail:a.detail,priority:a.priority,status:'Open',source:'Clinician escalation',created:now});p!.status='Needs review';label='Created escalation: '+a.title;break;
    case 'questionnaire.review':{
      // Records who reviewed which version of the patient's answers, and when (the audit entry below).
      // The answers themselves, the review flag and saved engine runs are left unchanged.
      const record=data.clinicalWorkflows?.slices.encounters.state.observations.find(r=>r.id===a.recordId&&r.patientId===p!.id);
      if(!record||record.status!=='confirmed'||record.submissionSource!=='patient-self-report')throw new Error('Questionnaire not found for this patient.');
      if(checkinKind(record)!=='previsit')throw new Error('Only a pre-visit questionnaire can be marked reviewed. Daily check-ins and check-ins without a recorded type stay in the patient trajectory.');
      if(record.version!==a.version)throw new Error('These answers changed. Review the latest questionnaire before marking it reviewed.');
      label=questionnaireReviewLabel(record);break;
    }
    case 'message.send':requireFeature('messages');data.messages.push({id:crypto.randomUUID(),patientId:a.patientId,text:a.text,date:now,sender:a.direction==='in'?p!.name:actor,direction:a.direction});label=a.direction==='in'?'Added patient companion message':'Saved care-team message';break;
    case 'patient.dose.log':{
      const med=p!.medications.find(m=>m.id===a.medicationId);
      if(!med)throw new Error('Medication not found for this patient.');
      p!.doseLogs=[{id:crypto.randomUUID(),date:now,medicationId:med.id,name:med.name,status:a.status,effects:a.effects??''},...(p!.doseLogs??[])];
      if(a.status==='missed')med.adherence='Missed doses';
      if(a.effects){med.tolerability='Effects reported';med.effects=a.effects;med.reportedAt=now.slice(0,10);}
      p!.status='Needs review';
      label=a.status==='taken'?'Logged dose as taken':'Logged a missed dose';
      break;
    }
    case 'advisor.request':{requireFeature('advisor');routeConcern(p!,a.text,a.concernUrgency,a.requestId??crypto.randomUUID());data.messages.push({id:crypto.randomUUID(),patientId:a.patientId,text:a.text,date:now,sender:p!.name,direction:'in'});data.patients.find(patient=>patient.id===a.patientId)!.status='Needs review';label='Requested care-team review from patient companion';break;}
    case 'task.add':data.tasks.push({id:crypto.randomUUID(),patientId:a.patientId,title:a.title,date:a.date,time:a.time,type:a.taskType,done:false});label='Scheduled '+a.title.toLowerCase();break;
    case 'task.toggle':{const task=data.tasks.find(t=>t.id===a.id);if(!task)throw new Error('Task not found.');if(taskWorkflow(data,task))throw new Error('Update this activity in its linked clinical workflow so the required review and evidence are retained.');retainTaskState(task,actor,now,a.done?'Activity completed':'Activity reopened',task.id==='medication-followup-'+task.patientId?data.patients.find(p=>p.id===task.patientId)?.carePlans[0]?.id:undefined);task.done=a.done;label=(a.done?'Completed: ':'Reopened: ')+task.title;break;}
    case 'showcase.load':{
      if((data.showcaseVersion??0)>=showcaseVersion)throw new Error('The program records are already loaded in this workspace.');
      ensureShowcaseData(data,actor,now);
      label='Loaded program records';break;
    }
    case 'configuration.save':{
      if(a.baseConfigurationId!==undefined&&a.baseConfigurationId!==(data.configurationHistory?.[0]?.id??''))throw new Error('The saved configuration changed. Reset to saved, review the latest choices, and apply your changes again.');
      data.features=a.features;data.planning=a.planning;
      const snapshot=configurationSnapshot(data.features,data.planning,actor,now,'Saved feature configuration and FDA planning assumptions');
      data.configurationHistory=[snapshot,...(data.configurationHistory??[])];label='Saved feature configuration and FDA planning: '+snapshot.id;break;
    }
    case 'symptom-rule.save':{
      // Clinician-owned thresholds for the rule-based review flag. Earlier settings stay in the rule history.
      data.symptomChangeRule=nextSymptomChangeRule(data.symptomChangeRule,a.thresholds,a.clinician,actor,now);
      label=ruleIsOn(a.thresholds)?'Set symptom-change review rule: '+thresholdSummary(a.thresholds):'Turned off symptom-change review rule';break;
    }
    case 'feature.toggle':{
      data.features[a.feature]=a.enabled;label=(a.enabled?'Enabled ':'Disabled ')+a.feature;
      data.configurationHistory=[configurationSnapshot(data.features,data.planning??defaultPlanning(),actor,now,label),...(data.configurationHistory??[])];break;
    }
  }
  const reviewPatient=a.type==='review.update'?data.reviews.find(r=>r.id===a.id)?.patientId:undefined;
  if(reviewPatient){const patient=data.patients.find(p=>p.id===reviewPatient);if(patient)patient.status=data.reviews.some(r=>r.patientId===reviewPatient&&r.status!=='Resolved')?'Needs review':'Monitoring';}
  if(a.type==='task.add'||a.type==='task.toggle'||a.type==='plan.save'||a.type==='engine.decide'){const changedId=a.type==='task.toggle'?data.tasks.find(t=>t.id===a.id)!.patientId:a.patientId;affectedPatientId=changedId;const changed=data.patients.find(p=>p.id===changedId)!;changed.nextVisit=data.tasks.filter(t=>t.patientId===changedId&&!t.done&&t.date>=now.slice(0,10)&&t.type!=='Care coordination').sort((x,y)=>(x.date+x.time).localeCompare(y.date+y.time))[0]?.date??'';}
  const affected=a.type==='patient.twin.configure'?undefined:data.patients.find(patient=>patient.id===(affectedPatientId??reviewPatient));
  if(affected){
    if(a.type==='medication.save'||a.type==='checkin.add'||a.type==='context.update'||a.type==='goal.update'||a.type==='medication.none')affected.recordReviewRequiredSince=now;
    if(a.type==='treatment.review')delete affected.recordReviewRequiredSince;
    if(affected.recordReviewRequiredSince)affected.status='Needs review';
  }
  if(affected?.treatmentReview){const course=treatmentCourse(affected,data);if(course.needsRecheck||data.reviews.some(r=>r.patientId===affected.id&&r.status!=='Resolved'))affected.status='Needs review';else if(a.type==='treatment.review')affected.status=course.direction==='Monitoring benefit'?'On track':'Monitoring';}
  if(replayKey)data.actionReceipts=[...(data.actionReceipts??[]),{id:replayKey,fingerprint:replayFingerprint!}].slice(-200);
  data.audit.unshift({id:crypto.randomUUID(),date:now,actor,action:label,patientId:affectedPatientId??reviewPatient});
  return data;
}
