const createError = require("http-errors");
const { Negotiation, LabTest, Sampling, GateEntry, PurchaseOrder, User } = require("../models/index");

// Rate revision workflow (Module 7)
// A negotiation can only be opened against a lab test whose verdict is 'negotiation'.
// vendor_response = 'accept' -> the negotiated rate is written back onto the PurchaseOrder
//                                and the gate entry moves to 'lab_accepted'.
// vendor_response = 'reject' -> the vendor didn't agree to the revised rate; the gate
//                                entry is moved to 'rejected'.

const detailIncludes = [
  {
    model: LabTest,
    as: "labTest",
    attributes: ["id", "verdict", "sampling_id"],
    include: [
      {
        model: Sampling,
        as: "sampling",
        attributes: ["id", "gate_entry_id"],
        include: [{ model: GateEntry, as: "gateEntry", attributes: ["id", "token_no", "gate_status", "po_id"] }],
      },
    ],
  },
  { model: User, as: "negotiator", attributes: ["id", "username", "email"] },
];

// Walks Negotiation -> LabTest -> Sampling -> GateEntry to find the linked gate entry.
const resolveGateEntry = async (negotiation) => {
  const labTest = await LabTest.findOne({ where: { id: negotiation.lab_test_id, is_deleted: false } });
  if (!labTest) return null;
  const sampling = await Sampling.findOne({ where: { id: labTest.sampling_id, is_deleted: false } });
  if (!sampling) return null;
  return GateEntry.findOne({ where: { id: sampling.gate_entry_id, is_deleted: false } });
};

module.exports = {
  // GET /api/negotiations?lab_test_id=&vendor_response=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { lab_test_id, vendor_response, page = 1, limit = 20 } = req.query;

      const where = { is_deleted: false };
      if (lab_test_id) where.lab_test_id = lab_test_id;
      if (vendor_response) where.vendor_response = vendor_response;

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await Negotiation.findAndCountAll({
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

  // GET /api/negotiations/:id
  getById: async (req, res, next) => {
    try {
      const negotiation = await Negotiation.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: detailIncludes,
      });
      if (!negotiation) throw createError(404, "Negotiation not found");
      res.status(200).json({ success: true, data: negotiation });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/negotiations  { lab_test_id, old_rate, proposed_rate }
  create: async (req, res, next) => {
    try {
      const { lab_test_id, old_rate, proposed_rate, plant_id } = req.body;

      if (!lab_test_id || old_rate === undefined || proposed_rate === undefined) {
        throw createError(400, "lab_test_id, old_rate and proposed_rate are required");
      }

      const labTest = await LabTest.findOne({ where: { id: lab_test_id, is_deleted: false } });
      if (!labTest) throw createError(400, "Invalid lab_test_id");
      if (labTest.verdict !== "negotiation") {
        throw createError(400, "A negotiation can only be opened for a lab test with verdict 'negotiation'");
      }

      const existing = await Negotiation.findOne({ where: { lab_test_id, is_deleted: false } });
      if (existing) throw createError(409, "A negotiation already exists for this lab test");

      const negotiation = await Negotiation.create({
        lab_test_id,
        old_rate,
        proposed_rate,
        negotiated_by: req.user ? req.user.id : null,
        negotiated_at: new Date(),
        plant_id: plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      const created = await Negotiation.findByPk(negotiation.id, { include: detailIncludes });
      res.status(201).json({ success: true, msg: "Negotiation opened", data: created });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/negotiations/:id
  update: async (req, res, next) => {
    try {
      const negotiation = await Negotiation.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!negotiation) throw createError(404, "Negotiation not found");

      const { old_rate, proposed_rate, plant_id } = req.body;

      const updates = { old_rate, proposed_rate, plant_id };
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      updates.updated_by = req.user ? req.user.id : null;

      await negotiation.update(updates);

      const updated = await Negotiation.findByPk(negotiation.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Negotiation updated", data: updated });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/negotiations/:id/respond  { vendor_response: "accept" | "reject" }
  respond: async (req, res, next) => {
    try {
      const { vendor_response } = req.body;
      if (!["accept", "reject"].includes(vendor_response)) {
        throw createError(400, "vendor_response must be 'accept' or 'reject'");
      }

      const negotiation = await Negotiation.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!negotiation) throw createError(404, "Negotiation not found");
      if (negotiation.vendor_response) {
        throw createError(400, `This negotiation has already been responded to ('${negotiation.vendor_response}')`);
      }

      await negotiation.update({
        vendor_response,
        negotiated_at: new Date(),
        updated_by: req.user ? req.user.id : null,
      });

      const gateEntry = await resolveGateEntry(negotiation);
      if (!gateEntry) {
        const updated = await Negotiation.findByPk(negotiation.id, { include: detailIncludes });
        return res.status(200).json({
          success: true,
          msg: `Vendor response recorded ('${vendor_response}'), but the linked gate entry could not be resolved`,
          data: updated,
        });
      }

      if (vendor_response === "accept") {
        if (gateEntry.po_id) {
          const po = await PurchaseOrder.findOne({ where: { id: gateEntry.po_id, is_deleted: false } });
          if (po) {
            await po.update({ rate: negotiation.proposed_rate, updated_by: req.user ? req.user.id : null });
          }
        }
        await gateEntry.update({ gate_status: "lab_accepted", updated_by: req.user ? req.user.id : null });
      } else {
        await gateEntry.update({ gate_status: "rejected", updated_by: req.user ? req.user.id : null });
      }

      const updated = await Negotiation.findByPk(negotiation.id, { include: detailIncludes });
      res.status(200).json({
        success: true,
        msg: `Vendor ${vendor_response === "accept" ? "accepted" : "rejected"} the revised rate — gate entry status is now '${gateEntry.gate_status}'`,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/negotiations/:id  (soft delete)
  delete: async (req, res, next) => {
    try {
      const negotiation = await Negotiation.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!negotiation) throw createError(404, "Negotiation not found");

      await negotiation.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Negotiation deleted" });
    } catch (err) {
      next(err);
    }
  },
};
