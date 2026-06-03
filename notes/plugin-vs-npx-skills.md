# Claude Plugin vs `npx skills` for davstack distribution

> Status: **research only, no decision made.** Captured for future reference.
> Date: 2026-05-30

## Question

Should davstack distribute its agent-facing skills as a **Claude Code plugin**
instead of the current **`npx @davstack/init` / `npx skills add`** flow?

## TL;DR

A plugin would cleanly replace *only the skill-distribution slice* of init, not the
whole CLI. It's complementary, not a replacement. Current lean: **stay on `npx`
skills for now** — the plugin upside is real but not urgent, and the CLI still has to
exist regardless.

## The three concepts

- **MCP** — protocol that gives the agent *new tools / external connections* (a running
  server process). Adds capability.
- **Skill** — packaged *instructions / workflow* (a folder + `SKILL.md`). Guides the
  tools the agent already has; adds no capability.
- **Plugin** — a *distribution bundle* that can contain skills + slash commands +
  subagents + hooks + MCP declarations. The unit of install / share / version,
  delivered via a marketplace (`/plugin marketplace add ...`, `/plugin install`).

Mental model: MCP = new hands · Skill = new know-how · Plugin = the box you ship them in.

## What `@davstack/init` actually does (3 jobs)

| # | Job | A plugin can replace it? |
|---|---|---|
| 1 | Installs npm daemon packages (`logs-server`, `vitest-server`, `playwright-server`, `open-agents`) as repo deps | ❌ No — plugins don't add deps to a user's repo |
| 2 | Scaffolds typed `.davstack/config/*.config.ts`, patches `.gitignore` | ❌ No — plugins don't write project files |
| 3 | Installs skills into `~/.claude/skills/` | ✅ Yes, and arguably better |

So a plugin maps onto job #3 only. Jobs #1 and #2 are real work a plugin
fundamentally cannot do — that's the CLI's reason to exist.

## Why a plugin *would* be nice (for job #3)

- **No symlinks.** `npx skills add` symlinks into `~/.claude/skills`, which is the flaky
  part on Windows. Plugin skills resolve from the plugin root via
  `${CLAUDE_PLUGIN_ROOT}` — no symlink dance.
- **Versioned + updatable** through the marketplace (`/plugin update`) instead of the
  "re-run init to bump `SKILL.md`" mechanism.
- **Free extras** in the same bundle: real slash commands (`/diagnose`,
  `/davstack-start`), hooks (e.g. auto-start daemons on session start).
- **Clean uninstall**, no global `~/.claude` pollution.

## The catch — they're complementary, not either/or

The skills instruct the agent to run `npx explore submit`, `npx vitest-server serve`,
etc. Those CLIs **must be installed in the repo** for the skills to function. So even
if a plugin ships the skills, the init CLI is *still needed* to install the daemon
packages and scaffold their config. Two layers:

```
Plugin   -> agent-facing layer:  skills, commands, hooks   (was job #3)
init CLI -> repo-side layer:      deps + .davstack/config   (jobs #1, #2)
```

If we ever did the split, a nice property falls out: someone could `/plugin install`
the skills just to *read/understand* the workflows, then run init only in repos that
actually need the daemons.

## Explicit non-recommendation

Do **not** convert the daemons themselves into MCP servers just to force everything
into the plugin. The warm-daemon-shared-via-`.davstack/` design (persistent across
turns) doesn't map onto MCP's per-session stdio model. The structured-JSON-CLI-over-Bash
approach is the right call there — keep it.

## Where this could go later (if revisited)

- **Do nothing** — keep `npx skills add`. Lowest effort; the CLI has to exist anyway.
- **Split** — skills move to a plugin; init shrinks to deps + config scaffold only.
  Best ergonomics, more moving parts to maintain.
- Either way, the daemon packages + config scaffold stay on the CLI.
