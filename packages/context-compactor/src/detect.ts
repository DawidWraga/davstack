import type { ContentType } from './types.js'

const CODE_KEYWORDS = [
  'def ',
  'class ',
  'function ',
  'import ',
  'const ',
  'let ',
  'var ',
  'func ',
  'fn ',
  'pub ',
  'package ',
  'export ',
]

const DIFF_PATTERN = /^(diff --git |@@ .* @@|\+\+\+ |--- )/m
const LOG_PATTERN = /\b(ERROR|WARN|WARNING|INFO|DEBUG|FATAL|TRACE)\b/

/**
 * Heuristic content-type detection (no ML). Cheap and good enough because we
 * usually compact known tool-output shapes. Order matters: diff before code
 * (diffs contain code keywords); json is confirmed by an actual parse.
 */
export function detectContentType(content: string): ContentType {
  const stripped = content.trim()
  if (!stripped) return 'unknown'

  if (stripped.startsWith('{') || stripped.startsWith('[')) {
    try {
      JSON.parse(stripped)
      return 'json'
    } catch {
      // not valid JSON; fall through
    }
  }

  if (DIFF_PATTERN.test(stripped)) return 'diff'
  if (CODE_KEYWORDS.some((kw) => content.includes(kw))) return 'code'
  if (LOG_PATTERN.test(content)) return 'log'
  return 'text'
}
