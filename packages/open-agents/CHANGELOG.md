# @davstack/open-agents

## 1.2.0

### Minor Changes

- 06962d2: Expose `./core/{jobs,parse,paths,deliverable}` and `./adapters/{types,cursor,gemini}` subpath exports (with matching `.d.ts` from tsup) so the davstack TUI agent run viewer can import the existing parser, job-store, path, and adapter modules without duplicating logic. Additive `package.json` / build entries only — no runtime behavior changes.

## 1.1.2

### Patch Changes

- Updated dependencies [2c18da2]
  - @davstack/cli-utils@1.2.0

## 1.1.1

### Patch Changes

- Updated dependencies [ade2196]
  - @davstack/cli-utils@1.1.1

## 1.0.1

### Patch Changes

- Docs-only: README install snippet now shows `pnpm add -g` and bare
  `explore` / `fast-edit` invocations to match the global-install flow
  that `@davstack/init@1.2.2` now uses. No code changes.

## 1.0.0

### Major Changes

- Initial 1.0.0 release.

### Patch Changes

- Updated dependencies
  - @davstack/cli-utils@1.0.0
