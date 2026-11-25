/**
 * Type guards for the optional `reading_status` and `importance` fields on
 * `LiteraturePaper`. The backend may return these as undefined, null, or
 * strings that don't match the expected union — these guards normalize
 * them at the boundary so downstream code can rely on a tight type.
 */

export const READING_STATUSES = ['unread', 'reading', 'read', 'reviewed'] as const
export type ReadingStatus = (typeof READING_STATUSES)[number]

export function isReadingStatus(value: unknown): value is ReadingStatus {
  return (
    typeof value === 'string' &&
    (READING_STATUSES as readonly string[]).includes(value)
  )
}

export function safeReadingStatus(value: unknown): ReadingStatus {
  return isReadingStatus(value) ? value : 'unread'
}

export type Importance = 0 | 1 | 2 | 3 | 4 | 5

/**
 * Coerce an unknown value to a 0-5 integer importance rating. Out-of-range
 * or non-numeric values are clamped to 0.
 */
export function clampImportance(value: unknown): Importance {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0
  const rounded = Math.round(value)
  if (rounded <= 0) return 0
  if (rounded >= 5) return 5
  return rounded as Importance
}
