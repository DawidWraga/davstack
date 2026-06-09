import type { Pointer } from '../types.js'

export interface LogCompactOptions {
  /** Strip leading timestamps before comparing lines for near-identity. */
  ignoreTimestamps: boolean
}

export interface LogCompactResult {
  text: string
  transforms: string[]
  pointers: Pointer[]
}

const SEVERITY = /\b(ERROR|WARN|WARNING|FATAL|Exception|Traceback)\b/
const STACK_FRAME = /(^\s*at\s)|(\bFile ")/
const TIMESTAMP =
  /^\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?Z?|\[\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\]|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\s*/

function alwaysKeep(line: string): boolean {
  return SEVERITY.test(line) || STACK_FRAME.test(line)
}

function normalize(line: string, ignoreTimestamps: boolean): string {
  return ignoreTimestamps ? line.replace(TIMESTAMP, '') : line
}

/**
 * Line-based log compaction. Collapses runs of identical (or, with timestamps
 * stripped, near-identical) lines into `<line>  (×N)`, but ALWAYS keeps lines
 * carrying a severity keyword or a stack frame. Heuristic only: "near-identical"
 * means equal after an optional leading-timestamp strip, not fuzzy matching.
 */
export function compactLog(content: string, opts: LogCompactOptions): LogCompactResult {
  const lines = content.split('\n')
  const transforms = new Set<string>()
  const pointers: Pointer[] = []
  const out: string[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (alwaysKeep(line)) {
      out.push(line)
      i++
      continue
    }

    const key = normalize(line, opts.ignoreTimestamps)
    let count = 1
    while (
      i + count < lines.length &&
      !alwaysKeep(lines[i + count]) &&
      normalize(lines[i + count], opts.ignoreTimestamps) === key
    ) {
      count++
    }

    if (count > 1) {
      transforms.add('log:dedup')
      pointers.push({ kind: 'log-dedup', omitted: count - 1, note: `(×${count})` })
      out.push(`${line}  (×${count})`)
    } else {
      out.push(line)
    }
    i += count
  }

  return { text: out.join('\n'), transforms: [...transforms], pointers }
}
