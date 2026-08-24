const createError = require("http-errors");
const PDFDocument = require("pdfkit");
const {
  Dispatch, SalesOrder, Customer, MaterialMaster, Vehicle, Driver, FinishedGoods,
} = require("../models/index");
const { generateChallanNo } = require("../helpers/helperFunction");

// Challan, invoice, loading slip, direct outward dispatch (Module 19)
// Creating a dispatch allocates one or more 'ready' FinishedGoods rows against
// a sales order, flips them to 'dispatched', generates a sequential challan_no,
// and marks the sales order 'dispatched'. GET /:id/challan streams a basic
// Delivery Challan PDF built with pdfkit.

const detailIncludes = [
  {
    model: SalesOrder,
    as: "salesOrder",
    attributes: ["id", "so_no", "customer_id", "material_id", "qty", "rate"],
    include: [
      { model: Customer, as: "customer", attributes: ["id", "customer_code", "name", "address", "gstin"] },
      { model: MaterialMaster, as: "material", attributes: ["id", "material_code", "name"] },
    ],
  },
  { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no", "type"] },
  { model: Driver, as: "driver", attributes: ["id", "name", "mobile"] },
  { model: FinishedGoods, as: "allocatedStock", attributes: ["id", "packing_id", "qty", "fg_status"] },
];

module.exports = {
  // GET /api/dispatches?so_id=&dispatch_status=&page=&limit=
  getAll: async (req, res, next) => {
    try {
      const { so_id, dispatch_status, plant_id, page = 1, limit = 20 } = req.query;

      const where = { is_deleted: false };
      if (so_id) where.so_id = so_id;
      if (dispatch_status) where.dispatch_status = dispatch_status;
      if (plant_id) where.plant_id = plant_id;

      const offset = (Number(page) - 1) * Number(limit);

      const { rows, count } = await Dispatch.findAndCountAll({
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

  // GET /api/dispatches/:id
  getById: async (req, res, next) => {
    try {
      const dispatch = await Dispatch.findOne({ where: { id: req.params.id, is_deleted: false }, include: detailIncludes });
      if (!dispatch) throw createError(404, "Dispatch not found");
      res.status(200).json({ success: true, data: dispatch });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/dispatches
  // { so_id, vehicle_id, driver_id, finished_goods_ids: [1,2,...], dispatch_weight?, dispatch_time?, dispatch_type? }
  create: async (req, res, next) => {
    try {
      const { so_id, vehicle_id, driver_id, finished_goods_ids, dispatch_weight, dispatch_time, dispatch_type, plant_id } = req.body;

      if (!so_id || !vehicle_id || !driver_id || !Array.isArray(finished_goods_ids) || finished_goods_ids.length === 0) {
        throw createError(400, "so_id, vehicle_id, driver_id and a non-empty finished_goods_ids array are required");
      }

      const so = await SalesOrder.findOne({ where: { id: so_id, is_deleted: false } });
      if (!so) throw createError(400, "Invalid so_id");
      if (["dispatched", "closed", "cancelled"].includes(so.so_status)) {
        throw createError(400, `This sales order is already '${so.so_status}' and cannot be dispatched again`);
      }

      const vehicle = await Vehicle.findOne({ where: { id: vehicle_id, is_deleted: false } });
      if (!vehicle) throw createError(400, "Invalid vehicle_id");

      const driver = await Driver.findOne({ where: { id: driver_id, is_deleted: false } });
      if (!driver) throw createError(400, "Invalid driver_id");

      const stockRows = await FinishedGoods.findAll({ where: { id: finished_goods_ids, is_deleted: false } });
      if (stockRows.length !== finished_goods_ids.length) {
        throw createError(400, "One or more finished_goods_ids are invalid");
      }
      const notReady = stockRows.filter((r) => r.fg_status !== "ready");
      if (notReady.length > 0) {
        throw createError(400, `Finished goods record(s) not in 'ready' status: ${notReady.map((r) => r.id).join(", ")}`);
      }

      const totalQty = stockRows.reduce((sum, r) => sum + Number(r.qty), 0);
      const challan_no = await generateChallanNo();

      const dispatch = await Dispatch.create({
        so_id,
        challan_no,
        vehicle_id,
        driver_id,
        dispatch_weight: dispatch_weight !== undefined ? dispatch_weight : totalQty,
        dispatch_time: dispatch_time || new Date(),
        dispatch_type: dispatch_type || "normal",
        dispatch_status: "dispatched",
        plant_id: plant_id || so.plant_id || (req.user ? req.user.plant_id : null),
        created_by: req.user ? req.user.id : null,
      });

      await Promise.all(
        stockRows.map((row) => row.update({
          fg_status: "dispatched",
          dispatch_id: dispatch.id,
          updated_by: req.user ? req.user.id : null,
        }))
      );

      await so.update({ so_status: "dispatched", updated_by: req.user ? req.user.id : null });

      const created = await Dispatch.findByPk(dispatch.id, { include: detailIncludes });
      res.status(201).json({
        success: true,
        msg: `Dispatch created — challan ${challan_no}, ${stockRows.length} FG record(s) allocated (${totalQty} kg)`,
        data: created,
      });
    } catch (err) {
      next(err);
    }
  },

  // PUT /api/dispatches/:id
  update: async (req, res, next) => {
    try {
      const dispatch = await Dispatch.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!dispatch) throw createError(404, "Dispatch not found");

      const { dispatch_weight, dispatch_time, dispatch_status, plant_id } = req.body;
      if (dispatch_status && !["pending", "dispatched", "delivered", "cancelled"].includes(dispatch_status)) {
        throw createError(400, "Invalid dispatch_status");
      }

      const updates = { dispatch_weight, dispatch_time, dispatch_status, plant_id };
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);
      updates.updated_by = req.user ? req.user.id : null;

      await dispatch.update(updates);

      const updated = await Dispatch.findByPk(dispatch.id, { include: detailIncludes });
      res.status(200).json({ success: true, msg: "Dispatch updated", data: updated });
    } catch (err) {
      next(err);
    }
  },

  // DELETE /api/dispatches/:id  (soft delete)
  delete: async (req, res, next) => {
    try {
      const dispatch = await Dispatch.findOne({ where: { id: req.params.id, is_deleted: false } });
      if (!dispatch) throw createError(404, "Dispatch not found");

      await dispatch.update({ is_deleted: true, updated_by: req.user ? req.user.id : null });
      res.status(200).json({ success: true, msg: "Dispatch deleted" });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/dispatches/:id/challan
  // Streams a basic Delivery Challan PDF built with pdfkit.
  getChallanPdf: async (req, res, next) => {
    try {
      const dispatch = await Dispatch.findOne({ where: { id: req.params.id, is_deleted: false }, include: detailIncludes });
      if (!dispatch) throw createError(404, "Dispatch not found");

      const so = dispatch.salesOrder;
      const customer = so ? so.customer : null;
      const material = so ? so.material : null;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="challan-${dispatch.challan_no}.pdf"`);

      const doc = new PDFDocument({ size: "A4", margin: 50 });
      doc.pipe(res);

      doc.fontSize(18).text("DELIVERY CHALLAN", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(10).text("Rice Mill ERP", { align: "center" });
      doc.moveDown(1.5);

      doc.fontSize(11);
      doc.text(`Challan No: ${dispatch.challan_no}`);
      doc.text(`Dispatch Date: ${new Date(dispatch.dispatch_time).toLocaleString()}`);
      doc.text(`Sales Order No: ${so ? so.so_no : "-"}`);
      doc.moveDown();

      doc.fontSize(13).text("Customer Details", { underline: true });
      doc.fontSize(11);
      doc.text(`Name: ${customer ? customer.name : "-"}`);
      doc.text(`GSTIN: ${customer && customer.gstin ? customer.gstin : "-"}`);
      doc.text(`Address: ${customer && customer.address ? customer.address : "-"}`);
      doc.moveDown();

      doc.fontSize(13).text("Transport Details", { underline: true });
      doc.fontSize(11);
      doc.text(`Vehicle No: ${dispatch.vehicle ? dispatch.vehicle.vehicle_no : "-"}`);
      doc.text(`Driver: ${dispatch.driver ? dispatch.driver.name : "-"} (${dispatch.driver ? dispatch.driver.mobile : "-"})`);
      doc.moveDown();

      doc.fontSize(13).text("Material Details", { underline: true });
      doc.fontSize(11);
      doc.text(`Material: ${material ? material.name : "-"} (${material ? material.material_code : "-"})`);
      doc.text(`Ordered Qty (Tons): ${so ? so.qty : "-"}`);
      doc.text(`Rate: ${so ? so.rate : "-"}`);
      doc.text(`Dispatched Weight: ${dispatch.dispatch_weight} kg`);
      doc.moveDown();

      doc.fontSize(13).text("Allocated Finished Goods", { underline: true });
      doc.fontSize(11);
      if (dispatch.allocatedStock && dispatch.allocatedStock.length > 0) {
        dispatch.allocatedStock.forEach((row) => {
          doc.text(`- FG #${row.id} (packing #${row.packing_id}): ${row.qty} kg`);
        });
      } else {
        doc.text("- none recorded");
      }

      doc.moveDown(2);
      doc.fontSize(10).text("This is a system-generated delivery challan.", { align: "center" });

      doc.end();
    } catch (err) {
      next(err);
    }
  },
};
