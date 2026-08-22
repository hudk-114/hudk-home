"""Polling coordinator for Homerun Pet devices."""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import HomerunApi, HomerunApiError, HomerunAuthError
from .const import DEFAULT_SCAN_INTERVAL_SECONDS, DOMAIN
from .protocol import normalize_snapshot

PROPERTY_IDENTIFIERS = ("LackFood", "BatterIn", "BatteryPercentage", "Desiccant")
_LOGGER = logging.getLogger(__name__)


def _is_feeder(device: dict[str, Any]) -> bool:
    searchable = " ".join(
        str(device.get(key, ""))
        for key in ("model", "categ", "deviceCategory", "deviceName", "nikename")
    ).upper()
    return any(marker in searchable for marker in ("PF20", "FEEDER", "喂食", "猫粮"))


class HomerunCoordinator(DataUpdateCoordinator[dict[str, dict[str, Any]]]):
    """Keep one normalized snapshot per feeder."""

    def __init__(
        self, hass: HomeAssistant, entry: ConfigEntry, api: HomerunApi
    ) -> None:
        super().__init__(
            hass,
            logger=_LOGGER,
            name=DOMAIN,
            config_entry=entry,
            update_interval=timedelta(seconds=DEFAULT_SCAN_INTERVAL_SECONDS),
        )
        self.api = api

    async def _optional_property(self, serial: str, identifier: str) -> Any:
        try:
            return await self.api.async_property(serial, identifier)
        except HomerunAuthError:
            raise
        except HomerunApiError:
            return None

    async def _device_snapshot(self, device: dict[str, Any]) -> dict[str, Any]:
        serial = str(device["deviceSerial"])
        results = await asyncio.gather(
            self.api.async_online(serial, device.get("status")),
            self.api.async_last_event(serial),
            *(self._optional_property(serial, prop) for prop in PROPERTY_IDENTIFIERS),
            return_exceptions=True,
        )
        for result in results:
            if isinstance(result, HomerunAuthError):
                raise result
        online = None if isinstance(results[0], Exception) else results[0]
        last_event = None if isinstance(results[1], Exception) else results[1]
        properties = {
            identifier: None if isinstance(value, Exception) else value
            for identifier, value in zip(PROPERTY_IDENTIFIERS, results[2:], strict=True)
        }
        return normalize_snapshot(
            device,
            online=online,
            properties=properties,
            last_event=last_event,
        )

    async def _async_update_data(self) -> dict[str, dict[str, Any]]:
        try:
            devices = [device for device in await self.api.async_devices() if _is_feeder(device)]
            if not devices:
                raise UpdateFailed("霍曼账号中没有发现喂食器")
            snapshots = await asyncio.gather(
                *(self._device_snapshot(device) for device in devices)
            )
            return {
                str(snapshot["device"]["deviceSerial"]): snapshot
                for snapshot in snapshots
            }
        except HomerunAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except HomerunApiError as err:
            raise UpdateFailed(str(err)) from err
