import { describe, expect, it } from 'vitest'
import {
  isReadingStatus,
  safeReadingStatus,
  clampImportance,
  READING_STATUSES,
} from './type-guards'

describe('isReadingStatus / safeReadingStatus', () => {
  it('accepts the four canonical values', () => {
    for (const s of READING_STATUSES) {
      expect(isReadingStatus(s)).toBe(true)
      expect(safeReadingStatus(s)).toBe(s)
    }
  })

  it('rejects unknown strings', () => {
    expect(isReadingStatus('finished')).toBe(false)
    expect(isReadingStatus('')).toBe(false)
    expect(isReadingStatus(null)).toBe(false)
    expect(isReadingStatus(undefined)).toBe(false)
    expect(isReadingStatus(42)).toBe(false)
  })

  it('safeReadingStatus falls back to "unread" for invalid input', () => {
    expect(safeReadingStatus('finished')).toBe('unread')
    expect(safeReadingStatus(null)).toBe('unread')
    expect(safeReadingStatus(undefined)).toBe('unread')
  })
})

describe('clampImportance', () => {
  it('passes through 0..5 integers', () => {
    for (let i = 0; i <= 5; i++) {
      expect(clampImportance(i)).toBe(i as 0 | 1 | 2 | 3 | 4 | 5)
    }
  })

  it('clamps out-of-range numbers', () => {
    expect(clampImportance(7)).toBe(5)
    expect(clampImportance(-2)).toBe(0)
    expect(clampImportance(99)).toBe(5)
  })

  it('rounds fractional values', () => {
    expect(clampImportance(2.4)).toBe(2)
    expect(clampImportance(2.6)).toBe(3)
  })

  it('returns 0 for non-numeric input', () => {
    expect(clampImportance(null)).toBe(0)
    expect(clampImportance(undefined)).toBe(0)
    expect(clampImportance('three')).toBe(0)
    expect(clampImportance(NaN)).toBe(0)
  })
})
