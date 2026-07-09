const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class RejectMaterial extends Model {}

RejectMaterial.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    source_stage: { type: DataTypes.STRING(50), allowNull: false },
    batch_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "production_batch", key: "id" } },
    qty: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    reason_code_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "reason_code_master", key: "id" } },
    disposition: { type: DataTypes.ENUM("rework", "scrap", "return_to_vendor"), allowNull: true },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "RejectMaterial",
    tableName: "reject_material",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = RejectMaterial;
