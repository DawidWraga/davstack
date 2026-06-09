import { describe, expect, test } from 'vitest'
import { compact, compactLog } from '../src/index.js'

describe('compactLog', () => {
  test('collapses runs of identical lines into a count marker', () => {
    const input = Array.from({ length: 50 }, () => 'connection retry...').join('\n')
    const { text, transforms, pointers } = compactLog(input, { ignoreTimestamps: true })
    expect(transforms).toContain('log:dedup')
    expect(text).toContain('(×50)')
    const p = pointers.find((p) => p.kind === 'log-dedup')
    expect(p).toBeDefined()
    expect(p!.omitted).toBe(49)
    expect(text.split('\n').length).toBeLessThan(input.split('\n').length)
  })

  test('treats timestamped lines as near-identical', () => {
    const input = [
      '2026-06-09T12:00:00Z heartbeat ok',
      '2026-06-09T12:00:01Z heartbeat ok',
      '2026-06-09T12:00:02Z heartbeat ok',
    ].join('\n')
    const { text } = compactLog(input, { ignoreTimestamps: true })
    expect(text).toContain('(×3)')
    expect(text.split('\n')).toHaveLength(1)
  })

  test('ALWAYS keeps error / warn / stack-frame lines', () => {
    const input = [
      'info ok',
      'info ok',
      'ERROR boom failed',
      'ERROR boom failed',
      'Traceback (most recent call last):',
      '  File "app.py", line 10, in <module>',
      '    at Object.<anonymous> (/x.js:1:1)',
      'WARNING low disk',
    ].join('\n')
    const { text } = compactLog(input, { ignoreTimestamps: true })
    expect((text.match(/ERROR boom failed/g) ?? []).length).toBe(2)
    expect(text).toContain('Traceback (most recent call last):')
    expect(text).toContain('File "app.py"')
    expect(text).toContain('at Object.<anonymous>')
    expect(text).toContain('WARNING low disk')
  })

  test('leaves non-repeating lines unchanged', () => {
    const input = 'line one\nline two\nline three'
    const { text, transforms } = compactLog(input, { ignoreTimestamps: true })
    expect(transforms).toHaveLength(0)
    expect(text).toBe(input)
  })

  test('compact() detects and compacts logs', () => {
    const input = Array.from({ length: 30 }, () => 'DEBUG polling status').join('\n')
    const result = compact(input)
    expect(result.contentType).toBe('log')
    expect(result.transforms).toContain('log:dedup')
    expect(result.tokensSaved).toBeGreaterThan(0)
  })
})
