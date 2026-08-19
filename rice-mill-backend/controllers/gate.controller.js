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

// Gate entry/exit, token & queue, driver photo capture (Module 1)

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

// Shared existence/validity checks for the entities a gate entry references.
// Returns the fetched rows so callers don't have to re-query (e.g. token
// generation needs vehicle.vehicle_no right after this runs).
// vendor_id/material_id are only required for entry_type = "purchase" —
// empty/miscellaneous trucks (entry_type = "other") usually have neither.
// entry_type = "sales" requires so_id instead; material_id is derived from
// the Sales Order automatically rather than picked separately.
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
  // GET /api/gate?status=&vendor_id=&vehicle_id=&plant_id=&from=&to=&page=&limit=
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

  // GET /api/gate/:id
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

  // POST /api/gate  (manual/admin creation - does not auto-generate a token; use /generatetoken for the gate workflow)
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

  // PUT /api/gate/:id
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

  // DELETE /api/gate/:id  (soft delete)
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

  // POST /api/gate/checkin  { id }  -- move a token'd vehicle forward into the yard for sampling
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

  // POST /api/gate/send-to-warehouse  { id, warehouse_id?, remarks? }
  // For entry_type = "other" (empty trucks / miscellaneous items) only.
  // Skips Sampling/Lab/Negotiation and, when there's nothing worth putting
  // through the full Lot/Stack/Inventory flow, sends the truck straight to
  // Warehouse for record-keeping. Valid from 'waiting_weighment' (no weighing
  // needed at all — e.g. a genuinely empty truck) or 'in_process' (already
  // weighed via Weighbridge, but with no material to open a Lot for).
  // If the load does need to be tracked as stock, use the normal
  // Unloading/Lot flow instead once the entry reaches 'in_process'.
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

  // POST /api/gate/checkout  { id }  -- vehicle leaves the plant
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

  // POST /api/gate/generatetoken  -- primary gate-keeper workflow: validates entities, issues a
  // sequential token number and opens a new gate entry record with status 'waiting_token'.
  generateToken: async (req, res, next) => {
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

      const { vehicle, salesOrder } = await validateReferences({
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
      res.status(201).json({ success: true, msg: "Token generated", data: created });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/gate/upload-photo  (multipart, field name "photo") -- saves a
  // driver photo to disk and returns its URL; driver_photo_url only ever
  // stores this short URL, never the raw image data (the column is a
  // VARCHAR(255), a base64 data URL would blow past that).
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