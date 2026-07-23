// General-purpose helpers shared across controllers.
// TODO: implement as needed while building out each module.

// e.g. generate sequential token numbers for Gate Entry (Module 1)
const generateTokenNo = async () => {
  const { GateEntry } = require("../models/index");
  const { Op } = require("sequelize");

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const datePart = `${yyyy}${mm}${dd}`;
  const prefix = `GT-${datePart}-`;

  const startOfDay = new Date(yyyy, now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(yyyy, now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const lastToday = await GateEntry.findOne({
    where: { token_no: { [Op.like]: `${prefix}%` }, created_at: { [Op.between]: [startOfDay, endOfDay] } },
    order: [["id", "DESC"]],
  });

  let nextSeq = 1;
  if (lastToday) {
    const lastSeq = parseInt(lastToday.token_no.split("-").pop(), 10);
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

module.exports = {
  generateTokenNo, generateLotNo, generateBatchNo, computeAgeDays,
  generatePackingBatchNo, generateEAN13,
};