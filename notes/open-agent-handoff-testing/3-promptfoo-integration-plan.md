# Promptfoo Integration Plan

## Why Consider Promptfoo Early

Promptfoo may be worth using from the start if it gives us a consistent matrix
runner and report format without forcing open-agents to become an eval framework.

The risk is over-integration: if promptfoo has to own process orchestration,
worktree setup, open-agents job polling, and human grading, the setup may become
heavier than the experiment.

## Preferred Boundary

Open-agents should remain responsible for:

- Creating and running agent jobs.
- Persisting job specs/results/logs.
- Selecting adapter/profile/model.
- Reporting job status and result paths.

Promptfoo should be responsible for:

- Running the variant/scenario matrix.
- Passing variables into prompt templates.
- Capturing normalized JSON summaries from a local provider script.
- Rendering comparison reports.
- Hosting simple assertions where they are reliable.

## Thin Local Provider Shape

Promptfoo can call a local script instead of directly calling model APIs.

Possible flow:

1. Promptfoo selects `{scenario, variant, tailSize, provider, model}`.
2. Local provider script prepares an isolated run directory or worktree.
3. Script builds the handoff prompt for A, B, or C.
4. Script invokes open-agents.
5. Script records metrics and returns compact JSON to promptfoo.

The local provider result should include:

- `variant`
- `scenario`
- `promptChars`
- `tailChars`
- `generatedSpecChars`
- `durationMs`
- `exitCode`
- `resultPath`
- `filesChanged`
- `verificationCommand`
- `verificationExitCode`
- `summary`

## Initial File Layout

```text
packages/open-agents/evals/
  fixtures/
    scenarios.yaml
  prompts/
    a-main-agent-spec.md
    b-title-tail-history.md
    c-spec-writer-title-tail-history.md
  scripts/
    run-promptfoo-provider.ts
    prepare-fixture.ts
    score-result.ts
  promptfooconfig.yaml
```

Keep this small at first. The script can shell out to the existing local source
entrypoint rather than requiring a published package.

## Assertions

Use objective assertions where they are cheap:

- Did the run exit successfully?
- Did required files appear in the answer?
- Did required instrumentation tags appear?
- Did verification command pass?
- Did edit diff stay under expected paths?

Use human review for the important qualitative parts:

- Intent fidelity.
- Scope control.
- Whether the result would have saved main-agent time.
- Whether the handoff was pleasant enough to use again.

## Open Questions

- Does promptfoo handle long-running local providers comfortably enough for
  agent jobs?
- Does it stream useful progress, or only final results?
- How awkward is one-worktree-per-variant setup inside promptfoo?
- Should the first implementation use promptfoo directly, or write the local
  provider script first and wrap it with promptfoo once stable?
- Can promptfoo store enough metadata, or should run artifacts live entirely
  under `.davstack/evals/` with promptfoo only linking to them?

## Lean Recommendation

Build the local provider script as if promptfoo will call it, then wire promptfoo
around it immediately if the integration feels simple.

That gives us both options:

- Run one scenario manually while debugging.
- Run the full A/B/C matrix through promptfoo once the provider is stable.

This is different from delaying evals. The eval-shaped artifact comes first; the
promptfoo wrapper should be thin.
