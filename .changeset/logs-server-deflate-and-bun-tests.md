---
"@davstack/logs-server": patch
---

Robustly decode `Content-Encoding: deflate` bodies. `Bun.inflateSync` accepts only raw DEFLATE (RFC 1951), so standards-compliant zlib-wrapped deflate (RFC 1950, what `Content-Encoding: deflate` officially means) silently failed to a garbage raw decode. The deflate branch now tries zlib-wrapped first, then raw — both forms round-trip.
