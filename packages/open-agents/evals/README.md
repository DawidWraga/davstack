# Open Agents Evals

Small Promptfoo-based harness for testing open-agents handoff strategies against
pinned external fixtures.

## Current Smoke Eval

The current eval proves plumbing only:

- loads three prompt variants;
- prepares the pinned `nextbase-supabase-starter` fixture;
- creates isolated checkouts under `.davstack/evals/runs`;
- cleans successful run checkouts by default;
- keeps the reusable mirror cache under `.davstack/evals/repo-cache`.

Run from the repo root:

```sh
pnpm --filter @davstack/open-agents eval:smoke
```

Expected result:

```text
3 passed (100%)
```

Promptfoo should be the source of truth for machine-readable eval results. Use
`--output <path>` so each run gets a Promptfoo JSON result file alongside any
open-agents artifacts copied by the provider.

The package script writes Promptfoo JSON to:

```text
.davstack/evals/runs/smoke/promptfoo-results.json
```

The wrapper passes `--no-cache` to Promptfoo because the provider creates local
case artifacts as side effects. Cached Promptfoo results can otherwise report a
pass without creating the corresponding `cases/` folders.

Provider artifacts are grouped by case:

```text
.davstack/evals/runs/smoke/
  promptfoo-results.json
  run.json
  cases/
    a-main-agent-spec/
      input.md
      output.md
      history.jsonl
      job.json
      scores.json
      manual-review.json
```

For a named run:

```sh
pnpm --filter @davstack/open-agents eval -- --run-id=first-explore
```

## Explore + LLM Judge Eval

The real explore eval is intentionally separate from smoke because it launches
agents and judge calls:

```sh
pnpm --filter @davstack/open-agents eval:explore
```

It uses `promptfooconfig.explore.yaml`, keeps explore checkouts for later
inspection, and grades subjective dimensions through
`scripts/promptfoo-grader-provider.mjs`.

Gemini judge knobs:

```sh
OPEN_AGENTS_EVAL_GRADER_MODEL=gemini-3.1-flash-lite-preview
OPEN_AGENTS_EVAL_GRADER_TIMEOUT_MS=120000
GEMINI_CLI_BIN=/path/to/gemini
```

The grader resolves the installed `@google/gemini-cli` bundle on Windows before
falling back to `gemini` on PATH.

## Fixture Prep

Manual smoke:

```sh
node scripts/prepare-fixture.mjs --fixture nextbase-supabase-starter --run-id smoke --variant manual --fresh
```

This clones or refreshes the mirror cache, creates a checkout at the pinned
commit, hard-resets it, and prints JSON metadata.

## Keeping Run Checkouts

Promptfoo provider runs delete successful checkouts by default. For debugging,
pass `keepRun: true` through provider options or test vars once that is wired
into a specific eval config.

## Local Artifacts

Generated local artifacts are intentionally ignored:

```text
.davstack/evals/
```

Keep manifests, prompt templates, scripts, and score logic in git. Keep cloned
fixtures, run checkouts, Promptfoo caches, and bulky outputs out of git unless a
small artifact is intentionally promoted into a fixture.

## Scoring Shape

Promptfoo should generate:

- pass/fail status;
- assertion scores;
- provider output;
- prompt text;
- latency and metadata where available;
- JSON export via `--output`.

The eval provider should generate/copy:

- `cases/<case-id>/job.json`;
- `cases/<case-id>/output.md`;
- `cases/<case-id>/input.md`;
- `cases/<case-id>/history.jsonl`;
- `cases/<case-id>/recent-tail.md`;
- `cases/<case-id>/scores.json`;
- objective checks that Promptfoo can assert on, such as citation count and
  valid citation ranges.

For the spec-writer hybrid variant, the provider also writes:

- `cases/<case-id>/spec-writer-input.md`;
- `cases/<case-id>/generated-spec.md`;
- `cases/<case-id>/spec-writer-job.json` when the spec-writer agent actually
  runs.

Eval configs can set `tailTokens: 50000` plus either `historyText` or
`historyPath` in Promptfoo vars/options to feed the spec writer a recent history
tail. This is eval-only plumbing, not a package CLI flag; real `--compact-mode`
always uses the built-in 50000-unit tail plus the resolved history file pointer.
If no history source is provided, smoke runs use a small synthetic history
snapshot from the test vars so artifact plumbing remains deterministic.

Humans should only add:

- coverage score;
- usefulness score;
- hallucination notes;
- would-use-again decision;
- any qualitative comparison notes.
