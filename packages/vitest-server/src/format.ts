// Pure formatters: vitest task/result trees → agent-facing JSON.
// Extracted from the original .mjs so we can unit-test them without
// booting vitest itself.

export type FormattedError = {
  name: string;
  summary: string;
  message: string;
  stack: string | null;
  expected: unknown;
  actual: unknown;
};

export type TestEntry = {
  id: string;
  name: string;
  rawName: string;
  module: string | null;
  state: 'passed' | 'failed' | 'skipped';
  durationMs: number | null;
  error: FormattedError | null;
};

// Storybook re-wraps play-function failures with a stacked "Click to debug…"
// preamble line. Strip those wrappers so the real assertion error surfaces.
const STORYBOOK_WRAPPER_PATTERN =
  /^\s*(?:\x1b\[\d+m)?Click to debug the error directly in Storybook/;

export function stripAnsi<T extends string | null | undefined>(s: T): T {
  if (typeof s !== 'string') return s;
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '') as T;
}

export function isStorybookWrapper(err: { message?: string } | null | undefined): boolean {
  if (!err?.message) return false;
  const first = err.message.split('\n').find((l) => l.trim().length > 0) ?? '';
  return STORYBOOK_WRAPPER_PATTERN.test(first);
}

export function pickRealError<T extends { message?: string }>(errors: T[] | null | undefined): T | null {
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const seen = new Set<string>();
  for (const e of errors) {
    if (isStorybookWrapper(e)) continue;
    const key = e?.message ?? '';
    if (seen.has(key)) continue;
    seen.add(key);
    return e;
  }
  return errors[0];
}

export function formatError(err: any): FormattedError | null {
  if (!err) return null;
  const rawMessage: string = err.message ?? '';
  const message = stripAnsi(rawMessage).trim();
  // One-line summary so an agent can grok the failure at a glance without
  // parsing the full body.
  const firstLine = message.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
  const name = err.name ?? err.constructor?.name ?? 'Error';
  const summary = firstLine ? `${name}: ${firstLine}` : name;
  return {
    name,
    summary,
    message,
    stack: stripAnsi(err.stack ?? '') || null,
    expected: err.expected ?? null,
    actual: err.actual ?? null,
  };
}

export function getSuiteChain(task: any): string {
  const chain: string[] = [];
  let s = task?.suite;
  while (s && s.type === 'suite' && s.name) {
    chain.unshift(s.name);
    s = s.suite;
  }
  return chain.join(' > ');
}

export function buildTestEntry(task: any, result: any): TestEntry {
  const err = pickRealError(result?.errors);
  const stateStr: TestEntry['state'] =
    result?.state === 'pass' ? 'passed' : result?.state === 'fail' ? 'failed' : 'skipped';
  const suiteChain = getSuiteChain(task);
  return {
    id: task.id,
    name: suiteChain ? `${suiteChain} > ${task.name}` : task.name,
    rawName: task.name,
    module: task.file?.filepath ?? task.file?.name ?? null,
    state: stateStr,
    durationMs: result?.duration ?? null,
    error: formatError(err),
  };
}

export function walkTaskTreeForTests(task: any, captured: Map<string, TestEntry>): void {
  if (!task) return;
  if (task.type === 'test' && !captured.has(task.id)) {
    captured.set(task.id, buildTestEntry(task, task.result ?? {}));
  }
  if (task.tasks) for (const t of task.tasks) walkTaskTreeForTests(t, captured);
}
