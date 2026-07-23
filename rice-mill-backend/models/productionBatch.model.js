const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class ProductionBatch extends Model {}

ProductionBatch.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    batch_no: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    lot_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "lots", key: "id" } },
    process_type: { type: DataTypes.ENUM("dry", "wet"), allowNull: false }, // note #22
    input_qty: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    production_date: { type: DataTypes.DATEONLY, allowNull: false },
    batch_status: { type: DataTypes.ENUM("pending", "in_progress", "completed", "on_hold"), defaultValue: "pending" }, // renamed from generic "status" to avoid clashing with common record_status
    current_stage: {
      type: DataTypes.ENUM("dryer", "milling", "separator", "shiner", "color_sorter", "length_grading", "completed"),
      allowNull: false,
      defaultValue: "milling",
    }, // drives the FE stage tracker / "completing a stage unlocks the next"
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
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
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = ProductionBatch;
