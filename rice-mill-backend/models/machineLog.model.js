const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

// TODO: implement full column definitions. Reference fields (from architecture doc):
// batch_id (FK), machine_id (FK), operator_id (FK), start_time, end_time, running_hours, input_qty, output_qty, recovery_pct, downtime_minutes, downtime_reason_id (FK)
//
// Common columns applied to every table per architecture doc section 7 (not repeated per-model):
// id (PK), created_by (FK->users.id), updated_by (FK->users.id), created_at, updated_at,
// status (ENUM), is_deleted (BOOLEAN), plant_id (FK, multi-plant scalability)

class MachineLog extends Model {}

MachineLog.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // TODO: add remaining fields listed above
  },
  {
    sequelize,
    modelName: "MachineLog",
    tableName: "machine_logs",
    timestamps: true,
    underscored: true,
  }
);

module.exports = MachineLog;
