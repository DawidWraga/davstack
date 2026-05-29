---
"@davstack/tui": minor
---

`davstack check` is now terse on success: when every configured daemon is up
it prints a single line (`✓ All davstack daemons running and ready.`) with no
header or per-daemon table, keeping an agent's context clean. The full table
plus the start hint still print when something is down. Exit codes are
unchanged (0 ok / 1 some down / 2 no config). The start hint now reads
`davstack start` instead of `pnpm dlx @davstack/tui start`.
