"""Homerun Pet integration setup."""

from __future__ import annotations

from typing import TypeAlias

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import HomerunApi
from .const import CONF_TOKEN, DOMAIN, PLATFORMS, load_vendor_keys
from .coordinator import HomerunCoordinator

HomerunConfigEntry: TypeAlias = ConfigEntry[HomerunCoordinator]


async def async_setup_entry(hass: HomeAssistant, entry: HomerunConfigEntry) -> bool:
    """Set up Homerun Pet from a config entry."""
    app_id, app_key, password_salt = load_vendor_keys()
    api = HomerunApi(
        async_get_clientsession(hass),
        app_id=app_id,
        app_key=app_key,
        password_salt=password_salt,
        token=entry.data[CONF_TOKEN],
    )
    coordinator = HomerunCoordinator(hass, entry, api)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: HomerunConfigEntry) -> bool:
    """Unload a config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
