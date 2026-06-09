import { encode } from '@toon-format/toon'
import type { Pointer } from '../types.js'

export interface ToonCompactOptions {
  /** Leading array items kept verbatim. */
  headItems: number
  /** Trailing array items kept verbatim. */
  tailItems: number
  /** String values longer than this are truncated. */
  maxStringLength: number
  /** Chars retained from the head of a truncated string. */
  stringHead: number
}

export interface ToonCompactResult {
  text: string
  transforms: string[]
  pointers: Pointer[]
}

/**
 * JSON compaction that serializes to TOON (Token-Oriented Object Notation)
 * instead of JSON. TOON declares an array's length + field names once and
 * streams comma-separated rows, so arrays of uniform objects cost far fewer
 * tokens than JSON (which repeats every key per element).
 *
 * Unlike the JSON handler, the array cap keeps the kept items *uniform* (no
 * inline sentinel) so the TOON table stays clean; omission/truncation notes are
 * appended as trailing `#` comment lines (read by the LLM, ignored as data).
 */
export function compactJsonToon(content: string, opts: ToonCompactOptions): ToonCompactResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return { text: content, transforms: [], pointers: [] }
  }

  const transforms = new Set<string>(['json:toon'])
  const pointers: Pointer[] = []
  const keep = opts.headItems + opts.tailItems

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      if (node.length > keep + 1) {
        const omitted = node.length - keep
        transforms.add('json:array-cap')
        pointers.push({
          kind: 'json-array-items',
          omitted,
          note: `+${omitted} of ${node.length} array items omitted`,
        })
        return [
          ...node.slice(0, opts.headItems).map(walk),
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
      transforms.add('json:string-truncate')
      pointers.push({ kind: 'json-string', omitted, note: `string truncated (+${omitted} chars)` })
      return node.slice(0, opts.stringHead) + `…[+${omitted} chars]`
    }

    return node
  }

  const reduced = walk(parsed)
  let text: string
  try {
    text = encode(reduced)
  } catch {
    // encode is total over the JSON data model, but stay defensive: fall back
    // to compact JSON if it ever throws.
    transforms.delete('json:toon')
    return { text: JSON.stringify(reduced), transforms: [...transforms], pointers }
  }

  if (pointers.length) {
    text += '\n' + pointers.map((pointer) => `# ${pointer.note}`).join('\n')
  }

  return { text, transforms: [...transforms], pointers }
}
