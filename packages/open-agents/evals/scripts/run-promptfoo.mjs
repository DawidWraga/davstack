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
const config =
  process.argv.find((arg) => arg.startsWith('--config='))?.slice('--config='.length) ||
  'promptfooconfig.yaml';

const outDir = join(repoRoot, '.davstack', 'evals', 'runs', runId);
mkdirSync(outDir, { recursive: true });

const startedAt = new Date().toISOString();

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

writeJson(join(outDir, 'run.json'), {
  runId,
  startedAt,
  config: `packages/open-agents/evals/${config}`,
  command: 'promptfoo eval',
});

const extraArgs = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith('--run-id=') && !arg.startsWith('--config=') && arg !== '--');
const args = [
  'promptfoo@latest',
  'eval',
  '-c',
  config,
  '--no-cache',
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

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function listCaseDirs(root) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const scenarioEntry of readdirSync(root, { withFileTypes: true })) {
    if (!scenarioEntry.isDirectory()) continue;
    const scenarioDir = join(root, scenarioEntry.name);
    for (const caseEntry of readdirSync(scenarioDir, { withFileTypes: true })) {
      if (caseEntry.isDirectory()) {
        out.push({
          caseId: `${scenarioEntry.name}/${caseEntry.name}`,
          path: join(scenarioDir, caseEntry.name),
        });
      }
    }
  }
  return out;
}

function readCaseSummary(entry) {
  const scores = readJson(join(entry.path, 'scores.json'), {});
  const review = readJson(join(entry.path, 'manual-review.json'), {});
  return { caseId: entry.caseId, scores, review };
}

function promptfooSummary(resultsJsonPath) {
  if (!existsSync(resultsJsonPath)) return '';
  const data = readJson(resultsJsonPath, {});
  const results = data.results?.results || [];
  if (!Array.isArray(results) || results.length === 0) return '';

  const rows = results
    .map((run) => {
      const scenario = run.testCase?.vars?.scenario || 'unknown';
      const prompt = run.prompt?.raw || '';
      const firstLine = prompt.split('\n')[0]?.replace(/^#\s*/, '') || 'unknown';
      const pass = run.gradingResult?.pass === false || run.success === false ? 'fail' : 'pass';
      const score =
        typeof run.gradingResult?.score === 'number' ? run.gradingResult.score.toFixed(2) : '';
      return `| ${scenario} | ${firstLine} | ${pass} | ${score} |`;
    })
    .join('\n');

  return `
## Promptfoo Results

| Scenario | Prompt | Status | Score |
| --- | --- | --- | --- |
${rows}
`;
}

function writeReport(finishedAt) {
  const cases = listCaseDirs(join(outDir, 'cases')).map(readCaseSummary);
  const rows = cases
    .map(
      (entry) =>
        `| ${entry.caseId} | ${entry.scores.ok === false ? 'fail' : 'pass'} | ${entry.review.status || 'unreviewed'} | ${entry.scores.promptChars ?? ''} |`,
    )
    .join('\n');
  const resultsJsonPath = join(outDir, 'promptfoo-results.json');

  writeFileSync(
    join(outDir, 'report.md'),
    `# Open Agents Eval Run: ${runId}

- Started: ${startedAt}
- Finished: ${finishedAt}
- Promptfoo status: ${result.status ?? 1}
- Promptfoo config: ${config}
- Promptfoo results: promptfoo-results.json

## Cases

| Case | Provider status | Manual review | Prompt chars |
| --- | --- | --- | --- |
${rows || '| _none_ | _none_ | _none_ | _none_ |'}

${promptfooSummary(resultsJsonPath)}
`,
  );
}

const finishedAt = new Date().toISOString();
writeJson(join(outDir, 'run.json'), {
  runId,
  startedAt,
  finishedAt,
  status: result.status ?? 1,
  config: `packages/open-agents/evals/${config}`,
  command: 'promptfoo eval',
  resultPath: join(outDir, 'promptfoo-results.json'),
});
writeReport(finishedAt);

process.exit(result.status ?? 1);
