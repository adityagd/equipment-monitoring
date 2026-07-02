using sce.monitoring as db from '../db/schema';

/**
 * Read-oriented service that powers the live Fiori dashboard:
 * equipment overview, latest metrics, and historical readings.
 */
@path: '/monitoring'
@requires: 'authenticated-user'
service MonitoringService {

  @readonly
  @cds.redirection.target
  entity Equipment as projection on db.Equipment;

  @readonly
  @cds.redirection.target
  entity SensorReadings as projection on db.SensorReading
    order by measuredAt desc;

  @readonly
  entity Thresholds as projection on db.Threshold;

  // Code lists exposed for value helps / dashboard filters
  @readonly entity EquipmentTypes    as projection on db.EquipmentTypes;
  @readonly entity MetricTypes       as projection on db.MetricTypes;
  @readonly entity EquipmentStatuses as projection on db.EquipmentStatuses;
  @readonly entity Severities        as projection on db.Severities;

  /**
   * Dashboard KPI: count of equipment grouped by current status.
   */
  @readonly
  entity StatusSummary as
    select from db.Equipment {
      key status.code as status,
          status.name as statusName,
          count(*)    as total : Integer
    }
    group by status.code, status.name;

  /**
   * Latest reading per equipment/metric — the "live tile" feed.
   */
  @readonly
  view LatestReadings as
    select from db.SensorReading {
      key equipment.ID   as equipmentID,
          equipment.tag  as equipmentTag,
          equipment.name as equipmentName,
      key metric.code    as metric,
          value,
          unit,
          measuredAt,
          quality
    }
    order by measuredAt desc;
}
