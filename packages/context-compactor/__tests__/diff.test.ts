import { describe, expect, test } from 'vitest'
import { compact, compactDiff } from '../src/index.js'

const SAMPLE = `diff --git a/src/x.ts b/src/x.ts
index 1111111..2222222 100644
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,12 +1,12 @@
 context line 1
 context line 2
 context line 3
 context line 4
 context line 5
 context line 6
-const old = 1
+const next = 2
 context line 7
 context line 8
 context line 9
 context line 10
 context line 11
`

describe('compactDiff', () => {
  test('keeps diff and hunk headers', () => {
    const { text } = compactDiff(SAMPLE, { maxContext: 3 })
    expect(text).toContain('diff --git a/src/x.ts b/src/x.ts')
    expect(text).toContain('--- a/src/x.ts')
    expect(text).toContain('+++ b/src/x.ts')
    expect(text).toContain('@@ -1,12 +1,12 @@')
  })

  test('keeps changed lines', () => {
    const { text } = compactDiff(SAMPLE, { maxContext: 3 })
    expect(text).toContain('-const old = 1')
    expect(text).toContain('+const next = 2')
  })

  test('collapses long context runs into a marker + pointer', () => {
    const { text, transforms, pointers } = compactDiff(SAMPLE, { maxContext: 3 })
    expect(transforms).toContain('diff:context-collapse')
    expect(text).toMatch(/… \d+ unchanged lines/)
    const p = pointers.find((p) => p.kind === 'diff-context')
    expect(p).toBeDefined()
    expect(p!.omitted).toBeGreaterThan(3)
    expect(text.split('\n').length).toBeLessThan(SAMPLE.split('\n').length)
  })

  test('does not collapse short context runs', () => {
    const small = `@@ -1,2 +1,2 @@
 ctx a
-old
+new
 ctx b`
    const { text, transforms } = compactDiff(small, { maxContext: 3 })
    expect(transforms).toHaveLength(0)
    expect(text).toContain(' ctx a')
    expect(text).toContain(' ctx b')
  })

  test('compact() detects and compacts diffs', () => {
    const result = compact(SAMPLE)
    expect(result.contentType).toBe('diff')
    expect(result.transforms).toContain('diff:context-collapse')
    expect(result.tokensSaved).toBeGreaterThan(0)
  })
})
