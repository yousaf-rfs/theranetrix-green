# Clinical workflows v3: implementation contract

Baseline: main@ddbd930613603b4c963263fa67d07ef40d6abc37. This is an implementation program, NOT a completion claim. Existing Care overview, patient record, companion, navigation, clinical histories and feature gates must remain. Do not replace the dashboard or mistake 34 registered links for 34 functioning journeys.

## Workstreams and ownership

| Stream | Journey ownership | Owned paths |
|---|---|---|
| A Results/referrals | J29 J30 | lib/clinical-flows/results-referrals.ts; components/theranetrix/clinical-flows/results-referrals.tsx; tests/results-referrals.test.mjs |
| B Treatment/continuity | J03 J04 J31 J32 J33 J34 | lib/clinical-flows/treatment-continuity.ts; components/theranetrix/clinical-flows/treatment-continuity.tsx; tests/treatment-continuity.test.mjs |
| C Encounters/intake | J01 J02 J08 J11 J14 J17 | lib/clinical-flows/encounters.ts; components/theranetrix/clinical-flows/encounters.tsx; tests/clinical-encounters.test.mjs |
| D Patient/coordination | J09 J10 J13 J15 J16 | lib/clinical-flows/patient-coordination.ts; components/theranetrix/clinical-flows/patient-coordination.tsx; tests/patient-coordination.test.mjs |
| E Decisions/evidence | J05 J06 J07 J18 J20 | lib/clinical-flows/decisions.ts; components/theranetrix/clinical-flows/decisions.tsx; tests/clinical-decisions.test.mjs |
| F Identity/integration | J12 J19 J21 | lib/clinical-flows/integration-access.ts; components/theranetrix/clinical-flows/integration-access.tsx; tests/integration-access.test.mjs |
| G Program/governance | J22 J23 J24 J25 J26 J27 J28 | lib/clinical-flows/program-governance.ts; components/theranetrix/clinical-flows/program-governance.tsx; tests/program-governance.test.mjs |

Workers may add a matching scoped CSS module and a scoped implementation README. They must not edit shared app.tsx, actions.ts, theranetrix.ts, workflows.tsx, package manifests, authentication, or CI. The integrator owns shared mounts, authenticated persistence/API, migrations, existing data bridges, authorization enforcement, browser integration tests and final coverage reporting. Worker PRs stay draft, are not individually deployed or merged, and are integrated together on feat/clinical-workflows-v3 after review.

## Shared module contract

Each domain exports:
- State: serializable domain state; initialState(): State.
- actionSchema: a strict Zod discriminated union using command `type` strings prefixed with the domain name. Export Action = z.infer<typeof actionSchema>.
- reduce(state: State, action: Action, context: Context): State. Must validate actionSchema at runtime, reject unexpected keys, and never mutate input. Context is {actor:string; now:string; patients:readonly {id:string; name:string}[]; features:Readonly<Record<string, boolean>>}. Actor/time are supplied by the server. Validate patient existence where required. Do not accept actor from an action or pretend supplied roles establish authorization.
- validateState(state: unknown): State where persisted-state normalization is needed; do not silently drop history or fill clinical facts with defaults.
- getSummary(state: State, patientId?:string): {open:number; overdue:number; attention:string[]} (or document a typed equivalent if now is needed).

Each UI module exports a named domain component: ResultsReferralsPanel, TreatmentContinuityPanel, EncountersPanel, PatientCoordinationPanel, DecisionsPanel, IntegrationAccessPanel, ProgramGovernancePanel. Props: {patientId?:string; patients:readonly {id:string;name:string}[]; state:State; busy:boolean; onAction:(action:Action)=>Promise<boolean>}. Also accept readonly clinical context as an OPTIONAL prop when needed; document it. Core logic must not import UI. Use existing React/Zod dependencies; no new packages unless separately justified. Use standard labelled forms, accessible errors/focus and CSS isolation. Keep drafts after failed save and require explicit confirmation of critical transitions.

Each record has id, patientId where applicable, encounterId when clinical, version (integer), createdAt, updatedAt, and append-only history [{id,at,actor,from,to,reason,evidenceRef?}]. New records use requestId for idempotency. Updates include id, patientId where applicable, expectedVersion, requestId, and necessary typed fields; repeat identical requests do not duplicate events; reused requestId with different payload is rejected. Preserve bounded idempotency receipts without deleting clinical history. Do not use localStorage for patient data. Do not infer that an empty field is a negative finding.

## System integration

Integrator validates domain command before applying it through the existing authenticated workspace API. Add versioned additive `clinicalWorkflows` state to Workspace; keep existing patients/records untouched. Bridge encounter sign-off to the SAME existing carePlans, notes, tasks and companion plan; do not create independent contradictory plans. Clinical outputs refer to exact input/evidence versions. Patient corrections or new observations invalidate affected drafts, not erase historical decisions. State transitions must be server-enforced, not only disabled buttons.

Named identity/tenant/patient authorization is a real dependency. Do not label the present shared-owner workspace as multi-role clinical authentication. Proposed grants/consents are records until the server authorization boundary enforces them. Add safe interfaces and negative tests; do not bypass existing authentication or read production secrets. Invalid launch context must block instead of selecting a different patient.

## External boundaries

Tests, referrals, prescriptions, integrations, scheduling and communications have distinct objects. Saved != delivered != acknowledged != acted on. A due follow-up != a booking. Prescription sent != dispensed != taken. Instructions sent != understood. A user-entered report of external completion must be labelled manual and attributed with evidence/source; it does not prove the application delivered anything. Real integrations require configured provider adapters, credentials and verified receipts. Fail closed when unconfigured; no hardcoded Connected status, fake clinical model, invented clinical rule, or fabricated external acknowledgement.

Governance approval records are not regulatory authorization. Model agreement is not clinical confidence. Preserve observed vs synthetic vs validated prediction labels. No arbitrary dosing, medical thresholds, copyrighted instrument reconstruction, automatic prescribing, automatic model training from overrides, or use of real patient data. All test fixtures are synthetic. Clinical validation, actual partner connection, licensed protocol/content and approval evidence remain release gates, not checkboxes an agent can truthfully complete.

## Required evidence and acceptance

Every journey must have: launch surface in existing app; role/context; typed saved state; normal path; exception path; receiving owner; observable persistence after reload; tests; current limitations. Worker tests use Node/esbuild patterns in this repo, cover each owned journey's happy/exception path, malformed input, wrong patient, stale update, invalid transitions, idempotency, non-mutation and chronology. npm run build, npx tsc --noEmit and full tests must pass before integration acceptance. Do not remove assertions to make tests green.

Integrator runs actual built-app/browser tests with isolated persistent database and synthetic identities where supported; clearly label any mocks. Keep blueprint coverage separate from tests of navigation. Target 34 normal + 34 exception + 24 cross-cutting scenarios, with evidence per scenario; tests remain Not run until executed. If a clinical/partner gate is unmet, mark blocked, not passed. Do not force urgent/complex visits into seven minutes.

Cross-cutting cases: pain phenotype/exam; competing conditions; urgent distress; deliberate no-change; source-summary correction; alert volume; teach-back; non-digital participation; closure/transfer; revocation; interpreters/proxies; corrected data; sensitive audiences; wrong-chart correction; nonresponse; monitoring gaps; unsupported scope; evidence/model recall; prescribing authority; concurrent therapies; interrupted documentation; remote visits; changed preferences; timezone-aware handovers.

## Handoff from every worker

Open a draft PR, include exact owned journeys and files, schemas/reducer/UI exports, acceptance tests actually run, all remaining dependencies, and migration/bridge instructions. Do not merge, deploy, alter shared files, or claim all 34 are done. The integration PR is the only merge candidate after combined QA.
