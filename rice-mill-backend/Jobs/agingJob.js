const cron = require("node-cron");
const { Op } = require("sequelize");
const { FinishedGoods } = require("../models/index");

const AGING_THRESHOLD_DAYS = 30;

// Flags any 'ready' finished-goods row whose ready_since is more than 30 days
// old as 'aging'. aged_days itself is a virtual field computed live on every
// read (today - ready_since), so this job only needs to touch fg_status —
// nothing to "update" on aged_days directly.
const flagAgingStock = async () => {
  const cutoff = new Date(Date.now() - AGING_THRESHOLD_DAYS * 86400000);

  const candidates = await FinishedGoods.findAll({
    where: { is_deleted: false, fg_status: "ready", ready_since: { [Op.lte]: cutoff } },
  });

  await Promise.all(candidates.map((row) => row.update({ fg_status: "aging" })));

  console.log(`[agingJob] Flagged ${candidates.length} finished-goods record(s) as 'aging'`);
  return candidates.length;
};

// Runs every night at 00:30 server time.
const scheduleAgingJob = () => {
  cron.schedule("30 0 * * *", () => {
    flagAgingStock().catch((err) => console.error("[agingJob] Failed:", err.message));
  });
  console.log("[agingJob] Scheduled nightly FG aging sweep (00:30)");
};

module.exports = { flagAgingStock, scheduleAgingJob };
