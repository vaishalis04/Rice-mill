const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class Payment extends Model {}

Payment.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    invoice_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "invoices", key: "id" } },
    amount_paid: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    payment_date: { type: DataTypes.DATEONLY, allowNull: false },
    mode: { type: DataTypes.ENUM("cash", "bank_transfer", "cheque", "upi", "other"), allowNull: false },
    reference_no: { type: DataTypes.STRING(50) },
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "Payment",
    tableName: "payments",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = Payment;
