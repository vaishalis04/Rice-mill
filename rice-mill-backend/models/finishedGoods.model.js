const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class FinishedGoods extends Model {}

FinishedGoods.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    packing_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "packing", key: "id" } },
    warehouse_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "warehouse_master", key: "id" } },
    rack_id: { type: DataTypes.STRING(30) },
    pallet_id: { type: DataTypes.STRING(30) },
    qty: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    fg_status: { type: DataTypes.ENUM("ready", "on_hold", "aging", "dispatched"), defaultValue: "ready" }, // renamed from generic "status"
    dispatch_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "dispatch", key: "id" } }, // set when allocated to a Dispatch (Module 19)
    ready_since: { type: DataTypes.DATE }, // drives the aged_days virtual below — note #24
    aged_days: { type: DataTypes.VIRTUAL, get() { const s = this.getDataValue("ready_since"); return s ? Math.floor((Date.now() - new Date(s)) / 86400000) : null; } },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "FinishedGoods",
    tableName: "finished_goods",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = FinishedGoods;
