const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// TODO: implement full column definitions. Reference fields (from architecture doc):
// po_no, vendor_id (FK), material_id (FK), variety_id (FK), qty, rate, po_date, validity, do_no, uploaded_by_vendor (BOOLEAN)
//
// Common columns applied to every table per architecture doc section 7 (not repeated per-model):
// id (PK), created_by (FK->users.id), updated_by (FK->users.id), created_at, updated_at,
// status (ENUM), is_deleted (BOOLEAN), plant_id (FK, multi-plant scalability)

class PurchaseOrder extends Model {}

PurchaseOrder.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // TODO: add remaining fields listed above
  },
  {
    sequelize,
    modelName: "PurchaseOrder",
    tableName: "purchase_order",
    timestamps: true,
    underscored: true,
  }
);

module.exports = PurchaseOrder;
