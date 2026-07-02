/**
 * Local telemetry publisher for development.
 *
 * Simulates the external gateway/device that, in production, publishes onto the
 * SAP Event Mesh topic `sce/monitoring/equipment/reading/v1`. Locally this uses
 * the file-based-messaging broker configured for the [development] profile.
 *
 *   node scripts/simulate-publisher.js            # continuous stream
 *   node scripts/simulate-publisher.js --once      # single burst
 *   node scripts/simulate-publisher.js --spike      # force a threshold breach
 *
 * Run `cds watch` in another terminal first so the ingestion handlers are live.
 */
const cds = require('@sap/cds');

const TOPIC = 'sce/monitoring/equipment/reading/v1';

// Matches db/data seed equipment tags + threshold metrics
const FLEET = [
  { tag: 'PMP-FW-001', metrics: { TEMP: [40, 70, '°C'], VIB: [1.0, 4.0, 'mm/s'] } },
  { tag: 'PMP-CW-002', metrics: { TEMP: [45, 75, '°C'] } },
  { tag: 'MTR-DR-010', metrics: { CURR: [60, 90, 'A'], VIB: [1.0, 3.0, 'mm/s'] } },
  { tag: 'CMP-AIR-101', metrics: { PRES: [5, 8.5, 'bar'] } },
  { tag: 'XFMR-SS-001', metrics: { TEMP: [40, 60, '°C'] } }
];

function rnd(min, max) {
  return Math.round((min + Math.random() * (max - min)) * 100) / 100;
}

function buildReadings({ spike }) {
  const readings = [];
  for (const eq of FLEET) {
    for (const [metric, [lo, hi, unit]] of Object.entries(eq.metrics)) {
      // Occasionally (or always, with --spike) push a value well past the limit.
      const breach = spike || Math.random() < 0.1;
      const value = breach ? rnd(hi * 1.15, hi * 1.4) : rnd(lo, hi);
      readings.push({
        equipmentTag: eq.tag,
        metric,
        value,
        unit,
        measuredAt: new Date().toISOString(),
        source: 'sim-gateway-01',
        quality: 'GOOD'
      });
    }
  }
  return readings;
}

(async () => {
  const once = process.argv.includes('--once');
  const spike = process.argv.includes('--spike');

  const messaging = await cds.connect.to('messaging');
  console.log(`Publishing to ${TOPIC} (once=${once}, spike=${spike})`);

  async function tick() {
    const readings = buildReadings({ spike });
    for (const r of readings) {
      await messaging.emit(TOPIC, r);
      console.log(`  → ${r.equipmentTag} ${r.metric}=${r.value}${r.unit || ''}`);
    }
  }

  await tick();
  if (once || spike) return process.exit(0);

  setInterval(tick, 5000);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
