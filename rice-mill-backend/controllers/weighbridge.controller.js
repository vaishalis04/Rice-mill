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

  // POST /api/weight-slips  { gate_entry_id, slip_no, gross_weight, tare_weight, weighed_at?, final_rate? }
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

    if (!gate_entry_id || !slip_no || gross_weight === undefined) {
      throw createError(
        400,
        "gate_entry_id, slip_no and gross_weight are required"
      );
    }

    const currentWeight = Number(gross_weight);

    if (isNaN(currentWeight) || currentWeight <= 0) {
      throw createError(400, "gross_weight must be a valid positive number");
    }

    if (
      tare_weight !== undefined &&
      tare_weight !== null &&
      Number(gross_weight) <= Number(tare_weight)
    ) {
      throw createError(
        400,
        "gross_weight must be greater than tare_weight"
      );
    }

    // ---------------------------------------------------------
    // GET GATE ENTRY
    // ---------------------------------------------------------

    let gateEntry;

    try {
      gateEntry = await GateEntry.findOne({
        where: {
          id: gate_entry_id,
          is_deleted: false,
        },
        include: [
          {
            association: "purchase_orders",
            required: false,
          },
        ],
      });
    } catch (assocError) {
      gateEntry = await GateEntry.findOne({
        where: {
          id: gate_entry_id,
          is_deleted: false,
        },
      });
    }

    if (!gateEntry) {
      throw createError(400, "Invalid gate_entry_id");
    }

    const entryType = gateEntry.entry_type;

    const isSalesEntry = entryType === "sales";
    const isPurchaseEntry = entryType === "purchase";
    const isOtherEntry = entryType === "other";

    // ---------------------------------------------------------
    // STATUS VALIDATION
    // ---------------------------------------------------------

    let requiredStatus;

    if (isSalesEntry) {
      // Sales has two stages:
      // 1. waiting_weighment -> first weight
      // 2. waiting_loading   -> second weight
      if (
        gateEntry.gate_status !== "waiting_weighment" &&
        gateEntry.gate_status !== "waiting_loading"
      ) {
        throw createError(
          400,
          `Sales gate entry cannot be weighed with status '${gateEntry.gate_status}'. Expected 'waiting_weighment' for first weight or 'waiting_loading' for second weight`
        );
      }
    } else if (isOtherEntry) {
      requiredStatus = "waiting_weighment";

      if (gateEntry.gate_status !== requiredStatus) {
        throw createError(
          400,
          `Cannot weigh a gate entry with status '${gateEntry.gate_status}'; it must be '${requiredStatus}'`
        );
      }
    } else {
      // Purchase
      requiredStatus = "accepted";

      if (gateEntry.gate_status !== requiredStatus) {
        throw createError(
          400,
          `Cannot weigh a purchase gate entry with status '${gateEntry.gate_status}'; it must be '${requiredStatus}'`
        );
      }
    }

    // ---------------------------------------------------------
    // SALES FLOW
    // ---------------------------------------------------------

    if (isSalesEntry) {
      // =======================================================
      // FIRST WEIGHT
      // waiting_weighment -> waiting_loading
      // =======================================================

      if (gateEntry.gate_status === "waiting_weighment") {
        const existingFirstSlip = await WeightSlip.findOne({
          where: {
            gate_entry_id,
            is_deleted: false,
          },
          order: [["id", "ASC"]],
        });

        if (existingFirstSlip) {
          throw createError(
            409,
            "First weight already recorded. Gate entry is waiting for second weight."
          );
        }

        // slip_no must still be unique
        const dupSlipNo = await WeightSlip.findOne({
          where: { slip_no },
        });

        if (dupSlipNo) {
          throw createError(
            409,
            "A weight slip with this slip_no already exists"
          );
        }

        const slip = await WeightSlip.create({
          gate_entry_id,
          slip_no,
          gross_weight: currentWeight,
          tare_weight: null,
          weighed_at: weighed_at || new Date(),
          weighbridge_operator_id: req.user ? req.user.id : null,
          plant_id:
            plant_id ||
            gateEntry.plant_id ||
            (req.user ? req.user.plant_id : null),
          created_by: req.user ? req.user.id : null,
        });

        // First weight complete.
        // Move sales entry to waiting_loading.
        await gateEntry.update({
          gate_status: "waiting_loading",
          updated_by: req.user ? req.user.id : null,
        });

        const created = await WeightSlip.findByPk(slip.id, {
          include: detailIncludes,
        });

        return res.status(201).json({
          success: true,
          msg: `First weight recorded for sales order. Weight: ${currentWeight}. Gate entry moved to waiting_loading.`,
          data: {
            weightSlip: created,
            purchase: null,
            first_weight: currentWeight,
            second_weight: null,
            net_weight: null,
            gate_status: "waiting_loading",
          },
        });
      }

      // =======================================================
      // SECOND WEIGHT
      // waiting_loading -> accepted
      // =======================================================

      if (gateEntry.gate_status === "waiting_loading") {
        const firstSlip = await WeightSlip.findOne({
          where: {
            gate_entry_id,
            is_deleted: false,
          },
          order: [["id", "ASC"]],
        });

        if (!firstSlip) {
          throw createError(
            400,
            "First weight is missing. Please record the first weight before second weight."
          );
        }

        const firstWeight = Number(firstSlip.gross_weight);

        // Sales:
        // First weight = LOW
        // Second weight = HIGH
        if (currentWeight <= firstWeight) {
          throw createError(
            400,
            `Second weight must be greater than first weight. First weight: ${firstWeight}, second weight: ${currentWeight}`
          );
        }

        const netWeight = currentWeight - firstWeight;

        // Check duplicate slip number
        const dupSlipNo = await WeightSlip.findOne({
          where: { slip_no },
        });

        if (dupSlipNo) {
          throw createError(
            409,
            "A weight slip with this slip_no already exists"
          );
        }

        // Create second weight slip
        const secondSlip = await WeightSlip.create({
          gate_entry_id,
          slip_no,
          gross_weight: currentWeight,
          tare_weight: firstWeight,
          weighed_at: weighed_at || new Date(),
          weighbridge_operator_id: req.user ? req.user.id : null,
          plant_id:
            plant_id ||
            gateEntry.plant_id ||
            (req.user ? req.user.plant_id : null),
          created_by: req.user ? req.user.id : null,
        });

        // -----------------------------------------------------
        // SALES ORDER RATE
        // -----------------------------------------------------

        let salesOrder = null;

        // If your GateEntry has so_id
        if (gateEntry.so_id) {
          salesOrder = await SalesOrder.findOne({
            where: {
              id: gateEntry.so_id,
              is_deleted: false,
            },
          });
        }

        // If there is no direct SO, try junction table
        if (!salesOrder) {
          try {
            const { GateEntrySalesOrder } = require("../models");

            if (GateEntrySalesOrder) {
              const soItem = await GateEntrySalesOrder.findOne({
                where: {
                  gate_entry_id: gateEntry.id,
                  is_deleted: false,
                },
              });

              if (soItem) {
                salesOrder = await SalesOrder.findOne({
                  where: {
                    id: soItem.so_id,
                    is_deleted: false,
                  },
                });
              }
            }
          } catch (soError) {
            // Ignore if junction model is not available
          }
        }

        // -----------------------------------------------------
        // RATE
        // -----------------------------------------------------

        let resolvedRate = null;

        if (salesOrder && salesOrder.rate !== undefined) {
          resolvedRate = Number(salesOrder.rate);
        } else if (final_rate !== undefined) {
          resolvedRate = Number(final_rate);
        }

        // -----------------------------------------------------
        // ACCEPT SALES WEIGHT
        // -----------------------------------------------------

        await gateEntry.update({
          gate_status: "accepted",
          updated_by: req.user ? req.user.id : null,
        });

        const created = await WeightSlip.findByPk(secondSlip.id, {
          include: detailIncludes,
        });

        return res.status(201).json({
          success: true,
          msg: `Second weight accepted. First: ${firstWeight}, Second: ${currentWeight}, Net: ${netWeight}`,
          data: {
            weightSlip: created,
            salesOrder,
            first_weight: firstWeight,
            second_weight: currentWeight,
            net_weight: netWeight,
            final_rate: resolvedRate,
            amount:
              resolvedRate !== null ? netWeight * resolvedRate : null,
            gate_status: "accepted",
          },
        });
      }
    }

    // ---------------------------------------------------------
    // PURCHASE / OTHER FLOW
    // ---------------------------------------------------------

    let existingSlip = null;

    if (isPurchaseEntry || isOtherEntry) {
      existingSlip = await WeightSlip.findOne({
        where: {
          gate_entry_id,
          is_deleted: false,
        },
      });

      if (existingSlip) {
        throw createError(
          409,
          "A weight slip already exists for this gate entry"
        );
      }
    }

    const dupSlipNo = await WeightSlip.findOne({
      where: { slip_no },
    });

    if (dupSlipNo) {
      throw createError(
        409,
        "A weight slip with this slip_no already exists"
      );
    }

    // ---------------------------------------------------------
    // PURCHASE PO LOGIC
    // ---------------------------------------------------------

    let hasPO = false;
    let po = null;

    if (isPurchaseEntry) {
      // Direct PO
      if (gateEntry.po_id) {
        hasPO = true;

        po = await PurchaseOrder.findOne({
          where: {
            id: gateEntry.po_id,
            is_deleted: false,
          },
        });

        if (!po) {
          throw createError(
            400,
            "The purchase order linked to this gate entry could not be found"
          );
        }
      } else {
        let purchaseOrders = gateEntry.purchase_orders;

        // Junction table
        if (!purchaseOrders) {
          try {
            const { GateEntryPurchaseOrder } = require("../models");

            const poItems = await GateEntryPurchaseOrder.findAll({
              where: {
                gate_entry_id: gateEntry.id,
                is_deleted: false,
              },
            });

            if (poItems && poItems.length > 0) {
              hasPO = true;

              const firstPO = await PurchaseOrder.findOne({
                where: {
                  id: poItems[0].po_id,
                  is_deleted: false,
                },
              });

              if (firstPO) {
                po = firstPO;
              }
            }
          } catch (junctionError) {
            // Fallback to Purchase
            const existingPurchase = await Purchase.findOne({
              where: {
                gate_entry_id: gateEntry.id,
                is_deleted: false,
              },
            });

            if (existingPurchase) {
              hasPO = true;

              po = await PurchaseOrder.findOne({
                where: {
                  id: existingPurchase.po_id,
                  is_deleted: false,
                },
              });
            }
          }
        } else if (purchaseOrders.length > 0) {
          hasPO = true;

          const firstPO = await PurchaseOrder.findOne({
            where: {
              id: purchaseOrders[0].po_id,
              is_deleted: false,
            },
          });

          if (firstPO) {
            po = firstPO;
          }
        }

        if (!hasPO && final_rate === undefined) {
          throw createError(
            400,
            "final_rate is required when the gate entry has no linked purchase order"
          );
        }
      }
    }

    // ---------------------------------------------------------
    // CREATE WEIGHT SLIP
    // ---------------------------------------------------------

    const slip = await WeightSlip.create({
      gate_entry_id,
      slip_no,
      gross_weight: currentWeight,
      tare_weight:
        tare_weight === undefined || tare_weight === null
          ? null
          : tare_weight,
      weighed_at: weighed_at || new Date(),
      weighbridge_operator_id: req.user ? req.user.id : null,
      plant_id:
        plant_id ||
        gateEntry.plant_id ||
        (req.user ? req.user.plant_id : null),
      created_by: req.user ? req.user.id : null,
    });

    // ---------------------------------------------------------
    // PURCHASE CREATION
    // ---------------------------------------------------------

    let purchase = null;

    if (isPurchaseEntry) {
      const resolvedRate =
        po
          ? Number(po.rate)
          : final_rate !== undefined
          ? Number(final_rate)
          : null;

      const netWeight =
        tare_weight !== undefined && tare_weight !== null
          ? currentWeight - Number(tare_weight)
          : 0;

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

    // ---------------------------------------------------------
    // PURCHASE / OTHER STATUS
    // ---------------------------------------------------------

    await gateEntry.update({
      gate_status: "in_process",
      updated_by: req.user ? req.user.id : null,
    });

    const created = await WeightSlip.findByPk(slip.id, {
      include: detailIncludes,
    });

    res.status(201).json({
      success: true,
      msg:
        tare_weight === undefined
          ? `First weight recorded for ${slip.slip_no}; ready for unloading.`
          : isOtherEntry
          ? `Weight slip ${slip.slip_no} generated (net ${
              currentWeight - Number(tare_weight)
            }); ready for warehouse`
          : `Weight slip ${slip.slip_no} generated (net ${
              currentWeight - Number(tare_weight)
            }); purchase finalized`,
      data: {
        weightSlip: created,
        purchase,
        gate_status: "in_process",
      },
    });
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
      if (nextTare !== undefined && nextGross <= nextTare) {
        throw createError(400, "gross_weight must be greater than tare_weight");
      }

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