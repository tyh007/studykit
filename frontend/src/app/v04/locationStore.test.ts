import { describe, expect, it } from 'vitest';
import { makeAppLocation } from '../../domain/workspace';
import { decodeLocationFromHash, encodeLocationToHash } from './locationStore';

describe('locationStore hash codec', () => {
  it('round-trips surface id and params so navigation has one durable truth', () => {
    const location = makeAppLocation({
      mode: 'research',
      surface: 'reader',
      container: {
        workspaceId: null,
        mode: 'research',
        kind: 'project',
        id: 'project 1',
      },
      surfaceId: 'work/1',
      params: { view: 'discovery', query: 'sleep & memory' },
    });

    const encoded = encodeLocationToHash(location);
    expect(encoded).toContain('__sid=work%2F1');
    expect(encoded).toContain('view=discovery');
    expect(decodeLocationFromHash(encoded)).toEqual(location);
  });

  it('keeps existing simple hashes compact', () => {
    const location = makeAppLocation({ mode: 'study', surface: 'study-home' });
    expect(encodeLocationToHash(location)).toBe('#/study/study-home');
  });
});
