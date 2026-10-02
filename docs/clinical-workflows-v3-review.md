# Clinical workflows completion review

The remaining demonstration behavior is connected across the seven domains. The final production build and **428/428 automated tests pass**, with zero failures, skips or cancellations. The 34-journey API fixture now persists and reloads **172 accepted workflow commands**, records one accepted care-work transfer, and rejects **71 invalid commands** without a write. The separate connection fixture persists 22 commands and rejects five invalid transitions. Its 15-test API file also verifies lost-response replay and audience permissions before replay.

The patient stories now include signed and amended plans, understood and unresolved teach-back, current governed engine runs, immutable decision packages, saved unfinished work, Spanish instructions tied to the current plan, accepted service coverage, interrupted remote visits and missing-report follow-up. Existing workspaces use **Load patient stories** to add version 4 while retaining user edits and disabled capabilities.

| Connected behavior | Verification |
| --- | --- |
| Urgent requests, accepted transfers, coverage, remote visits and monitoring gaps | `tests/care-operations.test.mjs`; source-owned task and queue transitions prevent shortcuts around required evidence. |
| Interim plans, clarification, withdrawal, examination limits, competing conditions and guarded episode closure | `tests/clinical-encounters.test.mjs`, `tests/clinical-workflow-bridges.test.mjs` and the real API fixtures. |
| Results, referrals, treatment exposure and access | Domain fixtures plus `tests/treatment-bridges.test.mjs`; source-attributed notes and owned tasks, including follow-up anchored to reported actual start. |
| Reviewed advice into shared plans | `tests/plan-preparation.test.mjs`; current same-patient source creates a draft amendment; signing requires its separate review. |
| Decision history, changed preferences and recoverable work | `tests/clinical-decisions.test.mjs`, `tests/decision-bridges.test.mjs`, `tests/story-completion.test.mjs`; actual engine outputs and reviewed data remain frozen. |
| Language, audiences and connection recovery | `tests/advisor-language.test.mjs`, integration tests and the real API file; original wording, exact-plan translation, filtered copies, revocation, replacement grants, offline replay and partial receipts. |
| Recalls, runtime artifacts and assigned protocols | `tests/program-governance.test.mjs` and `tests/governance-connections.test.mjs`; exact release use, preserved prior outputs and owned review of affected patients. |

All 24 original cross-flow entries now have direct software scenarios: 23 have scoped local passes; production prescribing authority remains blocked. These are the specific assertions listed in the manifest, not a claim that every original clinical acceptance criterion or browser interaction is validated. Targeted ESLint on the changed domain/shared code, panels, route and new tests reports zero errors and 37 existing-style/unused-variable warnings. No repository-wide lint pass is claimed.

The app remains in [draft PR #7](https://github.com/RocketFarm/theranetrix-app/pull/7). `main` is unchanged. The PR body records the saved commit and cloud CI evidence. Interactive browser persistence acceptance remains incomplete because the connected browser denied the local QA URL. Production identity, live PostgreSQL, external EHR/provider delivery and independent clinical/release evidence remain separate gates.

Sites publication was checked again: saved app project `appgprj_6a9feafcbaa881919171997f8b0c24a5` returns **NOT_FOUND (404)**. The separate clinical-and-claim-review Site is preserved.

The detailed acceptance manifest is [clinical-workflows-v3-acceptance.json](clinical-workflows-v3-acceptance.json). Reproduce the software gate with:

```sh
npm ci
npm test
```

The real API harness substitutes SQLite and the verified-session boundary while exercising actual handlers, validation, reducers, bridges and SQL/reloads. Existing cloud browser navigation checks mock the workspace API; they do not prove new workflow persistence in the browser.
