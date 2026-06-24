import { describe, expect, it } from 'vitest'
import { parseAIContent } from './AIChatPanel'

describe('parseAIContent', () => {
  it('returns { thinking: null, response: text } when marker is missing', () => {
    const out = parseAIContent('Just an answer, no thinking.')
    expect(out).toEqual({ thinking: null, response: 'Just an answer, no thinking.' })
  })

  it('does NOT split when the marker is mid-sentence', () => {
    const text = "Sure, here's a thinking process: let me think about it more."
    const out = parseAIContent(text)
    // Mid-sentence marker is NOT a real chain-of-thought header — must not split.
    expect(out).toEqual({ thinking: null, response: text })
  })

  it('parses a real "Here\'s a thinking process:" + numbered list correctly', () => {
    const text = [
      "Here's a thinking process:",
      '1. Consider the question.',
      '2. Look up the references.',
      '3. Compose the final answer.',
      'The answer is 42.',
    ].join('\n')
    const out = parseAIContent(text)
    expect(out.thinking).toContain("Here's a thinking process:")
    expect(out.thinking).toContain('3. Compose')
    expect(out.response).toBe('The answer is 42.')
  })

  it('returns the original text when marker is on its own line but no numbered steps follow', () => {
    const text = [
      "Here's a thinking process:",
      'I just answer the question directly.',
    ].join('\n')
    const out = parseAIContent(text)
    expect(out).toEqual({ thinking: null, response: text })
  })

  it('handles a single numbered step', () => {
    const text = [
      "Here's a thinking process:",
      '1. One step.',
      'The answer.',
    ].join('\n')
    const out = parseAIContent(text)
    expect(out.thinking).toContain('1. One step.')
    expect(out.response).toBe('The answer.')
  })

  it('handles leading whitespace before the numbered list', () => {
    const text = [
      "Here's a thinking process:",
      '   1. Step one.',
      '   2. Step two.',
      'Done.',
    ].join('\n')
    const out = parseAIContent(text)
    expect(out.thinking).toContain('Step two.')
    expect(out.response).toBe('Done.')
  })
})
