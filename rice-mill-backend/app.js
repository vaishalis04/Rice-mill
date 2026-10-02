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
const visitorRoutes        = require("./routes/visitor.routes");
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
const roleRoutes = require("./routes/role.routes");
const advisoryTruckRoutes  = require("./routes/advisoryTruck.routes");
const materialSlipRoutes   = require("./routes/materialSlip.routes");
const registrationRequestRoutes = require("./routes/registrationRequest.routes");
const paymentSettlementRoutes = require("./routes/paymentSettlement.routes");


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
app.use("/api/visitors",         visitorRoutes);
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
app.use("/api/role-management", roleRoutes);
app.use("/api/advisory-trucks", advisoryTruckRoutes);
app.use("/api/material-slips", materialSlipRoutes);
app.use("/api/registration-requests", registrationRequestRoutes);
app.use("/api/payment-settlements", paymentSettlementRoutes);

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

      let pending = Object.values(sequelize.models);
      let lastErrors = new Map();
      let pass = 0;

      // Keep looping over whatever still fails until a full pass makes no
      // further progress. This is what actually resolves ordering issues
      // like "material_master before uom_master exists" — a single pass
      // has no way to know uom_master will succeed later in that same
      // pass, so material_master would be stuck failing forever without
      // this. Only genuine circular dependencies (two tables that need
      // each other to exist first) survive every pass — those need an
      // actual model fix, not more retries.
      while (pending.length > 0) {
        pass += 1;
        const stillFailing = [];
        lastErrors = new Map();

        for (const model of pending) {
          try {
            await model.sync({ alter: true });
          } catch (modelErr) {
            stillFailing.push(model);
            lastErrors.set(model.getTableName(), modelErr.message);
          }
        }

        if (stillFailing.length === pending.length) break; // no progress this pass — stop
        pending = stillFailing;
      }

      for (const [table, message] of lastErrors) {
        console.error(`⚠️ Schema alignment warning [${table}]:`, message);
      }

      const totalModels = Object.values(sequelize.models).length;
      const failed = pending.length;
      console.log(
        failed
          ? `✅ Database schema aligned (${totalModels - failed}/${totalModels} tables after ${pass} pass(es) — see warnings above for the rest)`
          : `✅ Database schema aligned on retry (${pass} pass(es))`,
      );
    }

    // Loading used to be UNIQUE per gate entry (one loading record per
    // truck). It no longer is — a truck can be loaded in several passes
    // until its Sales Order is fully loaded — but sequelize.sync({ alter })
    // only ever ADDS indexes, it never drops one that was removed from the
    // model. So an existing database keeps the old unique index, and every
    // second loading pass for the same truck fails with a bare "Validation
    // error" (that's Sequelize's wording for a MySQL duplicate-key error).
    // Idempotent: does nothing once the index is gone.
    try {
      const [indexRows] = await sequelize.query("SHOW INDEX FROM `loading`");
      const byName = new Map();
      for (const r of indexRows) {
        if (!byName.has(r.Key_name)) byName.set(r.Key_name, { unique: Number(r.Non_unique) === 0, cols: [] });
        byName.get(r.Key_name).cols[r.Seq_in_index - 1] = r.Column_name;
      }
      const staleUnique = [...byName.entries()]
        .filter(([name, idx]) => name !== "PRIMARY" && idx.unique && idx.cols.length === 1 && idx.cols[0] === "gate_entry_id")
        .map(([name]) => name);

      if (staleUnique.length > 0) {
        // MySQL refuses to drop the only index on a foreign-key column, so
        // make sure a plain (non-unique) one exists first.
        const hasPlainIndex = [...byName.values()].some((idx) => !idx.unique && idx.cols[0] === "gate_entry_id");
        if (!hasPlainIndex) {
          await sequelize.query("CREATE INDEX `loading_gate_entry_id_idx` ON `loading` (`gate_entry_id`)");
        }
        for (const name of staleUnique) {
          await sequelize.query(`ALTER TABLE \`loading\` DROP INDEX \`${name}\``);
          console.log(`✅ Dropped stale unique index "${name}" on loading.gate_entry_id (multi-pass loading)`);
        }
      }
    } catch (idxErr) {
      // Non-fatal — e.g. the table doesn't exist yet on a brand-new database.
      console.warn("ℹ️ Loading index check skipped:", idxErr.message);
    }

    // "Advisory" role: create it once if it doesn't already exist (picks up
    // the next free id automatically — idempotent, safe to run on every
    // boot). Frontend roles.js needs this exact id in ROLE_ID.advisory; the
    // id actually assigned is always printed below so it can be checked
    // against what's in that file.
    //
    // Also retires the old duplicate "weighbridge" role (role_id 11) now
    // that only role_id 6 is used: any user still on it is moved to role 6
    // first (keeping whatever pages role 11 had granted as direct per-user
    // grants), then role 11 is soft-deleted — so no account is ever
    // orphaned. Only runs when role 11 really is a same-name duplicate.
    try {
      const { Role, User } = require("./models/index");

      const [advisoryRole, wasCreated] = await Role.findOrCreate({
        where: { role_name: "advisory" },
        defaults: { role_name: "advisory", description: "Advisory Trucks and Payment Settlement Advice" },
      });
      console.log(
        `${wasCreated ? "✅ Created" : "ℹ️ Found existing"} "advisory" role — id = ${advisoryRole.id}. ` +
        `Make sure frontend/src/constants/roles.js has ROLE_ID.advisory = ${advisoryRole.id}.`
      );

      const legacyWeighbridgeId = 11;
      const canonicalWeighbridgeId = 6;
      const legacyRole = await Role.findOne({ where: { id: legacyWeighbridgeId, is_deleted: false } });
      if (legacyRole) {
        const { RolePermission, UserPermission } = require("./models/index");
        const canonicalRole = await Role.findOne({ where: { id: canonicalWeighbridgeId, is_deleted: false } });
        const sameName = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

        // Only ever merge when role 11 really IS a duplicate of the real
        // Weighbridge role (same name) — never touch an unrelated role.
        if (canonicalRole && sameName(legacyRole.role_name, canonicalRole.role_name)) {
          const legacyUsers = await User.findAll({ where: { role_id: legacyWeighbridgeId } });

          if (legacyUsers.length > 0) {
            // Anything role 11 had been granted becomes a direct per-user
            // grant for the users being moved, so nobody loses access just
            // because their role row changed. (Role 6 itself is left alone.)
            const legacyGrants = await RolePermission.findAll({
              where: { role_id: legacyWeighbridgeId, is_deleted: false },
            });
            for (const u of legacyUsers) {
              for (const g of legacyGrants) {
                await UserPermission.findOrCreate({
                  where: { user_id: u.id, permission_id: g.permission_id },
                  defaults: { user_id: u.id, permission_id: g.permission_id, is_deleted: false },
                });
              }
            }
            await User.update({ role_id: canonicalWeighbridgeId }, { where: { role_id: legacyWeighbridgeId } });
            console.log(
              `✅ Moved ${legacyUsers.length} user(s) from duplicate role_id ${legacyWeighbridgeId} to role_id ${canonicalWeighbridgeId} ` +
              `(${legacyUsers.map((u) => u.email || u.username).join(", ")}) — they must log in again.`
            );
          }

          await legacyRole.update({ is_deleted: true });
          console.log(`✅ Retired duplicate role_id ${legacyWeighbridgeId} ("${legacyRole.role_name}") — role_id ${canonicalWeighbridgeId} is the only Weighbridge role.`);
        } else {
          console.warn(
            `⚠️ role_id ${legacyWeighbridgeId} ("${legacyRole.role_name}") is not a duplicate of role_id ${canonicalWeighbridgeId} ` +
            `("${canonicalRole ? canonicalRole.role_name : "missing"}") — left untouched.`
          );
        }
      }
    } catch (roleSetupErr) {
      console.warn("ℹ️ Advisory role / legacy weighbridge role setup skipped:", roleSetupErr.message);
    }

    scheduleAgingJob();
    app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Rice Mill ERP running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("❌ MySQL connection failed:", err.message);
    process.exit(1);
  });