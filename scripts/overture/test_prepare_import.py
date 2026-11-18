"""Import regressions that would lose human research or corrupt source identity."""

import copy
import json
from pathlib import Path
import tempfile
import unittest

from prepare_import import existing_inventory, make_input, prepare, read_records, record_id


def source_record():
    return {"overture_id": "1234-5678", "name": "Example Café", "latitude": 37.79, "longitude": -122.4,
            "data_release": "2026-11-18.0", "sources": [{"dataset": "Example", "license": "CC0-1.0"}],
            "review_status": "unreviewed", "research_notes": "", "next_action": "", "assignee": "", "owner": "", "last_verified_at": "",
            "website": None}


class ImportSafetyTest(unittest.TestCase):
    def test_refresh_preserves_human_research_and_aliases(self):
        source = source_record()
        patch = make_input(source, "overture-fieldwork", "fieldwork_place")
        self.assertNotIn("aliases", patch)
        for field in ("review_status", "research_notes", "next_action", "assignee", "owner", "last_verified_at", "website"):
            self.assertNotIn(field, patch["body"])
        existing = {"review_status": "shortlisted", "research_notes": "Owner asked for sample", "next_action": "Visit Tuesday", "assignee": "Reviewer", "website": "https://example.com"}
        refreshed = {**existing, **patch["body"]}
        for key, value in existing.items():
            self.assertEqual(refreshed[key], value)
        self.assertEqual(source, source_record())

    def test_identity_survives_release_and_name_change_but_is_workspace_scoped(self):
        old = source_record()
        new = copy.deepcopy(old)
        new.update(name="New name", data_release="2026-12-16.0")
        self.assertEqual(make_input(old, "one", "fieldwork_place")["recordId"], make_input(new, "one", "fieldwork_place")["recordId"])
        self.assertNotEqual(record_id("one", "fieldwork_place", old["overture_id"]), record_id("two", "fieldwork_place", old["overture_id"]))

    def test_incomplete_or_wrong_workspace_inventory_rejected(self):
        empty = {"workspaceId": "one", "typeKey": "fieldwork_place", "recordCount": 0, "records": [], "verifiedAt": "2026-11-18T00:00:00Z"}
        self.assertEqual(existing_inventory(empty, "one", "fieldwork_place"), {})
        for changed in ({"recordCount": 1}, {"records": [{"recordId": "wcr_1"}]}, {"workspaceId": "another"}):
            with self.assertRaises(ValueError):
                existing_inventory({**empty, **changed}, "one", "fieldwork_place")

    def test_refresh_uses_existing_canonical_identity_and_omits_defaults(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = source_record()
            path = root / "source.jsonl"
            path.write_text(json.dumps(source) + "\n")
            snapshot = root / "existing.json"
            snapshot.write_text(json.dumps({"workspaceId": "one", "typeKey": "fieldwork_place", "recordCount": 1, "verifiedAt": "2026-11-18T00:00:00Z", "records": [{"recordId": "wcr_existing", "body": {"overture_id": source["overture_id"], "research_notes": "keep"}}]}))
            manifest = prepare(path, root / "batches", "one", "fieldwork_place", 100, snapshot)
            patch = json.loads((root / "batches" / "batch-001.json").read_text())["variables"]["inputs"][0]
            self.assertEqual(patch["recordId"], "wcr_existing")
            self.assertNotIn("review_status", patch["body"])
            self.assertNotIn("research_notes", patch["body"])
            self.assertEqual(manifest["initialized_count"], 0)
            self.assertEqual(manifest["refreshed_count"], 1)

    def test_duplicates_invalid_coordinates_and_missing_provenance_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rows.jsonl"
            record = source_record()
            path.write_text(json.dumps(record) + "\n" + json.dumps(record) + "\n")
            with self.assertRaisesRegex(ValueError, "duplicate"):
                read_records(path)
            for changed in ({"latitude": 91}, {"longitude": True}, {"sources": []}, {"data_release": "unknown"}):
                path.write_text(json.dumps({**record, **changed}) + "\n")
                with self.assertRaises(ValueError):
                    read_records(path)

    def test_batches_split_on_utf8_bytes_and_reject_one_oversized_place(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "source.jsonl"
            snapshot = root / "existing.json"
            snapshot.write_text(json.dumps({"workspaceId": "one", "typeKey": "fieldwork_place", "recordCount": 0, "records": [], "verifiedAt": "2026-11-18T00:00:00Z"}))
            # Each café payload fits alone but exceeds the byte cap in pairs.
            rows = [{**source_record(), "overture_id": str(index), "raw_properties": {"detail": "é" * 800}} for index in range(3)]
            path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n")
            manifest = prepare(path, root / "batches", "one", "fieldwork_place", 20, snapshot, 4000)
            self.assertEqual([batch["count"] for batch in manifest["batches"]], [1, 1, 1])
            for batch in manifest["batches"]:
                payload = (root / "batches" / batch["file"]).read_bytes()
                self.assertEqual(len(payload), batch["utf8_bytes"])
                self.assertLessEqual(len(payload), 4000)
            rows[0]["raw_properties"]["detail"] = "😀" * 2000
            path.write_text(json.dumps(rows[0], ensure_ascii=False) + "\n")
            with self.assertRaisesRegex(ValueError, "by itself, exceeding"):
                prepare(path, root / "too-large", "one", "fieldwork_place", 20, snapshot, 4000)
            self.assertFalse((root / "too-large").exists())


if __name__ == "__main__":
    unittest.main()
