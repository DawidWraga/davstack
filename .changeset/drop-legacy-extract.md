---
"@davstack/playwright-server": minor
---

Drop `legacyExtract` config option and the legacy regex-based spec
runner. The registration-interception runner is now the only path:
specs load as real ES modules, supporting full TypeScript, multiple
`test()` blocks, `test.describe`, `beforeEach`/`afterEach`, and
`test.use({ storageState })`. Custom `test.extend(...)` fixtures remain
the one unsupported case. Requires Node >= 22.6.

Also: docs (README, setup.md, usage.md, troubleshooting.md, SKILL)
aligned to the scaffolder-first doctrine — `pnpx @davstack/init` is the
recommended install path, `davstack start` is the recommended boot path,
with `pnpm exec playwright-server serve` retained as the standalone
alternative.
