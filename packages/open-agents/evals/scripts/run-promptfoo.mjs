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

const extraArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('--run-id=') && arg !== '--');
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

function generateMarkdownReport(resultsJsonPath) {
  if (!existsSync(resultsJsonPath)) {
    return '';
  }
  try {
    const data = JSON.parse(readFileSync(resultsJsonPath, 'utf8'));
    const results = data.results?.results || [];
    
    // Group results by scenario
    const scenarios = {};
    for (const r of results) {
      const scenario = r.testCase?.vars?.scenario || 'unknown';
      if (!scenarios[scenario]) {
        scenarios[scenario] = [];
      }
      scenarios[scenario].push(r);
    }
    
    let reportContent = '';
    
    for (const [scenarioName, scenarioRuns] of Object.entries(scenarios)) {
      reportContent += `\n### LLM-Graded Performance Summary (${scenarioName})\n\n`;
      
      // Get all unique variants in this scenario
      const getVariantName = (r) => {
        const variantStr = r.testCase?.vars?.variant || r.response?.output?.variant || '';
        if (variantStr) return variantStr;
        
        const rawPrompt = r.prompt?.raw || '';
        const firstLine = rawPrompt.split('\n')[0].trim();
        if (firstLine.startsWith('# ')) {
          const match = firstLine.slice(2).match(/^(Variant\s+[A-Z]):\s*(.*)$/i);
          if (match) {
            return `${match[1]} (${match[2]})`;
          }
          return firstLine.slice(2);
        }
        
        if (/Variant A/i.test(rawPrompt)) return 'Variant A';
        if (/Variant B/i.test(rawPrompt)) return 'Variant B';
        if (/Variant C/i.test(rawPrompt)) return 'Variant C';
        return r.prompt?.label?.split(':')[0] || 'Unknown Variant';
      };

      const variants = Array.from(new Set(scenarioRuns.map(getVariantName)));
      variants.sort();
      
      // Map runs by variant name
      const runsByVariant = {};
      for (const r of scenarioRuns) {
        const varName = getVariantName(r);
        runsByVariant[varName] = r;
      }
      
      // Extract all unique assertions/metrics across all runs
      const assertionMap = new Map();
      for (const r of scenarioRuns) {
        const componentResults = r.gradingResult?.componentResults || [];
        for (const cr of componentResults) {
          const ass = cr.assertion || {};
          const key = ass.metric || `${ass.type}:${ass.value}`;
          if (!assertionMap.has(key)) {
            assertionMap.set(key, ass);
          }
        }
      }
      
      // Build markdown table header
      const headers = ['Metric (Min Threshold)', ...variants];
      const divider = headers.map(() => '---');
      
      reportContent += `| ${headers.join(' | ')} |\n`;
      reportContent += `| ${divider.join(' | ')} |\n`;
      
      // Populate rows
      for (const [key, ass] of assertionMap.entries()) {
        const rowCells = [];
        
        let metricName = ass.metric || '';
        if (!metricName) {
          if (ass.type === 'contains') {
            metricName = ass.value;
          } else if (ass.type === 'javascript') {
            metricName = `Citation Format`;
          } else {
            metricName = `${ass.type} (${ass.value})`;
          }
        }
        
        const thresholdSuffix = ass.threshold ? ` (${ass.threshold})` : ' (Pass/Fail)';
        rowCells.push(`${metricName}${thresholdSuffix}`);
        
        for (const variantName of variants) {
          const run = runsByVariant[variantName];
          if (!run) {
            rowCells.push('-');
            continue;
          }
          
          if (run.error && !run.gradingResult) {
            const cleanErr = run.error.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').slice(0, 50);
            rowCells.push(`ERROR: ${cleanErr}...`);
            continue;
          }
          
          const cr = run.gradingResult?.componentResults?.find(c => {
            const ca = c.assertion || {};
            const ckey = ca.metric || `${ca.type}:${ca.value}`;
            return ckey === key;
          });
          
          if (!cr) {
            rowCells.push('-');
          } else {
            const hasScore = typeof cr.score === 'number';
            const isRubric = key.includes('coverage') || key.includes('usefulness') || key.includes('safety') || key.includes('quality') || key.includes('actionability') || ass.type === 'llm-rubric';
            
            let cleanReason = cr.reason || '';
            if (cleanReason.includes('Custom function returned false')) {
              const commentMatch = cleanReason.match(/\/\/\s*(.*)/);
              cleanReason = commentMatch ? commentMatch[1].trim() : 'custom assertion failed';
            }
            
            if (cleanReason.includes('Verify that output contains a path:line citation') || cleanReason.includes('path:line citation')) {
              cleanReason = 'no path:line format found';
            } else if (cleanReason.startsWith('Expected output to contain ')) {
              const term = cleanReason.match(/"(.*)"/)?.[1] || '';
              cleanReason = term ? `did not mention "${term}"` : cleanReason;
            } else {
              const howeverMatch = cleanReason.match(/However,\s*(.*)/i);
              if (howeverMatch) {
                cleanReason = howeverMatch[1];
              }
              if (cleanReason.includes('descriptive rather than actively guiding') || cleanReason.includes('making it descriptive')) {
                cleanReason = 'purely descriptive';
              } else if (cleanReason.includes('lacks any actionable directives') || cleanReason.includes('lacked next steps') || cleanReason.includes('lacks actionable')) {
                cleanReason = 'lacked next steps';
              }
              if (cleanReason.length > 50) {
                cleanReason = cleanReason.slice(0, 47) + '...';
              }
            }

            let cellText = '';
            if (cr.pass) {
              if (isRubric && hasScore) {
                cellText = `PASS (Score: ${cr.score.toFixed(1)})`;
              } else {
                cellText = 'PASS';
              }
            } else {
              const reasonSuffix = cleanReason ? ` - ${cleanReason}` : '';
              if (isRubric && hasScore) {
                cellText = `FAIL (Score: ${cr.score.toFixed(1)}${reasonSuffix})`;
              } else {
                cellText = `FAIL${cleanReason ? ` (${cleanReason})` : ''}`;
              }
            }
            rowCells.push(cellText);
          }
        }
        reportContent += `| ${rowCells.join(' | ')} |\n`;
      }
      reportContent += '\n';
    }
    return reportContent;
  } catch (err) {
    return `\n*Failed to generate performance summary: ${err.message}*\n`;
  }
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

  const resultsJsonPath = join(outDir, 'promptfoo-results.json');
  const dynamicTables = generateMarkdownReport(resultsJsonPath);

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

${dynamicTables}
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
