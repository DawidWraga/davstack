// log-server — local Sentry log-ingest endpoint + correlation-keyed query CLI.
// (Historic CLI names: `diag`, then `log-sink`. Env var prefixes stay
// DIAG_* for back-compat with existing user/repo setups.)
//
// Verbs:
//   serve         boot the ingest endpoint
//   query run     timeline for one run_id
//   query trace   assembly for one trace_id
//   query errors  errors with surrounding context
//   query filter  generic level/grep/run/trace filter
//   prune         delete rows older than --days / --max-age-ms
//
// Output defaults to compact (one line per row, agent-consumable); --human
// groups by service. The DB is the one shared store (notes 03).
//
// Raw sqlite escape hatch: DB path is $DIAG_DB (default ~/.davstack/diag.sqlite).
// Schema: logs(id, ts, project, run_id, trace_id, level, msg, data_json, …).
// Use sqlite directly for ad-hoc queries the CLI's pre-baked cuts don't cover.

import { defineCli, type CommandSpec } from '@davstack/cli-utils';

function dbFlag() {
  return { type: 'string' as const, description: 'Path to the log-server sqlite db', env: 'DIAG_DB' };
}

function outputFlags() {
  return {
    json: { type: 'boolean' as const, default: false, description: 'JSON output' },
    human: { type: 'boolean' as const, default: false, description: 'Group by service' },
  };
}

const queryRun: CommandSpec = {
  description: 'Timeline for one run_id',
  flags: {
    db: dbFlag(),
    project: { type: 'string', required: true },
    run: { type: 'string', required: true },
    ...outputFlags(),
  },
  run: async (ctx) => {
    const { openDb } = await import('./db.ts');
    const { dbPath } = await import('./paths.ts');
    const { runTimeline, format } = await import('./query.ts');
    const db = openDb(dbPath(ctx.flags.db as string | undefined));
    const rows = runTimeline(db, {
      project: ctx.flags.project as string,
      run_id: ctx.flags.run as string,
    });
    emit(rows, ctx.flags, format);
    return 0;
  },
};

const queryTrace: CommandSpec = {
  description: 'Assembly for one trace_id',
  flags: {
    db: dbFlag(),
    project: { type: 'string', required: true },
    trace: { type: 'string', required: true },
    ...outputFlags(),
  },
  run: async (ctx) => {
    const { openDb } = await import('./db.ts');
    const { dbPath } = await import('./paths.ts');
    const { traceAssembly, format } = await import('./query.ts');
    const db = openDb(dbPath(ctx.flags.db as string | undefined));
    const rows = traceAssembly(db, {
      project: ctx.flags.project as string,
      trace_id: ctx.flags.trace as string,
    });
    emit(rows, ctx.flags, format);
    return 0;
  },
};

const queryErrors: CommandSpec = {
  description: 'Errors with surrounding context',
  flags: {
    db: dbFlag(),
    project: { type: 'string', required: true },
    trace: { type: 'string' },
    run: { type: 'string' },
    context: { type: 'number' },
    json: { type: 'boolean', default: false },
    human: { type: 'boolean', default: false },
  },
  run: async (ctx) => {
    const { openDb } = await import('./db.ts');
    const { dbPath } = await import('./paths.ts');
    const { errorContext, format } = await import('./query.ts');
    const db = openDb(dbPath(ctx.flags.db as string | undefined));
    const groups = errorContext(db, {
      project: ctx.flags.project as string,
      trace_id: ctx.flags.trace as string | undefined,
      run_id: ctx.flags.run as string | undefined,
      context: ctx.flags.context as number | undefined,
    });
    if (ctx.flags.json) {
      process.stdout.write(JSON.stringify(groups, null, 2) + '\n');
    } else {
      for (const g of groups) {
        process.stdout.write(`\n══ error: ${g.error.msg} ══\n`);
        process.stdout.write(format(g.window, { compact: !ctx.flags.human }));
      }
    }
    return 0;
  },
};

const queryFilter: CommandSpec = {
  description: 'Generic level/grep/run/trace filter',
  flags: {
    db: dbFlag(),
    project: { type: 'string' },
    level: { type: 'string' },
    grep: { type: 'string' },
    run: { type: 'string' },
    trace: { type: 'string' },
    limit: { type: 'number' },
    ...outputFlags(),
  },
  run: async (ctx) => {
    const { openDb } = await import('./db.ts');
    const { dbPath } = await import('./paths.ts');
    const { filterLogs, format } = await import('./query.ts');
    const db = openDb(dbPath(ctx.flags.db as string | undefined));
    const rows = filterLogs(db, {
      project: ctx.flags.project as string | undefined,
      level: ctx.flags.level as string | undefined,
      grep: ctx.flags.grep as string | undefined,
      run_id: ctx.flags.run as string | undefined,
      trace_id: ctx.flags.trace as string | undefined,
      limit: ctx.flags.limit as number | undefined,
    });
    emit(rows, ctx.flags, format);
    return 0;
  },
};

const cli = defineCli({
  name: 'logs-server',
  description: 'Local Sentry-shaped log ingest + correlation-keyed query CLI.',
  commands: {
    serve: {
      description: 'Boot the log-ingest HTTP endpoint',
      flags: {
        db: dbFlag(),
        port: { type: 'number', env: 'DIAG_PORT' },
        host: { type: 'string', env: 'DIAG_HOST' },
        'prune-days': {
          type: 'number',
          default: 0,
          description: 'Hourly background prune; 0 disables',
        },
      },
      run: async (ctx) => {
        const { openDb, prune } = await import('./db.ts');
        const { dbPath, ensureParent } = await import('./paths.ts');
        const { startServer } = await import('./server.ts');
        const file = ensureParent(dbPath(ctx.flags.db as string | undefined));
        const db = openDb(file);
        const srv = startServer({
          db,
          port: ctx.flags.port as number | undefined,
          host: ctx.flags.host as string | undefined,
        });
        process.stdout.write(
          `log-server listening on http://${srv.host}:${srv.port}  db=${file}\n`,
        );
        const days = ctx.flags['prune-days'] as number;
        if (days > 0) {
          setInterval(() => prune(db, days * 86_400_000), 3_600_000).unref();
        }
        return new Promise<number>(() => {});
      },
    },
    query: {
      description: 'Query the log store',
      commands: {
        run: queryRun,
        trace: queryTrace,
        errors: queryErrors,
        filter: queryFilter,
      },
    },
    prune: {
      description: 'Delete rows older than --days / --max-age-ms',
      flags: {
        db: dbFlag(),
        days: { type: 'number', default: 14 },
        'max-age-ms': { type: 'number' },
      },
      run: async (ctx) => {
        const { openDb, prune } = await import('./db.ts');
        const { dbPath } = await import('./paths.ts');
        const db = openDb(dbPath(ctx.flags.db as string | undefined));
        const ageMs =
          (ctx.flags['max-age-ms'] as number | undefined) ??
          (ctx.flags.days as number) * 86_400_000;
        process.stdout.write(
          `pruned ${prune(db, ageMs)} rows (older than ${ageMs}ms)\n`,
        );
        return 0;
      },
    },
  },
});

function emit(
  rows: unknown[],
  flags: Record<string, unknown>,
  format: (rows: any, opts: { compact: boolean }) => string,
): void {
  if (flags.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  } else {
    process.stdout.write(format(rows, { compact: !flags.human }));
  }
}

const code = await cli.run(process.argv.slice(2));
process.exit(code);
