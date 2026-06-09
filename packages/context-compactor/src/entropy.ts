/**
 * Shannon-entropy signal for preservation decisions.
 *
 * High-entropy tokens (UUIDs, hashes, random ids) are information-dense, often
 * identifiers, and easily mangled by naive compression — so handlers preserve
 * them. Ported from headroom's masks.EntropyScore.
 */

/** Normalized character entropy in [0, 1] (Shannon entropy / log2(alphabet size)). */
export function normalizedEntropy(text: string): number {
  if (!text) return 0
  const counts = new Map<string, number>()
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  const total = text.length
  let entropy = 0
  for (const count of counts.values()) {
    const p = count / total
    entropy -= p * Math.log2(p)
  }
  const distinct = counts.size
  const max = distinct > 1 ? Math.log2(distinct) : 1
  return max > 0 ? entropy / max : 0
}

/**
 * True for tokens worth preserving verbatim: long enough to matter and above the
 * entropy threshold. Short tokens rarely carry meaningful entropy.
 */
export function isHighEntropy(text: string, threshold = 0.85, minLength = 8): boolean {
  if (text.length < minLength) return false
  return normalizedEntropy(text) >= threshold
}
