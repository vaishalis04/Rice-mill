const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Dispatch extends Model {}

Dispatch.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    so_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "sales_order", key: "id" } },
    challan_no: { type: DataTypes.STRING(30), allowNull: false, unique: "dispatch_challan_no_unique" },
    invoice_id: { type: DataTypes.BIGINT, allowNull: true }, // back-reference, populated after the Invoice is created — no FK constraint here to avoid a circular dependency with Invoice.dispatch_id (see models/index.js)
    vehicle_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "vehicles", key: "id" } },
    driver_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "drivers", key: "id" } },
    dispatch_weight: { type: DataTypes.DECIMAL(12, 2) },
    dispatch_time: { type: DataTypes.DATE },
    dispatch_type: { type: DataTypes.ENUM("normal", "direct_outward"), defaultValue: "normal" }, // note #23: direct outward skips FG warehouse
    dispatch_status: { type: DataTypes.ENUM("pending", "dispatched", "delivered", "cancelled"), defaultValue: "pending" },
    // --- Transport tracking (added for the "Daily Outward" logistics report) ---
    // All nullable/optional — filled in by ops as the truck is followed up on
    // after dispatch; none of this blocks or changes the existing dispatch flow.
    transporter_name: { type: DataTypes.STRING(100), allowNull: true },
    destination: { type: DataTypes.STRING(150), allowNull: true }, // "To" column
    transit_location_note: { type: DataTypes.STRING(255), allowNull: true }, // e.g. "on the way", "Gadi phuch gai he sir ji"
    transit_position_note: { type: DataTypes.STRING(100), allowNull: true }, // e.g. "1 Day", "Call No Received"
    unloading_date: { type: DataTypes.DATEONLY, allowNull: true },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "Dispatch",
    tableName: "dispatch",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = Dispatch;