const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// TODO: implement full column definitions. Reference fields (from architecture doc):
// po_id (FK), gate_entry_id (FK), weight_slip_id (FK), final_rate, final_qty, amount, purchase_date
//
// Common columns applied to every table per architecture doc section 7 (not repeated per-model):
// id (PK), created_by (FK->users.id), updated_by (FK->users.id), created_at, updated_at,
// status (ENUM), is_deleted (BOOLEAN), plant_id (FK, multi-plant scalability)

class Purchase extends Model {}

Purchase.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // TODO: add remaining fields listed above
  },
  {
    sequelize,
    modelName: "Purchase",
    tableName: "purchase",
    timestamps: true,
    underscored: true,
  }
);

module.exports = Purchase;
