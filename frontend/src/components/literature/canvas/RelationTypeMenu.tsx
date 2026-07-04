import React, { useEffect, useRef } from 'react';

export type RelationType =
  | 'cites'
  | 'extends'
  | 'contradicts'
  | 'supports'
  | 'related'
  | 'method'
  | 'dataset';

export const RELATION_TYPE_OPTIONS: { value: RelationType; label: string; color: string }[] = [
  { value: 'cites', label: 'Cites', color: '#3b82f6' },
  { value: 'extends', label: 'Extends', color: '#8b5cf6' },
  { value: 'contradicts', label: 'Contradicts', color: '#ef4444' },
  { value: 'supports', label: 'Supports', color: '#22c55e' },
  { value: 'related', label: 'Related', color: '#6b7280' },
  { value: 'method', label: 'Same Method', color: '#f59e0b' },
  { value: 'dataset', label: 'Same Dataset', color: '#06b6d4' },
];

interface Props {
  position: { x: number; y: number };
  onPick: (type: RelationType) => void;
  onCancel: () => void;
}

export default function RelationTypeMenu({ position, onPick, onCancel }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [onCancel]);

  return (
    <div
      ref={ref}
      className="relation-type-menu"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 60,
        background: '#fff',
        border: '1px solid var(--color-border, #e5e7eb)',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
        padding: '0.25rem',
        minWidth: 160,
      }}
    >
      <div
        style={{
          fontSize: '0.7rem',
          color: 'var(--color-text-muted, #6b7280)',
          padding: '0.25rem 0.4rem',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        Relation type
      </div>
      {RELATION_TYPE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          className="relation-type-menu-item"
          onClick={() => onPick(opt.value)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            background: 'transparent',
            border: 'none',
            textAlign: 'left',
            padding: '0.4rem 0.5rem',
            cursor: 'pointer',
            font: 'inherit',
            borderRadius: 4,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              background: opt.color,
              borderRadius: '50%',
              display: 'inline-block',
            }}
          />
          {opt.label}
        </button>
      ))}
    </div>
  );
}
