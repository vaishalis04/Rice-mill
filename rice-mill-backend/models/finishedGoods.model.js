const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// TODO: implement full column definitions. Reference fields (from architecture doc):
// packing_id (FK), warehouse_id (FK), rack_id, pallet_id, qty, status(ready/on_hold/aging/dispatched), aged_days (computed)
//
// Common columns applied to every table per architecture doc section 7 (not repeated per-model):
// id (PK), created_by (FK->users.id), updated_by (FK->users.id), created_at, updated_at,
// status (ENUM), is_deleted (BOOLEAN), plant_id (FK, multi-plant scalability)

class FinishedGoods extends Model {}

FinishedGoods.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // TODO: add remaining fields listed above
  },
  {
    sequelize,
    modelName: "FinishedGoods",
    tableName: "finished_goods",
    timestamps: true,
    underscored: true,
  }
);

module.exports = FinishedGoods;
