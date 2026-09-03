const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Customer extends Model {}

Customer.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    customer_code: { type: DataTypes.STRING(30), allowNull: false, unique: "customers_customer_code_unique" },
    name: { type: DataTypes.STRING(150), allowNull: false },
    gstin: { type: DataTypes.STRING(15), unique: "customers_gstin_unique", validate: { len: [15, 15] } },
    address: { type: DataTypes.TEXT },
    credit_limit: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    customer_type: { type: DataTypes.ENUM("fg", "by_product"), defaultValue: "fg" }, // note #25: by-product customers != FG customers
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "Customer",
    tableName: "customers",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = Customer;