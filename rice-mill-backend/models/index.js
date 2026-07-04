const sequelize = require("../config/db");

// -- Model imports --------------------------------------------------------
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
const Sampling = require("./sampling.model");
const LabTest = require("./labTest.model");
const Negotiation = require("./negotiation.model");
const WeightSlip = require("./weightSlip.model");
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

// -- Associations -----------------------------------------------------------
// TODO: define associations between models here, grouped by module, e.g.:
// GateEntry.belongsTo(Vendor, { foreignKey: "vendor_id", as: "vendor" });
// GateEntry.hasOne(Sampling, { foreignKey: "gate_entry_id", as: "sample" });
// ProductionBatch.hasMany(MachineLog, { foreignKey: "batch_id", as: "machineLogs" });
// ... (see Rice-Mill-ERP-Design.html Section 6 ER Diagram / Section 8 Relationships)

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
  Sampling,
  LabTest,
  Negotiation,
  WeightSlip,
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
  AuditLog,
  Notification,
};
