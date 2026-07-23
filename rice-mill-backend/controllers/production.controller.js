const createError = require("http-errors");
const {
  ProductionBatch, Lot, Dryer, MachineLog, MachineMaster, User,
  SeparatorOutput, ShinerProcess, ColorSorter, LengthGrading,
  MaterialMaster, ByProductInventory, Inventory, ReasonCodeMaster,
} = require("../models/index");
const { generateBatchNo } = require("../helpers/helperFunction");

// Batch creation & stage-by-stage processing (Module 11)
// Stage order depends on process_type: 'wet' batches run the dryer first;
// 'dry' batches skip straight to milling. current_stage on ProductionBatch
// drives the FE's stage tracker and gates each PATCH endpoint below.

const STAGE_ORDER = {
  wet: ["dryer", "milling", "separator", "shiner", "color_sorter", "length_grading"],
  dry: ["milling", "separator", "shiner", "color_sorter", "length_grading"],
};

const STAGE_LABELS = {
  dryer: "Dryer",
  milling: "Milling / Huller",
  separator: "Separator",
  shiner: "Shiner (up to 5 passes)",
  color_sorter: "Color Sorter",
  length_grading: "Length Grading",
};

const detailIncludes = [
  { model: Lot, as: "lot", attributes: ["id", "lot_no", "material_id", "qty"] },
  { model: Dryer, as: "dryer" },
  {
    model: MachineLog,
    as: "machineLogs",
    include: [
      { model: MachineMaster, as: "machine", attributes: ["id", "machine_code", "name", "type"] },
      { model: User, as: "operator", attributes: ["id", "username", "email"] },
      { model: ReasonCodeMaster, as: "downtimeReason", attributes: ["id", "code", "description"] },
    ],
  },
  { model: SeparatorOutput, as: "separatorOutput" },
  { model: ShinerProcess, as: "shinerStages", include: [{ model: MachineMaster, as: "machine", attributes: ["id", "machine_code", "name"] }] },
  { model: ColorSorter, as: "colorSorter" },
  { model: LengthGrading, as: "lengthGrading" },
];

// Builds the FE's stage-checklist / progress-bar payload.
const buildChecklist = (batch) => {
  const order = STAGE_ORDER[batch.process_type];
  const currentIndex = batch.current_stage === "completed" ? order.length : order.indexOf(batch.current_stage);
  return order.map((stage, idx) => ({
    stage,
    label: STAGE_LABELS[stage],
    status: idx < currentIndex ? "completed" : idx === currentIndex ? "current" : "upcoming",
  }));
};

const nextStage = (processType, current) => {
  const order = STAGE_ORDER[processType];
  const idx = order.indexOf(current);
  return idx === order.length - 1 ? "completed" : order[idx + 1];
};

const ensureStage = (batch, stageName) => {
  if (batch.current_stage !== stageName) {
    throw createError(400, `This batch's current stage is '${batch.current_stage}'; the '${stageName}' stage is not unlocked yet`);
  }
};

const validateMachine = async (machine_id) => {
  if (!machine_id) throw createError(400, "machine_id is required");
  const machine = await MachineMaster.findOne({ where: { id: machine_id, is_deleted: false } });
  if (!machine) throw createError(400, "Invalid machine_id");
  return machine;
};

const computeRunningHours = (start, end) => {
  if (!start || !end) return null;
  const hrs = (new Date(end) - new Date(start)) / (1000 * 60 * 60);
  return hrs > 0 ? Number(hrs.toFixed(2)) : null;
};

// Writes a by-product entry (husk/bran/broken) to both the lot-traceable Inventory
// ledger (stage='by_product') and the aggregate ByProductInventory running totals.
// Silently skips (returning null) if no MaterialMaster row exists for that category —
// by-product master data is a prerequisite, not something this endpoint should invent.
const writeByProduct = async (category, qty, { lotId, plantId, userId }) => {
  if (!qty || Number(qty) <= 0) return null;

  const material = await MaterialMaster.findOne({ where: { category, is_deleted: false } });
  if (!material) return { skipped: true, category, reason: `No MaterialMaster row with category '${category}' found` };

  const inventoryRow = await Inventory.create({
    lot_id: lotId,
    material_id: material.id,
    warehouse_id: null,
    stage: "by_product",
    qty_in: qty,
    qty_out: 0,
    balance_qty: qty,
    as_of: new Date(),
    plant_id: plantId,
    created_by: userId,
  });

  let byProduct = await ByProductInventory.findOne({ where: { material_id: material.id, is_deleted: false } });
  if (byProduct) {
    await byProduct.update({
      qty_produced: Number(byProduct.qty_produced) + Number(qty),
      qty_in_stock: Number(byProduct.qty_in_stock) + Number(qty),
      updated_by: userId,
    });
  } else {
    byProduct = await ByProductInventory.create({
      material_id: material.id,
      qty_produced: qty,
      qty_sold: 0,
      qty_in_stock: qty,
      plant_id: plantId,
      created_by: userId,
    });
  }

  return { category, material_id: material.id, qty: Number(qty), inventoryRow, byProduct };
};

module.exports = {
  // GET /api/production/batches?lot_id=&batch_status=&current_stage=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { lot_id, batch_status, current_stage, plant_id, page = 1, limit = 20 } = req.query;

      const where = { is_deleted: false };
      if (lot_id) where.lot_id = lot_id;
      if (batch_status) where.batch_status = batch_status;
      if (current_stage) where.current_stage = current_stage;
      if (plant_id) where.plant_id = plant_id;

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await ProductionBatch.findAndCountAll({
        where,
        include: [{ model: Lot, as: "lot", attributes: ["id", "lot_no", "material_id"] }],
        order: [["created_at", "DESC"]],
        limit: Number(limit),
        offset,
        distinct: true,
      });

      res.status(200).json({
        success: true,
        data: rows.map((b) => ({ ...b.toJSON(), checklist: buildChecklist(b) })),
        pagination: { total: count, page: Number(page), limit: Number(limit), totalPages: Math.ceil(count / limit) },
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/production/batches/:id  — full stage history + checklist
  getById: async (req, res, next) => {
    try {
      const batch = await ProductionBatch.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: detailIncludes,
      });
      if (!batch) throw createError(404, "Production batch not found");

      res.status(200).json({ success: true, data: { ...batch.toJSON(), checklist: buildChecklist(batch) } });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/production/batches  { lot_id, process_type, input_qty?, production_date? }
  create: async (req, res, next) => {
    try {
      const { lot_id, process_type, input_qty, production_date, plant_id } = req.body;
console.log("req.body", req.body);
      if (!lot_id || !process_type) throw createError(400, "lot_id and process_type are required");
      if (!["dry", "wet"].includes(process_type)) throw createError(400, "process_type must be 'dry' or 'wet'");

      const lot = await Lot.findOne({ where: { id: lot_id, is_deleted: false } });
      if (!lot) throw createError(400, "Invalid lot_id");
console.log("lot", lot);
      const existing = await ProductionBatch.findOne({ where: { lot_id, is_deleted: false } });
      if (existing) throw createError(409, "A production batch already exists for this lot");
console.log("existing", existing);
      const batch_no = await generateBatchNo();
      console.log("batch_no", batch_no);
      const order = STAGE_ORDER[process_type];
      console.log("order", order);

      const batch = await ProductionBatch.create({
        batch_no,
        lot_id,
        process_type,
        input_qty: input_qty !== undefined ? input_qty : lot.qty,
        production_date: production_date || new Date().toISOString().slice(0, 10),
        batch_status: "in_progress",
        current_stage: order[0],
        plant_id: plant_id || lot.plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      const created = await ProductionBatch.findByPk(batch.id, { include: detailIncludes });
      res.status(201).json({
        success: true,
        msg: `Batch ${batch_no} created`,
        data: { ...created.toJSON(), checklist: buildChecklist(created) },
      });
    } catch (err) {
  console.log("ERROR:", err);
  console.log("ERROR MESSAGE:", err.message);
  console.log("SQL:", err.sql);
  next(err);
}
  },

  // PUT /api/production/batches/:id  (metadata only — use the stage endpoints for processing)
  update: async (req, res, next) => {
    try {
      const batch = await ProductionBatch.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!batch) throw createError(404, "Production batch not found");

      const { input_qty, production_date, batch_status, plant_id } = req.body;
      if (batch_status && !["pending", "in_progress", "completed", "on_hold"].includes(batch_status)) {
        throw createError(400, "Invalid batch_status");
      }

      const updates = { input_qty, production_date, batch_status, plant_id };
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      updates.updated_by = req.user ? req.user.id : null;

      await batch.update(updates);

      const updated = await ProductionBatch.findByPk(batch.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Batch updated", data: { ...updated.toJSON(), checklist: buildChecklist(updated) } });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/production/batches/:id  (soft delete)
  delete: async (req, res, next) => {
    try {
      const batch = await ProductionBatch.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!batch) throw createError(404, "Production batch not found");

      await batch.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Production batch deleted" });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/production/batches/:id/dryer
  // { machine_id, moisture_before, moisture_after, start_time, end_time, target_moisture? }
  dryerStage: async (req, res, next) => {
    try {
      const batch = await ProductionBatch.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!batch) throw createError(404, "Production batch not found");
      if (batch.process_type !== "wet") {
        throw createError(400, "This batch's process_type is 'dry'; the dryer stage does not apply");
      }
      ensureStage(batch, "dryer");

      const { machine_id, moisture_before, moisture_after, start_time, end_time, target_moisture } = req.body;
      if (moisture_before === undefined || moisture_after === undefined) {
        throw createError(400, "moisture_before and moisture_after are required");
      }
      await validateMachine(machine_id);

      const threshold = target_moisture !== undefined ? Number(target_moisture) : 14;
      const passed = Number(moisture_after) <= threshold;

      let dryer = await Dryer.findOne({ where: { batch_id: batch.id, is_deleted: false } });
      const payload = {
        batch_id: batch.id,
        machine_id,
        start_time,
        end_time,
        moisture_before,
        moisture_after,
        recheck_status: passed ? "passed" : "failed",
        plant_id: batch.plant_id,
      };

      if (dryer) {
        payload.updated_by = req.user ? req.user.id : null;
        await dryer.update(payload);
      } else {
        payload.created_by = req.user ? req.user.id : null;
        dryer = await Dryer.create(payload);
      }

      if (passed) {
        await batch.update({
          current_stage: nextStage(batch.process_type, "dryer"),
          batch_status: "in_progress",
          updated_by: req.user ? req.user.id : null,
        });
      } else {
        await batch.update({ batch_status: "on_hold", updated_by: req.user ? req.user.id : null });
      }

      const updated = await ProductionBatch.findByPk(batch.id, { include: detailIncludes });
      res.status(200).json({
        success: true,
        msg: passed
          ? `Moisture check passed (${moisture_after}% ≤ ${threshold}%) — advanced to '${updated.current_stage}'`
          : `Moisture check failed (${moisture_after}% > ${threshold}%) — batch on hold, re-dry and re-submit`,
        data: { ...updated.toJSON(), checklist: buildChecklist(updated) },
      });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/production/batches/:id/milling
  // { machine_id, operator_id?, input_qty?, output_qty, husk_qty?, broken_qty?, start_time?, end_time?, downtime_minutes?, downtime_reason_id? }
  millingStage: async (req, res, next) => {
    try {
      const batch = await ProductionBatch.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!batch) throw createError(404, "Production batch not found");
      ensureStage(batch, "milling");

      const {
        machine_id, operator_id, input_qty, output_qty, husk_qty, broken_qty,
        start_time, end_time, downtime_minutes, downtime_reason_id,
      } = req.body;

      if (output_qty === undefined) throw createError(400, "output_qty is required");
      await validateMachine(machine_id);

      const resolvedInput = input_qty !== undefined ? Number(input_qty) : Number(batch.input_qty);
      const recovery_pct = resolvedInput > 0 ? Number(((Number(output_qty) / resolvedInput) * 100).toFixed(2)) : null;

      const log = await MachineLog.create({
        batch_id: batch.id,
        machine_id,
        operator_id: operator_id || (req.user ? req.user.id : null),
        stage: "milling",
        start_time,
        end_time,
        running_hours: computeRunningHours(start_time, end_time),
        input_qty: resolvedInput,
        output_qty,
        recovery_pct,
        downtime_minutes: downtime_minutes || 0,
        downtime_reason_id: downtime_reason_id || null,
        plant_id: batch.plant_id,
        created_by: req.user ? req.user.id : null,
      });

      const byProducts = (
        await Promise.all([
          writeByProduct("husk", husk_qty, { lotId: batch.lot_id, plantId: batch.plant_id, userId: req.user ? req.user.id : null }),
          writeByProduct("broken", broken_qty, { lotId: batch.lot_id, plantId: batch.plant_id, userId: req.user ? req.user.id : null }),
        ])
      ).filter(Boolean);

      await batch.update({ current_stage: nextStage(batch.process_type, "milling"), updated_by: req.user ? req.user.id : null });

      const updated = await ProductionBatch.findByPk(batch.id, { include: detailIncludes });
      res.status(200).json({
        success: true,
        msg: `Milling recorded (recovery ${recovery_pct}%) — advanced to '${updated.current_stage}'`,
        data: { batch: { ...updated.toJSON(), checklist: buildChecklist(updated) }, machineLog: log, byProducts },
      });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/production/batches/:id/separator
  // { machine_id?, operator_id?, input_qty?, cleaned_qty, impurity_qty?, stone_qty?, dust_qty?, start_time?, end_time? }
  separatorStage: async (req, res, next) => {
    try {
      const batch = await ProductionBatch.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!batch) throw createError(404, "Production batch not found");
      ensureStage(batch, "separator");

      const { machine_id, operator_id, input_qty, cleaned_qty, impurity_qty, stone_qty, dust_qty, start_time, end_time } = req.body;
      if (cleaned_qty === undefined) throw createError(400, "cleaned_qty is required");

      const resolvedInput = input_qty !== undefined ? Number(input_qty) : Number(batch.input_qty);
      const recovery_pct = resolvedInput > 0 ? Number(((Number(cleaned_qty) / resolvedInput) * 100).toFixed(2)) : null;

      let existing = await SeparatorOutput.findOne({ where: { batch_id: batch.id, is_deleted: false } });
      const payload = {
        batch_id: batch.id,
        input_qty: resolvedInput,
        cleaned_qty,
        impurity_qty,
        stone_qty,
        dust_qty,
        plant_id: batch.plant_id,
      };

      if (existing) {
        payload.updated_by = req.user ? req.user.id : null;
        await existing.update(payload);
      } else {
        payload.created_by = req.user ? req.user.id : null;
        existing = await SeparatorOutput.create(payload);
      }

      let log = null;
      if (machine_id) {
        await validateMachine(machine_id);
        log = await MachineLog.create({
          batch_id: batch.id,
          machine_id,
          operator_id: operator_id || (req.user ? req.user.id : null),
          stage: "separator",
          start_time,
          end_time,
          running_hours: computeRunningHours(start_time, end_time),
          input_qty: resolvedInput,
          output_qty: cleaned_qty,
          recovery_pct,
          plant_id: batch.plant_id,
          created_by: req.user ? req.user.id : null,
        });
      }

      await batch.update({ current_stage: nextStage(batch.process_type, "separator"), updated_by: req.user ? req.user.id : null });

      const updated = await ProductionBatch.findByPk(batch.id, { include: detailIncludes });
      res.status(200).json({
        success: true,
        msg: `Separator recorded (recovery ${recovery_pct}%) — advanced to '${updated.current_stage}'`,
        data: { batch: { ...updated.toJSON(), checklist: buildChecklist(updated) }, separatorOutput: existing, machineLog: log },
      });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/production/batches/:id/shiner
  // { stage_no (1-5), machine_id, operator_id?, input_qty?, output_qty, loss_qty?, bran_qty?, start_time?, end_time?, is_final? }
  shinerStage: async (req, res, next) => {
    try {
      const batch = await ProductionBatch.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!batch) throw createError(404, "Production batch not found");
      ensureStage(batch, "shiner");

      const {
        stage_no, machine_id, operator_id, input_qty, output_qty, loss_qty, bran_qty,
        start_time, end_time, is_final,
      } = req.body;

      if (!stage_no || stage_no < 1 || stage_no > 5) throw createError(400, "stage_no is required and must be between 1 and 5");
      if (output_qty === undefined) throw createError(400, "output_qty is required");
      await validateMachine(machine_id);

      const existingPass = await ShinerProcess.findOne({ where: { batch_id: batch.id, stage_no, is_deleted: false } });
      if (existingPass) throw createError(409, `Shiner stage_no ${stage_no} has already been recorded for this batch`);

      const resolvedInput = input_qty !== undefined ? Number(input_qty) : Number(batch.input_qty);
      const recovery_pct = resolvedInput > 0 ? Number(((Number(output_qty) / resolvedInput) * 100).toFixed(2)) : null;

      const shinerPass = await ShinerProcess.create({
        batch_id: batch.id,
        stage_no,
        machine_id,
        input_qty: resolvedInput,
        output_qty,
        loss_qty,
        bran_qty,
        plant_id: batch.plant_id,
        created_by: req.user ? req.user.id : null,
      });

      const log = await MachineLog.create({
        batch_id: batch.id,
        machine_id,
        operator_id: operator_id || (req.user ? req.user.id : null),
        stage: "shiner",
        start_time,
        end_time,
        running_hours: computeRunningHours(start_time, end_time),
        input_qty: resolvedInput,
        output_qty,
        recovery_pct,
        plant_id: batch.plant_id,
        created_by: req.user ? req.user.id : null,
      });

      const byProducts = [
        await writeByProduct("bran", bran_qty, { lotId: batch.lot_id, plantId: batch.plant_id, userId: req.user ? req.user.id : null }),
      ].filter(Boolean);

      const finished = Boolean(is_final) || Number(stage_no) === 5;
      if (finished) {
        await batch.update({ current_stage: nextStage(batch.process_type, "shiner"), updated_by: req.user ? req.user.id : null });
      } else {
        await batch.update({ updated_by: req.user ? req.user.id : null });
      }

      const updated = await ProductionBatch.findByPk(batch.id, { include: detailIncludes });
      res.status(200).json({
        success: true,
        msg: finished
          ? `Shiner pass ${stage_no} recorded (final) — advanced to '${updated.current_stage}'`
          : `Shiner pass ${stage_no} recorded (recovery ${recovery_pct}%) — still on 'shiner', submit the next pass or mark is_final`,
        data: { batch: { ...updated.toJSON(), checklist: buildChecklist(updated) }, shinerPass, machineLog: log, byProducts },
      });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/production/batches/:id/color-sorter
  // { machine_id?, operator_id?, input_qty?, good_qty, rejected_qty?, start_time?, end_time? }
  colorSorterStage: async (req, res, next) => {
    try {
      const batch = await ProductionBatch.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!batch) throw createError(404, "Production batch not found");
      ensureStage(batch, "color_sorter");

      const { machine_id, operator_id, input_qty, good_qty, rejected_qty, start_time, end_time } = req.body;
      if (good_qty === undefined) throw createError(400, "good_qty is required");

      const resolvedInput = input_qty !== undefined ? Number(input_qty) : Number(batch.input_qty);
      const recovery_pct = resolvedInput > 0 ? Number(((Number(good_qty) / resolvedInput) * 100).toFixed(2)) : null;

      let existing = await ColorSorter.findOne({ where: { batch_id: batch.id, is_deleted: false } });
      const payload = { batch_id: batch.id, input_qty: resolvedInput, good_qty, rejected_qty, plant_id: batch.plant_id };

      if (existing) {
        payload.updated_by = req.user ? req.user.id : null;
        await existing.update(payload);
      } else {
        payload.created_by = req.user ? req.user.id : null;
        existing = await ColorSorter.create(payload);
      }

      let log = null;
      if (machine_id) {
        await validateMachine(machine_id);
        log = await MachineLog.create({
          batch_id: batch.id,
          machine_id,
          operator_id: operator_id || (req.user ? req.user.id : null),
          stage: "color_sorter",
          start_time,
          end_time,
          running_hours: computeRunningHours(start_time, end_time),
          input_qty: resolvedInput,
          output_qty: good_qty,
          recovery_pct,
          plant_id: batch.plant_id,
          created_by: req.user ? req.user.id : null,
        });
      }

      await batch.update({ current_stage: nextStage(batch.process_type, "color_sorter"), updated_by: req.user ? req.user.id : null });

      const updated = await ProductionBatch.findByPk(batch.id, { include: detailIncludes });
      res.status(200).json({
        success: true,
        msg: `Color sorter recorded (recovery ${recovery_pct}%) — advanced to '${updated.current_stage}'`,
        data: { batch: { ...updated.toJSON(), checklist: buildChecklist(updated) }, colorSorter: existing, machineLog: log },
      });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/production/batches/:id/length-grading  (final stage)
  // { machine_id?, operator_id?, input_qty?, long_qty, medium_qty?, broken_qty?, small_broken_qty?, start_time?, end_time? }
  lengthGradingStage: async (req, res, next) => {
    try {
      const batch = await ProductionBatch.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!batch) throw createError(404, "Production batch not found");
      ensureStage(batch, "length_grading");

      const {
        machine_id, operator_id, input_qty, long_qty, medium_qty, broken_qty, small_broken_qty,
        start_time, end_time,
      } = req.body;
      if (long_qty === undefined) throw createError(400, "long_qty is required");

      const resolvedInput = input_qty !== undefined ? Number(input_qty) : Number(batch.input_qty);
      const totalOutput = [long_qty, medium_qty, broken_qty, small_broken_qty]
        .map((v) => Number(v) || 0)
        .reduce((a, b) => a + b, 0);
      const recovery_pct = resolvedInput > 0 ? Number(((totalOutput / resolvedInput) * 100).toFixed(2)) : null;

      let existing = await LengthGrading.findOne({ where: { batch_id: batch.id, is_deleted: false } });
      const payload = {
        batch_id: batch.id,
        input_qty: resolvedInput,
        long_qty,
        medium_qty,
        broken_qty,
        small_broken_qty,
        plant_id: batch.plant_id,
      };

      if (existing) {
        payload.updated_by = req.user ? req.user.id : null;
        await existing.update(payload);
      } else {
        payload.created_by = req.user ? req.user.id : null;
        existing = await LengthGrading.create(payload);
      }

      let log = null;
      if (machine_id) {
        await validateMachine(machine_id);
        log = await MachineLog.create({
          batch_id: batch.id,
          machine_id,
          operator_id: operator_id || (req.user ? req.user.id : null),
          stage: "length_grading",
          start_time,
          end_time,
          running_hours: computeRunningHours(start_time, end_time),
          input_qty: resolvedInput,
          output_qty: totalOutput,
          recovery_pct,
          plant_id: batch.plant_id,
          created_by: req.user ? req.user.id : null,
        });
      }

      // Final stage — batch is now fully processed end to end.
      await batch.update({
        current_stage: "completed",
        batch_status: "completed",
        updated_by: req.user ? req.user.id : null,
      });

      const updated = await ProductionBatch.findByPk(batch.id, { include: detailIncludes });
      res.status(200).json({
        success: true,
        msg: `Length grading recorded (recovery ${recovery_pct}%) — batch ${updated.batch_no} completed`,
        data: { batch: { ...updated.toJSON(), checklist: buildChecklist(updated) }, lengthGrading: existing, machineLog: log },
      });
    } catch (err) {
      next(err);
    }
  },
};
