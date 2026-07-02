# Real-Time Equipment Monitoring & Alerting System

An end-to-end SAP BTP solution that ingests equipment telemetry in real time,
evaluates it against operating thresholds, raises alerts, and surfaces
everything on a live Fiori dashboard.

## Architecture

```
 External gateways / devices
          │  (publish readings)
          ▼
   ┌───────────────┐        sce/monitoring/equipment/reading/v1
   │ SAP Event Mesh│ ◀───────────────────────────────────────────┐
   └──────┬────────┘                                              │
          │ (queue subscription)                                  │
          ▼                                                       │
   ┌──────────────────────────────────────────────┐              │
   │ CAP backend (Node.js)                          │             │
   │                                                │             │
   │  IngestionService  ── persist reading          │             │
   │        │           ── evaluate thresholds      │             │
   │        │           ── raise Alert ─────────────┼── emit ─────┘
   │        ▼                                        │  alert.raised / status.changed
   │  HANA (HDI container)                           │
   │                                                 │
   │  MonitoringService (read)   AlertingService     │
   │        │                        │  resolve →    │
   └────────┼────────────────────────┼── Destination ── External Maintenance backend
            │                        │
            ▼                        ▼
   ┌──────────────────────────────────────────────┐
   │ Standalone App Router (XSUAA-secured)          │
   │   /monitoring, /alerting  → srv                │
   │   /  → Fiori dashboard (SAPUI5)                │
   └──────────────────────────────────────────────┘
```

| Concern              | Technology                                             |
|----------------------|--------------------------------------------------------|
| Backend              | SAP CAP (Node.js), OData V4                             |
| Eventing             | SAP Event Mesh (`enterprise-messaging`)                |
| Persistence          | SAP HANA Cloud (HDI) / SQLite locally                  |
| Frontend             | SAPUI5 / Fiori freestyle dashboard                     |
| Auth                 | XSUAA (Viewer / Supervisor roles)                      |
| External integration | SAP BTP Destination + Connectivity service            |
| Deployment           | Cloud Foundry via MTA (`mta.yaml`)                     |

## Project layout

```
db/            CDS data model + CSV seed data
srv/           OData services + Event Mesh handlers
  messaging.cds        event catalog + IngestionService (topics)
  ingestion-service.js inbound reading → persist → evaluate → alert
  monitoring-service.* read model powering the dashboard
  alerting-service.*   alert lifecycle + Destination integration
  external/            imported model of the external maintenance API
app/dashboard/ SAPUI5 dashboard (webapp)
app/router/    standalone approuter (serves UI + proxies OData)
scripts/       local Event Mesh publisher simulator
test/          jest tests for the ingestion pipeline
mta.yaml       Cloud Foundry deployment descriptor
xs-security.json  XSUAA scopes / roles / role collections
```

## Run locally

Prereqs: Node.js ≥ 20 and the CAP dev kit.

```bash
npm install
npm i -g @sap/cds-dk          # provides the `cds` CLI

# Terminal 1 — start the app (SQLite in-memory + file-based messaging)
cds watch

# Terminal 2 — simulate the external Event Mesh publisher
node scripts/simulate-publisher.js          # continuous stream
node scripts/simulate-publisher.js --spike  # force a threshold breach
```

Then open the dashboard at <http://localhost:4004/dashboard/webapp/index.html>
(served from `app/`). Alerts and KPI tiles update on a 15s poll.

Run the tests:

```bash
npm test
```

## Event topics

| Topic                                            | Direction | Purpose                          |
|--------------------------------------------------|-----------|----------------------------------|
| `sce/monitoring/equipment/reading/v1`            | inbound   | raw telemetry from gateways      |
| `sce/monitoring/equipment/alert/raised/v1`       | outbound  | alert raised on threshold breach |
| `sce/monitoring/equipment/status/changed/v1`     | outbound  | equipment status transition      |

## Deploy to Cloud Foundry

Prereqs: `cf` CLI (logged in to your BTP CF space) and the Cloud MTA Build Tool.

```bash
npm i -g mbt
mbt build                          # produces mta_archives/*.mtar
cf deploy mta_archives/equipment-monitoring_1.0.0.mtar
```

This provisions XSUAA, HANA HDI, Event Mesh, Destination and Connectivity
services, deploys the CAP backend, the HANA content, and the approuter.
After deployment, assign the **EquipmentMonitoringViewer** /
**EquipmentMonitoringSupervisor** role collections to users in the BTP cockpit,
and point the `MaintenanceBackend` destination at your real backend.

---

> ⚠️ This is a generated scaffold intended as a starting point. The threshold
> logic, security scopes, destination target and Event Mesh sizing are demo
> defaults. **Please have a qualified person review this before external or
> production use.** Any code deployment must be reviewed and approved by a
> qualified human before it is carried out.
