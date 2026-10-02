const createError = require("http-errors");
const { Op } = require("sequelize");
const {
  GateEntry, Vehicle, Driver, Vendor, Customer, PurchaseOrder, SalesOrder,
  GateEntryPurchaseOrder, GateEntrySalesOrder, MaterialMaster, GateEntryMiscItem,
} = require("../models/index");
const {
  STATUS_LABELS, COMPLETED_STATUS, statusOptionsFor, isValidStatusFor,
} = require("../helpers/advisoryStatus.helper");

// "Advisory Trucks" — Admin + Advisory role. Every truck that has already
// exited the gate and is not yet marked Completed, with a Status (the
// choices depend on whether it is a Sales, Purchase or Empty/Misc truck), a
// free-text Position remark and an Unloading/Loading date. Doesn't touch
// Dispatch — this lives entirely on GateEntry, which every truck (purchase,
// sales, or misc) already has one row of.
//
// A truck whose status is set to "completed" is hidden from this list (it is
// not deleted — the Daily Outward report and everything else still see it).

const detailIncludes = [
  { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
  { model: Driver, as: "driver", attributes: ["id", "name", "mobile"] },
  { model: Vendor, as: "vendor", attributes: ["id", "name"] },
  { model: Customer, as: "customer", attributes: ["id", "name"] },
  { model: PurchaseOrder, as: "purchaseOrder", attributes: ["id", "po_no"] },
  { model: SalesOrder, as: "salesOrder", attributes: ["id", "so_no"] },
  { model: MaterialMaster, as: "material", attributes: ["id", "name"], required: false },
  {
    model: GateEntryMiscItem,
    as: "misc_items",
    attributes: ["id", "item_name"],
    required: false,
    where: { is_deleted: false },
  },
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

// Empty/Misc trucks: the material names logged against the truck (what it
// carried), falling back to the gate entry's own material if none were logged.
const miscMaterialsFor = (row) => {
  if (row.entry_type !== "other") return null;
  const names = [...new Set((row.misc_items || []).map((m) => m.item_name).filter(Boolean))];
  if (names.length) return names.join(", ");
  return row.material?.name || null;
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
  materials: miscMaterialsFor(row),
  po_so_id: poSoIdFor(row),
  advisory_location_note: row.advisory_location_note,
  advisory_position_note: row.advisory_position_note,
  advisory_date: row.advisory_date,
  advisory_status: row.advisory_status || null,
  advisory_status_label: STATUS_LABELS[row.advisory_status] || null,
  // The dropdown choices for THIS truck's type, so the page never has to
  // hard-code (and risk drifting from) what the server will accept.
  advisory_status_options: statusOptionsFor(row.entry_type),
});

// "" / whitespace -> null, undefined -> leave as it was, anything else trimmed.
const cleanOrKeep = (incoming, current) => {
  if (incoming === undefined) return current;
  if (incoming === null) return null;
  const t = String(incoming).trim();
  return t === "" ? null : t;
};

module.exports = {
  // GET /api/advisory-trucks — every exited truck that is not yet Completed,
  // newest exit first.
  getAll: async (req, res, next) => {
    try {
      const { page = 1, limit = 50 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await GateEntry.findAndCountAll({
        where: {
          gate_status: "exited",
          is_deleted: false,
          // NULL (no status yet) must be listed too — SQL's `<> 'completed'`
          // alone would silently drop every NULL row.
          [Op.or]: [{ advisory_status: null }, { advisory_status: { [Op.ne]: COMPLETED_STATUS } }],
        },
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

  // PATCH /api/advisory-trucks/:id — set/update status, position and date.
  // Only allowed once the truck has actually exited (matches what the
  // Advisory Trucks list itself shows). The status must be one of the
  // choices for that truck's type (Sales / Purchase / Empty-Misc).
  update: async (req, res, next) => {
    try {
      const entry = await GateEntry.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!entry) throw createError(404, "Gate entry not found");
      if (entry.gate_status !== "exited") {
        throw createError(400, "Advisory remarks can only be added to a truck after it has exited");
      }

      const { advisory_location_note, advisory_position_note, advisory_date, advisory_status } = req.body;

      const nextStatus = cleanOrKeep(advisory_status, entry.advisory_status);
      if (advisory_status !== undefined && nextStatus !== null && !isValidStatusFor(entry.entry_type, nextStatus)) {
        throw createError(400, `"${nextStatus}" is not a valid status for this type of truck`);
      }

      await entry.update({
        // Location is no longer edited from the page, but an API caller that
        // still sends it keeps working exactly as before.
        advisory_location_note: advisory_location_note ?? entry.advisory_location_note,
        advisory_position_note: cleanOrKeep(advisory_position_note, entry.advisory_position_note),
        advisory_date: cleanOrKeep(advisory_date, entry.advisory_date),
        advisory_status: nextStatus,
        updated_by: req.user ? req.user.id : null,
      });

      const updated = await GateEntry.findByPk(entry.id, { include: detailIncludes });
      res.status(200).json({ success: true, data: serialize(updated) });
    } catch (err) {
      next(err);
    }
  },
};