const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class QualityParameterMaster extends Model {}

QualityParameterMaster.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    parameter_name: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    unit: { type: DataTypes.STRING(20) },
    acceptable_min: { type: DataTypes.DECIMAL(10, 2) },
    acceptable_max: { type: DataTypes.DECIMAL(10, 2) },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "QualityParameterMaster",
    tableName: "quality_parameter_master",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = QualityParameterMaster;
