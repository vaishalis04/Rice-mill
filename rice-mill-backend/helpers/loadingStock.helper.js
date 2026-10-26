const { Op } = require("sequelize");
const createError = require("http-errors");
const { KG_PER_QTL } = require("./units");
const {
  Inventory, FinishedGoods, Packing, Lot, WarehouseMaster, ProductionBatch, MaterialMaster, Loading,
} = require("../models/index");

// =============================================================================
// Loading <-> stock
//
// A sales truck is loaded FROM A WAREHOUSE, and the quantity loaded is taken out
// of that warehouse's stock — exactly as Unloading puts stock INTO a warehouse.
//
// "Stock" means the same physical stock every screen already agrees on
// (Inventory page, Warehouse > Stock, stock reports, dashboard):
//   * raw    : Inventory rows with stage "raw"  (balance_qty, Qtl)
//   * packed : FinishedGoods rows that are not dispatched (qty, kg) — this
//              includes by-products such as husk / bran, which production packs
//              like any other output.
// Deducting from those two sources is what makes every one of those screens move
// together. Two side effects mirror what production does when it consumes stock
// (controllers/productionOutput.controller.js consumeFromWarehouse):
//   * the legacy Inventory(stage "fg") "shadow" row of that packed lot is reduced
//   * Lot.qty of the source lot is reduced
//
// What was taken is written onto the loading line itself (items[].warehouse_id and
// items[].allocations), so an edit / delete / weighbridge correction can put back
// EXACTLY what was taken, row by row. No schema change is needed.
//
// Column precision: Inventory / Lot are DECIMAL(12,2) (Qtl) and FinishedGoods is
// DECIMAL(12,2) (kg), so amounts are rounded to what the column can hold BEFORE
// they are applied — the allocation record always equals what was really stored.
// =============================================================================

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const EPS = 0.0005;
const sameSize = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) < EPS;

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

// ---------------------------------------------------------------------------
// Reading physical stock
// ---------------------------------------------------------------------------

// Every stock row (raw + packed) that matches, as plain descriptors that keep a
// handle on the underlying record. Same sources / filters as the Warehouse and
// Inventory screens.
const loadStockRows = async ({ materialIds = null, warehouseId = null, transaction, lock = false } = {}) => {
  const opts = { transaction };
  if (lock && transaction) opts.lock = transaction.LOCK.UPDATE;

  const rawWhere = { is_deleted: false, stage: "raw", balance_qty: { [Op.gt]: 0 } };
  if (warehouseId) rawWhere.warehouse_id = Number(warehouseId);
  if (materialIds) rawWhere.material_id = { [Op.in]: materialIds.map(Number) };
  const rawRows = await Inventory.findAll({
    where: rawWhere,
    include: [{ model: Lot, as: "lot", attributes: ["id", "bag_size"] }],
    ...opts,
  });

  const fgWhere = { is_deleted: false, qty: { [Op.gt]: 0 }, fg_status: { [Op.ne]: "dispatched" } };
  if (warehouseId) fgWhere.warehouse_id = Number(warehouseId);
  const fgRows = await FinishedGoods.findAll({ where: fgWhere, ...opts });

  const packingIds = [...new Set(fgRows.map((r) => Number(r.packing_id)).filter(Boolean))];
  const packings = packingIds.length
    ? await Packing.findAll({
        where: { id: { [Op.in]: packingIds }, is_deleted: false },
        attributes: ["id", "lot_id", "material_id", "pack_size"],
        transaction,
      })
    : [];
  const packingById = new Map(packings.map((p) => [Number(p.id), p]));
  const lotIds = [...new Set(packings.map((p) => Number(p.lot_id)).filter(Boolean))];
  const lots = lotIds.length
    ? await Lot.findAll({ where: { id: { [Op.in]: lotIds } }, attributes: ["id", "material_id", "bag_size"], transaction })
    : [];
  const lotById = new Map(lots.map((l) => [Number(l.id), l]));

  const rows = [];
  for (const r of rawRows) {
    rows.push({
      kind: "raw",
      id: Number(r.id),
      warehouse_id: Number(r.warehouse_id),
      material_id: Number(r.material_id),
      lot_id: r.lot_id ? Number(r.lot_id) : null,
      bag_size: r.lot?.bag_size != null ? Number(r.lot.bag_size) : null,
      qty_qtl: Number(r.balance_qty || 0),
      as_of: r.as_of || r.createdAt,
      record: r,
    });
  }
  for (const r of fgRows) {
    const packing = packingById.get(Number(r.packing_id));
    if (!packing) continue;
    const lot = lotById.get(Number(packing.lot_id));
    const materialId = Number(packing.material_id || lot?.material_id);
    if (!materialId) continue;
    if (materialIds && !materialIds.map(Number).includes(materialId)) continue;
    rows.push({
      kind: "fg",
      id: Number(r.id),
      warehouse_id: Number(r.warehouse_id),
      material_id: materialId,
      lot_id: packing.lot_id ? Number(packing.lot_id) : null,
      packing_id: Number(packing.id),
      bag_size: packing.pack_size != null ? Number(packing.pack_size) : lot?.bag_size != null ? Number(lot.bag_size) : null,
      qty_qtl: Number(r.qty || 0) / KG_PER_QTL,
      as_of: r.ready_since || r.createdAt,
      record: r,
    });
  }
  return rows;
};

// Stock a pending (not-yet-packed) production batch has already reserved — same
// rule as Warehouse > summary, so loading can't take what a batch is waiting for.
// -> Map "warehouse|material" -> Qtl
const loadReserved = async ({ warehouseId = null, transaction } = {}) => {
  const where = { batch_status: "pending", is_deleted: false };
  if (warehouseId) where.warehouse_id = Number(warehouseId);
  const batches = await ProductionBatch.findAll({
    where,
    attributes: ["id", "warehouse_id", "material_id", "input_qty", "materials_data"],
    transaction,
  });
  const reserved = new Map();
  for (const b of batches) {
    const lines = asArray(b.materials_data);
    const use = lines.length ? lines : b.material_id ? [{ material_id: b.material_id, input_qty: b.input_qty }] : [];
    for (const line of use) {
      const key = `${Number(b.warehouse_id)}|${Number(line.material_id)}`;
      reserved.set(key, (reserved.get(key) || 0) + Number(line.input_qty || 0));
    }
  }
  return reserved;
};

const bagsFor = (qtl, size) => (size ? Math.floor((Number(qtl) * KG_PER_QTL) / Number(size) + 0.0001) : null);

// What is in stock, per material, per warehouse, per pack size — the figures the
// Loading page shows next to the warehouse picker. `excludeLoadingId` adds back
// what that loading already took, so editing it doesn't count against itself.
// -> { [material_id]: [{ warehouse_id, warehouse_name, total_qtl, reserved_qtl, available_qtl, packs:[{bag_size,bags,qty_qtl}] }] }
const getAvailability = async ({ materialIds, excludeLoadingId = null }) => {
  const ids = [...new Set((materialIds || []).map(Number).filter(Boolean))];
  const result = {};
  ids.forEach((id) => { result[id] = []; });
  if (!ids.length) return result;

  const [rows, reserved, warehouses] = await Promise.all([
    loadStockRows({ materialIds: ids }),
    loadReserved(),
    WarehouseMaster.findAll({ where: { is_deleted: false }, attributes: ["id", "name"] }),
  ]);
  const nameById = new Map(warehouses.map((w) => [Number(w.id), w.name]));

  // key -> { warehouse_id, material_id, packs: Map(sizeKey -> {bag_size, qty}) }
  const groups = new Map();
  const add = (wh, material, size, qtl) => {
    const key = `${wh}|${material}`;
    const g = groups.get(key) || { warehouse_id: wh, material_id: material, packs: new Map() };
    const sk = size == null ? "bulk" : String(Number(size));
    const p = g.packs.get(sk) || { bag_size: size == null ? null : Number(size), qty: 0 };
    p.qty += qtl;
    g.packs.set(sk, p);
    groups.set(key, g);
  };
  rows.forEach((r) => add(r.warehouse_id, r.material_id, r.bag_size, r.qty_qtl));

  if (excludeLoadingId) {
    const own = await Loading.findOne({ where: { id: excludeLoadingId, is_deleted: false }, attributes: ["id", "items"] });
    if (own) {
      for (const item of asArray(own.items)) {
        if (!item.warehouse_id || !ids.includes(Number(item.material_id))) continue;
        for (const a of asArray(item.allocations)) add(Number(item.warehouse_id), Number(item.material_id), item.bag_size, Number(a.qty_qtl) || 0);
      }
    }
  }

  for (const g of groups.values()) {
    const total = [...g.packs.values()].reduce((s, p) => s + p.qty, 0);
    if (total <= EPS) continue;
    const res = reserved.get(`${g.warehouse_id}|${g.material_id}`) || 0;
    result[g.material_id].push({
      warehouse_id: g.warehouse_id,
      warehouse_name: nameById.get(g.warehouse_id) || `Warehouse ${g.warehouse_id}`,
      total_qtl: r3(total),
      reserved_qtl: r3(res),
      available_qtl: r3(Math.max(total - res, 0)),
      packs: [...g.packs.values()]
        .filter((p) => p.qty > EPS)
        .map((p) => ({ bag_size: p.bag_size, bags: bagsFor(p.qty, p.bag_size), qty_qtl: r3(p.qty) }))
        .sort((a, b) => (a.bag_size ?? -1) - (b.bag_size ?? -1)),
    });
  }
  Object.values(result).forEach((list) => list.sort((a, b) => a.warehouse_name.localeCompare(b.warehouse_name)));
  return result;
};

// ---------------------------------------------------------------------------
// Taking stock out / putting it back
// ---------------------------------------------------------------------------

const describeShortage = async ({ warehouseId, materialId, bagSize, qty, available, sizeQty, others }) => {
  const [wh, mat] = await Promise.all([
    WarehouseMaster.findOne({ where: { id: warehouseId }, attributes: ["name"] }),
    MaterialMaster.findOne({ where: { id: materialId }, attributes: ["name"] }),
  ]);
  const whName = wh?.name || `warehouse ${warehouseId}`;
  const matName = mat?.name || `material ${materialId}`;
  if (sizeQty <= EPS) {
    const sizes = others.length
      ? ` It holds ${others.map((p) => `${p.bag_size != null ? `${p.bag_size} kg` : "bulk"} (${r3(p.qty)} Qtl)`).join(", ")} instead.`
      : " This warehouse has no stock of it at all.";
    return `No ${bagSize} kg stock of ${matName} in ${whName}.${sizes} Pick another warehouse or bag size.`;
  }
  return `Not enough ${matName} (${bagSize} kg bags) in ${whName}: ${r3(available)} Qtl available, but this load needs ${r3(qty)} Qtl.`;
};

// Take `qty` Qtl of one material / bag size out of one warehouse, oldest stock
// first. Returns the allocations (exactly what was taken). `clamp` takes what is
// there instead of failing — used only when the weighbridge re-scales a load that
// is already on the road.
const deductStock = async ({ warehouse_id, material_id, bag_size, qty, userId, transaction, clamp = false }) => {
  const wantQtl = r3(qty);
  const rows = await loadStockRows({ materialIds: [material_id], warehouseId: warehouse_id, transaction, lock: true });
  const matching = rows
    .filter((r) => (r.bag_size == null ? bag_size == null || r.kind === "raw" : sameSize(r.bag_size, bag_size)))
    .sort((a, b) => new Date(a.as_of || 0) - new Date(b.as_of || 0) || a.id - b.id);
  const sizeQty = matching.reduce((s, r) => s + r.qty_qtl, 0);
  const totalQty = rows.reduce((s, r) => s + r.qty_qtl, 0);
  const reserved = (await loadReserved({ warehouseId: warehouse_id, transaction })).get(`${Number(warehouse_id)}|${Number(material_id)}`) || 0;
  const available = clamp ? sizeQty : Math.min(sizeQty, Math.max(totalQty - reserved, 0));

  if (!clamp && wantQtl > available + EPS) {
    const others = rows.filter((r) => !matching.includes(r)).reduce((m, r) => {
      const p = m.find((x) => x.bag_size === r.bag_size) || (m.push({ bag_size: r.bag_size, qty: 0 }), m[m.length - 1]);
      p.qty += r.qty_qtl;
      return m;
    }, []);
    throw createError(400, await describeShortage({ warehouseId: warehouse_id, materialId: material_id, bagSize: bag_size, qty: wantQtl, available, sizeQty, others }));
  }

  let remaining = clamp ? Math.min(wantQtl, sizeQty) : wantQtl;
  const allocations = [];
  const now = new Date();

  for (const row of matching) {
    if (remaining <= EPS) break;
    const take = Math.min(row.qty_qtl, remaining);
    if (take <= EPS) continue;

    if (row.kind === "fg") {
      const takeKg = r2(take * KG_PER_QTL);
      const fg = row.record;
      fg.qty = Math.max(0, r2(Number(fg.qty || 0) - takeKg));
      fg.updated_by = userId;
      await fg.save({ transaction });

      // Keep the Inventory(fg) shadow of this packed lot in step (same as production does).
      const adjustments = [];
      let shadowLeft = r2(takeKg / KG_PER_QTL);
      const shadows = await Inventory.findAll({
        where: { warehouse_id, material_id, lot_id: row.lot_id, stage: "fg", is_deleted: false, balance_qty: { [Op.gt]: 0 } },
        order: [["as_of", "ASC"]],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      for (const s of shadows) {
        if (shadowLeft <= EPS) break;
        const t = r2(Math.min(Number(s.balance_qty || 0), shadowLeft));
        if (t <= 0) continue;
        s.balance_qty = r2(Number(s.balance_qty || 0) - t);
        s.qty_out = r2(Number(s.qty_out || 0) + t);
        s.as_of = now;
        s.updated_by = userId;
        await s.save({ transaction });
        adjustments.push({ inventory_id: Number(s.id), qty: t });
        shadowLeft = r2(shadowLeft - t);
      }
      const lotDrop = await dropLot(row.lot_id, r2(takeKg / KG_PER_QTL), userId, transaction, -1);
      allocations.push({
        kind: "fg", finished_goods_id: row.id, packing_id: row.packing_id, lot_id: row.lot_id,
        qty_kg: takeKg, qty_qtl: r3(takeKg / KG_PER_QTL), lot_drop: lotDrop, inventory_adjustments: adjustments,
        stock_bag_size: row.bag_size,
      });
      remaining = r3(remaining - takeKg / KG_PER_QTL);
    } else {
      const takeQtl = r2(take);
      const inv = row.record;
      inv.balance_qty = Math.max(0, r2(Number(inv.balance_qty || 0) - takeQtl));
      inv.qty_out = r2(Number(inv.qty_out || 0) + takeQtl);
      inv.as_of = now;
      inv.updated_by = userId;
      await inv.save({ transaction });
      const lotDrop = await dropLot(row.lot_id, takeQtl, userId, transaction, -1);
      allocations.push({
        kind: "raw", lot_id: row.lot_id, qty_kg: r2(takeQtl * KG_PER_QTL), qty_qtl: r3(takeQtl), lot_drop: lotDrop,
        inventory_adjustments: [{ inventory_id: row.id, qty: takeQtl }],
        stock_bag_size: row.bag_size,
      });
      remaining = r3(remaining - takeQtl);
    }
  }
  return allocations;
};

// Lot.qty follows consumption (see productionOutput lotDrops). Returns what was really applied.
const dropLot = async (lotId, qtl, userId, transaction, sign) => {
  if (!lotId || !qtl) return 0;
  const lot = await Lot.findOne({ where: { id: lotId, is_deleted: false }, transaction, lock: transaction.LOCK.UPDATE });
  if (!lot) return 0;
  const before = Number(lot.qty || 0);
  const after = sign < 0 ? Math.max(0, r2(before - qtl)) : r2(before + qtl);
  await lot.update({ qty: after, updated_by: userId }, { transaction });
  return r2(Math.abs(after - before));
};

// Put back exactly what `allocations` took.
const restoreAllocations = async (allocations, userId, transaction) => {
  const now = new Date();
  for (const a of asArray(allocations)) {
    if (a.kind === "fg" && a.finished_goods_id) {
      const fg = await FinishedGoods.findOne({ where: { id: a.finished_goods_id }, transaction, lock: transaction.LOCK.UPDATE });
      if (fg) {
        fg.qty = r2(Number(fg.qty || 0) + Number(a.qty_kg || 0));
        fg.updated_by = userId;
        await fg.save({ transaction });
      }
    }
    for (const adj of asArray(a.inventory_adjustments)) {
      const inv = await Inventory.findOne({ where: { id: adj.inventory_id }, transaction, lock: transaction.LOCK.UPDATE });
      if (!inv) continue;
      inv.balance_qty = r2(Number(inv.balance_qty || 0) + Number(adj.qty || 0));
      inv.qty_out = Math.max(0, r2(Number(inv.qty_out || 0) - Number(adj.qty || 0)));
      inv.as_of = now;
      inv.updated_by = userId;
      await inv.save({ transaction });
    }
    if (a.lot_id && Number(a.lot_drop) > 0) await dropLot(a.lot_id, Number(a.lot_drop), userId, transaction, +1);
  }
};

const restoreItems = async (items, userId, transaction) => {
  for (const item of asArray(items)) await restoreAllocations(item.allocations, userId, transaction);
};

// Takes stock for every loading line (each line names its own warehouse).
// Returns the lines with `warehouse_id`, `allocations` and `stock_at` filled in.
const deductItems = async ({ items, userId, transaction, clamp = false }) => {
  const out = [];
  for (const item of items) {
    if (!item.warehouse_id) {
      out.push(item);
      continue;
    }
    const allocations = await deductStock({
      warehouse_id: Number(item.warehouse_id),
      material_id: Number(item.material_id),
      bag_size: item.bag_size != null ? Number(item.bag_size) : null,
      qty: Number(item.qty),
      userId,
      transaction,
      clamp,
    });
    out.push({ ...item, warehouse_id: Number(item.warehouse_id), allocations, stock_at: new Date().toISOString() });
  }
  return out;
};

// After the weighbridge re-scales a load: put the old stock back and take the new
// quantity out of the same warehouses, so stock always equals the loaded quantity.
const resyncItems = async ({ oldItems, newItems, userId, transaction }) => {
  const changed = newItems.some((n, i) => Math.abs(Number(n.qty || 0) - Number(asArray(oldItems)[i]?.qty || 0)) > EPS);
  if (!changed) return newItems;
  await restoreItems(oldItems, userId, transaction);
  return deductItems({ items: newItems.map((n) => ({ ...n, allocations: undefined })), userId, transaction, clamp: true });
};

// ---------------------------------------------------------------------------
// For the reports
// ---------------------------------------------------------------------------

// One event per allocation of every live (not deleted) loading.
// -> [{ t, loading_id, loading_no, gate_entry_id, so_id, material_id, warehouse_id, bag_size, kind, qty_qtl,
//       finished_goods_id, lot_id, inventory_qty }]   (inventory_qty = what hit Inventory rows)
const loadingStockEvents = async ({ from = null, to = null, transaction } = {}) => {
  const loadings = await Loading.findAll({
    where: { is_deleted: false },
    attributes: ["id", "loading_no", "gate_entry_id", "so_id", "items", "loaded_at", "created_at"],
    transaction,
  });
  const events = [];
  for (const l of loadings) {
    const when = new Date(l.loaded_at || l.createdAt);
    if (from && when < from) continue;
    if (to && when > to) continue;
    for (const item of asArray(l.items)) {
      if (!item.warehouse_id) continue;
      for (const a of asArray(item.allocations)) {
        events.push({
          t: when.getTime(),
          at: when,
          loading_id: Number(l.id),
          loading_no: l.loading_no,
          gate_entry_id: l.gate_entry_id,
          so_id: Number(item.so_id || l.so_id) || null,
          material_id: Number(item.material_id),
          warehouse_id: Number(item.warehouse_id),
          // pack size of the STOCK row that was drawn on (what the stock reports key on)
          bag_size: a.stock_bag_size !== undefined ? (a.stock_bag_size != null ? Number(a.stock_bag_size) : null) : item.bag_size != null ? Number(item.bag_size) : null,
          kind: a.kind,
          qty_qtl: Number(a.qty_qtl) || 0,
          finished_goods_id: a.finished_goods_id ? Number(a.finished_goods_id) : null,
          lot_id: a.lot_id ? Number(a.lot_id) : null,
          inventory_qty: asArray(a.inventory_adjustments).reduce((s, x) => s + (Number(x.qty) || 0), 0),
        });
      }
    }
  }
  return events;
};

// finished_goods_id -> Qtl ever loaded out of it (to rebuild what a packing run PRODUCED).
const loadedQtlByFinishedGoods = (events) => {
  const m = new Map();
  for (const e of events) if (e.finished_goods_id) m.set(e.finished_goods_id, (m.get(e.finished_goods_id) || 0) + e.qty_qtl);
  return m;
};

module.exports = {
  getAvailability, deductStock, deductItems, restoreAllocations, restoreItems, resyncItems,
  loadingStockEvents, loadedQtlByFinishedGoods, asArray, r2, r3,
};
