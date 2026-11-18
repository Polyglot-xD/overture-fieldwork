#!/usr/bin/env python3
"""Prepare reviewed Overture JSONL for Gyri's governed MCP bulk mutation.

This command has no credentials, network calls, database access, or graph writes.
An agent submits its JSON requests with Gyri `act`, checks every returned error,
then uses the manifest's verification query to read back the actual records.
Refresh batches deliberately exclude human-owned research fields and aliases.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys

TYPE_KEY = "fieldwork_place"
USER_FIELDS = frozenset({
    "review_status", "research_notes", "next_action", "assignee",
    "researcher", "assigned_to", "reviewed_at", "reviewed_by",
    "owner", "last_verified_at",
    "research_focus", "visit_status", "planned_visit_at", "visit_notes",
    "verification_status", "verification_notes", "verification_source_url",
})
MUTATION = """mutation ImportOverturePlaces($inputs:[WorkspaceCustomRecordInput!]!){
  putWorkspaceCustomRecords(inputs:$inputs,partialSuccess:false){
    ok status writtenCount errorCount errorSummary
    records { recordId }
    errors { index typeKey recordId message }
  }
}"""


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def sha256(value: bytes):
    return hashlib.sha256(value).hexdigest()


def record_id(workspace_id: str, type_key: str, overture_id: str):
    # Include workspace because record_id is globally unique in Gyri.
    identity = canonical_json([workspace_id, type_key, overture_id])
    return "wcr_" + sha256(identity.encode("utf-8"))[:32]


def read_records(path: Path):
    records = []
    seen = set()
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                record = json.loads(line, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f"Non-finite JSON value {value}")))
            except (ValueError, json.JSONDecodeError) as exc:
                raise ValueError(f"{path}:{line_number}: invalid JSON: {exc}") from exc
            if not isinstance(record, dict):
                raise ValueError(f"{path}:{line_number}: record must be an object")
            identifier = record.get("overture_id")
            if not isinstance(identifier, str) or not identifier.strip():
                raise ValueError(f"{path}:{line_number}: missing Overture/GERS ID")
            if identifier in seen:
                raise ValueError(f"{path}:{line_number}: duplicate Overture/GERS ID {identifier}")
            seen.add(identifier)
            if not isinstance(record.get("name"), str) or not record["name"].strip():
                raise ValueError(f"{path}:{line_number}: missing place name")
            for field, bounds in (("longitude", (-180, 180)), ("latitude", (-90, 90))):
                value = record.get(field)
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not bounds[0] <= value <= bounds[1]:
                    raise ValueError(f"{path}:{line_number}: invalid {field}")
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}\.\d+", str(record.get("data_release", ""))):
                raise ValueError(f"{path}:{line_number}: missing or invalid source release")
            if not isinstance(record.get("sources"), list) or not record["sources"]:
                raise ValueError(f"{path}:{line_number}: source provenance is required")
            records.append(record)
    if not records:
        raise ValueError("Input contains no places")
    return sorted(records, key=lambda row: row["overture_id"])


def existing_inventory(snapshot: dict, workspace_id: str, type_key: str):
    """Require a complete, explicitly scoped native readback before preparation."""
    if not isinstance(snapshot, dict):
        raise ValueError("Existing-records snapshot must be a JSON object")
    if snapshot.get("workspaceId") != workspace_id or snapshot.get("typeKey") != type_key:
        raise ValueError("Existing-records snapshot workspace/type does not match the target")
    count, records = snapshot.get("recordCount"), snapshot.get("records")
    if isinstance(count, bool) or not isinstance(count, int) or count < 0 or not isinstance(records, list) or count != len(records):
        raise ValueError("Existing-records snapshot must contain the complete native record count and records; paginate the readback")
    if not isinstance(snapshot.get("verifiedAt"), str) or not snapshot["verifiedAt"].strip():
        raise ValueError("Existing-records snapshot must include the readback time in verifiedAt")
    inventory = {}
    for row in records:
        if not isinstance(row, dict) or not isinstance(row.get("body"), dict):
            raise ValueError("Existing records must include recordId and body with overture_id")
        identifier = row["body"].get("overture_id")
        rid = row.get("recordId")
        if not isinstance(identifier, str) or not identifier or not re.fullmatch(r"wcr_[a-zA-Z0-9]+", str(rid)):
            raise ValueError("Existing records must include valid recordId and overture_id")
        if identifier in inventory:
            raise ValueError("Existing native records contain duplicate Overture/GERS IDs")
        inventory[identifier] = rid
    return inventory


def make_input(record: dict, workspace_id: str, type_key: str, initialize: bool = False):
    # A null merge value deletes the existing key. Omit unavailable source fields
    # instead, preserving old provenance rather than silently erasing it.
    body = {key: value for key, value in record.items() if key not in USER_FIELDS and value is not None}
    result = {
        "typeKey": type_key,
        "recordId": record_id(workspace_id, type_key, record["overture_id"]),
        "body": body,
        "writeMode": "merge",
        "note": f"Overture {record['data_release']} source import; human research fields preserved",
    }
    if initialize:
        body["review_status"] = "unreviewed"
        body["research_notes"] = ""
        # Aliases replace existing aliases. Seed only for the verified first load.
        result["aliases"] = ["overture:" + record["overture_id"], record["name"]]
    return result


def prepare(input_path: Path, output_dir: Path, workspace_id: str, type_key: str, batch_size: int, existing_snapshot: Path, max_request_bytes: int = 80000):
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,62}", workspace_id):
        raise ValueError("workspace-id must be a lowercase workspace slug")
    if not re.fullmatch(r"[a-z][a-z0-9_]*", type_key):
        raise ValueError("type-key must use lowercase snake_case")
    if not 1 <= batch_size <= 100:
        raise ValueError("batch-size must be between 1 and 100")
    if not 1024 <= max_request_bytes <= 95000:
        raise ValueError("max-request-bytes must be between 1024 and 95000 (the current API limit is 100 KiB)")
    inventory = existing_inventory(json.loads(existing_snapshot.read_text()), workspace_id, type_key)
    records = read_records(input_path)
    inputs = []
    initialized_count = 0
    for row in records:
        identifier = row["overture_id"]
        is_new = identifier not in inventory
        item = make_input(row, workspace_id, type_key, is_new)
        if not is_new:
            item["recordId"] = inventory[identifier]
        else:
            initialized_count += 1
        inputs.append(item)
    def encode_request(rows):
        request = {
            "workspaceId": workspace_id,
            "query": MUTATION,
            "variables": {"inputs": rows},
            "rationale": f"Import {len(rows)} public Overture places from {', '.join(sorted({row['body']['data_release'] for row in rows}))}; stable GERS identity; source provenance retained; no outreach",
            "contextRefs": sorted({row["body"]["source_url"] for row in rows if row["body"].get("source_url")}),
        }
        return (canonical_json(request) + "\n").encode("utf-8")

    # Both row count and encoded UTF-8 request size matter. Raw provider
    # properties vary substantially, and non-ASCII characters use multiple bytes.
    pending = []
    encoded_batches = []
    for item in inputs:
        candidate = pending + [item]
        payload = encode_request(candidate)
        if pending and (len(candidate) > batch_size or len(payload) > max_request_bytes):
            encoded_batches.append((pending, encode_request(pending)))
            pending = []
            payload = encode_request([item])
        if len(payload) > max_request_bytes:
            raise ValueError(f"Place {item['body']['overture_id']} requires {len(payload)} UTF-8 request bytes by itself, exceeding max-request-bytes={max_request_bytes}; trim its raw_properties or choose a smaller source representation before importing")
        pending.append(item)
    if pending:
        encoded_batches.append((pending, encode_request(pending)))

    # Do not leave stale batches behind when a smaller extraction is prepared.
    # A fresh directory also prevents confusing initialization with refresh.
    output_dir.mkdir(parents=True, exist_ok=True)
    if any(output_dir.iterdir()):
        raise ValueError(f"Output directory is not empty: {output_dir}; choose a fresh directory")
    batches = []
    for rows, payload in encoded_batches:
        filename = f"batch-{len(batches) + 1:03d}.json"
        (output_dir / filename).write_bytes(payload)
        batches.append({"file": filename, "count": len(rows), "utf8_bytes": len(payload), "sha256": sha256(payload)})
    verify_query = '''query VerifyOvertureImport($typeKey:String!){
  viewerContext { workspaceId }
  workspaceCustomRecordCount(typeKey:$typeKey)
  workspaceCustomRecords(typeKey:$typeKey,limit:500,offset:0){ recordId }
  sourceSamples:workspaceCustomRecords(typeKey:$typeKey,limit:3,offset:0){ recordId body }
}'''
    verification = {"workspaceId": workspace_id, "query": verify_query, "variables": {"typeKey": type_key}}
    (output_dir / "verify.json").write_text(json.dumps(verification, indent=2) + "\n")
    manifest = {
        "workspaceId": workspace_id,
        "typeKey": type_key,
        "source_file": str(input_path),
        "source_sha256": sha256(input_path.read_bytes()),
        "record_count": len(records),
        "batch_size_limit": batch_size,
        "max_request_bytes": max_request_bytes,
        "source_releases": sorted({row["data_release"] for row in records}),
        "mode": "upsert_from_verified_native_inventory",
        "existing_snapshot_sha256": sha256(existing_snapshot.read_bytes()),
        "initialized_count": initialized_count,
        "refreshed_count": len(inputs) - initialized_count,
        "record_ids": [row["recordId"] for row in inputs],
        "batches": batches,
        "verification_file": "verify.json",
        "verification_requires_pagination": len(records) > 500,
        "notes": [
            "Submit each request through the Gyri MCP act tool; pass the connected link_id separately.",
            "Inspect ok/status/writtenCount/errorCount/errors after every batch. An HTTP/tool success alone is not an import receipt.",
            "The merge patch excludes human research fields for existing records. Defaults and source aliases are sent only for places missing from the supplied native inventory.",
            "Never replay old batches after users begin editing: obtain a fresh complete MCP inventory and regenerate. A readback/preparation pair is not an atomic create-if-absent guard; serialize initial ingestion with other importers.",
            "After import, use MCP query with verify.json; compare exact record IDs, count, and source provenance. Paginate if the input exceeds 500.",
            "Refresh is an upsert only: places missing from a new source slice are not deleted or marked closed.",
        ],
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("output/overture-fieldwork/focus-places.jsonl"))
    parser.add_argument("--workspace-id", required=True)
    parser.add_argument("--type-key", default=TYPE_KEY)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--batch-size", type=int, default=20, help="Maximum rows per request (default 20; native maximum 100)")
    parser.add_argument("--max-request-bytes", type=int, default=80000, help="Maximum encoded UTF-8 request bytes; 80000 leaves room below the current 100 KiB API body limit")
    parser.add_argument("--existing-records", type=Path, required=True, metavar="VERIFIED_SNAPSHOT_JSON", help="Fresh complete MCP inventory; controls which missing records receive initial review defaults")
    args = parser.parse_args()
    try:
        manifest = prepare(args.input, args.output_dir, args.workspace_id, args.type_key, args.batch_size, args.existing_records, args.max_request_bytes)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(json.dumps({"workspaceId": args.workspace_id, "typeKey": args.type_key, "mode": manifest["mode"], "record_count": manifest["record_count"], "batch_count": len(manifest["batches"]), "manifest": str(args.output_dir / "manifest.json")}))


if __name__ == "__main__":
    main()
