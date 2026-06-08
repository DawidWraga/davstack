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

Run from this folder:

```sh
npx promptfoo@latest eval -c promptfooconfig.yaml
```

Expected result:

```text
3 passed (100%)
```

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
