"""Sensors for Homerun Pet feeders."""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.const import PERCENTAGE, UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import HomerunConfigEntry
from .entity import HomerunEntity


def _event_title(event: dict[str, Any] | None) -> str | None:
    if not isinstance(event, dict):
        return None
    body = event.get("body")
    if isinstance(body, dict):
        title = body.get("title")
        if isinstance(title, str) and title:
            return title[:255]
    general = event.get("general")
    return str(general)[:255] if general is not None else None


async def async_setup_entry(
    hass: HomeAssistant,
    entry: HomerunConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up feeder sensors."""
    entities: list[SensorEntity] = []
    for serial, snapshot in entry.runtime_data.data.items():
        entities.extend(
            [HomerunStatusSensor(entry.runtime_data, serial), HomerunLastEventSensor(entry.runtime_data, serial)]
        )
        if snapshot.get("battery_percentage") is not None:
            entities.append(HomerunBatterySensor(entry.runtime_data, serial))
        if snapshot.get("desiccant_days") is not None:
            entities.append(HomerunDesiccantSensor(entry.runtime_data, serial))
    async_add_entities(entities)


class HomerunStatusSensor(HomerunEntity, SensorEntity):
    """Cloud-reported online status."""

    _attr_translation_key = "status"
    _attr_icon = "mdi:food-drumstick"

    def __init__(self, coordinator, serial: str) -> None:
        super().__init__(coordinator, serial, "status")

    @property
    def native_value(self) -> str:
        online = self.snapshot.get("online")
        return "online" if online is True else "offline" if online is False else "unknown"


class HomerunLastEventSensor(HomerunEntity, SensorEntity):
    """Most recent event reported by the vendor cloud."""

    _attr_translation_key = "last_event"
    _attr_icon = "mdi:history"

    def __init__(self, coordinator, serial: str) -> None:
        super().__init__(coordinator, serial, "last_event")

    @property
    def native_value(self) -> str | None:
        return _event_title(self.snapshot.get("last_event"))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        event = self.snapshot.get("last_event")
        if not isinstance(event, dict):
            return {}
        return {
            key: event.get(key)
            for key in ("doDate", "time", "general")
            if event.get(key) is not None
        }


class HomerunBatterySensor(HomerunEntity, SensorEntity):
    """Backup battery percentage when the model supports it."""

    _attr_translation_key = "battery"
    _attr_device_class = SensorDeviceClass.BATTERY
    _attr_native_unit_of_measurement = PERCENTAGE

    def __init__(self, coordinator, serial: str) -> None:
        super().__init__(coordinator, serial, "battery")

    @property
    def native_value(self) -> int | None:
        return self.snapshot.get("battery_percentage")


class HomerunDesiccantSensor(HomerunEntity, SensorEntity):
    """Desiccant remaining days."""

    _attr_translation_key = "desiccant_remaining"
    _attr_native_unit_of_measurement = UnitOfTime.DAYS
    _attr_icon = "mdi:calendar-clock"

    def __init__(self, coordinator, serial: str) -> None:
        super().__init__(coordinator, serial, "desiccant_remaining")

    @property
    def native_value(self) -> int | None:
        return self.snapshot.get("desiccant_days")

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        start = self.snapshot.get("desiccant_start")
        return {"start_date": start} if start else {}
