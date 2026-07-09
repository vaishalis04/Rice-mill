const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class ByProductInventory extends Model {}

ByProductInventory.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    material_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "material_master", key: "id" } }, // husk/bran/broken
    qty_produced: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    qty_sold: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    qty_in_stock: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 }, // notes #19, #20
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "ByProductInventory",
    tableName: "by_product_inventory",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = ByProductInventory;
