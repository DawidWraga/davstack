#!/usr/bin/env node
import { prepareFixture } from './prepare-fixture.mjs';
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const [, , prompt = '', optionsJson = '{}', contextJson = '{}'] = process.argv;
const here = dirname(fileURLToPath(import.meta.url));
const evalRoot = resolve(here, '..');
const repoRoot = resolve(evalRoot, '..', '..', '..');

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const context = parseJson(contextJson, {});
const vars = context.vars || {};
const options = parseJson(optionsJson, {});
const fixture = vars.fixture || options.fixture || 'nextbase-supabase-starter';
const scenario = vars.scenario || 'fixture-prepare-smoke';
const keepRun = vars.keepRun === true || options.keepRun === true;
const runId = process.env.OPEN_AGENTS_EVAL_RUN_ID || vars.runId || options.runId || scenario;
const variant = /Variant B/.test(prompt)
  ? 'b-title-tail-history'
  : /Variant C/.test(prompt)
    ? 'c-spec-writer-title-tail-history'
    : 'a-main-agent-spec';
const runPath = join(repoRoot, '.davstack', 'evals', 'runs', runId);
const casePath = join(runPath, 'cases', variant);

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function blankManualReview() {
  return {
    status: 'unreviewed',
    coverage: null,
    usefulness: null,
    hallucinationRisk: null,
    citationCorrectness: null,
    wouldUseAgain: null,
    notes: '',
  };
}

try {
  const prepared = prepareFixture({
    fixture,
    runId,
    variant,
    workRoot: options.workRoot,
    fresh: true,
    quiet: true,
  });

  mkdirSync(casePath, { recursive: true });
  writeFileSync(join(casePath, 'input.md'), prompt);
  writeFileSync(join(casePath, 'history.jsonl'), '');

  let agentText = '';
  let agentExitCode = 0;
  let filesChanged = [];
  const isSmoke = scenario === 'fixture-prepare-smoke';

  if (!isSmoke) {
    const exploreBin = resolve(repoRoot, 'packages', 'open-agents', 'bin', 'explore.mjs');
    const resultRun = spawnSync('node', [
      exploreBin,
      'submit',
      '--cwd', prepared.checkoutPath,
      '--file', join(casePath, 'input.md'),
      '--provider', 'gemini'
    ], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });

    agentExitCode = resultRun.status ?? 0;
    const stdout = resultRun.stdout || '';
    const match = stdout.match(/RESULT_PATH:\s*(.+)/);
    if (match && match[1]) {
      const resultPath = match[1].trim();
      if (existsSync(resultPath)) {
        agentText = readFileSync(resultPath, 'utf8');
        writeFileSync(join(casePath, 'output.md'), agentText);
      }
    } else {
      agentText = `Agent run failed with exit code ${agentExitCode}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${resultRun.stderr || ''}`;
    }

    // Check if any files were changed in the checkout path
    const gitStatus = spawnSync('git', ['status', '--porcelain'], {
      cwd: prepared.checkoutPath,
      encoding: 'utf8',
      shell: false,
    });
    if (gitStatus.status === 0 && gitStatus.stdout.trim()) {
      filesChanged = gitStatus.stdout.trim().split('\n').map(line => line.slice(3).trim());
    }
  }

  const output = {
    ok: prepared.ok && (isSmoke || agentExitCode === 0),
    fixture,
    scenario,
    variant,
    caseId: variant,
    promptChars: prompt.length,
    checkoutPath: prepared.checkoutPath,
    commit: prepared.actualCommit,
    retained: keepRun,
    filesChanged,
    agentExitCode,
  };

  writeJson(join(casePath, 'job.json'), {
    kind: isSmoke ? 'fixture-prepare-smoke' : 'explore',
    fixture,
    scenario,
    variant,
    checkoutPath: prepared.checkoutPath,
    repo: prepared.repo,
    commit: prepared.commit,
    actualCommit: prepared.actualCommit,
    retained: keepRun,
    filesChanged,
    agentExitCode,
  });

  if (isSmoke) {
    writeFileSync(join(casePath, 'output.md'), `${JSON.stringify(output, null, 2)}\n`);
  }

  writeJson(join(casePath, 'scores.json'), {
    ok: output.ok,
    fixturePrepared: prepared.ok ? 1 : 0,
    promptChars: prompt.length,
    agentExitCode,
    filesChangedCount: filesChanged.length,
  });

  writeJson(join(casePath, 'manual-review.json'), blankManualReview());

  if (!keepRun && prepared.ok) {
    rmSync(prepared.checkoutPath, { recursive: true, force: true });
  }

  if (isSmoke) {
    console.log(JSON.stringify(output));
  } else {
    console.log(agentText);
  }
} catch (error) {
  const output = {
    ok: false,
    fixture,
    scenario,
    variant,
    caseId: variant,
    promptChars: prompt.length,
    error: error instanceof Error ? error.message : String(error),
  };
  mkdirSync(casePath, { recursive: true });
  writeFileSync(join(casePath, 'input.md'), prompt);
  writeFileSync(join(casePath, 'history.jsonl'), '');
  writeFileSync(join(casePath, 'output.md'), `${JSON.stringify(output, null, 2)}\n`);
  writeJson(join(casePath, 'scores.json'), { ok: false, fixturePrepared: 0 });
  writeJson(join(casePath, 'manual-review.json'), blankManualReview());
  console.log(JSON.stringify(output));
  process.exit(1);
}
