---
name: fast-edit
description: >-
  Large, mechanical, low-complexity edits you can convey in a SHORT
  intent+constraints spec that the executor will then fully apply on its own
  — simple refactors, rote multi-file changes, repeated patterns. Worth
  delegating even if you've already read the files. Do it yourself if 1-2 line edit,
  or conveying it correctly would need exhaustive line-by-line detail right. Never use
  critical, complex edits that require careful judgement.
---

Default to one short `--task` whenever the mechanical edit can be stated in one
sentence, especially when conversation history already contains the details:

    fast-edit submit --task "Rename fooBar to computeFoo and update its callers without changing behavior"

Do not create a spec file or invent intent/changes/constraints tags merely to
wrap a task the user already stated. Conversation history supplies the
surrounding context automatically.

Run one foreground submission with a long shell timeout. If the shell yields a
running handle, wait on that same handle; completion wakes the agent. Never pass
`--background`, poll `result`, or resubmit.

Conversation history is included automatically. Keep the task to roughly one
sentence; do not repeat details, quotes, or file lists already present in the
conversation. History up to the direct budget goes to the executor unchanged;
oversized history is reduced to task-specific context first. Use `--no-history`
only when the conversation is irrelevant. `--compact-mode` remains a legacy
alias and is no longer needed.

If the conversation contains secrets, credentials, audit artifacts, or
user/health data, use `--no-history` and provide a sanitized scoped spec.

**Routing test.** Delegate when a short task is enough
for the executor to produce the **full** intended edit. If writing the spec
would mean pasting the new file contents or spelling out every line, the spec
costs as much as the edit — just do it yourself. (Having read the files is
fine; verbatim-detail specs are the only real waste.)

Use `--spec-file` only when essential constraints not present in conversation
cannot fit cleanly in one sentence, or when supplying an intentionally prepared
multi-part spec. Never generate one pre-emptively.

If a spec file is genuinely needed, begin it with a markdown `# 3-5 word title`
line — a short overview of
the task. The TUI agent viewer renders this as the job label; without it the
viewer falls back to the first 5 words of the spec, which is rarely meaningful.

The spec is intent / changes (exact files) / constraints / acceptance tags —
expressed as intent and constraints, never verbatim file content unless the
edit is genuinely adversarial/precision.

    # Rename fooBar to computeFoo
    <intent>Rename util fooBar to computeFoo and update all call sites.</intent>
    <changes>src/lib/foo.ts plus every importer of fooBar.</changes>
    <constraints>No signature or behaviour change. No reformatting.</constraints>
    <acceptance>tsc --noEmit clean; no remaining fooBar token.</acceptance>

The executor does ONE pass, typechecks only, never runs tests, and hands back
(does not iterate) if it doesn't apply cleanly.

**Verify (non-negotiable).** YOU run the acceptance command after the job and
confirm the returned `files changed` ⊆ the files you declared in `<changes>`
— that gate is the verification, not the executor's self-report. (Disjoint
declared scopes ⇒ jobs are safe to run in parallel.) Tell the user what you
delegated and that you verified.
