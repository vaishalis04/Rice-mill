const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Vehicle extends Model {}

Vehicle.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    vehicle_no: { type: DataTypes.STRING(20), allowNull: false, unique: "vehicles_vehicle_no_unique" },
    type: { type: DataTypes.ENUM("truck", "tractor_trolley"), allowNull: false },
    capacity: { type: DataTypes.DECIMAL(10, 2) },
    owner_vendor_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "vendors", key: "id" } },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "Vehicle",
    tableName: "vehicles",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = Vehicle;