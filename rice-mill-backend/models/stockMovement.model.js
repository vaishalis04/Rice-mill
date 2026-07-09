const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class StockMovement extends Model {}

StockMovement.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    material_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "material_master", key: "id" } },
    lot_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "lots", key: "id" } },
    from_location: { type: DataTypes.STRING(100) },
    to_location: { type: DataTypes.STRING(100) },
    qty: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    movement_type: { type: DataTypes.ENUM("in", "out", "transfer"), allowNull: false },
    moved_at: { type: DataTypes.DATE, allowNull: false },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "StockMovement",
    tableName: "stock_movement",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = StockMovement;
