# Coffee & Counter

**Pitch:** A shared map and research workspace that turns open place data into a deliberate supplier, neighborhood-partner or field-visit queue.

**Live workspace:** [Explore Coffee & Counter](https://app.gyri.io/pages/fieldwork?kb_ws=overture-fieldwork). Sign in with an invited Gyri account. The app uses the existing workspace's records, permissions, evidence and history.

## Why this product

A venue list is useful only until someone has to decide what to check next. Suppliers need a focused research queue. Neighborhood teams need context for a potential collaboration. Field researchers need to remember where they planned to go and what they actually found. Coffee & Counter keeps those decisions beside the place and its evidence instead of spreading them across map bookmarks, notes and spreadsheets.

## Three working use cases

- **Supplier prospects:** Start with coffee shops, cafes, bakeries, roasteries and sandwich venues. Inspect the menu or website, check the supplied address, and write a relevant next step before shortlisting. The category identifies a research starting point; it does not assert buying interest, purchasing authority or supplier fit.
- **Neighborhood partners:** Explore the area, compare public business context, and keep the reason a venue might suit an event or collaboration. City registrations and legacy-business context are independent evidence. Similar names, a shared address or proximity are candidate matches, not proof of identity or willingness to partner.
- **Field research:** Select a place, verify important facts, and record an internal visit plan. Field visits shows plans marked planned. Confirm opening hours separately, use the map for location context, and record actual observations after completing a visit. A plan is not a booking, and the app does not claim to optimize a route.

## Interface and information hierarchy

Explore provides intent presets, map/list views, search and venue/review filters. The selected place keeps source observations and team judgment distinct. Open its place workspace for guarded actions: update review, edit research notes, set a next step and optional owner, choose a research purpose, plan or cancel a visit, record an actual visit, or record an evidence check.

Team shortlist is a shared workspace view, not a personal filter. Field visits shows the team's internal plans. Both use the same place records, so edits appear consistently across the app. Sources & method explains scope, attribution, independent source refreshes and uncertainty. The raw source browser and workspace overview remain available as advanced navigation.

The geographic renderer is a reusable native Gyri capability configured with field bindings and presets. The module carries the use cases, wording, source context and view defaults. It does not introduce a tenant-specific service or worker.

The visual contract uses clear dark text, a restrained forest accent, a distinct caution color, readable 16px body text and 14px labels. Map marks and review states also have text equivalents. Keyboard focus, meaningful button labels, responsive map/list layouts and explicit empty/loading/error states are part of the renderer contract. Empty queues explain the next useful action; they do not contain fabricated sample prospects or decisions.

## Data, provenance and team judgment

The initial snapshot contains **486 places**, including 166 coffee shops, 115 cafes, 62 sandwich shops and 61 bakeries. It uses Overture places release **2026-11-18.0**, bbox `[-122.422, 37.775, -122.393, 37.801]`, twelve explicitly selected primary categories and confidence at least 0.80. Source records explicitly marked permanently closed are excluded; unknown operating status remains unknown. **422** places have a website URL supplied by the source.

The source release is a snapshot date, not a guarantee that every upstream observation is current. Confidence estimates place existence, not quality or partner fit. A listed website has not automatically been checked. Missing brand metadata does not establish independent ownership. Different Overture/GERS IDs can still describe the same physical business; no name-only deduplication erases that evidence.

The semantic module-local type is `fieldwork_place`. GERS identity, release, version, coordinates, source providers, licenses and raw properties remain attached. Public-source context is requested independently, with its own provenance and freshness. A public response is not silently promoted into a confirmed venue match.

Team-owned fields are separate: `review_status`, `research_notes`, `owner`, `next_action`, `last_verified_at`, `research_focus`, `visit_status`, `planned_visit_at`, `visit_notes`, `verification_status`, `verification_notes` and `verification_source_url`. Missing visit or verification values mean no plan or check has been recorded. These fields survive source refreshes. Existing required source fields and the five original review states are preserved.

Review states are unreviewed, verify first, shortlisted, visited and passed. A shortlist is a research decision. Mark visited only after an actual visit. Record an evidence check only after inspecting the stated source. No completed reviews, verification dates or visit observations are fabricated during installation.

## Reproduce the source slice

From the repository root:

```bash
python3 -m venv .codex-tmp/overture-venv
.codex-tmp/overture-venv/bin/pip install -r scripts/overture/requirements.txt
.codex-tmp/overture-venv/bin/python scripts/overture/extract_places.py \
  --release 2026-11-18.0 \
  --bbox=-122.422,37.775,-122.393,37.801 \
  --download-licenses
```

The maintained extractor writes raw GeoJSON, normalized JSONL, applicable license copies and a provenance/hash manifest under `output/overture-fieldwork/`. It reapplies the exact bbox and pins the resolved release. `focus-places.jsonl` is the deployed slice. See the [extraction documentation](../../scripts/overture/README.md).

## Install through Gyri MCP

Create an isolated invite-only workspace through the governed workspace operation, using an organization where the actor has `org:create_workspace`. Install this module by passing the `module.v2.json` contents as `$module`:

```graphql
mutation InstallFieldwork($module: JSON!) {
  installGraphModule(module: $module, conflictPolicy: merge_update) {
    moduleId
    errors
    warnings
  }
}
```

The package installs the place schema, three concept-widget pages, four semantic components, two source/progress dashboards, a shared research kanban, navigation and eight guarded existing-record actions. Companion JSON files are reviewable copies of the artifacts embedded in the module.

The runtime must support the generic `geographic` semantic renderer and bounded 500-record geographic data plan. The record action executor must support `xGyriExistingRecordIdField` paired with `existing_record_only`; it locks and merges the selected existing record instead of creating a replacement. The action dialog understands multiline notes and local date/time inputs. Older executors must fail closed. No special user identity or workspace credential is packaged here.

`navigation.json` is the optional focused-sidebar override. It hides default core navigation while retaining the module's navigation contribution. Apply it only in the intended app workspace with `setWorkspaceNavigation(nav:$nav)`; copying the module's items into an override would duplicate them.

## Governed import and refresh

Read the complete existing `fieldwork_place` inventory through MCP and save its observed count and IDs in a scoped snapshot. An empty snapshot is valid only after native readback confirms zero records. See the [import procedure](../../scripts/overture/IMPORT.md).

```bash
python3 scripts/overture/prepare_import.py \
  --workspace-id overture-fieldwork \
  --existing-records output/overture-fieldwork/existing-records.json \
  --output-dir output/overture-fieldwork/initial-import
```

Submit each generated request through Gyri MCP `act`, supplying the connected `link_id` separately. Check the mutation status and every per-row error. Requests default to at most twenty places and 80,000 encoded UTF-8 bytes. Verify the count, all expected record IDs, and source evidence through native queries. Never load graph content through SQL.

For each refresh, obtain a new complete native inventory and prepare a fresh request directory. Existing places receive source fields only; team fields and aliases must be preserved. Do not replay old initialization requests after edits begin. A missing source record is not automatically deleted or marked closed. Invitations use the live workspace access model and native invitation flow; recipient identities are not part of this portable package.

## Trade-offs and cuts

The bounded snapshot keeps all 486 places available within the geographic view's 500-record limit. Independent public data adds context through governed on-demand federation; availability, freshness and source coverage remain explicit. Source disagreement is exposed for review rather than hidden behind an automatic fit score.

Map locations can conflict with supplied addresses. Straight-line spatial context does not estimate walking time. The app does not provide live opening-hours guarantees, automatic entity matching, route optimization, contact enrichment, bookings or outbound campaigns. Research purpose, next steps, verification and visits are team decisions.

Data attribution: Overture Maps Foundation and its source contributors. Per-record metadata and the extraction bundle retain applicable CDLA-Permissive-2.0, Apache-2.0 and CC0-1.0 notices. See [Overture attribution](https://docs.overturemaps.org/attribution/), the [Foursquare places notice](https://opensource.foursquare.com/places-notice-txt/) and [OpenStreetMap attribution](https://www.openstreetmap.org/copyright). Public city sources retain their own terms in the federation source catalog. Existing Gyri runtime code keeps its repository license.
