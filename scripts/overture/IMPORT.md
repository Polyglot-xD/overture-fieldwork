# Governed Overture import

`prepare_import.py` prepares MCP requests from `focus-places.jsonl`; it does not
transmit anything. Run extraction first, install the Fieldwork module, and use
Gyri MCP to read the target inventory:

```graphql
query ExistingPlaces($typeKey: String!) {
  viewerContext { workspaceId }
  workspaceCustomRecordCount(typeKey: $typeKey)
  workspaceCustomRecords(typeKey: $typeKey, limit: 500, offset: 0) {
    recordId
    body
  }
}
```

Pass `{"typeKey":"fieldwork_place"}` and the explicit `overture-fieldwork`
workspace to the MCP query. Read additional pages if the count exceeds the page
size. Save the observed response as a small wrapper at
`output/overture-fieldwork/existing-records.json`:

```json
{
  "workspaceId": "overture-fieldwork",
  "typeKey": "fieldwork_place",
  "verifiedAt": "<time of native readback>",
  "recordCount": 0,
  "records": []
}
```

Use the actual count and records; an empty wrapper is valid only when the native
query confirms zero records. Every existing record must retain its `recordId`
and `body.overture_id`. The command rejects incomplete inventories, mismatched
workspaces/types, duplicate source IDs, malformed coordinates, and missing
provenance.

```bash
python3 scripts/overture/prepare_import.py \
  --workspace-id overture-fieldwork \
  --existing-records output/overture-fieldwork/existing-records.json \
  --output-dir output/overture-fieldwork/import-batches
```

Use a fresh output directory for each preparation. Batches default to at most
20 inputs and 80,000 encoded UTF-8 bytes per `batch-NNN.json`. Gyri's record
mutation allows 100 rows, but the current HTTP GraphQL request-body limit is
100 KiB: large raw properties can hit it well before the row limit. The 80,000
byte cap leaves safety margin for the forwarding envelope. The preparer splits
when either limit is reached and rejects any single place that cannot fit.
It measures bytes, including multibyte text, rather than character count.
The output includes request sizes, SHA-256 hashes, exact expected record IDs,
and a native verification query. For each batch, call Gyri MCP `act` with that
JSON request plus the connected `link_id`. Check `ok`, `status`, `writtenCount`,
`errorCount`, and the complete `errors` list before proceeding. A successful
transport response alone does not establish successful row ingestion.

After all batches, run `verify.json` through Gyri MCP `query`. Compare the exact
ID set and count with `manifest.json`; inspect the sample bodies for GERS ID,
release, coordinates, sources, and licenses. The provided query enumerates 500
IDs; paginate for larger slices. Preserve receipts as scratch evidence under
`output/overture-fieldwork/`, then capture the verified outcome with
`think verb=reflect`.

Refreshes use merge patches. Existing records receive source fields only:
`review_status`, `research_notes`, `owner`, `next_action`, `last_verified_at`,
`research_focus`, `visit_status`, `planned_visit_at`, `visit_notes`,
`verification_status`, `verification_notes` and `verification_source_url`
remain human-owned. Existing aliases are retained. Missing
source values are omitted because explicit null in a Gyri merge deletes a key.
Only places absent from the verified inventory receive initial `unreviewed`
status, blank notes, and source aliases. A known GERS ID retains its existing
native record ID; new IDs are deterministically scoped to workspace and type.

Always obtain a fresh inventory and regenerate before refreshing. **Do not
replay old initialization batches after reviewers start editing.** Preparation
is not an atomic create-if-absent operation; serialize initial ingestion with
other importers. Missing places in a later extract are not automatically deleted
or declared closed. Keep the original extraction manifest and source licensing
files beside the downloaded data.

Focused import regressions:

```bash
python3 -m unittest discover -s scripts/overture -p 'test_prepare_import.py'
```
