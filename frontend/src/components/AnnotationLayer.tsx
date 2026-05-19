import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { db } from '../lib/db';
import type {
  SourcePage,
  Annotation,
  HighlightGeometry,
  AnnotationStyle,
  SemanticLabel,
  UndoEntry,
} from '../types';
import { SEMANTIC_LABELS } from '../types';

interface AnnotationLayerProps {
  page: SourcePage;
}

export default function AnnotationLayer({ page }: AnnotationLayerProps) {
  const {
    annotations, setAnnotations, addAnnotation, removeAnnotation,
    deviceId, selectedLectureId,
  } = useStore();

  const svgRef = useRef<SVGSVGElement>(null);
  const [activeTool, setActiveTool] = useState<'highlight' | 'ink' | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<SemanticLabel>('important');
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawRect, setDrawRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [currentStroke, setCurrentStroke] = useState<Array<{ x: number; y: number; pressure?: number; t: number }>>([]);

  // Undo/redo stacks (session-scoped, does not survive reload per PRD)
  const undoStack = useRef<UndoEntry[]>([]);
  const redoStack = useRef<UndoEntry[]>([]);

  // Load annotations for this page
  useEffect(() => {
    if (!page?.id || !selectedLectureId) return;

    db.annotations
      .where({ source_page_id: page.id, lecture_id: selectedLectureId })
      .filter((a) => !a.deleted_at)
      .toArray()
      .then(setAnnotations)
      .catch(console.error);
  }, [page?.id, selectedLectureId]);

  // Scale: annotations stored in source-page coords; canvas renders at source-page coords
  // so scale is 1:1 when canvas matches source page dimensions
  // But PDF.js viewport scale = zoom/100, so annotation scale follows the same
  const scale = 1;

  // Get canvas-relative coordinates
  const getCoords = useCallback(
    (e: React.MouseEvent<SVGSVGElement>): { x: number; y: number } => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left),
        y: (e.clientY - rect.top),
      };
    },
    []
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!activeTool || !page) return;

      const coords = getCoords(e);
      setIsDrawing(true);
      setDrawStart(coords);

      if (activeTool === 'ink') {
        setCurrentStroke([{ ...coords, pressure: 0.5, t: Date.now() }]);
      }

      redoStack.current = [];
    },
    [activeTool, page, getCoords]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!isDrawing || !activeTool || !page) return;

      const coords = getCoords(e);

      if (activeTool === 'highlight' && drawStart) {
        setDrawRect({
          x: Math.min(drawStart.x, coords.x),
          y: Math.min(drawStart.y, coords.y),
          width: Math.abs(coords.x - drawStart.x),
          height: Math.abs(coords.y - drawStart.y),
        });
      }

      if (activeTool === 'ink') {
        setCurrentStroke((prev) => [...prev, { ...coords, pressure: 0.5, t: Date.now() }]);
      }
    },
    [isDrawing, activeTool, page, drawStart, getCoords]
  );

  const handleMouseUp = useCallback(async () => {
    if (!isDrawing || !activeTool || !page || !selectedLectureId) return;
    setIsDrawing(false);

    const now = new Date().toISOString();
    let annotation: Annotation | null = null;

    if (activeTool === 'highlight' && drawRect && drawRect.width > 3) {
      const geometry: HighlightGeometry = {
        coordinate_space: 'source_page',
        page_width: page.width || 1280,
        page_height: page.height || 720,
        rects: [drawRect],
      };

      const style: AnnotationStyle = {
        colour: SEMANTIC_LABELS[selectedLabel].colour,
        opacity: 0.3,
        semantic_label: selectedLabel,
      };

      annotation = {
        id: crypto.randomUUID(),
        lecture_id: selectedLectureId,
        source_page_id: page.id,
        annotation_type: 'highlight',
        geometry_json: geometry,
        style_json: style,
        layer: 'student',
        created_by_device_id: deviceId,
        created_at: now,
        updated_at: now,
        version: 1,
      };
    }

    if (activeTool === 'ink' && currentStroke.length > 2) {
      const geometry = {
        coordinate_space: 'source_page' as const,
        page_width: page.width || 1280,
        page_height: page.height || 720,
        strokes: [{ points: currentStroke }],
      };

      const style: AnnotationStyle = {
        colour: SEMANTIC_LABELS[selectedLabel].colour,
        thickness: 2,
        opacity: 0.8,
        semantic_label: selectedLabel,
      };

      annotation = {
        id: crypto.randomUUID(),
        lecture_id: selectedLectureId,
        source_page_id: page.id,
        annotation_type: 'ink',
        geometry_json: geometry,
        style_json: style,
        layer: 'student',
        created_by_device_id: deviceId,
        created_at: now,
        updated_at: now,
        version: 1,
      };
    }

    if (annotation) {
      await db.annotations.add(annotation);
      addAnnotation(annotation);
      undoStack.current.push({ annotation, previousGeometry: null, previousStyle: null, action: 'create' });
    }

    setDrawRect(null);
    setCurrentStroke([]);
    setDrawStart(null);
  }, [isDrawing, activeTool, page, selectedLectureId, drawRect, currentStroke, deviceId, selectedLabel]);

  const handleUndo = useCallback(async () => {
    const entry = undoStack.current.pop();
    if (!entry) return;

    if (entry.action === 'create') {
      await db.annotations.update(entry.annotation.id, { deleted_at: new Date().toISOString() });
      removeAnnotation(entry.annotation.id);
      redoStack.current.push(entry);
    }
  }, []);

  const handleRedo = useCallback(async () => {
    const entry = redoStack.current.pop();
    if (!entry) return;

    if (entry.action === 'create') {
      // The record still exists in Dexie (soft-deleted from undo), so update instead of add
      await db.annotations.update(entry.annotation.id, { deleted_at: null as any });
      addAnnotation(entry.annotation);
      undoStack.current.push(entry);
    }
  }, []);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo]);

  if (!page) return null;

  return (
    <>
      {/* Annotation toolbar - floating above the canvas */}
      <div className="annotation-toolbar" role="toolbar" aria-label="Slide annotation tools" style={{ pointerEvents: 'auto', position: 'absolute', top: '0.5rem', right: '0.5rem' }}>
        <button
          className={activeTool === 'highlight' ? 'active' : ''}
          onClick={() => setActiveTool(activeTool === 'highlight' ? null : 'highlight')}
          title="Highlight (H)"
          aria-label="Highlight tool"
          aria-pressed={activeTool === 'highlight'}
        >
          ▨
        </button>
        <button
          className={activeTool === 'ink' ? 'active' : ''}
          onClick={() => setActiveTool(activeTool === 'ink' ? null : 'ink')}
          title="Draw (D)"
          aria-label="Freehand draw tool"
          aria-pressed={activeTool === 'ink'}
        >
          ✎
        </button>
        <button onClick={handleUndo} title="Undo (Ctrl+Z)" aria-label="Undo annotation">↩</button>
        <button onClick={handleRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo annotation">↪</button>
      </div>

      {/* Semantic label picker */}
      {activeTool && (
        <div className="semantic-label-picker" role="radiogroup" aria-label="Annotation colour label" style={{ position: 'absolute', top: '2.75rem', right: '0.5rem', background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', pointerEvents: 'auto', zIndex: 5 }}>
          {(Object.entries(SEMANTIC_LABELS) as [SemanticLabel, { label: string; colour: string }][]).map(
            ([key, { label, colour }]) => (
              <button
                key={key}
                className={selectedLabel === key ? 'active' : ''}
                style={{ background: colour }}
                onClick={() => setSelectedLabel(key)}
                title={label}
                aria-label={label}
                role="radio"
                aria-checked={selectedLabel === key}
              />
            )
          )}
        </div>
      )}

      {/* SVG overlay - covers exact canvas area */}
      <svg
        ref={svgRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          cursor: activeTool === 'highlight' ? 'crosshair' : activeTool === 'ink' ? 'crosshair' : 'default',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        {/* Existing highlights */}
        {annotations
          .filter((a) => a.source_page_id === page.id && a.annotation_type === 'highlight')
          .map((a) => {
            const geo = a.geometry_json as HighlightGeometry;
            return geo.rects?.map((rect, i) => (
              <rect
                key={`${a.id}-${i}`}
                x={rect.x * scale}
                y={rect.y * scale}
                width={rect.width * scale}
                height={rect.height * scale}
                fill={(a.style_json as AnnotationStyle).colour}
                opacity={(a.style_json as AnnotationStyle).opacity ?? 0.3}
              />
            ));
          })}

        {/* Existing ink strokes */}
        {annotations
          .filter((a) => a.source_page_id === page.id && a.annotation_type === 'ink')
          .map((a) => {
            const geo = a.geometry_json as any;
            return geo.strokes?.map((stroke: any, si: number) => {
              const d = stroke.points
                .map((p: any, i: number) =>
                  i === 0 ? `M ${p.x * scale} ${p.y * scale}` : `L ${p.x * scale} ${p.y * scale}`
                )
                .join(' ');
              return (
                <path
                  key={`${a.id}-${si}`}
                  d={d}
                  fill="none"
                  stroke={(a.style_json as AnnotationStyle).colour}
                  strokeWidth={(a.style_json as AnnotationStyle).thickness ?? 2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            });
          })}

        {/* Current drawing */}
        {drawRect && (
          <rect
            x={drawRect.x * scale}
            y={drawRect.y * scale}
            width={drawRect.width * scale}
            height={drawRect.height * scale}
            fill={SEMANTIC_LABELS[selectedLabel].colour}
            opacity={0.3}
          />
        )}
        {currentStroke.length > 1 && (
          <path
            d={currentStroke
              .map((p, i) => (i === 0 ? `M ${p.x * scale} ${p.y * scale}` : `L ${p.x * scale} ${p.y * scale}`))
              .join(' ')}
            fill="none"
            stroke={SEMANTIC_LABELS[selectedLabel].colour}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </>
  );
}
