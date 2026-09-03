const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class WarehouseMaster extends Model {}

WarehouseMaster.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    warehouse_code: { type: DataTypes.STRING(30), allowNull: false, unique: "warehouse_master_warehouse_code_unique" },
    name: { type: DataTypes.STRING(100), allowNull: false },
    location: { type: DataTypes.STRING(255) },
    capacity: { type: DataTypes.DECIMAL(12, 2) },
    type: { type: DataTypes.ENUM("raw", "fg"), allowNull: false },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "WarehouseMaster",
    tableName: "warehouse_master",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = WarehouseMaster;