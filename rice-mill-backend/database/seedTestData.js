// Full end-to-end test-data seed for the Rice Mill ERP.
// Walks every module built so far — Gate Entry -> Sampling -> Lab QC ->
// Weighbridge -> Lot/Warehouse -> Production -> Packing/FG -> Sales/Dispatch —
// using the Sequelize models directly (same logic the controllers use), so
// the DB ends up in a fully realistic, internally-consistent state.
//
// Run with: node database/seedTestData.js
//
// Safe to re-run: master data (roles, users, vendors, machines, etc.) uses
// findOrCreate and is skipped if already present. The transactional chain
// (gate entries, batches, dispatches...) creates a NEW cycle each run, since
// the whole point is fresh, walkable test data — re-running just gives you
// more of it (with fresh daily-sequential numbers).

require("dotenv").config();
const bcrypt = require("bcrypt");
const {
  sequelize, Role, User, PlantMaster, UomMaster, VarietyMaster, MaterialMaster,
  Vendor, Customer, Vehicle, Driver, WarehouseMaster, BinStackMaster, MachineMaster,
  PurchaseOrder, GateEntry, Sampling, LabTest, WeightSlip, Purchase, Lot, Stack,
  Inventory, ByProductInventory, ProductionBatch, MachineLog, SeparatorOutput,
  ShinerProcess, ColorSorter, LengthGrading, Packing, FinishedGoods, SalesOrder, Dispatch,
} = require("../models/index");
const {
  generateTokenNo, generateLotNo, generateBatchNo, generatePackingBatchNo,
  generateEAN13, generateSoNo, generateChallanNo,
} = require("../helpers/helperFunction");

const SALT_ROUNDS = 10;
const PASSWORD = "test123";

async function upsertRole(role_name) {
  const [role] = await Role.findOrCreate({ where: { role_name }, defaults: { role_name } });
  return role;
}

async function upsertUser({ username, email, role_id, plant_id }) {
  const existing = await User.findOne({ where: { email } });
  if (existing) return existing;
  const password_hash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);
  return User.create({ username, email, password_hash, role_id, plant_id, employee_code: username.toUpperCase() });
}

(async () => {
  try {
    await sequelize.authenticate();
    console.log("✅ DB connected\n");

    // ---------------------------------------------------------------
    // 1. Roles
    // ---------------------------------------------------------------
    console.log("→ Seeding roles...");
    const roleNames = ["admin", "gate", "lab", "purchase", "warehouse", "production", "sales", "dispatch"];
    const roles = {};
    for (const name of roleNames) {
      // eslint-disable-next-line no-await-in-loop
      roles[name] = await upsertRole(name);
    }

    // ---------------------------------------------------------------
    // 2. Plant
    // ---------------------------------------------------------------
    console.log("→ Seeding plant...");
    const [plant] = await PlantMaster.findOrCreate({
      where: { plant_code: "PLANT-01" },
      defaults: { plant_code: "PLANT-01", name: "Main Rice Mill", address: "Industrial Area, Bhopal, MP" },
    });

    // ---------------------------------------------------------------
    // 3. Users (one per role, all password: test123)
    // ---------------------------------------------------------------
    console.log("→ Seeding users...");
    const users = {};
    for (const name of roleNames) {
      // eslint-disable-next-line no-await-in-loop
      users[name] = await upsertUser({
        username: `${name}1`,
        email: `${name}1@ricemill.com`,
        role_id: roles[name].id,
        plant_id: plant.id,
      });
    }

    // ---------------------------------------------------------------
    // 4. Master data: UOM, Variety, Materials
    // ---------------------------------------------------------------
    console.log("→ Seeding UOM / Variety / Materials...");
    const [kg] = await UomMaster.findOrCreate({ where: { uom_code: "KG" }, defaults: { uom_code: "KG", name: "Kilogram", conversion_factor: 1 } });
    const [basmati] = await VarietyMaster.findOrCreate({ where: { variety_name: "Basmati 1121" }, defaults: { variety_name: "Basmati 1121", grain_type: "long" } });

    const materialDefs = [
      { material_code: "PADDY001", name: "Paddy - 1121", category: "paddy" },
      { material_code: "RICE001", name: "Rice - 1121 Steam", category: "rice" },
      { material_code: "HUSK001", name: "Rice Husk", category: "husk" },
      { material_code: "BRAN001", name: "Rice Bran", category: "bran" },
      { material_code: "BROKEN001", name: "Broken Rice", category: "broken" },
    ];
    const materials = {};
    for (const m of materialDefs) {
      // eslint-disable-next-line no-await-in-loop
      const [rec] = await MaterialMaster.findOrCreate({
        where: { material_code: m.material_code },
        defaults: { ...m, uom_id: kg.id, variety_id: basmati.id, plant_id: plant.id },
      });
      materials[m.category] = rec;
    }

    // ---------------------------------------------------------------
    // 5. Vendor, Customer
    // ---------------------------------------------------------------
    console.log("→ Seeding vendor & customer...");
    const [vendor] = await Vendor.findOrCreate({
      where: { vendor_code: "VEND001" },
      defaults: {
        vendor_code: "VEND001", name: "Sharma Traders", gstin: "22AAAAA0000A1Z5",
        vendor_type: "supplier", credit_terms: "30 days", plant_id: plant.id,
      },
    });
    const [customer] = await Customer.findOrCreate({
      where: { customer_code: "CUST001" },
      defaults: {
        customer_code: "CUST001", name: "Sri Lakshmi Traders", gstin: "27AAAAA0000A1Z5",
        address: "12 MG Road, Indore", customer_type: "fg", credit_limit: 500000, plant_id: plant.id,
      },
    });

    // ---------------------------------------------------------------
    // 6. Vehicle, Driver (2 of each, for variety)
    // ---------------------------------------------------------------
    console.log("→ Seeding vehicles & drivers...");
    const [vehicle1] = await Vehicle.findOrCreate({
      where: { vehicle_no: "MP09AB1234" },
      defaults: { vehicle_no: "MP09AB1234", type: "truck", capacity: 10000, owner_vendor_id: vendor.id, plant_id: plant.id },
    });
    const [vehicle2] = await Vehicle.findOrCreate({
      where: { vehicle_no: "MP09CD5678" },
      defaults: { vehicle_no: "MP09CD5678", type: "truck", capacity: 8000, owner_vendor_id: vendor.id, plant_id: plant.id },
    });
    const [driver1] = await Driver.findOrCreate({
      where: { mobile: "9876543210" },
      defaults: { name: "Ram Singh", mobile: "9876543210", license_no: "MP0920230001234", plant_id: plant.id },
    });
    const [driver2] = await Driver.findOrCreate({
      where: { mobile: "9876543211" },
      defaults: { name: "Shyam Yadav", mobile: "9876543211", license_no: "MP0920230005678", plant_id: plant.id },
    });

    // ---------------------------------------------------------------
    // 7. Warehouse + Bin (raw & FG)
    // ---------------------------------------------------------------
    console.log("→ Seeding warehouses & bins...");
    const [rawWarehouse] = await WarehouseMaster.findOrCreate({
      where: { warehouse_code: "WH-RAW-01" },
      defaults: { warehouse_code: "WH-RAW-01", name: "Raw Material Godown 1", type: "raw", capacity: 500000, plant_id: plant.id },
    });
    const [fgWarehouse] = await WarehouseMaster.findOrCreate({
      where: { warehouse_code: "WH-FG-01" },
      defaults: { warehouse_code: "WH-FG-01", name: "Finished Goods Godown 1", type: "fg", capacity: 300000, plant_id: plant.id },
    });
    const [rawBin] = await BinStackMaster.findOrCreate({
      where: { bin_code: "BIN-A1" },
      defaults: { bin_code: "BIN-A1", warehouse_id: rawWarehouse.id, capacity: 20000, plant_id: plant.id },
    });

    // ---------------------------------------------------------------
    // 8. Machines (10 seed machines)
    // ---------------------------------------------------------------
    console.log("→ Seeding machines...");
    const machineDefs = [
      { machine_code: "DRY-01", name: "Paddy Dryer 1", type: "dryer", capacity_per_hr: 8000 },
      { machine_code: "HUL-01", name: "Huller / Milling Machine 1", type: "huller", capacity_per_hr: 6000 },
      { machine_code: "HUL-02", name: "Huller / Milling Machine 2", type: "huller", capacity_per_hr: 6000 },
      { machine_code: "SEP-01", name: "Destoner / Separator 1", type: "separator", capacity_per_hr: 7000 },
      { machine_code: "SHI-01", name: "Shiner / Whitener - Pass 1", type: "shiner", capacity_per_hr: 5500 },
      { machine_code: "SHI-02", name: "Shiner / Whitener - Pass 2", type: "shiner", capacity_per_hr: 5500 },
      { machine_code: "SHI-03", name: "Shiner / Whitener - Pass 3", type: "shiner", capacity_per_hr: 5500 },
      { machine_code: "CS-01", name: "Color Sorter 1", type: "color_sorter", capacity_per_hr: 4000 },
      { machine_code: "GR-01", name: "Length Grader 1", type: "grader", capacity_per_hr: 4500 },
      { machine_code: "OTH-01", name: "Bagging / Weighing Unit 1", type: "other", capacity_per_hr: 3000 },
    ];
    const machines = {};
    for (const m of machineDefs) {
      // eslint-disable-next-line no-await-in-loop
      const [rec] = await MachineMaster.findOrCreate({
        where: { machine_code: m.machine_code },
        defaults: { ...m, install_date: new Date().toISOString().slice(0, 10), plant_id: plant.id },
      });
      machines[m.machine_code] = rec;
    }

    // ---------------------------------------------------------------
    // 9. Purchase Order
    // ---------------------------------------------------------------
    console.log("→ Creating purchase order...");
    const po = await PurchaseOrder.create({
      po_no: `PO-SEED-${Date.now()}`,
      vendor_id: vendor.id,
      material_id: materials.paddy.id,
      variety_id: basmati.id,
      qty: 20000,
      rate: 22.5,
      po_date: new Date().toISOString().slice(0, 10),
      plant_id: plant.id,
      created_by: users.purchase.id,
    });

    // =================================================================
    // GOLDEN PATH #1 — full cycle: Gate -> Sampling -> Lab (accepted) ->
    // Weighbridge -> Lot -> Production (all stages) -> Packing -> FG ->
    // Sales Order -> Dispatch
    // =================================================================
    console.log("\n=== Golden path: full cycle (accepted) ===");

    console.log("→ Gate entry (check-in)...");
    const token_no = await generateTokenNo(vehicle1.vehicle_no);
    const gate1 = await GateEntry.create({
      token_no,
      vehicle_id: vehicle1.id,
      driver_id: driver1.id,
      vendor_id: vendor.id,
      po_id: po.id,
      material_id: materials.paddy.id,
      challan_no: "CH-VENDOR-0001",
      expected_qty: 10500,
      entry_time: new Date(),
      gate_status: "waiting_token",
      plant_id: plant.id,
      created_by: users.gate.id,
    });
    await gate1.update({ gate_status: "waiting_sampling" });

    console.log("→ Sampling...");
    const sample1 = await Sampling.create({
      gate_entry_id: gate1.id,
      sample_code: `SMP-SEED-${Date.now()}`,
      collected_by: users.lab.id,
      collected_at: new Date(),
      plant_id: plant.id,
      created_by: users.lab.id,
    });
    await gate1.update({ gate_status: "sampling_done" });

    console.log("→ Lab test (verdict: accepted)...");
    await LabTest.create({
      sampling_id: sample1.id,
      moisture_pct: 13.2,
      broken_pct: 4.5,
      fm_pct: 0.8,
      color: "golden",
      smell: "normal",
      variety_detected: basmati.id,
      grain_size: "long",
      verdict: "accepted",
      tested_by: users.lab.id,
      tested_at: new Date(),
      plant_id: plant.id,
      created_by: users.lab.id,
    });
    await gate1.update({ gate_status: "accepted" });

    console.log("→ Weighbridge (weight slip + purchase)...");
    const grossWeight = 18500;
    const tareWeight = 8200;
    const netWeight = grossWeight - tareWeight;
    const weightSlip1 = await WeightSlip.create({
      gate_entry_id: gate1.id,
      slip_no: `WS-SEED-${Date.now()}`,
      gross_weight: grossWeight,
      tare_weight: tareWeight,
      weighed_at: new Date(),
      weighbridge_operator_id: users.gate.id,
      plant_id: plant.id,
      created_by: users.gate.id,
    });
    const purchase1 = await Purchase.create({
      po_id: po.id,
      gate_entry_id: gate1.id,
      weight_slip_id: weightSlip1.id,
      final_rate: po.rate,
      final_qty: netWeight,
      amount: netWeight * Number(po.rate),
      purchase_date: new Date().toISOString().slice(0, 10),
      plant_id: plant.id,
      created_by: users.gate.id,
    });
    await gate1.update({ gate_status: "in_process" });

    console.log("→ Lot + Stack + Inventory (raw)...");
    const lot_no = await generateLotNo();
    const lot1 = await Lot.create({
      lot_no,
      purchase_id: purchase1.id,
      material_id: materials.paddy.id,
      variety_id: basmati.id,
      qty: netWeight,
      plant_id: plant.id,
      created_by: users.warehouse.id,
    });
    await Stack.create({
      stack_code: `${lot_no}-S1`,
      lot_id: lot1.id,
      warehouse_id: rawWarehouse.id,
      bin_id: rawBin.id,
      qty: netWeight,
      stacked_at: new Date(),
      plant_id: plant.id,
      created_by: users.warehouse.id,
    });
    await Inventory.create({
      lot_id: lot1.id,
      material_id: materials.paddy.id,
      warehouse_id: rawWarehouse.id,
      stage: "raw",
      qty_in: netWeight,
      qty_out: 0,
      balance_qty: netWeight,
      as_of: new Date(),
      plant_id: plant.id,
      created_by: users.warehouse.id,
    });
    await lot1.update({ destination: "warehouse" });
    await gate1.update({ gate_status: "unloaded" });

    console.log("→ Production batch (dry process)...");
    const batch_no = await generateBatchNo();
    const batch1 = await ProductionBatch.create({
      batch_no,
      lot_id: lot1.id,
      process_type: "dry",
      input_qty: lot1.qty,
      production_date: new Date().toISOString().slice(0, 10),
      batch_status: "in_progress",
      current_stage: "milling",
      plant_id: plant.id,
      created_by: users.production.id,
    });

    console.log("  - Milling stage...");
    const millingOutput = 7200;
    await MachineLog.create({
      batch_id: batch1.id, machine_id: machines["HUL-01"].id, operator_id: users.production.id,
      stage: "milling", start_time: new Date(Date.now() - 3 * 3600000), end_time: new Date(Date.now() - 1.5 * 3600000),
      running_hours: 1.5, input_qty: batch1.input_qty, output_qty: millingOutput,
      recovery_pct: Number(((millingOutput / batch1.input_qty) * 100).toFixed(2)),
      downtime_minutes: 0, plant_id: plant.id, created_by: users.production.id,
    });
    const huskQty = 1800;
    const brokenAtMillingQty = 300;
    await Inventory.create({
      lot_id: lot1.id, material_id: materials.husk.id, warehouse_id: null, stage: "by_product",
      qty_in: huskQty, qty_out: 0, balance_qty: huskQty, as_of: new Date(), plant_id: plant.id, created_by: users.production.id,
    });
    await ByProductInventory.create({ material_id: materials.husk.id, qty_produced: huskQty, qty_sold: 0, qty_in_stock: huskQty, plant_id: plant.id, created_by: users.production.id });
    await Inventory.create({
      lot_id: lot1.id, material_id: materials.broken.id, warehouse_id: null, stage: "by_product",
      qty_in: brokenAtMillingQty, qty_out: 0, balance_qty: brokenAtMillingQty, as_of: new Date(), plant_id: plant.id, created_by: users.production.id,
    });
    await ByProductInventory.create({ material_id: materials.broken.id, qty_produced: brokenAtMillingQty, qty_sold: 0, qty_in_stock: brokenAtMillingQty, plant_id: plant.id, created_by: users.production.id });
    await batch1.update({ current_stage: "separator" });

    console.log("  - Separator stage...");
    const cleanedQty = 7000;
    await SeparatorOutput.create({
      batch_id: batch1.id, input_qty: millingOutput, cleaned_qty: cleanedQty,
      impurity_qty: 120, stone_qty: 50, dust_qty: 30, plant_id: plant.id, created_by: users.production.id,
    });
    await MachineLog.create({
      batch_id: batch1.id, machine_id: machines["SEP-01"].id, operator_id: users.production.id,
      stage: "separator", start_time: new Date(Date.now() - 1.5 * 3600000), end_time: new Date(Date.now() - 1 * 3600000),
      running_hours: 0.5, input_qty: millingOutput, output_qty: cleanedQty,
      recovery_pct: Number(((cleanedQty / millingOutput) * 100).toFixed(2)),
      plant_id: plant.id, created_by: users.production.id,
    });
    await batch1.update({ current_stage: "shiner" });

    console.log("  - Shiner stage (single final pass)...");
    const shinerOutput = 6700;
    const branQty = 250;
    await ShinerProcess.create({
      batch_id: batch1.id, stage_no: 1, machine_id: machines["SHI-01"].id,
      input_qty: cleanedQty, output_qty: shinerOutput, loss_qty: 50, bran_qty: branQty,
      plant_id: plant.id, created_by: users.production.id,
    });
    await MachineLog.create({
      batch_id: batch1.id, machine_id: machines["SHI-01"].id, operator_id: users.production.id,
      stage: "shiner", start_time: new Date(Date.now() - 1 * 3600000), end_time: new Date(Date.now() - 0.5 * 3600000),
      running_hours: 0.5, input_qty: cleanedQty, output_qty: shinerOutput,
      recovery_pct: Number(((shinerOutput / cleanedQty) * 100).toFixed(2)),
      plant_id: plant.id, created_by: users.production.id,
    });
    await Inventory.create({
      lot_id: lot1.id, material_id: materials.bran.id, warehouse_id: null, stage: "by_product",
      qty_in: branQty, qty_out: 0, balance_qty: branQty, as_of: new Date(), plant_id: plant.id, created_by: users.production.id,
    });
    await ByProductInventory.create({ material_id: materials.bran.id, qty_produced: branQty, qty_sold: 0, qty_in_stock: branQty, plant_id: plant.id, created_by: users.production.id });
    await batch1.update({ current_stage: "color_sorter" });

    console.log("  - Color sorter stage...");
    const goodQty = 6550;
    await ColorSorter.create({
      batch_id: batch1.id, input_qty: shinerOutput, good_qty: goodQty, rejected_qty: 150,
      plant_id: plant.id, created_by: users.production.id,
    });
    await MachineLog.create({
      batch_id: batch1.id, machine_id: machines["CS-01"].id, operator_id: users.production.id,
      stage: "color_sorter", start_time: new Date(Date.now() - 0.5 * 3600000), end_time: new Date(),
      running_hours: 0.5, input_qty: shinerOutput, output_qty: goodQty,
      recovery_pct: Number(((goodQty / shinerOutput) * 100).toFixed(2)),
      plant_id: plant.id, created_by: users.production.id,
    });
    await batch1.update({ current_stage: "length_grading" });

    console.log("  - Length grading stage (final)...");
    const longQty = 5200; const mediumQty = 900; const gradingBrokenQty = 350; const smallBrokenQty = 100;
    await LengthGrading.create({
      batch_id: batch1.id, input_qty: goodQty, long_qty: longQty, medium_qty: mediumQty,
      broken_qty: gradingBrokenQty, small_broken_qty: smallBrokenQty, plant_id: plant.id, created_by: users.production.id,
    });
    const totalGradingOutput = longQty + mediumQty + gradingBrokenQty + smallBrokenQty;
    await MachineLog.create({
      batch_id: batch1.id, machine_id: machines["GR-01"].id, operator_id: users.production.id,
      stage: "length_grading", start_time: new Date(Date.now() - 0.25 * 3600000), end_time: new Date(),
      running_hours: 0.25, input_qty: goodQty, output_qty: totalGradingOutput,
      recovery_pct: Number(((totalGradingOutput / goodQty) * 100).toFixed(2)),
      plant_id: plant.id, created_by: users.production.id,
    });
    await batch1.update({ current_stage: "completed", batch_status: "completed" });

    console.log("→ Packing + Finished Goods...");
    const packing_batch_no = await generatePackingBatchNo();
    const barcode = await generateEAN13();
    const bagCount = 200; // 200 x 25kg = 5000kg
    const packSize = "25";
    const productionDate = new Date().toISOString().slice(0, 10);
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 180);
    const packing1 = await Packing.create({
      batch_id: batch1.id,
      lot_id: lot1.id,
      pack_size: packSize,
      bag_count: bagCount,
      batch_no: packing_batch_no,
      barcode,
      qr_code: JSON.stringify({ batch_no: packing_batch_no, lot_no: lot1.lot_no, production_batch_no: batch1.batch_no, production_date: productionDate }),
      production_date: productionDate,
      expiry_date: expiry.toISOString().slice(0, 10),
      packed_by: users.production.id,
      plant_id: plant.id,
      created_by: users.production.id,
    });
    const fgQty = bagCount * Number(packSize);
    const fg1 = await FinishedGoods.create({
      packing_id: packing1.id,
      warehouse_id: fgWarehouse.id,
      qty: fgQty,
      fg_status: "ready",
      ready_since: new Date(),
      plant_id: plant.id,
      created_by: users.production.id,
    });

    console.log("→ Sales order + Dispatch...");
    const so_no = await generateSoNo();
    const so1 = await SalesOrder.create({
      so_no,
      customer_id: customer.id,
      order_type: "fg",
      material_id: materials.rice.id,
      qty: fgQty,
      rate: 42.5,
      order_date: new Date().toISOString().slice(0, 10),
      so_status: "confirmed",
      plant_id: plant.id,
      created_by: users.sales.id,
    });
    const challan_no = await generateChallanNo();
    const dispatch1 = await Dispatch.create({
      so_id: so1.id,
      challan_no,
      vehicle_id: vehicle2.id,
      driver_id: driver2.id,
      dispatch_weight: fgQty,
      dispatch_time: new Date(),
      dispatch_type: "normal",
      dispatch_status: "dispatched",
      plant_id: plant.id,
      created_by: users.dispatch.id,
    });
    await fg1.update({ fg_status: "dispatched", dispatch_id: dispatch1.id });
    await so1.update({ so_status: "dispatched" });

    // =================================================================
    // GOLDEN PATH #2 (short) — a rejected lab verdict, for KPI/report variety
    // =================================================================
    console.log("\n=== Extra: rejected lab verdict cycle ===");
    const token_no2 = await generateTokenNo(vehicle2.vehicle_no);
    const gate2 = await GateEntry.create({
      token_no: token_no2,
      vehicle_id: vehicle2.id,
      driver_id: driver2.id,
      vendor_id: vendor.id,
      po_id: po.id,
      material_id: materials.paddy.id,
      challan_no: "CH-VENDOR-0002",
      expected_qty: 9000,
      entry_time: new Date(),
      gate_status: "waiting_sampling",
      plant_id: plant.id,
      created_by: users.gate.id,
    });
    const sample2 = await Sampling.create({
      gate_entry_id: gate2.id,
      sample_code: `SMP-SEED-${Date.now()}-2`,
      collected_by: users.lab.id,
      collected_at: new Date(),
      plant_id: plant.id,
      created_by: users.lab.id,
    });
    await gate2.update({ gate_status: "sampling_done" });
    await LabTest.create({
      sampling_id: sample2.id,
      moisture_pct: 19.5,
      broken_pct: 12,
      fm_pct: 3.5,
      color: "discolored",
      smell: "musty",
      grain_size: "mixed",
      verdict: "rejected",
      tested_by: users.lab.id,
      tested_at: new Date(),
      plant_id: plant.id,
      created_by: users.lab.id,
    });
    await gate2.update({ gate_status: "rejected" });

    // =================================================================
    // GOLDEN PATH #3 (partial) — still at the gate, for trucks_at_gate KPI
    // =================================================================
    console.log("\n=== Extra: truck still waiting at gate ===");
    const token_no3 = await generateTokenNo(vehicle1.vehicle_no);
    await GateEntry.create({
      token_no: token_no3,
      vehicle_id: vehicle1.id,
      driver_id: driver1.id,
      vendor_id: vendor.id,
      po_id: po.id,
      material_id: materials.paddy.id,
      challan_no: "CH-VENDOR-0003",
      expected_qty: 11000,
      entry_time: new Date(),
      gate_status: "waiting_token",
      plant_id: plant.id,
      created_by: users.gate.id,
    });

    // =================================================================
    // Extra: a second sales order still pending dispatch
    // =================================================================
    console.log("\n=== Extra: pending sales order (not yet dispatched) ===");
    const so_no2 = await generateSoNo();
    await SalesOrder.create({
      so_no: so_no2,
      customer_id: customer.id,
      order_type: "fg",
      material_id: materials.rice.id,
      qty: 2500,
      rate: 43.0,
      order_date: new Date().toISOString().slice(0, 10),
      so_status: "confirmed",
      plant_id: plant.id,
      created_by: users.sales.id,
    });

    // ---------------------------------------------------------------
    console.log("\n✅ Seed complete!\n");
    console.log("Login credentials (all passwords: test123):");
    roleNames.forEach((r) => console.log(`  ${r.padEnd(12)} -> ${r}1@ricemill.com`));
    console.log("\nKey generated records:");
    console.log(`  Gate entry #1 (full cycle, now 'unloaded'): token ${token_no}, id ${gate1.id}`);
    console.log(`  Gate entry #2 (rejected): token ${token_no2}, id ${gate2.id}`);
    console.log(`  Gate entry #3 (waiting_token): token ${token_no3}`);
    console.log(`  Lot: ${lot_no}`);
    console.log(`  Production batch: ${batch_no} (completed)`);
    console.log(`  Packing: ${packing_batch_no}, barcode ${barcode}`);
    console.log(`  Sales order #1: ${so_no} (dispatched), Sales order #2: ${so_no2} (confirmed, pending)`);
    console.log(`  Dispatch: ${challan_no} — try GET /api/dispatches/${dispatch1.id}/challan`);

    process.exit(0);
  } catch (err) {
    console.error("\n❌ Seed failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();