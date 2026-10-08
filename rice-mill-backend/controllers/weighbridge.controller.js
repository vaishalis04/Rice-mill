const createError = require("http-errors");
const { Op } = require("sequelize");
const sequelize = require("../config/db");
const { WeightSlip, GateEntry, Purchase, PurchaseOrder, User, Vendor, Customer, Vehicle, MaterialMaster, SalesOrder, Loading, GateEntryPurchaseOrder, Lot } = require("../models/index");
const { kgToQtl, SCALE_TOLERANCE_QTL } = require("../helpers/units");
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
// The scale may read this many Qtl more or less than the recorded load / unload (helpers/units.js).
const MAX_SCALE_ADJUSTMENT_QTL = SCALE_TOLERANCE_QTL;
const parseJsonArray = (value) => {
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

// Reconcile the estimated bag quantity for this truck against the scale.
// The difference is distributed over the materials in the same proportions
// as the recorded loading, and may not exceed the operator's +/- tolerance
// (SCALE_TOLERANCE_QTL) or push any SO line outside its ordered quantity.
// Every read / write here runs inside `transaction`, so if any check fails
// nothing is saved (no half-updated slip, sales order or loading).
const reconcileSalesLoading = async ({ gateEntryId, actualQtyQtl, userId, transaction }) => {
  const loadingRows = await Loading.findAll({
    where: { gate_entry_id: gateEntryId, is_deleted: false },
    order: [["id", "ASC"]],
    transaction,
  });
  const totals = new Map();
  let expected = 0;
  for (const loading of loadingRows) {
    for (const line of parseJsonArray(loading.items)) {
      const soId = Number(line.so_id || loading.so_id);
      const materialId = Number(line.material_id);
      const qty = Number(line.qty || 0);
      if (!soId || !materialId || qty <= 0) continue;
      const key = `${soId}:${materialId}`;
      const item = totals.get(key) || { so_id: soId, material_id: materialId, qty: 0 };
      item.qty = round3(item.qty + qty);
      totals.set(key, item);
      expected = round3(expected + qty);
    }
  }
  if (expected <= 0) throw createError(400, "Record a loading before entering the second weighment");

  const difference = round3(actualQtyQtl - expected);
  if (Math.abs(difference) > MAX_SCALE_ADJUSTMENT_QTL) {
    throw createError(400, `Scale quantity (${round3(actualQtyQtl)} Qtl) differs from the recorded load (${expected} Qtl) by ${difference.toFixed(3)} Qtl; the allowed range is -${MAX_SCALE_ADJUSTMENT_QTL} to +${MAX_SCALE_ADJUSTMENT_QTL} Qtl.`);
  }

  let allocated = 0;
  const adjustments = [...totals.values()];
  adjustments.forEach((line, index) => {
    const target = index === adjustments.length - 1
      ? round3(actualQtyQtl - allocated)
      : round3(actualQtyQtl * line.qty / expected);
    line.adjustment = round3(target - line.qty);
    line.actual_qty = target;
    allocated = round3(allocated + target);
  });

  const bySo = new Map();
  adjustments.forEach((line) => {
    const group = bySo.get(line.so_id) || [];
    group.push(line);
    bySo.set(line.so_id, group);
  });
  for (const [soId, lines] of bySo) {
    const so = await SalesOrder.findOne({ where: { id: soId, is_deleted: false }, transaction });
    if (!so) throw createError(404, `Sales Order ${soId} was not found during weighbridge reconciliation`);
    const items = parseJsonArray(so.items);
    for (const line of lines) {
      const item = items.find((candidate) => Number(candidate.material_id) === line.material_id);
      if (!item) throw createError(400, `Material ${line.material_id} is missing from Sales Order ${so.so_no}`);
      const newDispatched = round3(Number(item.dispatched_qty || 0) + line.adjustment);
      const ordered = Number(item.qty || 0);
      if (newDispatched < -0.001 || newDispatched > ordered + 0.001) {
        throw createError(400, `The +/- ${MAX_SCALE_ADJUSTMENT_QTL} Qtl weighbridge adjustment would put ${so.so_no} material ${line.material_id} outside its ordered quantity.`);
      }
      item.dispatched_qty = Math.min(ordered, Math.max(0, newDispatched));
    }
    const totalDispatched = round3(items.reduce((sum, item) => sum + Number(item.dispatched_qty || 0), 0));
    const complete = items.every((item) => Number(item.qty || 0) - Number(item.dispatched_qty || 0) <= 0.001);
    await so.update({
      items,
      dispatched_qty: totalDispatched,
      so_status: complete ? "dispatched" : "allocated",
      updated_by: userId,
    }, { transaction });
  }

  // Keep the trip's loading records consistent with the corrected SO totals.
  for (const loading of loadingRows) {
    const lines = parseJsonArray(loading.items);
    const adjustedLines = lines.map((line) => {
      const key = `${Number(line.so_id || loading.so_id)}:${Number(line.material_id)}`;
      const total = totals.get(key);
      if (!total) return line;
      const ratio = total.actual_qty / total.qty;
      return { ...line, qty: round3(Number(line.qty || 0) * ratio) };
    });
    const loadedQty = round3(adjustedLines.reduce((sum, line) => sum + Number(line.qty || 0), 0));
    await loading.update({
      items: adjustedLines,
      loaded_qty: loadedQty,
      updated_by: userId,
    }, { transaction });
  }

  return { expected_qty: expected, actual_qty: round3(actualQtyQtl), adjustment: difference };
};

const reconcilePurchaseUnloading = async ({ gateEntry, purchase, actualQtyQtl, userId, transaction }) => {
  const lots = await Lot.findAll({
    where: { purchase_id: purchase.id, is_deleted: false, unloading_status: "completed" },
    transaction,
  });
  if (lots.length === 0) throw createError(400, "Complete unloading before recording the second weighment");

  const qtyByMaterial = new Map();
  for (const lot of lots) {
    const materialId = Number(lot.material_id);
    const qty = round3(Number(lot.qty || 0) + Number(lot.rejected_qty || 0));
    qtyByMaterial.set(materialId, round3((qtyByMaterial.get(materialId) || 0) + qty));
  }
  const expected = round3([...qtyByMaterial.values()].reduce((sum, qty) => sum + qty, 0));
  const difference = round3(Number(actualQtyQtl) - expected);
  if (Math.abs(difference) > MAX_SCALE_ADJUSTMENT_QTL) {
    throw createError(400, `Scale quantity (${round3(actualQtyQtl)} Qtl) differs from the unloaded quantity (${expected} Qtl) by ${difference.toFixed(3)} Qtl; the allowed range is -${MAX_SCALE_ADJUSTMENT_QTL} to +${MAX_SCALE_ADJUSTMENT_QTL} Qtl.`);
  }

  let links = await GateEntryPurchaseOrder.findAll({
    where: { gate_entry_id: gateEntry.id, is_deleted: false },
    transaction,
  });
  if (links.length === 0 && gateEntry.po_id && gateEntry.material_id) {
    links = [{
      po_id: gateEntry.po_id,
      material_id: Number(gateEntry.material_id),
      qty: qtyByMaterial.get(Number(gateEntry.material_id)) || 0,
    }];
  }

  const linksByMaterial = new Map();
  for (const link of links) {
    const materialId = Number(link.material_id);
    const list = linksByMaterial.get(materialId) || [];
    list.push(link);
    linksByMaterial.set(materialId, list);
  }
  const allocations = [];
  const materialRows = [...qtyByMaterial.entries()];
  let allocatedTotal = 0;
  materialRows.forEach(([materialId, qty], index) => {
    const materialAllocation = index === materialRows.length - 1
      ? round3(Number(actualQtyQtl) - allocatedTotal)
      : expected > 0 ? round3(Number(actualQtyQtl) * qty / expected) : 0;
    allocatedTotal = round3(allocatedTotal + materialAllocation);
    const materialLinks = linksByMaterial.get(materialId) || [];
    // A material discovered during unloading may not be a PO line. It is
    // still a valid physical receipt, but must not consume another PO item's
    // remaining quantity.
    if (!materialLinks.length) return;
    const assignedTotal = materialLinks.reduce((sum, link) => sum + Number(link.qty || 0), 0);
    let linkAllocated = 0;
    materialLinks.forEach((link, linkIndex) => {
      const qtyForLink = linkIndex === materialLinks.length - 1
        ? round3(materialAllocation - linkAllocated)
        : assignedTotal > 0 ? round3(materialAllocation * Number(link.qty || 0) / assignedTotal) : 0;
      linkAllocated = round3(linkAllocated + qtyForLink);
      allocations.push({ po_id: Number(link.po_id), material_id: materialId, qty: qtyForLink });
    });
  });

  const poIds = [...new Set(allocations.map((line) => line.po_id))];
  const completedPurchases = poIds.length
    ? await Purchase.findAll({
        where: { po_id: { [Op.in]: poIds }, id: { [Op.ne]: purchase.id }, is_deleted: false },
        attributes: ["id", "po_id"],
        include: [{
          model: GateEntry,
          as: "gateEntry",
          attributes: ["id"],
          where: { is_deleted: false, gate_status: "exited" },
          required: true,
        }],
        transaction,
      })
    : [];
  const purchaseIds = completedPurchases.map((row) => Number(row.id));
  const historicalLots = purchaseIds.length
    ? await Lot.findAll({ where: { purchase_id: { [Op.in]: purchaseIds }, is_deleted: false, unloading_status: "completed" }, transaction })
    : [];
  const historicByOrderLine = new Map();
  for (const lot of historicalLots) {
    const purchaseRow = completedPurchases.find((row) => Number(row.id) === Number(lot.purchase_id));
    if (!purchaseRow) continue;
    const key = `${purchaseRow.po_id}:${lot.material_id}`;
    historicByOrderLine.set(key, round3((historicByOrderLine.get(key) || 0) + Number(lot.qty || 0) + Number(lot.rejected_qty || 0)));
  }

  const activeEntries = await GateEntry.findAll({
    where: {
      is_deleted: false,
      gate_status: { [Op.notIn]: ["exited", "parked"] },
      id: { [Op.ne]: gateEntry.id },
    },
    attributes: ["id"],
    transaction,
  });
  const activeEntryIds = activeEntries.map((row) => Number(row.id));
  const reservedRows = activeEntryIds.length
    ? await GateEntryPurchaseOrder.findAll({
        where: { gate_entry_id: { [Op.in]: activeEntryIds }, po_id: { [Op.in]: poIds }, is_deleted: false },
        transaction,
      })
    : [];

  const poUpdates = new Map();
  for (const allocation of allocations) {
    if (!poUpdates.has(allocation.po_id)) {
      const po = await PurchaseOrder.findOne({ where: { id: allocation.po_id, is_deleted: false }, transaction });
      if (!po) throw createError(404, `Purchase Order ${allocation.po_id} was not found`);
      const items = parseJsonArray(po.items);
      poUpdates.set(allocation.po_id, { po, items });
    }
    const { po, items } = poUpdates.get(allocation.po_id);
    const item = items.find((candidate) => Number(candidate.material_id) === allocation.material_id);
    if (!item) throw createError(400, `Material ${allocation.material_id} is missing from Purchase Order ${po.po_no}`);

    const key = `${allocation.po_id}:${allocation.material_id}`;
    const received = item.received_qty == null
      ? historicByOrderLine.get(key) || 0
      : Number(item.received_qty || 0);
    const reserved = reservedRows
      .filter((row) => Number(row.po_id) === allocation.po_id && Number(row.material_id) === allocation.material_id)
      .reduce((sum, row) => sum + Number(row.qty || 0), 0);
    const ordered = Number(item.qty || 0);
    const nextReceived = round3(received + allocation.qty);
    if (nextReceived + reserved > ordered + 0.001) {
      throw createError(400, `Second weighment would exceed remaining PO quantity for ${po.po_no}, material ${allocation.material_id}.`);
    }
    item.received_qty = nextReceived;
  }

  for (const { po, items } of poUpdates.values()) {
    await po.update({ items, updated_by: userId }, { transaction });
  }
  return { expected_qty: expected, actual_qty: round3(actualQtyQtl), adjustment: difference };
};

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
// Weights on the slip are kg (what the scale reads); quantities derived from
// them (Purchase.final_qty, the +/- tolerance check) are Qtl (1 Qtl = 100 kg).

const detailIncludes = [
  {
    model: GateEntry,
    as: "gateEntry",
    // vendor/customer/vehicle/PO/SO/material nested here so WeightSlipsPage's
    // list can show "Vendor/Customer Name", "PO/SO No.", "Vehicle No." and
    // "Materials" instead of a bare numeric gate_entry_id.
    attributes: ["id", "token_no", "gate_status", "entry_type", "po_id", "so_id", "vendor_id", "customer_id", "vehicle_id", "material_id", "expected_qty"],
    include: [
      { model: Vendor, as: "vendor", attributes: ["id", "name", "vendor_code"] },
      { model: Customer, as: "customer", attributes: ["id", "name", "customer_code"] },
      { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
      { model: PurchaseOrder, as: "purchaseOrder", attributes: ["id", "po_no"] },
      { model: SalesOrder, as: "salesOrder", attributes: ["id", "so_no"] },
      { model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name"] },
    ],
  },
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

      const gateEntryIds = [...new Set(rows.map((row) => Number(row.gate_entry_id)).filter(Boolean))];
      const [loadings, purchases] = await Promise.all([
        gateEntryIds.length ? Loading.findAll({ where: { gate_entry_id: { [Op.in]: gateEntryIds }, is_deleted: false }, attributes: ["gate_entry_id", "loaded_qty"] }) : [],
        gateEntryIds.length ? Purchase.findAll({ where: { gate_entry_id: { [Op.in]: gateEntryIds }, is_deleted: false }, attributes: ["id", "gate_entry_id"] }) : [],
      ]);
      const purchaseIds = purchases.map((row) => Number(row.id));
      const unloadedLots = purchaseIds.length
        ? await Lot.findAll({ where: { purchase_id: { [Op.in]: purchaseIds }, is_deleted: false, unloading_status: "completed" }, attributes: ["purchase_id", "qty", "rejected_qty"] })
        : [];
      const purchaseById = new Map(purchases.map((row) => [Number(row.id), Number(row.gate_entry_id)]));
      const tripActivity = new Map();
      for (const row of loadings) {
        const entryId = Number(row.gate_entry_id);
        const entry = tripActivity.get(entryId) || { loaded_qty: 0, unloaded_qty: 0 };
        entry.loaded_qty = round3(entry.loaded_qty + Number(row.loaded_qty || 0));
        tripActivity.set(entryId, entry);
      }
      for (const lot of unloadedLots) {
        const entryId = purchaseById.get(Number(lot.purchase_id));
        if (!entryId) continue;
        const entry = tripActivity.get(entryId) || { loaded_qty: 0, unloaded_qty: 0 };
        entry.unloaded_qty = round3(entry.unloaded_qty + Number(lot.qty || 0) + Number(lot.rejected_qty || 0));
        tripActivity.set(entryId, entry);
      }

      res.status(200).json({
        success: true,
        data: rows.map((row) => ({
          ...row.toJSON(),
          trip_activity: {
            expected_qty: Number(row.gateEntry?.expected_qty || 0),
            loaded_qty: tripActivity.get(Number(row.gate_entry_id))?.loaded_qty || 0,
            unloaded_qty: tripActivity.get(Number(row.gate_entry_id))?.unloaded_qty || 0,
          },
        })),
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

  create: async (req, res, next) => {
    try {
      const {
        gate_entry_id,
        slip_no,
        gross_weight,
        tare_weight,
        weighed_at,
        final_rate,
        plant_id,
      } = req.body;

      // --- VALIDATION ---
      if (!gate_entry_id || !slip_no || gross_weight === undefined) {
        throw createError(400, "gate_entry_id, slip_no and gross_weight are required");
      }

      const currentWeight = Number(gross_weight);
      if (isNaN(currentWeight) || currentWeight <= 0) {
        throw createError(400, "gross_weight must be a valid positive number");
      }

      // --- GET GATE ENTRY ---
      let gateEntry;
      try {
        gateEntry = await GateEntry.findOne({
          where: { id: gate_entry_id, is_deleted: false },
          include: [
            { association: "purchase_orders", required: false },
          ],
        });
      } catch (assocError) {
        gateEntry = await GateEntry.findOne({
          where: { id: gate_entry_id, is_deleted: false },
        });
      }

      if (!gateEntry) {
        throw createError(400, "Invalid gate_entry_id");
      }

      const entryType = gateEntry.entry_type;
      const isSalesEntry = entryType === "sales";
      const isPurchaseEntry = entryType === "purchase";
      const isOtherEntry = entryType === "other";

      // --- CHECK FOR EXISTING SLIPS ---
      const existingSlips = await WeightSlip.findAll({
        where: { gate_entry_id, is_deleted: false },
        order: [["id", "ASC"]],
      });

      const hasFirstWeight = existingSlips.some((slip) => slip.tare_weight == null);
      const isSecondWeight = hasFirstWeight && (tare_weight !== undefined && tare_weight !== null);
      if (!hasFirstWeight && tare_weight !== undefined && tare_weight !== null) {
        throw createError(400, "Record the first weighment first; record the second weighment after loading or unloading is complete.");
      }

      // --- STATUS VALIDATION ---
      if (isSalesEntry) {
        if (!hasFirstWeight && gateEntry.gate_status !== "waiting_weighment") {
          throw createError(
            400,
            `Sales entry must be in 'waiting_weighment' for first weight. Current status: '${gateEntry.gate_status}'`
          );
        }
        if (hasFirstWeight && gateEntry.gate_status === "waiting_loading") {
          throw createError(
            400,
            "Second weight isn't allowed yet — this truck isn't fully loaded. Complete loading of the whole Sales Order first (Warehouse > Loading)."
          );
        }
        if (hasFirstWeight && gateEntry.gate_status !== "waiting_second_weighment") {
          throw createError(
            400,
            `Sales entry must be in 'waiting_second_weighment' for second weight. Current status: '${gateEntry.gate_status}'`
          );
        }
      } else if (isPurchaseEntry) {
        if (!hasFirstWeight && gateEntry.gate_status !== "accepted") {
          throw createError(
            400,
            `Purchase entry must be in 'accepted' for first weight. Current status: '${gateEntry.gate_status}'`
          );
        }
        if (hasFirstWeight && gateEntry.gate_status !== "waiting_second_weighment") {
          throw createError(
            400,
            `Purchase entry must be in 'waiting_second_weighment' for second weight. Current status: '${gateEntry.gate_status}'`
          );
        }
      } else if (isOtherEntry) {
        if (!hasFirstWeight && gateEntry.gate_status !== "waiting_weighment") {
          throw createError(
            400,
            `Other entry must be in 'waiting_weighment' for first weight. Current status: '${gateEntry.gate_status}'`
          );
        }
        if (hasFirstWeight && gateEntry.gate_status !== "waiting_second_weighment") {
          throw createError(
            400,
            `Other entry must be in 'waiting_second_weighment' for second weight. Current status: '${gateEntry.gate_status}'`
          );
        }
      }

      if (!hasFirstWeight && tare_weight !== undefined && tare_weight !== null && (isPurchaseEntry || isSalesEntry)) {
        throw createError(400, "Purchase and Sales trucks must be weighed in first, then unloaded/loaded, and weighed out in a separate second-weighment step.");
      }

      // =========================================================
      // SECOND WEIGHT FLOW - UPDATE EXISTING SLIP
      // Runs in ONE transaction: the slip, the purchase, the SO / PO
      // balances, the loading records and the gate status are saved
      // together or not at all. (Before, the slip was saved first and a
      // later +/- tolerance failure left it half-done, so the next try
      // said "Record the first weighment first".)
      // =========================================================
      if (isSecondWeight) {
        const firstSlip = existingSlips[0];
        const firstWeight = Number(firstSlip.gross_weight);
        const netWeight = Math.max(isPurchaseEntry ? firstWeight - currentWeight : currentWeight - firstWeight, 0);
        const netQtl = kgToQtl(netWeight);
        const userId = req.user ? req.user.id : null;

        let purchase = null;
        let salesOrder = null;
        let resolvedRate = null;
        let salesReconciliation = null;
        let purchaseReconciliation = null;

        const t = await sequelize.transaction();
        try {
          // UPDATE THE EXISTING SLIP with second weight data
          await firstSlip.update({
            gross_weight: isPurchaseEntry ? firstWeight : currentWeight,
            tare_weight: isPurchaseEntry ? currentWeight : firstWeight,
            weighed_at: weighed_at || new Date(),
            updated_by: userId,
            updated_at: new Date(),
          }, { transaction: t });

          // --- HANDLE PURCHASE OR SALES ---
          if (isPurchaseEntry) {
            // Get PO
            let po = null;

            if (gateEntry.po_id) {
              po = await PurchaseOrder.findOne({
                where: { id: gateEntry.po_id, is_deleted: false },
                transaction: t,
              });
            } else {
              const poItems = await GateEntryPurchaseOrder.findAll({
                where: { gate_entry_id: gateEntry.id, is_deleted: false },
                transaction: t,
              });
              if (poItems && poItems.length > 0) {
                po = await PurchaseOrder.findOne({
                  where: { id: poItems[0].po_id, is_deleted: false },
                  transaction: t,
                });
              } else {
                const existingPurchaseForPo = await Purchase.findOne({
                  where: { gate_entry_id: gateEntry.id, is_deleted: false },
                  transaction: t,
                });
                if (existingPurchaseForPo) {
                  po = await PurchaseOrder.findOne({
                    where: { id: existingPurchaseForPo.po_id, is_deleted: false },
                    transaction: t,
                  });
                }
              }
            }

            resolvedRate = po ? Number(po.rate) : (final_rate !== undefined ? Number(final_rate) : null);

            if (resolvedRate == null) {
              throw createError(400, "Rate is required for purchase entry. Please provide final_rate or ensure PO has rate.");
            }

            // Check if purchase already exists
            const existingPurchase = await Purchase.findOne({
              where: { weight_slip_id: firstSlip.id, is_deleted: false },
              transaction: t,
            });

            if (existingPurchase) {
              await existingPurchase.update({
                final_rate: resolvedRate,
                final_qty: netQtl,
                amount: netQtl * resolvedRate,
                updated_by: userId,
              }, { transaction: t });
              purchase = existingPurchase;
            } else {
              purchase = await Purchase.create({
                po_id: po ? po.id : null,
                gate_entry_id,
                weight_slip_id: firstSlip.id,
                final_rate: resolvedRate,
                final_qty: netQtl,
                amount: netQtl * resolvedRate,
                purchase_date: new Date().toISOString().slice(0, 10),
                plant_id: firstSlip.plant_id,
                created_by: userId,
              }, { transaction: t });
            }
          }

          if (isSalesEntry) {
            if (gateEntry.so_id) {
              salesOrder = await SalesOrder.findOne({
                where: { id: gateEntry.so_id, is_deleted: false },
                transaction: t,
              });
            }

            if (!salesOrder) {
              const { GateEntrySalesOrder } = require("../models");
              const soItem = await GateEntrySalesOrder.findOne({
                where: { gate_entry_id: gateEntry.id, is_deleted: false },
                transaction: t,
              });
              if (soItem) {
                salesOrder = await SalesOrder.findOne({
                  where: { id: soItem.so_id, is_deleted: false },
                  transaction: t,
                });
              }
            }

            resolvedRate = salesOrder?.rate !== undefined ? Number(salesOrder.rate) : (final_rate !== undefined ? Number(final_rate) : null);

            salesReconciliation = await reconcileSalesLoading({
              gateEntryId: gateEntry.id,
              actualQtyQtl: netQtl,
              userId,
              transaction: t,
            });
          }

          if (isPurchaseEntry) {
            purchaseReconciliation = await reconcilePurchaseUnloading({
              gateEntry,
              purchase,
              actualQtyQtl: netQtl,
              userId,
              transaction: t,
            });
          }

          // --- UPDATE GATE ENTRY TO parked ---
          await gateEntry.update({
            gate_status: "parked",
            updated_by: userId,
          }, { transaction: t });

          await t.commit();
        } catch (txErr) {
          await t.rollback();
          throw txErr;
        }

        const updated = await WeightSlip.findByPk(firstSlip.id, {
          include: detailIncludes,
        });

        let msg = `Second weight recorded. First: ${firstWeight}, Second: ${currentWeight}, Net: ${netWeight} kg (${netQtl.toFixed(3)} Qtl)`;
        if (salesReconciliation) {
          msg += `; SO quantities adjusted by ${salesReconciliation.adjustment.toFixed(3)} Qtl (allowed -${MAX_SCALE_ADJUSTMENT_QTL} to +${MAX_SCALE_ADJUSTMENT_QTL} Qtl).`;
        }
        if (purchaseReconciliation) {
          msg += `; PO received balances adjusted by ${purchaseReconciliation.adjustment.toFixed(3)} Qtl (allowed -${MAX_SCALE_ADJUSTMENT_QTL} to +${MAX_SCALE_ADJUSTMENT_QTL} Qtl).`;
        }
        if (isPurchaseEntry) {
          msg += ` Purchase finalized.`;
        } else if (isSalesEntry) {
          msg += ` Sales order completed.`;
        } else {
          msg += ` Gate entry parked.`;
        }

        return res.status(200).json({
          success: true,
          msg,
          data: {
            weightSlip: updated,
            purchase,
            salesOrder,
            first_weight: firstWeight,
            second_weight: currentWeight,
            net_weight: netWeight,
            net_qty_qtl: netQtl,
            sales_reconciliation: salesReconciliation,
            purchase_reconciliation: purchaseReconciliation,
            final_rate: resolvedRate,
            amount: resolvedRate !== null ? netQtl * resolvedRate : null,
            gate_status: "parked",
            isSecondWeight: true,
            updated: true,
          },
        });
      }

      // =========================================================
      // FIRST WEIGHT FLOW (no tare_weight provided)
      // =========================================================
      if (!hasFirstWeight && (tare_weight === undefined || tare_weight === null)) {
        // Create first weight slip
        const slip = await WeightSlip.create({
          gate_entry_id,
          slip_no,
          gross_weight: currentWeight,
          tare_weight: null,
          weighed_at: weighed_at || new Date(),
          weighbridge_operator_id: req.user ? req.user.id : null,
          plant_id: plant_id || gateEntry.plant_id || (req.user ? req.user.plant_id : null),
          created_by: req.user ? req.user.id : null,
        });

        // Update gate entry status based on entry type
        let newStatus = "waiting_second_weighment";
        let statusMessage = "waiting_second_weighment";

        if (isPurchaseEntry) {
          // For purchase entries, set to in_process after first weight
          newStatus = "in_process";
          statusMessage = "in_process";
        } else if (isSalesEntry) {
          // Sales trucks go to Loading next — bags are loaded (bag size x no.
          // of bags, see loading.controller.js) and only once the Sales Order
          // is FULLY loaded does the gate entry move on to
          // 'waiting_second_weighment'. Going straight there from here let a
          // truck be weighed out before (or without) being loaded at all.
          newStatus = "waiting_loading";
          statusMessage = "waiting_loading";
        } else if (isOtherEntry) {
          // Empty/misc trucks don't load anything — straight to second weighment.
          newStatus = "waiting_second_weighment";
          statusMessage = "waiting_second_weighment";
        }

        await gateEntry.update({
          gate_status: newStatus,
          updated_by: req.user ? req.user.id : null,
        });

        const created = await WeightSlip.findByPk(slip.id, {
          include: detailIncludes,
        });

        return res.status(201).json({
          success: true,
          msg: `First weight recorded. Weight: ${currentWeight}. Gate entry moved to ${statusMessage}.`,
          data: {
            weightSlip: created,
            purchase: null,
            first_weight: currentWeight,
            second_weight: null,
            net_weight: null,
            gate_status: newStatus,
            isFirstWeight: true,
          },
        });
      }

      // =========================================================
      // BULK CREATE (both weights at once - fallback)
      // =========================================================
      if (!hasFirstWeight && tare_weight !== undefined && tare_weight !== null) {
        const netWeight = Math.max(Math.abs(currentWeight - Number(tare_weight)), 0);
        const netQtl = kgToQtl(netWeight);

        // Create single slip with both weights
        const slip = await WeightSlip.create({
          gate_entry_id,
          slip_no,
          gross_weight: currentWeight,
          tare_weight: Number(tare_weight),
          weighed_at: weighed_at || new Date(),
          weighbridge_operator_id: req.user ? req.user.id : null,
          plant_id: plant_id || gateEntry.plant_id || (req.user ? req.user.plant_id : null),
          created_by: req.user ? req.user.id : null,
        });

        let purchase = null;
        let resolvedRate = null;

        if (isPurchaseEntry) {
          let po = null;
          if (gateEntry.po_id) {
            po = await PurchaseOrder.findOne({
              where: { id: gateEntry.po_id, is_deleted: false },
            });
          }
          resolvedRate = po ? Number(po.rate) : (final_rate !== undefined ? Number(final_rate) : null);

          if (resolvedRate != null && netWeight > 0) {
            purchase = await Purchase.create({
              po_id: po ? po.id : null,
              gate_entry_id,
              weight_slip_id: slip.id,
              final_rate: resolvedRate,
              final_qty: netQtl,
              amount: netQtl * resolvedRate,
              purchase_date: new Date().toISOString().slice(0, 10),
              plant_id: slip.plant_id,
              created_by: req.user ? req.user.id : null,
            });
          }
        }

        if (isSalesEntry) {
          if (gateEntry.so_id) {
            const salesOrder = await SalesOrder.findOne({
              where: { id: gateEntry.so_id, is_deleted: false },
            });
            resolvedRate = salesOrder?.rate !== undefined ? Number(salesOrder.rate) : (final_rate !== undefined ? Number(final_rate) : null);
          }
        }

        // Update gate entry to parked (both weights done)
        await gateEntry.update({
          gate_status: "parked",
          updated_by: req.user ? req.user.id : null,
        });

        const created = await WeightSlip.findByPk(slip.id, {
          include: detailIncludes,
        });

        return res.status(201).json({
          success: true,
          msg: isOtherEntry
            ? `Weight slip generated (net ${netWeight}); gate entry parked.`
            : `Weight slip generated (net ${netWeight}); purchase finalized and gate entry parked.`,
          data: {
            weightSlip: created,
            purchase,
            first_weight: Number(tare_weight),
            second_weight: currentWeight,
            net_weight: netWeight,
            net_qty_qtl: netQtl,
            final_rate: resolvedRate,
            amount: resolvedRate !== null ? netQtl * resolvedRate : null,
            gate_status: "parked",
          },
        });
      }

      throw createError(400, "Invalid request. Please provide proper weight data.");

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
          const netQtl = kgToQtl(Number(updated.gross_weight) - Number(updated.tare_weight)); // slip weights are kg; Purchase.final_qty is Qtl
          if (existingPurchase) {
            // Update placeholder purchase (final_qty may have been 0)
            await existingPurchase.update({ final_qty: netQtl, amount: netQtl * Number(existingPurchase.final_rate), updated_by: req.user ? req.user.id : null });
          } else if (resolvedRate != null) {
            await Purchase.create({
              po_id: gateEntry.po_id || null,
              gate_entry_id: gateEntry.id,
              weight_slip_id: updated.id,
              final_rate: Number(resolvedRate),
              final_qty: netQtl,
              amount: netQtl * Number(resolvedRate),
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