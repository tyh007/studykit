import { afterEach, describe, expect, it } from 'vitest';
import { __resetFeatureFlagsForTests, __setFeatureFlagForTests } from '../feature-flags';
import { makeAppLocation, type AppLocation } from '../../domain/workspace';
import {
  decodeOpenParam,
  editorInputForLocation,
  encodeOpenParam,
  isWorkbenchLocation,
  workbenchLocation,
} from './workbenchRoutes';
import { decodeLocationFromHash, encodeLocationToHash } from './locationStore';

const P = 'proj-1';
const container = { workspaceId: null, mode: 'research' as const, kind: 'project' as const, id: P };

function loc(
  surface: AppLocation['surface'],
  extra: { surfaceId?: string; params?: Record<string, string> } = {},
): AppLocation {
  return makeAppLocation({ mode: 'research', surface, container, ...extra });
}

afterEach(() => __resetFeatureFlagsForTests());

describe('workbench routes: open param', () => {
  it('encodes and decodes kind:id, keeping colons in ids', () => {
    const input = { kind: 'work', id: 'doi:10.1/x' };
    expect(encodeOpenParam(input)).toBe('work:doi:10.1/x');
    expect(decodeOpenParam('work:doi:10.1/x')).toEqual(input);
  });

  it('rejects empty, malformed and unknown kinds', () => {
    expect(decodeOpenParam(undefined)).toBeNull();
    expect(decodeOpenParam('work')).toBeNull();
    expect(decodeOpenParam(':id')).toBeNull();
    expect(decodeOpenParam('work:')).toBeNull();
    expect(decodeOpenParam('mystery:1')).toBeNull();
  });

  it('survives the hash round-trip', () => {
    const location = workbenchLocation(P, { kind: 'work', id: 'doi:10.1/x' });
    const decoded = decodeLocationFromHash(encodeLocationToHash(location));
    expect(decoded?.surface).toBe('workbench');
    expect(editorInputForLocation(decoded!)).toEqual({ kind: 'work', id: 'doi:10.1/x' });
  });
});

describe('workbench routes: legacy links', () => {
  it.each([
    ['project', {}, null],
    ['project', { params: { details: '1' } }, { kind: 'overview', id: P, params: { details: '1' } }],
    ['library', {}, { kind: 'library', id: P }],
    ['library', { params: { add: '1' } }, { kind: 'library', id: P, params: { add: '1' } }],
    ['library', { params: { view: 'search' } }, { kind: 'search', id: P }],
    ['reader', { surfaceId: 'w-1' }, { kind: 'work', id: 'w-1' }],
    ['reader', { params: { view: 'discovery' } }, { kind: 'search', id: P }],
    ['evidence', { params: { claim: 'c-1' } }, { kind: 'evidence', id: P }],
    ['output', { surfaceId: 'o-1' }, { kind: 'output', id: 'o-1' }],
    ['design', { params: { question: 'q-1' } }, { kind: 'design', id: P, params: { question: 'q-1' } }],
    ['task-detail', { surfaceId: 't-1' }, { kind: 'task', id: 't-1' }],
    ['cognitive-canvas', {}, { kind: 'canvas', id: `canvas-${P}` }],
    [
      'cognitive-canvas',
      { surfaceId: 'v-1', params: { evidence: 'e-1', claim: 'c-1' } },
      { kind: 'canvas', id: 'v-1', params: { evidence: 'e-1', claim: 'c-1' } },
    ],
  ] as const)('%s %j → %j', (surface, extra, expected) => {
    expect(editorInputForLocation(loc(surface, extra as never))).toEqual(expected);
  });
});

describe('workbench routes: flag gating', () => {
  it('is off unless both v05Workbench and v04Research are on', () => {
    expect(isWorkbenchLocation(loc('library'))).toBe(false);
    __setFeatureFlagForTests('v05Workbench', true);
    expect(isWorkbenchLocation(loc('library'))).toBe(false);
    __setFeatureFlagForTests('v04Research', true);
    expect(isWorkbenchLocation(loc('library'))).toBe(true);
  });

  it('never takes over Research home or Study', () => {
    __setFeatureFlagForTests('v05Workbench', true);
    __setFeatureFlagForTests('v04Research', true);
    expect(isWorkbenchLocation(makeAppLocation({ mode: 'research', surface: 'research-home' }))).toBe(false);
    expect(isWorkbenchLocation(makeAppLocation({ mode: 'study', surface: 'study-home' }))).toBe(false);
  });
});
