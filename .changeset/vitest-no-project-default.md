---
"@davstack/vitest-server": minor
"@davstack/init": patch
---

Remove the `project: 'storybook'` default from the scaffolded
`vitest-server.config.ts` template and the canonical docs example. It
silently broke unit-test projects that didn't have a `storybook` vitest
project configured. `project` is now documented as an optional filter
(set only when you have multiple vitest projects and want one kept
warm).

Also: vitest-server docs (setup.md, usage.md) aligned to the
scaffolder-first doctrine — `pnpx @davstack/init` is the recommended
install path, `davstack start` is the recommended boot path, with
`pnpm exec vitest-server serve` retained as the standalone alternative.
