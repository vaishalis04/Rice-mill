const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Driver extends Model {}

Driver.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    mobile: { type: DataTypes.STRING(15), allowNull: false, unique: "drivers_mobile_unique" },
    license_no: { type: DataTypes.STRING(30), unique: "drivers_license_no_unique" },
    photo_url: { type: DataTypes.STRING(255) },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "Driver",
    tableName: "drivers",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = Driver;