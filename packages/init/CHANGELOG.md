# @davstack/init

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
