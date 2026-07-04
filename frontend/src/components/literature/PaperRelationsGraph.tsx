import React, { useRef, useEffect, useState, useCallback } from 'react';

interface GraphNode {
  id: string;
  title: string;
  authors?: string;
  year?: number;
}

interface GraphEdge {
  id: string;
  source_paper_id: string;
  target_paper_id: string;
  relation_type: string;
}

interface PaperRelationsGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  highlightPaperId?: string;
  onNodeClick?: (paperId: string) => void;
  width?: number;
  height?: number;
}

const EDGE_COLORS: Record<string, string> = {
  cites: '#3b82f6',
  extends: '#8b5cf6',
  contradicts: '#ef4444',
  supports: '#22c55e',
  related: '#6b7280',
  method: '#f59e0b',
  dataset: '#06b6d4',
};

const EDGE_LABELS: Record<string, string> = {
  cites: 'Cites',
  extends: 'Extends',
  contradicts: 'Contradicts',
  supports: 'Supports',
  related: 'Related',
  method: 'Method',
  dataset: 'Dataset',
};

interface Position {
  x: number;
  y: number;
}

function runForceLayout(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number): Position[] {
  const cx = width / 2;
  const cy = height / 2;
  const n = nodes.length;

  // Initialize positions in a circle
  const pos: Position[] = nodes.map((_, i) => ({
    x: cx + Math.cos((2 * Math.PI * i) / n) * Math.min(cx, cy) * 0.6,
    y: cy + Math.sin((2 * Math.PI * i) / n) * Math.min(cx, cy) * 0.6,
  }));

  const vel: Position[] = nodes.map(() => ({ x: 0, y: 0 }));
  const nodeMap = new Map(nodes.map((n, i) => [n.id, i]));

  const repulsion = 8000;
  const attraction = 0.005;
  const idealLength = 150;
  const damping = 0.85;
  const iterations = 100;

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsion (all pairs)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) dist = 1;
        const force = repulsion / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        vel[i].x += fx;
        vel[i].y += fy;
        vel[j].x -= fx;
        vel[j].y -= fy;
      }
    }

    // Attraction (along edges)
    for (const edge of edges) {
      const si = nodeMap.get(edge.source_paper_id);
      const ti = nodeMap.get(edge.target_paper_id);
      if (si === undefined || ti === undefined) continue;
      let dx = pos[ti].x - pos[si].x;
      let dy = pos[ti].y - pos[si].y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) dist = 1;
      const force = (dist - idealLength) * attraction;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      vel[si].x += fx;
      vel[si].y += fy;
      vel[ti].x -= fx;
      vel[ti].y -= fy;
    }

    // Center gravity
    for (let i = 0; i < n; i++) {
      vel[i].x += (cx - pos[i].x) * 0.01;
      vel[i].y += (cy - pos[i].y) * 0.01;
    }

    // Damping
    for (let i = 0; i < n; i++) {
      vel[i].x *= damping;
      vel[i].y *= damping;
    }

    // Apply
    for (let i = 0; i < n; i++) {
      pos[i].x += vel[i].x;
      pos[i].y += vel[i].y;
      // Keep within bounds
      pos[i].x = Math.max(60, Math.min(width - 60, pos[i].x));
      pos[i].y = Math.max(40, Math.min(height - 40, pos[i].y));
    }
  }

  return pos;
}

export default function PaperRelationsGraph({
  nodes, edges, highlightPaperId, onNodeClick,
  width = 600, height = 400,
}: PaperRelationsGraphProps) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [hoveredNode, setHoveredNode] = useState<number | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (nodes.length === 0) return;
    const pos = runForceLayout(nodes, edges, width, height);
    setPositions(pos);
    initialized.current = true;
  }, [nodes, edges, width, height]);

  if (nodes.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
        No papers to display in the graph.
      </div>
    );
  }

  const nodeMap = new Map(nodes.map((n, i) => [n.id, i]));

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height} style={{ border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)' }}>
        {/* Edges */}
        {edges.map(edge => {
          const si = nodeMap.get(edge.source_paper_id);
          const ti = nodeMap.get(edge.target_paper_id);
          if (si === undefined || ti === undefined) return null;
          const p1 = positions[si];
          const p2 = positions[ti];
          if (!p1 || !p2) return null;
          return (
            <g key={edge.id}>
              <line
                x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                stroke={EDGE_COLORS[edge.relation_type] || '#6b7280'}
                strokeWidth={1.5}
                strokeOpacity={0.5}
              />
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((node, i) => {
          const pos = positions[i];
          if (!pos) return null;
          const isHighlighted = node.id === highlightPaperId;
          const isHovered = hoveredNode === i;
          return (
            <g key={node.id}
              style={{ cursor: 'pointer' }}
              onClick={() => onNodeClick?.(node.id)}
              onMouseEnter={() => setHoveredNode(i)}
              onMouseLeave={() => setHoveredNode(null)}
            >
              {/* Glow for highlighted node */}
              {isHighlighted && (
                <circle cx={pos.x} cy={pos.y} r={16}
                  fill="none" stroke="var(--color-primary)" strokeWidth={2}
                  opacity={0.3}
                />
              )}
              {/* Node circle */}
              <circle cx={pos.x} cy={pos.y} r={isHovered ? 10 : 8}
                fill={isHighlighted ? 'var(--color-primary)' : '#d1d5db'}
                stroke={isHovered ? '#374151' : '#9ca3af'}
                strokeWidth={1.5}
                style={{ transition: 'r 0.15s' }}
              />
              {/* Label */}
              <text x={pos.x} y={pos.y + 20}
                textAnchor="middle" fontSize={10}
                fill={isHovered ? 'var(--color-text)' : 'var(--color-text-secondary)'}
                fontWeight={isHovered ? 600 : 400}
                style={{ pointerEvents: 'none' }}
              >
                {(() => {
                  const raw = node.title || node.authors || 'Untitled';
                  const title = typeof raw === 'string' ? raw : String(raw);
                  return title.length > 25 ? title.substring(0, 24) + '…' : title;
                })()}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.375rem', fontSize: '0.65rem' }}>
        {Object.entries(EDGE_LABELS).map(([type, label]) => (
          <span key={type} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span style={{ width: 10, height: 2, background: EDGE_COLORS[type], display: 'inline-block' }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
