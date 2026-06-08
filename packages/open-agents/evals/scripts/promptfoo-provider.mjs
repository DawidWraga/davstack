#!/usr/bin/env node
import { prepareFixture } from './prepare-fixture.mjs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const output = {
    ok: prepared.ok,
    fixture,
    scenario,
    variant,
    caseId: variant,
    promptChars: prompt.length,
    checkoutPath: prepared.checkoutPath,
    commit: prepared.actualCommit,
    retained: keepRun,
  };
  mkdirSync(casePath, { recursive: true });
  writeFileSync(join(casePath, 'input.md'), prompt);
  writeFileSync(join(casePath, 'history.jsonl'), '');
  writeJson(join(casePath, 'job.json'), {
    kind: 'fixture-prepare-smoke',
    fixture,
    scenario,
    variant,
    checkoutPath: prepared.checkoutPath,
    repo: prepared.repo,
    commit: prepared.commit,
    actualCommit: prepared.actualCommit,
    retained: keepRun,
  });
  writeFileSync(join(casePath, 'output.md'), `${JSON.stringify(output, null, 2)}\n`);
  writeJson(join(casePath, 'scores.json'), {
    ok: prepared.ok,
    fixturePrepared: prepared.ok ? 1 : 0,
    promptChars: prompt.length,
  });
  writeJson(join(casePath, 'manual-review.json'), blankManualReview());
  if (!keepRun && prepared.ok) {
    rmSync(prepared.checkoutPath, { recursive: true, force: true });
  }
  console.log(JSON.stringify(output));
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
