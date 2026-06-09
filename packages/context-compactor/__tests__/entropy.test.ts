import { describe, expect, test } from 'vitest'
import { isHighEntropy, normalizedEntropy } from '../src/entropy.js'

describe('normalizedEntropy', () => {
  test('uniform repetition has ~zero entropy', () => {
    expect(normalizedEntropy('aaaaaaaa')).toBe(0)
  })

  test('empty string is zero', () => {
    expect(normalizedEntropy('')).toBe(0)
  })

  test('a uuid scores higher than an english word', () => {
    const uuid = '8f14e45f-ceea-4123-8f14-e45fceea4123'
    expect(normalizedEntropy(uuid)).toBeGreaterThan(normalizedEntropy('success'))
  })
})

describe('isHighEntropy', () => {
  test('preserves a uuid', () => {
    expect(isHighEntropy('8f14e45f-ceea-4123-8f14-e45fceea4123')).toBe(true)
  })

  test('does not flag a short common word', () => {
    expect(isHighEntropy('hello')).toBe(false)
  })

  test('does not flag a long string dominated by one character', () => {
    // Normalized entropy measures alphabet-evenness, not word repetition: a
    // skewed distribution (mostly 'a') scores low and is not preserved.
    expect(isHighEntropy('aaaaaaaaaaaaaaaaaaaab')).toBe(false)
  })
})
