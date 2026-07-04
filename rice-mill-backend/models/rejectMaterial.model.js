const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// TODO: implement full column definitions. Reference fields (from architecture doc):
// source_stage, batch_id (FK), qty, reason_code_id (FK), disposition(rework/scrap/return-to-vendor)
//
// Common columns applied to every table per architecture doc section 7 (not repeated per-model):
// id (PK), created_by (FK->users.id), updated_by (FK->users.id), created_at, updated_at,
// status (ENUM), is_deleted (BOOLEAN), plant_id (FK, multi-plant scalability)

class RejectMaterial extends Model {}

RejectMaterial.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // TODO: add remaining fields listed above
  },
  {
    sequelize,
    modelName: "RejectMaterial",
    tableName: "reject_material",
    timestamps: true,
    underscored: true,
  }
);

module.exports = RejectMaterial;
