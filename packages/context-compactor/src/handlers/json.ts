import type { Pointer } from '../types.js'

export interface JsonCompactOptions {
  /** Leading array items kept verbatim. */
  headItems: number
  /** Trailing array items kept verbatim. */
  tailItems: number
  /** String values longer than this are truncated. */
  maxStringLength: number
  /** Chars retained from the head of a truncated string. */
  stringHead: number
}

export interface JsonCompactResult {
  text: string
  transforms: string[]
  pointers: Pointer[]
}

/**
 * Structure-aware JSON compaction. Unlike a blind truncation it preserves the
 * full schema (every key, all booleans/nulls/numbers, short values) so the LLM
 * still sees the shape, while collapsing the two things that dominate token
 * count in real tool output:
 *
 *  - long arrays  -> keep first N + last M items, drop the middle
 *  - long strings -> keep a head, drop the tail
 *
 * Every elision leaves an inline marker and a Pointer for retrieval. Re-emitting
 * with compact JSON.stringify also drops all pretty-print whitespace for free.
 *
 * Adapted from headroom's json_handler + array-cap heuristic, but operating on
 * the parsed structure (cleaner and exact) rather than a character mask.
 */
export function compactJson(content: string, opts: JsonCompactOptions): JsonCompactResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return { text: content, transforms: [], pointers: [] }
  }

  const transforms = new Set<string>()
  const pointers: Pointer[] = []
  const keep = opts.headItems + opts.tailItems

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      // Only cap when it actually saves more than one element.
      if (node.length > keep + 1) {
        const omitted = node.length - keep
        const note = `…[+${omitted} of ${node.length} items omitted]`
        transforms.add('json:array-cap')
        pointers.push({ kind: 'json-array-items', omitted, note })
        return [
          ...node.slice(0, opts.headItems).map(walk),
          note,
          ...node.slice(node.length - opts.tailItems).map(walk),
        ]
      }
      return node.map(walk)
    }

    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(node)) out[key] = walk(value)
      return out
    }

    if (typeof node === 'string' && node.length > opts.maxStringLength) {
      const omitted = node.length - opts.stringHead
      const note = `…[+${omitted} chars]`
      transforms.add('json:string-truncate')
      pointers.push({ kind: 'json-string', omitted, note })
      return node.slice(0, opts.stringHead) + note
    }

    return node
  }

  const reduced = walk(parsed)
  return { text: JSON.stringify(reduced), transforms: [...transforms], pointers }
}
