const createError = require("http-errors");
const { Op } = require("sequelize");
const sequelize = require("../config/db");
const {
  GateEntry,
  Vehicle,
  Driver,
  Vendor,
  PurchaseOrder,
  GateEntryPurchaseOrder,
  MaterialMaster,
  PlantMaster,
  WarehouseMaster,
  SalesOrder,
  Customer,
} = require("../models/index");
const { generateTokenNo } = require("../helpers/helperFunction");

const detailIncludes = [
  {
    model: Vehicle,
    as: "vehicle",
    attributes: ["id", "vehicle_no", "type", "capacity"],
  },
  {
    model: Driver,
    as: "driver",
    attributes: ["id", "name", "mobile", "license_no", "photo_url"],
  },
  {
    model: Vendor,
    as: "vendor",
    attributes: ["id", "vendor_code", "name", "vendor_type"],
  },
  {
    model: PurchaseOrder,
    as: "purchaseOrder",
    attributes: ["id", "po_no", "qty", "rate"],
  },
  {
    model: MaterialMaster,
    as: "material",
    attributes: ["id", "material_code", "name", "category"],
  },
  { model: PlantMaster, as: "plant", attributes: ["id", "plant_code", "name"] },
  {
    model: WarehouseMaster,
    as: "receivedWarehouse",
    attributes: ["id", "warehouse_code", "name"],
  },
  {
    model: SalesOrder,
    as: "salesOrder",
    attributes: [
      "id",
      "so_no",
      "customer_id",
      "material_id",
      "qty",
      "rate",
      "so_status",
    ],
    include: [
      {
        model: Customer,
        as: "customer",
        attributes: ["id", "customer_code", "name"],
      },
      {
        model: MaterialMaster,
        as: "material",
        attributes: ["id", "material_code", "name"],
      },
    ],
  },
];

const validateReferences = async ({
  vehicle_id,
  driver_id,
  vendor_id,
  material_id,
  po_id,
  so_id,
  entry_type = "purchase",
}) => {
  // =====================================================
  // VEHICLE + DRIVER
  // =====================================================

  const [vehicle, driver] = await Promise.all([
    Vehicle.findOne({
      where: {
        id: vehicle_id,
        is_deleted: false,
      },
    }),

    Driver.findOne({
      where: {
        id: driver_id,
        is_deleted: false,
      },
    }),
  ]);

  if (!vehicle) {
    throw createError(400, "Invalid vehicle_id");
  }

  if (!driver) {
    throw createError(400, "Invalid driver_id");
  }

  let vendor = null;
  let material = null;
  let po = null;
  let salesOrder = null;

  // =====================================================
  // PURCHASE ENTRY
  // =====================================================

  if (entry_type === "purchase") {
    // Vendor is still required
    if (!vendor_id) {
      throw createError(400, "vendor_id is required for a purchase entry");
    }

    // Validate vendor
    vendor = await Vendor.findOne({
      where: {
        id: vendor_id,
        is_deleted: false,
      },
    });

    if (!vendor) {
      throw createError(400, "Invalid vendor_id");
    }

    /*
      IMPORTANT:

      DO NOT require material_id here.

      Purchase entries now support:

      purchase_orders: [
        {
          po_id: 10,
          materials: [
            {
              material_id: 2,
              qty: 4456
            }
          ]
        }
      ]

      Each material will be validated later inside
      generateToken().
    */

    // ===================================================
    // LEGACY SINGLE PO SUPPORT
    // ===================================================

    if (po_id) {
      po = await PurchaseOrder.findOne({
        where: {
          id: po_id,
          is_deleted: false,
        },
      });

      if (!po) {
        throw createError(400, "Invalid po_id");
      }

      // Make sure PO belongs to selected vendor
      if (Number(po.vendor_id) !== Number(vendor_id)) {
        throw createError(400, "po_id does not belong to the given vendor_id");
      }
    }

    // Do NOT validate material_id here.
    // Material validation happens from purchase_orders.
  }

  // =====================================================
  // SALES ENTRY
  // =====================================================
  else if (entry_type === "sales") {
    if (!so_id) {
      throw createError(
        400,
        "so_id is required for a sales (outbound loading) entry",
      );
    }

    // Find Sales Order
    salesOrder = await SalesOrder.findOne({
      where: {
        id: so_id,
        is_deleted: false,
      },
    });

    if (!salesOrder) {
      throw createError(400, "Invalid so_id");
    }

    // Make sure SO is still available
    if (["dispatched", "closed", "cancelled"].includes(salesOrder.so_status)) {
      throw createError(
        400,
        `Sales Order ${salesOrder.so_no} is already '${salesOrder.so_status}' and cannot be assigned to a new gate entry`,
      );
    }

    // Sales material comes directly from Sales Order
    if (!salesOrder.material_id) {
      throw createError(400, "Sales Order does not have a material_id");
    }

    material = await MaterialMaster.findOne({
      where: {
        id: salesOrder.material_id,
        is_deleted: false,
      },
    });

    if (!material) {
      throw createError(400, "The Sales Order's material could not be found");
    }
  }

  // =====================================================
  // OTHER ENTRY
  // =====================================================
  else if (entry_type === "other") {
    // Vendor is optional
    if (vendor_id) {
      vendor = await Vendor.findOne({
        where: {
          id: vendor_id,
          is_deleted: false,
        },
      });

      if (!vendor) {
        throw createError(400, "Invalid vendor_id");
      }
    }

    // Material is optional for "other"
    if (material_id) {
      material = await MaterialMaster.findOne({
        where: {
          id: material_id,
          is_deleted: false,
        },
      });

      if (!material) {
        throw createError(400, "Invalid material_id");
      }
    }

    // PO is optional
    if (po_id) {
      po = await PurchaseOrder.findOne({
        where: {
          id: po_id,
          is_deleted: false,
        },
      });

      if (!po) {
        throw createError(400, "Invalid po_id");
      }
    }
  }

  // =====================================================
  // RETURN
  // =====================================================

  return {
    vehicle,
    driver,
    vendor,
    material,
    po,
    salesOrder,
  };
};

module.exports = {
 getAll: async (req, res, next) => {
  try {
    const {
      status,
      entry_type,
      vendor_id,
      vehicle_id,
      material_id,
      plant_id,
      from,
      to,
      page = 1,
      limit = 20,
    } = req.query;

    // --------------------------------------------------
    // WHERE CONDITIONS FOR GATE ENTRY
    // --------------------------------------------------
    const where = {
      is_deleted: false,
    };

    if (status) {
      where.gate_status = status;
    }

    if (entry_type) {
      where.entry_type = entry_type;
    }

    if (vendor_id) {
      where.vendor_id = vendor_id;
    }

    if (vehicle_id) {
      where.vehicle_id = vehicle_id;
    }

    if (material_id) {
      where.material_id = material_id;
    }

    if (plant_id) {
      where.plant_id = plant_id;
    }

    // --------------------------------------------------
    // DATE FILTER
    // --------------------------------------------------
    if (from || to) {
      where.entry_time = {};

      if (from) {
        const fromDate = new Date(from);

        if (isNaN(fromDate.getTime())) {
          throw createError(400, "Invalid from date");
        }

        where.entry_time[Op.gte] = fromDate;
      }

      if (to) {
        const toDate = new Date(to);

        if (isNaN(toDate.getTime())) {
          throw createError(400, "Invalid to date");
        }

        // Include complete day when only date is provided
        if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
          toDate.setHours(23, 59, 59, 999);
        }

        where.entry_time[Op.lte] = toDate;
      }
    }

    // --------------------------------------------------
    // PAGINATION
    // --------------------------------------------------
    const pageNumber = Math.max(Number(page) || 1, 1);
    const pageLimit = Math.max(Number(limit) || 20, 1);

    const offset = (pageNumber - 1) * pageLimit;

    // --------------------------------------------------
    // GET GATE ENTRIES + PURCHASE ORDERS
    // --------------------------------------------------
    const { rows, count } = await GateEntry.findAndCountAll({
      where,

      include: [
        ...(detailIncludes || []),

        {
          model: GateEntryPurchaseOrder,
          as: "purchaseOrders",
          required: false,
          where: {
            is_deleted: false,
          },
        },
      ],

      order: [["entry_time", "DESC"]],

      limit: pageLimit,

      offset,

      distinct: true,
    });

    // --------------------------------------------------
    // FORMAT RESPONSE
    // --------------------------------------------------
    const data = rows.map((gateEntry) => {
      const item = gateEntry.toJSON();

      return {
        ...item,

        purchase_orders: item.purchaseOrders || [],

        // Optional: remove Sequelize association name
        purchaseOrders: undefined,
      };
    });

    // --------------------------------------------------
    // RESPONSE
    // --------------------------------------------------
    return res.status(200).json({
      success: true,

      data,

      pagination: {
        total: count,
        page: pageNumber,
        limit: pageLimit,
        totalPages: Math.ceil(count / pageLimit),
      },
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
        vehicle_id,
        driver_id,
        vendor_id,
        po_id,
        material_id,
        so_id,
        challan_no,
        expected_qty,
        driver_photo_url,
        plant_id,
        entry_type = "purchase",
        remarks,
      } = req.body;

      if (!["purchase", "other", "sales"].includes(entry_type)) {
        throw createError(
          400,
          "entry_type must be 'purchase', 'other' or 'sales'",
        );
      }
      if (!vehicle_id || !driver_id) {
        throw createError(400, "vehicle_id and driver_id are required");
      }
      if (entry_type === "purchase" && (!vendor_id || !material_id)) {
        throw createError(
          400,
          "vendor_id and material_id are required for a purchase entry",
        );
      }
      if (entry_type === "sales" && !so_id) {
        throw createError(
          400,
          "so_id is required for a sales (outbound loading) entry",
        );
      }

      const { vehicle, material, salesOrder } = await validateReferences({
        vehicle_id,
        driver_id,
        vendor_id,
        material_id,
        po_id,
        so_id,
        entry_type,
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
        material_id:
          entry_type === "sales"
            ? salesOrder
              ? salesOrder.material_id
              : null
            : material_id || null,
        challan_no,
        expected_qty,
        remarks,
        driver_photo_url,
        entry_time: new Date(),
        gate_status: "waiting_token",
        plant_id: plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      const created = await GateEntry.findByPk(entry.id, {
        include: detailIncludes,
      });
      res
        .status(201)
        .json({ success: true, msg: "Gate entry created", data: created });
    } catch (err) {
      next(err);
    }
  },

  update: async (req, res, next) => {
    try {
      const entry = await GateEntry.findOne({
        where: { id: req.params.id, is_deleted: false },
      });
      if (!entry) throw createError(404, "Gate entry not found");

      const {
        vehicle_id,
        driver_id,
        vendor_id,
        po_id,
        material_id,
        so_id,
        challan_no,
        expected_qty,
        driver_photo_url,
        plant_id,
        gate_status,
        entry_type,
        remarks,
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
        vehicle_id,
        driver_id,
        vendor_id,
        po_id,
        material_id,
        so_id,
        challan_no,
        expected_qty,
        driver_photo_url,
        plant_id,
        gate_status,
        entry_type,
        remarks,
      };
      Object.keys(updates).forEach(
        (key) => updates[key] === undefined && delete updates[key],
      );
      updates.updated_by = req.user ? req.user.id : null;

      await entry.update(updates);

      const updated = await GateEntry.findByPk(entry.id, {
        include: detailIncludes,
      });
      res
        .status(200)
        .json({ success: true, msg: "Gate entry updated", data: updated });
    } catch (err) {
      next(err);
    }
  },

  delete: async (req, res, next) => {
    try {
      const entry = await GateEntry.findOne({
        where: { id: req.params.id, is_deleted: false },
      });
      if (!entry) throw createError(404, "Gate entry not found");

      await entry.update({
        is_deleted: true,
        updated_by: req.user ? req.user.id : null,
      });
      res.status(200).json({ success: true, msg: "Gate entry deleted" });
    } catch (err) {
      next(err);
    }
  },

  checkIn: async (req, res, next) => {
    try {
      const { id } = req.body;
      if (!id) throw createError(400, "id is required");

      const entry = await GateEntry.findOne({
        where: { id, is_deleted: false },
      });
      if (!entry) throw createError(404, "Gate entry not found");

      if (entry.gate_status !== "waiting_token") {
        throw createError(
          400,
          `Cannot check in a gate entry with status '${entry.gate_status}'`,
        );
      }

      // Purchase trucks join the normal Sampling -> Lab -> Negotiation queue.
      // Empty/miscellaneous trucks (entry_type = "other") skip all of that and
      // go straight into the weighment queue instead. Sales (outbound loading)
      // trucks go straight into the loading queue.
      let nextStatus = "waiting_sampling";
      if (entry.entry_type === "other") nextStatus = "waiting_weighment";
      else if (entry.entry_type === "sales") nextStatus = "waiting_loading";

      await entry.update({
        gate_status: nextStatus,
        updated_by: req.user ? req.user.id : null,
      });

      const updated = await GateEntry.findByPk(entry.id, {
        include: detailIncludes,
      });
      res
        .status(200)
        .json({ success: true, msg: "Vehicle checked in", data: updated });
    } catch (err) {
      next(err);
    }
  },

  sendToWarehouse: async (req, res, next) => {
    try {
      const { id, warehouse_id, remarks } = req.body;
      if (!id) throw createError(400, "id is required");

      const entry = await GateEntry.findOne({
        where: { id, is_deleted: false },
      });
      if (!entry) throw createError(404, "Gate entry not found");

      if (entry.entry_type !== "other") {
        throw createError(
          400,
          "Only empty/miscellaneous (entry_type = 'other') gate entries can be sent to warehouse directly",
        );
      }
      if (!["waiting_weighment", "in_process"].includes(entry.gate_status)) {
        throw createError(
          400,
          `Cannot send a gate entry with status '${entry.gate_status}' to warehouse; it must be 'waiting_weighment' or 'in_process'`,
        );
      }

      const updates = {
        gate_status: "unloaded",
        updated_by: req.user ? req.user.id : null,
      };
      if (warehouse_id) updates.received_warehouse_id = warehouse_id;
      if (remarks) updates.remarks = remarks;

      await entry.update(updates);

      const updated = await GateEntry.findByPk(entry.id, {
        include: detailIncludes,
      });
      res
        .status(200)
        .json({ success: true, msg: "Truck sent to warehouse", data: updated });
    } catch (err) {
      next(err);
    }
  },

  checkOut: async (req, res, next) => {
    try {
      const { id } = req.body;
      if (!id) throw createError(400, "id is required");

      const entry = await GateEntry.findOne({
        where: { id, is_deleted: false },
      });
      if (!entry) throw createError(404, "Gate entry not found");

      if (entry.gate_status === "exited") {
        throw createError(400, "This gate entry has already exited");
      }
      if (entry.gate_status === "waiting_token") {
        throw createError(
          400,
          "Vehicle has not been checked in yet; cannot check out",
        );
      }
      if (entry.entry_type === "sales" && entry.gate_status !== "loaded") {
        throw createError(
          400,
          `Cannot check out a sales truck with status '${entry.gate_status}'; it must be 'loaded' first (see the Loading module)`,
        );
      }

      await entry.update({
        gate_status: "exited",
        exit_time: new Date(),
        updated_by: req.user ? req.user.id : null,
      });

      const updated = await GateEntry.findByPk(entry.id, {
        include: detailIncludes,
      });
      res
        .status(200)
        .json({ success: true, msg: "Vehicle checked out", data: updated });
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

    // =====================================================
    // BASIC VALIDATION
    // =====================================================

    if (!["purchase", "other", "sales"].includes(entry_type)) {
      throw createError(
        400,
        "entry_type must be 'purchase', 'other' or 'sales'",
      );
    }

    if (!vehicle_id || !driver_id) {
      throw createError(
        400,
        "vehicle_id and driver_id are required",
      );
    }

    // =====================================================
    // PURCHASE VALIDATION
    // =====================================================

    if (entry_type === "purchase") {
      if (!vendor_id) {
        throw createError(
          400,
          "vendor_id is required for a purchase entry",
        );
      }

      if (
        !Array.isArray(purchase_orders) ||
        purchase_orders.length === 0
      ) {
        throw createError(
          400,
          "purchase_orders must be a non-empty array",
        );
      }
    }

    // =====================================================
    // SALES VALIDATION
    // =====================================================

    if (entry_type === "sales" && !so_id) {
      throw createError(
        400,
        "so_id is required for a sales entry",
      );
    }

    // =====================================================
    // VALIDATE VEHICLE / DRIVER / VENDOR / SALES ORDER
    // =====================================================

    const { vehicle, salesOrder } = await validateReferences({
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
      // ===================================================
      // GENERATE TOKEN
      // ===================================================

      const token_no = await generateTokenNo(
        vehicle.vehicle_no,
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

          // Multi PO purchase entry
          po_id: null,

          // Sales order
          so_id:
            entry_type === "sales"
              ? so_id
              : null,

          // Material is only stored on header for sales
          material_id:
            entry_type === "sales"
              ? salesOrder
                ? salesOrder.material_id
                : null
              : null,

          challan_no: challan_no || null,

          expected_qty:
            expected_qty !== undefined &&
            expected_qty !== null &&
            expected_qty !== ""
              ? Number(expected_qty)
              : null,

          remarks: remarks || null,

          driver_photo_url:
            driver_photo_url || null,

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
        },
      );

      // ===================================================
      // PURCHASE
      // ===================================================

      if (entry_type === "purchase") {
        const GateEntryPurchaseOrder = require(
          "../models/gateEntryPurchaseOrder.model"
        );

        // -------------------------------------------------
        // Prevent duplicate PO IDs in same request
        // -------------------------------------------------

        const poIds = purchase_orders.map((po) =>
          Number(po.po_id),
        );

        const uniquePoIds = new Set(poIds);

        if (uniquePoIds.size !== poIds.length) {
          throw createError(
            400,
            "The same purchase order cannot be selected more than once",
          );
        }

        // -------------------------------------------------
        // PROCESS EACH PO
        // -------------------------------------------------

        for (const po of purchase_orders) {
          // ===============================================
          // PO ID VALIDATION
          // ===============================================

          const poId = Number(po.po_id);

          if (!Number.isInteger(poId) || poId <= 0) {
            throw createError(
              400,
              `Invalid purchase order ID: ${po.po_id}`,
            );
          }

          // ===============================================
          // MATERIAL ARRAY VALIDATION
          // ===============================================

          if (
            !Array.isArray(po.materials) ||
            po.materials.length === 0
          ) {
            throw createError(
              400,
              `PO ${poId} must contain at least one material`,
            );
          }

          // ===============================================
          // CHECK APPROVED PO
          // ===============================================

          /*
           * IMPORTANT:
           *
           * purchase_order now stores its materials in the
           * JSON `items` column — [{ material_id, variety_id,
           * qty, rate }, ...] — NOT in a flat material_id
           * column on this row (that column is legacy/unused
           * by bulkCreate). Fetch the PO itself here; material
           * membership + ordered qty are checked below against
           * `purchaseOrder.items`.
           */

          const purchaseOrder =
            await PurchaseOrder.findOne({
              where: {
                id: poId,

                vendor_id: Number(vendor_id),

                approval_status: "approved",

                is_deleted: false,
              },

              transaction: t,

              lock: t.LOCK.UPDATE,
            });

          if (!purchaseOrder) {
            throw createError(
              400,
              `Invalid or unapproved purchase order: ${poId}`,
            );
          }

          const poItems = Array.isArray(purchaseOrder.items)
            ? purchaseOrder.items
            : [];

          // ===============================================
          // PREVENT DUPLICATE MATERIALS IN SAME PO
          // ===============================================

          const materialIds = po.materials.map(
            (material) =>
              Number(material.material_id),
          );

          const uniqueMaterialIds =
            new Set(materialIds);

          if (
            uniqueMaterialIds.size !==
            materialIds.length
          ) {
            throw createError(
              400,
              `The same material cannot be selected more than once for PO ${poId}`,
            );
          }

          // ===============================================
          // PROCESS MATERIALS
          // ===============================================

          for (const material of po.materials) {
            const materialId = Number(
              material.material_id,
            );

            // ---------------------------------------------
            // MATERIAL ID VALIDATION
            // ---------------------------------------------

            if (
              !Number.isInteger(materialId) ||
              materialId <= 0
            ) {
              throw createError(
                400,
                `Valid material_id is required for PO ${poId}`,
              );
            }

            // ---------------------------------------------
            // QUANTITY VALIDATION
            // ---------------------------------------------

            const receivedQty = Number(
              material.qty,
            );

            if (
              !Number.isFinite(receivedQty) ||
              receivedQty <= 0
            ) {
              throw createError(
                400,
                `Valid quantity is required for material ${materialId} in PO ${poId}`,
              );
            }

            // ---------------------------------------------
            // CHECK MATERIAL MASTER
            // ---------------------------------------------

            const materialMaster =
              await MaterialMaster.findOne({
                where: {
                  id: materialId,
                  is_deleted: false,
                },

                transaction: t,
              });

            if (!materialMaster) {
              throw createError(
                400,
                `Invalid material_id: ${materialId}`,
              );
            }

            // ---------------------------------------------
            // CHECK MATERIAL BELONGS TO PO
            // ---------------------------------------------

            /*
             * VERY IMPORTANT:
             *
             * Do NOT re-query PurchaseOrder with a flat
             * material_id filter here — bulkCreate never
             * populates that column, so it would always miss.
             * Membership + ordered qty live in
             * purchaseOrder.items (JSON), fetched above.
             */

            const poItem = poItems.find(
              (it) => Number(it.material_id) === materialId,
            );

            if (!poItem) {
              throw createError(
                400,
                `Material ${materialId} does not belong to PO ${poId}`,
              );
            }

            // ---------------------------------------------
            // CHECK ORDERED QUANTITY
            // ---------------------------------------------

            const orderedQty = Number(
              poItem.qty,
            );

            if (
              Number.isFinite(orderedQty) &&
              receivedQty > orderedQty
            ) {
              throw createError(
                400,
                `Received quantity ${receivedQty} exceeds ordered quantity ${orderedQty} for material ${materialId} in PO ${poId}`,
              );
            }

            // ---------------------------------------------
            // CREATE GATE ENTRY PO RELATION
            // ---------------------------------------------

            await GateEntryPurchaseOrder.create(
              {
                gate_entry_id: entry.id,

                po_id: poId,

                material_id: materialId,

                qty: receivedQty,
              },
              {
                transaction: t,
              },
            );
          }
        }
      }

      // ===================================================
      // COMMIT TRANSACTION
      // ===================================================

      await t.commit();

      // ===================================================
      // GET COMPLETE ENTRY
      // ===================================================

      const created = await GateEntry.findByPk(
        entry.id,
        {
          include: detailIncludes,
        },
      );

      // ===================================================
      // RESPONSE
      // ===================================================

      return res.status(201).json({
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
      if (!req.file)
        throw createError(
          400,
          "No photo file received (field name must be 'photo')",
        );
      const url = `/uploads/${req.file.filename}`;
      res
        .status(201)
        .json({ success: true, msg: "Photo uploaded", data: { url } });
    } catch (err) {
      next(err);
    }
  },
};
