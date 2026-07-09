const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class RateMaster extends Model {}

RateMaster.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    material_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "material_master", key: "id" } },
    variety_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "variety_master", key: "id" } },
    base_rate: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    effective_date: { type: DataTypes.DATEONLY, allowNull: false },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "RateMaster",
    tableName: "rate_master",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
    indexes: [
      { fields: ["material_id", "variety_id", "effective_date"] },
    ],
  }
);

module.exports = RateMaster;
