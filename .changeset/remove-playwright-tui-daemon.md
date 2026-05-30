---
"@davstack/tui": patch
---

Drop the retired playwright-server daemon from the supervisor: removed its `DaemonDescriptor`, the `"playwright"` `DaemonKey`, and `PLAYWRIGHT_DEFAULT_PORT`. The TUI now manages logs and vitest servers only.
