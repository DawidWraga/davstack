---
"@davstack/init": minor
---

Install the davstack TUI (`@davstack/tui`) globally on every init run, so the
`davstack` bin (`davstack start` / `davstack check`) resolves from any repo —
freshly-init'd repos now have the orchestrator the bundled skills expect. It
ships unconditionally alongside the other global tools, independent of which
daemons were selected (it's the orchestrator, not a selectable daemon).
`printNextSteps` now points at `davstack start` (in a separate terminal) +
`davstack check` instead of the per-server `<server> check` lines.

Also update the bundled `logs-server` skill: drop the removed `logs-server
query` verbs (trace/run/errors/filter, gone since logs-server 2.1.0) and
document the current read path — reading the store directly with sqlite3
against `.davstack/logs/<db>`, mirroring the canonical skill. Adds the shared
lifecycle rule (ask the user to run `davstack start`; never run `serve`
yourself).
