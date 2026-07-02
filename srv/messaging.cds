using sce.monitoring as db from '../db/schema';

/**
 * Event catalog for the Real-Time Equipment Monitoring solution.
 *
 * These events are exchanged over SAP Event Mesh (kind: enterprise-messaging
 * in production, file-based-messaging locally). Topic names are declared via
 * @topic so CAP maps the CDS events to the physical Event Mesh topics.
 */
@impl: 'srv/ingestion-service.js'
service IngestionService @(path: '/ingestion') {

  /**
   * Inbound: a raw telemetry reading published by an external gateway/device.
   * External publishers emit onto this topic; CAP consumes it via a queue.
   */
  @topic: 'sce/monitoring/equipment/reading/v1'
  event SensorReadingReceived {
    equipmentTag : String(40);
    metric       : String(20);
    value        : Decimal(15, 4);
    unit         : String(20);
    measuredAt   : Timestamp;
    source       : String(60);
    quality      : String(20);
  }

  /**
   * Outbound: emitted when an ingested reading breaches a configured threshold.
   * Downstream systems (notification, maintenance, analytics) subscribe here.
   */
  @topic: 'sce/monitoring/equipment/alert/raised/v1'
  event AlertRaised {
    alertID       : UUID;
    equipmentID   : UUID;
    equipmentTag  : String(40);
    metric        : String(20);
    severity      : String(10);
    message       : String(500);
    measuredValue : Decimal(15, 4);
    limitValue    : Decimal(15, 4);
    raisedAt      : Timestamp;
  }

  /**
   * Outbound: emitted when an equipment's aggregate status changes
   * (OK <-> WARN <-> CRIT <-> OFFLINE).
   */
  @topic: 'sce/monitoring/equipment/status/changed/v1'
  event EquipmentStatusChanged {
    equipmentID : UUID;
    equipmentTag : String(40);
    oldStatus   : String(10);
    newStatus   : String(10);
    changedAt   : Timestamp;
  }
}
