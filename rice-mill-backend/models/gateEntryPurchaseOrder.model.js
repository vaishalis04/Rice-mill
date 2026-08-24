const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class GateEntryPurchaseOrder extends Model {}

GateEntryPurchaseOrder.init(
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    gate_entry_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "gate_entry",
        key: "id",
      },
    },

    po_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "purchase_order",
        key: "id",
      },
    },

    material_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      references: {
        model: "material_master",
        key: "id",
      },
    },

    qty: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },

    created_by: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "users",
        key: "id",
      },
    },

    updated_by: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: {
        model: "users",
        key: "id",
      },
    },

    is_deleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    sequelize,
    modelName: "GateEntryPurchaseOrder",
    tableName: "gate_entry_purchase_orders",
    timestamps: true,
    underscored: true,
    paranoid: false,
  }
);

module.exports = GateEntryPurchaseOrder;