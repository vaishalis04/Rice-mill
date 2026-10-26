const createError = require("http-errors");
const PDFDocument = require("pdfkit");
const {
  CompositeReport, LabTest, Sampling, GateEntry, Vendor, Customer, Vehicle,
  MaterialMaster, PlantMaster,
} = require("../models/index");
const { drawCompositeReport } = require("../helpers/compositeReportPdf.helper");
const { labTestParamRows, parseJsonArray } = require("../helpers/labParams.helper");

// A Composite Report is generated from a tested sample (a lab test report).
// It stands on its own: it never changes gate entries, unloading, loading,
// production, stock or the lab test itself.

const RESULTS = ["approved", "rejected", "non_conforming"];
const VERDICT_TO_RESULT = { accepted: "approved", rejected: "rejected", negotiation: "non_conforming" };

const str = (v, max) => {
  const t = String(v ?? "").trim();
  return t ? t.slice(0, max) : null;
};

// [{ name, exposed, composite }] — a name is needed, the values are free text.
const cleanParams = (value) =>
  parseJsonArray(value)
    .map((p) => ({
      name: String((p && p.name) ?? "").trim().slice(0, 60),
      exposed: String((p && p.exposed) ?? "").trim().slice(0, 40),
      composite: String((p && p.composite) ?? "").trim().slice(0, 40),
    }))
    .filter((p) => p.name)
    .slice(0, 66);

const cleanResult = (v) => {
  if (v === undefined || v === null || v === "") return null;
  if (!RESULTS.includes(v)) throw createError(400, `result must be one of: ${RESULTS.join(", ")}`);
  return v;
};

const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// The lab test with everything the report header needs.
const loadLabTest = (id) =>
  LabTest.findOne({
    where: { id, is_deleted: false },
    include: [
      {
        model: Sampling, as: "sampling",
        attributes: ["id", "sample_code", "gate_entry_id", "plant_id"],
        include: [{
          model: GateEntry, as: "gateEntry",
          attributes: ["id", "token_no"],
          include: [
            { model: Vendor, as: "vendor", attributes: ["id", "name"] },
            { model: Customer, as: "customer", attributes: ["id", "name"] },
            { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
          ],
        }],
      },
    ],
  });

const materialNames = async (test) => {
  const ids = parseJsonArray(test.material_id).map(Number).filter(Boolean);
  if (!ids.length) return "";
  const rows = await MaterialMaster.findAll({ where: { id: ids }, attributes: ["id", "name"] });
  return rows.map((m) => m.name).join(", ");
};

const listIncludes = [
  {
    model: LabTest, as: "labTest",
    attributes: ["id", "sampling_id", "material_id", "verdict"],
    include: [{ model: Sampling, as: "sampling", attributes: ["id", "sample_code"] }],
  },
];

module.exports = {
  // GET /api/composite-reports
  getAll: async (req, res, next) => {
    try {
      const { lab_test_id, page = 1, limit = 100 } = req.query;
      const where = { is_deleted: false };
      if (lab_test_id) where.lab_test_id = lab_test_id;

      const { rows, count } = await CompositeReport.findAndCountAll({
        where,
        include: listIncludes,
        order: [["created_at", "DESC"]],
        limit: Number(limit),
        offset: (Number(page) - 1) * Number(limit),
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

  // GET /api/composite-reports/source/:lab_test_id
  // Everything the form pre-fills once a sample report is picked: the header
  // details and the exposed-sample analysis (the lab test's readings).
  source: async (req, res, next) => {
    try {
      const test = await loadLabTest(req.params.lab_test_id);
      if (!test) throw createError(404, "Sample report (lab test) not found");

      const ge = test.sampling?.gateEntry;
      res.status(200).json({
        success: true,
        data: {
          lab_test_id: test.id,
          sample_code: test.sampling?.sample_code || null,
          party_name: ge?.vendor?.name || ge?.customer?.name || "",
          truck_no: ge?.vehicle?.vehicle_no || "",
          quality: await materialNames(test),
          ref_no: test.sampling?.sample_code || "",
          report_date: todayStr(),
          result_exposed: VERDICT_TO_RESULT[test.verdict] || null,
          params: labTestParamRows(test).map((p) => ({ name: p.name, exposed: p.value, composite: "" })),
        },
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/composite-reports/:id
  getById: async (req, res, next) => {
    try {
      const row = await CompositeReport.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: listIncludes,
      });
      if (!row) throw createError(404, "Composite report not found");
      res.status(200).json({ success: true, data: row });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/composite-reports
  create: async (req, res, next) => {
    try {
      const b = req.body;
      if (!b.lab_test_id) throw createError(400, "Select the sample report (lab test) first");
      const test = await loadLabTest(b.lab_test_id);
      if (!test) throw createError(400, "Sample report (lab test) not found");

      const params = cleanParams(b.params);
      if (!params.length) throw createError(400, "Add at least one parameter to the report");

      const row = await CompositeReport.create({
        lab_test_id: test.id,
        approval_no: str(b.approval_no, 60),
        ref_no: str(b.ref_no, 60),
        report_date: b.report_date || todayStr(),
        party_name: str(b.party_name, 150),
        truck_no: str(b.truck_no, 40),
        qty: str(b.qty, 60),
        quality: str(b.quality, 150),
        params,
        result_exposed: cleanResult(b.result_exposed),
        result_composite: cleanResult(b.result_composite),
        remarks: str(b.remarks, 1000),
        plant_id: test.plant_id || test.sampling?.plant_id || (req.user ? req.user.plant_id : null) || null,
        created_by: req.user ? req.user.id : null,
      });
      await row.update({ report_no: `CR-${String(row.id).padStart(5, "0")}` });

      const created = await CompositeReport.findByPk(row.id, { include: listIncludes });
      res.status(201).json({ success: true, msg: "Composite report generated", data: created });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/composite-reports/:id
  update: async (req, res, next) => {
    try {
      const row = await CompositeReport.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!row) throw createError(404, "Composite report not found");

      const b = req.body;
      const updates = {};
      if (b.approval_no !== undefined) updates.approval_no = str(b.approval_no, 60);
      if (b.ref_no !== undefined) updates.ref_no = str(b.ref_no, 60);
      if (b.report_date !== undefined && b.report_date) updates.report_date = b.report_date;
      if (b.party_name !== undefined) updates.party_name = str(b.party_name, 150);
      if (b.truck_no !== undefined) updates.truck_no = str(b.truck_no, 40);
      if (b.qty !== undefined) updates.qty = str(b.qty, 60);
      if (b.quality !== undefined) updates.quality = str(b.quality, 150);
      if (b.result_exposed !== undefined) updates.result_exposed = cleanResult(b.result_exposed);
      if (b.result_composite !== undefined) updates.result_composite = cleanResult(b.result_composite);
      if (b.remarks !== undefined) updates.remarks = str(b.remarks, 1000);
      if (b.params !== undefined) {
        const params = cleanParams(b.params);
        if (!params.length) throw createError(400, "Add at least one parameter to the report");
        updates.params = params;
      }
      updates.updated_by = req.user ? req.user.id : null;

      await row.update(updates);
      const updated = await CompositeReport.findByPk(row.id, { include: listIncludes });
      res.status(200).json({ success: true, msg: "Composite report updated", data: updated });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/composite-reports/:id  (soft delete)
  delete: async (req, res, next) => {
    try {
      const row = await CompositeReport.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!row) throw createError(404, "Composite report not found");
      await row.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Composite report deleted" });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/composite-reports/:id/pdf
  pdf: async (req, res, next) => {
    try {
      const row = await CompositeReport.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: listIncludes,
      });
      if (!row) throw createError(404, "Composite report not found");

      const plant = row.plant_id
        ? await PlantMaster.findOne({ where: { id: row.plant_id } })
        : await PlantMaster.findOne({ where: { is_deleted: false }, order: [["id", "ASC"]] });

      const doc = new PDFDocument({ size: "A4", margin: 0 });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="composite-report-${row.report_no || row.id}.pdf"`);
      doc.pipe(res);

      drawCompositeReport(doc, {
        plant,
        report_no: row.report_no,
        approval_no: row.approval_no,
        ref_no: row.ref_no,
        date: row.report_date,
        party: row.party_name,
        truck: row.truck_no,
        qty: row.qty,
        quality: row.quality,
        params: parseJsonArray(row.params),
        result_exposed: row.result_exposed,
        result_composite: row.result_composite,
        remarks: row.remarks,
        generated_by: req.user?.username,
      });
      doc.end();
    } catch (err) {
      next(err);
    }
  },
};
