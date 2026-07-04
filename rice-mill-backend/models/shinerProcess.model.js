const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// TODO: implement full column definitions. Reference fields (from architecture doc):
// batch_id (FK), stage_no(1-5), machine_id (FK), input_qty, output_qty, loss_qty, bran_qty
//
// Common columns applied to every table per architecture doc section 7 (not repeated per-model):
// id (PK), created_by (FK->users.id), updated_by (FK->users.id), created_at, updated_at,
// status (ENUM), is_deleted (BOOLEAN), plant_id (FK, multi-plant scalability)

class ShinerProcess extends Model {}

ShinerProcess.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // TODO: add remaining fields listed above
  },
  {
    sequelize,
    modelName: "ShinerProcess",
    tableName: "shiner_process",
    timestamps: true,
    underscored: true,
  }
);

module.exports = ShinerProcess;
