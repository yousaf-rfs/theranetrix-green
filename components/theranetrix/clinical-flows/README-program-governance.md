# Program governance workflows (J22–J28)

`ProgramGovernancePanel` exposes every registry's create, select, revise, review, and applicable activation/publication/assignment/withdrawal/closure controls. Transitions identify the record and version, require a reason and a fresh confirmation, and collect reviewer/evidence details where required. Protocol steps, supporting or conflicting evidence sources, release evaluation, readiness gates, missing documentation, and operation outcomes are editable. No synthetic evidence or approval is silently filled into a production form. Failed saves retain the draft. Busy state disables inputs and prevents duplicate submissions.

## Integration contract

- Panel props: `{patientId?: string, patients: readonly {id: string; name: string}[], state: State, busy: boolean, onAction: (action: Action) => Promise<boolean>}`. Styles are imported by the panel.
- Reducer: `reduce(state, action, {actor, now, patients, features})`. All context must be server-derived. `actor` is the verified operator; `now` is an ISO instant; `patients` is the authorized workspace list. Feature booleans must reflect the current server policy after dependency checks.
- Runtime feature keys: `assessments`, `reviewPrompts`, `digitalTwin`, `pst`, `shadow`, `advisor`, `pathways`, `messages`.
- Commands are strictly parsed. Draft updates need both `id` and `expectedVersion`. Assignment updates additionally require `expectedAssignmentVersion`; first assignment uses `0` or omits it. The shared envelope still needs its slice version.
- Request replay is scoped to a matching payload and actor. The last 200 request receipts are retained, so the shared dispatcher remains responsible for workspace request persistence and optimistic concurrency.

## Integrity guarantees

Active configurations cannot be edited in place; create a revised draft. Review and activation check current runtime policy, selected capability dependencies, the current active base version, and non-hideable safety essentials. Configuration activation records governance intent and must never enable capabilities denied by runtime policy.

Every changed record retains its previous content in `revisions` and an attributed transition in `history`. Protocol assignment stores the exact published `protocolSnapshot`, so a later protocol revision cannot change an active episode's instructions. Exports include these snapshots.

Evidence approval needs a non-retracted supporting source, valid non-future source dates, and current rights. Rights expire at the start of the specified date. Evidence edits or withdrawal invalidate dependent reviews. Releases pin configuration and evidence versions; readiness pins evidence versions. Each successful governance mutation also reconciles expired or changed dependencies, changes prior approved/proposed decisions to a pending review state, and preserves the old decision in history. `getSummary(state, patientId?, now?)` uses the current clock even when no new record was saved. The panel refreshes attention once a minute. Positive decisions revalidate dependencies; a no-go can always document a failed review.

Required readiness gates cannot disappear, be renamed, or become optional during an edit or decision. Proposed readiness needs current supporting evidence, no explicit blockers, and review evidence for every satisfied or waived gate. Operation kinds and restore outcomes must agree; failed restore evidence cannot be closed as successful proof. Closed operation records remain immutable. Monitoring rejects future service dates and duplicate normalized date/activity/source combinations.

## External gates

These are evidence and decision records. They do not authenticate external reviewers, perform a deployment, restore data, grant partner rights or regulatory authorization, validate a clinical claim, or establish billing eligibility. Provider access, real clinical/legal/partner approvals, actual restore/deployment verification, and payer review remain external. Operational protocol content must be supplied and reviewed by the responsible owners; the application does not invent approved clinical steps.

## Verification

`node --test tests/program-governance.test.mjs` exercises normal lifecycles, concurrency, idempotency, snapshots, runtime policy changes, evidence expiry/invalidation, required gates, and malformed state. `tests/fixtures/program-governance-scenarios.mjs` exports reusable normal/exception scenarios for all J22–J28 against the authenticated persistence driver and the pure reducer. All scenario evidence is explicitly synthetic.
