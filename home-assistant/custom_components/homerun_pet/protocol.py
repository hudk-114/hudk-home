"""Pure protocol helpers kept independent from Home Assistant and aiohttp."""

from __future__ import annotations

import hashlib
from typing import Any


def password_digest(password: str, app_key: str, password_salt: str) -> str:
    """Match the password transform used by the official mobile client."""
    digest = hashlib.md5(f"{app_key}{password}{password_salt}".encode()).hexdigest()
    return digest[7:27]


def request_signature(data: dict[str, Any], timestamp: str, app_key: str) -> str:
    """Sign an old-API request exactly as the official client does."""
    def java_string(value: Any) -> str:
        if value is True:
            return "true"
        if value is False:
            return "false"
        if value is None:
            return "null"
        return str(value)

    pairs = "".join(
        f"{key}={java_string(data[key])}&" for key in sorted(data, reverse=True)
    )
    source = f"{pairs}appKey={app_key}&timestamp={timestamp}"
    return hashlib.sha256(source.encode()).hexdigest()


def is_success(code: Any) -> bool:
    """Accept the numeric and string success forms returned by the API."""
    return str(code) == "200"


def as_bool(value: Any) -> bool | None:
    """Normalize the vendor's mixed boolean representation."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "on", "yes", "online"}:
            return True
        if normalized in {"false", "0", "off", "no", "offline"}:
            return False
    return None


def as_int(value: Any) -> int | None:
    """Normalize integer-like JSON values."""
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            return int(float(value))
        except ValueError:
            return None
    return None


def normalize_snapshot(
    device: dict[str, Any],
    *,
    online: Any,
    properties: dict[str, Any],
    last_event: dict[str, Any] | None,
) -> dict[str, Any]:
    """Normalize loosely typed vendor responses for HA entities."""
    desiccant = properties.get("Desiccant")
    return {
        "device": device,
        "online": as_bool(online),
        "low_food": as_bool(properties.get("LackFood")),
        "battery_power": as_bool(properties.get("BatterIn")),
        "battery_percentage": as_int(properties.get("BatteryPercentage")),
        "desiccant_days": as_int(
            desiccant.get("RemainingDays") if isinstance(desiccant, dict) else None
        ),
        "desiccant_start": (
            desiccant.get("StartDate") if isinstance(desiccant, dict) else None
        ),
        "last_event": last_event,
    }
