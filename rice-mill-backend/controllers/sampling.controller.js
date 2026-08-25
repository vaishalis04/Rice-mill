const createError = require("http-errors");
const { Op } = require("sequelize");
const { GateEntry, Sampling, User, PurchaseOrder, MaterialMaster,GateEntryPurchaseOrder } = require("../models/index");
const { generateCode } = require("../helpers/helperFunction");
const sequelize = require("../config/db");

const detailIncludes = [
  {
    model: GateEntry,
    as: "gateEntry",
    attributes: ["id", "token_no", "gate_status", "vendor_id"],
    // no nested material here — gateEntry.material_id is null for multi-material entries
  },
  {
    model: MaterialMaster,
    as: "material",
    attributes: ["id", "material_code", "name"],
  },
  {
    model: PurchaseOrder,
    as: "purchaseOrder",
    attributes: ["id", "po_no"],
  },
  { model: User, as: "collector", attributes: ["id", "username", "email"] },
]; 

module.exports = {
  // GET /api/sampling?gate_entry_id=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { gate_entry_id, page = 1, limit = 20 } = req.query;

      const where = { is_deleted: false };
      if (gate_entry_id) where.gate_entry_id = gate_entry_id;

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await Sampling.findAndCountAll({
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

  // GET /api/sampling/:id
  getById: async (req, res, next) => {
    try {
      const sample = await Sampling.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: detailIncludes,
      });
      if (!sample) throw createError(404, "Sampling record not found");
      res.status(200).json({ success: true, data: sample });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/sampling  { gate_entry_id, sample_code, collected_at?, sent_to_lab_at? }
create: async (req, res, next) => {
  try {
    const { gate_entry_id, collected_at, sent_to_lab_at, plant_id } = req.body;
    let { material_id } = req.body;
    const { po_id } = req.body; // optional disambiguator, only used for matching below

    if (!gate_entry_id) {
      throw createError(400, "gate_entry_id is required");
    }
    if (material_id === undefined || material_id === null) {
      throw createError(400, "material_id is required (single id or array of ids)");
    }

    // normalize to array
    const requestedMaterialIds = Array.isArray(material_id)
      ? material_id.map(Number)
      : [Number(material_id)];

    if (requestedMaterialIds.some((id) => !id || Number.isNaN(id))) {
      throw createError(400, "material_id must be a valid id or array of valid ids");
    }
    const uniqueRequestedIds = [...new Set(requestedMaterialIds)];

    const gateEntry = await GateEntry.findOne({
      where: { id: gate_entry_id, is_deleted: false },
      include: [{ association: "purchase_orders" }],
    });
    if (!gateEntry) throw createError(400, "Invalid gate_entry_id");
    if (gateEntry.gate_status !== "waiting_sampling") {
      throw createError(400, `Cannot draw a sample for a gate entry with status '${gateEntry.gate_status}'; it must be 'waiting_sampling'`);
    }

    const materialLines = (gateEntry.purchase_orders || []).filter((l) => !l.is_deleted);

    let resolvedMaterialIds = [];
    let resolvedPoIds = [];

    if (materialLines.length > 0) {
      for (const mId of uniqueRequestedIds) {
        const matchedLine = materialLines.find(
          (l) => l.material_id === mId && (!po_id || l.po_id === Number(po_id))
        );
        if (!matchedLine) {
          throw createError(400, `Material_id ${mId} is not on this gate entry`);
        }
        resolvedMaterialIds.push(matchedLine.material_id);
        resolvedPoIds.push(matchedLine.po_id);
      }
    } else {
      // Fallback: single-material gate entry (no purchase_orders lines)
      const fallbackId = uniqueRequestedIds[0] || gateEntry.material_id;
      if (!fallbackId) {
        throw createError(400, "material_id is required");
      }
      resolvedMaterialIds = [fallbackId];
      resolvedPoIds = [po_id || null];
    }

    // Look for an existing (non-deleted) sample already recorded for this gate entry
    const existingSample = await Sampling.findOne({
      where: { gate_entry_id, is_deleted: false },
    });

    let sample;
    let gateStatusUpdated = false;
    let remainingMaterialIds = [];

    if (existingSample) {
      // Merge into the existing row instead of creating a new one
      const existingMaterialIds = Array.isArray(existingSample.material_id)
        ? existingSample.material_id
        : [existingSample.material_id];
      const existingPoIds = Array.isArray(existingSample.po_id)
        ? existingSample.po_id
        : [existingSample.po_id];

      const duplicates = resolvedMaterialIds.filter((id) => existingMaterialIds.includes(id));
      if (duplicates.length > 0) {
        throw createError(400, `Material_id(s) already sampled for this gate entry: ${duplicates.join(", ")}`);
      }

      const mergedMaterialIds = [...existingMaterialIds, ...resolvedMaterialIds];
      const mergedPoIds = [...existingPoIds, ...resolvedPoIds];

      await existingSample.update({
        material_id: mergedMaterialIds,
        po_id: mergedPoIds,
        sent_to_lab_at: sent_to_lab_at || existingSample.sent_to_lab_at,
        updated_by: req.user ? req.user.id : null,
      });
      sample = existingSample;

      if (materialLines.length > 0) {
        const requiredMaterialIds = [...new Set(materialLines.map((l) => l.material_id))];
        remainingMaterialIds = requiredMaterialIds.filter((id) => !mergedMaterialIds.includes(id));

        if (remainingMaterialIds.length === 0) {
          await gateEntry.update({ gate_status: "sampling_done", updated_by: req.user ? req.user.id : null });
          gateStatusUpdated = true;
        }
      } else {
        await gateEntry.update({ gate_status: "sampling_done", updated_by: req.user ? req.user.id : null });
        gateStatusUpdated = true;
      }
    } else {
      // No sample exists yet for this gate entry — create the first one
      const sample_code = await generateCode(Sampling, "sample_code", "SAMP");
      sample = await Sampling.create({
        gate_entry_id,
        po_id: resolvedPoIds,
        material_id: resolvedMaterialIds,
        sample_code,
        collected_by: req.user ? req.user.id : 12,
        collected_at: collected_at || new Date(),
        sent_to_lab_at: sent_to_lab_at || null,
        plant_id: plant_id || gateEntry.plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      if (materialLines.length > 0) {
        const requiredMaterialIds = [...new Set(materialLines.map((l) => l.material_id))];
        remainingMaterialIds = requiredMaterialIds.filter((id) => !resolvedMaterialIds.includes(id));

        if (remainingMaterialIds.length === 0) {
          await gateEntry.update({ gate_status: "sampling_done", updated_by: req.user ? req.user.id : null });
          gateStatusUpdated = true;
        }
      } else {
        await gateEntry.update({ gate_status: "sampling_done", updated_by: req.user ? req.user.id : null });
        gateStatusUpdated = true;
      }
    }

    const created = await Sampling.findByPk(sample.id, { include: detailIncludes });
    const createdJSON = created.toJSON();

    const allMaterialIds = Array.isArray(createdJSON.material_id) ? createdJSON.material_id : [createdJSON.material_id];
    const allPoIds = (Array.isArray(createdJSON.po_id) ? createdJSON.po_id : [createdJSON.po_id]).filter(Boolean);

    const [materials, purchaseOrders] = await Promise.all([
      MaterialMaster.findAll({ where: { id: allMaterialIds }, attributes: ["id", "material_code", "name"] }),
      allPoIds.length
        ? PurchaseOrder.findAll({ where: { id: allPoIds }, attributes: ["id", "po_no"] })
        : [],
    ]);
    createdJSON.materials = materials;
    createdJSON.purchaseOrders = purchaseOrders;

    res.status(existingSample ? 200 : 201).json({
      success: true,
      msg: gateStatusUpdated
        ? "Sample updated; gate entry moved to sampling_done"
        : existingSample
        ? "Sample updated; other materials still pending sampling"
        : "Sample collected; other materials still pending sampling",
      data: createdJSON,
      remaining_materials: remainingMaterialIds,
    });
  } catch (err) {
    next(err);
  }
},

  // PUT /api/sampling/:id
  update: async (req, res, next) => {
    try {
      const sample = await Sampling.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!sample) throw createError(404, "Sampling record not found");

      const { sample_code, collected_at, sent_to_lab_at, plant_id } = req.body;

      if (sample_code) {
        const dup = await Sampling.findOne({ where: { sample_code, id: { [Op.ne]: sample.id } } });
        if (dup) throw createError(409, "Another sampling record already uses this sample_code");
      }

      const updates = { sample_code, collected_at, sent_to_lab_at, plant_id };
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      updates.updated_by = req.user ? req.user.id : null;

      await sample.update(updates);

      const updated = await Sampling.findByPk(sample.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Sampling record updated", data: updated });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/sampling/:id  (soft delete)
  delete: async (req, res, next) => {
    try {
      const sample = await Sampling.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!sample) throw createError(404, "Sampling record not found");

      await sample.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Sampling record deleted" });
    } catch (err) {
      next(err);
    }
  },
};
