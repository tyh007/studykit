import React, { useEffect, useRef, useState } from 'react';
import {
  ARROW_OPTIONS,
  DASH_OPTIONS,
  DEFAULT_RELATION,
  RELATION_PRESETS,
  type ArrowSide,
  type DashStyle,
  type RelationKind,
} from './relation-types';

interface Props {
  position: { x: number; y: number };
  onPick: (kind: RelationKind) => void;
  onCancel: () => void;
  initialKind?: RelationKind;
  bothPaper?: boolean;
}

const SWATCH_COLORS = [
  '#64748b',
  '#3b82f6',
  '#8b5cf6',
  '#ef4444',
  '#22c55e',
  '#f59e0b',
  '#06b6d4',
  '#0f172a',
];

export default function RelationTypeMenu({
  position,
  onPick,
  onCancel,
  initialKind = DEFAULT_RELATION,
  bothPaper = true,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [kind, setKind] = useState<RelationKind>(initialKind);
  const [showStyle, setShowStyle] = useState<RelationKind['id'] | null>(null);
  const [customLabel, setCustomLabel] = useState<string>(
    initialKind.id === 'custom' ? initialKind.label : ''
  );
  const [showCustomInput, setShowCustomInput] = useState<boolean>(initialKind.id === 'custom');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && !showCustomInput) {
        onPick(kind);
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCancel, kind, showCustomInput]);

  const selectPreset = (preset: RelationKind) => {
    setKind({ ...preset, label: preset.label, id: preset.id });
    setShowStyle(null);
    setShowCustomInput(false);
    onPick(preset);
  };

  const commitCustom = () => {
    const trimmed = customLabel.trim();
    if (!trimmed) {
      setShowCustomInput(false);
      return;
    }
    const next: RelationKind = {
      ...kind,
      id: 'custom',
      label: trimmed,
      isPaperRelation: false,
    };
    setKind(next);
    setShowCustomInput(false);
    onPick(next);
  };

  const updateStyle = (patch: Partial<RelationKind>) => {
    const next: RelationKind = { ...kind, ...patch };
    setKind(next);
    onPick(next);
  };

  const visiblePresets = bothPaper
    ? RELATION_PRESETS
    : RELATION_PRESETS.filter((preset) => preset.id === 'link' || preset.id === 'related');

  return (
    <div
      ref={ref}
      className="relation-type-menu"
      role="dialog"
      aria-label="Relation type"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 80,
        background: 'var(--glass-liquid-floating, #fff)',
        border: '1px solid var(--color-border, #e5e7eb)',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)',
        padding: '0.4rem',
        minWidth: 220,
        maxWidth: 280,
        font: 'inherit',
        color: 'inherit',
      }}
    >
      <div className="relation-type-menu-section-title">Relation type</div>
      {visiblePresets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className={`relation-type-menu-item ${kind.id === preset.id ? 'is-active' : ''}`}
          onClick={() => selectPreset(preset)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            background: kind.id === preset.id ? 'color-mix(in srgb, ' + preset.color + ' 14%, transparent)' : 'transparent',
            border: 'none',
            textAlign: 'left',
            padding: '0.4rem 0.5rem',
            cursor: 'pointer',
            font: 'inherit',
            color: 'inherit',
            borderRadius: 4,
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              background: preset.color,
              borderRadius: '50%',
              display: 'inline-block',
              flexShrink: 0,
            }}
            aria-hidden
          />
          <span style={{ flex: 1 }}>{preset.label}</span>
          <PresetGlyph preset={preset} />
        </button>
      ))}

      <button
        type="button"
        className={`relation-type-menu-item ${kind.id === 'custom' ? 'is-active' : ''}`}
        onClick={() => {
          setShowCustomInput((v) => !v);
          setShowStyle(null);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          background:
            kind.id === 'custom'
              ? 'color-mix(in srgb, ' + kind.color + ' 14%, transparent)'
              : 'transparent',
          border: 'none',
          textAlign: 'left',
          padding: '0.4rem 0.5rem',
          cursor: 'pointer',
          font: 'inherit',
          color: 'inherit',
          borderRadius: 4,
        }}
      >
        <span
          style={{
            width: 12,
            height: 12,
            background: kind.id === 'custom' ? kind.color : 'transparent',
            border: '1.5px dashed currentColor',
            borderRadius: '50%',
            display: 'inline-block',
            flexShrink: 0,
          }}
          aria-hidden
        />
        <span style={{ flex: 1 }}>Custom…</span>
      </button>

      {showCustomInput && (
        <form
          className="relation-type-menu-custom"
          onSubmit={(event) => {
            event.preventDefault();
            commitCustom();
          }}
        >
          <input
            type="text"
            value={customLabel}
            placeholder="Relation label (e.g. 启发, extends method)"
            onChange={(event) => setCustomLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setShowCustomInput(false);
              }
            }}
            autoFocus
            style={{
              width: '100%',
              padding: '0.35rem 0.5rem',
              font: 'inherit',
              fontSize: '0.8rem',
              border: '1px solid var(--color-border, #e5e7eb)',
              borderRadius: 4,
              background: 'transparent',
              color: 'inherit',
            }}
          />
          <button
            type="submit"
            className="relation-type-menu-custom-apply"
            disabled={!customLabel.trim()}
            style={{
              marginTop: 4,
              padding: '0.3rem 0.6rem',
              border: 'none',
              borderRadius: 4,
              background: customLabel.trim() ? kind.color : 'var(--color-border, #e5e7eb)',
              color: '#fff',
              cursor: customLabel.trim() ? 'pointer' : 'not-allowed',
              font: 'inherit',
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            Apply
          </button>
        </form>
      )}

      <div style={{ borderTop: '1px solid var(--color-border, #e5e7eb)', margin: '0.4rem 0' }} />

      <button
        type="button"
        className="relation-type-menu-style-toggle"
        onClick={() => setShowStyle((curr) => (curr ? null : kind.id))}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          background: 'transparent',
          border: 'none',
          textAlign: 'left',
          padding: '0.4rem 0.5rem',
          cursor: 'pointer',
          font: 'inherit',
          color: 'inherit',
          borderRadius: 4,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: '0.78rem' }}>Style</span>
        <PresetGlyph preset={kind} />
      </button>

      {showStyle && (
        <div className="relation-type-menu-style">
          <div className="relation-type-menu-section-title">Color</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(8, 1fr)',
              gap: 4,
              marginBottom: 8,
            }}
          >
            {SWATCH_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() => updateStyle({ color: swatch })}
                aria-label={`Color ${swatch}`}
                title={swatch}
                style={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  borderRadius: 4,
                  background: swatch,
                  border: kind.color === swatch ? '2px solid currentColor' : '1px solid var(--color-border, #e5e7eb)',
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}
          </div>

          <div className="relation-type-menu-section-title">End arrow</div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {ARROW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => updateStyle({ arrowEnd: opt.value as ArrowSide })}
                className={`relation-type-menu-pill ${kind.arrowEnd === opt.value ? 'is-active' : ''}`}
                style={pillStyle(kind.arrowEnd === opt.value, kind.color)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="relation-type-menu-section-title">Start arrow</div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {ARROW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => updateStyle({ arrowStart: opt.value as ArrowSide })}
                className={`relation-type-menu-pill ${kind.arrowStart === opt.value ? 'is-active' : ''}`}
                style={pillStyle(kind.arrowStart === opt.value, kind.color)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="relation-type-menu-section-title">Line style</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {DASH_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => updateStyle({ dashStyle: opt.value as DashStyle })}
                className={`relation-type-menu-pill ${kind.dashStyle === opt.value ? 'is-active' : ''}`}
                style={pillStyle(kind.dashStyle === opt.value, kind.color)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginTop: 8 }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '0.35rem 0.7rem',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            font: 'inherit',
            color: 'var(--color-text-secondary, #6b7280)',
            borderRadius: 4,
            fontSize: '0.78rem',
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onPick(kind)}
          style={{
            padding: '0.35rem 0.7rem',
            border: 'none',
            background: kind.color,
            color: '#fff',
            cursor: 'pointer',
            font: 'inherit',
            borderRadius: 4,
            fontSize: '0.78rem',
            fontWeight: 600,
          }}
        >
          Apply ({kind.label})
        </button>
      </div>
    </div>
  );
}

function pillStyle(active: boolean, color: string): React.CSSProperties {
  return {
    flex: 1,
    padding: '0.3rem 0.4rem',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '0.72rem',
    background: active
      ? color
      : 'color-mix(in srgb, var(--color-bg, #fff) 60%, transparent)',
    color: active ? '#fff' : 'inherit',
    fontWeight: active ? 600 : 500,
  };
}

function PresetGlyph({ preset }: { preset: RelationKind }) {
  const dash =
    preset.dashStyle === 'solid' ? undefined : preset.dashStyle === 'dashed' ? '4 3' : '1 4';
  return (
    <svg
      width="36"
      height="10"
      viewBox="0 0 36 10"
      style={{ flexShrink: 0, marginLeft: 4 }}
      aria-hidden
    >
      {preset.arrowStart !== 'none' && (
        <path
          d={preset.arrowStart === 'double' ? 'M2 1 L8 5 L2 9 M2 4 L7 5' : 'M8 5 L2 1 L2 9 Z'}
          fill={preset.arrowStart === 'single' ? preset.color : 'none'}
          stroke={preset.color}
          strokeWidth="1.2"
        />
      )}
      <line
        x1={preset.arrowStart !== 'none' ? 8 : 2}
        y1="5"
        x2={preset.arrowEnd !== 'none' ? 28 : 34}
        y2="5"
        stroke={preset.color}
        strokeWidth="1.5"
        strokeDasharray={dash}
      />
      {preset.arrowEnd !== 'none' && (
        <path
          d={
            preset.arrowEnd === 'double'
              ? 'M34 1 L28 5 L34 9 M34 4 L29 5'
              : 'M28 5 L34 1 L34 9 Z'
          }
          fill={preset.arrowEnd === 'single' ? preset.color : 'none'}
          stroke={preset.color}
          strokeWidth="1.2"
        />
      )}
    </svg>
  );
}
