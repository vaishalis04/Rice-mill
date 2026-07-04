const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// TODO: implement full column definitions. Reference fields (from architecture doc):
// token_no (UNIQUE), vehicle_id (FK), driver_id (FK), driver_photo_url, vendor_id (FK), po_id (FK, nullable), challan_no, material_id (FK), expected_qty, entry_time, exit_time, gate_status
//
// Common columns applied to every table per architecture doc section 7 (not repeated per-model):
// id (PK), created_by (FK->users.id), updated_by (FK->users.id), created_at, updated_at,
// status (ENUM), is_deleted (BOOLEAN), plant_id (FK, multi-plant scalability)

class GateEntry extends Model {}

GateEntry.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // TODO: add remaining fields listed above
  },
  {
    sequelize,
    modelName: "GateEntry",
    tableName: "gate_entry",
    timestamps: true,
    underscored: true,
  }
);

module.exports = GateEntry;
