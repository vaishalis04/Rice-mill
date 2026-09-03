const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Packing extends Model {}

Packing.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    batch_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "production_batch", key: "id" } },
    lot_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "lots", key: "id" } }, 
    // Pack size in kg per bag. Was a fixed ENUM ("5","10","25","50","custom") which made
    // it impossible to actually store a real custom size (e.g. 15kg, 2kg) — "custom" was
    // just a literal string with no numeric value attached. Now it's a plain decimal, so
    // the common sizes (5/10/25/50) AND any custom size the mill packs in are all stored
    // as the real number, uniformly.
    pack_size: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    bag_count: { type: DataTypes.INTEGER, allowNull: false },
    batch_no: { type: DataTypes.STRING(30) },
    qr_code: { type: DataTypes.STRING(255), unique: "packing_qr_code_unique" },
    barcode: { type: DataTypes.STRING(100), unique: "packing_barcode_unique" },
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