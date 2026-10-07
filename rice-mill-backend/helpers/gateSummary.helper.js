const { Op } = require("sequelize");
const {
  GateEntry, Vehicle, Driver, Vendor, Customer, MaterialMaster, PurchaseOrder, SalesOrder,
  GateEntryPurchaseOrder, GateEntrySalesOrder, Purchase, Lot, Sampling, LabTest, Loading,
} = require("../models/index");

// Reports > Gate Register > Gate Summary.
//
// A live picture of every vehicle that is STILL INSIDE the mill (gate_status is
// anything but "exited"), arranged into six views:
//
//   PO            purchase trucks, grouped by Purchase Order
//   SO            sales (outbound) trucks, grouped by Sales Order
//   Lab Analysis  purchase trucks waiting for sampling / a lab verdict (or rejected, awaiting exit)
//   Loading       sales trucks being loaded, or loaded and waiting for the 2nd weighment
//   Unloading     purchase trucks waiting to unload, unloading, or waiting for the 2nd weighment
//   Gate Pass     trucks that have finished and are parked, waiting for the gate pass / checkout
//
// A vehicle can be in several views (a purchase truck being unloaded is in both PO
// and Unloading). Exited vehicles never appear anywhere. Trucks that belong to none
// of the six views (empty/misc trucks still being processed, details not yet
// attached) are returned as `unassigned` so nothing in the mill goes unseen.

const KG_PER_ORDER_QTL = 1000; // the app's "Qtl" on orders is 1000 kg, shown as MT
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

// How long a vehicle has sat in its current step (minutes) before it is flagged.
const WARN_AFTER_MIN = 120;
const LATE_AFTER_MIN = 360;
const waitLevel = (m) => (m >= LATE_AFTER_MIN ? "late" : m >= WARN_AFTER_MIN ? "warn" : "ok");

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
const orderLines = (o) => {
  const items = asArray(o && o.items);
  if (items.length) return items;
  return o && o.material_id ? [{ material_id: o.material_id, qty: o.qty, dispatched_qty: o.dispatched_qty }] : [];
};

const TAB_STATUSES = {
  lab: ["waiting_sampling", "sampling_done", "rejected"],
  loading: ["waiting_loading", "loaded", "waiting_second_weighment"],
  unloading: ["in_process", "unloading", "waiting_second_weighment"],
  gatepass: ["parked", "unloaded"],
};

// What the vehicle is doing right now, in plain words (same wording as the Gate Entry screen).
const stageFor = (e, extra) => {
  const type = e.entry_type;
  switch (e.gate_status) {
    case "pending_details": return { label: "Waiting on Admin", tone: "muted" };
    case "waiting_token": return { label: "Waiting Token", tone: "muted" };
    case "waiting_sampling": return { label: "Sample not taken yet", tone: "info" };
    case "sampling_done":
      if (extra.lab === "negotiation") return { label: "Negotiation pending", tone: "warn" };
      return { label: "Lab test pending", tone: "info" };
    case "accepted": return { label: "Accepted - waiting for 1st weighment", tone: "good" };
    case "rejected": return { label: "Rejected - awaiting exit", tone: "bad" };
    case "waiting_weighment": return { label: "Waiting for 1st weighment", tone: "info" };
    case "in_process": return { label: type === "purchase" ? "Weighed in - ready to unload" : "In process (weighed)", tone: "info" };
    case "unloading": return { label: "Unloading in progress", tone: "active" };
    case "unloaded": return { label: "Unloaded - gate pass pending", tone: "good" };
    case "waiting_loading":
      return extra.loadedQty > 0
        ? { label: `Partly loaded (${r3(extra.loadedQty)} Qtl so far)`, tone: "active" }
        : { label: "Ready for loading", tone: "info" };
    case "loaded": return { label: "Loaded", tone: "good" };
    case "waiting_second_weighment":
      if (type === "purchase") return { label: "Unloaded - waiting for 2nd weighment", tone: "info" };
      if (type === "sales") return { label: "Loaded - waiting for 2nd weighment", tone: "info" };
      return { label: "Waiting for 2nd weighment", tone: "info" };
    case "parked": return { label: "Parked - gate pass pending", tone: "good" };
    default: return { label: String(e.gate_status || "—").replace(/_/g, " "), tone: "muted" };
  }
};

const buildGateSummary = async ({ plantId, now = new Date() } = {}) => {
  const where = { is_deleted: false, gate_status: { [Op.ne]: "exited" } };
  if (plantId) where.plant_id = plantId;

  const entries = await GateEntry.findAll({
    where,
    include: [
      { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
      { model: Driver, as: "driver", attributes: ["id", "name", "mobile"] },
      { model: Vendor, as: "vendor", attributes: ["id", "name"] },
      { model: Customer, as: "customer", attributes: ["id", "name"] },
      { model: MaterialMaster, as: "material", attributes: ["id", "name"], required: false },
      { model: PurchaseOrder, as: "purchaseOrder", required: false },
      { model: SalesOrder, as: "salesOrder", required: false },
    ],
    order: [["entry_time", "ASC"], ["id", "ASC"]],
  });
  const ids = entries.map((e) => e.id);

  // ---- extra per-vehicle context, fetched in bulk ----
  const none = Promise.resolve([]);
  const [poLinks, soLinks, samplings, loadings, purchases] = await Promise.all([
    ids.length ? GateEntryPurchaseOrder.findAll({ where: { gate_entry_id: { [Op.in]: ids }, is_deleted: false }, include: [{ model: PurchaseOrder, as: "purchaseOrder" }] }) : none,
    ids.length ? GateEntrySalesOrder.findAll({ where: { gate_entry_id: { [Op.in]: ids }, is_deleted: false }, include: [{ model: SalesOrder, as: "sales_order" }] }) : none,
    ids.length ? Sampling.findAll({ where: { gate_entry_id: { [Op.in]: ids }, is_deleted: false }, attributes: ["id", "gate_entry_id"] }) : none,
    ids.length ? Loading.findAll({ where: { gate_entry_id: { [Op.in]: ids }, is_deleted: false }, attributes: ["id", "gate_entry_id", "loaded_qty"] }) : none,
    ids.length ? Purchase.findAll({ where: { gate_entry_id: { [Op.in]: ids }, is_deleted: false }, attributes: ["id", "gate_entry_id"] }) : none,
  ]);
  const tests = samplings.length
    ? await LabTest.findAll({ where: { sampling_id: { [Op.in]: samplings.map((s) => s.id) }, is_deleted: false }, order: [["id", "DESC"]], attributes: ["id", "sampling_id", "verdict"] })
    : [];
  const lots = purchases.length
    ? await Lot.findAll({ where: { purchase_id: { [Op.in]: purchases.map((p) => p.id) }, is_deleted: false }, attributes: ["id", "lot_no", "purchase_id", "unloading_status"] })
    : [];

  const group = (rows, key) => rows.reduce((m, r) => ((m.get(r[key]) || m.set(r[key], []).get(r[key])).push(r), m), new Map());
  const poByEntry = group(poLinks, "gate_entry_id");
  const soByEntry = group(soLinks, "gate_entry_id");
  const loadedByEntry = new Map();
  loadings.forEach((l) => loadedByEntry.set(l.gate_entry_id, (loadedByEntry.get(l.gate_entry_id) || 0) + Number(l.loaded_qty || 0)));
  const sampleToEntry = new Map(samplings.map((s) => [s.id, s.gate_entry_id]));
  const labByEntry = new Map(); // newest verdict per vehicle
  tests.forEach((t) => {
    const eid = sampleToEntry.get(t.sampling_id);
    if (eid && !labByEntry.has(eid)) labByEntry.set(eid, t.verdict);
  });
  const purchaseToEntry = new Map(purchases.map((p) => [p.id, p.gate_entry_id]));
  const lotsByEntry = new Map();
  lots.forEach((l) => {
    const eid = purchaseToEntry.get(l.purchase_id);
    (lotsByEntry.get(eid) || lotsByEntry.set(eid, []).get(eid)).push(l);
  });

  // ---- one record per vehicle ----
  const vehicles = entries.map((e) => {
    const poNos = [...new Set([...(poByEntry.get(e.id) || []).map((r) => r.purchaseOrder && r.purchaseOrder.po_no), e.purchaseOrder && e.purchaseOrder.po_no].filter(Boolean))];
    const soNos = [...new Set([...(soByEntry.get(e.id) || []).map((r) => r.sales_order && r.sales_order.so_no), e.salesOrder && e.salesOrder.so_no].filter(Boolean))];
    const extra = { lab: labByEntry.get(e.id) || null, loadedQty: loadedByEntry.get(e.id) || 0 };
    const stage = stageFor(e, extra);
    const sinceStage = Math.max(0, Math.round((now.getTime() - new Date(e.updatedAt || e.entry_time || now).getTime()) / 60000));
    const inMill = Math.max(0, Math.round((now.getTime() - new Date(e.entry_time || e.createdAt || now).getTime()) / 60000));
    const myLots = lotsByEntry.get(e.id) || [];
    return {
      id: e.id,
      token_no: e.token_no,
      entry_type: e.entry_type,
      gate_status: e.gate_status,
      stage_label: stage.label,
      stage_tone: stage.tone,
      vehicle_no: e.vehicle ? e.vehicle.vehicle_no : null,
      driver_name: e.driver ? e.driver.name : null,
      driver_mobile: e.driver ? e.driver.mobile : null,
      party_name: (e.vendor && e.vendor.name) || (e.customer && e.customer.name) || null,
      material: e.material ? e.material.name : null,
      entry_time: e.entry_time || e.createdAt,
      minutes_in_mill: inMill,
      minutes_in_stage: sinceStage,
      wait_level: waitLevel(sinceStage),
      po_nos: poNos,
      so_nos: soNos,
      lab_verdict: extra.lab,
      loaded_qty: extra.loadedQty ? r3(extra.loadedQty) : null,
      lot_nos: myLots.map((l) => l.lot_no),
    };
  });

  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const inTab = (v, tab) => TAB_STATUSES[tab].includes(v.gate_status);
  const purchaseV = vehicles.filter((v) => v.entry_type === "purchase");
  const salesV = vehicles.filter((v) => v.entry_type === "sales");
  const tabs = {
    po: purchaseV,
    so: salesV,
    lab: purchaseV.filter((v) => inTab(v, "lab")),
    loading: salesV.filter((v) => inTab(v, "loading")),
    unloading: purchaseV.filter((v) => inTab(v, "unloading")),
    gatepass: vehicles.filter((v) => inTab(v, "gatepass")),
  };

  // ---- order cards (PO / SO tabs): how much is ordered / received / pending, and the trucks inside ----
  const poOrders = new Map();
  const soOrders = new Map();
  const attach = (map, no, order, v, partyField) => {
    const o = map.get(no) || { order_no: no, order, vehicles: [] };
    if (!o.vehicles.includes(v)) o.vehicles.push(v);
    map.set(no, o);
  };
  entries.forEach((e) => {
    const v = byId.get(e.id);
    if (e.entry_type === "purchase") {
      const list = (poByEntry.get(e.id) || []).map((r) => r.purchaseOrder).filter(Boolean);
      if (e.purchaseOrder) list.push(e.purchaseOrder);
      const seen = new Set();
      list.forEach((po) => {
        if (seen.has(po.po_no)) return;
        seen.add(po.po_no);
        attach(poOrders, po.po_no, po, v);
      });
    } else if (e.entry_type === "sales") {
      const list = (soByEntry.get(e.id) || []).map((r) => r.sales_order).filter(Boolean);
      if (e.salesOrder) list.push(e.salesOrder);
      const seen = new Set();
      list.forEach((so) => {
        if (seen.has(so.so_no)) return;
        seen.add(so.so_no);
        attach(soOrders, so.so_no, so, v);
      });
    }
  });

  const poIds = [...poOrders.values()].map((o) => o.order.id);
  const received = new Map();
  if (poIds.length) {
    (await Purchase.findAll({ where: { po_id: { [Op.in]: poIds }, is_deleted: false }, attributes: ["po_id", "final_qty"] })).forEach((p) =>
      received.set(p.po_id, (received.get(p.po_id) || 0) + Number(p.final_qty || 0) / KG_PER_ORDER_QTL) // final_qty is the weighbridge net weight in kg
    );
  }
  const orderMaterialIds = new Set();
  [...poOrders.values(), ...soOrders.values()].forEach((o) => orderLines(o.order).forEach((l) => l.material_id && orderMaterialIds.add(Number(l.material_id))));
  const mats = orderMaterialIds.size ? await MaterialMaster.findAll({ where: { id: { [Op.in]: [...orderMaterialIds] } }, attributes: ["id", "name"] }) : [];
  const matName = new Map(mats.map((m) => [Number(m.id), m.name]));
  const partyNames = new Map();
  const vendorIds = [...poOrders.values()].map((o) => o.order.vendor_id).filter(Boolean);
  const customerIds = [...soOrders.values()].map((o) => o.order.customer_id).filter(Boolean);
  (vendorIds.length ? await Vendor.findAll({ where: { id: { [Op.in]: vendorIds } }, attributes: ["id", "name"] }) : []).forEach((x) => partyNames.set(`v${x.id}`, x.name));
  (customerIds.length ? await Customer.findAll({ where: { id: { [Op.in]: customerIds } }, attributes: ["id", "name"] }) : []).forEach((x) => partyNames.set(`c${x.id}`, x.name));

  const shapeOrder = (o, kind) => {
    const lines = orderLines(o.order);
    const ordered = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
    const done = kind === "po"
      ? received.get(o.order.id) || 0
      : lines.reduce((s, l) => s + (Number(l.dispatched_qty) || 0), 0) || Number(o.order.dispatched_qty) || 0;
    return {
      order_no: o.order_no,
      party_name: kind === "po" ? partyNames.get(`v${o.order.vendor_id}`) || null : partyNames.get(`c${o.order.customer_id}`) || null,
      materials: [...new Set(lines.map((l) => matName.get(Number(l.material_id))).filter(Boolean))],
      ordered_qty: r3(ordered),
      done_qty: r3(done), // received (PO) / loaded (SO)
      pending_qty: r3(Math.max(0, ordered - done)),
      progress_pct: ordered > 0 ? Math.min(100, Math.round((done / ordered) * 100)) : 0,
      vehicles: o.vehicles,
    };
  };
  const sortOrders = (arr) => arr.sort((a, b) => b.vehicles.length - a.vehicles.length || String(a.order_no).localeCompare(String(b.order_no)));
  const orders = {
    po: sortOrders([...poOrders.values()].map((o) => shapeOrder(o, "po"))),
    so: sortOrders([...soOrders.values()].map((o) => shapeOrder(o, "so"))),
  };

  const shown = new Set();
  Object.values(tabs).forEach((list) => list.forEach((v) => shown.add(v.id)));
  const unassigned = vehicles.filter((v) => !shown.has(v.id));

  return {
    generated_at: now,
    thresholds: { warn_minutes: WARN_AFTER_MIN, late_minutes: LATE_AFTER_MIN },
    total_in_mill: vehicles.length,
    counts: Object.fromEntries(Object.entries(tabs).map(([k, list]) => [k, list.length])),
    tabs,
    orders,
    unassigned,
  };
};

module.exports = { buildGateSummary, TAB_STATUSES };