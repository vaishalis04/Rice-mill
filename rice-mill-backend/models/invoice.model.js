const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Invoice extends Model {}

Invoice.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    invoice_no: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    dispatch_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "dispatch", key: "id" } },
    customer_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "customers", key: "id" } },
    amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    tax: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
    invoice_date: { type: DataTypes.DATEONLY, allowNull: false },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "Invoice",
    tableName: "invoices",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = Invoice;
