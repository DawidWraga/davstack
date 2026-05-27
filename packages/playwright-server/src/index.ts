// playwright-server entry. Long-lived warm-browser host for fast e2e
// iteration; agents POST spec paths to a daemon and clicks execute against
// the live window in 1–3 s.
//
// Verbs:
//   serve          boot the daemon (this is the heavy one)
//   run <file>     execute a spec against the running daemon
//   goto <url>     navigate the live page
//   refresh-auth   mint a fresh session and reseed the live context
//   health         daemon liveness check
//   shutdown       gracefully stop the daemon
//
// All non-serve verbs are CLI clients — they fetch() the running daemon and
// don't import chromium, so they're cold-start cheap (~50 ms).
//
// Consumer drops a `playwright-server.config.ts` in their project root
// describing baseUrl / storageStatePath / refreshAuth (see auth.ts).

import { defineCli, type CommandSpec } from '@davstack/cli-utils';

const serveSpec: CommandSpec = {
  description: 'Boot the long-lived warm-browser daemon',
  flags: {
    port: {
      type: 'number',
      default: 5180,
      env: 'PLAYWRIGHT_SERVER_PORT',
      description: 'HTTP listen port',
    },
    host: {
      type: 'string',
      default: '127.0.0.1',
      env: 'PLAYWRIGHT_SERVER_HOST',
      description: 'HTTP listen host',
    },
    cwd: {
      type: 'string',
      default: process.cwd(),
      description: 'Consumer project root (where playwright-server.config.ts lives)',
    },
  },
  run: async (ctx) => {
    // Load .env BEFORE heavy imports so config files (which read
    // process.env at module-eval time) see the user's env. Walk-up
    // resolver in cli-utils; opt out with DAVSTACK_NO_DOTENV=1.
    const { loadDotenv } = await import('@davstack/cli-utils/dotenv');
    const envResult = await loadDotenv({ cwd: ctx.flags.cwd as string });
    if (envResult.loaded) {
      console.log(
        `[playwright-server] loaded .env from ${envResult.path} (${envResult.keys} keys)`,
      );
    }
    // Heavy imports deferred so the non-serve verbs stay cheap.
    const { PlaywrightSession } = await import('./session.js');
    const { startServer } = await import('./http.js');
    const session = await PlaywrightSession.create({ cwd: ctx.flags.cwd as string });
    const server = startServer({
      session,
      port: ctx.flags.port as number,
      host: ctx.flags.host as string,
    });
    const log = (...a: unknown[]) => console.log('[playwright-server]', ...a);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : ctx.flags.port;
    log(`listening on http://${ctx.flags.host}:${port}`);
    log(`cwd: ${ctx.flags.cwd}`);
    const sig = async (s: string) => {
      log(`received ${s}, closing…`);
      await session.shutdown();
      process.exit(0);
    };
    process.on('SIGINT', () => sig('SIGINT'));
    process.on('SIGTERM', () => sig('SIGTERM'));
    return new Promise<number>(() => {});
  },
};

const cli = defineCli({
  name: 'playwright-server',
  description: 'Long-lived warm-browser daemon + CLI client for fast e2e iteration.',
  commands: {
    serve: serveSpec,
    run: {
      description: 'Execute a spec file against the running daemon',
      positionals: [{ name: 'file', required: true, description: 'Spec path' }],
      flags: {
        ...clientFlags(),
        db: {
          type: 'string' as const,
          description:
            "Route this run's logs to .davstack/logs/<db>.db via the davstack-logs.db attribute (logs-server 2.0+)",
        },
      },
      run: async (ctx) => {
        const { runFile } = await import('./client.js');
        const db = ctx.flags.db as string | undefined;
        const result = await runFile(ctx.positionals[0], clientOpts(ctx.flags), {
          db: db && db.length > 0 ? db : undefined,
        });
        console.log(JSON.stringify(result, null, 2));
        return result.ok ? 0 : 1;
      },
    },
    goto: {
      description: 'Navigate the live page to a URL',
      positionals: [{ name: 'url', required: true }],
      flags: clientFlags(),
      run: async (ctx) => {
        const { gotoUrl } = await import('./client.js');
        const result = await gotoUrl(ctx.positionals[0], clientOpts(ctx.flags));
        console.log(JSON.stringify(result, null, 2));
        return 0;
      },
    },
    'refresh-auth': {
      description: 'Mint a fresh session and reseed the live context',
      flags: clientFlags(),
      run: async (ctx) => {
        const { refreshAuth } = await import('./client.js');
        const result = await refreshAuth(clientOpts(ctx.flags));
        console.log(JSON.stringify(result, null, 2));
        return result.ok ? 0 : 1;
      },
    },
    health: {
      description: 'Daemon liveness check',
      flags: clientFlags(),
      run: async (ctx) => {
        const { health } = await import('./client.js');
        const result = await health(clientOpts(ctx.flags));
        console.log(JSON.stringify(result, null, 2));
        return 0;
      },
    },
    shutdown: {
      description: 'Stop the running daemon',
      flags: clientFlags(),
      run: async (ctx) => {
        const { shutdown } = await import('./client.js');
        await shutdown(clientOpts(ctx.flags));
        return 0;
      },
    },
    check: {
      description: 'Validate local install (node, peer dep, chromium, config, daemon liveness)',
      flags: {
        ...clientFlags(),
        cwd: { type: 'string', default: process.cwd() },
        json: { type: 'boolean', default: false, description: 'JSON output for agent parsing' },
      },
      run: async (ctx) => {
        const { runCheck } = await import('./check.js');
        return runCheck({
          cwd: ctx.flags.cwd as string,
          host: ctx.flags.host as string,
          port: ctx.flags.port as number,
          json: ctx.flags.json as boolean,
        });
      },
    },
  },
});

function clientFlags() {
  return {
    port: {
      type: 'number' as const,
      default: 5180,
      env: 'PLAYWRIGHT_SERVER_PORT',
    },
    host: {
      type: 'string' as const,
      default: '127.0.0.1',
      env: 'PLAYWRIGHT_SERVER_HOST',
    },
  };
}

function clientOpts(flags: Record<string, unknown>): { host: string; port: number } {
  return { host: flags.host as string, port: flags.port as number };
}

const code = await cli.run(process.argv.slice(2));
process.exit(code);
