---
"@davstack/logs-server": minor
"@davstack/vitest-server": minor
"@davstack/playwright-server": minor
---

Rename the per-server install-validation verb `check` → `doctor` (matching
`brew doctor` / `flutter doctor`), freeing `check` for the `davstack check`
orchestrator only. Behaviour, flags (`--json`, `--cwd`, …) and output are
unchanged. The old `check` verb is retained as a deprecated alias that
delegates to `doctor`, so existing scripts keep working for now — migrate to
`<server> doctor`. `health` (liveness ping) is unchanged.
