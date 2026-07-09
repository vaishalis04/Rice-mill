const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class WasteManagement extends Model {}

WasteManagement.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    source_stage: { type: DataTypes.STRING(50), allowNull: false },
    batch_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "production_batch", key: "id" } },
    waste_type: { type: DataTypes.ENUM("husk", "dust", "stone", "other"), allowNull: false },
    qty: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    disposal_method: { type: DataTypes.STRING(100) },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "WasteManagement",
    tableName: "waste_management",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = WasteManagement;
