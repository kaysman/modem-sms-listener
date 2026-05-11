# modem-sms-listener

Listens for incoming SMS on a USB GSM modem, parses Bariox GPS tracker payloads, and publishes the location to NATS server.

## Requirements

- Node.js 20+
- A serial-accessible GSM modem (e.g. `/dev/ttyUSB2`)
- A reachable NATS server

## Setup

```bash
npm install
```

Create a `.env` file:

```env
USB_PORT=/dev/ttyUSB2
NATS_URL=nats://localhost:4222
```

## Run

```bash
npm start
```

On startup the modem is initialized in PDU mode, SIM storage is cleared, and the SIM's MSISDN is logged. Incoming SMS are auto-deleted after receipt.

## NATS output

Bariox-format messages are published as JSON on subject `gps.location.received`:

```json
{ "serial_no": "...", "lat": 0, "lng": 0, "speed": 0, "battery": 0 }
```

Non-Bariox SMS are logged but not published.
