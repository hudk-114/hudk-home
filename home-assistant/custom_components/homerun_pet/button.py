"""Explicit manual actions for Homerun Pet feeders."""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import HomerunConfigEntry
from .api import HomerunApiError
from .entity import HomerunEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: HomerunConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up one fixed-portion feed button per feeder."""
    async_add_entities(
        HomerunFeedOnceButton(entry.runtime_data, serial)
        for serial in entry.runtime_data.data
    )


class HomerunFeedOnceButton(HomerunEntity, ButtonEntity):
    """Dispense exactly one portion after an explicit HA button press."""

    _attr_translation_key = "feed_once"
    _attr_icon = "mdi:bowl-mix"

    def __init__(self, coordinator, serial: str) -> None:
        super().__init__(coordinator, serial, "feed_once")

    @property
    def available(self) -> bool:
        return super().available and self.snapshot.get("online") is True

    async def async_press(self) -> None:
        try:
            await self.coordinator.api.async_manual_feed(self.serial, portions=1)
        except HomerunApiError as err:
            raise HomeAssistantError(f"霍曼喂食器出粮失败：{err}") from err
        await self.coordinator.async_request_refresh()
