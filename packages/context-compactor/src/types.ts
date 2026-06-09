/** High-level content categories used to route to a compaction handler. */
export type ContentType = 'json' | 'code' | 'log' | 'diff' | 'text' | 'unknown'

/** A breadcrumb left where content was elided, so a caller can retrieve the original. */
export interface Pointer {
  /** What kind of elision this marks (e.g. 'json-array-items', 'json-string'). */
  kind: string
  /** How much was dropped (items / lines / chars, depending on kind). */
  omitted: number
  /** Inline marker text that was inserted into the output. */
  note: string
}

export interface CompactOptions {
  /** Force a content type, skipping detection. */
  contentType?: ContentType
  /** Token counter. Defaults to a chars/4 estimator. */
  countTokens?: (s: string) => number
  /** Skip compaction below this length (chars). Default 200. */
  minLength?: number
  /** JSON: number of leading array items to keep verbatim. Default 3. */
  jsonHeadItems?: number
  /** JSON: number of trailing array items to keep verbatim. Default 1. */
  jsonTailItems?: number
  /** JSON: string values longer than this are truncated. Default 200. */
  jsonMaxStringLength?: number
  /**
   * JSON output serialization. 'json' = compact JSON; 'toon' = Token-Oriented
   * Object Notation (keys declared once per array, comma rows — far cheaper for
   * arrays of uniform objects); 'auto' = emit whichever is smaller. Default 'auto'.
   */
  jsonFormat?: 'json' | 'toon' | 'auto'
  /** code: indent columns at/below which a line is structural. Default 4. */
  codeSignatureIndent?: number
  /** code: minimum run of body lines before collapsing. Default 3. */
  codeMinRun?: number
  /** log: strip leading timestamps before comparing lines. Default true. */
  logIgnoreTimestamps?: boolean
  /** diff: collapse runs of unchanged context longer than this. Default 3. */
  diffMaxContext?: number
  /** text: lines kept from the head. Default 5. */
  textHeadLines?: number
  /** text: lines kept from the tail. Default 5. */
  textTailLines?: number
  /** text: drop exact-duplicate lines. Default false. */
  textDedup?: boolean
}

export interface CompactResult {
  /** The compacted content. */
  text: string
  /** Detected (or forced) content type. */
  contentType: ContentType
  tokensBefore: number
  tokensAfter: number
  tokensSaved: number
  /** tokensAfter / tokensBefore (1 = no change). */
  ratio: number
  /** Names of transforms that fired, e.g. ['json:array-cap']. */
  transforms: string[]
  /** Breadcrumbs for elided content. */
  pointers: Pointer[]
}
