const createError = require("http-errors");
const { KG_PER_QTL } = require("../helpers/units");
const { Op } = require("sequelize");
const {
  Inventory, Lot, MaterialMaster, WarehouseMaster, PlantMaster, ProductionBatch, Packing, FinishedGoods,
} = require("../models/index");
const { renderTableReport } = require("../helpers/reportPdf.helper");
const { buildFlowSection } = require("../helpers/stockFlow.helper");

// JSON columns come back as an array or, on some drivers, as a JSON string.
// (Was missing — it made the Stock Movement report fail with "asArray is not defined".)
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

// Inventory reports (PDF) — a separate controller so nothing in
// inventory.controller.js changes. Two reports, both streamed as a PDF:
//
//   report_type=movement (default)  Stock movement for a DATE RANGE, grouped
//        by warehouse: Opening, Inwards, Production/Repacking, Dispatch,
//        Issue, Closing — the same movement rules as reports.controller.js's
//        stockReport (which is a single-day, all-warehouse report), extended
//        to a from/to range with warehouse-wise grouping and totals.
//   report_type=stock               Current stock "as on now" — the same
//        item x location x bag size rows the Inventory screen shows.
//
// Filters (all optional): warehouse_id (one id or a comma list), material_id
// (same), stock_type (all | raw | fg), bag_size (a number in kg, or "bulk"),
// include_empty (movement only — keep rows with no stock and no movement),
// min_idle_days (current stock only).
//
// IMPORTANT LIMITATION (same as stockReport): this app keeps no stock-movement
// ledger — stock is only ever updated as a balance — so a historical running
// balance can't be rebuilt. Inwards / Production / Dispatch / Issue are derived
// from timestamped source rows and are accurate for any range, but Opening and
// Closing are only available when the range ends today (Closing = the live
// balance; Opening = Closing with the range's movements reversed out). For a
// range that ends earlier they print "—" with a footnote rather than a
// fabricated number. All quantities are in Qtl, as on the Inventory screen.

const pad2 = (n) => String(n).padStart(2, "0");
const ymdLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fmtDMY = (d) => `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
const fmtDMYHM = (d) => `${fmtDMY(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const parseYmd = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
};
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const dayEnd = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

const parseIdList = (v) => [...new Set(String(v ?? "").split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0))];
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const isTrue = (v) => ["1", "true", "yes", "on"].includes(String(v ?? "").toLowerCase());

// 1234567.891 -> "12,34,567.891" (Indian digit grouping, always 3 decimals)
const fmtQty = (n) => {
  const v = round3(n);
  const [int, frac] = Math.abs(v).toFixed(3).split(".");
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${v < 0 ? "-" : ""}${grouped}.${frac}`;
};
const fmtCount = (n) => {
  const s = String(Math.floor(Number(n) || 0));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
};

const STAGE_LABEL = { raw: "Raw", fg: "Packed" };
const sizeLabel = (size) => (size != null ? `${Number(size)} kg` : "Bulk");

// Loads the master data the report needs for names, plus the warehouse scope
// requested (null = every warehouse, including stock with no warehouse set).
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

// Live physical balances: raw from Inventory, packed from non-dispatched
// FinishedGoods. This is the same source-of-truth split used by Warehouse/Stock.
const addLiveStock = async (store, scope) => {
  const where = { is_deleted: false, stage: "raw", balance_qty: { [Op.gt]: 0 } };
  if (scope.warehouseSet) where.warehouse_id = { [Op.in]: [...scope.warehouseSet] };
  const inv = await Inventory.findAll({
    where,
    include: [{ model: Lot, as: "lot", attributes: ["id", "bag_size"] }],
  });

  for (const r of inv) {
    const size = r.lot?.bag_size != null ? Number(r.lot.bag_size) : null;
    const balance = Number(r.balance_qty || 0);
    const row = store.get("raw", r.warehouse_id, r.material_id, size);
    row.closing += balance;
    if (size) row.bags += Math.floor((balance * KG_PER_QTL) / size + 0.0001);
    const moved = r.as_of ? new Date(r.as_of) : null;
    if (moved && (!row.last_movement || moved > row.last_movement)) row.last_movement = moved;
  }

  const finishedGoods = await FinishedGoods.findAll({
    where: {
      is_deleted: false,
      fg_status: { [Op.ne]: "dispatched" },
      qty: { [Op.gt]: 0 },
      ...(scope.warehouseSet ? { warehouse_id: { [Op.in]: [...scope.warehouseSet] } } : {}),
    },
    attributes: ["id", "packing_id", "warehouse_id", "qty", "ready_since", "updated_at"],
  });
  const packingIds = [...new Set(finishedGoods.map((row) => Number(row.packing_id)).filter(Boolean))];
  const packingRows = packingIds.length
    ? await Packing.findAll({ where: { id: { [Op.in]: packingIds }, is_deleted: false }, attributes: ["id", "lot_id", "material_id", "pack_size"] })
    : [];
  const packingById = new Map(packingRows.map((row) => [Number(row.id), row]));
  const lotIds = [...new Set(packingRows.map((row) => Number(row.lot_id)).filter(Boolean))];
  const lots = lotIds.length
    ? await Lot.findAll({ where: { id: { [Op.in]: lotIds } }, attributes: ["id", "material_id", "bag_size"] })
    : [];
  const materialByLot = new Map(lots.map((row) => [Number(row.id), Number(row.material_id)]));
  for (const fg of finishedGoods) {
    const packing = packingById.get(Number(fg.packing_id));
    if (!packing) continue;
    const materialId = Number(packing.material_id || materialByLot.get(Number(packing.lot_id)));
    if (!materialId) continue;
    const lot = lots.find((row) => Number(row.id) === Number(packing.lot_id));
    const size = packing.pack_size != null ? Number(packing.pack_size) : lot?.bag_size != null ? Number(lot.bag_size) : null;
    const row = store.get("fg", fg.warehouse_id, materialId, size);
    const balance = Number(fg.qty || 0) / KG_PER_QTL;
    row.closing += balance;
    if (size) row.bags += Math.floor((balance * KG_PER_QTL) / size + 0.0001);
    const moved = fg.ready_since || fg.updated_at ? new Date(fg.ready_since || fg.updated_at) : null;
    if (moved && (!row.last_movement || moved > row.last_movement)) row.last_movement = moved;
  }
};

// Movements inside [from, to] — same sources and rules as stockReport.
const addMovements = async (store, scope, from, to) => {
  // Inwards: raw stock received after unloading — one Inventory(raw) row is created per
  // unloaded lot with qty_in = accepted qty. (Not Lot.qty / Lot.updated_at: packing lowers
  // Lot.qty and bumps updated_at, so that figure shrinks and moves after every batch.)
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

  // Production (destination warehouse) and Issue (source batch warehouse)
  const packings = await Packing.findAll({
    where: { is_deleted: false, created_at: { [Op.between]: [from, to] } },
    attributes: ["id", "material_id", "pack_size", "batch_id"],
  });
  if (packings.length) {
    const batchIds = [...new Set(packings.map((p) => Number(p.batch_id)).filter(Boolean))];
    const batches = batchIds.length
      ? await ProductionBatch.findAll({ where: { id: { [Op.in]: batchIds } }, attributes: ["id", "warehouse_id", "material_id", "input_qty", "materials_data", "lot_id"] })
      : [];
    const sourceWarehouseByBatch = new Map(batches.map((b) => [Number(b.id), b.warehouse_id]));
    const fgRows = await FinishedGoods.findAll({
      where: { packing_id: { [Op.in]: packings.map((p) => p.id) }, is_deleted: false },
      attributes: ["id", "packing_id", "warehouse_id", "qty"],
    });
    const fgByPacking = new Map(fgRows.map((fg) => [Number(fg.packing_id), fg]));
    for (const p of packings) {
      if (!p.material_id) continue;
      const fg = fgByPacking.get(Number(p.id));
      const qtl = fg ? Number(fg.qty || 0) / KG_PER_QTL : 0;
      const size = Number(p.pack_size);
      if (fg && scope.inWarehouseScope(fg.warehouse_id)) store.get("fg", fg.warehouse_id, p.material_id, size).production += qtl;
    }

    // Issues are the batch INPUT materials and quantities, not the produced
    // output material/quantity. Record each batch once even when it makes
    // several co-products.
    const lotIds = [...new Set(batches.flatMap((batch) => {
      const lines = asArray(batch.materials_data);
      const inputs = lines.length ? lines : batch.lot_id ? [{ lot_id: batch.lot_id }] : [];
      return inputs.map((line) => Number(line.lot_id)).filter(Boolean);
    }))];
    const [sourceLots, sourceInventory] = await Promise.all([
      lotIds.length ? Lot.findAll({ where: { id: { [Op.in]: lotIds } }, attributes: ["id", "bag_size"] }) : [],
      lotIds.length ? Inventory.findAll({ where: { lot_id: { [Op.in]: lotIds }, is_deleted: false }, attributes: ["lot_id", "warehouse_id", "material_id", "stage"] }) : [],
    ]);
    const bagSizeByLot = new Map(sourceLots.map((lot) => [Number(lot.id), lot.bag_size != null ? Number(lot.bag_size) : null]));
    const sourceStageByLot = new Map(sourceInventory.map((row) => [Number(row.lot_id), row.stage]));
    for (const batch of batches) {
      const sourceWh = sourceWarehouseByBatch.get(Number(batch.id));
      if (!sourceWh || !scope.inWarehouseScope(sourceWh)) continue;
      const lines = asArray(batch.materials_data);
      const inputs = lines.length
        ? lines
        : batch.material_id
          ? [{ material_id: batch.material_id, input_qty: batch.input_qty, lot_id: batch.lot_id }]
          : [];
      for (const line of inputs) {
        if (!line.material_id) continue;
        const lotId = Number(line.lot_id) || null;
        const stage = sourceStageByLot.get(lotId) || "raw";
        const size = Number(line.pack_size) || bagSizeByLot.get(lotId) || null;
        store.get(stage, sourceWh, line.material_id, size).issue += Number(line.input_qty || 0);
      }
    }
  }

  // Dispatch: finished goods that became 'dispatched' in the range
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
      store.get("fg", fg.warehouse_id, packing.material_id, Number(packing.pack_size)).dispatch += Number(fg.qty || 0) / KG_PER_QTL;
    }
  }
};

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

// Inventory reports share the ERP report layout: letterhead, KPI-compatible
// headings, grouped warehouse sections, zebra rows and consistent page footers.
const renderPdf = (res, opts) => renderTableReport(res, {
  ...opts,
  groups: (opts.groups || []).map((group) => ({
    title: `WAREHOUSE: ${String(group.warehouse_name || "Unassigned").toUpperCase()}`,
    rows: group.rows,
    subtotalCells: group.subtotalCells,
  })),
});

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
// Warehouse > Stock Report (the PDF on the Warehouse / Stock page).
// One day's stock for one warehouse (or every warehouse), worked out with the SAME
// engine as the Inventory reports above — raw stock from Inventory, packed stock from
// non-dispatched FinishedGoods, inwards from the unloaded-lot stock entries, issue from
// what production batches actually drew — so this PDF, the Inventory screen and the
// Inventory Stock Movement report always show the same numbers.
// Layout: each warehouse is split into RAW MATERIAL and PACKED GOODS, with a KPI strip
// on top. Opening / Closing / Bags are only available when the date is today (this app
// keeps no stock ledger, so a past running balance can't be rebuilt) — the PDF says so.
// ---------------------------------------------------------------------------
const buildWarehouseStockSpec = async (q = {}, { now = new Date() } = {}) => {
  const scope = await loadScope({ warehouse_id: q.warehouse_id });
  const today = dayStart(now);
  const dateRaw = q.date ? parseYmd(q.date) : today;
  if (!dateRaw) throw createError(400, "'date' must be YYYY-MM-DD");
  if (dateRaw > today) throw createError(400, "The stock report date can't be after today");
  const isToday = ymdLocal(dateRaw) === ymdLocal(today);

  const store = makeRowStore(scope);
  await addLiveStock(store, scope);
  await addMovements(store, scope, dayStart(dateRaw), dayEnd(dateRaw));

  const all = [...store.map.values()];
  all.forEach((r) => {
    r.opening = isToday ? r.closing - r.inwards - r.production + r.issue + r.dispatch : null;
  });
  const rows = all.filter((r) => [r.opening ?? 0, r.closing, r.inwards, r.production, r.dispatch, r.issue].some((v) => Math.abs(v) > 0.0005));

  const dash = (v) => (isToday ? fmtQty(v) : "—");
  const cellsFor = (r) => (n) => [
    n, r.material_name, sizeLabel(r.size), isToday && r.bags != null ? fmtCount(r.bags) : "—",
    dash(r.opening), fmtQty(r.inwards), fmtQty(r.production), fmtQty(r.dispatch), fmtQty(r.issue), { t: dash(r.closing), bold: true },
  ];
  const subtotal = (label, list) => [
    "", label, "", isToday && sumRows(list, "bags") > 0 ? fmtCount(sumRows(list, "bags")) : "—",
    dash(sumRows(list, "opening")), fmtQty(sumRows(list, "inwards")), fmtQty(sumRows(list, "production")),
    fmtQty(sumRows(list, "dispatch")), fmtQty(sumRows(list, "issue")), dash(sumRows(list, "closing")),
  ];

  const groups = [];
  const STAGES = [["raw", "RAW MATERIAL", "#9A3412"], ["fg", "PACKED GOODS", "#166534"]];
  for (const wg of groupByWarehouse(rows)) {
    for (const [stage, label, accent] of STAGES) {
      const part = wg.rows.filter((r) => r.stage === stage).sort((a, b) => a.material_name.localeCompare(b.material_name) || (a.size ?? -1) - (b.size ?? -1));
      if (!part.length) continue;
      groups.push({
        title: `WAREHOUSE: ${String(wg.warehouse_name).toUpperCase()}   |   ${label}`,
        meta: `${part.length} line(s)${isToday ? `  |  Closing ${fmtQty(sumRows(part, "closing"))} Qtl` : ""}`,
        accent,
        rows: part.map((r) => ({ cells: cellsFor(r) })),
        subtotalCells: subtotal(`Total ${label.toLowerCase()}`, part),
      });
    }
  }
  const warehousesShown = new Set(rows.map((r) => r.warehouse_id ?? 0)).size;
  const warehouse = scope.warehouseIds.length === 1 ? scope.warehouseById.get(scope.warehouseIds[0]) : null;
  const plant = await resolveLetterheadPlant(scope);

  const footnotes = [
    "Quantities are in Qtl. Inwards = stock received after unloading; Production / Repacking = packed goods added; Dispatch = packed goods dispatched; Issue = raw material drawn by production batches. Bags are an estimate (quantity / pack size); bulk stock has no bag count.",
  ];
  if (!isToday) {
    footnotes.push("Opening Stock, Closing Stock and Bags are only available for today's date - this system keeps no stock-movement ledger, so a past running balance can't be rebuilt. Inwards, Production / Repacking, Dispatch and Issue for the selected date are accurate.");
  }
  return {
    filename: `stock-report-${warehouse ? warehouse.warehouse_code || warehouse.id : "overall"}-${ymdLocal(dateRaw)}.pdf`,
    title: warehouse ? `${warehouse.name.toUpperCase()} STOCK REPORT` : "OVERALL WAREHOUSE STOCK REPORT",
    subtitleLines: [`Date: ${fmtDMY(dateRaw)}${isToday ? "  (live stock as on " + fmtDMYHM(now) + ")" : ""}`, warehouse ? `Warehouse: ${warehouse.name}` : "All warehouses"],
    plant,
    kpis: [
      { label: "Warehouses", value: String(warehousesShown) },
      { label: "Stock lines", value: String(rows.length) },
      { label: "Closing stock (Qtl)", value: isToday ? fmtQty(sumRows(rows, "closing")) : "—", color: "#1F2A44" },
      { label: "Inwards (Qtl)", value: fmtQty(sumRows(rows, "inwards")), color: "#166534" },
      { label: "Production (Qtl)", value: fmtQty(sumRows(rows, "production")), color: "#1D4ED8" },
      { label: "Dispatch (Qtl)", value: fmtQty(sumRows(rows, "dispatch")), color: "#B91C1C" },
      { label: "Issue (Qtl)", value: fmtQty(sumRows(rows, "issue")), color: "#9A3412" },
    ],
    columns: [
      { label: "S.No", w: 30, align: "center" },
      { label: "Material", w: 190, align: "left" },
      { label: "Pack Size", w: 56, align: "center" },
      { label: "Bags", w: 74, align: "right" },
      { label: "Opening Stock", w: 76, align: "right" },
      { label: "Inwards", w: 66, align: "right" },
      { label: "Production / Repacking", w: 84, align: "right" },
      { label: "Dispatch", w: 66, align: "right" },
      { label: "Issue", w: 62, align: "right" },
      { label: "Closing Stock", w: 80, align: "right" },
    ],
    groups,
    emptyText: "No stock or movement found for this warehouse and date.",
    footnotes,
  };
};

module.exports = {
  buildWarehouseStockSpec,
  // GET /api/inventory/report-filters — what the report form's dropdowns offer.
  // Served from here (under the Inventory page's own access list) so the
  // dropdowns work for every role that can open Inventory.
  filters: async (req, res, next) => {
    try {
      const [warehouses, materials, lots, packings] = await Promise.all([
        WarehouseMaster.findAll({ where: { is_deleted: false }, attributes: ["id", "name", "warehouse_code"], order: [["name", "ASC"]] }),
        MaterialMaster.findAll({ where: { is_deleted: false }, attributes: ["id", "name", "material_code"], order: [["name", "ASC"]] }),
        Lot.findAll({ where: { is_deleted: false, bag_size: { [Op.ne]: null } }, attributes: ["bag_size"], group: ["bag_size"] }),
        Packing.findAll({ where: { is_deleted: false }, attributes: ["pack_size"], group: ["pack_size"] }),
      ]);
      const sizes = [...new Set([...lots.map((l) => Number(l.bag_size)), ...packings.map((p) => Number(p.pack_size))].filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
      res.status(200).json({
        success: true,
        data: {
          warehouses: warehouses.map((w) => ({ id: w.id, name: w.name, code: w.warehouse_code })),
          materials: materials.map((m) => ({ id: m.id, name: m.name, code: m.material_code })),
          bag_sizes: sizes,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/inventory/report-pdf?report_type=&from=&to=&warehouse_id=&material_id=&stock_type=&bag_size=&include_empty=&min_idle_days=
  reportPdf: async (req, res, next) => {
    try {
      const q = req.query || {};
      const reportType = String(q.report_type || "movement").toLowerCase() === "stock" ? "stock" : "movement";
      const scope = await loadScope(q);
      const filters = parseCommonFilters(q);
      const plant = await resolveLetterheadPlant(scope);
      const generatedBy = req.user?.username || req.user?.name || req.user?.email || "";
      const now = new Date();
      const today = dayStart(now);

      // ======================= CURRENT STOCK =======================
      if (reportType === "stock") {
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
          warehouse_name: g.warehouse_name,
          rows: g.rows.map((r) => ({
            cells: (n) => [
              n, r.material_name, STAGE_LABEL[r.stage], sizeLabel(r.size),
              r.bags != null ? fmtCount(r.bags) : "—", fmtQty(r.closing),
              r.last_movement ? fmtDMY(r.last_movement) : "—",
              r.idle_days != null ? String(r.idle_days) : "—",
            ],
          })),
          subtotalCells: [
            "", `Total - ${g.warehouse_name}`, "", "",
            fmtCount(sumRows(g.rows, "bags")), fmtQty(sumRows(g.rows, "closing")), "", "",
          ],
        }));
        const totalsRow = groups.length > 1
          ? ["", "GRAND TOTAL", "", "", fmtCount(sumRows(rows, "bags")), fmtQty(sumRows(rows, "closing")), "", ""]
          : null;

        const subtitle = [`As on: ${fmtDMYHM(now)}`, describeFilters(scope, filters)];
        if (minIdle !== null) subtitle.push(`Only stock idle for at least ${minIdle} day(s)`);
        return renderPdf(res, {
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
          footnotes: [
            "Bag counts are an estimate for raw stock (remaining Qtl divided by bag size). Bulk stock has no bag size, so no bag count. Quantities are in Qtl.",
          ],
          generatedBy,
        });
      }

      // ======================= STOCK MOVEMENT (date range) =======================
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
        // Opening only derivable when the range runs up to now (see header note).
        r.opening = includesToday ? r.closing - r.inwards - r.production + r.issue + r.dispatch : null;
      });
      const rows = all
        .filter((r) => passesFilters(r, scope, filters))
        .filter((r) =>
          includeEmpty ||
          [r.opening ?? 0, r.closing, r.inwards, r.production, r.dispatch, r.issue].some((v) => Math.abs(v) > 0.0005)
        );

      const qtyOrDash = (v, ok) => (ok ? fmtQty(v) : "—");
      const groups = groupByWarehouse(rows).map((g) => {
        const sum = (k) => sumRows(g.rows, k);
        return {
          warehouse_name: g.warehouse_name,
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
          "Note: Opening and Closing stock (and Bags, which comes from Closing) are only available when the report period ends today - this system does not keep a full stock-movement ledger, so a past running balance can't be reconstructed. Inwards, Production/Repacking, Dispatch and Issue for the period are accurate."
        );
      }
      footnotes.push("Quantities are in Qtl. Production/Repacking and Issue are counted from packing runs, and Dispatch from finished goods dispatched, in the period.");

      const sameDay = ymdLocal(fromRaw) === ymdLocal(toDate);
      const period = sameDay ? `Date: ${fmtDMY(fromRaw)}` : `Period: ${fmtDMY(fromRaw)} to ${fmtDMY(toDate)}`;

      // Material-flow detail: every movement behind the totals above — from, to, how much,
      // and what is left. A failure here must not lose the summary, so it degrades to a note.
      const sections = [];
      try {
        const flow = await buildFlowSection({
          scope, from, to,
          passes: (e) => passesFilters(e, scope, filters),
          filtersLine: describeFilters(scope, filters),
          periodLine: period,
        });
        sections.push(flow);
        if (flow.hasUnreliable) {
          footnotes.push("* Left quantity marked with an asterisk: this item's recorded movements do not fully add up to its live balance (for example a balance edited by hand, or packed goods consumed by a repack), so treat that figure as approximate.");
        }
      } catch (flowErr) {
        console.error("Stock flow detail failed:", flowErr);
        footnotes.push(`Material flow detail could not be generated (${flowErr.message}).`);
      }

      return renderPdf(res, {
        filename: `inventory-movement-${ymdLocal(fromRaw)}${sameDay ? "" : `_to_${ymdLocal(toDate)}`}.pdf`,
        title: "INVENTORY STOCK MOVEMENT REPORT",
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
        sections,
        generatedBy,
      });
    } catch (err) {
      next(err);
    }
  },
};
