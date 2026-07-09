import { describe, expect, it } from 'vitest';
import { parseAIContent } from './ai-response';

describe('parseAIContent', () => {
  it('returns the input unchanged when there is no thinking block', () => {
    const text = 'Just a plain answer without any reasoning markers.';
    expect(parseAIContent(text)).toEqual({ thinking: null, response: text });
  });

  it('splits "Here\'s a thinking process:" + numbered list from the answer', () => {
    const text = [
      "Here's a thinking process:",
      '1. First step the model thought about.',
      '2. Second step that the model considered.',
      '',
      'Final answer for the user.',
    ].join('\n');
    const parsed = parseAIContent(text);
    expect(parsed.thinking).toContain('1. First step');
    expect(parsed.thinking).toContain('2. Second step');
    expect(parsed.response).toBe('Final answer for the user.');
  });

  it('extracts <think>...</think> tags into the thinking block', () => {
    const text = '<think>The user wants me to summarize.\nStep 1: read the paper.\nStep 2: write a note.</think># Title\n\nFinal answer body.';
    const parsed = parseAIContent(text);
    expect(parsed.thinking).toContain('Step 1: read the paper');
    expect(parsed.thinking).toContain('Step 2: write a note');
    expect(parsed.response).not.toContain('<think>');
    expect(parsed.response).toContain('# Title');
    expect(parsed.response).toContain('Final answer body.');
  });

  it('handles case-insensitive <think> tags', () => {
    const text = '<Think>reasoning here</THINK>actual response';
    const parsed = parseAIContent(text);
    expect(parsed.thinking).toBe('reasoning here');
    expect(parsed.response).toBe('actual response');
  });

  it('returns null thinking when <think> tags are empty', () => {
    const text = '<think>  </think>body only';
    expect(parseAIContent(text)).toEqual({ thinking: null, response: text });
  });

  it('handles empty input', () => {
    expect(parseAIContent('')).toEqual({ thinking: null, response: '' });
  });
});