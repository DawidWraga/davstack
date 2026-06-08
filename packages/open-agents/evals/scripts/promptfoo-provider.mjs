#!/usr/bin/env node
import { prepareFixture } from './prepare-fixture.mjs';
import { rmSync } from 'node:fs';

const [, , prompt = '', optionsJson = '{}', contextJson = '{}'] = process.argv;

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
const variant = /Variant B/.test(prompt)
  ? 'b-title-tail-history'
  : /Variant C/.test(prompt)
    ? 'c-spec-writer-title-tail-history'
    : 'a-main-agent-spec';

try {
  const prepared = prepareFixture({
    fixture,
    runId: `${scenario}-${Date.now()}`,
    variant,
    workRoot: options.workRoot,
    fresh: true,
    quiet: true,
  });
  if (!keepRun && prepared.ok) {
    rmSync(prepared.runPath, { recursive: true, force: true });
  }
  console.log(
    JSON.stringify({
      ok: prepared.ok,
      fixture,
      scenario,
      variant,
      promptChars: prompt.length,
      checkoutPath: prepared.checkoutPath,
      commit: prepared.actualCommit,
      retained: keepRun,
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      fixture,
      scenario,
      variant,
      promptChars: prompt.length,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
}
