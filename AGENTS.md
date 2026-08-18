# Project instructions

- Treat Home Assistant as the only device execution and state authority.
- Keep vendor entity IDs behind stable HA scripts or capability mappings.
- Never commit secrets, tokens, OAuth data, `.storage`, databases, logs, backups, or certificates.
- Prefer official Home Assistant integrations and local protocols; document cloud dependencies explicitly.
- Every new writable capability needs a safety level, an allow-list mapping, success criteria, and a failure response.
- AI output must validate against `contracts/intent.schema.json`; never pass generated service names or entity IDs directly to Home Assistant.
- Update `docs/device-inventory.md` and `config/capabilities.yaml` together when a device becomes operational.
- Documentation and examples are Chinese-first; stable identifiers and code remain English.
