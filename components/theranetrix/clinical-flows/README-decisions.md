# Decisions workflow integration

The `DecisionsPanel` implements the saved-record interaction for J05, J06, J07, J18, and J20. It accepts `patientId?`, `patients`, the decisions `state`, `busy`, `onAction: (Action) => Promise<boolean>`, and optional read-only `clinicalContext`.

## Trusted server context

Pass the authenticated actor, server timestamp, allowed patient references, and server-controlled features to `reduce`. In the combined application, also supply:

- `inputVersions: [{ patientId, encounterId, inputVersion }]`, using the authoritative patient/source fingerprint for the command's encounter. The client must not create this authority.
- `carePlans: [{ id, patientId, version, summary, goal }]`, projected from stored patient care plans. Sign-off and amendments reject IDs owned by another patient or missing from this list. The referenced plan contents are copied into the signed snapshot.
- `features.decisionsExport`, enabled only by the authenticated workspace's server policy. The reducer checks this before replaying its own export receipts. The outer API receipt layer must apply current authorization too.

The standalone reducer keeps `inputVersions` and `carePlans` optional for isolated unit tests. The integrated server supplies them.

## Client context

`clinicalContext.currentInputVersion` supplies the currently selected patient's authoritative source fingerprint for an entered encounter. An optional `inputVersions` list can provide specific patient/encounter entries. `observations`, `engineRuns`, and `plans` are always filtered to the selected patient; observations and engine runs are additionally filtered by encounter. A legacy care plan may omit `encounterId`.

The form retains original observation dates and provenance. Separate engine output identifiers and exact text must be available before importing a dual-engine record; a single shared summary is never copied into both outputs. Users can record independent outputs manually, with provenance defaulting to unverified. Capturing an output does not execute or clinically validate a model.

## State and lifecycle rules

- Captures append source revisions. Existing reviewed record IDs never silently change content.
- Drafts pin source IDs and versions. Sign-off requires the current input revision, current reviewed records, exact saved summary and disposition, and metadata present in the captured evidence/outputs.
- Corrections replace the actual summary and rebind reviewed sources. Disputed/cancelled drafts cannot be signed. Retry restores a draft which must be saved before sign-off.
- Signed snapshots contain complete copies of the reviewed records and are immutable. Amendments create new snapshots; an older ancestor cannot be amended once a newer amendment exists.
- Export records contain only the selected patient and encounter. JSON includes the complete immutable snapshot; readable output includes the reviewed records and audit history.
- Receipt matching binds actor and command. Reusing an active request ID for different content fails.

`tests/clinical-decisions.test.mjs` exercises reducer regressions and server-rendered patient/encounter context isolation. `tests/fixtures/decisions-scenarios.mjs` exports `runScenarios(driver)` for the combined authenticated API/persistence/reload suite; it uses synthetic evidence and selects a real stored patient care-plan ID from the driver's workspace.
