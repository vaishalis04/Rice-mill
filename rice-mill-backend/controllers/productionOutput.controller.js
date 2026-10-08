const createError = require("http-errors");
const { Op } = require("sequelize");
const sequelize = require("../config/db");
const {
  ProductionBatch, Lot, MaterialMaster, Inventory, Packing, FinishedGoods, WarehouseMaster, RejectMaterial,
} = require("../models/index");
const { generatePackingBatchNo, generateEAN13 } = require("../helpers/helperFunction");
const { KG_PER_QTL } = require("../helpers/units");

// Production OUTPUT + finalize (a separate controller so production.controller.js
// keeps doing exactly what it did for creating / reserving a batch).
//
// The flow:
//   1. Create batch  -> reserves INPUT materials (pack size x bags) in the source
//      warehouse. Status "pending"; stock is not touched yet.   [production.controller.js]
//   2. Finalize      -> THIS FILE. The person enters what the batch actually
//      produced, per input material:
//        - one or more OUTPUT materials (any material — it can even be the same
//          material as the input), each with a bag size, ACCEPTED bags and
//          REJECTED bags
//        - one destination warehouse for everything accepted
//      Rules: per input material, accepted + rejected output can't exceed the
//      input quantity (it can be less — the rest is shrink / loss).
//      On success, in ONE transaction (all or nothing):
//        - the input quantity is deducted from the source warehouse
//        - every output row gets its OWN production lot (parent = the input
//          lot, no purchase, material = the output material, bag size = the
//          output bag size). That is what lets the Inventory, Warehouse and
//          Production screens — which read a stock row's bag size / material
//          through its lot — show Rice 50 kg and Rice 25 kg, or Husk, correctly
//          in the destination warehouse instead of as the input material.
//        - every ACCEPTED output becomes a Packing record + Finished Goods
//          record + an Inventory "fg" row in the destination warehouse
//          (the same records completeAndPack creates)
//        - REJECTED bags are never added to stock (they must not be sellable
//          or usable as input). They are recorded on the output lot
//          (rejected_bags / rejected_qty — the same fields unloading uses), in
//          the reject register (reject_material) and on the batch
//          (outputs_data), and show in Production History and the batch report
//        - the batch becomes "completed"
//
// Quantities: every quantity is in Qtl (1 Qtl = 100 kg), so qty = kg / KG_PER_QTL (helpers/units.js).

const DEFAULT_SHELF_LIFE_DAYS = 180;
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

// Same normalisation production.controller.js uses: a batch's input lines as
// [{ material_id, input_qty, pack_size?, bag_count?, lot_id?, lot_no? }].
const getBatchMaterialLines = (batch) => {
  if (Array.isArray(batch.materials_data) && batch.materials_data.length > 0) {
    return batch.materials_data.map((m) => ({ ...m, material_id: Number(m.material_id), input_qty: Number(m.input_qty) }));
  }
  if (batch.material_id) {
    return [{ material_id: Number(batch.material_id), input_qty: Number(batch.input_qty), lot_id: batch.lot_id, lot_no: null }];
  }
  return [];
};

const ean13CheckDigit = (digits12) => {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += i % 2 === 0 ? Number(digits12[i]) : Number(digits12[i]) * 3;
  const mod = sum % 10;
  return mod === 0 ? 0 : 10 - mod;
};

// The packing batch number and barcode generators in helperFunction.js read
// the last COMMITTED row, so inside one transaction they'd return the same
// value for every output. Ask them once, then count up locally.
const makeSequences = async () => {
  const firstNo = await generatePackingBatchNo(); // e.g. PCK-20261005-004
  const lastDash = firstNo.lastIndexOf("-");
  const prefix = firstNo.slice(0, lastDash + 1);
  const startSeq = parseInt(firstNo.slice(lastDash + 1), 10) || 1;

  const firstBarcode = await generateEAN13(); // 890 + 9-digit seq + check
  const startBarcodeSeq = parseInt(firstBarcode.slice(3, 12), 10) || 1;

  return {
    packingNo: (i) => `${prefix}${String(startSeq + i).padStart(3, "0")}`,
    barcode: (i) => {
      const base12 = `890${String(startBarcodeSeq + i).padStart(9, "0")}`;
      return `${base12}${ean13CheckDigit(base12)}`;
    },
  };
};

// Deducts from the same physical sources Warehouse/Stock displays: raw
// Inventory and non-dispatched FinishedGoods. Legacy Inventory(fg) rows are
// updated as shadows when present, but are never counted as extra stock.
const consumeFromWarehouse = async ({ warehouse_id, material_id, qty, pack_size, userId, t }) => {
  const rawRows = await Inventory.findAll({
    where: { warehouse_id, material_id, is_deleted: false, stage: "raw", balance_qty: { [Op.gt]: 0 } },
    include: [{ model: Lot, as: "lot", attributes: ["id", "bag_size"] }],
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  const fgRows = await FinishedGoods.findAll({
    where: {
      warehouse_id,
      is_deleted: false,
      qty: { [Op.gt]: 0 },
      fg_status: { [Op.ne]: "dispatched" },
    },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  const packingIds = [...new Set(fgRows.map((row) => Number(row.packing_id)).filter(Boolean))];
  const packings = packingIds.length
    ? await Packing.findAll({
        where: { id: { [Op.in]: packingIds }, is_deleted: false },
        attributes: ["id", "lot_id", "material_id", "pack_size"],
        transaction: t,
      })
    : [];
  const packingById = new Map(packings.map((row) => [String(row.id), row]));
  const lotIds = [...new Set(packings.map((row) => Number(row.lot_id)).filter(Boolean))];
  const lots = lotIds.length
    ? await Lot.findAll({
        where: { id: { [Op.in]: lotIds }, is_deleted: false },
        attributes: ["id", "material_id", "bag_size"],
        transaction: t,
      })
    : [];
  const lotById = new Map(lots.map((row) => [String(row.id), row]));
  const rows = rawRows.map((row) => ({
    kind: "raw",
    lot_id: row.lot_id,
    bag_size: row.lot?.bag_size != null ? Number(row.lot.bag_size) : null,
    qty_qtl: Number(row.balance_qty || 0),
    as_of: row.as_of,
    inventory: row,
  }));
  for (const row of fgRows) {
    const packing = packingById.get(String(row.packing_id));
    const lot = packing ? lotById.get(String(packing.lot_id)) : null;
    const rowMaterialId = Number(packing?.material_id || lot?.material_id);
    if (rowMaterialId !== Number(material_id)) continue;
    rows.push({
      kind: "fg",
      lot_id: lot?.id || packing?.lot_id || null,
      bag_size: packing?.pack_size != null ? Number(packing.pack_size) : null,
      qty_qtl: Number(row.qty || 0) / KG_PER_QTL,
      as_of: row.ready_since,
      finishedGoods: row,
    });
  }
  if (rows.length === 0) {
    throw createError(400, `No inventory found for material ${material_id} in the source warehouse`);
  }

  const want = Number(pack_size);
  const rank = (row) => {
    const sizeMatch = want > 0 && Number(row.bag_size) === want ? 0 : 1;
    return sizeMatch;
  };
  rows.sort((a, b) => rank(a) - rank(b) || new Date(a.as_of || 0) - new Date(b.as_of || 0));

  const totalAvailable = rows.reduce((s, r) => s + Number(r.qty_qtl || 0), 0);
  let remaining = Number(qty);
  if (remaining > totalAvailable + 0.001) {
    throw createError(400, `Not enough stock to finalize: material ${material_id} has ${totalAvailable.toFixed(3)} in the source warehouse but this batch needs ${remaining.toFixed(3)}`);
  }

  const lotDrops = new Map();
  for (const row of rows) {
    if (remaining <= 0.001) break;
    const available = Number(row.qty_qtl || 0);
    const take = Math.min(available, remaining);
    if (take <= 0.001) continue;
    if (row.kind === "raw") {
      row.inventory.balance_qty = round3(available - take);
      row.inventory.qty_out = round3(Number(row.inventory.qty_out || 0) + take);
      row.inventory.as_of = new Date();
      row.inventory.updated_by = userId;
      await row.inventory.save({ transaction: t });
    } else {
      const finishedGoods = row.finishedGoods;
      finishedGoods.qty = Math.max(0, round3(Number(finishedGoods.qty || 0) - take * KG_PER_QTL));
      finishedGoods.updated_by = userId;
      await finishedGoods.save({ transaction: t });

      // Keep any historical fg Inventory shadow in sync without using it as
      // the stock source; some existing finished-goods rows have no shadow.
      let shadowRemaining = take;
      const shadowRows = await Inventory.findAll({
        where: {
          warehouse_id,
          material_id,
          lot_id: row.lot_id,
          stage: "fg",
          is_deleted: false,
          balance_qty: { [Op.gt]: 0 },
        },
        order: [["as_of", "ASC"]],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      for (const shadow of shadowRows) {
        if (shadowRemaining <= 0.001) break;
        const shadowTake = Math.min(Number(shadow.balance_qty || 0), shadowRemaining);
        shadow.balance_qty = round3(Number(shadow.balance_qty || 0) - shadowTake);
        shadow.qty_out = round3(Number(shadow.qty_out || 0) + shadowTake);
        shadow.as_of = new Date();
        shadow.updated_by = userId;
        await shadow.save({ transaction: t });
        shadowRemaining -= shadowTake;
      }
    }
    remaining -= take;
    if (row.lot_id) lotDrops.set(row.lot_id, (lotDrops.get(row.lot_id) || 0) + take);
  }
  if (remaining > 0.001) {
    throw createError(400, `Could not deduct the full quantity for material ${material_id} (short by ${remaining.toFixed(3)})`);
  }

  for (const [lotId, drop] of lotDrops) {
    const lot = await Lot.findOne({ where: { id: lotId, is_deleted: false }, transaction: t, lock: t.LOCK.UPDATE });
    if (lot) await lot.update({ qty: Math.max(0, round3(Number(lot.qty || 0) - drop)), updated_by: userId }, { transaction: t });
  }
};

module.exports = {
  // PATCH /api/production/batches/:id/finalize
  // {
  //   destination_warehouse_id,
  //   outputs: [{ source_index?, material_id, pack_size, accepted_bags, rejected_bags?, remark? }],
  //   rack_id?, pallet_id?, production_date?, shelf_life_days?, plant_id?
  // }
  // source_index = position of the input line (in the batch's materials) the
  // output comes from; optional when the batch has a single input line.
  finalize: async (req, res, next) => {
    let t;
    try {
      const { destination_warehouse_id, outputs, rack_id, pallet_id, production_date, shelf_life_days, plant_id } = req.body || {};
      const userId = req.user ? req.user.id : null;

      // ---------- cheap validation first (no DB locks yet) ----------
      if (!destination_warehouse_id) throw createError(400, "Select the destination warehouse for the output");
      if (!Array.isArray(outputs) || outputs.length === 0) throw createError(400, "Add at least one output material");

      const warehouse = await WarehouseMaster.findOne({ where: { id: Number(destination_warehouse_id), is_deleted: false } });
      if (!warehouse) throw createError(400, "Invalid destination warehouse");

      t = await sequelize.transaction();

      const batch = await ProductionBatch.findOne({
        where: { id: req.params.id, is_deleted: false },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!batch) throw createError(404, "Production batch not found");
      if (batch.batch_status === "completed") throw createError(400, "This batch is already completed");

      const lines = getBatchMaterialLines(batch);
      if (lines.length === 0) throw createError(400, "This batch has no input materials");

      // ---------- normalise + validate outputs ----------
      const wanted = outputs.map((o, i) => {
        const sourceIndex = o.source_index !== undefined && o.source_index !== null && o.source_index !== ""
          ? Number(o.source_index)
          : lines.length === 1 ? 0 : NaN;
        return {
          row: i + 1,
          source_index: sourceIndex,
          material_id: Number(o.material_id),
          pack_size: Number(o.pack_size),
          accepted_bags: Number(o.accepted_bags || 0),
          rejected_bags: Number(o.rejected_bags || 0),
          remark: o.remark ? String(o.remark).trim().slice(0, 200) : "",
        };
      });

      for (const o of wanted) {
        if (!Number.isInteger(o.source_index) || o.source_index < 0 || o.source_index >= lines.length) {
          throw createError(400, `Output row ${o.row}: choose which input material it comes from`);
        }
        if (!o.material_id) throw createError(400, `Output row ${o.row}: select the output material`);
        if (!(o.pack_size > 0)) throw createError(400, `Output row ${o.row}: bag size must be greater than 0`);
        if (!Number.isInteger(o.accepted_bags) || o.accepted_bags < 0 || !Number.isInteger(o.rejected_bags) || o.rejected_bags < 0) {
          throw createError(400, `Output row ${o.row}: bags must be whole numbers, 0 or more`);
        }
        if (o.accepted_bags + o.rejected_bags <= 0) {
          throw createError(400, `Output row ${o.row}: enter accepted and/or rejected bags`);
        }
      }

      const materialIds = [...new Set(wanted.map((o) => o.material_id))];
      const materialRows = await MaterialMaster.findAll({ where: { id: { [Op.in]: materialIds }, is_deleted: false }, attributes: ["id", "name"], transaction: t });
      const materialName = new Map(materialRows.map((m) => [Number(m.id), m.name]));
      for (const o of wanted) {
        if (!materialName.has(o.material_id)) throw createError(400, `Output row ${o.row}: that material doesn't exist`);
      }

      // per input line: accepted + rejected must fit inside the input quantity
      const lineSummaries = [];
      for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx];
        const mine = wanted.filter((o) => o.source_index === idx);
        const name = (await MaterialMaster.findByPk(line.material_id, { attributes: ["name"], transaction: t }))?.name || `Material ${line.material_id}`;
        if (mine.length === 0) throw createError(400, `Add at least one output for ${name} (input ${round3(line.input_qty).toFixed(3)} Qtl)`);

        const inputKg = Number(line.input_qty) * KG_PER_QTL;
        const acceptedKg = mine.reduce((s, o) => s + o.accepted_bags * o.pack_size, 0);
        const rejectedKg = mine.reduce((s, o) => s + o.rejected_bags * o.pack_size, 0);
        if (acceptedKg + rejectedKg > inputKg + 0.5) {
          throw createError(
            400,
            `${name}: output ${round3((acceptedKg + rejectedKg) / KG_PER_QTL).toFixed(3)} Qtl (accepted + rejected) is more than the ${round3(inputKg / KG_PER_QTL).toFixed(3)} Qtl used as input`
          );
        }
        lineSummaries.push({ idx, name, inputKg, acceptedKg, rejectedKg });
      }

      const totalAcceptedKg = wanted.reduce((s, o) => s + o.accepted_bags * o.pack_size, 0);

      // ---------- 1) deduct the INPUT from the source warehouse ----------
      for (const line of lines) {
        await consumeFromWarehouse({
          warehouse_id: batch.warehouse_id,
          material_id: Number(line.material_id),
          qty: Number(line.input_qty),
          pack_size: line.pack_size,
          userId,
          t,
        });
      }

      // ---------- 2) accepted output -> Packing + Finished Goods + Inventory(fg) ----------
      const resolvedDate = production_date || batch.production_date || new Date().toISOString().slice(0, 10);
      const shelfDays = shelf_life_days !== undefined && shelf_life_days !== "" ? Number(shelf_life_days) : DEFAULT_SHELF_LIFE_DAYS;
      const expiry = new Date(resolvedDate);
      expiry.setDate(expiry.getDate() + shelfDays);
      const expiryStr = expiry.toISOString().slice(0, 10);
      const resolvedPlantId = plant_id || batch.plant_id;
      const seq = await makeSequences();

      // One production lot per output row (accepted and/or rejected).
      const outLots = new Map();
      for (let i = 0; i < wanted.length; i += 1) {
        const o = wanted[i];
        const lot = await Lot.create(
          {
            lot_no: `${batch.batch_no}-O${i + 1}`,
            purchase_id: null,
            material_id: o.material_id,
            qty: round3((o.accepted_bags * o.pack_size) / KG_PER_QTL),
            parent_lot_id: lines[o.source_index].lot_id || null,
            destination: "warehouse",
            warehouse_id: Number(destination_warehouse_id),
            unloading_status: "completed",
            bag_size: o.pack_size,
            accepted_bags: o.accepted_bags,
            rejected_bags: o.rejected_bags,
            rejected_qty: round3((o.rejected_bags * o.pack_size) / KG_PER_QTL),
            plant_id: resolvedPlantId,
            created_by: userId,
          },
          { transaction: t }
        );
        outLots.set(o.row, lot);
      }

      const accepted = wanted.filter((o) => o.accepted_bags > 0);
      const packings = [];
      for (let i = 0; i < accepted.length; i += 1) {
        const o = accepted[i];
        const line = lines[o.source_index];
        const qtyKg = o.pack_size * o.accepted_bags;
        const qtyQtl = qtyKg / KG_PER_QTL;
        const packingNo = seq.packingNo(i);
        const outLot = outLots.get(o.row);

        const packing = await Packing.create(
          {
            batch_id: batch.id,
            lot_id: outLot.id,
            material_id: o.material_id,
            pack_size: o.pack_size,
            bag_count: o.accepted_bags,
            batch_no: packingNo,
            barcode: seq.barcode(i),
            qr_code: JSON.stringify({ batch_no: packingNo, production_batch_no: batch.batch_no, production_date: resolvedDate }),
            production_date: resolvedDate,
            expiry_date: expiryStr,
            packed_by: userId,
            plant_id: resolvedPlantId,
            created_by: userId,
          },
          { transaction: t }
        );
        const fg = await FinishedGoods.create(
          {
            packing_id: packing.id,
            warehouse_id: Number(destination_warehouse_id),
            rack_id: rack_id || null,
            pallet_id: pallet_id || null,
            qty: qtyKg,
            fg_status: "ready",
            ready_since: new Date(),
            plant_id: resolvedPlantId,
            created_by: userId,
          },
          { transaction: t }
        );
        await Inventory.create(
          {
            lot_id: outLot.id,
            material_id: o.material_id,
            warehouse_id: Number(destination_warehouse_id),
            stage: "fg",
            qty_in: qtyQtl,
            qty_out: 0,
            balance_qty: qtyQtl,
            as_of: new Date(),
            plant_id: resolvedPlantId,
            created_by: userId,
          },
          { transaction: t }
        );
        packings.push({ packing_id: packing.id, finished_goods_id: fg.id, material_id: o.material_id, qty_kg: qtyKg });
      }

      // ---------- rejected quantity -> reject register (no stock) ----------
      for (const o of wanted.filter((x) => x.rejected_bags > 0)) {
        await RejectMaterial.create(
          {
            source_stage: "production",
            batch_id: batch.id,
            qty: round3((o.rejected_bags * o.pack_size) / KG_PER_QTL),
            plant_id: resolvedPlantId,
            created_by: userId,
          },
          { transaction: t }
        );
      }

      // ---------- 3) record what was produced (incl. rejected) and complete ----------
      const outputsData = {
        destination_warehouse_id: Number(destination_warehouse_id),
        finalized_at: new Date().toISOString(),
        lines: lineSummaries.map((s) => ({
          source_index: s.idx,
          input_material_id: lines[s.idx].material_id,
          input_qty: round3(s.inputKg / KG_PER_QTL),
          accepted_qty: round3(s.acceptedKg / KG_PER_QTL),
          rejected_qty: round3(s.rejectedKg / KG_PER_QTL),
          loss_qty: round3((s.inputKg - s.acceptedKg - s.rejectedKg) / KG_PER_QTL),
        })),
        outputs: wanted.map((o) => ({
          source_index: o.source_index,
          lot_id: outLots.get(o.row).id,
          lot_no: outLots.get(o.row).lot_no,
          material_id: o.material_id,
          material_name: materialName.get(o.material_id),
          pack_size: o.pack_size,
          accepted_bags: o.accepted_bags,
          rejected_bags: o.rejected_bags,
          accepted_qty: round3((o.accepted_bags * o.pack_size) / KG_PER_QTL),
          rejected_qty: round3((o.rejected_bags * o.pack_size) / KG_PER_QTL),
          remark: o.remark,
        })),
      };
      await batch.update(
        {
          batch_status: "completed",
          current_stage: "completed",
          destination_warehouse_id: Number(destination_warehouse_id),
          outputs_data: outputsData,
          updated_by: userId,
        },
        { transaction: t }
      );

      await t.commit();
      t = null;

      const totalInputKg = lineSummaries.reduce((s, x) => s + x.inputKg, 0);
      const totalRejectedKg = lineSummaries.reduce((s, x) => s + x.rejectedKg, 0);
      res.status(200).json({
        success: true,
        msg:
          `Batch ${batch.batch_no} completed. ${round3(totalAcceptedKg / KG_PER_QTL).toFixed(3)} Qtl added to ${warehouse.name}` +
          (totalRejectedKg > 0 ? `, ${round3(totalRejectedKg / KG_PER_QTL).toFixed(3)} Qtl rejected` : "") +
          `, from ${round3(totalInputKg / KG_PER_QTL).toFixed(3)} Qtl of input.`,
        data: {
          batch_id: batch.id,
          batch_no: batch.batch_no,
          batch_status: "completed",
          total_input_Qtl: round3(totalInputKg / KG_PER_QTL),
          total_accepted_Qtl: round3(totalAcceptedKg / KG_PER_QTL),
          total_rejected_Qtl: round3(totalRejectedKg / KG_PER_QTL),
          packings,
          outputs_data: outputsData,
        },
      });
    } catch (err) {
      if (t) {
        try {
          await t.rollback();
        } catch {
          /* already finished */
        }
      }
      next(err);
    }
  },
};
