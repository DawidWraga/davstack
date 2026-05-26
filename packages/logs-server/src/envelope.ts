// The Sentry log-envelope parser. Deliberately Sentry-coupled (notes 03), and
// deliberately TOLERANT: it never throws to the caller and never drops a whole
// batch for one bad line — a malformed/unknown line is skipped, a non-`log`
// item is ignored, the full log record is always kept verbatim in `data`.
// Wire format (notes 03): newline-delimited JSON — an envelope header line,
// then (item header, item payload) line pairs; a `log` payload is
// `{ items: [ <log>, ... ] }`.

import type { LogRow } from './db.js';

export type ParsedLog = Omit<LogRow, 'recv_ts'>;

type Attr = { value?: unknown; type?: string };

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

function toRow(rec: Record<string, unknown>, sdkName: string, envTraceId: string): ParsedLog {
  const attrs = (rec.attributes as Record<string, Attr> | undefined) ?? undefined;
  const sev = rec.severity_number;
  const diagTag = attrVal(attrs, 'diag.tag');
  return {
    ts: typeof rec.timestamp === 'number' ? rec.timestamp : Number(rec.timestamp) || 0,
    project: strOr(attrVal(attrs, 'diag.project'), ''),
    service: sdkName,
    run_id: strOr(attrVal(attrs, 'diag.run_id'), ''),
    trace_id: strOr(rec.trace_id ?? envTraceId, ''),
    span_id: strOr(rec.span_id, ''),
    level: strOr(rec.level, ''),
    severity_number: typeof sev === 'number' && Number.isFinite(sev) ? sev : 0,
    logger: strOr(attrVal(attrs, 'sentry.origin'), ''),
    msg: stripStyledLogPrefix(strOr(rec.body, '')),
    data: JSON.stringify(rec), // verbatim — round-trips deep-equal
    tag: diagTag === undefined || diagTag === null ? null : String(diagTag),
  };
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
    if (itemHeader.type !== 'log') continue; // ignore non-log items
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
  }

  return { rows, skipped };
}
