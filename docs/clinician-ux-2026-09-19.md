# Clinician time and recommendation explanations

This frontend revision follows the September 18 stakeholder feedback and the request to cover all screens. The target is fast orientation during a short visit, with detailed reasoning one click away. No measured time-saving or clinical validation claim is made.

## Interaction rules

- Show current patient identity, urgent concerns, recent change, and the next action before background detail.
- Keep important cautions, unreviewed information, selection state, and failed-save errors visible.
- Use a consistent explanation dialog: why the item appears, supporting records and dates, checks before acting, alternatives, and limitations.
- Attribute saved clinician reasoning and historical snapshots exactly. Do not reconstruct historical evidence from today's record.
- Label absent evidence or rationale. Do not invent a clinical justification, confidence percentage, or citation.
- Keep full treatment comparisons and their live controls together. Put extended reasoning behind clearly labeled actions.
- Preserve partial, corrected, unanswered, and zero observations across summaries, prompts, and charts.
- Return keyboard focus to the invoking control after a dialog closes. Support Escape, visible focus, scrollable dialogs, and responsive layouts.
- Preserve mounted workflow forms, error recovery, and draft state when navigating task areas.

These choices apply [progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) and [usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/), with [focus visibility](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) and [target sizing](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) considered in implementation. This is not a claim of complete WCAG conformance.

## Screen coverage

| Area | Implementation |
|---|---|
| Care overview and patient directory | Aligned patient worklist, direct actions, recorded priority explanations, sources and dates, customizable columns |
| Patient visit and complete record | Visible goal, current reports, medication response, concerns and decision status; detailed reasons for prompts and cautions |
| Treatment/PST and Shadow | Full controls retained; explanations for ranking, comparison priorities, exclusions, Shadow opinions, and additional options |
| Twin, compact engine summaries, Advisor | Actual observations first; source-backed rules and alternatives; historical snapshot limitations explicit |
| Notes, outcomes, patient pathway | Search and type filter for notes; corrected/partial observation history; operational pathway-step reasons |
| Synopsis, evidence and decision trace | Supporting information grouped by purpose; recommendations and saved decisions remain inspectable |
| Review queue, messages, schedule and pathways | Recorded context and priority; clear ownership and next steps; high-priority concern details visible |
| Patient companion | All five tabs; readable preparation, exact medication instructions, saved-plan attribution, patient-friendly reasons |
| Settings and future capabilities | Configuration preset basis; access/integration status; separate planned-capability scope |
| Clinical workflows | Direct navigation to 34 tasks across encounters, decisions, treatment continuity, results/referrals, patient coordination, integration/access, and program governance |
| Forms | Existing actions, validation, unsaved drafts and failed-save recovery preserved; context errors made visible |

## Verification commands

- `npm run build`
- `node --test --test-concurrency=2 tests/*.test.mjs`
- `THERANETRIX_PREVIEW_MODE=production npm run test:ui`
- `THERANETRIX_PREVIEW_MODE=production npm run test:ui:pst`
- `THERANETRIX_PREVIEW_MODE=production npm run test:ui:all-screens`

Browser verification uses fictional data and the real workspace command route with isolated local storage. It does not exercise production Postgres or external services. Clinical scoring, interactions, evidence sourcing and real-world clinical suitability remain separate validation work. Existing prototype rule assumptions, including broad keyword or status matching, are exposed rather than silently presented as validated medicine.


## Full recheck findings

The second review corrected these reproducible issues:

- New partial and corrected observations now reach the current Twin, engines, Advisor and their sources. Zero stays zero; an unanswered measure is not filled from an older report. Existing saved engine snapshots keep their historical data and use the earlier observation-input revision.
- Working patient check-in, medication, dose-note, message and clinician treatment drafts survive ordinary tab changes. Patient account switches do not carry drafts into another patient's record.
- Patient and settings views follow URL and Back navigation. Supporting sources open in an explicitly labeled separate tab, with the correct patient section focused after asynchronous data loading.
- All four PST slider thumbs carry accessible names. Conversation history accepts keyboard focus. The mobile feedback action retains an accessible name, and workflow disclosures have adequate target height.
- Text colors that failed the measured contrast audit were darkened without changing chart, background, or status meanings.
- Schedule labels unfinished activities as open. Pathway/record actions have distinct spacing, and decision-trace rows visibly indicate expansion.

Additional regression commands:

- `THERANETRIX_PREVIEW_MODE=production npm run test:ui:accessibility`
- `THERANETRIX_PREVIEW_MODE=production node tests/clinician-navigation.browser.mjs`

The accessibility command checks WCAG-tagged axe rules across captured states. It is not a conformance certification. The navigation regression follows real review detours, including patient isolation, source popups, URL navigation and keyboard note expansion. Long records still require scrolling on smaller screens.
