const { Inventory, ProductionBatch, Packing, FinishedGoods } = require("../models/index");

// Warehouse stock "before" and "after" a production batch.
//
// This system keeps no stock-movement ledger (inventory.controller.ledger is an
// unimplemented stub) — only live balances. But EVERY change to a balance has a
// timestamped record behind it, so the history can be rebuilt exactly:
//
//   + inflow     an Inventory row's qty_in, at the row's created_at
//                (unloading completion creates the raw rows; a packing run creates the fg rows)
//   - outflow    a completed batch's reserved materials (materials_data[].input_qty),
//                drawn from the batch's source warehouse when the batch was completed
//
// Starting from the live balance and undoing everything that happened AFTER a
// batch gives the balance right after it; undoing the batch itself gives the
// balance right before it. Balances are tracked per (warehouse, material),
// across raw and packed stock, because that is how production draws stock.
//
// A batch is treated as ONE atomic event: its consumption and the Inventory
// rows its packing created are all stamped with the batch's completion time.
// Those rows are matched to their packing by warehouse + material + creation
// time (an fg row is created within milliseconds of its FinishedGoods record).
//
// PRODUCTION INTEGRATION NOTES — written against production as it works today.
// This file (with productionMovement.helper.js) is the ONLY place the reports depend
// on how production moves stock. If production changes, these are the assumptions to
// revisit:
//   1. a batch reserves its inputs in ProductionBatch.materials_data
//      ([{ material_id, input_qty, lot_id }], Qtl) and its source in batch.warehouse_id
//   2. stock is only drawn when the batch is completed (packing.completeAndPack ->
//      consumeFromWarehouse), as ONE event
//   3. the packed output is Packing -> FinishedGoods (destination warehouse) AND a new
//      Inventory row (stage "fg"), created within milliseconds of each other
//   4. nothing else changes a balance (no ledger / adjustments)
// The cleanest future change is to have production write a real stock-movement record
// (batch id, warehouse, material, qty, balance before / after) at completion; then
// loadStockTimeline() can simply read those rows instead of rebuilding them.
//
// Safety net: if the rebuilt history doesn't add back up to the live balance
// for a (warehouse, material) — e.g. someone edited a balance by hand — that
// pair is marked unreliable and before/after are returned as null rather than
// an invented number.

const EPS = 0.005; // Qtl
const MATCH_WINDOW_MS = 10000;
const keyOf = (warehouseId, materialId) => `${Number(warehouseId) || 0}|${Number(materialId)}`;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const ts = (d) => (d ? new Date(d).getTime() : 0);

// JSON columns come back as an array or, on some drivers, as a JSON string.
const asArray = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim()) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch (e) {
      return [];
    }
  }
  return [];
};

// Pair every finished-goods Inventory row with the FinishedGoods / Packing record that
// created it. A packing run writes the two within milliseconds of each other, in the
// same warehouse, for the same material — so they are matched by warehouse + material
// + creation time (exact quantity first, then ignoring quantity for a packing that was
// edited afterwards, because that edit changes FinishedGoods.qty but not the Inventory row).
// Inventory has no packing_id, which is why this is needed to know a row's real pack size.
const matchFgRows = (inv, packings, fgs) => {
  const packingById = new Map(packings.map((p) => [Number(p.id), p]));
  const fgRows = inv.filter((r) => r.stage === "fg");
  const ownerOfRow = new Map(); // inventory id -> batch id
  const pending = fgs
    .map((fg) => ({ fg, packing: packingById.get(Number(fg.packing_id)) }))
    .filter((x) => x.packing && x.packing.material_id)
    .sort((a, b) => ts(a.fg.createdAt) - ts(b.fg.createdAt));
  const matched = new Map(); // fg id -> inventory row
  const tryMatch = (strictQty) => {
    for (const { fg, packing } of pending) {
      if (matched.has(fg.id)) continue;
      const want = Number(fg.qty || 0) / 1000;
      let best = null;
      let bestDt = Infinity;
      for (const row of fgRows) {
        if (ownerOfRow.has(row.id)) continue;
        if (Number(row.warehouse_id) !== Number(fg.warehouse_id) || Number(row.material_id) !== Number(packing.material_id)) continue;
        if (strictQty && Math.abs(Number(row.qty_in || 0) - want) > 0.0006) continue;
        const dt = Math.abs(ts(row.createdAt) - ts(fg.createdAt));
        if (dt <= MATCH_WINDOW_MS && dt < bestDt) {
          best = row;
          bestDt = dt;
        }
      }
      if (best) {
        matched.set(fg.id, best);
        ownerOfRow.set(best.id, Number(packing.batch_id));
      }
    }
  };
  tryMatch(true);
  tryMatch(false);
  return { matched, ownerOfRow, pending };
};

// Inventory row id -> the pack size (kg) it was packed in, for every finished-goods row
// that can be matched to its packing.
const loadFgPackSizes = async () => {
  const [inv, packings] = await Promise.all([
    Inventory.findAll({ where: { is_deleted: false, stage: "fg" } }),
    Packing.findAll({}),
  ]);
  const fgs = packings.length ? await FinishedGoods.findAll({ where: { packing_id: packings.map((p) => p.id) } }) : [];
  const { matched, pending } = matchFgRows(inv, packings, fgs);
  const packingOfFg = new Map(pending.map((x) => [x.fg.id, x.packing]));
  const sizeByRow = new Map();
  matched.forEach((row, fgId) => {
    const packing = packingOfFg.get(fgId);
    if (packing && packing.pack_size != null) sizeByRow.set(row.id, Number(packing.pack_size));
  });
  return sizeByRow;
};

const loadStockTimeline = async () => {
  const [inv, packings] = await Promise.all([
    Inventory.findAll({ where: { is_deleted: false } }),
    // soft-deleted packings still changed stock when they were made, so keep them
    Packing.findAll({}),
  ]);
  const batchIds = [...new Set(packings.map((p) => Number(p.batch_id)).filter(Boolean))];
  const batches = batchIds.length ? await ProductionBatch.findAll({ where: { id: batchIds } }) : [];
  const fgs = packings.length ? await FinishedGoods.findAll({ where: { packing_id: packings.map((p) => p.id) } }) : [];

  // ---- live balances per (warehouse, material) ----
  const live = new Map();
  for (const r of inv) {
    const k = keyOf(r.warehouse_id, r.material_id);
    live.set(k, (live.get(k) || 0) + Number(r.balance_qty || 0));
  }

  // ---- which fg Inventory rows belong to which batch ----
  const packingById = new Map(packings.map((p) => [Number(p.id), p]));
  const { matched, ownerOfRow, pending } = matchFgRows(inv, packings, fgs);

  // ---- one record per batch that has packings ----
  const batchInfo = new Map();
  for (const b of batches) {
    batchInfo.set(Number(b.id), {
      id: Number(b.id),
      warehouse_id: b.warehouse_id,
      reserved: asArray(b.materials_data)
        .map((m) => ({ material_id: Number(m.material_id), qty: Number(m.input_qty) || 0, lot_id: m.lot_id ? Number(m.lot_id) : null }))
        .filter((m) => m.material_id && m.qty),
      rows: [], // fg Inventory rows its packing created
      fgs: [],
      T: 0,
    });
  }
  for (const { fg, packing } of pending) {
    const info = batchInfo.get(Number(packing.batch_id));
    if (!info) continue;
    info.fgs.push({ fg, packing, row: matched.get(fg.id) || null });
    info.T = Math.max(info.T, ts(fg.createdAt));
    const row = matched.get(fg.id);
    if (row) {
      info.rows.push(row);
      info.T = Math.max(info.T, ts(row.createdAt));
    }
  }
  for (const info of batchInfo.values()) {
    if (!info.T) {
      const p = packings.find((x) => Number(x.batch_id) === info.id);
      info.T = ts(p && p.createdAt);
    }
  }

  // ---- events ----
  const events = [];
  for (const info of batchInfo.values()) {
    for (const m of info.reserved) {
      events.push({ t: info.T, key: keyOf(info.warehouse_id, m.material_id), delta: -m.qty, batchId: info.id, kind: "consume" });
    }
    for (const row of info.rows) {
      events.push({ t: info.T, key: keyOf(row.warehouse_id, row.material_id), delta: Number(row.qty_in || 0), batchId: info.id, kind: "produce" });
    }
  }
  for (const row of inv) {
    if (ownerOfRow.has(row.id)) continue;
    events.push({ t: ts(row.createdAt), key: keyOf(row.warehouse_id, row.material_id), delta: Number(row.qty_in || 0), batchId: null, kind: "inflow" });
  }

  // ---- consistency check: the rebuilt history must add up to the live balance ----
  const forward = new Map();
  for (const e of events) forward.set(e.key, (forward.get(e.key) || 0) + e.delta);
  const keys = new Set([...live.keys(), ...forward.keys()]);
  const drift = new Map();
  for (const k of keys) drift.set(k, (live.get(k) || 0) - (forward.get(k) || 0));
  const reliable = (k) => Math.abs(drift.get(k) || 0) <= EPS;

  const eventsByKey = new Map();
  for (const e of events) {
    if (!eventsByKey.has(e.key)) eventsByKey.set(e.key, []);
    eventsByKey.get(e.key).push(e);
  }

  const isAfter = (e, T, batchId) => e.t > T || (e.t === T && e.batchId != null && e.batchId !== batchId && e.batchId > batchId);

  // stock of (warehouse, material) right AFTER the batch finished
  const balanceAfter = (key, batchId) => {
    const info = batchInfo.get(Number(batchId));
    if (!info || !info.T || !reliable(key)) return null;
    let bal = live.get(key) || 0;
    for (const e of eventsByKey.get(key) || []) {
      if (isAfter(e, info.T, Number(batchId))) bal -= e.delta; // undo it
    }
    return r3(bal);
  };
  const movedBy = (key, batchId, kind) =>
    r3((eventsByKey.get(key) || []).filter((e) => e.batchId === Number(batchId) && e.kind === kind).reduce((s, e) => s + Math.abs(e.delta), 0));
  // stock right BEFORE the batch drew / added anything
  const balanceBefore = (key, batchId) => {
    const after = balanceAfter(key, batchId);
    if (after === null) return null;
    return r3(after + movedBy(key, batchId, "consume") - movedBy(key, batchId, "produce"));
  };

  return {
    keyOf, live, drift, reliable, batchInfo, ownerOfRow,
    current: (key) => r3(live.get(key) || 0),
    balanceAfter, balanceBefore, consumedBy: (key, id) => movedBy(key, id, "consume"), producedBy: (key, id) => movedBy(key, id, "produce"),
  };
};

module.exports = { loadStockTimeline, loadFgPackSizes, matchFgRows, keyOf, asArray, EPS };