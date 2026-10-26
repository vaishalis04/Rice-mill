const createError = require("http-errors");
const PDFDocument = require("pdfkit");
const { Sampling, LabTest, GateEntry, VarietyMaster, User, Negotiation, PurchaseOrder, Vendor, Vehicle, Customer, MaterialMaster, PlantMaster } = require("../models/index");
const { drawLabTestReport, fmtDT } = require("../helpers/labTestPdf.helper");
const { NEW_NUMERIC_KEYS, numOrNull, cleanCustomParams } = require("../helpers/labParams.helper");

// The optional extra parameters from a request body, ready to save:
// blank numeric -> null, a real 0 stays 0; custom parameters are cleaned up.
// Only keys the request actually carries are returned (so an edit that doesn't
// mention them leaves them alone).
const extraParamFields = (body) => {
  const out = {};
  NEW_NUMERIC_KEYS.forEach((k) => {
    if (body[k] !== undefined) out[k] = numOrNull(body[k]);
  });
  if (body.custom_params !== undefined) out.custom_params = cleanCustomParams(body.custom_params);
  return out;
};

// Same MariaDB/Sequelize JSON-column quirk fixed elsewhere in this codebase
// (purchase.controller.js, loading.controller.js, salesOrder.controller.js):
// a JSON column can round-trip as a raw string instead of an already-parsed
// array. Sampling.material_id/LabTest.material_id are both JSON arrays, and
// without this, `Array.isArray(sampling.material_id)` was silently false —
// so the "does this material belong to the sampling" check always saw an
// empty list and rejected every material, meaning no lab test could ever
// actually be created against a sampling.
const parseIdArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const detailIncludes = [
  {
    model: Sampling,
    as: "sampling",
    attributes: ["id", "sample_code", "gate_entry_id"],
    // vendor/vehicle nested here so LabTestPage's list can show "Vendor Name"
    // and "Vehicle No." alongside the sample code, PO and materials.
    include: [{
      model: GateEntry,
      as: "gateEntry",
      attributes: ["id", "token_no", "gate_status", "vendor_id", "vehicle_id"],
      include: [
        { model: Vendor, as: "vendor", attributes: ["id", "name", "vendor_code"] },
        { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
      ],
    }],
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
    const extras = extraParamFields(req.body);

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

    // A lab test is now always for exactly one material — a sampling that
    // covers 3 materials gets 3 separate LabTest rows, each with its own
    // independent moisture/broken/fm/color/etc measurements, since two
    // different materials from the same truck can easily test differently.
    // The column is still a JSON array under the hood (unchanged, to avoid
    // another risky migration) — every row's array is just always exactly
    // one element now.
    const materialIdList = Array.isArray(material_id) ? material_id : [material_id];
    if (materialIdList.length === 0 || materialIdList[0] === undefined || materialIdList[0] === null) {
      throw createError(400, "material_id is required");
    }
    if (materialIdList.length > 1) {
      throw createError(
        400,
        "A lab test can only cover one material — submit a separate test for each material instead of several at once.",
      );
    }

    // Convert to numbers and remove duplicates
    const uniqueMaterialIds = [
      ...new Set(materialIdList.map((id) => Number(id))),
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
    const samplingMaterialIds = parseIdArray(sampling.material_id).map(Number);

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
    const alreadyTestedMaterialIds = existingTests.flatMap((test) =>
      parseIdArray(test.material_id).map(Number)
    );

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
      moisture_pct: numOrNull(moisture_pct),
      broken_pct: numOrNull(broken_pct),
      fm_pct: numOrNull(fm_pct),
      ...extras,
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
        variety_detected, grain_size, comment, tested_at, plant_id, verdict,
      } = req.body;

      // The edit form also carries the verdict — it used to be silently
      // ignored here, so changing it while editing never took effect.
      if (verdict !== undefined && verdict !== null && verdict !== "" && !VERDICTS.includes(verdict)) {
        throw createError(400, `verdict must be one of: ${VERDICTS.join(", ")}`);
      }
      const previousVerdict = test.verdict;

      if (variety_detected) {
        const variety = await VarietyMaster.findOne({ where: { id: variety_detected, is_deleted: false } });
        if (!variety) throw createError(400, "Invalid variety_detected");
      }

      const updates = {
        moisture_pct: moisture_pct === undefined ? undefined : numOrNull(moisture_pct),
        broken_pct: broken_pct === undefined ? undefined : numOrNull(broken_pct),
        fm_pct: fm_pct === undefined ? undefined : numOrNull(fm_pct),
        ...extraParamFields(req.body),
        color, smell, variety_detected, grain_size, comment, tested_at, plant_id,
      };
      if (verdict) updates.verdict = verdict;
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      if (updates.tested_at === null) delete updates.tested_at; // never blank out the test time
      updates.updated_by = req.user ? req.user.id : null;

      await test.update(updates);

      // A changed verdict drives the gate entry (and a negotiation) exactly
      // like the "Revise Verdict" dropdown does.
      if (updates.verdict && updates.verdict !== previousVerdict) {
        await applyVerdictToGateEntry(test.sampling_id, updates.verdict, req.user ? req.user.id : null);
        await openNegotiationIfNeeded(test, req.user ? req.user.id : null);
      }

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

  // GET /api/lab-tests/:id/pdf  — downloadable Lab Test Report
  pdf: async (req, res, next) => {
    try {
      const test = await LabTest.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: [
          {
            model: Sampling, as: "sampling",
            include: [
              { model: User, as: "collector", attributes: ["id", "username"] },
              {
                model: GateEntry, as: "gateEntry",
                attributes: ["id", "token_no", "challan_no", "entry_time"],
                include: [
                  { model: Vendor, as: "vendor", attributes: ["id", "name"] },
                  { model: Customer, as: "customer", attributes: ["id", "name"] },
                  { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
                ],
              },
            ],
          },
          { model: VarietyMaster, as: "detectedVariety", attributes: ["id", "variety_name"] },
          { model: User, as: "tester", attributes: ["id", "username"] },
        ],
      });
      if (!test) throw createError(404, "Lab test not found");

      const sampling = test.sampling;
      const ge = sampling?.gateEntry;

      const [materials, pos, negotiation, plant] = await Promise.all([
        MaterialMaster.findAll({ where: { id: parseIdArray(test.material_id).map(Number) }, attributes: ["id", "name"] }),
        parseIdArray(sampling?.po_id).length
          ? PurchaseOrder.findAll({ where: { id: parseIdArray(sampling.po_id).map(Number) }, attributes: ["id", "po_no"] })
          : [],
        test.verdict === "negotiation"
          ? Negotiation.findOne({ where: { lab_test_id: test.id, is_deleted: false }, order: [["id", "DESC"]] })
          : null,
        test.plant_id || sampling?.plant_id
          ? PlantMaster.findOne({ where: { id: test.plant_id || sampling.plant_id } })
          : PlantMaster.findOne({ where: { is_deleted: false }, order: [["id", "ASC"]] }),
      ]);

      const doc = new PDFDocument({ size: "A4", margin: 0 });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="lab-test-${sampling?.sample_code || test.id}.pdf"`);
      doc.pipe(res);

      drawLabTestReport(doc, {
        plant,
        test_no: `LT-${String(test.id).padStart(5, "0")}`,
        sample_code: sampling?.sample_code,
        token_no: ge?.token_no,
        vehicle_no: ge?.vehicle?.vehicle_no,
        party: ge?.vendor?.name || ge?.customer?.name,
        party_label: ge?.vendor ? "Vendor" : ge?.customer ? "Customer" : "Party",
        po_nos: [...new Set(pos.map((p) => p.po_no).filter(Boolean))].join(", "),
        challan_no: ge?.challan_no,
        materials: materials.map((m) => m.name).join(", "),
        gate_in: fmtDT(ge?.entry_time),
        collected_at: fmtDT(sampling?.collected_at),
        sent_to_lab_at: fmtDT(sampling?.sent_to_lab_at),
        collected_by: sampling?.collector?.username,
        moisture: test.moisture_pct,
        broken: test.broken_pct,
        fm: test.fm_pct,
        extra_params: [
          { label: "Pin Broken", value: test.pin_broken_pct, unit: "%" },
          { label: "Avg Length", value: test.avg_length_mm, unit: "mm" },
          { label: "DDC", value: test.ddc_pct, unit: "%" },
          { label: "Kett", value: test.kett },
          { label: "Light Yellow", value: test.light_yellow_pct, unit: "%" },
          { label: "Immature", value: test.immature_pct, unit: "%" },
          { label: "White Belly", value: test.white_belly_pct, unit: "%" },
          { label: "Add Mixing", value: test.add_mixing_pct, unit: "%" },
        ],
        custom_params: cleanCustomParams(test.custom_params),
        color: test.color,
        smell: test.smell,
        variety: test.detectedVariety?.variety_name,
        grain_size: test.grain_size,
        verdict: test.verdict,
        comment: test.comment,
        tested_by: test.tester?.username,
        tested_at: fmtDT(test.tested_at),
        negotiation: negotiation
          ? { old_rate: negotiation.old_rate, proposed_rate: negotiation.proposed_rate, response: negotiation.vendor_response }
          : null,
      });
      doc.end();
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