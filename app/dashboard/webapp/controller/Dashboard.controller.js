sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (Controller, JSONModel, MessageToast, MessageBox) {
  "use strict";

  // Auto-refresh interval for the "live" dashboard (ms).
  var REFRESH_MS = 15000;

  return Controller.extend("sce.monitoring.dashboard.controller.Dashboard", {

    onInit: function () {
      this._viewModel = new JSONModel({
        lastRefresh: "",
        kpi: { total: 0, ok: 0, warn: 0, crit: 0, openAlerts: 0 }
      });
      this.getView().setModel(this._viewModel, "view");

      this._loadKpis();
      // Poll the OData services so the dashboard stays "live".
      this._timer = setInterval(this.onRefresh.bind(this), REFRESH_MS);
    },

    onExit: function () {
      if (this._timer) { clearInterval(this._timer); }
    },

    onRefresh: function () {
      this.getView().getModel().refresh();
      this.getView().getModel("alerting").refresh();
      this._loadKpis();
    },

    _loadKpis: function () {
      var oModel = this.getView().getModel();
      var oAlerting = this.getView().getModel("alerting");
      var that = this;

      // Equipment counts grouped by status via the StatusSummary view.
      oModel.bindList("/StatusSummary").requestContexts(0, 100).then(function (aCtx) {
        var kpi = { total: 0, ok: 0, warn: 0, crit: 0 };
        aCtx.forEach(function (c) {
          var row = c.getObject();
          kpi.total += row.total;
          if (row.status === "OK") { kpi.ok += row.total; }
          else if (row.status === "WARN") { kpi.warn += row.total; }
          else if (row.status === "CRIT") { kpi.crit += row.total; }
        });
        that._viewModel.setProperty("/kpi/total", kpi.total);
        that._viewModel.setProperty("/kpi/ok", kpi.ok);
        that._viewModel.setProperty("/kpi/warn", kpi.warn);
        that._viewModel.setProperty("/kpi/crit", kpi.crit);
      }).catch(function () { /* service may be starting */ });

      // Open alert count.
      oAlerting.bindList("/OpenAlerts").requestContexts(0, 1, undefined, undefined, { $count: true })
        .then(function (aCtx) {
          var iCount = aCtx.length && aCtx[0].getBinding ? aCtx[0].getBinding().getLength() : aCtx.length;
          that._viewModel.setProperty("/kpi/openAlerts", iCount || 0);
        }).catch(function () { /* ignore */ });

      this._viewModel.setProperty("/lastRefresh", "Updated " + new Date().toLocaleTimeString());
    },

    // --- Formatters ---------------------------------------------------------

    formatStatusState: function (sCode) {
      switch (sCode) {
        case "OK": return "Success";
        case "WARN": return "Warning";
        case "CRIT": return "Error";
        case "OFFLINE": return "None";
        default: return "None";
      }
    },

    formatSeverityState: function (sCode) {
      switch (sCode) {
        case "CRITICAL": return "Error";
        case "HIGH": return "Error";
        case "MEDIUM": return "Warning";
        case "LOW": return "Information";
        default: return "None";
      }
    },

    // --- Actions ------------------------------------------------------------

    onOpenAlerts: function () {
      this.byId("alertPanel").setExpanded(true);
      this.byId("alertTable").focus();
    },

    onAcknowledge: function () {
      var oItem = this._selectedAlert();
      if (!oItem) { return MessageToast.show("Select an alert first"); }
      this._callAction("acknowledge", { alertID: oItem.ID, note: "Acknowledged from dashboard" });
    },

    onResolve: function () {
      var oItem = this._selectedAlert();
      if (!oItem) { return MessageToast.show("Select an alert first"); }
      var that = this;
      MessageBox.confirm("Resolve this alert and create a maintenance order?", {
        actions: [MessageBox.Action.YES, MessageBox.Action.NO, MessageBox.Action.CANCEL],
        onClose: function (sAction) {
          if (sAction === MessageBox.Action.CANCEL) { return; }
          that._callAction("resolve", {
            alertID: oItem.ID,
            note: "Resolved from dashboard",
            createMaintenanceOrder: sAction === MessageBox.Action.YES
          });
        }
      });
    },

    _selectedAlert: function () {
      var oTable = this.byId("alertTable");
      var oCtx = oTable.getSelectedItem() && oTable.getSelectedItem().getBindingContext("alerting");
      return oCtx ? oCtx.getObject() : null;
    },

    _callAction: function (sName, oParams) {
      var oModel = this.getView().getModel("alerting");
      var oOp = oModel.bindContext("/" + sName + "(...)");
      Object.keys(oParams).forEach(function (k) { oOp.setParameter(k, oParams[k]); });
      var that = this;
      oOp.execute().then(function () {
        MessageToast.show(sName + " succeeded");
        that.onRefresh();
      }).catch(function (e) {
        MessageBox.error("Action failed: " + (e.message || e));
      });
    },

    onEquipmentPress: function (oEvent) {
      var o = oEvent.getSource().getBindingContext().getObject();
      MessageToast.show(o.name + " — " + (o.status && o.status.name));
    },

    onAlertPress: function (oEvent) {
      var o = oEvent.getSource().getBindingContext("alerting").getObject();
      MessageBox.information(o.message);
    },

    onKpiPress: function () { this.onRefresh(); }
  });
});
