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
    entry_type: { type: DataTypes.ENUM("purchase", "other", "sales"), allowNull: false, defaultValue: "purchase" },
    vendor_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "vendors", key: "id" } },
    po_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "purchase_order", key: "id" } },
    so_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "sales_order", key: "id" } },
    challan_no: { type: DataTypes.STRING(30) },
    material_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "material_master", key: "id" } },
    expected_qty: { type: DataTypes.DECIMAL(12, 2) },
    remarks: { type: DataTypes.STRING(255), allowNull: true },
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
    "waiting_weighment",
    "in_process",
    "unloading",
    "unloaded",
    "waiting_loading",
    "loaded",
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
    paranoid: false,
    indexes: [
      { fields: ["gate_status"] },
    ],
  }
);

module.exports = GateEntry;