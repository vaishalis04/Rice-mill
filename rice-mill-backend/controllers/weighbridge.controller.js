const createError = require("http-errors");
const { Op } = require("sequelize");
const { WeightSlip, GateEntry, Purchase, PurchaseOrder, User } = require("../models/index");

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

const detailIncludes = [
  { model: GateEntry, as: "gateEntry", attributes: ["id", "token_no", "gate_status", "entry_type", "po_id", "vendor_id", "material_id"] },
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

      res.status(200).json({
        success: true,
        data: rows,
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

    // if (tare_weight !== undefined && tare_weight !== null && Number(gross_weight) <= Number(tare_weight)) {
    //   throw createError(400, "gross_weight must be greater than tare_weight");
    // }

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

    const hasFirstWeight = existingSlips.length > 0;
    const isSecondWeight = hasFirstWeight && (tare_weight !== undefined && tare_weight !== null);

    // --- STATUS VALIDATION ---
    if (isSalesEntry) {
      if (!hasFirstWeight && gateEntry.gate_status !== "waiting_weighment") {
        throw createError(
          400,
          `Sales entry must be in 'waiting_weighment' for first weight. Current status: '${gateEntry.gate_status}'`
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

    // =========================================================
    // SECOND WEIGHT FLOW - UPDATE EXISTING SLIP
    // =========================================================
    if (isSecondWeight) {
      const firstSlip = existingSlips[0];
      const firstWeight = Number(firstSlip.gross_weight);

      // Validate second weight > first weight
      // if (currentWeight <= firstWeight) {
      //   throw createError(
      //     400,
      //     `Second weight must be greater than first weight. First weight: ${firstWeight}, second weight: ${currentWeight}`
      //   );
      // }

      const netWeight = currentWeight - firstWeight;

      // UPDATE THE EXISTING SLIP with second weight data
      await firstSlip.update({
        gross_weight: currentWeight,  // Update gross to second weight
        tare_weight: firstWeight,      // Set tare as first weight
        weighed_at: weighed_at || new Date(),
        updated_by: req.user ? req.user.id : null,
        updated_at: new Date(),
      });

      // --- HANDLE PURCHASE OR SALES ---
      let purchase = null;
      let salesOrder = null;
      let resolvedRate = null;

      if (isPurchaseEntry) {
        // Get PO
        let po = null;
        let hasPO = false;

        if (gateEntry.po_id) {
          po = await PurchaseOrder.findOne({
            where: { id: gateEntry.po_id, is_deleted: false },
          });
          if (po) hasPO = true;
        } else {
          try {
            const { GateEntryPurchaseOrder } = require("../models");
            const poItems = await GateEntryPurchaseOrder.findAll({
              where: { gate_entry_id: gateEntry.id, is_deleted: false },
            });
            if (poItems && poItems.length > 0) {
              const firstPO = await PurchaseOrder.findOne({
                where: { id: poItems[0].po_id, is_deleted: false },
              });
              if (firstPO) {
                po = firstPO;
                hasPO = true;
              }
            }
          } catch (junctionError) {
            const existingPurchase = await Purchase.findOne({
              where: { gate_entry_id: gateEntry.id, is_deleted: false },
            });
            if (existingPurchase) {
              po = await PurchaseOrder.findOne({
                where: { id: existingPurchase.po_id, is_deleted: false },
              });
              if (po) hasPO = true;
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
        });

        if (existingPurchase) {
          // Update existing purchase
          await existingPurchase.update({
            final_rate: resolvedRate,
            final_qty: netWeight,
            amount: netWeight * resolvedRate,
            updated_by: req.user ? req.user.id : null,
          });
          purchase = existingPurchase;
        } else {
          // Create new purchase
          purchase = await Purchase.create({
            po_id: po ? po.id : null,
            gate_entry_id,
            weight_slip_id: firstSlip.id,
            final_rate: resolvedRate,
            final_qty: netWeight,
            amount: netWeight * resolvedRate,
            purchase_date: new Date().toISOString().slice(0, 10),
            plant_id: firstSlip.plant_id,
            created_by: req.user ? req.user.id : null,
          });
        }
      }

      if (isSalesEntry) {
        if (gateEntry.so_id) {
          salesOrder = await SalesOrder.findOne({
            where: { id: gateEntry.so_id, is_deleted: false },
          });
        }

        if (!salesOrder) {
          try {
            const { GateEntrySalesOrder } = require("../models");
            const soItem = await GateEntrySalesOrder.findOne({
              where: { gate_entry_id: gateEntry.id, is_deleted: false },
            });
            if (soItem) {
              salesOrder = await SalesOrder.findOne({
                where: { id: soItem.so_id, is_deleted: false },
              });
            }
          } catch (soError) {
            // Ignore
          }
        }

        resolvedRate = salesOrder?.rate !== undefined ? Number(salesOrder.rate) : (final_rate !== undefined ? Number(final_rate) : null);
      }

      // --- UPDATE GATE ENTRY TO Parked ---
      await gateEntry.update({
        gate_status: "Parked",
        updated_by: req.user ? req.user.id : null,
      });

      const updated = await WeightSlip.findByPk(firstSlip.id, {
        include: detailIncludes,
      });

      let msg = `Second weight recorded. First: ${firstWeight}, Second: ${currentWeight}, Net: ${netWeight}`;
      if (isPurchaseEntry) {
        msg += ` Purchase finalized.`;
      } else if (isSalesEntry) {
        msg += ` Sales order completed.`;
      } else {
        msg += ` Gate entry Parked.`;
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
          final_rate: resolvedRate,
          amount: resolvedRate !== null ? netWeight * resolvedRate : null,
          gate_status: "Parked",
          isSecondWeight: true,
          updated: true,
        },
      });
    }

    // --- CHECK DUPLICATE SLIP NO (only for first weight or bulk create) ---
    if (!isSecondWeight) {
      const dupSlipNo = await WeightSlip.findOne({
        where: { slip_no, is_deleted: false },
      });
      if (dupSlipNo) {
        throw createError(409, "A weight slip with this slip_no already exists");
      }
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
      } else if (isSalesEntry || isOtherEntry) {
        // For sales and other entries, set to waiting_second_weighment
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
      const netWeight = currentWeight - Number(tare_weight);
      if (netWeight <= 0) {
        throw createError(400, "Net weight must be positive. gross_weight must be greater than tare_weight");
      }

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
            final_qty: netWeight,
            amount: netWeight * resolvedRate,
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

      // Update gate entry to Parked (both weights done)
      await gateEntry.update({
        gate_status: "Parked",
        updated_by: req.user ? req.user.id : null,
      });

      const created = await WeightSlip.findByPk(slip.id, {
        include: detailIncludes,
      });

      return res.status(201).json({
        success: true,
        msg: isOtherEntry
          ? `Weight slip generated (net ${netWeight}); gate entry Parked.`
          : `Weight slip generated (net ${netWeight}); purchase finalized and gate entry Parked.`,
        data: {
          weightSlip: created,
          purchase,
          first_weight: Number(tare_weight),
          second_weight: currentWeight,
          net_weight: netWeight,
          final_rate: resolvedRate,
          amount: resolvedRate !== null ? netWeight * resolvedRate : null,
          gate_status: "Parked",
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

      const nextGross = gross_weight !== undefined ? Number(gross_weight) : Number(slip.gross_weight);
      const nextTare = tare_weight !== undefined ? Number(tare_weight) : (slip.tare_weight !== null ? Number(slip.tare_weight) : undefined);
      // if (nextTare !== undefined && nextGross <= nextTare) {
      //   throw createError(400, "gross_weight must be greater than tare_weight");
      // }

      if (slip_no) {
        const dup = await WeightSlip.findOne({ where: { slip_no, id: { [Op.ne]: slip.id } } });
        if (dup) throw createError(409, "Another weight slip already uses this slip_no");
      }

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
          const netWeight = Number(updated.gross_weight) - Number(updated.tare_weight);
          if (existingPurchase) {
            // Update placeholder purchase (final_qty may have been 0)
            await existingPurchase.update({ final_qty: netWeight, amount: netWeight * Number(existingPurchase.final_rate), updated_by: req.user ? req.user.id : null });
          } else if (resolvedRate != null) {
            await Purchase.create({
              po_id: gateEntry.po_id || null,
              gate_entry_id: gateEntry.id,
              weight_slip_id: updated.id,
              final_rate: Number(resolvedRate),
              final_qty: netWeight,
              amount: netWeight * Number(resolvedRate),
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