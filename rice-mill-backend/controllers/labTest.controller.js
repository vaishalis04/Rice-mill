const createError = require("http-errors");
const { Sampling, LabTest, GateEntry, VarietyMaster, User, Negotiation, PurchaseOrder } = require("../models/index");


const detailIncludes = [
  {
    model: Sampling,
    as: "sampling",
    attributes: ["id", "sample_code", "gate_entry_id"],
    include: [{ model: GateEntry, as: "gateEntry", attributes: ["id", "token_no", "gate_status"] }],
  },
  { model: VarietyMaster, as: "detectedVariety", attributes: ["id", "variety_name"] },
  { model: User, as: "tester", attributes: ["id", "username", "email"] },
];

const VERDICTS = ["accepted", "rejected", "negotiation"];

// Applies the business rule that a lab verdict drives the parent gate entry's status.
const applyVerdictToGateEntry = async (samplingId, verdict, userId) => {
  const sampling = await Sampling.findOne({ where: { id: samplingId, is_deleted: false } });
  if (!sampling) return null;

  const gateEntry = await GateEntry.findOne({ where: { id: sampling.gate_entry_id, is_deleted: false } });
  if (!gateEntry) return null;

  if (verdict === "accepted") {
    await gateEntry.update({ gate_status: "accepted", updated_by: userId });
  } else if (verdict === "rejected") {
    await gateEntry.update({ gate_status: "rejected", updated_by: userId });
  }
  // 'negotiation' leaves gate_status untouched; resolved later by Negotiation.respond

  return gateEntry;
};

const openNegotiationIfNeeded = async (labTest, userId) => {
  if (labTest.verdict !== "negotiation") return;

  const existing = await Negotiation.findOne({ where: { lab_test_id: labTest.id, is_deleted: false } });
  if (existing) return;

  let oldRate = null;
  const sampling = await Sampling.findOne({ where: { id: labTest.sampling_id, is_deleted: false } });
  if (sampling) {
    const gateEntry = await GateEntry.findOne({ where: { id: sampling.gate_entry_id, is_deleted: false } });
    if (gateEntry && gateEntry.po_id) {
      const po = await PurchaseOrder.findOne({ where: { id: gateEntry.po_id, is_deleted: false } });
      if (po) oldRate = po.rate;
    }
  }

  await Negotiation.create({
    lab_test_id: labTest.id,
    old_rate: oldRate,
    proposed_rate: oldRate,
    negotiated_by: userId,
    negotiated_at: new Date(),
    plant_id: labTest.plant_id || null,
    created_by: userId,
  });
};

module.exports = {
  // GET /api/lab-tests?sampling_id=&verdict=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { sampling_id, verdict, page = 1, limit = 20 } = req.query;

      const where = { is_deleted: false };
      if (sampling_id) where.sampling_id = sampling_id;
      if (verdict) where.verdict = verdict;

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await LabTest.findAndCountAll({
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

  // GET /api/lab-tests/:id
  getById: async (req, res, next) => {
    try {
      const test = await LabTest.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: detailIncludes,
      });
      if (!test) throw createError(404, "Lab test not found");
      res.status(200).json({ success: true, data: test });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/lab-tests
  // { sampling_id, moisture_pct, broken_pct, fm_pct, color, smell, variety_detected, grain_size, verdict, tested_at }
create: async (req, res, next) => {
  try {
    const {
      sampling_id,
      material_id,
      moisture_pct,
      broken_pct,
      fm_pct,
      color,
      smell,
      variety_detected,
      grain_size,
      comment,
      verdict,
      tested_at,
      plant_id,
    } = req.body;

    if (!sampling_id || !verdict) {
      throw createError(400, "sampling_id and verdict are required");
    }

    if (!VERDICTS.includes(verdict)) {
      throw createError(400, `verdict must be one of: ${VERDICTS.join(", ")}`);
    }

    // material_ids validation
    if (!Array.isArray(material_id) || material_id.length === 0) {
      throw createError(400, "material_id must be a non-empty array");
    }

    // Remove duplicate material IDs
    const uniqueMaterialIds = [...new Set(material_id.map(Number))];

    const sampling = await Sampling.findOne({
      where: { id: sampling_id, is_deleted: false },
    });

    if (!sampling) {
      throw createError(400, "Invalid sampling_id");
    }

    /*
     * Assuming Sampling has material_id JSON field
     * Example: sampling.material_id = [1, 2, 3]
     */
    const samplingMaterialIds = Array.isArray(sampling.material_id)
      ? sampling.material_id.map(Number)
      : [];

    // Make sure selected materials actually belong to sampling
    const invalidMaterials = uniqueMaterialIds.filter(
      (id) => !samplingMaterialIds.includes(id)
    );

    if (invalidMaterials.length > 0) {
      throw createError(
        400,
        `Material(s) ${invalidMaterials.join(", ")} do not belong to this sampling`
      );
    }

    // Validate variety
    if (variety_detected) {
      const variety = await VarietyMaster.findOne({
        where: { id: variety_detected, is_deleted: false },
      });

      if (!variety) {
        throw createError(400, "Invalid variety_detected");
      }
    }

    // Check whether a lab test already exists for this sampling
    const existing = await LabTest.findOne({
      where: { sampling_id, is_deleted: false },
    });

    let test;
    let statusCode;
    let msg;

    if (existing) {
      // Merge into the existing lab test instead of creating a new one
      const existingMaterialIds = Array.isArray(existing.material_id)
        ? existing.material_id.map(Number)
        : [];

      const duplicates = uniqueMaterialIds.filter((id) =>
        existingMaterialIds.includes(id)
      );
      if (duplicates.length > 0) {
        throw createError(
          400,
          `Material(s) ${duplicates.join(", ")} already have a lab test recorded for this sampling`
        );
      }

      const mergedMaterialIds = [...existingMaterialIds, ...uniqueMaterialIds];

      await existing.update({
        material_id: mergedMaterialIds,
        // latest submitted result fields overwrite the previous ones on the shared row;
        // fall back to what's already stored if this request omitted them
        moisture_pct: moisture_pct ?? existing.moisture_pct,
        broken_pct: broken_pct ?? existing.broken_pct,
        fm_pct: fm_pct ?? existing.fm_pct,
        color: color ?? existing.color,
        smell: smell ?? existing.smell,
        variety_detected: variety_detected || existing.variety_detected,
        grain_size: grain_size ?? existing.grain_size,
        comment: comment ?? existing.comment,
        verdict,
        tested_at: tested_at || existing.tested_at,
        updated_by: req.user ? req.user.id : null,
      });

      test = existing;
      statusCode = 200;
      msg = "Lab test updated with additional material(s)";
    } else {
      test = await LabTest.create({
        sampling_id,
        material_id: uniqueMaterialIds,
        moisture_pct,
        broken_pct,
        fm_pct,
        color,
        smell,
        variety_detected: variety_detected || null,
        grain_size,
        comment,
        verdict,
        tested_by: req.user ? req.user.id : null,
        tested_at: tested_at || new Date(),
        plant_id: plant_id || sampling.plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      statusCode = 201;
      msg = "Lab test recorded";
    }

    await applyVerdictToGateEntry(sampling_id, verdict, req.user ? req.user.id : null);
    await openNegotiationIfNeeded(test, req.user ? req.user.id : null);

    const created = await LabTest.findByPk(test.id, { include: detailIncludes });

    res.status(statusCode).json({
      success: true,
      msg,
      data: created,
    });
  } catch (err) {
    next(err);
  }
},

  // PUT /api/lab-tests/:id
  update: async (req, res, next) => {
    try {
      const test = await LabTest.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!test) throw createError(404, "Lab test not found");

      const {
        moisture_pct, broken_pct, fm_pct, color, smell,
        variety_detected, grain_size, comment, tested_at, plant_id,
      } = req.body;

      if (variety_detected) {
        const variety = await VarietyMaster.findOne({ where: { id: variety_detected, is_deleted: false } });
        if (!variety) throw createError(400, "Invalid variety_detected");
      }

      const updates = { moisture_pct, broken_pct, fm_pct, color, smell, variety_detected, grain_size, comment, tested_at, plant_id };
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      updates.updated_by = req.user ? req.user.id : null;

      await test.update(updates);

      const updated = await LabTest.findByPk(test.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Lab test updated", data: updated });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/lab-tests/:id/verdict  { verdict }
  // Revises/finalizes the verdict and (re)triggers the gate-status transition.
  updateVerdict: async (req, res, next) => {
    try {
      const { verdict } = req.body;
      if (!verdict || !VERDICTS.includes(verdict)) {
        throw createError(400, `verdict is required and must be one of: ${VERDICTS.join(", ")}`);
      }

      const test = await LabTest.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!test) throw createError(404, "Lab test not found");

      await test.update({ verdict, updated_by: req.user ? req.user.id : null });
      const gateEntry = await applyVerdictToGateEntry(test.sampling_id, verdict, req.user ? req.user.id : null);
      await openNegotiationIfNeeded(test, req.user ? req.user.id : null);

      const updated = await LabTest.findByPk(test.id, { include: detailIncludes });
      res.status(200).json({
        success: true,
        msg: `Verdict set to '${verdict}'${gateEntry ? ` — gate entry status is now '${gateEntry.gate_status}'` : ""}`,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/lab-tests/:id  (soft delete)
  delete: async (req, res, next) => {
    try {
      const test = await LabTest.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!test) throw createError(404, "Lab test not found");

      await test.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Lab test deleted" });
    } catch (err) {
      next(err);
    }
  },
};