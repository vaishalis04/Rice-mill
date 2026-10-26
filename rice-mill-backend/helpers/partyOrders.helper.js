const createError = require("http-errors");
const { Op } = require("sequelize");
const {
  PurchaseOrder, SalesOrder, Vendor, Customer, MaterialMaster, Purchase, GateEntry, GateEntryPurchaseOrder,
  GateEntrySalesOrder, Lot, Loading,
} = require("../models/index");
const { lotCounts } = require("./materialSlipCalc.helper");
const { fmtQty, fmtCount, fmtDMY, COLORS } = require("./reportPdf.helper");

// Reports > Party Orders — every Purchase Order / Sales Order grouped by the PARTY it belongs to
// (vendor for a PO, customer for an SO): how many orders the party has, how many are completed /
// in progress / not started, how much was ordered, received (PO) or loaded (SO), what is still
// pending, and the dates (first / last order, first / last receipt or loading, validity).
//
// Quantities are in Qtl. Money is deliberately NOT reported: the system stores the order rate in
// two different conventions, so a value here could be wrong.
//
// What "completed" means (same rule the rest of the app uses):
//   PO  every line has received >= ordered. A line's received quantity is its stored received_qty
//       when it has one, otherwise it is rebuilt from the unloaded lots of trucks that have exited
//       (bags x bag size — Lot.qty is lowered later by packing / production).
//   SO  dispatched / closed, or every line has dispatched_qty >= ordered qty.
// Statuses:  completed | in_progress (something received/loaded, or a truck is inside the mill)
//            | not_started | pending_approval | rejected | cancelled

const TOL = 0.001;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const pad2 = (n) => String(n).padStart(2, "0");
const ymdOf = (d) => {
  if (!d) return null;
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
};
const dateOf = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const dmy = (ymd) => (dateOf(ymd) ? fmtDMY(dateOf(ymd)) : "—");
const daysBetween = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 86400000);

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
  const items = asArray(o.items);
  if (items.length) return items;
  return o.material_id ? [{ material_id: o.material_id, qty: o.qty, received_qty: o.received_qty, dispatched_qty: o.dispatched_qty }] : [];
};

const STATUS = {
  completed: { label: "Completed", color: "#166534" },
  in_progress: { label: "In progress", color: "#1D4ED8" },
  not_started: { label: "Not started", color: "#64748B" },
  pending_approval: { label: "Pending approval", color: "#B45309" },
  rejected: { label: "Rejected", color: "#B91C1C" },
  cancelled: { label: "Cancelled", color: "#B91C1C" },
};
const OPEN = ["in_progress", "not_started"];
const COUNTED = ["completed", "in_progress", "not_started"]; // approved, not cancelled -> quantities

const minMax = (dates) => {
  const list = dates.filter(Boolean).sort();
  return { first: list[0] || null, last: list[list.length - 1] || null };
};

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
const buildPartyOrders = async (query = {}) => {
  const type = ["po", "so", "all"].includes(String(query.type || "").toLowerCase()) ? String(query.type).toLowerCase() : "all";
  const from = ymdOf(query.from);
  const to = ymdOf(query.to);
  if (from && to && from > to) throw createError(400, "'from' must not be after 'to'");
  const wantStatus = String(query.status || "").toLowerCase();
  if (wantStatus && !STATUS[wantStatus] && wantStatus !== "overdue") throw createError(400, "Unknown status filter");
  const needle = String(query.q || "").trim().toLowerCase();
  const partyKey = String(query.party_key || "").trim();
  const plantId = query.plant_id ? Number(query.plant_id) : null;
  const today = ymdOf(new Date());

  const dateWhere = (col) => {
    if (!from && !to) return {};
    const c = {};
    if (from) c[Op.gte] = from;
    if (to) c[Op.lte] = to;
    return { [col]: c };
  };

  const [pos, sos] = await Promise.all([
    type !== "so"
      ? PurchaseOrder.findAll({ where: { is_deleted: false, ...(plantId ? { plant_id: plantId } : {}), ...dateWhere("po_date") }, order: [["po_date", "ASC"], ["id", "ASC"]] })
      : [],
    type !== "po"
      ? SalesOrder.findAll({ where: { is_deleted: false, ...(plantId ? { plant_id: plantId } : {}), ...dateWhere("order_date") }, order: [["order_date", "ASC"], ["id", "ASC"]] })
      : [],
  ]);

  const poIds = pos.map((p) => Number(p.id));
  const soIds = sos.map((s) => Number(s.id));

  // ---- purchase side: receipts per PO, trucks, dates ----
  const purchases = poIds.length
    ? await Purchase.findAll({
        where: { po_id: { [Op.in]: poIds }, is_deleted: false },
        attributes: ["id", "po_id", "purchase_date", "gate_entry_id"],
        include: [{ model: GateEntry, as: "gateEntry", attributes: ["id", "gate_status"], required: false }],
      })
    : [];
  const exitedPurchases = purchases.filter((p) => p.gateEntry && p.gateEntry.gate_status === "exited");
  const lots = exitedPurchases.length
    ? await Lot.findAll({
        where: { purchase_id: { [Op.in]: exitedPurchases.map((p) => Number(p.id)) }, is_deleted: false, unloading_status: "completed" },
        attributes: ["purchase_id", "material_id", "bag_size", "accepted_bags", "rejected_bags", "qty", "rejected_qty"],
      })
    : [];
  const poOfPurchase = new Map(exitedPurchases.map((p) => [Number(p.id), Number(p.po_id)]));
  const rebuilt = new Map(); // "po:material" -> Qtl
  lots.forEach((lot) => {
    const key = `${poOfPurchase.get(Number(lot.purchase_id))}:${Number(lot.material_id)}`;
    rebuilt.set(key, (rebuilt.get(key) || 0) + (lotCounts(lot).total.qtl || 0));
  });

  // ---- sales side: loadings per SO ----
  const loadings = soIds.length
    ? await Loading.findAll({ where: { so_id: { [Op.in]: soIds }, is_deleted: false }, attributes: ["id", "so_id", "gate_entry_id", "loaded_at", "loaded_qty"] })
    : [];

  // ---- trucks currently inside the mill, per order ----
  const [poLinks, soLinks] = await Promise.all([
    poIds.length ? GateEntryPurchaseOrder.findAll({ where: { po_id: { [Op.in]: poIds }, is_deleted: false }, attributes: ["po_id", "gate_entry_id"] }) : [],
    soIds.length ? GateEntrySalesOrder.findAll({ where: { so_id: { [Op.in]: soIds }, is_deleted: false }, attributes: ["so_id", "gate_entry_id"] }) : [],
  ]);
  const linkedGateIds = [...new Set([...poLinks, ...soLinks].map((l) => Number(l.gate_entry_id)))];
  const gates = linkedGateIds.length
    ? await GateEntry.findAll({ where: { id: { [Op.in]: linkedGateIds }, is_deleted: false }, attributes: ["id", "gate_status"] })
    : [];
  const inMill = new Set(gates.filter((g) => !["exited", "cancelled"].includes(g.gate_status)).map((g) => Number(g.id)));
  const activeTrucks = (links, field, id) => new Set(links.filter((l) => Number(l[field]) === Number(id) && inMill.has(Number(l.gate_entry_id))).map((l) => Number(l.gate_entry_id))).size;

  // ---- names ----
  const materialIds = new Set();
  [...pos, ...sos].forEach((o) => orderLines(o).forEach((l) => l.material_id && materialIds.add(Number(l.material_id))));
  const vendorIds = [...new Set(pos.map((p) => Number(p.vendor_id)).filter(Boolean))];
  const customerIds = [...new Set(sos.map((s) => Number(s.customer_id)).filter(Boolean))];
  const [mats, vendors, customers] = await Promise.all([
    materialIds.size ? MaterialMaster.findAll({ where: { id: { [Op.in]: [...materialIds] } }, attributes: ["id", "name"] }) : [],
    vendorIds.length ? Vendor.findAll({ where: { id: { [Op.in]: vendorIds } }, attributes: ["id", "name"] }) : [],
    customerIds.length ? Customer.findAll({ where: { id: { [Op.in]: customerIds } }, attributes: ["id", "name"] }) : [],
  ]);
  const matName = new Map(mats.map((m) => [Number(m.id), m.name]));
  const vendorName = new Map(vendors.map((v) => [Number(v.id), v.name]));
  const customerName = new Map(customers.map((c) => [Number(c.id), c.name]));

  const finish = (base) => {
    const pending = Math.max(0, base.ordered_qty - base.done_qty);
    return {
      ...base,
      ordered_qty: r3(base.ordered_qty),
      done_qty: r3(base.done_qty),
      pending_qty: r3(pending),
      progress_pct: base.ordered_qty > 0 ? Math.min(100, Math.round((base.done_qty / base.ordered_qty) * 100)) : 0,
      status_label: STATUS[base.status].label,
      overdue: !!(base.validity && base.validity < today && !["completed", "cancelled", "rejected"].includes(base.status)),
    };
  };

  const orders = [];

  // ---- Purchase Orders ----
  for (const po of pos) {
    const lines = orderLines(po).filter((l) => Number(l.qty) > 0 || l.material_id);
    const lineRows = lines.map((l) => {
      const ordered = Number(l.qty) || 0;
      const done = l.received_qty != null ? Number(l.received_qty) || 0 : rebuilt.get(`${Number(po.id)}:${Number(l.material_id)}`) || 0;
      return { material: matName.get(Number(l.material_id)) || (l.material_id ? `Material ${l.material_id}` : "—"), ordered: r3(ordered), done: r3(done), pending: r3(Math.max(0, ordered - done)) };
    });
    const ordered = lineRows.reduce((s, l) => s + l.ordered, 0);
    const done = lineRows.reduce((s, l) => s + l.done, 0);
    const myPurchases = exitedPurchases.filter((p) => Number(p.po_id) === Number(po.id));
    const trucksActive = activeTrucks(poLinks, "po_id", po.id);
    const completed = lineRows.length > 0 && lines.every((l, i) => lineRows[i].done + TOL >= lineRows[i].ordered && lineRows[i].ordered > 0);
    let status;
    if (po.approval_status === "cancelled") status = "cancelled";
    else if (po.approval_status === "rejected") status = "rejected";
    else if (po.approval_status === "pending_approval") status = "pending_approval";
    else if (completed) status = "completed";
    else if (done > 0 || trucksActive > 0) status = "in_progress";
    else status = "not_started";
    const { first, last } = minMax(myPurchases.map((p) => ymdOf(p.purchase_date)));
    orders.push(finish({
      kind: "po", id: Number(po.id), order_no: po.po_no, party_key: `v:${po.vendor_id}`, party_id: Number(po.vendor_id),
      party_name: vendorName.get(Number(po.vendor_id)) || `Vendor ${po.vendor_id}`, party_kind: "vendor",
      order_date: ymdOf(po.po_date), validity: ymdOf(po.validity), status, materials: [...new Set(lineRows.map((l) => l.material))],
      ordered_qty: ordered, done_qty: done, lines: lineRows, trucks_done: myPurchases.length, trucks_active: trucksActive,
      first_date: first, last_date: last,
    }));
  }

  // ---- Sales Orders ----
  for (const so of sos) {
    const lines = orderLines(so).filter((l) => Number(l.qty) > 0 || l.material_id);
    const lineRows = lines.map((l) => {
      const ordered = Number(l.qty) || 0;
      const done = Number(l.dispatched_qty) || 0;
      return { material: matName.get(Number(l.material_id)) || (l.material_id ? `Material ${l.material_id}` : "—"), ordered: r3(ordered), done: r3(done), pending: r3(Math.max(0, ordered - done)) };
    });
    const ordered = lineRows.reduce((s, l) => s + l.ordered, 0);
    let done = lineRows.reduce((s, l) => s + l.done, 0);
    if (!done && Number(so.dispatched_qty) > 0) done = Number(so.dispatched_qty);
    const myLoads = loadings.filter((l) => Number(l.so_id) === Number(so.id));
    const trucksActive = activeTrucks(soLinks, "so_id", so.id);
    const allLoaded = lineRows.length > 0 && lineRows.every((l) => l.ordered > 0 && l.done + TOL >= l.ordered);
    let status;
    if (so.so_status === "cancelled") status = "cancelled";
    else if (so.approval_status === "rejected") status = "rejected";
    else if (so.approval_status === "pending_approval") status = "pending_approval";
    else if (["dispatched", "closed"].includes(so.so_status) || allLoaded) status = "completed";
    else if (done > 0 || trucksActive > 0) status = "in_progress";
    else status = "not_started";
    const { first, last } = minMax(myLoads.map((l) => ymdOf(l.loaded_at)));
    orders.push(finish({
      kind: "so", id: Number(so.id), order_no: so.so_no, party_key: `c:${so.customer_id}`, party_id: Number(so.customer_id),
      party_name: customerName.get(Number(so.customer_id)) || `Customer ${so.customer_id}`, party_kind: "customer",
      order_date: ymdOf(so.order_date), validity: null, status, materials: [...new Set(lineRows.map((l) => l.material))],
      ordered_qty: ordered, done_qty: done, lines: lineRows, trucks_done: new Set(myLoads.map((l) => Number(l.gate_entry_id))).size,
      trucks_active: trucksActive, first_date: first, last_date: last,
    }));
  }

  // ---- filters (applied to orders, then parties are rebuilt from what is left) ----
  let kept = orders;
  if (partyKey) kept = kept.filter((o) => o.party_key === partyKey);
  if (needle) kept = kept.filter((o) => String(o.party_name).toLowerCase().includes(needle) || String(o.order_no).toLowerCase().includes(needle));
  if (wantStatus === "overdue") kept = kept.filter((o) => o.overdue);
  else if (wantStatus) kept = kept.filter((o) => o.status === wantStatus);

  // ---- group by party ----
  const byParty = new Map();
  kept.forEach((o) => (byParty.get(o.party_key) || byParty.set(o.party_key, []).get(o.party_key)).push(o));

  const aggregate = (list) => {
    const counts = { total: list.length, completed: 0, in_progress: 0, not_started: 0, pending_approval: 0, rejected: 0, cancelled: 0, overdue: 0 };
    list.forEach((o) => { counts[o.status] += 1; if (o.overdue) counts.overdue += 1; });
    const counted = list.filter((o) => COUNTED.includes(o.status));
    const ordered = counted.reduce((s, o) => s + o.ordered_qty, 0);
    const done = counted.reduce((s, o) => s + o.done_qty, 0);
    const pending = list.filter((o) => OPEN.includes(o.status)).reduce((s, o) => s + o.pending_qty, 0);
    const doneDays = list.filter((o) => o.status === "completed" && o.last_date && o.order_date).map((o) => Math.max(0, daysBetween(o.order_date, o.last_date)));
    const orderDates = list.map((o) => o.order_date).filter(Boolean).sort();
    const activity = list.map((o) => o.last_date).filter(Boolean).sort();
    return {
      counts,
      ordered_qty: r3(ordered),
      done_qty: r3(done),
      pending_qty: r3(pending),
      completion_pct: ordered > 0 ? Math.min(100, Math.round((done / ordered) * 100)) : 0,
      first_order_date: orderDates[0] || null,
      last_order_date: orderDates[orderDates.length - 1] || null,
      last_activity_date: activity[activity.length - 1] || null,
      avg_days_to_complete: doneDays.length ? Math.round((doneDays.reduce((s, d) => s + d, 0) / doneDays.length) * 10) / 10 : null,
      trucks_done: list.reduce((s, o) => s + o.trucks_done, 0),
      trucks_active: list.reduce((s, o) => s + o.trucks_active, 0),
      materials: [...new Set(list.flatMap((o) => o.materials))],
    };
  };

  const parties = [...byParty.entries()]
    .map(([key, list]) => ({
      party_key: key,
      party_id: list[0].party_id,
      party_name: list[0].party_name,
      party_kind: list[0].party_kind,
      ...aggregate(list),
      // newest order first inside a party: it reads as the party's order history
      orders: [...list].sort((a, b) => String(b.order_date).localeCompare(String(a.order_date)) || b.id - a.id),
    }))
    .sort((a, b) => a.party_name.localeCompare(b.party_name));

  return {
    generated_at: new Date(),
    filters: { type, from, to, status: wantStatus || null, q: needle || null, party_key: partyKey || null, plant_id: plantId },
    summary: { parties: parties.length, ...aggregate(kept) },
    parties,
  };
};

// ---------------------------------------------------------------------------
// PDF layout (rendered by reportPdf.helper.renderTableReport)
// ---------------------------------------------------------------------------
const KIND_LABEL = { vendor: "Vendor", customer: "Customer" };
const filterLines = (f) => {
  const typeText = f.type === "po" ? "Purchase Orders (vendors)" : f.type === "so" ? "Sales Orders (customers)" : "Purchase and Sales Orders";
  return [
    `Order date: ${f.from ? dmy(f.from) : "All dates"} to ${f.to ? dmy(f.to) : "Today"}   |   ${typeText}`,
    `Status: ${f.status ? (STATUS[f.status] ? STATUS[f.status].label : "Past validity") : "All"}${f.q ? `   |   Search: "${f.q}"` : ""}`,
  ];
};
const statusCell = (o) => ({ t: o.status_label + (o.overdue ? " (past validity)" : ""), bold: true, color: STATUS[o.status].color });

const buildPartyOrdersPdfSpec = (data) => {
  const { summary: s, parties, filters } = data;
  const c = s.counts;
  const plusMinus = (n) => (n == null ? "—" : String(n));

  const partyRows = parties.map((p) => ({
    cells: (n) => [
      n, { t: p.party_name, bold: true }, KIND_LABEL[p.party_kind], fmtCount(p.counts.total),
      { t: fmtCount(p.counts.completed), color: "#166534", bold: !!p.counts.completed },
      { t: fmtCount(p.counts.in_progress), color: "#1D4ED8", bold: !!p.counts.in_progress },
      fmtCount(p.counts.not_started),
      fmtQty(p.ordered_qty), fmtQty(p.done_qty), { t: fmtQty(p.pending_qty), bold: true },
      `${p.completion_pct}%`, dmy(p.first_order_date), dmy(p.last_order_date), dmy(p.last_activity_date),
      plusMinus(p.avg_days_to_complete),
    ],
  }));

  const historyGroups = parties.map((p) => ({
    title: `${p.party_name.toUpperCase()}  -  ${KIND_LABEL[p.party_kind].toUpperCase()}`,
    meta: `${p.counts.total} order(s): ${p.counts.completed} completed, ${p.counts.in_progress} in progress, ${p.counts.not_started} not started${p.counts.pending_approval ? `, ${p.counts.pending_approval} awaiting approval` : ""}${p.counts.cancelled + p.counts.rejected ? `, ${p.counts.cancelled + p.counts.rejected} cancelled/rejected` : ""}`,
    accent: p.party_kind === "vendor" ? "#166534" : "#1D4ED8",
    rows: p.orders.map((o) => ({
      cells: (n) => [
        n, { t: o.order_no, bold: true }, o.kind === "po" ? "PO" : "SO", dmy(o.order_date), o.validity ? dmy(o.validity) : "—",
        o.materials.join(", ") || "—", statusCell(o), fmtQty(o.ordered_qty), fmtQty(o.done_qty), { t: fmtQty(o.pending_qty), bold: true },
        `${o.progress_pct}%`, `${o.trucks_done}${o.trucks_active ? ` (+${o.trucks_active} in mill)` : ""}`, dmy(o.first_date), dmy(o.last_date),
      ],
    })),
    subtotalCells: ["", `Total - ${p.party_name}`, "", "", "", "", "", fmtQty(p.ordered_qty), fmtQty(p.done_qty), fmtQty(p.pending_qty), `${p.completion_pct}%`, "", "", ""],
  }));

  return {
    filename: `party-order-summary${filters.from ? `-${filters.from}` : ""}${filters.to ? `_to_${filters.to}` : ""}.pdf`,
    title: "PARTY-WISE ORDER SUMMARY",
    subtitleLines: filterLines(filters),
    kpis: [
      { label: "Parties", value: fmtCount(s.parties) },
      { label: "Orders", value: fmtCount(c.total) },
      { label: "Completed", value: fmtCount(c.completed), color: "#166534" },
      { label: "In progress", value: fmtCount(c.in_progress), color: "#1D4ED8" },
      { label: "Not started", value: fmtCount(c.not_started) },
      { label: "Ordered (Qtl)", value: fmtQty(s.ordered_qty) },
      { label: "Received / loaded (Qtl)", value: fmtQty(s.done_qty), color: "#166534" },
      { label: "Pending (Qtl)", value: fmtQty(s.pending_qty), color: "#9A3412" },
    ],
    columns: [
      { label: "S.No", w: 26, align: "center" },
      { label: "Party", w: 150, align: "left" },
      { label: "Type", w: 50, align: "left" },
      { label: "Orders", w: 38, align: "right" },
      { label: "Completed", w: 48, align: "right" },
      { label: "In progress", w: 48, align: "right" },
      { label: "Not started", w: 46, align: "right" },
      { label: "Ordered (Qtl)", w: 62, align: "right" },
      { label: "Received / Loaded (Qtl)", w: 72, align: "right" },
      { label: "Pending (Qtl)", w: 62, align: "right" },
      { label: "Done %", w: 40, align: "right" },
      { label: "First order", w: 56, align: "center" },
      { label: "Last order", w: 56, align: "center" },
      { label: "Last activity", w: 58, align: "center" },
      { label: "Avg days to complete", w: 54, align: "right" },
    ],
    groups: parties.length ? [{ title: `PARTIES  -  ${parties.length}`, accent: COLORS.NAVY, rows: partyRows }] : [],
    totalsRow: parties.length > 1
      ? ["", "ALL PARTIES", "", fmtCount(c.total), fmtCount(c.completed), fmtCount(c.in_progress), fmtCount(c.not_started), fmtQty(s.ordered_qty), fmtQty(s.done_qty), fmtQty(s.pending_qty), `${s.completion_pct}%`, "", "", "", ""]
      : null,
    emptyText: "No orders found for the selected filters.",
    sections: parties.length
      ? [{
          title: "ORDER HISTORY BY PARTY",
          subtitleLines: filterLines(filters),
          columns: [
            { label: "S.No", w: 26, align: "center" },
            { label: "Order No", w: 84, align: "left" },
            { label: "Type", w: 28, align: "center" },
            { label: "Order date", w: 56, align: "center" },
            { label: "Validity", w: 56, align: "center" },
            { label: "Materials", w: 124, align: "left" },
            { label: "Status", w: 82, align: "left" },
            { label: "Ordered (Qtl)", w: 62, align: "right" },
            { label: "Received / Loaded (Qtl)", w: 72, align: "right" },
            { label: "Pending (Qtl)", w: 62, align: "right" },
            { label: "Done %", w: 38, align: "right" },
            { label: "Trucks", w: 62, align: "center" },
            { label: "First receipt / loading", w: 58, align: "center" },
            { label: "Last receipt / loading", w: 58, align: "center" },
          ],
          groups: historyGroups,
          emptyText: "No orders.",
        }]
      : [],
    footnotes: [
      "Quantities are in Qtl. Ordered / Received-Loaded count approved, non-cancelled orders; Pending is what is still left on orders that are in progress or not started. Orders awaiting approval, rejected or cancelled are listed but not counted in the quantities.",
      "Completed = every line received (PO) or loaded (SO) in full. In progress = something received/loaded, or a truck for the order is inside the mill. Trucks = completed trips (+ trucks currently in the mill). Avg days to complete = order date to last receipt / loading, for completed orders.",
    ],
  };
};

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
const orderCsvRows = (data) =>
  data.parties.flatMap((p) =>
    p.orders.map((o) => ({
      party: p.party_name,
      party_type: KIND_LABEL[p.party_kind],
      order_type: o.kind === "po" ? "Purchase Order" : "Sales Order",
      order_no: o.order_no,
      order_date: o.order_date || "",
      validity: o.validity || "",
      status: o.status_label,
      past_validity: o.overdue ? "Yes" : "",
      materials: o.materials.join("; "),
      ordered_qty: o.ordered_qty,
      done_qty: o.done_qty,
      pending_qty: o.pending_qty,
      progress_pct: o.progress_pct,
      trucks_done: o.trucks_done,
      trucks_in_mill: o.trucks_active,
      first_date: o.first_date || "",
      last_date: o.last_date || "",
    }))
  );
const ORDER_CSV_COLUMNS = [
  { key: "party", label: "Party" }, { key: "party_type", label: "Party Type" }, { key: "order_type", label: "Order Type" },
  { key: "order_no", label: "Order No" }, { key: "order_date", label: "Order Date" }, { key: "validity", label: "Validity" },
  { key: "status", label: "Status" }, { key: "past_validity", label: "Past Validity" }, { key: "materials", label: "Materials" },
  { key: "ordered_qty", label: "Ordered Qty (Qtl)" }, { key: "done_qty", label: "Received / Loaded Qty (Qtl)" },
  { key: "pending_qty", label: "Pending Qty (Qtl)" }, { key: "progress_pct", label: "Progress %" },
  { key: "trucks_done", label: "Trucks Completed" }, { key: "trucks_in_mill", label: "Trucks In Mill" },
  { key: "first_date", label: "First Receipt / Loading Date" }, { key: "last_date", label: "Last Receipt / Loading Date" },
];

const partyCsvRows = (data) =>
  data.parties.map((p) => ({
    party: p.party_name, party_type: KIND_LABEL[p.party_kind], orders: p.counts.total, completed: p.counts.completed,
    in_progress: p.counts.in_progress, not_started: p.counts.not_started, pending_approval: p.counts.pending_approval,
    rejected: p.counts.rejected, cancelled: p.counts.cancelled, past_validity: p.counts.overdue,
    ordered_qty: p.ordered_qty, done_qty: p.done_qty, pending_qty: p.pending_qty, completion_pct: p.completion_pct,
    first_order: p.first_order_date || "", last_order: p.last_order_date || "", last_activity: p.last_activity_date || "",
    avg_days: p.avg_days_to_complete ?? "", trucks_done: p.trucks_done, trucks_in_mill: p.trucks_active, materials: p.materials.join("; "),
  }));
const PARTY_CSV_COLUMNS = [
  { key: "party", label: "Party" }, { key: "party_type", label: "Party Type" }, { key: "orders", label: "Orders" },
  { key: "completed", label: "Completed" }, { key: "in_progress", label: "In Progress" }, { key: "not_started", label: "Not Started" },
  { key: "pending_approval", label: "Pending Approval" }, { key: "rejected", label: "Rejected" }, { key: "cancelled", label: "Cancelled" },
  { key: "past_validity", label: "Past Validity" }, { key: "ordered_qty", label: "Ordered Qty (Qtl)" },
  { key: "done_qty", label: "Received / Loaded Qty (Qtl)" }, { key: "pending_qty", label: "Pending Qty (Qtl)" },
  { key: "completion_pct", label: "Completion %" }, { key: "first_order", label: "First Order Date" },
  { key: "last_order", label: "Last Order Date" }, { key: "last_activity", label: "Last Receipt / Loading Date" },
  { key: "avg_days", label: "Avg Days To Complete" }, { key: "trucks_done", label: "Trucks Completed" },
  { key: "trucks_in_mill", label: "Trucks In Mill" }, { key: "materials", label: "Materials" },
];

module.exports = {
  buildPartyOrders, buildPartyOrdersPdfSpec,
  orderCsvRows, ORDER_CSV_COLUMNS, partyCsvRows, PARTY_CSV_COLUMNS,
};
