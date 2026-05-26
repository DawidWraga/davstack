export type AgentEventKind =
  | "start"
  | "system"
  | "tool_use"
  | "tool_result"
  | "assistant"
  | "result"
  | "other"

export const EVENT_GLYPH: Record<AgentEventKind, string> = {
  start: "▶",
  system: "◇",
  tool_use: "◆",
  tool_result: "▸",
  assistant: "✎",
  result: "■",
  other: "·",
}

export const EVENT_GLYPH_ASCII: Record<AgentEventKind, string> = {
  start: ">",
  system: "*",
  tool_use: "+",
  tool_result: "-",
  assistant: "~",
  result: "#",
  other: ".",
}

export function eventGlyph(kind: AgentEventKind, noColor: boolean): string {
  return noColor ? EVENT_GLYPH_ASCII[kind] : EVENT_GLYPH[kind]
}

export type AgentJobStatus = "running" | "done" | "failed" | "cancelled"

export const JOB_STATUS_GLYPH: Record<AgentJobStatus, string> = {
  running: "●",
  done: "✓",
  failed: "✗",
  cancelled: "○",
}

export const JOB_STATUS_GLYPH_ASCII: Record<AgentJobStatus, string> = {
  running: "*",
  done: "+",
  failed: "x",
  cancelled: "o",
}

export function jobStatusGlyph(status: AgentJobStatus, noColor: boolean): string {
  return noColor ? JOB_STATUS_GLYPH_ASCII[status] : JOB_STATUS_GLYPH[status]
}
