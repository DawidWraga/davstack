#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const startedAt = new Date().toISOString();
writeFileSync(
  join(outDir, 'run.json'),
  `${JSON.stringify(
    {
      runId,
      startedAt,
      config: 'packages/open-agents/evals/promptfooconfig.yaml',
      command: 'promptfoo eval',
    },
    null,
    2,
  )}\n`,
);

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
  env: {
    ...process.env,
    OPEN_AGENTS_EVAL_RUN_ID: runId,
  },
});

function readCaseSummary(caseId) {
  const caseDir = join(outDir, 'cases', caseId);
  const scoresPath = join(caseDir, 'scores.json');
  const reviewPath = join(caseDir, 'manual-review.json');
  const scores = existsSync(scoresPath)
    ? JSON.parse(readFileSync(scoresPath, 'utf8'))
    : {};
  const review = existsSync(reviewPath)
    ? JSON.parse(readFileSync(reviewPath, 'utf8'))
    : {};
  return { caseId, scores, review };
}

function writeReport(finishedAt) {
  const casesDir = join(outDir, 'cases');
  const cases = existsSync(casesDir)
    ? readdirSync(casesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => readCaseSummary(entry.name))
    : [];
  const rows = cases
    .map(
      (entry) =>
        `| ${entry.caseId} | ${entry.scores.ok === false ? 'fail' : 'pass'} | ${entry.review.status || 'unreviewed'} | ${entry.scores.promptChars ?? ''} |`,
    )
    .join('\n');

  writeFileSync(
    join(outDir, 'report.md'),
    `# Open Agents Eval Run: ${runId}

- Started: ${startedAt}
- Finished: ${finishedAt}
- Promptfoo status: ${result.status ?? 1}
- Promptfoo results: promptfoo-results.json

| Case | Smoke status | Manual review | Prompt chars |
| --- | --- | --- | --- |
${rows || '| _none_ | _none_ | _none_ | _none_ |'}
`,
  );
}

writeFileSync(
  join(outDir, 'run.json'),
  `${JSON.stringify(
    {
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: result.status ?? 1,
      config: 'packages/open-agents/evals/promptfooconfig.yaml',
      command: 'promptfoo eval',
      resultPath: join(outDir, 'promptfoo-results.json'),
    },
    null,
    2,
  )}\n`,
);
writeReport(new Date().toISOString());

process.exit(result.status ?? 1);
