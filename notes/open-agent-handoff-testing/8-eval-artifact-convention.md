# Eval Artifact Convention

## Problem

Promptfoo's table output is useful for a quick pass/fail view, but it is not
enough for inspecting agent-handoff evals later. We need durable local artifacts
per run: inputs, outputs, job metadata, scores, and notes.

## Current Convention

Ignored local eval artifacts live under:

```text
.davstack/evals/runs/<run-id>/artifacts/
```

For a manual comparison run, store:

```text
score.md
scores.json
variant-a-input.md
variant-a-output.md
variant-a-job.json
variant-b-input.md
variant-b-output.md
variant-b-job.json
related-history.jsonl
```

The fixture checkout can live beside `artifacts/` while the run is being scored:

```text
.davstack/evals/runs/<run-id>/shared-nextbase-supabase-starter/
```

That checkout is noisy, but useful for clickable citation verification. Once a
run is scored, we can either keep the checkout temporarily or delete it and rely
on the pinned commit plus copied outputs.

## What Gets Committed

Commit:

- fixture manifests;
- Promptfoo configs;
- provider scripts;
- prompt templates;
- scoring conventions/docs.

Do not commit:

- cloned fixture repos;
- run checkouts;
- raw Promptfoo caches;
- bulky open-agents logs;
- manual score artifacts unless deliberately promoting a small golden fixture.

## Next Automation Step

The Promptfoo provider should write this artifact bundle automatically:

- copy final prompt/spec for each variant;
- copy open-agents result;
- copy job JSON;
- run citation-range validation;
- write `scores.json` with objective metrics;
- leave manual score fields blank for review.
