---
"@davstack/open-agents": minor
---

Expose `./core/{jobs,parse,paths,deliverable}` and `./adapters/{types,cursor,gemini}` subpath exports (with matching `.d.ts` from tsup) so the davstack TUI agent run viewer can import the existing parser, job-store, path, and adapter modules without duplicating logic. Additive `package.json` / build entries only — no runtime behavior changes.
