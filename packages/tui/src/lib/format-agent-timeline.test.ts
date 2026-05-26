// parseLine (cursor + gemini adapters) → formatEventLines → timeline glyphs.

import { describe, expect, test } from "vitest"

import { cursorAdapter } from "@davstack/open-agents/adapters/cursor"
import { geminiAdapter } from "@davstack/open-agents/adapters/gemini"

import { EVENT_GLYPH, EVENT_GLYPH_ASCII } from "./agent-glyphs.ts"
import { formatEventLines, formatStartLine } from "./format-agent-timeline.ts"

const CURSOR_SYSTEM = '{"type":"system","session_id":"abc-123"}'
const GEMINI_INIT = '{"type":"init","session_id":"s1"}'
const CURSOR_TOOL =
  '{"type":"tool_use","name":"read_file","input":{"path":"src/foo.ts"}}'
const GEMINI_TOOL =
  '{"type":"tool_use","name":"grep","input":{"pattern":"aggregationMode","glob":"**/*.tsx"}}'
const CURSOR_ASSISTANT = '{"type":"assistant","message":{"text":"working on it"}}'
const GEMINI_ASSISTANT =
  '{"type":"message","role":"assistant","content":"hello from gemini"}'
const CURSOR_TOOL_RESULT =
  '{"type":"tool_result","content":"export function QueryBuilder() {}"}'

describe("formatEventLines — cursor stream-json", () => {
  test("system line uses ◇ glyph", () => {
    const ev = cursorAdapter.parseLine(CURSOR_SYSTEM)!
    const rows = formatEventLines({ ev, noColor: false })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.text.startsWith(EVENT_GLYPH.system)).toBe(true)
    expect(rows[0]!.text).toContain("model loaded")
  })

  test("tool_use uses ◆ glyph with path hint", () => {
    const ev = cursorAdapter.parseLine(CURSOR_TOOL)!
    const rows = formatEventLines({ ev, noColor: false })
    expect(rows[0]!.text.startsWith(EVENT_GLYPH.tool_use)).toBe(true)
    expect(rows[0]!.text).toContain("read_file")
    expect(rows[0]!.text).toContain("src/foo.ts")
  })

  test("assistant text uses ✎ glyph", () => {
    const ev = cursorAdapter.parseLine(CURSOR_ASSISTANT)!
    const rows = formatEventLines({ ev, noColor: false })
    expect(rows[0]!.text.startsWith(EVENT_GLYPH.assistant)).toBe(true)
    expect(rows[0]!.text).toContain("working on it")
  })

  test("tool_result uses ▸ glyph", () => {
    const ev = cursorAdapter.parseLine(CURSOR_TOOL_RESULT)!
    const rows = formatEventLines({ ev, noColor: false })
    expect(rows[0]!.text.startsWith(EVENT_GLYPH.tool_result)).toBe(true)
  })
})

describe("formatEventLines — gemini stream-json", () => {
  test("init line uses same ◇ glyph as cursor system", () => {
    const ev = geminiAdapter.parseLine(GEMINI_INIT)!
    const rows = formatEventLines({ ev, noColor: false })
    expect(rows[0]!.text.startsWith(EVENT_GLYPH.system)).toBe(true)
  })

  test("tool_use uses ◆ glyph with arg summary", () => {
    const ev = geminiAdapter.parseLine(GEMINI_TOOL)!
    const rows = formatEventLines({ ev, noColor: false })
    expect(rows[0]!.text.startsWith(EVENT_GLYPH.tool_use)).toBe(true)
    expect(rows[0]!.text).toContain("grep")
    expect(rows[0]!.text).toContain("aggregationMode")
  })

  test("assistant message uses ✎ glyph", () => {
    const ev = geminiAdapter.parseLine(GEMINI_ASSISTANT)!
    const rows = formatEventLines({ ev, noColor: false })
    expect(rows[0]!.text.startsWith(EVENT_GLYPH.assistant)).toBe(true)
    expect(rows[0]!.text).toContain("hello from gemini")
  })
})

describe("formatEventLines — noColor", () => {
  test("cursor tool_use falls back to ASCII + glyph", () => {
    const ev = cursorAdapter.parseLine(CURSOR_TOOL)!
    const rows = formatEventLines({ ev, noColor: true })
    expect(rows[0]!.text.startsWith(EVENT_GLYPH_ASCII.tool_use)).toBe(true)
  })
})

test("formatStartLine uses ▶ glyph", () => {
  const row = formatStartLine({ prompt: "audit auth flows", noColor: false })
  expect(row.text.startsWith(EVENT_GLYPH.start)).toBe(true)
  expect(row.text).toContain("audit auth flows")
})
