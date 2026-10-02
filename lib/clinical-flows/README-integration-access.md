# Integration access: J12, J19, J21

The shared-owner app supports evaluation source configuration, policy drafts, documented quarantine rejection, and manually reported external evidence. These local actions are persisted and audited. They do not create clinical roles, enable an external source, verify an EHR launch, import clinical observations, or acknowledge provider delivery.

## Shared contract

- `initialState(): State` returns independent empty state. No patient-to-organization assignments are invented.
- `actionSchema` is a strict discriminated union using `type: 'integration-access.…'`. Browser actions cannot contain `actor`, `principal`, `serverNow`, `adapterContext`, or `integrationAccess`.
- `reduce(state, action, context)` validates the whole persisted state, request fingerprint, state version, patient membership, and relevant authorization before changing data.
- `validateState(input): State` and `normalizeState(input): State` reject inconsistent persisted facts. `inspectState(input)` returns `{ok, errors}` for diagnostic use.
- `IntegrationAccessPanel` accepts `{patientId?, patients, state, busy, onAction: (action) => Promise<boolean>}`. Failed saves preserve drafts; successful saves reset only the submitted manual report or quarantine reason.

Ordinary coordinator context is `{actor: string, now: ISO, patients: Array<{id, name}>, features: Record<string, boolean>}`. `actor` and `now` must come from the authenticated server session and server clock. `features.integrationAccess === false` blocks the whole domain.

## External identity and adapter boundary

The coordinator intentionally does not currently supply `context.integrationAccess`. Supplying it is reserved for a server implementation backed by a real identity provider and adapter:

```ts
integrationAccess?: {
  actorKind: 'server' | 'server-adapter';
  organizationId: string;
  verified: true;
  principal?: Principal;
  launchContext?: { patientId; encounterId; organizationId; principalId };
  trustedSourceIds: string[];
  trustedAdapterId?: string;
  savedNote?: { noteId; patientId; encounterId; payloadDigest; savedAt; savedBy };
  receipt?: {
    outboxId; attemptId; adapterId; providerMessageId;
    status: 'acknowledged' | 'failed'; retryable?: boolean;
  };
}
```

For server user actions, `context.actor` must equal the verified principal ID, and principal organization must equal the trusted organization. For adapter actions, `context.actor` must equal `trustedAdapterId`. A source must be registered for that adapter and organization. State's adapter registry is descriptive, not an authority to grant trust.

`authorize(principal, permission, patientId, policy, now)` is a policy decision function. Its principal must come from verified server identity. A browser-supplied `verifiedServerIdentity: true` is not identity verification. Runtime read, write, export, and other clinical API boundaries must call this function with a verified principal if the app ever becomes a multi-role clinical system. Workspace ownership and integration administration cannot be configured into clinical record privileges.

Clinical write-back also requires a server-attested existing saved note matching patient, encounter, note ID, and payload digest; preparing outbox data does not save that clinical note. Write and integration consents are checked again before dispatch. Provider receipts are bound to the current outbox attempt, adapter, and tenant; previous receipts remain in `providerReceipts`. Manual evidence stays in `externalEvidence` with `kind: 'manual-report'` and cannot change delivery state.

## Observation bridge

`acceptedEvents` retains immutable accepted event history. `bridgeObservations` contains active observations only, preserving `patientId`, `organizationId`, `sourceId`, `eventId`, `metric`, `value`, `unit`, `observedAt`, `receivedAt`, `recordedAt`, `provenance`, and optional `correctedEventId`.

The bridge key is the tuple `(sourceId, eventId)`, not a concatenated string without escaping. A correction must reference the active predecessor from the same source, patient, organization, and metric. Its predecessor is removed from `bridgeObservations` but retained in `acceptedEvents`. The coordinator should project current bridge observations using this lineage and remove superseded projections. It must not append all accepted events as current measurements.

Quarantine acceptance re-runs source registration/freshness, patient mapping, timestamps, units, value range, stable event IDs, and correction checks. Changing units requires an explicitly reviewed value and evidence note; the model performs no implicit clinical conversion.

## Verification

Run `node --test tests/integration-access.test.mjs` for trusted-boundary unit tests. `tests/fixtures/integration-access-scenarios.mjs` exercises the real shared-owner API/SQLite driver. It records J12, J19, and J21 as `external-blocked`: evaluation preparation succeeds while external identity and provider operations remain unavailable. These scenarios must not be reported as completed live integrations.
