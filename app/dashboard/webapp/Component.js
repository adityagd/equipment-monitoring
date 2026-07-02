sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/Device"
], function (UIComponent, Device) {
  "use strict";

  return UIComponent.extend("sce.monitoring.dashboard.Component", {
    metadata: {
      manifest: "json"
    },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);

      // Device model for responsive behaviour
      this.setModel(new sap.ui.model.json.JSONModel(Device), "device");

      this.getRouter().initialize();
    }
  });
});
