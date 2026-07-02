/**
 * Imported model of an external Maintenance backend (e.g. SAP S/4HANA PM
 * or a partner CMMS) reached through the SAP BTP Destination service.
 *
 * In a real project this file is generated with:
 *   cds import <edmx> --as cds
 * Here it is a minimal hand-written stand-in for the demo.
 */
service ExternalMaintenanceAPI {

  entity MaintenanceOrders {
    key orderId       : String(40);
        equipmentTag  : String(40);
        description   : String(1000);
        priority      : String(10);   // 1=very high ... 4=low
        status        : String(20);
        createdAt     : Timestamp;
  }

  action createOrder(
    equipmentTag : String(40),
    description  : String(1000),
    priority     : String(10)
  ) returns MaintenanceOrders;
}
