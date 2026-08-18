---
name: explore
description: >-
  DEFAULT for multi-file codebase exploration ("how does X work / where is
  Y", tracing an unfamiliar subsystem, log analysis). Delegate the read-only
  sweep instead of self-grepping — protects your context. Never delegate
  design/synthesis. Self-check ONLY the most imporant load-bearing files/lines; delegate breadth
  you wouldn't otherwise open.
---

Default to one short `--task`, especially for lookups, traces, and other simple
requests. Use the user's request verbatim when it is already concise:

explore submit --task "Find where Juno's realtime voice is locked to marin, with exact path:line citations"

Do not create a spec file or invent `<goal>`, `<context>`, or `<scope>` merely
to wrap a task the user already stated. Conversation history supplies the
surrounding context automatically.

Run one foreground submission with a long shell timeout. If the shell yields a
running handle, wait on that same handle; completion wakes the agent. Never pass
`--background`, poll `result`, or resubmit.

Conversation history is included automatically. Keep the task to roughly one
sentence; do not repeat details, quotes, or file lists already present in the
conversation. History up to the direct budget goes to the executor unchanged;
oversized history is reduced to task-specific context first. Use `--no-history`
only when the conversation is irrelevant. `--compact-mode` remains a legacy
alias and is no longer needed.

If the conversation contains secrets, credentials, audit artifacts, or
user/health data, use `--no-history` and provide a sanitized scoped spec.

For a single scoped fact, use `--task` with no boilerplate:

    explore submit --task "Find the exact signature and return type of resolve_query_adapter in backend/src/query/adapter.py"

Use `--spec-file` only when essential instructions not present in conversation
cannot fit cleanly in one sentence, or when supplying an intentionally prepared
multi-part spec. Never generate one pre-emptively. Multiple `--task` or
`--spec-file` inputs can run in parallel.

If a spec file is genuinely needed, begin it with a markdown `# 3-5 word title`
line — a short
overview of the task. The TUI agent viewer renders this as the job label;
without it the viewer falls back to the first 5 words of the spec, which is
rarely meaningful.

The spec is just goal / context (the one gotcha) / scope tags. Do NOT add an
output section — the structured `path:line` deliverable is automatic.

    # Trace report-section autosave path
    <goal>How does report-section autosave reach the backend?</goal>
    <context>TipTap editor; suspect a debounce plus a websocket path.</context>
    <scope>react/src/feat/report/** and any agent ws handler it hits.</scope>

**Verify (non-negotiable).** Quoted `path:line` facts are reliable; the
synthesis is a hypothesis you re-derive yourself. Tell the user what you
delegated and that you verified.
