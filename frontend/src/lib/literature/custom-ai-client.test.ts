import { describe, expect, it } from 'vitest'
import { CustomAIClient } from './custom-ai-client'

// sanitizeResponse is private; cast the client to access it for tests.
function sanitize(text: string): string {
  return (new CustomAIClient() as unknown as {
    sanitizeResponse(text: string): string
  }).sanitizeResponse(text)
}

describe('CustomAIClient.sanitizeResponse', () => {
  it('strips ```json ... ``` fences', () => {
    const cleaned = sanitize('```json\n{"a": 1}\n```')
    expect(cleaned).toBe('{"a": 1}')
  })

  it('returns the first valid JSON object found inside a larger string', () => {
    const cleaned = sanitize('Here you go:\n{"a": 1, "b": [1, 2]}\nAnything else.')
    expect(JSON.parse(cleaned)).toEqual({ a: 1, b: [1, 2] })
  })

  it('falls back to the original text when no valid JSON is found', () => {
    const cleaned = sanitize('No JSON here, just prose with a { stray brace.')
    expect(cleaned).toBe('No JSON here, just prose with a { stray brace.')
  })

  it('caps candidate attempts at 20 and finishes quickly on pathological input', () => {
    // 200 unmatched `{}` — a naive implementation would try each one.
    const pathological = Array.from({ length: 200 }, () => '{}').join(',')
    const t0 = Date.now()
    const cleaned = sanitize(pathological)
    const elapsed = Date.now() - t0
    // Should bail in < 200ms; the actual cap means it never even tries the
    // 21st candidate.
    expect(elapsed).toBeLessThan(200)
    expect(cleaned).toBe(pathological) // no valid JSON → returns input
  })
})
