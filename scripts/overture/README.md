# Overture Fieldwork extraction

Reproducible, keyless Overture Maps inputs for Gyri's Coffee & Counter partner
scouting workspace. Files are preparation artifacts; graph writes go through
Gyri MCP's governed bulk-record mutation, with rationale and source references.

```bash
python3 -m venv .venv-overture
.venv-overture/bin/pip install -r scripts/overture/requirements.txt
.venv-overture/bin/python scripts/overture/extract_places.py --release 2026-11-18.0 --download-licenses
python3 -m unittest discover -s scripts/overture -p 'test_*.py'
```

Use `--release latest` (the default) to resolve the current official STAC release.
Use `--refresh` to replace a cached raw download when release/bounds change.
Overture retains only recent releases, so a historical pinned release may stop
being downloadable. Existing raw files plus their CLI state remain valid inputs.

The script downloads `place` features in the exact box
`-122.422,37.775,-122.393,37.801` (west,south,east,north), then checks point
coordinates against those bounds. The official client's rounded bounding-box
metadata can include a few points just outside an edge; those stay in raw GeoJSON
and their exclusion is counted in the manifest.

Outputs under `output/overture-fieldwork/`:

- `sf-downtown-places.geojson` and `.state`: complete provider download and its
  official CLI release/bounds/timestamp evidence.
- `all-places.jsonl`: every exact-bounds place, normalized, with raw properties.
- `food-places.jsonl`: food/drink hierarchy, existence confidence at least 0.8,
  excluding `permanently_closed`.
- `focus-places.jsonl`: coffee, cafe, bakery, sandwich, tea, breakfast, bagel,
  donut, and roastery primary categories. No arbitrary row limit or ranking cut.
- `manifest.json`: SHA-256, versions, filter recipe, category counts, sources,
  licenses, release and attribution URLs.
- `licenses/`: source license copies and the full official Foursquare notice
  page, downloaded when `--download-licenses` is supplied.

The November 18, 2026 slice contains 32,692 raw features; exact bounds remove 10.
The focused set has **486 places**, **422 with HTTP(S) websites**. Their provider
status is `open` for 450 and unknown for 36. Every place starts `unreviewed`.

Trade-offs: existence confidence is neither quality nor current opening evidence.
Unknown status remains visible for review. Different source IDs may still refer
to the same business; no name-based dedupe erases evidence. No ownership,
purchasing intent, Wi-Fi, hours, accessibility, or partner suitability is inferred.
The current taxonomy is read from `taxonomy` and `basic_category`; the removed
`categories` property is supported only as a legacy normalization fallback.

Attribution: Overture Maps Foundation, overturemaps.org. Provider attribution and
licenses remain on each record. The focused set includes CDLA-Permissive-2.0,
Apache-2.0, and CC0-1.0 material. Foursquare data was transformed to Overture's
schema, then selected and normalized here; raw source properties are retained.
See [Overture attribution](https://docs.overturemaps.org/attribution/), the
[Foursquare notice](https://opensource.foursquare.com/places-notice-txt/), and
downloaded license copies before redistributing the prepared files.
