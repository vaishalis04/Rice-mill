const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Lot extends Model {}

Lot.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    lot_no: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    purchase_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "purchase", key: "id" } }, // null for production-generated lots
    material_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "material_master", key: "id" } },
    variety_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "variety_master", key: "id" } },
    qty: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    parent_lot_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "lots", key: "id" } }, // self-FK: traceability backbone
    // destination: { type: DataTypes.ENUM("warehouse", "production"), allowNull: true }, // set via PATCH /api/lots/:id/route
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "Lot",
    tableName: "lots",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = Lot;
