const createError = require("http-errors");
const { KG_PER_QTL } = require("./units");
const { Op } = require("sequelize");
const sequelize = require("../config/db");
const {
  GateEntry, Vehicle, Driver, Vendor, Customer, MaterialMaster, PlantMaster, WarehouseMaster, Purchase, PurchaseOrder,
  SalesOrder, GateEntrySalesOrder, Lot, WeightSlip, Loading,
} = require("../models/index");
const { fmtQty, fmtCount, fmtDMY, pad2, COLORS } = require("./reportPdf.helper");
const { gpNoFor } = require("./gpNumber.helper");

// Admin > Reports > Daily Report — three PDF reports for one day:
//
//   inward   Purchase trucks that came in (against Purchase Orders), grouped by WAREHOUSE —
//            every warehouse is listed, with the ones that received nothing marked as such.
//   outward  Sales trucks that went out (against Sales Orders), grouped by plant / mill.
//   overall  One-page-style day summary (inward by warehouse, outward by plant, net) followed
//            by the combined vehicle list.
//
// Every vehicle row carries its Gate Pass number (GP-IN-0042 / GP-OUT-0042 — the same number
// the Gate Pass PDF and Payment Settlement use, built by helpers/gpNumber.helper).
//
// Weights: Net Wt is strictly the weighbridge figure (1st weighment - 2nd weighment, i.e. gross - tare)
// of the weight slip tied to that truck, in Kg — never a manually typed quantity. No slip yet = "—".
//
// Filters: date (required, defaults to today), plant_id (optional), warehouse_id (optional).
// Inward trucks are matched to a warehouse through the lots they were unloaded into. Outward trucks
// are not recorded against a warehouse in this system (Loading has no warehouse), so a warehouse
// filter narrows outward trucks to that warehouse's plant instead — the PDF says so.

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

const DASH = "—";
const hhmm = (d) => (d ? `${pad2(new Date(d).getHours())}:${pad2(new Date(d).getMinutes())}` : DASH);
const kg = (n) => (n == null ? DASH : fmtCount(Math.round(Number(n))));
const sum = (list, fn) => list.reduce((s, x) => s + (Number(fn(x)) || 0), 0);
const IN_COLOR = "#166534";
const OUT_COLOR = "#1D4ED8";

const parseDate = (value) => {
  const raw = String(value || "").trim() || new Date().toISOString().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) throw createError(400, "'date' must be YYYY-MM-DD");
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getMonth() !== Number(m[2]) - 1) throw createError(400, "'date' is not a real calendar date");
  return { ymd: raw, date: d };
};

const loadDay = async ({ ymd, plantId, warehouseId }) => {
  const [allPlants, allWarehouses] = await Promise.all([
    PlantMaster.findAll({ where: { is_deleted: false }, order: [["id", "ASC"]] }),
    WarehouseMaster.findAll({ where: { is_deleted: false }, attributes: ["id", "name", "warehouse_code", "plant_id"], order: [["name", "ASC"]] }),
  ]);
  const plantById = new Map(allPlants.map((p) => [Number(p.id), p]));
  const warehouseById = new Map(allWarehouses.map((w) => [Number(w.id), w]));

  let plant = null;
  if (plantId) {
    plant = plantById.get(Number(plantId));
    if (!plant) throw createError(404, "Plant / mill not found");
  }
  let warehouse = null;
  if (warehouseId) {
    warehouse = warehouseById.get(Number(warehouseId));
    if (!warehouse) throw createError(404, "Warehouse not found");
  }

  // ---------------- inward: purchase trucks ----------------
  const purchases = await Purchase.findAll({
    where: { is_deleted: false, purchase_date: ymd },
    include: [
      {
        model: GateEntry, as: "gateEntry", attributes: ["id", "vendor_id", "vehicle_id", "material_id", "entry_time", "exit_time"],
        include: [
          { model: Vendor, as: "vendor", attributes: ["id", "name"], required: false },
          { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"], required: false },
          { model: MaterialMaster, as: "material", attributes: ["id", "name"], required: false },
        ],
      },
      { model: WeightSlip, as: "weightSlip", attributes: ["id", "gross_weight", "tare_weight"], required: false },
    ],
    order: [["id", "ASC"]],
  });
  const purchaseIds = purchases.map((p) => p.id);
  const lots = purchaseIds.length
    ? await Lot.findAll({ where: { purchase_id: { [Op.in]: purchaseIds }, is_deleted: false }, attributes: ["id", "purchase_id", "lot_no", "accepted_bags", "warehouse_id", "material_id"] })
    : [];
  const lotsByPurchase = new Map();
  lots.forEach((l) => (lotsByPurchase.get(Number(l.purchase_id)) || lotsByPurchase.set(Number(l.purchase_id), []).get(Number(l.purchase_id))).push(l));
  const poIds = [...new Set(purchases.map((p) => Number(p.po_id)).filter(Boolean))];
  const pos = poIds.length ? await PurchaseOrder.findAll({ where: { id: { [Op.in]: poIds } }, attributes: ["id", "po_no"] }) : [];
  const poById = new Map(pos.map((p) => [Number(p.id), p]));
  const lotMaterialIds = [...new Set(lots.map((l) => Number(l.material_id)).filter(Boolean))];
  const lotMaterials = lotMaterialIds.length ? await MaterialMaster.findAll({ where: { id: { [Op.in]: lotMaterialIds } }, attributes: ["id", "name"] }) : [];
  const materialName = new Map(lotMaterials.map((m) => [Number(m.id), m.name]));

  let inward = purchases.map((p) => {
    const ge = p.gateEntry;
    const myLots = lotsByPurchase.get(Number(p.id)) || [];
    const whIds = [...new Set(myLots.map((l) => Number(l.warehouse_id)).filter(Boolean))];
    const slip = p.weightSlip;
    const gross = slip && slip.gross_weight != null ? Number(slip.gross_weight) : null;
    const tare = slip && slip.tare_weight != null ? Number(slip.tare_weight) : null;
    return {
      direction: "INWARD",
      id: p.id,
      gp_no: ge ? gpNoFor("purchase", ge.id) : DASH,
      time: ge ? ge.entry_time : null,
      vehicle: ge?.vehicle?.vehicle_no || DASH,
      party: ge?.vendor?.name || DASH,
      order_no: poById.get(Number(p.po_id))?.po_no || DASH,
      item: ge?.material?.name || [...new Set(myLots.map((l) => materialName.get(Number(l.material_id))).filter(Boolean))].join(", ") || DASH,
      lot_nos: myLots.map((l) => l.lot_no).join(", ") || DASH,
      bags: myLots.reduce((s, l) => s + (Number(l.accepted_bags) || 0), 0),
      gross, tare,
      net: gross != null && tare != null ? gross - tare : null,
      warehouse_ids: whIds,
      plant_id: p.plant_id,
    };
  });
  // plant filter (a record with no plant set is only shown when no plant is picked)
  if (plantId) inward = inward.filter((r) => Number(r.plant_id) === Number(plantId));
  if (warehouseId) inward = inward.filter((r) => r.warehouse_ids.includes(Number(warehouseId)));

  // ---------------- outward: sales trucks ----------------
  const dayMatch = {
    [Op.or]: [
      sequelize.where(sequelize.fn("DATE", sequelize.col("exit_time")), ymd),
      sequelize.where(sequelize.fn("DATE", sequelize.col("entry_time")), ymd),
    ],
  };
  const outwardPlantId = plantId || (warehouse && warehouse.plant_id) || null;
  const salesWhere = { is_deleted: false, entry_type: "sales" };
  if (outwardPlantId) salesWhere.plant_id = outwardPlantId;
  const gateEntries = await GateEntry.findAll({
    where: { [Op.and]: [salesWhere, dayMatch] },
    include: [
      { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"], required: false },
      { model: Driver, as: "driver", attributes: ["id", "name"], required: false },
      { model: Customer, as: "customer", attributes: ["id", "name"], required: false },
      { model: MaterialMaster, as: "material", attributes: ["id", "name"], required: false },
      { model: SalesOrder, as: "salesOrder", attributes: ["id", "so_no"], required: false },
      {
        model: GateEntrySalesOrder, as: "sales_orders", attributes: ["id"], required: false,
        include: [
          { model: MaterialMaster, as: "material", attributes: ["id", "name"], required: false },
          { model: SalesOrder, as: "sales_order", attributes: ["id", "so_no"], required: false },
        ],
      },
    ],
    order: [[sequelize.fn("COALESCE", sequelize.col("exit_time"), sequelize.col("entry_time")), "ASC"]],
  });
  const geIds = gateEntries.map((g) => g.id);
  const [slips, loadings] = await Promise.all([
    geIds.length ? WeightSlip.findAll({ where: { is_deleted: false, gate_entry_id: { [Op.in]: geIds } } }) : [],
    geIds.length ? Loading.findAll({ where: { is_deleted: false, gate_entry_id: { [Op.in]: geIds } }, attributes: ["id", "gate_entry_id", "loaded_qty", "items"] }) : [],
  ]);
  const netByGate = new Map();
  slips.forEach((ws) => { if (ws.net_weight != null) netByGate.set(Number(ws.gate_entry_id), Number(ws.net_weight)); });
  const loadedByGate = new Map();
  loadings.forEach((l) => {
    const cur = loadedByGate.get(Number(l.gate_entry_id)) || { qty: 0, bags: 0, hasBags: false };
    cur.qty += Number(l.loaded_qty || 0);
    asArray(l.items).forEach((it) => {
      if (it.bags != null && Number.isFinite(Number(it.bags))) { cur.bags += Number(it.bags); cur.hasBags = true; }
    });
    loadedByGate.set(Number(l.gate_entry_id), cur);
  });

  const outward = gateEntries.map((ge) => {
    const loaded = loadedByGate.get(Number(ge.id));
    const soNos = [...new Set([...(ge.sales_orders || []).map((r) => r.sales_order?.so_no), ge.salesOrder?.so_no].filter(Boolean))];
    const items = ge.material?.name
      ? ge.material.name
      : [...new Set((ge.sales_orders || []).map((r) => r.material?.name).filter(Boolean))].join(", ") || DASH;
    return {
      direction: "OUTWARD",
      id: ge.id,
      gp_no: gpNoFor("sales", ge.id),
      time: ge.exit_time || ge.entry_time,
      vehicle: ge.vehicle?.vehicle_no || DASH,
      driver: ge.driver?.name || DASH,
      party: ge.customer?.name || DASH,
      order_no: soNos.join(", ") || DASH,
      item: items,
      bags: loaded && loaded.hasBags ? loaded.bags : null,
      loaded_qty: loaded ? loaded.qty : null,
      net: netByGate.has(Number(ge.id)) ? netByGate.get(Number(ge.id)) : null,
      challan: ge.challan_no || DASH,
      status: String(ge.gate_status || "").replace(/_/g, " "),
      plant_id: ge.plant_id,
    };
  });

  // warehouses to list: the picked one, else every warehouse of the picked plant (or all of them)
  let listedWarehouses;
  if (warehouse) listedWarehouses = [warehouse];
  else if (plantId) listedWarehouses = allWarehouses.filter((w) => !w.plant_id || Number(w.plant_id) === Number(plantId));
  else listedWarehouses = allWarehouses;

  return { allPlants, plantById, warehouseById, plant, warehouse, listedWarehouses, inward, outward, outwardPlantId };
};

const letterheadFor = (d) => d.plant
  || (d.warehouse && d.warehouse.plant_id && d.plantById.get(Number(d.warehouse.plant_id)))
  || d.allPlants[0]
  || null;

const filterLine = (d) => {
  const parts = [`Plant / Mill: ${d.plant ? d.plant.name : "All"}`, `Warehouse: ${d.warehouse ? d.warehouse.name : "All warehouses"}`];
  return parts.join("   |   ");
};

const WH_NOTE = "Outward trucks are not recorded against a warehouse in this system, so a warehouse filter narrows outward trucks to that warehouse's plant / mill.";
const NET_NOTE = "Net Wt = weighbridge 1st weighment - 2nd weighment (gross - tare) in Kg for the weight slip tied to that truck; it shows a dash until the truck has been weighed twice. GP No. is the truck's Gate Pass number.";

// ------------------------------------------------------------------ layout 1: INWARD
const inwardSpec = (d, ymd, date) => {
  const whName = (id) => d.warehouseById.get(Number(id))?.name || `Warehouse ${id}`;
  const buckets = new Map();
  d.listedWarehouses.forEach((w) => buckets.set(`w${w.id}`, { name: w.name, plantId: w.plant_id, rows: [] }));
  const unloaded = { name: "NOT YET UNLOADED / NO WAREHOUSE", plantId: null, rows: [] };
  d.inward.forEach((r) => {
    const first = r.warehouse_ids[0];
    if (!first) { unloaded.rows.push(r); return; }
    const key = `w${first}`;
    if (!buckets.has(key)) buckets.set(key, { name: whName(first), plantId: d.warehouseById.get(Number(first))?.plant_id, rows: [] });
    buckets.get(key).rows.push(r);
  });
  const list = [...buckets.values()];
  if (unloaded.rows.length) list.push(unloaded);

  const groups = list.map((b) => {
    const rows = b.rows;
    const plantName = b.plantId ? d.plantById.get(Number(b.plantId))?.name : null;
    return {
      title: `WAREHOUSE: ${String(b.name).toUpperCase()}`,
      meta: rows.length ? `${rows.length} vehicle(s)  |  Net ${kg(sum(rows, (r) => r.net))} Kg${plantName ? `  |  ${plantName}` : ""}` : plantName || "",
      accent: rows.length ? IN_COLOR : "#94A3B8",
      note: rows.length ? undefined : "No inward vehicles received into this warehouse on this date.",
      rows: rows.map((r) => ({
        cells: (n) => [
          n, { t: r.gp_no, bold: true }, hhmm(r.time), r.vehicle, r.party, r.order_no, r.item, r.lot_nos,
          r.bags ? fmtCount(r.bags) : DASH, kg(r.gross), kg(r.tare), { t: kg(r.net), bold: true },
        ],
      })),
      subtotalCells: rows.length
        ? ["", "", "", "", `Total - ${b.name}`, "", "", "", fmtCount(sum(rows, (r) => r.bags)), kg(sum(rows, (r) => r.gross)), kg(sum(rows, (r) => r.tare)), kg(sum(rows, (r) => r.net))]
        : undefined,
    };
  });
  const all = d.inward;
  const used = list.filter((b) => b.rows.length).length;
  return {
    filename: `daily-inward-report-${ymd}.pdf`,
    title: "DAILY INWARD REPORT",
    subtitleLines: [`Date: ${fmtDMY(date)}`, filterLine(d), "Purchase vehicles received against Purchase Orders, by warehouse"],
    plant: letterheadFor(d),
    kpis: [
      { label: "Inward vehicles", value: fmtCount(all.length), color: IN_COLOR },
      { label: "Bags received", value: fmtCount(sum(all, (r) => r.bags)) },
      { label: "Net weight (Kg)", value: kg(sum(all, (r) => r.net)), color: IN_COLOR },
      { label: "Net weight (Qtl)", value: fmtQty(sum(all, (r) => r.net) / KG_PER_QTL) },
      { label: "Warehouses used", value: `${used} of ${d.listedWarehouses.length}` },
    ],
    columns: [
      { label: "S.No", w: 26, align: "center" },
      { label: "GP No", w: 62, align: "center" },
      { label: "Time", w: 36, align: "center" },
      { label: "Vehicle No", w: 66, align: "center" },
      { label: "Party / Vendor", w: 118, align: "left" },
      { label: "PO No", w: 82, align: "left" },
      { label: "Item", w: 80, align: "left" },
      { label: "Lot No", w: 84, align: "left" },
      { label: "Bags", w: 36, align: "right" },
      { label: "Gross (Kg)", w: 52, align: "right" },
      { label: "Tare (Kg)", w: 52, align: "right" },
      { label: "Net Wt (Kg)", w: 58, align: "right" },
    ],
    groups,
    totalsRow: groups.filter((g) => g.rows.length).length > 1
      ? ["", "", "", "", "GRAND TOTAL", "", "", "", fmtCount(sum(all, (r) => r.bags)), kg(sum(all, (r) => r.gross)), kg(sum(all, (r) => r.tare)), kg(sum(all, (r) => r.net))]
      : null,
    emptyText: "No inward vehicles for the selected date and filters.",
    footnotes: [NET_NOTE, "Every warehouse is listed; one with no inward vehicle on the day is marked as such. A truck is placed under the warehouse of the lot it was unloaded into."],
  };
};

// ------------------------------------------------------------------ layout 2: OUTWARD
const outwardSpec = (d, ymd, date) => {
  const buckets = new Map();
  const plants = d.plant ? [d.plant] : d.allPlants;
  plants.forEach((p) => buckets.set(Number(p.id), { name: p.name, rows: [] }));
  const none = { name: "UNASSIGNED / NO PLANT SET", rows: [] };
  d.outward.forEach((r) => {
    const b = buckets.get(Number(r.plant_id));
    (b || none).rows.push(r);
  });
  const list = [...buckets.values()].filter((b) => b.rows.length || buckets.size === 1);
  if (none.rows.length) list.push(none);
  const all = d.outward;
  const groups = list.map((b) => ({
    title: `PLANT / MILL: ${String(b.name).toUpperCase()}`,
    meta: `${b.rows.length} vehicle(s)  |  Net ${kg(sum(b.rows, (r) => r.net))} Kg`,
    accent: OUT_COLOR,
    note: b.rows.length ? undefined : "No outward vehicles on this date.",
    rows: b.rows.map((r) => ({
      cells: (n) => [
        n, { t: r.gp_no, bold: true }, hhmm(r.time), r.vehicle, r.driver, r.party, r.order_no, r.item,
        r.bags != null ? fmtCount(r.bags) : DASH, r.loaded_qty != null ? fmtQty(r.loaded_qty) : DASH,
        { t: kg(r.net), bold: true }, r.status || DASH,
      ],
    })),
    subtotalCells: b.rows.length
      ? ["", "", "", "", "", `Total - ${b.name}`, "", "", fmtCount(sum(b.rows, (r) => r.bags)), fmtQty(sum(b.rows, (r) => r.loaded_qty)), kg(sum(b.rows, (r) => r.net)), ""]
      : undefined,
  }));
  return {
    filename: `daily-outward-report-${ymd}.pdf`,
    title: "DAILY OUTWARD REPORT",
    subtitleLines: [`Date: ${fmtDMY(date)}`, filterLine(d), "Sales vehicles dispatched against Sales Orders, by plant / mill"],
    plant: letterheadFor(d),
    kpis: [
      { label: "Outward vehicles", value: fmtCount(all.length), color: OUT_COLOR },
      { label: "Bags loaded", value: fmtCount(sum(all, (r) => r.bags)) },
      { label: "Loaded qty (Qtl)", value: fmtQty(sum(all, (r) => r.loaded_qty)) },
      { label: "Net weight (Kg)", value: kg(sum(all, (r) => r.net)), color: OUT_COLOR },
      { label: "Net weight (Qtl)", value: fmtQty(sum(all, (r) => r.net) / KG_PER_QTL) },
    ],
    columns: [
      { label: "S.No", w: 26, align: "center" },
      { label: "GP No", w: 64, align: "center" },
      { label: "Time", w: 36, align: "center" },
      { label: "Vehicle No", w: 66, align: "center" },
      { label: "Driver", w: 70, align: "left" },
      { label: "Party / Customer", w: 112, align: "left" },
      { label: "SO No", w: 84, align: "left" },
      { label: "Item", w: 82, align: "left" },
      { label: "Bags", w: 36, align: "right" },
      { label: "Loaded (Qtl)", w: 56, align: "right" },
      { label: "Net Wt (Kg)", w: 56, align: "right" },
      { label: "Status", w: 68, align: "left" },
    ],
    groups,
    totalsRow: groups.length > 1
      ? ["", "", "", "", "", "GRAND TOTAL", "", "", fmtCount(sum(all, (r) => r.bags)), fmtQty(sum(all, (r) => r.loaded_qty)), kg(sum(all, (r) => r.net)), ""]
      : null,
    emptyText: "No outward vehicles for the selected date and filters.",
    footnotes: [
      NET_NOTE,
      "Bags and Loaded qty come from the truck's loading records; they show a dash if the truck has not been loaded yet.",
      ...(d.warehouse ? [WH_NOTE] : []),
    ],
  };
};

// ------------------------------------------------------------------ layout 3: OVERALL
const overallSpec = (d, ymd, date) => {
  const whName = (id) => d.warehouseById.get(Number(id))?.name || `Warehouse ${id}`;
  const plantName = (id) => (id ? d.plantById.get(Number(id))?.name : null) || "Unassigned / no plant set";

  // summary: inward per warehouse (all listed, zeros included) and outward per plant
  const inByWh = new Map(d.listedWarehouses.map((w) => [Number(w.id), { name: w.name, rows: [] }]));
  const notUnloaded = { name: "Not yet unloaded", rows: [] };
  d.inward.forEach((r) => {
    const first = r.warehouse_ids[0];
    if (!first) { notUnloaded.rows.push(r); return; }
    if (!inByWh.has(Number(first))) inByWh.set(Number(first), { name: whName(first), rows: [] });
    inByWh.get(Number(first)).rows.push(r);
  });
  const inwardLines = [...inByWh.values()];
  if (notUnloaded.rows.length) inwardLines.push(notUnloaded);

  const outByPlant = new Map();
  (d.plant ? [d.plant] : d.allPlants).forEach((p) => outByPlant.set(Number(p.id), { name: p.name, rows: [] }));
  d.outward.forEach((r) => {
    const key = r.plant_id ? Number(r.plant_id) : 0;
    if (!outByPlant.has(key)) outByPlant.set(key, { name: plantName(r.plant_id), rows: [] });
    outByPlant.get(key).rows.push(r);
  });
  const outwardLines = [...outByPlant.values()];

  const line = (color) => (b, i) => ({
    cells: () => [
      i + 1, b.name, b.rows.length ? { t: fmtCount(b.rows.length), bold: true, color } : { t: "0", color: "#94A3B8" },
      b.rows.length ? fmtCount(sum(b.rows, (r) => r.bags)) : DASH,
      b.rows.length ? { t: kg(sum(b.rows, (r) => r.net)), bold: true } : DASH,
      b.rows.length ? fmtQty(sum(b.rows, (r) => r.net) / KG_PER_QTL) : DASH,
    ],
  });
  const totalsOf = (label, rows) => ["", label, fmtCount(rows.length), fmtCount(sum(rows, (r) => r.bags)), kg(sum(rows, (r) => r.net)), fmtQty(sum(rows, (r) => r.net) / KG_PER_QTL)];
  const inNet = sum(d.inward, (r) => r.net);
  const outNet = sum(d.outward, (r) => r.net);

  const summaryGroups = [
    {
      title: "INWARD  -  BY WAREHOUSE", accent: IN_COLOR, meta: `${d.inward.length} vehicle(s)`,
      rows: inwardLines.map(line(IN_COLOR)), subtotalCells: totalsOf("Total inward", d.inward),
    },
    {
      title: "OUTWARD  -  BY PLANT / MILL", accent: OUT_COLOR, meta: `${d.outward.length} vehicle(s)`,
      rows: outwardLines.map(line(OUT_COLOR)), subtotalCells: totalsOf("Total outward", d.outward),
    },
  ];

  // detail: every vehicle of the day, in time order, both directions
  const everyone = [...d.inward, ...d.outward].sort((a, b) => new Date(a.time || 0) - new Date(b.time || 0));
  const placeOf = (r) => (r.direction === "INWARD"
    ? (r.warehouse_ids.length ? r.warehouse_ids.map(whName).join(", ") : "Not unloaded yet")
    : plantName(r.plant_id));
  const detail = {
    title: "DAY LOG  -  ALL INWARD & OUTWARD VEHICLES",
    subtitleLines: [`Date: ${fmtDMY(date)}`, filterLine(d)],
    columns: [
      { label: "S.No", w: 26, align: "center" },
      { label: "Direction", w: 56, align: "center" },
      { label: "GP No", w: 64, align: "center" },
      { label: "Time", w: 36, align: "center" },
      { label: "Vehicle No", w: 66, align: "center" },
      { label: "Party", w: 118, align: "left" },
      { label: "PO / SO No", w: 84, align: "left" },
      { label: "Item", w: 82, align: "left" },
      { label: "Bags", w: 36, align: "right" },
      { label: "Net Wt (Kg)", w: 58, align: "right" },
      { label: "Warehouse / Plant", w: 110, align: "left" },
    ],
    groups: everyone.length
      ? [{
          title: `ALL VEHICLES  -  ${everyone.length} movement(s)`, accent: COLORS.NAVY,
          rows: everyone.map((r) => ({
            cells: (n) => [
              n, { t: r.direction, bold: true, color: r.direction === "INWARD" ? IN_COLOR : OUT_COLOR }, { t: r.gp_no, bold: true }, hhmm(r.time),
              r.vehicle, r.party, r.order_no, r.item, r.bags != null && r.bags !== 0 ? fmtCount(r.bags) : DASH, { t: kg(r.net), bold: true }, placeOf(r),
            ],
          })),
        }]
      : [],
    emptyText: "No inward or outward vehicles for the selected date and filters.",
  };

  return {
    filename: `daily-overall-report-${ymd}.pdf`,
    title: "DAILY INWARD / OUTWARD REPORT",
    subtitleLines: [`Date: ${fmtDMY(date)}`, filterLine(d), "Day summary: inward by warehouse, outward by plant / mill, then the full vehicle log"],
    plant: letterheadFor(d),
    kpis: [
      { label: "Inward vehicles", value: fmtCount(d.inward.length), color: IN_COLOR },
      { label: "Inward net (Kg)", value: kg(inNet), color: IN_COLOR },
      { label: "Outward vehicles", value: fmtCount(d.outward.length), color: OUT_COLOR },
      { label: "Outward net (Kg)", value: kg(outNet), color: OUT_COLOR },
      { label: "Inward - Outward (Kg)", value: `${inNet - outNet < 0 ? "-" : ""}${kg(Math.abs(inNet - outNet))}` },
    ],
    columns: [
      { label: "S.No", w: 30, align: "center" },
      { label: "Warehouse / Plant", w: 260, align: "left" },
      { label: "Vehicles", w: 70, align: "right" },
      { label: "Bags", w: 80, align: "right" },
      { label: "Net Wt (Kg)", w: 110, align: "right" },
      { label: "Net Wt (Qtl)", w: 100, align: "right" },
    ],
    groups: summaryGroups,
    totalsRow: null,
    emptyText: "Nothing to show.",
    sections: [detail],
    footnotes: [NET_NOTE, ...(d.warehouse ? [WH_NOTE] : [])],
  };
};

// Builds the renderTableReport spec for GET /api/reports/daily-report-pdf
//   ?date=YYYY-MM-DD&report_type=inward|outward|overall&plant_id=&warehouse_id=
const buildDailyReportSpec = async (query) => {
  const { ymd, date } = parseDate(query.date);
  const type = ["inward", "outward", "overall"].includes(String(query.report_type || "").toLowerCase())
    ? String(query.report_type).toLowerCase()
    : "overall";
  const data = await loadDay({ ymd, plantId: query.plant_id || null, warehouseId: query.warehouse_id || null });
  if (type === "inward") return inwardSpec(data, ymd, date);
  if (type === "outward") return outwardSpec(data, ymd, date);
  return overallSpec(data, ymd, date);
};

module.exports = { buildDailyReportSpec };
