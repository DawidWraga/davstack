---
"@davstack/init": patch
---

Update the bundled `logs-server` skill: drop the removed `logs-server query`
verbs (trace/run/errors/filter, gone since logs-server 2.1.0) and document the
current read path — reading the store directly with sqlite3 against
`.davstack/logs/<db>`, mirroring the canonical skill. Also adds the shared
lifecycle rule (ask the user to run `davstack start`; never run `serve`
yourself).
