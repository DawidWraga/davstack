---
"@davstack/logs-server": minor
---

Ingest Sentry `event` envelope items (real exceptions) as a new `kind:'event'` row.

Previously the parser persisted only `log`, `transaction`, and `span` items — Sentry packages a real exception (`captureException`, unhandled rejections, React error boundaries, automatic capture) as an envelope item of `type:"event"`, which was silently dropped. So local error events vanished; only error-*level* console logs survived.

The parser now ingests `type:"event"` items and persists them discriminably as `kind:'event'`:

- **msg**: `"{type}: {value}"` of the innermost `exception.values[]` entry; `message`/`logentry.formatted` for `captureMessage`; falls back to `event_id`.
- **level** + **severity_number**: from `event.level`, mapped to OTel (fatal=21, error=17, warning=13, info=9).
- **trace_id**/**span_id**: from `contexts.trace` (header `trace.trace_id` fallback), so events correlate with logs/spans of the same request.
- **data**: the verbatim event JSON — the full `exception`/`stacktrace` is kept intact.
- **attrs**: headline fields (`exception_type`, `mechanism`, `handled`, `culprit`, top `in_app` frame).
- Honors the `davstack-logs.db` routing hint and `diag.tag` from the event's `tags`.

No DB migration needed — `kind` is a free-text column.
