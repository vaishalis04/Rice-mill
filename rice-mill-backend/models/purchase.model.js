const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Purchase extends Model {}

Purchase.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    po_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "purchase_order", key: "id" } },
    gate_entry_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "gate_entry", key: "id" } },
    weight_slip_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "weight_slip", key: "id" } },
    final_rate: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    final_qty: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    purchase_date: { type: DataTypes.DATEONLY, allowNull: false },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "Purchase",
    tableName: "purchase",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = Purchase;
