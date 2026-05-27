// log-server — local Sentry log-ingest endpoint.
// (Historic CLI names: `diag`, then `log-sink`. Env var prefixes stay
// DIAG_* for back-compat with existing user/repo setups.)
//
// Verbs:
//   serve         boot the ingest endpoint
//   prune         delete rows older than --days / --max-age-ms
//   check         validate local install (node, config, db rows, daemon liveness)
//
// Reading the log store: use sqlite3 directly against `.davstack/logs/<db>`
// — the canned-cuts CLI verb was removed in 2.1.0 because it couldn't reach
// structured probe attributes and cost ~10× sqlite's cold-boot. Recipes and
// the `logs_v` overlay (flat `attrs` column) live in
// packages/logs-server/docs/reading-logs.md.

import { defineCli } from '@davstack/cli-utils';

function dbFlag() {
  return { type: 'string' as const, description: 'Path to the log-server sqlite db', env: 'DIAG_DB' };
}

const cli = defineCli({
  name: 'logs-server',
  description: 'Local Sentry-shaped log ingest. Read the store with sqlite3 against .davstack/logs/<db> (see docs/reading-logs.md).',
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
        // Load .env before config so log-server.config.ts can read
        // user env (DIAG_DB, DIAG_PORT, etc.) at module-eval. Opt out
        // with DAVSTACK_NO_DOTENV=1.
        const { loadDotenv } = await import('@davstack/cli-utils/dotenv');
        const envResult = await loadDotenv();
        if (envResult.loaded) {
          process.stdout.write(
            `[logs-server] loaded .env from ${envResult.path} (${envResult.keys} keys)\n`,
          );
        }
        const { prune } = await import('./db.js');
        const { DbHandleCache } = await import('./db-cache.js');
        const { dbPath, defaultDbPathForRepo } = await import('./paths.js');
        const { startServer } = await import('./server.js');
        const { loadConfig } = await import('./config.js');
        const { walkLogDbs } = await import('./db-walk.js');
        const config = await loadConfig(process.cwd());
        const effectivePort = (ctx.flags.port as number | undefined) ?? config.port;
        const effectiveHost = (ctx.flags.host as string | undefined) ?? config.host;
        const repoRoot = config._repoRoot ?? process.cwd();

        // CLI --db / DIAG_DB / config.dbPath all pin a single file, in which
        // case dispatch is meaningless and we fall back to single-DB mode.
        // Without them, dispatch routes every envelope via the cache.
        const pinned =
          (ctx.flags.db as string | undefined) ||
          process.env.DIAG_DB ||
          config._dbPathResolved ||
          config.dbPath;

        const cache = new DbHandleCache();
        cache.startIdleSweeper();
        const defaultDbPath = pinned ? dbPath(pinned) : defaultDbPathForRepo(repoRoot);

        const srv = pinned
          ? startServer({
              db: cache.getOrOpen(defaultDbPath),
              port: effectivePort,
              host: effectiveHost,
              cors: config.cors,
            })
          : startServer({
              cache,
              defaultDbPath,
              repoRoot,
              port: effectivePort,
              host: effectiveHost,
              cors: config.cors,
            });
        process.stdout.write(
          `log-server listening on http://${srv.host}:${srv.port}  ` +
            `${pinned ? `db=${defaultDbPath}` : `logs=${defaultDbPath}/..`}\n`,
        );
        const days =
          (ctx.flags['prune-days'] as number | undefined) || config.pruneDays || 0;
        if (days > 0) {
          // Walk all DBs each tick. With one pinned DB the walk yields just
          // that file via the cache; with dispatch it sweeps every session DB
          // currently materialized under .davstack/logs/.
          setInterval(() => {
            const files = pinned ? [defaultDbPath] : walkLogDbs(repoRoot);
            for (const f of files) {
              try {
                prune(cache.getOrOpen(f), days * 86_400_000);
              } catch {
                // a DB file may be gone (rm'd by the user) — skip
              }
            }
          }, 3_600_000).unref();
        }
        return new Promise<number>(() => {});
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
        const { runCheck } = await import('./check.js');
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
      description:
        'Delete rows older than --days / --max-age-ms. Walks every .davstack/logs/*.db unless --db pins one file.',
      flags: {
        db: dbFlag(),
        days: { type: 'number', default: 14 },
        'max-age-ms': { type: 'number' },
      },
      run: async (ctx) => {
        const { openDb, prune } = await import('./db.js');
        const { dbPath, defaultDbPathForRepo } = await import('./paths.js');
        const { loadConfig } = await import('./config.js');
        const { walkLogDbs } = await import('./db-walk.js');
        const config = await loadConfig(process.cwd());
        const repoRoot = config._repoRoot ?? process.cwd();

        const ageMs =
          (ctx.flags['max-age-ms'] as number | undefined) ??
          (ctx.flags.days as number) * 86_400_000;

        const pinned =
          (ctx.flags.db as string | undefined) ||
          process.env.DIAG_DB ||
          config._dbPathResolved ||
          config.dbPath;

        const files = pinned
          ? [dbPath(pinned)]
          : (() => {
              const walked = walkLogDbs(repoRoot);
              return walked.length > 0 ? walked : [defaultDbPathForRepo(repoRoot)];
            })();

        let total = 0;
        for (const f of files) {
          try {
            const db = openDb(f);
            const n = prune(db, ageMs);
            db.close();
            total += n;
            process.stdout.write(`pruned ${n} rows from ${f}\n`);
          } catch (err) {
            process.stderr.write(`[logs-server] prune failed for ${f}: ${(err as Error).message}\n`);
          }
        }
        process.stdout.write(`pruned ${total} rows total (older than ${ageMs}ms)\n`);
        return 0;
      },
    },
  },
});

const code = await cli.run(process.argv.slice(2));
process.exit(code);
