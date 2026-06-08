#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const evalRoot = resolve(here, '..');
const repoRoot = resolve(evalRoot, '..', '..', '..');

const runId =
  process.env.OPEN_AGENTS_EVAL_RUN_ID ||
  process.argv.find((arg) => arg.startsWith('--run-id='))?.slice('--run-id='.length) ||
  'smoke';

const outDir = join(repoRoot, '.davstack', 'evals', 'runs', runId);
mkdirSync(outDir, { recursive: true });

const extraArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('--run-id='));
const args = [
  'promptfoo@latest',
  'eval',
  '-c',
  'promptfooconfig.yaml',
  '--output',
  join(outDir, 'promptfoo-results.json'),
  ...extraArgs,
];

const result = spawnSync('npx', args, {
  cwd: evalRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
