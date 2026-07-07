const cds = require('@sap/cds');

/**
 * AlertingService
 * ----------------
 * Alert lifecycle management + optional creation of maintenance orders in an
 * external backend reached via the SAP BTP Destination service.
 */
module.exports = class AlertingService extends cds.ApplicationService {
  async init() {
    const { Alert } = cds.entities('sce.monitoring');

    this.on('acknowledge', (req) => this.acknowledge(req));
    this.on('resolve', (req) => this.resolve(req));
    this.on('bulkAcknowledge', (req) => this.bulkAcknowledge(req));

    // React to alerts raised by the ingestion pipeline (in-process signal).
    // In a distributed setup this same topic is consumed from Event Mesh.
    const messaging = await cds.connect.to('messaging');
    messaging.on('sce/monitoring/equipment/alert/raised/v1', (msg) => {
      cds.log('alerting').info('New alert available in inbox:', msg.data.message);
    });

    this.Alert = Alert;
    await super.init();
  }

  async acknowledge(req) {
    const { alertID, note } = req.data;
    const user = req.user?.id || 'anonymous';
    const updated = await UPDATE(this.Alert, alertID).with({
      status_code: 'ACK',
      acknowledgedAt: new Date().toISOString(),
      acknowledgedBy: user,
      note: note || undefined
    });
    if (!updated) return req.error(404, `Alert ${alertID} not found`);
    return SELECT.one.from(this.Alert).where({ ID: alertID });
  }

  async resolve(req) {
    const { alertID, note, createMaintenanceOrder } = req.data;
    const alert = await SELECT.one.from(this.Alert).where({ ID: alertID });
    if (!alert) return req.error(404, `Alert ${alertID} not found`);

    let maintenanceOrderId;
    if (createMaintenanceOrder) {
      maintenanceOrderId = await this.createMaintenanceOrder(alert, note);
    }

    await UPDATE(this.Alert, alertID).with({
      status_code: 'RESOLVED',
      resolvedAt: new Date().toISOString(),
      maintenanceOrderId,
      note: note || undefined
    });
    return SELECT.one.from(this.Alert).where({ ID: alertID });
  }

  async bulkAcknowledge(req) {
    const { severity } = req.data;
    const now = new Date().toISOString();
    const affected = await UPDATE(this.Alert)
      .set({ status_code: 'ACK', acknowledgedAt: now, acknowledgedBy: req.user?.id })
      .where({ status_code: 'OPEN', severity_code: severity });
    return affected || 0;
  }

  /**
   * Calls the external maintenance backend through the Destination service.
   * The destination + auth are resolved by the `ExternalMaintenanceAPI`
   * `requires` binding configured in package.json / mta.yaml.
   */
  async createMaintenanceOrder(alert, note) {
    try {
      const api = await cds.connect.to('ExternalMaintenanceAPI');
      const equipment = await SELECT.one
        .from('sce.monitoring.Equipment')
        .where({ ID: alert.equipment_ID });

      const priority = { CRITICAL: '1', HIGH: '2', MEDIUM: '3', LOW: '4' }[alert.severity_code] || '3';
      const result = await api.send('createOrder', {
        equipmentTag: equipment?.tag,
        description: `${alert.message}${note ? ' | ' + note : ''}`,
        priority
      });
      cds.log('alerting').info('Maintenance order created:', result?.orderId);
      return result?.orderId;
    } catch (e) {
      // Do not fail alert resolution if the external system is unavailable.
      cds.log('alerting').error('Failed to create maintenance order:', e.message);
      return undefined;
    }
  }
};
