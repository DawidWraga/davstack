---
"@davstack/logs-server": patch
---

Fix `view` reading web vitals from the wrong span in cross-runtime traces.

The vitals header pulled `measurement.*` off the trace's topmost root span — but trace propagation re-parents the browser pageload (which actually carries the web vitals) *under* the server root, so its segment isn't parentless and the header came up empty. `view` now scans for the segment carrying `measurement.*` rather than assuming it's the root, and rounds CLS to 4 d.p. So a browser↔server trace now renders e.g. `vitals: LCP 624ms · FCP 624ms · TTFB 364ms · CLS 0.0001`.
