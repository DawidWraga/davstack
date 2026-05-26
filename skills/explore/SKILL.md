---
name: explore
description: >-
  DEFAULT for multi-file codebase exploration ("how does X work / where is
  Y", tracing an unfamiliar subsystem, log analysis). Delegate the read-only
  sweep instead of self-grepping — protects your context. Never delegate
  design/synthesis. Self-check ONLY the most imporant load-bearing files/lines; delegate breadth
  you wouldn't otherwise open.
---

Scope tightly, then run (backgrounded — the harness notifies you):

    npx explore submit --file ~/.davstack/specs/<slug>.md

For a **single scoped fact**, skip the spec file — inline it (no boilerplate):

    npx explore submit '<goal>Exact signature + return type of resolve_query_adapter</goal> <scope>backend/src/query/adapter.py only</scope>'

Many `--file` run in parallel from one command. Read the `result → <path>`
file for the answer.

Begin every `--file` spec with a markdown `# 3-5 word title` line — a short
overview of the task. The TUI agent viewer renders this as the job label;
without it the viewer falls back to the first 5 words of the spec, which is
rarely meaningful. (Inline single-fact submits can skip the heading.)

The spec is just goal / context (the one gotcha) / scope tags. Do NOT add an
output section — the structured `path:line` deliverable is automatic.

    # Trace report-section autosave path
    <goal>How does report-section autosave reach the backend?</goal>
    <context>TipTap editor; suspect a debounce plus a websocket path.</context>
    <scope>react/src/feat/report/** and any agent ws handler it hits.</scope>

**Verify (non-negotiable).** Quoted `path:line` facts are reliable; the
synthesis is a hypothesis you re-derive yourself. Tell the user what you
delegated and that you verified.
