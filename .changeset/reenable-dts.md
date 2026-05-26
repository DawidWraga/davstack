---
"@davstack/cli-utils": patch
"@davstack/logs-server": patch
"@davstack/vitest-server": patch
"@davstack/playwright-server": patch
---

Ship `.d.ts` declarations so consumers can import `ServerConfig` (and
other public types) from `@davstack/{logs,vitest,playwright}-server/config`
and `@davstack/cli-utils` without `TS2307: Cannot find module ... or its
corresponding type declarations`.

Runtime output is byte-stable — only declarations are new. Non-breaking.

See: 8065fc9 (`fix(daemons): ship .d.ts for @davstack/{cli-utils,logs-server,vitest-server,playwright-server}`)
