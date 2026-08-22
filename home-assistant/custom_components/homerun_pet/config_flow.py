"""Config flow for Homerun Pet."""

from __future__ import annotations

import logging
import uuid
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.const import CONF_PASSWORD
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import TextSelector, TextSelectorConfig, TextSelectorType

from .api import (
    HomerunApi,
    HomerunApiError,
    HomerunAuthError,
    HomerunTransportError,
)
from .const import (
    CONF_AREA_CODE,
    CONF_DEVICE_ID,
    CONF_PHONE,
    CONF_TOKEN,
    DEFAULT_AREA_CODE,
    DOMAIN,
    load_vendor_keys,
)

_LOGGER = logging.getLogger(__name__)


def _login_error_key(err: HomerunAuthError) -> str:
    """Map safe vendor login messages to useful translated UI errors."""
    message = err.vendor_message.casefold()
    if "未注册" in message or "not registered" in message:
        return "account_not_registered"
    if "密码" in message or "password" in message:
        return "invalid_auth"
    return "login_rejected"


class HomerunConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the Homerun Pet config flow."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Collect the account once; store the token but never the password."""
        errors: dict[str, str] = {}
        if user_input is not None:
            phone = str(user_input[CONF_PHONE]).strip()
            area_code = str(user_input[CONF_AREA_CODE]).strip()
            try:
                app_id, app_key, password_salt = load_vendor_keys()
                device_id = uuid.uuid4().hex
                api = HomerunApi(
                    async_get_clientsession(self.hass),
                    app_id=app_id,
                    app_key=app_key,
                    password_salt=password_salt,
                )
                token = await api.async_login(
                    phone=phone,
                    password=user_input[CONF_PASSWORD],
                    device_id=device_id,
                    area_code=area_code,
                )
                devices = await api.async_devices()
                if not devices:
                    errors["base"] = "no_devices"
                else:
                    await self.async_set_unique_id(f"homerun:{area_code}:{phone}")
                    self._abort_if_unique_id_configured()
                    return self.async_create_entry(
                        title="霍曼宠物设备",
                        data={
                            CONF_PHONE: phone,
                            CONF_AREA_CODE: area_code,
                            CONF_DEVICE_ID: device_id,
                            CONF_TOKEN: token,
                        },
                    )
            except RuntimeError:
                errors["base"] = "vendor_keys_missing"
            except HomerunAuthError as err:
                _LOGGER.warning(
                    "Homerun cloud rejected login (code %s): %s",
                    err.code,
                    err.vendor_message,
                )
                errors["base"] = _login_error_key(err)
            except HomerunTransportError as err:
                _LOGGER.warning("Unable to reach Homerun cloud: %s", err)
                errors["base"] = "cannot_connect"
            except HomerunApiError as err:
                _LOGGER.warning("Homerun device discovery failed after login: %s", err)
                errors["base"] = "device_discovery_failed"

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_PHONE): TextSelector(),
                    vol.Required(CONF_PASSWORD): TextSelector(
                        TextSelectorConfig(type=TextSelectorType.PASSWORD)
                    ),
                    vol.Required(CONF_AREA_CODE, default=DEFAULT_AREA_CODE): str,
                }
            ),
            errors=errors,
        )

    async def async_step_reauth(
        self, entry_data: dict[str, Any]
    ) -> ConfigFlowResult:
        """Start reauthentication without recovering the old password."""
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Ask for the password only when the token expires."""
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                app_id, app_key, password_salt = load_vendor_keys()
                api = HomerunApi(
                    async_get_clientsession(self.hass),
                    app_id=app_id,
                    app_key=app_key,
                    password_salt=password_salt,
                )
                token = await api.async_login(
                    phone=self._get_reauth_entry().data[CONF_PHONE],
                    password=user_input[CONF_PASSWORD],
                    device_id=self._get_reauth_entry().data[CONF_DEVICE_ID],
                    area_code=self._get_reauth_entry().data[CONF_AREA_CODE],
                )
                return self.async_update_reload_and_abort(
                    self._get_reauth_entry(),
                    data_updates={CONF_TOKEN: token},
                )
            except RuntimeError:
                errors["base"] = "vendor_keys_missing"
            except HomerunAuthError as err:
                _LOGGER.warning(
                    "Homerun cloud rejected reauthentication (code %s): %s",
                    err.code,
                    err.vendor_message,
                )
                errors["base"] = _login_error_key(err)
            except HomerunTransportError as err:
                _LOGGER.warning("Unable to reach Homerun cloud: %s", err)
                errors["base"] = "cannot_connect"
            except HomerunApiError as err:
                _LOGGER.warning("Homerun reauthentication failed: %s", err)
                errors["base"] = "login_rejected"

        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_PASSWORD): TextSelector(
                        TextSelectorConfig(type=TextSelectorType.PASSWORD)
                    )
                }
            ),
            errors=errors,
        )
