---
"@davstack/tui": minor
---

Agent run viewer (Issue 30, read-only):

- `g` from the daemons list opens an Agents view listing every open-agents job for the current repo (status glyph + inferred title + relative date)
- `enter` drills into a 3-pane focus view: `s` spec (markdown-rendered), `l` logs (tailed NDJSON timeline with cursor `tool_call` → tool-name+args), `d` diff (async `git diff HEAD -- <filesChanged>`)
- Body region reserves a fixed height so pane swaps don't leak previous frames
- `cli.ts` uses the terminal alt-screen buffer (`\x1b[?1049h`/`l`) so the TUI takes its own scrollback and restores yours on quit. Opt out with `DAVSTACK_NO_ALTSCREEN=1`
- Bottom bar trimmed to daemon pills (the dedicated agents view replaces the chip row)
- Every list view collapses its keyboard hint behind `c for controls` by default
