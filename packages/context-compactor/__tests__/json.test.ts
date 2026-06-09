import { describe, expect, test } from 'vitest'
import { compact } from '../src/index.js'

/** Build the canonical "large tool-result array" shape (cf. logs-dump.md). */
function bigArrayFixture(n = 1000): string {
  const results = Array.from({ length: n }, (_, i) => ({
    id: i,
    status: i === n - 2 ? 'error' : 'ok',
    message: i === n - 2 ? 'Connection timeout' : 'Success',
    uuid: '8f14e45f-ceea-4123-8f14-e45fceea4123',
    timestamp: '2026-06-09T12:00:00Z',
  }))
  return JSON.stringify({ results }, null, 2)
}

describe('compact() on JSON', () => {
  test('caps a long array to head + sentinel + tail and stays valid JSON', () => {
    const input = bigArrayFixture(1000)
    const result = compact(input, { jsonFormat: 'json' })

    expect(result.contentType).toBe('json')
    expect(result.transforms).toContain('json:array-cap')

    const parsed = JSON.parse(result.text) as { results: unknown[] }
    // 3 head + 1 sentinel + 1 tail
    expect(parsed.results).toHaveLength(5)
    expect((parsed.results[0] as { id: number }).id).toBe(0)
    expect((parsed.results[4] as { id: number }).id).toBe(999)
    expect(parsed.results[3]).toContain('omitted')
  })

  test('records a pointer with the omitted count', () => {
    const result = compact(bigArrayFixture(1000))
    const arrayPointer = result.pointers.find((p) => p.kind === 'json-array-items')
    expect(arrayPointer).toBeDefined()
    expect(arrayPointer!.omitted).toBe(996)
  })

  test('preserves the full schema (every key) of kept items', () => {
    const result = compact(bigArrayFixture(1000), { jsonFormat: 'json' })
    const parsed = JSON.parse(result.text) as { results: Array<Record<string, unknown>> }
    expect(Object.keys(parsed.results[0]).sort()).toEqual([
      'id',
      'message',
      'status',
      'timestamp',
      'uuid',
    ])
  })

  test('preserves high-entropy ids verbatim in kept items', () => {
    const result = compact(bigArrayFixture(1000))
    expect(result.text).toContain('8f14e45f-ceea-4123-8f14-e45fceea4123')
  })

  test('achieves a large token reduction on the big array', () => {
    const result = compact(bigArrayFixture(1000))
    expect(result.tokensSaved).toBeGreaterThan(0)
    expect(result.ratio).toBeLessThan(0.2)
  })

  test('truncates long string values but keeps short ones', () => {
    const input = JSON.stringify({
      short: 'keep me',
      long: 'x'.repeat(1000),
    })
    const result = compact(input, { jsonFormat: 'json' })
    expect(result.transforms).toContain('json:string-truncate')
    const parsed = JSON.parse(result.text) as { short: string; long: string }
    expect(parsed.short).toBe('keep me')
    expect(parsed.long).toContain('chars]')
    expect(parsed.long.length).toBeLessThan(200)
  })

  test('leaves small JSON untouched (below minLength)', () => {
    const input = '{"a": 1, "b": 2}'
    const result = compact(input)
    expect(result.transforms).toHaveLength(0)
    expect(result.text).toBe(input)
    expect(result.tokensSaved).toBe(0)
  })

  test('does not cap arrays that are already short', () => {
    const input = JSON.stringify({ items: [1, 2, 3] }) + ' '.repeat(300)
    const result = compact(input)
    expect(result.transforms).not.toContain('json:array-cap')
  })
})
