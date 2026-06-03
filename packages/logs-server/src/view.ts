// `view` — render one trace from the local sink as a nested waterfall, or scan
// recent traces (list / cross-runtime). Built for the browser↔server
// trace-propagation feedback loop: after a fix, `view --cross` shows whether any
// single trace now stitches browser → node → db.
//
// Output is written to `.davstack/view.md` (under the already-gitignored
// `.davstack/`) — trace tables are wide and wrap badly in a terminal; open the
// file in an editor. Each run overwrites it. `--stdout` prints instead.
//
// This module is pure of CLI parsing: `runView()` is the entry the cli-spec
// dispatches to; the render functions take an open bun:sqlite `Database` so they
// can be unit-tested against an in-memory db.

import { Database } from 'bun:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { DEFAULT_DB_DIR, defaultDbPathForRepo } from './paths.js';

//* MARK: Row shape
/** The subset of columns the renderers read. Matches `logs` table rows. */
export interface ViewRow {
  kind: string;
  msg: string;
  attrs: string | null;
  data: string | null;
  duration_ms: number | null;
  ts: number;
  span_id: string | null;
  id: number;
}

const parse = (s: string | null): Record<string, any> => {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
};
const esc = (s: string) => (s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

//* MARK: Runtime
/** Authoritative when the consumer stamped `runtime`; else a heuristic (`?`). */
export function runtimeOf(a: Record<string, any>): string {
  if (a.runtime) return a.runtime; // stamped by the consumer's Sentry config — trust it
  const o = a['sentry.origin'] || '';
  const op = a.op || a['sentry.op'] || '';
  const k = a['otel.kind'];
  if (/\.browser\./.test(o) || /^(pageload|navigation|paint|mark|resource\.|ui\.|browser\.)/.test(op)) return 'browser?';
  if (k === 'CLIENT' || op === 'http.client' || o === 'auto.http.otel.node_fetch') return 'node?'; // outbound from node
  if (k === 'SERVER' || op === 'http.server' || a['next.span_type'] != null) return 'node?';
  return '?';
}
/** Bare runtime (no `?`), for set membership when scanning. */
export const bareRuntime = (a: Record<string, any>) => runtimeOf(a).replace(/\?$/, '') || 'unknown';

/** Parent span id, dug out of the per-row data/attrs JSON. */
export function parentOf(r: Pick<ViewRow, 'data' | 'attrs'>): string {
  const d = parse(r.data);
  const a = parse(r.attrs);
  return d.parent_span_id || d?.data?.parent_span_id || a['sentry.parent_span_id'] || '';
}

//* MARK: Vitals
/**
 * Web-vitals + request summary from a ROOT span row's attrs. The sink stamps
 * these onto the root span ONLY, value-only, keyed `measurement.<vital>`
 * (LCP/FCP/TTFB/INP/FID in ms; CLS unitless) — see envelope.ts. Returns "" when
 * none present.
 */
export function vitalsLine(a: Record<string, any>): string {
  const ms = (k: string) => (typeof a[`measurement.${k}`] === 'number' ? `${Math.round(a[`measurement.${k}`])}ms` : null);
  const parts: string[] = [];
  if (ms('lcp')) parts.push(`LCP ${ms('lcp')}`);
  if (ms('fcp')) parts.push(`FCP ${ms('fcp')}`);
  if (ms('ttfb')) parts.push(`TTFB ${ms('ttfb')}`);
  if (ms('inp')) parts.push(`INP ${ms('inp')}`);
  if (ms('fid')) parts.push(`FID ${ms('fid')}`);
  if (typeof a['measurement.cls'] === 'number') parts.push(`CLS ${parseFloat(a['measurement.cls'].toFixed(4))}`);
  const req = a['request.method'] && a['request.url'] ? `${a['request.method']} ${a['request.url']}` : a['request.url'] || '';
  let line = '';
  if (parts.length) line += `vitals: ${parts.join(' · ')}`;
  if (req) line += `${line ? '  ·  ' : ''}req: ${req}`;
  return line;
}

//* MARK: Tree
/**
 * Build the DEPTH-FIRST nesting of a trace's rows. Spans/events form the tree
 * via `parentOf`; logs slot UNDER their enclosing span (by `span_id`) when
 * resolvable, else float at root by timestamp. Pure over a row array so it's
 * unit-testable without a db. Returns rows in render order, each with `depth`.
 */
export function buildTree(rows: ViewRow[]): { r: ViewRow; depth: number }[] {
  const spanRows = rows.filter((r) => r.kind === 'span' || r.kind === 'event');
  const logRows = rows.filter((r) => r.kind === 'log');
  const bySpanId = new Map<string, ViewRow>();
  for (const r of spanRows) if (r.span_id) bySpanId.set(r.span_id, r);

  // children[parentSpanId]; roots = parent empty or pointing outside this trace.
  const children = new Map<string, ViewRow[]>();
  const roots: ViewRow[] = [];
  for (const r of spanRows) {
    const p = parentOf(r);
    if (p && bySpanId.has(p)) {
      (children.get(p) ?? children.set(p, []).get(p)!).push(r);
    } else {
      roots.push(r);
    }
  }
  const logsForSpan = new Map<string, ViewRow[]>();
  const orphanLogs: ViewRow[] = [];
  for (const r of logRows) {
    if (r.span_id && bySpanId.has(r.span_id)) {
      (logsForSpan.get(r.span_id) ?? logsForSpan.set(r.span_id, []).get(r.span_id)!).push(r);
    } else {
      orphanLogs.push(r);
    }
  }
  const byTs = (a: ViewRow, b: ViewRow) => a.ts - b.ts || a.id - b.id;
  roots.sort(byTs);
  for (const arr of children.values()) arr.sort(byTs);
  for (const arr of logsForSpan.values()) arr.sort(byTs);
  orphanLogs.sort(byTs);

  const flat: { r: ViewRow; depth: number }[] = [];
  const seen = new Set<ViewRow>();
  const visit = (r: ViewRow, depth: number) => {
    if (seen.has(r)) return; // guard against pathological parent cycles
    seen.add(r);
    flat.push({ r, depth });
    for (const lg of logsForSpan.get(r.span_id ?? '') ?? []) flat.push({ r: lg, depth: depth + 1 });
    for (const c of children.get(r.span_id ?? '') ?? []) visit(c, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  for (const lg of orphanLogs) flat.push({ r: lg, depth: 0 });
  for (const r of spanRows) if (!seen.has(r)) flat.push({ r, depth: 0 }); // unreached (cycle) → flat
  return flat;
}

/** The topmost root row of a trace. */
function rootOf(rows: ViewRow[]): ViewRow | undefined {
  return buildTree(rows).find((x) => x.depth === 0)?.r;
}

/**
 * Attrs of the span that measured web vitals (the pageload / transaction
 * segment), if any. NOT necessarily the trace root: trace propagation nests the
 * browser pageload — which carries `measurement.*` — under the server root.
 */
function vitalsSegmentAttrs(rows: ViewRow[]): Record<string, any> | null {
  for (const r of rows) {
    const a = parse(r.attrs);
    if (Object.keys(a).some((k) => k.startsWith('measurement.'))) return a;
  }
  return null;
}

//* MARK: Summary
/** Distinct runtimes present in a trace, plus row/span counts. */
export function summarise(rows: { kind: string; attrs: string | null }[]) {
  const runtimes = new Set<string>();
  let spans = 0;
  for (const r of rows) {
    runtimes.add(bareRuntime(parse(r.attrs)));
    if (r.kind === 'span') spans++;
  }
  return { rows: rows.length, spans, runtimes: [...runtimes].sort() };
}

//* MARK: Waterfall
/** Render one trace's rows as a genuinely nested waterfall table. */
export function renderWaterfall(rows: ViewRow[], opts: { showIds?: boolean; limit?: number } = {}): { md: string; n: number; vitals: string } {
  if (!rows.length) return { md: '_no rows for this trace_\n', n: 0, vitals: '' };
  const t0 = Math.min(...rows.map((r) => r.ts));
  const flat = buildTree(rows);
  const use = opts.limit ? flat.slice(0, opts.limit) : flat;

  const head = opts.showIds
    ? `| +ms | runtime | kind | op / type | dur(ms) | span | parent | msg |\n|----:|---------|------|-----------|--------:|------|--------|-----|\n`
    : `| +ms | runtime | kind | op / type | dur(ms) | msg |\n|----:|---------|------|-----------|--------:|-----|\n`;
  let md = head;
  for (const { r, depth } of use) {
    const a = parse(r.attrs);
    const off = Math.round((r.ts - t0) * 1000);
    const dur = r.duration_ms != null ? Math.round(r.duration_ms) : (a.durationMs ?? '');
    const op = esc(a.op || a['sentry.op'] || a['next.span_type'] || '').slice(0, 32);
    const prefix = depth > 0 ? `${'  '.repeat(depth - 1)}└─ ` : '';
    const msg = prefix + esc(r.msg).slice(0, 70);
    if (opts.showIds) {
      const sp = (r.span_id || '').slice(0, 8);
      const pa = (parentOf(r) || '').slice(0, 8);
      md += `| ${off} | ${runtimeOf(a)} | ${r.kind} | ${op} | ${dur} | ${sp} | ${pa} | ${msg} |\n`;
    } else {
      md += `| ${off} | ${runtimeOf(a)} | ${r.kind} | ${op} | ${dur} | ${msg} |\n`;
    }
  }
  if (opts.limit && flat.length > opts.limit) {
    md += `| … | | | | ${opts.showIds ? '| | ' : ''}| _(${flat.length - opts.limit} more rows)_ |\n`;
  }
  // Vitals live on the transaction segment that measured them — in a propagated
  // cross-runtime trace that's the browser pageload, which gets re-parented under
  // the server root, so it is NOT rootOf(rows). Find the segment carrying
  // measurements; fall back to the root for request context on vitals-less traces.
  const root = rootOf(rows);
  const vitalsAttrs = vitalsSegmentAttrs(rows) ?? (root ? parse(root.attrs) : {});
  const vitals = vitalsLine(vitalsAttrs);
  return { md, n: rows.length, vitals };
}

//* MARK: DB queries
const traceRows = (db: Database, traceId: string): ViewRow[] =>
  db.query('SELECT kind,msg,attrs,data,duration_ms,ts,span_id,id FROM logs WHERE trace_id=? ORDER BY ts,id').all(traceId) as ViewRow[];

const recentTraces = (db: Database, n: number) =>
  db
    .query("SELECT trace_id, MAX(recv_ts) AS last, COUNT(*) AS rows FROM logs WHERE trace_id!='' GROUP BY trace_id ORDER BY last DESC LIMIT ?")
    .all(n) as { trace_id: string; last: number; rows: number }[];

const summaryRows = (db: Database, traceId: string) =>
  db.query('SELECT kind,attrs FROM logs WHERE trace_id=?').all(traceId) as { kind: string; attrs: string | null }[];

//* MARK: Renderers
export function renderTrace(db: Database, traceId: string, dbName: string, opts: { showIds?: boolean; limit?: number } = {}): string {
  const s = summarise(summaryRows(db, traceId));
  if (!s.rows) return `# trace ${traceId}\n\n_no rows in db "${dbName}"_\n`;
  const { md, n, vitals } = renderWaterfall(traceRows(db, traceId), opts);
  const vitalsHeader = vitals ? `${vitals}\n\n` : '';
  return `# trace ${traceId}\n\n${n} rows · ${s.spans} spans · runtimes: ${s.runtimes.join(', ')}\n\n${vitalsHeader}${md}`;
}

export function renderList(db: Database, n: number, dbName: string): string {
  const traces = recentTraces(db, n);
  let md = `# ${traces.length} most-recent traces  (db: ${dbName})\n\n`;
  md += '| trace_id | rows | spans | runtimes |\n|----------|-----:|------:|----------|\n';
  for (const t of traces) {
    const s = summarise(summaryRows(db, t.trace_id));
    md += `| ${t.trace_id} | ${s.rows} | ${s.spans} | ${s.runtimes.join(', ')} |\n`;
  }
  return md;
}

export function renderCross(db: Database, n: number, dbName: string): string {
  const traces = recentTraces(db, n);
  const multi: { trace_id: string; runtimes: string[]; rows: number }[] = [];
  let browserAndNode = 0;
  for (const t of traces) {
    const s = summarise(summaryRows(db, t.trace_id));
    const real = s.runtimes.filter((r) => r !== 'unknown');
    if (real.length > 1) {
      multi.push({ trace_id: t.trace_id, runtimes: s.runtimes, rows: s.rows });
      if (real.includes('browser') && real.includes('node')) browserAndNode++;
    }
  }
  let md = `# Cross-runtime traces in the last ${traces.length} traces  (db: ${dbName})\n\n`;
  md += `browser+node traces: **${browserAndNode}**   ·   any-multi-runtime traces: **${multi.length}**\n\n`;
  if (!multi.length) return `${md}⚠️  No trace spans more than one runtime — propagation is NOT working yet.\n`;
  md += '| trace_id | rows | runtimes |\n|----------|-----:|----------|\n';
  for (const m of multi) md += `| ${m.trace_id} | ${m.rows} | ${m.runtimes.join(', ')} |\n`;
  if (browserAndNode > 0) md += `\n✅ ${browserAndNode} trace(s) stitch browser ↔ node.\n`;
  return md;
}

//* MARK: Path resolution
/**
 * Resolve the sink db. `--db` accepts a bare session name (→
 * `.davstack/logs/<name>.db`) for the per-session convention, or a path/abs file
 * passed straight through. Default: `<cwd>/.davstack/logs/default.db`.
 */
export function resolveDbPath(opts: { db?: string; cwd: string }): { path: string; name: string } {
  const { db, cwd } = opts;
  if (!db || !db.trim()) return { path: defaultDbPathForRepo(cwd), name: 'default' };
  const v = db.trim();
  if (!v.includes('/') && !v.includes('\\') && !v.endsWith('.db')) {
    return { path: join(cwd, DEFAULT_DB_DIR, `${v}.db`), name: v };
  }
  const path = isAbsolute(v) ? v : resolve(cwd, v);
  return { path, name: v.replace(/\\/g, '/').split('/').pop()!.replace(/\.db$/, '') };
}

//* MARK: Entry
export interface RunViewOpts {
  trace?: string;
  list?: boolean;
  cross?: boolean;
  n?: number;
  limit?: number;
  ids?: boolean;
  out?: string;
  stdout?: boolean;
  db?: string;
  cwd?: string;
}

export async function runView(opts: RunViewOpts): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const { path: dbFile, name: dbName } = resolveDbPath({ db: opts.db, cwd });
  let db: Database;
  try {
    db = new Database(dbFile, { readonly: true });
  } catch {
    process.stderr.write(`[logs-server] view: cannot open db ${dbFile}\n`);
    return 1;
  }

  let md: string;
  let summary: string;
  if (opts.list) {
    const n = opts.n ?? 20;
    md = renderList(db, n, dbName);
    summary = `${n} recent traces`;
  } else if (opts.cross) {
    const n = opts.n ?? 200;
    md = renderCross(db, n, dbName);
    summary = `cross-runtime scan (last ${n})`;
  } else if (opts.trace) {
    md = renderTrace(db, opts.trace, dbName, { showIds: opts.ids, limit: opts.limit });
    summary = `trace ${opts.trace}`;
  } else {
    db.close();
    process.stderr.write('usage: logs-server view <trace_id> | --list | --cross  (see --help)\n');
    return 2;
  }
  db.close();

  if (opts.stdout) {
    process.stdout.write(md.endsWith('\n') ? md : `${md}\n`);
    return 0;
  }
  const out = opts.out ?? join('.davstack', 'view.md');
  const dir = dirname(out);
  if (dir && dir !== '.') mkdirSync(dir, { recursive: true });
  writeFileSync(out, md);
  process.stdout.write(`wrote ${out}  (${summary})\n`);
  return 0;
}
