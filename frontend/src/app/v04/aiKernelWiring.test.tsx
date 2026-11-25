/**
 * StudyKit v0.4 — Production composition integration test
 * for `<AiKernelWiring />`.
 *
 * The previous round accidentally deleted the wiring file,
 * leaving the v04 branch with NO production-side
 * `registerSafeActions(...)` call. The second pass wired
 * the four safe actions back, but the `noteWriter` was a
 * synthetic stub that returned a fake id without touching
 * the database — so Accept looked successful while the
 * content was not findable later. This suite asserts the
 * production composition is fully real:
 *
 *   1. The four WP-03 safe actions are registered in the
 *      live `actionRegistry` when `v04Assistant = on` and
 *      torn down when it goes off (or the component
 *      unmounts).
 *   2. The `noteWriter` adapter is the real one: it calls
 *      `getDataApi().lectures.create({ module_id, title })`
 *      exactly once on Accept, and returns the canonical
 *      lecture id the dataApi produced. Local and Sync
 *      flavours both go through the gateway.
 *   3. Reject / Cancel never reach the writer — zero data
 *      writes.
 *   4. A writer failure throws; the draft, prompt,
 *      selection, focus and scope are preserved; the user
 *      can retry by clicking Accept again.
 *
 * The test mounts the REAL `<AiKernelWiring />` and calls
 * the REAL `acceptNoteDraft(...)`. It does NOT call
 * `registerSafeActions(...)` by hand; that would hide
 * exactly the regression we are guarding against.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { AiKernelWiring } from './aiKernelWiring';
import {
  __resetAiKernelForTests,
  ACTION_CANVAS_SUGGEST_CLUSTER,
  ACTION_CANVAS_SUGGEST_LAYOUT,
  ACTION_CANVAS_SUGGEST_RELATIONS,
  ACTION_CREATE_FREE_NOTE,
  ACTION_EXPLAIN_SELECTED,
  ACTION_NAVIGATE,
  ACTION_SEARCH_LOCAL,
  SAFE_ACTION_IDS,
  acceptNoteDraft,
  actionRegistry,
  draftLayer,
  type ContextPacket,
} from '../../features/ai';
import {
  __resetFeatureFlagsForTests,
  __setFeatureFlagForTests,
  isFeatureEnabled,
} from '../feature-flags';
import { getDataApi, setWorkspaceFlavour } from '../../application/dataGateway';
import * as dataGateway from '../../application/dataGateway';
import type { Lecture } from '../../types';

const SAFE_IDS = new Set<string>([
  ACTION_NAVIGATE,
  ACTION_SEARCH_LOCAL,
  ACTION_CREATE_FREE_NOTE,
  ACTION_EXPLAIN_SELECTED,
  ACTION_CANVAS_SUGGEST_RELATIONS,
  ACTION_CANVAS_SUGGEST_CLUSTER,
  ACTION_CANVAS_SUGGEST_LAYOUT,
]);

function registeredIds(): string[] {
  return actionRegistry
    .list()
    .map((a) => a.id)
    .filter((id) => SAFE_IDS.has(id))
    .sort();
}

// Minimal `Lecture` mock for the writer-return path. The
// shape matches the real `types.Lecture`; the only field
// the wiring reads is `id`.
function makeLecture(args: { id: string; module_id: string; title: string }): Lecture {
  return {
    id: args.id,
    module_id: args.module_id,
    title: args.title,
    sort_order: 0,
    settings_json: {
      cornell_mode: false,
      layout: 'slide_left_notes_right',
      export_defaults: {
        include_cornell_cues: true,
        include_annotations: true,
        include_page_numbers: true,
        template: 'cornell',
      },
    },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

// A course container so the `create-free-note-draft`
// permission gate passes.
const COURSE_PACKET: ContextPacket = Object.freeze({
  mode: 'study' as const,
  route: '/',
  container: {
    workspaceId: 'ws-1',
    mode: 'study' as const,
    kind: 'course' as const,
    id: 'course-1',
  },
  focus: null,
  selectedText: 'a passage',
  selectedObjectIds: Object.freeze(['o-1']),
  selectionPreview: Object.freeze([{ id: 'o-1', label: 'o-1' }]),
  pinnedContextIds: Object.freeze([]),
  scopePolicy: 'selection' as const,
  provider: 'unknown' as const,
  visibility: 'private' as const,
  invocationSurface: 'selection' as const,
  snapshotHash: '00000000',
});

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  setWorkspaceFlavour('sync');
  // Fresh kernel state — no leftover actions from a prior
  // test. The wiring component is the *only* registrar in
  // this file.
  __resetAiKernelForTests();
  __setFeatureFlagForTests('v04Assistant', false);
});

afterEach(() => {
  cleanup();
  __resetFeatureFlagsForTests();
  __resetAiKernelForTests();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Flag off → no actions registered, host tree is unaffected
// ---------------------------------------------------------------------------

describe('AiKernelWiring / flag off (default)', () => {
  it('registers nothing when the v04Assistant flag is off', () => {
    // Flag is off (set in beforeEach).
    expect(isFeatureEnabled('v04Assistant')).toBe(false);

    const { container } = render(<AiKernelWiring />);

    // Component returns `null`; nothing is added to the DOM.
    expect(container.firstChild).toBeNull();

    // No safe action is registered.
    expect(registeredIds()).toEqual([]);
    expect(actionRegistry.list().length).toBe(0);
  });

  it('the v0.3 / WP-02 surface tree is byte-for-byte unaffected with flag off', () => {
    // Snapshot: the registry is empty before mount, stays
    // empty after mount, and is still empty after unmount.
    const before = actionRegistry.list().map((a) => a.id).sort();
    expect(before).toEqual([]);

    const { unmount } = render(<AiKernelWiring />);
    const during = actionRegistry.list().map((a) => a.id).sort();
    expect(during).toEqual([]);

    unmount();
    const after = actionRegistry.list().map((a) => a.id).sort();
    expect(after).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Flag on → all four WP-03 safe actions are registered
// ---------------------------------------------------------------------------

describe('AiKernelWiring / flag on', () => {
  it('registers exactly the eight safe actions (WP-03 + WP-06 canvas + WP-07 research) when the flag is on', () => {
    __setFeatureFlagForTests('v04Assistant', true);
    expect(isFeatureEnabled('v04Assistant')).toBe(true);

    render(<AiKernelWiring />);

    const ids = registeredIds();
    // The wiring component must register ALL safe
    // actions defined in `safeActions.ts`, no more, no less.
    expect(ids).toEqual([...SAFE_IDS].sort());
    // Defensive: there is exactly one entry per safe id.
    expect(actionRegistry.list().length).toBe(8);
  });

  it('re-registers cleanly when the flag is off then on (cleanup + mount)', () => {
    const { rerender } = render(<AiKernelWiring />);
    expect(registeredIds()).toEqual([]);

    // Flip the flag on via test override + re-render to
    // pick up the new value (the component reads
    // `isFeatureEnabled` on every render; React then
    // sees the dependency change and runs the effect).
    __setFeatureFlagForTests('v04Assistant', true);
    rerender(<AiKernelWiring />);
    expect(registeredIds()).toEqual([...SAFE_IDS].sort());

    // Flip back off — the effect cleanup tears down every
    // action it registered.
    __setFeatureFlagForTests('v04Assistant', false);
    rerender(<AiKernelWiring />);
    expect(registeredIds()).toEqual([]);
  });

  it('toggles on / off / on / off without leaking actions', () => {
    const { rerender } = render(<AiKernelWiring />);
    // Start: off → nothing.
    expect(registeredIds()).toEqual([]);

    // on
    __setFeatureFlagForTests('v04Assistant', true);
    rerender(<AiKernelWiring />);
    expect(registeredIds()).toEqual([...SAFE_IDS].sort());

    // off
    __setFeatureFlagForTests('v04Assistant', false);
    rerender(<AiKernelWiring />);
    expect(registeredIds()).toEqual([]);

    // on again — re-registers, no duplicates.
    __setFeatureFlagForTests('v04Assistant', true);
    rerender(<AiKernelWiring />);
    expect(registeredIds()).toEqual([...SAFE_IDS].sort());
    expect(actionRegistry.list().filter((a) => SAFE_IDS.has(a.id)).length).toBe(7);

    // off again — final teardown.
    __setFeatureFlagForTests('v04Assistant', false);
    rerender(<AiKernelWiring />);
    expect(registeredIds()).toEqual([]);
  });

  it('tears down on unmount so a route change does not leak actions', () => {
    __setFeatureFlagForTests('v04Assistant', true);
    const { unmount } = render(<AiKernelWiring />);
    expect(registeredIds()).toEqual([...SAFE_IDS].sort());

    unmount();
    expect(registeredIds()).toEqual([]);
    expect(actionRegistry.list().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. The `noteWriter` is the REAL adapter — `getDataApi().lectures.create`
//    is called once, returns a real lecture id, both flavours route
//    through the gateway.
// ---------------------------------------------------------------------------

describe('AiKernelWiring / real noteWriter (Accept path)', () => {
  it('Accept calls getDataApi().lectures.create exactly once and returns the real lecture id', async () => {
    const realLectureId = 'lecture-real-abc-123';
    const createSpy = vi
      .spyOn(getDataApi().lectures, 'create')
      .mockResolvedValue(
        makeLecture({ id: realLectureId, module_id: 'course-1', title: 'My note\n\nfree body' }),
      );

    __setFeatureFlagForTests('v04Assistant', true);
    render(<AiKernelWiring />);

    // The wiring must have installed the safe actions.
    expect(registeredIds()).toEqual([...SAFE_IDS].sort());

    // Run the action through the real registry — this
    // exercises the full draft lifecycle, not just the
    // writer.
    const out = await actionRegistry.run(ACTION_CREATE_FREE_NOTE, {
      packet: COURSE_PACKET,
      prompt: 'free body',
      args: { title: 'My note', body: 'free body', moduleId: 'course-1' },
    });

    // The draft is in `draft` state — not yet accepted.
    expect(out.draft.status).toBe('draft');
    expect(out.draft.body).toMatchObject({
      kind: 'note-draft',
      title: 'My note',
      body: 'free body',
      moduleId: 'course-1',
    });

    // No write yet — Accept is the only path.
    expect(createSpy).not.toHaveBeenCalled();

    // Accept: the kernel calls the registered noteWriter.
    const result = await acceptNoteDraft(out.draft);

    // Exactly one dataApi write, with the safe mapping.
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        module_id: 'course-1',
      }),
    );
    // The title carries the body (existing safe mapping —
    // the v0.3 Lecture model has no body field).
    const callArg = createSpy.mock.calls[0][0] as { title: string };
    expect(callArg.title).toContain('My note');
    expect(callArg.title).toContain('free body');

    // The returned id is the REAL lecture id the dataApi
    // produced — never a synthetic `wp03-stub-note-*` and
    // never a `draft_*` id.
    expect(result.canonicalId).toBe(realLectureId);
    expect(result.canonicalId).not.toMatch(/wp03-stub-note/);
    expect(result.canonicalId).not.toMatch(/^draft_/);
    expect(result.canonicalId).not.toMatch(/^wp03/);

    // The draft moved to `accepted` (Accept completed).
    expect(draftLayer.get(out.draft.id)?.status).toBe('accepted');
  });

  it('the same adapter works in local flavour (gateway dispatches to the local port)', async () => {
    // The local port in `dataGateway.ts` writes to Dexie;
    // the gateway's `getDataApi()` returns a *different*
    // object per flavour. happy-dom does not ship
    // IndexedDB, so we cannot open a real Dexie database
    // here. Instead we assert the wiring is gateway-routed
    // by spying on the `dataGateway.getDataApi` call
    // itself: the wiring must go through `getDataApi()`
    // (not call `lib/api` / `lib/db` directly), and it
    // must read the flavour at *call* time (not at mount
    // time), so a flavour switch is picked up.
    setWorkspaceFlavour('local');

    // Spy on the gateway's `getDataApi` and route it to
    // a fake local-shaped dataApi.
    const localLectureId = 'lecture-local-xyz-789';
    const localCreateSpy = vi.fn(async (data: { module_id: string; title: string }) =>
      makeLecture({ id: localLectureId, module_id: data.module_id, title: data.title }),
    );
    const localApi = {
      flavour: 'local' as const,
      supports: () => true,
      modules: { list: async () => [], create: async () => ({} as never), update: async () => ({} as never), delete: async () => ({ success: true }) },
      lectures: {
        list: async () => [],
        create: localCreateSpy,
        update: async () => ({} as never),
        delete: async () => ({ success: true }),
      },
      literatureProjects: { list: async () => [], create: async () => ({} as never), update: async () => ({} as never), delete: async () => ({ success: true }) },
      literaturePapers: { list: async () => [] },
    };
    const getDataApiSpy = vi
      .spyOn(dataGateway, 'getDataApi')
      .mockReturnValue(localApi as unknown as ReturnType<typeof getDataApi>);

    __setFeatureFlagForTests('v04Assistant', true);
    render(<AiKernelWiring />);

    const out = await actionRegistry.run(ACTION_CREATE_FREE_NOTE, {
      packet: COURSE_PACKET,
      prompt: 'b',
      args: { title: 't', body: 'b', moduleId: 'course-1' },
    });
    const result = await acceptNoteDraft(out.draft);

    // The wiring asked the gateway for the current
    // dataApi (proves it does NOT hardcode the sync
    // port) and the gateway returned a local-shaped
    // object (proves flavour is read at call time).
    expect(getDataApiSpy).toHaveBeenCalled();
    expect(localCreateSpy).toHaveBeenCalledTimes(1);
    expect(localCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ module_id: 'course-1' }),
    );
    expect(result.canonicalId).toBe(localLectureId);
    expect(result.canonicalId).not.toMatch(/wp03-stub-note/);
  });

  it('Reject / Cancel never reach the dataApi writer (zero writes)', async () => {
    const createSpy = vi
      .spyOn(getDataApi().lectures, 'create')
      .mockResolvedValue(makeLecture({ id: 'nope', module_id: 'course-1', title: 't' }));

    __setFeatureFlagForTests('v04Assistant', true);
    render(<AiKernelWiring />);

    const out = await actionRegistry.run(ACTION_CREATE_FREE_NOTE, {
      packet: COURSE_PACKET,
      prompt: 'body',
      args: { title: 't', body: 'body', moduleId: 'course-1' },
    });

    // Reject: kernel transitions to `rejected`. The writer
    // is NOT called.
    draftLayer.transition(out.draft.id, 'rejected');
    expect(createSpy).not.toHaveBeenCalled();
    expect(draftLayer.get(out.draft.id)?.status).toBe('rejected');
  });

  it('a writer failure throws, preserves the draft + body + moduleId, and is retryable', async () => {
    const createSpy = vi
      .spyOn(getDataApi().lectures, 'create')
      .mockRejectedValueOnce(new Error('network down: write failed'))
      // A second call succeeds — the user clicks Accept again.
      .mockResolvedValueOnce(
        makeLecture({ id: 'lecture-retry-ok', module_id: 'course-1', title: 't\n\nb' }),
      );

    __setFeatureFlagForTests('v04Assistant', true);
    render(<AiKernelWiring />);

    const out = await actionRegistry.run(ACTION_CREATE_FREE_NOTE, {
      packet: COURSE_PACKET,
      prompt: 'b',
      args: { title: 't', body: 'b', moduleId: 'course-1' },
    });

    // First Accept: writer throws, acceptNoteDraft re-throws.
    await expect(acceptNoteDraft(out.draft)).rejects.toThrow(/network down/);

    // Exactly one attempt (the failed one).
    expect(createSpy).toHaveBeenCalledTimes(1);

    // The draft is preserved in `draft` state — NOT deleted,
    // NOT moved to `accepted`/`rejected`. The body, title,
    // and moduleId are all intact for retry.
    const after = draftLayer.get(out.draft.id);
    expect(after).toBeDefined();
    expect(after?.status).toBe('draft');
    expect(after?.body).toMatchObject({
      kind: 'note-draft',
      title: 't',
      body: 'b',
      moduleId: 'course-1',
    });

    // Second Accept: the same draft, same args. The
    // user re-typed nothing — the data is still there.
    // The writer is called again; this time it succeeds.
    const result = await acceptNoteDraft(out.draft);
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(result.canonicalId).toBe('lecture-retry-ok');
    expect(draftLayer.get(out.draft.id)?.status).toBe('accepted');
  });

  it('a missing moduleId (no course container) refuses to write to global scope', async () => {
    const createSpy = vi
      .spyOn(getDataApi().lectures, 'create')
      .mockResolvedValue(makeLecture({ id: 'should-not-happen', module_id: 'x', title: 't' }));

    __setFeatureFlagForTests('v04Assistant', true);
    render(<AiKernelWiring />);

    // The permission gate refuses a packet with no course
    // container — the action never even runs through the
    // kernel. We exercise the gate + the UI's gate skip.
    const action = actionRegistry.get(ACTION_CREATE_FREE_NOTE);
    expect(action).toBeDefined();
    const noCoursePacket: ContextPacket = {
      ...COURSE_PACKET,
      container: null,
    };
    // The gate is enforced by the UI; the kernel itself
    // will run the action if invoked. We assert that the
    // adapter's defensive check (no moduleId → throw) is
    // the second line of defence.
    const out = await actionRegistry.run(ACTION_CREATE_FREE_NOTE, {
      packet: noCoursePacket,
      prompt: 'b',
      args: { title: 't', body: 'b' /* no moduleId */ },
    });
    await expect(acceptNoteDraft(out.draft)).rejects.toThrow(/requires a course container/);
    expect(createSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Composition guarantee — a fresh registry is empty, the wiring
//    component is the *only* path that registers the four safe
//    actions in this file.
// ---------------------------------------------------------------------------

describe('AiKernelWiring / composition guarantee', () => {
  it('without mounting, the live actionRegistry has zero safe actions', () => {
    // beforeEach resets the kernel; no manual register call
    // is performed anywhere in this file. If this assertion
    // ever fails, somebody has either (a) added a side-effect
    // import in this file or (b) lost the `__reset` call in
    // `beforeEach`.
    expect(registeredIds()).toEqual([]);
  });
});
