import { describe, expect, it } from 'vitest'
// parseAIContent was removed when AI extraction logic moved to the
// shared `useLiteratureAIExtraction` hook (see 234c4b1). This test was
// orphaned by that refactor. The unit tests for the extraction behaviour
// now live alongside the hook. Keeping this file as a no-op so the
// build still picks up the test path.
describe('parseAIContent (removed — see useLiteratureAIExtraction)', () => {
  it.skip('placeholder', () => {
    expect(true).toBe(true)
  })
})