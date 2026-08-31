const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Stack extends Model {}

Stack.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    stack_code: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    lot_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "lots", key: "id" } },
    warehouse_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "warehouse_master", key: "id" } },
    // Nullable to match Lot.bin_id — many warehouses don't do bin-level
    // tracking, so a stack can exist against a warehouse alone.
    bin_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "bin_stack_master", key: "id" } },
    qty: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    stacked_at: { type: DataTypes.DATE, allowNull: false },
    age_days: { type: DataTypes.VIRTUAL, get() { const s = this.getDataValue("stacked_at"); return s ? Math.floor((Date.now() - new Date(s)) / 86400000) : null; } }, // computed, not stored — note #24
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "Stack",
    tableName: "stacks",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = Stack;