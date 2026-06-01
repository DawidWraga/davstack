---
"@davstack/logs-server": patch
"@davstack/init": patch
---

logs-server docs: adopt the `->>` operator for JSON projection (`attrs->>'seam'` in place of `json_extract(attrs, '$.seam')`) across the skill, reading/writing/session-views docs, and README recipes. Shorter, single recommended idiom; init's shipped skill copy regenerated.
