const { Op } = require("sequelize");
const createError = require("http-errors");
const {
  GateEntry, Vehicle, Vendor, Customer, PurchaseOrder, SalesOrder,
  GateEntryPurchaseOrder, GateEntrySalesOrder, GateEntryMiscItem, MaterialMaster,
  Purchase, Lot, WeightSlip, Loading, PaymentSettlement,
} = require("../models/index");
const { gpNoFor, parseGpNo } = require("./gpNumber.helper");

// Auto-fetch for Payment Settlement Advice. A settlement is made AGAINST A
// TRUCK'S GATE PASS (GP No.): pick the truck — by GP No., SO No., PO No.,
// vehicle, token or party — and this builds the form's AUTO FETCH fields from
// what the system already knows:
//
//   party / lorry / date / GST ........ gate entry + the party's master record
//   load & empty weight ............... weighbridge slip (kg)
//   item rows ......................... Sales: Loading records  |  Purchase: unloaded
//                                       Lots  |  Empty/Misc: the logged misc items
//   rate .............................. the order line (Sales) / final purchase rate
//   SAUDA / INWARD DETAILS / PENDING .. the order, plus every truck loaded or
//                                       received against it so far
//
// Anything the system doesn't hold (invoice no., broker, TDS, quality
// difference, balance freight ...) is simply left blank for manual entry.
// Read-only: nothing is ever written to the database here.

const pad2 = (n) => String(n).padStart(2, "0");
const toNum = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const trim3 = (n) => String(Number(Number(n).toFixed(3)));

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

// DATEONLY strings pass straight through; Date objects use local date parts.
const ymd = (v) => {
  if (!v) return "";
  if (typeof v === "string") {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

// An order's material lines. Older orders keep a single material directly on
// the row instead of in `items`.
const orderLines = (order) => {
  if (!order) return [];
  const items = asArray(order.items);
  if (items.length) return items;
  return order.material_id
    ? [{ material_id: order.material_id, qty: order.qty, rate: order.rate, dispatched_qty: order.dispatched_qty }]
    : [];
};
const orderTotalQty = (order) => orderLines(order).reduce((s, l) => s + (toNum(l.qty) || 0), 0);

// Quantities on orders / loading are in Qtl (1 Qtl = 100 kg, helpers/units.js).
// The Sauda / Pending Sauda text on the advice therefore reads e.g. "600Qtl".
const { KG_PER_QTL: KG_PER_ORDER_QTL } = require("./units");
const qtlLabel = (qty) => `${trim3(qty)}Qtl`;

// ---------------------------------------------------------------- search ---

const SETTLEABLE_TYPES = ["purchase", "sales", "other"];

// Candidate trucks (exited ones only — that's when a GP exists) matching text
// typed as a GP No., SO No., PO No., vehicle, token or party name.
//
// A truck is HIDDEN once it has been settled AND that settlement's PDF has
// been opened / downloaded (pdf_generated_at is set). A truck that has only
// been saved — no PDF yet — still shows, flagged "Settled #n", so the advice
// can't be forgotten half-way. `includeSettled` brings the hidden ones back
// (e.g. to issue a second settlement for the same GP).
const searchSources = async (rawQuery, { includeSettled = false } = {}) => {
  const q = String(rawQuery || "").trim().slice(0, 60);
  const base = { is_deleted: false, gate_status: "exited", entry_type: { [Op.in]: SETTLEABLE_TYPES } };
  let where = base;

  if (q) {
    const like = { [Op.like]: `%${q}%` };
    const gp = parseGpNo(q);
    if (gp) {
      where = { ...base, id: gp.id, entry_type: gp.entry_type };
    } else {
      const ids = new Set();
      const add = (rows, key = "id") => rows.forEach((r) => r[key] && ids.add(Number(r[key])));
      const pick = (extra) => GateEntry.findAll({ where: { ...base, ...extra }, attributes: ["id"], limit: 200 });

      if (/^\d+$/.test(q)) ids.add(Number(q));
      add(await pick({ token_no: like }));

      const vehicles = await Vehicle.findAll({ where: { vehicle_no: like }, attributes: ["id"], limit: 100 });
      if (vehicles.length) add(await pick({ vehicle_id: { [Op.in]: vehicles.map((v) => v.id) } }));

      const vendors = await Vendor.findAll({ where: { name: like, is_deleted: false }, attributes: ["id"], limit: 100 });
      if (vendors.length) add(await pick({ vendor_id: { [Op.in]: vendors.map((v) => v.id) } }));
      const customers = await Customer.findAll({ where: { name: like, is_deleted: false }, attributes: ["id"], limit: 100 });
      if (customers.length) add(await pick({ customer_id: { [Op.in]: customers.map((c) => c.id) } }));

      // SO No. -> every truck loaded / linked against that order
      const sos = await SalesOrder.findAll({ where: { so_no: like, is_deleted: false }, attributes: ["id"], limit: 100 });
      if (sos.length) {
        const soIds = sos.map((s) => s.id);
        add(await pick({ so_id: { [Op.in]: soIds } }));
        add(await GateEntrySalesOrder.findAll({ where: { so_id: { [Op.in]: soIds }, is_deleted: false }, attributes: ["gate_entry_id"] }), "gate_entry_id");
        add(await Loading.findAll({ where: { so_id: { [Op.in]: soIds }, is_deleted: false }, attributes: ["gate_entry_id"] }), "gate_entry_id");
      }
      // PO No. -> every truck received against that order
      const pos = await PurchaseOrder.findAll({ where: { po_no: like, is_deleted: false }, attributes: ["id"], limit: 100 });
      if (pos.length) {
        const poIds = pos.map((p) => p.id);
        add(await pick({ po_id: { [Op.in]: poIds } }));
        add(await GateEntryPurchaseOrder.findAll({ where: { po_id: { [Op.in]: poIds }, is_deleted: false }, attributes: ["gate_entry_id"] }), "gate_entry_id");
        add(await Purchase.findAll({ where: { po_id: { [Op.in]: poIds }, is_deleted: false }, attributes: ["gate_entry_id"] }), "gate_entry_id");
      }
      where = { ...base, id: { [Op.in]: ids.size ? [...ids] : [0] } };
    }
  }

  if (!includeSettled) {
    const done = await PaymentSettlement.findAll({
      where: { is_deleted: false, gate_entry_id: { [Op.ne]: null }, pdf_generated_at: { [Op.ne]: null } },
      attributes: ["gate_entry_id"],
    });
    const hiddenIds = [...new Set(done.map((r) => Number(r.gate_entry_id)))];
    if (hiddenIds.length) where = { [Op.and]: [where, { id: { [Op.notIn]: hiddenIds } }] };
  }

  const entries = await GateEntry.findAll({
    where,
    include: [
      { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
      { model: Vendor, as: "vendor", attributes: ["id", "name"] },
      { model: Customer, as: "customer", attributes: ["id", "name"] },
      { model: PurchaseOrder, as: "purchaseOrder", attributes: ["id", "po_no"], required: false },
      { model: SalesOrder, as: "salesOrder", attributes: ["id", "so_no"], required: false },
    ],
    order: [["exit_time", "DESC"], ["id", "DESC"]],
    limit: 25,
  });
  if (!entries.length) return [];

  const entryIds = entries.map((e) => e.id);
  const [soLinks, poLinks, settled] = await Promise.all([
    GateEntrySalesOrder.findAll({
      where: { gate_entry_id: { [Op.in]: entryIds }, is_deleted: false },
      include: [{ model: SalesOrder, as: "sales_order", attributes: ["so_no"] }],
    }),
    GateEntryPurchaseOrder.findAll({
      where: { gate_entry_id: { [Op.in]: entryIds }, is_deleted: false },
      include: [{ model: PurchaseOrder, as: "purchaseOrder", attributes: ["po_no"] }],
    }),
    PaymentSettlement.findAll({ where: { gate_entry_id: { [Op.in]: entryIds }, is_deleted: false }, attributes: ["id", "gate_entry_id"] }),
  ]);
  const ordersByEntry = {};
  const addOrder = (entryId, no) => {
    if (!no) return;
    (ordersByEntry[entryId] = ordersByEntry[entryId] || new Set()).add(no);
  };
  entries.forEach((e) => {
    addOrder(e.id, e.salesOrder?.so_no);
    addOrder(e.id, e.purchaseOrder?.po_no);
  });
  soLinks.forEach((l) => addOrder(l.gate_entry_id, l.sales_order?.so_no));
  poLinks.forEach((l) => addOrder(l.gate_entry_id, l.purchaseOrder?.po_no));
  const settledByEntry = {};
  settled.forEach((s) => (settledByEntry[s.gate_entry_id] = s.id));

  return entries.map((e) => ({
    gate_entry_id: e.id,
    gp_no: gpNoFor(e.entry_type, e.id),
    entry_type: e.entry_type,
    token_no: e.token_no,
    vehicle_no: e.vehicle?.vehicle_no || "",
    party_name: e.vendor?.name || e.customer?.name || "",
    order_no: [...(ordersByEntry[e.id] || [])].join(", "),
    exit_time: e.exit_time,
    settlement_id: settledByEntry[e.id] || null,
  }));
};

// ---------------------------------------------------------------- source ---

const weightsFor = async (gateEntryId) => {
  const slips = await WeightSlip.findAll({ where: { gate_entry_id: gateEntryId, is_deleted: false }, order: [["id", "DESC"]] });
  const both = slips.find((s) => toNum(s.gross_weight) !== null && toNum(s.tare_weight) !== null);
  const any = both || slips[0];
  return {
    load: any && toNum(any.gross_weight) !== null ? Number(any.gross_weight) : null,
    empty: any && toNum(any.tare_weight) !== null ? Number(any.tare_weight) : null,
  };
};

const blankReturnRow = () => ({ item_name: "Return", bags: "", weight: "", rate: "", is_return: true });

// Sales: one row per material loaded onto the truck, rate from that material's
// line on its Sales Order.
const salesRows = async (entry, netKnown, notices) => {
  const loadings = await Loading.findAll({ where: { gate_entry_id: entry.id, is_deleted: false }, order: [["id", "ASC"]] });
  const lineItems = loadings.flatMap((l) => asArray(l.items).map((it) => ({ ...it, so_id: it.so_id || l.so_id })));
  if (!lineItems.length) return { rows: [], loadings };

  const materialIds = [...new Set(lineItems.map((i) => i.material_id).filter(Boolean))];
  const soIds = [...new Set(lineItems.map((i) => i.so_id).filter(Boolean))];
  const [materials, sos] = await Promise.all([
    MaterialMaster.findAll({ where: { id: { [Op.in]: materialIds } }, attributes: ["id", "name"] }),
    SalesOrder.findAll({ where: { id: { [Op.in]: soIds } } }),
  ]);
  const nameById = Object.fromEntries(materials.map((m) => [m.id, m.name]));
  const soById = Object.fromEntries(sos.map((s) => [s.id, s]));

  const groups = new Map();
  lineItems.forEach((it) => {
    const key = `${it.so_id}:${it.material_id}`;
    const g = groups.get(key) || { so_id: it.so_id, material_id: it.material_id, bags: 0, kg: 0 };
    const bags = toNum(it.bags) || 0;
    const bagSize = toNum(it.bag_size);
    g.bags += bags;
    g.kg += bagSize !== null && bags ? bags * bagSize : (toNum(it.qty) || 0) * KG_PER_ORDER_QTL;
    groups.set(key, g);
  });

  const single = groups.size === 1 && netKnown;
  const orderNos = new Set();
  const rows = [...groups.values()].map((g) => {
    const so = soById[g.so_id];
    if (so) orderNos.add(so.so_no);
    const line = orderLines(so).find((l) => Number(l.material_id) === Number(g.material_id));
    return {
      item_name: nameById[g.material_id] || `Material ${g.material_id}`,
      bags: g.bags || "",
      weight: single ? "" : Number(g.kg.toFixed(3)),
      rate: line && toNum(line.rate) !== null ? Number(line.rate) : "",
      is_return: false,
    };
  });
  if (orderNos.size) notices.push(`Rate copied from ${[...orderNos].join(", ")} exactly as entered on the order (Rs per kg).`);
  if (!single && rows.length > 1) notices.push("This truck carried several items, so each row's weight is bags x bag size. Adjust if needed.");
  return { rows, loadings, soById };
};

const salesSauda = async (entry, loadings, soById) => {
  // The order this settlement is about: the first one loaded onto the truck.
  const primarySoId = loadings[0]?.so_id || entry.so_id;
  if (!primarySoId) return {};
  const so = (soById && soById[primarySoId]) || (await SalesOrder.findByPk(primarySoId));
  if (!so) return {};

  const total = orderTotalQty(so);
  const myLastLoadingId = Math.max(...loadings.map((l) => Number(l.id)));
  const allLoads = await Loading.findAll({
    where: { so_id: so.id, is_deleted: false, id: { [Op.lte]: myLastLoadingId } },
    order: [["loaded_at", "ASC"], ["id", "ASC"]],
  });
  // Quantity of THIS order in each load (a load may carry several orders).
  const qtyForSo = (l) => {
    const items = asArray(l.items);
    const mine = items.filter((i) => Number(i.so_id) === Number(so.id));
    return mine.length ? mine.reduce((s, i) => s + (toNum(i.qty) || 0), 0) : toNum(l.loaded_qty) || 0;
  };
  const inward = allLoads.map((l) => ({
    date: ymd(l.loaded_at),
    weight: Math.round(qtyForSo(l) * KG_PER_ORDER_QTL),
    gp_no: gpNoFor("sales", l.gate_entry_id), // the vehicle that made this load
  }));
  const loaded = allLoads.reduce((s, l) => s + qtyForSo(l), 0);
  const pending = total - loaded;

  return {
    order_no: so.so_no,
    sauda_date: ymd(so.order_date),
    sauda: total ? qtlLabel(total) : "",
    inward_details: inward,
    // Only shown when the order is only PARTLY loaded, as on the Excel.
    pending_sauda: total && pending > 0.0005 ? qtlLabel(pending) : "",
  };
};

// Purchase: one row per unloaded material (accepted bags), at the final
// (negotiated) rate of its purchase.
const purchaseRows = async (entry, netKnown, notices) => {
  const purchases = await Purchase.findAll({ where: { gate_entry_id: entry.id, is_deleted: false }, order: [["id", "ASC"]] });
  if (!purchases.length) return { rows: [], purchases };
  const purchaseById = Object.fromEntries(purchases.map((p) => [p.id, p]));

  const lots = await Lot.findAll({
    where: { purchase_id: { [Op.in]: purchases.map((p) => p.id) }, is_deleted: false },
    include: [{ model: MaterialMaster, as: "material", attributes: ["id", "name"] }],
    order: [["id", "ASC"]],
  });

  let rows;
  let rejectedBags = 0;
  if (lots.length) {
    const groups = new Map();
    lots.forEach((lot) => {
      const key = `${lot.purchase_id}:${lot.material_id}`;
      const g = groups.get(key) || { purchase_id: lot.purchase_id, name: lot.material?.name || `Material ${lot.material_id}`, bags: 0, kg: 0, haveBags: false };
      const accepted = toNum(lot.accepted_bags);
      if (accepted !== null) {
        g.haveBags = true;
        g.bags += accepted;
        g.kg += accepted * (toNum(lot.bag_size) || 0);
      }
      rejectedBags += toNum(lot.rejected_bags) || 0;
      groups.set(key, g);
    });
    const single = groups.size === 1 && netKnown;
    rows = [...groups.values()].map((g) => ({
      item_name: g.name,
      bags: g.haveBags ? g.bags : "",
      weight: single ? "" : g.kg ? Number(g.kg.toFixed(3)) : "",
      rate: toNum(purchaseById[g.purchase_id]?.final_rate) ?? "",
      is_return: false,
    }));
    if (!single && rows.length > 1) notices.push("This truck carried several items, so each row's weight is accepted bags x bag size. Adjust if needed.");
  } else {
    rows = [{ item_name: entry.material?.name || "Material", bags: "", weight: "", rate: toNum(purchases[0].final_rate) ?? "", is_return: false }];
  }
  notices.push("Rate is the final purchase rate recorded at the weighbridge (Rs per kg).");
  if (rejectedBags > 0) notices.push(`${rejectedBags} bag(s) were rejected at unloading. They are not deducted automatically - add a Return row if they should be.`);
  return { rows, purchases };
};

const purchaseSauda = async (entry, purchases) => {
  const primaryPoId = purchases[0]?.po_id || entry.po_id;
  if (!primaryPoId) return {};
  const po = await PurchaseOrder.findByPk(primaryPoId);
  if (!po) return {};

  const total = orderTotalQty(po);
  const myLastPurchaseId = Math.max(...purchases.map((p) => Number(p.id)));
  const allReceipts = await Purchase.findAll({
    where: { po_id: po.id, is_deleted: false, id: { [Op.lte]: myLastPurchaseId } },
    order: [["purchase_date", "ASC"], ["id", "ASC"]],
  });
  // Purchase.final_qty is the weighbridge net weight in kg.
  const inward = allReceipts.map((p) => ({
    date: ymd(p.purchase_date),
    weight: Math.round(Number(p.final_qty) || 0),
    gp_no: gpNoFor("purchase", p.gate_entry_id), // the vehicle that made this delivery
  }));
  const receivedQtl = allReceipts.reduce((s, p) => s + (Number(p.final_qty) || 0), 0) / KG_PER_ORDER_QTL;
  const pending = total - receivedQtl;

  return {
    order_no: po.po_no,
    sauda_date: ymd(po.po_date),
    sauda: total ? qtlLabel(total) : "",
    inward_details: inward,
    pending_sauda: total && pending > 0.0005 ? qtlLabel(pending) : "",
  };
};

// Empty / Misc: the logged items; rate, weight and amounts are for the user.
const miscRows = (entry, notices) => {
  const items = (entry.misc_items || []).map((m) => m.get({ plain: true }));
  const rows = items.length
    ? items.map((m, i) => ({
        item_name: m.item_name,
        bags: "",
        weight: items.length > 1 ? 0 : "",
        rate: "",
        is_return: false,
      }))
    : [{ item_name: entry.material?.name || "Item", bags: "", weight: "", rate: "", is_return: false }];
  notices.push("Empty/Misc truck: enter the weight and rate of each item - the system does not hold a price for these.");
  return rows;
};

const buildSource = async (gateEntryId) => {
  const entry = await GateEntry.findOne({
    where: { id: gateEntryId, is_deleted: false },
    include: [
      { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
      { model: Vendor, as: "vendor", attributes: ["id", "name", "gstin"] },
      { model: Customer, as: "customer", attributes: ["id", "name", "gstin"] },
      { model: MaterialMaster, as: "material", attributes: ["id", "name"], required: false },
      { model: GateEntryMiscItem, as: "misc_items", required: false, where: { is_deleted: false } },
    ],
  });
  if (!entry) throw createError(404, "Gate entry not found");
  if (entry.gate_status !== "exited" || !SETTLEABLE_TYPES.includes(entry.entry_type)) {
    throw createError(400, "A settlement can only be made against a truck that has checked out (it needs a Gate Pass)");
  }

  const notices = [];
  const { load, empty } = await weightsFor(entry.id);
  const netKnown = load !== null && empty !== null && load > empty;
  if (!netKnown) notices.push("No weighbridge slip with both gross and tare weight was found - enter Load Weight and Empty Weight yourself.");

  let party = entry.vendor || entry.customer;
  let rows = [];
  let sauda = {};

  if (entry.entry_type === "sales") {
    const r = await salesRows(entry, netKnown, notices);
    rows = r.rows;
    if (r.loadings.length) sauda = await salesSauda(entry, r.loadings, r.soById);
    if (!party) {
      const so = r.soById && r.soById[r.loadings[0]?.so_id];
      if (so?.customer_id) party = await Customer.findByPk(so.customer_id, { attributes: ["id", "name", "gstin"] });
    }
    if (!rows.length) notices.push("No loading record was found for this truck, so the item rows are blank.");
  } else if (entry.entry_type === "purchase") {
    const r = await purchaseRows(entry, netKnown, notices);
    rows = r.rows;
    if (r.purchases.length) sauda = await purchaseSauda(entry, r.purchases);
    if (!party && sauda.order_no) {
      const po = await PurchaseOrder.findOne({ where: { po_no: sauda.order_no }, attributes: ["vendor_id"] });
      if (po?.vendor_id) party = await Vendor.findByPk(po.vendor_id, { attributes: ["id", "name", "gstin"] });
    }
    if (!r.purchases.length) {
      rows = [{ item_name: entry.material?.name || "Material", bags: "", weight: "", rate: "", is_return: false }];
      notices.push("No purchase / unloading record was found for this truck, so bags and rate are blank.");
    }
  } else {
    rows = miscRows(entry, notices);
  }

  if (sauda.pending_sauda) notices.push(`Partly loaded order: ${sauda.pending_sauda} of ${sauda.order_no} is still pending.`);

  const existing = await PaymentSettlement.findOne({ where: { gate_entry_id: entry.id, is_deleted: false }, attributes: ["id"] });

  return {
    gate_entry_id: entry.id,
    entry_type: entry.entry_type,
    order_no: sauda.order_no || "",
    existing_settlement_id: existing ? existing.id : null,
    notices,
    form: {
      gate_entry_id: entry.id,
      gp_no: gpNoFor(entry.entry_type, entry.id),
      settlement_date: ymd(entry.exit_time) || ymd(new Date()),
      party_name: party?.name || "",
      lorry_no: entry.vehicle?.vehicle_no || "",
      gst_number: party?.gstin || "",
      load_weight: load !== null ? load : "",
      empty_weight: empty !== null ? empty : "",
      items: [...rows, blankReturnRow()],
      sauda_date: sauda.sauda_date || "",
      sauda: sauda.sauda || "",
      inward_details: sauda.inward_details || [],
      pending_sauda: sauda.pending_sauda || "",
    },
  };
};

module.exports = { searchSources, buildSource };
