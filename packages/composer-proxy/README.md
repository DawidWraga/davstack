# @davstack/composer-proxy

A local **OpenAI-compatible** HTTP proxy in front of Cursor's **Composer**
(`composer-2.5`) via [`@cursor/sdk`](https://cursor.com/docs/api/sdk/typescript).

Any OpenAI client can now send chat completions to Composer. The point-of-use
this was built for: **routing Claude Code's haiku/background slot through
Composer** via [claude-code-router](https://github.com/musistudio/claude-code-router),
while keeping your main model on real Claude.

```
Claude Code ──Anthropic──▶ claude-code-router ──OpenAI──▶ composer-proxy ──@cursor/sdk──▶ composer-2.5
   (main model → Anthropic;  background/haiku slot → Composer)
```

Unlike `standardagents/composer-api` (a macOS DMG + Cloudflare Worker), this is
a few-dozen-line node server — no Swift, no wrangler, no D1 — so it runs on
Windows under stock node.

## Requirements

- Node ≥ 20
- A **Cursor Dashboard API key** (Dashboard → Integrations / API) — this is the
  cloud `@cursor/sdk` key, *separate* from the `cursor-agent` CLI login.

## Run

```bash
pnpm --filter @davstack/composer-proxy build
CURSOR_API_KEY=sk-... composer-proxy            # → http://127.0.0.1:8787/v1
```

Flags / env:

| flag | env | default |
|------|-----|---------|
| `--port` | `COMPOSER_PROXY_PORT` | `8787` |
| `--host` | `COMPOSER_PROXY_HOST` | `127.0.0.1` |
| `--model` | `COMPOSER_PROXY_MODEL` | `composer-2.5` |
| — | `CURSOR_API_KEY` | *(required)* |

Smoke test:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"composer-2.5","messages":[{"role":"user","content":"say hi in 3 words"}]}'
```

## Endpoints

- `GET /` — health
- `GET /v1/models` — advertises `composer-2.5`, `composer-2-fast`, `composer-2`
- `POST /v1/chat/completions` — streaming (`"stream": true`) and non-streaming

Sampling params (temperature, max_tokens, tools) are accepted and ignored —
Composer doesn't take them on this path. Token `usage` is **estimated** from
character counts (Cursor's stream returns no token accounting).

## Wiring into claude-code-router (replace the haiku slot)

In `~/.claude-code-router/config.json`, add this as a provider and route the
**background** slot (the haiku-class model Claude Code uses for summaries,
titles, `/compact`) to it:

```jsonc
{
  "Providers": [
    {
      "name": "composer",
      "api_base_url": "http://127.0.0.1:8787/v1/chat/completions",
      "api_key": "local",
      "models": ["composer-2.5"]
    }
    // ...your real Anthropic provider stays here
  ],
  "Router": {
    "default": "anthropic,claude-...",      // main model → real Claude
    "background": "composer,composer-2.5"    // haiku slot → Composer
  }
}
```

Then launch Claude Code through the router (`ccr code`). Only background tasks
hit Composer; your main model is untouched.

## Notes / limitations

- `@cursor/sdk` is agentic; we run it with an **isolated throwaway `cwd`** so it
  never touches a real working tree, and use it purely for text generation.
- All Composer-specific logic lives in `src/cursor.ts` — the one file to update
  on a `@cursor/sdk` version bump.
- Check Cursor's terms before routing Composer into another tool, and watch
  Dashboard billing — every background call is a Composer request.
