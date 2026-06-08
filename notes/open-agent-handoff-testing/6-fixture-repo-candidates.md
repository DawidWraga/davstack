# Fixture Repo Candidates

## Current Recommendation

Start by trying `imbhargav5/nextbase-nextjs-supabase-starter` if the goal is a
realistic agent-eval fixture rather than the smallest possible todo app.

Why:

- It has real project structure: app code, database app, packages, docs, and
  migrations.
- It advertises Supabase, CRUD/private items, typecheck, lint, tests, e2e tests,
  and local Supabase lifecycle scripts.
- It is likely rich enough for both `explore` and `fast-edit` scenarios.

Tradeoff:

- It is more of a SaaS starter than a tiny todo app.
- It may be heavier to install and reset.
- It uses newer framework versions, so the commit and lockfile need to be pinned
  tightly.

Candidate:

- <https://github.com/imbhargav5/nextbase-nextjs-supabase-starter>

## Other Candidates

### Halo-Lab/next-supabase-todo

- URL: <https://github.com/Halo-Lab/next-supabase-todo>
- Shape: small Next.js + Supabase todo app.
- Pros: focused todo domain, MIT license noted in README, likely easy for agents
  to understand.
- Cons: very small; package scripts appear limited to dev/build/start; dependency
  versions may be less deterministic if using `latest`.

### Ali-Onar/nextjs-supabase-todo-app

- URL: <https://github.com/Ali-Onar/nextjs-supabase-todo-app>
- Shape: small-to-mid Next.js todo app with Supabase, Clerk, TypeScript, Material
  UI, and drag/drop.
- Pros: more UI/application structure than the smallest examples.
- Cons: Clerk plus Supabase setup may add auth/environment friction; tests were
  not obvious from a quick scan.

### keiloktql/supabase-todo-app

- URL: <https://github.com/keiloktql/supabase-todo-app>
- Shape: small Supabase todo app.
- Pros: MIT license visible, simple domain.
- Cons: likely too small for deeper eval tasks; setup details looked less
  reliable from a quick scan.

### clerk/clerk-supabase-nextjs

- URL: <https://github.com/clerk/clerk-supabase-nextjs>
- Shape: official-ish Clerk/Supabase/Next.js integration example.
- Pros: auth/RLS integration may be realistic.
- Cons: not clearly todo/CRUD-focused; likely depends on dashboard/env setup;
  less ideal for deterministic local evals.

## Selection Criteria

Before committing to a fixture, check:

- Can it install from the pinned lockfile?
- Can it typecheck/build without hosted secrets?
- Does it have local tests, or can we define a cheap verification command?
- Does it have enough code structure for meaningful `explore` tasks?
- Does it have a safe edit surface for `fast-edit` tasks?
- Can Supabase setup be skipped, mocked, or run locally without long setup?

## First Spike

Try the recommended starter first, but treat that as a spike rather than a final
choice:

1. Pin a commit.
2. Clone into a gitignored eval workspace.
3. Run install/typecheck/test commands once manually.
4. Record setup friction.
5. Decide whether to keep it or fall back to a smaller todo repo.
