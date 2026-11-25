import { describe, expect, it } from 'vitest';

import {
  INVOCATION_SURFACES,
  packetIsCloudEligible,
  resolveContext,
  type ContextResolverInput,
} from './contextResolver';
import { makeContainerRef, makeLocation } from '../../../domain/__fixtures__/domain-fixtures';

function baseInput(overrides: Partial<ContextResolverInput> = {}): ContextResolverInput {
  return {
    route: '/study/course/c-1/lecture',
    location: makeLocation({ mode: 'study', surface: 'study-home' }),
    workspaceFlavour: 'sync',
    invocationSurface: 'intent-capsule',
    ...overrides,
  };
}

describe('ContextResolver', () => {
  it('exposes the documented invocation surfaces', () => {
    expect([...INVOCATION_SURFACES].sort()).toEqual([
      'desktop-quick-access',
      'intent-capsule',
      'object',
      'selection',
      'transition',
      'workspace',
    ]);
  });

  it('selection takes precedence over current view and container', () => {
    const packet = resolveContext(
      baseInput({
        location: makeLocation({
          mode: 'study',
          surface: 'course',
          container: makeContainerRef({ mode: 'study', kind: 'course', id: 'course-x' }),
        }),
        focus: { objectId: 'note-9', kind: 'note' },
        selectedText: 'a small passage',
        selectedObjects: [{ id: 'obj-1', kind: 'text', preview: 'p' }],
      }),
    );
    expect(packet.scopePolicy).toBe('selection');
    expect(packet.selectedObjectIds).toEqual(['obj-1']);
    expect(packet.focus?.objectId).toBe('note-9');
  });

  it('never widens across containers automatically', () => {
    const courseContainer = makeContainerRef({ mode: 'study', kind: 'course', id: 'course-1' });
    const projectContainer = makeContainerRef({ mode: 'research', kind: 'project', id: 'project-1' });
    const packet = resolveContext(
      baseInput({
        // Caller passed a project override while location is on a course.
        containerOverride: projectContainer,
        location: makeLocation({
          mode: 'study',
          surface: 'course',
          container: courseContainer,
        }),
        selectedObjects: [{ id: 'obj-1', kind: 'text' }],
      }),
    );
    // The override wins (caller knew better); selection wins over both.
    expect(packet.scopePolicy).toBe('selection');
    expect(packet.container?.id).toBe('project-1');
    expect(packet.container?.mode).toBe('research');
  });

  it('falls back to current-view when focus is set without selection', () => {
    const packet = resolveContext(
      baseInput({
        focus: { objectId: 'n-1', kind: 'note' },
      }),
    );
    expect(packet.scopePolicy).toBe('current-view');
  });

  it('falls back to explicit-set when pinned items are present', () => {
    const packet = resolveContext(
      baseInput({
        pinnedContext: [{ id: 'pin-1', kind: 'paper', label: 'Smith 2024' }],
      }),
    );
    expect(packet.scopePolicy).toBe('explicit-set');
    expect(packet.pinnedContextIds).toEqual(['pin-1']);
  });

  it('falls back to container when nothing is selected or pinned', () => {
    const packet = resolveContext(
      baseInput({
        location: makeLocation({
          mode: 'study',
          surface: 'course',
          container: makeContainerRef({ mode: 'study', kind: 'course', id: 'course-7' }),
        }),
      }),
    );
    expect(packet.scopePolicy).toBe('container');
    expect(packet.container?.id).toBe('course-7');
  });

  it('local flavour picks provider=none', () => {
    const packet = resolveContext(baseInput({ workspaceFlavour: 'local' }));
    expect(packet.provider).toBe('none');
    expect(packet.visibility).toBe('private');
  });

  it('sync flavour on a research project picks provider=unknown + visibility=project', () => {
    const packet = resolveContext(
      baseInput({
        workspaceFlavour: 'sync',
        location: makeLocation({
          mode: 'research',
          surface: 'project',
          container: makeContainerRef({ mode: 'research', kind: 'project', id: 'project-1' }),
        }),
      }),
    );
    expect(packet.provider).toBe('unknown');
    expect(packet.visibility).toBe('project');
  });

  it('caps the selection preview at four entries', () => {
    const packet = resolveContext(
      baseInput({
        selectedObjects: Array.from({ length: 7 }, (_, i) => ({
          id: `o-${i}`,
          kind: 'text' as const,
          preview: `p-${i}`,
        })),
      }),
    );
    expect(packet.selectionPreview).toHaveLength(4);
    expect(packet.selectionPreview[0]).toEqual({ id: 'o-0', label: 'p-0' });
  });

  it('snapshot hash is stable for identical inputs and different for any change', () => {
    const input = baseInput({
      selectedText: 'hello',
      selectedObjects: [{ id: 'a', kind: 'text' }],
    });
    const a = resolveContext(input);
    const b = resolveContext(input);
    expect(a.snapshotHash).toBe(b.snapshotHash);
    const c = resolveContext(baseInput({ selectedText: 'hello there' }));
    expect(c.snapshotHash).not.toBe(a.snapshotHash);
  });

  it('packetIsCloudEligible is true only for project visibility on a research container in sync', () => {
    const projectPacket = resolveContext(
      baseInput({
        workspaceFlavour: 'sync',
        visibility: 'project',
        location: makeLocation({
          mode: 'research',
          surface: 'project',
          container: makeContainerRef({ mode: 'research', kind: 'project', id: 'project-1' }),
        }),
      }),
    );
    expect(packetIsCloudEligible(projectPacket)).toBe(true);
    const privatePacket = resolveContext(baseInput({ visibility: 'private' }));
    expect(packetIsCloudEligible(privatePacket)).toBe(false);
  });

  describe('userScope (ScopeEditor choice)', () => {
    it('respects the user choice verbatim when the underlying state is present', () => {
      const packet = resolveContext(
        baseInput({
          userScope: 'container',
          selectedText: 'hello',
          selectedObjects: [{ id: 'o-1', kind: 'text' }],
        }),
      );
      expect(packet.scopePolicy).toBe('container');
    });

    it('demotes `selection` to `current-view` when the selection is empty', () => {
      const packet = resolveContext(
        baseInput({
          userScope: 'selection',
          // No selection text, no selected objects.
          focus: { objectId: 'n-1', kind: 'note' },
        }),
      );
      expect(packet.scopePolicy).toBe('current-view');
    });

    it('demotes `selection` to `container` when the selection is empty and no focus', () => {
      const packet = resolveContext(
        baseInput({
          userScope: 'selection',
          location: makeLocation({
            mode: 'study',
            surface: 'course',
            container: makeContainerRef({ mode: 'study', kind: 'course', id: 'c-1' }),
          }),
        }),
      );
      expect(packet.scopePolicy).toBe('container');
    });

    it('demotes `explicit-set` to `current-view` when no pinned items', () => {
      const packet = resolveContext(
        baseInput({
          userScope: 'explicit-set',
          focus: { objectId: 'n-1', kind: 'note' },
        }),
      );
      expect(packet.scopePolicy).toBe('current-view');
    });

    it('keeps `current-view` and `container` as-is even if the user picked them', () => {
      const a = resolveContext(baseInput({ userScope: 'current-view' }));
      expect(a.scopePolicy).toBe('current-view');
      const b = resolveContext(
        baseInput({
          userScope: 'container',
          location: makeLocation({
            mode: 'study',
            surface: 'course',
            container: makeContainerRef({ mode: 'study', kind: 'course', id: 'c-1' }),
          }),
        }),
      );
      expect(b.scopePolicy).toBe('container');
    });

    it('snapshot hash changes when userScope changes (provenance agrees with packet)', () => {
      // Both inputs have a real selection so neither
      // scope gets demoted. The hash must differ
      // because `scopePolicy` participates in the
      // snapshot.
      const a = resolveContext(
        baseInput({
          userScope: 'selection',
          selectedText: 'hello',
        }),
      );
      const b = resolveContext(
        baseInput({
          userScope: 'current-view',
          selectedText: 'hello',
        }),
      );
      expect(a.scopePolicy).toBe('selection');
      expect(b.scopePolicy).toBe('current-view');
      expect(a.snapshotHash).not.toBe(b.snapshotHash);
    });
  });
});

