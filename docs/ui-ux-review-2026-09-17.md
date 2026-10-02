# UI/UX review — 17 September 2026

Six independent agents reviewed navigation, encounters, results/treatment, patient coordination, decisions, and program administration. The review started from GitHub PR #7 at `6b96e8f3c1c101c7f0d4cf05075542bc14ca95d5`. The source review found material usability defects despite the existing navigation checks passing. This follow-up fixes those defects; it does not constitute a visual or clinical release sign-off.

## Findings addressed

| Area | Confirmed problem | Change |
| --- | --- | --- |
| Saving | Automatic reload after a conflicting save remounted version-keyed editors and discarded drafts. | Keep the current workspace and unfinished fields, stop further saves, and make loading the newer records an explicit, confirmed action. Entry dialogs expose recovery inside the modal. This is discard-and-reload recovery, not automatic merging. |
| Patient context | Explicit unavailable patient links opened the first patient's writable companion or message thread. | Reject unavailable context and require an available patient selection. |
| Scheduling and queues | New activities/escalations from patient-filtered views defaulted to another patient. Schedule ignored its patient query. | Filter the schedule by the selected patient and carry that patient into creation forms. |
| Mobile schedule | Responsive styles hid the patient identity; selected date text had poor contrast. | Keep names and statuses in the compact grid, improve selected-date colors and expose the selection with `aria-pressed`. |
| Navigation | Leaving a guided record view could unmount an unfinished workflow. Some Decisions journey links did not find their legends. | Preserve mounted workflow editors across view changes; locate and focus headings, legends and nested disclosures. The compact search control has an accessible name. |
| Connection entry | Two independent connection editors could appear in settings; a closed workbench did not reliably reopen. | One editor, with an explicit open-domain event that validates the destination and focuses its selector. |
| Messages | Successful sending could erase text typed during the request. | Lock the composer during sending, clear only the submitted draft, and keep inline failure feedback. |
| Encounters | Closed-episode observation corrections sent the save command that the domain rejects. | Use the supported attributable correction command and explain when there is no recorded observation to correct. |
| Entry dialogs | Escape, backdrop or close discarded unfinished notes. | Ask whether to keep editing or discard. Saving cannot dismiss the editor. Goal editing follows Spanish patient preference. |
| Encounter errors | Raw schema feedback was detached from the active form. | Show concise, announced errors and focus the error summary. |
| Remote visits | The displayed interrupted visit and the encounter used by Save could differ. | Choose an explicit encounter, initialize from that visit and update that exact record. Priya's recovery is tested against her original interruption. |
| Care operations | Unrelated forms shared owner/reason/date fields and defaulted saved paused/interrupted states to active/scheduled. | Separate source-aware drafts for each form, initialize from saved states, preserve dirty changes and block overwriting a changed source without review. |
| Handoffs | Opening an older queue concern selected the patient's newest handoff. | Pass and validate the exact patient-owned handoff record ID. Invalid or foreign IDs block the editor. |
| Proxy and pathways | Documented proxy status implied it changed grants; the local-checklist option could not be restored. | Explain the documentation/access distinction and restore the local checklist draft when selected. |
| Decisions | Typing an encounter ID remounted the editor on every keystroke. | Stage the selection and switch explicitly, with dirty/pending-save protection. |
| Twin labels | An automatically calculated comparison line was called an agreed target. | Call it an illustrative comparison target. |
| Trace/history | New immutable signed decisions were absent from the older trace view. | Show patient- and run-scoped signatures and preserve their original signed instructions; retain unlinked historical signatures separately. |
| Results/referrals | Suggested next actions contradicted request acceptance, coverage, e-consult and communication gates. | Match guidance and visible forms to the domain's actual permitted transitions. |
| Treatment selection | Several source choices had indistinguishable labels. | Include kind, clinical subject, owner, version and reference. |
| Long workflow panels | Update editors were hard to locate and six treatment forms stayed expanded. | Focus the selected editor and use native disclosures while keeping the draft fields mounted. Narrow form grids stack. |
| Follow-up completion | The access-response follow-up had no domain completion action but its schedule checkbox was locked. | Permit completion only for the exact current access-response task with a validated actual-start source. Keep source-owned barrier, start and medication-review tasks locked and retain workflow navigation. |
| Feature/service status | Static activity times and enabled-only badges contradicted saved data and governance restrictions. | Derive activity from saved runs/exchanges and distinguish enabled settings from current usability, with reasons and governance links. |
| Quarantine review | A correction could be confirmed without inspecting report values or its target. | Show source, target, values, units and timestamps and require an explicit target-patient acknowledgment. Label connection mode as applying across the workspace. |
| Governance creation | A successful new record left the filled creation form active, allowing duplicate creation. | Resolve the exact saved request receipt, select the created record and focus its next-action heading. |

## Verification and its limits

- The implementation includes regression coverage for component handlers/state, rendered markup, navigation transitions and real domain actions. Component harnesses are not browser automation and do not verify layout or actual focus behavior.
- The full production build, TypeScript check and repository tests are the combined verification gate. The PR records the completed results and the cloud run for the pushed commit.
- The pre-review GitHub Journey QA run #50 passed 35 browser navigation checks. Those checks use a mocked workspace API and establish navigation/basic viewport behavior, not end-to-end persistence of the new forms.
- The run's screenshot artifact was located, but downloading the returned file was denied with HTTP 403. No screenshots were inspected in this review. The previously denied local browser target was not retried through another browser, tunnel or proxy.
- The saved app's Sites project was unavailable at the preceding publication attempt. Code in PR #7 is not evidence of a published or merged app.

## Remaining usability work

1. Review actual desktop and mobile screens, keyboard/tab order, screen-reader announcements, touch targets, scroll behavior and all nested modal/disclosure interactions in an approved browser. Include persisted save/retry/conflict flows against the real workspace API.
2. Replace technical encounter/configuration/evidence IDs and pipe-delimited inputs with named selectors or structured rows where the remaining forms still require transcription.
3. Simplify result deadline/timezone entry and avoid duplicate deadline fields; improve field-level validation and linked error summaries beyond the encounter forms.
4. Add accessible dated chart-value tables and finish Spanish chart/date labels. The Spanish goal editor is addressed; this is not a claim of complete localization.

These remaining items are visible follow-up work. The review should not be summarized as “all UI/UX is good.”
