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
  GateEntrySalesOrder,
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
    // GET GATE ENTRIES
    // --------------------------------------------------

    const { rows, count } = await GateEntry.findAndCountAll({
      where,

      include: [
        // Existing Gate Entry details
        ...(detailIncludes || []),

        // ------------------------------------------------
        // PURCHASE ORDERS
        // ------------------------------------------------

        {
          model: GateEntryPurchaseOrder,
          as: "purchaseOrders",
          required: false,
          where: {
            is_deleted: false,
          },
        },

        // ------------------------------------------------
        // SALES ORDER
        // ------------------------------------------------

        {
          model: SalesOrder,
          as: "salesOrder",
          required: false,
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

        // Purchase orders
        purchase_orders: item.purchaseOrders || [],

        // Sales order
        sales_orders: item.salesOrders || [],

        // Remove Sequelize association names
        purchaseOrders: undefined,
        salesOrder: undefined,
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
      else if (entry.entry_type === "sales") nextStatus = "waiting_weighment";

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
  const t = await sequelize.transaction();

  try {
    const {
      vehicle_id,
      driver_id,
      vendor_id,
      customer_id,
      challan_no,
      expected_qty,
      plant_id,
      entry_type,

      // Purchase Orders
      purchase_orders = [],

      // Sales Orders
      sales_orders = [],
    } = req.body || {};

    // ============================================================
    // 1. BASIC VALIDATION
    // ============================================================

    if (!vehicle_id) {
      throw createError(400, "vehicle_id is required");
    }

    if (!driver_id) {
      throw createError(400, "driver_id is required");
    }

    if (!entry_type) {
      throw createError(400, "entry_type is required");
    }

    if (!["purchase", "sales"].includes(entry_type)) {
      throw createError(
        400,
        "entry_type must be either purchase or sales"
      );
    }

    // ============================================================
    // 2. PURCHASE VALIDATION
    // ============================================================

    if (entry_type === "purchase") {
      if (
        !Array.isArray(purchase_orders) ||
        purchase_orders.length === 0
      ) {
        throw createError(
          400,
          "purchase_orders is required and must contain at least one Purchase Order"
        );
      }

      if (!vendor_id) {
        throw createError(
          400,
          "vendor_id is required for a purchase entry"
        );
      }
    }

    // ============================================================
    // 3. SALES VALIDATION
    // ============================================================

    if (entry_type === "sales") {
      if (
        !Array.isArray(sales_orders) ||
        sales_orders.length === 0
      ) {
        throw createError(
          400,
          "sales_orders is required and must contain at least one Sales Order"
        );
      }

      if (!customer_id) {
        throw createError(
          400,
          "customer_id is required for a sales entry"
        );
      }
    }

    // ============================================================
    // 4. RESOLVE PLANT
    // ============================================================

    const resolvedPlantId =
      plant_id ||
      (req.user ? req.user.plant_id : null);

    // ============================================================
    // 5. GET VEHICLE
    // ============================================================

    /*
     * IMPORTANT:
     * generateTokenNo() needs the actual vehicle number.
     *
     * Example:
     * vehicle_id = 1
     * vehicle_no = MP09 AB 1234
     *
     * Generated token:
     * GT-MP09AB1234-0001
     */

    const vehicle = await Vehicle.findOne({
      where: {
        id: vehicle_id,
        is_deleted: false,
      },
      transaction: t,
    });

    if (!vehicle) {
      throw createError(
        400,
        `Invalid vehicle_id: ${vehicle_id}`
      );
    }

    // Change vehicle_no to your actual column name if different.
    const vehicleNo =
      vehicle.vehicle_no ||
      vehicle.vehicle_number ||
      vehicle.registration_no ||
      vehicle.reg_no;

    if (!vehicleNo) {
      throw createError(
        400,
        `Vehicle ${vehicle_id} does not have a vehicle number`
      );
    }

    // ============================================================
    // 6. VALIDATE SALES ORDERS
    // ============================================================

    const validatedSalesOrders = [];

    if (entry_type === "sales") {
      for (const soItem of sales_orders) {
        const {
          so_id,
          materials,
        } = soItem || {};

        // --------------------------------------------------------
        // SO ID
        // --------------------------------------------------------

        if (!so_id) {
          throw createError(
            400,
            "so_id is required for every sales order"
          );
        }

        // --------------------------------------------------------
        // MATERIALS
        // --------------------------------------------------------

        if (
          !Array.isArray(materials) ||
          materials.length === 0
        ) {
          throw createError(
            400,
            `materials are required for Sales Order ${so_id}`
          );
        }

        // --------------------------------------------------------
        // FIND SALES ORDER
        // --------------------------------------------------------

        const salesOrder = await SalesOrder.findOne({
          where: {
            id: so_id,
            is_deleted: false,
          },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (!salesOrder) {
          throw createError(
            400,
            `Sales Order ${so_id} not found`
          );
        }

        // --------------------------------------------------------
        // CUSTOMER VALIDATION
        // --------------------------------------------------------

        if (
          customer_id &&
          Number(salesOrder.customer_id) !==
            Number(customer_id)
        ) {
          throw createError(
            400,
            `Sales Order ${so_id} does not belong to customer ${customer_id}`
          );
        }

        // --------------------------------------------------------
        // APPROVAL VALIDATION
        // --------------------------------------------------------

        if (
          salesOrder.approval_status !==
          "approved"
        ) {
          throw createError(
            400,
            `Sales Order ${so_id} is not approved`
          );
        }

        // --------------------------------------------------------
        // STATUS VALIDATION
        // --------------------------------------------------------

        if (
          ["cancelled", "closed"].includes(
            salesOrder.so_status
          )
        ) {
          throw createError(
            400,
            `Sales Order ${so_id} is ${salesOrder.so_status}`
          );
        }

        // --------------------------------------------------------
        // GET ITEMS FROM JSON
        // --------------------------------------------------------

        let soItems = salesOrder.items || [];

        if (typeof soItems === "string") {
          try {
            soItems = JSON.parse(soItems);
          } catch (error) {
            throw createError(
              400,
              `Invalid items JSON in Sales Order ${so_id}`
            );
          }
        }

        if (!Array.isArray(soItems)) {
          throw createError(
            400,
            `Invalid items data in Sales Order ${so_id}`
          );
        }

        // --------------------------------------------------------
        // VALIDATE REQUESTED MATERIALS
        // --------------------------------------------------------

        const requestedMaterialIds = new Set();
        const validatedMaterials = [];

        for (const materialItem of materials) {
          const {
            material_id,
            qty,
          } = materialItem || {};

          // ------------------------------------------------------
          // MATERIAL ID
          // ------------------------------------------------------

          if (!material_id) {
            throw createError(
              400,
              `material_id is required for Sales Order ${so_id}`
            );
          }

          const materialKey =
            Number(material_id);

          // ------------------------------------------------------
          // DUPLICATE MATERIAL
          // ------------------------------------------------------

          if (
            requestedMaterialIds.has(
              materialKey
            )
          ) {
            throw createError(
              400,
              `Duplicate material ${material_id} in Sales Order ${so_id}`
            );
          }

          requestedMaterialIds.add(
            materialKey
          );

          // ------------------------------------------------------
          // REQUESTED QTY
          // ------------------------------------------------------

          const requestedQty =
            Number(qty);

          if (
            !Number.isFinite(
              requestedQty
            ) ||
            requestedQty <= 0
          ) {
            throw createError(
              400,
              `qty must be greater than 0 for Sales Order ${so_id}, material ${material_id}`
            );
          }

          // ------------------------------------------------------
          // FIND MATERIAL INSIDE JSON ITEMS
          // ------------------------------------------------------

          const soMaterial =
            soItems.find(
              (item) =>
                Number(
                  item.material_id
                ) ===
                Number(material_id)
            );

          if (!soMaterial) {
            throw createError(
              400,
              `Sales Order ${so_id} does not contain material ${material_id}`
            );
          }

          // ------------------------------------------------------
          // ORDERED QTY
          // ------------------------------------------------------

          const orderedQty =
            Number(
              soMaterial.qty || 0
            );

          if (
            !Number.isFinite(
              orderedQty
            ) ||
            orderedQty <= 0
          ) {
            throw createError(
              400,
              `Invalid ordered quantity for Sales Order ${so_id}, material ${material_id}`
            );
          }

          // ------------------------------------------------------
          // DISPATCHED QTY
          // ------------------------------------------------------

          const dispatchedQty =
            Number(
              soMaterial.dispatched_qty ||
                0
            );

          // ------------------------------------------------------
          // REMAINING QTY
          // ------------------------------------------------------

          const remainingQty =
            orderedQty -
            dispatchedQty;

          if (
            remainingQty <= 0
          ) {
            throw createError(
              400,
              `Sales Order ${so_id}, material ${material_id} has no remaining quantity`
            );
          }

          // ------------------------------------------------------
          // CHECK REQUESTED QTY
          // ------------------------------------------------------

          if (
            requestedQty >
            remainingQty
          ) {
            throw createError(
              400,
              `Requested quantity ${requestedQty} exceeds remaining quantity ${remainingQty} for Sales Order ${so_id}, material ${material_id}`
            );
          }

          // ------------------------------------------------------
          // SAVE VALIDATED MATERIAL
          // ------------------------------------------------------

          validatedMaterials.push({
            so_id:
              salesOrder.id,

            material_id:
              Number(
                soMaterial.material_id
              ),

            qty:
              requestedQty,

            rate:
              Number(
                soMaterial.rate || 0
              ),

            ordered_qty:
              orderedQty,

            dispatched_qty:
              dispatchedQty,

            remaining_qty:
              remainingQty,

            salesOrder,
          });
        }

        // --------------------------------------------------------
        // SAVE VALIDATED SO
        // --------------------------------------------------------

        validatedSalesOrders.push({
          so_id:
            salesOrder.id,

          so_no:
            salesOrder.so_no,

          customer_id:
            salesOrder.customer_id,

          materials:
            validatedMaterials,

          salesOrder,
        });
      }
    }

    // ============================================================
    // 7. CALCULATE TOTAL EXPECTED QTY
    // ============================================================

    let calculatedTotalQty = 0;

    if (entry_type === "sales") {
      calculatedTotalQty =
        validatedSalesOrders.reduce(
          (total, so) => {
            return (
              total +
              so.materials.reduce(
                (
                  materialTotal,
                  material
                ) =>
                  materialTotal +
                  Number(
                    material.qty || 0
                  ),
                0
              )
            );
          },
          0
        );
    }

    // ============================================================
    // 8. VALIDATE EXPECTED QTY
    // ============================================================

    if (
      entry_type === "sales" &&
      expected_qty !== undefined &&
      expected_qty !== null
    ) {
      const expectedQtyNum =
        Number(expected_qty);

      if (
        !Number.isFinite(
          expectedQtyNum
        ) ||
        expectedQtyNum <= 0
      ) {
        throw createError(
          400,
          "expected_qty must be greater than 0"
        );
      }

      if (
        Math.abs(
          expectedQtyNum -
            calculatedTotalQty
        ) > 0.01
      ) {
        throw createError(
          400,
          `expected_qty ${expectedQtyNum} does not match total Sales Order quantity ${calculatedTotalQty}`
        );
      }
    }

    // ============================================================
    // 9. GENERATE TOKEN NUMBER
    // ============================================================

    /*
     * Pass the actual vehicle number here.
     *
     * Example:
     * vehicleNo = "MP09 AB 1234"
     *
     * Helper cleans it:
     * MP09AB1234
     *
     * Result:
     * GT-MP09AB1234-0001
     */

    const token_no =
      await generateTokenNo(vehicleNo);

    // ============================================================
    // 10. CREATE GATE ENTRY
    // ============================================================

    const gateEntryData = {
      token_no,

      vehicle_id,

      driver_id,

      vendor_id:
        entry_type === "purchase"
          ? vendor_id || null
          : null,

      customer_id:
        entry_type === "sales"
          ? customer_id || null
          : null,

      challan_no:
        challan_no || null,

      expected_qty:
        expected_qty !== undefined &&
        expected_qty !== null
          ? Number(expected_qty)
          : entry_type === "sales"
          ? calculatedTotalQty
          : null,

      plant_id:
        resolvedPlantId,

      entry_type,

      so_id: null,

      material_id: null,

      gate_status:
        "waiting_token",

      created_by:
        req.user
          ? req.user.id
          : null,
    };

    const gateEntry =
      await GateEntry.create(
        gateEntryData,
        {
          transaction: t,
        }
      );

    // ============================================================
    // 11. CREATE SALES ORDER RELATION RECORDS
    // ============================================================

    if (entry_type === "sales") {
      const salesOrderRows = [];

      for (
        const soItem
        of validatedSalesOrders
      ) {
        for (
          const material
          of soItem.materials
        ) {
          salesOrderRows.push({
            gate_entry_id:
              gateEntry.id,

            so_id:
              material.so_id,

            material_id:
              material.material_id,

            qty:
              material.qty,

            plant_id:
              resolvedPlantId,

            created_by:
              req.user
                ? req.user.id
                : null,

            updated_by:
              null,

            is_deleted:
              false,
          });
        }
      }

      if (
        salesOrderRows.length > 0
      ) {
        await GateEntrySalesOrder.bulkCreate(
          salesOrderRows,
          {
            transaction: t,
          }
        );
      }
    }

    // ============================================================
    // 12. PURCHASE ORDER PROCESSING
    // ============================================================

    if (entry_type === "purchase") {
      const purchaseOrderRows = [];

      for (
        const poItem
        of purchase_orders
      ) {
        const {
          po_id,
          materials,
        } = poItem || {};

        // --------------------------------------------------------
        // PO ID
        // --------------------------------------------------------

        if (!po_id) {
          throw createError(
            400,
            "po_id is required for every purchase order"
          );
        }

        // --------------------------------------------------------
        // MATERIALS
        // --------------------------------------------------------

        if (
          !Array.isArray(
            materials
          ) ||
          materials.length === 0
        ) {
          throw createError(
            400,
            `materials are required for Purchase Order ${po_id}`
          );
        }

        // --------------------------------------------------------
        // PROCESS MATERIALS
        // --------------------------------------------------------

        for (
          const material
          of materials
        ) {
          const {
            material_id,
            qty,
          } = material || {};

          if (!material_id) {
            throw createError(
              400,
              `material_id is required for Purchase Order ${po_id}`
            );
          }

          const requestedQty =
            Number(qty);

          if (
            !Number.isFinite(
              requestedQty
            ) ||
            requestedQty <= 0
          ) {
            throw createError(
              400,
              `qty must be greater than 0 for Purchase Order ${po_id}, material ${material_id}`
            );
          }

          purchaseOrderRows.push({
            gate_entry_id:
              gateEntry.id,

            po_id,

            material_id,

            qty:
              requestedQty,

            plant_id:
              resolvedPlantId,

            created_by:
              req.user
                ? req.user.id
                : null,

            updated_by:
              null,

            is_deleted:
              false,
          });
        }
      }

      // ----------------------------------------------------------
      // BULK CREATE PO RELATIONS
      // ----------------------------------------------------------

      if (
        purchaseOrderRows.length > 0
      ) {
        await GateEntryPurchaseOrder.bulkCreate(
          purchaseOrderRows,
          {
            transaction: t,
          }
        );
      }
    }

    // ============================================================
    // 13. COMMIT TRANSACTION
    // ============================================================

    await t.commit();

    // ============================================================
    // 14. GET CREATED GATE ENTRY
    // ============================================================

    const createdGateEntry =
      await GateEntry.findByPk(
        gateEntry.id,
        {
          include: [
            {
              model:
                GateEntrySalesOrder,

              as:
                "sales_orders",

              required:
                false,

              include: [
                {
                  model:
                    SalesOrder,

                  as:
                    "sales_orders",

                  required:
                    false,
                },
              ],
            },

            {
              model:
                GateEntryPurchaseOrder,

              as:
                "purchase_orders",

              required:
                false,
            },
          ],
        }
      );

    // ============================================================
    // 15. RESPONSE
    // ============================================================

    return res.status(201).json({
      success: true,

      msg:
        entry_type === "sales"
          ? "Gate entry created with Sales Order(s)"
          : "Gate entry created with Purchase Order(s)",

      data:
        createdGateEntry,
    });

  } catch (err) {

    // ============================================================
    // ROLLBACK
    // ============================================================

    try {
      if (!t.finished) {
        await t.rollback();
      }
    } catch (rollbackError) {
      console.error(
        "Transaction rollback error:",
        rollbackError
      );
    }

    console.error(
      "GENERATE TOKEN ERROR:",
      err
    );

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
