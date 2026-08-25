const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class LabTest extends Model {}

LabTest.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    sampling_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: { model: "sampling", key: "id" },
    },
    material_id: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    moisture_pct: { type: DataTypes.DECIMAL(5, 2) },
    broken_pct: { type: DataTypes.DECIMAL(5, 2) },
    fm_pct: { type: DataTypes.DECIMAL(5, 2) },
    color: { type: DataTypes.STRING(30) },
    smell: { type: DataTypes.STRING(30) },
    variety_detected: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: { model: "variety_master", key: "id" },
    },
    grain_size: { type: DataTypes.STRING(30) },
    comment: { type: DataTypes.STRING(500), allowNull: true },
    verdict: {
      type: DataTypes.ENUM("accepted", "rejected", "negotiation"),
      allowNull: false,
    },
    tested_by: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: { model: "users", key: "id" },
    },
    tested_at: { type: DataTypes.DATE },
    created_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: { model: "users", key: "id" },
    },
    updated_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: { model: "users", key: "id" },
    },
    is_deleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    plant_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: { model: "plant_master", key: "id" },
    }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "LabTest",
    tableName: "lab_test",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  },
);

module.exports = LabTest;
