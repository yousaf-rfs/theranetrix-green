# TheraNetrix hard-pass review

Reviewed September 8, 2026. This pass used three independent read-only audits, direct action/API reproductions, server-render checks, and a review of source changes. It did not use browser or clinical usability testing.

## Findings and corrections

| Finding | Correction | Verification |
| --- | --- | --- |
| Switching both AI simulators off blanked ordinary outcome metrics in the default encounter view. | Observed metrics are an assessment function independent of AI availability. Disabled simulators return no clinical findings. | Every PST/Shadow on/off combination, with assessments available and disabled. |
| Original patients could remain On track after new medication concerns or worsening outcomes. | Clinical record changes retain a pending review flag for every patient. A new clinician treatment assessment clears it. Resolving a separate escalation cannot clear it. | Medication and check-in updates on a patient without a prior structured treatment assessment, including prompts disabled. |
| Review updates erased earlier acknowledgment or resolution notes. | Server-attributed transition history retains status, rationale, actor, and time, with visible review history. Legacy current text is retained with unknown attribution labeled. | Acknowledgment, resolution, amendment, and a legacy record. |
| Medication snapshots omitted start date and reason for use. | New snapshots preserve both fields. A matching current legacy snapshot retains the known values before editing. Earlier unknown values stay unknown. | Change both fields and verify current, prior, and older snapshots. |
| Original trajectories lacked corresponding source records. | Recover missing source rows from existing saved values. Preserve user IDs, notes, times, duplicate observations, and zero scores. Recovered dates do not acquire invented times. | Idempotent recovery, source labels, and existing records preserved. |
| A new follow-up replaced prior completion context. | Task history preserves previous schedule, owner, completion, and plan link. Current scheduling retains a single current follow-up task. | Complete then reschedule; retain prior state and avoid linking unrelated tasks. |
| Changing the patient goal retained old goal evidence in the treatment form. | A changed goal starts with blank evidence. A form tied to an older goal cannot save against a different current goal. | Render the changed-goal form and reject a stale goal-specific action. |
| FDA planning omitted clinical checks that remain active with optional features off. | Always-on core review checks are included in settings, CDS review topics, open questions, and configuration snapshots. | All optional features off still includes core clinical support and its review needs. |
| Switching settings tabs lost the draft. | Keep the features pane mounted while hidden, preserving inputs across settings tabs. | Read-only review against installed Tabs behavior. |
| Trimmed saves could remain marked unsaved; stale drafts could overwrite newer configurations after retry. | Reconcile successful saves against canonical returned values. Check the configuration snapshot ID independently of workspace version. Preserve conflicting drafts until the latest configuration is loaded. | Schema normalization, configuration revision rejection, and independent state-flow review. |
| Simulator revision omitted inputs that changed findings. | Include reconciliation, pending review state, overdue state, and rule version in provenance. | Reconciliation changes findings and revision together. |
| A null request body returned a service failure. | Validate the request envelope before reading action fields. | Null, arrays, primitives, and invalid JSON return 400 without creating workspace data. |
| Patient export omitted reviews, schedule history, messages, and patient-linked audit. | Export those related records with the patient and current feature configuration, preserving patient isolation. | Export includes retained histories without another patient's records. |

## Remaining limits

- This is a synthetic evaluation app. Clinical AI services, predictive modeling, external clinical integration, production role permissions, and clinical validation remain incomplete as listed in Feature coverage.
- FDA planning is an inventory and conditional review aid. Core review checks cannot be removed by switching off optional features. No setting establishes a device classification, exclusion, enforcement-discretion conclusion, or clearance.
- Review and schedule history is retained in application records; it is not an independently immutable clinical audit store. Information overwritten before history was introduced cannot be reconstructed if no earlier source remains.
- Shared CDS screening answers do not replace function-specific assessment and evidence. Current source: [FDA Clinical Decision Support Software guidance, January 29, 2026](https://www.fda.gov/media/109618/download).
