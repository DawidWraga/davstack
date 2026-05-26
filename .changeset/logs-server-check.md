---
'@davstack/logs-server': minor
---

Add `check` verb for install validation. Run `npx logs-server check` (or
`--json`) to probe a real install in one shot: Node version (gate >=20),
config file resolution, DB file existence + lifetime + last-300s row
counts, and daemon liveness via `GET /` to the resolved port.

Pretty output uses three glyphs to distinguish severities:

- `✓` — passing gate.
- `~` — advisory: gate passes but the row carries a `fix:` hint (e.g.
  daemon not running, but exit code stays 0).
- `✗` — hard failure (e.g. Node too old), flips aggregate `ok: false`.

The stale-rows `fix:` hint ("no rows in last 300s — verify transmitter
DSN") is suppressed when the daemon is up and lifetime rows > 0 — that
combination is "idle dev sink", not a broken transmitter. It still
fires when the DB has zero rows total.

`--json` emits a structured `CheckResult` for agent/script consumers.
Port resolves via flag > `DIAG_*` env > config > default.
