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
  // TODO
};

// e.g. compute stock/FG "aging" in days (Modules 9, 17)
const computeAgeDays = (fromDate) => {
  // TODO
};

module.exports = { generateTokenNo, generateLotNo, computeAgeDays };
