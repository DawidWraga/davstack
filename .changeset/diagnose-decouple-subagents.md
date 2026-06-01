---
"@davstack/init": patch
---

diagnose skill: decouple from the `fast-edit`/`explore` skills (no longer assumes them by name — just "delegate to a subagent") and drop the removed `diag query` verb (read path is `sqlite3`).
