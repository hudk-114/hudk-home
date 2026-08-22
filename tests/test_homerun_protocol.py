"""Tests for pure Homerun protocol helpers."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest

PROTOCOL_PATH = (
    Path(__file__).parents[1]
    / "home-assistant"
    / "custom_components"
    / "homerun_pet"
    / "protocol.py"
)
SPEC = importlib.util.spec_from_file_location("homerun_protocol", PROTOCOL_PATH)
assert SPEC and SPEC.loader
protocol = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(protocol)


class HomerunProtocolTest(unittest.TestCase):
    def test_password_digest_matches_known_vector(self) -> None:
        self.assertEqual(
            protocol.password_digest("secret", "demo-app-key", "demo-salt"),
            "19349bebb12bc4e99284",
        )

    def test_request_signature_uses_reverse_key_order_and_java_booleans(self) -> None:
        self.assertEqual(
            protocol.request_signature(
                {"z": 2, "a": "x", "middle": True},
                "1700000000",
                "demo-app-key",
            ),
            "3fab8e7cdcdbe26c4ebac82e7b332ae3e21b9a08ea8da2e985f304c82ad12303",
        )

    def test_snapshot_normalizes_mixed_vendor_types(self) -> None:
        snapshot = protocol.normalize_snapshot(
            {"deviceSerial": "redacted"},
            online="1",
            properties={
                "LackFood": "false",
                "BatterIn": 1,
                "BatteryPercentage": 83.0,
                "Desiccant": {"RemainingDays": "12", "StartDate": "2026-08-01"},
            },
            last_event={"general": 1},
        )
        self.assertIs(snapshot["online"], True)
        self.assertIs(snapshot["low_food"], False)
        self.assertIs(snapshot["battery_power"], True)
        self.assertEqual(snapshot["battery_percentage"], 83)
        self.assertEqual(snapshot["desiccant_days"], 12)


if __name__ == "__main__":
    unittest.main()
