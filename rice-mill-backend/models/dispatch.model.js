const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// TODO: implement full column definitions. Reference fields (from architecture doc):
// so_id (FK), challan_no, invoice_id (FK), vehicle_id (FK), driver_id (FK), dispatch_weight, dispatch_time, dispatch_type(normal/direct-outward)
//
// Common columns applied to every table per architecture doc section 7 (not repeated per-model):
// id (PK), created_by (FK->users.id), updated_by (FK->users.id), created_at, updated_at,
// status (ENUM), is_deleted (BOOLEAN), plant_id (FK, multi-plant scalability)

class Dispatch extends Model {}

Dispatch.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // TODO: add remaining fields listed above
  },
  {
    sequelize,
    modelName: "Dispatch",
    tableName: "dispatch",
    timestamps: true,
    underscored: true,
  }
);

module.exports = Dispatch;
