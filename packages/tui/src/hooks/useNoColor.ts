// Reads the NO_COLOR signal once at module load. We honour two sources:
//
//   1. The `NO_COLOR` environment variable (https://no-color.org) — any
//      non-empty value disables color.
//   2. The `DAVSTACK_NO_COLOR` env (set by cli.ts when --no-color is passed).
//
// Components call this hook to decide whether to forward `color={...}`
// props or leave them undefined. Ink doesn't expose a theme-level toggle
// so each colored seam consults the hook explicitly.

let cached: boolean | null = null

function compute(): boolean {
  const env = process.env.NO_COLOR
  if (typeof env === "string" && env.length > 0) return true
  const dav = process.env.DAVSTACK_NO_COLOR
  if (typeof dav === "string" && dav.length > 0) return true
  return false
}

export function useNoColor(): boolean {
  if (cached === null) cached = compute()
  return cached
}

// Test-only escape hatch — the cache lives at module scope so tests that
// toggle env need to reset it.
export function __resetNoColorCacheForTests(): void {
  cached = null
}

// Helper for the common "maybe-color" pattern in components.
export function colorOrUndef(value: string | undefined, noColor: boolean): string | undefined {
  return noColor ? undefined : value
}
