#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const evalRoot = resolve(here, '..');
const repoRoot = resolve(evalRoot, '..', '..', '..');
const defaultWorkRoot = join(repoRoot, '.davstack', 'evals');

function usage() {
  console.error(
    'usage: node prepare-fixture.mjs --fixture <id> [--run-id <id>] [--variant <id>] [--work-root <path>] [--fresh]',
  );
}

function parseArgs(argv) {
  const out = { runId: 'manual', variant: 'smoke', workRoot: defaultWorkRoot, fresh: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fixture') out.fixture = argv[++i];
    else if (arg === '--run-id') out.runId = argv[++i];
    else if (arg === '--variant') out.variant = argv[++i];
    else if (arg === '--work-root') out.workRoot = resolve(argv[++i]);
    else if (arg === '--fresh') out.fresh = true;
    else {
      usage();
      process.exit(2);
    }
  }
  if (!out.fixture) {
    usage();
    process.exit(2);
  }
  return out;
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    cwd: options.cwd,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr || result.stdout || ''}` : '';
    throw new Error(`${cmd} ${args.join(' ')} failed with exit ${result.status}${detail}`);
  }
  return result.stdout || '';
}

export function loadFixture(fixtureId) {
  const manifestPath = join(evalRoot, 'fixtures', `${fixtureId}.json`);
  return {
    manifestPath,
    manifest: JSON.parse(readFileSync(manifestPath, 'utf8')),
  };
}

export function prepareFixture(options) {
  const { manifest } = loadFixture(options.fixture);
  const workRoot = resolve(options.workRoot || defaultWorkRoot);
  const cacheDir = join(workRoot, 'repo-cache');
  const runsDir = join(workRoot, 'runs', options.runId);
  const mirrorPath = join(cacheDir, `${manifest.id}.git`);
  const checkoutPath = join(runsDir, `${options.variant}-${manifest.id}`);

  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });

  if (!existsSync(mirrorPath)) {
    run('git', ['clone', '--mirror', manifest.repo, mirrorPath], { capture: options.quiet });
  } else {
    run('git', ['fetch', '--prune'], { cwd: mirrorPath, capture: options.quiet });
  }

  if (options.fresh && existsSync(checkoutPath)) {
    rmSync(checkoutPath, { recursive: true, force: true });
  }
  if (!existsSync(checkoutPath)) {
    run('git', ['clone', mirrorPath, checkoutPath], { capture: options.quiet });
  }

  run('git', ['checkout', '--force', manifest.commit], {
    cwd: checkoutPath,
    capture: options.quiet,
  });
  run('git', ['reset', '--hard', manifest.commit], { cwd: checkoutPath, capture: options.quiet });
  run('git', ['clean', '-ffd'], { cwd: checkoutPath, capture: options.quiet });

  const actualCommit = run('git', ['rev-parse', 'HEAD'], {
    cwd: checkoutPath,
    capture: true,
  }).trim();

  return {
    ok: actualCommit === manifest.commit,
    fixture: manifest.id,
    repo: manifest.repo,
    commit: manifest.commit,
    actualCommit,
    runPath: runsDir,
    checkoutPath,
    mirrorPath,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = prepareFixture(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
