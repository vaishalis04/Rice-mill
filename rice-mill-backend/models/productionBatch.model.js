const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class ProductionBatch extends Model {}

ProductionBatch.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    batch_no: { type: DataTypes.STRING(30), allowNull: false, unique: "production_batch_batch_no_unique" },
    lot_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "lots", key: "id" } },
    material_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "material_master", key: "id" } },
    warehouse_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "warehouse_master", key: "id" } },
    process_type: { type: DataTypes.ENUM("dry", "wet"), allowNull: true }, // no longer required by the simplified flow
    input_qty: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    production_date: { type: DataTypes.DATEONLY, allowNull: false },
    batch_status: {
  type: DataTypes.ENUM(
    "pending",
    "in_progress",
    "completed",
    "on_hold",
    "partial"
  ),
  allowNull: true,
  defaultValue: "pending",
},
    current_stage: {
      type: DataTypes.STRING(30), // was an ENUM tied to the old stage pipeline; now just "packing" | "completed"
      allowNull: true,
      defaultValue: "packing",
    },
    materials_data: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
      comment: "JSON array of materials for multi-material batches: [{material_id, input_qty, lot_id, lot_no}]",
    },
    is_multi_material: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } },
    is_final: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    sequelize,
    modelName: "ProductionBatch",
    tableName: "production_batch",
    timestamps: true,
    underscored: true,
  }
);

module.exports = ProductionBatch;