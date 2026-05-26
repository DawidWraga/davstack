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
