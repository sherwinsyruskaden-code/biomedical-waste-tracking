# RFID / NFC hardware (backend only)

> **The web UI is QR-only.** The RFID reader tab, Web NFC scan and manual code entry were removed from the interface, and the tag-registration dialog was removed from batch detail. The backend endpoints, tables and resolver described below remain and are tested only through the API (no hardware). Re-adding a UI would be a front-end task.

**Status:** the software side is implemented; **no physical RFID reader or NFC tag was available, so these paths have not been tested with hardware.** QR scanning with a phone or laptop camera is the fully working, tested path.

## How identification is structured

- `container_identifiers` holds QR tokens, RFID EPCs and NFC UIDs for each container. One active `(method, value)` pair may exist system-wide, so a tag can never point at two containers.
- Every scan source calls `POST /api/identify { method, value, source, readerId? }`. Lifecycle actions (`pickup`, `handover`, `receive`) accept the same `{ scanMethod, identifier }` and check the tag belongs to that batch.
- Values are normalised: RFID/NFC IDs are upper-case hex with separators removed (`04:a2:3b:9c` → `04A23B9C`, 8–64 hex chars).
- Registering, moving (explicit "reassign" confirmation) and deactivating tags are admin/facility-staff actions and are audit-logged.
- RFID and NFC identify a container at the moment it is read. **They do not provide location tracking** — GPS comes from the transporter's phone.

## Supported now (software)

| Source | Hardware | How it works | Tested |
|---|---|---|---|
| Camera QR | Any phone/laptop camera | `qr-scanner` reads the label in the browser (HTTPS or localhost required) | Yes (code path); the E2E test uses manual entry because the headless browser has no camera |
| Keyboard-wedge RFID | USB or Bluetooth HID readers (common 125 kHz EM4100 / 13.56 MHz ISO 14443 desktop readers, many UHF handhelds in "keyboard mode") | Reader "types" the tag ID and presses Enter into the focused field on the *RFID reader* scan tab | Typing only, no reader |
| Web NFC | Android phone with NFC, Chrome browser, NDEF-capable tags (NTAG213/215/216) | `NDEFReader.scan()` returns the tag serial number | No |
| Manual entry | — | Paste a label link/code or type a tag ID | Yes |

## Recommended hardware for a pilot

- **Bags / containers at short range:** NTAG215 NFC stickers (13.56 MHz) + Android phones (Web NFC), or a USB 13.56 MHz desktop reader in keyboard mode at the facility desk. Cheap and works with the current code.
- **Gate / dock reading of many containers:** UHF (860–960 MHz, EPC Gen2) on-metal or bag tags + a fixed UHF reader with antennas (e.g. Impinj-based readers such as Zebra FX9600 or a ThingMagic module). These need the gateway below.
- Mind that liquids and metal sharps containers reduce UHF read range; test tag placement.

## Adding a fixed reader (not implemented)

A small gateway service near the reader would:
1. receive tag reads from the reader (LLRP, vendor SDK, or serial),
2. de-duplicate reads within a time window,
3. call `POST /api/identify` (and, for automated handovers, the lifecycle action endpoint) as a dedicated service account, sending `readerId` and `source: "reader_gateway"`.

Authentication for a headless gateway would need an API-key mechanism (not built: today every request is a user session). Because the lifecycle only consumes the resolved container, no change to the lifecycle code is required.
