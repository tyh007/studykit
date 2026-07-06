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
  '#475569',
  '#3b82f6',
  '#8b5cf6',
  '#22c55e',
  '#ef4444',
  '#0ea5e9',
  '#f59e0b',
  '#06b6d4',
  '#14b8a6',
  '#64748b',
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
  const [showStyle, setShowStyle] = useState(false);
  const [showCustom, setShowCustom] = useState(initialKind.id === 'custom');
  const [customLabel, setCustomLabel] = useState<string>(
    initialKind.id === 'custom' ? initialKind.label : ''
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && !showCustom) {
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
  }, [onCancel, kind, showCustom]);

  const selectPreset = (preset: RelationKind) => {
    setKind(preset);
    setShowStyle(false);
    onPick(preset);
  };

  const commitCustom = () => {
    const trimmed = customLabel.trim();
    if (!trimmed) {
      setShowCustom(false);
      return;
    }
    const next: RelationKind = {
      ...kind,
      id: 'custom',
      label: trimmed,
      isPaperRelation: false,
    };
    setKind(next);
    setShowCustom(false);
    onPick(next);
  };

  const updateStyle = (patch: Partial<RelationKind>) => {
    const next: RelationKind = { ...kind, ...patch };
    setKind(next);
    onPick(next);
  };

  const paperPresets = RELATION_PRESETS.filter(
    (p) => p.id !== 'link' && p.id !== 'custom'
  );
  const genericPresets = RELATION_PRESETS.filter((p) => p.id === 'link');

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
      }}
    >
      {bothPaper && (
        <>
          <div className="relation-type-menu-section-title">Literature relations</div>
          <div className="relation-type-menu-grid">
            {paperPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`relation-preset-chip ${kind.id === preset.id ? 'is-active' : ''}`}
                onClick={() => selectPreset(preset)}
                style={
                  {
                    ['--preset-color' as string]: preset.color,
                  } as React.CSSProperties
                }
                title={preset.description || preset.label}
              >
                <PresetGlyph preset={preset} />
                <span className="relation-preset-chip-label">{preset.label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="relation-type-menu-section-title">Other</div>
      <div className="relation-type-menu-grid is-secondary">
        {genericPresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`relation-preset-chip ${kind.id === preset.id ? 'is-active' : ''}`}
            onClick={() => selectPreset(preset)}
            style={
              {
                ['--preset-color' as string]: preset.color,
              } as React.CSSProperties
            }
            title={preset.description || preset.label}
          >
            <PresetGlyph preset={preset} />
            <span className="relation-preset-chip-label">{preset.label}</span>
          </button>
        ))}
        <button
          type="button"
          className={`relation-preset-chip is-custom ${showCustom ? 'is-active' : ''}`}
          onClick={() => setShowCustom((v) => !v)}
          style={
            {
              ['--preset-color' as string]: kind.color,
            } as React.CSSProperties
          }
          title="Add a custom relation label"
        >
          <span className="relation-preset-chip-glyph is-custom-glyph" aria-hidden>
            ＋
          </span>
          <span className="relation-preset-chip-label">Custom…</span>
        </button>
      </div>

      {showCustom && (
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
            placeholder="e.g. 启发, motivates"
            onChange={(event) => setCustomLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setShowCustom(false);
              }
            }}
            autoFocus
          />
          <button
            type="submit"
            className="relation-type-menu-custom-apply"
            disabled={!customLabel.trim()}
            style={
              {
                ['--preset-color' as string]: kind.color,
              } as React.CSSProperties
            }
          >
            Apply
          </button>
        </form>
      )}

      <button
        type="button"
        className="relation-type-menu-style-toggle"
        onClick={() => setShowStyle((v) => !v)}
        style={
          {
            ['--preset-color' as string]: kind.color,
          } as React.CSSProperties
        }
      >
        <span className="relation-type-menu-style-toggle-label">Style</span>
        <PresetGlyph preset={kind} small />
      </button>

      {showStyle && (
        <div className="relation-type-menu-style">
          <div className="relation-type-menu-section-title">Color</div>
          <div className="relation-type-menu-swatches">
            {SWATCH_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={`relation-type-menu-swatch ${kind.color === swatch ? 'is-active' : ''}`}
                onClick={() => updateStyle({ color: swatch })}
                style={{ background: swatch }}
                aria-label={`Color ${swatch}`}
                title={swatch}
              />
            ))}
          </div>

          <div className="relation-type-menu-section-title">End arrow</div>
          <div className="relation-type-menu-pills">
            {ARROW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`relation-type-menu-pill ${kind.arrowEnd === opt.value ? 'is-active' : ''}`}
                onClick={() => updateStyle({ arrowEnd: opt.value as ArrowSide })}
                style={
                  {
                    ['--preset-color' as string]: kind.color,
                  } as React.CSSProperties
                }
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="relation-type-menu-section-title">Start arrow</div>
          <div className="relation-type-menu-pills">
            {ARROW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`relation-type-menu-pill ${kind.arrowStart === opt.value ? 'is-active' : ''}`}
                onClick={() => updateStyle({ arrowStart: opt.value as ArrowSide })}
                style={
                  {
                    ['--preset-color' as string]: kind.color,
                  } as React.CSSProperties
                }
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="relation-type-menu-section-title">Line</div>
          <div className="relation-type-menu-pills">
            {DASH_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`relation-type-menu-pill ${kind.dashStyle === opt.value ? 'is-active' : ''}`}
                onClick={() => updateStyle({ dashStyle: opt.value as DashStyle })}
                style={
                  {
                    ['--preset-color' as string]: kind.color,
                  } as React.CSSProperties
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="relation-type-menu-footer">
        <button type="button" className="relation-type-menu-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="relation-type-menu-apply"
          onClick={() => onPick(kind)}
          style={
            {
              ['--preset-color' as string]: kind.color,
            } as React.CSSProperties
          }
        >
          Apply
        </button>
      </div>
    </div>
  );
}

function PresetGlyph({ preset, small = false }: { preset: RelationKind; small?: boolean }) {
  const dash =
    preset.dashStyle === 'solid'
      ? undefined
      : preset.dashStyle === 'dashed'
      ? '4 3'
      : '1 4';
  const w = small ? 22 : 28;
  return (
    <svg
      className="relation-preset-chip-glyph"
      width={w}
      height="10"
      viewBox="0 0 28 10"
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
        x2={preset.arrowEnd !== 'none' ? 20 : 26}
        y2="5"
        stroke={preset.color}
        strokeWidth="1.5"
        strokeDasharray={dash}
      />
      {preset.arrowEnd !== 'none' && (
        <path
          d={
            preset.arrowEnd === 'double'
              ? 'M26 1 L20 5 L26 9 M26 4 L21 5'
              : 'M20 5 L26 1 L26 9 Z'
          }
          fill={preset.arrowEnd === 'single' ? preset.color : 'none'}
          stroke={preset.color}
          strokeWidth="1.2"
        />
      )}
    </svg>
  );
}
