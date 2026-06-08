# External Fixture Strategy

## Direction We Agree On

Use a pinned third-party mid-size repository as the first realistic eval target,
instead of testing only against `davstack` itself.

Agreed principles:

- Do not vendor a large third-party repo into normal git history.
- Keep only a small fixture manifest in this repo.
- Clone the target repo at a pinned commit during a prepare step.
- Put cloned/prepared repo copies in a gitignored eval workspace.
- Run variants in isolated checkouts so edits, generated files, and dependency
  artifacts cannot contaminate other runs.
- Reset to the pinned base between runs.

## Candidate Fixture Shape

Preferred first fixture:

- Next.js app.
- Supabase-backed or Supabase-like CRUD flow.
- Todo or simple CRUD domain.
- Medium sized: enough routing/components/server logic to make `explore` useful,
  but not so large that setup and grading become the project.
- Has predictable local install/build/typecheck/test behavior.
- Licensed in a way that is comfortable for local eval use.

The fixture does not need to be perfect. It needs to be stable, understandable,
and realistic enough to exercise the handoff strategies.

## Manifest-First Model

Store a small manifest in git, not the cloned repo.

Example shape:

```yaml
id: nextjs-supabase-todos
repo: https://github.com/example/nextjs-supabase-todos.git
commit: abc123
sparse:
  - app/**
  - components/**
  - lib/**
  - supabase/**
  - package.json
  - pnpm-lock.yaml
setup:
  - pnpm install --frozen-lockfile
verify:
  - pnpm typecheck
  - pnpm test
```

Sparse checkout is optional. It is useful only if the chosen repo has docs,
assets, generated files, or unrelated examples that would distract agents.

## Isolation Model

For edit-capable scenarios, each `{scenario, variant, repeat}` should get its
own checkout/worktree/copy.

Why:

- Variant A must not see files changed by variant B.
- Failed runs should be inspectable without blocking later runs.
- Parallel runs become much easier to reason about.

For read-only scenarios, shared checkout is possible, but the first harness
should probably use the same isolation model for every scenario. Uniformity is
worth a little disk/time overhead while the eval is young.

## Reset Behavior

Every run starts from the same pinned commit plus the same setup result.

Possible implementation:

1. Maintain a local bare/mirror cache of the fixture repo.
2. Create a fresh worktree or clone for each run from the pinned commit.
3. Apply any scenario-specific seed patch or setup script.
4. Run the handoff variant.
5. Collect result, diff, verification output, and metadata.
6. Delete successful run dirs or keep only compressed artifacts.
7. Keep failed run dirs until inspected, or save their diff before cleanup.

## Artifact Layout Is Still Provisional

The earlier `.davstack/evals` sketch is a plausible starting point, not a
decision. Promptfoo may emit its own logs/results in a way that changes the best
layout.

Open question:

- Should Promptfoo own the run directory?
- Should open-agents own `.davstack/evals/runs/*` and Promptfoo only link to it?
- Should fixture clones live under `.davstack/evals`, `packages/open-agents/evals/.work`,
  or a configurable temp path?

Lean starting point:

- Keep manifests and prompt templates in git.
- Keep cloned repos and run artifacts out of git.
- Let the first Promptfoo spike tell us whether `.davstack/evals` is the right
  home or just a useful placeholder.

## Macro Plan

1. Pick one candidate CRUD fixture repo.
2. Record repo URL, commit SHA, install command, verify command, and any setup
   quirks in a manifest.
3. Build a tiny prepare script that clones/resets one isolated checkout.
4. Run one read-only `explore` scenario manually against that checkout.
5. Run one edit scenario manually in three isolated checkouts for variants A/B/C.
6. Capture artifacts and review whether the layout is annoying.
7. Wrap the same provider/prepare flow with Promptfoo only after the manual
   path is understandable.

## Future Extension

Once the basic three-way handoff comparison works, test the middleman as a
fan-out planner:

- It reads the task and fixture context.
- It writes one shared context artifact.
- It emits several parallel `explore` or `fast-edit` specs.
- The harness runs them independently and collects/composes results.

That is likely a high-leverage path, but it should not be mixed into the first
fixture-preparation spike.
