Reflections from running `explore` BOTH ways on the *same* task in one session, so this is a
controlled A/B, not two unrelated jobs. Task: "produce a completion / gap-map for the
enum-contains workstream — what's done vs outstanding vs superseded, judged against the actual
code." I ran `--file <spec>` and `--compact-mode "map remaining enum-contains work against what
we implemented"` back-to-back against an identical repo state, then diffed the two deliverables.
Verdict up front: **for this task `--file` was the better output, but the reason is instructive
and the two are genuinely complementary — neither alone was complete.**

## What each produced

- **`--file`** (scoped spec; I hand-wrote goal + the one supersession gotcha + the
  committed-vs-uncommitted facts + explicit path scope): ~480-line gap-map grouped by workstream,
  dual-sided evidence (the doc that states a goal AND the code path:line that does/doesn't satisfy
  it), explicit DONE/PARTIAL/OUTSTANDING/SUPERSEDED labels, plus a supersession table.
- **`--compact-mode`** (5-word inline, distilled the spec from the live transcript): one tight
  status matrix + thematic evidence blocks. Leaner, faster to read.

## The deciding difference: coverage mirrors the context source

This is the real finding, and it predicts when to use which:

- **`--file` covers what you point it at.** I scoped it to read `constraints/` source, so it found
  the highest-value item in the whole audit: an existing unit test
  (`test_substring_operator_rejected_when_allowed_values_present[contains]`) that the proposed
  change **breaks** — a concrete ship blocker. I verified it; it does fail. Nothing in our
  conversation had mentioned that test, so it could only be found by *systematically reading the
  code*, which is exactly what a path-scoped spec forces.

- **`--compact-mode` covers what the conversation knows.** It distilled the transcript, so it was
  excellent at surfacing a *tension already latent in the discussion*: it independently flagged the
  n=25-vs-r10 contradiction (baseline VSL 25/25→72 in one doc, 9/10→188 in another) as
  "reconcile". That's a synthesis catch — it connected two things we'd touched. But it **missed the
  breaking test**, because that test was never in the transcript.

So the blind spots are symmetric and predictable: compact can't catch what wasn't discussed; file
can't catch what you didn't scope. For a **completion/ship audit** — where unknown blockers and
systematic coverage are the whole point — `--file` wins. For a **"where do we stand / what's
inconsistent"** read, compact wins and at ~10× lower authoring effort (5 words vs a 40-line spec).

## What compact got for free that file made me re-type

Worth calling out for the SKILL.md guidance: the spec gotcha I most cared about — "later docs
supersede earlier ones, here's the implementation reality" — compact inherited *for free* from the
transcript. For `--file` I had to hand-write all of it into the spec, and if I'd forgotten the
supersession note the file agent would have reported stale doc TODOs as open work. So the existing
guidance ("prefer compact when the conversation already has the context") is right and earns its
keep — compact is lower-effort AND less error-prone *for the context it can see*. The catch is only
coverage of things outside the transcript.

## Recommendations for the skill

1. **Document the coverage-vs-context tradeoff explicitly in SKILL.md.** Current guidance frames
   compact-vs-file as "is the context already in the conversation?" That's necessary but not
   sufficient. Add: *compact's coverage is bounded by the transcript — it will not find blockers in
   code that wasn't discussed. For completeness/audit/"did we miss anything" tasks, use `--file`
   with explicit code scope, or run both.*

2. **Offer a hybrid: `--compact-mode --also-scan <paths>`.** The ideal for this task was compact's
   free transcript context PLUS a forced systematic read of named files. Today I had to choose. A
   compact run that ALSO guarantees coverage of explicitly-named paths would have caught both the
   contradiction and the breaking test in one job.

3. **Running both is a cheap power-move — make it a documented pattern.** Two jobs on one task cost
   little and the outputs covered each other's blind spots (file found the blocker, compact found
   the contradiction). A one-liner in SKILL.md ("for high-stakes audits, fan out one compact + one
   scoped file and diff them") would surface this.

4. **For the deliverable shape: `--file`'s dual-sided evidence (doc-claim path:line + code-reality
   path:line, side by side) is the more verifiable format** and should be the default the
   spec-writer aims for, because it lets the caller re-derive each verdict in one click instead of
   trusting a synthesis sentence.

## Tool friction hit along the way (secondary, but worth fixing)

- **The installed `.claude/skills/explore` copy was stale** — it pointed at an old
  `bun .../scripts/explore.ts` CLI that rejected my inline `<goal>` with "shell-hostile chars" and
  swept "stray 0-byte .test.ts litter". The real entrypoint is the global `explore` bin from
  `@davstack/open-agents`. `npx explore` also failed ("could not determine executable"). A user
  following SKILL.md's `npx explore submit` verbatim hits a dead end; the working invocation
  (global bin, or pnpm-linked local) isn't obvious. Worth a one-line "if `npx explore` fails, the
  bin is `@davstack/open-agents` — install/link it" note.
- **Inline single-fact form `'<goal>..</goal> <scope>..</scope>'` is fragile** — the `<>?()` chars
  trip a shell-hostility guard, so the documented single-fact path effectively forces you to
  compact-mode or `--file` anyway. Either escape-handle it or drop the inline-tags form from the
  docs.

Net: both modes are good; the choice is "transcript-synthesis (compact, cheap)" vs
"systematic-coverage-of-scoped-code (file, thorough)", and for anything where *missing something is
the failure mode*, file — or both. The single most valuable upgrade would be letting compact-mode
also take explicit `--also-scan` paths so you stop having to choose.
