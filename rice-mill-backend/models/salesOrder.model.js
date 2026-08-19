const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class SalesOrder extends Model {}

SalesOrder.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // No longer unique: a single SO can now have multiple line items
    // (different material/qty/rate combos) sharing one so_no.
    // Uniqueness is enforced instead on (so_no, material_id) — see
    // salesOrder.controller.js's create/bulkCreate/addItem.
    so_no: { type: DataTypes.STRING(30), allowNull: false },
    customer_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "customers", key: "id" } },
    order_type: { type: DataTypes.ENUM("fg", "by_product"), allowNull: false }, // note #25
    material_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: "material_master", key: "id" } },
    qty: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    // Running total of everything loaded against this order so far, across
    // possibly multiple trucks (see loading.controller.js). qty - dispatched_qty
    // = how much is still left to load.
    dispatched_qty: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    rate: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    order_date: { type: DataTypes.DATEONLY, allowNull: false },
    so_status: { type: DataTypes.ENUM("pending", "confirmed", "allocated", "dispatched", "closed", "cancelled"), defaultValue: "pending" }, // renamed from generic "status"
    created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    updated_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: "users", key: "id" } },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    plant_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: "plant_master", key: "id" } }, // multi-plant scalability
  },
  {
    sequelize,
    modelName: "SalesOrder",
    tableName: "sales_order",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  }
);

module.exports = SalesOrder;