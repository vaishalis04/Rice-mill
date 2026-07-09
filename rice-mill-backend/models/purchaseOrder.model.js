const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class PurchaseOrder extends Model {}

PurchaseOrder.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    po_no: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    vendor_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "vendors", key: "id" } },
    material_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "material_master", key: "id" } },
    variety_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "variety_master", key: "id" } },
    qty: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    rate: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    po_date: { type: DataTypes.DATEONLY, allowNull: false },
    validity: { type: DataTypes.DATEONLY },
    do_no: { type: DataTypes.STRING(30) }, // Delivery Order number
    uploaded_by_vendor: { type: DataTypes.BOOLEAN, defaultValue: false }, // note #12
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "PurchaseOrder",
    tableName: "purchase_order",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = PurchaseOrder;
