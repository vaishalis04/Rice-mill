const { Op } = require("sequelize");
const {
  GateEntry, Purchase, LabTest, Sampling, ProductionBatch, FinishedGoods,
  SalesOrder, Dispatch,
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
      ]);

      const today_dispatch_value = todayDispatches.reduce((sum, d) => {
        const rate = d.salesOrder ? Number(d.salesOrder.rate) : 0;
        return sum + Number(d.dispatch_weight || 0) * rate;
      }, 0);

      res.status(200).json({
        success: true,
        data: {
          trucks_at_gate: trucksAtGate,
          today_intake_qty: Number(todayIntakeQty) || 0,
          lab_rejection_rate: labTestsToday > 0 ? Number(((labRejectedToday / labTestsToday) * 100).toFixed(2)) : 0,
          active_batches: activeBatches,
          fg_stock_qty: Number(fgStockQty) || 0,
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
        results.push({ date: dateStr, intake_qty: Number(qty) || 0 });
      }

      res.status(200).json({ success: true, data: results });
    } catch (err) {
      next(err);
    }
  },
};
