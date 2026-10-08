const { Op } = require("sequelize");
const { KG_PER_QTL } = require("./units");
const {
  Inventory, Lot, Purchase, PurchaseOrder, GateEntry, Vendor, Vehicle, Customer, SalesOrder, Dispatch,
  ProductionBatch, Packing, FinishedGoods,
} = require("../models/index");
const { fmtQty, fmtCount, pad2 } = require("./reportPdf.helper");
const stamp = (t) => { const d = new Date(t); return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${String(d.getFullYear()).slice(-2)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

// Material-flow ledger for the Stock Movement report (Admin > Reports > Inventory).
//
// The summary table of that report says HOW MUCH moved per item (Opening / Inwards /
// Production / Dispatch / Issue / Closing). This ledger lists every single movement
// behind those totals, in time order, per warehouse:
//
//   INWARD       raw material received into a warehouse after unloading   (Vendor -> Warehouse)
//   ISSUE        raw material drawn from a warehouse by a production batch (Warehouse -> Batch)
//   PRODUCTION   packed goods a batch put into a warehouse                  (Batch -> Warehouse)
//   DISPATCH     packed goods that left on a sales dispatch                 (Warehouse -> Customer)
//
// and for each line: from, to, how much (Qtl + bags), the reference (lot / batch / challan)
// and the quantity LEFT in that warehouse for that item + pack size right after it.
//
// "Left" is worked backwards from the live stock (the same live balances the Inventory
// screen shows): left after a movement = live balance - everything that happened later.
// This app keeps no stock ledger table, so if an item's recorded movements don't add up
// to its live balance (someone edited a balance by hand) its Left values are marked with *.
//
// Stock definitions match the Inventory screen: raw = Inventory(raw) balances; packed =
// FinishedGoods that are not dispatched (so a dispatch DOES reduce packed stock here).

const EPS = 0.01; // Qtl
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const ts = (d) => (d ? new Date(d).getTime() : 0);
const keyOf = (stage, wh, mat, size) => `${stage}|${wh == null ? 0 : Number(wh)}|${Number(mat)}|${size == null ? "b" : Number(size)}`;

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

const TYPE_ORDER = { INWARD: 0, ISSUE: 1, PRODUCTION: 2, DISPATCH: 3 };
const TYPE_STYLE = {
  INWARD: { t: "INWARD", color: "#166534", bold: true },
  ISSUE: { t: "ISSUE", color: "#9A3412", bold: true },
  PRODUCTION: { t: "PRODUCTION", color: "#1D4ED8", bold: true },
  DISPATCH: { t: "DISPATCH", color: "#B91C1C", bold: true },
};

const loadFlowData = async () => {
  const [rawInv, fgRows, packings] = await Promise.all([
    Inventory.findAll({
      where: { is_deleted: false, stage: "raw" },
      include: [{ model: Lot, as: "lot", attributes: ["id", "lot_no", "bag_size", "accepted_bags", "purchase_id"] }],
    }),
    FinishedGoods.findAll({ where: { is_deleted: false } }),
    Packing.findAll({}),
  ]);
  const packingById = new Map(packings.map((p) => [Number(p.id), p]));

  const batchIds = [...new Set(packings.map((p) => Number(p.batch_id)).filter(Boolean))];
  const batches = batchIds.length ? await ProductionBatch.findAll({ where: { id: { [Op.in]: batchIds } } }) : [];

  // lot numbers / bag sizes for the batch input lines
  const lineLotIds = [...new Set(batches.flatMap((b) => asArray(b.materials_data).map((m) => Number(m.lot_id))).filter(Boolean))];
  const inputLots = lineLotIds.length ? await Lot.findAll({ where: { id: { [Op.in]: lineLotIds } }, attributes: ["id", "lot_no", "bag_size"] }) : [];

  // vendor / vehicle behind every inward lot
  const purchaseIds = [...new Set(rawInv.map((r) => Number(r.lot?.purchase_id)).filter(Boolean))];
  const purchases = purchaseIds.length ? await Purchase.findAll({ where: { id: { [Op.in]: purchaseIds } }, attributes: ["id", "gate_entry_id", "po_id"] }) : [];
  const gateIds = [...new Set(purchases.map((p) => Number(p.gate_entry_id)).filter(Boolean))];
  const gates = gateIds.length
    ? await GateEntry.findAll({
        where: { id: { [Op.in]: gateIds } },
        attributes: ["id", "vendor_id", "vehicle_id"],
        include: [
          { model: Vendor, as: "vendor", attributes: ["id", "name"], required: false },
          { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"], required: false },
        ],
      })
    : [];
  const poIds = [...new Set(purchases.map((p) => Number(p.po_id)).filter(Boolean))];
  const pos = poIds.length ? await PurchaseOrder.findAll({ where: { id: { [Op.in]: poIds } }, attributes: ["id", "po_no"] }) : [];

  // customer / challan behind every dispatched pack
  const dispatchIds = [...new Set(fgRows.map((f) => Number(f.dispatch_id)).filter(Boolean))];
  const dispatches = dispatchIds.length ? await Dispatch.findAll({ where: { id: { [Op.in]: dispatchIds } } }) : [];
  const soIds = [...new Set(dispatches.map((d) => Number(d.so_id)).filter(Boolean))];
  const sos = soIds.length ? await SalesOrder.findAll({ where: { id: { [Op.in]: soIds } }, attributes: ["id", "so_no", "customer_id"] }) : [];
  const custIds = [...new Set(sos.map((s) => Number(s.customer_id)).filter(Boolean))];
  const customers = custIds.length ? await Customer.findAll({ where: { id: { [Op.in]: custIds } }, attributes: ["id", "name"] }) : [];

  return {
    rawInv, fgRows, packings, packingById, batches,
    lotById: new Map(inputLots.map((l) => [Number(l.id), l])),
    purchaseById: new Map(purchases.map((p) => [Number(p.id), p])),
    gateById: new Map(gates.map((g) => [Number(g.id), g])),
    poById: new Map(pos.map((p) => [Number(p.id), p])),
    dispatchById: new Map(dispatches.map((d) => [Number(d.id), d])),
    soById: new Map(sos.map((s) => [Number(s.id), s])),
    customerById: new Map(customers.map((c) => [Number(c.id), c])),
  };
};

// Pure: turns the loaded rows into time-ordered movement events + the live balances.
const buildEvents = (data, scope) => {
  const whName = (id) => (id == null ? "Unassigned" : scope.warehouseById.get(Number(id))?.name || `Warehouse ${id}`);
  const matName = (id) => scope.materialById.get(Number(id))?.name || `Material ${id}`;
  const events = [];
  const live = new Map();
  const addLive = (k, v) => live.set(k, (live.get(k) || 0) + v);

  // ---- raw: live balance + inwards ----
  for (const r of data.rawInv) {
    const size = r.lot?.bag_size != null ? Number(r.lot.bag_size) : null;
    const k = keyOf("raw", r.warehouse_id, r.material_id, size);
    addLive(k, Number(r.balance_qty || 0));
    const qty = Number(r.qty_in || 0);
    if (!qty) continue;
    const purchase = r.lot?.purchase_id ? data.purchaseById.get(Number(r.lot.purchase_id)) : null;
    const gate = purchase ? data.gateById.get(Number(purchase.gate_entry_id)) : null;
    const po = purchase ? data.poById.get(Number(purchase.po_id)) : null;
    const refParts = [r.lot?.lot_no ? `Lot ${r.lot.lot_no}` : null, gate?.vehicle?.vehicle_no || null].filter(Boolean);
    void po;
    events.push({
      t: ts(r.createdAt), type: "INWARD", stage: "raw", warehouse_id: r.warehouse_id, material_id: Number(r.material_id), size, key: k,
      delta: qty, qty,
      bags: Number(r.lot?.accepted_bags) || (size ? Math.floor((qty * KG_PER_QTL) / size + 0.0001) : null),
      from: gate?.vendor?.name || "Vendor / purchase",
      to: whName(r.warehouse_id), ref: refParts.join(" · ") || "—",
    });
  }

  // ---- packed: output (production) and dispatch ----
  const batchById = new Map(data.batches.map((b) => [Number(b.id), b]));
  const batchT = new Map(); // batch id -> completion time (earliest packed output)
  const fgByBatch = new Map();
  for (const fg of data.fgRows) {
    const packing = data.packingById.get(Number(fg.packing_id));
    if (!packing || !packing.material_id) continue;
    const bid = Number(packing.batch_id);
    const t = ts(fg.createdAt);
    if (!batchT.has(bid) || t < batchT.get(bid)) batchT.set(bid, t);
    (fgByBatch.get(bid) || fgByBatch.set(bid, []).get(bid)).push(fg);
  }

  for (const fg of data.fgRows) {
    const packing = data.packingById.get(Number(fg.packing_id));
    if (!packing || !packing.material_id) continue;
    const size = packing.pack_size != null ? Number(packing.pack_size) : null;
    const qty = Number(fg.qty || 0) / KG_PER_QTL;
    if (!qty) continue;
    const k = keyOf("fg", fg.warehouse_id, packing.material_id, size);
    const batch = batchById.get(Number(packing.batch_id));
    const bags = size ? Math.floor((qty * KG_PER_QTL) / size + 0.0001) : null;
    const dispatched = fg.fg_status === "dispatched";
    if (!dispatched) addLive(k, qty);
    events.push({
      t: ts(fg.createdAt), type: "PRODUCTION", stage: "fg", warehouse_id: fg.warehouse_id, material_id: Number(packing.material_id), size, key: k,
      delta: qty, qty, bags,
      from: batch ? whName(batch.warehouse_id) : "Production batch",
      to: whName(fg.warehouse_id), ref: batch?.batch_no || "—",
    });
    if (dispatched) {
      const d = fg.dispatch_id ? data.dispatchById.get(Number(fg.dispatch_id)) : null;
      const so = d?.so_id ? data.soById.get(Number(d.so_id)) : null;
      const cust = so?.customer_id ? data.customerById.get(Number(so.customer_id)) : null;
      events.push({
        t: ts(d?.dispatch_time || fg.updatedAt), type: "DISPATCH", stage: "fg", warehouse_id: fg.warehouse_id, material_id: Number(packing.material_id), size, key: k,
        delta: -qty, qty, bags,
        from: whName(fg.warehouse_id),
        to: cust?.name || d?.destination || "Dispatch",
        ref: [d?.challan_no, so?.so_no].filter(Boolean).join(" · ") || "—",
      });
    }
  }

  // ---- issue: raw material a completed batch drew from its source warehouse ----
  for (const b of data.batches) {
    const T = batchT.get(Number(b.id));
    if (!T) continue; // batch not completed (nothing packed yet) — no stock has left the warehouse
    const lines = asArray(b.materials_data);
    const inputs = lines.length ? lines : b.material_id ? [{ material_id: b.material_id, input_qty: b.input_qty, lot_id: b.lot_id }] : [];
    for (const line of inputs) {
      const qty = Number(line.input_qty) || 0;
      if (!line.material_id || !qty) continue;
      const lot = line.lot_id ? data.lotById.get(Number(line.lot_id)) : null;
      const size = line.pack_size != null && Number(line.pack_size) ? Number(line.pack_size) : lot?.bag_size != null ? Number(lot.bag_size) : null;
      const k = keyOf("raw", b.warehouse_id, line.material_id, size);
      events.push({
        t: T, type: "ISSUE", stage: "raw", warehouse_id: b.warehouse_id, material_id: Number(line.material_id), size, key: k,
        delta: -qty, qty, bags: size ? Math.floor((qty * KG_PER_QTL) / size + 0.0001) : null,
        from: whName(b.warehouse_id),
        to: `Production${b.destination_warehouse_id ? ` > ${whName(b.destination_warehouse_id)}` : ""}`,
        ref: [b.batch_no, lot?.lot_no ? `Lot ${lot.lot_no}` : line.lot_no ? `Lot ${line.lot_no}` : null].filter(Boolean).join(" · "),
      });
    }
  }

  events.sort((a, b) => a.t - b.t || TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
  events.forEach((e, i) => { e.seq = i; e.material_name = matName(e.material_id); e.warehouse_name = whName(e.warehouse_id); });

  // ---- running balance, worked back from the live stock ----
  const byKey = new Map();
  for (const e of events) (byKey.get(e.key) || byKey.set(e.key, []).get(e.key)).push(e);
  const unreliable = new Set();
  for (const [k, list] of byKey) {
    const total = list.reduce((s, e) => s + e.delta, 0);
    if (Math.abs((live.get(k) || 0) - total) > EPS) unreliable.add(k);
    let later = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      list[i].left = r3((live.get(k) || 0) - later);
      later += list[i].delta;
    }
  }
  events.forEach((e) => { e.left_flag = unreliable.has(e.key); });
  return events;
};

// Spec for one extra table (renderTableReport `sections` entry).
const buildFlowSection = async ({ scope, from, to, passes, filtersLine, periodLine }) => {
  const data = await loadFlowData();
  const all = buildEvents(data, scope);
  const f = from.getTime();
  const t = to.getTime();
  const rows = all.filter((e) => e.t >= f && e.t <= t && passes(e) && (scope.warehouseSet ? e.warehouse_id != null && scope.warehouseSet.has(Number(e.warehouse_id)) : true));

  const groupsMap = new Map();
  for (const e of rows) {
    const gk = e.warehouse_id == null ? 0 : Number(e.warehouse_id);
    if (!groupsMap.has(gk)) groupsMap.set(gk, { warehouse_id: e.warehouse_id, name: e.warehouse_name, rows: [] });
    groupsMap.get(gk).rows.push(e);
  }
  const ordered = [...groupsMap.values()].sort((a, b) => (a.warehouse_id == null) - (b.warehouse_id == null) || a.name.localeCompare(b.name));
  const sum = (list, fn) => list.reduce((s, e) => s + fn(e), 0);
  const isIn = (e) => e.delta > 0;
  const packLabel = (e) => `${e.stage === "fg" ? "Packed" : "Raw"} · ${e.size != null ? `${Number(e.size)} kg` : "Bulk"}`;

  const groups = ordered.map((g) => ({
    title: `WAREHOUSE: ${String(g.name).toUpperCase()}`,
    meta: `${g.rows.length} movement(s)  |  In ${fmtQty(sum(g.rows, (e) => (isIn(e) ? e.qty : 0)))}  |  Out ${fmtQty(sum(g.rows, (e) => (isIn(e) ? 0 : e.qty)))} Qtl`,
    rows: g.rows.map((e) => ({
      cells: (n) => [
        n, stamp(e.t), { ...TYPE_STYLE[e.type] }, e.material_name, packLabel(e), e.from, e.to, e.ref,
        e.bags != null ? fmtCount(e.bags) : "—",
        isIn(e) ? { t: fmtQty(e.qty), color: "#166534", bold: true } : "—",
        !isIn(e) ? { t: fmtQty(e.qty), color: "#B91C1C", bold: true } : "—",
        { t: `${fmtQty(e.left)}${e.left_flag ? " *" : ""}`, bold: true },
      ],
    })),
    subtotalCells: [
      "", "", "", "Total", "", "", "", "", "",
      fmtQty(sum(g.rows, (e) => (isIn(e) ? e.qty : 0))), fmtQty(sum(g.rows, (e) => (isIn(e) ? 0 : e.qty))), "",
    ],
  }));
  const totalsRow = groups.length > 1
    ? ["", "", "", "Grand total", "", "", "", "", "", fmtQty(sum(rows, (e) => (isIn(e) ? e.qty : 0))), fmtQty(sum(rows, (e) => (isIn(e) ? 0 : e.qty))), ""]
    : null;

  return {
    title: "MATERIAL FLOW - WAREHOUSE MOVEMENT DETAIL",
    subtitleLines: [periodLine, filtersLine],
    note: "Every movement in the period, oldest first. ISSUE = raw material drawn by a production batch; PRODUCTION = packed goods a batch added; From / To show where the material moved. Left = quantity remaining in that warehouse for that item and pack size right after the movement (Qtl).",
    columns: [
      { label: "S.No", w: 30, align: "center" },
      { label: "Date & Time", w: 72, align: "center" },
      { label: "Movement", w: 72, align: "left" },
      { label: "Material", w: 72, align: "left" },
      { label: "Stock / Pack", w: 66, align: "center" },
      { label: "From", w: 96, align: "left" },
      { label: "To", w: 108, align: "left" },
      { label: "Reference", w: 116, align: "left" },
      { label: "Bags", w: 34, align: "right" },
      { label: "Qty In (Qtl)", w: 50, align: "right" },
      { label: "Qty Out (Qtl)", w: 50, align: "right" },
      { label: "Left (Qtl)", w: 54, align: "right" },
    ],
    groups,
    totalsRow,
    emptyText: "No material movement found for the selected period and filters.",
    hasUnreliable: rows.some((e) => e.left_flag),
    events: rows,
  };
};

module.exports = { buildFlowSection, buildEvents, loadFlowData };
