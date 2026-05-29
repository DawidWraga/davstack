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

Also bring the bundled `logs-server`, `vitest-server`, and `playwright-server`
skills in line with the canonical skills: drop the removed `logs-server query`
verbs (trace/run/errors/filter, gone since logs-server 2.1.0) in favour of
reading the store directly with sqlite3 against `.davstack/logs/<db>`; remove
the `serve &` / per-server `check` recipes; and add the shared lifecycle rule
(ask the user to run `davstack start` in a separate terminal; never run
`serve` yourself). The playwright skill also drops the obsolete "only the first
top-level `test()`" limitation.
