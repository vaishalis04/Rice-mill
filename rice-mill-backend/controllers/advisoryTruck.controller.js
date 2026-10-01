const createError = require("http-errors");
const {
  GateEntry, Vehicle, Driver, Vendor, Customer, PurchaseOrder, SalesOrder,
  GateEntryPurchaseOrder, GateEntrySalesOrder,
} = require("../models/index");

// "Advisory Trucks" — Admin-only. Every truck that has already exited the
// gate, with a place to type free-text Location/Position remarks and an
// Unloading/Loading date, same three fields the Daily Outward report
// (reports.controller.js dailyOutwardPdf) reads back. Doesn't touch
// Dispatch — this lives entirely on GateEntry, which every truck (purchase,
// sales, or misc) already has one row of.

const detailIncludes = [
  { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
  { model: Driver, as: "driver", attributes: ["id", "name", "mobile"] },
  { model: Vendor, as: "vendor", attributes: ["id", "name"] },
  { model: Customer, as: "customer", attributes: ["id", "name"] },
  { model: PurchaseOrder, as: "purchaseOrder", attributes: ["id", "po_no"] },
  { model: SalesOrder, as: "salesOrder", attributes: ["id", "so_no"] },
  {
    model: GateEntryPurchaseOrder,
    as: "purchase_orders",
    attributes: ["id"],
    include: [{ model: PurchaseOrder, as: "purchaseOrder", attributes: ["id", "po_no"] }],
  },
  {
    model: GateEntrySalesOrder,
    as: "sales_orders",
    attributes: ["id"],
    include: [{ model: SalesOrder, as: "sales_order", attributes: ["id", "so_no"] }],
  },
];

// A gate entry can carry either a single po_id/so_id (simple, one-material
// entries) or several rows in the GateEntryPurchaseOrder/GateEntrySalesOrder
// junction tables (multi-material entries) — never both populated at once
// in practice, so this just prefers whichever actually has data.
const poSoIdFor = (row) => {
  const junctionPoNos = (row.purchase_orders || []).map((r) => r.purchaseOrder?.po_no).filter(Boolean);
  const junctionSoNos = (row.sales_orders || []).map((r) => r.sales_order?.so_no).filter(Boolean);
  const nos = [
    ...new Set([
      ...junctionPoNos,
      ...junctionSoNos,
      ...(row.purchaseOrder?.po_no ? [row.purchaseOrder.po_no] : []),
      ...(row.salesOrder?.so_no ? [row.salesOrder.so_no] : []),
    ]),
  ];
  return nos.length ? nos.join(", ") : null;
};

const serialize = (row) => ({
  id: row.id,
  token_no: row.token_no,
  entry_type: row.entry_type,
  gate_status: row.gate_status,
  exit_time: row.exit_time,
  vehicle_no: row.vehicle?.vehicle_no || null,
  driver_name: row.driver?.name || null,
  driver_mobile: row.driver?.mobile || null,
  party_name: row.vendor?.name || row.customer?.name || null,
  po_so_id: poSoIdFor(row),
  advisory_location_note: row.advisory_location_note,
  advisory_position_note: row.advisory_position_note,
  advisory_date: row.advisory_date,
});

module.exports = {
  // GET /api/advisory-trucks — every exited truck, newest exit first.
  getAll: async (req, res, next) => {
    try {
      const { page = 1, limit = 50 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await GateEntry.findAndCountAll({
        where: { gate_status: "exited", is_deleted: false },
        include: detailIncludes,
        order: [["exit_time", "DESC"]],
        limit: Number(limit),
        offset,
        distinct: true,
      });

      res.status(200).json({
        success: true,
        data: rows.map(serialize),
        pagination: { total: count, page: Number(page), limit: Number(limit), totalPages: Math.ceil(count / limit) },
      });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/advisory-trucks/:id — set/update the three advisory fields.
  // Only allowed once the truck has actually exited (matches what the
  // Advisory Trucks list itself shows).
  update: async (req, res, next) => {
    try {
      const entry = await GateEntry.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!entry) throw createError(404, "Gate entry not found");
      if (entry.gate_status !== "exited") {
        throw createError(400, "Advisory remarks can only be added to a truck after it has exited");
      }

      const { advisory_location_note, advisory_position_note, advisory_date } = req.body;
      await entry.update({
        advisory_location_note: advisory_location_note ?? entry.advisory_location_note,
        advisory_position_note: advisory_position_note ?? entry.advisory_position_note,
        advisory_date: advisory_date ?? entry.advisory_date,
        updated_by: req.user ? req.user.id : null,
      });

      const updated = await GateEntry.findByPk(entry.id, { include: detailIncludes });
      res.status(200).json({ success: true, data: serialize(updated) });
    } catch (err) {
      next(err);
    }
  },
};