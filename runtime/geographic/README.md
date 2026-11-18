# Geographic workspace explorer

The new reusable map/list renderer contributed for Coffee & Counter. The module supplies the venue schema, intent presets, labels and source catalog; these files contain the generic interface.

## Included files

- `components/widgets/GeographicWorkspaceExplorer.tsx`: React explorer, selected-place evidence, on-demand graph context, map/list selection and CSV export.
- `components/widgets/geographic-explorer-model.ts`: field mapping, filters, coordinate validation, source-date formatting, distance, safe external URLs and CSV preparation.
- `components/widgets/geographic-explorer-styles.ts`: scoped responsive styles.
- `components/widgets/geographic-explorer-model.unit.test.ts`: 33 meaningful model regressions, including invalid coordinates, complete result filtering, filter composition, unsafe URLs, calendar/epoch dates and spreadsheet-safe exports.
- `vendor/leaflet/`: Leaflet 1.9.4 JavaScript and CSS with its BSD 2-Clause license.

## Host integration

These are source contributions for Gyri's React/TypeScript runtime, not a standalone application. Copy `components/widgets/*` to the corresponding Gyri `ui/src/components/widgets/` location and `vendor/leaflet/*` to `ui/src/vendor/leaflet/`. The relative imports deliberately preserve that layout. The runtime's existing authentication, workspace scope, semantic query execution, record notebook and permission enforcement remain host responsibilities. An explicit workspace in the page URL must remain scoped to that tab; another tab changing shared browser storage must not redirect its data or actions into a different workspace.

The renderer imports a host `rest` adapter from `../../api/rest`. Its context request is `rest('/graphql', {method:'POST', body:{query,variables}})`, returning the decoded GraphQL response. Supply an equivalent authenticated, workspace-scoped adapter if integrating elsewhere. No provider credential or direct database access is required.

Expose `GeographicWorkspaceExplorer` through the host semantic renderer kind `geographic`. Pass the semantic component's name, description, complete bounded rows and `rendererOptions` as `options`; pass `onOpenRecord(recordId)` to open the native place notebook and `onRefresh()` for data reload. The host geographic data plan must admit up to 500 rows so all 486 source places are included. The saved component files provide complete field bindings and presets.

`options.contextSources` declares graph field keys, result limits, source links, warnings, freshness and optional per-result field labels. Context reads run only after the user requests them. Install the public context module so `workspaceCustomRecord(recordId:$id).graphEdge(...)` resolves those fields. Keep remote records ephemeral and separate from local team judgments.

Leaflet is dynamically imported when the map mounts. Import its CSS as a **text string**: the renderer injects it beside its scoped styles. Gyri's esbuild configuration uses `'.css':'text'` for this contribution; equivalent bundlers need a string-loading rule. TypeScript hosts should declare CSS text and the vendored JavaScript module as needed. Map tiles default to OpenStreetMap with attribution; saved list research remains available if tiles fail.

The notebook actions rely on a separate generic Gyri capability: the record action executor honors `xGyriExistingRecordIdField` with `existing_record_only`, locks and merges the selected record, and checks write permission. The dialog renders JSON Schema `textarea` and `date-time` formats, converting local visit time to an ISO instant. Those existing private platform files are intentionally outside this source bundle; older runtimes must fail closed rather than create a replacement record.

## Validation

The geographic model tests run with Vitest in the Gyri host. Together with the host action-dialog tests, the implementation passed 43 UI tests. The published model suite has no platform imports and can also run in a TypeScript/Vitest project. An isolated test run does not validate host permissions, GraphQL wiring or deployment.

Leaflet's upstream license is preserved at `vendor/leaflet/LICENSE`. The Overture snapshot and public source feeds retain their separate attribution and terms.
