sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/Device",
  "sap/ui/model/json/JSONModel"
], function (UIComponent, Device, JSONModel) {
  "use strict";

  return UIComponent.extend("sce.monitoring.dashboard.Component", {
    metadata: {
      manifest: "json"
    },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);

      // Device model for responsive behaviour
      this.setModel(new JSONModel(Device), "device");
    }
  });
});
