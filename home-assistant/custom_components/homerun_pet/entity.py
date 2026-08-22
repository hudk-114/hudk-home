"""Shared Homerun Pet entity base."""

from __future__ import annotations

from typing import Any

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import HomerunCoordinator


class HomerunEntity(CoordinatorEntity[HomerunCoordinator]):
    """Base entity bound to one vendor device serial."""

    _attr_has_entity_name = True

    def __init__(
        self, coordinator: HomerunCoordinator, serial: str, suffix: str
    ) -> None:
        super().__init__(coordinator)
        self.serial = serial
        self._attr_unique_id = f"{serial}_{suffix}"
        device = self.snapshot["device"]
        model = str(device.get("model") or device.get("deviceCategory") or "PF20")
        name = str(device.get("deviceName") or device.get("nikename") or model)
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, serial)},
            manufacturer="Homerun",
            model=model,
            name=name,
        )

    @property
    def snapshot(self) -> dict[str, Any]:
        return self.coordinator.data[self.serial]
