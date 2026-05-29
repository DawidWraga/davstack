# @davstack/init

## 1.5.0

### Minor Changes

- 9b53d8c: Split skill installation by location so daemon-skill doc links always resolve.

  Daemon skills (`logs-server`, `vitest-server`, `playwright-server`) reference
  `node_modules/@davstack/<pkg>/docs/...`, which only resolves from a specific
  project root. They now install **project-local** to `<root>/.claude/skills/`,
  and their doc links are rewritten to `../../../node_modules/@davstack/<pkg>/...`
  so they resolve directly from the installed file — locally, offline, and
  version-matched to the project's installed package.

  Orchestrator / open-agents skills (`diagnose`, `explore`, `fast-edit`) have no
  project-relative links and continue to install **globally** to
  `~/.claude/skills/`, available from every repo.

  On install, init also removes any stale **global** copy of a now-project-local
  daemon skill — but only the exact `SKILL.md` it previously generated (matched by
  a generated marker), and only removes the containing directory if it is then
  empty. Hand-authored skills and any other files are never touched.

## 1.4.0

### Minor Changes

- 5a8bea4: Generate init's shipped skill files from the canonical `skills/` instead of hand-forking them.

  `packages/init/src/skills/<name>.md` is now a generated artifact derived from the canonical `skills/<name>/SKILL.md` via `scripts/sync-init-skills.ts` (`pnpm gen:init-skills`). Relative repo doc links (`../../packages/<pkg>/...`) are rewritten to `node_modules/@davstack/<pkg>/...` so the installed skill's links resolve against the user's locally-installed, version-matched package docs (offline, no GitHub fetch). This fixes drift where the frozen fork shipped removed APIs to users.

  The three daemon packages now ship their `docs/**` and `README.md` so those rewritten links resolve inside `node_modules`.

### Patch Changes

- 2214848: Trim the generated skill CLI-reference to a lean bullet list (command +
  required positionals + one-line description, with a pointer to
  `<server> <command> --help` for flags) instead of an exhaustive table —
  the per-flag detail was noise. Deprecated aliases are dropped from the list.

  Move the daemon-lifecycle guidance ("ask the user to run `davstack start`
  in a separate terminal; don't run `serve` yourself") out of every daemon
  skill and into the `davstack check` failure output, since that advice only
  matters at the moment a daemon is reported down.

## 1.3.0

### Minor Changes

- af3bbda: Install the davstack TUI (`@davstack/tui`) globally on every init run, so the
  `davstack` bin (`davstack start` / `davstack check`) resolves from any repo —
  freshly-init'd repos now have the orchestrator the bundled skills expect. It
  ships unconditionally alongside the other global tools, independent of which
  daemons were selected (it's the orchestrator, not a selectable daemon).
  `printNextSteps` now points at `davstack start` (in a separate terminal) +
  `davstack check` instead of the per-server `<server> check` lines.

  Also bring the bundled `logs-server`, `vitest-server`, and `playwright-server`
  skills in line with the canonical skills: drop the removed `logs-server query`
  verbs (trace/run/errors/filter, gone since logs-server 2.1.0) in favour of
  reading the store directly with sqlite3 against `.davstack/logs/<db>`; remove
  the `serve &` / per-server `check` recipes; and add the shared lifecycle rule
  (ask the user to run `davstack start` in a separate terminal; never run
  `serve` yourself). The playwright skill also drops the obsolete "only the first
  top-level `test()`" limitation.

## 1.2.4

### Patch Changes

- 7150d1a: Remove the `project: 'storybook'` default from the scaffolded
  `vitest-server.config.ts` template and the canonical docs example. It
  silently broke unit-test projects that didn't have a `storybook` vitest
  project configured. `project` is now documented as an optional filter
  (set only when you have multiple vitest projects and want one kept
  warm).

  Also: vitest-server docs (setup.md, usage.md) aligned to the
  scaffolder-first doctrine — `pnpx @davstack/init` is the recommended
  install path, `davstack start` is the recommended boot path, with
  `pnpm exec vitest-server serve` retained as the standalone alternative.

## 1.2.3

### Patch Changes

- Update `diagnose` skill: add no-echo rule (don't restate log card details
  in chat — one-line gist is fine), terseness directive (fragments over
  prose, sacrifice grammar), and explicit "goal is the fix, not the
  document" framing. Targets a failure mode where the orchestrator wrote a
  card to the log then re-explained it in chat, doubling tokens and slowing
  the loop. Also syncs the daemon-prereq paragraph that the bundled copy
  was missing.

## 1.2.2

### Patch Changes

- Install `@davstack/open-agents` globally instead of as a dev dep. The
  `explore` / `fast-edit` bins are now on PATH from any repo, so the skill
  bodies can drop the `npx` prefix — which was unreliable in fresh repos
  because `npx explore` fell back to an unrelated public `explore` package
  on the npm registry. Logs / vitest / playwright daemons stay
  project-local; only open-agents goes global (it has no per-repo state,
  just optional `.davstack/config/open-agents.config.ts` overrides which
  are still read from cwd).

## 1.2.1

### Patch Changes

- Add `--all-skills` flag. Installs every bundled SKILL.md regardless of
  selected tools. Useful when you have skills installed from a previous
  init run and want to refresh them all without re-selecting all tools.

## 1.2.0

### Minor Changes

- Install Claude Code skills as part of init. Bundles all 6 SKILL.md files
  (diagnose, explore, fast-edit, logs-server, vitest-server,
  playwright-server) and copies the ones relevant to the selected tools
  into `~/.claude/skills/<name>/SKILL.md`:

  - `diagnose` always installs (orchestrates the others).
  - `logs-server` / `vitest-server` / `playwright-server` install when
    their daemon is selected.
  - `explore` + `fast-edit` install when `open-agents` is selected.

  Skills always overwrite, so re-running `davstack-init` bumps the user to
  the latest skill content shipped with the installed init version.

## 1.1.1

### Patch Changes

- Fix tsx launcher path: resolve `tsx/cli` (its exported subpath) instead of
  the unexported `tsx/dist/cli.mjs`, which Node refused with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.

## 1.1.0

### Minor Changes

- - Default bin launchers to `tsx` runtime. tsx loads TS from `node_modules`
    (which Node 24's `--experimental-transform-types` rejects) and avoids the
    bun-vs-vitest incompatibility that crashed vitest-server mid-run.
    Opt into bun with `<NAME>_RUNTIME=bun` or plain Node with `=node`.
  - Add `exports` map with `./config` subpath to each daemon package, so
    consumer `.davstack/config/<name>-server.config.ts` files can do:

    ```ts
    import type { ServerConfig } from "@davstack/logs-server/config";
    ```

    instead of brittle deep-imports into `/src/`.

  - Split `ServerConfig` into two: a user-facing all-optional shape (what you
    `satisfies`) and an internal `ResolvedConfig` (post-merge with defaults).
    `port` and `host` are now first-class fields on `ServerConfig`, so the
    scaffolded config files type-check cleanly with no intersections.
  - Update init's templates to use the new clean imports.
  - playwright-server: move `ServerConfig` + `loadConfig` from `auth.ts` to a
    new `config.ts` so the `exports` subpath points at a single-purpose file.
    `auth.ts` re-exports for back-compat.

## 1.0.1

### Patch Changes

- Default bin launcher to bun runtime so TS source loads under node_modules.
  Node 24's `--experimental-transform-types` rejects TS files under node_modules;
  falling back to bun (with `*_RUNTIME=node` opt-out) matches the sibling
  `logs-server` / `open-agents` pattern.

## 1.0.0

### Major Changes

- Initial 1.0.0 release.
