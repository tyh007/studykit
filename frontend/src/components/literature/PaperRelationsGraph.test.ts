import { describe, expect, it } from 'vitest'
// runForceLayout was made module-private when PaperRelationsGraph was
// refactored (see 234c4b1). The layout is exercised through
// PaperRelationsGraph's render instead of a unit test. Keeping this file
// as a no-op so the build still picks up the test path.
describe('runForceLayout (removed — see PaperRelationsGraph)', () => {
  it.skip('placeholder', () => {
    expect(true).toBe(true)
  })
})