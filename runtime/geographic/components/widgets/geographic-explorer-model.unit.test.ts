import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  filterGeographicRows,
  formatGeographicSourceDate,
  geographicCoordinates,
  geographicCsv,
  geographicDistance,
  geographicValue,
  safeGeographicUrl,
  type GeographicFieldMap,
  type GeographicRow,
} from './geographic-explorer-model';

const fields: GeographicFieldMap = {
  id: 'record_id', name: 'venue_name', category: 'kind', categoryLabel: 'kind_label',
  address: 'address', latitude: 'latitude', longitude: 'longitude', website: 'website',
  status: 'review_status', notes: 'notes', owner: 'owner', nextAction: 'next_action',
  sourceId: 'gers_id', mapUrl: 'map_url', release: 'data_release',
  visitStatus: 'visit_status', plannedVisit: 'planned_visit_at',
};
const noFilters = { search: '', category: '', status: '', website: '' };
const place = (patch: GeographicRow = {}): GeographicRow => ({
  record_id: 'place-a', venue_name: 'North Counter', kind: 'cafe', kind_label: 'Cafe',
  address: '10 Market Street', latitude: 37.79, longitude: -122.4,
  website: 'https://example.com/', review_status: 'unreviewed', ...patch,
});

/** Read RFC 4180 fields independently of the exporter's quoting choices. */
function csvRows(csv: string): string[][] {
  const rows: string[][] = [], row: string[] = [];
  let field = '', quoted = false;
  const content = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < content.length; i += 1) {
    const c = content[i];
    if (c === '"') {
      if (quoted && content[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (!quoted && c === ',') { row.push(field); field = ''; }
    else if (!quoted && (c === '\n' || c === '\r')) {
      if (c === '\r' && content[i + 1] === '\n') i += 1;
      row.push(field); rows.push([...row]); row.length = 0; field = '';
    } else field += c;
  }
  row.push(field); rows.push(row);
  return rows;
}

afterEach(() => vi.unstubAllEnvs());

describe('geographic place data', () => {
  it.each([
    { latitude: null }, { longitude: undefined }, { latitude: '' }, { longitude: '  ' },
    { latitude: true }, { longitude: false }, { latitude: [] }, { latitude: 'unknown' },
    { latitude: Infinity }, { longitude: Number.NaN }, { latitude: 90.01 },
    { latitude: -90.01 }, { longitude: 180.01 }, { longitude: -180.01 },
  ])('does not manufacture a map point from invalid coordinates: %j', invalid => {
    expect(geographicCoordinates(place(invalid), fields)).toBeNull();
  });

  it('accepts valid numeric source strings and keeps a real zero coordinate', () => {
    expect(geographicCoordinates(place({ latitude: '37.79', longitude: '-122.4' }), fields)).toEqual([37.79, -122.4]);
    expect(geographicCoordinates(place({ latitude: 0, longitude: 0 }), fields)).toEqual([0, 0]);
    expect(geographicCoordinates(place({ latitude: 90, longitude: 180 }), fields)).toEqual([90, 180]);
  });

  it('reports straight-line distance in metres, including coincident points', () => {
    expect(geographicDistance([37.79, -122.4], [37.79, -122.4])).toBe(0);
    const equatorialDegree = geographicDistance([0, 0], [0, 1]);
    expect(equatorialDegree).toBeGreaterThan(111_000);
    expect(equatorialDegree).toBeLessThan(111_400);
    const shortNorthwardDistance = geographicDistance([37.79, -122.4], [37.791, -122.4]);
    expect(shortNorthwardDistance).toBeGreaterThan(110);
    expect(shortNorthwardDistance).toBeLessThan(113);
  });

  it('honors field bindings without allowing body fields to stand in for canonical values', () => {
    expect(geographicValue({ body: { display_name: 'Bound venue' } }, { name: 'body.display_name' }, 'name')).toBe('Bound venue');
    expect(geographicValue({ body: { display_name: 'Bound venue' } }, { name: 'body.missing' }, 'name')).toBeUndefined();
  });
});

describe('research views over the complete place slice', () => {
  it('keeps all 486 records filterable, including the final source record', () => {
    const rows = Array.from({ length: 486 }, (_, index) => place({
      record_id: `place-${index}`, venue_name: `Venue ${String(index).padStart(3, '0')}`,
      notes: index === 485 ? 'Final source record' : '',
    }));
    expect(filterGeographicRows(rows, fields, noFilters)).toHaveLength(486);
    expect(filterGeographicRows(rows, fields, { ...noFilters, search: 'final source record' }).map(row => row.record_id)).toEqual(['place-485']);
    expect(rows[0].record_id).toBe('place-0');
  });

  it('combines preset categories, OR-within-field filters, and explicit filters with AND semantics', () => {
    const rows = [
      place({ record_id: 'wanted', venue_name: 'North Bakery', kind: 'bakery', notes: 'Check seasonal menu', review_status: 'shortlisted', visit_status: 'planned' }),
      place({ record_id: 'wrong-preset-status', kind: 'bakery', notes: 'Check seasonal menu', review_status: 'passed', visit_status: 'planned' }),
      place({ record_id: 'wrong-preset-field', kind: 'bakery', notes: 'Check seasonal menu', review_status: 'shortlisted', visit_status: 'cancelled' }),
      place({ record_id: 'wrong-category', kind: 'coffee_shop', notes: 'Check seasonal menu', review_status: 'shortlisted', visit_status: 'planned' }),
      place({ record_id: 'wrong-search', kind: 'bakery', notes: 'Call later', review_status: 'shortlisted', visit_status: 'planned' }),
      place({ record_id: 'wrong-explicit-status', kind: 'bakery', notes: 'Check seasonal menu', review_status: 'verify_first', visit_status: 'planned' }),
      place({ record_id: 'missing-website', kind: 'bakery', notes: 'Check seasonal menu', review_status: 'shortlisted', visit_status: 'planned', website: '' }),
    ];
    const result = filterGeographicRows(rows, fields, {
      preset: { id: 'research', label: 'Research', categories: ['bakery', 'coffee_shop'], filters: { review_status: ['shortlisted', 'verify_first'], visit_status: 'planned' } },
      search: ' SEASONAL ', category: 'bakery', status: 'shortlisted', website: 'listed',
    });
    expect(result.map(row => row.record_id)).toEqual(['wanted']);
  });

  it('finds notes and owners case-insensitively, and treats absent review state as unreviewed', () => {
    const row = place({ review_status: undefined, owner: 'Sam Rivera', notes: 'Address needs verification' });
    expect(filterGeographicRows([row], fields, { ...noFilters, search: 'RIVERA', status: 'unreviewed' })).toEqual([row]);
    expect(filterGeographicRows([row], fields, { ...noFilters, search: 'verification' })).toEqual([row]);
    expect(filterGeographicRows([row], fields, { ...noFilters, status: 'visited' })).toEqual([]);
  });

  it('does not treat an unsafe or malformed URL as listed website evidence', () => {
    const rows = [place({ record_id: 'safe' }), place({ record_id: 'unsafe', website: 'javascript:alert(1)' }), place({ record_id: 'missing', website: null })];
    expect(filterGeographicRows(rows, fields, { ...noFilters, website: 'listed' }).map(row => row.record_id)).toEqual(['safe']);
    expect(filterGeographicRows(rows, fields, { ...noFilters, website: 'missing' }).map(row => row.record_id).sort()).toEqual(['missing', 'unsafe']);
  });
});

describe('public source dates and links', () => {
  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'mailto:user@example.com', 'https://user:secret@example.com/', 'https://user@example.com/', '/relative/path', 'not a URL', null])('rejects unsafe or non-web links: %s', value => {
    expect(safeGeographicUrl(value)).toBeNull();
  });

  it('accepts ordinary absolute website URLs without removing their useful path or query', () => {
    expect(safeGeographicUrl(' https://example.com/venue?q=coffee#menu ')).toBe('https://example.com/venue?q=coffee#menu');
    expect(safeGeographicUrl('http://example.com/place')).toBe('http://example.com/place');
  });

  it('keeps calendar source dates stable in a west-coast browser and handles ArcGIS epochs', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    const sourceDate = '2026-04-08';
    const epoch = Date.UTC(2026, 3, 8);
    const sourceCalendarDay = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date('2026-04-08T12:00:00Z'));
    expect(formatGeographicSourceDate(sourceDate)).toBe(sourceCalendarDay);
    expect(formatGeographicSourceDate(epoch)).toBe(sourceCalendarDay);
    expect(formatGeographicSourceDate(String(epoch))).toBe(sourceCalendarDay);
    expect(formatGeographicSourceDate('1979')).toBe('1979');
    expect(formatGeographicSourceDate(null)).toBe('Not supplied');
    expect(formatGeographicSourceDate('No source date')).toBe('No source date');
  });

  it('formats pre-1970 ArcGIS dates from either numeric or string epochs', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    const epoch = Date.UTC(1950, 0, 1);
    const expected = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date('1950-01-01T12:00:00Z'));
    expect(formatGeographicSourceDate(epoch)).toBe(expected);
    expect(formatGeographicSourceDate(String(epoch))).toBe(expected);
  });
});

describe('research view CSV export', () => {
  it('retains source identity and numeric coordinates while quoting notes and escaping formulas', () => {
    const row = place({
      gers_id: 'gers-source-486', venue_name: 'A "quoted", counter',
      notes: '=HYPERLINK("https://example.com")\nSecond line', owner: '+SUM(1,2)',
      next_action: '  @external', map_url: 'https://www.openstreetmap.org/?mlat=37.79&mlon=-122.4',
      planned_visit_at: '2026-11-19T18:30:00.000Z', data_release: '2026-11-18.0',
    });
    const [header, exported] = csvRows(geographicCsv([row], fields));
    const record = Object.fromEntries(header.map((name, index) => [name, exported[index]]));
    expect(record['Source place ID']).toBe('gers-source-486');
    expect(record.Latitude).toBe('37.79');
    expect(record.Longitude).toBe('-122.4');
    expect(record.Place).toBe('A "quoted", counter');
    expect(record['Research notes']).toBe('\'=HYPERLINK("https://example.com")\nSecond line');
    expect(record['Research owner']).toBe("'+SUM(1,2)");
    expect(record['Next step']).toBe("'  @external");
    expect(record['Map URL']).toContain('openstreetmap.org');
    expect(record['Planned visit (ISO)']).toBe('2026-11-19T18:30:00.000Z');
    expect(record['Source release']).toBe('2026-11-18.0');
    expect(header.every(label => !label.includes('_'))).toBe(true);
  });
});
