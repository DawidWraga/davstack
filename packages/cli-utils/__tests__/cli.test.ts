// Tests for the zero-dep CLI helper. Hand-rolled because bunli is bus-factor-1
// and commander/citty are heavier than what we need. Goal: parseArgs +
// coerceFlag + defineCli covering subcommands, env-var fallback, boolean
// negation, and conventional exit codes (0/1/2).

import { test, expect, afterEach, beforeEach } from 'vitest';
import { coerceFlag, parseArgs, defineCli, type CliSpec } from '../src/cli.js';

// ─── coerceFlag ─────────────────────────────────────────────────────────────

test('coerceFlag string passes raw through', () => {
  expect(coerceFlag('string', 'hello')).toEqual({ ok: true, value: 'hello' });
  expect(coerceFlag('string', '')).toEqual({ ok: true, value: '' });
});

test('coerceFlag number parses integers and floats', () => {
  expect(coerceFlag('number', '42')).toEqual({ ok: true, value: 42 });
  expect(coerceFlag('number', '3.14')).toEqual({ ok: true, value: 3.14 });
  expect(coerceFlag('number', '-7')).toEqual({ ok: true, value: -7 });
});

test('coerceFlag number rejects non-numeric strings', () => {
  const r = coerceFlag('number', 'banana');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(/not a number/i);
});

test('coerceFlag boolean accepts truthy/falsy strings', () => {
  expect(coerceFlag('boolean', 'true')).toEqual({ ok: true, value: true });
  expect(coerceFlag('boolean', '1')).toEqual({ ok: true, value: true });
  expect(coerceFlag('boolean', 'false')).toEqual({ ok: true, value: false });
  expect(coerceFlag('boolean', '0')).toEqual({ ok: true, value: false });
});

// ─── parseArgs: flat command ────────────────────────────────────────────────

const flatSpec: CliSpec = {
  name: 'demo',
  flags: {
    port: { type: 'number', default: 5180, env: 'DEMO_PORT' },
    host: { type: 'string', default: '127.0.0.1' },
    verbose: { type: 'boolean', default: false },
    name: { type: 'string', required: true },
  },
  positionals: [{ name: 'file', required: false }],
  run: () => 0,
};

test('parseArgs returns defaults when no args given (besides required)', () => {
  const r = parseArgs(['--name', 'x'], flatSpec);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.flags.port).toBe(5180);
  expect(r.flags.host).toBe('127.0.0.1');
  expect(r.flags.verbose).toBe(false);
  expect(r.flags.name).toBe('x');
});

test('parseArgs handles --flag value form', () => {
  const r = parseArgs(['--name', 'x', '--port', '9000', '--host', '0.0.0.0'], flatSpec);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.flags.port).toBe(9000);
  expect(r.flags.host).toBe('0.0.0.0');
});

test('parseArgs handles --flag=value form', () => {
  const r = parseArgs(['--name=x', '--port=9000'], flatSpec);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.flags.port).toBe(9000);
  expect(r.flags.name).toBe('x');
});

test('parseArgs treats bare boolean flag as true', () => {
  const r = parseArgs(['--name', 'x', '--verbose'], flatSpec);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.flags.verbose).toBe(true);
});

test('parseArgs supports --no-flag negation for booleans', () => {
  const spec: CliSpec = {
    name: 'd',
    flags: { verbose: { type: 'boolean', default: true } },
    run: () => 0,
  };
  const r = parseArgs(['--no-verbose'], spec);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.flags.verbose).toBe(false);
});

test('parseArgs collects positionals', () => {
  const r = parseArgs(['--name', 'x', 'a.spec.ts'], flatSpec);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.positionals).toEqual(['a.spec.ts']);
});

test('parseArgs fails when required flag missing', () => {
  const r = parseArgs([], flatSpec);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toMatch(/required.*name/i);
});

test('parseArgs reports unknown flag as usage error', () => {
  const r = parseArgs(['--name', 'x', '--unknown', 'y'], flatSpec);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toMatch(/unknown flag/i);
});

test('parseArgs reports coerce error for bad number', () => {
  const r = parseArgs(['--name', 'x', '--port', 'banana'], flatSpec);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toMatch(/port/i);
  expect(r.error).toMatch(/not a number/i);
});

// ─── parseArgs: env-var fallback ────────────────────────────────────────────

const ENV_SAVE: Record<string, string | undefined> = {};
beforeEach(() => {
  ENV_SAVE.DEMO_PORT = process.env.DEMO_PORT;
});
afterEach(() => {
  if (ENV_SAVE.DEMO_PORT === undefined) delete process.env.DEMO_PORT;
  else process.env.DEMO_PORT = ENV_SAVE.DEMO_PORT;
});

test('parseArgs falls back to env when flag omitted', () => {
  process.env.DEMO_PORT = '7777';
  const r = parseArgs(['--name', 'x'], flatSpec);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.flags.port).toBe(7777);
});

test('parseArgs precedence: flag > env > default', () => {
  process.env.DEMO_PORT = '7777';
  const r = parseArgs(['--name', 'x', '--port', '8888'], flatSpec);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.flags.port).toBe(8888);
});

// ─── parseArgs: --help / -h ─────────────────────────────────────────────────

test('parseArgs flags --help even when required flags absent', () => {
  const r = parseArgs(['--help'], flatSpec);
  expect(r.helpRequested).toBe(true);
});

test('parseArgs flags -h shorthand', () => {
  const r = parseArgs(['-h'], flatSpec);
  expect(r.helpRequested).toBe(true);
});

// ─── parseArgs: subcommands ─────────────────────────────────────────────────

const subSpec: CliSpec = {
  name: 'tool',
  commands: {
    serve: {
      flags: { port: { type: 'number', default: 5180 } },
      run: () => 0,
    },
    run: {
      positionals: [{ name: 'file', required: true }],
      run: () => 0,
    },
    query: {
      commands: {
        last: {
          flags: { limit: { type: 'number', default: 10 } },
          run: () => 0,
        },
      },
    },
  },
};

test('parseArgs routes to single-level subcommand', () => {
  const r = parseArgs(['serve', '--port', '6000'], subSpec);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.commandPath).toEqual(['serve']);
  expect(r.flags.port).toBe(6000);
});

test('parseArgs subcommand positionals captured', () => {
  const r = parseArgs(['run', 'foo.spec.ts'], subSpec);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.commandPath).toEqual(['run']);
  expect(r.positionals).toEqual(['foo.spec.ts']);
});

test('parseArgs subcommand missing required positional fails', () => {
  const r = parseArgs(['run'], subSpec);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toMatch(/required.*file/i);
});

test('parseArgs routes to two-level nested subcommand', () => {
  const r = parseArgs(['query', 'last', '--limit', '50'], subSpec);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.commandPath).toEqual(['query', 'last']);
  expect(r.flags.limit).toBe(50);
});

test('parseArgs unknown subcommand reports usage error', () => {
  const r = parseArgs(['bogus'], subSpec);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error).toMatch(/unknown command/i);
});

test('parseArgs no subcommand at root with subcommands shows help', () => {
  const r = parseArgs([], subSpec);
  expect(r.helpRequested).toBe(true);
});

// ─── defineCli runtime ──────────────────────────────────────────────────────

test('defineCli.run invokes matching command and returns its exit code', async () => {
  let called: { flags?: any; positionals?: any } = {};
  const spec: CliSpec = {
    name: 'demo',
    commands: {
      hi: {
        flags: { name: { type: 'string', default: 'world' } },
        run: (ctx) => {
          called = ctx;
          return 0;
        },
      },
    },
  };
  const cli = defineCli(spec);
  const code = await cli.run(['hi', '--name', 'alice']);
  expect(code).toBe(0);
  expect(called.flags?.name).toBe('alice');
});

test('defineCli.run returns 2 on usage error', async () => {
  const spec: CliSpec = {
    name: 'demo',
    flags: { name: { type: 'string', required: true } },
    run: () => 0,
  };
  const cli = defineCli(spec);
  const code = await cli.run([]);
  expect(code).toBe(2);
});

test('defineCli.run returns 1 when handler throws', async () => {
  const spec: CliSpec = {
    name: 'demo',
    run: () => {
      throw new Error('boom');
    },
  };
  const cli = defineCli(spec);
  const code = await cli.run([]);
  expect(code).toBe(1);
});

test('defineCli.run returns 0 when handler resolves undefined', async () => {
  const spec: CliSpec = {
    name: 'demo',
    run: () => undefined,
  };
  const cli = defineCli(spec);
  const code = await cli.run([]);
  expect(code).toBe(0);
});

test('defineCli.run propagates explicit numeric exit code', async () => {
  const spec: CliSpec = {
    name: 'demo',
    run: () => 7,
  };
  const cli = defineCli(spec);
  const code = await cli.run([]);
  expect(code).toBe(7);
});

test('defineCli.run shows help and returns 0 when --help given', async () => {
  let invoked = false;
  const spec: CliSpec = {
    name: 'demo',
    run: () => {
      invoked = true;
      return 0;
    },
  };
  const cli = defineCli(spec);
  const code = await cli.run(['--help']);
  expect(code).toBe(0);
  expect(invoked).toBe(false);
});
