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
app.use("/api/dashboard",        dashboardRoutes);
app.use("/api/audit-logs",       auditLogRoutes);
app.use("/api/notifications",    notificationRoutes);
app.use("/api/reject-waste",     rejectWasteRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ success: false, msg: err.message || "Internal Server Error" });
});

const PORT = process.env.PORT || 3000;

// Connect MySQL then start server
sequelize.authenticate()
  .then(() => {
    console.log("✅ MySQL connected");
    scheduleAgingJob();
    app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Rice Mill ERP running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("❌ MySQL connection failed:", err.message);
    process.exit(1);
  });
