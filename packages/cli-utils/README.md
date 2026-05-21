# @davstack/cli-utils

Zero-dep CLI helper shared by `@davstack/logs-server`, `@davstack/vitest-server`,
and `@davstack/playwright-server`.

Exports `defineCli`, `parseArgs`, `coerceFlag`, and types for building tiny
sub-command CLIs with flag parsing, env-var fallback, `--no-flag` negation, and
conventional exit codes (0 = ok, 1 = handler error, 2 = usage).

## Why hand-rolled

`commander` / `citty` pull more weight than the daemon CLIs need; `bunli` is
single-maintainer. Hand-rolled keeps the dependency surface small.

## Runtime

Consumers (the daemon packages) launch under
`node --experimental-transform-types`, which lets this package ship `.ts`
sources directly via the `"exports"` map — no build step.
