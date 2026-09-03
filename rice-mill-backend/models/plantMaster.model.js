const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class PlantMaster extends Model {}

PlantMaster.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    plant_code: { type: DataTypes.STRING(20), allowNull: false, unique: "plant_master_plant_code_unique" },
    name: { type: DataTypes.STRING(100), allowNull: false },
    address: { type: DataTypes.TEXT },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  {
    sequelize,
    modelName: "PlantMaster",
    tableName: "plant_master",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = PlantMaster;