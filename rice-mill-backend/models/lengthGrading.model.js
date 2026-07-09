const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class LengthGrading extends Model {}

LengthGrading.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    batch_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "production_batch", key: "id" } },
    input_qty: { type: DataTypes.DECIMAL(12, 2) },
    long_qty: { type: DataTypes.DECIMAL(12, 2) },
    medium_qty: { type: DataTypes.DECIMAL(12, 2) },
    broken_qty: { type: DataTypes.DECIMAL(12, 2) },
    small_broken_qty: { type: DataTypes.DECIMAL(12, 2) },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "LengthGrading",
    tableName: "length_grading",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = LengthGrading;
