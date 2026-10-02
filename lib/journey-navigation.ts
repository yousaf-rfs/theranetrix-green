import { ADVISOR_NAME } from './product-names';
/** Navigation only. This register does not implement or certify clinical services. */
export type Screen = 'record' | 'visit' | 'treatment' | 'twin' | 'pst' | 'shadow' | 'advisor' | 'evidence' | 'trace' | 'notes' | 'pathway' | 'outcomes' | 'companion' | 'queue' | 'messages' | 'schedule' | 'integrations' | 'settings' | 'access';
export type Readiness = 'existing-views' | 'extension-needed' | 'partner-needed';
export type Journey = { id: string; title: string; category: string; suggestedPatient: string; requiresPatient: boolean; readiness: Readiness; question: string; screens: readonly Screen[] };
export type JourneyPatient = { id: string; name: string };
export const readinessLabels: Record<Readiness, string> = {
  'existing-views': 'Explore existing views',
  'extension-needed': 'Workflow extension needed',
  'partner-needed': 'Partner or governed service needed',
};
export const screenLabels: Record<Screen, string> = {
  record: 'Patient synopsis', visit: 'Encounter review', treatment: 'Medication and treatment review', twin: 'Digital Twin', pst: 'PST comparison', shadow: 'Shadow review', advisor: ADVISOR_NAME, evidence: 'Sources and evidence readiness', trace: 'Saved decisions', notes: 'Documentation and plans', pathway: 'Patient care pathway', outcomes: 'Observation history', companion: 'Patient companion', queue: 'Patient review queue', messages: 'Patient messages', schedule: 'Schedule (all patients)', integrations: 'Integration status', settings: 'Workspace settings', access: 'Account and access',
};
function journey(id: string, title: string, category: string, suggestedPatient: string, readiness: Readiness, question: string, screens: readonly Screen[], requiresPatient = true): Journey {
  return { id, title, category, suggestedPatient, readiness, question, screens, requiresPatient };
}
export const journeys: readonly Journey[] = [
  journey('J01', 'Prepare the clinic and next visit', 'Preparation', '', 'extension-needed', 'What changed, what needs review, and who prepared the record?', ['record', 'evidence', 'visit']),
  journey('J02', 'Enroll a new patient', 'Preparation', 'Johnny', 'partner-needed', 'Is intake complete and is the baseline ready for review?', ['record', 'companion', 'outcomes', 'pathway']),
  journey('J03', 'Reconcile missing or conflicting information', 'Preparation', 'Robert Chen', 'existing-views', 'What is confirmed, unknown, or still disputed?', ['record', 'treatment', 'evidence', 'visit']),
  journey('J04', 'Review treatment experience', 'Clinical encounters', 'Emma Carter', 'existing-views', 'Does reported benefit outweigh the difficulties for this patient?', ['visit', 'treatment', 'evidence', 'notes', 'companion']),
  journey('J05', 'Understand progress through the Digital Twin', 'Clinical encounters', 'Lucas Hayes', 'existing-views', 'What changed in pain, function, sleep, and the patient goal?', ['twin', 'outcomes', 'evidence', 'visit', 'notes']),
  journey('J06', 'Compare options and patient priorities', 'Clinical encounters', 'Maya', 'partner-needed', 'Which suitable options fit the patient priorities, and what is their basis?', ['visit', 'pst', 'evidence', 'trace', 'notes']),
  journey('J07', 'Review PST and Shadow differences', 'Clinical encounters', 'Emma Carter', 'partner-needed', 'What differs, why does it differ, and what does the clinician decide?', ['pst', 'shadow', 'evidence', 'notes', 'trace']),
  journey('J08', 'Assess a new or unexplained problem', 'Clinical encounters', 'David Anderson', 'extension-needed', 'What supports the working assessment and what remains uncertain?', ['visit', 'record', 'evidence', 'notes', 'schedule']),
  journey('J09', 'Support the patient between visits', 'Between visits', 'Elena Rodriguez', 'partner-needed', 'Does the conversation stay grounded in the saved plan?', ['companion', 'advisor', 'outcomes', 'messages']),
  journey('J10', 'Carry a concern through human resolution', 'Between visits', 'Elena Rodriguez', 'partner-needed', 'Who received the concern, acted on it, and replied to the patient?', ['advisor', 'queue', 'visit', 'messages', 'notes']),
  journey('J11', 'Collect assessments and check-ins', 'Between visits', 'Priya Raman', 'partner-needed', 'Are new measurements deliberate, dated, and distinct from missing answers?', ['companion', 'outcomes', 'twin', 'queue']),
  journey('J12', 'Reconcile external observations', 'Between visits', 'Johnny', 'partner-needed', 'Did the right source update the right patient without duplicates?', ['integrations', 'evidence', 'outcomes', 'twin']),
  journey('J13', 'Support language, accessibility, and caregivers', 'Between visits', 'Maria', 'partner-needed', 'Can the patient complete the same journey with equivalent meaning?', ['companion', 'access', 'advisor', 'messages']),
  journey('J14', 'Agree the plan and next actions', 'Care completion', 'Emma Carter', 'extension-needed', 'Do the clinician record, patient instructions, and responsibilities agree?', ['visit', 'notes', 'schedule', 'companion', 'trace']),
  journey('J15', 'Execute the care pathway', 'Care completion', 'Emma Carter', 'partner-needed', 'What is the current step, its prerequisite, and the next owned action?', ['pathway', 'outcomes', 'schedule', 'companion']),
  journey('J16', 'Book and recover missed care', 'Care completion', 'Johnny', 'partner-needed', 'Is care booked, overdue, or still waiting for a response?', ['schedule', 'messages', 'queue', 'pathway']),
  journey('J17', 'Review the episode and goals', 'Care completion', 'Lucas Hayes', 'extension-needed', 'Should care continue, change, transfer, or close?', ['outcomes', 'treatment', 'visit', 'pathway', 'notes']),
  journey('J18', 'Reconstruct a decision', 'Trust and continuity', 'Sarah Mitchell', 'extension-needed', 'Can we distinguish what was reviewed then from what is known now?', ['trace', 'evidence', 'notes']),
  journey('J19', 'Launch from the EHR and confirm write-back', 'Trust and continuity', '', 'partner-needed', 'Is patient context correct and was external write-back acknowledged?', ['integrations', 'visit', 'notes', 'trace']),
  journey('J20', 'Recover interrupted or stale work', 'Trust and continuity', '', 'extension-needed', 'Can work resume without a lost draft, silent overwrite, or stale acceptance?', ['visit', 'evidence', 'trace', 'integrations']),
  journey('J21', 'Manage access, consent, and proxies', 'Program operations', '', 'partner-needed', 'Who is authorized, for which patient and purpose?', ['access', 'settings'], false),
  journey('J22', 'Configure the existing dashboard and program', 'Program operations', '', 'existing-views', 'Can the view adapt while preserving essential safety information?', ['settings', 'access'], false),
  journey('J23', 'Author and publish a clinical pathway', 'Program operations', '', 'partner-needed', 'Which reviewed protocol version is approved for execution?', ['settings', 'integrations'], false),
  journey('J24', 'Curate evidence and clinical content', 'Program operations', '', 'partner-needed', 'Are the source, applicability, rights, and review date established?', ['settings', 'integrations'], false),
  journey('J25', 'Govern model and software releases', 'Program operations', '', 'partner-needed', 'What evidence permits this exact release and how can it be rolled back?', ['settings', 'integrations'], false),
  journey('J26', 'Operate securely and recover incidents', 'Program operations', '', 'partner-needed', 'Are responsibility, access history, and recovery evidence available?', ['access', 'integrations', 'settings'], false),
  journey('J27', 'Review monitoring-service documentation', 'Program operations', '', 'partner-needed', 'What actual service evidence supports the authorized review?', ['settings', 'integrations'], false),
  journey('J28', 'Approve the exact release', 'Program operations', '', 'partner-needed', 'Which functions and obligations are approved, pending, or excluded?', ['settings', 'integrations'], false),
  journey('J29', 'Track tests through result action', 'Care completion', 'David Anderson', 'extension-needed', 'Was the result reviewed, acted on, and communicated, or is it overdue?', ['notes', 'queue', 'evidence', 'messages', 'trace']),
  journey('J30', 'Close the specialist referral loop', 'Care completion', 'Johnny', 'extension-needed', 'Did specialist advice return and become part of the agreed plan?', ['notes', 'schedule', 'messages', 'pathway', 'trace']),
  journey('J31', 'Track medication authorization, access, and use', 'Care completion', 'Emma Carter', 'extension-needed', 'Was treatment merely agreed, dispensed, actually started, or stopped?', ['treatment', 'notes', 'queue', 'companion', 'trace']),
  journey('J32', 'Resolve access barriers', 'Care completion', 'Maya', 'extension-needed', 'Can the patient obtain the agreed care, and who is addressing the barrier?', ['visit', 'notes', 'queue', 'messages', 'pathway']),
  journey('J33', 'Reconcile transitions and covering responsibility', 'Trust and continuity', 'Elena Rodriguez', 'extension-needed', 'What changed elsewhere and who accepted follow-up responsibility?', ['record', 'treatment', 'queue', 'notes', 'trace']),
  journey('J34', 'Coordinate multidisciplinary care', 'Care completion', 'Lucas Hayes', 'extension-needed', 'Which people and interventions support the functional goal?', ['visit', 'pathway', 'schedule', 'outcomes', 'notes']),
];
export const chapters: readonly { id: string; title: string; journeys: readonly string[] }[] = [
  { id: 'D01', title: 'Get ready for the visit', journeys: ['J01', 'J03'] },
  { id: 'D02', title: 'Emma: medication experience', journeys: ['J04', 'J14', 'J09'] },
  { id: 'D03', title: 'Lucas: Digital Twin progress', journeys: ['J05', 'J17', 'J14'] },
  { id: 'D04', title: 'Patient priorities and PST', journeys: ['J06', 'J14'] },
  { id: 'D05', title: 'Shadow and evidence', journeys: ['J07', 'J18'] },
  { id: 'D06', title: 'Elena: concern to clinical action', journeys: ['J09', 'J10', 'J04', 'J14'] },
  { id: 'D07', title: 'New patient into longitudinal care', journeys: ['J02', 'J11', 'J12', 'J15', 'J16'] },
  { id: 'D08', title: 'Accessible language and proxy access', journeys: ['J13', 'J21', 'J11', 'J09'] },
  { id: 'D09', title: 'David: preserve uncertainty', journeys: ['J08', 'J14', 'J16'] },
  { id: 'D10', title: 'Trust when work is interrupted', journeys: ['J19', 'J20', 'J18'] },
  { id: 'D11', title: 'The product behind patient care', journeys: ['J22', 'J23', 'J24', 'J25', 'J26', 'J27', 'J28'] },
  { id: 'D12', title: 'David: results reach action', journeys: ['J08', 'J29', 'J14'] },
  { id: 'D13', title: 'The referral gets an answer', journeys: ['J30', 'J14'] },
  { id: 'D14', title: 'Emma: after treatment was agreed', journeys: ['J31', 'J04', 'J14'] },
  { id: 'D15', title: 'A feasible care plan', journeys: ['J32', 'J06', 'J14'] },
  { id: 'D16', title: 'Elena: a covering clinician takes over', journeys: ['J33', 'J03', 'J14'] },
  { id: 'D17', title: 'Lucas: care beyond medication', journeys: ['J34', 'J17'] },
];
export function findJourney(id: string | null | undefined): Journey | undefined {
  return journeys.find(item => item.id === id);
}
export function suggestedPatient(j: Journey, patients: readonly JourneyPatient[]): string {
  if (!j.suggestedPatient) return '';
  const matches = patients.filter(p => p.name.trim().toLowerCase() === j.suggestedPatient.toLowerCase());
  return matches.length === 1 ? matches[0].id : '';
}
const tabs: Partial<Record<Screen, string>> = { record: 'overview', visit: 'visit', treatment: 'treatment', twin: 'twin', pst: 'pst', shadow: 'shadow', advisor: 'advisor', evidence: 'evidence', trace: 'trace', notes: 'notes', pathway: 'pathway', outcomes: 'outcomes' };
const paths: Partial<Record<Screen, string>> = { companion: '/patient-companion', queue: '/review-queue', messages: '/messages', schedule: '/schedule', integrations: '/settings', settings: '/settings', access: '/settings' };
/** A missing patient is never replaced with the first patient in the workspace. */
export function journeyHref(id: string, stop: number, patientId: string, patients: readonly JourneyPatient[]): string | null {
  const j = findJourney(id);
  if (!j || !Number.isInteger(stop) || stop < 0 || stop >= j.screens.length) return null;
  if (j.requiresPatient && (!patientId || !patients.some(p => p.id === patientId))) return null;
  const screen = j.screens[stop];
  const tab = tabs[screen];
  if (tab && !j.requiresPatient) return null;
  const path = tab ? '/patients/' + encodeURIComponent(patientId) : paths[screen];
  if (!path) return null;
  const params = new URLSearchParams({ journey: j.id, journeyStop: String(stop) });
  if (j.requiresPatient) { params.set('journeyPatient', patientId); params.set('patient', patientId); }
  if (tab) params.set('tab', tab);
  if (screen === 'integrations') params.set('tab', 'integrations');
  if (screen === 'access') params.set('tab', 'access');
  return path + '?' + params.toString();
}
export type JourneyContext = { kind: 'none' } | { kind: 'invalid'; reason: string } | { kind: 'active'; journey: Journey; patientId: string; stop: number };
export function readJourneyContext(path: string, search: string, patients: readonly JourneyPatient[]): JourneyContext {
  const params = new URLSearchParams(search);
  const id = params.get('journey');
  if (id === null) return { kind: 'none' };
  for (const key of ['journey', 'journeyStop', 'journeyPatient', 'patient', 'tab']) {
    if (params.getAll(key).length > 1) return { kind: 'invalid', reason: 'The journey address contains ambiguous parameters.' };
  }
  const j = findJourney(id);
  if (!j) return { kind: 'invalid', reason: 'This journey is not in the journey register.' };
  const raw = params.get('journeyStop') ?? '0';
  if (!/^\d+$/.test(raw)) return { kind: 'invalid', reason: 'The journey position is invalid.' };
  const stop = Number(raw), patientId = params.get('journeyPatient') ?? '';
  if (!Number.isSafeInteger(stop) || stop >= j.screens.length) return { kind: 'invalid', reason: 'The journey position is out of range.' };
  if (j.requiresPatient) {
    if (!patientId || !patients.some(p => p.id === patientId)) return { kind: 'invalid', reason: 'Choose an available patient before opening this journey.' };
    if ((params.has('patient') || ['/patient-companion', '/messages', '/review-queue'].includes(path)) && params.get('patient') !== patientId) return { kind: 'invalid', reason: 'Patient context changed. Return to Care overview to choose the correct record.' };
    if (path.startsWith('/patients/')) {
      try { if (decodeURIComponent(path.slice('/patients/'.length)) !== patientId) return { kind: 'invalid', reason: 'This journey belongs to a different patient. Return to Care overview.' }; }
      catch { return { kind: 'invalid', reason: 'The patient address is invalid.' }; }
    }
  }
  if (!j.requiresPatient && (params.has('patient') || params.has('journeyPatient'))) {
    return { kind: 'invalid', reason: 'A program journey must not carry patient context.' };
  }
  const expected = journeyHref(j.id, stop, patientId, patients);
  if (!expected) return { kind: 'invalid', reason: 'The journey destination is unavailable.' };
  const target = new URL(expected, 'https://journey.invalid');
  if (path !== target.pathname || params.get('tab') !== target.searchParams.get('tab')) {
    return { kind: 'invalid', reason: 'This screen does not match the journey position. Return to Care overview.' };
  }
  return { kind: 'active', journey: j, patientId, stop };
}

/** User-initiated account/conversation switches leave the old guide, never retarget it. */
export function patientSelectionSearch(search: string, patientId: string): string {
  const params = new URLSearchParams(search);
  for (const key of ['journey', 'journeyStop', 'journeyPatient']) params.delete(key);
  params.set('patient', patientId);
  return '?' + params.toString();
}
export function updatePatientLocation(patientId: string): void {
  if (typeof window === 'undefined') return;
  const {pathname, search, hash} = window.location;
  window.history.replaceState(null, '', pathname + patientSelectionSearch(search, patientId) + hash);
}
/** Used before rendering the record so a malformed URL cannot crash the shell. */
export function patientIdFromPath(path: string): string | null {
  if (!path.startsWith('/patients/')) return null;
  try { return decodeURIComponent(path.slice('/patients/'.length)); }
  catch { return null; }
}
