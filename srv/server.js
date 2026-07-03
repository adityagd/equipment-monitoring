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

/** Resolve broker credentials from env vars (local) or a bound CF service. */
function resolveSolaceConfig() {
  // 1) Explicit env vars — local .env or `cf set-env`
  if (process.env.SOLACE_MQTT_URL) {
    return {
      url: process.env.SOLACE_MQTT_URL,
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
        url: c.mqttUrl || c.url,
        username: c.username,
        password: c.password
      };
    }
  } catch (e) {
    LOG.warn('Could not parse VCAP_SERVICES:', e.message);
  }
  return null;
}

cds.on('served', async () => {
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

  const messaging = await cds.connect.to('messaging');
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
