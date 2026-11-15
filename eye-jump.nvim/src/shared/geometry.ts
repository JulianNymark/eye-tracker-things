import type { Geometry } from './model';

export const GEOMETRY_FIELDS = [
  { key: 'widthMm', label: 'Panel width', min: 100, max: 2000, placeholder: 'e.g. 1196.7', description: 'Exclude the bezel.' },
  { key: 'heightMm', label: 'Panel height', min: 80, max: 1200, placeholder: 'e.g. 339.2', description: 'Exclude the bezel.' },
  { key: 'bottomMm', label: 'Bottom above tracker', min: -500, max: 500, placeholder: 'e.g. 15', description: 'Sensor center to bottom edge.' },
  { key: 'depthMm', label: 'Panel depth offset', min: -500, max: 500, placeholder: 'e.g. 0', description: '− screen behind tracker · + screen toward you' },
] as const;

export type GeometryInput = Record<keyof Geometry, string>;
export type GeometryErrors = Partial<Record<keyof Geometry, string>>;

export function sameGeometry(a: Geometry | null | undefined, b: Geometry | null | undefined): boolean {
  return Boolean(a && b && GEOMETRY_FIELDS.every(field => a[field.key] === b[field.key]));
}

export function parseGeometry(input: GeometryInput): { value: Geometry | null; errors: GeometryErrors } {
  const errors: GeometryErrors = {};
  const value = {} as Geometry;
  for (const field of GEOMETRY_FIELDS) {
    const raw = input[field.key].trim();
    if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(raw)) {
      errors[field.key] = `Enter ${field.label.toLowerCase()} in millimeters.`;
      continue;
    }
    const number = Number(raw.replace(',', '.'));
    if (!Number.isFinite(number) || number < field.min || number > field.max) {
      errors[field.key] = `${field.label} must be between ${field.min} and ${field.max} mm.`;
      continue;
    }
    value[field.key] = number;
  }
  return { value: Object.keys(errors).length ? null : value, errors };
}
