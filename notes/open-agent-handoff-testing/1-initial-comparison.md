# Initial Handoff Comparison

Related issues:

- #28 Experiment with improved openagents spec writing flow
- #25 Add evals

## Current Focus

Start with three handoff strategies only. The wider candidate set belongs in
`4-candidate-backlog.md` until the small comparison proves what is worth
expanding.

## Variants

### A. Main-Agent Written Spec

This is the baseline. The main agent writes the normal detailed open-agents spec
and passes that to `explore` or `fast-edit`.

Hypothesis:

- Best quality and scope control.
- Highest main-agent output cost.
- Slowest preparation path.

### B. No Spec: Title Plus Recent Tail Plus Full-History Pointer

The main agent writes only a concise task title or one-line intent, appends the
last X chars of the chat/history, and includes a path/link to the full history
file for deeper lookup.

Hypothesis:

- May be good enough for many realistic `explore` and `fast-edit` tasks.
- Avoids the spec-writer middleman entirely.
- Main risk is that the execution agent must synthesize and execute in one run.

### C. Spec Writer: Title Plus Recent Tail Plus Full-History Pointer

The main agent writes the concise title/intent. A cheap middleman agent receives
that plus recent history tail plus a full-history pointer, then writes a compact
execution spec. The actual execution agent receives only that generated spec.

Hypothesis:

- Better focus than variant B on harder tasks.
- Still much cheaper for the main agent than variant A.
- Only worth productizing if the quality gain beats the extra agent run.

## First Decision Rule

Compare B against C before assuming the spec-writer middleman is necessary.

- If B is close to C, prefer no-spec history handoff for common tasks.
- If C is materially better, build spec writing as a first-class flow.
- If A is still clearly better, identify which task shapes need human/orchestrator
  spec synthesis and avoid over-automating those.

## Tail Sizes

Initial tail-size sweep should stay small:

- 30k chars.
- 50k chars.
- 100k chars only if 30k/50k are inconclusive.

The full-history pointer should be present in B and C for every run so the tail
size measures "immediate context usefulness", not "does the agent have any
history at all?"

## Documentation Style

Prefer append-only experiment notes as runs happen. Edit existing sections only
when they are actively misleading or block comprehension. When the next decision
branch appears, start a new numbered file instead of repeatedly rewriting a long
plan.
