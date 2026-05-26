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
//   check         validate local install (node, config, db rows, daemon liveness)
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

// Resolve the DB path with full precedence: CLI flag > DIAG_DB env > config
// file > built-in default. Used by every verb so query/prune/serve share the
// same source of truth and don't accidentally hit different DBs.
async function resolveDbPath(flagDb: string | undefined): Promise<string> {
  const { dbPath } = await import('./paths.ts');
  if (flagDb && flagDb.trim()) return dbPath(flagDb);
  if (process.env.DIAG_DB && process.env.DIAG_DB.trim()) return dbPath();
  const { loadConfig } = await import('./config.ts');
  const cfg = await loadConfig(process.cwd());
  if (cfg._dbPathResolved) return cfg._dbPathResolved;
  if (cfg.dbPath) return dbPath(cfg.dbPath);
  return dbPath();
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
    const { runTimeline, format } = await import('./query.ts');
    const db = openDb(await resolveDbPath(ctx.flags.db as string | undefined));
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
    const { traceAssembly, format } = await import('./query.ts');
    const db = openDb(await resolveDbPath(ctx.flags.db as string | undefined));
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
    const { errorContext, format } = await import('./query.ts');
    const db = openDb(await resolveDbPath(ctx.flags.db as string | undefined));
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
    const { filterLogs, format } = await import('./query.ts');
    const db = openDb(await resolveDbPath(ctx.flags.db as string | undefined));
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
        const { loadConfig } = await import('./config.ts');
        const config = await loadConfig(process.cwd());
        // CLI flags already fold env vars (via `env:` spec) — so flag > config > built-in.
        const effectivePort = (ctx.flags.port as number | undefined) ?? config.port;
        const effectiveHost = (ctx.flags.host as string | undefined) ?? config.host;
        const configDbPath = config._dbPathResolved ?? config.dbPath;
        const file = ensureParent(
          dbPath((ctx.flags.db as string | undefined) ?? configDbPath),
        );
        const db = openDb(file);
        const srv = startServer({ db, port: effectivePort, host: effectiveHost });
        process.stdout.write(
          `log-server listening on http://${srv.host}:${srv.port}  db=${file}\n`,
        );
        const days =
          (ctx.flags['prune-days'] as number | undefined) || config.pruneDays || 0;
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
    check: {
      description: 'Validate local install (node, config, db rows, daemon liveness)',
      flags: {
        db: dbFlag(),
        port: { type: 'number', env: 'DIAG_PORT' },
        host: { type: 'string', env: 'DIAG_HOST' },
        cwd: { type: 'string', default: process.cwd() },
        json: { type: 'boolean', default: false, description: 'JSON output for agent parsing' },
      },
      run: async (ctx) => {
        const { runCheck } = await import('./check.ts');
        return runCheck({
          cwd: ctx.flags.cwd as string,
          host: ctx.flags.host as string | undefined,
          port: ctx.flags.port as number | undefined,
          db: ctx.flags.db as string | undefined,
          json: ctx.flags.json as boolean,
        });
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
        const { loadConfig } = await import('./config.ts');
        const config = await loadConfig(process.cwd());
        const configDbPath = config._dbPathResolved ?? config.dbPath;
        const db = openDb(
          dbPath((ctx.flags.db as string | undefined) ?? configDbPath),
        );
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
