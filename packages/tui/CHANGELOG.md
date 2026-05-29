# @davstack/tui

## 0.5.0

### Minor Changes

- af3bbda: `davstack check` is now terse on success: when every configured daemon is up
  it prints a single line (`✓ All davstack daemons running and ready.`) with no
  header or per-daemon table, keeping an agent's context clean. The full table
  plus the start hint still print when something is down. Exit codes are
  unchanged (0 ok / 1 some down / 2 no config). The start hint now reads
  `davstack start` instead of `pnpm dlx @davstack/tui start`.

## 0.4.1

### Patch Changes

- @davstack/open-agents@1.2.3

## 0.3.2

### Patch Changes

- Re-publish of 0.3.1 — the previous publish went via `npm publish` and shipped `"@davstack/open-agents": "workspace:*"` literally in the manifest, which is unresolvable for end-users. This release is published via `pnpm publish`, which rewrites `workspace:*` to a pinned version. No code changes vs 0.3.1. 0.3.1 will be deprecated.
- Updated dependencies
  - @davstack/open-agents@1.2.2

## 0.3.1

### Patch Changes

- Updated dependencies
  - @davstack/open-agents@1.2.1

## 0.3.0

### Minor Changes

- 22a095e: Agent run viewer (Issue 30, read-only):

  - `g` from the daemons list opens an Agents view listing every open-agents job for the current repo (status glyph + inferred title + relative date)
  - `enter` drills into a 3-pane focus view: `s` spec (markdown-rendered), `l` logs (tailed NDJSON timeline with cursor `tool_call` → tool-name+args), `d` diff (async `git diff HEAD -- <filesChanged>`)
  - Body region reserves a fixed height so pane swaps don't leak previous frames
  - `cli.ts` uses the terminal alt-screen buffer (`\x1b[?1049h`/`l`) so the TUI takes its own scrollback and restores yours on quit. Opt out with `DAVSTACK_NO_ALTSCREEN=1`
  - Bottom bar trimmed to daemon pills (the dedicated agents view replaces the chip row)
  - Every list view collapses its keyboard hint behind `c for controls` by default

### Patch Changes

- Updated dependencies [06962d2]
  - @davstack/open-agents@1.2.0

## 0.2.0

### Minor Changes

- a1ff7b9: Initial release: davstack start TUI for supervising vitest-server,
  playwright-server, and logs-server from a single terminal.
