const createError = require("http-errors");
const { Op } = require("sequelize");
const {
  Packing, FinishedGoods, ProductionBatch, LengthGrading, Lot, User, WarehouseMaster,
} = require("../models/index");
const { generatePackingBatchNo, generateEAN13 } = require("../helpers/helperFunction");

// Batch/Lot/Barcode/QR generation (Module 16)
// A packing record can only be created once a batch has finished length grading
// (the final production stage). Creating one auto-generates a sequential
// batch_no, a valid-format EAN-13 barcode, a JSON QR payload, and opens the
// matching FinishedGoods record with status 'ready'.

const DEFAULT_SHELF_LIFE_DAYS = 180;
// pack_size is a free numeric value (kg per bag) — any positive number (5, 10, 25, 50,
// 15, 2, 33.5...) is valid; the frontend just offers common ones (5/10/25/50) as quick picks
// plus a "Custom" option for anything else.

const detailIncludes = [
  {
    model: ProductionBatch,
    as: "batch",
    attributes: ["id", "batch_no", "lot_id", "process_type"],
    include: [{ model: LengthGrading, as: "lengthGrading" }],
  },
  { model: Lot, as: "outputLot", attributes: ["id", "lot_no", "material_id"] },
  { model: User, as: "packer", attributes: ["id", "username", "email"] },
  {
    model: FinishedGoods,
    as: "finishedGoodsRecords",
    attributes: ["id", "warehouse_id", "qty", "fg_status"],
    include: [{ model: WarehouseMaster, as: "warehouse", attributes: ["id", "warehouse_code", "name"] }],
  },
];

module.exports = {
  // GET /api/packing?batch_id=&pack_size=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { batch_id, pack_size, plant_id, page = 1, limit = 20 } = req.query;

      const where = { is_deleted: false };
      if (batch_id) where.batch_id = batch_id;
      if (pack_size) where.pack_size = pack_size;
      if (plant_id) where.plant_id = plant_id;

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await Packing.findAndCountAll({
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

  // GET /api/packing/:id
  getById: async (req, res, next) => {
    try {
      const packing = await Packing.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: detailIncludes,
      });
      if (!packing) throw createError(404, "Packing record not found");
      res.status(200).json({ success: true, data: packing });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/packing/graded-outputs/:batch_id
  // Convenience lookup for the packing form's "select batch → show graded outputs" step.
  getGradedOutputs: async (req, res, next) => {
    try {
      const batch = await ProductionBatch.findOne({
        where: { id: req.params.batch_id, is_deleted: false },
        include: [{ model: LengthGrading, as: "lengthGrading" }, { model: Lot, as: "lot", attributes: ["id", "lot_no"] }],
      });
      if (!batch) throw createError(404, "Production batch not found");
      if (!batch.lengthGrading) throw createError(400, "This batch has not completed length grading yet");

      // Sum what's already been packed against this batch, across every prior
      // packing record — both in bags and in actual kg (via the linked
      // FinishedGoods qty, so a qty_override on an earlier packing is
      // accounted for correctly, not just bag_count × pack_size).
      const priorPackings = await Packing.findAll({
        where: { batch_id: batch.id, is_deleted: false },
        include: [
          {
            model: FinishedGoods,
            as: "finishedGoodsRecords",
            attributes: ["qty"],
            where: { is_deleted: false },
            required: false,
          },
        ],
      });
      const bagsAlreadyPacked = priorPackings.reduce((sum, p) => sum + (p.bag_count || 0), 0);
      const qtyAlreadyPacked = priorPackings.reduce(
        (sum, p) =>
          sum + (p.finishedGoodsRecords || []).reduce((s, fg) => s + Number(fg.qty || 0), 0),
        0
      );

      const totalGraded =
        Number(batch.lengthGrading.long_qty || 0) +
        Number(batch.lengthGrading.medium_qty || 0) +
        Number(batch.lengthGrading.broken_qty || 0) +
        Number(batch.lengthGrading.small_broken_qty || 0);
      const remainingQty = Math.max(0, totalGraded - qtyAlreadyPacked);

      res.status(200).json({
        success: true,
        data: {
          batch_no: batch.batch_no,
          lot_no: batch.lot ? batch.lot.lot_no : null,
          gradedOutput: {
            long_qty: batch.lengthGrading.long_qty,
            medium_qty: batch.lengthGrading.medium_qty,
            broken_qty: batch.lengthGrading.broken_qty,
            small_broken_qty: batch.lengthGrading.small_broken_qty,
          },
          bagsAlreadyPacked: bagsAlreadyPacked || 0,
          bags_packed_so_far: bagsAlreadyPacked || 0,
          qty_already_packed: qtyAlreadyPacked,
          remaining_qty: remainingQty,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/packing
  // { batch_id, warehouse_id, pack_size, bag_count, qty_override? (optional manual total override),
  //   production_date?, shelf_life_days?, rack_id?, pallet_id? }
  // pack_size is the kg-per-bag weight — any positive number is accepted, not just the
  // common presets, so a genuinely custom pack size (e.g. 15kg, 2kg) can be recorded.
  create: async (req, res, next) => {
    try {
      const {
        batch_id, warehouse_id, pack_size, bag_count, qty_override,
        production_date, shelf_life_days, rack_id, pallet_id, plant_id,
      } = req.body;

      if (!batch_id || !warehouse_id || pack_size === undefined || pack_size === null || pack_size === "" || !bag_count) {
        throw createError(400, "batch_id, warehouse_id, pack_size and bag_count are required");
      }
      if (!(Number(pack_size) > 0)) throw createError(400, "pack_size must be a positive number (kg per bag)");
      if (Number(bag_count) <= 0) throw createError(400, "bag_count must be greater than 0");

      const batch = await ProductionBatch.findOne({
        where: { id: batch_id, is_deleted: false },
        include: [{ model: LengthGrading, as: "lengthGrading" }],
      });
      if (!batch) throw createError(400, "Invalid batch_id");
      if (!batch.lengthGrading) throw createError(400, "This batch has not completed length grading yet — packing is only allowed from length grader output");

      const warehouse = await WarehouseMaster.findOne({ where: { id: warehouse_id, is_deleted: false } });
      if (!warehouse) throw createError(400, "Invalid warehouse_id");

      const resolvedProductionDate = production_date || new Date().toISOString().slice(0, 10);
      const shelfDays = shelf_life_days !== undefined ? Number(shelf_life_days) : DEFAULT_SHELF_LIFE_DAYS;
      const expiry = new Date(resolvedProductionDate);
      expiry.setDate(expiry.getDate() + shelfDays);

      const batch_no = await generatePackingBatchNo();
      const barcode = await generateEAN13();
      const qr_code = JSON.stringify({
        batch_no,
        lot_no: batch.lot_id,
        production_batch_no: batch.batch_no,
        production_date: resolvedProductionDate,
      });

      const resolvedPlantId = plant_id || batch.plant_id || (req.user ? req.user.plant_id : null);

      const packing = await Packing.create({
        batch_id,
        lot_id: batch.lot_id,
        pack_size: Number(pack_size),
        bag_count,
        batch_no,
        barcode,
        qr_code,
        production_date: resolvedProductionDate,
        expiry_date: expiry.toISOString().slice(0, 10),
        packed_by: req.user ? req.user.id : null,
        plant_id: resolvedPlantId,
        created_by: req.user ? req.user.id : null,
      });

      // qty is normally pack_size × bag_count; qty_override lets an operator correct the
      // total by hand for any pack size (e.g. one bag was part-filled) without lying about
      // the recorded pack_size itself.
      const qty = qty_override !== undefined && qty_override !== null && qty_override !== ""
        ? Number(qty_override)
        : Number(pack_size) * Number(bag_count);

      const finishedGoods = await FinishedGoods.create({
        packing_id: packing.id,
        warehouse_id,
        rack_id,
        pallet_id,
        qty,
        fg_status: "ready",
        ready_since: new Date(),
        plant_id: resolvedPlantId,
        created_by: req.user ? req.user.id : null,
      });

      const created = await Packing.findByPk(packing.id, { include: detailIncludes });
      res.status(201).json({
        success: true,
        msg: `Packing ${batch_no} created (barcode ${barcode}); ${qty} kg added to finished goods as 'ready'`,
        data: { packing: created, finishedGoods },
      });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/packing/:id
  update: async (req, res, next) => {
    try {
      const packing = await Packing.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: [{ model: FinishedGoods, as: "finishedGoodsRecords", where: { is_deleted: false }, required: false }],
      });
      if (!packing) throw createError(404, "Packing record not found");

      const { pack_size, bag_count, production_date, expiry_date, plant_id } = req.body;
      if (pack_size !== undefined && !(Number(pack_size) > 0)) throw createError(400, "pack_size must be a positive number (kg per bag)");
      if (bag_count !== undefined && Number(bag_count) <= 0) throw createError(400, "bag_count must be greater than 0");

      const changingQty = pack_size !== undefined || bag_count !== undefined;
      const dispatchedFg = (packing.finishedGoodsRecords || []).find(
        (fg) => fg.fg_status === "dispatched" || fg.dispatch_id != null
      );
      if (changingQty && dispatchedFg) {
        throw createError(
          400,
          "Can't change pack size or bag count — this packing's finished goods stock has already been dispatched."
        );
      }

      const updates = {
        pack_size: pack_size !== undefined ? Number(pack_size) : undefined,
        bag_count, production_date, expiry_date, plant_id,
      };
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      updates.updated_by = req.user ? req.user.id : null;

      await packing.update(updates);

      // Keep the linked Finished Goods qty in sync — it was originally set to
      // pack_size × bag_count (or a manual override) at creation time, and
      // would otherwise go stale the moment either of those numbers changes
      // here, silently corrupting stock/dispatch totals.
      if (changingQty) {
        const finalPackSize = Number(updates.pack_size ?? packing.pack_size);
        const finalBagCount = Number(updates.bag_count ?? packing.bag_count);
        const recalculatedQty = finalPackSize * finalBagCount;
        await FinishedGoods.update(
          { qty: recalculatedQty, updated_by: req.user ? req.user.id : null },
          { where: { packing_id: packing.id, is_deleted: false } }
        );
      }

      const updated = await Packing.findByPk(packing.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Packing record updated", data: updated });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/packing/:id  (soft delete)
  delete: async (req, res, next) => {
    try {
      const packing = await Packing.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!packing) throw createError(404, "Packing record not found");

      await packing.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Packing record deleted" });
    } catch (err) {
      next(err);
    }
  },
};