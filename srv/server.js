const cds = require('@sap/cds');
const LOG = cds.log('solace-bridge');

/**
 * Solace <-> CAP messaging bridge (MQTT)
 * --------------------------------------
 * SAP Event Mesh is not available in BTP trial accounts, so we use a Solace
 * PubSub+ broker (a.k.a. SAP Advanced Event Mesh) instead. This bridge keeps
 * the application code unchanged:
 *
 *   Solace topic ──(MQTT)──▶ this bridge ──▶ internal cds messaging ──▶ IngestionService
 *   IngestionService ──emit──▶ internal cds messaging ──▶ this bridge ──(MQTT)──▶ Solace topic
 *
 * The internal `messaging` service is a plain in-process bus (local-messaging);
 * Solace is the real broker reached over MQTT here. If no Solace credentials
 * are configured the bridge disables itself and the app runs on internal
 * messaging only (useful for local dev / tests).
 */

const INBOUND_TOPIC = 'sce/monitoring/equipment/reading/v1';
const OUTBOUND_TOPICS = [
  'sce/monitoring/equipment/alert/raised/v1',
  'sce/monitoring/equipment/status/changed/v1'
];

/**
 * Load a local `.env` (KEY=VALUE) into process.env for development, if present.
 * No-op in Cloud Foundry (no .env file — creds come from VCAP_SERVICES). Does
 * not overwrite variables already set in the real environment.
 */
function loadDotEnv() {
  try {
    const fs = require('fs');
    const path = require('path');
    const file = path.join(cds.root || process.cwd(), '.env');
    if (!fs.existsSync(file)) return;
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch (e) {
    cds.log('solace-bridge').warn('Could not read .env:', e.message);
  }
}

/** Normalize a Solace host URI to a scheme the Node `mqtt` client understands. */
function normalizeMqttUrl(url) {
  if (!url) return url;
  return url.replace(/^ssl:\/\//i, 'mqtts://').replace(/^tcp:\/\//i, 'mqtt://');
}

/** Resolve broker credentials from env vars (local) or a bound CF service. */
function resolveSolaceConfig() {
  loadDotEnv();
  // 1) Explicit env vars — local .env or `cf set-env`
  if (process.env.SOLACE_MQTT_URL) {
    return {
      url: normalizeMqttUrl(process.env.SOLACE_MQTT_URL),
      username: process.env.SOLACE_MQTT_USERNAME,
      password: process.env.SOLACE_MQTT_PASSWORD
    };
  }
  // 2) A user-provided service bound to the app (VCAP_SERVICES)
  try {
    const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}');
    const ups = (vcap['user-provided'] || []).find((s) => /solace/i.test(s.name));
    if (ups && ups.credentials) {
      const c = ups.credentials;
      return {
        url: normalizeMqttUrl(c.mqttUrl || c.url),
        username: c.username,
        password: c.password
      };
    }
  } catch (e) {
    LOG.warn('Could not parse VCAP_SERVICES:', e.message);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Live push to dashboards via Server-Sent Events (SSE)
// ---------------------------------------------------------------------------
// The dashboard opens an EventSource on /alerting/stream. Whenever an alert or
// status-change event hits the internal bus, it is streamed to every connected
// browser instantly (no 15s poll needed). One-way server -> client, plain HTTP,
// so it traverses the approuter as a normal /alerting/* route.
const sseClients = new Set();

function broadcastSSE(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(frame); } catch (e) { /* client gone; cleaned up on close */ }
  }
}

cds.on('bootstrap', (app) => {
  // Registered before the OData service is mounted at /alerting, so this exact
  // path takes precedence over the service router.
  app.get('/alerting/stream', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });
    if (res.flushHeaders) res.flushHeaders();
    res.write('retry: 5000\n\n');
    sseClients.add(res);
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (e) { /* ignore */ }
    }, 25000);
    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });
});

cds.on('served', async () => {
  const messaging = await cds.connect.to('messaging');

  // Live push (always on, independent of Solace).
  messaging.on('sce/monitoring/equipment/alert/raised/v1', (msg) => broadcastSSE('alert', msg.data));
  messaging.on('sce/monitoring/equipment/status/changed/v1', (msg) => broadcastSSE('status', msg.data));

  const cfg = resolveSolaceConfig();
  if (!cfg || !cfg.url) {
    return LOG.info('No Solace configuration found — internal messaging only (bridge disabled).');
  }

  let mqtt;
  try {
    mqtt = require('mqtt');
  } catch (e) {
    return LOG.warn('The `mqtt` package is not installed — Solace bridge disabled. Run `npm i mqtt`.');
  }

  const client = mqtt.connect(cfg.url, {
    username: cfg.username,
    password: cfg.password,
    clientId: 'equipment-monitoring-' + Math.random().toString(16).slice(2, 8),
    reconnectPeriod: 5000,
    connectTimeout: 15000,
    clean: true
  });

  client.on('connect', () => {
    LOG.info('Connected to Solace broker:', cfg.url);
    client.subscribe(INBOUND_TOPIC, { qos: 1 }, (err) => {
      if (err) LOG.error('Subscribe failed for', INBOUND_TOPIC, err.message);
      else LOG.info('Subscribed to inbound topic:', INBOUND_TOPIC);
    });
  });
  client.on('reconnect', () => LOG.info('Reconnecting to Solace...'));
  client.on('error', (e) => LOG.error('Solace MQTT error:', e.message));

  // Inbound: Solace reading -> internal bus -> IngestionService.handleReading
  client.on('message', async (topic, payload) => {
    try {
      const data = JSON.parse(payload.toString());
      await messaging.emit(topic, data);
    } catch (e) {
      LOG.error('Failed to process inbound message on', topic, '-', e.message);
    }
  });

  // Outbound: internal alert/status events -> Solace
  for (const topic of OUTBOUND_TOPICS) {
    messaging.on(topic, (msg) => {
      client.publish(topic, JSON.stringify(msg.data), { qos: 1 }, (err) => {
        if (err) LOG.error('Publish failed for', topic, err.message);
        else LOG.info('Published to Solace:', topic);
      });
    });
  }

  cds.on('shutdown', () => client.end(true));
});
