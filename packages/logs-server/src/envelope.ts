// The Sentry telemetry-envelope parser. Deliberately Sentry-coupled (notes 03),
// and deliberately TOLERANT: it never throws to the caller and never drops a
// whole batch for one bad line — a malformed/unknown line is skipped, an
// unsupported item type is ignored, the full record is always kept verbatim in
// `data`.
//
// Wire format (notes 03): newline-delimited JSON — an envelope header line,
// then (item header, item payload) line pairs. Two item types are persisted:
//
//   type:"log" payload = `{ items: [ <log>, ... ] }` → one `kind:'log'` row per
//     item (severity, body, OTel {value,type} attributes).
//
//   type:"transaction" payload = a transaction *event* (Sentry tracing). Shape
//     captured live from @sentry/node 10.16.0 (real wire, not a guess):
//       { transaction, start_timestamp, timestamp, type:"transaction",
//         contexts: { trace: { trace_id, span_id, parent_span_id?, op, status,
//                              origin, data } },
//         spans: [ { span_id, parent_span_id, trace_id, op, description, status,
//                    origin, start_timestamp, timestamp, data } ... ] }
//     → ROOT row from `contexts.trace` (timing from top-level start/timestamp)
//       PLUS one row per `spans[]` entry. Each is a `kind:'span'` row.
//     `type:"span"` standalone items (Sentry's newer span-streaming protocol)
//     are handled defensively as a single span.
//
// Span `data` is a PLAIN object (NOT the log {value,type} wrapper) — it gets its
// own flattener; the log unwrap is never applied to it.

import type { LogRow } from './db.js';

// `routeDb` is a daemon-internal field — it drives multi-DB dispatch and is
// stripped from the row's `data` before persistence (the file IS the session
// indicator). Never written to the `logs` table.
export type ParsedLog = Omit<LogRow, 'recv_ts'> & { routeDb?: string };

type Attr = { value?: unknown; type?: string };

const ROUTE_DB_ATTR = 'davstack-logs.db';

function strOr(v: unknown, d: string): string {
  return v === undefined || v === null ? d : String(v);
}

// Strip a leading ANSI styled prefix shaped like `\x1b[<style>m%s\x1b[0m ` —
// pure rendering noise from console-monkey-patchers upstream of the JS
// `consoleLoggingIntegration` (React DevTools / HMR / the `debug` package
// guessing "node" instead of "browser"). Anchored at the start; requires a
// matching reset, so mid-string inline ANSI is preserved. Stripping (not
// dropping) means we never lose signal in the worst case. Applied to `msg`
// only — the verbatim record is still preserved in `data`.
const STYLED_PREFIX = /^\x1b\[[0-9;:]*m.*?\x1b\[0m\s?/;
function stripStyledLogPrefix(s: string): string {
  return s.replace(STYLED_PREFIX, '');
}

function attrVal(attrs: Record<string, Attr> | undefined, key: string): unknown {
  return attrs && attrs[key] ? attrs[key].value : undefined;
}

// Flatten OTel-wrapped attributes into a plain key→value map. Returns null
// when there's nothing to flatten — matches the old logs_v view's CASE
// semantics (NULL for missing-or-empty, not "{}").
function flattenAttrs(attrs: Record<string, Attr> | undefined): string | null {
  if (!attrs) return null;
  const keys = Object.keys(attrs);
  if (keys.length === 0) return null;
  const flat: Record<string, unknown> = {};
  for (const k of keys) flat[k] = attrs[k]?.value;
  return JSON.stringify(flat);
}

function toRow(rec: Record<string, unknown>, sdkName: string, envTraceId: string): ParsedLog {
  const attrs = (rec.attributes as Record<string, Attr> | undefined) ?? undefined;
  const sev = rec.severity_number;
  const diagTag = attrVal(attrs, 'diag.tag');

  // Pull the routing hint and remove it before serializing — the persisted
  // record carries no trace of which DB it landed in. Operate on a shallow
  // copy of `attributes` so we don't mutate the caller's object.
  let routeDb: string | undefined;
  let recForPersist: Record<string, unknown> = rec;
  let attrsForFlatten: Record<string, Attr> | undefined = attrs;
  if (attrs && ROUTE_DB_ATTR in attrs) {
    const v = attrs[ROUTE_DB_ATTR]?.value;
    if (typeof v === 'string' && v.length > 0) routeDb = v;
    const { [ROUTE_DB_ATTR]: _drop, ...rest } = attrs;
    void _drop;
    recForPersist = { ...rec, attributes: rest };
    attrsForFlatten = rest;
  }

  return {
    ts: typeof rec.timestamp === 'number' ? rec.timestamp : Number(rec.timestamp) || 0,
    kind: 'log',
    project: strOr(attrVal(attrs, 'diag.project'), ''),
    service: sdkName,
    run_id: strOr(attrVal(attrs, 'diag.run_id'), ''),
    trace_id: strOr(rec.trace_id ?? envTraceId, ''),
    span_id: strOr(rec.span_id, ''),
    level: strOr(rec.level, ''),
    severity_number: typeof sev === 'number' && Number.isFinite(sev) ? sev : 0,
    logger: strOr(attrVal(attrs, 'sentry.origin'), ''),
    msg: stripStyledLogPrefix(strOr(rec.body, '')),
    data: JSON.stringify(recForPersist), // verbatim — minus the routing key
    attrs: flattenAttrs(attrsForFlatten),
    tag: diagTag === undefined || diagTag === null ? null : String(diagTag),
    duration_ms: null,
    routeDb,
  };
}

//* MARK: Spans

// A span row carries no severity and no OTel-wrapped attributes — its `data` is
// the verbatim span/transaction-trace object. We surface the span's headline
// fields (op, status, parent, description, duration_ms) into the flat `attrs`
// JSON so they're `json_extract`-queryable alongside the span's own plain data.

// Flatten a span's plain `data` object (NO {value,type} unwrap — that's
// log-only) into a flat map, merged with the span-specific headline fields.
// Returns null only when there is genuinely nothing to record.
function flattenSpanAttrs(
  spanData: Record<string, unknown> | undefined,
  headline: Record<string, unknown>,
): string | null {
  const flat: Record<string, unknown> = {};
  if (spanData) for (const k of Object.keys(spanData)) flat[k] = spanData[k];
  for (const k of Object.keys(headline)) {
    if (headline[k] !== undefined && headline[k] !== null) flat[k] = headline[k];
  }
  if (Object.keys(flat).length === 0) return null;
  return JSON.stringify(flat);
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function durationMs(start: unknown, end: unknown): number | null {
  const s = num(start);
  const e = num(end);
  if (s === undefined || e === undefined) return null;
  return (e - s) * 1000;
}

// Build one span row. `spanObj` is the verbatim span (or trace context) object;
// `msg` is its display string; `start`/`end` give the timing. The
// `davstack-logs.db` routing hint and diag.* attribution are pulled from the
// span's plain `data` (analogous to logs), stripped from the persisted copy.
function spanRow(opts: {
  spanObj: Record<string, unknown>;
  msg: string;
  start: unknown;
  end: unknown;
  sdkName: string;
  envTraceId: string;
}): ParsedLog {
  const { spanObj, msg, start, end, sdkName, envTraceId } = opts;
  const rawData = (spanObj.data as Record<string, unknown> | undefined) ?? undefined;

  // Pull routing + attribution from the span's plain data, then strip the
  // routing key from the persisted copy (the DB file is the session indicator).
  let routeDb: string | undefined;
  let dataForPersist: Record<string, unknown> | undefined = rawData;
  let objForPersist: Record<string, unknown> = spanObj;
  if (rawData && ROUTE_DB_ATTR in rawData) {
    const v = rawData[ROUTE_DB_ATTR];
    if (typeof v === 'string' && v.length > 0) routeDb = v;
    const { [ROUTE_DB_ATTR]: _drop, ...rest } = rawData;
    void _drop;
    dataForPersist = rest;
    objForPersist = { ...spanObj, data: rest };
  }

  const dur = durationMs(start, end);
  const diagTag = dataForPersist?.['diag.tag'];
  const op = dataForPersist?.['sentry.op'] ?? spanObj.op;
  const headline: Record<string, unknown> = {
    op: op ?? undefined,
    status: spanObj.status,
    parent_span_id: spanObj.parent_span_id,
    description: spanObj.description,
    duration_ms: dur ?? undefined,
  };

  return {
    ts: num(start) ?? 0,
    kind: 'span',
    project: strOr(dataForPersist?.['diag.project'], ''),
    service: sdkName,
    run_id: strOr(dataForPersist?.['diag.run_id'], ''),
    trace_id: strOr(spanObj.trace_id ?? envTraceId, ''),
    span_id: strOr(spanObj.span_id, ''),
    level: '', // spans carry no level; discriminate via kind='span'
    severity_number: 0,
    logger: strOr(dataForPersist?.['sentry.origin'] ?? spanObj.origin ?? sdkName, ''),
    msg,
    data: JSON.stringify(objForPersist), // verbatim — minus the routing key
    attrs: flattenSpanAttrs(dataForPersist, headline),
    tag: diagTag === undefined || diagTag === null ? null : String(diagTag),
    duration_ms: dur,
    routeDb,
  };
}

// Expand a transaction event into its span rows: the ROOT (from
// `contexts.trace`, timed by the event's top-level start/timestamp) plus one
// row per `spans[]` child (each self-timed). Emitted in that order.
function transactionRows(
  tx: Record<string, unknown>,
  sdkName: string,
  envTraceId: string,
): ParsedLog[] {
  const out: ParsedLog[] = [];
  const trace = (tx.contexts as Record<string, unknown> | undefined)?.trace as
    | Record<string, unknown>
    | undefined;

  if (trace && typeof trace === 'object') {
    const op = (trace.data as Record<string, unknown> | undefined)?.['sentry.op'] ?? trace.op;
    const rootMsg = strOr(tx.transaction ?? op, '');
    out.push(
      spanRow({
        spanObj: trace,
        msg: rootMsg,
        start: tx.start_timestamp,
        end: tx.timestamp,
        sdkName,
        envTraceId,
      }),
    );
  }

  const spans = tx.spans;
  if (Array.isArray(spans)) {
    for (const s of spans) {
      if (!s || typeof s !== 'object') continue;
      const span = s as Record<string, unknown>;
      const op = (span.data as Record<string, unknown> | undefined)?.['sentry.op'] ?? span.op;
      const msg = strOr(span.description ?? op, '');
      out.push(
        spanRow({
          spanObj: span,
          msg,
          start: span.start_timestamp,
          end: span.timestamp,
          sdkName,
          envTraceId,
        }),
      );
    }
  }
  return out;
}

function tryParse(line: string): unknown | undefined {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

export function parseEnvelope(raw: string): { rows: ParsedLog[]; skipped: number } {
  const rows: ParsedLog[] = [];
  let skipped = 0;

  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { rows, skipped };

  const header = (tryParse(lines[0]) as Record<string, any>) ?? {};
  const sdkName = strOr(header?.sdk?.name, '');
  const envTraceId = strOr(header?.trace?.trace_id, '');

  // Walk the remaining lines as (item header, item payload) pairs.
  for (let i = 1; i < lines.length; ) {
    const itemHeader = tryParse(lines[i]) as Record<string, unknown> | undefined;
    if (!itemHeader || typeof itemHeader !== 'object') {
      skipped += 1; // unparseable header line — skip just this line
      i += 1;
      continue;
    }
    const payload = tryParse(lines[i + 1] ?? '');
    i += 2; // a well-formed item consumes header + payload

    if (itemHeader.type === 'log') {
      const items = (payload as { items?: unknown[] } | undefined)?.items;
      if (!Array.isArray(items)) {
        skipped += 1; // log item header but unusable payload
        continue;
      }
      for (const entry of items) {
        if (entry && typeof entry === 'object') {
          rows.push(toRow(entry as Record<string, unknown>, sdkName, envTraceId));
        } else {
          skipped += 1;
        }
      }
      continue;
    }

    if (itemHeader.type === 'transaction') {
      // A transaction event expands to its root + child span rows.
      if (payload && typeof payload === 'object') {
        rows.push(...transactionRows(payload as Record<string, unknown>, sdkName, envTraceId));
      } else {
        skipped += 1; // transaction header but unusable payload
      }
      continue;
    }

    if (itemHeader.type === 'span') {
      // Standalone span item (Sentry's newer span-streaming protocol) — a
      // single plain span object, no transaction envelope around it.
      if (payload && typeof payload === 'object') {
        const span = payload as Record<string, unknown>;
        const op = (span.data as Record<string, unknown> | undefined)?.['sentry.op'] ?? span.op;
        rows.push(
          spanRow({
            spanObj: span,
            msg: strOr(span.description ?? op, ''),
            start: span.start_timestamp,
            end: span.timestamp,
            sdkName,
            envTraceId,
          }),
        );
      } else {
        skipped += 1;
      }
      continue;
    }

    // Any other item type (event, profile, session, ...) is ignored.
  }

  return { rows, skipped };
}
