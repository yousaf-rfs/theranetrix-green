# TheraNetrix Forest Green

This repository contains the Forest Green home-page design for client feedback. The home page is `/`; it has no design switcher. The former `/design-preview` address redirects to `/`. Other application screens and the existing clinical, authentication, and storage behavior are retained.

The source is maintained on the `forest-green` branch. Nothing is pushed to `main`. When setting up the separate Vercel project, select `forest-green` as its production branch.

Use Node.js 24 and `npm ci`. Run `npm run preview:demo` to preview fictional records locally at `http://127.0.0.1:3030`, or `npm run build` for the production bundle. The local demo is temporary; Vercel needs its own configured Postgres database. See [Vercel setup](./VERCEL-SETUP.md).

---

## Workspace interface redesign

The redesigned workspace uses a shared navigation shell, patient triage rows with expandable reviews, a focused Visit view, side-by-side treatment review, and dedicated sections for observations, records, and follow-up. Review queue, conversations, schedule, companion, forms, and settings share the same hierarchy and responsive controls. Long source explanations and workflow editors use disclosures; urgent concerns, missing information, save errors, and primary actions remain visible.

To review the interface without database credentials, run `npm ci` and `npm run preview:demo`, then open `http://127.0.0.1:3030`. This loopback-only preview runs the real workspace route with an isolated in-memory SQLite adapter and fictional records. Changes reset when the preview stops. Production authentication and storage are unchanged.

`npm run test:ui` starts that preview and exercises desktop/mobile navigation, filtering, care-plan save and recovery, linked follow-up, companion visibility, messaging, and settings draft retention. It also checks sticky patient navigation, recorded identifiers, first-report states, feedback saving, printable visit summaries, dashboard reordering, and Advisor placement. Install the Playwright browser with `npx playwright install chromium` first, or set `THERANETRIX_CHROMIUM_PATH` to an existing compatible browser. Screenshots and `verification.json` are written to `THERANETRIX_SCREENSHOT_DIR`, or a temporary `theranetrix-feedback-review` directory by default. `npm run test:ui:pst` verifies the full comparison, weighting, drug filters, ranking explanations, and Shadow decision staging.

To verify the production bundle, run `npm run build` first, then `THERANETRIX_PREVIEW_MODE=production npm run test:ui` (or `npm run preview:demo` with the same variable).

The September 18 stakeholder feedback revision places patient tabs above the name and keeps identity, allergies, and note actions visible while scrolling on desktop/tablet. DOB and MRN are editable recorded fields; no DOB is inferred from age. Visit review separates reported trajectories, medication response, unresolved concerns, and the current plan. Patient preparation supports searchable medication names and attributed reports that require clinician review. The complete PST workbench retains its weighting controls and score columns, adds drug/category filters, and explains its prototype calculation beside alternatives. Digital Twin leads with observed data; its illustrative scenario is a separate disclosure. Screen feedback is saved inside the workspace with priority and request type. Visit PDF opens the browser print/save-as-PDF path, with no EHR delivery.

## Connected engine experience

The clinician-time revision extends consistent click-through reasoning across the worklist, patient review, treatment, engine summaries, Advisor, companion, and operational workflows. See [screen coverage and interaction rules](./docs/clinician-ux-2026-09-19.md). `npm run test:ui:all-screens` checks the expanded screen inventory, explanation dialogs, keyboard focus return, and all 34 workflow task shortcuts.

Open `/engines` for the shared workspace, `/digital-twin` for the patient state/scenario, `/pst` for PST and Shadow comparisons, or `/robo-advisor` for patient conversation. A `?patient=TN-DEMO-01` or `TN-DEMO-02` query preserves the selected case. The seven-minute visit exposes all four engines and can save a run directly.

- Digital Twin displays saved observations with a clearly illustrative target and scenario range. These curves are not clinical predictions or uncertainty estimates.
- PST applies editable patient-priority weights to authored synthetic strategy profiles. Shadow applies a second transparent record-rule scoring method. Their agreement is a demo comparison, not independent clinical validation.
- Every saved run retains its source excerpts, preferences, displayed scores, rule version, input revision, actor, and time. New patient information makes older runs stale without rewriting them.
- A clinician decision references the exact current run, requires a rationale, and saves the same patient-facing plan and follow-up seen in the companion. It never changes medication or resolves existing concerns.
- Robo Advisor uses scripted replies. Confirmed measurements create actual workspace check-ins. Concerns/questions create review items and conversation history; unresolved concerns continue to influence later comparisons until reviewed.
- Runtime feature dependencies apply to all new actions. Saved records remain available for audit/export. The patient plan is independent of the pathway switch.

`lib/engine-demo.ts` documents every synthetic scoring assumption. Real drug-combination generation, mechanistic efficacy models, literature retrieval, protocol-specific education, external notifications, and clinical model validation remain unconnected. This is a complete connected *demo loop*, not a completed clinical platform.

## Feature demonstration records

Demonstration records upgrade additively: a workspace created by an earlier deploy receives records added since, without duplicating anything or overwriting operator edits. A new workspace is created with authored synthetic records for every mapped feature area, so each workflow can be shown without first having to generate data. `lib/demo-showcase.ts` contains them and documents the seeding order. `seedWorkspace()` itself stays a clean baseline; the records are applied where a workspace is first created, and a workspace created before they existed can load them once from **Workspace settings → Account & access**.

- Digital Twin: two saved runs per connected case. The newer run stores the current record fingerprint, so the board opens on a current, decidable run rather than a stale one; the older run is labelled historical. Per-patient display settings choose the measures, the opening chart, and a patient-facing note from the care team, with one earlier revision retained.
- PST and Shadow AI: Emma Carter's saved run has the two demo rule sets disagreeing on the first priority, because the record carries a reported side effect and an unresolved concern. Lucas Hayes's run has them agreeing. A clinician decision is recorded against the exact earlier run, with the rationale for following the Shadow ordering, and it authored the current patient plan and follow-up task.
- Robo Advisor: conversations covering all four message types, a care-team handoff that is still open, a handoff that was acknowledged and resolved with attribution, and a confirmed check-in that became a real workspace observation. Elena Rodriguez's existing queue handoff now has the transcript it refers to.
- Clinician workspace: recorded regimens, reviewed clinical context, care plans, and treatment assessments across the sample directory.
- Care pathways, review queue, saved doctor dashboards, FDA planning snapshot, and audit history are all populated.

Four patients carry a saved engine run: the two connected cases, Sarah Mitchell as a directory example, and Priya Raman. Every one of them opens on a current run, and Sarah and Priya also carry advisor transcripts so the Robo Advisor card is populated on their records.

Missing-data states are preserved rather than filled in, because they are themselves mapped behaviour. Robert Chen keeps an unreviewed history and allergy status, no care plan and no conversation — he is the missing-data demonstration, and he is the only patient whose message thread reads empty. David Anderson keeps an unassessed treatment response, and Michael Thompson keeps a medication list that has never been reconciled. Priya Raman, an added case, records a *confirmed* absence of medication with an author and date, so that state and an unreviewed empty list are both demonstrable. One review is left Acknowledged so that queue filter has an example, and Emma Carter's newest run is deliberately left undecided so a decision can be recorded live during a walkthrough.

Every record is fictional. None is a clinical prediction, an efficacy estimate, a drug recommendation, or a validated instrument score. Loading the records never replaces existing patients, edits, or saved records.

## Planned capability previews

`/future-capabilities` holds prototype screens for the nine capabilities the app does not implement, so the intended interface can be reviewed and shown before it is built: predictive Digital Twin, PST candidate generation and ranking, an independent Shadow model with evidence retrieval, Tabia/EHR/FHIR integration, validated instrument scoring, the full X-1 protocol, the native MobileNetrix app with device streams, remote-monitoring eligibility, and clinical roles with consent and access audit.

The figures on these screens are fabricated for the prototype. Nothing is connected to a clinical service, and no value is computed, retrieved, predicted, or scored. Each screen carries a `Design preview` badge and a collapsible build-notes section stating what ships today instead and what making it real requires. `lib/future-preview.ts` holds the preview data and imports nothing from the clinical modules, so a preview cannot be wired into a real workspace record.

Two limits are deliberate. Licensed instrument item wording (BPI, PEG, SOAPP-R, COMM) is never reproduced; only subscale names, fabricated scores, and interpretation bands appear. The X-1 steps are an illustrative structure of the right shape and length, because the approved protocol was never supplied to this project.

## Working workflows

- Clinician overview with every patient’s priority, current medications, reported benefit/tolerability/use, outcome comparisons, and suggested review steps visible without opening the chart.
- Medication review dialogs, new and stopped medication records, dated assessment history, and confirmed absence of medication.
- Clinician plans with rationale, owner, follow-up date/time, linked schedule activities, completion state, and encounter documentation.
- Patient directory, medication search and clinician/review filters.
- Single-patient overview combines prioritized review actions, medication response, clinician plan, observed outcomes, treatment preferences, clinical/biopsychosocial context, care activities, patient messages, Robo Advisor handoffs, and documentation. Existing detail tabs remain available.
- Editable clinical history, reported allergies, prior treatments, pain presentation, patient preferences, and care coordinator, with attributed context history.
- Observed trajectories and source completeness, treatment-review surfaces, self-reported outcomes, care pathways, conversations, and encounter documentation.
- Add sample patients, goals, notes, escalations, scheduled activities, and check-ins.
- Review queue with acknowledgement, resolution, context, and patient-status updates.
- Operational sample care pathway with enrollment and activity completion.
- Patient companion with daily self-reports, progress, patient goals, care-team messages, education, and requests that reach the clinician queue.
- Workspace capability controls with dependency handling and server-side mutation checks.
- Access-code-protected owner workspace, optimistic concurrency, validation, and audit history. People sharing the code share the same workspace.
- Record and audit exports.

## Boundaries

This is not a clinically validated production system. It must use synthetic records. PST, Digital Twin, and Shadow AI clinical services are not connected. Clearly labeled record-based simulations are available; they do not invent predictions, rankings, efficacy, medical citations, or drug instructions. The Robo Advisor surface implements scripted conversations, confirmed check-ins, and care-team handoffs; it is not autonomous medical advice.

Tabia, EHR/SMART on FHIR, the native MobileNetrix application, external messaging, notifications, and video conferencing require partner integrations. Clinical roles are a documented target; the current shared workspace opens directly for anyone with its URL. Password protection is optional through `WORKSPACE_REQUIRE_PASSWORD=true`; the default is open access. The companion is a shared evaluation view, not a separate patient-authentication boundary.

The five-stage sample operational pathway is not the 29-step Peripheral Neuropathy Care Plan X-1. The full clinical protocol was not supplied. Named instruments BPI, PROMIS, PEG, SOAPP-R, and COMM are not reconstructed or scored. The patient companion has translated core navigation and check-in labels; record content and parts of shared UI remain in English. Configurable reminders, full history reconciliation, licensed instruments, broader syndrome protocols, model evaluation, and multi-clinician authorization remain production work.

Medication examples are explicitly synthetic. The two expanded demonstration cases include recorded example regimens; unknown regimens in other records stay unrecorded. Reported benefit is not inferred from outcome trends; prompts ask the clinician to review recorded concerns or missing information and never recommend a drug or dose. Changing a recorded regimen resets the form’s assessment fields and requires confirmation before reusing assessed responses. Different drug identities require a new record. Existing JSON workspaces upgrade idempotently without resetting saved records.

## Source requirements

Requirements were recovered from revision `403398ce06a02c61d0dcaffff191b5162033ba39` of the source repository:

- `sources/components/clinician-workspace.md`
- `sources/components/digital-twin.md`
- `sources/components/pst.md`
- `sources/components/shadow-ai.md`
- `sources/components/mobilenetrix.md`
- `sources/components/robo-advisor.md`
- `sources/components/care-pathway-execution.md`
- `sources/components/data-integration-tabia.md`
- `sources/compliance/comp-iec-62366.md`
- `feature-map.config.js`

## Connected simulation and all-in-one overview

Shadow AI and PST now use a shared deterministic patient-record simulator (`demo-record-rules-v1`). Each output cites the medication report, observation range, review item, preference, or plan that produced it. The record fingerprint and displayed findings update after saved changes. This is a rule-based demonstration, not an AI inference service, independent validation, prescribing engine, or efficacy estimate. Missing data stays missing and existing saved records are never replaced to manufacture a result.

The Visit view puts review actions, observed outcomes, medication response, and the current care plan first. Treatment comparisons, source details, conversation history, and clinical workflows remain accessible through focused tabs and disclosures. The clinician panel uses the same Shadow summary.

## Patient overview feature cross-check

The single-patient overview was cross-checked against all 12 domains in `feature-map.config.js` and the eight component briefs at the source revision above. It exposes clinician decisions and their basis first, then medication response, plan/follow-up, observed Digital Twin inputs, patient goals and treatment preferences, PST/Shadow availability, pathway execution, MobileNetrix feedback, Robo handoffs, clinical context, documentation, and data gaps. Review, medication, plan, context, pathway/task completion, and reply actions work directly on the overview.

Unavailable capabilities are labeled rather than simulated: predictive state/trajectories, CUI/ranking/dosing, independent model conclusions/agreement, clinical evidence retrieval, validated PROM scoring/cadence, EHR/Tabia sync and write-back, device/lab/imaging/genetic records, autonomous advisor configuration, consent enforcement, and monitoring eligibility. The five-stage operational pathway remains separate from the unsupplied X-1 clinical protocol.

## Implementation

Native Next.js/React on Vercel. Postgres stores the single-owner workspace document. Authentication uses an access code and a signed HTTP-only session cookie; production workspace access does not trust ChatGPT user headers. Optimistic version checks prevent concurrent writes from silently overwriting each other. Changes are applied through a discriminated, validated server action API; the client cannot replace arbitrary workspace state. Database setup and the migration boundary from Sites are documented in [VERCEL-SETUP.md](./VERCEL-SETUP.md).

The storage shape is suitable for evaluation, not a final clinical data architecture. A production version should normalize clinical records, use a dedicated immutable audit stream and validated patient/organization authorization, implement partner data contracts, establish record-retention and backup policies, and perform full clinical and security validation.

## Validation

- `npm run build`: native Next.js production build.
- `npx tsc --noEmit`: TypeScript validation; run the build first to generate Next.js types.
- `node --test tests/demo-insights.test.mjs`: simulator data consistency, patient isolation, live refresh after saves, unknown/zero handling, and capability gates.
- `node --test tests/patient-overview.test.mjs`: rendered patient isolation and feature visibility, missing-data states, disabled assessment behavior, context history/audit, and chronological review/message summaries.
- `node --test tests/medications.test.mjs`: medication isolation/history, unknown versus no benefit, context-change validation, reconciliation, plan/schedule ownership and completion, and priority ordering.
- `node --test tests/workflows.test.mjs`: state consistency, patient handoff, capability enforcement, date validation, scheduling, enrollment, and audit linkage.
- `node --test tests/workspace-auth.test.mjs`: workspace API behavior against isolated SQLite with substituted identity, including legacy identity compatibility, isolation, and version conflicts. This does not exercise production access-code sessions or Postgres.
- `node --test tests/vercel-session.test.mjs`: Vercel session authentication checks.
- `node --test tests/future-preview.test.mjs`: every planned-capability preview renders, stays labelled as a preview, keeps its build notes, never reproduces licensed instrument wording, and cannot reach the clinical workspace.
- `node --test tests/demo-showcase.test.mjs`: demonstration-record coverage of every feature area, idempotent seeding, preservation of operator edits and missing-data states, saved-run fingerprints matching the live record, and rendered engine/twin/loader states.

The redesign includes browser verification against the isolated synthetic preview at desktop, tablet, and mobile widths. This checks interface behavior and saved workspace actions; it does not validate production Postgres connectivity or external clinical services. The app includes keyboard navigation primitives, visible focus states, and reduced-motion support.
