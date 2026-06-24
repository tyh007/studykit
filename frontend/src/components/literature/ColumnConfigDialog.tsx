import React, { useState } from 'react';

const AVAILABLE_FIELDS = [
  { key: 'background', label: 'Background' },
  { key: 'theory', label: 'Theory & Hypotheses' },
  { key: 'methodology', label: 'Methodology' },
  { key: 'measures', label: 'Measures' },
  { key: 'results', label: 'Results' },
  { key: 'implications', label: 'Implications' },
  { key: 'limitations', label: 'Limitations' },
];

const STORAGE_KEY = 'lit-column-config';

export interface ColumnConfigItem {
  key: string;
  label: string;
  visible: boolean;
}

export function readColumnConfig(): ColumnConfigItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  // Default: all fields visible
  return AVAILABLE_FIELDS.map(f => ({ ...f, visible: true }));
}

export function saveColumnConfig(config: ColumnConfigItem[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function getVisibleColumnKeys(): string[] {
  return readColumnConfig().filter(c => c.visible).map(c => c.key);
}

interface ColumnConfigDialogProps {
  onClose: () => void;
  onSave: () => void;
}

export default function ColumnConfigDialog({ onClose, onSave }: ColumnConfigDialogProps) {
  const [columns, setColumns] = useState<ColumnConfigItem[]>(() => readColumnConfig());
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const toggleVisibility = (index: number) => {
    setColumns(prev => prev.map((c, i) => i === index ? { ...c, visible: !c.visible } : c));
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    setColumns(prev => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  };

  const moveDown = (index: number) => {
    if (index === columns.length - 1) return;
    setColumns(prev => {
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  };

  const handleSave = () => {
    saveColumnConfig(columns);
    onSave();
    onClose();
  };

  const handleReset = () => {
    const defaults = AVAILABLE_FIELDS.map(f => ({ ...f, visible: true }));
    setColumns(defaults);
    saveColumnConfig(defaults);
    onSave();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h2 style={{ marginBottom: '0.5rem' }}>Configure Columns</h2>
        <p className="text-sm text-muted" style={{ marginBottom: '1rem' }}>
          Toggle visibility and reorder columns in the summary table.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {columns.map((col, i) => (
            <div
              key={col.key}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.4rem 0.5rem', borderRadius: 'var(--radius-sm)',
                background: col.visible ? 'var(--color-bg)' : 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                opacity: col.visible ? 1 : 0.5,
              }}
            >
              <input
                type="checkbox"
                checked={col.visible}
                onChange={() => toggleVisibility(i)}
              />
              <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: col.visible ? 500 : 400 }}>
                {col.label}
              </span>
              <div style={{ display: 'flex', gap: '0.125rem' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={i === 0}
                  onClick={() => moveUp(i)}
                  style={{ fontSize: '0.7rem', padding: '0.125rem 0.25rem' }}
                  title="Move up"
                >
                  ▲
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={i === columns.length - 1}
                  onClick={() => moveDown(i)}
                  style={{ fontSize: '0.7rem', padding: '0.125rem 0.25rem' }}
                  title="Move down"
                >
                  ▼
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 justify-between" style={{ marginTop: '1rem' }}>
          <button className="btn" onClick={handleReset} style={{ color: 'var(--color-text-secondary)' }}>
            Reset
          </button>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
