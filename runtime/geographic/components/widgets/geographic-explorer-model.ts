export type GeographicRow = Record<string, unknown>;
export type GeographicFieldMap = Record<string, string>;
export type GeographicPreset = { id: string; label: string; description?: string; guidance?: string; categories?: string[]; filters?: Record<string, unknown>; emptyTitle?: string; emptyDescription?: string };

export function geographicValue(row: GeographicRow, fields: GeographicFieldMap, key: string): unknown {
  const path = fields[key] || key;
  return path.split('.').reduce<unknown>((value, part) => value && typeof value === 'object' && !Array.isArray(value) ? (value as GeographicRow)[part] : undefined, row);
}

export function geographicCoordinates(row: GeographicRow, fields: GeographicFieldMap): [number, number] | null {
  const rawLat = geographicValue(row, fields, 'latitude'), rawLon = geographicValue(row, fields, 'longitude');
  if (rawLat == null || rawLon == null || rawLat === '' || rawLon === '') return null;
  if (!['number', 'string'].includes(typeof rawLat) || !['number', 'string'].includes(typeof rawLon)) return null;
  if (typeof rawLat === 'string' && !rawLat.trim() || typeof rawLon === 'string' && !rawLon.trim()) return null;
  const lat = Number(rawLat), lon = Number(rawLon);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
}

export function geographicDistance(a: [number, number], b: [number, number]): number {
  const radians = Math.PI / 180;
  const dLat = (b[0] - a[0]) * radians, dLon = (b[1] - a[1]) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * radians) * Math.cos(b[0] * radians) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function filterGeographicRows(rows: GeographicRow[], fields: GeographicFieldMap, state: { preset?: GeographicPreset; search: string; category: string; status: string; website: string }): GeographicRow[] {
  const query = state.search.trim().toLocaleLowerCase();
  return rows.filter(row => {
    const category = String(geographicValue(row, fields, 'category') ?? '');
    if (state.preset?.categories?.length && !state.preset.categories.includes(category)) return false;
    if (state.preset?.filters && !Object.entries(state.preset.filters).every(([key, expected]) => Array.isArray(expected) ? expected.includes(row[key]) : row[key] === expected)) return false;
    if (state.category && category !== state.category) return false;
    if (state.status && String(geographicValue(row, fields, 'status') ?? 'unreviewed') !== state.status) return false;
    const hasWebsite = Boolean(safeGeographicUrl(geographicValue(row, fields, 'website')));
    if (state.website === 'listed' && !hasWebsite || state.website === 'missing' && hasWebsite) return false;
    return !query || ['name', 'categoryLabel', 'address', 'website', 'notes', 'owner', 'nextAction', 'brand'].some(key => String(geographicValue(row, fields, key) ?? '').toLocaleLowerCase().includes(query));
  }).sort((a, b) => String(geographicValue(a, fields, 'name') ?? '').localeCompare(String(geographicValue(b, fields, 'name') ?? '')));
}

export function safeGeographicUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}

/** Provider calendar dates stay on their source date, including ArcGIS epochs. */
export function formatGeographicSourceDate(value: unknown): string {
  if (value == null || value === '') return 'Not supplied';
  const raw = String(value);
  if (/^\d{4}$/.test(raw)) return raw;
  const parsed = typeof value === 'number' || /^-?\d{11,}$/.test(raw) ? new Date(Number(value)) : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function geographicCsv(rows: GeographicRow[], fields: GeographicFieldMap): string {
  const keys = ['sourceId', 'name', 'categoryLabel', 'address', 'latitude', 'longitude', 'website', 'mapUrl', 'status', 'notes', 'owner', 'nextAction', 'visitStatus', 'plannedVisit', 'release'];
  const labels = ['Source place ID', 'Place', 'Venue type', 'Address', 'Latitude', 'Longitude', 'Website', 'Map URL', 'Team review', 'Research notes', 'Research owner', 'Next step', 'Visit status', 'Planned visit (ISO)', 'Source release'];
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (typeof value === 'string' && /^\s*[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return '\uFEFF' + [labels.map(cell).join(','), ...rows.map(row => keys.map(key => cell(geographicValue(row, fields, key))).join(','))].join('\r\n');
}
