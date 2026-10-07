const createError = require("http-errors");
const { Op } = require("sequelize");
const {
  Inventory, Lot, MaterialMaster, WarehouseMaster, PlantMaster, ProductionBatch, Packing, FinishedGoods,
} = require("../models/index");
const {
  ymdLocal, fmtDMY, fmtDMYHM, parseYmd, dayStart, dayEnd, fmtQty, fmtCount,
} = require("./reportPdf.helper");
const { loadFgPackSizes } = require("./stockHistory.helper");

// The stock-movement engine behind every stock PDF: Inventory > Reports
// (Stock Movement / Current Stock) and the Warehouse page's Stock Report.
//
// How each column is derived (all quantities in Qtl, as on the Inventory screen):
//   Closing     the live Inventory balance (only meaningful when the period ends today)
//   Inwards     Inventory rows (stage "raw") CREATED in the period — unloading
//               completion creates exactly one per lot, with qty_in = accepted qty.
//               NOT Lot.qty / Lot.updated_at: packing lowers Lot.qty and bumps its
//               updated_at, so that figure shrinks and moves after every batch.
//   Production  packed stock added in the period: the finished-goods Inventory rows created
//               in it (what actually entered stock — editing a packing later changes
//               FinishedGoods.qty but not the stock), labelled with their real pack size
//   Issue       raw material CONSUMED by batches completed in the period, from the
//               batch's source warehouse (batch.materials_data input_qty — the INPUT
//               material, not the packed output)
//   Dispatch    finished goods marked dispatched in the period (information only —
//               see DISPATCH_REDUCES_STOCK)
//   Opening     Closing with the period's movements reversed out
//
// IMPORTANT LIMITATION: this app keeps no stock-movement ledger — stock is only
// ever updated as a balance — so Opening/Closing can only be given when the
// period ends today. For an earlier period the movements are still exact, but
// Opening/Closing print "—" instead of an invented number.

// Dispatching goods (Dispatch module) or loading a sales truck does NOT reduce the
// Inventory balance in this system, so a dispatch must not be added back when
// working Opening out of Closing. Flip to true if dispatch ever starts deducting stock.
const DISPATCH_REDUCES_STOCK = false;

const parseIdList = (v) => [...new Set(String(v ?? "").split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0))];
const isTrue = (v) => ["1", "true", "yes", "on"].includes(String(v ?? "").toLowerCase());

const STAGE_LABEL = { raw: "Raw", fg: "Packed" };
const sizeLabel = (size) => (size != null ? `${Number(size)} kg` : "Bulk");

// Master data for names, plus the warehouse/item scope requested
// (null = every warehouse, including stock with no warehouse set).
const loadScope = async (query) => {
  const warehouses = await WarehouseMaster.findAll({
    where: { is_deleted: false },
    attributes: ["id", "name", "warehouse_code", "plant_id"],
    order: [["name", "ASC"]],
  });
  const warehouseById = new Map(warehouses.map((w) => [Number(w.id), w]));
  const materials = await MaterialMaster.findAll({
    where: { is_deleted: false },
    attributes: ["id", "name", "material_code"],
    order: [["name", "ASC"]],
  });
  const materialById = new Map(materials.map((m) => [Number(m.id), m]));

  const wantedWarehouses = parseIdList(query.warehouse_id);
  for (const id of wantedWarehouses) {
    if (!warehouseById.has(id)) throw createError(404, "Warehouse not found");
  }
  const wantedMaterials = parseIdList(query.material_id);
  for (const id of wantedMaterials) {
    if (!materialById.has(id)) throw createError(404, "Item not found");
  }
  const warehouseSet = wantedWarehouses.length ? new Set(wantedWarehouses) : null;
  return {
    warehouses, warehouseById, materials, materialById,
    warehouseIds: wantedWarehouses,
    warehouseSet,
    materialSet: wantedMaterials.length ? new Set(wantedMaterials) : null,
    inWarehouseScope: (id) => (warehouseSet ? id != null && warehouseSet.has(Number(id)) : true),
  };
};

const parseCommonFilters = (query) => {
  const stockType = ["raw", "fg"].includes(String(query.stock_type || "").toLowerCase()) ? String(query.stock_type).toLowerCase() : "all";
  const rawBag = String(query.bag_size ?? "").trim().toLowerCase();
  let bagSize = { mode: "all" };
  if (rawBag === "bulk") bagSize = { mode: "bulk" };
  else if (rawBag && rawBag !== "all") {
    const n = Number(rawBag);
    if (!Number.isFinite(n) || n <= 0) throw createError(400, "Pack size must be a number in kg, or 'bulk'");
    bagSize = { mode: "size", value: n };
  }
  return { stockType, bagSize };
};

const passesFilters = (row, scope, filters) => {
  if (scope.materialSet && !scope.materialSet.has(Number(row.material_id))) return false;
  if (filters.stockType !== "all" && row.stage !== filters.stockType) return false;
  if (filters.bagSize.mode === "bulk" && row.size != null) return false;
  if (filters.bagSize.mode === "size" && !(row.size != null && Number(row.size) === filters.bagSize.value)) return false;
  return true;
};

// A fresh row accumulator keyed by stage + warehouse + material + pack size.
const makeRowStore = (scope) => {
  const map = new Map();
  const whName = (id) => (id == null ? "Unassigned" : scope.warehouseById.get(Number(id))?.name || `Warehouse ${id}`);
  const matName = (id) => scope.materialById.get(Number(id))?.name || `Material ${id}`;
  const get = (stage, warehouseId, materialId, size) => {
    const wh = warehouseId == null ? null : Number(warehouseId);
    const sz = size == null ? null : Number(size);
    const key = `${stage}|${wh ?? 0}|${Number(materialId)}|${sz ?? "b"}`;
    let row = map.get(key);
    if (!row) {
      row = {
        stage, warehouse_id: wh, warehouse_name: whName(wh), material_id: Number(materialId), material_name: matName(materialId),
        size: sz, bags: sz ? 0 : null, opening: 0, inwards: 0, production: 0, dispatch: 0, issue: 0, closing: 0, last_movement: null,
      };
      map.set(key, row);
    }
    return row;
  };
  return { map, get };
};

// Real pack size of each packed (fg) Inventory row, matched to the packing that created
// it (see stockHistory.helper.matchFgRows). Loaded once per report.
const fgSizes = (store) => {
  if (!store.fgSizesPromise) store.fgSizesPromise = loadFgPackSizes();
  return store.fgSizesPromise;
};

// Live balances (raw + fg), exactly the rows the Inventory screen groups.
// Packed (fg) stock is labelled with its real pack size — matched row by row to the
// packing that created it, so a lot repacked into several sizes is not lumped under
// the first one — falling back to a lot/material lookup, then the lot's bag size.
const addLiveStock = async (store, scope) => {
  const where = { is_deleted: false, stage: { [Op.in]: ["raw", "fg"] }, balance_qty: { [Op.gt]: 0 } };
  if (scope.warehouseSet) where.warehouse_id = { [Op.in]: [...scope.warehouseSet] };
  const inv = await Inventory.findAll({
    where,
    include: [{ model: Lot, as: "lot", attributes: ["id", "bag_size"] }],
  });

  const fgLotIds = [...new Set(inv.filter((r) => r.stage === "fg").map((r) => r.lot_id).filter(Boolean))];
  const packingRows = fgLotIds.length
    ? await Packing.findAll({ where: { lot_id: { [Op.in]: fgLotIds }, is_deleted: false }, attributes: ["id", "lot_id", "material_id", "pack_size"] })
    : [];

  const exactSize = await fgSizes(store);
  for (const r of inv) {
    let size = r.lot?.bag_size != null ? Number(r.lot.bag_size) : null;
    if (r.stage === "fg") {
      if (exactSize.has(r.id)) {
        size = exactSize.get(r.id);
      } else {
        const packing = packingRows.find((p) => Number(p.lot_id) === Number(r.lot_id) && (!p.material_id || Number(p.material_id) === Number(r.material_id)));
        if (packing?.pack_size != null) size = Number(packing.pack_size);
      }
    }
    const balance = Number(r.balance_qty || 0);
    const row = store.get(r.stage, r.warehouse_id, r.material_id, size);
    row.closing += balance;
    if (size) row.bags += Math.floor((balance * 1000) / size + 0.0001);
    const moved = r.as_of ? new Date(r.as_of) : null;
    if (moved && (!row.last_movement || moved > row.last_movement)) row.last_movement = moved;
  }
};

// Movements inside [from, to]. See the header for what each column means.
const addMovements = async (store, scope, from, to) => {
  // ---- Inwards: raw stock received (one Inventory row per unloaded lot) ----
  const receivedWhere = { is_deleted: false, stage: "raw", created_at: { [Op.between]: [from, to] } };
  if (scope.warehouseSet) receivedWhere.warehouse_id = { [Op.in]: [...scope.warehouseSet] };
  const received = await Inventory.findAll({
    where: receivedWhere,
    attributes: ["id", "material_id", "warehouse_id", "qty_in", "lot_id"],
    include: [{ model: Lot, as: "lot", attributes: ["id", "bag_size"] }],
  });
  for (const r of received) {
    if (!r.material_id) continue;
    store.get("raw", r.warehouse_id, r.material_id, r.lot?.bag_size != null ? Number(r.lot.bag_size) : null).inwards += Number(r.qty_in || 0);
  }

  // ---- Production: packed stock added in the period (fg Inventory rows created in it) ----
  const exactSize = await fgSizes(store);
  const producedWhere = { is_deleted: false, stage: "fg", created_at: { [Op.between]: [from, to] } };
  if (scope.warehouseSet) producedWhere.warehouse_id = { [Op.in]: [...scope.warehouseSet] };
  const producedRows = await Inventory.findAll({ where: producedWhere, attributes: ["id", "material_id", "warehouse_id", "qty_in", "lot_id"] });
  const unmatchedLots = [...new Set(producedRows.filter((r) => !exactSize.has(r.id)).map((r) => r.lot_id).filter(Boolean))];
  const lotPackings = unmatchedLots.length
    ? await Packing.findAll({ where: { lot_id: { [Op.in]: unmatchedLots }, is_deleted: false }, attributes: ["lot_id", "material_id", "pack_size"] })
    : [];
  for (const r of producedRows) {
    if (!r.material_id) continue;
    let size = exactSize.get(r.id);
    if (size === undefined) {
      const p = lotPackings.find((x) => Number(x.lot_id) === Number(r.lot_id) && (!x.material_id || Number(x.material_id) === Number(r.material_id)));
      size = p && p.pack_size != null ? Number(p.pack_size) : null;
    }
    store.get("fg", r.warehouse_id, r.material_id, size).production += Number(r.qty_in || 0);
  }

  // ---- Issue: the INPUT materials of batches completed in the period, drawn from their source warehouse ----
  const packings = await Packing.findAll({
    where: { is_deleted: false, created_at: { [Op.between]: [from, to] } },
    attributes: ["id", "batch_id"],
  });
  if (packings.length) {
    const batchIds = [...new Set(packings.map((p) => Number(p.batch_id)).filter(Boolean))];
    const batches = batchIds.length
      ? await ProductionBatch.findAll({ where: { id: { [Op.in]: batchIds } }, attributes: ["id", "warehouse_id", "materials_data"] })
      : [];
    const rawKeys = await Inventory.findAll({ where: { is_deleted: false, stage: "raw" }, attributes: ["warehouse_id", "material_id"], group: ["warehouse_id", "material_id"] });
    const hasRaw = new Set(rawKeys.map((r) => `${Number(r.warehouse_id)}|${Number(r.material_id)}`));
    const lotIds = [...new Set(batches.flatMap((b) => asArray(b.materials_data).map((m) => Number(m.lot_id))).filter(Boolean))];
    const lots = lotIds.length ? await Lot.findAll({ where: { id: { [Op.in]: lotIds } }, attributes: ["id", "bag_size"] }) : [];
    const bagSizeByLot = new Map(lots.map((l) => [Number(l.id), l.bag_size != null ? Number(l.bag_size) : null]));
    const lotPacks = lotIds.length
      ? await Packing.findAll({ where: { lot_id: { [Op.in]: lotIds }, is_deleted: false }, attributes: ["lot_id", "material_id", "pack_size", "batch_id"] })
      : [];

    for (const b of batches) {
      if (!scope.inWarehouseScope(b.warehouse_id)) continue;
      for (const m of asArray(b.materials_data)) {
        const qty = Number(m.input_qty) || 0;
        if (!m.material_id || !qty) continue;
        // Raw stock normally; if the warehouse holds this material only as packed
        // goods (a repack run), the draw came from the packed rows.
        const stage = hasRaw.has(`${Number(b.warehouse_id)}|${Number(m.material_id)}`) ? "raw" : "fg";
        let size = bagSizeByLot.get(Number(m.lot_id)) ?? null;
        if (stage === "fg") {
          // Which pack size was repacked? The sizes this lot was packed into by OTHER
          // batches; if that is ambiguous, the size holding the most stock.
          const sizes = new Set(
            lotPacks
              .filter((x) => Number(x.lot_id) === Number(m.lot_id) && Number(x.material_id) === Number(m.material_id) && Number(x.batch_id) !== Number(b.id))
              .map((x) => Number(x.pack_size))
          );
          if (sizes.size === 1) {
            size = [...sizes][0];
          } else {
            const rows = [...store.map.values()].filter((r) => r.stage === "fg" && r.warehouse_id === Number(b.warehouse_id) && r.material_id === Number(m.material_id));
            size = rows.length ? rows.sort((a, c) => c.closing + c.production - (a.closing + a.production))[0].size : null;
          }
        }
        store.get(stage, b.warehouse_id, m.material_id, size).issue += qty;
      }
    }
  }

  // ---- Dispatch: finished goods that became 'dispatched' in the period (information only) ----
  const fgWhere = { is_deleted: false, fg_status: "dispatched", updated_at: { [Op.between]: [from, to] } };
  if (scope.warehouseSet) fgWhere.warehouse_id = { [Op.in]: [...scope.warehouseSet] };
  const dispatched = await FinishedGoods.findAll({ where: fgWhere, attributes: ["id", "packing_id", "qty", "warehouse_id"] });
  if (dispatched.length) {
    const packingIds = [...new Set(dispatched.map((r) => Number(r.packing_id)).filter(Boolean))];
    const packingRows = packingIds.length
      ? await Packing.findAll({ where: { id: { [Op.in]: packingIds }, is_deleted: false }, attributes: ["id", "material_id", "pack_size"] })
      : [];
    const packingById = new Map(packingRows.map((p) => [Number(p.id), p]));
    for (const fg of dispatched) {
      const packing = packingById.get(Number(fg.packing_id));
      if (!packing || !packing.material_id) continue;
      store.get("fg", fg.warehouse_id, packing.material_id, Number(packing.pack_size)).dispatch += Number(fg.qty || 0) / 1000;
    }
  }
};

// JSON columns come back as an array or, on some drivers, as a JSON string.
function asArray(v) {
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
}

const openingFor = (r) => r.closing - r.inwards - r.production + r.issue + (DISPATCH_REDUCES_STOCK ? r.dispatch : 0);

const groupByWarehouse = (rows) => {
  const groups = new Map();
  for (const r of rows) {
    const key = r.warehouse_id ?? 0;
    if (!groups.has(key)) groups.set(key, { warehouse_id: r.warehouse_id, warehouse_name: r.warehouse_name, rows: [] });
    groups.get(key).rows.push(r);
  }
  return [...groups.values()]
    .sort((a, b) => (a.warehouse_id == null) - (b.warehouse_id == null) || a.warehouse_name.localeCompare(b.warehouse_name))
    .map((g) => ({
      ...g,
      rows: g.rows.sort((a, b) => a.material_name.localeCompare(b.material_name) || (a.size ?? -1) - (b.size ?? -1) || a.stage.localeCompare(b.stage)),
    }));
};

const resolveLetterheadPlant = async (scope) => {
  if (scope.warehouseIds.length === 1) {
    const w = scope.warehouseById.get(scope.warehouseIds[0]);
    if (w?.plant_id) {
      const plant = await PlantMaster.findOne({ where: { id: w.plant_id, is_deleted: false } });
      if (plant) return plant;
    }
  }
  return PlantMaster.findOne({ where: { is_deleted: false }, order: [["id", "ASC"]] });
};

const describeFilters = (scope, filters) => {
  const wh = scope.warehouseIds.length
    ? scope.warehouseIds.map((id) => scope.warehouseById.get(id)?.name).filter(Boolean).join(", ")
    : "All warehouses";
  const items = scope.materialSet
    ? [...scope.materialSet].map((id) => scope.materialById.get(id)?.name).filter(Boolean).join(", ")
    : "All items";
  const stock = { all: "Raw + Packed", raw: "Raw only", fg: "Packed only" }[filters.stockType];
  const pack = filters.bagSize.mode === "all" ? "All" : filters.bagSize.mode === "bulk" ? "Bulk" : `${filters.bagSize.value} kg`;
  return `Warehouse: ${wh}   |   Item: ${items}   |   Stock: ${stock}   |   Pack size: ${pack}`;
};

const sumRows = (rows, key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);

// ---------------------------------------------------------------------------
// Report specs (what renderTableReport draws)
// ---------------------------------------------------------------------------

// Current stock "as on now": one row per stage x location x item x pack size.
const buildStockSpec = async (q, { now = new Date() } = {}) => {
  const scope = await loadScope(q);
  const filters = parseCommonFilters(q);
  const plant = await resolveLetterheadPlant(scope);
  const minIdle = q.min_idle_days !== undefined && String(q.min_idle_days).trim() !== "" ? Number(q.min_idle_days) : null;
  if (minIdle !== null && (!Number.isFinite(minIdle) || minIdle < 0)) throw createError(400, "Minimum idle days must be 0 or more");

  const store = makeRowStore(scope);
  await addLiveStock(store, scope);
  let rows = [...store.map.values()].filter((r) => r.closing > 0.001 && passesFilters(r, scope, filters));
  rows.forEach((r) => {
    r.idle_days = r.last_movement ? Math.floor((now.getTime() - r.last_movement.getTime()) / 86400000) : null;
  });
  if (minIdle !== null) rows = rows.filter((r) => r.idle_days != null && r.idle_days >= minIdle);

  const groups = groupByWarehouse(rows).map((g) => ({
    title: `WAREHOUSE: ${g.warehouse_name.toUpperCase()}`,
    meta: `${g.rows.length} line(s)  |  ${fmtQty(sumRows(g.rows, "closing"))} Qtl`,
    rows: g.rows.map((r) => ({
      cells: (n) => [
        n, r.material_name, STAGE_LABEL[r.stage], sizeLabel(r.size),
        r.bags != null ? fmtCount(r.bags) : "—", fmtQty(r.closing),
        r.last_movement ? fmtDMY(r.last_movement) : "—",
        r.idle_days != null ? String(r.idle_days) : "—",
      ],
    })),
    subtotalCells: ["", `Total - ${g.warehouse_name}`, "", "", fmtCount(sumRows(g.rows, "bags")), fmtQty(sumRows(g.rows, "closing")), "", ""],
  }));
  const totalsRow = groups.length > 1
    ? ["", "GRAND TOTAL", "", "", fmtCount(sumRows(rows, "bags")), fmtQty(sumRows(rows, "closing")), "", ""]
    : null;

  const subtitle = [`As on: ${fmtDMYHM(now)}`, describeFilters(scope, filters)];
  if (minIdle !== null) subtitle.push(`Only stock idle for at least ${minIdle} day(s)`);
  return {
    filename: `inventory-stock-${ymdLocal(now)}.pdf`,
    title: "INVENTORY STOCK REPORT",
    subtitleLines: subtitle,
    plant,
    columns: [
      { label: "S.No", w: 30, align: "center" },
      { label: "Item", w: 186, align: "left" },
      { label: "Stock", w: 52, align: "center" },
      { label: "Pack Size", w: 62, align: "center" },
      { label: "Stock (Bags)", w: 84, align: "right" },
      { label: "Stock (Qtl)", w: 90, align: "right" },
      { label: "Last Movement", w: 96, align: "center" },
      { label: "Idle Days", w: 56, align: "center" },
    ],
    groups,
    totalsRow,
    emptyText: "No stock found for the selected filters.",
    footnotes: ["Bag counts are an estimate for raw stock (remaining Qtl divided by bag size). Bulk stock has no bag size, so no bag count. Quantities are in Qtl."],
  };
};

// Stock movement for a date range, grouped by warehouse.
const buildMovementSpec = async (q, { title = "INVENTORY STOCK MOVEMENT REPORT", now = new Date() } = {}) => {
  const scope = await loadScope(q);
  const filters = parseCommonFilters(q);
  const plant = await resolveLetterheadPlant(scope);
  const today = dayStart(now);

  const toRaw = q.to ? parseYmd(q.to) : today;
  if (!toRaw) throw createError(400, "'To' date must be YYYY-MM-DD");
  const fromRaw = q.from ? parseYmd(q.from) : toRaw;
  if (!fromRaw) throw createError(400, "'From' date must be YYYY-MM-DD");
  const toDate = toRaw > today ? today : toRaw;
  if (fromRaw > toDate) throw createError(400, "'From' date can't be after the 'To' date (or after today)");
  const from = dayStart(fromRaw);
  const to = dayEnd(toDate);
  const includesToday = ymdLocal(toDate) === ymdLocal(today);

  const store = makeRowStore(scope);
  await addLiveStock(store, scope);
  await addMovements(store, scope, from, to);

  const includeEmpty = isTrue(q.include_empty);
  const all = [...store.map.values()];
  all.forEach((r) => {
    r.opening = includesToday ? openingFor(r) : null; // only derivable when the range runs up to now
  });
  const rows = all
    .filter((r) => passesFilters(r, scope, filters))
    .filter((r) => includeEmpty || [r.opening ?? 0, r.closing, r.inwards, r.production, r.dispatch, r.issue].some((v) => Math.abs(v) > 0.0005));

  const qtyOrDash = (v, ok) => (ok ? fmtQty(v) : "—");
  const groups = groupByWarehouse(rows).map((g) => {
    const sum = (k) => sumRows(g.rows, k);
    return {
      title: `WAREHOUSE: ${g.warehouse_name.toUpperCase()}`,
      meta: `${g.rows.length} line(s)`,
      rows: g.rows.map((r) => ({
        cells: (n) => [
          n, r.material_name, STAGE_LABEL[r.stage], sizeLabel(r.size),
          includesToday && r.bags != null ? fmtCount(r.bags) : "—",
          qtyOrDash(r.opening, includesToday), fmtQty(r.inwards), fmtQty(r.production),
          fmtQty(r.dispatch), fmtQty(r.issue), qtyOrDash(r.closing, includesToday),
        ],
      })),
      subtotalCells: [
        "", `Total - ${g.warehouse_name}`, "", "",
        includesToday ? fmtCount(sum("bags")) : "—",
        qtyOrDash(sum("opening"), includesToday), fmtQty(sum("inwards")), fmtQty(sum("production")),
        fmtQty(sum("dispatch")), fmtQty(sum("issue")), qtyOrDash(sum("closing"), includesToday),
      ],
    };
  });
  const totalsRow = groups.length > 1
    ? [
        "", "GRAND TOTAL", "", "",
        includesToday ? fmtCount(sumRows(rows, "bags")) : "—",
        qtyOrDash(sumRows(rows, "opening"), includesToday), fmtQty(sumRows(rows, "inwards")), fmtQty(sumRows(rows, "production")),
        fmtQty(sumRows(rows, "dispatch")), fmtQty(sumRows(rows, "issue")), qtyOrDash(sumRows(rows, "closing"), includesToday),
      ]
    : null;

  const footnotes = [];
  if (!includesToday) {
    footnotes.push(
      "Note: Opening and Closing stock (and Bags, which comes from Closing) are only available when the report period ends today - this system does not keep a full stock-movement ledger, so a past running balance can't be reconstructed. Inwards, Production, Dispatch and Issue for the period are accurate."
    );
  }
  footnotes.push("Quantities are in Qtl. Inwards = stock received after unloading; Production = finished goods packed; Issue = raw material drawn by production batches from their warehouse.");
  footnotes.push(
    DISPATCH_REDUCES_STOCK
      ? "Dispatch = finished goods dispatched in the period."
      : "Dispatch is shown for information: dispatching goods does not reduce the Inventory balance in this system, so it is not deducted in Opening / Closing."
  );

  const sameDay = ymdLocal(fromRaw) === ymdLocal(toDate);
  const period = sameDay ? `Date: ${fmtDMY(fromRaw)}` : `Period: ${fmtDMY(fromRaw)} to ${fmtDMY(toDate)}`;
  return {
    filename: `inventory-movement-${ymdLocal(fromRaw)}${sameDay ? "" : `_to_${ymdLocal(toDate)}`}.pdf`,
    title,
    subtitleLines: [period, describeFilters(scope, filters)],
    plant,
    columns: [
      { label: "S.No", w: 28, align: "center" },
      { label: "Material", w: 150, align: "left" },
      { label: "Stock", w: 46, align: "center" },
      { label: "Pack Size", w: 50, align: "center" },
      { label: "Bags", w: 74, align: "right" },
      { label: "Opening", w: 72, align: "right" },
      { label: "Inwards", w: 66, align: "right" },
      { label: "Production / Repacking", w: 84, align: "right" },
      { label: "Dispatch", w: 64, align: "right" },
      { label: "Issue", w: 58, align: "right" },
      { label: "Closing", w: 76, align: "right" },
    ],
    groups,
    totalsRow,
    emptyText: "No stock or movement found for the selected period and filters.",
    footnotes,
  };
};

module.exports = {
  parseIdList, isTrue, loadScope, parseCommonFilters, passesFilters, makeRowStore, addLiveStock, addMovements,
  groupByWarehouse, resolveLetterheadPlant, describeFilters, sumRows, openingFor,
  buildStockSpec, buildMovementSpec, DISPATCH_REDUCES_STOCK, STAGE_LABEL, sizeLabel,
};