const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class MachineLog extends Model {}

MachineLog.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    batch_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "production_batch", key: "id" } },
    machine_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "machine_master", key: "id" } },
    operator_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    start_time: { type: DataTypes.DATE },
    end_time: { type: DataTypes.DATE },
    running_hours: { type: DataTypes.DECIMAL(6, 2) },
    input_qty: { type: DataTypes.DECIMAL(12, 2) },
    output_qty: { type: DataTypes.DECIMAL(12, 2) },
    recovery_pct: { type: DataTypes.DECIMAL(5, 2) },
    downtime_minutes: { type: DataTypes.INTEGER, defaultValue: 0 },
    downtime_reason_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "reason_code_master", key: "id" } }, // note #1: why it stops
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "MachineLog",
    tableName: "machine_logs",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = MachineLog;
