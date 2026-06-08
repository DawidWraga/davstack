# Candidate Backlog: Open Agents Spec Handoff Experiments

Related issues:

- #28 Experiment with improved openagents spec writing flow
- #25 Add evals

## Problem

Open-agents delegation is useful when a cheap/fast agent can absorb bounded
work, but the current handoff can be expensive in a different way: the main
agent often spends a lot of output tokens writing a detailed spec. That can make
delegation feel slower and more costly than just doing the work directly.

The central question is not "should every task have a generated spec?" The
question is:

> What is the cheapest handoff shape that still gives the execution agent enough
> context to succeed on the first try?

## High-Level Hypotheses

### H1: Main-agent specs are high quality but often over-priced

The current pattern gives the execution agent a curated spec, but the main agent
pays the full cost of synthesis. This may be best for complex or risky edits,
but it is probably wasteful for straightforward explore and mechanical edit
tasks.

### H2: Title plus history may be enough for many tasks

A very short intent plus recent chat context and a pointer to full history may
let the execution agent infer the needed spec internally. If true, the separate
spec-writer agent is unnecessary for a large class of tasks.

### H3: A spec-writer middleman helps when the execution agent needs focus

Some tasks may fail when the execution agent has to both discover the task and
execute it. A cheap spec-writer agent may be valuable when it turns noisy chat
history into a compact, executable brief.

### H4: Recent chat tail plus full-history pointer beats either alone

The recent tail gives the agent immediately relevant context. The full-history
file gives it an escape hatch for older decisions without forcing all that text
into the prompt.

### H5: The best strategy may depend on task shape

Explore, fast-edit, bug diagnosis, and architectural planning may need different
handoff strategies. The eval should preserve task category instead of averaging
everything into one score.

## Candidate Handoff Variants

### A. Main Agent Written Spec

Current baseline.

Input to execution agent:

- Detailed spec written by the orchestrating agent.
- Normal open-agents profile scaffold.

Expected strengths:

- Highest intent clarity.
- Best acceptance criteria.
- Lowest chance the execution agent chases stale context.

Expected weaknesses:

- Expensive output tokens from the main agent.
- Slow to prepare.
- May erase useful nuance from the original chat.

### B. No Spec: Title Only

Input to execution agent:

- Task title or one-line intent only.
- Normal open-agents profile scaffold.

Expected strengths:

- Cheapest possible orchestration.
- Useful lower-bound baseline.

Expected weaknesses:

- Likely under-specified.
- May work only for tiny or obvious tasks.

### C. No Spec: Title Plus Full-History Pointer

Input to execution agent:

- Task title or one-line intent.
- Path to full chat history file.
- Instruction to inspect only relevant portions.

Expected strengths:

- Very low main-agent output.
- Avoids pasting huge context into every run.
- Lets execution agent decide what history matters.

Expected weaknesses:

- Agent may not inspect the right parts.
- More tool use and latency.
- Harder to guarantee reproducibility if history file format changes.

### D. No Spec: Title Plus Recent Tail Plus Full-History Pointer

Input to execution agent:

- Task title or one-line intent.
- Last X chars of chat history, probably 30k, 50k, and 100k buckets.
- Path to full chat history file for deeper lookup.

Expected strengths:

- Keeps the most relevant context in the prompt.
- Still avoids full-context prompt bloat.
- May remove the need for a spec-writer middleman.

Expected weaknesses:

- Still pays input-token cost for the tail.
- Recent chat can contain distractions.
- The execution agent still has to synthesize and execute in one pass.

### E. Spec Writer: Title Plus Full-History Pointer

Step 1 spec-writer agent input:

- Task title or one-line intent.
- Path to full chat history file.
- Instruction to produce a compact execution spec.

Step 2 execution agent input:

- Generated spec.
- Normal open-agents profile scaffold.

Expected strengths:

- Main agent writes almost nothing.
- Execution agent gets a compact, focused spec.
- Full history is only read by the spec writer.

Expected weaknesses:

- Adds an extra agent run.
- Spec writer may miss context.
- More moving parts and more artifact management.

### F. Spec Writer: Title Plus Recent Tail Plus Full-History Pointer

Step 1 spec-writer agent input:

- Task title or one-line intent.
- Recent chat tail.
- Path to full chat history file.
- Instruction to produce a compact execution spec.

Step 2 execution agent input:

- Generated spec.
- Normal open-agents profile scaffold.

Expected strengths:

- Likely strongest middleman variant.
- Spec writer sees recent nuance immediately.
- Execution agent gets a clean, bounded brief.

Expected weaknesses:

- Most expensive experimental variant besides baseline.
- May be overkill for simple tasks.
- Tail-size tuning matters.

### G. Spec Writer Iteration

Same as E or F, but the spec writer can run a self-check pass before handing off.

Possible self-check questions:

- Does the spec include the exact goal?
- Does it name scope and non-goals?
- Does it include acceptance criteria for edit tasks?
- Does it preserve user preferences from the chat?
- Does it avoid inventing requirements?

Expected strengths:

- Better generated specs for complex work.
- Useful for high-risk edits.

Expected weaknesses:

- More latency.
- More tokens.
- May collapse into the same cost problem we are trying to solve.

## Task Fixtures

Start with a small set of real-ish tasks instead of synthetic only.

### Fixture 1: Hello World Mechanical Edit

Purpose:

- Prove the harness can run all variants.
- Check that metadata, artifacts, timings, and result paths are captured.

Success criteria:

- All variants produce comparable records.
- Execution result is easy to grade.
- No expensive manual analysis needed.

### Fixture 2: Open-Agents Small Explore

Example:

- "Find where open-agents builds the Cursor command args and explain the mode
  differences."

Purpose:

- Tests whether history helps a read-only task.
- Lower risk than editing.

Success criteria:

- Answer cites relevant files and lines.
- No invented behavior.

### Fixture 3: Open-Agents Small Edit

Example:

- "Add a small metadata field to persisted job records and cover it with a unit
  test."

Purpose:

- Tests whether generated/no-spec handoffs can produce acceptable edit specs.

Success criteria:

- Patch applies.
- Typecheck or targeted tests pass.
- Scope remains narrow.

### Fixture 4: Ambiguous Planning Task

Example:

- "Improve open-agents spec handoff."

Purpose:

- Stress test whether the agent can recover intent from chat history.

Success criteria:

- Output identifies uncertainty.
- Does not over-commit to implementation without enough evidence.

## Measurements

Capture objective metrics for every run:

- Variant id.
- Fixture id.
- Provider and model.
- Prompt character count.
- Recent-tail character count.
- Whether a full-history pointer was provided.
- Generated spec character count, if any.
- Wall-clock duration.
- Process exit code.
- Result path.
- Files changed.
- Test/typecheck command result, when applicable.

Capture subjective review metrics:

- Intent fidelity: 1-5.
- Scope control: 1-5.
- First-pass usefulness: 1-5.
- Would-use-again: yes/no.
- Notes on failure mode.

For edit tasks, also capture:

- Did it modify only expected files?
- Did it include or preserve acceptance criteria?
- Did it run the allowed verification command?
- Did the final diff require human cleanup?

## Promptfoo Integration Shape

Promptfoo is probably useful, but it should start as a thin runner/evaluator
around the same artifacts open-agents already writes. Avoid making promptfoo own
the whole execution pipeline too early.

Proposed lightweight structure:

```text
packages/open-agents/evals/
  fixtures/
    hello-world.yaml
    small-explore.yaml
    small-edit.yaml
  prompts/
    main-agent-spec.md
    no-spec-title.md
    no-spec-title-history-pointer.md
    no-spec-title-tail-history-pointer.md
    spec-writer-history-pointer.md
    spec-writer-tail-history-pointer.md
  promptfooconfig.yaml
  scripts/
    run-variant.ts
    collect-results.ts
```

Promptfoo can compare prompt variants and call a local script provider that:

1. Builds the variant prompt.
2. Runs open-agents with the selected adapter/profile.
3. Records job metadata and result artifacts.
4. Returns a compact JSON summary to promptfoo.

This keeps open-agents as the source of truth for job execution while promptfoo
handles matrix runs, assertions, and reports.

## Open Questions

- Where does the full chat history file live in each host environment?
- Is the history file stable enough to pass directly, or do we need an export
  command?
- Should recent-tail extraction happen in open-agents, a wrapper script, or the
  main agent?
- Should generated specs be persisted as first-class job artifacts?
- Do we need a new `spec` profile, or is this just an `explore` profile with a
  different output contract?
- Should spec-writer output be constrained to the existing `<goal>`,
  `<context>`, `<scope>`, `<acceptance>` shape?
- How much should the execution agent be told about the experiment variant?

## Suggested Implementation Phases

### Phase 1: Planning Artifacts

- Write this experiment plan.
- Pick 3-4 fixtures.
- Define review rubric.
- Decide where chat history input comes from.

### Phase 2: Minimal Manual Harness

- Add scripts that run one fixture through each variant.
- Persist raw prompts, generated specs, job ids, results, and metrics.
- Avoid promptfoo until one or two variants have completed manually.

### Phase 3: Promptfoo Wrapper

- Add promptfoo config over the same fixtures and scripts.
- Use promptfoo for repeatable matrix runs and basic assertions.
- Keep human review fields in a simple JSON/Markdown report.

### Phase 4: Productize Winning Flow

- Add a user-facing command or profile only after the experiment shows a winner.
- Likely candidates:
  - `open-agents spec`
  - `open-agents submit --handoff title-tail-history`
  - `open-agents submit --spec-writer`

## Current Lean Recommendation

Do not assume the middleman spec-writer is necessary. Test no-spec history
variants directly against spec-writer variants.

The most promising early comparison is:

1. Main-agent written spec.
2. No spec: title plus recent tail plus full-history pointer.
3. Spec writer: title plus recent tail plus full-history pointer.

If variant 2 is close to variant 3, skip the middleman for common tasks and
reserve spec-writing for complex/risky work. If variant 3 is much better, build
the spec-writer path as a first-class open-agents flow.
