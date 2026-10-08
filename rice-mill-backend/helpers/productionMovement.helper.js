const { Op } = require("sequelize");
const { KG_PER_QTL } = require("./units");
const {
  ProductionBatch, Packing, FinishedGoods, WarehouseMaster, MaterialMaster, Lot, PlantMaster,
} = require("../models/index");
const { loadStockTimeline, keyOf, asArray } = require("./stockHistory.helper");
const { fmtQty, fmtDMY, fmtCount, COLORS } = require("./reportPdf.helper");

// Production Summary → "what did each batch take out of which warehouse, where
// did it go, and what was the stock before / after / now".
//
//   USED FROM            the batch's reserved materials (materials_data), drawn from
//                        its source warehouse (batch.warehouse_id) when the batch was
//                        completed — this is when stock actually moves
//   TRANSFERRED INTO     the packed output (Packing → FinishedGoods) in its destination
//                        warehouse
//   stock before/after   the quantity of that material held in that warehouse
//                        just before the batch moved stock / right after it finished
//   current stock        the live Inventory balance now
//
// PRODUCTION INTEGRATION: built against production as it works today (reserved inputs on
// the batch, stock drawn at completion, packed output via Packing/FinishedGoods). The
// production-specific reads are all in buildBatchMovements() below plus
// stockHistory.helper.js — adapt those two if the production workflow changes.
//
// Quantities are Qtl, the unit used throughout Inventory. "Value" here is
// quantity: stock is not priced anywhere in this system.
// Before/after come from helpers/stockHistory.helper.js, which rebuilds them from
// the timestamped stock records (there is no stock ledger) and returns null when
// the history can't be trusted — shown as "n/a", never an invented number.

const STATUS_LABEL = {
  pending: "Pending - stock reserved, not yet used",
  in_progress: "In progress",
  completed: "Completed",
  on_hold: "On hold",
  partial: "Partial",
};
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

// Packed output of each batch in Qtl (FinishedGoods.qty is kg).
const packedOutputByBatch = async (batchIds) => {
  const out = new Map();
  if (!batchIds.length) return out;
  const packings = await Packing.findAll({ where: { batch_id: { [Op.in]: batchIds }, is_deleted: false }, attributes: ["id", "batch_id"] });
  if (!packings.length) return out;
  const fgs = await FinishedGoods.findAll({ where: { packing_id: { [Op.in]: packings.map((p) => p.id) }, is_deleted: false }, attributes: ["packing_id", "qty"] });
  const batchOfPacking = new Map(packings.map((p) => [Number(p.id), Number(p.batch_id)]));
  for (const fg of fgs) {
    const b = batchOfPacking.get(Number(fg.packing_id));
    out.set(b, (out.get(b) || 0) + Number(fg.qty || 0) / KG_PER_QTL);
  }
  return out;
};

// Movement detail for the given ProductionBatch rows.
const buildBatchMovements = async (batches) => {
  if (!batches.length) return [];
  const ids = batches.map((b) => Number(b.id));
  const timeline = await loadStockTimeline();
  const [packings, warehouses, materials] = await Promise.all([
    Packing.findAll({ where: { batch_id: { [Op.in]: ids }, is_deleted: false } }),
    WarehouseMaster.findAll({ attributes: ["id", "name"] }),
    MaterialMaster.findAll({ attributes: ["id", "name"] }),
  ]);
  const fgs = packings.length
    ? await FinishedGoods.findAll({ where: { packing_id: { [Op.in]: packings.map((p) => p.id) }, is_deleted: false } })
    : [];
  const whName = new Map(warehouses.map((w) => [Number(w.id), w.name]));
  const matName = new Map(materials.map((m) => [Number(m.id), m.name]));
  const lotIds = [...new Set(batches.flatMap((b) => asArray(b.materials_data).map((m) => Number(m.lot_id))).filter(Boolean))];
  const lots = lotIds.length ? await Lot.findAll({ where: { id: { [Op.in]: lotIds } }, attributes: ["id", "lot_no"] }) : [];
  const lotNo = new Map(lots.map((l) => [Number(l.id), l.lot_no]));
  const fgByPacking = new Map();
  fgs.forEach((fg) => {
    const arr = fgByPacking.get(Number(fg.packing_id)) || [];
    arr.push(fg);
    fgByPacking.set(Number(fg.packing_id), arr);
  });

  return batches.map((b) => {
    const batchId = Number(b.id);
    const mine = packings.filter((p) => Number(p.batch_id) === batchId);
    const completed = mine.length > 0;
    const warnings = [];

    // ---- USED FROM: reserved materials, one line per material ----
    const byMaterial = new Map();
    for (const m of asArray(b.materials_data)) {
      const mid = Number(m.material_id);
      if (!mid) continue;
      const e = byMaterial.get(mid) || { material_id: mid, qty: 0, lots: [] };
      e.qty += Number(m.input_qty) || 0;
      const ln = m.lot_no && m.lot_no !== "x" ? m.lot_no : lotNo.get(Number(m.lot_id));
      if (ln && !e.lots.includes(ln)) e.lots.push(ln);
      byMaterial.set(mid, e);
    }
    const used = [...byMaterial.values()].map((e) => {
      const key = keyOf(b.warehouse_id, e.material_id);
      const reliable = timeline.reliable(key);
      return {
        material_id: e.material_id,
        material_name: matName.get(e.material_id) || `Material ${e.material_id}`,
        lots: e.lots,
        warehouse_id: b.warehouse_id,
        warehouse_name: whName.get(Number(b.warehouse_id)) || "—",
        qty: r3(e.qty),
        before: completed ? timeline.balanceBefore(key, batchId) : null,
        after: completed ? timeline.balanceAfter(key, batchId) : null,
        current: timeline.current(key),
        history_ok: completed ? reliable : true,
      };
    });

    // ---- TRANSFERRED INTO: packed output grouped by destination warehouse + material ----
    const groups = new Map();
    for (const p of mine) {
      for (const fg of fgByPacking.get(Number(p.id)) || []) {
        const mid = Number(p.material_id);
        const gk = `${fg.warehouse_id}|${mid}`;
        const g = groups.get(gk) || { warehouse_id: fg.warehouse_id, material_id: mid, qty: 0, packs: [] };
        g.qty += Number(fg.qty || 0) / KG_PER_QTL;
        g.packs.push({ pack_size: Number(p.pack_size), bags: Number(p.bag_count) || 0, qty: r3(Number(fg.qty || 0) / KG_PER_QTL) });
        groups.set(gk, g);
      }
    }
    const produced = [...groups.values()].map((g) => {
      const key = keyOf(g.warehouse_id, g.material_id);
      const stockEffect = timeline.producedBy(key, batchId);
      const note = Math.abs(stockEffect - g.qty) > 0.001
        ? (stockEffect === 0 ? "stock entry for this packing not found" : `packing edited after completion - stock recorded: ${fmtQty(stockEffect)} Qtl`)
        : null;
      return {
        material_id: g.material_id,
        material_name: matName.get(g.material_id) || `Material ${g.material_id}`,
        warehouse_id: g.warehouse_id,
        warehouse_name: whName.get(Number(g.warehouse_id)) || "—",
        packs: g.packs,
        qty: r3(g.qty),
        before: timeline.balanceBefore(key, batchId),
        after: timeline.balanceAfter(key, batchId),
        current: timeline.current(key),
        history_ok: timeline.reliable(key),
        note,
      };
    });

    const inputQty = r3(Number(b.input_qty) || used.reduce((s, u) => s + u.qty, 0));
    const outputQty = r3(produced.reduce((s, p) => s + p.qty, 0));
    if (completed && used.some((u) => !u.history_ok)) warnings.push("Stock history for a source material could not be rebuilt (the stock was adjusted by hand), so its before / after is shown as n/a.");
    if (completed && produced.some((p) => !p.history_ok)) warnings.push("Stock history for a packed material could not be rebuilt (the stock was adjusted by hand), so its before / after is shown as n/a.");
    produced.forEach((p) => p.note && warnings.push(`${p.material_name}: ${p.note}.`));
    if (!completed && b.batch_status === "completed") warnings.push("Marked completed but has no packing record, so no stock movement was recorded.");

    return {
      batch_id: batchId,
      batch_no: b.batch_no,
      production_date: b.production_date,
      batch_status: b.batch_status,
      status_label: STATUS_LABEL[b.batch_status] || b.batch_status || "—",
      completed,
      source_warehouse: { id: b.warehouse_id, name: whName.get(Number(b.warehouse_id)) || "—" },
      destination_warehouses: [...new Set(produced.map((p) => p.warehouse_name))],
      input_qty: inputQty,
      output_qty: completed ? outputQty : null,
      recovery_pct: completed && inputQty > 0 ? Number(((outputQty / inputQty) * 100).toFixed(2)) : null,
      used,
      produced,
      warnings,
    };
  });
};

const stockCell = (v, completed) => ({ t: v === null ? (completed ? "n/a" : "—") : fmtQty(v), color: v === null ? "#888" : undefined });

// Layout for the Production Summary PDF (rendered by reportPdf.helper.renderTableReport).
const buildProductionPdfSpec = async ({ movements, from, to, plant, truncatedTo }) => {
  const done = movements.filter((m) => m.completed);
  const totalUsed = r3(done.reduce((s, m) => s + m.used.reduce((a, u) => a + u.qty, 0), 0));
  const totalOut = r3(done.reduce((s, m) => s + (m.output_qty || 0), 0));
  const recovery = totalUsed > 0 ? `${((totalOut / totalUsed) * 100).toFixed(2)}%` : "—";

  const groups = movements.map((m) => {
    const rows = [];
    m.used.forEach((u) => {
      rows.push({
        cells: (n) => [
          n, { t: "USED FROM", bold: true, color: "#9A3412" }, u.material_name,
          u.lots.length ? `Lot ${u.lots.join(", ")}` : "—", u.warehouse_name, fmtQty(u.qty),
          stockCell(u.before, m.completed), stockCell(u.after, m.completed), { t: fmtQty(u.current), bold: true },
        ],
      });
    });
    m.produced.forEach((p) => {
      rows.push({
        cells: (n) => [
          n, { t: "TRANSFERRED INTO", bold: true, color: "#166534" }, p.material_name,
          p.packs.map((k) => `${k.pack_size} kg x ${fmtCount(k.bags)}`).join(", "), p.warehouse_name, fmtQty(p.qty),
          stockCell(p.before, true), stockCell(p.after, true), { t: fmtQty(p.current), bold: true },
        ],
      });
    });
    if (!rows.length) {
      rows.push({ cells: () => ["", "", { t: "No materials recorded for this batch.", color: "#888" }, "", "", "", "", "", ""] });
    }
    const meta = m.completed
      ? `Used ${fmtQty(m.input_qty)} -> Packed ${fmtQty(m.output_qty)} Qtl  |  Recovery ${m.recovery_pct != null ? `${m.recovery_pct}%` : "—"}`
      : `Reserved ${fmtQty(m.input_qty)} Qtl`;
    return {
      title: `${m.batch_no}   |   ${m.production_date ? fmtDMY(new Date(`${String(m.production_date).slice(0, 10)}T00:00:00`)) : "—"}   |   ${m.status_label}`,
      meta,
      accent: m.completed ? COLORS.NAVY : "#B45309",
      note: m.warnings.length ? m.warnings.join("  ") : null,
      rows,
    };
  });

  const range = from || to
    ? `Production date: ${from ? fmtDMY(new Date(`${from}T00:00:00`)) : "start"} to ${to ? fmtDMY(new Date(`${to}T00:00:00`)) : "today"}`
    : "Production date: all dates";
  const footnotes = [
    "Used from = materials the batch drew from its source warehouse (stock moves when a batch is completed). Transferred into = packed goods added to the destination warehouse. Quantities are in Qtl.",
    "Stock before / after = the quantity of that material held in that warehouse just before the batch moved stock and right after it finished; Current stock = the live balance now. Stock is not priced in this system, so values are quantities.",
    "Before / after are rebuilt from the stock records (there is no stock ledger). n/a means the records for that warehouse and material no longer add up because stock was adjusted by hand.",
  ];
  if (truncatedTo) footnotes.unshift(`Only the newest ${truncatedTo} batches are listed - narrow the date range to see the rest.`);

  return {
    filename: `production-summary-${from || "all"}${to ? `_to_${to}` : ""}.pdf`,
    title: "PRODUCTION SUMMARY REPORT",
    subtitleLines: [range],
    plant,
    kpis: [
      { label: "Batches", value: String(movements.length) },
      { label: "Completed", value: String(done.length), color: "#166534" },
      { label: "Used from warehouses (Qtl)", value: fmtQty(totalUsed), color: "#9A3412" },
      { label: "Packed into warehouses (Qtl)", value: fmtQty(totalOut), color: "#166534" },
      { label: "Overall recovery", value: recovery },
    ],
    columns: [
      { label: "S.No", w: 34, align: "center" },
      { label: "Movement", w: 112, align: "left" },
      { label: "Material", w: 122, align: "left" },
      { label: "Lot / Packing", w: 118, align: "left" },
      { label: "Warehouse", w: 116, align: "left" },
      { label: "Qty (Qtl)", w: 64, align: "right" },
      { label: "Stock before (Qtl)", w: 76, align: "right" },
      { label: "Stock after (Qtl)", w: 76, align: "right" },
      { label: "Current stock (Qtl)", w: 76, align: "right" },
    ],
    groups,
    emptyText: "No production batches found for the selected dates.",
    footnotes,
  };
};

const firstPlant = () => PlantMaster.findOne({ where: { is_deleted: false }, order: [["id", "ASC"]] });

module.exports = { packedOutputByBatch, buildBatchMovements, buildProductionPdfSpec, firstPlant, STATUS_LABEL };
