const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class PurchaseOrder extends Model {}

PurchaseOrder.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // No longer unique: a single PO can now have multiple line items
    // (different material/variety/qty/rate combos) sharing one po_no.
    // Uniqueness is enforced instead on (po_no, material_id, variety_id) —
    // see purchase.controller.js's create/bulkCreate.
    po_no: { type: DataTypes.STRING(30), allowNull: false },
    vendor_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: { model: "vendors", key: "id" },
    },
    material_id: {
  type: DataTypes.BIGINT,
  allowNull: true,
  references: { model: "material_master", key: "id" },
},
    variety_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: { model: "variety_master", key: "id" },
    },
    qty: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
    rate: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    po_date: { type: DataTypes.DATEONLY, allowNull: false },
    validity: { type: DataTypes.DATEONLY },
    do_no: { type: DataTypes.STRING(30) }, // Delivery Order number
    uploaded_by_vendor: { type: DataTypes.BOOLEAN, defaultValue: false }, // note #12
    created_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: { model: "users", key: "id" },
    },
    updated_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: { model: "users", key: "id" },
    },
    approval_status: {
      type: DataTypes.ENUM("pending_approval", "approved", "rejected"),
      allowNull: false,
      defaultValue: "pending_approval",
    },

    approved_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: {
        model: "users",
        key: "id",
      },
    },

    approved_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    rejection_reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    is_deleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    plant_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: { model: "plant_master", key: "id" },
    }, // multi-plant scalability
    items: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
  },
  {
    sequelize,
    modelName: "PurchaseOrder",
    tableName: "purchase_order",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  },
);

module.exports = PurchaseOrder;
