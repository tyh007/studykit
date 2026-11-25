/**
 * StudyKit v0.4 — `features/collaboration/PublishScratchDialog`
 *
 * The explicit publish-preview dialog. The
 * Private-Scratch publish flow goes through this
 * component:
 *
 *   1. The user clicks "Preview publish" on a
 *      Private Scratch (in the CollaborationPanel).
 *   2. The dialog calls `previewPublishScratch` and
 *      renders a side-by-side diff: before / after
 *      for `title` and `body`. The diff is *visible*
 *      — the user sees what the publish will write
 *      to the canonical store.
 *   3. The user clicks "Publish" to commit. The
 *      dialog calls the host-supplied
 *      `resolveCanonicalId` callback. The callback
 *      writes the canonical row (e.g. `createTask`)
 *      and returns its id. **The dialog only calls
 *      `confirmPublish` after the host's writer
 *      succeeds** — a failed write surfaces the
 *      error in the dialog and the scratch stays
 *      in `publishing` state so the user can retry
 *      or Cancel.
 *   4. The user clicks "Cancel" to abort. The
 *      dialog calls `cancelPublish` and the
 *      scratch reverts to `private`.
 *
 * The dialog is the *only* path that flips a
 * Private Scratch from `private` to `published`.
 * Inviting a collaborator, opening the panel,
 * reloading the page — none of these publish a
 * scratch. The dialog is the explicit confirmation
 * gate.
 */

import React from 'react';
import {
  previewPublishScratch,
  cancelPublish,
  confirmPublish,
  type UseCaseDeps,
} from '../../application/collaboration/collaborationUseCases';
import type { PrivateScratch, PublishDiff } from '../../domain/collaboration';

export interface PublishScratchDialogProps {
  readonly projectId: string;
  readonly scratch: PrivateScratch;
  readonly useCaseDeps: UseCaseDeps;
  /**
   * The canonical id the publish will produce (or
   * touch, for `changed` ops). When the scratch is
   * a fresh `note` the host passes a new id; for a
   * `task`/`claim`/etc. the host routes the publish
   * through the right use case and passes the
   * resulting id back to the dialog.
   */
  readonly resolveCanonicalId: (scratch: PrivateScratch) => Promise<string>;
  readonly onClose: () => void;
  readonly onPublished: (scratchId: string, canonicalId: string) => void;
}

export function PublishScratchDialog(
  props: PublishScratchDialogProps,
): React.ReactElement {
  const [diff, setDiff] = React.useState<PublishDiff | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await previewPublishScratch(props.useCaseDeps, {
          projectId: props.projectId,
          scratchId: props.scratch.id,
          targetId: null,
          baseline: null,
        });
        if (!cancelled) setDiff(d);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to preview publish.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // The effect depends on the scratch id +
    // project id + use case deps, NOT the
    // whole `props` object (which is a new
    // reference on every render and would
    // cause the effect to re-run indefinitely).
  }, [props.scratch.id, props.projectId, props.useCaseDeps]);

  const onCancel = async (): Promise<void> => {
    setBusy(true);
    try {
      if (diff) {
        await cancelPublish(props.useCaseDeps, {
          projectId: props.projectId,
          publishDiffId: diff.id,
        });
      }
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel publish.');
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = async (): Promise<void> => {
    if (!diff) return;
    setBusy(true);
    setError(null);
    try {
      const canonicalId = await props.resolveCanonicalId(props.scratch);
      await confirmPublish(props.useCaseDeps, {
        projectId: props.projectId,
        publishDiffId: diff.id,
        canonicalId,
      });
      props.onPublished(props.scratch.id, canonicalId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm publish.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Publish private scratch"
      data-testid="publish-scratch-dialog"
      className="sk-publish-dialog"
    >
      <h2>Publish private scratch</h2>
      <p data-testid="publish-scratch-target">
        <strong>{props.scratch.title || '(untitled)'}</strong> ({props.scratch.kind})
      </p>
      {error && (
        <p data-testid="publish-scratch-error" role="alert">
          {error}
        </p>
      )}
      {diff ? (
        <table data-testid="publish-scratch-diff">
          <thead>
            <tr>
              <th>Field</th>
              <th>Before</th>
              <th>After</th>
            </tr>
          </thead>
          <tbody>
            {diff.rows.map((row, i) => (
              <tr key={i} data-testid={`diff-row-${row.path}`}>
                <td>{row.path} ({row.op})</td>
                <td>
                  <pre>{row.before ?? '(empty)'}</pre>
                </td>
                <td>
                  <pre>{row.after ?? '(empty)'}</pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>Loading preview…</p>
      )}
      <p>
        <strong>This is an explicit publish.</strong> The scratch will leave
        your private space and become visible to the project members. Inviting
        a collaborator does NOT auto-publish your private scratch.
      </p>
      <button
        type="button"
        data-testid="publish-scratch-confirm"
        onClick={() => void onConfirm()}
        disabled={busy || !diff}
      >
        Publish to project
      </button>
      <button
        type="button"
        data-testid="publish-scratch-cancel"
        onClick={() => void onCancel()}
        disabled={busy}
      >
        Cancel
      </button>
    </div>
  );
}
