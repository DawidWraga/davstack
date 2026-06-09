import type { Pointer } from '../types.js'

export interface CodeCompactOptions {
  /** Indent columns at/below which a *block-opening* line is kept as a signature. */
  signatureIndent: number
  /** Minimum run of body lines before they are collapsed. */
  minRun: number
}

export interface CodeCompactResult {
  text: string
  transforms: string[]
  pointers: Pointer[]
}

const STRUCTURAL = [
  'import',
  'export',
  'from ',
  'def ',
  'class ',
  'function ',
  'func ',
  'fn ',
  'interface ',
  'type ',
  'struct ',
  'enum ',
  'pub ',
  'package ',
]

function leadingIndent(line: string): number {
  const m = line.match(/^[ \t]*/)
  return m ? m[0].replace(/\t/g, '  ').length : 0
}

function isStructural(line: string, signatureIndent: number): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) return true
  if (trimmed.startsWith('@')) return true // decorator
  if (STRUCTURAL.some((kw) => trimmed.startsWith(kw))) return true
  // Shallow block-opening lines (signatures, closing braces) are scaffolding.
  if (leadingIndent(line) <= signatureIndent) {
    if (/[{([:]\s*$/.test(trimmed) || /=>\s*\{?\s*$/.test(trimmed)) return true
    if (/^[)\]}]/.test(trimmed)) return true
  }
  return false
}

/**
 * Line-based code compaction. Keeps structural lines (imports/exports, defs,
 * classes, signatures, decorators, comments and low-indent scaffolding) and
 * collapses consecutive deeply-indented body lines into a `// … N lines` marker.
 * Heuristic only: it does not parse the language, so unusual formatting (no
 * indentation, minified code) will simply collapse less.
 */
export function compactCode(content: string, opts: CodeCompactOptions): CodeCompactResult {
  const lines = content.split('\n')
  const transforms = new Set<string>()
  const pointers: Pointer[] = []
  const out: string[] = []

  let run: string[] = []

  const flush = () => {
    if (run.length === 0) return
    if (run.length >= opts.minRun) {
      const indent = run[0].match(/^[ \t]*/)?.[0] ?? ''
      const note = `${indent}// … ${run.length} lines`
      transforms.add('code:body-elide')
      pointers.push({ kind: 'code-body', omitted: run.length, note })
      out.push(note)
    } else {
      out.push(...run)
    }
    run = []
  }

  for (const line of lines) {
    if (isStructural(line, opts.signatureIndent)) {
      flush()
      out.push(line)
    } else {
      run.push(line)
    }
  }
  flush()

  return { text: out.join('\n'), transforms: [...transforms], pointers }
}
