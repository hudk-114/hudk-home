"""Minimal client for the Homerun Pet cloud API used by the official app."""

from __future__ import annotations

import json
import time
from typing import Any

from aiohttp import ClientError, ClientSession

from .protocol import as_bool, is_success, password_digest, request_signature

API_BASE_URL = "https://api.homerunsmart.com"


class HomerunApiError(Exception):
    """Base API error."""


class HomerunAuthError(HomerunApiError):
    """Authentication failed or expired."""

    def __init__(self, code: str, message: str) -> None:
        """Keep the vendor code and message available to the config flow."""
        self.code = code
        self.vendor_message = message
        super().__init__(f"{code}: {message}")


class HomerunTransportError(HomerunApiError):
    """The cloud request could not be completed or decoded."""


class HomerunApi:
    """Async client with no persistence of the account password."""

    def __init__(
        self,
        session: ClientSession,
        *,
        app_id: str,
        app_key: str,
        password_salt: str,
        token: str = "",
        language: str = "zh_CN",
    ) -> None:
        self._session = session
        self._app_id = app_id
        self._app_key = app_key
        self._password_salt = password_salt
        self.token = token
        self.language = language

    async def _post(
        self,
        path: str,
        data: dict[str, Any],
        *,
        authenticated: bool = True,
    ) -> dict[str, Any]:
        timestamp = str(int(time.time()))
        payload = {
            "data": data,
            "timestamp": timestamp,
            "sign": request_signature(data, timestamp, self._app_key),
        }
        headers = {
            "Content-Type": "application/json",
            "x-lang": self.language,
            "x-token": self.token if authenticated else "",
        }
        try:
            async with self._session.post(
                f"{API_BASE_URL}{path}", json=payload, headers=headers
            ) as response:
                response.raise_for_status()
                result = await response.json(content_type=None)
        except (ClientError, TimeoutError, ValueError) as err:
            raise HomerunTransportError(
                f"Homerun cloud request failed: {err}"
            ) from err

        if not isinstance(result, dict):
            raise HomerunTransportError("Homerun cloud returned an invalid response")
        if not is_success(result.get("code")):
            code = str(result.get("code", "unknown"))
            message = str(result.get("msg", "unknown error"))
            # A structured response from the unauthenticated login endpoint proves
            # connectivity. Treat it as a rejected login, not a transport failure.
            if not authenticated or code in {"401", "4010", "4011", "4001", "4003"}:
                raise HomerunAuthError(code, message)
            raise HomerunApiError(f"{code}: {message}")
        return result

    async def async_login(
        self,
        *,
        phone: str,
        password: str,
        device_id: str,
        area_code: str,
        country_code: str = "CN",
        region: str = "Asia",
    ) -> str:
        result = await self._post(
            "/app/v1/login/phonePassword",
            {
                "countryCode": country_code,
                "region": region,
                "langType": self.language,
                "appId": self._app_id,
                "areaCode": area_code,
                "phone": phone,
                "password": password_digest(
                    password, self._app_key, self._password_salt
                ),
                "deviceId": device_id,
                "model": "Home Assistant",
            },
            authenticated=False,
        )
        data = result.get("data")
        token = data.get("token") if isinstance(data, dict) else None
        if not isinstance(token, str) or not token:
            raise HomerunAuthError(
                "invalid_response", "Homerun cloud did not return a token"
            )
        self.token = token
        return token

    async def async_families(self) -> list[dict[str, Any]]:
        """Return every home available to the signed-in account."""
        result = await self._post(
            "/app/v1/family/list", {"page": 1, "limit": 100}
        )
        data = result.get("data")
        families = data.get("list") if isinstance(data, dict) else None
        if not isinstance(families, list):
            raise HomerunApiError("Homerun family list returned no list")
        return [item for item in families if isinstance(item, dict)]

    async def async_devices(self) -> list[dict[str, Any]]:
        """Return devices from every home available to the account."""
        devices: list[dict[str, Any]] = []
        for family in await self.async_families():
            family_id = family.get("id")
            if not isinstance(family_id, int):
                continue
            result = await self._post(
                "/app/v1/devices/list",
                {"familyId": family_id, "page": 1, "limit": 100},
            )
            data = result.get("data")
            family_devices = data.get("list") if isinstance(data, dict) else None
            if not isinstance(family_devices, list):
                raise HomerunApiError(
                    f"Homerun device list returned no list for family {family_id}"
                )
            for item in family_devices:
                if isinstance(item, dict):
                    item.setdefault("familyId", family_id)
                    devices.append(item)

        if not devices:
            return []
        return devices

    async def async_online(self, serial: str, fallback: Any = None) -> bool | None:
        try:
            result = await self._post(
                "/app/v1/devices/status", {"deviceSerial": serial}
            )
        except HomerunApiError:
            return as_bool(fallback)
        data = result.get("data")
        return as_bool(data.get("status") if isinstance(data, dict) else fallback)

    async def async_property(self, serial: str, identifier: str) -> Any:
        headers = json.dumps(
            {
                "Content-Type": "application/json",
                "deviceSerial": serial,
                "localIndex": 0,
                "resourceCategory": "PetFeederRes",
                "domainIdentifier": "global",
                "propIdentifier": identifier,
            },
            separators=(",", ":"),
            ensure_ascii=False,
        )
        result = await self._post(
            "/app/v1/devices/control",
            {
                "url": "/api/v3/device/otap/prop",
                "method": "GET",
                "headers": headers,
                "body": "",
            },
        )
        inner = result.get("data")
        if not isinstance(inner, dict):
            raise HomerunApiError(f"Property {identifier} returned no data")
        meta = inner.get("meta")
        if isinstance(meta, dict) and not is_success(meta.get("code")):
            raise HomerunApiError(
                f"Property {identifier} failed: {meta.get('message', 'unknown error')}"
            )
        return inner.get("data")

    async def async_last_event(self, serial: str) -> dict[str, Any] | None:
        result = await self._post(
            "/app/v2/devicesDynamic/list",
            {"deviceSerial": serial, "doDate": "", "page": 1, "limit": 1},
        )
        data = result.get("data")
        events = data.get("list") if isinstance(data, dict) else None
        if not isinstance(events, list) or not events or not isinstance(events[0], dict):
            return None
        return events[0]

    async def async_manual_feed(self, serial: str, portions: int = 1) -> None:
        if portions != 1:
            raise HomerunApiError("Only one fixed portion is allowed")
        headers = json.dumps(
            {
                "Content-Type": "application/json",
                "deviceSerial": serial,
                "localIndex": 0,
                "resourceCategory": "PetFeederRes",
                "domainIdentifier": "global",
                "actionIdentifier": "ManualFeed",
            },
            separators=(",", ":"),
            ensure_ascii=False,
        )
        result = await self._post(
            "/app/v1/devices/control",
            {
                "url": "/api/v3/device/otap/action",
                "method": "PUT",
                "headers": headers,
                "body": "1",
            },
        )
        inner = result.get("data")
        meta = inner.get("meta") if isinstance(inner, dict) else None
        if not isinstance(meta, dict) or not is_success(meta.get("code")):
            message = meta.get("message") if isinstance(meta, dict) else "missing reply"
            raise HomerunApiError(f"Manual feed was not accepted by the device: {message}")
