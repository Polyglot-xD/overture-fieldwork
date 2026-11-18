# Coffee & Counter

A shared map and research workspace that turns open place data into a deliberate supplier, neighborhood-partner or field-visit queue.

**[Open the deployed app](https://app.gyri.io/pages/fieldwork?kb_ws=overture-fieldwork)** — sign in with an invited Gyri account.

## Why this

A venue map answers where. A field team also needs to remember what it checked, why a place matters and who should do what next. Coffee & Counter keeps that work beside its evidence in Gyri's shared records, permissions and revision history.

The immutable public snapshot contains **486 downtown San Francisco places** from Overture release **2026-11-18.0**. Explore includes an embedded map, a keyboard-accessible place list, search, intent presets and category/review/website filters. Select a place for its source facts and team notes; open its research notebook to save a decision, owner, next step, evidence check or visit plan. Team shortlist and Field visits are shared views of those same records. Editors can save; invited viewers can read.

[Connect your AI](https://app.gyri.io/pages/fieldwork_connect?kb_ws=overture-fieldwork) shows the canonical MCP URL and current workspace's OAuth instructions. Accept your invitation first, then use your own sign-in and select **Only this workspace**; no owner key is shared. Data & connections offers advanced discovery of connections, HTTP source operations, data types, graph relationships, components and pages. Viewers can inspect metadata while write permissions remain separate.

## Three uses

- **Supplier prospects:** Find coffee shops, cafés, bakeries, roasteries and counter-service venues; check the evidence and capture a relevant next step. A category is a research starting point, not proof of buying interest.
- **Neighborhood partners:** Inspect nearby public business context and record why a venue might suit an event or collaboration. Nearby records remain candidate evidence rather than confirmed venue matches.
- **Field research:** Build an internal visit queue, check important facts and record actual observations afterward. Confirm opening hours separately; plans are not bookings or optimized routes.

## Four public sources, requested on demand

The selected place's **Check city context** button requests bounded native graph reads from:

- [SF Registered Business Locations](https://data.sf.gov/d/g8m3-pdis): nearby tax-location records, including historic records and lifecycle dates.
- [SF Legacy Business Registry](https://sfgov.maps.arcgis.com/apps/dashboards/471cc5798f8c486fb0f8e9ac8badaf03): nearby recognized businesses and their registry program status.
- [Muni Stops](https://data.sf.gov/d/i28k-bkz6): published stop locations, not arrivals or service predictions.
- [Analysis Neighborhoods](https://data.sf.gov/d/j2bu-swwd): census-tract analysis areas, not legal neighborhood boundaries.

Each source keeps its attribution, freshness and limitations visible. A live request does not make an old dataset current. Straight-line proximity does not establish identity, walking time or partner fit. The [source module](modules/fieldwork-public-context/README.md) documents limits, terms and verification recipes.

## Source and reproduction

- [Product module](modules/overture-fieldwork/): portable type, pages, geographic component configuration, dashboards and eight guarded actions.
- [Public context module](modules/fieldwork-public-context/): keyless HTTP definitions, graph bridges, a selected-place GraphQL query and read-only provider smoke script.
- [Extraction and import scripts](scripts/overture/): reproducible source selection, pinned extraction dependencies, bounded governed import preparation and 12 Python regressions.
- [Runtime contribution](runtime/geographic/): the new reusable geographic renderer, model, styles, model tests and vendored Leaflet with its license. [Integration notes](runtime/geographic/README.md) describe its Gyri host requirements.
- [Data](data/): source-only snapshot, immutable hashes, contributor attribution and upstream license/notice copies. Team research, membership, invitation records and installation receipts are excluded.

This is a **native Gyri app**, deployed on the existing Gyri runtime. The repository is its product configuration, data pipeline and new renderer contribution; it is not a standalone frontend or a copy of the private platform. Install both modules using the [native install guide](modules/overture-fieldwork/README.md), then import through [governed MCP requests](scripts/overture/IMPORT.md).

```bash
python3 -m venv .venv-overture
.venv-overture/bin/pip install -r scripts/overture/requirements.txt
.venv-overture/bin/python scripts/overture/extract_places.py \
  --release 2026-11-18.0 \
  --bbox=-122.422,37.775,-122.393,37.801 \
  --download-licenses
python3 -m unittest discover -s scripts/overture -p 'test_*.py'
```

Extraction writes to `output/overture-fieldwork/`. Historical releases may eventually become unavailable; `data/focus-places.jsonl` preserves this exact source slice. To prepare the bundled snapshot, give `prepare_import.py` `--input data/focus-places.jsonl` and a complete native record inventory. Refreshes preserve human decisions and notes.

## Trade-offs and cuts

A bounded snapshot keeps all 486 places browsable within the native 500-record geographic plan and makes the source reproducible. We retain conflicting coordinates/addresses and distinct GERS IDs instead of hiding uncertainty behind name-only deduplication or a fit score. Unknown operating status remains unknown; source confidence estimates existence, not quality or openness.

We cut automatic entity matching, automatic source refresh, live opening-hours guarantees, route optimization, contact enrichment, bookings and outreach. City context is fetched when requested and can fail independently of the saved place research. [Data attribution and licenses](data/ATTRIBUTION.md) remain attached to the snapshot; public city feeds have their own terms.
