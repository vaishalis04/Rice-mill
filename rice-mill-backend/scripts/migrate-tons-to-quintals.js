/* eslint-disable no-console */
// ---------------------------------------------------------------------------
// ONE-TIME DATA MIGRATION — old "Qtl" (really 1000 kg) -> true quintals (100 kg)
//
// Until now this ERP stored every quantity (stock, lots, orders, loading...) in a
// unit it labelled "Qtl" but that was 1000 kg. The code now uses real quintals
// (1 Qtl = 100 kg, helpers/units.js), so every quantity ALREADY SAVED in the
// database has to be multiplied by 10 to keep meaning the same physical weight.
// (1 old unit = 1000 kg = 10 true quintals.)
//
// What is converted (x10):
//   lots.qty, lots.rejected_qty                    stacks.qty
//   inventory.qty_in / qty_out / balance_qty       production_batch.input_qty
//   production_batch.materials_data[].input_qty    production_batch.outputs_data (all qty fields)
//   reject_material.qty                            warehouse_master.capacity
//   sales_order.qty / dispatched_qty               sales_order.items[].qty / dispatched_qty
//   purchase_order.qty (the "a,b,c" text)          purchase_order.items[].qty
//   gate_entry.expected_qty                        gate_entry_purchase_orders.qty
//   gate_entry_sales_orders.qty                    loading.loaded_qty, loading.items[].qty
//
// NOT converted (already kg, or not a quantity): finished_goods.qty (kg), weighbridge
// weights, bag / pack sizes, bag counts, rates, amounts, payment settlements, and
// gate_entry_misc_items (free units). Rates are left alone on purpose — check them
// yourself if any of your rates were quoted "per old Qtl".
//
// USAGE (from rice-mill-backend/), BACK UP THE DATABASE FIRST:
//   node scripts/migrate-tons-to-quintals.js            -> DRY RUN: shows what would change, writes nothing
//   node scripts/migrate-tons-to-quintals.js --apply    -> does it, in ONE transaction (all or nothing)
//
// It records itself in a small table (unit_migrations) and refuses to run twice, so a
// second --apply can't multiply by 10 again. Run it exactly once, at the same moment
// you deploy the new code.
// ---------------------------------------------------------------------------
const FACTOR = 10;
const MIGRATION = "tons_to_quintals_x10";

// ---- pure helpers (exported so they can be tested) ----
const scale = (v) => {
  if (v === null || v === undefined || v === "") return v;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * FACTOR * 1e6) / 1e6 : v;
};
const asJson = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch (e) { return null; }
  }
  return v;
};
const scaleKeys = (obj, keys) => {
  if (!obj || typeof obj !== "object") return obj;
  const out = { ...obj };
  keys.forEach((k) => { if (k in out) out[k] = scale(out[k]); });
  return out;
};
// purchase_order.qty is text like "100,250.5"
const scaleCsv = (s) => (typeof s === "string" && s.trim() !== ""
  ? s.split(",").map((p) => { const n = Number(p); return p.trim() !== "" && Number.isFinite(n) ? String(scale(n)) : p; }).join(",")
  : s);

const NUMERIC = [
  ["lots", ["qty", "rejected_qty"]],
  ["stacks", ["qty"]],
  ["inventory", ["qty_in", "qty_out", "balance_qty"]],
  ["production_batch", ["input_qty"]],
  ["reject_material", ["qty"]],
  ["warehouse_master", ["capacity"]],
  ["sales_order", ["qty", "dispatched_qty"]],
  ["gate_entry", ["expected_qty"]],
  ["gate_entry_purchase_orders", ["qty"]],
  ["gate_entry_sales_orders", ["qty"]],
  ["loading", ["loaded_qty"]],
];

// [table, column, transform(value) -> new value]
const JSON_COLS = [
  ["production_batch", "materials_data", (j) => (Array.isArray(j) ? j.map((l) => scaleKeys(l, ["input_qty"])) : j)],
  ["production_batch", "outputs_data", (j) => {
    if (!j || typeof j !== "object") return j;
    const out = { ...j };
    if (Array.isArray(out.lines)) out.lines = out.lines.map((l) => scaleKeys(l, ["input_qty", "accepted_qty", "rejected_qty", "loss_qty"]));
    if (Array.isArray(out.outputs)) out.outputs = out.outputs.map((o) => scaleKeys(o, ["accepted_qty", "rejected_qty"]));
    return out;
  }],
  ["sales_order", "items", (j) => (Array.isArray(j) ? j.map((l) => scaleKeys(l, ["qty", "dispatched_qty"])) : j)],
  ["purchase_order", "items", (j) => (Array.isArray(j) ? j.map((l) => scaleKeys(l, ["qty"])) : j)],
  ["loading", "items", (j) => (Array.isArray(j) ? j.map((l) => scaleKeys(l, ["qty"])) : j)],
];

const TEXT_COLS = [["purchase_order", "qty", scaleCsv]];

module.exports = { scale, scaleKeys, scaleCsv, JSON_COLS, NUMERIC, TEXT_COLS, asJson };

if (require.main === module) {
  const apply = process.argv.includes("--apply");
  const sequelize = require("../config/db");

  (async () => {
    const q = (sql, t) => sequelize.query(sql, { type: sequelize.QueryTypes.SELECT, transaction: t });
    const run = (sql, t, replacements) => sequelize.query(sql, { transaction: t, replacements });
    // Created BEFORE the transaction: MySQL commits implicitly on DDL, which would otherwise end the
    // transaction early and make the updates below stop being all-or-nothing.
    await sequelize.query("CREATE TABLE IF NOT EXISTS unit_migrations (name VARCHAR(100) PRIMARY KEY, applied_at DATETIME NOT NULL)");
    const t = await sequelize.transaction();
    try {
      const done = await q(`SELECT name FROM unit_migrations WHERE name = '${MIGRATION}'`, t);
      if (done.length) {
        console.log(`Already applied (${MIGRATION}) — nothing to do. Running it twice would multiply by 10 again, so it refuses.`);
        await t.rollback();
        process.exit(0);
      }

      console.log(apply ? "APPLYING migration (one transaction)...\n" : "DRY RUN — nothing is written. Add --apply to do it.\n");

      for (const [table, cols] of NUMERIC) {
        for (const col of cols) {
          const [r] = await q(`SELECT COUNT(${col}) AS n, COALESCE(SUM(${col}), 0) AS total FROM ${table}`, t);
          console.log(`${table}.${col}: ${r.n} value(s), total ${Number(r.total).toLocaleString()} -> ${(Number(r.total) * FACTOR).toLocaleString()}`);
          if (apply) await run(`UPDATE ${table} SET ${col} = ${col} * ${FACTOR} WHERE ${col} IS NOT NULL`, t);
        }
      }

      for (const [table, col, fn] of TEXT_COLS) {
        const rows = await q(`SELECT id, ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL`, t);
        console.log(`${table}.${col} (text): ${rows.length} row(s)`);
        if (apply) for (const r of rows) await run(`UPDATE ${table} SET ${col} = :v WHERE id = :id`, t, { v: fn(r.v), id: r.id });
      }

      for (const [table, col, fn] of JSON_COLS) {
        const rows = await q(`SELECT id, ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL`, t);
        console.log(`${table}.${col} (json): ${rows.length} row(s)`);
        if (apply) {
          for (const r of rows) {
            const parsed = asJson(r.v);
            if (parsed === null) continue;
            await run(`UPDATE ${table} SET ${col} = :v WHERE id = :id`, t, { v: JSON.stringify(fn(parsed)), id: r.id });
          }
        }
      }

      if (apply) {
        await run(`INSERT INTO unit_migrations (name, applied_at) VALUES ('${MIGRATION}', NOW())`, t);
        await t.commit();
        console.log("\nDone. All quantities are now in true quintals (1 Qtl = 100 kg).");
      } else {
        await t.rollback();
        console.log("\nDry run finished — no changes were made.");
      }
      process.exit(0);
    } catch (err) {
      await t.rollback();
      console.error("\nMigration FAILED and was rolled back — nothing changed.\n", err);
      process.exit(1);
    }
  })();
}
