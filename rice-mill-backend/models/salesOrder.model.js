const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// TODO: implement full column definitions. Reference fields (from architecture doc):
// so_no, customer_id (FK), order_type(FG/by-product), material_id (FK), qty, rate, order_date, status
//
// Common columns applied to every table per architecture doc section 7 (not repeated per-model):
// id (PK), created_by (FK->users.id), updated_by (FK->users.id), created_at, updated_at,
// status (ENUM), is_deleted (BOOLEAN), plant_id (FK, multi-plant scalability)

class SalesOrder extends Model {}

SalesOrder.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // TODO: add remaining fields listed above
  },
  {
    sequelize,
    modelName: "SalesOrder",
    tableName: "sales_order",
    timestamps: true,
    underscored: true,
  }
);

module.exports = SalesOrder;
