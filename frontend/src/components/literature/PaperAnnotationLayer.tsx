import React, { useState, useRef, useCallback, useEffect } from 'react';
import { literaturePapersApi } from '../../lib/literature-api';

interface PaperAnnotation {
  id: string;
  paper_id: string;
  page_number: number;
  annotation_type: 'highlight' | 'ink' | 'underline';
  geometry_json: any;
  style_json: any;
  text_content?: string;
  created_at: string;
  updated_at: string;
}

interface PaperAnnotationLayerProps {
  paperId: string;
  pageNumber: number;
}

const SEMANTIC_LABELS: Record<string, { label: string; colour: string }> = {
  important: { label: 'Important', colour: '#ffd700' },
  definition: { label: 'Definition', colour: '#87ceeb' },
  question: { label: 'Question', colour: '#ff69b4' },
  key_concept: { label: 'Key Concept', colour: '#98fb98' },
  example: { label: 'Example', colour: '#dda0dd' },
  reference: { label: 'Reference', colour: '#f0e68c' },
  argument: { label: 'Argument', colour: '#ffa07a' },
  summary: { label: 'Summary', colour: '#b0c4de' },
};

export default function PaperAnnotationLayer({ paperId, pageNumber }: PaperAnnotationLayerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [annotations, setAnnotations] = useState<PaperAnnotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTool, setActiveTool] = useState<'highlight' | 'ink' | null>(null);
  const [selectedLabel, setSelectedLabel] = useState('important');
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawRect, setDrawRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [currentStroke, setCurrentStroke] = useState<Array<{ x: number; y: number }>>([]);

  // Fetch annotations from server
  useEffect(() => {
    if (!paperId) return;
    setLoading(true);
    literaturePapersApi.listAnnotations(paperId, pageNumber)
      .then(setAnnotations)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [paperId, pageNumber]);

  const getCoords = useCallback((e: React.MouseEvent<SVGSVGElement>): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!activeTool) return;
    const coords = getCoords(e);
    setIsDrawing(true);
    setDrawStart(coords);
    if (activeTool === 'ink') setCurrentStroke([coords]);
  }, [activeTool, getCoords]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDrawing || !activeTool) return;
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
      setCurrentStroke(prev => [...prev, coords]);
    }
  }, [isDrawing, activeTool, drawStart, getCoords]);

  const handleMouseUp = useCallback(async () => {
    if (!isDrawing || !activeTool || !paperId) return;
    setIsDrawing(false);

    if (activeTool === 'highlight' && drawRect && drawRect.width > 3) {
      try {
        const saved = await literaturePapersApi.createAnnotation(paperId, {
          page_number: pageNumber,
          annotation_type: 'highlight',
          geometry_json: {
            coordinate_space: 'page',
            rects: [drawRect],
          },
          style_json: {
            colour: SEMANTIC_LABELS[selectedLabel]?.colour || '#ffd700',
            opacity: 0.3,
            semantic_label: selectedLabel,
          },
        });
        setAnnotations(prev => [...prev, saved]);
      } catch (err) {
        console.error('Failed to save annotation:', err);
      }
    }

    if (activeTool === 'ink' && currentStroke.length > 2) {
      try {
        const saved = await literaturePapersApi.createAnnotation(paperId, {
          page_number: pageNumber,
          annotation_type: 'ink',
          geometry_json: {
            coordinate_space: 'page',
            strokes: [{ points: currentStroke }],
          },
          style_json: {
            colour: SEMANTIC_LABELS[selectedLabel]?.colour || '#ffd700',
            thickness: 2,
            opacity: 0.8,
            semantic_label: selectedLabel,
          },
        });
        setAnnotations(prev => [...prev, saved]);
      } catch (err) {
        console.error('Failed to save annotation:', err);
      }
    }

    setDrawRect(null);
    setCurrentStroke([]);
    setDrawStart(null);
  }, [isDrawing, activeTool, paperId, pageNumber, drawRect, currentStroke, selectedLabel]);

  const handleDeleteAnnotation = async (id: string) => {
    try {
      await literaturePapersApi.deleteAnnotation(id);
      setAnnotations(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      console.error('Failed to delete annotation:', err);
    }
  };

  if (loading) return null;

  return (
    <>
      {/* Toolbar */}
      <div style={{
        position: 'absolute', top: '0.25rem', right: '0.25rem', zIndex: 10,
        display: 'flex', gap: '0.125rem', background: 'rgba(255,255,255,0.9)',
        borderRadius: '4px', padding: '0.125rem', boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        pointerEvents: 'auto',
      }}>
        <button
          onClick={() => setActiveTool(activeTool === 'highlight' ? null : 'highlight')}
          style={{
            width: 24, height: 24, border: activeTool === 'highlight' ? '2px solid #333' : '1px solid #ccc',
            borderRadius: 3, background: '#fff', cursor: 'pointer', fontSize: '0.75rem', padding: 0,
          }}
          title="Highlight (H)"
        >
          ▨
        </button>
        <button
          onClick={() => setActiveTool(activeTool === 'ink' ? null : 'ink')}
          style={{
            width: 24, height: 24, border: activeTool === 'ink' ? '2px solid #333' : '1px solid #ccc',
            borderRadius: 3, background: '#fff', cursor: 'pointer', fontSize: '0.75rem', padding: 0,
          }}
          title="Draw (D)"
        >
          ✎
        </button>
      </div>

      {/* Color picker */}
      {activeTool && (
        <div style={{
          position: 'absolute', top: '2.25rem', right: '0.25rem', zIndex: 10,
          display: 'flex', flexDirection: 'column', gap: '0.125rem',
          background: 'rgba(255,255,255,0.9)', borderRadius: '4px',
          padding: '0.125rem', boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
          pointerEvents: 'auto',
        }}>
          {Object.entries(SEMANTIC_LABELS).map(([key, { label, colour }]) => (
            <button
              key={key}
              onClick={() => setSelectedLabel(key)}
              style={{
                width: 20, height: 20, border: selectedLabel === key ? '2px solid #333' : '1px solid #ccc',
                borderRadius: 3, background: colour, cursor: 'pointer', padding: 0,
              }}
              title={label}
            />
          ))}
        </div>
      )}

      {/* SVG overlay */}
      <svg
        ref={svgRef}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          cursor: activeTool ? 'crosshair' : 'default',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        {/* Existing highlights */}
        {annotations.filter(a => a.annotation_type === 'highlight').map(a => {
          const geo = a.geometry_json;
          return geo?.rects?.map((rect: any, i: number) => (
            <rect
              key={`${a.id}-${i}`}
              x={rect.x} y={rect.y}
              width={rect.width} height={rect.height}
              fill={a.style_json?.colour || '#ffd700'}
              opacity={a.style_json?.opacity ?? 0.3}
              onClick={() => handleDeleteAnnotation(a.id)}
              style={{ cursor: 'pointer' }}
            />
          ));
        })}

        {/* Existing ink strokes */}
        {annotations.filter(a => a.annotation_type === 'ink').map(a => {
          const geo = a.geometry_json;
          return geo?.strokes?.map((stroke: any, si: number) => {
            const d = stroke.points.map((p: any, i: number) =>
              i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
            ).join(' ');
            return (
              <path
                key={`${a.id}-${si}`}
                d={d}
                fill="none"
                stroke={a.style_json?.colour || '#ffd700'}
                strokeWidth={a.style_json?.thickness ?? 2}
                strokeLinecap="round"
                strokeLinejoin="round"
                onClick={() => handleDeleteAnnotation(a.id)}
                style={{ cursor: 'pointer' }}
              />
            );
          });
        })}

        {/* Current drawing preview */}
        {drawRect && (
          <rect
            x={drawRect.x} y={drawRect.y}
            width={drawRect.width} height={drawRect.height}
            fill={SEMANTIC_LABELS[selectedLabel]?.colour || '#ffd700'}
            opacity={0.3}
          />
        )}
        {currentStroke.length > 1 && (
          <path
            d={currentStroke.map((p, i) => i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`).join(' ')}
            fill="none"
            stroke={SEMANTIC_LABELS[selectedLabel]?.colour || '#ffd700'}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </>
  );
}
