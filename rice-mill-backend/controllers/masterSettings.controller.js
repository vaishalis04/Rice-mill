// const createError = require("http-errors");
// const { PlantMaster, MaterialMaster, VarietyMaster, UomMaster, RateMaster, QualityParameterMaster, ReasonCodeMaster } = require("../models/index");

const createError = require("http-errors");
const { Op } = require("sequelize");
const {
  PlantMaster, MaterialMaster, VarietyMaster, UomMaster,
  RateMaster, QualityParameterMaster, ReasonCodeMaster,
} = require("../models/index");
const { generateCode } = require("../helpers/helperFunction");

// Org / plant / UOM / variety / rate / reason-code masters (Module 25)
// One generic module fronting several small master tables. Which table a
// request targets is chosen via `type` (query param for GET/DELETE, body
// field for POST/PUT): plant | material | variety | uom | rate | quality_parameter | reason_code

const registry = {
  plant: { model: PlantMaster, label: "Plant" },
  material: { model: MaterialMaster, label: "Material" },
  variety: { model: VarietyMaster, label: "Variety" },
  uom: { model: UomMaster, label: "UOM" },
  rate: { model: RateMaster, label: "Rate" },
  quality_parameter: { model: QualityParameterMaster, label: "Quality parameter" },
  reason_code: { model: ReasonCodeMaster, label: "Reason code" },
};

const getEntry = (type) => {
  const entry = registry[type];
  if (!entry) {
    throw createError(400, `type must be one of: ${Object.keys(registry).join(", ")}`);
  }
  return entry;
};

// Per-type include list for eager-loading related masters.
const getIncludes = (type) => {
  if (type === "material") {
    return [
      { model: UomMaster, as: "uom", attributes: ["id", "uom_code", "name"] },
      { model: VarietyMaster, as: "variety", attributes: ["id", "variety_name"] },
    ];
  }
  if (type === "rate") {
    return [
      { model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name"] },
      { model: VarietyMaster, as: "variety", attributes: ["id", "variety_name"] },
    ];
  }
  return [];
};

// Per-type required-field validation + FK checks + uniqueness checks.
const validateAndBuildPayload = async (type, body, { isUpdate = false, existing = null } = {}) => {
  if (type === "plant") {
    const { name, address } = body;
    const plant_code = isUpdate ? body.plant_code : await generateCode(PlantMaster, "plant_code", "PLANT");
    if (!isUpdate && !name) throw createError(400, "name is required");
    if (plant_code) {
      const dup = await PlantMaster.findOne({ where: { plant_code, ...(existing ? { id: { [Op.ne]: existing.id } } : {}) } });
      if (dup) throw createError(409, "A plant with this plant_code already exists");
    }
    return { plant_code, name, address };
  }

  if (type === "material") {
    // eslint-disable-next-line prefer-const
    let { name, category, uom_id, variety_id, hsn_code, plant_id } = body;
    const material_code = isUpdate ? body.material_code : await generateCode(MaterialMaster, "material_code", "MAT");
    if (!isUpdate && (!name || !category)) {
      throw createError(400, "name and category are required");
    }
    // category used to be locked to a fixed 6-value enum; it's now free text
    // so new categories can be added on the fly (Purchase Orders quick-add,
    // Admin > Master Settings). Still required + normalized (trimmed,
    // lowercased) so it stays a short, consistent, comparable key — and so
    // it still matches the literal "husk" / "bran" / "broken" strings
    // production.controller.js's writeByProduct() looks up by category.
    if (category) {
      category = String(category).trim().toLowerCase();
      if (!category) throw createError(400, "category cannot be blank");
      if (category.length > 30) throw createError(400, "category must be 30 characters or fewer");
    }
    if (material_code) {
      const dup = await MaterialMaster.findOne({ where: { material_code, ...(existing ? { id: { [Op.ne]: existing.id } } : {}) } });
      if (dup) throw createError(409, "A material with this material_code already exists");
    }
    if (uom_id) {
      const uom = await UomMaster.findOne({ where: { id: uom_id, is_deleted: false } });
      if (!uom) throw createError(400, "Invalid uom_id");
    }
    if (variety_id) {
      const variety = await VarietyMaster.findOne({ where: { id: variety_id, is_deleted: false } });
      if (!variety) throw createError(400, "Invalid variety_id");
    }
    return { material_code, name, category, uom_id, variety_id, hsn_code, plant_id };
  }

  if (type === "variety") {
    const { variety_name, grain_type, plant_id } = body;
    if (!isUpdate && (!variety_name || !grain_type)) throw createError(400, "variety_name and grain_type are required");
    if (grain_type && !["long", "medium", "short"].includes(grain_type)) {
      throw createError(400, "grain_type must be 'long', 'medium' or 'short'");
    }
    if (variety_name) {
      const dup = await VarietyMaster.findOne({ where: { variety_name, ...(existing ? { id: { [Op.ne]: existing.id } } : {}) } });
      if (dup) throw createError(409, "A variety with this variety_name already exists");
    }
    return { variety_name, grain_type, plant_id };
  }

  if (type === "uom") {
    const { name, conversion_factor, plant_id } = body;
    const uom_code = isUpdate ? body.uom_code : await generateCode(UomMaster, "uom_code", "UOM");
    if (!isUpdate && !name) throw createError(400, "name is required");
    if (uom_code) {
      const dup = await UomMaster.findOne({ where: { uom_code, ...(existing ? { id: { [Op.ne]: existing.id } } : {}) } });
      if (dup) throw createError(409, "A UOM with this uom_code already exists");
    }
    return { uom_code, name, conversion_factor, plant_id };
  }

  if (type === "rate") {
    const { material_id, variety_id, base_rate, effective_date, plant_id } = body;
    if (!isUpdate && (!material_id || !base_rate || !effective_date)) {
      throw createError(400, "material_id, base_rate and effective_date are required");
    }
    if (material_id) {
      const material = await MaterialMaster.findOne({ where: { id: material_id, is_deleted: false } });
      if (!material) throw createError(400, "Invalid material_id");
    }
    if (variety_id) {
      const variety = await VarietyMaster.findOne({ where: { id: variety_id, is_deleted: false } });
      if (!variety) throw createError(400, "Invalid variety_id");
    }
    return { material_id, variety_id, base_rate, effective_date, plant_id };
  }

  if (type === "quality_parameter") {
    const { parameter_name, unit, acceptable_min, acceptable_max, plant_id } = body;
    if (!isUpdate && !parameter_name) throw createError(400, "parameter_name is required");
    if (parameter_name) {
      const dup = await QualityParameterMaster.findOne({ where: { parameter_name, ...(existing ? { id: { [Op.ne]: existing.id } } : {}) } });
      if (dup) throw createError(409, "A quality parameter with this name already exists");
    }
    return { parameter_name, unit, acceptable_min, acceptable_max, plant_id };
  }

  // reason_code
  const { category, description, plant_id } = body;
  const code = isUpdate ? body.code : await generateCode(ReasonCodeMaster, "code", "RSN");
  if (!isUpdate && !category) throw createError(400, "category is required");
  if (category && !["rejection", "downtime", "waste"].includes(category)) {
    throw createError(400, "category must be 'rejection', 'downtime' or 'waste'");
  }
  if (category && code) {
    const dup = await ReasonCodeMaster.findOne({ where: { category, code, ...(existing ? { id: { [Op.ne]: existing.id } } : {}) } });
    if (dup) throw createError(409, "A reason code with this category+code already exists");
  }
  return { category, code, description, plant_id };
};

module.exports = {
  // GET /api/mastersettings?type=material&search=&plant_id=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { type, search, plant_id, page = 1, limit = 20 } = req.query;
      const { model: Model } = getEntry(type);

      const where = { is_deleted: false };
      if (plant_id) where.plant_id = plant_id;
      if (search) {
        const searchableFields = {
          plant: ["plant_code", "name"],
          material: ["material_code", "name"],
          variety: ["variety_name"],
          uom: ["uom_code", "name"],
          rate: [],
          quality_parameter: ["parameter_name"],
          reason_code: ["code", "description"],
        }[type];
        if (searchableFields && searchableFields.length) {
          where[Op.or] = searchableFields.map((f) => ({ [f]: { [Op.like]: `%${search}%` } }));
        }
      }

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await Model.findAndCountAll({
        where,
        include: getIncludes(type),
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

  // GET /api/mastersettings/:id?type=material
  getById: async (req, res, next) => {
    try {
      const { type } = req.query;
      const { model: Model, label } = getEntry(type);

      const record = await Model.findOne({
        where: { id: req.params.id, is_deleted: false },
        include: getIncludes(type),
      });
      if (!record) throw createError(404, `${label} not found`);
      res.status(200).json({ success: true, data: record });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/mastersettings  { type, ...fields }
  create: async (req, res, next) => {
    try {
      const { type } = req.body;
      const { model: Model, label } = getEntry(type);

      const payload = await validateAndBuildPayload(type, req.body);
      Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
      payload.created_by = req.user ? req.user.id : null;
      if ("plant_id" in payload) payload.plant_id = payload.plant_id || (req.user ? req.user.plant_id : null);

      const record = await Model.create(payload);
      const created = await Model.findByPk(record.id, { include: getIncludes(type) });

      res.status(201).json({ success: true, msg: `${label} created`, data: created });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/mastersettings/:id  { type, ...fields }
  update: async (req, res, next) => {
    try {
      const { type } = req.body;
      const { model: Model, label } = getEntry(type);

      const record = await Model.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!record) throw createError(404, `${label} not found`);

      const payload = await validateAndBuildPayload(type, req.body, { isUpdate: true, existing: record });
      Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
      payload.updated_by = req.user ? req.user.id : null;

      await record.update(payload);
      const updated = await Model.findByPk(record.id, { include: getIncludes(type) });

      res.status(200).json({ success: true, msg: `${label} updated`, data: updated });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/mastersettings/:id?type=material  (soft delete)
  delete: async (req, res, next) => {
    try {
      const { type } = req.query;
      const { model: Model, label } = getEntry(type);

      const record = await Model.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!record) throw createError(404, `${label} not found`);

      await record.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: `${label} deleted` });
    } catch (err) {
      next(err);
    }
  },
};