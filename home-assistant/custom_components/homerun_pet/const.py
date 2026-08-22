"""Constants for the Homerun Pet integration."""

from __future__ import annotations

DOMAIN = "homerun_pet"
PLATFORMS = ["sensor", "binary_sensor", "button"]

CONF_PHONE = "phone"
CONF_AREA_CODE = "area_code"
CONF_TOKEN = "token"
CONF_DEVICE_ID = "device_id"

DEFAULT_AREA_CODE = "+86"
DEFAULT_COUNTRY_CODE = "CN"
DEFAULT_REGION = "Asia"
DEFAULT_LANGUAGE = "zh_CN"
DEFAULT_SCAN_INTERVAL_SECONDS = 60

ATTR_DEVICE_SERIAL = "device_serial"
ATTR_MODEL = "model"


def load_vendor_keys() -> tuple[str, str, str]:
    """Load untracked mobile-client material required by the vendor API."""
    try:
        from .vendor_keys import APP_ID, APP_KEY, PASSWORD_SALT
    except ImportError as err:
        raise RuntimeError("vendor_keys.py is missing") from err

    values = (APP_ID.strip(), APP_KEY.strip(), PASSWORD_SALT.strip())
    if not all(values) or any(value.startswith("replace_") for value in values):
        raise RuntimeError("vendor_keys.py is incomplete")
    return values
