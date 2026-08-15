// General-purpose helpers shared across controllers.
// TODO: implement as needed while building out each module.

// e.g. generate sequential token numbers for Gate Entry (Module 1)
// Format: GT-<VEHICLE_NO>-0001 — sequence is per vehicle (all-time), not
// per calendar day, so a truck's Nth visit is always token ...-000N.
const generateTokenNo = async (vehicleNo) => {
  const { GateEntry } = require("../models/index");
  const { Op } = require("sequelize");

  // Keep the token clean/predictable even if the vehicle number was typed
  // with spaces or hyphens (e.g. "MP09 AB 1122" -> "MP09AB1122").
  const cleanVehicleNo = String(vehicleNo || "UNKNOWN")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const prefix = `GT-${cleanVehicleNo}-`;

  const lastForVehicle = await GateEntry.findOne({
    where: { token_no: { [Op.like]: `${prefix}%` } },
    order: [["id", "DESC"]],
  });

  let nextSeq = 1;
  if (lastForVehicle) {
    const lastSeq = parseInt(lastForVehicle.token_no.split("-").pop(), 10);
    if (!Number.isNaN(lastSeq)) nextSeq = lastSeq + 1;
  }

  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
};

// e.g. generate lot / batch numbers for Production & Packing (Modules 11, 16)
const generateLotNo = async () => {
  const { Lot } = require("../models/index");
  const { Op } = require("sequelize");

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const datePart = `${yyyy}${mm}${dd}`;
  const prefix = `LOT-${datePart}-`;

  const startOfDay = new Date(yyyy, now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(yyyy, now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const lastToday = await Lot.findOne({
    where: { lot_no: { [Op.like]: `${prefix}%` }, created_at: { [Op.between]: [startOfDay, endOfDay] } },
    order: [["id", "DESC"]],
  });

  let nextSeq = 1;
  if (lastToday) {
    const lastSeq = parseInt(lastToday.lot_no.split("-").pop(), 10);
    if (!Number.isNaN(lastSeq)) nextSeq = lastSeq + 1;
  }

  return `${prefix}${String(nextSeq).padStart(3, "0")}`;
};

// e.g. compute stock/FG "aging" in days (Modules 9, 17)
const computeAgeDays = (fromDate) => {
  if (!fromDate) return null;
  return Math.floor((Date.now() - new Date(fromDate)) / 86400000);
};

const generateBatchNo = async () => {
  const { ProductionBatch } = require("../models/index");
  const { Op } = require("sequelize");

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const datePart = `${yyyy}${mm}${dd}`;
  const prefix = `BATCH-${datePart}-`;

  const startOfDay = new Date(yyyy, now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(yyyy, now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const lastToday = await ProductionBatch.findOne({
    where: { batch_no: { [Op.like]: `${prefix}%` }, created_at: { [Op.between]: [startOfDay, endOfDay] } },
    order: [["id", "DESC"]],
  });

  let nextSeq = 1;
  if (lastToday) {
    const lastSeq = parseInt(lastToday.batch_no.split("-").pop(), 10);
    if (!Number.isNaN(lastSeq)) nextSeq = lastSeq + 1;
  }

  return `${prefix}${String(nextSeq).padStart(3, "0")}`;
};

const generatePackingBatchNo = async () => {
  const { Packing } = require("../models/index");
  const { Op } = require("sequelize");

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const datePart = `${yyyy}${mm}${dd}`;
  const prefix = `PCK-${datePart}-`;

  const startOfDay = new Date(yyyy, now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(yyyy, now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const lastToday = await Packing.findOne({
    where: { batch_no: { [Op.like]: `${prefix}%` }, created_at: { [Op.between]: [startOfDay, endOfDay] } },
    order: [["id", "DESC"]],
  });

  let nextSeq = 1;
  if (lastToday) {
    const lastSeq = parseInt(lastToday.batch_no.split("-").pop(), 10);
    if (!Number.isNaN(lastSeq)) nextSeq = lastSeq + 1;
  }

  return `${prefix}${String(nextSeq).padStart(3, "0")}`;
};

const ean13CheckDigit = (digits12) => {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const digit = Number(digits12[i]);
    sum += i % 2 === 0 ? digit * 1 : digit * 3;
  }
  const mod = sum % 10;
  return mod === 0 ? 0 : 10 - mod;
};

const generateEAN13 = async () => {
  const { Packing } = require("../models/index");

  const count = await Packing.count();
  const seq = String(count + 1).padStart(9, "0");
  const base12 = `890${seq}`;
  const check = ean13CheckDigit(base12);
  return `${base12}${check}`;
};

const generateDailySequence = async (Model, field, prefixLabel, padLength) => {
  const { Op } = require("sequelize");

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const datePart = `${yyyy}${mm}${dd}`;
  const prefix = `${prefixLabel}-${datePart}-`;

  const startOfDay = new Date(yyyy, now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(yyyy, now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const lastToday = await Model.findOne({
    where: { [field]: { [Op.like]: `${prefix}%` }, created_at: { [Op.between]: [startOfDay, endOfDay] } },
    order: [["id", "DESC"]],
  });

  let nextSeq = 1;
  if (lastToday) {
    const lastSeq = parseInt(lastToday[field].split("-").pop(), 10);
    if (!Number.isNaN(lastSeq)) nextSeq = lastSeq + 1;
  }

  return `${prefix}${String(nextSeq).padStart(padLength, "0")}`;
};

// Generate sequential daily sales order numbers (Module 18)
// Format: SO-YYYYMMDD-001
const generateSoNo = async () => {
  const { SalesOrder } = require("../models/index");
  return generateDailySequence(SalesOrder, "so_no", "SO", 3);
};

// Generate sequential daily PO numbers (Module 4)
// Format: PO-YYYYMMDD-001 — one number shared across every line item
// (material+variety+qty+rate row) belonging to the same purchase order.
const generatePoNo = async () => {
  const { PurchaseOrder } = require("../models/index");
  return generateDailySequence(PurchaseOrder, "po_no", "PO", 3);
};

// Generate sequential daily delivery challan numbers (Module 19)
// Format: CH-YYYYMMDD-001
const generateChallanNo = async () => {
  const { Dispatch } = require("../models/index");
  return generateDailySequence(Dispatch, "challan_no", "CH", 3);
};

// Generate sequential customer codes (Module: Sales/Customers)
// Format: CUST0001, CUST0002, ... — continuous, not reset daily, since
// customers are master data rather than daily transactions. Robust against
// gaps left by deleted records: looks at the highest existing numeric
// suffix rather than a plain row count.
const generateCustomerCode = async () => {
  const { Customer } = require("../models/index");
  const { Op } = require("sequelize");
  const last = await Customer.findOne({
    where: { customer_code: { [Op.like]: "CUST%" } },
    order: [["id", "DESC"]],
  });
  let nextSeq = 1;
  if (last) {
    const match = last.customer_code.match(/CUST(\d+)$/);
    if (match) nextSeq = parseInt(match[1], 10) + 1;
  }
  return `CUST${String(nextSeq).padStart(4, "0")}`;
};

// Generate sequential vendor codes (Module: Purchase/Vendors)
// Format: VEND0001, VEND0002, ... — same rationale as generateCustomerCode.
const generateVendorCode = async () => {
  const { Vendor } = require("../models/index");
  const { Op } = require("sequelize");
  const last = await Vendor.findOne({
    where: { vendor_code: { [Op.like]: "VEND%" } },
    order: [["id", "DESC"]],
  });
  let nextSeq = 1;
  if (last) {
    const match = last.vendor_code.match(/VEND(\d+)$/);
    if (match) nextSeq = parseInt(match[1], 10) + 1;
  }
  return `VEND${String(nextSeq).padStart(4, "0")}`;
};

module.exports = {
  generateTokenNo, generateLotNo, generateBatchNo, computeAgeDays,
  generateCustomerCode, generateVendorCode, generatePoNo,
  generatePackingBatchNo, generateEAN13, generateSoNo, generateChallanNo,
};