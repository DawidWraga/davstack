import type { Pointer } from '../types.js'

export interface TextCompactOptions {
  /** Lines kept from the head. */
  headLines: number
  /** Lines kept from the tail. */
  tailLines: number
  /** Drop exact-duplicate lines before head/tail trimming. */
  dedup: boolean
}

export interface TextCompactResult {
  text: string
  transforms: string[]
  pointers: Pointer[]
}

/**
 * Line-based prose compaction. Optionally drops exact-duplicate lines, then
 * keeps the first K and last K lines, replacing the middle with an
 * `…[+N lines omitted]` marker. Heuristic only: it has no sentence awareness,
 * so it can cut mid-paragraph — fine for boilerplate-heavy tool output.
 */
export function compactText(content: string, opts: TextCompactOptions): TextCompactResult {
  const transforms = new Set<string>()
  const pointers: Pointer[] = []
  let lines = content.split('\n')

  if (opts.dedup) {
    const seen = new Set<string>()
    const deduped: string[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed && seen.has(line)) {
        transforms.add('text:dedup')
        continue
      }
      if (trimmed) seen.add(line)
      deduped.push(line)
    }
    lines = deduped
  }

  const keep = opts.headLines + opts.tailLines
  if (lines.length > keep + 1) {
    const omitted = lines.length - keep
    const note = `…[+${omitted} lines omitted]`
    transforms.add('text:head-tail')
    pointers.push({ kind: 'text-middle', omitted, note })
    const out = [
      ...lines.slice(0, opts.headLines),
      note,
      ...lines.slice(lines.length - opts.tailLines),
    ]
    return { text: out.join('\n'), transforms: [...transforms], pointers }
  }

  return { text: lines.join('\n'), transforms: [...transforms], pointers }
}
