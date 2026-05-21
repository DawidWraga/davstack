# @davstack/init

Interactive bootstrap CLI for the davstack daemons:

- `@davstack/logs-server` — local Sentry-shaped log sink
- `@davstack/vitest-server` — warm vitest daemon
- `@davstack/playwright-server` — warm chromium daemon

## Usage

```bash
npx @davstack/init
```

The CLI:

1. Detects the repo root (`git rev-parse --show-toplevel`, then workspace
   markers, then any `package.json`, falling back to cwd).
2. Detects the package manager from the lockfile (pnpm / yarn / bun /
   npm).
3. Prompts you (checkbox) for which daemons to wire up.
4. Installs them as devDependencies (pnpm-workspace roots get `-w`).
5. Scaffolds `.davstack/config/<tool>.config.ts` for each selected tool.
6. Appends `.davstack/*` and `!.davstack/config/` to `.gitignore`.

## Flags

| flag | effect |
| --- | --- |
| `--all` | select all tools, skip prompt |
| `--tools=logs-server,vitest-server` | explicit selection, skip prompt |
| `--skip-install` | scaffold only — don't run the package manager |
| `--no-scaffold` | install only — don't write `.davstack/` |
| `-h`, `--help` | usage |

Env: `DAVSTACK_INIT_SKIP_INSTALL=1` is equivalent to `--skip-install`.

## Layout written

```
.davstack/
  config/
    logs-server.config.ts
    vitest-server.config.ts
    playwright-server.config.ts
```

Runtime files (created by the daemons on first boot) live at
`.davstack/logs.db`, `.davstack/port`, `.davstack/cache/` and are
gitignored.
