# Composer-2.5 in Claude Code — Investigation & Findings

> Status: **parked** (June 2026). A working prototype exists but the dream UX (Composer as a
> tool-using model driving Claude Code's loop with native step-by-step visibility) is **blocked
> by upstream constraints**, not by our implementation. This doc captures the full journey so we
> don't re-litigate it and can pick it back up if Cursor ships the missing surface.

---

## TL;DR

- **Goal:** use Cursor's **Composer 2.5** inside **Claude Code** (CC) — ideally to power CC subagents
  (Explore / fast-edit) so they run on Cursor credits, not Anthropic, while staying inspectable.
- **The wall:** Cursor exposes Composer **only as an autonomous agent** (`@cursor/sdk` / `cursor-agent`)
  that **self-executes its own tools**. There is **no raw-inference API** that emits `tool_use` blocks
  for a client to execute. CC's model contract is the opposite: a **stateless, step-wise model that
  emits `tool_use`, which CC executes**. These two architectures are fundamentally incompatible.
- **What we proved works:** a proxy where **Composer self-executes in the real repo and returns its
  answer as text**, with main-loop requests passed through to real Claude. This *functions* — Composer
  does real work on the real repo and answers correctly — but it turns CC into a thin frontend and CC
  **cannot render native tool-cards** for it (no `tool_use` = no cards), so the "see it working" UX is
  limited to a text activity-log + a server-side terminal trace.
- **Verdict:** Composer-as-a-tool-calling-model-in-CC is **infeasible today** (4 independent
  confirmations). Composer-as-a-self-executing-text-agent-behind-a-proxy is **feasible but degraded**.
  The cleanest "Composer in CC" that actually works in the wild is **sub-agent delegation** (CC shells
  out to `cursor-agent`), which davstack already has via `packages/open-agents`.

---

## 1. The goal & what inspired it

The trigger: seeing claims online (and Artificial Analysis benchmarks) of "Composer 2.5 in Claude Code."
The hope was an integrated setup where CC could spawn Composer-backed subagents — explore/fast-edit on a
"haiku" slot — that (a) cost Cursor credits not Anthropic, and (b) were inspectable/monitorable inside
CC's native agent UI, switchable like first-party agents.

**Premise correction (from web research):** Artificial Analysis benchmarks **"Composer 2 in *Cursor
CLI*"** — Composer in *its own* harness. Their "*X* in Claude Code" rows are **other** models (DeepSeek
V4 Pro, Kimi K2.6, GLM-5.1) routed in via standard OpenAI-compatible endpoints. There is **no AA row
"Composer in Claude Code."** Composer is the one model they *couldn't* run that way, precisely because it
has no raw tool-calling endpoint. The "people using Composer in Claude Code" are doing **sub-agent
delegation** (CC invokes `cursor-agent` as a tool), not Composer driving CC's loop.

---

## 2. The core architectural conflict

| | Claude Code expects (the "model" contract) | Cursor Composer provides (`@cursor/sdk`) |
|---|---|---|
| Role | Stateless **inference** endpoint | Stateful **autonomous agent** |
| Tools | Model **emits `tool_use`**; **CC executes** them in the repo and returns `tool_result` | Agent **runs its own tools** (read/grep/edit/shell) |
| Turn shape | One step per turn; CC drives the loop | Completes the whole task itself, returns final answer |
| History | Full transcript replayed each request | Held internally; not injectable as input |

Everything below is a consequence of this mismatch.

---

## 3. Access surfaces investigated (and why each fails)

1. **`@cursor/sdk` (the Agent SDK)** — `Agent.create()/send()`, streams `tool_call` events but the agent
   **self-executes**. Only public hooks are informational. **This is the only programmatic surface.**
2. **`cursor-agent` CLI** — same agent runtime; `ask` mode is read-only-but-still-self-executes,
   `agent`/`plan` modes edit. Already wrapped in davstack `open-agents` (one-way `-p`).
3. **`standardagents/composer-api`** — OpenAI-compatible wrapper over `@cursor/sdk@1.0.13`;
   **explicitly rejects tool calls** ("Cursor does not expose equivalent controls").
4. **`anyrobert/cursor-api-proxy`** — speaks Anthropic `/v1/messages` (CC-native) but its own source
   comments: *"we can't return tool_call deltas natively"* — it **fakes** tools by stringifying schemas
   into the system prompt and only ever emits `type:"text"` blocks. Never `tool_use`.
5. **No raw Cursor inference API** — confirmed by Cursor docs, DataCamp, and **open/unshipped Cursor
   forum feature requests** ("Expose Cursor API for Composer or Chat", unfulfilled as of June 2026).

**Four independent confirmations** that native `tool_use` from Composer is impossible: our own spikes,
the SDK type analysis, web research, and competitors' source code.

---

## 4. The experiments (what we actually ran)

All spikes live in `packages/composer-proxy/spike/`. Captured real CC traffic in `.captures/`
(gitignored — contains real prompts/code).

### 4a. Capture tap (`src/capture.ts`)
A transparent recording reverse-proxy. Pointed CC's `ANTHROPIC_BASE_URL` at it; recorded 22 real
`/v1/messages` requests + responses (redacting secrets, stripping gzip). This gave ground-truth
fixtures: real Anthropic SSE event sequences, real tool-use payloads, and the haiku-vs-main split.

**Key data learned from the capture:**
- Main loop = `claude-opus-4-8`, `tools=52`, `thinking:{type:"adaptive"}`.
- Background tasks (title-gen, summaries) = **`tools=0`**, tiny `max_tokens` (1–64). These are the
  genuine "haiku background" calls and are **pure text** (no tools).
- A `tools=0` title-gen request literally contained the user's prompt text "can u use grep?" — which is
  why "tools=0 but it used grep" looked contradictory (it was titling a conversation *about* grep).
- Haiku subagents = `claude-haiku-4-5`, `tools=42`, **`thinking:{type:"disabled"}`**, and they DO emit
  `tool_use`. So the haiku slot is not purely text.
- Real Anthropic streams include a `ping` event (which claude-code-router omits — we replicate it).

### 4b. Tool-semantics spike (`spike/tool-semantics-spike.mjs`) — 5 live experiments
- **E1** customTool `execute` IS invoked and **CAN block** on async work. ✅
- **E2** (toy) Composer used our **custom tool** over its built-in for a file read. ✅ (misleading — see 4c)
- **E3** `mode:"plan"` does **NOT** suppress built-ins (it used read/glob/shell/grep). ❌
- **E4** (toy) Composer **emitted** a `TOOL_CALL {...}` text directive without self-executing. ✅ (misleading)
- **E5** Composer correctly **continued from a flattened transcript** containing a prior tool result. ✅

### 4c. Real-fixture replay (`spike/fixture-replay-spike.mjs`) — the reality check
Fed a **real** captured 70K-char CC request (52 tools) through "Approach B" (prompted tool-use).
**Composer ignored the directive instructions and self-executed its own tools on the REAL repo** (grep/
glob/shell ×9+), roaming outside the cwd, returning a finished answer. Even with **CC's system prompt
removed** and a maximally forceful "you have NO filesystem access" frame, it **still self-executed**
(×28 tool calls) and emitted malformed directive JSON. → **Prompted tool-use does not hold at real scale.**

### 4d. Sandbox spike (`spike/sandbox-spike.mjs`) — the one lever that could force delegation
`LocalAgentOptions.sandboxOptions.enabled` could, in theory, confine built-ins so Composer is *forced*
to delegate. Results:
- **Windows:** crashes — `sandboxing is not supported in this environment`.
- **Linux (Docker):** **also** crashes with the same error — but it's an **SDK bug** (`@cursor/sdk@1.0.19`):
  the bundled `cursorsandbox` helper's own preflight **succeeds** under `--cap-add=SYS_ADMIN`, yet the
  SDK's gate reads an unset binary path (`V()` returns false) and bails before trying. **Not a kernel
  limit — an upstream JS bug.** `1.0.19` is the **latest** published version (no fix available).
- Without sandbox, the custom-tool route is **non-deterministic** (sometimes delegates, sometimes roams).

### 4e. SDK `dist` interception probe
Read the SDK's minified `dist` directly. `customTools.execute` is **invoke-and-await-inline** — **no
`AbortSignal`, no suspend/surface hook**; a thrown error becomes an in-band tool error, not an abort.
`tool_call` stream events are **notifications around** execution the agent already does. `run.cancel()`
on first event is racy and the tool (a read) has already hit disk. **No interception hook exists.**

### 4f. History injection
`send()` accepts only `string | {text, images?}`. `Agent.resume` replays the SDK's **own opaque
checkpoint by `agentId`**, not a caller-supplied transcript. So you cannot natively inject a
`tool_use`+`tool_result` history — only **flatten it to text** (which works; see E5).

---

## 5. The reframe that produced a working prototype

Key insight (credit: the user): **self-execution is only a "problem" if Composer must drive CC's loop.
For a sub-agent, running its own tools and reporting back is exactly correct.** So instead of fighting
it, *let Composer do the work and return text*; CC thinks it got a normal (haiku) answer.

**Proof:** the fixture-011 replay we'd called a "failure" was actually a **success** under this framing —
Composer self-executed on the real `titanium` repo and returned a correct file inventory.

This became **`composer-cc`** (`src/cc-proxy.ts`, `src/cc-index.ts`, bin `composer-cc`):

- CC points `ANTHROPIC_BASE_URL` at the proxy; sets `ANTHROPIC_DEFAULT_HAIKU_MODEL=composer-2.5`.
- `POST /v1/messages`:
  - `model === composer-2.5` → run Composer as an agent **in the real repo** (cwd extracted from the
    request's `working directory:` line, or `COMPOSER_CWD` override), stream its answer back as Anthropic
    **text** SSE. Composer's own `tool_call` events are surfaced as **markdown narration** (blockquotes
    with per-tool icons) so the work stays visible.
  - `model === claude-*` → **transparent passthrough** to real Anthropic (main loop untouched, normal
    credits). Reuses the capture-tap forwarding.
  - tiny `max_tokens ≤ 4` (probe) → short-circuit "ok" without spinning up Composer.
- `POST /v1/messages/count_tokens` → estimate (composer) or passthrough (claude).
- **Per-request trace logging** to the proxy terminal: branch (`COMPOSER 🟢` vs passthrough), cwd,
  every `› tool` call, and a done line. This is the definitive "did it run Composer" check.

**It works end-to-end:** verified live — valid Anthropic SSE (`message_start → content_block_start →
ping → content_block_delta → content_block_stop → message_delta → message_stop`), Composer executing
real tools on the real repo, correct answers, zero Anthropic credits.

---

## 6. Why it's still "ok but not great" — the ceiling

1. **No native tool-cards.** CC renders the nice step-by-step tool UI only for models that **emit
   `tool_use`** (CC executes → CC renders). Composer emits none, so the best we get is **text** (an
   activity-log of blockquotes). Structural — unfixable from our side.
2. **Subagent output may be condensed.** CC appears to summarize/condense subagent results rather than
   show full streamed text, so even the text activity-log can get buried. (Unconfirmed exact behavior;
   it's CC-internal.)
3. **`thinking` blocks unavailable for the target slot.** They'd give native collapsible "process" UI,
   but haiku-subagent requests set `thinking:{type:"disabled"}`, so emitting thinking blocks would be
   invalid there. (They *are* enabled — `adaptive` — on the main/opus loop, so a thinking-enabled slot
   could use them, but that's not the haiku-subagent use case.)
4. **CC becomes a thin frontend.** You lose CC's tool execution, permission prompts, diff review, hooks,
   todo tracking. Composer edits the repo **ungated**.
5. **Lossy multi-turn.** Each turn spins a fresh Composer agent fed the flattened text transcript
   (Composer re-reads the real files, so it self-corrects, but CC's history isn't a faithful tool log).
6. **Cost/latency of aux calls.** Any non-probe haiku call routes to a full Composer agent run; only the
   `max_tokens ≤ 4` probe is short-circuited. Title-gen etc. would be slow/wasteful through Composer.

---

## 7. Final verdict

| Goal | Feasible? | Notes |
|---|---|---|
| Composer **drives** CC's loop, emitting `tool_use` | ❌ **No** | No raw-inference surface exists; unshipped Cursor feature |
| Composer **self-executes** in real repo, returns text (proxy) | ✅ **Yes (degraded)** | The `composer-cc` prototype. Works; CC = frontend; text-only visibility |
| Composer for **tool-less background** (titles/summaries) | ✅ **Yes** | Pure text; safe; the genuine haiku-background slice |
| Native CC tool-card UI for Composer | ❌ **No** | Requires `tool_use` emission (structural) |
| Composer as a **delegated sub-agent** (CC → `cursor-agent`) | ✅ **Yes (works today)** | This is what people actually do; davstack `open-agents` already does it |

---

## 8. Conditions to revisit

Pick this back up if **any** of these change:
1. **Cursor ships a raw Composer inference API** (OpenAI/Anthropic-compatible chat completions with
   native function calling that returns `tool_use`/`tool_calls` for the client to execute). Watch the
   Cursor forum feature requests ("Expose Cursor API for Composer/Chat").
2. **Cursor fixes the `@cursor/sdk` sandbox gate bug** (so `sandboxOptions.enabled` initializes). That
   would let us confine built-ins and *force* delegation, reopening the customTools-bridge path — though
   it would still need a privileged Linux/WSL runtime + a stateful session bridge + reliability work.
3. **Claude Code adds a way to register an external process as a first-class managed/streaming agent**
   (it does not today — Agent View rows and subagents are first-party model-driven sessions only).

---

## 9. What was built (artifacts on branch `composer-proxy`)

All under `packages/composer-proxy/`:

| Artifact | Files | Status |
|---|---|---|
| **OpenAI-compatible Composer proxy** | `src/{server,cursor,openai,index}.ts`, bin `composer-proxy` | ✅ works (text-only OpenAI clients / claude-code-router) |
| **Capture tap** | `src/capture.ts`, bin `composer-capture` | ✅ works (records CC↔Anthropic traffic to `.captures/`) |
| **composer-cc proxy** | `src/{cc-proxy,cc-index,anthropic-sse,anthropic-request}.ts`, `runComposerAgent` in `cursor.ts`, bin `composer-cc` | ✅ works (the prototype; degraded UX per §6) |
| **Spikes** | `spike/{tool-semantics,fixture-replay,sandbox}-spike.mjs` | reproducible evidence |
| **Fixtures** | `.captures/` (gitignored) | 22 real CC requests/responses |

**Dependency note:** `@cursor/sdk` has an **undeclared** dependency on `@connectrpc/connect-node`,
patched via `pnpm.packageExtensions` in the **root** `package.json`. Also emits a harmless
`Ripgrep path not configured` warning on Windows (falls back to shell; no public API to set it).

### Run the prototype
```bash
# Terminal 1 — the proxy (points Composer at your real repo)
cd packages/composer-proxy
CURSOR_API_KEY="<cursor-dashboard-key>" COMPOSER_CWD="<repo path>" node dist/cc-index.js

# Terminal 2 — a throwaway Claude Code routed through it
export ANTHROPIC_BASE_URL="http://127.0.0.1:8790"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="composer-2.5"
claude
# then spawn a haiku-tier subagent (Explore / fast-edit) and watch the proxy terminal trace
```

---

## 10. Operational notes / loose ends

- **Branch:** `composer-proxy` (davstack). Commits: OpenAI proxy → capture tap → composer-cc →
  trace logging → narration polish.
- **`.captures/` is gitignored** — it contains real prompts/source; do not commit or push.
- **The Cursor API key was pasted into a chat transcript during this work — ROTATE IT.**
- The `@cursor/sdk` is `win32-x64` 1.0.19; uses node's experimental `node:sqlite` (the SQLite warning is benign).
- The cleanest *working* "Composer in CC" remains **sub-agent delegation** via davstack `packages/open-agents`
  (`cursor-agent -p`, one-way). Upgrading it to streaming (`--output-format stream-json`) + resume
  (`--resume <chatId>`) would close most of the UX gap without the proxy's downsides — a separate,
  more promising track if the integrated-agent experience is the real want.
```
