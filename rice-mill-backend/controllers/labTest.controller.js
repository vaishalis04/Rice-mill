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

    // Required validation
    if (!sampling_id || !verdict) {
      throw createError(400, "sampling_id and verdict are required");
    }

    // Verdict validation
    if (!VERDICTS.includes(verdict)) {
      throw createError(
        400,
        `verdict must be one of: ${VERDICTS.join(", ")}`
      );
    }

    // material_id must be an array
    if (!Array.isArray(material_id) || material_id.length === 0) {
      throw createError(400, "material_id must be a non-empty array");
    }

    // Convert to numbers and remove duplicates
    const uniqueMaterialIds = [
      ...new Set(material_id.map((id) => Number(id))),
    ];

    // Validate IDs
    if (uniqueMaterialIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw createError(400, "material_id contains invalid values");
    }

    // Find sampling
    const sampling = await Sampling.findOne({
      where: {
        id: sampling_id,
        is_deleted: false,
      },
    });

    if (!sampling) {
      throw createError(400, "Invalid sampling_id");
    }

    // Get materials assigned to this sampling
    const samplingMaterialIds = Array.isArray(sampling.material_id)
      ? sampling.material_id.map(Number)
      : [];

    // Check submitted materials belong to sampling
    const invalidMaterials = uniqueMaterialIds.filter(
      (id) => !samplingMaterialIds.includes(id)
    );

    if (invalidMaterials.length > 0) {
      throw createError(
        400,
        `Material(s) ${invalidMaterials.join(
          ", "
        )} do not belong to this sampling`
      );
    }

    // Validate variety
    if (variety_detected) {
      const variety = await VarietyMaster.findOne({
        where: {
          id: variety_detected,
          is_deleted: false,
        },
      });

      if (!variety) {
        throw createError(400, "Invalid variety_detected");
      }
    }

    /*
     * Find ALL previous lab tests for this sampling
     */
    const existingTests = await LabTest.findAll({
      where: {
        sampling_id,
        is_deleted: false,
      },
    });

    /*
     * Collect all materials already tested
     *
     * Example existing rows:
     *
     * Row 1 -> material_id [1]
     * Row 2 -> material_id [2, 3]
     *
     * Result:
     * alreadyTestedMaterialIds = [1, 2, 3]
     */
    const alreadyTestedMaterialIds = existingTests.flatMap((test) => {
      if (Array.isArray(test.material_id)) {
        return test.material_id.map(Number);
      }

      return [];
    });

    // Check whether submitted materials were already tested
    const duplicates = uniqueMaterialIds.filter((id) =>
      alreadyTestedMaterialIds.includes(id)
    );

    if (duplicates.length > 0) {
      throw createError(
        400,
        `Material(s) ${duplicates.join(
          ", "
        )} already have a lab test for this sampling`
      );
    }

    /*
     * ALWAYS CREATE A NEW ROW
     *
     * Do not use existing.update()
     */
    const test = await LabTest.create({
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
      plant_id:
        plant_id ||
        sampling.plant_id ||
        (req.user ? req.user.plant_id : null),
      created_by: req.user ? req.user.id : null,
    });

    // Apply verdict to gate entry
    await applyVerdictToGateEntry(
      sampling_id,
      verdict,
      req.user ? req.user.id : null
    );

    // Open negotiation if required
    await openNegotiationIfNeeded(
      test,
      req.user ? req.user.id : null
    );

    // Get created record with details
    const created = await LabTest.findByPk(test.id, {
      include: detailIncludes,
    });

    return res.status(201).json({
      success: true,
      msg: "Lab test recorded successfully",
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