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

Run (backgrounded — the harness notifies you):

    fast-edit submit --file ~/.davstack/specs/<slug>.md

**Routing test.** Delegate when a *short* intent+constraints spec is enough
for the executor to produce the **full** intended edit. If writing the spec
would mean pasting the new file contents or spelling out every line, the spec
costs as much as the edit — just do it yourself. (Having read the files is
fine; verbatim-detail specs are the only real waste.)

Begin every spec with a markdown `# 3-5 word title` line — a short overview of
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
