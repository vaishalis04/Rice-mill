const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// TODO: implement full column definitions. Reference fields (from architecture doc):
// material_id (FK), lot_id (FK), from_location, to_location, qty, movement_type(in/out/transfer), moved_at
//
// Common columns applied to every table per architecture doc section 7 (not repeated per-model):
// id (PK), created_by (FK->users.id), updated_by (FK->users.id), created_at, updated_at,
// status (ENUM), is_deleted (BOOLEAN), plant_id (FK, multi-plant scalability)

class StockMovement extends Model {}

StockMovement.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // TODO: add remaining fields listed above
  },
  {
    sequelize,
    modelName: "StockMovement",
    tableName: "stock_movement",
    timestamps: true,
    underscored: true,
  }
);

module.exports = StockMovement;
