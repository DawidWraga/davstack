---
name: diagnose
description: Disciplined diagnosis loop for hard bugs and performance regressions. Frame → reproduce the USER's failure → hypothesis tree → pre-registered experiment → instrument (delegated) → interpret with a confound gate → root cause → fix-as-hypothesis. Backed by a local Sentry log-ingest sink + `diag` query CLI, a warm Playwright host for live-app replays, and a Vitest daemon for fast unit/storybook reruns. Use when the user says "diagnose this" / "debug this", reports a bug, says something is broken/throwing/failing, or describes a performance regression.
---

# Diagnose

Discipline for hard bugs. Skip a phase only with a written reason.

**Two places rigor is non-negotiable** (move fast everywhere else):

1. **Fidelity** — reproduce the *user's* failure, not a nearby lookalike. A
   green shallow seam is not a repro.
2. **Diagnosticity** — every signal you call confirming/falsifying must be
   *specific* to the hypothesis, not also explainable by a confound.

**Division of labor.** The orchestrator does all epistemics (framing,
hypotheses, experiment design, interpretation). Delegate only mechanical edits
(via the `fast-edit` skill) and *raw quoted extraction* (via the `explore`
skill) — never analysis. Over-generalization starts the moment interpretation
leaks to the executor or is decided after seeing data.

**Diagnosis log.** One markdown file per investigation
(`~/.davstack/diagnoses/<slug>.md`). It holds **only** pre-registration — hypothesis
cards, experiment cards, the Phase-3 separation table, and one-line verdicts —
written **before** the data exists, **append-only, never rewritten** (their
epistemic force is that they predate the data; that *is* the resume point).
Everything else — status headers, progress narration, synthesis, the distilled
root-cause writeup — is **deferred to a single terminal flush** (at the finale,
or when context is about to max). Do not narrate as you go: the harness already
summarizes the conversation, so log narration is pure duplication and is the
largest avoidable token sink. Format/cadence provisional; iterate via
`~/.davstack/diagnose-feedback/`.

**No-echo rule.** After writing a card to the log, don't restate the
details in chat — a one-line gist is fine (`H3 added: stale cache`), but no
re-pasting, no re-explaining what's already on disk. Chat is for the next
decision, not for mirroring the file.

**Write terse.** Cards and verdicts are notes-to-self, not prose. Fragments
over sentences, sacrifice grammar/articles — the goal is recall, not
readability. A 30-word card beats a 200-word one.

**Goal is the fix, not the document.** Documentation serves diagnosis;
diagnosis does not serve documentation. If you're polishing the log instead
of dispatching the next experiment, you're in the wrong loop.

**Large artifacts.** Eval `REPORT.md`, big test/prompt/log files: scoped grep
or a delegated `explore` slice — never a full re-read
(`feedback_delegate_big_file_recon`). Compounds with the note rule above.

**Daemon prereq.** This loop leans on `logs-server`, `vitest-server`, and
`playwright-server`. First run `davstack check` to confirm the required
daemons are running — it prints the start instructions if anything's missing.

## 0 — Frame

The problem in the user's terms, before code: exact symptom verbatim (expected
vs. seen); what changed; what they've **already ruled out**; glossary/ADRs in
scope. Output: a one-paragraph problem statement you will later prove your
repro matches.

## 1 — Feedback loop

**Still the skill.** A fast, deterministic, agent-runnable pass/fail signal
makes the rest mechanical; without one, staring at code won't save you. Be
aggressive.

Try, in order: failing test at the reaching seam → curl/HTTP → CLI + fixture
diff → headless browser → replay a captured trace → throwaway harness →
property/fuzz → `git bisect run` → differential (old vs. new) → HITL script
(last resort). Then sharpen it: faster; assert the *specific* symptom (not
"didn't crash"); deterministic (pin time, seed RNG, isolate fs/net).
Non-deterministic ⇒ raise the *repro rate* (loop 100×, parallelise, stress)
until debuggable.

Can't build one? Stop, say so, list what you tried, ask for env access / a
captured artifact / instrumentation permission. Don't hypothesise without a
loop.

## 2 — Reproduce + fidelity gate

Run it, watch the bug, then prove fidelity adversarially:

- [ ] It's the **user's** symptom from Phase 0 (same error/value/timing), not
      a nearby failure.
- [ ] Reproducible across runs (or at a high enough rate).
- [ ] Exact symptom captured for later fix-verification.

Can't reproduce the *user's* failure specifically ⇒ that is the first
investigation, not something to paper over.

## 3 — Hypothesis tree

≥3 mutually distinguishable hypotheses before testing any (one anchors). Each,
in writing:

- **Mechanism** — the causal story, concretely.
- **Signature** — what you'll see, at which seam, in what order/value,
  *because* of the mechanism.
- **Confounds** — every *other* mechanism producing that same signature. If you
  can't make the signature specific, Phase 4 must add an observation that
  separates them.
- **Falsification** — what must be absent/true if it holds.

**Exit artifact (append-only, before any experiment):** a *separation table* —
one row per live hypothesis; columns = its discriminating observation · each
enumerated confound · the observation that is **absent** under that confound. A
hypothesis with no confound-separating observation is not yet testable: split or
sharpen it until it has one.

Evidence narrows the tree: a discriminating result selects a branch; spawn
children and recurse. Show the ranked list to the user (cheap re-rank: "we
just deployed #3"); proceed on your ranking if AFK.

## 4 — Pre-register the experiment (before any code)

The **cheapest experiment whose outcome differs per hypothesis** (one all
predict alike is worthless). Per hypothesis, an *experiment card* in the
diagnosis log **before** dispatching — written-first is what makes
pre-registration real:

- **Instrumentation** — which seams (state transitions, service boundaries),
  what `diag` debug logs, each discriminating line tagged with its hypothesis
  id in `diag.tag`, correlated via `diag.run_id`/`trace_id`.
- **Positive control** — a probe on a path you *know* executes. Silent in the
  digest ⇒ the run is **VOID**, never FALSIFIED.
- **Decision rule, now** — CONFIRMED iff the signature appears, replicated ≥2
  runs; FALSIFIED iff predicted-and-absent on a *non-void* run; VOID iff the
  positive control is silent.
- **Separation gate (blocking — no experiment is dispatched until this
  passes):** every live hypothesis has, in writing, an observation present
  under it AND absent under *every* enumerated confound (the Phase-3 separation
  table). Missing one ⇒ the experiment is non-diagnostic *by construction*.
  Under token/time pressure this is the **last** thing compressed, never the
  first.

Instrumentation doctrine: **capture broad by default** — instrument every seam
on the path in one pass, store all of it. `diag` retrieval is
correlation-scoped (run_id/trace_id) and hypothesis-tagged, so breadth costs
nothing at analysis. **A second instrument-and-rerun loop is a capture failure,
not a step** (this episode lost ≈4 costed runs to narrow/broken capture).
Volume is safe *only* with run_id/trace_id scoping + pruning (`--prune-days`);
unscoped queries get expensive — the 49KB "output too large" was the early
warning. Log misfires to `~/.davstack/diagnose-feedback/`.

## 5 — Delegate instrumentation

Default to `fast-edit` — manual edits here burn orchestrator tokens for zero
epistemic gain. Hand a precise spec:

    target_files, hypothesis_log (= ~/.davstack/diagnoses/<slug>.md),
    add_logs: [{file, seam_name, insertion_anchor, tag, capture: […]}],
    constraints: ["only diag(...) + import; no other edits"].

Pass the diagnosis log path rather than restating hypotheses — the executor
reads it for context but does no analysis. Typecheck only. One pass; if it
won't apply cleanly the handback is the finding — don't widen scope.

**Additive-only gate (blocking).** Before dispatching the run, scan the diff
yourself: any hunk touching control flow, dep arrays, conditionals, signatures,
or anything other than `diag(...)` calls + their import ⇒ revert the offending
hunk and re-dispatch. A runtime-behaviour change mid-investigation contaminates
every run that follows; the resulting data is not comparable across runs. This
is non-negotiable; do not "revert later".

**Capture preflight (blocking — before the first costed/expensive run):** one
cheap smoke asserting a *known* DEBUG seam line round-trips into `diag` and is
queryable by run_id. Capture defects (sink not initialised in the test process,
level filter dropping DEBUG, gzip/encoding, timeout) must surface here, on a
free run — never on an expensive agentic eval. Smoke silent ⇒ fix capture
before spending a real run.

## 6 — Run + raw extraction

Drive the **real** repro (the user's path, not a proxy). Delegate the run
read-only via the `explore` skill; it returns the `diag query` digest **as
quoted evidence only** — quote-extractor, not analyst. ≥2 independent runs
(single-run signals never count).

## 7 — Interpret (orchestrator only): the diagnosticity gate

For **every** observation before calling it confirm/falsify:

> *Is this DEFINITELY confirming/falsifying what I think it is — or could this
> same observation have another cause? If so, how do I tell which one actually
> produced it?*

1. State what you think it means.
2. Adversarially list every *other* mechanism producing this same observation.
   This is the step that gets skipped.
3. Any plausible alternative ⇒ **non-diagnostic as-is**: resolve with a further
   specific signal in the slice (present under H, absent under the confound) or
   one more 4–6 iteration.
4. Positive control silent ⇒ **VOID**; falsify nothing from it.
5. Accept only when the signature is specific *and* replicated, and competitors
   are **positively excluded** by their own predicted-and-absent signals — not
   "less likely".

Never generalize from one signal; absence ≠ evidence-of-absence unless the
experiment was *powered* for the positive. Record each verdict and the confound
it beat in the log as you go.

## 8 — Root cause + fix-as-hypothesis

Declare a root cause only when: one hypothesis confirmed by its specific
replicated signature; all competitors positively excluded; and you've answered
*"what would make this wrong, and did I look for it?"*

The fix is itself a hypothesis. Verify by re-running the **user's** repro
(Phase 2), not the shallow seam. Regression test only at a **correct seam**
(exercises the real bug pattern at the call site). No correct seam ⇒ *that is
the finding*: the architecture prevents lockdown — flag it.

## 9 — Cleanup + post-mortem

- [ ] User's repro no longer reproduces (re-run Phase 2).
- [ ] Regression test passes, or no-correct-seam documented.
- [ ] Hypothesis-tagged `diag` probes removed; hypothesis-neutral seam logs may
      stay — state which and why.
- [ ] PR states the confirmed hypothesis **and the confound it beat**.
- [ ] Diagnosis log distilled: root cause, confound distinguished from,
      anything still open.
- [ ] Misfires logged to `~/.davstack/diagnose-feedback/`.
- [ ] Architectural root cause ⇒ hand to `/improve-codebase-architecture`
      *after* the fix lands.
