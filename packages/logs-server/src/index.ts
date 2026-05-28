// log-server — local Sentry log-ingest endpoint.
// (Historic CLI names: `diag`, then `log-sink`. Env var prefixes stay
// DIAG_* for back-compat with existing user/repo setups.)
//
// Verbs:
//   serve         boot the ingest endpoint
//   check         validate local install (node, config, db rows, daemon liveness)
//
// Reading the log store: use sqlite3 directly against `.davstack/logs/<db>`.
// The flat `attrs` column is populated at insert time so probe attributes
// are one `json_extract` away. Recipes live in
// packages/logs-server/docs/reading-logs.md.
//
// Retention is file-based: each session writes its own `.davstack/logs/<name>.db`,
// so cleanup is `mv` into an archive dir. See docs/reading-logs.md#sessions.

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
        const { DbHandleCache } = await import('./db-cache.js');
        const { dbPath, defaultDbPathForRepo } = await import('./paths.js');
        const { startServer } = await import('./server.js');
        const { loadConfig } = await import('./config.js');
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
  },
});

const code = await cli.run(process.argv.slice(2));
process.exit(code);
