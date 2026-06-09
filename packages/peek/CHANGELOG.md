# @davstack/peek

## 0.1.0

### Minor Changes

- Rename the package from `@davstack/meta` to `@davstack/peek` and make the CLI print a folder peek with `peek <path>` instead of requiring the `view` subcommand.

## 0.1.6

### Patch Changes

- Summarize test and describe calls in TypeScript-like files using their literal source titles.

## 0.1.5

### Patch Changes

- Add configurable output presets for human-readable and token-optimized folder metadata.
- Make metadata presets scan deeply by default and remove the generated Markdown title.

## 0.1.4

### Patch Changes

- Refine folder metadata indentation and render code symbol line references without list prefixes.

## 0.1.3

### Patch Changes

- Format code symbol references with repo-relative file paths and `[ln start-end]` line ranges.

## 0.1.2

### Patch Changes

- Add line numbers to code symbol references and render omitted files at the bottom of each folder block.

## 0.1.1

### Patch Changes

- Update folder metadata XML output to omit file kinds, nest deep folder tags with root-relative paths, report unsupported files per folder, and summarize JS/MJS files like TypeScript.
