# Overture Fieldwork — Coffee & Counter

**Pitch:** Turn open map places into a shared, evidence-backed partner research queue for wholesale roasters, bakery suppliers, and neighborhood teams.

**Live app:** [Coffee & Counter](https://app.gyri.io/pages/fieldwork?kb_ws=overture-fieldwork). Sign in to the invited Gyri workspace. Start with **Explore places**, open a venue, inspect its source evidence, then use **Update review status** or **Replace research notes** on that place. The native action dialog saves only the selected record’s team fields. Editors can save; invited reviewers have read-only access. **Start here** shows the team's shortlist and live counts.

## Why this

A supplier or neighborhood team needs to remember which venues were worth investigating, what they checked, and what to do next. Gyri already provides shared records, search, evidence, notes, revision history, and permissions. This product gives those capabilities real place data and a small, understandable job.

## Data and judgment

The initial snapshot contains **486 places**, including 166 coffee shops, 115 cafes, 62 sandwich shops, and 61 bakeries. It uses Overture places release **2026-11-18.0**, bbox `[-122.422, 37.775, -122.393, 37.801]`, 12 explicitly selected primary categories, and confidence ≥ 0.80; explicitly permanently closed places are excluded. 422 have a website URL in the source. These are source observations, not live verification.

Every record starts **unreviewed** with empty research notes. Review states are `unreviewed`, `verify_first`, `shortlisted`, `visited`, and `passed`. A shortlist means worth researching; it does not assert buying intent. Unknown operating status remains unknown. Missing brand metadata does not prove independent ownership. Confidence estimates place existence, not quality or partner fit.

The semantic module-local type is `fieldwork_place`. Overture identity, source release, version, coordinates, contributors, licenses, and raw properties remain attached. Team-owned `review_status`, `research_notes`, `owner`, `next_action`, and `last_verified_at` survive source refreshes. We do not project unverified place records into canonical organization identities.

## Reproduce the slice

From the repository root:

```bash
python3 -m venv .codex-tmp/overture-venv
.codex-tmp/overture-venv/bin/pip install -r scripts/overture/requirements.txt
.codex-tmp/overture-venv/bin/python scripts/overture/extract_places.py \
  --release 2026-11-18.0 \
  --bbox=-122.422,37.775,-122.393,37.801 \
  --download-licenses
```

The maintained extractor writes GeoJSON, normalized JSONL, licenses, and a provenance/hash manifest under `output/overture-fieldwork/`. It reapplies the exact bbox and pins the resolved release. `focus-places.jsonl` is the deployed slice. See [extraction documentation](../../scripts/overture/README.md).

## Install and load through Gyri MCP

Create an isolated `invite_only` workspace through the governed workspace operation. Use an organization where the actor has `org:create_workspace`. Install this module with the contents of `module.v2.json` as `$module`:

```graphql
mutation InstallFieldwork($module: JSON!) {
  installGraphModule(module: $module, conflictPolicy: merge_update) {
    moduleId
    errors
  }
}
```

The package installs the type, Explore page, two dashboards, shared research kanban, navigation, a default place component, and two guarded existing-record actions. The runtime must support the existing-record action contract (`xGyriExistingRecordIdField` plus `existing_record_only`); older executors must fail closed until that reusable capability is deployed. `navigation.json` is an optional focused sidebar override; apply it with `setWorkspaceNavigation(nav:$nav)` only in the new workspace. The JSON companion files are reviewable copies of the artifacts embedded in the module.

Read the complete existing `fieldwork_place` inventory through MCP and save its observed count and records in a scoped snapshot. An empty snapshot is valid only after native readback confirms zero records. See [the import procedure](../../scripts/overture/IMPORT.md). Prepare mutation requests:

```bash
python3 scripts/overture/prepare_import.py \
  --workspace-id overture-fieldwork \
  --existing-records output/overture-fieldwork/existing-records.json \
  --output-dir output/overture-fieldwork/initial-import
```

Submit each generated `batch-*.json` through Gyri MCP `act`, with the connected `link_id` supplied separately. Inspect `ok`, `writtenCount`, `errorCount`, and every error; a transport success is not an import receipt. Run the generated `verify.json` through MCP `query` and compare the count, **all 486 expected record IDs**, and source evidence. Never load graph content through SQL.

Requests default to at most 20 places and 80,000 encoded UTF-8 bytes, below the current API body limit. For every later refresh, obtain a fresh complete inventory, pass it with `--existing-records`, and choose a fresh output directory. Existing places receive source fields only, preserving team decisions and aliases; only missing places receive initial review defaults. Do not replay old initial-import batches after edits begin. Missing places are not automatically deleted or marked closed. Recheck the module schema and slice size before expanding beyond 500 places. Invitations use Gyri's live access plan and native invitation flow; do not put recipient identities into this portable package.

## Trade-offs and cuts

A bounded one-time snapshot keeps data extraction reproducible and fits all 486 places in the native Explore view's 500-row limit. Search, source evidence, research notes, permissions, and shared state use Gyri's existing runtime. Native record action dialogs update the selected place’s review status or replace its research notes; source fields remain intact. The Source records browser itself is read-only. Map inspection uses each record's OpenStreetMap URL. We cut live refresh, embedded map tiles, route optimization, automatic fit scoring, contact enrichment, and outbound campaigns. There are no fabricated decisions, fake reviews, sample prospects, or background workers.

Data attribution: © Overture Maps Foundation and its source contributors. Per-record license metadata and the download bundle retain applicable CDLA-Permissive-2.0, Apache-2.0, and CC0-1.0 notices, together with the [Foursquare places notice](https://opensource.foursquare.com/places-notice-txt/). See [Overture attribution](https://docs.overturemaps.org/attribution/) and the generated license files. Existing Gyri runtime code keeps its repository license.
