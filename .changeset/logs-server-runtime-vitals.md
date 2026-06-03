---
"@davstack/logs-server": minor
---

Enrich telemetry rows with a `runtime` column and root-span transaction metadata.

- **`runtime` column** (`browser | node | edge`): added to every row (spans, logs, events) with an idempotent `ALTER` migration. The shred can't recover the runtime from per-span fields once a transaction is expanded, so the consumer stamps it (Sentry `beforeSendLog` / `beforeSendTransaction`) and the parser persists it into a first-class column for trivial filtering (`WHERE runtime='browser'`) instead of digging through `attrs`.
- **Web vitals + request on the root span**: `transactionRows()` now reads `tx.measurements` (numeric web vitals → `attrs["measurement.<vital>"]`, value-only: LCP/FCP/TTFB/INP/FID in ms, CLS unitless) and `tx.request` (→ `attrs["request.url"]` / `["request.method"]`), attaching them to the **root span row only** — no child duplication, no new columns. This is the "enriched root span" model (spans are the primitive; the segment/root span carries what the transaction used to), recovering the perf data the transaction→span shred otherwise drops.
- Docs: `reading-logs.md` gains a section on the root transaction metadata + a recursive-CTE query for reconstructing the span tree from the flat table.
