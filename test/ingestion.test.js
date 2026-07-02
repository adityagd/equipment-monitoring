const cds = require('@sap/cds');

// Bootstrap the CAP server in-process for testing (auto-serves from project root).
// `expect` is provided globally by jest.
const { GET } = cds.test(__dirname + '/..');

// Services require an authenticated user; mocked-auth accepts any username.
const AUTH = { auth: { username: 'supervisor', password: '' } };

describe('Ingestion pipeline (Event Mesh)', () => {
  test('a threshold breach persists a reading, raises an alert and flips status', async () => {
    const messaging = await cds.connect.to('messaging');

    // TEMP limit for PMP-FW-001 (Feedwater Pump A) maxValue = 85 (see Threshold.csv)
    await messaging.emit('sce/monitoring/equipment/reading/v1', {
      equipmentTag: 'PMP-FW-001',
      metric: 'TEMP',
      value: 120,
      unit: '°C',
      measuredAt: new Date().toISOString(),
      source: 'jest',
      quality: 'GOOD'
    });

    // Give the async handler a moment to complete
    await new Promise((r) => setTimeout(r, 300));

    const { data: alerts } = await GET(`/alerting/Alerts?$filter=measuredValue eq 120`, AUTH);
    expect(alerts.value.length).toBeGreaterThan(0);
    expect(alerts.value[0].status_code).toBe('OPEN');

    const { data: eq } = await GET(
      `/monitoring/Equipment?$filter=tag eq 'PMP-FW-001'&$select=status_code`, AUTH
    );
    expect(eq.value[0].status_code).toBe('CRIT');
  });

  test('a normal reading does not raise an alert', async () => {
    const messaging = await cds.connect.to('messaging');
    await messaging.emit('sce/monitoring/equipment/reading/v1', {
      equipmentTag: 'PMP-CW-002',
      metric: 'TEMP',
      value: 50,
      unit: '°C',
      measuredAt: new Date().toISOString(),
      source: 'jest'
    });
    await new Promise((r) => setTimeout(r, 200));

    const { data } = await GET(`/alerting/Alerts?$filter=measuredValue eq 50`, AUTH);
    expect(data.value.length).toBe(0);
  });
});
