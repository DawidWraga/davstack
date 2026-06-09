import { describe, expect, test } from 'vitest'
import { compact, compactCode } from '../src/index.js'

const SAMPLE = `import { foo } from './foo'
export function doWork(input: string) {
  const a = input.trim()
  const b = a.toUpperCase()
  const c = b.split('')
  const d = c.reverse()
  return d.join('')
}

export class Widget {
  render() {
    const el = document.createElement('div')
    el.className = 'widget'
    el.textContent = 'hi'
    document.body.appendChild(el)
    return el
  }
}
`

describe('compactCode', () => {
  test('keeps structural lines (imports, signatures, class)', () => {
    const { text } = compactCode(SAMPLE, { signatureIndent: 4, minRun: 3 })
    expect(text).toContain("import { foo } from './foo'")
    expect(text).toContain('export function doWork(input: string) {')
    expect(text).toContain('export class Widget {')
    expect(text).toContain('render() {')
  })

  test('collapses deep body runs into a marker + pointer', () => {
    const { text, transforms, pointers } = compactCode(SAMPLE, { signatureIndent: 4, minRun: 3 })
    expect(transforms).toContain('code:body-elide')
    expect(text).toMatch(/\/\/ … \d+ lines/)
    const p = pointers.find((p) => p.kind === 'code-body')
    expect(p).toBeDefined()
    expect(p!.omitted).toBeGreaterThanOrEqual(3)
  })

  test('reduces line count', () => {
    const { text } = compactCode(SAMPLE, { signatureIndent: 4, minRun: 3 })
    expect(text.split('\n').length).toBeLessThan(SAMPLE.split('\n').length)
  })

  test('preserves leading comments', () => {
    const src = '// important note\nfunction f() {\n      x\n      y\n      z\n      w\n}'
    const { text } = compactCode(src, { signatureIndent: 4, minRun: 3 })
    expect(text).toContain('// important note')
  })

  test('routes via compact() and leaves short input unchanged', () => {
    const short = 'export const x = 1'
    const result = compact(short, { contentType: 'code' })
    expect(result.transforms).toHaveLength(0)
    expect(result.text).toBe(short)
  })

  test('compact() detects and compacts code', () => {
    const result = compact(SAMPLE)
    expect(result.contentType).toBe('code')
    expect(result.transforms).toContain('code:body-elide')
    expect(result.tokensSaved).toBeGreaterThan(0)
  })
})
