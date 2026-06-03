---
"@davstack/logs-server": minor
---

Add the `clean` verb + daemon auto-clean to bound the working DB.

- `clean` CLI verb: full sweep by default (drop all rows for a fresh slate) or `--window <dur>` for a retention sweep (drop rows older than the cutoff by `recv_ts`). `--mode archive|delete`. Both `VACUUM` afterward so the file actually shrinks, then best-effort `/__refresh` the daemon so its cached handle picks up the rewritten file.
- `archive` mode (default) writes a self-contained, Brotli-compressed SQL dump of the targeted rows to `<logsDir>/archive/<ts>.sql.br` before deleting — lossless, zero new dependency.
- Config keys: `autoCleanInterval` (daemon sweep cadence; unset → off), `autoCleanWindow` (retention, default `"24h"`), `cleaningMode` (default `"archive"`).
- Daemon owns an auto-clean timer that runs a windowed sweep on its own handle, with an overlap guard.
