import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview';
const DEFAULT_TIMEOUT_MS = 120000;

function resolveGeminiCommand() {
  const env = process.env.GEMINI_CLI_BIN;
  if (env && env.trim()) {
    return { bin: env.trim(), prelaunchArgs: [], shell: false };
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) {
      const bundle = join(appData, 'npm', 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js');
      const dist = join(appData, 'npm', 'node_modules', '@google', 'gemini-cli', 'dist', 'index.js');
      if (existsSync(bundle)) return { bin: 'node', prelaunchArgs: [bundle], shell: false };
      if (existsSync(dist)) return { bin: 'node', prelaunchArgs: [dist], shell: false };
    }
  }

  return { bin: 'gemini', prelaunchArgs: [], shell: process.platform === 'win32' };
}

function findJsonObject(text) {
  const cleaned = text
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
  try {
    return JSON.stringify(JSON.parse(cleaned));
  } catch {
    // Continue to brace extraction.
  }

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  const candidate = cleaned.slice(start, end + 1);
  try {
    return JSON.stringify(JSON.parse(candidate));
  } catch {
    return null;
  }
}

function pickModelText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  for (const key of ['response', 'result', 'text', 'message', 'content', 'output']) {
    const found = pickModelText(value[key]);
    if (found) return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = pickModelText(item);
      if (found) return found;
    }
  }
  return '';
}

function normalizeGeminiOutput(stdout) {
  const raw = stdout || '';
  try {
    const parsed = JSON.parse(raw);
    const modelText = pickModelText(parsed);
    return findJsonObject(modelText) || findJsonObject(raw) || modelText || raw;
  } catch {
    return findJsonObject(raw) || raw.trim();
  }
}

function buildStrictPrompt(prompt) {
  return `You are a strict Promptfoo LLM-as-judge grader.

Follow the grading instructions below. Return only a JSON object with this exact shape:
{"pass": boolean, "score": number, "reason": string}

Rules:
- score must be a number from 0.0 to 1.0.
- pass should be true only when the score satisfies the rubric threshold implied by the prompt.
- reason must be concise and cite the main evidence from the candidate answer.
- Do not include markdown fences, prose outside JSON, or extra keys.

${prompt}`;
}

export default class GeminiGraderProvider {
  constructor(options = {}) {
    this.config = options.config || {};
  }

  id() {
    return 'gemini-grader';
  }

  async callApi(prompt) {
    const { bin, prelaunchArgs, shell } = resolveGeminiCommand();
    const model = this.config.model || process.env.OPEN_AGENTS_EVAL_GRADER_MODEL || DEFAULT_MODEL;
    const timeout = Number(
      this.config.timeoutMs || process.env.OPEN_AGENTS_EVAL_GRADER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
    );
    const strictPrompt = buildStrictPrompt(prompt);

    const result = spawnSync(
      bin,
      [
        ...prelaunchArgs,
        '-m',
        model,
        '-o',
        'json',
        '--skip-trust',
        '-p',
        strictPrompt,
      ],
      {
        encoding: 'utf8',
        shell,
        timeout,
        windowsHide: true,
      },
    );

    if (result.error) {
      return { error: `Gemini grader spawn error: ${result.error.message}` };
    }
    if (result.status !== 0) {
      return {
        error: `Gemini grader exited with status ${result.status}: ${result.stderr || result.stdout}`,
      };
    }

    const output = normalizeGeminiOutput(result.stdout);
    const strictJson = findJsonObject(output);
    if (!strictJson) {
      return { error: `Gemini grader did not return JSON: ${output.slice(0, 500)}` };
    }
    return { output: strictJson };
  }
}
