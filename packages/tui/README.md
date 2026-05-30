# @davstack/tui

Long-running terminal UI that spawns, owns, and surfaces the davstack
daemons (`logs-server`, `vitest-server`). One process
to launch on `cd`, one quit to stop everything cleanly.

## Install / run

From inside a davstack-shaped repo (one with `.davstack/config/*.config.ts`):

```sh
pnpm dlx @davstack/tui start
```

The TUI auto-discovers which daemons are enabled by scanning
`.davstack/config/<tool>.config.ts` at the repo root, spawns each one,
streams its output into a ring buffer, and shows live status pills.

Flags:

- `--no-color` — disable ANSI colors (also honours `NO_COLOR` env).

## Checking daemon health

`davstack check` probes every configured daemon and exits 0 if all are
running, 1 if any are missing, 2 if no davstack configs exist. Cheap
enough to run at the start of any agent workflow.

## Keybindings

| Key      | Where      | What                                             |
|----------|------------|--------------------------------------------------|
| `1`-`9`  | any view   | jump to that daemon's log view                   |
| `↑` / `↓`| list view  | move focus between rows                          |
| `enter`  | list view  | drill into the focused daemon's log view         |
| `s`      | list view  | start/stop the focused daemon                    |
| `esc`    | log view   | back to the daemon list                          |
| `c`      | log view   | clear the current daemon's ring buffer           |
| `q`      | any view   | quit (confirms first if any daemon is running)   |
| `ctrl-c` | any view   | same as `q`                                      |

When `q` triggers confirm-on-quit, only `y` / `n` / `esc` are active.

## Daemons

| Daemon              | Default port | Purpose                                                 |
|---------------------|--------------|---------------------------------------------------------|
| `logs-server`       | `7077`       | Local log sink — Sentry-shaped store + `diag` queries.  |
| `vitest-server`     | `5179`       | Warm vitest daemon for fast unit/storybook reruns.      |

Each is independently enabled by dropping its config under
`.davstack/config/`. Daemons that aren't configured are skipped — the TUI
only shows what you've opted into.

## Troubleshooting

- **Port already in use**: a daemon's row shows `blocked :PORT` instead of
  starting. Kill whatever else is on that port, then press `s` on the row.
- **Windows orphan handling**: shutdown uses HTTP `/shutdown` then SIGTERM,
  finally SIGKILL via `taskkill /F /T` so bun grandchildren can't orphan.
- **Requires Node 24+**: the launcher runs `tsx` under your installed
  Node. Older Node versions are unsupported.

See the monorepo root [README](../../README.md) for the broader davstack
toolkit.
