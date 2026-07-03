# Solace PubSub+ as the Event Broker (BTP Trial)

SAP Event Mesh is **not available in BTP trial accounts**, so this project uses
an external **Solace PubSub+** broker (the same technology behind SAP Advanced
Event Mesh) reached over **MQTT**. A bridge in [`srv/server.js`](srv/server.js)
connects the broker to the app's internal event bus, so no service code changes
are needed. If no Solace credentials are present, the app falls back to internal
messaging and the bridge disables itself.

```
 publisher ──MQTT──▶ Solace PubSub+ ──MQTT──▶ srv/server.js ──▶ IngestionService
 IngestionService ──emit──▶ srv/server.js ──MQTT──▶ Solace PubSub+ ──▶ subscribers
```

---

## 1. Create a free Solace PubSub+ Cloud broker

1. Go to <https://solace.com> → **Get PubSub+ for Free** → **Get started with Cloud**.
2. Sign up and create a **service** (the free tier gives one single-node broker).
3. Open the service → **Connect** tab → **MQTT** section. Note these values:

   | Value            | Example                                             |
   |------------------|-----------------------------------------------------|
   | Secured MQTT URL | `mqtts://mr-connection-abc123.messaging.solace.cloud:8883` |
   | Username         | `solace-cloud-client`                               |
   | Password         | (shown on the Connect tab)                          |
   | Message VPN      | `msgvpn-abc123` (informational; not needed for MQTT) |

   > Use the **secured** endpoint (`mqtts://…:8883`). Solace Cloud certificates
   > are signed by a public CA, so the Node `mqtt` client validates TLS with no
   > extra config.

No manual topic/queue creation is required — MQTT clients publish/subscribe to
topics directly. The topics used are:

| Topic                                        | Direction | Purpose                     |
|----------------------------------------------|-----------|-----------------------------|
| `sce/monitoring/equipment/reading/v1`        | inbound   | telemetry from publishers   |
| `sce/monitoring/equipment/alert/raised/v1`   | outbound  | alert raised                |
| `sce/monitoring/equipment/status/changed/v1` | outbound  | equipment status change     |

---

## 2. Local development

```bash
cp .env.sample .env
# edit .env with the MQTT URL / username / password from step 1
```

```
SOLACE_MQTT_URL=mqtts://mr-connection-abc123.messaging.solace.cloud:8883
SOLACE_MQTT_USERNAME=solace-cloud-client
SOLACE_MQTT_PASSWORD=********
```

Then:

```bash
cds watch          # bridge connects on startup; look for "Connected to Solace broker"
```

Publish a test reading from Solace Cloud's **Try Me!** tab (topic
`sce/monitoring/equipment/reading/v1`) with a body like:

```json
{ "equipmentTag": "PMP-FW-001", "metric": "TEMP", "value": 120, "unit": "°C", "measuredAt": "2026-07-03T10:00:00Z", "source": "solace-tryme" }
```

An alert should appear in the dashboard, and an `alert.raised` message should be
delivered back to the broker.

---

## 3. BTP trial deployment (Cloud Foundry)

Solace is external, so its credentials are supplied to the app as a
**user-provided service** — no Event Mesh entitlement needed.

```bash
# 1) Build & deploy the MTA (deploys fine even before Solace is bound)
mbt build
cf deploy mta_archives/equipment-monitoring_1.0.0.mtar

# 2) Create a user-provided service holding the Solace MQTT credentials
cf cups equipment-monitoring-solace -p '{
  "mqttUrl":  "mqtts://mr-connection-abc123.messaging.solace.cloud:8883",
  "username": "solace-cloud-client",
  "password": "********"
}'

# 3) Bind it to the backend app and restage so it reads VCAP_SERVICES
cf bind-service equipment-monitoring-srv equipment-monitoring-solace
cf restage equipment-monitoring-srv
```

The bridge auto-detects the bound service (it looks for a user-provided service
whose name contains `solace`) — no config change needed.

> **Alternative to a user-provided service:** set the three env vars directly:
> ```bash
> cf set-env equipment-monitoring-srv SOLACE_MQTT_URL "mqtts://…:8883"
> cf set-env equipment-monitoring-srv SOLACE_MQTT_USERNAME "solace-cloud-client"
> cf set-env equipment-monitoring-srv SOLACE_MQTT_PASSWORD "********"
> cf restage equipment-monitoring-srv
> ```

Verify:

```bash
cf logs equipment-monitoring-srv --recent | grep -i solace
# expect: "Connected to Solace broker: mqtts://…"
```

---

## 4. Scaling caveat (important)

The internal bus is `local-messaging` (in-process). With **more than one `srv`
instance**, every instance subscribes to the inbound MQTT topic and would
process each reading multiple times. For trial, **keep `srv` at 1 instance**
(`memory: 512M`, `instances: 1`). To scale out later, switch the inbound
subscription to an **MQTT shared subscription** (`$share/<group>/<topic>`) or
bind the bridge to a **Solace queue** so a reading is processed exactly once.

---

## 5. Security / data-handling notes

- Solace Cloud is a **non-SAP service outside your BTP boundary**. Telemetry and
  equipment tags routed through it leave BTP — confirm this is permitted under
  your project's data classification policy before sending anything beyond demo
  data.
- Store the broker password only in the user-provided service or `cf set-env`
  (never in git). `.env` is git-ignored.
- Rotate the Solace credentials periodically and after any exposure.

> ⚠️ This configuration is a scaffold for a trial/demo. Please have a qualified
> person review the broker setup, credential handling, and scaling model before
> any external or production use. Any deployment must be reviewed and approved
> by a qualified human before it is carried out.
