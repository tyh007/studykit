import { describe, expect, it } from 'vitest';

import {
  CONTAINER_SCOPED_SURFACES,
  CROSS_MODE_SURFACES,
  SURFACES_BY_MODE,
  WORKSPACE_MODES,
  courseContainer,
  isAppLocation,
  isContainerRef,
  isSurfaceCompatibleWithMode,
  isSurfaceKind,
  isWorkspaceMode,
  makeAppLocation,
  projectContainer,
  sameAppLocation,
} from './workspace';
import {
  makeContainerRef,
  makeLocation,
  makeProjectContainer,
} from './__fixtures__/domain-fixtures';

describe('workspace domain contract', () => {
  describe('WorkspaceMode', () => {
    it('exposes exactly the two modes from the decision log (D-001)', () => {
      expect([...WORKSPACE_MODES].sort()).toEqual(['research', 'study']);
    });

    it('type guard accepts only study / research', () => {
      expect(isWorkspaceMode('study')).toBe(true);
      expect(isWorkspaceMode('research')).toBe(true);
      expect(isWorkspaceMode('review')).toBe(false);
      expect(isWorkspaceMode('')).toBe(false);
      expect(isWorkspaceMode(null)).toBe(false);
      expect(isWorkspaceMode(undefined)).toBe(false);
      expect(isWorkspaceMode(42)).toBe(false);
    });
  });

  describe('ContainerRef', () => {
    it('courseContainer builds a study-mode ref', () => {
      const ref = courseContainer(null, 'c-1');
      expect(ref).toEqual({
        workspaceId: null,
        mode: 'study',
        kind: 'course',
        id: 'c-1',
      });
    });

    it('projectContainer builds a research-mode ref', () => {
      const ref = projectContainer('ws-2', 'p-1');
      expect(ref).toEqual({
        workspaceId: 'ws-2',
        mode: 'research',
        kind: 'project',
        id: 'p-1',
      });
    });

    it('isContainerRef accepts a valid ref and rejects garbage', () => {
      expect(isContainerRef(makeContainerRef())).toBe(true);
      expect(isContainerRef(makeProjectContainer())).toBe(true);
      expect(isContainerRef(null)).toBe(false);
      expect(isContainerRef({})).toBe(false);
      expect(isContainerRef({ mode: 'study', kind: 'course', id: 'x' })).toBe(false); // no workspaceId
      expect(
        isContainerRef({ workspaceId: 'w', mode: 'study', kind: 'mystery', id: 'x' }),
      ).toBe(false);
    });

    it('isContainerRef rejects mode/kind mismatches (study cannot hold a project, research cannot hold a course)', () => {
      // study mode cannot hold a project ref
      expect(
        isContainerRef({ workspaceId: 'w', mode: 'study', kind: 'project', id: 'p' }),
      ).toBe(false);
      // research mode cannot hold a course ref
      expect(
        isContainerRef({ workspaceId: 'w', mode: 'research', kind: 'course', id: 'c' }),
      ).toBe(false);
      // factories are the only legitimate constructors; raw objects with
      // matching mode/kind are accepted, mismatching ones are not.
      expect(
        isContainerRef({ workspaceId: 'w', mode: 'study', kind: 'course', id: 'c' }),
      ).toBe(true);
      expect(
        isContainerRef({ workspaceId: 'w', mode: 'research', kind: 'project', id: 'p' }),
      ).toBe(true);
    });
  });

  describe('SurfaceKind', () => {
    it('isSurfaceKind accepts every declared surface', () => {
      for (const surface of [
        'home',
        'study-home',
        'course',
        'lecture',
        'study-canvas',
        'review',
        'research-home',
        'project',
        'library',
        'reader',
        'evidence',
        'research-canvas',
        'cognitive-canvas',
        'output',
        'search',
        'settings',
      ]) {
        expect(isSurfaceKind(surface)).toBe(true);
      }
    });

    it('isSurfaceKind rejects unknown values', () => {
      expect(isSurfaceKind('mystery')).toBe(false);
      expect(isSurfaceKind(0)).toBe(false);
      expect(isSurfaceKind(undefined)).toBe(false);
    });

    it('every container-scoped surface belongs to exactly one mode', () => {
      for (const surface of CONTAINER_SCOPED_SURFACES) {
        const inStudy = SURFACES_BY_MODE.study.has(surface);
        const inResearch = SURFACES_BY_MODE.research.has(surface);
        expect(inStudy !== inResearch).toBe(true);
      }
    });

    it('CROSS_MODE_SURFACES is exactly {home, reader, search, settings}', () => {
      expect([...CROSS_MODE_SURFACES].sort()).toEqual(['home', 'reader', 'search', 'settings']);
    });

    it('mode-specific non-cross-mode surfaces are NOT cross-mode (study-home/review/research-home)', () => {
      // study-only
      expect(isSurfaceCompatibleWithMode('study-home', 'study')).toBe(true);
      expect(isSurfaceCompatibleWithMode('study-home', 'research')).toBe(false);
      expect(isSurfaceCompatibleWithMode('review', 'study')).toBe(true);
      expect(isSurfaceCompatibleWithMode('review', 'research')).toBe(false);
      // research-only
      expect(isSurfaceCompatibleWithMode('research-home', 'research')).toBe(true);
      expect(isSurfaceCompatibleWithMode('research-home', 'study')).toBe(false);
    });

    it('cross-mode surfaces are compatible with BOTH modes (only home/reader/search/settings)', () => {
      for (const surface of CROSS_MODE_SURFACES) {
        expect(isSurfaceCompatibleWithMode(surface, 'study')).toBe(true);
        expect(isSurfaceCompatibleWithMode(surface, 'research')).toBe(true);
      }
      // And every other surface kind is NOT cross-mode.
      const allSurfaces: readonly import('./workspace').SurfaceKind[] = [
        'home',
        'study-home',
        'course',
        'lecture',
        'study-canvas',
        'review',
        'research-home',
        'project',
        'library',
        'reader',
        'evidence',
        'research-canvas',
        'output',
        'search',
        'settings',
      ];
      for (const surface of allSurfaces) {
        if (CROSS_MODE_SURFACES.has(surface)) continue;
        // Non-cross-mode surfaces must reject the wrong mode.
        const inStudy = SURFACES_BY_MODE.study.has(surface);
        const inResearch = SURFACES_BY_MODE.research.has(surface);
        expect(isSurfaceCompatibleWithMode(surface, 'study')).toBe(inStudy);
        expect(isSurfaceCompatibleWithMode(surface, 'research')).toBe(inResearch);
        // In particular, a non-cross-mode surface can never be both.
        expect(inStudy && inResearch).toBe(false);
      }
    });
  });

  describe('AppLocation', () => {
    it('round-trips through JSON without loss', () => {
      const original = makeLocation({
        mode: 'research',
        surface: 'project',
        container: makeProjectContainer(),
        surfaceId: 'project-001',
        params: { tab: 'evidence' },
      });
      const restored = JSON.parse(JSON.stringify(original));
      expect(isAppLocation(restored)).toBe(true);
      expect(restored).toEqual(original);
    });

    it('makeAppLocation rejects container whose mode does not match', () => {
      expect(() =>
        makeAppLocation({
          mode: 'study',
          surface: 'course',
          container: makeProjectContainer(), // research container
        }),
      ).toThrow(/Container mode/);
    });

    it('makeAppLocation requires a container for container-scoped surfaces', () => {
      expect(() =>
        makeAppLocation({ mode: 'study', surface: 'lecture' }),
      ).toThrow(/requires a ContainerRef/);
    });

    it('makeAppLocation rejects mode-specific surfaces in the wrong mode', () => {
      // study-home is not a research surface
      expect(() => makeAppLocation({ mode: 'research', surface: 'study-home' })).toThrow(
        /not compatible with mode/,
      );
      // research-home is not a study surface
      expect(() => makeAppLocation({ mode: 'study', surface: 'research-home' })).toThrow(
        /not compatible with mode/,
      );
      // review is study-only
      expect(() => makeAppLocation({ mode: 'research', surface: 'review' })).toThrow(
        /not compatible with mode/,
      );
      // project is research-only
      expect(() =>
        makeAppLocation({
          mode: 'study',
          surface: 'project',
          container: makeContainerRef({ kind: 'project' }),
        }),
      ).toThrow(/not compatible with mode/);
    });

    it('makeAppLocation accepts cross-mode surfaces in either mode', () => {
      for (const surface of ['home', 'reader', 'search', 'settings'] as const) {
        expect(() => makeAppLocation({ mode: 'study', surface })).not.toThrow();
        expect(() => makeAppLocation({ mode: 'research', surface })).not.toThrow();
      }
    });

    it('isAppLocation rejects malformed payloads', () => {
      expect(isAppLocation(null)).toBe(false);
      expect(isAppLocation({})).toBe(false);
      expect(isAppLocation({ mode: 'study', surface: 'mystery' })).toBe(false);
      expect(
        isAppLocation({
          mode: 'study',
          surface: 'lecture',
          surfaceId: 42, // wrong type
        }),
      ).toBe(false);
    });

    it('isAppLocation rejects container-scoped surfaces without a container', () => {
      // Invariant 3
      expect(isAppLocation({ mode: 'study', surface: 'lecture' })).toBe(false);
      expect(isAppLocation({ mode: 'research', surface: 'project' })).toBe(false);
      expect(isAppLocation({ mode: 'study', surface: 'study-canvas' })).toBe(false);
    });

    it('isAppLocation rejects mode-specific surfaces paired with the wrong mode', () => {
      // Invariant 4
      expect(isAppLocation({ mode: 'research', surface: 'study-home' })).toBe(false);
      expect(isAppLocation({ mode: 'study', surface: 'research-home' })).toBe(false);
      expect(isAppLocation({ mode: 'research', surface: 'review' })).toBe(false);
    });

    it('isAppLocation rejects a container whose mode does not match the location mode', () => {
      // Invariant 5
      expect(
        isAppLocation({
          mode: 'study',
          surface: 'course',
          container: makeProjectContainer(), // mode=research
        }),
      ).toBe(false);
    });

    it('isAppLocation accepts cross-mode surfaces in either mode', () => {
      for (const surface of ['home', 'reader', 'search', 'settings'] as const) {
        expect(isAppLocation({ mode: 'study', surface })).toBe(true);
        expect(isAppLocation({ mode: 'research', surface })).toBe(true);
      }
    });

    it('isSurfaceCompatibleWithMode is true exactly for (cross-mode) ∪ (SURFACES_BY_MODE[mode])', () => {
      const allSurfaces: readonly import('./workspace').SurfaceKind[] = [
        'home',
        'study-home',
        'course',
        'lecture',
        'study-canvas',
        'review',
        'research-home',
        'project',
        'library',
        'reader',
        'evidence',
        'research-canvas',
        'output',
        'search',
        'settings',
      ];
      for (const surface of allSurfaces) {
        const expectedStudy = CROSS_MODE_SURFACES.has(surface) || SURFACES_BY_MODE.study.has(surface);
        const expectedResearch =
          CROSS_MODE_SURFACES.has(surface) || SURFACES_BY_MODE.research.has(surface);
        expect(isSurfaceCompatibleWithMode(surface, 'study')).toBe(expectedStudy);
        expect(isSurfaceCompatibleWithMode(surface, 'research')).toBe(expectedResearch);
      }
    });

    it('sameAppLocation is true for itself and equal copies, false for any difference', () => {
      const a = makeLocation({
        mode: 'study',
        surface: 'course',
        container: makeContainerRef({ id: 'c-1' }),
        surfaceId: 'c-1',
        params: { tab: 'notes' },
      });
      const b = JSON.parse(JSON.stringify(a));
      expect(sameAppLocation(a, b)).toBe(true);
      expect(sameAppLocation(a, a)).toBe(true);

      const differentMode = { ...a, mode: 'research' as const };
      expect(sameAppLocation(a, differentMode)).toBe(false);

      const differentSurface = { ...a, surface: 'lecture' as const };
      expect(sameAppLocation(a, differentSurface)).toBe(false);

      const differentSurfaceId = { ...a, surfaceId: 'other' };
      expect(sameAppLocation(a, differentSurfaceId)).toBe(false);

      const differentContainer = {
        ...a,
        container: makeContainerRef({ id: 'c-2' }),
      };
      expect(sameAppLocation(a, differentContainer)).toBe(false);

      const differentParams = { ...a, params: { tab: 'citations' } };
      expect(sameAppLocation(a, differentParams)).toBe(false);
    });
  });
});
