import { describe, expect, test } from 'vitest'
import { detectContentType } from '../src/detect.js'

describe('detectContentType', () => {
  test('valid json object', () => {
    expect(detectContentType('{"a": 1, "b": [1, 2, 3]}')).toBe('json')
  })

  test('valid json array', () => {
    expect(detectContentType('[{"id": 1}, {"id": 2}]')).toBe('json')
  })

  test('json-looking but invalid falls through to text', () => {
    expect(detectContentType('{not json at all')).toBe('text')
  })

  test('unified diff', () => {
    expect(detectContentType('diff --git a/x.ts b/x.ts\n@@ -1 +1 @@\n-old\n+new')).toBe('diff')
  })

  test('source code', () => {
    expect(detectContentType('export function foo() {\n  return 1\n}')).toBe('code')
  })

  test('log output', () => {
    expect(detectContentType('2026-06-09 12:00:00 ERROR something failed')).toBe('log')
  })

  test('plain prose', () => {
    expect(detectContentType('the quick brown fox jumps over the lazy dog')).toBe('text')
  })

  test('empty is unknown', () => {
    expect(detectContentType('   ')).toBe('unknown')
  })
})
