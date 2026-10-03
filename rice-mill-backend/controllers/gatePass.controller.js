const createError = require("http-errors");
const PDFDocument = require("pdfkit");
const {
  GateEntry, Vehicle, Driver, Vendor, Customer, PurchaseOrder, SalesOrder,
  GateEntryPurchaseOrder, GateEntrySalesOrder, GateEntryMiscItem, MaterialMaster,
  PlantMaster, Purchase, Lot, Sampling, LabTest, WeightSlip, Loading,
} = require("../models/index");
const { drawGatePasses } = require("../helpers/gatePassPdf.helper");
const { drawGatePassModule } = require("../helpers/gatePassModule.helper");
const { gpNoFor } = require("../helpers/gpNumber.helper");

// Gate Pass — printed from the Gate Entry tab AFTER a truck has checked out
// (gate_status = "exited"). Two copies only: ORIGINAL + ACCOUNTS.
//
//   Purchase / Sales trucks -> item-table pass (gatePassModule.helper.js).
//     Item rows are read from the database: unloaded Lots (+ lab verdict)
//     for purchase, Loading records for sales. Net weight comes from the
//     weight slip.
//   Empty / Misc trucks     -> "Inward Store Pass" (gatePassPdf.helper.js).
//     Items / qty are read from the misc items logged for the truck.
//
// Anything typed into the optional manual form (query string) overrides the
// auto-filled value; anything left blank falls back to the database.
// Read-only — nothing is ever written to the database.

const KIND_BY_ENTRY_TYPE = { purchase: "module", sales: "module", other: "store" };

const clean = (v, max = 120) => (v === undefined || v === null ? "" : String(v).trim().slice(0, max));
const pad2 = (n) => String(n).padStart(2, "0");

const fmtDateTime = (v) => {
  const dt = v ? new Date(v) : new Date();
  const t = Number.isNaN(dt.getTime()) ? new Date() : dt;
  return `${pad2(t.getDate())}-${pad2(t.getMonth() + 1)}-${t.getFullYear()} ${pad2(t.getHours())}:${pad2(t.getMinutes())}:${pad2(t.getSeconds())}`;
};

const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const show = (v) => (v === null || v === undefined ? "" : String(Number(Number(v).toFixed(2))));

// JSON columns can come back as a real array or as a JSON string.
const asArray = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch (e) {
      return [];
    }
  }
  return [];
};

const VERDICT_LABEL = { accepted: "Accepted", rejected: "Rejected", negotiation: "Negotiation" };

const entryIncludes = () => [
  { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
  { model: Driver, as: "driver", attributes: ["id", "name", "mobile"] },
  { model: Vendor, as: "vendor", attributes: ["id", "name"] },
  { model: Customer, as: "customer", attributes: ["id", "name"] },
  { model: PlantMaster, as: "plant", attributes: ["id", "name", "address"], required: false },
  { model: MaterialMaster, as: "material", attributes: ["id", "name"], required: false },
  { model: PurchaseOrder, as: "purchaseOrder", attributes: ["id", "po_no", "vendor_id"] },
  { model: SalesOrder, as: "salesOrder", attributes: ["id", "so_no", "customer_id"] },
  {
    model: GateEntryPurchaseOrder,
    as: "purchase_orders",
    attributes: ["id"],
    include: [{ model: PurchaseOrder, as: "purchaseOrder", attributes: ["id", "po_no", "vendor_id"] }],
  },
  {
    model: GateEntrySalesOrder,
    as: "sales_orders",
    attributes: ["id"],
    include: [{ model: SalesOrder, as: "sales_order", attributes: ["id", "so_no", "customer_id"] }],
  },
  { model: GateEntryMiscItem, as: "misc_items", required: false, where: { is_deleted: false } },
];

const loadExitedEntry = async (id) => {
  const entry = await GateEntry.findOne({ where: { id, is_deleted: false }, include: entryIncludes() });
  if (!entry) throw createError(404, "Gate entry not found");
  if (entry.gate_status !== "exited") {
    throw createError(400, "A gate pass can only be printed after the truck has checked out");
  }
  if (!KIND_BY_ENTRY_TYPE[entry.entry_type]) {
    throw createError(400, "This truck hasn't been classified (Purchase / Sales / Empty) yet, so it has no gate pass");
  }
  return entry;
};

// Vendor/customer straight off the entry, else via the linked PO / SO.
const partyNameFor = async (entry) => {
  if (entry.vendor?.name) return entry.vendor.name;
  if (entry.customer?.name) return entry.customer.name;
  const pos = [entry.purchaseOrder, ...(entry.purchase_orders || []).map((r) => r.purchaseOrder)].filter(Boolean);
  const vendorId = pos.find((p) => p.vendor_id)?.vendor_id;
  if (vendorId) {
    const v = await Vendor.findByPk(vendorId, { attributes: ["name"] });
    if (v?.name) return v.name;
  }
  const sos = [entry.salesOrder, ...(entry.sales_orders || []).map((r) => r.sales_order)].filter(Boolean);
  const customerId = sos.find((s) => s.customer_id)?.customer_id;
  if (customerId) {
    const c = await Customer.findByPk(customerId, { attributes: ["name"] });
    if (c?.name) return c.name;
  }
  return "";
};

const poSoNoFor = (entry) => {
  const nos = [
    ...(entry.purchase_orders || []).map((r) => r.purchaseOrder?.po_no),
    ...(entry.sales_orders || []).map((r) => r.sales_order?.so_no),
    entry.purchaseOrder?.po_no,
    entry.salesOrder?.so_no,
  ].filter(Boolean);
  return [...new Set(nos)].join(", ");
};

// Latest weight slip that has both gross and tare => net weight in kg.
const netWeightFor = async (gateEntryId) => {
  const slips = await WeightSlip.findAll({
    where: { gate_entry_id: gateEntryId, is_deleted: false },
    order: [["id", "DESC"]],
  });
  const withNet = slips.find((s) => s.net_weight !== null && Number(s.net_weight) > 0);
  return withNet ? Number(withNet.net_weight) : null;
};

// ---- Purchase: one row per unloaded Lot, with the lab's verdict ----
const purchaseRows = async (entry) => {
  const purchases = await Purchase.findAll({ where: { gate_entry_id: entry.id, is_deleted: false }, attributes: ["id"] });
  if (!purchases.length) return [];

  const lots = await Lot.findAll({
    where: { purchase_id: purchases.map((p) => p.id), is_deleted: false },
    include: [{ model: MaterialMaster, as: "material", attributes: ["id", "name"] }],
    order: [["id", "ASC"]],
  });

  const samplings = await Sampling.findAll({ where: { gate_entry_id: entry.id, is_deleted: false }, attributes: ["id"] });
  const tests = samplings.length
    ? await LabTest.findAll({
        where: { sampling_id: samplings.map((s) => s.id), is_deleted: false },
        order: [["id", "DESC"]],
      })
    : [];

  const verdictFor = (materialId) => {
    // A lab test lists the material ids it covered. Newest matching one wins;
    // a test that lists no materials is treated as covering the whole truck.
    const hit =
      tests.find((t) => asArray(t.material_id).map(Number).includes(Number(materialId))) ||
      tests.find((t) => asArray(t.material_id).length === 0);
    return hit ? VERDICT_LABEL[hit.verdict] || "N/A" : "N/A";
  };

  return lots.map((lot) => {
    const accepted = num(lot.accepted_bags);
    const rejected = num(lot.rejected_bags) ?? 0;
    const hasBags = accepted !== null;
    return {
      item_name: lot.material?.name || `Material ${lot.material_id}`,
      lab_decision: verdictFor(lot.material_id),
      size: lot.bag_size !== null && lot.bag_size !== undefined ? show(lot.bag_size) : "",
      total: hasBags ? String(accepted + rejected) : "",
      accp: hasBags ? String(accepted) : "",
      rej: hasBags ? String(rejected) : "",
      remarks_auto: rejected > 0 ? `${rejected} bag(s) rejected` : "",
    };
  });
};

// ---- Sales: one row per material line of every Loading record ----
// A saved Loading only keeps { so_id, material_id, bag_size, bags, qty } per
// line — the material NAME and SO number are looked up here by id.
const salesRows = async (entry) => {
  const loadings = await Loading.findAll({
    where: { gate_entry_id: entry.id, is_deleted: false },
    order: [["id", "ASC"]],
  });
  const lines = loadings.flatMap((l) => asArray(l.items).map((it) => ({ ...it, so_id: it.so_id || l.so_id })));
  if (!lines.length) return [];

  const materialIds = [...new Set(lines.map((i) => i.material_id).filter(Boolean))];
  const soIds = [...new Set(lines.map((i) => i.so_id).filter(Boolean))];
  const [materials, sos] = await Promise.all([
    materialIds.length ? MaterialMaster.findAll({ where: { id: materialIds }, attributes: ["id", "name"] }) : [],
    soIds.length ? SalesOrder.findAll({ where: { id: soIds }, attributes: ["id", "so_no"] }) : [],
  ]);
  const nameById = Object.fromEntries(materials.map((m) => [m.id, m.name]));
  const soNoById = Object.fromEntries(sos.map((o) => [o.id, o.so_no]));

  return lines.map((it) => {
    const bags = num(it.bags);
    const soNo = it.so_no || soNoById[it.so_id];
    return {
      item_name: it.material_name || nameById[it.material_id] || (it.material_id ? `Material ${it.material_id}` : "—"),
      lab_decision: "N/A",
      size: it.bag_size !== null && it.bag_size !== undefined ? show(it.bag_size) : "",
      total: bags !== null ? String(bags) : "",
      accp: bags !== null ? String(bags) : "",
      rej: bags !== null ? "0" : "",
      remarks_auto: soNo ? String(soNo) : "",
    };
  });
};

// Resolves everything a pass needs. `q` = the optional manual overrides.
const buildPassData = async (entry, q = {}) => {
  const kind = KIND_BY_ENTRY_TYPE[entry.entry_type];
  const gpNo = gpNoFor(entry.entry_type, entry.id); // shared with Payment Settlement, which is done against this number
  const autoParty = await partyNameFor(entry);
  const base = {
    id: entry.id,
    token_no: entry.token_no,
    entry_type: entry.entry_type,
    pass_kind: kind,
    gp_no: gpNo,
    date_time: fmtDateTime(entry.exit_time),
    vehicle_no: entry.vehicle?.vehicle_no || "",
    driver_name: entry.driver?.name || "",
  };

  if (kind === "store") {
    const misc = (entry.misc_items || []).map((m) => m.get({ plain: true }));
    const defaultItems = misc.length ? misc.map((m) => m.item_name).filter(Boolean).join(", ") : entry.material?.name || "";
    let defaultQty = "";
    if (misc.length) {
      const units = [...new Set(misc.map((m) => m.unit).filter(Boolean))];
      const total = misc.reduce((s, m) => s + (Number(m.qty) || 0), 0);
      defaultQty = `${Number(total.toFixed(2))}${units.length === 1 ? ` ${units[0]}` : ""}`;
    } else if (entry.expected_qty) {
      defaultQty = String(Number(entry.expected_qty));
    }
    const defaults = {
      party: autoParty,
      inv_no: entry.challan_no || "",
      inv_value: "",
      qty: defaultQty,
      items: defaultItems,
      remarks: entry.remarks || (misc.length ? `Loaded ${misc.length} material(s)` : ""),
    };
    return {
      ...base,
      title: "INWARD STORE PASS",
      auto_items_found: misc.length > 0,
      defaults,
      // What the PDF actually prints (override > auto).
      store: {
        gp_no: gpNo,
        date_time: base.date_time,
        vehicle_no: base.vehicle_no,
        driver_name: base.driver_name,
        party_name: clean(q.party) || defaults.party,
        inv_no: clean(q.inv_no, 40) || defaults.inv_no,
        inv_value: clean(q.inv_value, 20),
        qty: clean(q.qty, 40) || defaults.qty,
        items: clean(q.items, 200) || defaults.items,
        remarks: clean(q.remarks, 200) || defaults.remarks,
      },
    };
  }

  // Purchase / Sales
  const autoRows = entry.entry_type === "purchase" ? await purchaseRows(entry) : await salesRows(entry);
  const netKg = await netWeightFor(entry.id);
  const manualRemarks = clean(q.remarks, 80);

  let items = autoRows.map((r) => ({
    item_name: r.item_name,
    lab_decision: r.lab_decision,
    size: r.size,
    total: r.total,
    accp: r.accp,
    rej: r.rej,
    remarks: manualRemarks || r.remarks_auto || "No Remarks",
  }));

  // No unloading / loading rows in the DB (yet)? Fall back to what was
  // typed by hand, else to the gate entry's own material, so the pass still
  // prints with something on it.
  const manualItems = clean(q.items, 150);
  if (!items.length) {
    const name = manualItems || entry.material?.name || "";
    const qty = clean(q.qty, 20);
    if (name || qty) {
      items = [{ item_name: name || "—", lab_decision: "N/A", size: "", total: qty, accp: "", rej: "", remarks: manualRemarks || "No Remarks" }];
    }
  }

  const company = entry.plant || (await PlantMaster.findOne({ where: { is_deleted: false }, order: [["id", "ASC"]] }));
  const isInward = entry.entry_type === "purchase";
  const autoNet = netKg !== null ? show(netKg) : "";
  const net = clean(q.net_weight, 20) || autoNet;

  const defaults = {
    party: autoParty,
    net_weight: autoNet,
    inv_no: entry.challan_no || "",
    remarks: "",
  };

  return {
    ...base,
    title: isInward ? "INWARD GATE PASS" : "OUTWARD GATE PASS",
    auto_items_found: autoRows.length > 0,
    defaults,
    items,
    module: {
      plant_name: (company?.name || "RICE MILL").toUpperCase(),
      plant_address: company?.address || "",
      title: isInward ? "INWARD GATE PASS" : "OUTWARD GATE PASS",
      gp_no: gpNo,
      date_time: base.date_time,
      vehicle_no: base.vehicle_no,
      driver_name: base.driver_name,
      party_name: clean(q.party) || autoParty,
      po_so_no: poSoNoFor(entry),
      inv_no: clean(q.inv_no, 40) || defaults.inv_no,
      net_weight: net,
      items,
      qr_text: `${gpNo} | ${entry.token_no || ""} | ${base.vehicle_no}`,
    },
  };
};

module.exports = {
  // GET /api/gate/:id/gate-pass/data — what the pass will contain, so the
  // Gate Entry screen can show it (and the manual-override form can show the
  // auto-filled values as placeholders).
  getData: async (req, res, next) => {
    try {
      const entry = await loadExitedEntry(req.params.id);
      const data = await buildPassData(entry, {});

      // Empty/Misc fallback dropdown: item names logged on past misc trucks.
      let itemSuggestions = [];
      if (data.pass_kind === "store") {
        const past = await GateEntryMiscItem.findAll({
          where: { is_deleted: false },
          attributes: ["item_name"],
          order: [["id", "DESC"]],
          limit: 500,
        });
        itemSuggestions = [...new Set(past.map((p) => (p.item_name || "").trim()).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b))
          .slice(0, 100);
      }

      res.status(200).json({
        success: true,
        data: {
          id: data.id,
          token_no: data.token_no,
          entry_type: data.entry_type,
          pass_kind: data.pass_kind,
          title: data.title,
          gp_no: data.gp_no,
          date_time: data.date_time,
          vehicle_no: data.vehicle_no,
          driver_name: data.driver_name,
          party_name: data.defaults.party,
          net_weight: data.defaults.net_weight || null,
          auto_items_found: data.auto_items_found,
          items: data.items || [],
          defaults: data.defaults,
          item_suggestions: itemSuggestions,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/gate/:id/gate-pass — the PDF (ORIGINAL + ACCOUNTS).
  pdf: async (req, res, next) => {
    try {
      const entry = await loadExitedEntry(req.params.id);
      const data = await buildPassData(entry, req.query || {});

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${data.gp_no}.pdf"`);
      const doc = new PDFDocument({ size: "A4", margin: 0 });
      doc.pipe(res);
      if (data.pass_kind === "store") drawGatePasses(doc, data.store);
      else drawGatePassModule(doc, data.module);
      doc.end();
    } catch (err) {
      next(err);
    }
  },
};