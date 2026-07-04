const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// TODO: implement full column definitions. Reference fields (from architecture doc):
// batch_id (FK), check_level(bag/lot), accepted_qty, rejected_qty, reason_code_id (FK), action(replace/refund/scrap), checked_by (FK)
//
// Common columns applied to every table per architecture doc section 7 (not repeated per-model):
// id (PK), created_by (FK->users.id), updated_by (FK->users.id), created_at, updated_at,
// status (ENUM), is_deleted (BOOLEAN), plant_id (FK, multi-plant scalability)

class QualityCheck extends Model {}

QualityCheck.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // TODO: add remaining fields listed above
  },
  {
    sequelize,
    modelName: "QualityCheck",
    tableName: "quality_check",
    timestamps: true,
    underscored: true,
  }
);

module.exports = QualityCheck;
