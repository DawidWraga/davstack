// Resolve a `davstack-logs.db` routing value (the per-session/per-bug log DB
// hint emitted by the transmitter) into an absolute path on disk.
//
// Inputs are untrusted: the value originates in browser code and rides through
// the Sentry envelope as an opaque attribute. The pipeline therefore must
// reject anything pathological (absolute paths, drive prefixes, mixed case,
// stray whitespace) and contain the result inside the repo root — including
// when the `..` traversal escape is used for eval co-location.
//
// On reject: caller routes to default.db. We warn-once per unique invalid
// value to avoid spam from a misconfigured transmitter looping the same
// envelope thousands of times.

import { resolve, sep } from 'node:path';

export type RouteResult =
  | { ok: true; path: string }
  | { ok: false; reason: string };

export type RouteOptions = {
  warn?: (msg: string) => void;
};

const SEGMENT_RE = /^[a-z0-9][a-z0-9_-]*$/;
const ABS_PREFIXES = [/^\//, /^[A-Za-z]:/];

const warnedValues = new Set<string>();

export function _resetWarnOnceForTests(): void {
  warnedValues.clear();
}

function classify(value: string): { ok: true } | { ok: false; reason: string } {
  if (value.length === 0) return { ok: false, reason: 'empty value' };
  for (const re of ABS_PREFIXES) {
    if (re.test(value)) return { ok: false, reason: 'absolute path not allowed' };
  }
  // The final segment may end in `.db` (idempotency for users who type the
  // suffix). Strip it for charset purposes; reappended in resolveRoutedDb.
  const segments = value.replace(/\\/g, '/').split('/');
  if (segments.length > 0) {
    const last = segments[segments.length - 1];
    if (last.endsWith('.db')) segments[segments.length - 1] = last.slice(0, -3);
  }
  for (const seg of segments) {
    if (seg === '.' || seg === '..') continue;
    if (!SEGMENT_RE.test(seg)) {
      return { ok: false, reason: `charset (segment "${seg}" must match ${SEGMENT_RE})` };
    }
  }
  return { ok: true };
}

export function resolveRoutedDb(
  value: string,
  repoRoot: string,
  opts: RouteOptions = {},
): RouteResult {
  const verdict = classify(value);
  if (!verdict.ok) {
    return warnOnceAndReject(value, verdict.reason, opts);
  }

  const withSuffix = value.endsWith('.db') ? value : `${value}.db`;
  const abs = resolve(repoRoot, '.davstack', 'logs', withSuffix);

  // Containment: the resolved path must live inside the repo root. The trailing
  // sep guards against `<repoRoot>/foo` matching `<repoRoot>foo-evil`.
  const rootWithSep = repoRoot.endsWith(sep) ? repoRoot : repoRoot + sep;
  if (!abs.startsWith(rootWithSep) && abs !== repoRoot) {
    return warnOnceAndReject(value, 'escapes repo root', opts);
  }
  return { ok: true, path: abs };
}

function warnOnceAndReject(
  value: string,
  reason: string,
  opts: RouteOptions,
): RouteResult {
  if (!warnedValues.has(value)) {
    warnedValues.add(value);
    const msg = `[logs-server] invalid db "${value}": ${reason}; routing to default.db`;
    if (opts.warn) opts.warn(msg);
    else process.stderr.write(msg + '\n');
  }
  return { ok: false, reason };
}
