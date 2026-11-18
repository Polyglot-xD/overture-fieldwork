import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import leafletStyles from '../../vendor/leaflet/leaflet.css';
import { rest } from '../../api/rest';
import { geographicExplorerStyles } from './geographic-explorer-styles';
import { filterGeographicRows, formatGeographicSourceDate, geographicCoordinates, geographicCsv, geographicDistance, geographicValue, safeGeographicUrl, type GeographicFieldMap, type GeographicPreset, type GeographicRow } from './geographic-explorer-model';

type Json = Record<string, unknown>;
type ContextSource = { edgeKey?: string; fieldKey?: string; title?: string; description?: string; disclaimer?: string; freshness?: string; provider?: string; sourceUrl?: string; dataAsOf?: string; limit?: number; fields?: Record<string, string> };
type ContextResult = { ok?: boolean; error?: string | null; remoteNodes?: Array<{ fields?: Json; raw?: Json }>; cacheStatus?: string | null };
type ContextState = { checkedAt: number; results: ContextResult[]; error?: string };
type Props = { name: string; description?: string; rows: GeographicRow[]; options?: Json; loading?: boolean; onOpenRecord?: (id: string) => void; onRefresh?: () => void };
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const text = (value: unknown) => value == null ? '' : Array.isArray(value) ? value.map(String).join(', ') : String(value);
const words = (value: unknown) => text(value).replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const statuses: Record<string, string> = { unreviewed: 'Not yet reviewed', verify_first: 'Needs a check', shortlisted: 'Shortlisted', visited: 'Visited', passed: 'Passed' };
function Icon({ kind = 'pin' }: { kind?: string }) {
  const paths: Record<string, ReactNode> = {
    pin: <><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    supply: <><path d="M4 9h13v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Z"/><path d="M17 10h2a3 3 0 0 1 0 6h-2M7 3v3m4-3v3m4-3v3"/></>,
    neighborhood: <><path d="M3 21V10l5-4 5 4v11M13 21V5l4-3 4 3v16M1 21h22M6 13h4m-4 4h4m6-9h2m-2 4h2m-2 4h2"/></>,
    visit: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Zm6-3v15m6-12v15"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    export: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/></>,
    link: <><path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/></>,
    check: <path d="m4 12 5 5L20 6"/>,
  };
  return <svg className="geo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind] || paths.pin}</svg>;
}
const date = formatGeographicSourceDate;

function visitDate(value: unknown): string { if (!value) return 'Time not set'; const d = new Date(text(value)); return Number.isNaN(d.getTime()) ? text(value) : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); }

function GeographicMap({ rows, fields, selectedId, onSelect, fitVersion, options }: { rows: GeographicRow[]; fields: GeographicFieldMap; selectedId: string; onSelect: (id: string) => void; fitVersion: number; options: Json }) {
  const root = useRef<HTMLDivElement>(null), map = useRef<any>(null), layer = useRef<any>(null), firstFit = useRef(false), leaflet = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const pointsRef = useRef<[number, number][]>([]);
  pointsRef.current = rows.flatMap(row => { const point = geographicCoordinates(row, fields); return point ? [point] : []; });
  const [mapError, setMapError] = useState(false);
  const select = useRef(onSelect); select.current = onSelect;
  useEffect(() => {
    if (!root.current) return;
    let disposed = false, instance: any, observer: ResizeObserver | undefined;
    void import('../../vendor/leaflet/leaflet.esm.js').then(L => {
      if (disposed || !root.current) return;
      leaflet.current = L;
      const center = Array.isArray(options.center) ? options.center.map(Number) : [0, 0];
      instance = L.map(root.current, { scrollWheelZoom: false, zoomControl: true, preferCanvas: true }).setView([center[1], center[0]], Number(options.zoom) || 12);
      map.current = instance;
      const tileUrl = typeof options.tileUrl === 'string' && options.tileUrl.startsWith('https://') ? options.tileUrl : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
      L.tileLayer(tileUrl, { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors' }).on('tileerror', () => setMapError(true)).addTo(instance);
      layer.current = L.layerGroup().addTo(instance);
      observer = new ResizeObserver(() => {
        instance.invalidateSize({ animate: false });
        if (!firstFit.current && root.current?.clientWidth && pointsRef.current.length) { instance.fitBounds(L.latLngBounds(pointsRef.current).pad(.09), { maxZoom: 15, animate: false }); firstFit.current = true; }
      }); observer.observe(root.current);
      setReady(true);
    }).catch(() => { if (!disposed) setMapError(true); });
    return () => { disposed = true; observer?.disconnect(); instance?.remove(); map.current = null; firstFit.current = false; };
  }, []);
  useEffect(() => {
    const L = leaflet.current;
    if (!map.current || !layer.current || !L) return;
    layer.current.clearLayers();
    const points: [number, number][] = [];
    for (const row of rows) {
      const point = geographicCoordinates(row, fields); if (!point) continue;
      points.push(point);
      const id = text(geographicValue(row, fields, 'id')), selected = id === selectedId;
      const marker = L.circleMarker(point, { radius: selected ? 10 : 5, weight: selected ? 3 : 1.5, color: '#ffffff', fillColor: selected ? '#c95536' : '#26775e', fillOpacity: selected ? 1 : .82 });
      const tip = document.createElement('span'); tip.textContent = text(geographicValue(row, fields, 'name'));
      marker.bindTooltip(tip, { direction: 'top' }); marker.on('click', () => select.current(id)); marker.addTo(layer.current);
      if (selected) marker.bringToFront();
    }
    if (!firstFit.current && root.current?.clientWidth && points.length) { map.current.fitBounds(L.latLngBounds(points).pad(.09), { maxZoom: 15, animate: false }); firstFit.current = true; }
  }, [ready, rows, fields, selectedId]);
  useEffect(() => {
    if (!map.current) return; const points = rows.flatMap(row => { const p = geographicCoordinates(row, fields); return p ? [p] : []; });
    if (points.length && leaflet.current) map.current.fitBounds(leaflet.current.latLngBounds(points).pad(.12), { maxZoom: 17, animate: false });
  }, [fitVersion, ready]);
  useEffect(() => { const row = rows.find(row => text(geographicValue(row, fields, 'id')) === selectedId); const point = row && geographicCoordinates(row, fields); if (point && map.current && !map.current.getBounds().contains(point)) map.current.panTo(point, { animate: false }); }, [selectedId]);
  return <><div ref={root} className="geo-map" aria-label="Map of matching places. The place list provides the same selections using a keyboard."/>{mapError ? <div className="geo-map-error" role="status">Some map tiles are unavailable. You can keep browsing every place in the list.</div> : null}</>;
}

export function GeographicWorkspaceExplorer({ name, description, rows, options = {}, onOpenRecord, onRefresh }: Props) {
  const statusLabels = { ...statuses, ...object(options.statusLabels) } as Record<string, string>;
  const fields = useMemo(() => object(options.fieldMap) as GeographicFieldMap, [options.fieldMap]);
  const presets = useMemo(() => Array.isArray(options.presets) ? options.presets as GeographicPreset[] : [], [options.presets]);
  const [presetId, setPresetId] = useState(text(options.defaultPreset) || 'all');
  const [search, setSearch] = useState(''), [category, setCategory] = useState(''), [status, setStatus] = useState(''), [website, setWebsite] = useState('');
  const [selectedId, setSelectedId] = useState(''), [mobileMode, setMobileMode] = useState('list'), [fitVersion, setFitVersion] = useState(0);
  const [context, setContext] = useState<Record<string, ContextState>>({}), [contextBusy, setContextBusy] = useState('');
  const requestEpoch = useRef(0);
  const sources = useMemo(() => Array.isArray(options.contextSources) ? options.contextSources as ContextSource[] : [], [options.contextSources]);
  const preset = presets.find(p => p.id === presetId);
  const matching = useMemo(() => filterGeographicRows(rows, fields, { preset, search, category, status, website }), [rows, fields, preset, search, category, status, website]);
  const selected = matching.find(row => text(geographicValue(row, fields, 'id')) === selectedId) || null;
  const value = (row: GeographicRow, key: string) => geographicValue(row, fields, key);
  const categories = useMemo(() => [...new Map(rows.map(row => [text(geographicValue(row, fields, 'category')), text(geographicValue(row, fields, 'categoryLabel')) || words(geographicValue(row, fields, 'category'))])).entries()].filter(([key]) => key).sort((a, b) => a[1].localeCompare(b[1])), [rows, fields]);
  const shortlistCount = rows.filter(row => value(row, 'status') === 'shortlisted').length;
  const visitCount = rows.filter(row => value(row, 'visitStatus') === 'planned').length;
  const release = rows.map(row => text(value(row, 'release'))).find(Boolean);
  const selectPlace = useCallback((id: string) => { setSelectedId(id); }, []);
  const changePreset = (id: string) => { setPresetId(id); setCategory(''); setStatus(''); setWebsite(''); setSearch(''); setSelectedId(''); setFitVersion(n => n + 1); };
  const clearFilters = () => { setSearch(''); setCategory(''); setStatus(''); setWebsite(''); };
  useEffect(() => { if (selectedId && !selected) setSelectedId(''); requestEpoch.current++; setContextBusy(''); }, [selectedId, Boolean(selected)]);
  const loadContext = async (force = false) => {
    if (!selected || !sources.length) return;
    const id = text(value(selected, 'id'));
    if (!force && context[id] && Date.now() - context[id].checkedAt < 300000) return;
    const epoch = ++requestEpoch.current; setContextBusy(id);
    try {
      const variables: Json = { id };
      const declarations = ['$id:String!'];
      const selections = sources.map((source, index) => {
        declarations.push(`$edge${index}:String!`); variables[`edge${index}`] = source.fieldKey || source.edgeKey;
        return `s${index}:graphEdge(fieldKey:$edge${index},limit:${Math.min(20, Math.max(1, Number(source.limit) || 8))}){ok error remoteNodes}`;
      });
      const payload = await rest<{ data?: { workspaceCustomRecord?: Record<string, ContextResult> }; errors?: Array<{ message: string }> }>('/graphql', { method: 'POST', body: { query: `query GeographicContext(${declarations.join(',')}){workspaceCustomRecord(recordId:$id){${selections.join(' ')}}}`, variables } });
      if (payload.errors?.length) throw Error(payload.errors[0].message);
      if (!payload.data?.workspaceCustomRecord) throw Error('The selected record could not be read.');
      if (epoch === requestEpoch.current) setContext(current => ({ ...current, [id]: { checkedAt: Date.now(), results: sources.map((_, i) => payload.data!.workspaceCustomRecord![`s${i}`] || { ok: false, error: 'This source returned no result.' }) } }));
    } catch (error) { if (epoch === requestEpoch.current) setContext(current => ({ ...current, [id]: { checkedAt: Date.now(), results: [], error: error instanceof Error ? error.message : 'City context is unavailable.' } })); }
    finally { if (epoch === requestEpoch.current) setContextBusy(''); }
  };
  const download = () => {
    const blob = new Blob([geographicCsv(matching, fields)], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `place-research-${presetId}-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const activeContext = selected ? context[text(value(selected, 'id'))] : null;
  const websiteUrl = selected ? safeGeographicUrl(value(selected, 'website')) : null;
  const mapUrl = selected ? safeGeographicUrl(value(selected, 'mapUrl')) : null;
  return <section className="geo-workspace" aria-label={name}>
    <style>{String(leafletStyles)}{geographicExplorerStyles}</style>
    <header className="geo-hero"><div className="geo-kicker">A place to start. Evidence to go further.</div><h2>{name}</h2><p>{description || 'Explore places, understand the evidence, and keep your next step with the record.'}</p><div className="geo-hero-meta"><span><strong>{rows.length.toLocaleString()}</strong> places in this snapshot</span><span><strong>{shortlistCount}</strong> shortlisted</span><span><strong>{visitCount}</strong> planned visits</span>{release ? <span>Overture release <strong>{release}</strong></span> : null}</div></header>
    <div className="geo-usecases" aria-label="Research purpose">{presets.slice(0, 3).map((p, index) => <button key={p.id} className="geo-usecase" type="button" aria-pressed={presetId === p.id} onClick={() => changePreset(p.id)}><Icon kind={['supply', 'neighborhood', 'visit'][index]}/><b>{p.label}</b><span>{p.description}</span></button>)}</div>
    <nav className="geo-tabs" aria-label="Saved research views">{presets.slice(3).map(p => <button type="button" className="geo-tab" key={p.id} aria-pressed={presetId === p.id} onClick={() => changePreset(p.id)}>{p.label}{p.id === 'shortlist' ? ` · ${shortlistCount}` : p.id === 'visits' ? ` · ${visitCount}` : ''}</button>)}</nav>
    {preset?.guidance ? <p className="geo-guidance">{preset.guidance}</p> : null}
    <div className="geo-toolbar"><div className="geo-search-row"><label className="geo-search"><Icon kind="search"/><span className="sr-only">Search places, streets, notes or owners</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search a place, street, note, or owner…" aria-label="Search places, streets, notes or owners"/></label><button type="button" className="geo-button geo-export" disabled={!matching.length} onClick={download}><Icon kind="export"/>Export this view</button></div><div className="geo-filters"><label className="geo-field">Venue type<select value={category} onChange={event => setCategory(event.target.value)}><option value="">All venue types</option>{categories.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><label className="geo-field">Team review<select value={status} onChange={event => setStatus(event.target.value)}><option value="">All review states</option>{Object.entries(statusLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><label className="geo-field">Website<select value={website} onChange={event => setWebsite(event.target.value)}><option value="">Any website status</option><option value="listed">Website listed</option><option value="missing">No website listed</option></select></label><button type="button" className="geo-button" onClick={clearFilters}>Clear filters</button></div></div>
    <div className="geo-results-line"><div aria-live="polite"><strong>{matching.length.toLocaleString()} places</strong>{preset ? ` · ${preset.label}` : ''}{search ? ` matching “${search}”` : ''}</div><div className="geo-mode" aria-label="Mobile view"><button className="geo-button" aria-pressed={mobileMode === 'list'} onClick={() => setMobileMode('list')}>List</button><button className="geo-button" aria-pressed={mobileMode === 'map'} onClick={() => setMobileMode('map')}>Map & details</button></div></div>
    <div className="geo-grid" data-mobile={mobileMode}>
      <div className="geo-results" aria-label="Matching places">{matching.length ? matching.map(row => {
        const id = text(value(row, 'id')), rowStatus = text(value(row, 'status')) || 'unreviewed';
        return <button type="button" className="geo-place" aria-pressed={selectedId === id} key={id} onClick={() => selectPlace(id)}><div className="geo-place-title"><b>{text(value(row, 'name')) || 'Unnamed place'}</b><Icon kind="pin"/></div><p className="geo-place-address">{text(value(row, 'address')) || 'Address not supplied'}</p><div className="geo-place-footer"><span className="geo-tag">{text(value(row, 'categoryLabel')) || words(value(row, 'category'))}</span><span className={`geo-tag ${rowStatus === 'shortlisted' || rowStatus === 'visited' ? 'geo-tag-green' : rowStatus === 'verify_first' ? 'geo-tag-amber' : 'geo-tag-neutral'}`}>{statusLabels[rowStatus] || words(rowStatus)}</span></div>{value(row, 'nextAction') ? <p className="geo-next">Next: {text(value(row, 'nextAction'))}</p> : null}{value(row, 'visitStatus') === 'planned' ? <p className="geo-next">Visit planned · {visitDate(value(row, 'plannedVisit'))}</p> : null}</button>;
      }) : <div className="geo-empty"><h3>{search || category || status || website ? 'No places match these filters' : preset?.emptyTitle || 'No places in this view yet'}</h3><p>{search || category || status || website ? 'Try a different word or clear a filter. Your saved research stays in the workspace.' : preset?.emptyDescription || 'Choose a place from the complete snapshot to start your research.'}</p><button className="geo-button geo-button-primary" onClick={() => changePreset('all')}>Explore all places</button></div>}</div>
      <div className="geo-map-column"><div className="geo-map-shell"><GeographicMap rows={matching} fields={fields} selectedId={selectedId} onSelect={selectPlace} fitVersion={fitVersion} options={object(options.map)}/><button type="button" className="geo-button geo-map-fit" onClick={() => setFitVersion(v => v + 1)}>Fit results</button><div className="geo-map-caption"><span className="geo-legend"><span><i className="geo-legend-dot"/>Matching place</span><span><i className="geo-legend-dot geo-legend-selected"/>Selected</span></span><span>{matching.filter(row => geographicCoordinates(row, fields)).length} map locations</span></div></div>
      {selected ? <article className="geo-detail" aria-label="Selected place details"><div className="geo-detail-head"><div><span className="geo-kicker" style={{ color: '#176b50' }}>{text(value(selected, 'categoryLabel'))}</span><h3>{text(value(selected, 'name'))}</h3><p>{text(value(selected, 'address')) || 'Address not supplied'}</p></div><span className={`geo-tag ${value(selected, 'status') === 'shortlisted' ? 'geo-tag-green' : 'geo-tag-neutral'}`}>{statusLabels[text(value(selected, 'status'))] || 'Not yet reviewed'}</span></div><div className="geo-detail-actions"><button className="geo-button geo-button-primary" onClick={() => onOpenRecord?.(text(value(selected, 'id')))}>Open research notebook</button>{websiteUrl ? <a className="geo-button" href={websiteUrl} target="_blank" rel="noopener noreferrer">Website<Icon kind="link"/></a> : null}{mapUrl ? <a className="geo-button" href={mapUrl} target="_blank" rel="noopener noreferrer">View on map<Icon kind="link"/></a> : null}</div><div className="geo-detail-grid"><div><span className="geo-meta-label">Source operating status</span><span className="geo-meta-value">{words(value(selected, 'sourceStatus')) || 'Unknown'} · source report</span></div><div><span className="geo-meta-label">Website evidence</span><span className="geo-meta-value">{websiteUrl ? 'URL listed in source' : 'No URL listed in source'}</span></div><div><span className="geo-meta-label">Research owner</span><span className="geo-meta-value">{text(value(selected, 'owner')) || 'Unassigned'}</span></div><div><span className="geo-meta-label">Next step</span><span className="geo-meta-value">{text(value(selected, 'nextAction')) || 'Add a next step in the notebook'}</span></div>{value(selected, 'visitStatus') ? <div><span className="geo-meta-label">Visit plan</span><span className="geo-meta-value">{words(value(selected, 'visitStatus'))} · {visitDate(value(selected, 'plannedVisit'))}</span></div> : null}{value(selected, 'verificationStatus') ? <div><span className="geo-meta-label">Evidence check</span><span className="geo-meta-value">{words(value(selected, 'verificationStatus'))}</span></div> : null}</div>{value(selected, 'notes') ? <div className="geo-note"><b className="geo-note-label">Team research notes</b>{text(value(selected, 'notes'))}</div> : null}
        {sources.length ? <section className="geo-context" aria-label="Public source context"><div className="geo-context-head"><h4>More context, directly from the source</h4><button type="button" className="geo-button" disabled={contextBusy === selectedId} onClick={() => void loadContext(Boolean(activeContext))}>{contextBusy === selectedId ? 'Checking sources…' : activeContext ? 'Refresh sources' : 'Check city context'}</button></div><p className="geo-context-description">Nearby records can help your research. They are not confirmed matches to this venue. Distances are approximate straight-line distances.</p>{activeContext?.error ? <p className="geo-status-note" role="alert">{activeContext.error} Your place data and research are still available.</p> : null}<div className="geo-context-sources">{sources.map((source, i) => {
          const result = activeContext?.results[i], providerError = result?.remoteNodes?.some(node => object(node.raw).error || !node.fields?.external_id || !node.fields?.name);
          const remote = (result?.remoteNodes || []).filter(node => node.fields?.name && node.fields?.external_id);
          return <article className="geo-source" key={source.fieldKey || source.edgeKey}><div className="geo-source-head"><b>{source.title || words(source.fieldKey || source.edgeKey)}</b>{safeGeographicUrl(source.sourceUrl) ? <a href={safeGeographicUrl(source.sourceUrl)!} target="_blank" rel="noopener noreferrer">Source</a> : null}</div>{source.provider ? <p>{source.provider}</p> : null}{source.description || source.disclaimer ? <p>{source.description || source.disclaimer}</p> : null}{source.dataAsOf || source.freshness ? <p>{source.dataAsOf ? `Source date: ${source.dataAsOf}` : source.freshness}</p> : null}{!activeContext ? <p>Available on demand</p> : result?.ok === false || providerError ? <p role="status">This source could not return results. Try refreshing it.</p> : activeContext.error ? null : <details className="geo-source-details"><summary>{remote.length ? `Inspect ${remote.length} source record${remote.length === 1 ? '' : 's'}` : 'No nearby records returned'}</summary><div className="geo-source-results">{remote.length ? remote.map((node, index) => {
            const f = object(node.fields), center = geographicCoordinates(selected, fields);
            const point: [number, number] | null = f.latitude != null && f.longitude != null ? [Number(f.latitude), Number(f.longitude)] : null;
            const distance = Number(f.distance_m ?? (point && center ? geographicDistance(center, point) : NaN));
            const sourceLink = safeGeographicUrl(f.source_url);
            return <div className="geo-source-result" key={text(f.external_id) || index}><b>{text(f.name || f.business_name || f.nhood || f.stop_name) || 'Source record'}</b>{f.address ? <span>{text(f.address)}</span> : null}{Number.isFinite(distance) ? <span>About {Math.round(distance)} m away</span> : null}{f.status ? <span>{text(f.status)}</span> : null}{f.data_as_of ? <span>Data as of {date(f.data_as_of)}</span> : null}{Object.entries(source.fields || {}).filter(([key]) => f[key] != null && f[key] !== '').map(([key,label]) => <span key={key}>{label}: {/date|_at$/.test(key) ? date(f[key]) : text(f[key])}</span>)}{sourceLink ? <a href={sourceLink} target="_blank" rel="noopener noreferrer">View source record</a> : null}</div>;
          }) : <p>No nearby records returned by this source. This does not establish whether the venue appears elsewhere in it.</p>}</div></details>}</article>;
        })}</div>{activeContext ? <p className="geo-context-description">Queried {new Date(activeContext.checkedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}. Source datasets have their own update schedules.</p> : null}</section> : null}
      </article> : <article className="geo-detail"><div className="geo-kicker" style={{ color: '#176b50' }}>Start with a place</div><h3>Every good shortlist has a reason.</h3><p>Select a map pin or a place in the list. Check its source evidence, compare nearby city context, and save the next useful step in its research notebook.</p><div className="geo-note"><b className="geo-note-label">Your team’s judgment stays yours</b>Opening hours, ownership, purchasing interest and supplier fit need direct verification. A map record is a starting point.</div></article>}
      </div>
    </div><footer className="geo-footer"><span>{text(options.sourceNote) || 'A source snapshot with your team’s current research alongside it.'}<br/>Data: {safeGeographicUrl(options.sourceUrl) ? <a href={safeGeographicUrl(options.sourceUrl)!} target="_blank" rel="noopener noreferrer">{text(options.sourceLabel) || 'Workspace sources'}</a> : text(options.sourceLabel) || 'Workspace sources'}. Source contributor notices remain attached to each record.</span>{onRefresh ? <button className="geo-button" onClick={onRefresh}>Refresh workspace data</button> : null}</footer>
  </section>;
}
