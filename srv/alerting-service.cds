using sce.monitoring as db from '../db/schema';

/**
 * Manages the lifecycle of alerts raised by the ingestion pipeline.
 * Consumed by the dashboard's alert inbox and maintenance workflows.
 */
@path: '/alerting'
@requires: 'authenticated-user'
service AlertingService {

  @cds.redirection.target
  entity Alerts as projection on db.Alert
    order by raisedAt desc;

  // Exposed read-only so the `equipment` association on Alerts resolves to a
  // navigation property (enables $expand=equipment from the dashboard).
  @readonly
  entity Equipment as projection on db.Equipment;

  @readonly
  entity OpenAlerts as
    select from db.Alert {
      *,
      equipment.tag  as equipmentTag,
      equipment.name as equipmentName
    }
    where status.code = 'OPEN'
    order by severity.code desc, raisedAt desc;

  /**
   * Acknowledge an open alert (records user + timestamp).
   */
  action acknowledge(alertID : UUID, note : String) returns Alerts;

  /**
   * Resolve an alert. Optionally triggers creation of a maintenance order
   * in the external backend via the Destination service.
   */
  action resolve(alertID : UUID, note : String, createMaintenanceOrder : Boolean) returns Alerts;

  @requires: 'Supervisor'
  action bulkAcknowledge(severity : String) returns Integer;
}
