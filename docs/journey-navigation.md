# Journey navigation: first implementation increment

Base: RocketFarm/theranetrix-app main at b2f2bcc0d4f49ddcfa3a96b43116b17d8a444e4e.

## Scope

A collapsed Explore patient journeys launcher extends the existing Care overview. It registers 34 journeys and 17 presentation chapters, with search, explicit patient selection and previous/next related-screen links. Chapter choices follow their authored sequence. No replacement dashboard, patient seed, clinical score, service integration, or clinical completion record is added.

Journeys J29-J34 still require the actual results, referrals, prescribing, access-barrier, handover and multidisciplinary workflow objects. A screen visit is not a completed clinical task. Readiness labels distinguish existing views from missing workflow and partner capabilities.

## Navigation and context protections

Guide addresses are checked for patient existence, patient/path agreement, expected route and tab, duplicate context parameters, and valid stop positions. Invalid guide addresses suppress the underlying record screen instead of displaying a fallback patient. Program-only journeys reject patient context. These checks do not replace server-side authorization.

Switching accounts in the companion, conversations in Messages, or patient filters in the review queue removes the old guide context and records the newly selected patient in the URL. Normal patient and settings tab navigation also exits the guide. Schedule remains explicitly labeled as all-patient.

Guide links are disabled during saves. Editing a native form triggers a conservative confirmation before leaving through a guide link; cancel retains the form. A saved but still-mounted form may prompt again. This is not autosave or complete draft recovery, and unrelated application links and custom controls outside forms retain their existing behavior. Existing patient selectors retain their existing authorization model.

## Review and regression verification

The Journey QA workflow installs locked application dependencies on Node 24, builds the complete Next app, checks full TypeScript, and runs all repository tests. The configuration rendering test has an output directory for its in-memory esbuild CSS-module output; its assertions are unchanged.

The browser script runs Chromium against the built local Next server with explicitly intercepted synthetic workspace API responses. It checks all guide destination types, launcher/chapters/search, missing proposed patients, next/previous, ordinary record navigation, account/conversation/queue switching, malformed/mismatched context, edit confirmation, save-in-flight behavior, program settings and narrow layouts. It records uncaught browser errors, attempted writes, screenshots and per-check results.

Browser fixtures never access a live clinical database or partner service. Simulated save failures test UI behavior only. Existing server tests have their own documented identity/storage substitutes. The 92 clinical acceptance scenarios in the blueprint are not certified by navigation tests. Refer to the exact PR commit's CI run and attached report for executed outcomes; a proposed test is not a pass.

## Merge boundary

Merge only after the production build, full typecheck, repository tests and browser checks pass for the reviewed head, with screenshots inspected. The UI remains an evaluation implementation; this merge does not authorize real-patient use or complete the broader clinical blueprint.
