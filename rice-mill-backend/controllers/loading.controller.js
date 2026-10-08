const createError = require("http-errors");
const sequelize = require("../config/db");
const { Loading, GateEntry, SalesOrder, Customer, MaterialMaster, Vehicle, Driver, User, Sampling, LabTest ,GateEntrySalesOrder } = require("../models/index");
const { generateLoadingNo } = require("../helpers/helperFunction");

// Units on a Sales Order / Loading: bag SIZE is in kg, everything else
// (ordered, dispatched, remaining, loaded, totals) is in Qtl. 1 Qtl = 100 kg —
// the one definition in helpers/units.js, shared with the whole app. Rounded
// to 3 decimals (1 kg = 0.01 Qtl exactly) so small bag counts still add up
// and "fully loaded" lands on exactly zero remaining.
const { KG_PER_QTL } = require("../helpers/units");
const round3 = (n) => Math.round(Number(n) * 1000) / 1000;
const bagsToQtl = (bagSizeKg, bags) => round3((Number(bagSizeKg) * Number(bags)) / KG_PER_QTL);

// Same MariaDB/Sequelize JSON-column quirk handled in purchase.controller.js:
// a JSON column can round-trip as a raw string instead of an already-parsed
// array, so every read needs to tolerate both shapes.
const parseItemsField = (value) => {
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

// Normalize a Loading row (Sequelize instance or plain object) into a plain
// object with `items` guaranteed to be a real array before it goes out over
// the API.
const serializeLoading = (loading) => {
  if (!loading) return loading;
  const plain = typeof loading.toJSON === "function" ? loading.toJSON() : loading;
  return { ...plain, items: parseItemsField(plain.items) };
};

const parseSoItems = (so) => parseItemsField(so?.items);

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
        data: rows.map(serializeLoading),
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
      res.status(200).json({ success: true, data: serializeLoading(loading) });
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

    // A truck can be loaded in more than one pass (partial batches of
    // bags arriving over time) — the only real guard is the gate_status
    // check above, which already blocks any further loading once this
    // gate entry has moved past 'waiting_loading' (i.e. everything on the
    // Sales Order is fully loaded and it's ready for its second weighment).

    // Validate each material quantity
    const validatedMaterials = [];
    let totalLoadedQty = 0;
    let soId = null;
    
    for (const materialQty of material_quantities) {
      const { so_id, material_id, bag_size, bags } = materialQty;
      // qty is derived from bag_size x bags — same physical-bag-count
      // convention Unloading uses — with a plain `qty` still accepted as a
      // fallback for any other caller of this API.
      const qty = bag_size != null && bags != null ? bagsToQtl(bag_size, bags) : materialQty.qty;
      
      if (!so_id) {
        throw createError(400, "so_id is required for each material quantity");
      }
      
      if (!material_id) {
        throw createError(400, "material_id is required for each material quantity");
      }

      if ((bag_size == null || bags == null) && !materialQty.qty) {
        throw createError(400, `bag_size and bags (or qty) required for material ${material_id} in SO ${so_id}`);
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

      const previousLoadings = await Loading.findAll({
        where: { gate_entry_id: gateEntry.id, so_id, is_deleted: false },
        attributes: ["items"],
      });
      let alreadyLoadedOnThisTrip = 0;
      previousLoadings.forEach((loading) => {
        const priorLines = parseItemsField(loading.items);
        alreadyLoadedOnThisTrip += priorLines
          .filter((line) => Number(line.so_id || so_id) === Number(so_id) && Number(line.material_id) === Number(material_id))
          .reduce((sum, line) => sum + Number(line.qty || 0), 0);
      });
      const assignmentRemaining = Math.max(0, round3(Number(junctionRecord.qty || 0) - alreadyLoadedOnThisTrip));
      if (round3(qty) > assignmentRemaining) {
        throw createError(400, `Loaded qty (${round3(qty)} Qtl) exceeds this truck's assigned quantity (${assignmentRemaining} Qtl) for ${junctionRecord.material?.name || material_id}`);
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
      const remainingQty = round3(orderedQty - dispatchedQty);
      
      if (round3(qty) > remainingQty) {
        throw createError(400, `Loaded qty (${round3(qty)} Qtl) for material ${junctionRecord.material?.name || material_id} in SO ${so.so_no} exceeds remaining qty (${remainingQty} Qtl)`);
      }
      
      totalLoadedQty = round3(totalLoadedQty + Number(qty));
      
      validatedMaterials.push({
        so_id: so_id,
        so_no: so.so_no,
        material_id: material_id,
        material_name: junctionRecord.material?.name || `Material ${material_id}`,
        bag_size: bag_size != null ? Number(bag_size) : null,
        bags: bags != null ? Number(bags) : null,
        qty: Number(qty),
        ordered_qty: orderedQty,
        dispatched_qty: dispatchedQty,
        remaining_qty: round3(remainingQty - Number(qty)),
        salesOrder: so,
        junctionRecord: junctionRecord,
        soItem: soItem,
        soItems: soItems
      });
    }
    
    // Validate total loaded quantity matches
    if (Math.abs(Number(loaded_qty) - totalLoadedQty) > 0.002) {
      throw createError(400, `Total loaded_qty (${loaded_qty}) does not match sum of material quantities (${totalLoadedQty})`);
    }

    // Generate loading number
    const loading_no = await generateLoadingNo();

    // Create a SINGLE loading record — `items` is this record's own
    // per-material breakdown (bag_size/bags/qty), separate from the Sales
    // Order's own cumulative items updated further below.
    const loading = await Loading.create({
      loading_no,
      gate_entry_id,
      so_id: soId,
      loaded_qty: loaded_qty,
      loaded_at: loaded_at || new Date(),
      loading_operator_id: req.user ? req.user.id : null,
      remarks: remarks || `Loaded ${validatedMaterials.length} material(s)`,
      items: validatedMaterials.map((m) => ({
        so_id: m.so_id,
        material_id: m.material_id,
        bag_size: m.bag_size,
        bags: m.bags,
        qty: m.qty,
      })),
      plant_id: plant_id || gateEntry.plant_id || (req.user ? req.user.plant_id : null),
      created_by: req.user ? req.user.id : null,
    });

    // Update the sales order's dispatched quantity and items
    const so = validatedMaterials[0].salesOrder;
    let soItems = validatedMaterials[0].soItems;
    
    // Update the items with dispatched quantities for all materials
    const updatedItems = soItems.map(item => {
      const material = validatedMaterials.find(m => Number(m.material_id) === Number(item.material_id));
      if (material) {
        const currentDispatched = Number(item.dispatched_qty || 0);
        return {
          ...item,
          dispatched_qty: round3(currentDispatched + Number(material.qty))
        };
      }
      return item;
    });
    
    // Calculate per-material remaining quantities
    const materialsStatus = updatedItems.map(item => ({
      material_id: item.material_id,
      ordered_qty: Number(item.qty || 0),
      dispatched_qty: Number(item.dispatched_qty || 0),
      remaining_qty: round3(Number(item.qty || 0) - Number(item.dispatched_qty || 0))
    }));
    
    // Check if ALL materials are fully loaded
    const allMaterialsFullyLoaded = materialsStatus.every(m => m.remaining_qty <= 0);

    // This vehicle is weighed out after its own load, even when its part of
    // the overall SO is partial. The SO stays allocated and its remaining
    // quantity is available to assign to another vehicle.
    await gateEntry.update({
      gate_status: "waiting_second_weighment",
      updated_by: req.user ? req.user.id : null
    });
    
    // Calculate total dispatched quantity
    const totalDispatchedQty = round3(updatedItems.reduce((sum, item) => {
      return sum + Number(item.dispatched_qty || 0);
    }, 0));
    
    // Update the SO
    await so.update({
      dispatched_qty: totalDispatchedQty,
      so_status: allMaterialsFullyLoaded ? "dispatched" : "allocated",
      items: updatedItems,
      updated_by: req.user ? req.user.id : null,
    });
    
    // Calculate remaining quantities for response
    // Real ordered total = sum of each item's own qty (the row-level so.qty
    // column is deprecated and often empty on multi-material orders).
    const totalOrderedQty = round3(updatedItems.reduce((sum, item) => sum + Number(item.qty || 0), 0));
    const newRemainingQty = round3(totalOrderedQty - totalDispatchedQty);
    
    const results = [{
      so_id: so.id,
      so_no: so.so_no,
      ordered_qty: totalOrderedQty,
      dispatched_qty: totalDispatchedQty,
      remaining_qty: Math.max(newRemainingQty, 0),
      is_fully_loaded: allMaterialsFullyLoaded,
      materials_status: materialsStatus,
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
      msg: allMaterialsFullyLoaded
        ? `Loading recorded — Sales Order ${so.so_no} is fully loaded. This vehicle can proceed to its second weighment.`
        : `Partial loading recorded — ${newRemainingQty.toFixed(3)} Qtl remains on Sales Order ${so.so_no}. This vehicle can proceed to its second weighment; assign the balance to another vehicle.`,
      data: created,
      results: results,
      all_fully_loaded: allMaterialsFullyLoaded
    });
  } catch (err) {
    next(err);
  }
},

  // PUT /api/loading/:id — correct a loading after the fact (e.g. a re-weigh
  // or a miscounted material). Supports two payload shapes:
  //   1. { material_quantities: [{ material_id, qty }, ...], remarks? }
  //      — edits the material-wise breakdown; loaded_qty and the linked
  //      Sales Order's dispatched quantities are recalculated from it.
  //   2. { loaded_qty, remarks } (legacy) — only touches the total/remarks,
  //      kept for any older callers; doesn't touch per-material figures.
  update: async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
      const loading = await Loading.findOne({
        where: { id: req.params.id, is_deleted: false },
        transaction: t,
      });
      if (!loading) throw createError(404, "Loading record not found");

      const { loaded_qty, remarks, material_quantities } = req.body;

      if (Array.isArray(material_quantities)) {
        if (material_quantities.length === 0) {
          throw createError(400, "material_quantities must include at least one material");
        }

        const so = await SalesOrder.findOne({
          where: { id: loading.so_id, is_deleted: false },
          transaction: t,
        });
        if (!so) throw createError(404, "Linked Sales Order not found");

        const materialIds = await MaterialMaster.findAll({
          where: { id: material_quantities.map((m) => m.material_id).filter(Boolean) },
          attributes: ["id", "name"],
          transaction: t,
        });
        const materialById = new Map(materialIds.map((m) => [String(m.id), m]));

        // Step 1 — reverse what THIS loading previously contributed, so the
        // remaining-qty check below is against the SO's state as if this
        // loading had never happened.
        const oldItems = parseItemsField(loading.items);
        const oldQtyByMaterial = new Map(
          oldItems.map((it) => [String(it.material_id), Number(it.qty) || 0]),
        );

        let soItems = parseSoItems(so);
        soItems = soItems.map((item) => {
          const reverseQty = oldQtyByMaterial.get(String(item.material_id));
          if (reverseQty) {
            return {
              ...item,
              dispatched_qty: Math.max(0, round3(Number(item.dispatched_qty || 0) - reverseQty)),
            };
          }
          return item;
        });

        // Step 2 — validate and apply the new per-material quantities.
        const newItems = [];
        let newTotalQty = 0;

        for (const entry of material_quantities) {
          const { material_id, bag_size, bags } = entry || {};
          const qty = bag_size != null && bags != null ? bagsToQtl(bag_size, bags) : entry?.qty;
          if (!material_id) throw createError(400, "material_id is required for each material quantity");

          const qtyNum = round3(qty);
          if (!Number.isFinite(qtyNum) || qtyNum < 0) {
            throw createError(400, `Invalid quantity for material ${material_id}`);
          }
          if (qtyNum === 0) continue; // treat 0 as "remove this material's contribution"

          const soItem = soItems.find((it) => Number(it.material_id) === Number(material_id));
          if (!soItem) {
            throw createError(400, `Material ${material_id} not found on Sales Order ${so.so_no}`);
          }

          const orderedQty = Number(soItem.qty || 0);
          const dispatchedQty = Number(soItem.dispatched_qty || 0);
          const remainingQty = round3(orderedQty - dispatchedQty);

          if (qtyNum > remainingQty) {
            const name = materialById.get(String(material_id))?.name || `Material ${material_id}`;
            throw createError(
              400,
              `Quantity (${qtyNum} Qtl) for ${name} exceeds remaining qty (${remainingQty} Qtl) on SO ${so.so_no}`,
            );
          }

          soItem.dispatched_qty = round3(dispatchedQty + qtyNum);
          newTotalQty = round3(newTotalQty + qtyNum);
          newItems.push({
            so_id: loading.so_id,
            material_id: Number(material_id),
            bag_size: bag_size != null ? Number(bag_size) : null,
            bags: bags != null ? Number(bags) : null,
            qty: qtyNum,
          });
        }

        if (newItems.length === 0) {
          throw createError(400, "At least one material must have a quantity greater than 0");
        }

        const totalDispatchedQty = round3(soItems.reduce(
          (sum, item) => sum + Number(item.dispatched_qty || 0),
          0,
        ));
        // Same fix as create(): the SO's real ordered total is the sum of
        // each item's own qty, not the deprecated row-level so.qty column.
        const totalOrderedQty = soItems.reduce(
          (sum, item) => sum + Number(item.qty || 0),
          0,
        );
        const newRemainingQty = round3(totalOrderedQty - totalDispatchedQty);
        const isFullyLoaded = newRemainingQty <= 0;

        await so.update(
          {
            dispatched_qty: totalDispatchedQty,
            so_status: isFullyLoaded ? "dispatched" : "allocated",
            items: soItems,
            updated_by: req.user ? req.user.id : null,
          },
          { transaction: t },
        );

        await loading.update(
          {
            loaded_qty: newTotalQty,
            items: newItems,
            remarks: remarks !== undefined ? remarks : loading.remarks,
            updated_by: req.user ? req.user.id : null,
          },
          { transaction: t },
        );

        // Keep the gate entry's status in step with this edit — but only
        // while it's still sitting at the loading stage. If the truck has
        // already gone further (second weighment done, parked, exited...),
        // an edit here shouldn't yank it backwards or skip it forwards.
        const gateEntry = await GateEntry.findOne({ where: { id: loading.gate_entry_id }, transaction: t });
        if (gateEntry && ["waiting_loading", "waiting_second_weighment"].includes(gateEntry.gate_status)) {
          const nextStatus = isFullyLoaded ? "waiting_second_weighment" : "waiting_loading";
          if (gateEntry.gate_status !== nextStatus) {
            await gateEntry.update(
              { gate_status: nextStatus, updated_by: req.user ? req.user.id : null },
              { transaction: t },
            );
          }
        }
      } else {
        // Legacy path — total-only edit, no per-material changes.
        const updates = {};
        if (loaded_qty !== undefined) {
          if (!(Number(loaded_qty) > 0)) throw createError(400, "loaded_qty must be greater than 0");
          updates.loaded_qty = loaded_qty;
        }
        if (remarks !== undefined) updates.remarks = remarks;
        updates.updated_by = req.user ? req.user.id : null;

        await loading.update(updates, { transaction: t });
      }

      await t.commit();

      const updated = await Loading.findByPk(loading.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Loading record updated", data: serializeLoading(updated) });
    } catch (err) {
      await t.rollback();
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
