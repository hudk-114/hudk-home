"""Binary sensors for Homerun Pet feeders."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import HomerunConfigEntry
from .entity import HomerunEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: HomerunConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up feeder binary sensors."""
    entities: list[BinarySensorEntity] = []
    for serial, snapshot in entry.runtime_data.data.items():
        entities.append(HomerunLowFoodSensor(entry.runtime_data, serial))
        if snapshot.get("battery_power") is not None:
            entities.append(HomerunBatteryPowerSensor(entry.runtime_data, serial))
    async_add_entities(entities)


class HomerunLowFoodSensor(HomerunEntity, BinarySensorEntity):
    """Whether the feeder reports insufficient food."""

    _attr_translation_key = "low_food"
    _attr_device_class = BinarySensorDeviceClass.PROBLEM

    def __init__(self, coordinator, serial: str) -> None:
        super().__init__(coordinator, serial, "low_food")

    @property
    def is_on(self) -> bool | None:
        return self.snapshot.get("low_food")


class HomerunBatteryPowerSensor(HomerunEntity, BinarySensorEntity):
    """Whether the feeder is currently on backup battery power."""

    _attr_translation_key = "battery_power"
    _attr_icon = "mdi:battery-arrow-down-outline"

    def __init__(self, coordinator, serial: str) -> None:
        super().__init__(coordinator, serial, "battery_power")

    @property
    def is_on(self) -> bool | None:
        return self.snapshot.get("battery_power")
