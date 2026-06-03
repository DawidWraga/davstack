// Tiny human-duration parser for retention/cadence config ("10m", "24h",
// "90s", "1d") → milliseconds. Deliberately strict: a single integer + a
// single unit suffix, nothing else. Garbage throws so a typo in config
// surfaces loudly instead of silently meaning "0ms" (which would hammer
// the auto-clean timer or pick an absurd window).

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export interface ParseDurationOpts {
  value: string;
}

/**
 * Parse a human duration string into milliseconds.
 *
 * @example
 * parseDuration('10m') // 600000
 * parseDuration('24h') // 86400000
 */
export function parseDuration(value: string): number {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  const m = /^(\d+)([smhd])$/.exec(trimmed);
  if (!m) {
    throw new Error(
      `Invalid duration "${value}". Expected <integer><unit> where unit is s|m|h|d (e.g. "10m", "24h").`,
    );
  }
  const n = Number(m[1]);
  return n * UNIT_MS[m[2]];
}
