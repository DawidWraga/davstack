# @davstack/open-agents

A thin self-waiting job primitive over a configured agent CLI (default
`cursor-agent -p`; pluggable adapters for `gemini-cli` and `agy`). Delegate
scoped explore (read-only) and fast-edit (mechanical) work to a fast/cheap
model (`composer-2.5` by default), one or many in parallel, with each result
persisted and re-printable.

Not an orchestrator — the design goal is to **make a Cursor job a
self-waiting, harness-trackable command** so the harness's own
background-completion notification *is* the orchestration: no polling, no
status truncation, no near-miss re-send.

## Install

```bash
pnpm add -g @davstack/open-agents      # global so `explore`/`fast-edit` are on PATH everywhere
explore   check                        # validate cursor-agent install
explore   submit --file <spec>.md
fast-edit submit --file <spec>.md
```

Bins are global because they have no per-repo state — per-repo config is
still read from `.davstack/config/open-agents.config.ts` in your cwd.
`@davstack/init` installs open-agents globally by default for the same
reason; the other daemons (logs/vitest) stay project-local.

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
        --compact-mode: treat the inline input as a very short task title
          (roughly 5-10 words) and let a Cursor composer-2.5 spec-writer distill
          recent conversation history into the executor spec. Do not paste
          details, quotes, or file lists into the inline prompt when the current
          conversation already has that context.
          History resolves from --history-file <path>, OPEN_AGENTS_HISTORY_FILE,
          CLAUDE_CODE_TRANSCRIPT_PATH, or the current Claude Code transcript
          when CLAUDE_CODE_SESSION_ID is set. It also detects Codex sessions
          from CODEX_THREAD_ID / ~/.codex/sessions and falls back to
          ~/.codex/history.jsonl when no richer transcript is available.
          Compact mode gives the spec-writer the last 50000 token-like history
          units plus a pointer to the full history file, or 100000 when a local
          Headroom proxy is healthy. The generated spec is kept concise and points
          back to the history file for uncertain detail instead of copying the
          transcript. Progress output includes the spec generation duration and
          a ~/... path to the generated spec artifact.
        --headroom auto|off|require (default auto): probe the local Headroom
          proxy and, when healthy, run the Cursor adapter with
          OPENAI_BASE_URL=http://127.0.0.1:8787/v1. If the proxy is absent,
          jobs continue normally with a concise stderr notice. Use
          --headroom-url <url>, OPEN_AGENTS_HEADROOM_URL, or config
          headroom.url for a non-default proxy.
wait                        wait for ALL running jobs (this repo)
wait   "<id…>" | <id…>      wait for ALL of these
wait   --any <id…>          return when ≥1 done; prints which (loop = popcorn)
result [id]                 print a job's clean deliverable (its result file)
ls                          recent jobs (this repo)
tail   <id>                 follow a running job
check        [--json]       validate node version, cursor-agent install, config,
                            jobs dir. --json for machine-readable output.
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

## Optional Headroom proxy

Headroom is optional. By default, `open-agents` briefly probes
`http://127.0.0.1:8787/health`. If the proxy is healthy and the selected adapter
is `cursor`, the spawned Cursor Agent process receives
`OPENAI_BASE_URL=http://127.0.0.1:8787/v1`. If the proxy is not installed or not
running, the job still runs directly.

Controls:

```bash
OPEN_AGENTS_HEADROOM=off explore submit "short task"
OPEN_AGENTS_HEADROOM=require fast-edit submit --compact-mode "fix parser"
OPEN_AGENTS_HEADROOM_URL=http://127.0.0.1:8788 explore submit "inspect auth"
```

In compact mode, a healthy Headroom proxy raises the history tail budget from
50000 to 100000 token-like units and prints a `/stats` delta from
`requests.total` and `tokens.saved`.

## Job state

Lives under `~/.davstack/jobs/<repo-hash>/` (override `OPEN_AGENTS_HOME`).
`CURSOR_JOBS_HOME` is honoured as a deprecated one-release fallback, and the
old `~/.cursor-jobs` state is read if present. User-global (not per-repo) so
jobs survive `git clean` and stay visible across worktrees.

Operational guidance (when/how the orchestrator should use this) lives in
the `explore` and `fast-edit` skills (`davstack/skills/*/SKILL.md`).
