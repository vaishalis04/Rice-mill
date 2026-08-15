const { Op, fn, col, literal } = require("sequelize");
const {
  GateEntry, Vehicle, Driver, MaterialMaster, ProductionBatch, LengthGrading,
  Dispatch, Inventory, FinishedGoods, ByProductInventory,
} = require("../models/index");

// Admin analytics dashboard (real-time KPIs, charts, fleet snapshot).
// Every field here is a live aggregate query — nothing is placeholder data.
// Shared date-range resolution, same convention as reports.controller.js.
const resolveRange = (query) => {
  const { from, to, period } = query;
  if (from || to) {
    return {
      from: from ? new Date(from) : new Date(0),
      to: to ? new Date(`${to}T23:59:59.999Z`) : new Date(),
    };
  }
  const end = new Date();
  const start = new Date();
  if (period === "week") start.setDate(start.getDate() - 6);
  else if (period === "month") start.setDate(start.getDate() - 29);
  else start.setDate(start.getDate() - 13); // default: last 14 days, matches the trend chart
  return { from: start, to: end };
};

module.exports = {
  // GET /api/analytics/summary?from=&to=&plant_id=
  // The four KPI cards at the top of the dashboard.
  summary: async (req, res, next) => {
    try {
      const { plant_id } = req.query;
      const { from, to } = resolveRange(req.query);
      const plantWhere = plant_id ? { plant_id } : {};

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [gateEntriesToday, gateEntriesYesterday, batchesInRange, batchesYesterday, activeVehicles] =
        await Promise.all([
          GateEntry.count({ where: { is_deleted: false, ...plantWhere, entry_time: { [Op.gte]: todayStart } } }),
          GateEntry.count({
            where: {
              is_deleted: false,
              ...plantWhere,
              entry_time: {
                [Op.gte]: new Date(todayStart.getTime() - 86400000),
                [Op.lt]: todayStart,
              },
            },
          }),
          ProductionBatch.count({
            where: { is_deleted: false, ...plantWhere, production_date: { [Op.between]: [from, to] } },
          }),
          ProductionBatch.count({
            where: {
              is_deleted: false,
              ...plantWhere,
              production_date: {
                [Op.between]: [new Date(todayStart.getTime() - 86400000), new Date(todayStart.getTime() - 1)],
              },
            },
          }),
          Vehicle.count({ where: { is_deleted: false, ...plantWhere } }),
        ]);

      // Average recovery % across completed batches in range (output/input via LengthGrading).
      const gradedBatches = await ProductionBatch.findAll({
        where: { is_deleted: false, ...plantWhere, production_date: { [Op.between]: [from, to] } },
        include: [{ model: LengthGrading, as: "lengthGrading", required: true }],
      });
      let avgRecovery = 0;
      if (gradedBatches.length) {
        const recoveries = gradedBatches.map((b) => {
          const g = b.lengthGrading;
          const output = Number(g.long_qty || 0) + Number(g.medium_qty || 0) + Number(g.broken_qty || 0) + Number(g.small_broken_qty || 0);
          return Number(b.input_qty) > 0 ? (output / Number(b.input_qty)) * 100 : 0;
        });
        avgRecovery = recoveries.reduce((a, b) => a + b, 0) / recoveries.length;
      }

      res.status(200).json({
        success: true,
        data: {
          gate_entries_today: gateEntriesToday,
          gate_entries_delta_pct: gateEntriesYesterday > 0
            ? Math.round(((gateEntriesToday - gateEntriesYesterday) / gateEntriesYesterday) * 100)
            : null,
          batches_in_range: batchesInRange,
          batches_delta: batchesInRange - batchesYesterday,
          avg_recovery_pct: Math.round(avgRecovery * 10) / 10,
          active_vehicles: activeVehicles,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/analytics/production-trend?from=&to=&plant_id=
  // Day-by-day input vs output vs recovery% for the chart. Only days with at
  // least one fully-graded batch appear — a day with batches still in
  // progress simply won't have an output bar yet, which is accurate, not a bug.
  productionTrend: async (req, res, next) => {
    try {
      const { plant_id } = req.query;
      const { from, to } = resolveRange(req.query);
      const plantWhere = plant_id ? { plant_id } : {};

      const batches = await ProductionBatch.findAll({
        where: { is_deleted: false, ...plantWhere, production_date: { [Op.between]: [from, to] } },
        include: [{ model: LengthGrading, as: "lengthGrading" }],
        order: [["production_date", "ASC"]],
      });

      const byDate = {};
      for (const b of batches) {
        const date = b.production_date;
        if (!byDate[date]) byDate[date] = { date, input_qty: 0, output_qty: 0 };
        byDate[date].input_qty += Number(b.input_qty || 0);
        if (b.lengthGrading) {
          const g = b.lengthGrading;
          byDate[date].output_qty += Number(g.long_qty || 0) + Number(g.medium_qty || 0) + Number(g.broken_qty || 0) + Number(g.small_broken_qty || 0);
        }
      }

      const rows = Object.values(byDate).map((d) => ({
        ...d,
        recovery_pct: d.input_qty > 0 ? Math.round((d.output_qty / d.input_qty) * 1000) / 10 : 0,
      }));

      res.status(200).json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/analytics/material-flow?plant_id=
  // Raw / by-product / finished-goods stock levels, as percentages of the
  // highest of the three so the bars are visually comparable (same idea as
  // the reference mockup's "% filled" bars, but built from real balances).
  materialFlow: async (req, res, next) => {
    try {
      const { plant_id } = req.query;
      const plantWhere = plant_id ? { plant_id } : {};

      const [rawStock, byProductStock, fgStock] = await Promise.all([
        Inventory.sum("balance_qty", { where: { is_deleted: false, ...plantWhere, stage: "raw" } }),
        ByProductInventory.sum("qty_in_stock", { where: { is_deleted: false, ...plantWhere } }),
        FinishedGoods.sum("qty", { where: { is_deleted: false, ...plantWhere, fg_status: { [Op.in]: ["ready", "aging"] } } }),
      ]);

      const raw = Number(rawStock) || 0;
      const byProduct = Number(byProductStock) || 0;
      const fg = Number(fgStock) || 0;
      const max = Math.max(raw, byProduct, fg, 1); // avoid divide-by-zero when everything is empty

      res.status(200).json({
        success: true,
        data: {
          raw_stock_qty: raw,
          raw_stock_pct: Math.round((raw / max) * 100),
          by_product_qty: byProduct,
          by_product_pct: Math.round((byProduct / max) * 100),
          fg_stock_qty: fg,
          fg_stock_pct: Math.round((fg / max) * 100),
        },
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/analytics/fleet-snapshot?plant_id=
  // Vehicle type breakdown + trip counts (a "trip" = one dispatch that
  // vehicle has fulfilled — the only real per-vehicle activity count this
  // system tracks).
  fleetSnapshot: async (req, res, next) => {
    try {
      const { plant_id } = req.query;
      const plantWhere = plant_id ? { plant_id } : {};

      const typeCounts = await Vehicle.findAll({
        where: { is_deleted: false, ...plantWhere },
        attributes: ["type", [fn("COUNT", col("id")), "count"]],
        group: ["type"],
        raw: true,
      });

      const total = typeCounts.reduce((sum, t) => sum + Number(t.count), 0);

      const tripCounts = await Dispatch.findAll({
        where: { is_deleted: false },
        attributes: ["driver_id", [fn("COUNT", col("Dispatch.id")), "trips"]],
        include: [{ model: Driver, as: "driver", attributes: ["id", "name", "license_no"], required: true }],
        group: ["driver_id", "driver.id"],
        order: [[literal("trips"), "DESC"]],
        limit: 5,
        raw: true,
        nest: true,
      });

      res.status(200).json({
        success: true,
        data: {
          total_vehicles: total,
          by_type: typeCounts.map((t) => ({ type: t.type, count: Number(t.count) })),
          top_drivers: tripCounts.map((t) => ({
            name: t.driver.name,
            license_no: t.driver.license_no,
            trips: Number(t.trips),
          })),
        },
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/analytics/gate-activity?limit=5&plant_id=
  // Most recent gate entries for the "live activity" feed.
  gateActivity: async (req, res, next) => {
    try {
      const { plant_id, limit = 5 } = req.query;
      const plantWhere = plant_id ? { plant_id } : {};

      const entries = await GateEntry.findAll({
        where: { is_deleted: false, ...plantWhere },
        include: [
          { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
          { model: Driver, as: "driver", attributes: ["id", "name"] },
          { model: MaterialMaster, as: "material", attributes: ["id", "name"] },
        ],
        order: [["entry_time", "DESC"]],
        limit: Number(limit),
      });

      res.status(200).json({ success: true, data: entries });
    } catch (err) {
      next(err);
    }
  },
};