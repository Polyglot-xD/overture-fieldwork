# Overture Fieldwork — Coffee & Counter

Turn open map places into a shared, evidence-backed partner research queue for
wholesale roasters, bakery suppliers, and neighborhood teams.

**[Open the deployed app](https://app.gyri.io/dashboards/fieldwork_home?kb_ws=overture-fieldwork)**
— Gyri sign-in and a workspace invitation are required.

## Why this

A map shows where venues are. A field team also needs to remember what it checked,
which places are worth investigating, and who should do what next. This app uses
Gyri’s shared records, source evidence, search, notes, revision history, and
permissions to turn Overture data into that working research queue.

The immutable public snapshot contains **486 downtown San Francisco places**
from Overture release **2026-11-18.0**, including coffee shops, cafés, bakeries,
and counter-service venues. All 486 fit in the native Explore view. Filter places,
inspect the Overture provenance and map location, then use the selected venue’s
Update review status or Replace research notes action. The native dialog updates
that place’s team fields. Editors can save; invited reviewers can read. The
Source records browser is read-only. Start here shows the team’s live shortlist
and counts. Unknown operating status remains visible; source confidence measures
existence, not quality, openness, independence, or partner fit.

## What is in this repository

- `modules/overture-fieldwork/`: portable native Gyri module, schema, Explore
  page, dashboards, shared research board, focused navigation, and install guide.
- `scripts/overture/`: pinned extraction requirements, reproducible extractor,
  governed MCP import preparation, documentation, and contract regression tests.
- `data/`: the focused public snapshot, extraction metadata, file hashes,
  contributor attribution, and upstream license/notice copies.

The Gyri platform runtime is deployed separately. This repository contains the
product’s declarative configuration and reproducible data pipeline; it contains
no credentials, private workspace inventory, reviewer decisions, membership or
invitation records, import receipts, or unrelated platform changes.

## Reproduce and install

From this repository’s root:

```bash
python3 -m venv .venv-overture
.venv-overture/bin/pip install -r scripts/overture/requirements.txt
.venv-overture/bin/python scripts/overture/extract_places.py \
  --release 2026-11-18.0 \
  --bbox=-122.422,37.775,-122.393,37.801 \
  --download-licenses
python3 -m unittest discover -s scripts/overture -p 'test_*.py'
```

The extractor writes the provider download, focused and broader normalized
slices, license notices, and a provenance/hash manifest under
`output/overture-fieldwork/`. Historical Overture releases may eventually stop
being downloadable; `data/focus-places.jsonl` preserves this demo’s focused
snapshot without human research fields.

Follow [the native module install guide](modules/overture-fieldwork/README.md)
and [the governed import procedure](scripts/overture/IMPORT.md). Install the
module in a new invite-only Gyri workspace, read its complete native inventory,
then prepare bounded MCP requests. To use the bundled immutable source:

```bash
python3 scripts/overture/prepare_import.py \
  --input data/focus-places.jsonl \
  --workspace-id YOUR_WORKSPACE_SLUG \
  --existing-records output/overture-fieldwork/existing-records.json \
  --output-dir output/overture-fieldwork/initial-import
```

Submit the generated requests through Gyri MCP `act` and verify every receipt
and the complete native record set. A refresh preserves human decisions and
notes. No raw SQL, background worker, or outbound campaign is involved.

## Trade-offs and cuts

A bounded snapshot makes the source reproducible and keeps every selected place
browsable within the native 500-row view. This is a research workflow backed by
shared durable records; map inspection opens a source-linked OpenStreetMap pin.
We cut embedded map tiles, live refresh, route optimization, automatic partner
scoring, contact enrichment, and outreach. Different GERS IDs can still describe
the same venue; we retain that evidence rather than deduplicating by name.
Missing places on a later refresh are not automatically deleted or marked closed.

See [data attribution and licenses](data/ATTRIBUTION.md) before redistributing
the included snapshot.
