# Davstack Peek Initial Concept

Idea: add a small package/CLI, `@davstack/peek`, that prints concise
folder-level peek files for agents.

## Motivation

Agents often need a quick map of a folder before deciding what to read. Full
recursive exploration can burn tokens and time. A generated metadata file could
act like a compact table of contents for source and docs.

## Possible CLI

```text
npx @davstack/peek ./path-to-folder
npx @davstack/peek ./path-to-folder --agent
npx @davstack/peek ./path-to-folder --human
```

## `gen`

`gen` scans a folder and writes a concise generated markdown file in that
folder, likely something like `.folder-peek.generated.md`.

Initial scope:

- Include markdown, TypeScript, and Python files.
- Skip files ignored by git.
- Skip generated peek files themselves.
- Prefer concise structural summaries over content summaries.

For markdown:

- Include file path.
- Include headings.

For TypeScript:

- Include exported functions, classes, types, interfaces, consts, and important
  non-exported top-level symbols.
- Possibly include JSDoc in a longer mode.

For Python:

- Include functions, classes, constants, and module docstring where useful.

## Peek

The CLI prints existing peek output for a folder. If the peek file does not
exist, it can generate it on the spot.

`--deep` could recursively include child folder output, either by generating
missing child files or by doing a direct recursive scan.

## Output Shape

Experiment with XML-ish blocks because agents parse them well:

```xml
<folder path="packages/open-agents/src">
  <file path="cli.ts">
    <exports>
      <function name="main" />
      <function name="parseFlags" />
    </exports>
  </file>
</folder>
```

There may be two useful output levels:

- Short: names and headings only.
- Long: names, signatures, JSDoc/docstrings, and maybe one-line comments.

## Git Hygiene

Generated peek files should probably be gitignored by default. The package
could also provide a recommended `.gitignore` entry.

## Agent Workflow

An agent can run:

```text
npx @davstack/peek packages/open-agents/src --deep
```

Then use the output as a cheap routing map before opening source files. This
could pair well with open-agent handoff testing because history/context pointers
are more useful when agents can cheaply inspect repo structure too.
