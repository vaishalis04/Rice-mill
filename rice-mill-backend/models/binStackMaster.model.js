const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class BinStackMaster extends Model {}

BinStackMaster.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    bin_code: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    warehouse_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "warehouse_master", key: "id" } },
    capacity: { type: DataTypes.DECIMAL(12, 2) },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "BinStackMaster",
    tableName: "bin_stack_master",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = BinStackMaster;
