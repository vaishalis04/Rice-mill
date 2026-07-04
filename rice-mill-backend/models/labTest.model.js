const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// TODO: implement full column definitions. Reference fields (from architecture doc):
// sampling_id (FK), moisture_pct, broken_pct, fm_pct, color, smell, variety_detected, grain_size, verdict, tested_by (FK), tested_at
//
// Common columns applied to every table per architecture doc section 7 (not repeated per-model):
// id (PK), created_by (FK->users.id), updated_by (FK->users.id), created_at, updated_at,
// status (ENUM), is_deleted (BOOLEAN), plant_id (FK, multi-plant scalability)

class LabTest extends Model {}

LabTest.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // TODO: add remaining fields listed above
  },
  {
    sequelize,
    modelName: "LabTest",
    tableName: "lab_test",
    timestamps: true,
    underscored: true,
  }
);

module.exports = LabTest;
