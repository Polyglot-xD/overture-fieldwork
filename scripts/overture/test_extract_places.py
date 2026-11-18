"""Data-contract checks: source identity, exact bounds, schema migration, filters."""
import argparse
import unittest

from extract_places import DEFAULT_BBOX, eligible_food, normalize, point_in_bbox, validated_bbox


def feature(**properties):
    return {
        "id": "known-source-id", "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [-122.41, 37.79]},
        "properties": {
            "names": {"primary": "Sample Cafe"},
            "taxonomy": {"primary": "coffee_shop", "hierarchy": ["food_and_drink", "casual_eatery", "coffee_shop"]},
            "confidence": .9, **properties,
        },
    }


class PlaceContractTests(unittest.TestCase):
    def test_normalization_preserves_source_facts_and_does_not_verify(self):
        original = feature(operating_status="open", websites=["javascript:bad", "https://cafe.example"], addresses=[{"freeform": "10 Main", "locality": "San Francisco"}])
        result = normalize(original, "2026-11-18.0", DEFAULT_BBOX)
        self.assertEqual(result["overture_id"], "known-source-id")
        self.assertEqual(result["website"], "https://cafe.example")
        self.assertTrue(result["website_available"])
        self.assertEqual(result["full_address"], "10 Main, San Francisco")
        self.assertEqual(result["raw_properties"], original["properties"])
        self.assertEqual(result["review_status"], "unreviewed")

    def test_exact_geometry_filter_handles_rounded_source_bbox(self):
        sample = feature()
        sample["geometry"]["coordinates"][0] = DEFAULT_BBOX[0] - .000001
        self.assertFalse(point_in_bbox(sample, DEFAULT_BBOX))

    def test_closed_and_unknown_confidence_are_not_candidates(self):
        for properties in ({"operating_status": "permanently_closed"}, {"confidence": None}, {"confidence": .79}):
            self.assertFalse(eligible_food(normalize(feature(**properties), "2026-11-18.0", DEFAULT_BBOX), .8))
        self.assertTrue(eligible_food(normalize(feature(), "2026-11-18.0", DEFAULT_BBOX), .8))

    def test_missing_provider_status_remains_unknown(self):
        self.assertEqual(normalize(feature(), "2026-11-18.0", DEFAULT_BBOX)["operating_status"], "unknown")

    def test_legacy_category_input_keeps_primary_without_fabricated_hierarchy(self):
        result = normalize(feature(taxonomy=None, categories={"primary": "cafe"}), "2026-11-18.0", DEFAULT_BBOX)
        self.assertEqual(result["category"], "cafe")
        self.assertEqual(result["category_hierarchy"], [])

    def test_invalid_bounding_box_rejected(self):
        for box in ("nan,37,-122,38", "-122,38,-123,37", "1,2,3"):
            with self.assertRaises(argparse.ArgumentTypeError):
                validated_bbox(box)


if __name__ == "__main__":
    unittest.main()
