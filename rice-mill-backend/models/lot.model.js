const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// TODO: implement full column definitions. Reference fields (from architecture doc):
// lot_no (UNIQUE), purchase_id (FK, nullable), material_id (FK), variety_id (FK), qty, parent_lot_id (FK self)
//
// Common columns applied to every table per architecture doc section 7 (not repeated per-model):
// id (PK), created_by (FK->users.id), updated_by (FK->users.id), created_at, updated_at,
// status (ENUM), is_deleted (BOOLEAN), plant_id (FK, multi-plant scalability)

class Lot extends Model {}

Lot.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // TODO: add remaining fields listed above
  },
  {
    sequelize,
    modelName: "Lot",
    tableName: "lots",
    timestamps: true,
    underscored: true,
  }
);

module.exports = Lot;
