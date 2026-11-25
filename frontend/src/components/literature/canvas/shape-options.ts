export type CanvasShapeType =
  | 'rectangle'
  | 'rounded'
  | 'ellipse'
  | 'diamond'
  | 'pill'
  | 'triangle'
  | 'hexagon';

export interface CanvasShapeOption {
  value: CanvasShapeType;
  label: string;
}

export const CANVAS_SHAPE_OPTIONS: CanvasShapeOption[] = [
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'ellipse', label: 'Ellipse' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'pill', label: 'Pill' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'hexagon', label: 'Hexagon' },
];

export const CANVAS_SHAPE_FILLS = [
  '#F8FAFC',
  '#F5E5BE',
  '#F2D5D2',
  '#DCC8DC',
  '#CFE8D8',
  '#D6E4F0',
];

export const CANVAS_SHAPE_STROKES = [
  '#64748B',
  '#C08497',
  '#7AA68A',
  '#8B5CF6',
  '#3B82F6',
  '#F59E0B',
];

export function normalizeShapeType(value: unknown): CanvasShapeType {
  return CANVAS_SHAPE_OPTIONS.some((option) => option.value === value)
    ? (value as CanvasShapeType)
    : 'rectangle';
}
