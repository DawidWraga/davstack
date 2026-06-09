import { describe, expect, test } from 'vitest'
import { compact } from '../src/index.js'

function bigArrayFixture(n = 1000): string {
  const results = Array.from({ length: n }, (_, i) => ({
    id: i,
    status: i === n - 2 ? 'error' : 'ok',
    message: i === n - 2 ? 'Connection timeout' : 'Success',
    timestamp: '2026-06-09T12:00:00Z',
  }))
  return JSON.stringify({ results }, null, 2)
}

describe('compact() with TOON output', () => {
  test('emits a tabular TOON header declaring fields once', () => {
    const result = compact(bigArrayFixture(1000), { jsonFormat: 'toon' })
    expect(result.contentType).toBe('json')
    expect(result.transforms).toContain('json:toon')
    expect(result.transforms).toContain('json:array-cap')
    // length + field list declared once: results[N]{id,status,message,timestamp}:
    expect(result.text).toMatch(/results\[\d+\]\{id,status,message,timestamp\}:/)
  })

  test('keeps array rows uniform (no inline sentinel) and notes omissions in trailing comments', () => {
    const result = compact(bigArrayFixture(1000), { jsonFormat: 'toon' })
    // The omission marker is a trailing `#` line, not an array element.
    expect(result.text).toMatch(/#.*items omitted/)
    const arrayPointer = result.pointers.find((p) => p.kind === 'json-array-items')
    expect(arrayPointer?.omitted).toBe(996)
  })

  test('preserves field values verbatim in kept rows', () => {
    const result = compact(bigArrayFixture(1000), { jsonFormat: 'toon' })
    // Timestamp contains ':' so TOON quotes it; the value is still present verbatim.
    expect(result.text).toContain('2026-06-09T12:00:00Z')
    expect(result.text).toContain('Success')
  })

  test('TOON beats JSON on a uniform-object array', () => {
    const input = bigArrayFixture(1000)
    const asJson = compact(input, { jsonFormat: 'json' })
    const asToon = compact(input, { jsonFormat: 'toon' })
    expect(asToon.tokensAfter).toBeLessThan(asJson.tokensAfter)
  })

  test("'auto' (the default) selects TOON for a large uniform array", () => {
    const result = compact(bigArrayFixture(1000))
    expect(result.transforms).toContain('json:toon')
  })

  test("'auto' never produces more tokens than JSON", () => {
    const input = bigArrayFixture(1000)
    const auto = compact(input)
    const asJson = compact(input, { jsonFormat: 'json' })
    expect(auto.tokensAfter).toBeLessThanOrEqual(asJson.tokensAfter)
  })
})
