const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// TODO: implement full column definitions. Reference fields (from architecture doc):
// gate_entry_id (FK), slip_no, gross_weight, tare_weight, net_weight, weighed_at, weighbridge_operator_id (FK)
//
// Common columns applied to every table per architecture doc section 7 (not repeated per-model):
// id (PK), created_by (FK->users.id), updated_by (FK->users.id), created_at, updated_at,
// status (ENUM), is_deleted (BOOLEAN), plant_id (FK, multi-plant scalability)

class WeightSlip extends Model {}

WeightSlip.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // TODO: add remaining fields listed above
  },
  {
    sequelize,
    modelName: "WeightSlip",
    tableName: "weight_slip",
    timestamps: true,
    underscored: true,
  }
);

module.exports = WeightSlip;
