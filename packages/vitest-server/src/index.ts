// vitest-server entry. Long-lived Vitest host for storybook/unit projects;
// warm reruns drop a story file's cycle from ~50s cold to ~3-15s.
//
// Verbs:
//   serve            boot the daemon (heavy — vite + playwright + storybook addon)
//   run <file>       rerun a file against the running daemon
//   health           liveness check
//   shutdown         stop the daemon
//
// Runtime: recommended `node --experimental-transform-types ./index.ts
// serve` (Node 24+). Bun works on Linux/macOS but fails on Windows
// (storybook 10.3 malformed `file:/C:/…` URLs); tsx fails on the
// estree-walker resolver. See session.ts header for the full matrix.
//
// Consumer drops a `vitest-server.config.ts` in their project root:
//   export default { project: 'storybook', primeFile: 'src/.../foo.stories.tsx' }
// Or pass --project / --prime on the `serve` command.

import { defineCli, type CommandSpec } from '@davstack/cli-utils';

function clientFlags() {
  return {
    port: { type: 'number' as const, default: 5179, env: 'VITEST_SERVER_PORT' },
    host: { type: 'string' as const, default: '127.0.0.1', env: 'VITEST_SERVER_HOST' },
  };
}

function clientOpts(flags: Record<string, unknown>) {
  return { host: flags.host as string, port: flags.port as number };
}

const serveSpec: CommandSpec = {
  description: 'Boot the long-lived Vitest daemon',
  flags: {
    port: { type: 'number', default: 5179, env: 'VITEST_SERVER_PORT' },
    host: { type: 'string', default: '127.0.0.1', env: 'VITEST_SERVER_HOST' },
    cwd: {
      type: 'string',
      default: process.cwd(),
      description: 'Consumer project root',
    },
    project: {
      type: 'string',
      description: 'Vitest project filter (overrides vitest-server.config.ts)',
    },
    prime: {
      type: 'string',
      env: 'VITEST_SERVER_PRIME_FILE',
      description: 'File to prime the storybook plugin on boot (overrides config)',
    },
  },
  run: async (ctx) => {
    // Heavy imports deferred — non-serve verbs stay cold-start cheap.
    const { VitestSession } = await import('./session.js');
    const { startServer } = await import('./http.js');
    const session = await VitestSession.create({
      cwd: ctx.flags.cwd as string,
      project: ctx.flags.project as string | undefined,
      primeFile: ctx.flags.prime as string | undefined,
    });
    const log = (...a: unknown[]) => console.log('[vitest-server]', ...a);
    const server = startServer({
      session,
      port: ctx.flags.port as number,
      host: ctx.flags.host as string,
    });
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
  name: 'vitest-server',
  description: 'Long-lived Vitest daemon + CLI client for fast story/unit reruns.',
  commands: {
    serve: serveSpec,
    run: {
      description: 'Rerun a file against the running daemon',
      positionals: [{ name: 'file', required: true, description: 'Spec/story path' }],
      flags: {
        ...clientFlags(),
        grep: { type: 'string', description: 'Vitest testNamePattern filter' },
      },
      run: async (ctx) => {
        const { runFile } = await import('./client.js');
        const result = await runFile(ctx.positionals[0], clientOpts(ctx.flags), {
          testNamePattern: ctx.flags.grep as string | undefined,
        });
        console.log(JSON.stringify(result, null, 2));
        return result.ok ? 0 : 1;
      },
    },
    health: {
      description: 'Daemon liveness check',
      flags: clientFlags(),
      run: async (ctx) => {
        const { health } = await import('./client.js');
        console.log(JSON.stringify(await health(clientOpts(ctx.flags)), null, 2));
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
      description: 'Validate local install (node, peer dep, config, daemon liveness)',
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

const code = await cli.run(process.argv.slice(2));
process.exit(code);
