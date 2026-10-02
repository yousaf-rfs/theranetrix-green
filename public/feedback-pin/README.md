# feedback-pin (from BidSwipe)

`fb-anchor.js` and `feedback.js` are copied from `RocketFarm/bidswipe-web`, `tools/feedback-pin/`
(commit 54acc19). `feedback.js` carries one change, marked "TheraNetrix change": an importance value
that matches no configured level (a severity saved before the app switched to request types) still
shows, with a neutral color and the label from `cfg.importanceLegacy`, and the composer lists it first
and keeps it selected, so editing only a pin's text no longer rewrites it to the first request type.
`fb-anchor.js` carries two bug fixes that should go upstream too; re-apply them if you copy a newer
file over:

- `resolve()` builds its per-flush cache key from every identity field. The upstream key,
  `a.sel || (a.attr + "=" + a.val) || a.path`, is never empty, so pins anchored only by a path all
  resolved to the first one's element.
- `observe()` starts the per-frame transform sampler only when `worldHost` is configured, instead of
  running an empty loop on every frame.

Keep TheraNetrix-specific changes in `theranetrix-config.js` and `loader.js`.

- `loader.js` (loaded from `app/layout.tsx`) loads the engine, the TheraNetrix settings, then the UI.
- `theranetrix-config.js` defines a screen as the route plus the patient-record tab, so a pin on one
  patient's Treatment tab does not show on another patient or tab, and points storage at `/api/feedback`.
- `/api/feedback` stores pins in the workspace Postgres database (`feedback_pins`), so every reviewer
  of the shared workspace sees the same pins, including whether a pin is resolved. Replies stay in
  each reviewer's browser, as they do with the upstream API backend.
- The dock sits bottom-left (`app/feedback-foundation.css`) so it does not cover the Robo Advisor.
