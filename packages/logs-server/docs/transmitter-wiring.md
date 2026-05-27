# Routing logs to a per-session DB

By default everything lands in `.davstack/logs/default.db`. If you want a session's logs to land in its own file (`reorder-bug.db`, `hotfix-7c.db`, etc.) — for cross-session isolation, per-session SQL views (see [session-views.md](./session-views.md)), or eval co-location — the transmitter stamps one extra attribute on each log envelope. The daemon dispatches.

## Wire shape

The Sentry log envelope already carries a key-value `attributes` map. The daemon reads attribute `davstack-logs.db`:

- present → resolve + route to `.davstack/logs/<value>.db`
- absent → route to `.davstack/logs/default.db`

The daemon strips the attribute before persisting the row, so the file IS the session indicator and nothing inside the row records which bucket it landed in.

## Consumer side: 3 lines in `sentry.ts`

Where you already stamp `diag.run_id` and friends in `beforeSendLog`, add the routing key:

```ts
// near the top, after diagRunId is captured
const davstackDb = (window as Window & { __davstack_db?: string }).__davstack_db ?? null

Sentry.init({
  // … your existing init …
  beforeSendLog(log) {
    return {
      ...log,
      attributes: {
        ...log.attributes,
        "diag.project": DIAG_PROJECT,
        "diag.run_id": diagRunId,
        ...(davstackDb && { "davstack-logs.db": davstackDb }),
      },
    }
  },
})
```

No transport rewrite, no DSN change, no integration package. Existing CORS / proxy / Sentry SDK behaviour is unchanged — the wire shape is the same envelope you already POST.

## Runner side (browser)

`window.__davstack_db` is the boot-time global. Whoever launches the page sets it before the app's bundle runs.

### Playwright

`playwright-server --db=<value>` seeds the global via `page.addInitScript` before navigation. Nothing else to do — the spec just runs and its logs land in `.davstack/logs/<value>.db`.

```bash
playwright-server --db=reorder-bug e2e/reorder-flow.spec.ts
```

### Dev server / manual reproduction

In the browser devtools console, before reloading the page:

```js
window.__davstack_db = "reorder-bug"
```

Then reload. Logs from this tab will route to `reorder-bug.db` until you clear the value or close the tab.

## Naming rules

- Lowercase alnum + `-` / `_`, no spaces (`reorder-bug`, `feat_x`, `hotfix-7c`).
- Slashes create subdirectories (`feat/reorder` → `.davstack/logs/feat/reorder.db`).
- `..` traversal is allowed but the resolved path must stay inside the repo root (used by eval runners to co-locate logs with test artifacts).
- Invalid values do not fail — the daemon prints one stderr warning per unique bad value and routes the rows to `default.db` so emissions are never lost.

## Backend (Node) is deferred

This wire is browser-only today. Backend processes continue to route to `default.db` regardless of attribute (their logs cross the daemon via separate transmitters). When backend-side routing lands, the same attribute will work — no daemon change needed.
