---
'@davstack/logs-server': minor
---

Add CORS support for browser-origin envelope POSTs. The sink now responds to
`OPTIONS` preflights and attaches `Access-Control-Allow-*` headers to ingest
responses, so browser SDKs can post directly to `http://public@127.0.0.1:5181/1`
without a same-origin proxy (Vite, webpack-dev-server, etc).

New `cors` config field:

- `"*"` (default) — echo `Access-Control-Allow-Origin: *` (no credentials).
- `string[]` — allowlist; matching `Origin` is echoed back with `Vary: Origin`,
  non-matching origins get no CORS headers.
- `false` — emit no CORS headers (legacy behaviour).

Default-permissive is safe: the sink binds `127.0.0.1` only, the response is
empty (POST) or a fixed `"diag sink ok"` literal (non-POST), and
`Access-Control-Allow-Credentials` is never set.
