export type PresetRelationType =
  | 'cites'
  | 'extends'
  | 'contradicts'
  | 'supports'
  | 'related'
  | 'method'
  | 'dataset'
  | 'link';

export type RelationTypeId = PresetRelationType | 'custom';

export type ArrowSide = 'none' | 'single' | 'double';
export type DashStyle = 'solid' | 'dashed' | 'dotted';

export interface RelationKind {
  id: RelationTypeId;
  label: string;
  color: string;
  arrowStart: ArrowSide;
  arrowEnd: ArrowSide;
  dashStyle: DashStyle;
  isPaperRelation: boolean;
}

export const RELATION_PRESETS: RelationKind[] = [
  {
    id: 'cites',
    label: 'Cites',
    color: '#3b82f6',
    arrowStart: 'none',
    arrowEnd: 'single',
    dashStyle: 'solid',
    isPaperRelation: true,
  },
  {
    id: 'extends',
    label: 'Extends',
    color: '#8b5cf6',
    arrowStart: 'none',
    arrowEnd: 'single',
    dashStyle: 'solid',
    isPaperRelation: true,
  },
  {
    id: 'contradicts',
    label: 'Contradicts',
    color: '#ef4444',
    arrowStart: 'none',
    arrowEnd: 'double',
    dashStyle: 'solid',
    isPaperRelation: true,
  },
  {
    id: 'supports',
    label: 'Supports',
    color: '#22c55e',
    arrowStart: 'none',
    arrowEnd: 'single',
    dashStyle: 'solid',
    isPaperRelation: true,
  },
  {
    id: 'related',
    label: 'Related',
    color: '#6b7280',
    arrowStart: 'none',
    arrowEnd: 'single',
    dashStyle: 'dashed',
    isPaperRelation: true,
  },
  {
    id: 'method',
    label: 'Same Method',
    color: '#f59e0b',
    arrowStart: 'none',
    arrowEnd: 'double',
    dashStyle: 'dotted',
    isPaperRelation: true,
  },
  {
    id: 'dataset',
    label: 'Same Dataset',
    color: '#06b6d4',
    arrowStart: 'none',
    arrowEnd: 'double',
    dashStyle: 'dotted',
    isPaperRelation: true,
  },
  {
    id: 'link',
    label: 'Link',
    color: '#64748b',
    arrowStart: 'none',
    arrowEnd: 'single',
    dashStyle: 'dashed',
    isPaperRelation: false,
  },
];

export const RELATION_PRESET_MAP: Record<PresetRelationType, RelationKind> =
  RELATION_PRESETS.reduce((acc, preset) => {
    if (preset.id !== 'custom') {
      acc[preset.id as PresetRelationType] = preset;
    }
    return acc;
  }, {} as Record<PresetRelationType, RelationKind>);

export const DASH_PATTERNS: Record<DashStyle, string | undefined> = {
  solid: undefined,
  dashed: '6 4',
  dotted: '1 5',
};

export const ARROW_OPTIONS: { value: ArrowSide; label: string }[] = [
  { value: 'none', label: 'No arrow' },
  { value: 'single', label: 'Single ▸' },
  { value: 'double', label: 'Double ▸▸' },
];

export const DASH_OPTIONS: { value: DashStyle; label: string }[] = [
  { value: 'solid', label: '── Solid' },
  { value: 'dashed', label: '╴╴╴ Dashed' },
  { value: 'dotted', label: '···· Dotted' },
];

export const DEFAULT_RELATION: RelationKind = RELATION_PRESET_MAP.link;

export function getPresetById(id: string | null | undefined): RelationKind | null {
  if (!id) return null;
  if ((RELATION_PRESETS as RelationKind[]).some((p) => p.id === id)) {
    return RELATION_PRESETS.find((p) => p.id === id) ?? null;
  }
  return null;
}

export function isPresetRelationType(value: string | null | undefined): value is PresetRelationType {
  if (!value) return false;
  return value in RELATION_PRESET_MAP;
}

export function readRelationKindFromEdge(edge: {
  edge_type?: 'canvas' | 'paper_relation' | null;
  relation_type?: string | null;
  label?: string | null;
  content_json?: Record<string, any> | null;
  style_json?: Record<string, any> | null;
}): RelationKind {
  const relType =
    edge.relation_type ||
    edge.content_json?.relation_type ||
    (edge.edge_type === 'paper_relation' ? 'related' : 'link');

  const style = (edge.style_json as Record<string, any>) || {};
  const content = (edge.content_json as Record<string, any>) || {};

  const preset = getPresetById(relType);
  const id: RelationTypeId = preset ? preset.id : 'custom';

  const label =
    typeof edge.label === 'string' && edge.label.trim().length > 0
      ? edge.label
      : content.custom_label || preset?.label || 'Link';

  const color =
    typeof style.color === 'string'
      ? style.color
      : preset?.color || DEFAULT_RELATION.color;

  const arrowStart = normalizeArrow(style.arrowStart) ?? preset?.arrowStart ?? DEFAULT_RELATION.arrowStart;
  const arrowEnd = normalizeArrow(style.arrowEnd) ?? preset?.arrowEnd ?? DEFAULT_RELATION.arrowEnd;
  const dashStyle =
    normalizeDash(style.dashStyle) ?? preset?.dashStyle ?? DEFAULT_RELATION.dashStyle;

  return {
    id,
    label,
    color,
    arrowStart,
    arrowEnd,
    dashStyle,
    isPaperRelation: edge.edge_type === 'paper_relation' && id !== 'custom',
  };
}

export function kindToEdgePayload(kind: RelationKind): {
  edge_type: 'canvas' | 'paper_relation';
  relation_type: string;
  label: string | null;
  content_json: Record<string, any>;
  style_json: Record<string, any>;
} {
  const isPaper = kind.isPaperRelation && kind.id !== 'custom';
  return {
    edge_type: isPaper ? 'paper_relation' : 'canvas',
    relation_type: kind.id,
    label: kind.label,
    content_json: {
      relation_type: kind.id,
      ...(kind.id === 'custom' ? { custom_label: kind.label } : {}),
    },
    style_json: {
      color: kind.color,
      arrowStart: kind.arrowStart,
      arrowEnd: kind.arrowEnd,
      dashStyle: kind.dashStyle,
    },
  };
}

function normalizeArrow(value: unknown): ArrowSide | null {
  return value === 'none' || value === 'single' || value === 'double' ? value : null;
}

function normalizeDash(value: unknown): DashStyle | null {
  return value === 'solid' || value === 'dashed' || value === 'dotted' ? value : null;
}
