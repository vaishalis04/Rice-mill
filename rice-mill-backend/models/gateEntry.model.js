const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class GateEntry extends Model {}

GateEntry.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    token_no: { type: DataTypes.STRING(30), allowNull: false, unique: true }, // sequential
    vehicle_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "vehicles", key: "id" } },
    driver_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "drivers", key: "id" } },
    driver_photo_url: { type: DataTypes.STRING(255) },
    // entry_type: "purchase" (default) is the normal vendor-delivery flow
    // (Gate -> Sampling -> Lab -> Negotiation -> Weighbridge -> Unloading).
    // "other" is for empty trucks or trucks carrying miscellaneous/non-purchase
    // items — these skip Sampling/Lab/Negotiation entirely and go straight
    // from the gate to Weighbridge (optional) and then Warehouse.
    entry_type: { type: DataTypes.ENUM("purchase", "other"), allowNull: false, defaultValue: "purchase" },
    // Only required for entry_type = "purchase"; empty/misc trucks usually
    // have no vendor or material master record to link.
    vendor_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "vendors", key: "id" } },
    po_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "purchase_order", key: "id" } },
    challan_no: { type: DataTypes.STRING(30) },
    material_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "material_master", key: "id" } },
    expected_qty: { type: DataTypes.DECIMAL(12, 2) },
    // Free-text note for entry_type = "other", e.g. "Empty truck — returning
    // from delivery" or "Dropping off packaging material, not for sale".
    remarks: { type: DataTypes.STRING(255), allowNull: true },
    // Set when an entry_type = "other" truck is sent straight to warehouse
    // (see gate.controller.js#sendToWarehouse) — which warehouse received it,
    // for the "Empty / Misc Trucks" listing. Not used by the purchase flow
    // (that stock is tracked via Lot/Stack instead).
    received_warehouse_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "warehouse_master", key: "id" } },
    entry_time: { type: DataTypes.DATE },
    exit_time: { type: DataTypes.DATE, allowNull: true },
gate_status: {
  type: DataTypes.ENUM(
    "waiting_token",
    "waiting_sampling",
    "sampling_done",
    "accepted",
    "rejected",
    // Checked-in state for entry_type = "other" only — the equivalent of
    // "waiting_sampling" for entries that skip QC entirely and go straight
    // toward the weighbridge (or directly to warehouse if nothing to weigh).
    "waiting_weighment",
    "in_process",
    // Truck opened for unloading, manual check happening at the factory,
    // bags not yet counted (set by POST /api/lots/start-unloading).
    "unloading",
    "unloaded",
    "parked",
    "exited"
  ),
  defaultValue: "waiting_token"
},
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "GateEntry",
    tableName: "gate_entry",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
    indexes: [
      { fields: ["gate_status"] },
    ],
  }
);

module.exports = GateEntry;