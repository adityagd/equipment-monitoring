const cds = require('@sap/cds');

/**
 * IngestionService
 * ----------------
 * Event-driven core of the solution. Consumes raw telemetry from SAP Event
 * Mesh, persists it, evaluates it against configured thresholds, and emits
 * downstream alert / status-change events.
 *
 *   [external gateway] --(reading)--> Event Mesh --> IngestionService
 *        -> persist SensorReading
 *        -> evaluate Thresholds
 *        -> raise Alert + emit AlertRaised
 *        -> update Equipment.status + emit EquipmentStatusChanged
 */
module.exports = class IngestionService extends cds.ApplicationService {
  async init() {
    const { Equipment, SensorReading, Threshold, Alert } = cds.entities('sce.monitoring');
    const messaging = await cds.connect.to('messaging');

    // ---- Inbound: consume readings published to the Event Mesh topic --------
    messaging.on('sce/monitoring/equipment/reading/v1', (msg) =>
      this.handleReading(msg.data)
    );

    // Also accept readings via the typed service event (local emit / tests)
    this.on('SensorReadingReceived', (req) => this.handleReading(req.data));

    await super.init();

    // Store references for handlers
    this.entities = { Equipment, SensorReading, Threshold, Alert };
    this.messaging = messaging;
  }

  /**
   * Process a single inbound reading end-to-end.
   * @param {object} reading { equipmentTag, metric, value, unit, measuredAt, source, quality }
   */
  async handleReading(reading) {
    const { Equipment, SensorReading, Threshold } = this.entities;
    const { equipmentTag, metric, value } = reading;

    if (!equipmentTag || !metric || value == null) {
      return cds.log('ingestion').warn('Discarding malformed reading', reading);
    }

    const equipment = await SELECT.one.from(Equipment).where({ tag: equipmentTag });
    if (!equipment) {
      return cds.log('ingestion').warn(`Unknown equipment tag '${equipmentTag}' — reading dropped`);
    }

    const measuredAt = reading.measuredAt || new Date().toISOString();

    // 1) Persist the reading
    await INSERT.into(SensorReading).entries({
      equipment_ID: equipment.ID,
      metric_code: metric,
      value,
      unit: reading.unit,
      measuredAt,
      source: reading.source,
      quality: reading.quality || 'GOOD'
    });

    // 2) Evaluate against active thresholds for this equipment + metric
    const thresholds = await SELECT.from(Threshold).where({
      equipment_ID: equipment.ID,
      metric_code: metric,
      active: true
    });

    let level = 'OK'; // OK | WARN | CRIT
    let breached = null;
    for (const t of thresholds) {
      const overMax = t.maxValue != null && value > t.maxValue;
      const underMin = t.minValue != null && value < t.minValue;
      const warnHi = t.warnMax != null && value > t.warnMax;
      const warnLo = t.warnMin != null && value < t.warnMin;
      if (overMax || underMin) {
        level = 'CRIT';
        breached = t;
        break;
      } else if (warnHi || warnLo) {
        level = 'WARN';
        breached = t;
      }
    }

    // 3) Raise an alert on a hard breach
    if (level === 'CRIT' && breached) {
      await this.raiseAlert(equipment, reading, breached);
    }

    // 4) Reconcile equipment status and emit a status-change event
    const newStatus = level === 'CRIT' ? 'CRIT' : level === 'WARN' ? 'WARN' : 'OK';
    await this.updateStatus(equipment, newStatus);
  }

  /** Persist an Alert row and publish AlertRaised to Event Mesh. */
  async raiseAlert(equipment, reading, threshold) {
    const { Alert } = this.entities;
    const limitValue =
      reading.value > (threshold.maxValue ?? Infinity) ? threshold.maxValue : threshold.minValue;

    const message =
      `${reading.metric} = ${reading.value}${reading.unit || ''} breached limit ` +
      `${limitValue} on ${equipment.tag} (${equipment.name})`;

    const alertID = cds.utils.uuid();
    const alert = {
      ID: alertID,
      equipment_ID: equipment.ID,
      metric_code: reading.metric,
      severity_code: threshold.severity_code || 'HIGH',
      status_code: 'OPEN',
      message,
      measuredValue: reading.value,
      limitValue
    };

    await INSERT.into(Alert).entries(alert);

    await this.messaging.emit('sce/monitoring/equipment/alert/raised/v1', {
      alertID,
      equipmentID: equipment.ID,
      equipmentTag: equipment.tag,
      metric: reading.metric,
      severity: alert.severity_code,
      message,
      measuredValue: reading.value,
      limitValue,
      raisedAt: new Date().toISOString()
    });

    cds.log('ingestion').info('⚠️  Alert raised:', message);
  }

  /** Update the aggregate status of an equipment and emit a change event. */
  async updateStatus(equipment, newStatus) {
    const { Equipment } = this.entities;
    if (equipment.status_code === newStatus) return;

    await UPDATE(Equipment, equipment.ID).with({ status_code: newStatus });

    await this.messaging.emit('sce/monitoring/equipment/status/changed/v1', {
      equipmentID: equipment.ID,
      equipmentTag: equipment.tag,
      oldStatus: equipment.status_code,
      newStatus,
      changedAt: new Date().toISOString()
    });

    cds.log('ingestion').info(
      `Equipment ${equipment.tag} status ${equipment.status_code} -> ${newStatus}`
    );
  }
};
