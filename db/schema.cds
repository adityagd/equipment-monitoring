namespace sce.monitoring;

using {
  cuid,
  managed,
  sap.common.CodeList
} from '@sap/cds/common';

/**
 * Master data for a physical piece of equipment being monitored.
 */
entity Equipment : cuid, managed {
  name          : String(120)          @mandatory;
  tag           : String(40)           @mandatory;  // e.g. asset / functional location tag
  type          : Association to EquipmentTypes @mandatory;
  location      : String(120);
  manufacturer  : String(120);
  serialNumber  : String(60);
  installedOn   : Date;
  criticality   : Association to Criticalities default 'MED';
  status        : Association to EquipmentStatuses default 'OK';
  // Navigation
  readings      : Composition of many SensorReading on readings.equipment = $self;
  alerts        : Composition of many Alert         on alerts.equipment = $self;
  thresholds    : Composition of many Threshold     on thresholds.equipment = $self;
}

/**
 * A single telemetry data point ingested (typically via Event Mesh) from a sensor.
 */
entity SensorReading : cuid {
  equipment   : Association to Equipment @mandatory;
  metric      : Association to MetricTypes @mandatory;
  value       : Decimal(15, 4)          @mandatory;
  unit        : String(20);
  measuredAt   : Timestamp             @mandatory;
  ingestedAt   : Timestamp             @cds.on.insert: $now;
  source       : String(60);           // publisher / gateway id
  quality      : String(20) default 'GOOD'; // GOOD | UNCERTAIN | BAD
}

/**
 * Per-equipment / per-metric operating limits used to evaluate readings.
 */
entity Threshold : cuid, managed {
  equipment   : Association to Equipment @mandatory;
  metric      : Association to MetricTypes @mandatory;
  minValue    : Decimal(15, 4);
  maxValue    : Decimal(15, 4);
  warnMin     : Decimal(15, 4);
  warnMax     : Decimal(15, 4);
  severity    : Association to Severities default 'HIGH';
  active       : Boolean default true;
}

/**
 * An alert raised when a reading breaches a threshold.
 */
entity Alert : cuid, managed {
  equipment    : Association to Equipment @mandatory;
  metric       : Association to MetricTypes;
  triggeredBy  : Association to SensorReading;
  severity     : Association to Severities @mandatory;
  status       : Association to AlertStatuses default 'OPEN';
  message      : String(500);
  measuredValue : Decimal(15, 4);
  limitValue    : Decimal(15, 4);
  raisedAt      : Timestamp @cds.on.insert: $now;
  acknowledgedAt : Timestamp;
  acknowledgedBy : String(120);
  resolvedAt     : Timestamp;
  // Optional link to a maintenance follow-up created via Destination integration
  maintenanceOrderId : String(40);
}

// ---------------------------------------------------------------------------
// Code lists / value helps
// ---------------------------------------------------------------------------

entity EquipmentTypes : CodeList {
  key code : String(20);
}

entity MetricTypes : CodeList {
  key code       : String(20);   // TEMP | VIB | PRES | RPM | CURR ...
  defaultUnit    : String(20);
}

entity Criticalities : CodeList {
  key code : String(10);         // LOW | MED | HIGH
}

entity EquipmentStatuses : CodeList {
  key code : String(10);         // OK | WARN | CRIT | OFFLINE
}

entity AlertStatuses : CodeList {
  key code : String(10);         // OPEN | ACK | RESOLVED
}

entity Severities : CodeList {
  key code : String(10);         // LOW | MEDIUM | HIGH | CRITICAL
}
