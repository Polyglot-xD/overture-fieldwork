#!/usr/bin/env python3
"""Extract a bounded Overture places slice; emit provenance-preserving Gyri inputs.

This script prepares files only. Import through Gyri's governed MCP bulk-record
mutation; it never writes database rows or runs a business workflow.
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import re
import subprocess
import sys
from urllib.request import urlopen

DEFAULT_BBOX = (-122.422, 37.775, -122.393, 37.801)
CATALOG = "https://stac.overturemaps.org/catalog.json"
ATTRIBUTION = "https://docs.overturemaps.org/attribution/"
FOCUS_CATEGORIES = {
    "coffee_shop", "cafe", "bakery", "sandwich_shop",
    "bubble_tea_shop", "tea_room", "donut_shop", "bagel_shop",
    "breakfast_and_brunch_restaurant", "coffee_roastery", "internet_cafe",
    "hong_kong_style_cafe",
}
LICENSE_URLS = {
    "CDLA-Permissive-2.0": "https://raw.githubusercontent.com/Community-Data-License-Agreements/Releases/main/CDLA-Permissive-2.0.txt",
    "Apache-2.0": "https://www.apache.org/licenses/LICENSE-2.0.txt",
    "CC0-1.0": "https://raw.githubusercontent.com/spdx/license-list-data/main/text/CC0-1.0.txt",
}
FOURSQUARE_NOTICE = "https://opensource.foursquare.com/places-notice-txt/"


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def write_jsonl(path: Path, rows):
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")
    temporary.replace(path)


def validated_bbox(value: str):
    try:
        box = tuple(float(part) for part in value.split(","))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("bbox requires four numbers: west,south,east,north") from exc
    if len(box) != 4 or not all(math.isfinite(n) for n in box):
        raise argparse.ArgumentTypeError("bbox requires four finite numbers")
    west, south, east, north = box
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise argparse.ArgumentTypeError("bbox must satisfy -180 <= west < east <= 180 and -90 <= south < north <= 90")
    return box


def normalize(feature, release, bbox):
    """Normalize without changing provider facts; raw properties remain available."""
    properties = feature.get("properties") or {}
    identifier = feature.get("id") or properties.get("id")
    if not identifier:
        raise ValueError("Place is missing its Overture/GERS ID")
    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates") or []
    if geometry.get("type") != "Point" or len(coordinates) < 2:
        raise ValueError(f"Place {identifier} has no point geometry")
    longitude, latitude = coordinates[:2]
    west, south, east, north = bbox
    if not (math.isfinite(longitude) and math.isfinite(latitude) and west <= longitude <= east and south <= latitude <= north):
        raise ValueError(f"Place {identifier} is outside the requested bbox")
    taxonomy = properties.get("taxonomy") or {}
    # Pre-September 2026 inputs remain readable, but current data uses taxonomy.
    legacy_categories = properties.get("categories") or {}
    category = taxonomy.get("primary") or legacy_categories.get("primary") or "uncategorized"
    addresses = properties.get("addresses") or []
    address = addresses[0] if addresses else {}
    websites = properties.get("websites") or []
    website = next((url for url in websites if isinstance(url, str) and url.startswith(("https://", "http://"))), "")
    brand = properties.get("brand") or {}
    full_address = ", ".join(str(address.get(key)) for key in ("freeform", "locality", "region", "postcode", "country") if address.get(key))
    sources = properties.get("sources") or []
    source_datasets = sorted({s.get("dataset") for s in sources if s.get("dataset")})
    licenses = sorted({s.get("license") for s in sources if s.get("license")})
    return {
        "overture_id": identifier,
        "name": (properties.get("names") or {}).get("primary") or "Unnamed place",
        "category": category,
        "category_label": category.replace("_", " ").capitalize(),
        "basic_category": properties.get("basic_category") or "",
        "category_hierarchy": taxonomy.get("hierarchy") or [],
        "latitude": latitude,
        "longitude": longitude,
        "address": address.get("freeform") or "",
        "full_address": full_address,
        "locality": address.get("locality") or "",
        "region": address.get("region") or "",
        "postcode": address.get("postcode") or "",
        "country": address.get("country") or "",
        "website": website,
        "website_available": bool(website),
        "websites": websites,
        "phones": properties.get("phones") or [],
        "socials": properties.get("socials") or [],
        "brand": (brand.get("names") or {}).get("primary") or "",
        "operating_status": properties.get("operating_status") or "unknown",
        "confidence": properties.get("confidence"),
        "data_release": release,
        "overture_version": properties.get("version"),
        "sources": sources,
        "source_datasets": source_datasets,
        "source_licenses": licenses,
        "source_url": f"https://stac.overturemaps.org/{release}/catalog.json",
        "map_url": f"https://www.openstreetmap.org/?mlat={latitude}&mlon={longitude}#map=18/{latitude}/{longitude}",
        "review_status": "unreviewed",
        "research_notes": "",
        "raw_properties": properties,
    }


def eligible_food(record, minimum_confidence):
    confidence = record["confidence"]
    return (
        "food_and_drink" in record["category_hierarchy"]
        and isinstance(confidence, (int, float))
        and confidence >= minimum_confidence
        and record["operating_status"] != "permanently_closed"
    )


def point_in_bbox(feature, bbox):
    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates") or []
    if geometry.get("type") != "Point" or len(coordinates) < 2:
        raise ValueError(f"Place {feature.get('id')} has no point geometry")
    x, y = coordinates[:2]
    west, south, east, north = bbox
    return math.isfinite(x) and math.isfinite(y) and west <= x <= east and south <= y <= north


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bbox", type=validated_bbox, default=DEFAULT_BBOX)
    parser.add_argument("--release", default="latest", help="A published release, or latest resolved through official STAC")
    parser.add_argument("--output-dir", type=Path, default=Path("output/overture-fieldwork"))
    parser.add_argument("--minimum-confidence", type=float, default=0.8)
    parser.add_argument("--refresh", action="store_true", help="Explicitly redownload and replace cached raw input")
    parser.add_argument("--download-licenses", action="store_true")
    args = parser.parse_args()
    if not 0 <= args.minimum_confidence <= 1:
        parser.error("minimum-confidence must be between zero and one")
    release = args.release
    if release == "latest":
        with urlopen(CATALOG, timeout=30) as response:
            release = json.load(response)["latest"]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}\.\d+", release):
        parser.error("release must use YYYY-MM-DD.N format")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    raw_path = args.output_dir / "sf-downtown-places.geojson"
    state_path = Path(str(raw_path) + ".state")
    command = [sys.executable, "-m", "overturemaps", "download", "--bbox=" + ",".join(map(str, args.bbox)), "-f", "geojson", "--type=place", "--release=" + release, "-o", str(raw_path)]
    if raw_path.exists() and not args.refresh:
        if not state_path.exists():
            parser.error("Cached data lacks Overture CLI state. Use --refresh to establish provenance.")
        state = read_json(state_path)
        state_bbox = state.get("bbox") or {}
        cached_bbox = tuple(state_bbox.get(k) for k in ("xmin", "ymin", "xmax", "ymax"))
        if state.get("last_release") != release or cached_bbox != args.bbox:
            parser.error("Cached data has a different release or bbox. Use --refresh or another output-dir.")
    else:
        subprocess.run(command, check=True)
    collection = read_json(raw_path)
    if collection.get("type") != "FeatureCollection":
        raise ValueError("Expected a GeoJSON FeatureCollection")
    # The CLI filters rounded Parquet bbox metadata. Apply exact point bounds as
    # well: a handful of points can otherwise sit centimeters beyond the edge.
    bounded_features = [feature for feature in collection["features"] if point_in_bbox(feature, args.bbox)]
    records = [normalize(feature, release, args.bbox) for feature in bounded_features]
    records.sort(key=lambda row: row["overture_id"])
    if len({row["overture_id"] for row in records}) != len(records):
        raise ValueError("Duplicate Overture IDs: import would overwrite distinct source rows")
    food = [row for row in records if eligible_food(row, args.minimum_confidence)]
    focus = [row for row in food if row["category"] in FOCUS_CATEGORIES]
    filenames = {"all": "all-places.jsonl", "food_and_drink": "food-places.jsonl", "focus": "focus-places.jsonl"}
    for key, rows in (("all", records), ("food_and_drink", food), ("focus", focus)):
        write_jsonl(args.output_dir / filenames[key], rows)
    licenses = sorted({license for row in records for license in row["source_licenses"]})
    if args.download_licenses:
        license_dir = args.output_dir / "licenses"
        license_dir.mkdir(exist_ok=True)
        for license in licenses:
            url = LICENSE_URLS.get(license)
            if not url:
                raise ValueError(f"Unmapped source license {license}; inspect official attribution before redistribution")
            with urlopen(url, timeout=30) as response:
                (license_dir / f"{license}.txt").write_bytes(response.read())
        if any("Foursquare" in row["source_datasets"] for row in records):
            with urlopen(FOURSQUARE_NOTICE, timeout=30) as response:
                (license_dir / "Foursquare-NOTICE.html").write_bytes(response.read())
    manifest = {
        "dataset": "Overture Maps Foundation places", "release": release,
        "extracted_at": read_json(state_path).get("last_run"),
        "normalized_at": datetime.now(timezone.utc).isoformat(),
        "bbox": dict(zip(("west", "south", "east", "north"), args.bbox)),
        "catalog_url": CATALOG,
        "release_url": f"https://stac.overturemaps.org/{release}/catalog.json",
        "data_path": f"s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/",
        "attribution_url": ATTRIBUTION,
        "attribution": "Overture Maps Foundation, overturemaps.org; source providers and licenses preserved per record.",
        "source_licenses": licenses,
        "license_urls": LICENSE_URLS,
        "foursquare_notice_url": FOURSQUARE_NOTICE,
        "source_datasets": sorted({source for row in records for source in row["source_datasets"]}),
        "overturemaps_version": importlib.metadata.version("overturemaps"),
        "download_command": command,
        "raw_sha256": hashlib.sha256(raw_path.read_bytes()).hexdigest(),
        "raw_bytes": raw_path.stat().st_size,
        "counts": {"raw": len(collection["features"]), "excluded_outside_exact_bbox": len(collection["features"]) - len(records), "all": len(records), "food_and_drink": len(food), "focus": len(focus)},
        "files": filenames,
        "focus_filter": {"primary_categories": sorted(FOCUS_CATEGORIES), "minimum_existence_confidence": args.minimum_confidence, "excluded_operating_status": ["permanently_closed"]},
        "focus_categories": dict(Counter(row["category"] for row in focus).most_common()),
        "focus_statuses": dict(Counter(row["operating_status"] for row in focus)),
        "focus_website_count": sum(row["website_available"] for row in focus),
        "caveats": ["Confidence measures existence, not quality, openness, accessibility, or suitability.", "An open source status is not a current field verification.", "Unknown operating status is retained for review.", "Provider duplicates can remain under different GERS IDs; names are not deduplicated heuristically.", "Independent ownership and purchasing intent are not inferred.", "User review fields are initial defaults; imports must preserve subsequent human notes and status."],
    }
    write_json(args.output_dir / "manifest.json", manifest)
    print(json.dumps({"release": release, "counts": manifest["counts"], "focus_website_count": manifest["focus_website_count"], "manifest": str(args.output_dir / "manifest.json")}))


if __name__ == "__main__":
    main()
