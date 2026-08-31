// const createError = require("http-errors");
// const { PurchaseOrder, Purchase } = require("../models/index");

const createError = require("http-errors");
const { Op } = require("sequelize");
const sequelize = require("../config/db");
const {
  PurchaseOrder,
  Purchase,
  Vendor,
  MaterialMaster,
  VarietyMaster,
  GateEntry,
  WeightSlip,
} = require("../models/index");
const { generatePoNo } = require("../helpers/helperFunction");

const poIncludes = [
  { model: Vendor, as: "vendor", attributes: ["id", "vendor_code", "name"] },
  {
    model: MaterialMaster,
    as: "material",
    attributes: ["id", "material_code", "name"],
  },
  { model: VarietyMaster, as: "variety", attributes: ["id", "variety_name"] },
];

// The `items` column is a JSON column, but on MariaDB (and in some
// mysql2/Sequelize version combos) it round-trips as a raw JSON
// *string* instead of an already-parsed array/object. Every read of
// row.items needs to tolerate both shapes, or a PO's line items
// silently disappear (this was the root cause of the Approval page's
// "Material Details" table showing blank).
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

const normalizePoItems = (row) => {
  const list = [];

  const jsonItems = parseItemsField(row?.items);
  for (const item of jsonItems) {
    if (!item) continue;
    list.push({
      material_id: item.material_id ?? row?.material_id ?? null,
      variety_id: item.variety_id ?? row?.variety_id ?? null,
      qty: item.qty ?? row?.qty ?? null,
      rate: item.rate ?? row?.rate ?? null,
      material: item.material || row?.material || null,
      variety: item.variety || row?.variety || null,
    });
  }

  if (
    row &&
    (row.material_id !== null || row.qty !== null || row.rate !== null) &&
    !list.some(
      (item) =>
        String(item.material_id || "") === String(row.material_id || "") &&
        String(item.variety_id || "") === String(row.variety_id || "") &&
        Number(item.qty || 0) === Number(row.qty || 0) &&
        Number(item.rate || 0) === Number(row.rate || 0),
    )
  ) {
    list.push({
      material_id: row.material_id ?? null,
      variety_id: row.variety_id ?? null,
      qty: row.qty ?? null,
      rate: row.rate ?? null,
      material: row.material || null,
      variety: row.variety || null,
    });
  }

  return list.filter((item) => item.material_id || item.qty !== null || item.rate !== null);
};

const buildGroupedPurchaseOrder = (rows) => {
  const groups = new Map();

  for (const row of rows) {
    const key = row.po_no;
    if (!groups.has(key)) {
      groups.set(key, {
        id: row.id,
        po_no: row.po_no,
        vendor_id: row.vendor_id,
        vendor: row.vendor,
        material_id: row.material_id,
        material: row.material,
        variety_id: row.variety_id,
        variety: row.variety,
        qty: row.qty,
        rate: row.rate,
        po_date: row.po_date,
        validity: row.validity,
        do_no: row.do_no,
        uploaded_by_vendor: row.uploaded_by_vendor,
        plant_id: row.plant_id,
        approval_status: row.approval_status,
        rejection_reason: row.rejection_reason,
        created_by: row.created_by,
        updated_by: row.updated_by,
        approved_by: row.approved_by,
        approved_at: row.approved_at,
        items: [],
      });
    }

    const group = groups.get(key);
    const merged = normalizePoItems(row);
    const existingKeys = new Set(
      (group.items || []).map((item) => {
        const materialId = item.material_id ?? "";
        const varietyId = item.variety_id ?? "";
        return `${String(materialId)}::${String(varietyId)}::${String(item.qty ?? "")}::${String(item.rate ?? "")}`;
      }),
    );

    for (const item of merged) {
      const itemKey = `${String(item.material_id ?? "")}::${String(item.variety_id ?? "")}::${String(item.qty ?? "")}::${String(item.rate ?? "")}`;
      if (!existingKeys.has(itemKey)) {
        group.items.push(item);
        existingKeys.add(itemKey);
      }
    }
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    item_count: group.items?.length || 0,
    total_qty: (group.items || []).reduce(
      (sum, item) => sum + Number(item.qty || 0),
      0,
    ),
    total_amount: (group.items || []).reduce(
      (sum, item) => sum + Number(item.qty || 0) * Number(item.rate || 0),
      0,
    ),
  }));
};

// Shared by getAllGrouped / getPendingApprovals / getById so a PO's items
// always come back the same shape: grouped by po_no, with each item's
// material/variety looked up and attached (some items only carry the
// material_id/variety_id inside the JSON items column, with no
// association pre-loaded on them).
const enrichGroupedPurchaseOrders = async (grouped) => {
  const materialIds = new Set();
  const varietyIds = new Set();
  for (const group of grouped) {
    for (const item of group.items || []) {
      if (item.material_id) materialIds.add(item.material_id);
      if (item.variety_id) varietyIds.add(item.variety_id);
    }
  }

  const [materials, varieties] = await Promise.all([
    materialIds.size
      ? MaterialMaster.findAll({
          where: { id: Array.from(materialIds) },
          attributes: ["id", "material_code", "name"],
        })
      : [],
    varietyIds.size
      ? VarietyMaster.findAll({
          where: { id: Array.from(varietyIds) },
          attributes: ["id", "variety_name"],
        })
      : [],
  ]);
  const materialById = new Map(materials.map((m) => [String(m.id), m]));
  const varietyById = new Map(varieties.map((v) => [String(v.id), v]));

  return grouped.map((group) => ({
    ...group,
    items: (group.items || []).map((item) => ({
      ...item,
      material: item.material || materialById.get(String(item.material_id)) || null,
      variety: item.variety || (item.variety_id ? varietyById.get(String(item.variety_id)) || null : null),
    })),
  }));
};

module.exports = {
  getAllGrouped: async (req, res, next) => {
    try {
      const { search, vendor_id, plant_id } = req.query;

      const where = { is_deleted: false };
      if (req.user.role !== "admin") where.approval_status = "approved";
      if (vendor_id) where.vendor_id = vendor_id;
      if (plant_id) where.plant_id = plant_id;
      if (search) {
        where[Op.or] = [
          { po_no: { [Op.like]: `%${search}%` } },
          { do_no: { [Op.like]: `%${search}%` } },
        ];
      }

      const rows = await PurchaseOrder.findAll({
        where,
        include: poIncludes,
        order: [
          ["po_no", "DESC"],
          ["created_at", "ASC"],
        ],
      });

      const grouped = buildGroupedPurchaseOrder(rows);
      const enriched = await enrichGroupedPurchaseOrders(grouped);

      res.status(200).json({ success: true, data: enriched });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/purchase?search=&vendor_id=&material_id=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const {
        search,
        vendor_id,
        material_id,
        plant_id,
        page = 1,
        limit = 20,
      } = req.query;

      const where = { is_deleted: false };
      if (vendor_id) where.vendor_id = vendor_id;
      if (material_id) where.material_id = material_id;
      if (plant_id) where.plant_id = plant_id;
      if (search) {
        where[Op.or] = [
          { po_no: { [Op.like]: `%${search}%` } },
          { do_no: { [Op.like]: `%${search}%` } },
        ];
      }

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await PurchaseOrder.findAndCountAll({
        where,
        include: poIncludes,
        order: [["created_at", "DESC"]],
        limit: Number(limit),
        offset,
        distinct: true,
      });

      res.status(200).json({
        success: true,
        data: rows,
        pagination: {
          total: count,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(count / limit),
        },
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/purchase/:id
  // A PO can be made of several `purchase_order` rows sharing one po_no
  // (multi-item POs from bulkCreate/addItem), plus items packed into the
  // JSON `items` column. Fetching just the single row by id — as this
  // used to do — showed a blank Material Details table on the Approval
  // page whenever that particular row wasn't the one carrying the visible
  // fields. Instead: resolve po_no from the requested id, then fetch and
  // group every row for that po_no, same as the list endpoints do.
  getById: async (req, res, next) => {
    try {
      const anchor = await PurchaseOrder.findOne({
        where: { id: req.params.id, is_deleted: false },
      });
      if (!anchor) throw createError(404, "Purchase order not found");

      const rows = await PurchaseOrder.findAll({
        where: { po_no: anchor.po_no, is_deleted: false },
        include: poIncludes,
        order: [["created_at", "ASC"]],
      });

      const grouped = buildGroupedPurchaseOrder(rows);
      const [enriched] = await enrichGroupedPurchaseOrders(grouped);

      res.status(200).json({ success: true, data: enriched });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/purchase
  create: async (req, res, next) => {
    try {
      const {
        po_no,
        vendor_id,
        material_id,
        variety_id,
        qty,
        rate,
        po_date,
        validity,
        do_no,
        uploaded_by_vendor,
        plant_id,
      } = req.body;

      if (!po_no || !vendor_id || !material_id || !qty || !rate || !po_date) {
        throw createError(
          400,
          "po_no, vendor_id, material_id, qty, rate and po_date are required",
        );
      }

      const [vendor, material] = await Promise.all([
        Vendor.findOne({ where: { id: vendor_id, is_deleted: false } }),
        MaterialMaster.findOne({
          where: { id: material_id, is_deleted: false },
        }),
      ]);
      if (!vendor) throw createError(400, "Invalid vendor_id");
      if (!material) throw createError(400, "Invalid material_id");

      if (variety_id) {
        const variety = await VarietyMaster.findOne({
          where: { id: variety_id, is_deleted: false },
        });
        if (!variety) throw createError(400, "Invalid variety_id");
      }

      // po_no is no longer globally unique — multiple line items (different
      // material/variety combos) can share one PO number. Only block a
      // literal repeat of the same material+variety under that same po_no.
      const existing = await PurchaseOrder.findOne({
        where: { po_no, material_id, variety_id: variety_id || null },
      });
      if (existing)
        throw createError(409, "This material/variety is already on this PO");

      const po = await PurchaseOrder.create({
        po_no,
        vendor_id,
        material_id,
        variety_id,
        qty,
        rate,
        po_date,
        validity,
        do_no,
        uploaded_by_vendor: uploaded_by_vendor ?? false,
        plant_id: plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      const created = await PurchaseOrder.findByPk(po.id, {
        include: poIncludes,
      });
      res
        .status(201)
        .json({ success: true, msg: "Purchase order created", data: created });
    } catch (err) {
      next(err);
    }
  },

  bulkCreate: async (req, res, next) => {
    const t = await sequelize.transaction();

    try {
      const {
        vendor_id,
        po_date,
        validity,
        do_no,
        uploaded_by_vendor,
        plant_id,
        items,
      } = req.body;

      if (!vendor_id) {
        throw createError(400, "vendor_id is required");
      }

      if (!po_date) {
        throw createError(400, "po_date is required");
      }

      if (!Array.isArray(items) || items.length === 0) {
        throw createError(400, "items must be a non-empty array");
      }

      const vendor = await Vendor.findOne({
        where: {
          id: vendor_id,
          is_deleted: false,
        },
        transaction: t,
      });

      if (!vendor) {
        throw createError(400, `Invalid vendor_id: ${vendor_id}`);
      }

      const seen = new Set();

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        const materialId = Number(item.material_id);

        if (!Number.isInteger(materialId) || materialId <= 0) {
          throw createError(
            400,
            `Item ${i + 1}: valid material_id is required`,
          );
        }

        if (item.qty === undefined || item.qty === null || item.qty === "") {
          throw createError(400, `Item ${i + 1}: qty is required`);
        }

        const qty = Number(item.qty);

        if (!Number.isFinite(qty) || qty <= 0) {
          throw createError(400, `Item ${i + 1}: qty must be greater than 0`);
        }

        if (item.rate === undefined || item.rate === null || item.rate === "") {
          throw createError(400, `Item ${i + 1}: rate is required`);
        }

        const rate = Number(item.rate);

        if (!Number.isFinite(rate) || rate < 0) {
          throw createError(400, `Item ${i + 1}: rate must be a valid number`);
        }

        let varietyId = null;

        if (
          item.variety_id !== undefined &&
          item.variety_id !== null &&
          item.variety_id !== ""
        ) {
          varietyId = Number(item.variety_id);

          if (!Number.isInteger(varietyId) || varietyId <= 0) {
            throw createError(400, `Item ${i + 1}: invalid variety_id`);
          }
        }

        const material = await MaterialMaster.findOne({
          where: {
            id: materialId,
            is_deleted: false,
          },
          transaction: t,
        });

        if (!material) {
          throw createError(
            400,
            `Item ${i + 1}: Invalid material_id: ${materialId}`,
          );
        }

        if (varietyId !== null) {
          const variety = await VarietyMaster.findOne({
            where: {
              id: varietyId,
              is_deleted: false,
            },
            transaction: t,
          });

          if (!variety) {
            throw createError(
              400,
              `Item ${i + 1}: Invalid variety_id: ${varietyId}`,
            );
          }

          if (
            variety.material_id !== undefined &&
            variety.material_id !== null &&
            Number(variety.material_id) !== materialId
          ) {
            throw createError(
              400,
              `Item ${i + 1}: Variety ${varietyId} does not belong to material ${materialId}`,
            );
          }
        }

        const key = `${materialId}-${varietyId ?? "null"}`;

        if (seen.has(key)) {
          throw createError(
            400,
            `Duplicate material/variety combination at item ${
              i + 1
            }: material ${materialId}, variety ${varietyId ?? "none"}`,
          );
        }

        seen.add(key);

        item.material_id = materialId;
        item.variety_id = varietyId;
        item.qty = qty;
        item.rate = rate;
      }

      const po_no = await generatePoNo();

      const resolvedPlantId = plant_id || (req.user ? req.user.plant_id : null);

      const materialIds = items.map((item) => item.material_id).join(",");

      const varietyIds = items.map((item) => item.variety_id ?? "").join(",");

      const quantities = items.map((item) => item.qty).join(",");

      const rates = items.map((item) => item.rate).join(",");

      const purchaseOrder = await PurchaseOrder.create(
        {
          po_no,
          vendor_id,

          // Keep these NULL because bulk PO items are stored in JSON
          material_id: null,
          variety_id: null,
          qty: null,
          rate: null,

          po_date,
          validity,
          do_no,

          uploaded_by_vendor: uploaded_by_vendor ?? false,

          plant_id: resolvedPlantId,

          created_by: req.user ? req.user.id : null,

          approval_status: "pending_approval",

          items: items.map((item) => ({
            material_id: item.material_id,
            variety_id: item.variety_id,
            qty: item.qty,
            rate: item.rate,
          })),
        },
        {
          transaction: t,
        },
      );

      await t.commit();

      const fullRow = await PurchaseOrder.findOne({
        where: {
          id: purchaseOrder.id,
        },
        include: poIncludes,
      });

      return res.status(201).json({
        success: true,
        msg: `PO ${po_no} created successfully`,
        data: fullRow,
      });
    } catch (err) {
      if (!t.finished) {
        await t.rollback();
      }

      if (
        err.name === "SequelizeValidationError" &&
        Array.isArray(err.errors)
      ) {
        const detail = err.errors
          .map((e) => `${e.path}: ${e.message}`)
          .join("; ");

        return next(createError(400, `Validation failed — ${detail}`));
      }

      if (
        err.name === "SequelizeUniqueConstraintError" &&
        Array.isArray(err.errors)
      ) {
        const detail = err.errors
          .map((e) => `${e.path}: ${e.message}`)
          .join("; ");

        return next(createError(400, `Duplicate entry — ${detail}`));
      }

      return next(err);
    }
  },

  getPendingApprovals: async (req, res, next) => {
    try {
      const purchaseOrders = await PurchaseOrder.findAll({
        where: {
          approval_status: "pending_approval",
        },
        include: poIncludes,
        order: [["created_at", "DESC"]],
      });

      const grouped = buildGroupedPurchaseOrder(purchaseOrders);
      const enriched = await enrichGroupedPurchaseOrders(grouped);

      res.status(200).json({
        success: true,
        data: enriched,
      });
    } catch (err) {
      next(err);
    }
  },

  updateBeforeApproval: async (req, res, next) => {
    try {
      const { id } = req.params;

      const { vendor_id, po_date, validity, do_no, plant_id, items } = req.body;

      const po = await PurchaseOrder.findOne({
        where: {
          id,
          approval_status: "pending_approval",
        },
      });

      if (!po) {
        throw createError(404, "Purchase order not found or already processed");
      }

      // Update common PO fields
      if (vendor_id !== undefined) po.vendor_id = vendor_id;
      if (po_date !== undefined) po.po_date = po_date;
      if (validity !== undefined) po.validity = validity;
      if (do_no !== undefined) po.do_no = do_no;
      if (plant_id !== undefined) po.plant_id = plant_id;

      po.updated_by = req.user.id;

      await po.save();

      res.status(200).json({
        success: true,
        msg: "Purchase order updated successfully",
        data: po,
      });
    } catch (err) {
      next(err);
    }
  },

  approve: async (req, res, next) => {
    try {
      const { po_no } = req.params;

      const purchaseOrders = await PurchaseOrder.findAll({
        where: {
          po_no,
          approval_status: "pending_approval",
        },
      });

      if (!purchaseOrders.length) {
        throw createError(404, "Pending purchase order not found");
      }

      await PurchaseOrder.update(
        {
          approval_status: "approved",
          approved_by: req.user.id,
          approved_at: new Date(),
        },
        {
          where: {
            po_no,
            approval_status: "pending_approval",
          },
        },
      );

      const updated = await PurchaseOrder.findAll({
        where: { po_no },
        include: poIncludes,
      });

      res.status(200).json({
        success: true,
        msg: `PO ${po_no} approved successfully`,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  },

  reject: async (req, res, next) => {
    try {
      const { po_no } = req.params;
      const { rejection_reason } = req.body;

      if (!rejection_reason) {
        throw createError(400, "rejection_reason is required");
      }

      const [updated] = await PurchaseOrder.update(
        {
          approval_status: "rejected",
          rejection_reason,
          updated_by: req.user.id,
        },
        {
          where: {
            po_no,
            approval_status: "pending_approval",
          },
        },
      );

      if (!updated) {
        throw createError(404, "Pending purchase order not found");
      }

      res.status(200).json({
        success: true,
        msg: `PO ${po_no} rejected successfully`,
      });
    } catch (err) {
      next(err);
    }
  },

  addItem: async (req, res, next) => {
    try {
      const { po_no } = req.params;
      const { material_id, variety_id, qty, rate } = req.body;

      if (!material_id || !qty || !rate) {
        throw createError(400, "material_id, qty and rate are required");
      }

      // Any existing row for this po_no carries the shared header fields
      // (vendor, po_date, validity, do_no) that the new line should inherit.
      const anyRow = await PurchaseOrder.findOne({
        where: { po_no, is_deleted: false },
      });
      if (!anyRow) throw createError(404, "Purchase order not found");

      const material = await MaterialMaster.findOne({
        where: { id: material_id, is_deleted: false },
      });
      if (!material) throw createError(400, "Invalid material_id");
      if (variety_id) {
        const variety = await VarietyMaster.findOne({
          where: { id: variety_id, is_deleted: false },
        });
        if (!variety) throw createError(400, "Invalid variety_id");
      }

      const existingRows = await PurchaseOrder.findAll({
        where: {
          po_no,
          is_deleted: false,
        },
      });

      const duplicateKey = `${material_id}-${variety_id || "null"}`;
      const alreadyExists = existingRows.some((row) => {
        const materialKey = `${row.material_id ?? "null"}-${row.variety_id ?? "null"}`;
        return materialKey === duplicateKey;
      });
      if (alreadyExists) {
        throw createError(409, "This material/variety is already on this PO");
      }

      const row = await PurchaseOrder.create({
        po_no,
        vendor_id: anyRow.vendor_id,
        material_id,
        variety_id: variety_id || null,
        qty,
        rate,
        po_date: anyRow.po_date,
        validity: anyRow.validity,
        do_no: anyRow.do_no,
        uploaded_by_vendor: anyRow.uploaded_by_vendor,
        plant_id: anyRow.plant_id,
        created_by: req.user ? req.user.id : null,
      });

      const allRows = await PurchaseOrder.findAll({
        where: { po_no, is_deleted: false },
      });
      const mergedItems = buildGroupedPurchaseOrder(allRows).flatMap((group) => group.items || []);

      await PurchaseOrder.update(
        { items: mergedItems },
        { where: { po_no, is_deleted: false } },
      );

      const created = await PurchaseOrder.findByPk(row.id, {
        include: poIncludes,
      });
      res
        .status(201)
        .json({
          success: true,
          msg: `Material added to PO ${po_no}`,
          data: created,
        });
    } catch (err) {
      next(err);
    }
  },

  updateHeader: async (req, res, next) => {
    try {
      const { po_no } = req.params;
      const { vendor_id, po_date, validity, do_no } = req.body;

      const rows = await PurchaseOrder.findAll({
        where: { po_no, is_deleted: false },
      });
      if (rows.length === 0) throw createError(404, "Purchase order not found");

      if (vendor_id) {
        const vendor = await Vendor.findOne({
          where: { id: vendor_id, is_deleted: false },
        });
        if (!vendor) throw createError(400, "Invalid vendor_id");
      }

      const updates = { vendor_id, po_date, validity, do_no };
      Object.keys(updates).forEach(
        (key) => updates[key] === undefined && delete updates[key],
      );
      updates.updated_by = req.user ? req.user.id : null;

      await PurchaseOrder.update(updates, {
        where: { po_no, is_deleted: false },
      });

      const updated = await PurchaseOrder.findAll({
        where: { po_no, is_deleted: false },
        include: poIncludes,
      });
      res
        .status(200)
        .json({ success: true, msg: `PO ${po_no} updated`, data: updated });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/purchase/:id
  update: async (req, res, next) => {
    try {
      const po = await PurchaseOrder.findOne({
        where: { id: req.params.id, is_deleted: false },
      });
      if (!po) throw createError(404, "Purchase order not found");

      const {
        po_no,
        vendor_id,
        material_id,
        variety_id,
        qty,
        rate,
        po_date,
        validity,
        do_no,
        uploaded_by_vendor,
        plant_id,
      } = req.body;

      if (po_no || material_id || variety_id !== undefined) {
        const dup = await PurchaseOrder.findOne({
          where: {
            po_no: po_no || po.po_no,
            material_id: material_id || po.material_id,
            variety_id:
              variety_id !== undefined ? variety_id || null : po.variety_id,
            id: { [Op.ne]: po.id },
          },
        });
        if (dup)
          throw createError(409, "This material/variety is already on this PO");
      }
      if (vendor_id) {
        const vendor = await Vendor.findOne({
          where: { id: vendor_id, is_deleted: false },
        });
        if (!vendor) throw createError(400, "Invalid vendor_id");
      }
      if (material_id) {
        const material = await MaterialMaster.findOne({
          where: { id: material_id, is_deleted: false },
        });
        if (!material) throw createError(400, "Invalid material_id");
      }
      if (variety_id) {
        const variety = await VarietyMaster.findOne({
          where: { id: variety_id, is_deleted: false },
        });
        if (!variety) throw createError(400, "Invalid variety_id");
      }

      const updates = {
        po_no,
        vendor_id,
        material_id,
        variety_id,
        qty,
        rate,
        po_date,
        validity,
        do_no,
        uploaded_by_vendor,
        plant_id,
      };
      Object.keys(updates).forEach(
        (key) => updates[key] === undefined && delete updates[key],
      );
      updates.updated_by = req.user ? req.user.id : null;

      await po.update(updates);

      const updated = await PurchaseOrder.findByPk(po.id, {
        include: poIncludes,
      });
      res
        .status(200)
        .json({ success: true, msg: "Purchase order updated", data: updated });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/purchase/:id  (soft delete)
  delete: async (req, res, next) => {
    try {
      const po = await PurchaseOrder.findOne({
        where: { id: req.params.id, is_deleted: false },
      });
      if (!po) throw createError(404, "Purchase order not found");

      await po.update({
        is_deleted: true,
        updated_by: req.user ? req.user.id : null,
      });
      res.status(200).json({ success: true, msg: "Purchase order deleted" });
    } catch (err) {
      next(err);
    }
  },

  convertToPurchase: async (req, res, next) => {
    try {
      const {
        gate_entry_id,
        weight_slip_id,
        po_id,
        final_rate,
        purchase_date,
        plant_id,
      } = req.body;

      if (!gate_entry_id || !weight_slip_id || !final_rate || !purchase_date) {
        throw createError(
          400,
          "gate_entry_id, weight_slip_id, final_rate and purchase_date are required",
        );
      }

      const [gateEntry, weightSlip] = await Promise.all([
        GateEntry.findOne({ where: { id: gate_entry_id, is_deleted: false } }),
        WeightSlip.findOne({
          where: { id: weight_slip_id, gate_entry_id, is_deleted: false },
        }),
      ]);
      if (!gateEntry) throw createError(400, "Invalid gate_entry_id");
      if (!weightSlip)
        throw createError(400, "Invalid weight_slip_id for this gate_entry_id");

      const existing = await Purchase.findOne({
        where: { gate_entry_id, is_deleted: false },
      });
      if (existing)
        throw createError(
          409,
          "This gate entry has already been converted to a purchase",
        );

      if (po_id) {
        const po = await PurchaseOrder.findOne({
          where: { id: po_id, is_deleted: false },
        });
        if (!po) throw createError(400, "Invalid po_id");
      }

      const final_qty = weightSlip.net_weight;
      const amount = Number(final_qty) * Number(final_rate);

      const purchase = await Purchase.create({
        po_id: po_id || gateEntry.po_id || null,
        gate_entry_id,
        weight_slip_id,
        final_rate,
        final_qty,
        amount,
        purchase_date,
        plant_id:
          plant_id ||
          gateEntry.plant_id ||
          (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      res
        .status(201)
        .json({ success: true, msg: "Purchase finalized", data: purchase });
    } catch (err) {
      next(err);
    }
  },
};