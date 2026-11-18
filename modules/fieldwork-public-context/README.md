# Fieldwork public place context

An on-demand, keyless context layer for Coffee & Counter: inspect city registration candidates, recognized neighborhood businesses, transit stop locations, and analysis neighborhoods around a selected Overture place.

This package is native configuration: two managed HTTP integrations, four ephemeral remote types, eight graph bridges, and one geographic test anchor. It has no worker, poller, business-record import, automatic identity match, qualification score, or outreach.

## Useful questions

- Supplier research: What city tax-location records are near this venue's mapped position, and do the source name/address/dates support further verification?
- Neighborhood partnerships: Which nearby places are in the city's Legacy Business Registry, and what program status does the registry report?
- Field visits: Which published Muni stop locations are nearby, and which analysis neighborhood contains the point?

Each query starts from the selected place's Overture coordinates. A coordinate/address discrepancy in Overture therefore remains a discrepancy; these sources do not automatically correct or confirm the venue.

## Sources and bounded reads

| Native field key | Official source | Read recipe and limit | Important meaning |
| --- | --- | --- | --- |
| `nearbyRegistrations` | [Registered Business Locations](https://data.sf.gov/d/g8m3-pdis) | Nearest 10 within 100 m, including historic records | City tax-location records; neither verified venue identity nor current opening evidence. End dates and administrative-close values are retained. Owner names and mailing addresses are excluded. |
| `nearbyLegacyBusinesses` | [Official Legacy Business Registry](https://sfgov.maps.arcgis.com/apps/dashboards/471cc5798f8c486fb0f8e9ac8badaf03) | At most 8 within 500 m; registry active/in-transition statuses | Nearby registry membership does not mean the selected venue is a legacy business. Coordinates come from feature geometry, because latitude/longitude attributes are often null. |
| `nearbyTransitStops` | [Muni Stops](https://data.sf.gov/d/i28k-bkz6) | Nearest 8 within 400 m | Published static inventory, not arrivals, walking routes, live service, or accessibility certification. Source `data_as_of` was April 8, 2026 when verified. |
| `analysisNeighborhood` | [Analysis Neighborhoods](https://data.sf.gov/d/j2bu-swwd) | Containing area, at most 2 | Static census-tract analysis grouping, not an official or legal neighborhood designation. Dataset rows were last updated October 17, 2023 when verified. |

DataSF metadata declares PDDL 1.0 for these three datasets. The Legacy Registry layer exposes no explicit license; preserve official source attribution and use live reads rather than redistributing a bulk registry snapshot. The registry layer and business data were updated November 18, 2026 when checked. “Requested live” describes the request, not the age of the underlying dataset.

Requests have fixed provider-side row limits. Result sets are bounded candidates, not exhaustive directories. Distances supplied by Socrata are straight-line metres. ArcGIS legacy results are not distance-sorted; the interface may compute display distance from returned geometry.

## Install through Gyri MCP

Install the parent Overture Fieldwork schema first (`fieldwork_place`), then pass this `module.v2.json` as `$module`. The four place bridges declare `crossCluster:true` because they extend the parent module’s already-installed type; this does not grant access to another workspace:

```graphql
mutation InstallPublicContext($module: JSON!) {
  installGraphModule(module: $module, conflictPolicy: merge_update, allowExistingTypes: true) {
    moduleId
    errors
    warnings
    integrationBindings
    receipt
  }
}
```

Keep the returned `integrationBindings` and supply them on later module updates. This reuses the two managed endpoints instead of provisioning replacements.

The HTTP executor supports `httpTimeoutMs`, while the module's `provision.operations` schema currently does not preserve that field. `http-operations.json` contains the same operation definitions with an 8,000 ms transport limit. After initial install, read each bound endpoint's metadata, preserve its other keys, replace `operations` with the matching array from this file, and write it through:

```graphql
mutation BoundPublicContextTimeout($id: ID!, $metadata: JSON!) {
  updateWorkspaceHttpEndpoint(endpointId: $id, metadata: $metadata) {
    endpointId
    metadata
  }
}
```

This is a native connector configuration step, not a separate adapter service. No secret is needed. Do not claim the timeout was applied until endpoint readback confirms it. Existing native connector read-context timeout limits may be tighter.

## Read selected-place context

Use [selected-place.query.graphql](selected-place.query.graphql) with the actual record ID. Every `graphEdge` result has `ok`, `error`, and `remoteNodes`. Remote node values live under `remoteNodes[].fields`; common fields are `external_id`, `name`, `source_url`, `source_system`, and provider `data_as_of` when available.

Load context only on selection or an explicit request. Do not resolve four sources for all 486 places while opening the app. A short browser-session cache can reduce repeat requests. Native graph reads remain governed by the signed-in workspace role and resource policies. The adapter does not persist provider rows or mutate source places or team notes.

For the seeded area, first read `workspaceCustomRecords(typeKey:"fieldwork_context_area",limit:1) { recordId body }`. Its bridge field keys use `areaNearbyRegistrations`, `areaNearbyLegacyBusinesses`, `areaNearbyTransitStops`, and `areaAnalysisNeighborhood` to avoid generic GraphQL field collisions with place bridges.

An upstream failure is “unavailable,” not “no matches.” The current native ArcGIS JSON bridge does not automatically interpret a provider `{error:...}` response with HTTP 200. The interface must reject projected nodes missing `fields.external_id` or `fields.name` and show a source error if malformed nodes are present. Do not convert this case into a successful empty result.

## Verification

```bash
python3 modules/fieldwork-public-context/verify-live-sources.py \
  --output output/overture-fieldwork/research/native-context-live.json
```

The read-only smoke compiles the module's actual operation recipes, checks provider status and list shapes, rejects structured provider errors, and checks bounded result sizes. On November 18, 2026 at the explicit Polk Street sample point, it returned 10 registration records, 8 Muni stops, 6 Legacy Registry locations, and one analysis neighborhood (Nob Hill). Actual native response projection also verified nonempty identities, names, source links, and finite geometry/distance fields.

Module/schema parsing, native projection, and full live provider reads passed. The live Overture Fieldwork installation also verified all eight bridges, both keyless endpoints with 8-second per-operation limits, and all four selected-place graph reads. Source place count remained 486, remote source record counts remained zero, and one geographic test anchor was installed. The smoke script itself makes no graph mutations.
