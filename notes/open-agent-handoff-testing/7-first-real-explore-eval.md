# First Real Explore Eval Plan

## Goal

Move from fixture-preparation smoke testing to one real `explore` task against
the pinned Supabase starter fixture.

Keep the first real eval small. The purpose is to prove the A/B/C handoff shape,
not to solve all scoring and artifact problems at once.

## Three Variants

### A. Main-Agent Written Spec

The prompt contains a normal curated `explore` spec:

- clear goal;
- short context;
- concrete scope;
- expected citation style.

This is the quality baseline and the current manual workflow.

### B. No Spec: Title + Tail + History Pointer

The prompt contains:

- one-line task title;
- recent conversation/history tail;
- pointer to full history/context artifact;
- instruction to inspect only what is needed.

For the first real eval, the "history" can be a small synthetic artifact instead
of the actual full chat export. We mainly need to test whether the execution
agent can turn lightweight context into a useful read-only answer.

### C. Spec Writer Middleman

Two-step flow:

1. Spec-writer receives the same title + tail + history pointer as variant B.
2. It emits a compact `explore` spec.
3. Execution agent receives only that generated spec.

For the first implementation, it is acceptable to simulate step 1 with a local
provider function or a separate open-agents run, as long as the generated spec is
persisted and measured.

## Candidate Task

Use a read-only architecture reconnaissance task:

> In the pinned Supabase starter fixture, trace how the private-items CRUD flow
> is structured from route/page entry points through server/data access and
> Supabase calls. Cite relevant files and lines. Do not modify files.

Why this task:

- It matches real `explore` usage.
- It is concrete but not trivial.
- The answer can be graded by checking for route/page files, data-access files,
  Supabase client usage, and path/line citations.
- It does not require installing dependencies or running the app.

## Measurements

Capture per variant:

- prompt character count;
- tail character count;
- generated spec character count, if any;
- fixture checkout path;
- open-agents job id;
- result path;
- wall-clock duration;
- exit code;
- whether the run checkout was retained;
- answer character count.

Review manually:

- intent fidelity: 1-5;
- citation usefulness: 1-5;
- coverage of CRUD path: 1-5;
- hallucination / unsupported claims: yes/no;
- would use again: yes/no.

Cheap automated assertions:

- result includes at least one `path:line`-style citation;
- result mentions Supabase;
- result mentions private/items or the equivalent fixture domain term;
- result does not report edits/files changed.

## Harness Steps

1. Extend the provider so a scenario can run `explore` after preparing the
   fixture checkout.
2. Persist each variant's final prompt/spec beside the Promptfoo result.
3. Keep successful run checkouts cleaned by default, but retain result artifacts.
4. Add `keepRun: true` for debugging failed runs.
5. Run one Promptfoo row with the three variants.
6. Manually inspect the three outputs and record the review scores.

## Open Questions

- Should the first real run use Cursor via open-agents immediately, or should we
  first make the provider output the exact prompts/specs without launching
  agents?
- Where should generated specs/results live if Promptfoo stores only table
  output?
- Should the fixture checkout be retained for `explore` results so citations can
  be clicked after cleanup, or is the mirror/pinned commit enough?
- How should we pass the synthetic history tail and full-history pointer into
  Promptfoo vars without making the YAML noisy?
