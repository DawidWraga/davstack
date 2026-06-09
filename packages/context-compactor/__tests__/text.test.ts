import { describe, expect, test } from 'vitest'
import { compact, compactText } from '../src/index.js'

function lines(n: number): string {
  return Array.from({ length: n }, (_, i) => `line ${i}`).join('\n')
}

describe('compactText', () => {
  test('keeps head and tail, elides the middle with a marker + pointer', () => {
    const input = lines(100)
    const { text, transforms, pointers } = compactText(input, {
      headLines: 5,
      tailLines: 5,
      dedup: false,
    })
    expect(transforms).toContain('text:head-tail')
    expect(text).toContain('line 0')
    expect(text).toContain('line 4')
    expect(text).toContain('line 99')
    expect(text).toMatch(/…\[\+\d+ lines omitted\]/)
    const p = pointers.find((p) => p.kind === 'text-middle')
    expect(p).toBeDefined()
    expect(p!.omitted).toBe(90)
    expect(text.split('\n').length).toBeLessThan(input.split('\n').length)
  })

  test('leaves short input unchanged', () => {
    const input = lines(4)
    const { text, transforms } = compactText(input, { headLines: 5, tailLines: 5, dedup: false })
    expect(transforms).toHaveLength(0)
    expect(text).toBe(input)
  })

  test('dedups exact-duplicate lines when enabled', () => {
    const input = ['a', 'a', 'b', 'b', 'c'].join('\n')
    const { text, transforms } = compactText(input, { headLines: 50, tailLines: 50, dedup: true })
    expect(transforms).toContain('text:dedup')
    expect(text.split('\n')).toEqual(['a', 'b', 'c'])
  })

  test('compact() detects and compacts prose', () => {
    const input = Array.from({ length: 80 }, (_, i) => `the quick brown fox number ${i}`).join('\n')
    const result = compact(input)
    expect(result.contentType).toBe('text')
    expect(result.transforms).toContain('text:head-tail')
    expect(result.tokensSaved).toBeGreaterThan(0)
  })
})
