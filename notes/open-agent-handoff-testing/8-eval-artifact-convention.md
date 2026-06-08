# Eval Artifact Convention

## Problem

Promptfoo's table output is useful for a quick pass/fail view, but it is not
enough for inspecting agent-handoff evals later. We need durable local artifacts
per run: inputs, outputs, job metadata, scores, and notes.

## Current Convention

Ignored local eval artifacts live under one folder per run:

```text
.davstack/evals/runs/<run-id>/
```

Each run folder should be self-contained enough to inspect later without knowing
which global history files, open-agents job files, or fixture cache were used.

Preferred layout:

```text
.davstack/evals/runs/<run-id>/
  report.md
  promptfoo-results.json
  run.json
  cases/
    a-main-agent-spec/
      history.jsonl
      input.md
      output.md
      job.json
      scores.json
      manual-review.json
    b-title-tail-history/
      history.jsonl
      input.md
      output.md
      job.json
      scores.json
      manual-review.json
```

Promptfoo should own the primary machine-readable result file:

```text
.davstack/evals/runs/<run-id>/promptfoo-results.json
```

Run evals with `--output` so Promptfoo writes that file directly instead of us
inventing a separate score format.

For a manual comparison run, store:

```text
promptfoo-results.json
report.md
run.json
cases/a-main-agent-spec/history.jsonl
cases/a-main-agent-spec/input.md
cases/a-main-agent-spec/output.md
cases/a-main-agent-spec/job.json
cases/a-main-agent-spec/scores.json
cases/a-main-agent-spec/manual-review.json
cases/b-title-tail-history/history.jsonl
cases/b-title-tail-history/input.md
cases/b-title-tail-history/output.md
cases/b-title-tail-history/job.json
cases/b-title-tail-history/scores.json
cases/b-title-tail-history/manual-review.json
```

The fixture checkout can live inside the run folder while the run is being
scored:

```text
.davstack/evals/runs/<run-id>/<case-id>-nextbase-supabase-starter/
```

That checkout is noisy, but useful for clickable citation verification. Once a
run is scored, we can either keep the checkout temporarily or delete it and rely
on the pinned commit plus copied outputs.

## History Snapshots

If a variant uses history/context from outside the run folder, copy the exact
material into the run folder before launching the agent.

Examples:

- related synthetic Claude-history-shaped JSONL;
- redacted excerpts from `~/.claude/history.jsonl`;
- Cursor/agent chat exports, if used;
- a recent-tail text file;
- a `source-pointer.txt` file naming the original source path, timestamp, and
  redaction/sampling rule.

Do not make later review depend on mutable global files such as
`~/.claude/history.jsonl` or Cursor history databases. The run should contain
the exact history bytes the agent saw, or a clear statement that no history was
provided.

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

The Promptfoo provider should write this artifact bundle automatically for each
case:

- copy final prompt/spec for each variant;
- copy any history/context files used by that variant;
- copy open-agents result;
- copy job JSON;
- run citation-range validation;
- return objective metrics to Promptfoo so Promptfoo can score/assert them;
- write or update `manual-review.json` with blank human-review fields.

Promptfoo should produce `promptfoo-results.json`. A tiny post-process script can
then merge in per-case `manual-review.json` files and render run-level
`report.md` for humans.

## Promptfoo-Native Scoring

Use Promptfoo assertions for objective checks:

- result contains at least one `path:Lx-Ly` citation;
- citation-range validation returned zero invalid ranges;
- result mentions the target domain term, such as `private_items`;
- result has no `filesChanged`;
- provider exit status is success.

Use Promptfoo metrics or named assertions for objective dimensions where
possible. Keep manual scores separate and additive:

```text
cases/<case-id>/manual-review.json
```

Manual review should add only human judgment:

- coverage;
- usefulness;
- hallucination risk;
- would-use-again;
- notes.
