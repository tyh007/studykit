/**
 * StudyKit v0.4 — `features/canvas/CognitiveCard`
 *
 * The xyflow node renderer for cognitive roles that
 * do not map onto the engine's existing
 * `TextNode` / `NoteNode` / `QuestionNode` renderers.
 *
 * Roles handled here:
 *   - `concept`, `claim`, `evidence`, `counterevidence`,
 *     `example`, `task`, `output`, `source`.
 *   - `free` (the engine's `NoteNode` would also work,
 *     but we route through this card so the body
 *     presentation is consistent with the other
 *     cognitive roles).
 *
 * The card is a thin presentation. It reads
 * `data.canvasNode.content_json` (a projection the
 * mapping in `canvasMappings.ts` writes) and renders
 * the body, role label, and missing badge. It does
 * not talk to any data source directly.
 */

import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

import type { CanvasFlowNode } from '../../components/literature/canvas/canvas-types';
import type { CognitiveRole } from '../../domain/canvas';

function roleLabel(role: CognitiveRole | string | null | undefined): string {
  switch (role) {
    case 'free':
      return 'Free node';
    case 'source':
      return 'Source';
    case 'concept':
      return 'Concept';
    case 'question':
      return 'Question';
    case 'claim':
      return 'Claim';
    case 'evidence':
      return 'Evidence';
    case 'counterevidence':
      return 'Counter';
    case 'example':
      return 'Example';
    case 'task':
      return 'Task';
    case 'output':
      return 'Output';
    default:
      return 'Node';
  }
}

export default function CognitiveCard(
  props: NodeProps<CanvasFlowNode>,
): React.ReactElement {
  const { data, selected } = props;
  const role = (data.canvasNode.content_json?.role ?? 'free') as CognitiveRole;
  const body = (data.canvasNode.content_json?.text ?? '') as string;
  const missing = !!data.canvasNode.content_json?.missing;
  const refKind = (data.canvasNode.content_json?.refKind ?? 'free') as 'free' | 'knowledge';
  const objectKind = (data.canvasNode.content_json?.objectKind ?? null) as string | null;
  return (
    <div
      className={`cognitive-card cognitive-card--${role} ${selected ? 'is-selected' : ''} ${
        missing ? 'is-missing' : ''
      }`}
      data-ref-kind={refKind}
      data-object-kind={objectKind ?? ''}
      role="group"
      aria-label={`${roleLabel(role)} card${missing ? ' (source lost)' : ''}`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="cognitive-card__role">{roleLabel(role)}</div>
      <div className="cognitive-card__body">
        {missing ? '(source lost — Evidence or Claim was archived / rejected)' : body || '(empty)'}
      </div>
      {missing && <div className="cognitive-card__missing-badge">source lost</div>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
