const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// TODO: implement full column definitions. Reference fields (from architecture doc):
// batch_id (FK), lot_id (FK output), pack_size(5/10/25/50/custom), bag_count, batch_no, qr_code, barcode, production_date, expiry_date, packed_by (FK)
//
// Common columns applied to every table per architecture doc section 7 (not repeated per-model):
// id (PK), created_by (FK->users.id), updated_by (FK->users.id), created_at, updated_at,
// status (ENUM), is_deleted (BOOLEAN), plant_id (FK, multi-plant scalability)

class Packing extends Model {}

Packing.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // TODO: add remaining fields listed above
  },
  {
    sequelize,
    modelName: "Packing",
    tableName: "packing",
    timestamps: true,
    underscored: true,
  }
);

module.exports = Packing;
