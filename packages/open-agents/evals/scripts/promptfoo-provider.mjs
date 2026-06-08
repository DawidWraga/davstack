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
const safeSegment = (value) =>
  String(value)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-|-$/g, '');
const scenarioId = safeSegment(scenario);
const variantId = safeSegment(variant);
const runPath = join(repoRoot, '.davstack', 'evals', 'runs', runId);
const casePath = join(runPath, 'cases', scenarioId, variantId);

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

function tokenTail(text, maxTokens) {
  const limit = Number(maxTokens);
  if (!Number.isFinite(limit) || limit <= 0) return '';
  const parts = text.match(/\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) || [];
  let tokens = 0;
  let start = parts.length;
  while (start > 0 && tokens < limit) {
    start -= 1;
    if (!/^\s+$/.test(parts[start])) tokens += 1;
  }
  return parts.slice(start).join('').trim();
}

function historySnapshot() {
  if (typeof vars.historyText === 'string') {
    return {
      text: vars.historyText,
      pointer: vars.historyPointer || 'vars.historyText',
      source: 'vars.historyText',
    };
  }

  const historyPath = vars.historyPath || options.historyPath;
  if (historyPath) {
    const resolved = resolve(String(historyPath));
    return {
      text: readFileSync(resolved, 'utf8'),
      pointer: vars.historyPointer || resolved,
      source: resolved,
    };
  }

  const synthetic = [
    JSON.stringify({
      role: 'user',
      content: vars.goal || prompt,
    }),
    JSON.stringify({
      role: 'assistant',
      content: vars.context || 'No external history was provided for this eval case.',
    }),
  ].join('\n');

  return {
    text: synthetic,
    pointer: vars.historyPointer || 'synthetic eval history generated from test vars',
    source: 'synthetic',
  };
}

function buildSpecWriterPrompt({ goal, context, historyPointer, recentTail, tailTokens }) {
  return `# Spec Writer: Hybrid ${tailTokens} Token Tail Handoff

You are the spec-writer agent in a two-agent handoff.

Task title:
${goal}

Known task context:
${context || '(none)'}

Full history pointer:
${historyPointer}

Write a detailed execution spec for the executor agent. Preserve the user's
latest intent, scope, constraints, and non-goals. Do not solve the task yourself.
Do not invent requirements that are not supported by the title, context, or
history tail.

Return only the execution spec, in this shape:

<goal>
...
</goal>

<context>
...
</context>

<scope>
...
</scope>

<constraints>
...
</constraints>

<acceptance>
...
</acceptance>

Recent history tail:
The following block contains the last ${tailTokens} token-like units available
from the provided history source. Use it as the primary source of recent intent.

<recent_history_tail>
${recentTail || '(empty)'}
</recent_history_tail>
`;
}

function appendRecentTail(prompt, { historyPointer, recentTail, tailTokens }) {
  return `${prompt.trim()}

Recent history tail:
The following block contains the last ${tailTokens} token-like units available
from the provided history source.

Full history pointer:
${historyPointer}

<recent_history_tail>
${recentTail || '(empty)'}
</recent_history_tail>
`;
}

function runExploreAgent({ inputPath, cwd, provider, timeoutMs }) {
  const exploreEntry = resolve(repoRoot, 'packages', 'open-agents', 'src', 'entrypoints', 'explore.ts');
  const resultRun = spawnSync(
    'bun',
    [
      exploreEntry,
      'submit',
      '--cwd',
      cwd,
      '--file',
      inputPath,
      '--provider',
      provider,
    ],
    {
      encoding: 'utf8',
      shell: false,
      timeout: timeoutMs,
    },
  );

  const exitCode = resultRun.status ?? (resultRun.error || resultRun.signal ? 1 : 0);
  const stdout = resultRun.stdout || '';
  const match = stdout.match(/RESULT_PATH:\s*(.+)/);
  if (match && match[1]) {
    const resultPath = match[1].trim();
    if (existsSync(resultPath)) {
      return {
        exitCode,
        stdout,
        stderr: resultRun.stderr || '',
        resultPath,
        text: readFileSync(resultPath, 'utf8'),
      };
    }
    return {
      exitCode: exitCode || 1,
      stdout,
      stderr: resultRun.stderr || '',
      resultPath,
      text: `Agent reported missing result path: ${resultPath}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${resultRun.stderr || ''}`,
    };
  }

  return {
    exitCode,
    stdout,
    stderr: resultRun.stderr || '',
    resultPath: null,
    text:
      `Agent run failed with exit code ${exitCode}` +
      (resultRun.error ? ` (${resultRun.error.message})` : '') +
      `\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${resultRun.stderr || ''}`,
  };
}

try {
  const prepared = prepareFixture({
    fixture,
    runId,
    variant: `${scenarioId}-${variantId}`,
    workRoot: options.workRoot,
    fresh: true,
    quiet: true,
  });

  mkdirSync(casePath, { recursive: true });
  const history = historySnapshot();
  const tailTokens = Number(vars.tailTokens || vars.tailChars || options.tailTokens || 50000);
  const recentTail = tokenTail(history.text, tailTokens);
  writeFileSync(join(casePath, 'history.jsonl'), history.text);
  writeFileSync(join(casePath, 'recent-tail.md'), recentTail ? `${recentTail}\n` : '');

  let agentText = '';
  let agentExitCode = 0;
  let specWriterExitCode = null;
  let generatedSpecChars = 0;
  let filesChanged = [];
  const isSmoke = scenario === 'fixture-prepare-smoke';
  const agentProvider =
    vars.agentProvider || options.agentProvider || process.env.OPEN_AGENTS_EVAL_AGENT_PROVIDER || 'gemini';
  const agentTimeoutMs = Number(process.env.OPEN_AGENTS_EVAL_AGENT_TIMEOUT_MS || options.agentTimeoutMs || 600000);
  const isSpecWriterVariant = variant === 'c-spec-writer-title-tail-history';
  let executorInput = prompt;

  if (variant === 'b-title-tail-history') {
    executorInput = appendRecentTail(prompt, {
      historyPointer: history.pointer,
      recentTail,
      tailTokens,
    });
  }

  if (isSpecWriterVariant) {
    const specWriterPrompt = buildSpecWriterPrompt({
      goal: vars.goal || prompt,
      context: vars.context,
      historyPointer: history.pointer,
      recentTail,
      tailTokens,
    });
    writeFileSync(join(casePath, 'spec-writer-input.md'), specWriterPrompt);

    if (isSmoke) {
      executorInput = `<goal>\n${vars.goal || prompt}\n</goal>\n\n<context>\n${vars.context || ''}\n\nGenerated from ${tailTokens} token tail source: ${history.source}.\n</context>\n\n<scope>\nFixture: ${fixture}\nScenario: ${scenario}\n</scope>\n\n<constraints>\nSmoke run only; do not launch an executor agent.\n</constraints>\n\n<acceptance>\nFixture preparation artifacts are created for this case.\n</acceptance>\n`;
    } else {
      const specWriterResult = runExploreAgent({
        inputPath: join(casePath, 'spec-writer-input.md'),
        cwd: prepared.checkoutPath,
        provider: agentProvider,
        timeoutMs: agentTimeoutMs,
      });
      specWriterExitCode = specWriterResult.exitCode;
      executorInput = specWriterResult.text.trim();
      writeJson(join(casePath, 'spec-writer-job.json'), {
        exitCode: specWriterResult.exitCode,
        resultPath: specWriterResult.resultPath,
      });
      if (specWriterResult.exitCode !== 0) {
        agentExitCode = specWriterResult.exitCode || 1;
        agentText = `Spec writer failed; executor was not launched.\n\n${specWriterResult.text}`;
      }
    }

    generatedSpecChars = executorInput.length;
    writeFileSync(join(casePath, 'generated-spec.md'), executorInput.trim() + '\n');
  }

  writeFileSync(join(casePath, 'input.md'), executorInput);

  if (!isSmoke && (!isSpecWriterVariant || specWriterExitCode === 0)) {
    const executorResult = runExploreAgent({
      inputPath: join(casePath, 'input.md'),
      cwd: prepared.checkoutPath,
      provider: agentProvider,
      timeoutMs: agentTimeoutMs,
    });

    agentExitCode = executorResult.exitCode;
    agentText = executorResult.text;
    writeFileSync(join(casePath, 'output.md'), agentText);

    // Check if any files were changed in the checkout path
    const gitStatus = spawnSync('git', ['status', '--porcelain'], {
      cwd: prepared.checkoutPath,
      encoding: 'utf8',
      shell: false,
    });
    if (gitStatus.status === 0 && gitStatus.stdout.trim()) {
      filesChanged = gitStatus.stdout.trim().split('\n').map(line => line.slice(3).trim());
    }
  } else if (agentText) {
    writeFileSync(join(casePath, 'output.md'), agentText);
  }

  const output = {
    ok: prepared.ok && (isSmoke || agentExitCode === 0),
    fixture,
    scenario,
    variant,
    caseId: `${scenarioId}/${variantId}`,
    promptChars: prompt.length,
    executorPromptChars: executorInput.length,
    tailTokens,
    recentTailChars: recentTail.length,
    generatedSpecChars,
    checkoutPath: prepared.checkoutPath,
    commit: prepared.actualCommit,
    retained: keepRun,
    filesChanged,
    agentExitCode,
    specWriterExitCode,
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
    specWriterExitCode,
    historySource: history.source,
    tailTokens,
    recentTailChars: recentTail.length,
    generatedSpecChars,
  });

  if (isSmoke) {
    writeFileSync(join(casePath, 'output.md'), `${JSON.stringify(output, null, 2)}\n`);
  }

  writeJson(join(casePath, 'scores.json'), {
    ok: output.ok,
    fixturePrepared: prepared.ok ? 1 : 0,
    promptChars: prompt.length,
    executorPromptChars: executorInput.length,
    tailTokens,
    recentTailChars: recentTail.length,
    generatedSpecChars,
    specWriterExitCode,
    agentExitCode,
    filesChangedCount: filesChanged.length,
  });

  writeJson(join(casePath, 'manual-review.json'), blankManualReview());

  if (!keepRun && prepared.ok) {
    if (isSmoke) {
      rmSync(prepared.checkoutPath, { recursive: true, force: true });
    }
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
    caseId: `${scenarioId}/${variantId}`,
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
