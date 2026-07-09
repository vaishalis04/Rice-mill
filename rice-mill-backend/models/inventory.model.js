const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Inventory extends Model {}

Inventory.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    lot_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "lots", key: "id" } },
    material_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "material_master", key: "id" } },
    warehouse_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "warehouse_master", key: "id" } },
    stage: { type: DataTypes.ENUM("raw", "wip", "fg", "by_product"), allowNull: false, defaultValue: "raw" }, // split out from ambiguous "warehouse_id/stage" in original doc
    qty_in: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    qty_out: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    balance_qty: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    as_of: { type: DataTypes.DATE },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "Inventory",
    tableName: "inventory",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
    indexes: [
      { fields: ["lot_id", "material_id", "stage"] },
    ],
  }
);

module.exports = Inventory;
