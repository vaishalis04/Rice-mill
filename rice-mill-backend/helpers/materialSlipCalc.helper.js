// All the arithmetic behind the Material Inward Slip / Material Outward Slip
// lives here, as plain functions with NO database access, so every figure on
// the PDFs can be checked (and unit-tested) in one place.
//
// Units (see helpers/units.js):
//   * bag size            -> kg per bag
//   * weighbridge weights -> kg  (gross / tare / net)
//   * quantities          -> Qtl (1 Qtl = 100 kg)
//
// Rules this file enforces:
//   1. A received quantity is ALWAYS bags x bag size. It is never read from
//      Lot.qty, because packing / production lower Lot.qty after unloading — a
//      slip re-printed later would otherwise show a smaller "received" figure.
//   2. Totals are summed in kg and converted to Qtl once at the end, so the
//      total can never drift from its rows through float rounding (no more
//      0.30000000000000004 on the paper).
//   3. The weighbridge column quirk is handled here: until the SECOND
//      weighment, WeightSlip.gross_weight holds the FIRST reading — the loaded
//      truck for a Purchase, but the EMPTY truck (tare) for a Sales truck.

const { KG_PER_QTL } = require("./units");

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const r3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
const kgToQtl = (kg) => r3((Number(kg) || 0) / KG_PER_QTL);

// A matched / excess / short call is only made beyond this many kg.
const MATCH_TOLERANCE_KG = 0.05;

// ---- bags x size -> { bags, kg, qtl } -----------------------------------
const bagBlock = (bagSizeKg, bags) => {
  const size = num(bagSizeKg);
  const n = num(bags);
  if (n === null) return { bags: null, kg: null, qtl: null };
  if (size === null || size <= 0) return { bags: n, kg: null, qtl: null };
  const kg = r2(size * n);
  return { bags: n, kg, qtl: kgToQtl(kg) };
};

// Adds blocks together (bags and kg), converting kg -> Qtl once at the end.
const addBlocks = (...blocks) => {
  const live = blocks.filter(Boolean);
  const anyBags = live.some((b) => b.bags !== null && b.bags !== undefined);
  const anyKg = live.some((b) => b.kg !== null && b.kg !== undefined);
  const bags = anyBags ? live.reduce((s, b) => s + (Number(b.bags) || 0), 0) : null;
  const kg = anyKg ? r2(live.reduce((s, b) => s + (Number(b.kg) || 0), 0)) : null;
  return { bags, kg, qtl: kg === null ? null : kgToQtl(kg) };
};

// ---- Inward: one unloaded Lot -------------------------------------------
// accepted + rejected = total received. bag_size is kg per bag. A legacy lot
// with no bag size can only fall back to what was stored (Qtl).
const lotCounts = (lot) => {
  const size = num(lot.bag_size);
  const acceptedBags = Math.trunc(num(lot.accepted_bags) || 0);
  const rejectedBags = Math.trunc(num(lot.rejected_bags) || 0);

  if (size !== null && size > 0) {
    const accepted = bagBlock(size, acceptedBags);
    const rejected = bagBlock(size, rejectedBags);
    return { basis: "bags", bag_size: size, accepted, rejected, total: addBlocks(accepted, rejected) };
  }

  const acceptedKg = r2((num(lot.qty) || 0) * KG_PER_QTL);
  const rejectedKg = r2((num(lot.rejected_qty) || 0) * KG_PER_QTL);
  const accepted = { bags: acceptedBags || null, kg: acceptedKg, qtl: kgToQtl(acceptedKg) };
  const rejected = { bags: rejectedBags || null, kg: rejectedKg, qtl: kgToQtl(rejectedKg) };
  return { basis: "stored", bag_size: null, accepted, rejected, total: addBlocks(accepted, rejected) };
};

// Whole-truck counted weight across every completed lot of the trip (kg).
const truckCountedKg = (lots) => {
  const blocks = (lots || []).map((l) => lotCounts(l).total);
  return blocks.length ? addBlocks(...blocks).kg : null;
};

// ---- Weighbridge --------------------------------------------------------
// -> { gross, tare, net, complete, slip_no } (kg) or null when never weighed.
const readWeighbridge = (slip, entryType) => {
  if (!slip) return null;
  const g = num(slip.gross_weight);
  const t = num(slip.tare_weight);
  const slip_no = slip.slip_no || null;

  if (t === null) {
    // First weighment only: the column holds the loaded truck for a purchase,
    // the empty truck for a sales dispatch.
    return entryType === "sales"
      ? { gross: null, tare: g, net: null, complete: false, slip_no }
      : { gross: g, tare: null, net: null, complete: false, slip_no };
  }
  return { gross: g, tare: t, net: g !== null ? r2(Math.max(g - t, 0)) : null, complete: true, slip_no };
};

// ---- Reconciliation: weighbridge net vs what was counted / loaded -------
// difference = scale net - counted. Positive = the scale read MORE (excess),
// negative = the scale read LESS (short).
const reconcile = ({ countedKg, netKg, assignedQtl }) => {
  const counted = num(countedKg);
  const net = num(netKg);
  const assigned = num(assignedQtl);
  const diffKg = counted !== null && net !== null ? r2(net - counted) : null;
  let status = "pending";
  if (diffKg !== null) status = Math.abs(diffKg) < MATCH_TOLERANCE_KG ? "matched" : diffKg > 0 ? "excess" : "short";
  return {
    assigned_qtl: assigned !== null && assigned > 0 ? r3(assigned) : null,
    counted_kg: counted,
    counted_qtl: counted === null ? null : kgToQtl(counted),
    net_kg: net,
    net_qtl: net === null ? null : kgToQtl(net),
    diff_kg: diffKg,
    diff_qtl: diffKg === null ? null : kgToQtl(diffKg),
    status,
  };
};

// ---- Outward: Loading items ---------------------------------------------
// A Loading line stores { so_id, material_id, bag_size, bags, qty }. `qty`
// (Qtl) is the authoritative figure: it starts as bags x bag size and is then
// scaled to the weighbridge reading at the second weighment (see
// weighbridge.controller.js reconcileSalesLoading). So the line quantity is
// `qty`, and a line whose bags x size no longer equals it is flagged as
// "adjusted to the scale".
const parseItems = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const p = JSON.parse(value);
      return Array.isArray(p) ? p : [];
    } catch (e) {
      return [];
    }
  }
  return [];
};

const outwardLine = (item) => {
  const size = num(item.bag_size);
  const bags = num(item.bags);
  const qtlStored = r3(num(item.qty) || 0);
  const kg = r2(qtlStored * KG_PER_QTL);
  const bagQtl = size !== null && size > 0 && bags !== null ? kgToQtl(r2(size * bags)) : null;
  return {
    bag_size: size,
    bags,
    kg,
    qtl: kgToQtl(kg),
    adjusted: bagQtl !== null && Math.abs(bagQtl - qtlStored) > 0.0005,
  };
};

const outwardTotals = (lines) => {
  const kg = r2(lines.reduce((s, l) => s + (Number(l.kg) || 0), 0));
  const anyBags = lines.some((l) => l.bags !== null && l.bags !== undefined);
  return {
    bags: anyBags ? lines.reduce((s, l) => s + (Number(l.bags) || 0), 0) : null,
    kg,
    qtl: kgToQtl(kg),
  };
};

// ---- Number formatting for the PDFs -------------------------------------
// 1234567.891 -> "12,34,567.891" (Indian grouping).
const group = (intStr) => {
  const last3 = intStr.slice(-3);
  const rest = intStr.slice(0, -3);
  return rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
};
const fmtFixed = (v, dp) => {
  const n = num(v);
  if (n === null) return "—";
  const [i, f] = Math.abs(n).toFixed(dp).split(".");
  return `${n < 0 && Number(Math.abs(n).toFixed(dp)) !== 0 ? "-" : ""}${group(i)}${f ? `.${f}` : ""}`;
};
const fmtInt = (v) => fmtFixed(v, 0);
const fmtQtl = (v) => fmtFixed(v, 3);
// kg: up to 2 decimals, trailing zeros trimmed (28450 / 28450.5 / 28450.25).
const fmtKg = (v) => {
  const n = num(v);
  if (n === null) return "—";
  const s = fmtFixed(n, 2); // e.g. "28,450.00"
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};
const fmtSigned = (v, fmt) => {
  const n = num(v);
  if (n === null) return "—";
  return `${n > 0 ? "+" : ""}${fmt(n)}`;
};

module.exports = {
  num, r2, r3, kgToQtl,
  bagBlock, addBlocks, lotCounts, truckCountedKg,
  readWeighbridge, reconcile,
  parseItems, outwardLine, outwardTotals,
  fmtInt, fmtQtl, fmtKg, fmtSigned,
  MATCH_TOLERANCE_KG,
};
