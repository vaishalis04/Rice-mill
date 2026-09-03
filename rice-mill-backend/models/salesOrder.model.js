const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class SalesOrder extends Model {}

SalesOrder.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // Named unique constraint (not a bare `unique: true` — see
    // user.model.js for why) closing the actual structural gap that let
    // Sales Orders end up split into duplicate rows sharing one so_no in
    // the first place: nothing enforced so_no uniqueness at the DB level,
    // so a bug (the old updateBeforeApproval/addItem) or even a raw
    // double-submit could silently create a second row for the same
    // order. The model is one row per so_no by design — the DB should
    // refuse anything that breaks that, not just the application code.
    so_no: { type: DataTypes.STRING(30), allowNull: false, unique: "sales_order_so_no_unique" },
    customer_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: { model: "customers", key: "id" },
    },
    order_type: { type: DataTypes.ENUM("fg", "by_product"), allowNull: false }, // note #25
    material_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: {
        model: "material_master",
        key: "id",
      },
    },
    qty: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    }, // Running total of everything loaded against this order so far, across
    // possibly multiple trucks (see loading.controller.js). qty - dispatched_qty
    // = how much is still left to load.
    dispatched_qty: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    rate: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    order_date: { type: DataTypes.DATEONLY, allowNull: false },
    so_status: {
      type: DataTypes.ENUM(
        "pending",
        "confirmed",
        "allocated",
        "dispatched",
        "closed",
        "cancelled",
      ),
      defaultValue: "pending",
    }, // renamed from generic "status"
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
    items: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
  },
  {
    sequelize,
    modelName: "SalesOrder",
    tableName: "sales_order",
    timestamps: true,
    underscored: true,
    paranoid: false, // using explicit is_deleted flag instead of Sequelize's own soft-delete timestamp
  },
);

module.exports = SalesOrder;