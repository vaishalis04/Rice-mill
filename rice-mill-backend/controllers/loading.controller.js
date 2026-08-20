const createError = require("http-errors");
const { Loading, GateEntry, SalesOrder, Customer, MaterialMaster, Vehicle, Driver, User, Sampling, LabTest } = require("../models/index");
const { generateLoadingNo } = require("../helpers/helperFunction");

// Outbound loading capture at the gate (entry_type = "sales" flow).
// A gate entry for a sales truck moves: waiting_token -> (check-in) ->
// waiting_loading -> (this module) -> loaded -> (check-out) -> exited.
// Creating a Loading record is only valid once the gate entry is at
// 'waiting_loading'; it finalizes the loaded qty, moves the gate entry to
// 'loaded', and marks the Sales Order 'dispatched'.
//
// Gate Entry only ever books the truck against a Sales Order NUMBER as a
// whole (see gate.controller.js) — it does NOT ask which material on a
// multi-material SO this truck is for. That choice happens here, right
// before the load is recorded (see the `so_id` handling in create() below),
// which is also why this module now lives on the Warehouse dashboard
// alongside the rest of physical goods movement, not the Gate dashboard.

const detailIncludes = [
  {
    model: GateEntry,
    as: "gateEntry",
    attributes: ["id", "token_no", "gate_status", "vehicle_id", "driver_id"],
    include: [
      { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
      { model: Driver, as: "driver", attributes: ["id", "name", "mobile"] },
      {
        model: Sampling,
        as: "samplings",
        attributes: ["id", "sample_code"],
        include: [{ model: LabTest, as: "labTest", attributes: ["id", "comment"] }],
      },
    ],
  },
  {
    model: SalesOrder,
    as: "salesOrder",
    attributes: ["id", "so_no", "customer_id", "material_id", "qty", "rate", "so_status"],
    include: [
      { model: Customer, as: "customer", attributes: ["id", "customer_code", "name"] },
      { model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name"] },
    ],
  },
  { model: User, as: "operator", attributes: ["id", "username", "email"] },
];

module.exports = {
  // GET /api/loading?gate_entry_id=&so_id=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { gate_entry_id, so_id, page = 1, limit = 20 } = req.query;

      const where = { is_deleted: false };
      if (gate_entry_id) where.gate_entry_id = gate_entry_id;
      if (so_id) where.so_id = so_id;

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await Loading.findAndCountAll({
        where,
        include: detailIncludes,
        order: [["created_at", "DESC"]],
        limit: Number(limit),
        offset,
        distinct: true,
      });

      res.status(200).json({
        success: true,
        data: rows,
        pagination: { total: count, page: Number(page), limit: Number(limit), totalPages: Math.ceil(count / limit) },
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/loading/:id
  getById: async (req, res, next) => {
    try {
      const loading = await Loading.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: detailIncludes,
      });
      if (!loading) throw createError(404, "Loading record not found");
      res.status(200).json({ success: true, data: loading });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/loading  { gate_entry_id, loaded_qty, loaded_at?, remarks? }
  // Supports partial fulfillment: a Sales Order can be loaded across
  // multiple trucks (multiple gate entries) until fully loaded. Each
  // Loading record adds to the Sales Order's running dispatched_qty; once
  // dispatched_qty reaches qty, the order auto-closes as 'dispatched'.
  // Until then it stays 'allocated' so further sales gate entries can still
  // be opened against it for the remaining quantity.
  create: async (req, res, next) => {
    try {
      const { gate_entry_id, loaded_qty, loaded_at, remarks, plant_id, so_id } = req.body;
      if (!gate_entry_id || loaded_qty === undefined) {
        throw createError(400, "gate_entry_id and loaded_qty are required");
      }
      if (!(Number(loaded_qty) > 0)) throw createError(400, "loaded_qty must be greater than 0");

      const gateEntry = await GateEntry.findOne({ where: { id: gate_entry_id, is_deleted: false } });
      if (!gateEntry) throw createError(400, "Invalid gate_entry_id");
      if (gateEntry.entry_type !== "sales") {
        throw createError(400, "Only entry_type = 'sales' gate entries can be loaded here");
      }
      if (gateEntry.gate_status !== "waiting_loading") {
        throw createError(400, `Cannot load a gate entry with status '${gateEntry.gate_status}'; it must be 'waiting_loading' (checked in)`);
      }

      const existing = await Loading.findOne({ where: { gate_entry_id, is_deleted: false } });
      if (existing) throw createError(409, "A loading record already exists for this gate entry");

      // Which material is being loaded is decided HERE, not back at Gate
      // Entry (which only books the truck against a Sales Order number as a
      // whole). so_id, if provided, must point to a line item on the SAME
      // so_no the gate entry was booked against — swapping it moves the
      // gate entry onto that specific material's line before recording the
      // load, so its own remaining qty/status track independently of the
      // SO's other materials.
      let effectiveSoId = gateEntry.so_id;
      if (so_id && String(so_id) !== String(gateEntry.so_id)) {
        const currentSo = gateEntry.so_id
          ? await SalesOrder.findOne({ where: { id: gateEntry.so_id, is_deleted: false } })
          : null;
        const newSo = await SalesOrder.findOne({ where: { id: so_id, is_deleted: false } });
        if (!newSo) throw createError(400, "Invalid so_id");
        if (!currentSo || newSo.so_no !== currentSo.so_no) {
          throw createError(400, "so_id must be a material line item on the same Sales Order this gate entry was booked against");
        }
        await gateEntry.update({
          so_id: newSo.id,
          material_id: newSo.material_id,
          updated_by: req.user ? req.user.id : null,
        });
        effectiveSoId = newSo.id;
      }

      const so = await SalesOrder.findOne({ where: { id: effectiveSoId, is_deleted: false } });
      if (!so) throw createError(400, "This gate entry has no valid linked Sales Order");
      if (["dispatched", "closed", "cancelled"].includes(so.so_status)) {
        throw createError(400, `Sales Order ${so.so_no} is already '${so.so_status}' and cannot be loaded against`);
      }

      const remainingQty = Number(so.qty) - Number(so.dispatched_qty || 0);
      if (Number(loaded_qty) > remainingQty) {
        throw createError(400, `loaded_qty (${loaded_qty}) cannot exceed the Sales Order's remaining qty (${remainingQty})`);
      }

      const loading_no = await generateLoadingNo();

      const loading = await Loading.create({
        loading_no,
        gate_entry_id,
        so_id: effectiveSoId,
        loaded_qty,
        loaded_at: loaded_at || new Date(),
        loading_operator_id: req.user ? req.user.id : null,
        remarks,
        plant_id: plant_id || gateEntry.plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      await gateEntry.update({ gate_status: "loaded", updated_by: req.user ? req.user.id : null });

      const newDispatchedQty = Math.round((Number(so.dispatched_qty || 0) + Number(loaded_qty)) * 100) / 100;
      const newRemainingQty = Math.round((Number(so.qty) - newDispatchedQty) * 100) / 100;
      const isFullyLoaded = newRemainingQty <= 0;

      await so.update({
        dispatched_qty: newDispatchedQty,
        // Fully loaded -> 'dispatched' and closed to further gate entries.
        // Still short -> 'allocated', staying open for another truck to
        // load the rest (see "Load New Truck" on the front end).
        so_status: isFullyLoaded ? "dispatched" : "allocated",
        updated_by: req.user ? req.user.id : null,
      });

      const created = await Loading.findByPk(loading.id, { include: detailIncludes });
      res.status(201).json({
        success: true,
        msg: isFullyLoaded
          ? `Loading ${loading_no} recorded — ${loaded_qty} loaded, Sales Order ${so.so_no} is now fully loaded and marked 'dispatched'.`
          : `Loading ${loading_no} recorded — ${loaded_qty} loaded against ${so.so_no}. ${newRemainingQty} still remaining — load another truck or mark the order completed.`,
        data: created,
        so_id: so.id,
        so_no: so.so_no,
        ordered_qty: Number(so.qty),
        dispatched_qty: newDispatchedQty,
        remaining_qty: Math.max(newRemainingQty, 0),
        is_fully_loaded: isFullyLoaded,
      });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/loading/:id  — correct the loaded qty after the fact (e.g. a re-weigh).
  update: async (req, res, next) => {
    try {
      const loading = await Loading.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!loading) throw createError(404, "Loading record not found");

      const { loaded_qty, remarks } = req.body;
      const updates = {};
      if (loaded_qty !== undefined) {
        if (!(Number(loaded_qty) > 0)) throw createError(400, "loaded_qty must be greater than 0");
        updates.loaded_qty = loaded_qty;
      }
      if (remarks !== undefined) updates.remarks = remarks;
      updates.updated_by = req.user ? req.user.id : null;

      await loading.update(updates);

      const updated = await Loading.findByPk(loading.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Loading record updated", data: updated });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/loading/:id  (soft delete)
  delete: async (req, res, next) => {
    try {
      const loading = await Loading.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!loading) throw createError(404, "Loading record not found");

      await loading.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Loading record deleted" });
    } catch (err) {
      next(err);
    }
  },
};