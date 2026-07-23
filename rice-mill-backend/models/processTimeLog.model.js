const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class ProcessTimeLog extends Model {}

ProcessTimeLog.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    batch_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "production_batch", key: "id" } },
    stage_name: { type: DataTypes.STRING(50), allowNull: false },
    stage_start: { type: DataTypes.DATE, allowNull: false },
    stage_end: { type: DataTypes.DATE, allowNull: true },
    duration_minutes: { type: DataTypes.VIRTUAL, get() { const s = this.getDataValue("stage_start"); const e = this.getDataValue("stage_end"); return s && e ? Math.round((new Date(e) - new Date(s)) / 60000) : null; } }, // note #26: end-to-end cycle time reporting
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "ProcessTimeLog",
    tableName: "process_time_log",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
    indexes: [
      { fields: ["batch_id", "stage_name"] },
    ],
  }
);

module.exports = ProcessTimeLog;