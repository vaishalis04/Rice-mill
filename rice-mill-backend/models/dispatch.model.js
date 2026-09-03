const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Dispatch extends Model {}

Dispatch.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    so_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "sales_order", key: "id" } },
    challan_no: { type: DataTypes.STRING(30), allowNull: false, unique: "dispatch_challan_no_unique" },
    invoice_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "invoices", key: "id" } },
    vehicle_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "vehicles", key: "id" } },
    driver_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "drivers", key: "id" } },
    dispatch_weight: { type: DataTypes.DECIMAL(12, 2) },
    dispatch_time: { type: DataTypes.DATE },
    dispatch_type: { type: DataTypes.ENUM("normal", "direct_outward"), defaultValue: "normal" }, // note #23: direct outward skips FG warehouse
    dispatch_status: { type: DataTypes.ENUM("pending", "dispatched", "delivered", "cancelled"), defaultValue: "pending" },
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