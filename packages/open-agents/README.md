# @davstack/open-agents

A thin self-waiting job primitive over `cursor-agent -p`. Delegate scoped
explore (read-only) and fast-edit (mechanical) work to a fast/cheap model
(`composer-2.5` by default), one or many in parallel, with each result
persisted and re-printable.

Not an orchestrator — the design goal is to **make a Cursor job a
self-waiting, harness-trackable command** so the harness's own
background-completion notification *is* the orchestration: no polling, no
status truncation, no near-miss re-send.

## Install

```bash
pnpm add -wD @davstack/open-agents     # in your repo
npx explore   check                    # validate cursor-agent install
npx explore   submit --file <spec>.md
npx fast-edit submit --file <spec>.md
```

Two bins, one package — both bins resolve to the same engine with a
different profile bound (read-only vs `--force` edit).

## Verbs

```
submit --file a.md [--file b.md …] | "<inline>"  [--edit] [--model m] [--timeout s] [--cwd d]
        default: BLOCKS until all done, exits worst code. Each job's clean
          deliverable → its OWN <id>.result.md; stdout is just an index
          (`result → <path>`) — no input echo, jobs never mix. Read the file(s).
        many --file ⇒ run in parallel · --detach: print bare id(s), don't wait
        --parallel-mode asap|all-together (default asap): asap prints each
          index line as its job finishes; all-together waits, submission order
wait                        wait for ALL running jobs (this repo)
wait   "<id…>" | <id…>      wait for ALL of these
wait   --any <id…>          return when ≥1 done; prints which (loop = popcorn)
result [id]                 print a job's clean deliverable (its result file)
ls                          recent jobs (this repo)
tail   <id>                 follow a running job
```

Exit codes: `0` ok · `1` job failed · `2` bad id/spec · `3` wait timeout.
`wait` itself exits 0 even if a job failed (so `&& result` still runs).

## Structure — profiles × adapters

- `core/` — the run loop, deliverable contract, durable job state, output
  parsing, path resolution. `cli.ts` is the thin dispatcher.
- `profiles/` — binds an explore/edit prompt scaffold + mode (read-only vs edit).
- `adapters/` — executor-binary resolution and quirks. On Windows it spawns
  the **vendored `cursor-agent` node entrypoint directly** (`shell:false`,
  no shim binary): `CURSOR_AGENT_BIN` → vendored `node.exe`+`index.js` under
  `%LOCALAPPDATA%\cursor-agent` → bare `cursor-agent`.
- `entrypoints/` — `explore.ts` / `fast-edit.ts` each bind one profile; these
  are what the bins launch.

## How it works

- `submit` writes a job record per spec and runs them (parallel for many),
  blocking by default; on finish it writes each job's clean deliverable to its
  own `<id>.result.md` and prints only a compact index — so jobs never mix and
  no input/stderr leaks into the content. `--detach` spawns detached runners
  and prints the bare id(s).
- The runner streams `cursor-agent --output-format stream-json` to a per-job
  `.ndjson`, and on the `result` event arms a 5 s watchdog (cursor-agent
  sometimes emits its result then fails to self-exit) plus a hard timeout.
- On close it extracts the final message, `filesChanged` (write/edit tool
  calls only — not files merely read), and the Cursor `chat_id` (for
  `cursor-agent --resume=<id>` follow-ups) into the job JSON.
- The injected scaffold forces a whole-line `___FINAL_OUTPUT___` marker; only
  the text after that marker line becomes the deliverable — deterministic, not
  heuristic last-message hunting. The token is intentionally non-standard so
  quoted code/docs can't collide.
- A explore spec runs read-only (`--mode ask`); `--edit` adds `--force`.

## Runtime

The bin launcher prefers `bun` (matches sibling davstack packages); set
`OPEN_AGENTS_RUNTIME=node` to use `node --experimental-transform-types`
instead. The source is pure `node:*` — either runtime works.

## Job state

Lives under `~/.davstack/jobs/<repo-hash>/` (override `OPEN_AGENTS_HOME`).
`CURSOR_JOBS_HOME` is honoured as a deprecated one-release fallback, and the
old `~/.cursor-jobs` state is read if present. User-global (not per-repo) so
jobs survive `git clean` and stay visible across worktrees.

Operational guidance (when/how the orchestrator should use this) lives in
the `explore` and `fast-edit` skills (`davstack/skills/*/SKILL.md`).
