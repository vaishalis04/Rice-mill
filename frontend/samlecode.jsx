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