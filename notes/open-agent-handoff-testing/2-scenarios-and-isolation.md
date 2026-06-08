# Scenarios And Isolation

## What Existing Specs Suggest

Local `.davstack` artifacts show the realistic open-agents work is mostly:

- Read-only reconnaissance with explicit scope and path/line reporting.
- Mechanical edit specs with tight file lists and acceptance criteria.
- Diagnosis support, especially broad instrumentation or quote-only extraction.
- Fan-out work where one main question becomes several bounded sub-jobs.

The initial eval should avoid abstract planning prompts. We should test the
things `explore` and `fast-edit` are already used for.

## Scenario Requirements

Each scenario should be:

- Repeatable from a clean fixture/worktree.
- Independent, so variants can run in parallel.
- Cheap enough to run multiple times.
- Easy to grade with a mix of objective checks and quick human review.
- Representative of real `explore` or `fast-edit` usage.

For edit scenarios, every variant needs either its own isolated copy/worktree or
a teardown step that restores exactly the touched files. Parallel runs should
not share a mutable checkout.

## Scenario 1: Read-Only Code Recon

Shape:

- `explore` task.
- Ask where a concrete open-agents behavior lives and how it works.

Example:

> Find where open-agents builds provider command args and explain how ask vs
> force mode changes the Cursor, Gemini, and Agy adapters. Cite files and lines.

Why this is useful:

- Mirrors real `explore` specs.
- No cleanup required.
- Grading can check for specific source files and absence of invented behavior.

Expected answer should mention:

- `packages/open-agents/src/cli.ts`
- `packages/open-agents/src/adapters/cursor.ts`
- `packages/open-agents/src/adapters/gemini.ts`
- `packages/open-agents/src/adapters/agy.ts`
- Profile mode source in `packages/open-agents/src/profiles/*`

## Scenario 2: Mechanical Fast-Edit

Shape:

- `fast-edit` task.
- Small, deterministic code change with clear acceptance criteria.

Example:

> Add a persisted `handoffVariant` metadata field to open-agents job records and
> cover the default/roundtrip behavior with unit tests.

Isolation:

- Run each variant in a separate temporary worktree or copied fixture repo.
- Teardown can remove the temp worktree/copy after metrics are collected.

Objective checks:

- Typecheck or targeted tests pass.
- Only expected open-agents files changed.
- Job record compatibility remains intact for old records.

Risk:

- This may be too product-shaped for the very first run. If so, replace it with
  a smaller metadata-only edit in a toy package fixture.

## Scenario 3: Diagnosis Support / Instrumentation Fan-Out

Shape:

- `fast-edit` task derived from diagnosis usage.
- Add broad, additive-only instrumentation across several named seams.

Example:

> Given hypotheses H1/H2/H3 and a path through three files, add additive debug
> logs at every seam with stable tags and enough fields to discriminate the
> hypotheses. Do not change behavior.

Why this matters:

- Existing diagnosis feedback says fast-edit specs underused fan-out and were
  too verbatim.
- This tests whether history handoff preserves the doctrine: intent plus seam
  list, not pasted code.

Isolation:

- Use a small fixture package or temporary worktree.
- Logs should be easy to grep by tag.
- Teardown deletes the fixture copy/worktree.

Objective checks:

- All expected tags exist.
- No non-instrumentation behavior changes.
- Typecheck passes.

## Scenario 4: Multi-Explore Fan-Out Recon

Shape:

- Future scenario, not in the first run unless the first three are too easy.
- A middleman identifies that a broad question can split into several parallel
  `explore` jobs.

Why this is future-only:

- It tests composition/fan-out, not just handoff shape.
- It likely needs a shared context artifact plus several generated task specs.

This should become its own follow-up once the basic A/B/C handoff comparison is
working.

## Cleanup And Parallelism Notes

For read-only scenarios:

- Variants can run in parallel in the same repo.
- Persist raw prompt, job id, result path, duration, and review score.

For edit scenarios:

- Prefer one temp worktree/copy per variant and per repeat.
- Record the exact base commit or fixture version.
- Collect diff stats before teardown.
- Keep failed worktrees until inspected, or copy their diffs into the result
  artifact before cleanup.

For diagnosis/instrumentation scenarios:

- Fixture should include deterministic code paths and named seams.
- Expected instrumentation tags should be declared up front.
- Verification should be grep/typecheck, not a long runtime test.
