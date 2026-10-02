# PR #7 code review and QA — 2026-09-17

This review started from GitHub commit `7399a0c5315c9e1a7653d7884f1bc76ae06ab3a8` on `feat/clinical-workflows-v3`. All 277 cloud blob files were compared with the local review checkout and matched before edits. The PR contained 118 changed files against `main` (`ddbd930613603b4c963263fa67d07ef40d6abc37`). Six reviewers covered API and security boundaries, decisions, encounters, governance, results/treatment projections, and client recovery.

The starting commit passed GitHub Journey QA run #51 with 474 repository tests and 35 browser navigation checks. The reproducible defects below demonstrate the limits of that coverage. Each fix has a focused regression; combined verification is recorded below after integration.

## Confirmed findings and corrections

| ID | Priority | Defect and consequence | Correction |
| --- | --- | --- | --- |
| CR01 | P1 | An approving amendment bypassed the governance checks used for initial sign-off, allowing approval of recalled saved engine output. | Apply the same approval guard to capture and amendment, using the original immutable reviewed source runs and their exact release references. |
| CR02 | P1 | Reviewing a release again silently replaced its evidence pins without changing its artifact version. Earlier output then appeared to use newer evidence and could disappear from recall impact. | Preserve artifact evidence pins through every review. Changed evidence requires an explicit new release artifact revision. |
| CR03 | P1 | A recall affecting evidence used only by a readiness scope did not block runtime use or readiness reapproval. | Evaluate exact recalled readiness evidence, invalidate the scope, and reject reapproval until replacement evidence is reviewed. Closing recall work does not reinstate the recalled version. |
| CR04 | P1 | Resuming a working copy restored older draft text onto whichever draft opened by default. Saving could overwrite a different record. | Persist scoped draft identity and version. Restore that exact draft when current; otherwise restore the text as a new draft. |
| CR05 | P1 | Required interim fallback instructions were omitted from the shared patient care plan and note. Downstream patient views and exports missed part of the signed package. | Project the frozen fallback into the patient-facing plan and note while retaining the original signature. |
| CR06 | P1 | New Advisor or legacy check-ins could leave encounter review evidence apparently current when pain and function were unchanged. | Include saved, nonwithdrawn check-ins and their stable source identities in review freshness; avoid duplicating workflow observation projections. |
| CR07 | P1 | A medication lifecycle could change medication or order identity while retaining authorization, dispensing, actual-use and completed response evidence for the previous identity. | Lock medication and order identity once exact order evidence is attached. A replacement uses a new lifecycle; same-identity regimen revision remains supported. |
| CR08 | P2 | A lost-response retry failed once its entry left the shared 50-receipt cache, even though the domain retained its receipt. | Authenticate durable domain replay before rejecting a stale slice version. New stale mutations and changed payloads remain rejected without writes. |
| CR09 | P2 | An empty optional coordinator prevented ordinary and urgent Advisor concerns from saving despite an available clinician. | Choose the first trimmed, nonblank coverage owner, coordinator or clinician. |
| CR10 | P2 | Working copies omitted amendment fields and engine preferences despite reporting that progress was saved. | Persist and restore these fields, the selected engine run, and amendment identity. |
| CR11 | P2 | Selecting another coordination record or decision draft silently discarded unfinished editor state. Pending saves could also lose their context. | Require explicit keep-editing or discard-and-switch actions and block selection during an active save. Preserve retry identity until explicit discard. |
| CR12 | P2 | Offset timestamps for clarification work were sliced into a schedule entry labeled UTC without converting the instant. | Normalize the timestamp before deriving the UTC date and time, including date rollover. |
| CR13 | P2 | Any later encounter save reapplied old withdrawal effects and reopened an already resolved record review. | Persist an idempotent withdrawal projection marker and apply its patient review effects only once. |
| CR14 | P1 | Accepted ownership transfers disappeared on later source updates, and most treatment record kinds never projected ownership onto their original task. | Project validated accepted assignment history consistently across supported source identities. Preserve exact source-version requirements for clinical closure. |
| CR15 | P2 | Correcting an access start or removing its review interval left an obsolete response task open and locked against completion. | Retire removed projected tasks as deferred history at the current source version. |
| CR16 | P2 | Changing a referral coordination deadline left its schedule entry on the old date. | Synchronize the source deadline and derive task date/time from the actual current deadline or next attempt. |

## Verification

The integrated changes passed these local gates:

| Gate | Result |
| --- | --- |
| Production build (`npm run build`) | Passed |
| TypeScript (`npx tsc --noEmit`) | Passed |
| Repository tests (`node --test tests/*.test.mjs`) | 504 passed, zero failed or skipped; 30 more than the reviewed baseline |
| Scoped ESLint, all 22 changed code/test files | Zero errors; 12 unused-variable warnings in `lib/actions.ts` |

The full suite includes the 34-journey API fixture: 172 accepted commands, one care-work transfer, and 71 rejections with unchanged persisted data. The connection fixture adds 22 accepted commands and five rejected transitions. The separately documented external blockers are not counted as live-service acceptance.

New regression files cover decision integrity/recovery, encounter integrity, medication identity, coordination record selection and treatment assignment projections. Existing API, care-operations and governance suites contain additional regressions. A second governance reviewer checked the amendment guard and the distinction between historical receipt replay and new artifact use.

All 23 follow-up files are checked against the uploaded GitHub tree, with unrelated cloud files preserved. The [PR #7 description](https://github.com/RocketFarm/theranetrix-app/pull/7) records the reviewed commit and its corresponding GitHub Journey QA result. No repository-wide lint pass is claimed.

Regression coverage includes real domain reducers, workspace command handling, the authenticated workspace API with an isolated SQLite database, and component state/event-handler harnesses. Component harnesses are not browser tests.

## Remaining acceptance limits

- GitHub browser navigation checks mock the workspace API. They do not establish end-to-end persistence or visual acceptance of the new workflow forms.
- The connected browser denied the local QA URL. No alternative browser path was used. Earlier screenshot artifact retrieval returned HTTP 403, so those images were not visually reviewed.
- The saved Sites application previously returned project-not-found (404). The separate clinical-and-claim-review Site is a different project and is preserved.
- Live providers, production identity/consent/roles, PostgreSQL behavior and independent clinical/release acceptance remain unverified. Existing externally blocked J12/J19/J21 acceptance items remain open.
- Earlier UI polish items remain documented in `docs/ui-ux-review-2026-09-17.md`.

This code-review follow-up updates the existing PR branch. It does not merge `main` or publish the application.
