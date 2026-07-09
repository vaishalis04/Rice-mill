const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class ShinerProcess extends Model {}

ShinerProcess.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    batch_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "production_batch", key: "id" } },
    stage_no: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 5 } },
    machine_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "machine_master", key: "id" } },
    input_qty: { type: DataTypes.DECIMAL(12, 2) },
    output_qty: { type: DataTypes.DECIMAL(12, 2) },
    loss_qty: { type: DataTypes.DECIMAL(12, 2) },
    bran_qty: { type: DataTypes.DECIMAL(12, 2) },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "ShinerProcess",
    tableName: "shiner_process",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = ShinerProcess;
