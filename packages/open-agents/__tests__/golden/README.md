# Phase 0 behavioural golden — regression oracle

Captured 2026-05-19 on `migrate/davstack-skills` @ ROLLBACK_BASE
`e578be103749448c266dbabb71305dfc1674180e`, using the **current** tool
(`cursor-jobs/skill/tool/cursor-jobs.ts`, model `composer-2.5`) against a
throwaway scratch repo.

These artifacts are the parity oracle for **Phase 2** (and re-checked through
the built script in Phase 3). Parity = *same deliverable shape + same exit code
+ same actual on-disk effect*. They are scratch until Phase 2 formalises them
into `open-agents/test/golden/`.

## Scratch repo
`C:\Users\dpwra\dev\_mig-scratch` — git repo, baseline commit
`70466078a2ebeebc58c4ec844fca7b691e5b4a13`. Files: `src/math.ts`,
`src/strings.ts`, `src/index.ts`, `tsconfig.json`. Disposable; recreate from
`explore-spec.md`/`edit-spec.md` context if lost.

## GOLDEN-EXPLORE  (read-only profile)
- spec: `explore-spec.md`  ·  job id `20260519-161854-4bd9`
- `submit` exit **0**, status `done`, `edit:false`, `filesChanged:[]`, ~45s
- index → `GOLDEN-EXPLORE.index.txt`  ·  deliverable → `GOLDEN-EXPLORE.result.md`
  · job record → `GOLDEN-EXPLORE.job.json`
- **Shape invariants:** deliverable is SENTINEL-sliced (starts at the `##`
  heading, zero preamble/narration); each finding is a `path:Lstart-Lend` line
  + fenced verbatim source; no prose between findings; read-only honoured
  (`filesChanged:[]`, scratch repo `git status` clean after run).
- index line shape: `### cursor-job <id> — done (exit 0) · composer-2.5 · Ns`
  / `label:` / `result → <abs path>` / `follow-up: cursor-agent --resume=<uuid>`
  — **no "files changed:" block** for explore.

## GOLDEN-EDIT  (one-pass edit profile, `--edit`)
- spec: `edit-spec.md` (has `<acceptance>` ⇒ no missing-acceptance warning)
  · job id `20260519-162008-a363`
- `submit` exit **0**, status `done`, `edit:true`, ~69s
- index → `GOLDEN-EDIT.index.txt`  ·  deliverable → `GOLDEN-EDIT.result.md`
  · job record → `GOLDEN-EDIT.job.json`
- **On-disk effect (authoritative):** `src/math.ts` only, `+4` lines, exactly
  the requested `export function triple(n: number): number { return n * 3 }`;
  `src/index.ts` and all other files untouched (scope respected). Verified by
  `git diff` in the scratch repo (1 file changed, 4 insertions).
- **Shape invariant:** deliverable is the SENTINEL-sliced requested artifact
  (the new function in a ```typescript fence), no narration.

## ⚠ Load-bearing baseline quirk — DO NOT "fix" as part of the migration
`filesChanged` is **`[]` even for the successful edit**. Cause (proven, not
assumed): `lib/parse.ts:summariseEvents` derives `filesChanged` only from
streamed `tool_use`/`tool_call` write events via `walkToolUses`; this
cursor-agent version on Windows does not surface file-write tool calls in a
shape/keying that matches (`WRITE_TOOL_HINTS` / the path-key set). So:

- The **authoritative** "the edit happened" signal is **exit 0 + the on-disk
  git diff**, NOT `filesChanged`.
- Phase 2 parity gate ⇒ assert `filesChanged == []` (baseline), deliverable
  shape, exit code, and the **actual scratch-repo diff** — NOT "filesChanged
  is now populated". Improving file-change attribution is a *separate,
  post-migration* change; making it populated during the refactor would be a
  spec violation of "behaviour identical to the Phase-0 golden".
- The plan's "files-changed ⊆ declared" criterion holds trivially (∅ ⊆ any).

## Other observed runtime behaviour (both runs)
- cursor-agent drops a 0-byte `.test.ts` write-probe at the scratch root on
  Windows; the tool's `sweepDotTest` removes it and logs
  `cursor-jobs: swept stray 0-byte .test.ts (cursor-agent Windows probe
  litter)` to **stderr**. Relevant to the **Phase 2 shim/adapter empirical
  gate** (Appendix D) — this sweep is cursor-only litter handling and must
  move into `adapters/cursor.ts`, not the generic loop.
- Progress goes to **stderr**; **stdout** is only the compact index + the
  `--- deliverable file(s) ---` trailer. (Parity: stdout/stderr split preserved.)
