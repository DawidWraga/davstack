// Tests for the help formatter. We don't pin the exact whitespace; we assert
// the relevant pieces (flags, defaults, env, descriptions, subcommands) are
// rendered. That keeps the visual layout free to evolve without churn.

import { test, expect } from 'vitest';
import { formatHelp } from '../src/cli-help.js';
import type { CliSpec } from '../src/cli.js';

test('formatHelp renders name, description, flags, defaults', () => {
  const spec: CliSpec = {
    name: 'demo',
    description: 'A demo tool',
    flags: {
      port: { type: 'number', default: 5180, description: 'Listen port' },
      verbose: { type: 'boolean', default: false },
    },
    run: () => 0,
  };
  const out = formatHelp([], spec);
  expect(out).toContain('demo');
  expect(out).toContain('A demo tool');
  expect(out).toContain('--port');
  expect(out).toContain('5180');
  expect(out).toContain('Listen port');
  expect(out).toContain('--verbose');
});

test('formatHelp shows env-var fallback when configured', () => {
  const spec: CliSpec = {
    name: 'demo',
    flags: {
      port: { type: 'number', default: 5180, env: 'DEMO_PORT' },
    },
    run: () => 0,
  };
  const out = formatHelp([], spec);
  expect(out).toContain('DEMO_PORT');
});

test('formatHelp lists subcommands at root', () => {
  const spec: CliSpec = {
    name: 'tool',
    commands: {
      serve: { description: 'Start the server', run: () => 0 },
      run: { description: 'Run a spec', run: () => 0 },
    },
  };
  const out = formatHelp([], spec);
  expect(out).toContain('serve');
  expect(out).toContain('Start the server');
  expect(out).toContain('run');
  expect(out).toContain('Run a spec');
});

test('formatHelp narrows to a subcommand when commandPath given', () => {
  const spec: CliSpec = {
    name: 'tool',
    commands: {
      serve: {
        description: 'Start the server',
        flags: { port: { type: 'number', default: 5180 } },
        run: () => 0,
      },
      run: { description: 'Run a spec', run: () => 0 },
    },
  };
  const out = formatHelp(['serve'], spec);
  expect(out).toContain('serve');
  expect(out).toContain('--port');
  // Sibling subcommand shouldn't appear in narrowed help.
  expect(out).not.toMatch(/^\s*run\b/m);
});

test('formatHelp marks required flags', () => {
  const spec: CliSpec = {
    name: 'demo',
    flags: { name: { type: 'string', required: true } },
    run: () => 0,
  };
  const out = formatHelp([], spec);
  expect(out).toContain('--name');
  expect(out.toLowerCase()).toContain('required');
});

test('formatHelp shows positionals when defined', () => {
  const spec: CliSpec = {
    name: 'demo',
    positionals: [{ name: 'file', required: true, description: 'Spec to run' }],
    run: () => 0,
  };
  const out = formatHelp([], spec);
  expect(out).toContain('file');
  expect(out).toContain('Spec to run');
});
