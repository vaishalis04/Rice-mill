const express = require("express");
const dotenv  = require("dotenv");
dotenv.config();

const cors = require("cors");
const path = require("path");
const { sequelize } = require("./models/index");
const { scheduleAgingJob } = require("./jobs/agingJob");

// ── Route Imports (grouped per ERP module — see Rice-Mill-ERP-Design.html Section 5) ──
const authRoutes           = require("./routes/auth.routes");
const userRoutes           = require("./routes/user.routes");
const masterSettingsRoutes = require("./routes/masterSettings.routes");
const vendorRoutes         = require("./routes/vendor.routes");
const vendorPortalRoutes   = require("./routes/vendorPortal.routes");
const customerRoutes       = require("./routes/customer.routes");
const vehicleDriverRoutes  = require("./routes/vehicleDriver.routes");
const gateRoutes           = require("./routes/gate.routes");
const purchaseRoutes       = require("./routes/purchase.routes");
const samplingRoutes       = require("./routes/sampling.routes");
const labTestRoutes        = require("./routes/labTest.routes");
const negotiationRoutes    = require("./routes/negotiation.routes");
const weighbridgeRoutes    = require("./routes/weighbridge.routes");
const loadingRoutes        = require("./routes/loading.routes");
const warehouseRoutes      = require("./routes/warehouse.routes");
const lotRoutes            = require("./routes/lot.routes");
const inventoryRoutes      = require("./routes/inventory.routes");
const productionRoutes     = require("./routes/production.routes");
const dryerRoutes          = require("./routes/dryer.routes");
const machineRoutes        = require("./routes/machine.routes");
const qualityControlRoutes = require("./routes/qualityControl.routes");
const byProductRoutes      = require("./routes/byProduct.routes");
const packingRoutes        = require("./routes/packing.routes");
const finishedGoodsRoutes  = require("./routes/finishedGoods.routes");
const salesOrderRoutes     = require("./routes/salesOrder.routes");
const dispatchRoutes       = require("./routes/dispatch.routes");
const gpsTrackingRoutes    = require("./routes/gpsTracking.routes");
const accountsRoutes       = require("./routes/accounts.routes");
const reportsRoutes        = require("./routes/reports.routes");
const analyticsRoutes      = require("./routes/analytics.routes");
const dashboardRoutes      = require("./routes/dashboard.routes");
const auditLogRoutes       = require("./routes/auditLog.routes");
const notificationRoutes   = require("./routes/notification.routes");
const rejectWasteRoutes    = require("./routes/rejectWaste.routes");

const app = express();

app.use(cors({
  origin: process.env.CLIENT_URL || "*",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ── Routes ────────────────────────────────────────────────────────────────
app.use("/api/auth",             authRoutes);
app.use("/api/users",            userRoutes);
app.use("/api/master-settings",  masterSettingsRoutes);
app.use("/api/vendors",          vendorRoutes);
app.use("/api/vendor-portal",    vendorPortalRoutes);
app.use("/api/customers",        customerRoutes);
app.use("/api/vehicles-drivers", vehicleDriverRoutes);
app.use("/api/gate",             gateRoutes);
app.use("/api/purchases",        purchaseRoutes);
app.use("/api/sampling",         samplingRoutes);
app.use("/api/lab-tests",        labTestRoutes);
app.use("/api/negotiations",     negotiationRoutes);
app.use("/api/weight-slips",    weighbridgeRoutes);
app.use("/api/loading",         loadingRoutes);
app.use("/api/warehouse",        warehouseRoutes);
app.use("/api/lots",             lotRoutes);
app.use("/api/inventory",        inventoryRoutes);
app.use("/api/production",       productionRoutes);
app.use("/api/dryer",            dryerRoutes);
app.use("/api/machines",         machineRoutes);
app.use("/api/quality-control",  qualityControlRoutes);
app.use("/api/by-products",      byProductRoutes);
app.use("/api/packing",          packingRoutes);
app.use("/api/finished-goods",   finishedGoodsRoutes);
app.use("/api/sales-orders",     salesOrderRoutes);
app.use("/api/dispatch",         dispatchRoutes);
app.use("/api/gps-tracking",     gpsTrackingRoutes);
app.use("/api/accounts",         accountsRoutes);
app.use("/api/reports",          reportsRoutes);
app.use("/api/analytics",        analyticsRoutes);
app.use("/api/dashboard",        dashboardRoutes);
app.use("/api/audit-logs",       auditLogRoutes);
app.use("/api/notifications",    notificationRoutes);
app.use("/api/reject-waste",     rejectWasteRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("❌", req.method, req.originalUrl, "-", err.message);
  console.error(err.stack);
  res.status(err.status || 500).json({ success: false, msg: err.message || "Internal Server Error" });
});

const PORT = process.env.PORT || 3000;

// Connect MySQL, align schema for grouped item models, then start server
sequelize.authenticate()
  .then(async () => {
    console.log("✅ MySQL connected");

    // Phase 1 — sequelize.sync({ alter: true }) as one coordinated pass.
    // This is what actually respects foreign-key dependency order (it
    // topologically sorts models so a table is never created/altered
    // before the tables it references), which per-model syncing cannot
    // do on its own — attempting that on an empty DB makes every table
    // fail with "foreign key constraint is incorrectly formed" simply
    // because referenced tables don't exist yet.
    try {
      await sequelize.sync({ alter: true });
      console.log("✅ Database schema verified/aligned");
    } catch (syncErr) {
      // Phase 2 — this only runs if phase 1 hit a genuine per-table issue
      // partway through (a bad FK, a stray/duplicate index, etc.). Phase 1
      // already got every table up to that point into a mostly-correct
      // state and correctly ordered, so re-attempting each model
      // individually here just mops up the tables that phase 1 couldn't
      // reach — one bad table can no longer silently block every table
      // after it, which is what let earlier, unrelated schema issues mask
      // real fixes to completely different tables (e.g. Stack/Loading
      // never actually getting their column changes applied because
      // something alphabetically/structurally earlier threw first).
      console.error("⚠️ Schema alignment warning (pass 1):", syncErr.message);
      console.log("↻ Retrying remaining tables individually...");

      const models = Object.values(sequelize.models);
      let failed = 0;
      for (const model of models) {
        try {
          await model.sync({ alter: true });
        } catch (modelErr) {
          failed += 1;
          console.error(
            `⚠️ Schema alignment warning [${model.getTableName()}]:`,
            modelErr.message,
          );
        }
      }
      console.log(
        failed
          ? `✅ Database schema aligned (${models.length - failed}/${models.length} tables — see warnings above for the rest)`
          : "✅ Database schema aligned on retry",
      );
    }

    scheduleAgingJob();
    app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Rice Mill ERP running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("❌ MySQL connection failed:", err.message);
    process.exit(1);
  });