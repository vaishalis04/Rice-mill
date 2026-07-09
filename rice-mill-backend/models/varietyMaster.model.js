const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class VarietyMaster extends Model {}

VarietyMaster.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    variety_name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    grain_type: { type: DataTypes.ENUM("long", "medium", "short"), allowNull: false },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "VarietyMaster",
    tableName: "variety_master",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = VarietyMaster;
