---
"@davstack/logs-server": patch
---

Coerce ISO-8601 span timestamps to epoch seconds in the envelope parser. python `sentry_sdk` serializes transaction `start_timestamp`/`timestamp` as ISO-8601 strings (the JS SDK sends epoch-second floats), so backend/agent spans previously landed at `ts=0` with `duration_ms=null` and sorted to the epoch — invisible to time queries. The span path now accepts both numeric and ISO-string timestamps.
