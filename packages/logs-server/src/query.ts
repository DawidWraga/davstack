// Retrieval layer: the canned cuts + correlation-grouped formatting. Every
// cut is strictly scoped by `project` (one DB serves all repos) plus a
// correlation key (run_id / trace_id), so a colliding id in another repo or
// run can never bleed in. Output has two shapes: `compact` (one line per
// row, agent-consumable) and human (grouped by service).

import type { Database } from 'bun:sqlite';
import type { LogRow } from './db.ts';

const ERROR_LEVELS = new Set(['error', 'fatal']);

export function runTimeline(
  db: Database,
  o: { project: string; run_id: string },
): LogRow[] {
  return db
    .query('SELECT * FROM logs WHERE project = ? AND run_id = ? ORDER BY ts, id')
    .all(o.project, o.run_id) as LogRow[];
}

export function traceAssembly(
  db: Database,
  o: { project: string; trace_id: string },
): LogRow[] {
  return db
    .query('SELECT * FROM logs WHERE project = ? AND trace_id = ? ORDER BY ts, id')
    .all(o.project, o.trace_id) as LogRow[];
}

function scopedRows(
  db: Database,
  o: { project: string; trace_id?: string; run_id?: string },
): LogRow[] {
  const where = ['project = ?'];
  const params: unknown[] = [o.project];
  if (o.trace_id) {
    where.push('trace_id = ?');
    params.push(o.trace_id);
  }
  if (o.run_id) {
    where.push('run_id = ?');
    params.push(o.run_id);
  }
  return db
    .query(`SELECT * FROM logs WHERE ${where.join(' AND ')} ORDER BY ts, id`)
    .all(...params) as LogRow[];
}

export function errorContext(
  db: Database,
  o: { project: string; trace_id?: string; run_id?: string; context?: number },
): { error: LogRow; window: LogRow[] }[] {
  const ctx = o.context ?? 3;
  const rows = scopedRows(db, o);
  const out: { error: LogRow; window: LogRow[] }[] = [];
  rows.forEach((r, i) => {
    if (ERROR_LEVELS.has(r.level)) {
      out.push({
        error: r,
        window: rows.slice(Math.max(0, i - ctx), Math.min(rows.length, i + ctx + 1)),
      });
    }
  });
  return out;
}

export function filterLogs(
  db: Database,
  o: {
    project?: string;
    level?: string;
    grep?: string;
    run_id?: string;
    trace_id?: string;
    limit?: number;
  },
): LogRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  const eq = (col: string, v: unknown) => {
    if (v !== undefined && v !== null) {
      where.push(`${col} = ?`);
      params.push(v);
    }
  };
  eq('project', o.project);
  eq('level', o.level);
  eq('run_id', o.run_id);
  eq('trace_id', o.trace_id);
  if (o.grep) {
    where.push('msg LIKE ?');
    params.push(`%${o.grep}%`);
  }
  const sql =
    `SELECT * FROM logs${where.length ? ` WHERE ${where.join(' AND ')}` : ''}` +
    ` ORDER BY ts, id${o.limit ? ` LIMIT ${Number(o.limit)}` : ''}`;
  return db.query(sql).all(...params) as LogRow[];
}

// One-liner per row — agent-consumable; newlines in the message are flattened
// so the "one line per row" contract holds.
function line(r: LogRow): string {
  const tr = r.trace_id ? ` [${String(r.trace_id).slice(0, 8)}]` : '';
  const msg = String(r.msg).replace(/\s*\n\s*/g, ' ⏎ ');
  return `${r.ts} ${r.level} ${r.service} ${r.logger} ${msg}${tr}`;
}

export function format(rows: LogRow[], opts: { compact: boolean }): string {
  if (opts.compact) return rows.map(line).join('\n') + (rows.length ? '\n' : '');
  const byService = new Map<string, LogRow[]>();
  for (const r of rows) {
    const k = r.service || '(no service)';
    (byService.get(k) ?? byService.set(k, []).get(k)!).push(r);
  }
  const blocks: string[] = [];
  for (const [svc, rs] of byService) {
    blocks.push(`── ${svc} (${rs.length}) ──`);
    blocks.push(...rs.map((r) => `  ${line(r)}`));
  }
  return blocks.join('\n') + (blocks.length ? '\n' : '');
}
