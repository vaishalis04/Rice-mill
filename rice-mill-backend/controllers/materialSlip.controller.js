const createError = require("http-errors");
const PDFDocument = require("pdfkit");
const {
  Lot, MaterialMaster, VarietyMaster, PlantMaster, WarehouseMaster, BinStackMaster, Stack,
  Purchase, PurchaseOrder, GateEntry, Vendor, Vehicle, Driver, WeightSlip,
  Loading, SalesOrder, Customer,
} = require("../models/index");
const calc = require("../helpers/materialSlipCalc.helper");
const { drawInwardSlip, drawOutwardSlip } = require("../helpers/materialSlipPdf.helper");

// Material Inward Slip / Material Outward Slip PDFs, generated from live data.
//
// This controller only GATHERS data. Every figure on the slips is calculated in
// helpers/materialSlipCalc.helper.js and drawn by helpers/materialSlipPdf.helper.js.
// Key rules (details in the calc helper):
//   * received quantity = bags x bag size, never Lot.qty (packing/production
//     lower Lot.qty after unloading);
//   * weighbridge readings come from the weight slip: gross / tare / net, with
//     the "first weighment" column quirk handled for sales trucks;
//   * the slip also reconciles the scale net against what was counted / loaded.

const pad2 = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => {
  if (!d) return "—";
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? "—" : `${pad2(t.getDate())}-${pad2(t.getMonth() + 1)}-${t.getFullYear()}`;
};
const fmtDateTime = (d) => {
  if (!d) return "—";
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? "—" : `${fmtDate(t)} ${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
};
const uniq = (arr) => [...new Set(arr.filter(Boolean))];

const startPdf = (res, filename) => {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  const doc = new PDFDocument({ size: "A4", margin: 0 });
  doc.pipe(res);
  return doc;
};

module.exports = {
  // GET /api/material-slips/inward/:lotId  — one slip per completed Lot.
  inwardSlipPdf: async (req, res, next) => {
    try {
      const lot = await Lot.findOne({
        where: { id: req.params.lotId, is_deleted: false },
        include: [
          { model: MaterialMaster, as: "material", attributes: ["id", "name"] },
          { model: VarietyMaster, as: "variety", attributes: ["id", "variety_name"] },
          { model: PlantMaster, as: "plant", attributes: ["id", "name", "address"] },
          { model: WarehouseMaster, as: "targetWarehouse", attributes: ["id", "name"] },
          {
            model: Stack, as: "stacks", attributes: ["id", "stack_code", "qty"],
            include: [{ model: BinStackMaster, as: "bin", attributes: ["id", "bin_code"] }],
          },
          {
            model: Purchase, as: "purchase", attributes: ["id", "gate_entry_id", "po_id"],
            include: [
              { model: PurchaseOrder, as: "purchaseOrder", attributes: ["id", "po_no"] },
              { model: WeightSlip, as: "weightSlip", attributes: ["id", "slip_no", "gross_weight", "tare_weight"] },
              {
                model: GateEntry, as: "gateEntry",
                attributes: ["id", "token_no", "challan_no", "entry_time", "exit_time", "expected_qty", "remarks"],
                include: [
                  { model: Vendor, as: "vendor", attributes: ["id", "name"] },
                  { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
                  { model: Driver, as: "driver", attributes: ["id", "name"] },
                ],
              },
            ],
          },
        ],
      });
      if (!lot) throw createError(404, "Lot not found");
      if (lot.unloading_status !== "completed") {
        throw createError(400, "This lot's unloading isn't complete yet — the Inward Slip is generated once bags have been counted and accepted.");
      }

      const purchase = lot.purchase;
      const ge = purchase?.gateEntry;

      // Every PO on this truck (a truck can carry several), not just the first.
      let poNos = [purchase?.purchaseOrder?.po_no];
      if (ge) {
        const sameTruck = await Purchase.findAll({
          where: { gate_entry_id: ge.id, is_deleted: false },
          attributes: ["id"],
          include: [{ model: PurchaseOrder, as: "purchaseOrder", attributes: ["po_no"] }],
        });
        poNos = [...poNos, ...sameTruck.map((p) => p.purchaseOrder?.po_no)];
      }

      // Whole-truck counted weight: every completed lot of this trip.
      let truckLots = [lot];
      if (ge) {
        const trips = await Purchase.findAll({ where: { gate_entry_id: ge.id, is_deleted: false }, attributes: ["id"] });
        const found = trips.length
          ? await Lot.findAll({
              where: { purchase_id: trips.map((p) => p.id), is_deleted: false, unloading_status: "completed" },
              attributes: ["id", "bag_size", "accepted_bags", "rejected_bags", "qty", "rejected_qty"],
            })
          : [];
        if (found.length) truckLots = found;
      }

      const counts = calc.lotCounts(lot);
      const weighbridge = calc.readWeighbridge(purchase?.weightSlip, "purchase");
      const recon = calc.reconcile({
        countedKg: calc.truckCountedKg(truckLots),
        netKg: weighbridge?.net,
        assignedQtl: ge?.expected_qty,
      });

      const stacks = (lot.stacks || []).map((s) => ({
        code: s.stack_code,
        bin: s.bin?.bin_code || "",
        qty_qtl: Number(s.qty) || 0,
      }));

      const doc = startPdf(res, `inward-slip-${lot.lot_no}.pdf`);
      drawInwardSlip(doc, {
        plant: lot.plant,
        slip_no: ge?.token_no || lot.lot_no,
        lot_no: lot.lot_no,
        date: fmtDate(ge?.entry_time || lot.created_at),
        vehicle_no: ge?.vehicle?.vehicle_no,
        supplier: ge?.vendor?.name,
        po_no: uniq(poNos).join(", "),
        challan_no: ge?.challan_no,
        driver_name: ge?.driver?.name,
        warehouse: lot.targetWarehouse?.name,
        commodity: lot.material?.name,
        variety: lot.variety?.variety_name,
        time_in: fmtDateTime(ge?.entry_time),
        time_out: fmtDateTime(ge?.exit_time),
        remarks: ge?.remarks,
        counts,
        weighbridge,
        recon,
        truck_lots: truckLots.length,
        stacks,
      });
      doc.end();
    } catch (err) {
      next(err);
    }
  },

  // GET /api/material-slips/outward/:loadingId  — one slip per Loading pass.
  outwardSlipPdf: async (req, res, next) => {
    try {
      const loading = await Loading.findOne({
        where: { id: req.params.loadingId, is_deleted: false },
        include: [
          {
            model: GateEntry, as: "gateEntry",
            attributes: ["id", "token_no", "challan_no", "entry_time", "exit_time", "plant_id", "remarks"],
            include: [
              { model: Vehicle, as: "vehicle", attributes: ["id", "vehicle_no"] },
              { model: Driver, as: "driver", attributes: ["id", "name", "mobile"] },
            ],
          },
          {
            model: SalesOrder, as: "salesOrder", attributes: ["id", "so_no", "customer_id"],
            include: [{ model: Customer, as: "customer", attributes: ["id", "name"] }],
          },
        ],
      });
      if (!loading) throw createError(404, "Loading record not found");

      const ge = loading.gateEntry;
      const plant = ge?.plant_id
        ? await PlantMaster.findOne({ where: { id: ge.plant_id, is_deleted: false } })
        : await PlantMaster.findOne({ where: { is_deleted: false }, order: [["id", "ASC"]] });

      // Truck-level weighbridge reading (the scale weighs the whole truck, not one pass).
      const weightSlip = ge
        ? await WeightSlip.findOne({ where: { gate_entry_id: ge.id, is_deleted: false }, order: [["id", "DESC"]] })
        : null;
      const weighbridge = calc.readWeighbridge(weightSlip, "sales");

      // Every loading pass of this truck, for the "all passes" reconciliation.
      const passes = ge
        ? await Loading.findAll({ where: { gate_entry_id: ge.id, is_deleted: false }, order: [["id", "ASC"]] })
        : [loading];
      const allPassLines = passes.flatMap((p) => calc.parseItems(p.items).map(calc.outwardLine));
      const allPassesKg = calc.outwardTotals(allPassLines).kg;
      const passIndex = Math.max(0, passes.findIndex((p) => Number(p.id) === Number(loading.id)));

      // This pass's lines.
      const items = calc.parseItems(loading.items).map((it) => ({ ...it, so_id: it.so_id || loading.so_id }));
      const materialIds = uniq(items.map((it) => it.material_id));
      const soIds = uniq(items.map((it) => it.so_id));
      const [materials, sos] = await Promise.all([
        materialIds.length ? MaterialMaster.findAll({ where: { id: materialIds }, attributes: ["id", "name"] }) : [],
        soIds.length
          ? SalesOrder.findAll({
              where: { id: soIds },
              attributes: ["id", "so_no", "customer_id"],
              include: [{ model: Customer, as: "customer", attributes: ["id", "name"] }],
            })
          : [],
      ]);
      const nameById = new Map(materials.map((m) => [Number(m.id), m.name]));
      const soById = new Map(sos.map((s) => [Number(s.id), s]));
      // the warehouse each line was loaded from (chosen on the Loading screen)
      const warehouseIds = uniq(items.map((it) => Number(it.warehouse_id)));
      const warehouses = warehouseIds.length
        ? await WarehouseMaster.findAll({ where: { id: warehouseIds }, attributes: ["id", "name"] })
        : [];
      const warehouseNameById = new Map(warehouses.map((w) => [Number(w.id), w.name]));

      let lines = items.map((it) => ({
        ...calc.outwardLine(it),
        name: nameById.get(Number(it.material_id)) || (it.material_id ? `Material ${it.material_id}` : "—"),
        so_no: soById.get(Number(it.so_id))?.so_no || "",
        warehouse: warehouseNameById.get(Number(it.warehouse_id)) || "",
      }));
      // A loading saved without an item breakdown still prints its total.
      if (!lines.length && Number(loading.loaded_qty) > 0) {
        lines = [{ ...calc.outwardLine({ qty: loading.loaded_qty }), name: "Material (not itemised)", so_no: loading.salesOrder?.so_no || "" }];
      }
      const totals = calc.outwardTotals(lines);

      // Party / SO numbers across every SO on this loading (a truck can serve several).
      const customers = uniq([...sos.map((s) => s.customer?.name), loading.salesOrder?.customer?.name]);
      const soNos = uniq([...sos.map((s) => s.so_no), loading.salesOrder?.so_no]);

      const recon = calc.reconcile({ countedKg: allPassesKg, netKg: weighbridge?.net });

      const doc = startPdf(res, `outward-slip-${loading.loading_no}.pdf`);
      drawOutwardSlip(doc, {
        plant,
        slip_no: ge?.token_no || loading.loading_no,
        loading_no: loading.loading_no,
        date: fmtDate(loading.loaded_at || ge?.entry_time),
        vehicle_no: ge?.vehicle?.vehicle_no,
        party: customers.join("; "),
        so_nos: soNos.join(", "),
        challan_no: ge?.challan_no,
        driver_name: ge?.driver?.name,
        passes_label: `${passIndex + 1} of ${passes.length}`,
        warehouse_names: uniq(lines.map((l) => l.warehouse)).join(", "),
        time_in: fmtDateTime(ge?.entry_time),
        time_out: fmtDateTime(ge?.exit_time),
        remarks: loading.remarks && !/^Loaded \d+ material/.test(loading.remarks) ? loading.remarks : "",
        lines,
        totals,
        weighbridge,
        recon,
      });
      doc.end();
    } catch (err) {
      next(err);
    }
  },
};
