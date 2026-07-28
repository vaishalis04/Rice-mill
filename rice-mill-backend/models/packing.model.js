const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Packing extends Model {}

Packing.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    batch_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "production_batch", key: "id" } },
    lot_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "lots", key: "id" } }, 
    pack_size: { type: DataTypes.ENUM("5", "10", "25", "50", "custom"), allowNull: false },
    bag_count: { type: DataTypes.INTEGER, allowNull: false },
    batch_no: { type: DataTypes.STRING(30) },
    qr_code: { type: DataTypes.STRING(255), unique: true },
    barcode: { type: DataTypes.STRING(100), unique: true },
    production_date: { type: DataTypes.DATEONLY },
    expiry_date: { type: DataTypes.DATEONLY },
    packed_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, 
  },
  {
    sequelize,
    modelName: "Packing",
    tableName: "packing",
    timestamps: true,
    underscored: true,
    paranoid: false, 
  }
);

module.exports = Packing;
