import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { AnnotationIcon, CloseIcon, CheckIcon, CommentIcon } from './ui/Icons';
import { db } from '../lib/db';
import type { NoteBlock, BlockContent } from '../types';

interface AnnotationPanelProps {
  lectureId: string;
}

interface AnnotationEntry {
  id: string;
  paragraphIndex: number;
  text: string;
  sort_order: number;
}

export default function AnnotationPanel({ lectureId }: AnnotationPanelProps) {
  const { deviceId, selectedModuleId } = useStore();
  const [annotations, setAnnotations] = useState<AnnotationEntry[]>([]);

  // Load all annotations for this lecture
  const loadAnnotations = useCallback(async () => {
    if (!lectureId) return;
    const annoBlocks = await db.noteBlocks
      .where('lecture_id')
      .equals(lectureId)
      .filter((b) => !b.deleted_at && b.block_type === 'annotation')
      .toArray();

    setAnnotations(annoBlocks
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((ab) => {
        const posRef = ab.linked_source_page_id || '';
        const idx = posRef.startsWith('pos:') ? parseInt(posRef.slice(4), 10) : -1;
        return {
          id: ab.id,
          paragraphIndex: idx,
          text: ab.content_json.plain_text || ab.content_json?.content?.[0]?.text || '',
          sort_order: ab.sort_order,
        };
      }));
  }, [lectureId]);

  // Load on mount
  useEffect(() => {
    loadAnnotations();
  }, [loadAnnotations]);

  // Re-load when annotations are added/deleted, or when notes are saved
  useEffect(() => {
    window.addEventListener('studykit:annotation:changed', loadAnnotations);
    window.addEventListener('studykit:notes:saved', loadAnnotations);
    return () => {
      window.removeEventListener('studykit:annotation:changed', loadAnnotations);
      window.removeEventListener('studykit:notes:saved', loadAnnotations);
    };
  }, [loadAnnotations]);

  // Delete annotation
  const deleteAnnotation = useCallback(async (id: string) => {
    try {
      await db.noteBlocks.update(id, { deleted_at: new Date().toISOString() });
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
      window.dispatchEvent(new CustomEvent('studykit:annotation:changed'));
    } catch (err) {
      console.error('Failed to delete annotation:', err);
    }
  }, []);

  return (
    <div className="annotation-panel">
      <div className="annotation-panel-header">
        <span>Annotations</span>
      </div>
      <div className="annotation-panel-content">
        {annotations.length === 0 && (
          <p className="text-xs text-muted" style={{ padding: '0.75rem', textAlign: 'center', lineHeight: 1.5 }}>
            Click on any paragraph in the notes to add a margin annotation here.
          </p>
        )}

        {annotations.map((anno) => (
          <div key={anno.id} className="annotation-entry">
            <div className="annotation-entry-header">
              <span className="annotation-entry-label"><AnnotationIcon size="sm" /> Paragraph {anno.paragraphIndex + 1}</span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={(e) => { e.stopPropagation(); deleteAnnotation(anno.id); }}
                style={{ fontSize: '0.65rem', padding: '0.1rem 0.3rem', marginLeft: 'auto' }}
                title="Delete"
              ><CloseIcon size="sm" />
              </button>
            </div>
            <div className="annotation-entry-text">{anno.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== Floating add-annotation button (rendered inside NoteEditor) =====
// Uses stable paragraph index ("pos:N") so annotations survive note saves

interface AddAnnotationButtonProps {
  paragraphIndex: number;
  paragraphPreview: string;
  hasAnnotation: boolean;
}

export function AddAnnotationButton({ paragraphIndex, paragraphPreview, hasAnnotation }: AddAnnotationButtonProps) {
  const [showInput, setShowInput] = useState(false);
  const [text, setText] = useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showInput]);

  const handleSave = async () => {
    if (!text.trim()) return;
    try {
      const store = useStore.getState();
      const lectureId = store.selectedLectureId;
      const moduleId = store.selectedModuleId;
      if (!lectureId || !moduleId) return;

      const now = new Date().toISOString();
      const content: BlockContent = {
        schema_version: '1.0',
        type: 'paragraph',
        attrs: {},
        content: [{ type: 'text', text: text.trim() }],
        plain_text: text.trim(),
        export_hints: { annotation: true },
        accessibility: {},
      };
      const block: NoteBlock = {
        id: crypto.randomUUID(),
        lecture_id: lectureId,
        module_id: moduleId,
        linked_source_page_id: `pos:${paragraphIndex}`,
        block_type: 'annotation',
        content_json: content,
        source_links_json: {},
        sort_order: paragraphIndex,
        created_by_device_id: store.deviceId,
        created_at: now,
        updated_at: now,
        version: 1,
      };

      await db.noteBlocks.add(block);
      setText('');
      setShowInput(false);
      window.dispatchEvent(new CustomEvent('studykit:annotation:changed'));
    } catch (err) {
      console.error('Failed to add annotation:', err);
    }
  };

  return (
    <span className="annotation-anchor">
      {!showInput ? (
        <button
          className={`annotation-add-btn${hasAnnotation ? ' has-annotation' : ''}`}
          onClick={(e) => { e.stopPropagation(); setShowInput(true); }}
          title={hasAnnotation ? 'Edit annotation' : 'Add margin annotation'}
        >
          <>{hasAnnotation ? <AnnotationIcon size="sm" /> : <CommentIcon size="sm" />}</>
        </button>
      ) : (
        <span className="annotation-inline-form" onClick={(e) => e.stopPropagation()}>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
              if (e.key === 'Escape') { setShowInput(false); setText(''); }
            }}
            placeholder={hasAnnotation ? 'Add another annotation...' : 'Annotation...'}
            className="annotation-inline-input"
          />
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!text.trim()}
            style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}><CheckIcon size="sm" />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setShowInput(false); setText(''); }}
            style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}><CloseIcon size="sm" />
          </button>
        </span>
      )}
    </span>
  );
}
