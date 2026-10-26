const { Op } = require("sequelize");
const { kgToQtl, KG_PER_QTL } = require("../helpers/units");
const {
  GateEntry, Purchase, LabTest, Sampling, ProductionBatch, FinishedGoods,
  SalesOrder, Dispatch, Loading,
} = require("../models/index");

// Real-time KPIs (Module 24)
// A handful of independent aggregate queries run in parallel via Promise.all —
// functionally a single "dashboard aggregation" even though each metric reads
// from a different table, since no single SQL join could sensibly combine
// gate/production/warehouse/sales counts without a fan-out.

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const endOfToday = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};

module.exports = {
  // GET /api/dashboard/kpis
  getKpis: async (req, res, next) => {
    try {
      const { plant_id } = req.query;
      const plantWhere = plant_id ? { plant_id } : {};
      const todayRange = { [Op.between]: [startOfToday(), endOfToday()] };

      const [
        trucksAtGate,
        todayIntakeQty,
        labTestsToday,
        labRejectedToday,
        activeBatches,
        fgStockQty,
        pendingDispatchCount,
        todayDispatches,
        todayLoadings,
      ] = await Promise.all([
        GateEntry.count({ where: { ...plantWhere, is_deleted: false, gate_status: { [Op.notIn]: ["exited"] } } }),
        Purchase.sum("final_qty", { where: { ...plantWhere, is_deleted: false, purchase_date: new Date().toISOString().slice(0, 10) } }),
        LabTest.count({ where: { ...plantWhere, is_deleted: false, tested_at: todayRange } }),
        LabTest.count({ where: { ...plantWhere, is_deleted: false, tested_at: todayRange, verdict: "rejected" } }),
        ProductionBatch.count({ where: { ...plantWhere, is_deleted: false, batch_status: "in_progress" } }),
        FinishedGoods.sum("qty", { where: { ...plantWhere, is_deleted: false, fg_status: { [Op.in]: ["ready", "aging"] } } }),
        SalesOrder.count({ where: { ...plantWhere, is_deleted: false, so_status: { [Op.in]: ["pending", "confirmed", "allocated"] } } }),
        Dispatch.findAll({
          where: { ...plantWhere, is_deleted: false, dispatch_time: todayRange },
          include: [{ association: "salesOrder", attributes: ["rate"] }],
        }),
        // Sales trucks loaded today (the gate-based sales flow records loadings, not Dispatch rows)
        Loading.findAll({
          where: { ...plantWhere, is_deleted: false, loaded_at: todayRange },
          attributes: ["id", "so_id", "items", "loaded_at"],
        }),
      ]);

      // Value of what was loaded today: each line's Qtl -> kg x its Sales Order line rate (Rs / kg).
      const loadingSoIds = [...new Set(todayLoadings.map((l) => Number(l.so_id)).filter(Boolean))];
      const loadingSos = loadingSoIds.length
        ? await SalesOrder.findAll({ where: { id: { [Op.in]: loadingSoIds } }, attributes: ["id", "rate", "items"] })
        : [];
      const asList = (v) => {
        if (Array.isArray(v)) return v;
        try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; }
      };
      const soById = new Map(loadingSos.map((so) => [Number(so.id), so]));
      const loadingValue = todayLoadings.reduce((total, l) => {
        const so = soById.get(Number(l.so_id));
        const soLines = asList(so?.items);
        return total + asList(l.items).reduce((sum, line) => {
          const soLine = soLines.find((it) => Number(it.material_id) === Number(line.material_id));
          const rate = Number(soLine?.rate ?? so?.rate ?? 0);
          return sum + Number(line.qty || 0) * KG_PER_QTL * rate;
        }, 0);
      }, 0);

      const today_dispatch_value = loadingValue + todayDispatches.reduce((sum, d) => {
        const rate = d.salesOrder ? Number(d.salesOrder.rate) : 0;
        return sum + Number(d.dispatch_weight || 0) * rate;
      }, 0);

      res.status(200).json({
        success: true,
        data: {
          trucks_at_gate: trucksAtGate,
          today_intake_qty: kgToQtl(todayIntakeQty), // Purchase.final_qty is the weighbridge net weight in kg; the dashboard shows Qtl
          lab_rejection_rate: labTestsToday > 0 ? Number(((labRejectedToday / labTestsToday) * 100).toFixed(2)) : 0,
          active_batches: activeBatches,
          fg_stock_qty: kgToQtl(fgStockQty), // FinishedGoods.qty is kg; the dashboard shows Qtl
          pending_dispatch_count: pendingDispatchCount,
          today_dispatch_value: Number(today_dispatch_value.toFixed(2)),
        },
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/dashboard/daily-intake-trend?days=7
  // Bonus endpoint backing the FE's "daily intake last 7 days" Recharts BarChart.
  getDailyIntakeTrend: async (req, res, next) => {
    try {
      const { days = 7, plant_id } = req.query;
      const plantWhere = plant_id ? { plant_id } : {};

      const numDays = Number(days);
      const results = [];

      for (let i = numDays - 1; i >= 0; i -= 1) {
        const day = new Date();
        day.setDate(day.getDate() - i);
        const dateStr = day.toISOString().slice(0, 10);

        // eslint-disable-next-line no-await-in-loop
        const qty = await Purchase.sum("final_qty", { where: { ...plantWhere, is_deleted: false, purchase_date: dateStr } });
        results.push({ date: dateStr, intake_qty: kgToQtl(qty) }); // kg -> Qtl
      }

      res.status(200).json({ success: true, data: results });
    } catch (err) {
      next(err);
    }
  },
};
