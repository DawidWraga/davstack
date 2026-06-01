# @davstack/cli-utils

Zero-dep CLI scaffolding shared by the davstack daemon packages (`logs-server`, `vitest-server`).

## Why

- **Spec-driven CLIs.** Declare verbs + flags + positionals + sub-commands as one tree; parsing, `--help`, and exit codes (0 ok / 1 handler error / 2 usage) fall out for free.
- **Shared config resolver.** `findRepoRoot` + `findToolConfig` give every davstack daemon the same `<repo-root>/.davstack/config/<tool>.config.ts` lookup, with git-root + workspace-marker fallbacks.
- **Zero runtime deps.** Pure TS, no commander/yargs/citty. Ships as source — consumers run it via `bun` or `node --experimental-transform-types`.

## Install

```bash
pnpm add @davstack/cli-utils
```

Library-only — no `bin`. Consume from your daemon's entry file.

## Usage Example

```ts
import { defineCli, type CommandSpec } from "@davstack/cli-utils"
import { findToolConfig } from "@davstack/cli-utils/config"

const serve: CommandSpec = {
  description: "Boot the daemon",
  flags: {
    port: { type: "number", default: 5179, env: "MYTOOL_PORT" },
    host: { type: "string", default: "127.0.0.1" },
  },
  run: async ({ flags }) => {
    const configPath = findToolConfig("mytool")  // <repo>/.davstack/config/mytool.config.ts
    // ... boot server using flags + (optional) config file
    return 0
  },
}

const cli = defineCli({ name: "mytool", description: "My daemon", commands: { serve } })
process.exit(await cli.run(process.argv.slice(2)))
```

```bash
$ mytool serve --port 6000          # flag wins over env wins over default
$ mytool serve --no-some-bool       # boolean negation
$ mytool --help                     # auto-generated help tree
```

## Exports

| Subpath | Source | Surface |
|---|---|---|
| `@davstack/cli-utils` | [`src/cli.ts`](./src/cli.ts) | `defineCli`, `parseArgs`, `coerceFlag`, `CommandSpec`, `CliSpec`, `FlagSpec` |
| `@davstack/cli-utils/help` | [`src/cli-help.ts`](./src/cli-help.ts) | `formatHelp(commandPath, spec)` |
| `@davstack/cli-utils/config` | [`src/config.ts`](./src/config.ts) | `findRepoRoot(start?)`, `findToolConfig(toolName, cwd?)` |

Type signatures live in source — read them rather than re-documenting. Real consumers: `packages/logs-server/src/index.ts`, `packages/vitest-server/src/index.ts`.
