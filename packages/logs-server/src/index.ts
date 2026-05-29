// log-server — local Sentry log-ingest endpoint.
// (Historic CLI names: `diag`, then `log-sink`. Env var prefixes stay
// DIAG_* for back-compat with existing user/repo setups.)
//
// Verbs:
//   serve         boot the ingest endpoint
//   refresh       evict cached DB handles + re-read config; keep PID
//   health        liveness check
//   doctor        validate local install (node, config, db rows, daemon liveness)
//                 (formerly `check`; `check` retained as a deprecated alias)
//
// Reading the log store: use sqlite3 directly against `.davstack/logs/<db>`.
// The flat `attrs` column is populated at insert time so probe attributes
// are one `json_extract` away. Recipes live in
// packages/logs-server/docs/reading-logs.md.
//
// Retention is file-based: each session writes its own `.davstack/logs/<name>.db`,
// so cleanup is `mv` into an archive dir. See docs/reading-logs.md#sessions.

import { defineCli, type CommandSpec } from '@davstack/cli-utils';

function dbFlag() {
  return { type: 'string' as const, description: 'Path to the log-server sqlite db', env: 'DIAG_DB' };
}

const doctorSpec: CommandSpec = {
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
};

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

        // /refresh handler: in multi-DB mode, close every cached DB
        // handle so the next ingest reopens against current schema
        // (covers manual schema edits and sqlite file replacement). In
        // single-DB pinned mode, startServer captured a live Database
        // reference at boot; closing it would dangle that pointer, so we
        // skip handle eviction and just re-read config.
        //
        // port / host / cors are baked into Bun.serve() at boot — those
        // genuinely need a shutdown+serve. Surfaced via the
        // `configReloaded` flag so the caller can decide.
        const handleRefresh = async () => {
          let closedHandles = 0;
          if (!pinned) {
            closedHandles = cache._sizeForTests();
            cache.closeAll();
            cache.startIdleSweeper();
          }
          let configReloaded = false;
          try {
            await loadConfig(process.cwd());
            configReloaded = true;
          } catch {
            // ignore — keep prior in-memory config
          }
          return {
            ok: true,
            refreshedAt: '', // overwritten by server.ts
            closedHandles,
            configReloaded,
          };
        };

        const srv = pinned
          ? startServer({
              db: cache.getOrOpen(defaultDbPath),
              port: effectivePort,
              host: effectiveHost,
              cors: config.cors,
              onRefresh: handleRefresh,
            })
          : startServer({
              cache,
              defaultDbPath,
              repoRoot,
              port: effectivePort,
              host: effectiveHost,
              cors: config.cors,
              onRefresh: handleRefresh,
            });
        process.stdout.write(
          `log-server listening on http://${srv.host}:${srv.port}  ` +
            `${pinned ? `db=${defaultDbPath}` : `logs=${defaultDbPath}/..`}\n`,
        );
        return new Promise<number>(() => {});
      },
    },
    refresh: {
      description:
        'Evict the daemon\'s cached DB handles and re-read config without restarting (keeps the daemon PID alive). Pass --hard for a full shutdown + detached re-serve (loses PID; needed for port/host/cors changes).',
      flags: {
        port: { type: 'number', env: 'DIAG_PORT' },
        host: { type: 'string', env: 'DIAG_HOST' },
        hard: {
          type: 'boolean' as const,
          default: false,
          description: 'Full shutdown + detached re-serve (loses daemon PID).',
        },
        db: dbFlag(),
      },
      run: async (ctx) => {
        const host = (ctx.flags.host as string | undefined) ?? '127.0.0.1';
        const port = (ctx.flags.port as number | undefined) ?? 7077;
        if (ctx.flags.hard) {
          const { restartDaemon } = await import('@davstack/cli-utils/restart');
          const serveArgs = ['--port', String(port), '--host', String(host)];
          if (ctx.flags.db) serveArgs.push('--db', String(ctx.flags.db));
          const result = await restartDaemon({
            host,
            port,
            entry: process.argv[1],
            serveArgs,
            healthPath: '/__health',
            shutdownPath: '/__shutdown',
          });
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
          return result.ok ? 0 : 1;
        }
        const { refresh } = await import('./client.js');
        const result = await refresh({ host, port });
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return result.ok ? 0 : 1;
      },
    },
    health: {
      description: 'Daemon liveness check',
      flags: {
        port: { type: 'number', env: 'DIAG_PORT' },
        host: { type: 'string', env: 'DIAG_HOST' },
      },
      run: async (ctx) => {
        const { health } = await import('./client.js');
        const result = await health({
          host: (ctx.flags.host as string | undefined) ?? '127.0.0.1',
          port: (ctx.flags.port as number | undefined) ?? 7077,
        });
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return result.ok ? 0 : 1;
      },
    },
    doctor: doctorSpec,
    check: {
      ...doctorSpec,
      description: "Validate local install (deprecated alias for 'doctor')",
    },
  },
});

const code = await cli.run(process.argv.slice(2));
process.exit(code);
