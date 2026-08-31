const sequelize = require("../config/db");

// -- Model imports ----------------------------------------------------------
const User = require("./user.model");
const Role = require("./role.model");
const Permission = require("./permission.model");
const RolePermission = require("./rolePermission.model");
const Vendor = require("./vendor.model");
const Customer = require("./customer.model");
const Driver = require("./driver.model");
const Vehicle = require("./vehicle.model");
const MaterialMaster = require("./materialMaster.model");
const VarietyMaster = require("./varietyMaster.model");
const WarehouseMaster = require("./warehouseMaster.model");
const BinStackMaster = require("./binStackMaster.model");
const MachineMaster = require("./machineMaster.model");
const UomMaster = require("./uomMaster.model");
const RateMaster = require("./rateMaster.model");
const QualityParameterMaster = require("./qualityParameterMaster.model");
const ReasonCodeMaster = require("./reasonCodeMaster.model");
const PlantMaster = require("./plantMaster.model");
const PurchaseOrder = require("./purchaseOrder.model");
const GateEntry = require("./gateEntry.model");
const GateEntryPurchaseOrder = require("./gateEntryPurchaseOrder.model");
const Sampling = require("./sampling.model");
const LabTest = require("./labTest.model");
const Negotiation = require("./negotiation.model");
const WeightSlip = require("./weightSlip.model");
const Loading = require("./loading.model");
const Purchase = require("./purchase.model");
const Lot = require("./lot.model");
const Stack = require("./stack.model");
const Inventory = require("./inventory.model");
const QualityCheck = require("./qualityCheck.model");
const Dryer = require("./dryer.model");
const ProductionBatch = require("./productionBatch.model");
const MachineLog = require("./machineLog.model");
const SeparatorOutput = require("./separatorOutput.model");
const ShinerProcess = require("./shinerProcess.model");
const ColorSorter = require("./colorSorter.model");
const LengthGrading = require("./lengthGrading.model");
const Packing = require("./packing.model");
const FinishedGoods = require("./finishedGoods.model");
const RejectMaterial = require("./rejectMaterial.model");
const WasteManagement = require("./wasteManagement.model");
const ByProductInventory = require("./byProductInventory.model");
const SalesOrder = require("./salesOrder.model");
const Dispatch = require("./dispatch.model");
const StockMovement = require("./stockMovement.model");
const Invoice = require("./invoice.model");
const Payment = require("./payment.model");
const MachineMaintenance = require("./machineMaintenance.model");
const AuditLog = require("./auditLog.model");
const Notification = require("./notification.model");
const ProcessTimeLog = require("./processTimeLog.model");
const GateEntrySalesOrder = require("./gateEntrySalesOrder.model");

// -- Associations -------------------------------------------------------------
// Every belongsTo below has an implicit inverse (hasMany/hasOne) that callers
// can add as needed, e.g.:
//   Vendor.hasMany(GateEntry, { foreignKey: "vendor_id", as: "gateEntries" });
// Only the belongsTo side is declared here since that's what drives the FK
// column placement; add inverse associations as each module needs eager-loading.

User.belongsTo(Role, { foreignKey: "role_id", as: "role" });
RolePermission.belongsTo(Role, { foreignKey: "role_id", as: "role" });
RolePermission.belongsTo(Permission, {
  foreignKey: "permission_id",
  as: "permission",
});
Vehicle.belongsTo(Vendor, { foreignKey: "owner_vendor_id", as: "ownerVendor" });
MaterialMaster.belongsTo(UomMaster, { foreignKey: "uom_id", as: "uom" });
MaterialMaster.belongsTo(VarietyMaster, {
  foreignKey: "variety_id",
  as: "variety",
});
BinStackMaster.belongsTo(WarehouseMaster, {
  foreignKey: "warehouse_id",
  as: "warehouse",
});
RateMaster.belongsTo(MaterialMaster, {
  foreignKey: "material_id",
  as: "material",
});
RateMaster.belongsTo(VarietyMaster, {
  foreignKey: "variety_id",
  as: "variety",
});
PurchaseOrder.belongsTo(Vendor, { foreignKey: "vendor_id", as: "vendor" });
PurchaseOrder.belongsTo(MaterialMaster, {
  foreignKey: "material_id",
  as: "material",
});
PurchaseOrder.belongsTo(VarietyMaster, {
  foreignKey: "variety_id",
  as: "variety",
});
GateEntry.belongsTo(Vehicle, { foreignKey: "vehicle_id", as: "vehicle" });
GateEntry.belongsTo(Driver, { foreignKey: "driver_id", as: "driver" });
GateEntry.belongsTo(Vendor, { foreignKey: "vendor_id", as: "vendor" });
GateEntry.belongsTo(PurchaseOrder, {
  foreignKey: "po_id",
  as: "purchaseOrder",
});
GateEntry.belongsTo(MaterialMaster, {
  foreignKey: "material_id",
  as: "material",
});
GateEntry.belongsTo(SalesOrder, { foreignKey: "so_id", as: "salesOrder" }); // entry_type = "sales" only
Sampling.belongsTo(GateEntry, { foreignKey: "gate_entry_id", as: "gateEntry" });
Sampling.hasOne(LabTest, { foreignKey: "sampling_id", as: "labTest" });
GateEntry.hasMany(Sampling, { foreignKey: "gate_entry_id", as: "samplings" });
Sampling.belongsTo(User, { foreignKey: "collected_by", as: "collector" });
LabTest.belongsTo(Sampling, { foreignKey: "sampling_id", as: "sampling" });
LabTest.belongsTo(VarietyMaster, {
  foreignKey: "variety_detected",
  as: "detectedVariety",
});
LabTest.belongsTo(User, { foreignKey: "tested_by", as: "tester" });
Negotiation.belongsTo(LabTest, { foreignKey: "lab_test_id", as: "labTest" });
Negotiation.belongsTo(User, { foreignKey: "negotiated_by", as: "negotiator" });
WeightSlip.belongsTo(GateEntry, {
  foreignKey: "gate_entry_id",
  as: "gateEntry",
});
WeightSlip.belongsTo(User, {
  foreignKey: "weighbridge_operator_id",
  as: "operator",
});

Loading.belongsTo(GateEntry, { foreignKey: "gate_entry_id", as: "gateEntry" });
Loading.belongsTo(SalesOrder, { foreignKey: "so_id", as: "salesOrder" });
Loading.belongsTo(User, { foreignKey: "loading_operator_id", as: "operator" });
GateEntry.hasOne(Loading, { foreignKey: "gate_entry_id", as: "loading" });
Purchase.belongsTo(PurchaseOrder, { foreignKey: "po_id", as: "purchaseOrder" });
Purchase.belongsTo(GateEntry, { foreignKey: "gate_entry_id", as: "gateEntry" });
Purchase.belongsTo(WeightSlip, {
  foreignKey: "weight_slip_id",
  as: "weightSlip",
});
Lot.belongsTo(Purchase, { foreignKey: "purchase_id", as: "purchase" });
Lot.belongsTo(MaterialMaster, { foreignKey: "material_id", as: "material" });
Lot.belongsTo(VarietyMaster, { foreignKey: "variety_id", as: "variety" });
Lot.belongsTo(Lot, { foreignKey: "parent_lot_id", as: "parentLot" });
Lot.belongsTo(WarehouseMaster, {
  foreignKey: "warehouse_id",
  as: "targetWarehouse",
}); // chosen at Start Unloading, before the Stack exists
Lot.belongsTo(BinStackMaster, { foreignKey: "bin_id", as: "targetBin" });
Stack.belongsTo(Lot, { foreignKey: "lot_id", as: "lot" });
Lot.hasMany(Stack, { foreignKey: "lot_id", as: "stacks" });
Stack.belongsTo(WarehouseMaster, {
  foreignKey: "warehouse_id",
  as: "warehouse",
});
Stack.belongsTo(BinStackMaster, { foreignKey: "bin_id", as: "bin" });
Inventory.belongsTo(Lot, { foreignKey: "lot_id", as: "lot" });
Inventory.belongsTo(MaterialMaster, {
  foreignKey: "material_id",
  as: "material",
});
Inventory.belongsTo(WarehouseMaster, {
  foreignKey: "warehouse_id",
  as: "warehouse",
});
QualityCheck.belongsTo(ProductionBatch, {
  foreignKey: "batch_id",
  as: "batch",
});
QualityCheck.belongsTo(ReasonCodeMaster, {
  foreignKey: "reason_code_id",
  as: "reasonCode",
});
QualityCheck.belongsTo(User, { foreignKey: "checked_by", as: "checker" });
Dryer.belongsTo(ProductionBatch, { foreignKey: "batch_id", as: "batch" });
Dryer.belongsTo(MachineMaster, { foreignKey: "machine_id", as: "machine" });
ProductionBatch.belongsTo(Lot, { foreignKey: "lot_id", as: "lot" });
MachineLog.belongsTo(ProductionBatch, { foreignKey: "batch_id", as: "batch" });
MachineLog.belongsTo(MachineMaster, {
  foreignKey: "machine_id",
  as: "machine",
});
MachineLog.belongsTo(User, { foreignKey: "operator_id", as: "operator" });
MachineLog.belongsTo(ReasonCodeMaster, {
  foreignKey: "downtime_reason_id",
  as: "downtimeReason",
});
SeparatorOutput.belongsTo(ProductionBatch, {
  foreignKey: "batch_id",
  as: "batch",
});
ShinerProcess.belongsTo(ProductionBatch, {
  foreignKey: "batch_id",
  as: "batch",
});
ShinerProcess.belongsTo(MachineMaster, {
  foreignKey: "machine_id",
  as: "machine",
});
ColorSorter.belongsTo(ProductionBatch, { foreignKey: "batch_id", as: "batch" });
LengthGrading.belongsTo(ProductionBatch, {
  foreignKey: "batch_id",
  as: "batch",
});
ProductionBatch.hasOne(Dryer, { foreignKey: "batch_id", as: "dryer" });
ProductionBatch.hasMany(MachineLog, {
  foreignKey: "batch_id",
  as: "machineLogs",
});
ProductionBatch.hasOne(SeparatorOutput, {
  foreignKey: "batch_id",
  as: "separatorOutput",
});
ProductionBatch.hasMany(ShinerProcess, {
  foreignKey: "batch_id",
  as: "shinerStages",
});
ProductionBatch.hasOne(ColorSorter, {
  foreignKey: "batch_id",
  as: "colorSorter",
});
ProductionBatch.hasOne(LengthGrading, {
  foreignKey: "batch_id",
  as: "lengthGrading",
});
ProcessTimeLog.belongsTo(ProductionBatch, {
  foreignKey: "batch_id",
  as: "batch",
});
Packing.belongsTo(ProductionBatch, { foreignKey: "batch_id", as: "batch" });
Packing.belongsTo(Lot, { foreignKey: "lot_id", as: "outputLot" });
Packing.belongsTo(User, { foreignKey: "packed_by", as: "packer" });
FinishedGoods.belongsTo(Packing, { foreignKey: "packing_id", as: "packing" });
FinishedGoods.belongsTo(WarehouseMaster, {
  foreignKey: "warehouse_id",
  as: "warehouse",
});
ProductionBatch.hasMany(Packing, { foreignKey: "batch_id", as: "packings" });
Packing.hasMany(FinishedGoods, {
  foreignKey: "packing_id",
  as: "finishedGoodsRecords",
});
RejectMaterial.belongsTo(ProductionBatch, {
  foreignKey: "batch_id",
  as: "batch",
});
RejectMaterial.belongsTo(ReasonCodeMaster, {
  foreignKey: "reason_code_id",
  as: "reasonCode",
});
WasteManagement.belongsTo(ProductionBatch, {
  foreignKey: "batch_id",
  as: "batch",
});
ByProductInventory.belongsTo(MaterialMaster, {
  foreignKey: "material_id",
  as: "material",
});
SalesOrder.belongsTo(Customer, { foreignKey: "customer_id", as: "customer" });
SalesOrder.belongsTo(MaterialMaster, {
  foreignKey: "material_id",
  as: "material",
});
Dispatch.belongsTo(SalesOrder, { foreignKey: "so_id", as: "salesOrder" });
Dispatch.belongsTo(Invoice, { foreignKey: "invoice_id", as: "invoice" });
Dispatch.belongsTo(Vehicle, { foreignKey: "vehicle_id", as: "vehicle" });
Dispatch.belongsTo(Driver, { foreignKey: "driver_id", as: "driver" });
Dispatch.hasMany(FinishedGoods, {
  foreignKey: "dispatch_id",
  as: "allocatedStock",
});
FinishedGoods.belongsTo(Dispatch, {
  foreignKey: "dispatch_id",
  as: "dispatch",
});
StockMovement.belongsTo(MaterialMaster, {
  foreignKey: "material_id",
  as: "material",
});
StockMovement.belongsTo(Lot, { foreignKey: "lot_id", as: "lot" });
Invoice.belongsTo(Dispatch, { foreignKey: "dispatch_id", as: "dispatch" });
Invoice.belongsTo(Customer, { foreignKey: "customer_id", as: "customer" });
Payment.belongsTo(Invoice, { foreignKey: "invoice_id", as: "invoice" });
MachineMaintenance.belongsTo(MachineMaster, {
  foreignKey: "machine_id",
  as: "machine",
});
AuditLog.belongsTo(User, { foreignKey: "performed_by", as: "performer" });
Notification.belongsTo(User, { foreignKey: "user_id", as: "user" });
Notification.belongsTo(Role, { foreignKey: "role_id", as: "role" });
User.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
Vendor.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
Customer.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
Driver.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
Vehicle.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
MaterialMaster.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
VarietyMaster.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
WarehouseMaster.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
BinStackMaster.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
MachineMaster.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
UomMaster.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
RateMaster.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
QualityParameterMaster.belongsTo(PlantMaster, {
  foreignKey: "plant_id",
  as: "plant",
});
ReasonCodeMaster.belongsTo(PlantMaster, {
  foreignKey: "plant_id",
  as: "plant",
});
PurchaseOrder.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
GateEntry.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
GateEntry.belongsTo(WarehouseMaster, {
  foreignKey: "received_warehouse_id",
  as: "receivedWarehouse",
});
Sampling.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
LabTest.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
Negotiation.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
WeightSlip.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
Loading.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
Purchase.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
Lot.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
Stack.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
Inventory.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
QualityCheck.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
Dryer.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
ProductionBatch.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
MachineLog.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
SeparatorOutput.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
ShinerProcess.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
ColorSorter.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
LengthGrading.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
Packing.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
FinishedGoods.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
RejectMaterial.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
WasteManagement.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
ByProductInventory.belongsTo(PlantMaster, {
  foreignKey: "plant_id",
  as: "plant",
});
SalesOrder.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
Dispatch.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
StockMovement.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
Invoice.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
Payment.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
MachineMaintenance.belongsTo(PlantMaster, {
  foreignKey: "plant_id",
  as: "plant",
});
ProcessTimeLog.belongsTo(PlantMaster, { foreignKey: "plant_id", as: "plant" });
GateEntry.hasMany(GateEntryPurchaseOrder, {
  foreignKey: "gate_entry_id",
  as: "purchaseOrders",
});

GateEntryPurchaseOrder.belongsTo(GateEntry, {
  foreignKey: "gate_entry_id",
  as: "gateEntry",
});

GateEntryPurchaseOrder.belongsTo(PurchaseOrder, {
  foreignKey: "po_id",
  as: "purchaseOrder",
});

GateEntryPurchaseOrder.belongsTo(MaterialMaster, {
  foreignKey: "material_id",
  as: "material",
});
// NOTE: Sampling.material_id and Sampling.po_id are DataTypes.JSON (arrays) —
// a single sampling record can cover multiple materials/POs pulled from a
// multi-material gate entry (see sampling.controller.js). These associations
// are kept (with constraints:false) purely so sampling.controller.js's
// `detailIncludes` can still eager-load a single related row via `include`;
// constraints:false stops Sequelize from trying to create a real DB-level FK
// constraint on a JSON column, which was breaking schema sync.
Sampling.belongsTo(MaterialMaster, {
  foreignKey: "material_id",
  as: "material",
  constraints: false,
});
Sampling.belongsTo(PurchaseOrder, {
  foreignKey: "po_id",
  as: "purchaseOrder",
  constraints: false,
});

GateEntry.hasMany(GateEntryPurchaseOrder, {
  foreignKey: "gate_entry_id",
  as: "purchase_orders",
});
GateEntry.hasMany(GateEntrySalesOrder, {
  foreignKey: "gate_entry_id",
  as: "sales_orders",
});

GateEntrySalesOrder.belongsTo(GateEntry, {
  foreignKey: "gate_entry_id",
  as: "gate_entry",
});

SalesOrder.hasMany(GateEntrySalesOrder, {
  foreignKey: "so_id",
  as: "gate_entries",
});

GateEntrySalesOrder.belongsTo(SalesOrder, {
  foreignKey: "so_id",
  as: "sales_order",
});

MaterialMaster.hasMany(GateEntrySalesOrder, {
  foreignKey: "material_id",
  as: "gate_entry_sales_orders",
});

GateEntrySalesOrder.belongsTo(MaterialMaster, {
  foreignKey: "material_id",
  as: "material",
});

module.exports = {
  sequelize,
  User,
  Role,
  Permission,
  RolePermission,
  Vendor,
  Customer,
  Driver,
  Vehicle,
  MaterialMaster,
  VarietyMaster,
  WarehouseMaster,
  BinStackMaster,
  MachineMaster,
  UomMaster,
  RateMaster,
  QualityParameterMaster,
  ReasonCodeMaster,
  PlantMaster,
  PurchaseOrder,
  GateEntry,
  GateEntryPurchaseOrder,
  Sampling,
  LabTest,
  Negotiation,
  WeightSlip,
  Loading,
  Purchase,
  Lot,
  Stack,
  Inventory,
  QualityCheck,
  Dryer,
  ProductionBatch,
  MachineLog,
  SeparatorOutput,
  ShinerProcess,
  ColorSorter,
  LengthGrading,
  Packing,
  FinishedGoods,
  RejectMaterial,
  WasteManagement,
  ByProductInventory,
  SalesOrder,
  Dispatch,
  StockMovement,
  Invoice,
  Payment,
  MachineMaintenance,
  GateEntrySalesOrder,
  AuditLog,
  Notification,
  ProcessTimeLog,
};