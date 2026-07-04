const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// TODO: implement full column definitions. Reference fields (from architecture doc):
// material_id (FK: husk/bran/broken), qty_produced, qty_sold, qty_in_stock
//
// Common columns applied to every table per architecture doc section 7 (not repeated per-model):
// id (PK), created_by (FK->users.id), updated_by (FK->users.id), created_at, updated_at,
// status (ENUM), is_deleted (BOOLEAN), plant_id (FK, multi-plant scalability)

class ByProductInventory extends Model {}

ByProductInventory.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // TODO: add remaining fields listed above
  },
  {
    sequelize,
    modelName: "ByProductInventory",
    tableName: "by_product_inventory",
    timestamps: true,
    underscored: true,
  }
);

module.exports = ByProductInventory;
