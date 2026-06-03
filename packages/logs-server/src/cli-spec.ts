// Side-effect-free CLI spec for logs-server. Extracted from index.ts so a
// generator (scripts/gen-skill-cli-reference.ts) can import the spec without
// executing the CLI. index.ts wires this into defineCli(); every run handler
// uses dynamic `await import()` so importing this module does no real work.
//
// (Historic CLI names: `diag`, then `log-sink`. Env var prefixes stay
// DIAG_* for back-compat with existing user/repo setups.)

import type { CliSpec, CommandSpec } from '@davstack/cli-utils';

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

export const cliSpec: CliSpec = {
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

        // Auto-clean timer (daemon-owned). Unset interval → off. Runs only in
        // multi-DB mode: pinned single-DB mode hands its handle to startServer
        // and shouldn't be VACUUMed out from under it. The timer uses the
        // cache's own handle (getOrOpen) so there's no stale-handle problem —
        // it's our live connection. See startAutoClean for the overlap guard.
        if (!pinned && config.autoCleanInterval) {
          const { startAutoClean } = await import('./clean.js');
          const mode = config.cleaningMode ?? 'archive';
          const window = config.autoCleanWindow ?? '24h';
          startAutoClean({
            interval: config.autoCleanInterval,
            window,
            mode,
            dbPath: defaultDbPath,
            getDb: () => cache.getOrOpen(defaultDbPath),
            log: (m) => process.stdout.write(`[logs-server] ${m}\n`),
            warn: (m) => process.stderr.write(`[logs-server] ${m}\n`),
          });
          process.stdout.write(
            `[logs-server] auto-clean every ${config.autoCleanInterval} ` +
              `(window=${window}, mode=${mode})\n`,
          );
        }

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
    clean: {
      description:
        'Bound the working DB: remove rows (full sweep by default; --window for a retention sweep), then VACUUM to reclaim disk. Archives to a .sql.br first unless --mode delete. Refreshes the daemon afterward so its cached handle picks up the rewritten file.',
      flags: {
        db: dbFlag(),
        mode: {
          type: 'string' as const,
          description: 'archive | delete (overrides config cleaningMode)',
        },
        window: {
          type: 'string' as const,
          description:
            'Retention window (e.g. "24h"); presence = windowed sweep (drop rows older than this), absence = full sweep (all rows).',
        },
        port: { type: 'number', env: 'DIAG_PORT' },
        host: { type: 'string', env: 'DIAG_HOST' },
        json: { type: 'boolean', default: false, description: 'JSON output for agent parsing' },
      },
      run: async (ctx) => {
        const { loadConfig } = await import('./config.js');
        const { runClean, formatCleanSummary } = await import('./run-clean.js');
        try {
          const summary = await runClean({
            config: await loadConfig(process.cwd()),
            dbFlag: ctx.flags.db as string | undefined,
            modeFlag: ctx.flags.mode as string | undefined,
            windowFlag: ctx.flags.window as string | undefined,
            host: ctx.flags.host as string | undefined,
            port: ctx.flags.port as number | undefined,
          });
          process.stdout.write(
            ctx.flags.json
              ? JSON.stringify(summary, null, 2) + '\n'
              : formatCleanSummary(summary),
          );
          return 0;
        } catch (e) {
          process.stderr.write(`[logs-server] clean failed: ${(e as Error)?.message ?? e}\n`);
          return 1;
        }
      },
    },
    view: {
      description:
        'Render one trace as a nested waterfall, or scan recent traces (--list / --cross for cross-runtime propagation). Writes Markdown to .davstack/view.md (wide tables wrap badly in a terminal); --stdout to print instead.',
      positionals: [{ name: 'trace_id', required: false, description: 'Trace to render (omit with --list / --cross)' }],
      flags: {
        db: dbFlag(),
        list: { type: 'boolean', default: false, description: 'List N most-recent traces' },
        cross: { type: 'boolean', default: false, description: 'Scan recent traces for ones spanning >1 runtime' },
        n: { type: 'number', description: 'Count for --list (default 20) / --cross (default 200)' },
        limit: { type: 'number', description: 'Cap rows in a waterfall' },
        ids: { type: 'boolean', default: false, description: 'Add span_id / parent columns (propagation debugging)' },
        out: { type: 'string', description: 'Output path (default .davstack/view.md)' },
        stdout: { type: 'boolean', default: false, description: 'Print to stdout instead of writing a file' },
      },
      run: async (ctx) => {
        const { runView } = await import('./view.js');
        return runView({
          trace: ctx.positionals[0],
          list: ctx.flags.list as boolean,
          cross: ctx.flags.cross as boolean,
          n: ctx.flags.n as number | undefined,
          limit: ctx.flags.limit as number | undefined,
          ids: ctx.flags.ids as boolean,
          out: ctx.flags.out as string | undefined,
          stdout: ctx.flags.stdout as boolean,
          db: ctx.flags.db as string | undefined,
          cwd: process.cwd(),
        });
      },
    },
    doctor: doctorSpec,
    check: {
      ...doctorSpec,
      description: "Validate local install (deprecated alias for 'doctor')",
    },
  },
};
