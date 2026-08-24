const createError = require("http-errors");
const { Op } = require("sequelize");
const {
  GateEntry,
  Vehicle,
  Driver,
  Vendor,
  PurchaseOrder,
  MaterialMaster,
  PlantMaster,
  WarehouseMaster,
  SalesOrder,
  Customer,
} = require("../models/index");
const { generateTokenNo } = require("../helpers/helperFunction");

const detailIncludes = [
  { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no", "type", "capacity"] },
  { model: Driver, as: "driver", attributes: ["id", "name", "mobile", "license_no", "photo_url"] },
  { model: Vendor, as: "vendor", attributes: ["id", "vendor_code", "name", "vendor_type"] },
  { model: PurchaseOrder, as: "purchaseOrder", attributes: ["id", "po_no", "qty", "rate"] },
  { model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name", "category"] },
  { model: PlantMaster, as: "plant", attributes: ["id", "plant_code", "name"] },
  { model: WarehouseMaster, as: "receivedWarehouse", attributes: ["id", "warehouse_code", "name"] },
  {
    model: SalesOrder,
    as: "salesOrder",
    attributes: ["id", "so_no", "customer_id", "material_id", "qty", "rate", "so_status"],
    include: [
      { model: Customer, as: "customer", attributes: ["id", "customer_code", "name"] },
      { model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name"] },
    ],
  },
];

const validateReferences = async ({ vehicle_id, driver_id, vendor_id, material_id, po_id, so_id, entry_type = "purchase" }) => {
  const [vehicle, driver] = await Promise.all([
    Vehicle.findOne({ where: { id: vehicle_id, is_deleted: false } }),
    Driver.findOne({ where: { id: driver_id, is_deleted: false } }),
  ]);

  if (!vehicle) throw createError(400, "Invalid vehicle_id");
  if (!driver) throw createError(400, "Invalid driver_id");

  let vendor = null;
  let material = null;
  let po = null;
  let salesOrder = null;

  if (entry_type === "purchase") {
    if (!vendor_id) throw createError(400, "vendor_id is required for a purchase entry");
    if (!material_id) throw createError(400, "material_id is required for a purchase entry");

    [vendor, material] = await Promise.all([
      Vendor.findOne({ where: { id: vendor_id, is_deleted: false } }),
      MaterialMaster.findOne({ where: { id: material_id, is_deleted: false } }),
    ]);

    if (!vendor) throw createError(400, "Invalid vendor_id");
    if (!material) throw createError(400, "Invalid material_id");

    if (po_id) {
      po = await PurchaseOrder.findOne({ where: { id: po_id, is_deleted: false } });
      if (!po) throw createError(400, "Invalid po_id");
      if (Number(po.vendor_id) !== Number(vendor_id)) {
        throw createError(400, "po_id does not belong to the given vendor_id");
      }
    }
  } else if (entry_type === "sales") {
    if (!so_id) throw createError(400, "so_id is required for a sales (outbound loading) entry");

    salesOrder = await SalesOrder.findOne({ where: { id: so_id, is_deleted: false } });
    if (!salesOrder) throw createError(400, "Invalid so_id");
    if (["dispatched", "closed", "cancelled"].includes(salesOrder.so_status)) {
      throw createError(400, `Sales Order ${salesOrder.so_no} is already '${salesOrder.so_status}' and cannot be assigned to a new gate entry`);
    }

    // material is always derived from the Sales Order for a sales entry —
    // never picked separately, so it can't drift from what was actually ordered.
    material = await MaterialMaster.findOne({ where: { id: salesOrder.material_id, is_deleted: false } });
    if (!material) throw createError(400, "The Sales Order's material could not be found");
  } else {
    // entry_type = "other": vendor/material/PO are optional; validate only
    // whichever of them were actually supplied.
    if (vendor_id) {
      vendor = await Vendor.findOne({ where: { id: vendor_id, is_deleted: false } });
      if (!vendor) throw createError(400, "Invalid vendor_id");
    }
    if (material_id) {
      material = await MaterialMaster.findOne({ where: { id: material_id, is_deleted: false } });
      if (!material) throw createError(400, "Invalid material_id");
    }
    if (po_id) {
      po = await PurchaseOrder.findOne({ where: { id: po_id, is_deleted: false } });
      if (!po) throw createError(400, "Invalid po_id");
    }
  }

  return { vehicle, driver, vendor, material, po, salesOrder };
};

module.exports = {

  getAll: async (req, res, next) => {
    try {
      const { status, entry_type, vendor_id, vehicle_id, material_id, plant_id, from, to, page = 1, limit = 20 } = req.query;

      const where = { is_deleted: false };
      if (status) where.gate_status = status;
      if (entry_type) where.entry_type = entry_type;
      if (vendor_id) where.vendor_id = vendor_id;
      if (vehicle_id) where.vehicle_id = vehicle_id;
      if (material_id) where.material_id = material_id;
      if (plant_id) where.plant_id = plant_id;
      if (from || to) {
        where.entry_time = {};
        if (from) where.entry_time[Op.gte] = new Date(from);
        if (to) where.entry_time[Op.lte] = new Date(to);
      }

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await GateEntry.findAndCountAll({
        where,
        include: detailIncludes,
        order: [["entry_time", "DESC"]],
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

  getById: async (req, res, next) => {
    try {
      const entry = await GateEntry.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: detailIncludes,
      });
      if (!entry) throw createError(404, "Gate entry not found");
      res.status(200).json({ success: true, data: entry });
    } catch (err) {
      next(err);
    }
  },

  create: async (req, res, next) => {
    try {
      const {
        vehicle_id, driver_id, vendor_id, po_id, material_id, so_id,
        challan_no, expected_qty, driver_photo_url, plant_id,
        entry_type = "purchase", remarks,
      } = req.body;

      if (!["purchase", "other", "sales"].includes(entry_type)) {
        throw createError(400, "entry_type must be 'purchase', 'other' or 'sales'");
      }
      if (!vehicle_id || !driver_id) {
        throw createError(400, "vehicle_id and driver_id are required");
      }
      if (entry_type === "purchase" && (!vendor_id || !material_id)) {
        throw createError(400, "vendor_id and material_id are required for a purchase entry");
      }
      if (entry_type === "sales" && !so_id) {
        throw createError(400, "so_id is required for a sales (outbound loading) entry");
      }

      const { vehicle, material, salesOrder } = await validateReferences({
        vehicle_id, driver_id, vendor_id, material_id, po_id, so_id, entry_type,
      });

      const token_no = await generateTokenNo(vehicle.vehicle_no);

      const entry = await GateEntry.create({
        token_no,
        vehicle_id,
        driver_id,
        entry_type,
        vendor_id: vendor_id || null,
        po_id: po_id || null,
        so_id: entry_type === "sales" ? so_id : null,
        // For "sales", material_id is always derived from the Sales Order —
        // never taken from the request body.
        material_id: entry_type === "sales" ? (salesOrder ? salesOrder.material_id : null) : (material_id || null),
        challan_no,
        expected_qty,
        remarks,
        driver_photo_url,
        entry_time: new Date(),
        gate_status: "waiting_token",
        plant_id: plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      const created = await GateEntry.findByPk(entry.id, { include: detailIncludes });
      res.status(201).json({ success: true, msg: "Gate entry created", data: created });
    } catch (err) {
      next(err);
    }
  },

  update: async (req, res, next) => {
    try {
      const entry = await GateEntry.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!entry) throw createError(404, "Gate entry not found");

      const {
        vehicle_id, driver_id, vendor_id, po_id, material_id, so_id,
        challan_no, expected_qty, driver_photo_url, plant_id, gate_status,
        entry_type, remarks,
      } = req.body;

      await validateReferences({
        vehicle_id: vehicle_id || entry.vehicle_id,
        driver_id: driver_id || entry.driver_id,
        vendor_id: vendor_id || entry.vendor_id,
        material_id: material_id || entry.material_id,
        po_id: po_id !== undefined ? po_id : entry.po_id,
        so_id: so_id !== undefined ? so_id : entry.so_id,
        entry_type: entry_type || entry.entry_type,
      });

      const updates = {
        vehicle_id, driver_id, vendor_id, po_id, material_id, so_id,
        challan_no, expected_qty, driver_photo_url, plant_id, gate_status,
        entry_type, remarks,
      };
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      updates.updated_by = req.user ? req.user.id : null;

      await entry.update(updates);

      const updated = await GateEntry.findByPk(entry.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Gate entry updated", data: updated });
    } catch (err) {
      next(err);
    }
  },

  delete: async (req, res, next) => {
    try {
      const entry = await GateEntry.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!entry) throw createError(404, "Gate entry not found");

      await entry.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Gate entry deleted" });
    } catch (err) {
      next(err);
    }
  },

  checkIn: async (req, res, next) => {
    try {
      const { id } = req.body;
      if (!id) throw createError(400, "id is required");

      const entry = await GateEntry.findOne({ where: { id, is_deleted: false } });
      if (!entry) throw createError(404, "Gate entry not found");

      if (entry.gate_status !== "waiting_token") {
        throw createError(400, `Cannot check in a gate entry with status '${entry.gate_status}'`);
      }

      // Purchase trucks join the normal Sampling -> Lab -> Negotiation queue.
      // Empty/miscellaneous trucks (entry_type = "other") skip all of that and
      // go straight into the weighment queue instead. Sales (outbound loading)
      // trucks go straight into the loading queue.
      let nextStatus = "waiting_sampling";
      if (entry.entry_type === "other") nextStatus = "waiting_weighment";
      else if (entry.entry_type === "sales") nextStatus = "waiting_loading";

      await entry.update({ gate_status: nextStatus, updated_by: req.user ? req.user.id : null });

      const updated = await GateEntry.findByPk(entry.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Vehicle checked in", data: updated });
    } catch (err) {
      next(err);
    }
  },

  sendToWarehouse: async (req, res, next) => {
    try {
      const { id, warehouse_id, remarks } = req.body;
      if (!id) throw createError(400, "id is required");

      const entry = await GateEntry.findOne({ where: { id, is_deleted: false } });
      if (!entry) throw createError(404, "Gate entry not found");

      if (entry.entry_type !== "other") {
        throw createError(400, "Only empty/miscellaneous (entry_type = 'other') gate entries can be sent to warehouse directly");
      }
      if (!["waiting_weighment", "in_process"].includes(entry.gate_status)) {
        throw createError(
          400,
          `Cannot send a gate entry with status '${entry.gate_status}' to warehouse; it must be 'waiting_weighment' or 'in_process'`
        );
      }

      const updates = { gate_status: "unloaded", updated_by: req.user ? req.user.id : null };
      if (warehouse_id) updates.received_warehouse_id = warehouse_id;
      if (remarks) updates.remarks = remarks;

      await entry.update(updates);

      const updated = await GateEntry.findByPk(entry.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Truck sent to warehouse", data: updated });
    } catch (err) {
      next(err);
    }
  },

  checkOut: async (req, res, next) => {
    try {
      const { id } = req.body;
      if (!id) throw createError(400, "id is required");

      const entry = await GateEntry.findOne({ where: { id, is_deleted: false } });
      if (!entry) throw createError(404, "Gate entry not found");

      if (entry.gate_status === "exited") {
        throw createError(400, "This gate entry has already exited");
      }
      if (entry.gate_status === "waiting_token") {
        throw createError(400, "Vehicle has not been checked in yet; cannot check out");
      }
      if (entry.entry_type === "sales" && entry.gate_status !== "loaded") {
        throw createError(400, `Cannot check out a sales truck with status '${entry.gate_status}'; it must be 'loaded' first (see the Loading module)`);
      }

      await entry.update({
        gate_status: "exited",
        exit_time: new Date(),
        updated_by: req.user ? req.user.id : null,
      });

      const updated = await GateEntry.findByPk(entry.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Vehicle checked out", data: updated });
    } catch (err) {
      next(err);
    }
  },

 generateToken: async (req, res, next) => {
  try {
    const {
      vehicle_id,
      driver_id,
      vendor_id,
      challan_no,
      expected_qty,
      driver_photo_url,
      plant_id,
      entry_type = "purchase",
      remarks,
      purchase_orders,
      so_id,
    } = req.body;

    if (!["purchase", "other", "sales"].includes(entry_type)) {
      throw createError(
        400,
        "entry_type must be 'purchase', 'other' or 'sales'"
      );
    }

    if (!vehicle_id || !driver_id) {
      throw createError(
        400,
        "vehicle_id and driver_id are required"
      );
    }

    // =====================================================
    // PURCHASE VALIDATION
    // =====================================================

    if (entry_type === "purchase") {
      if (!vendor_id) {
        throw createError(
          400,
          "vendor_id is required for a purchase entry"
        );
      }

      if (
        !Array.isArray(purchase_orders) ||
        purchase_orders.length === 0
      ) {
        throw createError(
          400,
          "purchase_orders must be a non-empty array"
        );
      }
    }

    // =====================================================
    // SALES VALIDATION
    // =====================================================

    if (entry_type === "sales" && !so_id) {
      throw createError(
        400,
        "so_id is required for a sales entry"
      );
    }

    // =====================================================
    // VALIDATE VEHICLE / DRIVER
    // =====================================================

    const { vehicle, salesOrder } =
      await validateReferences({
        vehicle_id,
        driver_id,
        vendor_id,
        so_id,
        entry_type,
      });

    // =====================================================
    // TRANSACTION
    // =====================================================

    const t = await sequelize.transaction();

    try {
      // Generate token
      const token_no = await generateTokenNo(
        vehicle.vehicle_no
      );

      // ===================================================
      // CREATE GATE ENTRY HEADER
      // ===================================================

      const entry = await GateEntry.create(
        {
          token_no,
          vehicle_id,
          driver_id,
          entry_type,

          vendor_id: vendor_id || null,

          // For multi-PO purchase entry we don't use
          // the old single po_id field.
          po_id: null,

          so_id:
            entry_type === "sales"
              ? so_id
              : null,

          // For purchase this is also no longer stored
          // as a single material.
          material_id:
            entry_type === "sales"
              ? salesOrder
                ? salesOrder.material_id
                : null
              : null,

          challan_no,
          expected_qty,
          remarks,
          driver_photo_url,

          entry_time: new Date(),

          gate_status: "waiting_token",

          plant_id:
            plant_id ||
            (req.user ? req.user.plant_id : null),

          created_by:
            req.user ? req.user.id : null,
        },
        {
          transaction: t,
        }
      );

      // ===================================================
      // CREATE MULTIPLE PO + MATERIAL RELATIONS
      // ===================================================

      if (entry_type === "purchase") {
        const GateEntryPurchaseOrder =
          require("../models/gateEntryPurchaseOrder.model");

        for (const po of purchase_orders) {
          if (!po.po_id) {
            throw createError(
              400,
              "Each purchase order needs po_id"
            );
          }

          if (
            !Array.isArray(po.materials) ||
            po.materials.length === 0
          ) {
            throw createError(
              400,
              `PO ${po.po_id} must contain at least one material`
            );
          }

          // Check PO
          const purchaseOrder =
            await PurchaseOrder.findOne({
              where: {
                id: po.po_id,
                vendor_id,
                approval_status: "approved",
                is_deleted: false,
              },
              transaction: t,
            });

          if (!purchaseOrder) {
            throw createError(
              400,
              `Invalid or unapproved purchase order: ${po.po_id}`
            );
          }

          for (const material of po.materials) {
            if (!material.material_id) {
              throw createError(
                400,
                `material_id is required for PO ${po.po_id}`
              );
            }

            // Make sure material exists
            const materialMaster =
              await MaterialMaster.findOne({
                where: {
                  id: material.material_id,
                  is_deleted: false,
                },
                transaction: t,
              });

            if (!materialMaster) {
              throw createError(
                400,
                `Invalid material_id: ${material.material_id}`
              );
            }

            // Make sure material belongs to this PO
            const poMaterial =
              await PurchaseOrder.findOne({
                where: {
                  id: po.po_id,
                  material_id: material.material_id,
                  is_deleted: false,
                },
                transaction: t,
              });

            if (!poMaterial) {
              throw createError(
                400,
                `Material ${material.material_id} does not belong to PO ${po.po_id}`
              );
            }

            await GateEntryPurchaseOrder.create(
              {
                gate_entry_id: entry.id,
                po_id: po.po_id,
                material_id: material.material_id,
                qty: material.qty || null,
              },
              {
                transaction: t,
              }
            );
          }
        }
      }

      await t.commit();

      // ===================================================
      // RETURN COMPLETE ENTRY
      // ===================================================

      const created =
        await GateEntry.findByPk(
          entry.id,
          {
            include: detailIncludes,
          }
        );

      res.status(201).json({
        success: true,
        msg: "Token generated",
        data: created,
      });
    } catch (error) {
      await t.rollback();
      throw error;
    }
  } catch (err) {
    next(err);
  }
},

  uploadPhoto: async (req, res, next) => {
    try {
      if (!req.file) throw createError(400, "No photo file received (field name must be 'photo')");
      const url = `/uploads/${req.file.filename}`;
      res.status(201).json({ success: true, msg: "Photo uploaded", data: { url } });
    } catch (err) {
      next(err);
    }
  },
};