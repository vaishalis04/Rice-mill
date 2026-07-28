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
    fg_status: { type: DataTypes.ENUM("ready", "on_hold", "aging", "dispatched"), defaultValue: "ready" }, 
    dispatch_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "dispatch", key: "id" } },
    ready_since: { type: DataTypes.DATE }, 
    aged_days: { type: DataTypes.VIRTUAL, get() { const s = this.getDataValue("ready_since"); return s ? Math.floor((Date.now() - new Date(s)) / 86400000) : null; } },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, 
  },
  {
    sequelize,
    modelName: "FinishedGoods",
    tableName: "finished_goods",
    timestamps: true,
    underscored: true,
    paranoid: false, 
  }
);

module.exports = FinishedGoods;
