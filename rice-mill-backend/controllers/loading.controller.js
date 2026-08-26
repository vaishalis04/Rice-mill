const createError = require("http-errors");
const { Loading, GateEntry, SalesOrder, Customer, MaterialMaster, Vehicle, Driver, User, Sampling, LabTest ,GateEntrySalesOrder } = require("../models/index");
const { generateLoadingNo } = require("../helpers/helperFunction");

const detailIncludes = [
  {
    model: GateEntry,
    as: "gateEntry",
    attributes: ["id", "token_no", "gate_status", "vehicle_id", "driver_id"],
    include: [
      { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
      { model: Driver, as: "driver", attributes: ["id", "name", "mobile"] },
      {
        model: Sampling,
        as: "samplings",
        attributes: ["id", "sample_code"],
        include: [{ model: LabTest, as: "labTest", attributes: ["id", "comment"] }],
      },
    ],
  },
  {
    model: SalesOrder,
    as: "salesOrder",
    attributes: ["id", "so_no", "customer_id", "material_id", "qty", "rate", "so_status"],
    include: [
      { model: Customer, as: "customer", attributes: ["id", "customer_code", "name"] },
      { model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name"] },
    ],
  },
  { model: User, as: "operator", attributes: ["id", "username", "email"] },
];

module.exports = {
  // GET /api/loading?gate_entry_id=&so_id=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { gate_entry_id, so_id, page = 1, limit = 20 } = req.query;

      const where = { is_deleted: false };
      if (gate_entry_id) where.gate_entry_id = gate_entry_id;
      if (so_id) where.so_id = so_id;

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await Loading.findAndCountAll({
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

  // GET /api/loading/:id
  getById: async (req, res, next) => {
    try {
      const loading = await Loading.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: detailIncludes,
      });
      if (!loading) throw createError(404, "Loading record not found");
      res.status(200).json({ success: true, data: loading });
    } catch (err) {
      next(err);
    }
  },

 create: async (req, res, next) => {
  try {
    const { gate_entry_id, loaded_qty, loaded_at, remarks, plant_id, material_quantities } = req.body;
    
    // Validate required fields
    if (!gate_entry_id || loaded_qty === undefined) {
      throw createError(400, "gate_entry_id and loaded_qty are required");
    }
    if (!(Number(loaded_qty) > 0)) throw createError(400, "loaded_qty must be greater than 0");
    
    // Validate material quantities
    if (!material_quantities || !Array.isArray(material_quantities) || material_quantities.length === 0) {
      throw createError(400, "material_quantities array is required with at least one material");
    }

    // Fetch gate entry with its sales order relationships
    const gateEntry = await GateEntry.findOne({
      where: { id: gate_entry_id, is_deleted: false },
      include: [
        {
          model: GateEntrySalesOrder,
          as: 'sales_orders',
          required: false,
          include: [
            {
              model: SalesOrder,
              as: 'sales_order',
              required: false
            },
            {
              model: MaterialMaster,
              as: 'material',
              required: false
            }
          ]
        }
      ]
    });
    
    if (!gateEntry) throw createError(400, "Invalid gate_entry_id");
    
    // Validate entry type
    if (gateEntry.entry_type !== "sales") {
      throw createError(400, "Only entry_type = 'sales' gate entries can be loaded here");
    }
    
    // Validate gate status
    if (gateEntry.gate_status !== "waiting_loading") {
      throw createError(400, `Cannot load a gate entry with status '${gateEntry.gate_status}'; it must be 'waiting_loading' (checked in)`);
    }

    // Check for existing loading record
    const existing = await Loading.findOne({ 
      where: { gate_entry_id, is_deleted: false } 
    });
    if (existing) throw createError(409, "A loading record already exists for this gate entry");

    // Validate each material quantity
    const validatedMaterials = [];
    let totalLoadedQty = 0;
    let soId = null;
    
    for (const materialQty of material_quantities) {
      const { so_id, material_id, qty } = materialQty;
      
      if (!so_id) {
        throw createError(400, "so_id is required for each material quantity");
      }
      
      if (!material_id) {
        throw createError(400, "material_id is required for each material quantity");
      }
      
      if (!qty || Number(qty) <= 0) {
        throw createError(400, `Valid quantity required for material ${material_id} in SO ${so_id}`);
      }
      
      // Set the SO ID (should be the same for all materials)
      if (!soId) {
        soId = so_id;
      } else if (soId !== so_id) {
        throw createError(400, "All materials must belong to the same Sales Order");
      }
      
      // Find the junction record for this SO and material
      const junctionRecord = await GateEntrySalesOrder.findOne({
        where: {
          gate_entry_id: gateEntry.id,
          so_id: so_id,
          material_id: material_id,
          is_deleted: false
        },
        include: [
          {
            model: SalesOrder,
            as: 'sales_order',
            required: false
          },
          {
            model: MaterialMaster,
            as: 'material',
            required: false
          }
        ]
      });
      
      if (!junctionRecord) {
        throw createError(400, `Material ${material_id} in Sales Order ${so_id} is not linked to this gate entry`);
      }
      
      // Get the sales order
      const so = await SalesOrder.findOne({ 
        where: { id: so_id, is_deleted: false } 
      });
      
      if (!so) throw createError(400, `Sales Order ${so_id} not found`);
      
      // Check sales order status
      if (["dispatched", "closed", "cancelled"].includes(so.so_status)) {
        throw createError(400, `Sales Order ${so.so_no} is already '${so.so_status}' and cannot be loaded against`);
      }
      
      // Get items from sales order
      let soItems = so.items || [];
      if (typeof soItems === "string") {
        try {
          soItems = JSON.parse(soItems);
        } catch (e) {
          soItems = [];
        }
      }
      
      // Find the material in items
      const soItem = soItems.find(item => Number(item.material_id) === Number(material_id));
      if (!soItem) {
        throw createError(400, `Material ${material_id} not found in Sales Order ${so.so_no}`);
      }
      
      // Calculate remaining quantity for this material
      const orderedQty = Number(soItem.qty || 0);
      const dispatchedQty = Number(soItem.dispatched_qty || 0);
      const remainingQty = orderedQty - dispatchedQty;
      
      if (Number(qty) > remainingQty) {
        throw createError(400, `Loaded qty (${qty}) for material ${junctionRecord.material?.name || material_id} in SO ${so.so_no} exceeds remaining qty (${remainingQty})`);
      }
      
      totalLoadedQty += Number(qty);
      
      validatedMaterials.push({
        so_id: so_id,
        so_no: so.so_no,
        material_id: material_id,
        material_name: junctionRecord.material?.name || `Material ${material_id}`,
        qty: Number(qty),
        ordered_qty: orderedQty,
        dispatched_qty: dispatchedQty,
        remaining_qty: remainingQty - Number(qty),
        salesOrder: so,
        junctionRecord: junctionRecord,
        soItem: soItem,
        soItems: soItems
      });
    }
    
    // Validate total loaded quantity matches
    if (Math.abs(Number(loaded_qty) - totalLoadedQty) > 0.01) {
      throw createError(400, `Total loaded_qty (${loaded_qty}) does not match sum of material quantities (${totalLoadedQty})`);
    }

    // Generate loading number
    const loading_no = await generateLoadingNo();

    // Create a SINGLE loading record (since Loading table doesn't have material_id)
    const loading = await Loading.create({
      loading_no,
      gate_entry_id,
      so_id: soId, // Use the SO ID from the first material
      loaded_qty: loaded_qty, // Use the total loaded quantity
      loaded_at: loaded_at || new Date(),
      loading_operator_id: req.user ? req.user.id : null,
      remarks: remarks || `Loaded ${validatedMaterials.length} material(s)`,
      plant_id: plant_id || gateEntry.plant_id || (req.user ? req.user.plant_id : null),
      created_by: req.user ? req.user.id : null,
    });

    // Update gate entry status to 'loaded'
    await gateEntry.update({ 
      gate_status: "loaded", 
      updated_by: req.user ? req.user.id : null 
    });

    // Update the sales order's dispatched quantity and items
    const so = validatedMaterials[0].salesOrder;
    const soItems = validatedMaterials[0].soItems;
    
    // Update the items with dispatched quantities for all materials
    const updatedItems = soItems.map(item => {
      const material = validatedMaterials.find(m => Number(m.material_id) === Number(item.material_id));
      if (material) {
        const currentDispatched = Number(item.dispatched_qty || 0);
        return {
          ...item,
          dispatched_qty: currentDispatched + Number(material.qty)
        };
      }
      return item;
    });
    
    // Calculate total dispatched qty for the SO
    const totalDispatchedQty = updatedItems.reduce((sum, item) => {
      return sum + Number(item.dispatched_qty || 0);
    }, 0);
    
    const newRemainingQty = Number(so.qty) - totalDispatchedQty;
    const isFullyLoaded = newRemainingQty <= 0;
    
    await so.update({
      dispatched_qty: totalDispatchedQty,
      so_status: isFullyLoaded ? "dispatched" : "allocated",
      items: updatedItems,
      updated_by: req.user ? req.user.id : null,
    });
    
    const results = [{
      so_id: so.id,
      so_no: so.so_no,
      ordered_qty: Number(so.qty),
      dispatched_qty: totalDispatchedQty,
      remaining_qty: Math.max(newRemainingQty, 0),
      is_fully_loaded: isFullyLoaded,
      materials_loaded: validatedMaterials.map(m => ({
        material_id: m.material_id,
        material_name: m.material_name,
        qty: m.qty,
        remaining_after: m.remaining_qty
      }))
    }];

    // Fetch the created loading with includes
    const created = await Loading.findByPk(loading.id, { 
      include: [
        { model: GateEntry, as: 'gateEntry' },
        { model: SalesOrder, as: 'salesOrder' }
      ] 
    });
    
    // Return response
    res.status(201).json({
      success: true,
      msg: isFullyLoaded
        ? `Loading recorded — Sales Order ${so.so_no} is now fully loaded and marked 'dispatched'.`
        : `Loading recorded — Sales Order ${so.so_no} still has remaining quantities.`,
      data: created,
      results: results,
      all_fully_loaded: isFullyLoaded
    });
  } catch (err) {
    next(err);
  }
},

  // PUT /api/loading/:id  — correct the loaded qty after the fact (e.g. a re-weigh).
  update: async (req, res, next) => {
    try {
      const loading = await Loading.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!loading) throw createError(404, "Loading record not found");

      const { loaded_qty, remarks } = req.body;
      const updates = {};
      if (loaded_qty !== undefined) {
        if (!(Number(loaded_qty) > 0)) throw createError(400, "loaded_qty must be greater than 0");
        updates.loaded_qty = loaded_qty;
      }
      if (remarks !== undefined) updates.remarks = remarks;
      updates.updated_by = req.user ? req.user.id : null;

      await loading.update(updates);

      const updated = await Loading.findByPk(loading.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Loading record updated", data: updated });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/loading/:id  (soft delete)
  delete: async (req, res, next) => {
    try {
      const loading = await Loading.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!loading) throw createError(404, "Loading record not found");

      await loading.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Loading record deleted" });
    } catch (err) {
      next(err);
    }
  },
};