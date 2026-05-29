// Side-effect-free CLI spec for vitest-server. Extracted from index.ts so a
// generator (scripts/gen-skill-cli-reference.ts) can import the spec without
// executing the CLI. index.ts wires this into defineCli(); every run handler
// uses dynamic `await import()` so importing this module does no real work.

import type { CliSpec, CommandSpec } from '@davstack/cli-utils';

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
    // Load .env BEFORE heavy imports so vitest.config and storybook
    // probes that read process.env at module-eval time see the user's
    // env. Opt out with DAVSTACK_NO_DOTENV=1.
    const { loadDotenv } = await import('@davstack/cli-utils/dotenv');
    const envResult = await loadDotenv({ cwd: ctx.flags.cwd as string });
    if (envResult.loaded) {
      console.log(
        `[vitest-server] loaded .env from ${envResult.path} (${envResult.keys} keys)`,
      );
    }
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

const doctorSpec: CommandSpec = {
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
};

export const cliSpec: CliSpec = {
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
    refresh: {
      description:
        'Flush vitest transform cache + vite-node module cache and re-read config without restarting (keeps the warm vitest instance alive). Pass --hard for a full shutdown + detached re-serve when soft refresh is insufficient.',
      flags: {
        ...clientFlags(),
        hard: {
          type: 'boolean' as const,
          default: false,
          description: 'Full shutdown + detached re-serve (loses daemon PID).',
        },
        cwd: {
          type: 'string' as const,
          default: process.cwd(),
          description: 'Consumer project root passed to the re-spawned serve (--hard only).',
        },
        project: {
          type: 'string' as const,
          description: 'Vitest project filter, passed to the re-spawned serve (--hard only).',
        },
        prime: {
          type: 'string' as const,
          env: 'VITEST_SERVER_PRIME_FILE',
          description: 'Prime file passed to the re-spawned serve (--hard only).',
        },
      },
      run: async (ctx) => {
        if (ctx.flags.hard) {
          const { restart } = await import('./client.js');
          const serveArgs = [
            '--port', String(ctx.flags.port),
            '--host', String(ctx.flags.host),
            '--cwd', String(ctx.flags.cwd),
          ];
          if (ctx.flags.project) serveArgs.push('--project', String(ctx.flags.project));
          if (ctx.flags.prime) serveArgs.push('--prime', String(ctx.flags.prime));
          const result = await restart({
            ...clientOpts(ctx.flags),
            entry: process.argv[1],
            serveArgs,
            startupTimeoutMs: 60_000, // vitest boot is slower than playwright
          });
          console.log(JSON.stringify(result, null, 2));
          return result.ok ? 0 : 1;
        }
        const { refresh } = await import('./client.js');
        const result = await refresh(clientOpts(ctx.flags));
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
    doctor: doctorSpec,
    check: {
      ...doctorSpec,
      description: "Validate local install (deprecated alias for 'doctor')",
    },
  },
};
