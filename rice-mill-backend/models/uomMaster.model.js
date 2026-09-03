const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class UomMaster extends Model {}

UomMaster.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    uom_code: { type: DataTypes.STRING(10), allowNull: false, unique: "uom_master_uom_code_unique" },
    name: { type: DataTypes.STRING(50), allowNull: false },
    conversion_factor: { type: DataTypes.DECIMAL(10, 4), defaultValue: 1 },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "UomMaster",
    tableName: "uom_master",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = UomMaster;