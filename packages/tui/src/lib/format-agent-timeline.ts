import { walkToolUses } from "@davstack/open-agents/core/parse"
import type { ParsedEvent } from "@davstack/open-agents/adapters/types"

import { eventGlyph, type AgentEventKind } from "./agent-glyphs.ts"

const TOOL_ARG_KEYS = [
  "path",
  "file_path",
  "pattern",
  "glob",
  "command",
  "target",
  "target_file",
  "filename",
  "file",
]

export interface TimelineRenderLine {
  kind: AgentEventKind
  text: string
}

export function formatStartLine(opts: { prompt: string; noColor: boolean }): TimelineRenderLine {
  const g = eventGlyph("start", opts.noColor)
  const prompt = truncateOneLine(opts.prompt, 60)
  return { kind: "start", text: `${g} run started · prompt: "${prompt}"` }
}

export function formatEventLines(opts: {
  ev: ParsedEvent
  noColor: boolean
}): TimelineRenderLine[] {
  const { ev, noColor } = opts
  const type = typeof ev.type === "string" ? ev.type : "other"

  if (type === "system" || type === "init") {
    return [line("system", noColor, "system", "model loaded")]
  }

  if (type === "tool_result" || type === "tool_result_error") {
    const body = extractText(ev)
    const preview = truncateOneLine(body.replace(/\s+/g, " "), 160)
    const size = body.length > 0 ? ` (${formatByteSize(body.length)})` : ""
    return [line("tool_result", noColor, `tool_result${size}`, preview || "ok")]
  }

  if (type === "assistant" || (type === "message" && ev.role === "assistant")) {
    const body = extractAssistantText(ev)
    if (!body.trim()) return []
    return [line("assistant", noColor, "assistant", `"${truncateOneLine(body.replace(/\s+/g, " "), 120)}"`)]
  }

  if (type === "result") {
    return []
  }

  const out: TimelineRenderLine[] = []
  for (const tu of walkToolUses(ev)) {
    const summary = summarizeToolInput(tu.input)
    const label = summary ? `${tu.name}(${summary})` : tu.name
    out.push(line("tool_use", noColor, "tool_use", label))
  }
  if (out.length > 0) return out

  if (type === "tool_use" || type === "tool_call") {
    const name = typeof ev.name === "string" ? ev.name : "tool"
    out.push(line("tool_use", noColor, "tool_use", `${name}(${summarizeToolInput(ev.input ?? ev.arguments)})`))
    return out
  }

  return []
}

export function formatResultSummaryLine(opts: {
  toolCallCount: number
  filesChanged: string[]
  usage?: { input?: number; output?: number }
  cost?: string
  noColor: boolean
}): TimelineRenderLine {
  const parts: string[] = []
  parts.push(`${opts.toolCallCount} tool calls`)
  if (opts.filesChanged.length > 0) {
    parts.push(`${opts.filesChanged.length} files changed`)
  }
  if (opts.usage?.input != null && opts.usage?.output != null) {
    parts.push(`${formatTokenCount(opts.usage.input)} in / ${formatTokenCount(opts.usage.output)} out`)
  }
  if (opts.cost) parts.push(opts.cost)
  return line("result", opts.noColor, "result", parts.join(" · "))
}

function line(
  kind: AgentEventKind,
  noColor: boolean,
  label: string,
  detail: string,
): TimelineRenderLine {
  const g = eventGlyph(kind, noColor)
  const body = detail ? ` ${label} ${detail}` : ` ${label}`
  return { kind, text: `${g}${body}`.trimEnd() }
}

function summarizeToolInput(input: unknown): string {
  if (input == null) return ""
  if (typeof input === "string") return truncateOneLine(input, 80)
  if (typeof input !== "object") return truncateOneLine(String(input), 80)
  const rec = input as Record<string, unknown>
  const parts: string[] = []
  for (const k of TOOL_ARG_KEYS) {
    const v = rec[k]
    if (typeof v === "string" && v.length > 0) parts.push(v)
  }
  if (parts.length === 0) {
    for (const [k, v] of Object.entries(rec).slice(0, 2)) {
      if (typeof v === "string" && v.length > 0) parts.push(`${k}=${v}`)
    }
  }
  return truncateOneLine(parts.join(", "), 80)
}

function extractText(ev: ParsedEvent): string {
  const direct =
    pickString(ev, ["content", "result", "text", "output"]) ??
    pickString(ev.message as Record<string, unknown> | undefined, ["content", "text"])
  if (direct) return direct
  if (typeof ev.content === "string") return ev.content
  return JSON.stringify(ev).slice(0, 500)
}

function extractAssistantText(ev: ParsedEvent): string {
  if (typeof ev.text === "string") return ev.text
  if (typeof ev.content === "string") return ev.content
  const msg = ev.message as Record<string, unknown> | undefined
  if (msg) {
    const t = pickString(msg, ["text", "content"])
    if (t) return t
  }
  return ""
}

function pickString(obj: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!obj) return undefined
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "string" && v.length > 0) return v
  }
  return undefined
}

function truncateOneLine(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim()
  if (one.length <= n) return one
  return one.slice(0, n - 1) + "…"
}

function formatByteSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatTokenCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}
