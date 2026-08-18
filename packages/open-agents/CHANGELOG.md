# @davstack/open-agents

## 2.0.0

### Major Changes

- a5ce721: Run profile entrypoints exactly once, fall back from unstartable Cursor Agent
  installations, use `cursor-grok-4.6-high-fast` by default, and replace the
  `--smarter`/`--faster` model tiers with the explicit `--model <id>` override.

## 1.3.0

### Minor Changes

- 81da911: Add `@davstack/context-compactor`: a TS-native, deterministic context-compaction package with structure-aware handlers (JSON, code, log, diff, text) and TOON output for arrays of uniform objects. open-agents now compacts spec-writer handoff history through it before generation, replacing the removed Headroom proxy integration.

### Patch Changes

- Updated dependencies [81da911]
  - @davstack/context-compactor@0.2.0

## 1.2.5

### Patch Changes

- 458c0ec: Add optional Headroom proxy routing plus Codex compact-history discovery.

## 1.2.4

### Patch Changes

- Add compact handoff mode for `explore` and `fast-edit`, including transcript-backed spec writing, Claude Code transcript auto-detection, file-backed compact spec-writer prompts on Windows, and clearer compact-mode progress output.

## 1.2.3

### Patch Changes

- Updated dependencies
  - @davstack/cli-utils@1.3.0

## 1.2.2

### Patch Changes

- Re-publish of 1.2.1 — the previous publish went via `npm publish` and shipped `"@davstack/cli-utils": "workspace:*"` literally in the manifest, which is unresolvable for end-users. This release is published via `pnpm publish`, which rewrites `workspace:*` to a pinned version. No code changes vs 1.2.1. 1.2.1 will be deprecated.

## 1.2.1

### Patch Changes

- Emit a tail-stable `RESULT_PATH: <abs path>` sentinel on stdout (one per job) as the final write in `submit`, after `adapter.postExit` (Issue 48):

  - When the parent runner captures only the last few KB of our stdout (e.g. Claude Code's backgrounded-subagent `.output` file tail-truncates around ~1.3KB), the existing `result → <path>` line at the top of the inline body gets sliced off.
  - The new sentinel sits below `postExit` chatter so it is the very last line(s) of stdout — one grep recovers the deliverable pointer regardless of how aggressively the transport truncates.
  - No change to the existing `result → <path>` header or the inlined `--- deliverable ---` body; this is additive.

## 1.2.0

### Minor Changes

- 06962d2: Expose `./core/{jobs,parse,paths,deliverable}` and `./adapters/{types,cursor,gemini}` subpath exports (with matching `.d.ts` from tsup) so the davstack TUI agent run viewer can import the existing parser, job-store, path, and adapter modules without duplicating logic. Additive `package.json` / build entries only — no runtime behavior changes.

## 1.1.2

### Patch Changes

- Updated dependencies [2c18da2]
  - @davstack/cli-utils@1.2.0

## 1.1.1

### Patch Changes

- Updated dependencies [ade2196]
  - @davstack/cli-utils@1.1.1

## 1.0.1

### Patch Changes

- Docs-only: README install snippet now shows `pnpm add -g` and bare
  `explore` / `fast-edit` invocations to match the global-install flow
  that `@davstack/init@1.2.2` now uses. No code changes.

## 1.0.0

### Major Changes

- Initial 1.0.0 release.

### Patch Changes

- Updated dependencies
  - @davstack/cli-utils@1.0.0
