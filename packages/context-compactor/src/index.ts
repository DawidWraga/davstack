import { detectContentType } from './detect.js'
import { compactCode } from './handlers/code.js'
import { compactDiff } from './handlers/diff.js'
import { compactJson } from './handlers/json.js'
import { compactLog } from './handlers/log.js'
import { compactText } from './handlers/text.js'
import { compactJsonToon } from './handlers/toon.js'
import type { CompactOptions, CompactResult, ContentType, Pointer } from './types.js'

const DEFAULTS = {
  minLength: 200,
  jsonHeadItems: 3,
  jsonTailItems: 1,
  jsonMaxStringLength: 200,
  jsonStringHead: 120,
  jsonFormat: 'auto' as const,
  codeSignatureIndent: 4,
  codeMinRun: 3,
  logIgnoreTimestamps: true,
  diffMaxContext: 3,
  textHeadLines: 5,
  textTailLines: 5,
  textDedup: false,
}

interface HandlerResult {
  text: string
  transforms: string[]
  pointers: Pointer[]
}

/** Cheap chars/4 token estimate (same heuristic headroom uses). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Per-type reducers. Each mirrors `compactJson`'s `(content, opts) => result`. */
const HANDLERS: Partial<Record<ContentType, (content: string, o: CompactOptions) => HandlerResult>> =
  {
    json: (content, o) => {
      const jsonOpts = {
        headItems: o.jsonHeadItems ?? DEFAULTS.jsonHeadItems,
        tailItems: o.jsonTailItems ?? DEFAULTS.jsonTailItems,
        maxStringLength: o.jsonMaxStringLength ?? DEFAULTS.jsonMaxStringLength,
        stringHead: DEFAULTS.jsonStringHead,
      }
      const format = o.jsonFormat ?? DEFAULTS.jsonFormat
      if (format === 'json') return compactJson(content, jsonOpts)
      if (format === 'toon') return compactJsonToon(content, jsonOpts)
      // 'auto': emit whichever serialization is smaller (never worse than JSON).
      const asJson = compactJson(content, jsonOpts)
      const asToon = compactJsonToon(content, jsonOpts)
      const count = o.countTokens ?? estimateTokens
      return count(asToon.text) <= count(asJson.text) ? asToon : asJson
    },
    code: (content, o) =>
      compactCode(content, {
        signatureIndent: o.codeSignatureIndent ?? DEFAULTS.codeSignatureIndent,
        minRun: o.codeMinRun ?? DEFAULTS.codeMinRun,
      }),
    log: (content, o) =>
      compactLog(content, {
        ignoreTimestamps: o.logIgnoreTimestamps ?? DEFAULTS.logIgnoreTimestamps,
      }),
    diff: (content, o) =>
      compactDiff(content, {
        maxContext: o.diffMaxContext ?? DEFAULTS.diffMaxContext,
      }),
    text: (content, o) =>
      compactText(content, {
        headLines: o.textHeadLines ?? DEFAULTS.textHeadLines,
        tailLines: o.textTailLines ?? DEFAULTS.textTailLines,
        dedup: o.textDedup ?? DEFAULTS.textDedup,
      }),
  }

/**
 * Compact a single blob of content. Detects the content type and routes to a
 * structure-aware handler. Deterministic, synchronous, no ML, no network.
 *
 * Each content type (json/code/log/diff/text) has its own handler; 'unknown'
 * and anything below `minLength` pass through unchanged.
 */
export function compact(content: string, options: CompactOptions = {}): CompactResult {
  const count = options.countTokens ?? estimateTokens
  const contentType: ContentType = options.contentType ?? detectContentType(content)
  const tokensBefore = count(content)
  const minLength = options.minLength ?? DEFAULTS.minLength

  let text = content
  let transforms: string[] = []
  let pointers: Pointer[] = []

  const handler = HANDLERS[contentType]
  if (content.length >= minLength && handler) {
    const result = handler(content, options)
    text = result.text
    transforms = result.transforms
    pointers = result.pointers
  }

  const tokensAfter = count(text)
  return {
    text,
    contentType,
    tokensBefore,
    tokensAfter,
    tokensSaved: Math.max(0, tokensBefore - tokensAfter),
    ratio: tokensBefore > 0 ? tokensAfter / tokensBefore : 1,
    transforms,
    pointers,
  }
}

export { detectContentType } from './detect.js'
export { normalizedEntropy, isHighEntropy } from './entropy.js'
export { compactJson } from './handlers/json.js'
export { compactCode } from './handlers/code.js'
export { compactLog } from './handlers/log.js'
export { compactDiff } from './handlers/diff.js'
export { compactText } from './handlers/text.js'
export { compactJsonToon } from './handlers/toon.js'
export type { JsonCompactOptions, JsonCompactResult } from './handlers/json.js'
export type { ToonCompactOptions, ToonCompactResult } from './handlers/toon.js'
export type { CodeCompactOptions, CodeCompactResult } from './handlers/code.js'
export type { LogCompactOptions, LogCompactResult } from './handlers/log.js'
export type { DiffCompactOptions, DiffCompactResult } from './handlers/diff.js'
export type { TextCompactOptions, TextCompactResult } from './handlers/text.js'
export type { CompactOptions, CompactResult, ContentType, Pointer } from './types.js'
