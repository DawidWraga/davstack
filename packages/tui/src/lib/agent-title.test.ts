import { describe, expect, test } from "vitest"

import { inferAgentTitle } from "./agent-title.ts"

describe("inferAgentTitle", () => {
  test("uses first markdown heading", () => {
    const prompt = "# Phase A1 — Widen exports\n\nbody text..."
    expect(inferAgentTitle({ prompt })).toBe("Phase A1 — Widen exports")
  })

  test("strips trailing hashes from heading", () => {
    expect(inferAgentTitle({ prompt: "## Quick fix ##" })).toBe("Quick fix")
  })

  test("ignores leading blank lines", () => {
    expect(inferAgentTitle({ prompt: "\n\n\n# Real title\nbody" })).toBe("Real title")
  })

  test("falls back to first 5 words when no heading", () => {
    const prompt = "Refactor the auth flow to use JWT instead of cookies"
    expect(inferAgentTitle({ prompt })).toBe("Refactor the auth flow to")
  })

  test("strips XML tags when falling back", () => {
    const prompt = "<intent>Rename fooBar to computeFoo</intent>"
    expect(inferAgentTitle({ prompt })).toBe("Rename fooBar to computeFoo")
  })

  test("first non-blank line that isn't a heading falls back to words", () => {
    const prompt = "Not a heading\n# But this is\nmore"
    expect(inferAgentTitle({ prompt })).toBe("Not a heading But this")
  })

  test("respects maxWords override", () => {
    const prompt = "one two three four five six seven"
    expect(inferAgentTitle({ prompt }, 3)).toBe("one two three")
  })

  test("empty prompt returns empty string", () => {
    expect(inferAgentTitle({ prompt: "" })).toBe("")
  })
})
