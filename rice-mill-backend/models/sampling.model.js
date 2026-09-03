const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Sampling extends Model {}

Sampling.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    gate_entry_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "gate_entry", key: "id" } },
    po_id: { type: DataTypes.JSON, allowNull: true },
    material_id: { type: DataTypes.JSON, allowNull: false },
    sample_code: { type: DataTypes.STRING(30), allowNull: false, unique: "sampling_sample_code_unique" },
    collected_by: { type: DataTypes.BIGINT, allowNull: false, references: { model: "users", key: "id" } },
    collected_at: { type: DataTypes.DATE },
    sent_to_lab_at: { type: DataTypes.DATE, allowNull: true },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "Sampling",
    tableName: "sampling",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = Sampling;