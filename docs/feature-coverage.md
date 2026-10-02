# TheraNetrix feature coverage and treatment cases

Reviewed September 8, 2026 against `DanielRondeau/theranetrix-featuremap` commit `403398ce06a02c61d0dcaffff191b5162033ba39`. The feature map is the requirements source; this repository is the clinical app.

The app demonstrates a useful encounter workflow, but does not implement every mapped clinical, integration, governance, or commercial capability. A working interface or synthetic record is not evidence of a validated clinical service.

## Two connected examples

| Case | Treatment situation | Details shown |
| --- | --- | --- |
| Emma Carter, TN-DEMO-01 | Still finding a tolerable treatment | Partial reported benefit, grogginess, 28 days on the recorded regimen at the last report, previous topical trial and stop reason, partly met work goal, clinician discussion options, open review, follow-up owner and date. |
| Lucas Hayes, TN-DEMO-02 | Reports improvement with follow-up | Helpful medication report, no current reported side effects, 35 days on the recorded regimen at the last report, prior trial with grogginess, observed pain/function/sleep gains, attained walking goal, recorded maintenance discussion and monitoring plan. |

Both are entirely fictional. Their current medications, stopped trials, patient reports, treatment assessments, notes, messages, tasks, and simulator inputs share the same saved patient record. New information flags an older treatment assessment for review. Goal changes do not inherit the prior goal's attainment. Existing patient records and user edits are preserved when the two examples are added.

## Coverage against the mapped domains

| Domain | Working or demonstrated | Still missing |
| --- | --- | --- |
| Clinician Workspace | Patient overview, priority concerns, current and prior treatment, reported benefit/effects/use, goal progress, clinician options and reasoning, care plans, follow-up, notes. | Formal encounter objects and validated clinical model integration. Synthetic engine decisions retain exact run linkage. |
| Digital Twin | Observed trajectories, dated treatment context, source gaps, saved illustrative target/scenario runs. | Predictive patient model, expected trajectory, uncertainty, recalibration and versioned twin states. |
| PST | Recorded regimen/history plus editable synthetic strategy utility scores and saved clinician decisions. | Actual candidate generation, combination search, utility scoring, predicted benefit/burden, ranking, and mechanistic evidence. |
| Shadow AI | Record-derived checks, separate synthetic strategy scoring, comparison with PST, saved output snapshots. | Independent clinical model, literature retrieval, ranking, and agreement/disagreement comparison with PST. |
| MobileNetrix | Workspace check-ins, goals, conversations, observed trends, record export. | Actual app connection, validated PROM instrument scoring, configured cadence, notifications, devices, and localization. |
| Robo Advisor | Scripted patient conversations, confirmed check-ins, and concern/question handoffs with retained transcripts. | Clinician-approved rubric extensions (versioned), approved protocol education, validated urgent triage, and external delivery. |
| Care Pathway Execution | Five sample operational activities, assignment, scheduling, completion. | Approved 29-step X-1 content, clinical branches, event automation, Tabia execution and multichannel delivery. |
| Data Integration | Explicit source and missing-data information. | EHR/Tabia, SMART/FHIR, CDS Hooks, laboratory/vital/device imports and clinical write-back. |
| Regulatory Pathway | Eight dependency-aware runtime controls, future-scope declarations, intended-use screening, conditional FDA work items, and server-attributed configuration snapshots with sources and exports. | Function-specific regulatory conclusions, release-specific evidence, clinical validation, complaint handling and post-market controls. |
| Engineering / Model Governance | Source history, regression checks, simulator rule version/fingerprint, saved record history. | Inference registry, signed model artifacts, immutable displayed-output snapshots and validated model evaluations. |
| Privacy / Data Protection | Private owner access and isolated owner workspaces. | Clinical role permissions, patient-specific access, consent/revocation, disclosure accounting and read-access audit. |
| Reimbursement / Licensing | No working billing or eligibility flow. | Monitoring eligibility, time/data sufficiency, payer workflows and instrument-license enforcement. |

## Demonstration records per domain

Reviewed September 16, 2026. A new workspace is created with authored synthetic records so every domain below has something saved to show, rather than an empty state. `lib/demo-showcase.ts` holds them; `seedWorkspace()` stays a clean baseline. The **Still missing** column is unchanged: seeding records does not connect a clinical service.

| Domain | Records now saved on a new workspace |
| --- | --- |
| Clinician Workspace | Recorded regimens with dated report history, reviewed clinical context, care plans, and treatment assessments across the sample directory. Three patients deliberately retain their missing-data states. |
| Digital Twin | Two saved runs for each connected case, the newer matching the current record fingerprint and the older labelled historical. Per-patient display settings with an earlier retained revision and a patient-facing care-team note. |
| PST | Saved weighted comparisons at patient-specific priorities, and a clinician decision recorded against one exact run. |
| Shadow AI | A disagreeing first priority in the finding-treatment case and an agreeing one in the improving case, each with the record signals that produced it. |
| MobileNetrix | A confirmed self-report arriving through the advisor and becoming a workspace observation, alongside the recovered stored trajectories. |
| Robo Advisor | Conversations across all four message types, one open handoff, one acknowledged-and-resolved handoff with attribution, and one confirmed check-in. |
| Care Pathway Execution | Named activity owners and a completed activity that retains its prior state and history. |
| Data Integration | Unreviewed allergy status, an unreconciled medication list, an unassessed treatment response, and a separately recorded *confirmed* absence of medication are all present, so labelled gaps stay visible. |
| Regulatory Pathway | A saved planning profile and its configuration snapshot, including conditional work items, open questions, and the guidance sources. |
| Engineering / Model Governance | Saved runs carrying rule version, record fingerprint, displayed scores, actor, and time, plus an audit history for the seeded actions. |
| Privacy / Data Protection | Unchanged. Records are owner-scoped, and a separate owner's workspace never carries another owner's runs, decisions, or snapshots. |
| Reimbursement / Licensing | Unchanged. No billing or eligibility flow exists to populate. |

### Rendered audit, September 16, 2026

Every screen was rendered server-side against the seeded workspace and checked for empty panels: care overview, patient directory and record, review queue, messages, schedule, care pathways, patient companion, the engines board across all seven tabs, encounter review, live engine summary, medication surfaces, settings, Digital Twin and dashboard customization, record export, and all eight feature toggles including every-feature-off. No screen failed to render.

The audit found one defect and several thin spots, all since fixed:

- A patient with a *confirmed* medication reconciliation was shown the unreviewed-list prompt as well, so the record read "Confirmed no current medications reported" and "No medication entries are recorded" together. This was a pre-existing fault in the empty branch at `components/theranetrix/medications.tsx`, reachable through the `medication.none` action and not only through seeded data.
- Priya Raman had no saved run, advisor transcript or display settings, leaving the engine board, output trace, and patient companion empty for her.
- Sarah Mitchell had a recorded check-in concern but no advisor transcript, so her Robo Advisor card read empty next to her own quoted message.
- Three directory patients had no conversation and no scheduled visit; three medication records had no current-regimen date; two dated report-history entries had no start date or reason.

### Landing-screen pass, September 16, 2026

Every screen and every patient-record view was walked in a browser against a seeded workspace and checked for panels that read as empty. The care overview was the weakest: it renders a Robo Advisor card, a clinician plan and a next visit per patient, and six patients had no advisor transcript, three had no plan.

Those are now filled for every patient except **TN-1047 Robert Chen**, whose incomplete baseline is the missing-record example: he is the one patient with no transcript, no plan and no scheduled visit, and the only empty message thread. **TN-1049 David Anderson** remains the single unassessed treatment response. Concentrating the gaps on named patients keeps the missing-data behaviour demonstrable without making the directory look unfinished.

The same pass found that demonstration records could never reach a workspace created by an earlier deploy: seeding was skipped whenever the stored marker was set at all. It now upgrades additively — a workspace at an older version receives records added since, existing records and operator edits are untouched, and nothing is duplicated.

Every record is fictional and none is a clinical prediction, efficacy estimate, drug recommendation, or validated instrument score. A workspace created before these records existed can load them once from Workspace settings; loading never replaces existing patients, edits, or saved records.

## Requirements inspected

`feature-map.config.js` and `sources/components/clinician-workspace.md`, `digital-twin.md`, `pst.md`, `shadow-ai.md`, `mobilenetrix.md`, `robo-advisor.md`, `care-pathway-execution.md`, and `data-integration-tabia.md` in the source commit above.

## Configuration and FDA planning audit

The settings distinguish actual workspace availability from proposed future clinical behavior. Available controls include check-ins/outcomes, record-based review prompts, observed Digital Twin views, PST simulation, Shadow simulation, manual Robo Advisor handoffs, pathways, and messaging. Turning assessments off also disables Digital Twin, PST, and Shadow through their dependency chain. Turning messaging off disables the handoff workflow. Presets change runtime choices only; none declares an FDA category.

The audit corrected assessment display leaks in the patient directory and companion progress. It added an independent control for deterministic medication review prompts. Disabled simulations return no findings; ordinary assessment metrics remain independent of simulator availability. Existing escalation records, manual medication records, and pending reassessment status remain available. A new check-in cannot be made to disappear from treatment-review freshness by turning charts off.

Each saved configuration captures requested and effective features, proposed and effective future scope, intended-use assumptions, review owner, evidence rationale, conditional work items, outstanding questions, guidance references, rule version, and authenticated actor/time. Later saves retain earlier snapshots. Shared CDS answers are initial screening assumptions, not per-function determinations or evidence of compliance. The planner inventories always-on clinical review checks and includes active PST/Shadow interpretation even when separate review prompts are off, flags every blocked proposal, and considers patient-facing clinical support and planned AI changes.

Baseline scope, dependency boundaries, and product security remain visible with all optional features off. Device documentation, QMSR, human factors, device cybersecurity, and AI change planning remain conditional on actual applicability. The interface never selects a device class, clearance pathway, non-device exclusion, or enforcement-discretion conclusion automatically.

Official sources, verified September 8, 2026:

- [Device software and mobile medical applications, September 28, 2022](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/policy-device-software-functions-and-mobile-medical-applications)
- [Clinical Decision Support Software, January 29, 2026](https://www.fda.gov/media/109618/download)
- [Multiple Function Device Products, July 29, 2020](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/multiple-function-device-products-policy-and-considerations)
- [Premarket software documentation, June 14, 2023](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/content-premarket-submissions-device-software-functions)
- [QMSR, effective February 2, 2026](https://www.fda.gov/medical-devices/postmarket-requirements-devices/quality-management-system-regulation-qmsr)
- [Device cybersecurity, February 3, 2026](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/cybersecurity-medical-devices-quality-management-system-considerations-and-content-premarket)
- [AI predetermined change control plans, August 18, 2025](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/marketing-submission-recommendations-predetermined-change-control-plan-artificial-intelligence)
- [Human factors and usability engineering, August 3, 2026](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/applying-human-factors-and-usability-engineering-medical-devices)

Validation covers conditional scope combinations, blocked dependencies, historical snapshot retention, authenticated save/reload and stale-version rejection, disabled writes, assessment rendering, preserved review status, and current workflow regressions. This is code and server-render verification, not a clinical or browser usability validation.

## Medication fixture references

Current regimen examples were checked for plausibility against [the manufacturer's Neurontin labeling](https://labeling.pfizer.com/ShowLabeling.aspx?id=630) and [DailyMed duloxetine labeling](https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=c4fa1d3b-f136-e14f-e053-2a95a90a6cfb). These references do not establish patient-specific suitability. Historical doses that were not specified remain unknown. The app does not generate prescriptions, establish drug efficacy from outcome trends, or automatically clear interactions or contraindications.
