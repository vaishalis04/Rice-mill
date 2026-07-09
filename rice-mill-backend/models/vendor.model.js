const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Vendor extends Model {}

Vendor.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    vendor_code: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(150), allowNull: false },
    gstin: { type: DataTypes.STRING(15), unique: true, validate: { len: [15, 15] } },
    address: { type: DataTypes.TEXT },
    bank_details: { type: DataTypes.JSON },
    rating: { type: DataTypes.DECIMAL(3, 2), defaultValue: 0 },
    credit_terms: { type: DataTypes.STRING(50) },
    vendor_type: { type: DataTypes.ENUM("supplier", "by_product_buyer"), defaultValue: "supplier" },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "Vendor",
    tableName: "vendors",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = Vendor;
