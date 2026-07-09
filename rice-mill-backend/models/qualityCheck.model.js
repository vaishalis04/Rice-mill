const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class QualityCheck extends Model {}

QualityCheck.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    batch_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "production_batch", key: "id" } },
    check_level: { type: DataTypes.ENUM("bag", "lot"), allowNull: false },
    accepted_qty: { type: DataTypes.DECIMAL(12, 2) },
    rejected_qty: { type: DataTypes.DECIMAL(12, 2) },
    reason_code_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "reason_code_master", key: "id" } },
    action: { type: DataTypes.ENUM("replace", "refund", "scrap"), allowNull: true },
    checked_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "QualityCheck",
    tableName: "quality_check",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = QualityCheck;
