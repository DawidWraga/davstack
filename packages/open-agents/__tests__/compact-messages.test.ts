import { describe, expect, test } from 'vitest'
import {
  compactMessageContent,
  compactMessages,
  renderCompactMessages,
} from '../src/core/compact.js'
import type { CompactMessage } from '../src/core/compact.js'

function bigJsonToolResult(): string {
  return JSON.stringify(
    Array.from({ length: 80 }, (_, i) => ({
      id: i,
      name: `row-${i}`,
      value: i * 7,
      active: i % 2 === 0,
      note: 'lorem ipsum dolor sit amet consectetur adipiscing elit',
    })),
  )
}

describe('compactMessageContent', () => {
  test('reduces a large JSON string content, preserves role and schema keys', () => {
    const original = bigJsonToolResult()
    const message: CompactMessage = { role: 'tool', content: original }
    const result = compactMessageContent(message)

    expect(result.role).toBe('tool')
    expect(typeof result.content).toBe('string')
    expect((result.content as string).length).toBeLessThan(original.length)
    // schema keys still present in the compacted output
    expect(result.content as string).toContain('id')
    expect(result.content as string).toContain('name')
    expect(result.content as string).toContain('value')
  })

  test('passes a small / plain message through unchanged', () => {
    const message: CompactMessage = { role: 'user', content: 'fix the enum bug please' }
    const result = compactMessageContent(message)
    expect(result.role).toBe('user')
    expect(result.content).toBe('fix the enum bug please')
  })

  test('array content: text blocks compacted, non-text blocks preserved', () => {
    const big = bigJsonToolResult()
    const message: CompactMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: big },
        { type: 'tool_use', id: 'tu_1', name: 'do_thing', input: { a: 1 } },
        { type: 'text', content: big },
      ],
    }
    const result = compactMessageContent(message)
    expect(result.role).toBe('assistant')
    const blocks = result.content as Array<Record<string, unknown>>

    // text block compacted
    expect((blocks[0].text as string).length).toBeLessThan(big.length)
    expect(blocks[0].type).toBe('text')
    // non-text block untouched
    expect(blocks[1]).toEqual({ type: 'tool_use', id: 'tu_1', name: 'do_thing', input: { a: 1 } })
    // .content string block compacted too
    expect((blocks[2].content as string).length).toBeLessThan(big.length)
  })
})

describe('compactMessages', () => {
  test('aggregates token estimates and reduces a big tool_result message', () => {
    const messages: CompactMessage[] = [
      { role: 'user', content: 'short ask' },
      { role: 'tool', content: bigJsonToolResult() },
    ]
    const result = compactMessages(messages)
    expect(result.messages).toHaveLength(2)
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore)
    expect(result.tokensSaved).toBe(result.tokensBefore - result.tokensAfter)
    expect(result.messages[0].role).toBe('user')
    expect(result.messages[1].role).toBe('tool')
  })

  test('renderCompactMessages still works on compacted messages', () => {
    const messages: CompactMessage[] = [
      { role: 'user', content: 'do the thing' },
      { role: 'tool', content: bigJsonToolResult() },
    ]
    const { messages: compacted } = compactMessages(messages)
    const rendered = renderCompactMessages(compacted)
    expect(rendered).toContain('user: do the thing')
    expect(rendered).toContain('tool:')
    expect(rendered.length).toBeGreaterThan(0)
  })
})
