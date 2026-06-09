import type { Pointer } from '../types.js'

export interface DiffCompactOptions {
  /** Runs of unchanged context longer than this are collapsed. */
  maxContext: number
}

export interface DiffCompactResult {
  text: string
  transforms: string[]
  pointers: Pointer[]
}

const HEADER = /^(diff --git |index |--- |\+\+\+ |@@ )/

function isHeader(line: string): boolean {
  return HEADER.test(line)
}

function isChange(line: string): boolean {
  // '+'/'-' but not the '+++'/'---' file headers (caught by isHeader first).
  return (line.startsWith('+') || line.startsWith('-')) && !isHeader(line)
}

/**
 * Line-based unified-diff compaction. Keeps every diff/hunk header and every
 * changed line (`+`/`-`), and collapses runs of unchanged context (leading
 * space, or blank) longer than `maxContext` into a `… N unchanged lines` marker.
 * Heuristic only: it assumes standard unified-diff line prefixes.
 */
export function compactDiff(content: string, opts: DiffCompactOptions): DiffCompactResult {
  const lines = content.split('\n')
  const transforms = new Set<string>()
  const pointers: Pointer[] = []
  const out: string[] = []

  let run: string[] = []

  const flush = () => {
    if (run.length === 0) return
    if (run.length > opts.maxContext) {
      const note = `… ${run.length} unchanged lines`
      transforms.add('diff:context-collapse')
      pointers.push({ kind: 'diff-context', omitted: run.length, note })
      out.push(note)
    } else {
      out.push(...run)
    }
    run = []
  }

  for (const line of lines) {
    if (isHeader(line) || isChange(line)) {
      flush()
      out.push(line)
    } else {
      // context (leading space) or blank line
      run.push(line)
    }
  }
  flush()

  return { text: out.join('\n'), transforms: [...transforms], pointers }
}
