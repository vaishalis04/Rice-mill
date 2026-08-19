const createError = require("http-errors");
const { Op } = require("sequelize");
const { WeightSlip, GateEntry, Purchase, PurchaseOrder, User } = require("../models/index");

// Gross / Tare / Net capture, slip printing (Module 8)
// Weighing can happen once a gate entry has either cleared lab QC (gate_status
// = 'accepted', the normal purchase flow) or, for empty/miscellaneous trucks
// (entry_type = 'other'), once it's simply checked in (gate_status =
// 'waiting_weighment' — those skip Sampling/Lab/Negotiation entirely).
// For purchase entries, creating a slip auto-calculates net weight and
// immediately finalizes a Purchase record (qty from the scale, rate from the
// linked PurchaseOrder unless overridden). For "other" entries there's no
// purchase to finalize — no PO/rate is required and no Purchase record is
// created. Either way the gate entry advances to 'in_process'.

const detailIncludes = [
  { model: GateEntry, as: "gateEntry", attributes: ["id", "token_no", "gate_status", "entry_type", "po_id", "vendor_id", "material_id"] },
  { model: User, as: "operator", attributes: ["id", "username", "email"] },
];

module.exports = {
  // GET /api/weight-slips?gate_entry_id=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { gate_entry_id, page = 1, limit = 20 } = req.query;

      const where = { is_deleted: false };
      if (gate_entry_id) where.gate_entry_id = gate_entry_id;

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await WeightSlip.findAndCountAll({
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

  // GET /api/weight-slips/:id
  getById: async (req, res, next) => {
    try {
      const slip = await WeightSlip.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: detailIncludes,
      });
      if (!slip) throw createError(404, "Weight slip not found");
      res.status(200).json({ success: true, data: slip });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/weight-slips  { gate_entry_id, slip_no, gross_weight, tare_weight, weighed_at?, final_rate? }
  create: async (req, res, next) => {
    try {
      const { gate_entry_id, slip_no, gross_weight, tare_weight, weighed_at, final_rate, plant_id } = req.body;

      // Required fields: gate_entry_id, slip_no, gross_weight. Tare may be omitted
      // for the first weighment (Start Unloading) — in that case we create the
      // slip without finalizing the Purchase. If tare is provided we validate
      // and finalize the purchase immediately as before.
      if (!gate_entry_id || !slip_no || gross_weight === undefined) {
        throw createError(400, "gate_entry_id, slip_no and gross_weight are required");
      }
      if (tare_weight !== undefined && Number(gross_weight) <= Number(tare_weight)) {
        throw createError(400, "gross_weight must be greater than tare_weight");
      }

      const gateEntry = await GateEntry.findOne({ where: { id: gate_entry_id, is_deleted: false } });
      if (!gateEntry) throw createError(400, "Invalid gate_entry_id");

      const isOtherEntry = gateEntry.entry_type === "other";
      const requiredStatus = isOtherEntry ? "waiting_weighment" : "accepted";
      if (gateEntry.gate_status !== requiredStatus) {
        throw createError(400, `Cannot weigh a gate entry with status '${gateEntry.gate_status}'; it must be '${requiredStatus}'`);
      }

      const existingSlip = await WeightSlip.findOne({ where: { gate_entry_id, is_deleted: false } });
      if (existingSlip) throw createError(409, "A weight slip already exists for this gate entry");

      const dupSlipNo = await WeightSlip.findOne({ where: { slip_no } });
      if (dupSlipNo) throw createError(409, "A weight slip with this slip_no already exists");

      // Empty/miscellaneous trucks (entry_type = "other") aren't a purchase —
      // no PO/rate is needed and no Purchase record gets created for them.
      let po = null;
      if (!isOtherEntry) {
        // Resolve the rate to finalize the purchase at: the linked PO's rate, unless
        // this gate entry has no PO, in which case final_rate must be supplied.
        if (gateEntry.po_id) {
          po = await PurchaseOrder.findOne({ where: { id: gateEntry.po_id, is_deleted: false } });
          if (!po) throw createError(400, "The purchase order linked to this gate entry could not be found");
        } else if (final_rate === undefined) {
          throw createError(400, "final_rate is required when the gate entry has no linked purchase order");
        }
      }

      const slip = await WeightSlip.create({
        gate_entry_id,
        slip_no,
        gross_weight,
        tare_weight: tare_weight === undefined ? null : tare_weight,
        weighed_at: weighed_at || new Date(),
        weighbridge_operator_id: req.user ? req.user.id : null,
        plant_id: plant_id || gateEntry.plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });
      let purchase = null;
      // For purchase entries we need a Purchase row so Start Unloading (which
      // expects a finalized purchase record) can create a Lot. Create a
      // placeholder Purchase on first weighment with final_qty = 0 when tare is
      // not yet provided; when tare is later added we will update this Purchase
      // with the actual qty and amount.
      if (!isOtherEntry) {
        const resolvedRate = po ? Number(po.rate) : (final_rate !== undefined ? Number(final_rate) : null);
        const netWeight = tare_weight !== undefined ? Number(gross_weight) - Number(tare_weight) : 0;
        if (resolvedRate == null) {
          // If there's no PO and no final_rate provided, we cannot create a Purchase.
          // In that case require tare to be provided so create() earlier will have
          // validated final_rate presence. This should match the existing validation
          // behavior for edge cases.
          if (gateEntry.po_id == null && final_rate === undefined) {
            // Leave purchase as null; downstream Start Unloading will fail and the
            // operator must supply final_rate or complete PO before proceeding.
          }
        } else {
          purchase = await Purchase.create({
            po_id: gateEntry.po_id || null,
            gate_entry_id,
            weight_slip_id: slip.id,
            final_rate: resolvedRate,
            final_qty: netWeight,
            amount: netWeight * resolvedRate,
            purchase_date: new Date().toISOString().slice(0, 10),
            plant_id: slip.plant_id,
            created_by: req.user ? req.user.id : null,
          });
        }
      }

      await gateEntry.update({ gate_status: "in_process", updated_by: req.user ? req.user.id : null });

      const created = await WeightSlip.findByPk(slip.id, { include: detailIncludes });
      res.status(201).json({
        success: true,
        msg: tare_weight === undefined
          ? `First weight recorded for ${slip.slip_no}; ready for unloading.`
          : isOtherEntry
          ? `Weight slip ${slip.slip_no} generated (net ${Number(gross_weight) - Number(tare_weight)}); ready for warehouse`
          : `Weight slip ${slip.slip_no} generated (net ${Number(gross_weight) - Number(tare_weight)}); purchase finalized`,
        data: { weightSlip: created, purchase },
      });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/weight-slips/:id
  // Note: does not retroactively recompute the linked Purchase record; use with care
  // after a purchase has already been finalized.
  update: async (req, res, next) => {
    try {
      const slip = await WeightSlip.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!slip) throw createError(404, "Weight slip not found");

      const { slip_no, gross_weight, tare_weight, weighed_at, plant_id } = req.body;

      const nextGross = gross_weight !== undefined ? Number(gross_weight) : Number(slip.gross_weight);
      const nextTare = tare_weight !== undefined ? Number(tare_weight) : (slip.tare_weight !== null ? Number(slip.tare_weight) : undefined);
      if (nextTare !== undefined && nextGross <= nextTare) {
        throw createError(400, "gross_weight must be greater than tare_weight");
      }

      if (slip_no) {
        const dup = await WeightSlip.findOne({ where: { slip_no, id: { [Op.ne]: slip.id } } });
        if (dup) throw createError(409, "Another weight slip already uses this slip_no");
      }

      const updates = { slip_no, gross_weight, tare_weight, weighed_at, plant_id };
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      updates.updated_by = req.user ? req.user.id : null;

      await slip.update(updates);

      const updated = await WeightSlip.findByPk(slip.id, { include: detailIncludes });

      // If this slip previously had no tare and now does, and this is a purchase
      // entry, either create a new Purchase or update the placeholder Purchase
      // we created at first-weigh. Prefer updating an existing Purchase linked
      // to this weight slip.
      if ((slip.tare_weight === null || slip.tare_weight === undefined) && updated.tare_weight != null) {
        const gateEntry = await GateEntry.findOne({ where: { id: updated.gate_entry_id, is_deleted: false } });
        if (gateEntry && gateEntry.entry_type !== "other") {
          const existingPurchase = await Purchase.findOne({ where: { weight_slip_id: updated.id } });
          const resolvedRate = gateEntry.po_id
            ? (await PurchaseOrder.findOne({ where: { id: gateEntry.po_id, is_deleted: false } }))?.rate
            : null;
          const netWeight = Number(updated.gross_weight) - Number(updated.tare_weight);
          if (existingPurchase) {
            // Update placeholder purchase (final_qty may have been 0)
            await existingPurchase.update({ final_qty: netWeight, amount: netWeight * Number(existingPurchase.final_rate), updated_by: req.user ? req.user.id : null });
          } else if (resolvedRate != null) {
            await Purchase.create({
              po_id: gateEntry.po_id || null,
              gate_entry_id: gateEntry.id,
              weight_slip_id: updated.id,
              final_rate: Number(resolvedRate),
              final_qty: netWeight,
              amount: netWeight * Number(resolvedRate),
              purchase_date: new Date().toISOString().slice(0, 10),
              plant_id: updated.plant_id,
              created_by: req.user ? req.user.id : null,
            });
          }
        }
      }

      res.status(200).json({ success: true, msg: "Weight slip updated", data: updated });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/weight-slips/:id  (soft delete)
  delete: async (req, res, next) => {
    try {
      const slip = await WeightSlip.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!slip) throw createError(404, "Weight slip not found");

      await slip.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Weight slip deleted" });
    } catch (err) {
      next(err);
    }
  },
};