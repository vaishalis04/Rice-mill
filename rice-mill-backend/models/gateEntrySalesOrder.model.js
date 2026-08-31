const { DataTypes, Model } = require("sequelize");
const sequelize = require("../config/db");

class GateEntrySalesOrder extends Model {}

GateEntrySalesOrder.init(
  {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },

    gate_entry_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: {
        model: "gate_entry",
        key: "id",
      },
    },

    so_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: {
        model: "sales_order",
        key: "id",
      },
    },

    material_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: {
        model: "material_master",
        key: "id",
      },
    },

    qty: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },

    created_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: {
        model: "users",
        key: "id",
      },
    },

    updated_by: {
      type: DataTypes.BIGINT,
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

    plant_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: {
        model: "plant_master",
        key: "id",
      },
    },
  },
  {
    sequelize,
    modelName: "GateEntrySalesOrder",
    tableName: "gate_entry_sales_orders",
    timestamps: true,
    underscored: true,
    paranoid: false,
  }
);

module.exports = GateEntrySalesOrder;