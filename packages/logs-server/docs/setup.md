# Setup

## 1. Config file

`<repo-root>/.davstack/config/logs-server.config.ts`:

```ts
export default {
  port: 5181,
  host: "127.0.0.1",
  // dbPath pins a SINGLE file (back-compat / external eval-runner co-location).
  // Omit for the default per-session layout under .davstack/logs/.
  // dbPath: ".davstack/logs/default.db",
  // cors: "*",                 // browser CORS policy (see §7); default permissive
}
```

Retention is file-based — each session writes its own `.davstack/logs/<name>.db`. When a session goes quiet, archive by moving the file (e.g. to `.davstack/logs/archive/`); past timelines stay queryable and often resurface when a regression reappears. See [reading-logs.md](./reading-logs.md#sessions).

The daemon walks up from cwd to find the repo root (git root → workspace marker → `package.json` with workspaces).

Per-key precedence: **CLI flag > env var (`DIAG_PORT` / `DIAG_DB` / `DIAG_HOST`) > config file > built-in default.**

Default DB layout: `<repo-root>/.davstack/logs/default.db`, with per-session sibling files (`reorder-bug.db`, `hotfix-7c.db`, …) created on demand when a transmitter sets the `davstack-logs.db` attribute. Setting `dbPath` (or `DIAG_DB`, or `--db <file>`) pins the daemon to a single file and disables the dispatch layer — useful for eval runs that want a co-located log file outside the repo's standard layout.

Skip the manual edit with `pnpm exec davstack-init --tools=logs-server` (scaffolds the config + appends `.davstack/*` / `!.davstack/config/` to `.gitignore`).

## 2. Point your transmitter at the daemon

### A. Already have Sentry set up

Requires `@sentry/*` **v9.0.0+** for top-level `enableLogs` / `beforeSendLog`. On v8, these still live under `_experiments` — upgrade rather than special-case.

Two changes to your existing `Sentry.init`:

1. **In dev, override the DSN** to `http://public@127.0.0.1:5181/1`. Prod keeps the real DSN.
2. **Turn on auto-instrumentation** so existing `console.*` / stdlib-logger calls become structured envelopes.

#### JS/TS

```ts
import * as Sentry from "@sentry/react" // or /browser, /node, /nextjs …

const IS_DEV = import.meta.env.DEV
const runId = crypto.randomUUID() // one per page-load / process

Sentry.init({
  dsn: IS_DEV
    ? "http://public@127.0.0.1:5181/1"  // local sink; auth ignored
    : import.meta.env.VITE_SENTRY_DSN,

  enableLogs: true,                     // top-level since v9

  integrations: IS_DEV
    ? [Sentry.consoleLoggingIntegration({
        levels: ["debug", "log", "info", "warn", "error"],
      })]
    : [],

  initialScope: { tags: { run_id: runId } },              // events
  beforeSendLog: (log) => ({                              // logs
    ...log,
    attributes: { ...log.attributes, run_id: runId },
  }),
})
```

#### Python

```python
import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration

sentry_sdk.init(
    dsn=("http://public@127.0.0.1:5181/1" if DEV else REAL_DSN),
    enable_logs=True,
    integrations=[LoggingIntegration()],
)
sentry_sdk.set_tag("run_id", run_id)
```

#### Raw HTTP

POST a newline-delimited Sentry envelope to **any path** (the daemon is path-liberal — real SDKs hit `/api/<project_id>/envelope/`, `curl` examples hit `/envelope/`; both work). See §6.

### B. No Sentry set up yet

Use the **Sentry-for-AI** plugin — bundles SDK-setup skills for Next.js, React, Node, Python, FastAPI, Django, Rails, Android, iOS, etc.

```
/install-plugin sentry        # Claude Code (restart after install)
```

Cursor users: search "Sentry" in **Settings → Plugins**.

Then ask your coding agent: *"set up Sentry for this project."* Once wired, return to path A for the dev override + auto-instrumentation.

Source + supported platforms: <https://github.com/getsentry/sentry-for-ai>

### C. Optional — cloud Sentry for prod triage

Local-only works with **zero cloud auth, zero payments**. With cloud added, the loop becomes: prod issue → cloud UI → grab `trace_id` → reproduce locally → `sqlite3 .davstack/logs/default.db "SELECT * FROM logs WHERE trace_id = '<id>' ORDER BY ts"` for the full debug-level timeline.

```bash
npm i -g @sentry/cli && sentry-cli login
```

Then create a project on sentry.io and set `VITE_SENTRY_DSN` / `SENTRY_DSN` in prod env. Free tier covers small teams. Skip if local-only is enough.

## 3. Auto-instrumentation — broadest coverage per line of init

Most of the value is the unmodified `console.*` / library calls you already wrote. Turn integrations on **before** hand-rolling `logger.debug` probes.

**General (enable everywhere):**

- **`consoleLoggingIntegration` / stdlib `LoggingIntegration`** — every existing `console.log` / `logger.info` becomes queryable. Zero rewrites.
- **`httpIntegration`** (Node/Python) / **`browserTracingIntegration`** (browser) — outbound HTTP gets a span + `trace_id`; backend reads Sentry's `sentry-trace` + `baggage` headers and logs under the same id, so `WHERE trace_id = '…'` assembles the hop chain. (W3C `traceparent` is bridged via OTel only.)
- **`replayIntegration`** (browser) — DOM replay on error envelopes. Cloud-side only.

**Stack-specific (enable what you use):**

- **AI SDK** — `vercelAIIntegration({ recordInputs: true, recordOutputs: true })`. Capture full prompts/completions in dev — agent debugging is impossible without the transcript. Default OFF in prod (cost + PII).
- **Prisma / Drizzle / Sequelize** — `prismaIntegration()` etc. Each query becomes a span; combined with `trace_id`, you see "frontend click → handler → 4 SQL queries" in one timeline.
- **Redis** — `redisIntegration()`. Auto-enabled in `@sentry/node`. (BullMQ is covered indirectly via the NestJS integration.)
- **Next.js / Express / FastAPI / Django** — attach route/method/status to every envelope automatically.

**Dev-vs-prod asymmetry:**

```ts
integrations: IS_DEV
  ? [
      Sentry.consoleLoggingIntegration({ levels: ["debug","log","info","warn","error"] }),
      Sentry.vercelAIIntegration({ recordInputs: true, recordOutputs: true }),
      Sentry.prismaIntegration(),
    ]
  : [
      Sentry.httpIntegration(),
      Sentry.prismaIntegration(),  // defaults to no params capture
    ]
```

**Rule of thumb:** in dev, capture inputs/outputs/params for everything. Storage is local and per-session; archive old DBs out of `.davstack/logs/` rather than discarding them.

## 4. Recommended attributes

| Attr | Purpose |
|------|---------|
| `service` | Which process emitted it: `"react"`, `"agent"`, `"node"`. |
| `run_id` | Per-invocation correlation. One page-load / CLI run / test / job = one `run_id`. |
| `trace_id` | Per-request correlation across services. Frontend mints it; backend reads from the incoming header. |

Working reference: `~/dev/traffease_man/react/src/config/sentry.ts`.

## 5. Runtime

The bin shim spawns **`bun`** by default (server uses `bun:sqlite` + `Bun.serve`). Force Node with `LOGS_SERVER_RUNTIME=node` — uses `--experimental-transform-types`, no build step.

## 6. CORS (browser DSN posts)

Browser SDKs that post envelopes directly to the sink (via `Sentry.init({ dsn: "http://public@127.0.0.1:5181/1" })`) trigger a CORS preflight — Sentry's `Content-Type: application/x-sentry-envelope` is non-simple. The sink ships with default-permissive CORS so this Just Works; no Vite/webpack proxy needed.

Three modes via the `cors` config field:

```ts
// .davstack/config/logs-server.config.ts
export default {
  cors: "*",                                 // default; echo Allow-Origin: * (no creds)
  // cors: ["http://localhost:3001"],        // allowlist; echo matching origin + Vary: Origin
  // cors: false,                            // emit no CORS headers (legacy behaviour)
}
```

Default-permissive is safe because:

1. The sink binds to `127.0.0.1` only — unreachable off-host.
2. The response body is empty on `POST` and a fixed `"diag sink ok"` on non-POST — nothing readable to leak cross-origin.
3. `Access-Control-Allow-Credentials` is never set, so cookies/auth are not in scope.

Lock down with an allowlist or `false` if you disagree.

## 7. Sanity check

```bash
logs-server doctor
```

Reports node version, resolved config path, resolved `dbPath` (with total + recent row counts), and daemon liveness against the configured `host:port`. Exit code is 0 unless the install itself is broken (e.g. node < 20) — a not-running daemon or zero recent rows are reported as info, not failure, so agents can disambiguate "broken install" from "needs `serve`". Add `--json` for agent-parseable output.

For an end-to-end ingest test:

```bash
curl -s -X POST http://127.0.0.1:5181/envelope/ \
  --data-binary @- <<'EOF'
{"sent_at":"2026-05-21T00:00:00Z"}
{"type":"log"}
{"items":[{"timestamp":"2026-05-21T00:00:00Z","level":"info","body":"ping"}]}
EOF

sqlite3 -header -column .davstack/logs/default.db "SELECT ts, level, msg FROM logs WHERE msg LIKE '%ping%' ORDER BY ts DESC LIMIT 5"
```

If the row comes back, you're wired up.
